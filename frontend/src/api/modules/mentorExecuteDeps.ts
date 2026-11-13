// El trabajo REAL de «Ejecutar plan»: cada tarea llama a una función que la app ya tiene (generación de un tema, canvas, manifiesto, ejercicios por
// skill, carpetas del Sistema de práctica por área). Aquí solo se añade lo que garantiza la seguridad:
//  · la carpeta del tema se FOTOGRAFÍA antes de la tarea y, si la generación tocó un archivo que ya existía, se RESTAURA tal cual (nunca se sobrescribe);
//  · la señal de cancelación (`withAiSignal`) llega a las llamadas de IA de esas funciones y MATA la petición o el proceso de Claude Code;
//  · el resultado se VALIDA con el checklist de diseño (`lib/topicDesign.ts`) antes de dar la tarea por buena.
// Lo que crea es la lista de archivos nuevos (diferencia entre el antes y el después), que queda en el registro de la ejecución.

import * as fs from "node:fs";
import * as path from "node:path";
import { generateConcept } from "../../../tools/kb_canvas";
import { AIConfig, sendChat, type ChatMessage } from "../../core/aiClient.js";
import { withAiSignal } from "../../core/aiAbort.js";
import { ApiError } from "../../core/errors.js";
import { areaFolderOf, declaredLevelOf, kataForDay, kataLevel, kataNote, levelFromDeclared } from "../../lib/areaPracticeSystem.js";
import { createAreaPracticeFolders } from "../../core/mentor/areaPracticeFolders.js";
import { kataBlockMessages, mergeAiKata, parseKataBlock } from "../../core/mentor/areaKatasAi.js";
import type { ExecDeps, TaskRunResult } from "../../core/mentor/planExecutor.js";
import { ppAreaDir } from "../../core/mentor/practiceState.js";
import { diskExercises, readRawManifest, scanTopicDesigns } from "../../core/mentor/topicDesignScan.js";
import { ensureTopicViewFiles } from "../../core/practice/viewFiles.js";
import { safeName } from "../../core/assistantActions.js";
import { PlanStore } from "../../core/mentor/plan.js";
import { practiceCells } from "../../lib/planExecution.js";
import type { TaskState } from "../../lib/planExecution.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { clearStudySnapshotCache, reevaluateTopic, studyApi } from "./study.js";
import { studySpaceApi } from "./studySpace.js";
import { ppApi } from "./pp.js";
import { withGenerationLock } from "./generationLock.js";

type SendFn = (cfg: AIConfig, messages: ChatMessage[], opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<string>;

const MAX_SNAPSHOT_FILES = 3000;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const posix = (p: string): string => p.split(path.sep).join("/");
const abortError = (): Error => Object.assign(new Error("Cancelado."), { name: "AbortError" });

/** Todos los archivos bajo `dir` (rutas relativas POSIX) con su contenido, para poder restaurarlos. Los demasiado grandes solo se registran. */
function snapshot(dir: string): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.size >= MAX_SNAPSHOT_FILES) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          out.set(posix(path.relative(dir, full)), fs.statSync(full).size <= MAX_SNAPSHOT_BYTES ? fs.readFileSync(full) : null);
        } catch {
          out.set(posix(path.relative(dir, full)), null);
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** Restaura los archivos que existían y cambiaron (o desaparecieron); devuelve las rutas restauradas y las nuevas. */
function restoreAndDiff(dir: string, before: Map<string, Buffer | null>): { restored: string[]; created: string[] } {
  const after = snapshot(dir);
  const restored: string[] = [];
  for (const [rel, buf] of before) {
    if (buf === null) continue;
    const now = after.get(rel);
    if (now === undefined || (now !== null && !now.equals(buf))) {
      try {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), buf);
        restored.push(rel);
      } catch {
        /* no se pudo restaurar: queda el aviso */
      }
    }
  }
  const created = [...after.keys()].filter((rel) => !before.has(rel));
  return { restored, created };
}

