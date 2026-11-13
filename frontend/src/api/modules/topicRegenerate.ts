// «Regenerar» un tema desde el Mentor (Plan > Temas por área): rehace la TEORÍA (y su canvas), la PRÁCTICA (la matriz .practica) o los EJERCICIOS.
//
//  - study_topic_regenerate(folder, what, confirm, engine?) -> { jobId }: trabajo largo en segundo plano. Exige `confirm: true` (la persona lo confirmó en el
//    diálogo) y un motor que pueda correr: «app» (la IA configurada; no en modo puente) o «claude» (igual, pero el proveedor tiene que ser Claude). El tercer
//    motor, el agente externo (Antigravity / Claude Code), va por `topicRegenerateHandoff.ts` (study_topic_regenerate_handoff / _validate). Es el ÚNICO camino que reemplaza contenido que ya existe, y SIEMPRE lo respalda antes:
//      · teoría  -> copia la nota (y los canvas del tema) a `<vault>/.trash/regenerar/<fecha>_<tema>/`, genera de nuevo con `force` (el canvas lo
//                   rehace `generateConcept`: uno editado a mano se conserva y el nuevo va a `.nuevo.canvas`). Si falla, RESTAURA la copia.
//      · práctica -> copia `<tema>.practica.md`, re-evalúa con la IA. Si falla, restaura la copia.
//      · ejercicios -> MUEVE `Ejercicios/<skill>/ej_*.md` al archivo `.trash/regenerar/…/Ejercicios/<skill>/` (el historial de intentos va por ruta y
//                   queda con los archivos archivados) y genera un juego nuevo por celda skill x dificultad. Si no se genera nada, los devuelve.
//  - study_topic_regenerate_status(jobId) -> el estado del trabajo (se consulta cada poco).
//
// Nada se borra: lo anterior queda siempre en `.trash` (recuperable a mano). El turno de generación se comparte con «Ejecutar plan».

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { withAiSignal } from "../../core/aiAbort.js";
import { AIConfig } from "../../core/aiClient.js";
import { ApiError } from "../../core/errors.js";
import { engineBlockedReason, REGEN_ENGINES, type RegenEngine } from "./regenEngines.js";
import { generateConcept } from "../../../tools/kb_canvas";
import { diskExercises, readRawManifest, scanTopicDesigns } from "../../core/mentor/topicDesignScan.js";
import { parseExercise } from "../../core/practice/exerciseNote.js";
import { clearExerciseIndexCache } from "../../core/practice/exerciseIndex.js";
import { practiceCells } from "../../lib/planExecution.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { withGenerationLock } from "./generationLock.js";
import { clearStudySnapshotCache, reevaluateTopic, studyApi } from "./study.js";
import { studySpaceApi } from "./studySpace.js";

export type RegenWhat = "theory" | "map" | "practice" | "exercises" | "all";
const WHATS: readonly RegenWhat[] = ["theory", "map", "practice", "exercises", "all"];

export interface RegenJob {
  id: string;
  folder: string;
  what: RegenWhat;
  log: string[];
  done: boolean;
  error: string;
  finished: number;
  total: number;
  /** carpeta de la copia de seguridad (relativa a la vault, POSIX) */
  backup: string;
  /** la generación falló y se devolvió lo anterior */
  restored: boolean;
  /** archivos nuevos (relativos a la vault) */
  created: string[];
  /** archivos respaldados / archivados (relativos a la vault) */
  archived: string[];
}

/** Piezas sustituibles (los tests ponen una IA simulada). */
export interface RegenHooks {
  /** genera de nuevo la teoría del tema; devuelve el texto de error o "" si salió bien */
  generateTheory?: (folder: string, signal: AbortSignal) => Promise<string>;
  /** re-evalúa la matriz de práctica del tema */
  reevaluate?: (folder: string, signal: AbortSignal) => Promise<void>;
  /** construye los ejercicios de una celda; devuelve las rutas nuevas */
  buildExercises?: (folder: string, skill: string, difficulty: number, signal: AbortSignal) => Promise<string[]>;
  /** rehace el canvas explicativo desde la nota; devuelve el texto de error o "" y la ruta del archivo nuevo si fue un `.nuevo.canvas` */
  generateMap?: (topicAbs: string) => { error: string; alt?: string };
  pollMs?: number;
  now?: () => Date;
}

