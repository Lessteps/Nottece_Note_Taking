// Tiempo y precondiciones del Plan del Mentor: fechas, semanas de un periodo libre y capacidad.
//
// Módulo PURO y compartido: lo usan el núcleo (`core/mentor/plan.ts`, `planSpec.ts`) y el formulario del
// panel Plan (el cálculo en vivo y el de la API son el mismo código). Sin node:* ni DOM.

// ── Fechas (AAAA-MM-DD, siempre en calendario local sin zona: se opera en UTC para no sufrir el DST) ──

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_PERIOD_DAYS = 1096;
const DAY_MS = 86400000;
const two = (n: number): string => String(n).padStart(2, "0");

export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const toMs = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number): string => {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
};

export const addDays = (iso: string, n: number): string => fromMs(toMs(iso) + n * DAY_MS);
/** Días de `a` a `b` (positivo si `b` es posterior). */
export const daysBetween = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / DAY_MS);
/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoDow(iso: string): number {
  const d = new Date(toMs(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}
/** Todos los días de `start` a `end`, ambos incluidos ([] si `end` < `start`). */
export function eachDay(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  const out: string[] = [];
  for (let i = 0; i <= n && i <= MAX_PERIOD_DAYS + 1; i++) out.push(addDays(start, i));
  return out;
}
/** Suma meses de calendario recortando el día (31 ene + 1 mes = 28/29 feb). */
export function addMonthsToDate(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${two(first.getUTCMonth() + 1)}-${two(Math.min(d, last))}`;
}
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${two(last)}` };
}

export interface WeekRange {
  week: number;
  start: string;
  end: string;
  days: number;
}

/** Semanas de un periodo: trozos de 7 días desde `start` (la última puede ser más corta). */
export function weekRangesOf(start: string, end: string): WeekRange[] {
  const out: WeekRange[] = [];
  const total = daysBetween(start, end) + 1;
  for (let off = 0, w = 1; off < total; off += 7, w++) {
    const days = Math.min(7, total - off);
    out.push({ week: w, start: addDays(start, off), end: addDays(start, off + days - 1), days });
  }
  return out;
}

/** Semana (1..) del periodo a la que pertenece `date`; 0 si es anterior, nº de semanas + 1 si es posterior. */
export function weekIndex(date: string, start: string, end: string): number {
  if (date < start) return 0;
  const weeks = weekRangesOf(start, end).length;
  if (date > end) return weeks + 1;
  return Math.floor(daysBetween(start, date) / 7) + 1;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (iso: string): string => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
/** "6 oct – 5 nov" (con año si cambia de año o no es el actual no se complica: solo si cruza de año). */
export function periodLabel(start: string, end: string): string {
  const cross = start.slice(0, 4) !== end.slice(0, 4);
  return `${dm(start)}${cross ? ` ${start.slice(0, 4)}` : ""} – ${dm(end)}${cross ? ` ${end.slice(0, 4)}` : ""}`;
}
/** "6–12 oct" / "29 oct – 4 nov": el rango corto de una semana. */
export function shortWeekLabel(start: string, end: string): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return start === end ? dm(start) : `${Number(start.slice(8))}–${dm(end)}`;
  return `${dm(start)} – ${dm(end)}`;
}
const num1 = (n: number): string => String(Math.round(n * 10) / 10).replace(".", ",");
export const weeksLabel = (weeks: number): string => `${num1(weeks)} ${weeks === 1 ? "semana" : "semanas"}`;

// ── Periodos predefinidos ────────────────────────────────────────────────

export const PERIOD_PRESETS = [
  { key: "1s", label: "1 semana", weeks: 1 },
  { key: "2s", label: "2 semanas", weeks: 2 },
  { key: "1m", label: "1 mes", months: 1 },
  { key: "2m", label: "2 meses", months: 2 },
  { key: "3m", label: "3 meses", months: 3 },
  { key: "6m", label: "6 meses", months: 6 },
] as const;
export type PeriodPresetKey = (typeof PERIOD_PRESETS)[number]["key"];

/** Fin inclusivo de un preset que empieza en `start`: 1 semana = 7 días; 1 mes = hasta el día anterior del mes siguiente. */
export function presetEnd(key: PeriodPresetKey, start: string): string {
  const p = PERIOD_PRESETS.find((x) => x.key === key)!;
  return "weeks" in p ? addDays(start, p.weeks * 7 - 1) : addDays(addMonthsToDate(start, p.months), -1);
}

// ── Precondiciones ───────────────────────────────────────────────────────

export const LEVELS = ["empezando", "basico", "intermedio", "avanzado", "no_se"] as const;
export type PlanLevel = (typeof LEVELS)[number];
export const PACES = ["suave", "normal", "intenso"] as const;
export type PlanPace = (typeof PACES)[number];
/** Capacidad efectiva sobre el tiempo declarado. */
export const PACE_FACTOR: Record<PlanPace, number> = { suave: 0.7, normal: 0.85, intenso: 1 };
/** El nivel declarado ajusta los minutos estimados de un tema (hipótesis, no verdad). */
export const LEVEL_FACTOR: Record<PlanLevel, number> = { empezando: 1.2, basico: 1.1, intermedio: 1, avanzado: 0.85, no_se: 1 };

/**
 * Entregables. YA NO se eligen al crear el plan: quedan «por definir» hasta que se ejecuta el plan (o se piden en «Preguntas y ajustes»).
 * El formulario nuevo guarda «no» (nada definido todavía); «ask» y «yes» solo se LEEN en planes antiguos (compatibilidad de lectura).
 */
export const DELIVERABLE_MODES = ["ask", "yes", "no"] as const;
export type DeliverablesMode = (typeof DELIVERABLE_MODES)[number];
/** Compatibilidad de lectura: `true` → «yes», `false` → «no», ausente o desconocido → «ask». Sin migración destructiva. */
export function normalizeDeliverables(v: unknown): DeliverablesMode {
  if (v === true || v === "true") return "yes";
  if (v === false || v === "false") return "no";
  return (DELIVERABLE_MODES as readonly string[]).includes(String(v)) ? (v as DeliverablesMode) : "no";
}

/** Los focos del proyecto semanal de Programming practice (mismos que `core/ppractice/spec.ts`). */
export const PRACTICE_FOCUSES = ["backend", "databases", "frontend", "desktop", "mobile", "automation"] as const;
export type PracticeFocus = (typeof PRACTICE_FOCUSES)[number];

/** Preferencias de la pista «Programming practice» dentro del plan (kata diario + proyecto semanal full stack). */
export interface PracticePrefs {
  /** minutos del reto de lógica diario (0 = sin kata) */
  kataMinutes: number;
  /** sesiones del proyecto semanal por semana (0 = sin proyecto semanal) */
  sessionsPerWeek: number;
  minutesPerSession: number;
  /** un proyecto mayor cada 4 semanas que integra los semanales */
  monthly: boolean;
  /** «rotate» = el foco rota por las áreas del stack; o un foco fijo */
  focus: "rotate" | PracticeFocus;
}
export const KATA_CHOICES = [15, 30, 45, 60] as const;
export const DEFAULT_PRACTICE: PracticePrefs = { kataMinutes: 30, sessionsPerWeek: 3, minutesPerSession: 90, monthly: false, focus: "rotate" };

/** Normaliza las preferencias de práctica; `undefined` si no hay (o si no hay nada que practicar). */
export function sanitizePractice(raw: unknown): PracticePrefs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const kataMinutes = o.kataMinutes === undefined ? DEFAULT_PRACTICE.kataMinutes : int(o.kataMinutes, 0, 180, DEFAULT_PRACTICE.kataMinutes);
  const sessionsPerWeek = o.sessionsPerWeek === undefined ? DEFAULT_PRACTICE.sessionsPerWeek : int(o.sessionsPerWeek, 0, 7, DEFAULT_PRACTICE.sessionsPerWeek);
  const minutesPerSession = int(o.minutesPerSession, 15, 480, DEFAULT_PRACTICE.minutesPerSession);
  if (kataMinutes <= 0 && sessionsPerWeek <= 0) return undefined;
  const focus = (PRACTICE_FOCUSES as readonly string[]).includes(String(o.focus)) ? (o.focus as PracticeFocus) : "rotate";
  return { kataMinutes, sessionsPerWeek, minutesPerSession, monthly: o.monthly === true && sessionsPerWeek > 0, focus };
}

