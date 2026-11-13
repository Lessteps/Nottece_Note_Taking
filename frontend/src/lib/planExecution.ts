// «EJECUTAR PLAN»: el INFORME de ejecución (qué falta crear, agrupado por área y tema, con estimación de coste y en el orden de la agenda) y el
// modelo de la COLA de trabajos que lo ejecuta. Módulo PURO y compartido (núcleo, API y renderer): sin node:* ni DOM.
//
// Del análisis al informe: la cobertura determinista (`topicDesign.ts`: faltantes concretos por tema) + la revisión de la IA (`coverageReview`:
// temas nuevos propuestos) dan una lista EXACTA de tareas. Cada tarea es una función existente de la app: «Generar tema completo»
// (teoría + canvas), el canvas de un tema que ya tiene nota, el manifiesto de práctica de un tema que no lo tiene, los ejercicios de una skill y
// las carpetas del Sistema de práctica por área. NUNCA se sobrescribe nada que exista: lo que existe y tiene un defecto (una nota que no cumple el
// contrato, un manifiesto con skills que no encajan) se lista aparte como «revisar a mano».
//
// Documentado en docs/VAULT_FORMAT.md («Ejecutar plan»).

import { PRACTICE_AREA_IDS, isPracticeAreaId } from "./areaPracticeSystem.js";
import type { CoverageReview } from "./planCoverage.js";
import type { TopicDesign } from "./topicDesign.js";

// ── Tareas ──────────────────────────────────────────────────────────────

