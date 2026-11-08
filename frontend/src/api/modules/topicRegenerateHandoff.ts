// «Regenerar» un tema CON UN AGENTE EXTERNO (Antigravity / Claude Code): la app no llama a ninguna IA. Escribe una TAREA autocontenida en la vault, la
// persona se la pasa al agente y, al terminar, la app VALIDA lo que escribió con los mismos verificadores que usa con su propia IA.
//
//  - study_regen_engines() -> { mode, provider, model, engines[], recommended }: qué motores puede usar la persona ahora mismo (según los ajustes de IA).
//  - study_topic_regenerate_handoff(folders, what, confirm) -> RegenHandoff: respalda lo actual en `.trash/regenerar/…` (igual que «Con la app») y escribe
//    `<espacio>/_handoff/regenerar/<fecha>_<tema>.md` con: las carpetas exactas, qué escribir y dónde, las skills incrustadas (las MISMAS instrucciones
//    que enviaría la app), el contrato de salida (lo que se verifica) y la lista de «al terminar». Devuelve también la frase corta para pegar en el agente.
//    `folders` puede ser UNA carpeta o varias (un lote): un solo archivo con todos los temas.
//  - study_topic_regenerate_handoff_status(id) -> RegenHandoff: el estado guardado + cuántos archivos esperados ya existen (para avisar «el agente ya escribió»).
//  - study_topic_regenerate_validate(id, restore?) -> RegenHandoff: valida lo que escribió el agente tema a tema (teoría: estructura + mapa; práctica: plan
//    JSON; ejercicios: esquema) y lo aplica. Los temas que fallan se quedan como el agente los dejó para que los corrija, salvo que `restore: true`
//    (la persona lo confirmó): entonces se devuelve la copia de seguridad. Regenera mapa, índices y cachés.
//
// El estado vive en `.notevault/regenerar/<id>.json`. Nada se borra: lo anterior queda siempre en `.trash/regenerar/`.

import * as fs from "node:fs";
import * as path from "node:path";
import { ApiError } from "../../core/errors.js";
import { generateConcept } from "../../../tools/kb_canvas";
import { AIConfig } from "../../core/aiClient.js";
import { scanTopicDesigns } from "../../core/mentor/topicDesignScan.js";
import { clearExerciseIndexCache } from "../../core/practice/exerciseIndex.js";
import { keyOf } from "../../core/practice/domain.js";
import { learningPromptLines } from "../../core/practice/learningLog.js";
import { applyPlanToPractica, buildReevaluationMessages, fitPlanToArchetype, parsePracticePlan } from "../../core/practice/practicePlan.js";
import { routeContextOf, taughtBeforeOf } from "../../core/practice/routeContext.js";
import { buildTopicSession, parseExerciseArray, type GeneratedExercise, type SessionAIClient, type TheoryNoteContext } from "../../core/practice/sessionBuilder.js";
import { catalogFor } from "../../core/practice/skillSelection.js";
import type { DifficultyLevel } from "../../core/practice/skills.js";
import { ensureTopicViewFiles, viewFileName } from "../../core/practice/viewFiles.js";
import { noteWeight } from "../../lib/noteWeight.js";
import { outdatedByFolder, stampSkillVersion } from "./skillFreshness.js";
import { practiceCells } from "../../lib/planExecution.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { withGenerationLock } from "./generationLock.js";
import { regenEngines, type RegenEnginesView } from "./regenEngines.js";
import { classifyForTopic, clearStudySnapshotCache, findTopicManifest, readTheoryNotes, skillTemplates, vocabularyWords } from "./study.js";
import { isCompleteTheory, sanitizeRequires, theoryMessagesFor } from "./studySpace.js";
import { copyInto, posix, sameFile, stamp, type RegenWhat } from "./topicRegenerate.js";

/** Qué pedirle al agente: una pieza, «all» o una combinación (un solo prompt que hace varias cosas a la vez). */
export type HandoffWhat = Exclude<RegenWhat, "map"> | "theory+practice" | "theory+exercises" | "practice+exercises";
const HANDOFF_WHATS: readonly HandoffWhat[] = ["theory", "practice", "exercises", "all", "theory+practice", "theory+exercises", "practice+exercises"];
const STEPS_OF: Record<HandoffWhat, ReadonlyArray<"theory" | "practice" | "exercises">> = {
  theory: ["theory"],
  practice: ["practice"],
  exercises: ["exercises"],
  all: ["theory", "practice", "exercises"],
  "theory+practice": ["theory", "practice"],
  "theory+exercises": ["theory", "exercises"],
  "practice+exercises": ["practice", "exercises"],
};
const WHAT_LABEL: Record<HandoffWhat, string> = {
  theory: "Theory note",
  practice: "Practice plan (.practica)",
  exercises: "Exercises",
  all: "Theory, practice plan and exercises",
  "theory+practice": "Theory note and practice plan",
  "theory+exercises": "Theory note and exercises",
  "practice+exercises": "Practice plan and exercises",
};
/** ejercicios por celda (skill × dificultad): lo mismo que pide la app con «3-5» */
const PER_CELL = 4;
/** válidos mínimos para dar por buena una celda */
const MIN_PER_CELL = 3;