/**
 * ¿Cómo se combinan las áreas del plan? (se decide AL CREAR el plan)
 *  - `together`: todas las áreas elegidas activas TODO el periodo y presentes CADA día (el día combina teoría y práctica de cada una).
 *  - `phased`: áreas separadas por fases (como máximo 2 en paralelo).
 *  - `ai`: lo decide el Mentor (propone en el esqueleto; la app valida y calcula; queda una línea de justificación).
 * Ausente en un plan o en unas precondiciones antiguas = comportamiento de siempre (`phased`). Automation siempre va al final.
 */
export const AREA_MODES = ["together", "phased", "ai"] as const;
export type PlanAreaMode = (typeof AREA_MODES)[number];
/** El modo ya decidido de un plan (nunca `ai`). */
export type ResolvedAreaMode = "together" | "phased";
export const normalizeAreaMode = (v: unknown): PlanAreaMode | undefined => ((AREA_MODES as readonly string[]).includes(String(v)) ? (v as PlanAreaMode) : undefined);

/** Lenguajes con práctica propia diaria. */
export const PLAN_LANGUAGE_IDS = ["python", "javascript", "typescript"] as const;
export type PlanLanguageId = (typeof PLAN_LANGUAGE_IDS)[number];
export interface PlanLanguage {
  id: PlanLanguageId;
  /** obligatorio por las áreas del plan (o porque lo pediste): no se puede quitar */
  required: boolean;
  /** por qué está en el plan («Backend lo usa en TypeScript y Python») */
  why: string;
  /** peso de la rotación diaria (por defecto Python 3, JavaScript 2, TypeScript 2) */
  weight?: number;
}