export const TASK_KINDS = ["pp_init", "area_folder", "area_katas_ai", "topic_new", "theory", "canvas", "manifest", "practice"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const KIND_LABEL: Record<TaskKind, string> = {
  pp_init: "Instalar programming_practice",
  area_folder: "Carpeta de práctica del área",
  area_katas_ai: "Katas del área con IA",
  topic_new: "Tema nuevo",
  theory: "Nota de teoría y canvas",
  canvas: "Canvas del tema",
  manifest: "Manifiesto de práctica",
  practice: "Ejercicios por skill",
};

/** Orden de las tareas de un mismo tema (cada una necesita la anterior). */
const KIND_ORDER: Record<TaskKind, number> = { pp_init: 0, area_folder: 1, area_katas_ai: 2, topic_new: 3, theory: 4, canvas: 5, manifest: 6, practice: 7 };

export interface ExecTask {
  /** estable: `theory:Programación/4 Backend/4.3 REST` */
  id: string;
  kind: TaskKind;
  areaKey: string;
  area: string;
  folder?: string;
  title: string;
  /** semana objetivo del tema en el plan (1…); 0 = antes de todo; 1000 = al final (temas nuevos) */
  week: number;
  /** obligatoria para el checklist (si no, es recomendada) */
  required: boolean;
  /** llamadas a la IA estimadas */
  aiCalls: number;
  /** archivos nuevos estimados */
  files: number;
  label: string;
  dependsOn: string[];
  /** datos del trabajo: celdas de práctica, katas por área, título propuesto… */
  args?: Record<string, unknown>;
}

export interface ExecutionScope {
  mode: "all" | "weeks" | "area" | "topic";
  /** `weeks`: semanas del plan, ambas incluidas */
  fromWeek?: number;
  toWeek?: number;
  /** `area`: la clave del área */
  areaKey?: string;
  /** `topic`: la carpeta de UN tema (todo lo que falta de ese tema y nada más) */
  folder?: string;
  /** incluir también lo recomendado (escalera de dificultades), no solo lo obligatorio */
  includeRecommended: boolean;
  /** crear también los temas nuevos que propuso la revisión */
  includeNewTopics: boolean;
  /** crear las carpetas del Sistema de práctica por área (con sus katas) */
  includeAreaPractice: boolean;
  /** pedir a la IA los katas de las áreas por bloques de 4 semanas (con plantillas como respaldo) */
  includeKatasAi: boolean;
}

export const DEFAULT_SCOPE: ExecutionScope = { mode: "all", includeRecommended: false, includeNewTopics: false, includeAreaPractice: true, includeKatasAi: false };

export const SECONDS_PER_AI_CALL = 60;
export const EXEC_CONCURRENCY = 2;
export const MAX_KATAS_PER_AREA = 60;
export const KATA_BLOCK_WEEKS = 4;

export interface ReportTopicIn {
  folder: string;
  title: string;
  areaKey: string;
  area: string;
  week: number;
  /** fuera de ruta */
  skipped?: boolean;
  completed?: boolean;
}

export interface AreaFileProbe {
  rel: string;
  exists: boolean;
}

export interface ReportInput {
  planId: string;
  topics: ReadonlyArray<ReportTopicIn>;
  /** en el orden del plan */
  areas: ReadonlyArray<{ key: string; area: string; areaId?: string }>;
  designs: ReadonlyMap<string, TopicDesign>;
  review?: CoverageReview | null;
  /** la carpeta `programming_practice` existe */
  ppReady: boolean;
  /** archivos de la carpeta de un área (con los `katas` primeros katas) y si ya existen */
  areaFiles: (areaId: string, katas: number, fromDay: number) => AreaFileProbe[];
  /** semana del plan de cada día de kata (índice 0 = kata nº 1) */
  kataWeeks: readonly number[];
  /** semana de cada día de kata de cada área (Automation puede empezar más tarde); sin dato se usa `kataWeeks` */
  kataWeeksByArea?: Readonly<Record<string, readonly number[]>>;
  aiConfigured: boolean;
  /** ISO de cuándo se calculó */
  now: string;
}

export interface ReportTopic {
  folder: string;
  title: string;
  week: number;
  score: number;
  tasks: ExecTask[];
  /** defectos de lo que YA existe: no se reescribe, se revisa a mano */
  manual: string[];
}

export interface ReportArea {
  key: string;
  area: string;
  areaTasks: ExecTask[];
  topics: ReportTopic[];
  /** temas nuevos propuestos por la revisión de la IA (solo se crean con «temas nuevos») */
  proposals: Array<{ title: string; why: string; included: boolean }>;
}

export interface ExecutionTotals {
  tasks: number;
  required: number;
  aiCalls: number;
  files: number;
  /** minutos aproximados con la concurrencia de la cola */
  minutes: number;
  byKind: Partial<Record<TaskKind, number>>;
}

export interface ExecutionReport {
  planId: string;
  at: string;
  scope: ExecutionScope;
  areas: ReportArea[];
  /** todas las tareas, en el orden de ejecución (las primeras semanas primero) */
  tasks: ExecTask[];
  totals: ExecutionTotals;
  /** temas con defectos en lo que ya existe (no se sobrescribe) */
  manual: Array<{ folder: string; title: string; gaps: string[] }>;
  aiConfigured: boolean;
  /** semanas del plan que existen en los datos (para elegir el alcance) */
  maxWeek: number;
}

export const estimateMinutes = (aiCalls: number, tasks: number): number => (tasks ? Math.max(1, Math.ceil((aiCalls * SECONDS_PER_AI_CALL) / EXEC_CONCURRENCY / 60)) : 0);

const slug = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const shortTitle = (t: string): string => t.replace(/^[\d.\s_-]+/, "").trim() || t;

export function inScope(scope: ExecutionScope, t: { areaKey: string; week: number; folder?: string }): boolean {
  if (scope.mode === "topic") return !!scope.folder && t.folder === scope.folder;
  if (scope.mode === "area") return t.areaKey === scope.areaKey;
  if (scope.mode === "weeks") return t.week >= (scope.fromWeek ?? 1) && t.week <= (scope.toWeek ?? 1000);
  return true;
}

/** Celdas de práctica que faltan en un tema (skill y dificultad): las obligatorias (una por skill sin ejercicios) y, si se pide, la escalera. */
export function practiceCells(d: TopicDesign, includeRecommended: boolean): Array<{ skill: string; difficulty: number; required: boolean }> {
  const out: Array<{ skill: string; difficulty: number; required: boolean }> = [];
  for (const g of d.gaps) {
    if (g.fix !== "practice" || !g.skill) continue;
    if (g.artifact === "practice_basic") {
      // un ejercicio por skill: a la dificultad más baja que admite
      out.push({ skill: g.skill, difficulty: g.difficulty ?? 1, required: true });
    } else if (includeRecommended && g.difficulty) out.push({ skill: g.skill, difficulty: g.difficulty, required: false });
  }
  return out;
}

/**
 * Construye el informe. Determinista: la misma entrada da el mismo informe. No lee ni escribe nada.
 */
export function buildExecutionReport(inp: ReportInput, scopeIn: Partial<ExecutionScope> = {}): ExecutionReport {
  const scope: ExecutionScope = { ...DEFAULT_SCOPE, ...scopeIn };
  const areaOrder = new Map(inp.areas.map((a, i) => [a.key, i]));
  const topicOrder = new Map(inp.topics.map((t, i) => [t.folder, i]));
  const areas: ReportArea[] = inp.areas.map((a) => ({ key: a.key, area: a.area, areaTasks: [], topics: [], proposals: [] }));
  const byKey = new Map(areas.map((a) => [a.key, a]));
  const manual: ExecutionReport["manual"] = [];
  const all: ExecTask[] = [];

  // 1. temas del plan con faltantes de diseño
  for (const t of inp.topics) {
    const ar = byKey.get(t.areaKey);
    const d = inp.designs.get(t.folder);
    if (!ar || !d || t.skipped || t.completed) continue;
    const manualGaps = [...new Set(d.gaps.filter((g) => g.fix === "manual" && g.level === "required").map((g) => g.text))];
    const tasks: ExecTask[] = [];
    const id = (k: TaskKind): string => `${k}:${t.folder}`;
    const base = { areaKey: t.areaKey, area: t.area, folder: t.folder, week: t.week };
    const gapOf = (fix: string, artifact?: string) => d.gaps.filter((g) => g.fix === fix && (!artifact || g.artifact === artifact));
    const noFolder = gapOf("topic").length > 0;
    const needTheory = gapOf("theory").some((g) => g.artifact === "theory");
    const needCanvas = gapOf("canvas").length > 0;
    const needManifest = gapOf("manifest").some((g) => g.artifact === "manifest");
    const cells = practiceCells(d, scope.includeRecommended);
    // sin manifiesto todavía no se sabe qué skills tendrá: la tarea de práctica se calcula al ejecutarla (≈ 4 skills)
    const practiceUnknown = needManifest || noFolder;
    const generated = noFolder || needTheory;
    if (noFolder) tasks.push({ id: id("topic_new"), kind: "topic_new", ...base, title: t.title, required: true, aiCalls: 3, files: 4, label: `Crear el tema «${shortTitle(t.title)}»`, dependsOn: [] });
    else if (needTheory) tasks.push({ id: id("theory"), kind: "theory", ...base, title: t.title, required: true, aiCalls: 2, files: 2, label: `Teoría y canvas de «${shortTitle(t.title)}»`, dependsOn: [] });
    if (needCanvas && !generated) tasks.push({ id: id("canvas"), kind: "canvas", ...base, title: t.title, required: true, aiCalls: 0, files: 1, label: `Canvas de «${shortTitle(t.title)}»`, dependsOn: [] });
    if (needManifest && !noFolder) {
      tasks.push({ id: id("manifest"), kind: "manifest", ...base, title: t.title, required: true, aiCalls: 1, files: 1, label: `Manifiesto de práctica de «${shortTitle(t.title)}»`, dependsOn: generated ? [id("theory")] : [] });
    }
    if (practiceUnknown) {
      tasks.push({ id: id("practice"), kind: "practice", ...base, title: t.title, required: true, aiCalls: 4, files: 16, label: `Ejercicios de «${shortTitle(t.title)}» (una skill tras otra)`, dependsOn: tasks.length ? [tasks[tasks.length - 1]!.id] : [], args: { cells: [], unknown: true, includeRecommended: scope.includeRecommended } });
    } else if (cells.length) {
      const req = cells.filter((c) => c.required);
      const dep = tasks.length ? [tasks[tasks.length - 1]!.id] : [];
      tasks.push({
        id: id("practice"),
        kind: "practice",
        ...base,
        title: t.title,
        required: req.length > 0,
        aiCalls: cells.length,
        files: cells.length * 4,
        label: `Ejercicios de «${shortTitle(t.title)}»: ${[...new Set(cells.map((c) => c.skill))].join(", ")}`,
        dependsOn: dep,
        args: { cells: cells.map((c) => ({ skill: c.skill, difficulty: c.difficulty })), includeRecommended: scope.includeRecommended },
      });
    }
    if (manualGaps.length) manual.push({ folder: t.folder, title: t.title, gaps: manualGaps });
    const kept = tasks.filter((x) => inScope(scope, x));
    if (kept.length || manualGaps.length) ar.topics.push({ folder: t.folder, title: t.title, week: t.week, score: d.score, tasks: kept, manual: manualGaps });
    all.push(...kept);
  }

  // 2. sistema de práctica por área
  if (scope.includeAreaPractice && scope.mode !== "topic") {
    const maxScopeWeek = scope.mode === "weeks" ? (scope.toWeek ?? 1000) : 1000;
    const minScopeWeek = scope.mode === "weeks" ? (scope.fromWeek ?? 1) : 1;
    let pendingInit = false;
    for (const a of inp.areas) {
      if (scope.mode === "area" && a.key !== scope.areaKey) continue;
      const areaId = a.areaId ?? a.key;
      if (!isPracticeAreaId(areaId)) continue;
      const kataWeeks = inp.kataWeeksByArea?.[areaId] ?? inp.kataWeeks;
      // katas que se escriben: los días de kata hasta el final del alcance (como mucho MAX_KATAS_PER_AREA)
      const upTo = kataWeeks.filter((w) => w <= maxScopeWeek).length;
      const from = kataWeeks.findIndex((w) => w >= minScopeWeek);
      const katas = Math.min(MAX_KATAS_PER_AREA, from < 0 ? 0 : Math.max(0, upTo - from));
      const fromDay = from < 0 ? 1 : from + 1;
      // con katas por IA la carpeta solo lleva la estructura: los katas los escribe la IA por bloques (con plantillas de respaldo)
      const files = inp.areaFiles(areaId, scope.includeKatasAi ? 0 : katas, fromDay);
      const missing = files.filter((f) => !f.exists).length;
      const ar = byKey.get(a.key)!;
      if (missing > 0) {
        if (!inp.ppReady && !pendingInit) {
          pendingInit = true;
          const t: ExecTask = { id: "pp_init", kind: "pp_init", areaKey: a.key, area: a.area, title: "programming_practice", week: 0, required: false, aiCalls: 0, files: 8, label: "Instalar el módulo programming_practice (carpetas y skills del módulo)", dependsOn: [] };
          ar.areaTasks.push(t);
          all.push(t);
        }
        const t: ExecTask = {
          id: `area_folder:${areaId}`,
          kind: "area_folder",
          areaKey: a.key,
          area: a.area,
          title: a.area,
          week: 0,
          required: false,
          aiCalls: 0,
          files: missing,
          label: scope.includeKatasAi ? `Carpeta de práctica de ${a.area}: README, skills y proyectos` : `Carpeta de práctica de ${a.area}: README, skills, ${katas} ${katas === 1 ? "kata" : "katas"} y proyectos`,
          dependsOn: !inp.ppReady ? ["pp_init"] : [],
          args: { areaId, katas: scope.includeKatasAi ? 0 : katas, fromDay },
        };
        ar.areaTasks.push(t);
        all.push(t);
      }
      if (scope.includeKatasAi) {
        const lastWeek = kataWeeks.length ? Math.min(maxScopeWeek, kataWeeks[kataWeeks.length - 1]!) : 0;
        for (let w = Math.max(1, minScopeWeek); w <= lastWeek; w += KATA_BLOCK_WEEKS) {
          const days = kataWeeks.map((kw, i) => ({ kw, day: i + 1 })).filter((x) => x.kw >= w && x.kw < w + KATA_BLOCK_WEEKS && x.kw <= maxScopeWeek && x.day >= fromDay && x.day < fromDay + katas).map((x) => x.day);
          if (!days.length) continue;
          const t: ExecTask = {
            id: `area_katas_ai:${areaId}:${w}`,
            kind: "area_katas_ai",
            areaKey: a.key,
            area: a.area,
            title: a.area,
            week: w,
            required: false,
            aiCalls: 1,
            files: days.length,
            label: `Katas de ${a.area} con IA: semanas ${w}-${Math.min(w + KATA_BLOCK_WEEKS - 1, lastWeek)}`,
            dependsOn: [`area_folder:${areaId}`].filter((x) => all.some((y) => y.id === x)),
            args: { areaId, days, fromWeek: w },
          };
          ar.areaTasks.push(t);
          all.push(t);
        }
      }
    }
  }

  // 3. temas nuevos propuestos por la revisión
  for (const ra of inp.review?.areas ?? []) {
    const ar = byKey.get(ra.key);
    if (!ar) continue;
    for (const m of ra.missing) {
      const included = scope.includeNewTopics && inScope(scope, { areaKey: ra.key, week: 1000 }) && scope.mode !== "weeks" && scope.mode !== "topic";
      ar.proposals.push({ title: m.title, why: m.why, included });
      if (!included) continue;
      const t: ExecTask = {
        id: `topic_new:${ra.key}:${slug(m.title)}`,
        kind: "topic_new",
        areaKey: ra.key,
        area: ar.area,
        title: m.title,
        week: 1000,
        required: false,
        aiCalls: 3,
        files: 4,
        label: `Tema nuevo propuesto: «${m.title}»`,
        dependsOn: [],
        args: { proposed: true, groupId: m.groupId ?? "" },
      };
      ar.areaTasks.push(t);
      all.push(t);
    }
  }

  // 4. orden de ejecución: semana, área, orden del plan, tipo de tarea
  const ordered = [...all].sort(
    (a, b) =>
      a.week - b.week ||
      (areaOrder.get(a.areaKey) ?? 0) - (areaOrder.get(b.areaKey) ?? 0) ||
      (topicOrder.get(a.folder ?? "") ?? 0) - (topicOrder.get(b.folder ?? "") ?? 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.id.localeCompare(b.id),
  );
  const ids = new Set(ordered.map((t) => t.id));
  for (const t of ordered) t.dependsOn = t.dependsOn.filter((d) => ids.has(d));
  const byKind: ExecutionTotals["byKind"] = {};
  for (const t of ordered) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  const aiCalls = ordered.reduce((n, t) => n + t.aiCalls, 0);
  return {
    planId: inp.planId,
    at: inp.now,
    scope,
    areas: areas.filter((a) => a.areaTasks.length || a.topics.length || a.proposals.length),
    tasks: ordered,
    totals: {
      tasks: ordered.length,
      required: ordered.filter((t) => t.required).length,
      aiCalls,
      files: ordered.reduce((n, t) => n + t.files, 0),
      minutes: ordered.length ? estimateMinutes(aiCalls, ordered.length) : 0,
      byKind,
    },
    manual,
    aiConfigured: inp.aiConfigured,
    maxWeek: Math.max(1, ...inp.topics.map((t) => t.week)),
  };
}

// ── Estado persistido de una ejecución ──────────────────────────────────

export const TASK_STATUSES = ["pending", "running", "done", "failed", "skipped", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const RUN_STATUSES = ["running", "paused", "done", "cancelled", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { pending: "Pendiente", running: "En curso", done: "Hecha", failed: "Falló", skipped: "Omitida", cancelled: "Cancelada" };
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { running: "Ejecutando", paused: "En pausa", done: "Terminada", cancelled: "Cancelada", failed: "Con errores" };

export interface TaskState extends ExecTask {
  status: TaskStatus;
  /** intentos hechos (se reintenta hasta `MAX_ATTEMPTS`) */
  attempts: number;
  /** rutas relativas a la vault de los archivos que esta tarea creó */
  created: string[];
  /** archivos que ya existían y se dejaron como estaban */
  skippedFiles: string[];
  /** avisos de la validación (p. ej. la nota no cumple el contrato) */
  warnings: string[];
  error?: string;
  note?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ExecutionState {
  version: 1;
  planId: string;
  /** id de esta ejecución */
  id: string;
  status: RunStatus;
  scope: ExecutionScope;
  createdAt: string;
  updatedAt: string;
  tasks: TaskState[];
  /** últimas líneas del registro */
  log: string[];
}

export const MAX_ATTEMPTS = 2;
export const MAX_LOG_LINES = 200;

export interface ExecutionProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  running: number;
  pending: number;
  /** «12/58 · Backend · 4.3 REST API design» */
  label: string;
  pct: number;
  created: number;
}

export function progressOf(s: Pick<ExecutionState, "tasks">): ExecutionProgress {
  const c = (st: TaskStatus): number => s.tasks.filter((t) => t.status === st).length;
  const finished = c("done") + c("failed") + c("skipped") + c("cancelled");
  const cur = s.tasks.find((t) => t.status === "running") ?? s.tasks.find((t) => t.status === "pending");
  const total = s.tasks.length;
  return {
    total,
    done: c("done"),
    failed: c("failed"),
    skipped: c("skipped") + c("cancelled"),
    running: c("running"),
    pending: c("pending"),
    label: cur ? `${Math.min(total, finished + (cur.status === "running" ? 1 : 0))}/${total} · ${cur.area}${cur.folder ? ` · ${shortTitle(cur.title)}` : cur.title && cur.title !== cur.area ? ` · ${cur.title}` : ""}` : `${finished}/${total}`,
    pct: total ? Math.round((finished / total) * 100) : 0,
    created: s.tasks.reduce((n, t) => n + t.created.length, 0),
  };
}

/**
 * Las tareas que pueden empezar ahora: pendientes con todas sus dependencias hechas u omitidas con éxito, y sin otra tarea en curso sobre el mismo
 * tema (la carpeta de un tema se toca de una en una). Respeta el orden y el límite de concurrencia.
 */
export function runnable(tasks: readonly TaskState[], limit = EXEC_CONCURRENCY): TaskState[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const busy = new Set(tasks.filter((t) => t.status === "running").map((t) => t.folder ?? t.id));
  let slots = limit - busy.size;
  const out: TaskState[] = [];
  for (const t of tasks) {
    if (slots <= 0) break;
    if (t.status !== "pending") continue;
    const deps = t.dependsOn.map((d) => byId.get(d)).filter((d): d is TaskState => !!d);
    if (deps.some((d) => d.status === "pending" || d.status === "running")) continue;
    if (deps.some((d) => d.status === "failed" || d.status === "cancelled")) continue; // se marcará omitida
    const key = t.folder ?? t.id;
    if (busy.has(key)) continue;
    busy.add(key);
    out.push(t);
    slots--;
  }
  return out;
}

/** Las tareas pendientes cuya dependencia falló o se canceló: no se pueden hacer. */
export function blockedBy(tasks: readonly TaskState[]): Array<{ task: TaskState; dep: TaskState }> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Array<{ task: TaskState; dep: TaskState }> = [];
  for (const t of tasks) {
    if (t.status !== "pending") continue;
    const dep = t.dependsOn.map((d) => byId.get(d)).find((d) => d && (d.status === "failed" || d.status === "cancelled" || (d.status === "skipped" && d.error)));
    if (dep) out.push({ task: t, dep });
  }
  return out;
}

/** ¿Es una clave de área de práctica conocida? (para el informe de áreas sin sistema) */
export const hasAreaPractice = (areaId: string | undefined): boolean => isPracticeAreaId(areaId ?? "");
export { PRACTICE_AREA_IDS };