export const posix = (p: string): string => p.split(path.sep).join("/");
export const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/** Copia `file` a `dest` (creando carpetas); nunca pisa una copia anterior. */
export function copyInto(file: string, destDir: string, name = path.basename(file)): string {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, name);
  fs.copyFileSync(file, dest);
  return dest;
}

/** Mueve `file` a `destDir` (sin pisar nada: añade `_n` si ya hay uno igual). */
export function moveInto(file: string, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true });
  const parsed = path.parse(file);
  let dest = path.join(destDir, parsed.base);
  for (let n = 1; fs.existsSync(dest); n++) dest = path.join(destDir, `${parsed.name}_${n}${parsed.ext}`);
  fs.renameSync(file, dest);
  return dest;
}

export const sameFile = (a: string, b: string): boolean => {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
};

export function topicRegenerateApi(app: AppState, hooks: RegenHooks = {}) {
  const jobs = new Map<string, RegenJob>();
  const running = new Set<string>();
  const study = studyApi(app);
  const space = studySpaceApi(app);
  const rel = (abs: string): string => posix(app.rel(abs));

  const aiCheck = (engine: RegenEngine): void => {
    if (engine === "handoff") throw new ApiError("Con Antigravity / Claude Code no se regenera aquí: crea la tarea con «study_topic_regenerate_handoff» y valida el resultado después.");
    const why = engineBlockedReason(AIConfig.fromDict(AppConfig.get_ai_config()), engine);
    if (why) throw new ApiError(why);
  };

  const defaults: Required<Pick<RegenHooks, "generateTheory" | "reevaluate" | "buildExercises">> = {
    async generateTheory(folder, signal) {
      const { jobId } = space.study_topic_generate(folder, "", { theory: true, map: true, practice: false }, true);
      for (;;) {
        const st = space.study_space_status(jobId);
        if (st.done) {
          if (st.error) return st.error;
          // el generador de un tema NO lanza si falla: deja la línea «✗» en su registro
          const bad = st.log.find((l) => l.includes("✗"));
          return bad ? bad.replace(/^[\s✗]+/, "").slice(0, 200) : "";
        }
        if (signal.aborted) return "Cancelado.";
        await sleep(hooks.pollMs ?? 250);
      }
    },
    async reevaluate(folder, signal) {
      await withAiSignal(signal, () => reevaluateTopic(app, folder, { createView: true }));
    },
    async buildExercises(folder, skill, difficulty, signal) {
      const dir = path.join(app.root, ...folder.split("/"));
      const manifest = readRawManifest(path.join(dir, `${path.basename(dir)}.practica.md`));
      const expected = manifest?.plan?.[skill]?.[difficulty - 1] ?? 0;
      const r = await withAiSignal(signal, () => study.study_topic_session_build(folder, skill, difficulty, expected > 0 ? "ai" : "3-5", "no_help"));
      const created = r.exercises.filter((e) => e.is_new);
      try {
        if (r.exercises.length < (expected || 4)) throw new Error(`Solo se generaron ${r.exercises.length} de ${expected || 4} ejercicios para ${skill} d${difficulty}.`);
        for (const ex of created) {
          const note = parseExercise(fs.readFileSync(app.resolve(ex.path, { allowRoot: false }), "utf8"));
          if (!note.hints.some((h) => h.trim() && !/^\(?\s*(no hints|sin pistas)/i.test(h))) throw new Error(`El ejercicio «${ex.title}» no tiene pistas.`);
        }
      } catch (e) {
        for (const ex of created) {
          try { fs.unlinkSync(app.resolve(ex.path, { allowRoot: false })); } catch { /* la copia anterior permanece en el respaldo */ }
        }
        throw e;
      }
      return created.map((e) => e.path.replace(/\\/g, "/"));
    },
  };
  const generateMap =
    hooks.generateMap ??
    ((topicAbs: string): { error: string; alt?: string } => {
      const r = generateConcept(topicAbs);
      if (r.problems.length) return { error: `El canvas no pasó la verificación: ${r.problems.slice(0, 3).join("; ")}` };
      return r.written.includes(".nuevo.canvas") ? { error: "", alt: r.written.replace(/^.*→ wrote /, "") } : { error: "" };
    });
  const generateTheory = hooks.generateTheory ?? defaults.generateTheory;
  const reevaluate = hooks.reevaluate ?? defaults.reevaluate;
  const buildExercises = hooks.buildExercises ?? defaults.buildExercises;

  const caches = (): void => {
    clearExerciseIndexCache();
    clearStudySnapshotCache();
  };

  async function run(job: RegenJob, folder: string, topicAbs: string, what: RegenWhat, signal: AbortSignal): Promise<void> {
    const say = (l: string): void => void job.log.push(l);
    const name = path.basename(topicAbs);
    const backupAbs = path.join(app.root, ".trash", "regenerar", `${stamp((hooks.now ?? (() => new Date()))())}_${name}`);
    job.backup = rel(backupAbs);
    const noteAbs = path.join(topicAbs, `${name}.md`);
    const practicaAbs = path.join(topicAbs, `${name}.practica.md`);
    const canvasesNow = (): string[] => {
      try {
        return fs.readdirSync(topicAbs, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".canvas")).map((e) => e.name);
      } catch {
        return [];
      }
    };

    if (what === "all") {
      // teoría (que ya rehace el mapa), práctica y ejercicios, en ese orden; se para en el primer fallo
      const steps: RegenWhat[] = ["theory", "practice", "exercises"];
      job.total = steps.length;
      for (const step of steps) {
        if (signal.aborted) {
          job.error = "Cancelado.";
          break;
        }
        const sub: RegenJob = { ...job, what: step, log: [], error: "", finished: 0, total: 1, restored: false, created: [], archived: [] };
        say(`— ${step === "theory" ? "Teoría y mapa" : step === "practice" ? "Práctica" : "Ejercicios"} —`);
        await run(sub, folder, topicAbs, step, signal);
        job.log.push(...sub.log);
        job.created.push(...sub.created);
        job.archived.push(...sub.archived);
        job.finished += 1;
        if (sub.restored) job.restored = true;
        if (sub.error) {
          job.error = sub.error;
          break;
        }
      }
      return;
    }

    if (what === "map") {
      job.total = 2;
      if (!fs.existsSync(noteAbs)) {
        job.error = "El tema no tiene nota de teoría: de ella sale el mapa. Usa «Generar lo que falta».";
        say(`✗ ${job.error}`);
        job.finished = 2;
        return;
      }
      const cs = canvasesNow();
      for (const c of cs) job.archived.push(rel(copyInto(path.join(topicAbs, c), backupAbs)));
      say(cs.length ? `Copia de seguridad de ${cs.length} canvas en ${job.backup}.` : "No había canvas que respaldar.");
      job.finished = 1;
      say(`Rehaciendo el mapa de «${name}» desde su teoría…`);
      const had = new Set(cs);
      try {
        const r = generateMap(topicAbs);
        if (r.error) {
          job.error = r.error;
          say(`✗ ${job.error}`);
        } else {
          for (const c of canvasesNow()) if (!had.has(c)) job.created.push(rel(path.join(topicAbs, c)));
          say(r.alt ? "✓ El mapa anterior se guardó en la papelera y se actualizó el mapa principal." : "✓ Mapa regenerado.");
        }
      } catch (e) {
        job.error = (e as Error).message;
        say(`✗ ${job.error}`);
      }
      job.finished = 2;
      return;
    }

    if (what === "theory") {
      job.total = 3;
      // 1. copia de seguridad de la nota y de sus canvas
      const saved: string[] = [];
      if (fs.existsSync(noteAbs)) saved.push(noteAbs);
      for (const c of canvasesNow()) saved.push(path.join(topicAbs, c));
      for (const f of saved) job.archived.push(rel(copyInto(f, backupAbs)));
      say(saved.length ? `Copia de seguridad de ${saved.length} archivo(s) en ${job.backup}.` : "No había teoría ni canvas que respaldar.");
      job.finished = 1;
      const had = new Set(canvasesNow());
      // 2. se vuelve a generar (con `force`) y el canvas lo rehace `generateConcept` (un canvas editado a mano se conserva: el nuevo va a .nuevo.canvas)
      say(`Regenerando la teoría de «${name}»…`);
      const error = await generateTheory(folder, signal);
      job.finished = 2;
      if (error) {
        // 3a. falló: se devuelve lo anterior
        for (const f of saved) {
          const copy = path.join(backupAbs, path.basename(f));
          if (!sameFile(copy, f)) fs.copyFileSync(copy, f);
        }
        job.restored = saved.length > 0;
        job.error = `${error}${saved.length ? " — se restauró la teoría anterior." : ""}`;
        say(`✗ ${job.error}`);
      } else {
        for (const c of canvasesNow()) if (!had.has(c)) job.created.push(rel(path.join(topicAbs, c)));
        say("✓ Teoría regenerada. Lo anterior queda en la copia de seguridad.");
      }
      job.finished = 3;
      return;
    }

    if (what === "practice") {
      job.total = 2;
      const had = fs.existsSync(practicaAbs);
      if (had) job.archived.push(rel(copyInto(practicaAbs, backupAbs)));
      say(had ? `Copia de seguridad de ${name}.practica.md en ${job.backup}.` : "El tema no tenía .practica: se creará.");
      job.finished = 1;
      say(`Re-evaluando la matriz de práctica de «${name}»…`);
      try {
        await reevaluate(folder, signal);
        say("✓ Práctica regenerada.");
      } catch (e) {
        if (had && !sameFile(path.join(backupAbs, path.basename(practicaAbs)), practicaAbs)) {
          fs.copyFileSync(path.join(backupAbs, path.basename(practicaAbs)), practicaAbs);
          job.restored = true;
        }
        job.error = `${(e as Error).message}${job.restored ? " — se restauró la práctica anterior." : ""}`;
        say(`✗ ${job.error}`);
      }
      job.finished = 2;
      return;
    }

    // ejercicios: se ARCHIVAN los generados por la app (`ej_*.md` de cada skill) y se genera un juego nuevo
    const exRoot = path.join(topicAbs, "Ejercicios");
    const moved: Array<{ from: string; to: string }> = [];
    if (fs.existsSync(exRoot)) {
      for (const skill of fs.readdirSync(exRoot, { withFileTypes: true })) {
        if (!skill.isDirectory()) continue;
        for (const f of fs.readdirSync(path.join(exRoot, skill.name), { withFileTypes: true })) {
          if (!f.isFile() || !/^ej_.*\.md$/i.test(f.name)) continue;
          const from = path.join(exRoot, skill.name, f.name);
          const to = moveInto(from, path.join(backupAbs, "Ejercicios", skill.name));
          moved.push({ from, to });
          job.archived.push(rel(to));
        }
      }
    }
    caches();
    say(moved.length ? `${moved.length} ejercicio(s) archivados en ${job.backup}/Ejercicios.` : "No había ejercicios generados que archivar.");
    const design = scanTopicDesigns([{ folder, title: name }], { root: app.root, exercises: diskExercises(app.root, folder) }).get(folder)!;
    const cells = practiceCells(design, true);
    job.total = 1 + cells.length;
    job.finished = 1;
    const giveBack = (): void => {
      for (const m of moved) {
        try {
          fs.mkdirSync(path.dirname(m.from), { recursive: true });
          if (!fs.existsSync(m.from)) fs.renameSync(m.to, m.from);
        } catch {
          /* queda en el archivo */
        }
      }
      caches();
      job.restored = moved.length > 0;
    };
    if (!cells.length) {
      giveBack();
      job.error = `No hay competencias (skills) con las que generar ejercicios${moved.length ? " — se devolvieron los anteriores" : ""}. Regenera antes la práctica.`;
      say(`✗ ${job.error}`);
      return;
    }
    let made = 0;
    let lastError = "";
    for (const c of cells) {
      if (signal.aborted) {
        lastError = "Cancelado.";
        break;
      }
      say(`Ejercicios de ${c.skill} (dificultad ${c.difficulty})…`);
      try {
        const created = await buildExercises(folder, c.skill, c.difficulty, signal);
        made += created.length;
        job.created.push(...created);
      } catch (e) {
        lastError = (e as Error).message;
        say(`  ✗ ${c.skill} d${c.difficulty}: ${lastError}`);
      }
      caches();
      job.finished += 1;
    }
    if (made === 0) {
      // no se generó nada: se devuelve el juego anterior (nunca se deja el tema sin ejercicios por un fallo)
      giveBack();
      job.error = `${lastError || "La IA no devolvió ejercicios válidos."}${moved.length ? " — se devolvieron los ejercicios anteriores." : ""}`;
      say(`✗ ${job.error}`);
    } else if (lastError) {
      job.error = `Regeneración incompleta: ${lastError}. Se crearon ${made} ejercicio(s); la copia anterior está en ${job.backup}.`;
      say(`✗ ${job.error}`);
    } else {
      say(`✓ ${made} ejercicio(s) nuevos. Los anteriores quedan archivados en ${job.backup}/Ejercicios.`);
    }
  }

  return {
    /** Regenera la teoría / práctica / ejercicios de UN tema (`Espacio/Área/Tema`). Exige `confirm: true`. */
    study_topic_regenerate(folderRel: string, what: string, confirm?: boolean, engine?: string): { jobId: string } {
      if (confirm !== true) throw new ApiError("Falta la confirmación: regenerar reemplaza contenido y solo se hace cuando la persona la da.");
      if (!WHATS.includes(what as RegenWhat)) throw new ApiError("Elige qué regenerar: teoría, mapa, práctica, ejercicios o todo.");
      const parts = String(folderRel ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
      const topicAbs = path.join(app.root, ...parts);
      if (parts.length !== 3 || !fs.existsSync(topicAbs) || !fs.statSync(topicAbs).isDirectory()) throw new ApiError("Selecciona la carpeta de un tema (Espacio / Área / Tema).");
      // la ruta no puede salir de la vault
      if (path.relative(app.root, topicAbs).startsWith("..")) throw new ApiError("Esa carpeta no está en la vault.");
      const eng = (engine ?? "app") as RegenEngine;
      if (!REGEN_ENGINES.includes(eng)) throw new ApiError("Motor desconocido: elige «app», «claude» o «handoff».");
      // el mapa no usa IA (sale de la nota): se puede regenerar con cualquier motor, también con la IA en modo puente
      if (what !== "map") aiCheck(eng);
      const folder = parts.join("/");
      const key = folder;
      if (running.has(key)) throw new ApiError("Ya hay una regeneración en curso de este tema.");
      running.add(key);
      const job: RegenJob = { id: crypto.randomUUID(), folder, what: what as RegenWhat, log: [], done: false, error: "", finished: 0, total: 1, backup: "", restored: false, created: [], archived: [] };
      jobs.set(job.id, job);
      const ctl = new AbortController();
      void withGenerationLock(() => run(job, folder, topicAbs, what as RegenWhat, ctl.signal))
        .catch((e) => {
          job.error = (e as Error).message;
          job.log.push(`✗ ${job.error}`);
        })
        .finally(() => {
          caches();
          job.done = true;
          running.delete(key);
        });
      return { jobId: job.id };
    },

    study_topic_regenerate_status(jobId: string): RegenJob {
      const job = jobs.get(String(jobId));
      if (!job) throw new ApiError("Ese trabajo ya no existe.");
      return { ...job, log: [...job.log], created: [...job.created], archived: [...job.archived] };
    },
  };
}