export interface PlanPreconditions {
  /** AAAA-MM-DD */
  start: string;
  end: string;
  minutesPerDay: number;
  /** días de estudio, ISO: 1 = lunes … 7 = domingo */
  studyDays: number[];
  blockedDates?: string[];
  pace: PlanPace;
  goalIds: string[];
  /** materias / áreas de estudio (primer segmento de la carpeta de los temas) */
  subjects: string[];
  freeObjective?: string;
  /** nivel declarado por materia: solo una hipótesis para el reparto y la IA */
  levels: Record<string, PlanLevel>;
  deliverables: DeliverablesMode;
  /** pista «Programming practice» (kata diario + proyecto semanal full stack); ausente = sin práctica */
  practice?: PracticePrefs;
  /** comentarios libres del estudiante para la IA (preferencias; no cambian los hechos fijos) */
  notes?: string;
  /** ramas incluidas por materia (área → nombres de rama = 2.º segmento de la carpeta); una materia sin entrada incluye todas sus ramas */
  branches?: Record<string, string[]>;
  /** el preset con el que se eligieron las ramas (`fullstack`, `backend`…), para explicarlo */
  branchPreset?: string;
  /** ramas que quedaron fuera al aplicar `branches`: solo para mostrar «Excluí X porque pediste full stack» */
  branchExcluded?: string[];
  /** cómo se combinan las áreas (juntas, por fases o lo decide el Mentor); ausente = por fases como siempre */
  areaMode?: PlanAreaMode;
  /** lenguajes con bloque de práctica propio cada día; ausente = sin bloque diario de lenguaje (planes antiguos) */
  languages?: PlanLanguage[];
}

export const MAX_NOTES_CHARS = 1500;
/** Texto libre: una cadena, sin caracteres de control (se conservan los saltos de línea), recortada a su máximo. */
export function sanitizeNotes(v: unknown, max = MAX_NOTES_CHARS): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]|\p{Zl}|\p{Zp}/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();
}

export const DEFAULT_STUDY_DAYS = [1, 2, 3, 4, 5, 6];
export const MIN_MINUTES_PER_DAY = 5;
export const MAX_MINUTES_PER_DAY = 720;

const strList = (v: unknown, max: number, len = 200): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))].map((s) => s.slice(0, len)).slice(0, max);