export type HandoffTopicState = "pending" | "ok" | "error" | "restored";
export interface RegenHandoffTopic {
  folder: string;
  title: string;
  /** copia de seguridad (relativa a la vault) */
  backup: string;
  state: HandoffTopicState;
  /** pasos ya aplicados (para continuar donde se quedó) */
  done: string[];
  problems: string[];
  /** archivos nuevos (relativos a la vault) */
  created: string[];
  restored: boolean;
}
export interface RegenHandoff {
  id: string;
  what: HandoffWhat;
  createdAt: string;
  /** el archivo de la tarea (relativo a la vault) y su ruta absoluta */
  task: string;
  taskAbs: string;
  /** carpeta donde el agente deja los JSON (relativa a la vault) */
  resultDir: string;
  /** la carpeta que se abre con «Abrir carpeta» (relativa a la vault) */
  folder: string;
  /** la frase corta para pegar en el agente */
  prompt: string;
  status: "waiting" | "validated" | "failed" | "restored";
  topics: RegenHandoffTopic[];
  log: string[];
  /** archivos esperados y cuántos existen ya */
  ready: { found: number; expected: number };
}

interface Cell { skill: string; difficulty: number; count: number }
interface StateTopic extends RegenHandoffTopic {
  /** copias hechas (relativas a la vault) */
  saved: string[];
  preExercises: string[];
  /** carpeta de resultados de este tema (relativa a la vault) */
  out: string;
  cells: Cell[];
}
interface State extends Omit<RegenHandoff, "topics" | "ready" | "taskAbs"> {
  topics: StateTopic[];
}

/** Hooks de los tests. */
export interface HandoffHooks { now?: () => Date }

const NOTE_NAME = (name: string): string => `${name}.md`;
// El id de la tarea es el nombre de su archivo y lo comprueba `load`: solo letras, dígitos, punto, guion, subrayado y espacio. Cualquier otro carácter del título (coma, &, #, acentos…) se quita aquí.
const safeSlug = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48).trim() || "tema";
/** Un cercado de markdown más largo que cualquier racha de ``` del texto. */
function fenced(text: string, lang = ""): string {
  const runs = text.match(/`+/g) ?? [];
  const n = Math.max(3, ...runs.map((r) => r.length + 1));
  const f = "`".repeat(n);
  return `${f}${lang}\n${text.replace(/\s+$/, "")}\n${f}`;
}
const frontmatterOf = (text: string): string => /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0] ?? "";