export interface ExecDepsOptions {
  /** inyectable en los tests para las llamadas de IA propias (katas con IA) */
  send?: SendFn;
  /** hoy (AAAA-MM-DD) para el nivel de los katas */
  today?: () => string;
}

export function makeExecDeps(app: AppState, planId: string, o: ExecDepsOptions = {}): ExecDeps {
  const rel = (abs: string): string => posix(app.rel(abs));
  const topicAbs = (folder: string): string => path.join(app.root, ...folder.split("/"));
  const study = studyApi(app);
  const space = studySpaceApi(app);
  const plan = () => new PlanStore(app.root).load(planId);
  // La lectura por archivo (`exerciseIndex`) se valida sola con la fecha y el tamaño de cada nota, así que NO se vacía: vaciarla obligaba a
  // releer las ~3 000 notas del vault, de forma síncrona, tras cada tarea y cada ejercicio, y dejaba la app colgada mientras corría la ejecución.
  const caches = (): void => {
    clearStudySnapshotCache();
  };

  /** Genera un tema con `study_topic_generate` (teoría, mapa y, si se pide, matriz) y espera a que termine el trabajo. */
  async function generate(folder: string, steps: { theory: boolean; map: boolean; practice: boolean }, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<void> {
    // de una en una (el turno se comparte con «Regenerar»), y así cada tarea sabe exactamente qué creó
    await withGenerationLock(() => generateLocked(folder, steps, ctx));
  }

  async function generateLocked(folder: string, steps: { theory: boolean; map: boolean; practice: boolean }, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<void> {
    if (ctx.signal.aborted) throw abortError();
    const { jobId } = space.study_topic_generate(folder, "", steps);
    let seen = 0;
    const started = Date.now();
    for (;;) {
      const st = space.study_space_status(jobId);
      for (; seen < st.log.length; seen++) ctx.say(st.log[seen]!.slice(0, 160));
      if (st.done) {
        if (st.error) throw new Error(st.error);
        if (ctx.signal.aborted) throw abortError();
        return;
      }
      // tras cancelar, el trabajo falla enseguida (la señal mata sus llamadas); se espera a que termine para no dejarlo escribiendo
      if (ctx.signal.aborted && Date.now() - started > 60_000) throw abortError();
      await sleep(250);
    }
  }

  async function runTopicTask(task: TaskState, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<TaskRunResult> {
    const folder = task.folder!;
    const abs = topicAbs(folder);
    const proposed = !!task.args?.proposed;
    let target = folder;
    let targetAbs = abs;
    if (proposed || !fs.existsSync(abs)) {
      // un tema nuevo: la carpeta no existe todavía (propuesto por la revisión, o un tema del plan que ya no está en la vault)
      if (proposed) {
        const resolved = proposedFolder(app, plan(), task);
        if (!resolved) throw new ApiError("No se pudo decidir en qué rama de la vault crear el tema.");
        target = resolved;
        targetAbs = topicAbs(resolved);
      }
      fs.mkdirSync(targetAbs, { recursive: true });
    }
    const beforeTopic = snapshot(targetAbs);
    const hadTheory = [...beforeTopic.keys()].some((f) => !f.includes("/") && /\.md$/i.test(f) && !/\.(practica|resumen)\.md$/i.test(f) && !f.startsWith("_"));
    if (task.kind === "theory" && hadTheory) return { created: [], skippedFiles: [target], note: "El tema ya tiene nota de teoría: no se reescribe." };
    ctx.say(`Generando «${path.basename(targetAbs)}»…`);
    await withAiSignal(ctx.signal, () => generate(target, { theory: true, map: true, practice: task.kind === "topic_new" }, ctx));
    caches();
    const { restored, created: own } = restoreAndDiff(targetAbs, beforeTopic);
    // la generación de UN tema solo escribe en la carpeta de ese tema (ya no crea vistas de los hermanos), así que solo se registra lo suyo
    const rels = new Set(own.map((r) => posix(path.relative(app.root, path.join(targetAbs, r)))));
    return {
      created: [...rels],
      warnings: restored.map((r) => `Se restauró «${r}»: la generación intentó modificar un archivo que ya existía.`),
    };
  }

  async function runCanvas(task: TaskState): Promise<TaskRunResult> {
    const abs = topicAbs(task.folder!);
    const files = fs.existsSync(abs) ? fs.readdirSync(abs) : [];
    if (files.some((f) => f.toLowerCase().endsWith(".canvas"))) return { created: [], skippedFiles: [task.folder!], note: "El tema ya tiene canvas: no se reescribe." };
    const before = snapshot(abs);
    try {
      generateConcept(abs);
    } catch (e) {
      throw new Error(`No se pudo generar el canvas: ${(e as Error).message}`);
    }
    caches();
    const { created, restored } = restoreAndDiff(abs, before);
    return { created: created.map((r) => `${task.folder}/${r}`), warnings: restored.map((r) => `Se restauró «${r}».`) };
  }

  async function runManifest(task: TaskState, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<TaskRunResult> {
    const abs = topicAbs(task.folder!);
    const name = path.basename(abs);
    const files = fs.existsSync(abs) ? fs.readdirSync(abs) : [];
    if (files.some((f) => f === `${name}.practica.md` || f === "_tema.md" || f === "tema.md")) return { created: [], skippedFiles: [task.folder!], note: "El tema ya tiene manifiesto: no se reescribe." };
    const before = snapshot(abs);
    ensureTopicViewFiles(app.root, abs);
    caches();
    ctx.say(`Eligiendo las skills de «${name}»…`);
    await withAiSignal(ctx.signal, () => reevaluateTopic(app, task.folder!, { createView: true }));
    caches();
    const { created, restored } = restoreAndDiff(abs, before);
    return { created: created.map((r) => `${task.folder}/${r}`), warnings: restored.map((r) => `Se restauró «${r}».`) };
  }

  async function runPractice(task: TaskState, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<TaskRunResult> {
    const folder = task.folder!;
    const abs = topicAbs(folder);
    const includeRecommended = task.args?.includeRecommended === true || (Array.isArray(task.args?.cells) && (task.args!.cells as unknown[]).length > 0 && task.required === false);
    const design = (): ReturnType<typeof scanTopicDesigns> extends Map<string, infer D> ? D : never =>
      scanTopicDesigns([{ folder, title: task.title }], { root: app.root, exercises: diskExercises(app.root, folder) }).get(folder)!;
    const cells = practiceCells(design(), includeRecommended);
    if (!cells.length) return { created: [], note: "No faltan ejercicios." };
    const before = snapshot(abs);
    const manifest = readRawManifest(path.join(abs, `${path.basename(abs)}.practica.md`));
    const created: string[] = [];
    const warnings: string[] = [];
    for (const c of cells) {
      if (ctx.signal.aborted) throw abortError();
      ctx.say(`Ejercicios de ${c.skill} (dificultad ${c.difficulty})…`);
      const r = await withAiSignal(ctx.signal, () => study.study_topic_session_build(folder, c.skill, c.difficulty, (manifest?.plan?.[c.skill]?.[c.difficulty - 1] ?? 0) > 0 ? "ai" : "3-5", "no_help", true));
      caches();
      for (const e of r.exercises) if (e.is_new) created.push(e.path.replace(/\\/g, "/"));
      if (r.generated_count === 0 && r.existing_count === 0) warnings.push(`La IA no devolvió ejercicios válidos para ${c.skill} (dificultad ${c.difficulty}).`);
    }
    const { restored } = restoreAndDiff(abs, before);
    return { created, warnings: [...warnings, ...restored.map((r) => `Se restauró «${r}».`)] };
  }

  function runAreaFolder(task: TaskState): TaskRunResult {
    const ppDir = ppAreaDir(app.root);
    if (!ppDir) throw new ApiError("El módulo programming_practice no está instalado.");
    const areaId = String(task.args?.areaId ?? "");
    const p = plan();
    const declared = declaredLevelOf(p?.preconditions?.levels as Record<string, string> | undefined, areaId);
    const r = createAreaPracticeFolders({ ppDir, areas: [areaId], katasPerArea: Number(task.args?.katas) || 0, fromDay: Number(task.args?.fromDay) || 1, levels: { [areaId]: levelFromDeclared(declared) } });
    caches();
    if (r.failed.length) throw new Error(`No se pudo escribir ${r.failed[0]!.rel}: ${r.failed[0]!.reason}`);
    const base = rel(ppDir);
    return { created: r.created.map((f) => `${base}/${f}`), skippedFiles: r.skipped.map((f) => `${base}/${f}`) };
  }

  async function runKatasAi(task: TaskState, ctx: { signal: AbortSignal; say: (l: string) => void }): Promise<TaskRunResult> {
    const ppDir = ppAreaDir(app.root);
    if (!ppDir) throw new ApiError("El módulo programming_practice no está instalado.");
    const areaId = String(task.args?.areaId ?? "");
    const katasDir = path.join(ppDir, areaFolderOf(areaId), "katas");
    fs.mkdirSync(katasDir, { recursive: true });
    const have = new Set(fs.readdirSync(katasDir).map((f) => /^(\d{3}) /.exec(f)?.[1]).filter(Boolean) as string[]);
    const days = ((task.args?.days as number[]) ?? []).filter((d) => !have.has(String(d).padStart(3, "0")));
    if (!days.length) return { created: [], note: "Esos katas ya existen: no se reescriben." };
    const p = plan();
    const declared = declaredLevelOf(p?.preconditions?.levels as Record<string, string> | undefined, areaId);
    const level = kataLevel(declared, 0);
    const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
    let reply = "";
    try {
      reply = await (o.send ?? ((c, m, opts) => sendChat(c, m, opts)))(cfg, kataBlockMessages(areaId, days.map((d) => ({ day: d, level }))), { signal: ctx.signal, timeoutMs: 240_000 });
    } catch (e) {
      if (ctx.signal.aborted) throw abortError();
      ctx.say(`La IA no respondió (${(e as Error).message}); se usan las plantillas.`);
    }
    const ai = parseKataBlock(reply, days);
    const created: string[] = [];
    const base = rel(katasDir);
    let fromAi = 0;
    for (const d of days) {
      const t = kataForDay(areaId, d, level);
      if (!t) continue;
      const k = ai.has(d) ? mergeAiKata(t, ai.get(d)!) : t;
      if (ai.has(d)) fromAi++;
      try {
        fs.writeFileSync(path.join(katasDir, k.file), kataNote(k), { encoding: "utf-8", flag: "wx" });
        created.push(`${base}/${k.file}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    caches();
    return { created, note: `${fromAi} de ${days.length} katas vienen de la IA; el resto, de las plantillas.` };
  }

  return {
    async run(task, ctx) {
      if (ctx.signal.aborted) throw abortError();
      switch (task.kind) {
        case "pp_init": {
          const r = ppApi(app).pp_init();
          caches();
          return { created: r.created };
        }
        case "area_folder":
          return runAreaFolder(task);
        case "area_katas_ai":
          return runKatasAi(task, ctx);
        case "topic_new":
        case "theory":
          return runTopicTask(task, ctx);
        case "canvas":
          return runCanvas(task);
        case "manifest":
          return runManifest(task, ctx);
        case "practice":
          return runPractice(task, ctx);
        default:
          throw new Error(`Tarea desconocida: ${String(task.kind)}`);
      }
    },

    async validate(task, result) {
      const problems: string[] = [];
      const warnings: string[] = [...(result.warnings ?? [])];
      if (task.kind === "pp_init") {
        if (!ppAreaDir(app.root)) problems.push("no se creó la carpeta programming_practice");
        return { problems, warnings };
      }
      if (task.kind === "area_folder" || task.kind === "area_katas_ai") {
        const ppDir = ppAreaDir(app.root);
        const areaId = String(task.args?.areaId ?? "");
        if (!ppDir || !fs.existsSync(path.join(ppDir, areaFolderOf(areaId)))) problems.push("la carpeta del área no existe");
        else if (task.kind === "area_folder" && !fs.existsSync(path.join(ppDir, areaFolderOf(areaId), "README.md"))) problems.push("falta el README del área");
        return { problems, warnings };
      }
      const folder = task.kind === "topic_new" && task.args?.proposed ? proposedFolder(app, plan(), task) : task.folder;
      if (!folder) return { problems: ["no se sabe qué carpeta de tema validar"], warnings };
      const d = scanTopicDesigns([{ folder, title: task.title }], { root: app.root, exercises: diskExercises(app.root, folder) }).get(folder)!;
      const has = (id: string): boolean => !!d.items.find((i) => i.id === id)?.ok;
      if ((task.kind === "theory" || task.kind === "topic_new") && !has("theory")) problems.push("no se creó la nota de teoría");
      if (task.kind === "canvas" && !has("canvas")) problems.push("no se creó el canvas");
      if (task.kind === "manifest" && !has("manifest")) problems.push("no se creó el manifiesto con skills");
      if (task.kind === "practice") {
        const missing = d.gaps.filter((g) => g.artifact === "practice_basic" && g.fix === "practice");
        if (missing.length && !result.note) problems.push(`siguen sin ejercicios: ${missing.map((g) => g.skill).join(", ")}`);
      }
      // la nota nueva debe cumplir el contrato: si no, se avisa (no se descarta lo creado)
      for (const g of d.gaps) if (g.artifact === "contract" && (task.kind === "theory" || task.kind === "topic_new")) warnings.push(g.text);
      return { problems, warnings: [...new Set(warnings)].slice(0, 10) };
    },
  };
}

// ── Carpeta de un tema propuesto por la revisión ───────────────────────

/** `Programación/4 Backend/4.19 Título`: la rama donde más temas tiene el área y el siguiente número libre. */
export function proposedFolder(app: AppState, plan: ReturnType<PlanStore["load"]>, task: TaskState): string | null {
  if (!plan) return null;
  const sub = plan.subplans.find((s) => (s.areaId ?? s.id) === task.areaKey);
  if (!sub) return null;
  const counts = new Map<string, number>();
  for (const t of sub.topics) {
    const segs = t.folder.split("/");
    if (segs.length >= 3) counts.set(segs.slice(0, 2).join("/"), (counts.get(segs.slice(0, 2).join("/")) ?? 0) + 1);
  }
  const branch = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!branch) return null;
  const abs = path.join(app.root, ...branch.split("/"));
  const prefix = /^(\d+(?:\.\d+)*)/.exec(path.basename(abs))?.[1];
  let max = 0;
  try {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const m = e.isDirectory() ? new RegExp(`^${(prefix ?? "").replace(/\./g, "\\.")}\\.(\\d+)\\b`).exec(e.name) : null;
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    return null;
  }
  const title = safeName(task.title).replace(/^\d+(?:\.\d+)*\s+/, "").trim();
  if (!title || !prefix) return null;
  // una carpeta con el mismo título (sin número) ya existe: no se duplica
  const same = fs.existsSync(abs) ? fs.readdirSync(abs).find((n) => n.replace(/^[\d.\s]+/, "").toLowerCase() === title.toLowerCase()) : undefined;
  return `${branch}/${same ?? `${prefix}.${max + 1} ${title}`}`;
}