/** Normaliza lo que llegue (UI, API, disco): nunca lanza; lo inválido se corrige o se omite. */
export function sanitizePreconditions(raw: unknown, today: string): PlanPreconditions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const start = isDate(o.start) ? o.start : today;
  const end = isDate(o.end) ? o.end : presetEnd("1m", start);
  const mpd = Math.round(Number(o.minutesPerDay));
  const studyDays = [...new Set((Array.isArray(o.studyDays) ? o.studyDays : DEFAULT_STUDY_DAYS).map((d: unknown) => Math.round(Number(d))).filter((d: number) => d >= 1 && d <= 7))].sort((a, b) => a - b);
  const blocked = [...new Set((Array.isArray(o.blockedDates) ? o.blockedDates : []).filter(isDate))].sort().slice(0, 400) as string[];
  const levels: Record<string, PlanLevel> = {};
  for (const [k, v] of Object.entries(o.levels && typeof o.levels === "object" ? o.levels : {})) {
    if ((LEVELS as readonly string[]).includes(String(v)) && k.trim()) levels[k.trim().slice(0, 120)] = v as PlanLevel;
  }
  const free = String(o.freeObjective ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const notes = sanitizeNotes(o.notes);
  const practice = sanitizePractice(o.practice);
  const branches: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o.branches && typeof o.branches === "object" ? o.branches : {})) {
    if (k.trim() && Array.isArray(v)) branches[k.trim().slice(0, 120)] = strList(v, 60, 120);
  }
  const hasBranches = Object.keys(branches).length > 0;
  const preset = String(o.branchPreset ?? "").trim().slice(0, 20);
  const excluded = strList(o.branchExcluded, 60, 120);
  const areaMode = normalizeAreaMode(o.areaMode);
  const languages = sanitizeLanguages(o.languages);
  return {
    start,
    end,
    minutesPerDay: mpd >= MIN_MINUTES_PER_DAY ? Math.min(MAX_MINUTES_PER_DAY, mpd) : 120,
    studyDays: studyDays.length ? studyDays : [...DEFAULT_STUDY_DAYS],
    ...(blocked.length ? { blockedDates: blocked } : {}),
    pace: (PACES as readonly string[]).includes(String(o.pace)) ? (o.pace as PlanPace) : "normal",
    goalIds: strList(o.goalIds, 40, 80),
    subjects: strList(o.subjects, 40, 120),
    ...(free ? { freeObjective: free } : {}),
    ...(notes ? { notes } : {}),
    levels,
    deliverables: normalizeDeliverables(o.deliverables),
    ...(practice ? { practice } : {}),
    ...(hasBranches ? { branches } : {}),
    // «all» (Todo) es una elección explícita sin lista de ramas: evita que el servidor vuelva a inferir un preset
    ...(preset && (hasBranches || preset === "all") ? { branchPreset: preset } : {}),
    ...(excluded.length && hasBranches ? { branchExcluded: excluded } : {}),
    ...(areaMode ? { areaMode } : {}),
    ...(languages ? { languages } : {}),
  };
}

/** Lenguajes válidos (ids conocidos, sin repetir); `undefined` si no hay campo (planes antiguos); `[]` = el estudiante no quiere ninguno. */
export function sanitizeLanguages(raw: unknown): PlanLanguage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlanLanguage[] = [];
  for (const l of raw) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const id = String(o.id ?? "").toLowerCase();
    if (!(PLAN_LANGUAGE_IDS as readonly string[]).includes(id) || out.some((x) => x.id === id)) continue;
    const w = Math.round(Number(o.weight));
    out.push({
      id: id as PlanLanguageId,
      required: o.required === true,
      why: String(o.why ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      ...(Number.isFinite(w) && w >= 1 && w <= 9 ? { weight: w } : {}),
    });
  }
  return out;
}

/** Motivo por el que unas precondiciones no sirven para armar un plan, o null. */
export function preconditionsProblem(pre: PlanPreconditions, today?: string): string | null {
  if (!isDate(pre.start) || !isDate(pre.end)) return "Indica las fechas de inicio y fin del periodo.";
  if (pre.end < pre.start) return "La fecha de fin es anterior a la de inicio.";
  if (daysBetween(pre.start, pre.end) + 1 > MAX_PERIOD_DAYS) return `El periodo no puede pasar de ${MAX_PERIOD_DAYS} días.`;
  if (today && pre.end < today) return "El periodo ya terminó: elige fechas que no sean pasadas.";
  if (!(pre.minutesPerDay >= MIN_MINUTES_PER_DAY)) return "El tiempo diario debe ser de al menos 5 minutos.";
  if (!pre.studyDays.length) return "Elige al menos un día de estudio.";
  if (!pre.goalIds.length && !pre.subjects.length && !pre.freeObjective) return "Elige qué quieres cubrir: una meta, una materia o escribe otro objetivo.";
  return null;
}