export function topicRegenerateHandoffApi(app: AppState, hooks: HandoffHooks = {}) {
  const rel = (abs: string): string => posix(app.rel(abs));
  const stateFile = (id: string): string => path.join(app.root, ".notevault", "regenerar", `${id}.json`);
  const nowDate = (): Date => (hooks.now ?? (() => new Date()))();

  const save = (s: State): void => {
    fs.mkdirSync(path.dirname(stateFile(s.id)), { recursive: true });
    fs.writeFileSync(stateFile(s.id), JSON.stringify(s, null, 2), "utf-8");
  };
  const load = (id: string): State => {
    // los ids viejos llevan comas del título del tema («Project structure, virtual…»): se aceptan; lo que no puede haber es una ruta
    if (!/^[\w.,()\- ]+$/.test(String(id ?? "")) || String(id).includes("..")) throw new ApiError("Esa tarea no existe.");
    try {
      return JSON.parse(fs.readFileSync(stateFile(id), "utf-8")) as State;
    } catch {
      throw new ApiError("Esa tarea ya no existe: vuelve a crearla.");
    }
  };

  const topicAbsOf = (folder: string): string => path.join(app.root, ...folder.split("/"));
  const parseFolder = (raw: unknown): string => {
    const parts = String(raw ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
    const abs = path.join(app.root, ...parts);
    if (parts.length !== 3 || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new ApiError("Selecciona la carpeta de un tema (Espacio / Área / Tema).");
    if (path.relative(app.root, abs).startsWith("..")) throw new ApiError("Esa carpeta no está en la vault.");
    return parts.join("/");
  };

  const siblings = (folder: string): string[] => {
    const [space, area] = folder.split("/") as [string, string, string];
    try {
      return fs
        .readdirSync(path.join(app.root, space, area), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    } catch {
      return [];
    }
  };
  const subjectName = (space: string): string => {
    let subject = space.replace(/\s*\d+\s*$/, "").trim() || space;
    try {
      const head = fs.readFileSync(path.join(app.root, space, `${space}.resumen.md`), "utf-8").slice(0, 1500);
      subject = /^subject:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1] ?? subject;
    } catch {
      /* un espacio sin resumen: la carpeta es la materia */
    }
    return subject;
  };

  // ── Los prompts: los MISMOS que enviaría la app ───────────────────────────────────────────────────────────────────

  const theoryPrompt = (folder: string): Array<{ role: string; content: string }> => {
    const [space, area, topic] = folder.split("/") as [string, string, string];
    const sibs = siblings(folder);
    return theoryMessagesFor(app, space, subjectName(space), area, topic, sibs.slice(0, Math.max(0, sibs.indexOf(topic))));
  };

  const practiceCtx = (folder: string) => {
    const found = findTopicManifest(app, folder);
    if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema (regenera antes la práctica con «Con la app» o créalo con «Generar todo»).");
    const manifest = found.manifest;
    const topicAbs = app.resolve(manifest.folder || folder, { allowRoot: true });
    const subject = manifest.subject || "mathematics";
    const cls = classifyForTopic(app, folder, manifest);
    const catalog = catalogFor(subject);
    const route = subject === "programming" ? routeContextOf(topicAbs, manifest.title, cls.topicType) : null;
    const messages = buildReevaluationMessages({
      subject,
      title: manifest.title,
      topicType: cls.topicType,
      archetype: route?.archetype,
      taughtBefore: route?.taughtBefore,
      branch: cls.branch,
      catalog,
      theory: readTheoryNotes(app, topicAbs),
      templates: skillTemplates(app, folder),
      currentSkills: manifest.skills,
    });
    return { manifest, topicAbs, cls, catalog, messages };
  };

  /** El contexto de una celda de ejercicios: manifiesto, teoría y skills de la vault (como `study_topic_session_build`). */
  const sessionCtx = (folder: string, skill: string, difficulty: number) => {
    const found = findTopicManifest(app, folder);
    if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
    const topicAbs = app.resolve(found.manifest.folder || folder, { allowRoot: true });
    const theoryNotes: TheoryNoteContext[] = [...readTheoryNotes(app, topicAbs).filter((t) => !t.title.startsWith("_tema")), ...skillTemplates(app, folder)];
    const config = {
      skill,
      difficulty: Math.min(3, Math.max(1, difficulty)) as DifficultyLevel,
      quantity: "3-5" as const,
      assistance: "no_help" as const,
      planCount: null,
      learning: learningPromptLines(app.root, folder, skill),
      taughtBefore: taughtBeforeOf(topicAbs),
      ...vocabularyWords(app, found.manifest.subject, skill, found.manifest.title),
    };
    return { manifest: found.manifest, theoryNotes, config };
  };

  const exercisePrompt = async (folder: string, skill: string, difficulty: number): Promise<Array<{ role: string; content: string }>> => {
    const ctx = sessionCtx(folder, skill, difficulty);
    let captured: Array<{ role: string; content: string }> = [];
    const client: SessionAIClient = {
      async generateExercises(messages) {
        captured = messages as Array<{ role: string; content: string }>;
        return [];
      },
    };
    await buildTopicSession(ctx.manifest, folder, ctx.config, [], ctx.theoryNotes, client);
    return captured;
  };

  /** Las celdas skill × dificultad que cubre el tema AHORA (como si no tuviera ejercicios: se archivan los de antes). */
  const cellsOf = (folder: string): Cell[] => {
    const design = scanTopicDesigns([{ folder, title: path.basename(folder) }], { root: app.root, exercises: [] }).get(folder);
    return design ? practiceCells(design, true).map((c) => ({ skill: c.skill, difficulty: c.difficulty, count: PER_CELL })) : [];
  };

  // ── Copias de seguridad ───────────────────────────────────────────────────────────────────────────────────────────

  const uniqueBackup = (name: string, at: Date): string => {
    const base = path.join(app.root, ".trash", "regenerar", `${stamp(at)}_${name}`);
    let dir = base;
    for (let n = 2; fs.existsSync(dir); n++) dir = `${base}_${n}`;
    return dir;
  };
  const canvasesOf = (topicAbs: string): string[] => {
    try {
      return fs.readdirSync(topicAbs, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".canvas")).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const exercisesOf = (topicAbs: string): string[] => {
    const out: string[] = [];
    const root = path.join(topicAbs, "Ejercicios");
    if (!fs.existsSync(root)) return out;
    for (const skill of fs.readdirSync(root, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(root, skill.name), { withFileTypes: true })) if (f.isFile() && /^ej_.*\.md$/i.test(f.name)) out.push(path.join(root, skill.name, f.name));
    }
    return out;
  };

  // ── El documento de la tarea ──────────────────────────────────────────────────────────────────────────────────────

  interface TopicBlock { t: StateTopic; md: string[] }

  const buildMarkdown = async (s: State, taskAbs: string, skills: Map<string, string>, blocks: TopicBlock[]): Promise<string> => {
    const L: string[] = [];
    const push = (...l: string[]): void => void L.push(...l);
    const many = s.topics.length > 1;
    push(
      `# NoteVault regeneration task — ${WHAT_LABEL[s.what]}${many ? ` · ${s.topics.length} topics` : ` · ${s.topics[0]!.title}`}`,
      "",
      "To run this task, paste only this:",
      "",
      `> ${s.prompt}`,
      "",
      "---",
      "",
      `You are regenerating study content of a NoteVault vault (\`${app.root}\`). The app already BACKED UP what exists (section 2); you write the new content and the app VALIDATES it with the same checks it uses for its own AI (section 5). Task id: \`${s.id}\`.`,
      "",
      "## 1. Rules",
      "",
      "- Write ONLY the files listed in section 4. Do not touch anything else in the vault, do not edit the backups in `.trash`, and do not run git commands.",
      "- Do NOT draw or edit any `.canvas` by hand: the app regenerates each topic map from the note you write.",
      "- Follow the instructions of section 3 literally (they are the very prompts the app would send to its AI): headings, fields, language and style are a contract.",
      "- Everything that must be valid JSON is parsed by a program: escape newlines inside strings as `\\n`, escape quotes, and write NOTHING outside the JSON.",
      "",
      "## 2. Backups already made by the app",
      "",
      "| Topic | Backup folder | Files saved |",
      "|---|---|---|",
    );
    for (const t of s.topics) push(`| \`${t.folder}\` | \`${t.backup}\` | ${t.saved.length ? t.saved.map((f) => `\`${path.posix.basename(f)}\``).join(", ") : "—"}${t.preExercises.length ? ` · ${t.preExercises.length} exercise note(s)` : ""} |`);
    push("", "If a topic cannot be validated the app restores these copies (only after the person confirms).", "", "## 3. Instructions (the skills, inlined)", "");
    if (skills.size) {
      push("These are the system instructions the app sends to its AI, word for word. Topic sections below say which one applies.", "");
      for (const [id, text] of skills) push(`### ${id}`, "", fenced(text), "");
    }
    push("## 4. Work list", "");
    for (const b of blocks) push(...b.md);
    push(
      "## 5. When you finish",
      "",
      "Tick every box, then tell the person: **done**. The person clicks «Ya terminó — validar» in NoteVault; the app then:",
      "",
      "- theory: checks the note is complete and the topic map can be generated from it (zero problems), then generates the map itself;",
      "- practice: parses your JSON with the app's own plan parser and writes the competency matrix into the topic's `.practica.md`;",
      "- exercises: parses each JSON array, drops invalid items, needs at least " + MIN_PER_CELL + " valid exercises per cell, formats them as exercise notes and archives the old ones;",
      "- if something fails it lists the exact problems so you can fix them and run the validation again (or the person restores the backup).",
      "",
      "Checklist:",
      "",
    );
    for (const b of blocks) for (const line of b.md.filter((l) => l.startsWith("- [ ] "))) push(line);
    push("- [ ] Nothing outside the files listed in section 4 was changed.", "", `> Generated by NoteVault on ${s.createdAt}. Task file: \`${rel(taskAbs)}\`.`, "");
    return L.join("\n");
  };

  return {
    /** Qué motores puede usar la persona ahora mismo, según los ajustes de IA que ya existen. */
    study_regen_engines(): RegenEnginesView {
      return regenEngines(AIConfig.fromDict(AppConfig.get_ai_config()));
    },

    async study_topic_regenerate_handoff(foldersIn: unknown, whatIn: string, confirm?: boolean): Promise<RegenHandoff> {
      if (confirm !== true) throw new ApiError("Falta la confirmación: la tarea respalda y, al validar, reemplaza contenido.");
      if (whatIn === "map") throw new ApiError("El mapa no usa IA: se reconstruye de la nota. Regénéralo con «Con la app».");
      if (!HANDOFF_WHATS.includes(whatIn as HandoffWhat)) throw new ApiError("Elige qué regenerar: teoría, práctica, ejercicios o una combinación.");
      let what = whatIn as HandoffWhat;
      const list = (Array.isArray(foldersIn) ? foldersIn : [foldersIn]).map(parseFolder);
      const folders = [...new Set(list)];
      if (!folders.length) throw new ApiError("Elige al menos un tema.");
      // Una teoría que ya cumple la skill actual (reconstruida antes: no desactualizada y dentro de los límites) no se vuelve a pedir en una combinación:
      // la tarea pide solo lo que falta. Si se pidió SOLO la teoría, se respeta (la persona la quiere rehacer).
      let skippedTheory = false;
      if (STEPS_OF[what].length > 1 && STEPS_OF[what].includes("theory")) {
        const stale = outdatedByFolder(app.root, folders);
        if (folders.every((f) => !stale.get(f)?.theory)) {
          const rest = STEPS_OF[what].filter((x) => x !== "theory").join("+") as HandoffWhat;
          if (HANDOFF_WHATS.includes(rest)) {
            what = rest;
            skippedTheory = true;
          }
        }
      }
      const steps = STEPS_OF[what];
      const at = nowDate();
      const space = folders[0]!.split("/")[0]!;
      const slug = folders.length === 1 ? safeSlug(path.posix.basename(folders[0]!)) : `${safeSlug(path.posix.basename(folders[0]!))} y ${folders.length - 1} mas`;
      let id = `${stamp(at)}_${slug}`;
      const dirAbs = path.join(app.root, space, "_handoff", "regenerar");
      for (let n = 2; fs.existsSync(path.join(dirAbs, `${id}.md`)); n++) id = `${stamp(at)}_${slug}_${n}`;
      const taskAbs = path.join(dirAbs, `${id}.md`);
      const resultAbs = path.join(dirAbs, `${id}.resultado`);

      // 1. lo que hace falta de cada tema (y que se pueda) ANTES de tocar nada
      const prompts = new Map<string, string>(); // texto de la skill -> id
      const skillIds = new Map<string, string>(); // id -> texto
      const skillRef = (text: string, label: string): string => {
        let id2 = prompts.get(text);
        if (!id2) {
          id2 = `${label} (${skillIds.size + 1})`;
          prompts.set(text, id2);
          skillIds.set(id2, text);
        }
        return id2;
      };
      const plans: Array<{ folder: string; theory?: Array<{ role: string; content: string }>; practice?: Array<{ role: string; content: string }>; cells: Cell[]; exercisePrompts: Map<string, Array<{ role: string; content: string }>> }> = [];
      for (const folder of folders) {
        const plan: (typeof plans)[number] = { folder, cells: [], exercisePrompts: new Map() };
        if (steps.includes("theory")) plan.theory = theoryPrompt(folder);
        if (steps.includes("practice")) plan.practice = practiceCtx(folder).messages;
        if (steps.includes("exercises") && !steps.includes("practice")) {
          // solo ejercicios (con o sin teoría nueva): las competencias son las del plan de práctica actual
          plan.cells = cellsOf(folder);
          if (!plan.cells.length) throw new ApiError(`«${path.posix.basename(folder)}»: no hay competencias (skills) con las que generar ejercicios. Regenera antes la práctica.`);
          for (const c of plan.cells) plan.exercisePrompts.set(`${c.skill}|${c.difficulty}`, await exercisePrompt(folder, c.skill, c.difficulty));
        } else if (steps.includes("exercises")) {
          // las celdas del plan NUEVO aún no existen: como modelo se enseña el prompt de la primera celda del plan actual (si lo hay)
          const model = cellsOf(folder)[0];
          if (model) {
            try {
              plan.exercisePrompts.set(`${model.skill}|${model.difficulty}`, await exercisePrompt(folder, model.skill, model.difficulty));
            } catch {
              /* sin modelo: se describe el formato */
            }
          }
        }
        plans.push(plan);
      }

      // 2. copias de seguridad (las mismas carpetas `.trash/regenerar` que «Con la app»)
      const topics: StateTopic[] = folders.map((folder, i) => {
        const topicAbs = topicAbsOf(folder);
        const name = path.basename(topicAbs);
        const backupAbs = uniqueBackup(name, at);
        const saved: string[] = [];
        const noteAbs = path.join(topicAbs, NOTE_NAME(name));
        const practicaAbs = path.join(topicAbs, viewFileName(name, "practica"));
        if (steps.includes("theory")) for (const f of [noteAbs, ...canvasesOf(topicAbs).map((c) => path.join(topicAbs, c))]) if (fs.existsSync(f)) saved.push(rel(copyInto(f, backupAbs)));
        if (steps.includes("practice") && fs.existsSync(practicaAbs)) saved.push(rel(copyInto(practicaAbs, backupAbs)));
        const preExercises: string[] = [];
        if (steps.includes("exercises")) {
          for (const f of exercisesOf(topicAbs)) {
            preExercises.push(rel(f));
            copyInto(f, path.join(backupAbs, "Ejercicios", path.basename(path.dirname(f))));
          }
        }
        fs.mkdirSync(backupAbs, { recursive: true });
        const out = rel(path.join(resultAbs, `${String(i + 1).padStart(2, "0")} ${safeSlug(name)}`));
        return { folder, title: name, backup: rel(backupAbs), state: "pending", done: [], problems: [], created: [], restored: false, saved, preExercises, out, cells: plans[i]!.cells };
      });

      // 3. el documento
      const state: State = {
        id,
        what,
        createdAt: at.toISOString(),
        task: rel(taskAbs),
        resultDir: rel(resultAbs),
        folder: rel(dirAbs),
        prompt: `Read \`${taskAbs}\` and execute it. Do only what that file lists, write nothing outside the files it names, and tell me when you are done.`,
        status: "waiting",
        topics,
        log: [`Tarea creada: ${topics.length} tema(s). Copias en .trash/regenerar.`, ...(skippedTheory ? ["La teoría ya cumple la skill actual: no se vuelve a pedir."] : [])],
      };
      const blocks: TopicBlock[] = topics.map((t, i) => {
        const plan = plans[i]!;
        const md: string[] = [`### ${i + 1}. \`${t.folder}\``, ""];
        const noteRel = `${t.folder}/${t.title}.md`;
        if (plan.theory) {
          const sys = plan.theory.find((m) => m.role === "system")?.content ?? "";
          const user = plan.theory.find((m) => m.role === "user")?.content ?? "";
          const sibs = siblings(t.folder);
          md.push(
            `#### Theory — write \`${noteRel}\``,
            "",
            `Instructions: **${skillRef(sys, "Theory skill")}**. The request for this topic (what the app would send as the user message):`,
            "",
            fenced(user),
            "",
            "Output contract (the app checks all of it):",
            "",
            `- Overwrite \`${noteRel}\` with the complete note. Keep the YAML frontmatter block that is at the top of the current file EXACTLY as it is (a copy is in \`${t.backup}\`); the instructions say "without frontmatter" because the app normally adds it — here you keep the existing one.`,
            "- It must reach its last section (`## Tarjetas`, or `## Cards` for English programming notes) with real content under it; a note that stops earlier is rejected as cut off.",
            "- The topic map is generated from your note: every required heading and every field of each example and each mistake (the four bullets the skill names) must be present, exactly as written in the skill. The app runs the map generator and requires ZERO problems.",
            `- \`[[links]]\` under the prerequisites heading must be EXACT names of earlier sibling topics: ${sibs.slice(0, Math.max(0, sibs.indexOf(t.title))).map((n) => `\`${n}\``).join(", ") || "none (write the \"no prerequisites\" line)"}. Other links are removed.`,
            "- The file must differ from the current one.",
            "",
            `- [ ] \`${noteRel}\` rewritten as the skill says`,
            "",
          );
        }
        if (plan.practice) {
          const sys = plan.practice.find((m) => m.role === "system")?.content ?? "";
          const user = plan.practice.find((m) => m.role === "user")?.content ?? "";
          md.push(
            `#### Practice plan — write \`${t.out}/practica.json\``,
            "",
            `Instructions: **${skillRef(sys, "Practice designer")}**. Request for this topic:`,
            "",
            fenced(user),
            "",
            steps.includes("theory") ? "Base the plan on the theory note you write for this same topic (the request above shows the OLD note)." : "",
            "Output contract: the file contains ONLY the JSON object described in the instructions (`topic_type`, `skills[]` with `skill`, `difficulties`, `why`, and `summary`). Skill ids must come from the catalogue; unknown or unsuitable skills are dropped, and the plan needs at least one valid skill.",
            "",
            `- [ ] \`${t.out}/practica.json\` written`,
            "",
          );
        }
        if (steps.includes("exercises")) {
          if (steps.includes("practice")) {
            md.push(
              `#### Exercises — one file per skill × difficulty of YOUR practice plan`,
              "",
              `For every skill with a count above 0 at a difficulty in the plan you wrote, write \`${t.out}/ejercicios_<skill>_d<difficulty>.json\` (e.g. \`ejercicios_implement_d1.json\`): a JSON array of exactly ${PER_CELL} exercise objects, built with the exercise instructions below.`,
              "",
              `Exercise instructions (the app's prompt for one cell, shown for the first skill of the OLD plan as a model — change only the skill and the difficulty):`,
              "",
            );
            const first = [...plan.exercisePrompts.values()][0];
            if (first) {
              const sys = first.find((m) => m.role === "system")?.content ?? "";
              const user = first.find((m) => m.role === "user")?.content ?? "";
              md.push(`Instructions: **${skillRef(sys, "Exercise creator")}**. Model request (for the first cell of the current plan; use the same one with your skill, difficulty and ${PER_CELL} exercises):`, "", fenced(user), "");
            } else {
              md.push(`Exercise format: JSON objects with \`title\`, \`statement\`, \`hints\`, \`solution\`, \`rubric\` (see the vault skills in \`${space}/_skills\`).`, "");
            }
            md.push("- [ ] one `ejercicios_<skill>_d<n>.json` per skill × difficulty of the plan", "");
          } else {
            md.push(`#### Exercises — ${t.cells.length} file(s) of ${PER_CELL} exercises each`, "");
            for (const c of t.cells) {
              const m = plan.exercisePrompts.get(`${c.skill}|${c.difficulty}`) ?? [];
              const sys = m.find((x) => x.role === "system")?.content ?? "";
              const user = m.find((x) => x.role === "user")?.content ?? "";
              md.push(
                `##### \`${c.skill}\` · difficulty ${c.difficulty} → write \`${t.out}/ejercicios_${c.skill}_d${c.difficulty}.json\``,
                "",
                `Instructions: **${skillRef(sys, "Exercise creator")}**. Request:`,
                "",
                fenced(user),
                "",
                `- [ ] \`${t.out}/ejercicios_${c.skill}_d${c.difficulty}.json\` written`,
                "",
              );
            }
          }
          md.push(
            `Output contract for every exercises file: a JSON array of exactly ${PER_CELL} objects \`{"title","statement","hints":[…],"solution","rubric":[…]}\`. Required: non-empty \`statement\` and \`solution\`, \`rubric\` with at least 3 checklist criteria; the app needs at least ${MIN_PER_CELL} valid exercises per file and writes the exercise notes itself (do not write \`.md\` exercises). Programming exercises: run every code block of a solution before pasting its output.`,
            "",
          );
        }
        return { t, md };
      });

      fs.mkdirSync(dirAbs, { recursive: true });
      for (const t of topics) if (steps.includes("practice") || steps.includes("exercises")) fs.mkdirSync(app.resolve(t.out, { allowRoot: true, mustExist: false }), { recursive: true });
      fs.writeFileSync(taskAbs, await buildMarkdown(state, taskAbs, skillIds, blocks), "utf-8");
      save(state);
      return view(state);
    },

    study_topic_regenerate_handoff_status(id: string): RegenHandoff {
      return view(load(id));
    },

    /** Todas las tareas guardadas en `.notevault/regenerar/*.json` (para reabrirlas tras reiniciar la app), las más nuevas primero. */
    study_topic_regenerate_handoff_list(): RegenHandoff[] {
      const dir = path.join(app.root, ".notevault", "regenerar");
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
      } catch {
        return [];
      }
      const out: RegenHandoff[] = [];
      for (const n of names) {
        try {
          out.push(view(load(n.slice(0, -".json".length))));
        } catch {
          /* archivo ajeno o dañado: se ignora */
        }
      }
      return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async study_topic_regenerate_validate(id: string, restore?: boolean): Promise<RegenHandoff> {
      const s = load(id);
      await withGenerationLock(async () => {
        for (const t of s.topics) {
          if (t.state === "ok" || t.state === "restored") continue;
          if (restore === true) {
            restoreTopic(s, t);
            continue;
          }
          await validateTopic(s, t);
        }
        s.status = s.topics.every((t) => t.state === "ok") ? "validated" : s.topics.every((t) => t.state === "ok" || t.state === "restored") ? "restored" : "failed";
        s.log.push(restore === true ? "Se restauraron las copias de seguridad de los temas con error." : s.status === "validated" ? "✓ Todo validado." : "✗ Hay temas con problemas.");
        save(s);
        clearExerciseIndexCache();
        clearStudySnapshotCache();
      });
      return view(s);
    },
  };

  // ── Validación ────────────────────────────────────────────────────────────────────────────────────────────────────

  function restoreTopic(s: State, t: StateTopic): void {
    const topicAbs = topicAbsOf(t.folder);
    for (const f of t.saved) {
      const copy = path.join(app.root, ...f.split("/"));
      const dest = path.join(topicAbs, path.basename(copy));
      if (fs.existsSync(copy) && !sameFile(copy, dest)) fs.copyFileSync(copy, dest);
    }
    t.state = "restored";
    t.restored = t.saved.length > 0;
    t.problems = [];
    s.log.push(`↩ «${t.title}»: ${t.saved.length ? "se devolvió la copia de seguridad" : "no había nada que devolver"}.`);
  }

  /** Marca la pieza validada con la versión de la skill con la que se hizo (`skill_version` en su frontmatter). */
  function stampPiece(t: StateTopic, step: "theory" | "practice" | "exercises"): void {
    if (step === "exercises") return;
    const name = path.basename(topicAbsOf(t.folder));
    const file = path.join(topicAbsOf(t.folder), step === "theory" ? NOTE_NAME(name) : viewFileName(name, "practica"));
    stampSkillVersion(app.root, t.folder.split("/")[0] ?? "", step === "theory" ? "theory" : "practica", file);
  }

  async function validateTopic(s: State, t: StateTopic): Promise<void> {
    const steps = STEPS_OF[s.what];
    t.problems = [];
    for (const step of steps) {
      if (t.done.includes(step)) continue;
      const problems = step === "theory" ? applyTheory(t) : step === "practice" ? applyPractice(t) : await applyExercises(t, s.what);
      if (problems.length) {
        t.problems = problems;
        t.state = "error";
        s.log.push(`✗ «${t.title}» (${step}): ${problems[0]}`);
        return;
      }
      stampPiece(t, step);
      t.done.push(step);
      s.log.push(`✓ «${t.title}»: ${step === "theory" ? "teoría y mapa" : step === "practice" ? "práctica" : "ejercicios"} validados.`);
    }
    t.state = "ok";
  }

  function applyTheory(t: StateTopic): string[] {
    const topicAbs = topicAbsOf(t.folder);
    const name = path.basename(topicAbs);
    const noteAbs = path.join(topicAbs, NOTE_NAME(name));
    if (!fs.existsSync(noteAbs)) return [`Falta la nota «${name}.md».`];
    const backup = t.saved.map((f) => path.join(app.root, ...f.split("/"))).find((f) => path.basename(f) === NOTE_NAME(name));
    // Una nota igual a la copia NO es un error por sí sola: si ya se reconstruyó (a mano, o en una tarea anterior) antes de crear esta tarea, la copia ya es la
    // nota buena. Se juzga por lo que la nota ES: si no cumple la skill (estructura, longitud) falla con SUS motivos, no con «no ha cambiado».
    const unchanged = !!backup && sameFile(backup, noteAbs);
    // …pero una nota que sigue desactualizada (más vieja que su skill, sin el formato o demasiado larga) y no cambió sí es «el agente no hizo nada»
    if (unchanged && outdatedByFolder(app.root, [t.folder]).get(t.folder)?.theory) return ["La nota no ha cambiado y sigue desactualizada: el agente aún no escribió la teoría nueva."];
    let text = fs.readFileSync(noteAbs, "utf-8");
    if (!frontmatterOf(text) && backup) {
      // el agente la escribió sin frontmatter: se le devuelve el de siempre
      text = frontmatterOf(fs.readFileSync(backup, "utf-8")) + text.replace(/^\s+/, "");
    }
    const fm = frontmatterOf(text);
    const body = text.slice(fm.length);
    if (!isCompleteTheory(body)) return [unchanged ? "La nota no ha cambiado y está cortada o sin formato: el agente aún no escribió la teoría nueva." : "La nota está cortada: no llega a la sección final «Tarjetas» / «Cards» con contenido."];
    // una nota que no se aprende de una vez es dos notas: se devuelve al agente (límites de «Size and focus» de la skill)
    if (t.folder.startsWith("Programación/") && !text.includes("curriculum_id:")) {
      const heavy = noteWeight(body).reasons;
      if (heavy.length) return [`${unchanged ? "La nota no ha cambiado y " : ""}Nota demasiado larga o con más de una idea: ${heavy.join("; ")}. Redúcela a UN concepto y dilo con las mínimas palabras.`];
    }
    const known = new Set(siblings(t.folder));
    const cleaned = fm + sanitizeRequires(body, known);
    if (cleaned !== text || text !== fs.readFileSync(noteAbs, "utf-8")) fs.writeFileSync(noteAbs, cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`, "utf-8");
    // la estructura que exige el generador del mapa (menos los prerrequisitos sin nota)
    try {
      const dry = generateConcept(topicAbs, { dryRun: true });
      const problems = [...dry.problems, ...dry.warnings.filter((w) => !/prerrequisito/i.test(w))];
      if (problems.length) return problems.slice(0, 8).map((p) => `Estructura: ${p}`);
      const r = generateConcept(topicAbs);
      if (r.problems.length) return r.problems.slice(0, 5).map((p) => `Mapa: ${p}`);
      const alt = r.written.includes(".nuevo.canvas") ? r.written.replace(/^.*→ wrote /, "") : "";
      for (const c of canvasesOf(topicAbs)) if (!t.saved.some((f) => path.basename(f) === c)) t.created.push(rel(path.join(topicAbs, c)));
      if (alt) t.created.push(alt);
    } catch (e) {
      return [`No se pudo generar el mapa: ${(e as Error).message}`];
    }
    return [];
  }

  function applyPractice(t: StateTopic): string[] {
    const file = path.join(app.resolve(t.out, { allowRoot: true, mustExist: false }), "practica.json");
    if (!fs.existsSync(file)) return [`Falta ${t.out}/practica.json.`];
    const ctx = practiceCtx(t.folder);
    const reply = fs.readFileSync(file, "utf-8");
    let plan = parsePracticePlan(reply, ctx.catalog, keyOf(ctx.cls));
    if (!plan) return [`practica.json no es un plan válido: hace falta un objeto JSON con «skills» (ids del catálogo, con «difficulties» 1/2/3) y al menos una skill que encaje con el tema. Empieza por: «${reply.replace(/\s+/g, " ").trim().slice(0, 100)}»`];
    if (ctx.manifest.subject === "programming") {
      const route = routeContextOf(ctx.topicAbs, ctx.manifest.title, ctx.cls.topicType);
      plan = fitPlanToArchetype(plan, route.archetype, ctx.catalog);
    }
    if (ctx.cls.domain !== "english") plan.topicType = plan.topicType ?? ctx.cls.topicType;
    const name = path.basename(ctx.topicAbs);
    const practicaAbs = path.join(ctx.topicAbs, viewFileName(name, "practica"));
    if (!fs.existsSync(practicaAbs)) ensureTopicViewFiles(app.root, ctx.topicAbs);
    if (!fs.existsSync(practicaAbs)) return ["No se pudo crear el archivo .practica del tema."];
    const labels = Object.fromEntries(ctx.catalog.map((c) => [c.id, c.label]));
    fs.writeFileSync(practicaAbs, applyPlanToPractica(fs.readFileSync(practicaAbs, "utf-8"), plan, labels), "utf-8");
    clearExerciseIndexCache();
    return [];
  }

  async function applyExercises(t: StateTopic, what: HandoffWhat): Promise<string[]> {
    const outAbs = app.resolve(t.out, { allowRoot: true, mustExist: false });
    // «todo»: las celdas salen del plan recién escrito; «ejercicios»: las que se calcularon al crear la tarea
    const cells = STEPS_OF[what].includes("practice") ? cellsOf(t.folder) : t.cells;
    if (!cells.length) return ["El plan de práctica no tiene celdas (skill × dificultad) de las que generar ejercicios."];
    const problems: string[] = [];
    const batches: Array<{ cell: Cell; items: GeneratedExercise[] }> = [];
    for (const c of cells) {
      const file = path.join(outAbs, `ejercicios_${c.skill}_d${c.difficulty}.json`);
      if (!fs.existsSync(file)) {
        problems.push(`Falta ${t.out}/ejercicios_${c.skill}_d${c.difficulty}.json.`);
        continue;
      }
      const all = parseExerciseArray(fs.readFileSync(file, "utf-8"));
      const valid = all.filter((e) => e.statement.trim().length >= 20 && e.solution.trim().length >= 10 && e.rubric.length >= 3);
      if (valid.length < MIN_PER_CELL) problems.push(`${path.basename(file)}: solo ${valid.length} ejercicio(s) válido(s) de ${all.length} (hacen falta ${MIN_PER_CELL}: enunciado, solución y una rúbrica de al menos 3 criterios).`);
      else batches.push({ cell: c, items: valid.slice(0, PER_CELL) });
    }
    if (problems.length) return problems;
    // todo bien: se escriben las notas con el mismo formateador de la app (el «cliente de IA» devuelve lo que escribió el agente) y se archivan las anteriores
    const written: string[] = [];
    for (const { cell, items } of batches) {
      const ctx = sessionCtx(t.folder, cell.skill, cell.difficulty);
      const client: SessionAIClient = { generateExercises: async () => items };
      const plan = await buildTopicSession(ctx.manifest, t.folder, ctx.config, [], ctx.theoryNotes, client);
      for (const ex of plan.exercises) {
        if (!ex.isNew || !ex.content) continue;
        const abs = app.resolve(ex.path, { allowRoot: false, mustExist: false });
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, ex.content, "utf-8");
        written.push(rel(abs));
      }
    }
    if (!written.length) return ["No se pudo escribir ningún ejercicio."];
    t.created.push(...written);
    // los anteriores se archivan: la copia ya está en .trash/regenerar/<tema>/Ejercicios, así que se quitan de su sitio
    for (const f of t.preExercises) {
      const abs = path.join(app.root, ...f.split("/"));
      const copy = path.join(app.root, ...t.backup.split("/"), "Ejercicios", path.basename(path.dirname(abs)), path.basename(abs));
      try {
        if (fs.existsSync(abs) && fs.existsSync(copy) && sameFile(abs, copy)) fs.unlinkSync(abs);
      } catch {
        /* se queda donde estaba */
      }
    }
    clearExerciseIndexCache();
    return [];
  }

  /** La vista pública del estado + cuántos archivos esperados existen ya. */
  function view(s: State): RegenHandoff {
    const steps = STEPS_OF[s.what];
    let expected = 0;
    let found = 0;
    for (const t of s.topics) {
      const topicAbs = topicAbsOf(t.folder);
      const outAbs = app.resolve(t.out, { allowRoot: true, mustExist: false });
      if (steps.includes("theory")) {
        expected += 1;
        const noteName = NOTE_NAME(path.basename(topicAbs));
        const noteAbs = path.join(topicAbs, noteName);
        const backup = t.saved.map((f) => path.join(app.root, ...f.split("/"))).find((f) => path.basename(f) === noteName);
        if (t.done.includes("theory") || (fs.existsSync(noteAbs) && !(backup && sameFile(backup, noteAbs)))) found += 1;
      }
      if (steps.includes("practice")) {
        expected += 1;
        if (t.done.includes("practice") || fs.existsSync(path.join(outAbs, "practica.json"))) found += 1;
      }
      if (steps.includes("exercises")) {
        let files: string[] = [];
        try {
          files = fs.readdirSync(outAbs).filter((n) => /^ejercicios_.*\.json$/.test(n));
        } catch {
          /* aún no hay carpeta de resultados */
        }
        if (!steps.includes("practice")) {
          expected += t.cells.length;
          found += t.done.includes("exercises") ? t.cells.length : t.cells.filter((c) => files.includes(`ejercicios_${c.skill}_d${c.difficulty}.json`)).length;
        } else {
          expected += Math.max(1, files.length);
          found += files.length;
        }
      }
    }
    const { topics, ...rest } = s;
    return {
      ...rest,
      taskAbs: path.join(app.root, ...s.task.split("/")),
      topics: topics.map(({ saved: _saved, preExercises: _pre, out: _out, cells: _cells, ...pub }) => ({ ...pub, problems: [...pub.problems], created: [...pub.created], done: [...pub.done] })),
      log: [...s.log],
      ready: { found, expected },
    };
  }
}