export interface Capacity {
  /** días del periodo (desde `from`) */
  totalDays: number;
  /** días de estudio que quedan tras quitar los bloqueados */
  studyDays: number;
  blockedDays: number;
  weeks: number;
  /** minutos declarados (días de estudio × tiempo diario) */
  rawMinutes: number;
  /** minutos reales tras el ritmo */
  effectiveMinutes: number;
  /** horas efectivas por semana (media) */
  hoursPerWeek: number;
  factor: number;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Minutos que da cada día del plan: día de estudio no bloqueado × tiempo diario × ritmo. */
export function dayMinutes(pre: Pick<PlanPreconditions, "minutesPerDay" | "studyDays" | "blockedDates" | "pace">): (date: string) => number {
  const days = new Set(pre.studyDays);
  const blocked = new Set(pre.blockedDates ?? []);
  const f = PACE_FACTOR[pre.pace] ?? 1;
  return (date) => (days.has(isoDow(date)) && !blocked.has(date) ? pre.minutesPerDay * f : 0);
}

/** Capacidad real del plan (determinista). `from` = primer día aprovechable (hoy si el periodo ya empezó). */
export function capacityOf(pre: PlanPreconditions, from?: string): Capacity {
  const first = from && from > pre.start ? from : pre.start;
  const days = isDate(first) && isDate(pre.end) ? eachDay(first, pre.end) : [];
  const f = PACE_FACTOR[pre.pace] ?? 1;
  const study = new Set(pre.studyDays);
  const blocked = new Set(pre.blockedDates ?? []);
  let studyCount = 0;
  let blockedCount = 0;
  for (const d of days) {
    if (!study.has(isoDow(d))) continue;
    if (blocked.has(d)) blockedCount++;
    else studyCount++;
  }
  const rawMinutes = studyCount * pre.minutesPerDay;
  const effectiveMinutes = Math.round(rawMinutes * f);
  const weeks = r1(days.length / 7);
  return {
    totalDays: days.length,
    studyDays: studyCount,
    blockedDays: blockedCount,
    weeks,
    rawMinutes,
    effectiveMinutes,
    hoursPerWeek: weeks > 0 ? r1(effectiveMinutes / 60 / weeks) : 0,
    factor: f,
  };
}

// ── Qué hay que cubrir ───────────────────────────────────────────────────

/** Un tema pendiente de lo que se puede elegir (para el cálculo de lo que hay que cubrir). */
export interface ScopeTopic {
  folder: string;
  /** materia / área (primer segmento de la carpeta) */
  area: string;
  minutes: number;
  /** metas activas que lo enlazan */
  goalIds: string[];
  /** rama de la materia (2.º segmento de la carpeta; "" si el tema cuelga directamente de la materia) */
  branch?: string;
}

export const areaOfFolder = (folder: string): string => folder.split("/").filter(Boolean)[0] ?? "";
/** Rama de un tema: el 2.º segmento de su carpeta cuando hay al menos 3 («Programación/4 Backend/Tema»); "" si no tiene. */
export const branchOfFolder = (folder: string): string => {
  const segs = folder.split("/").filter(Boolean);
  return segs.length >= 3 ? segs[1]! : "";
};
/** ¿Entra un tema de `area`/`branch` según las ramas elegidas? Sin selección para la materia, o sin rama, entra. */
export const branchAllowed = (branches: PlanPreconditions["branches"], area: string, branch: string): boolean => {
  const list = branches?.[area];
  return !list || !branch || list.includes(branch);
};

// ── Ramas de una materia: presets «Full stack web», «Backend»… (clasificación por nombre, tratada como datos) ──

export type BranchClass = "fundamentals" | "language" | "logic" | "backend" | "frontend" | "databases" | "desktop" | "mobile" | "automation" | "tooling" | "other";
const foldText = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const CLASS_RULES: Array<[BranchClass, RegExp]> = [
  // entrenamiento de resolución de problemas (independiente del lenguaje): «Programming Logic», «Lógica de programación», «Problem solving»
  ["logic", /^(programming logic|logica de programacion|logica|problem solving|resolucion de problemas|algorithmic)/],
  ["desktop", /desktop|electron|escritorio/],
  ["mobile", /mobile|movil|android|\bios\b|flutter|react native/],
  ["automation", /automat/],
  ["databases", /database|base de datos|bases de datos|\bsql\b/],
  ["backend", /backend|back end|servidor|\bapis?\b/],
  ["frontend", /frontend|front end/],
  ["tooling", /tooling|quality|calidad|\bgit\b|testing|herramientas/],
  ["fundamentals", /fundament|fundamento|basics?\b|basico/],
  ["language", /python|javascript|typescript|\bjs\b|\bts\b|\bjava\b|golang|\brust\b|c\+\+|c#|kotlin|swift|lenguaje|language/],
];
/** La clase de una rama según su nombre (los números de orden iniciales no cuentan). */
export function classifyBranch(name: string): BranchClass {
  const n = foldText(name).replace(/^[\d.\s_-]+/, "");
  return CLASS_RULES.find(([, re]) => re.test(n))?.[0] ?? "other";
}

export const BRANCH_PRESETS = [
  { key: "fullstack", label: "Full stack web", classes: ["fundamentals", "language", "logic", "backend", "frontend", "databases", "tooling"] },
  { key: "backend", label: "Backend", classes: ["fundamentals", "language", "backend", "databases", "tooling"] },
  { key: "frontend", label: "Frontend", classes: ["fundamentals", "language", "frontend", "tooling"] },
  { key: "desktop", label: "Desktop", classes: ["fundamentals", "language", "desktop", "tooling"] },
  { key: "mobile", label: "Mobile", classes: ["fundamentals", "language", "mobile", "tooling"] },
  { key: "all", label: "Todo", classes: null },
] as const;
export type BranchPresetKey = (typeof BRANCH_PRESETS)[number]["key"];

/** Las ramas que incluye un preset entre las de la materia (`all` = todas; las no clasificadas solo entran con «Todo»). */
export function presetBranches(key: BranchPresetKey, names: readonly string[], extraClasses: readonly BranchClass[] = []): string[] {
  const p = BRANCH_PRESETS.find((x) => x.key === key);
  if (!p || !p.classes) return [...names];
  const ok = new Set<BranchClass>([...(p.classes as readonly BranchClass[]), ...extraClasses]);
  return names.filter((n) => ok.has(classifyBranch(n)));
}

/**
 * Detecta en el texto (objetivo libre, nombres de metas, comentarios) qué quiere el estudiante: «full stack» preselecciona ese preset,
 * y si además nombra móvil o escritorio de forma explícita, esa rama se incluye (el estudiante manda).
 */
export function detectBranchIntent(text: string): { preset: BranchPresetKey | null; extra: BranchClass[] } {
  const t = foldText(text);
  const extra: BranchClass[] = [];
  if (/(movil|mobile|android|\bios\b|flutter|react native)/.test(t)) extra.push("mobile");
  if (/(escritorio|desktop|electron|apps? de pc)/.test(t)) extra.push("desktop");
  if (/full[\s-]?stack/.test(t)) return { preset: "fullstack", extra };
  return { preset: null, extra };
}

/** Minutos de un tema con el ajuste por el nivel declarado de su materia. */
export function adjustedMinutes(minutes: number, area: string, levels: Record<string, PlanLevel>): number {
  return Math.max(5, Math.round((minutes * LEVEL_FACTOR[levels[area] ?? "no_se"]) / 5) * 5);
}

/** Temas (únicos) dentro de lo elegido y sus minutos ajustados por nivel. */
export function selectionOf(pre: Pick<PlanPreconditions, "goalIds" | "subjects" | "levels" | "branches">, topics: readonly ScopeTopic[]): { folders: string[]; minutes: number } {
  const goals = new Set(pre.goalIds);
  const areas = new Set(pre.subjects);
  const picked = topics.filter((t) => (areas.has(t.area) && branchAllowed(pre.branches, t.area, t.branch ?? "")) || t.goalIds.some((g) => goals.has(g)));
  return { folders: picked.map((t) => t.folder), minutes: picked.reduce((n, t) => n + adjustedMinutes(t.minutes, t.area, pre.levels), 0) };
}

export interface Coverage {
  fits: boolean;
  /** diferencia en minutos (capacidad − necesidad): positiva = sobra */
  spareMinutes: number;
  text: string;
}

const hours = (min: number): string => `${num1(min / 60)} h`;

/** El aviso claro: "tus metas necesitan ~X h y tienes Y h: sobra/falta". */
export function coverage(neededMinutes: number, capacityMinutes: number): Coverage {
  const spare = capacityMinutes - neededMinutes;
  if (neededMinutes <= 0) return { fits: true, spareMinutes: spare, text: "No hay temas pendientes en lo que elegiste: el plan solo tendría entregables." };
  if (capacityMinutes <= 0) return { fits: false, spareMinutes: spare, text: `Lo elegido necesita ~${hours(neededMinutes)} y no tienes horas disponibles: revisa los días de estudio y las fechas.` };
  const head = `Lo elegido necesita ~${hours(neededMinutes)} y tienes ${hours(capacityMinutes)}`;
  return spare >= 0
    ? { fits: true, spareMinutes: spare, text: `${head}: sobran ${hours(spare)}.` }
    : { fits: false, spareMinutes: spare, text: `${head}: faltan ${hours(-spare)}. Alarga el periodo, sube el tiempo diario o quita objetivos.` };
}
