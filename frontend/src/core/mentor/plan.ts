/**
 * Plan del Mentor sobre un PERIODO LIBRE `[start, end]` (1 semana, 2 meses, fechas a medida…): subplanes por
 * área/objetivo con temas elegidos, reparto semanal según la capacidad real y registro de temas completados.
 *
 * Datos en `.notevault/mentor/plans/<id>.json` (opcional y aditivo, ver docs/VAULT_FORMAT.md). Los planes
 * mensuales antiguos (`<YYYY-MM>.json`, con `month`) se leen como un plan de periodo (día 1 – último día).
 * La IA solo propone (ver `planDraft.ts` / `planSpec.ts`); aquí todo es determinista:
 *  - `distributeTopics` / `buildPlan`: reparto semana a semana según la capacidad (horas por semana, o
 *    tiempo diario × días de estudio × ritmo).
 *  - `topicState` / `deriveView`: el estado de práctica y el % se DERIVAN en vivo del motor de
 *    práctica; en el archivo solo se guarda lo que no se puede derivar (`completedAt`, entregable).
 *  - `refreshPlanProgress`: anota la fecha la primera vez que se observa un tema completo (nunca la pisa).
 *  - `planItemsFor`: de dónde sale el plan diario: lo que los planes activos dicen que toca esta semana.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  addDays,
  areaOfFolder,
  daysBetween,
  dayMinutes,
  eachDay,
  isDate,
  MAX_PERIOD_DAYS,
  monthBounds,
  sanitizePreconditions,
  weekIndex,
  weekRangesOf,
  type PlanPace,
  type PlanPreconditions,
} from "../../lib/planTime.js";
import {
  areasPlanName,
  PARALLEL_GROUP,
  planAreaPhases,
  planTogetherPhases,
  type AreaModeSource,
  sanitizeGroups,
  sanitizePhase,
  sanitizePlanDeliverables,
  sanitizePurposes,
  type AreaGroup,
  type AreaPhase,
  type PlanDeliverable,
  type PlanPurposes,
} from "../../lib/planAreas.js";
import { buildSchedule, progressPlan } from "../../lib/planSchedule.js";
import { deliverablesDefined } from "../../lib/planTopicsByArea.js";
import { isLive, sanitizeRouteFields, type TopicRoute } from "../../lib/planRoute.js";
import { projectsForSubplan, sanitizeTopicProject, type MasteryLookup, type TopicProject } from "../../lib/planTopicProject.js";
import { dailyProjectOf } from "../../lib/planCurriculum.js";
import { sanitizeCurriculum, scopeOfPlan, type PracticeCurriculum } from "../../lib/planCurriculum.js";
import { areaKeyOf, sanitizeCoverageReview, type CoverageReview } from "../../lib/planCoverage.js";
import { sanitizePracticeTrack, type PracticeTrack } from "../../lib/practiceTrack.js";
import { sanitizeExtraPractice, sanitizeExtraTopics, sanitizePace, type ExtraPractice, type ExtraTopic, type DailyPace } from "../../lib/planPace.js";
import * as store from "../store.js";
import { formatLayout, isSyncConflict, LAYOUT } from "../vaultFormat.js";
import type { TopicProgressSnap } from "./topics.js";

// ── Tipos ────────────────────────────────────────────────────────────────

export const DELIVERABLE_STATUSES = ["idea", "en_curso", "hecho"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export interface PlannedTopic {
  /** carpeta del tema (id estable, POSIX relativa a la vault) */
  folder: string;
  title: string;
  skills?: string[];
  /** semana del plan (1..) en que toca terminarlo */
  targetWeek: number;
  estMinutes: number;
  /** AAAA-MM-DD: la primera vez que se observó el tema completo (registro de temas completados) */
  completedAt?: string;
  /** primer tema de una materia de nivel «no sé»: empieza con un diagnóstico corto para calibrar */
  diagnostic?: boolean;
  /** el estudiante fijó su semana con un comentario («pasa X a la semana 5»): el reparto no la mueve */
  pinned?: boolean;
  /** grupo interno del área al que pertenece (Bases, Lenguaje: Python, Conocimientos…); ver `lib/planAreas.ts` */
  group?: string;
  /** RUTA: `core` (por defecto, ausente) · `optional` · `skipped` (fuera de ruta: se conserva en el plan y en la vault, no cuenta ni se agenda); ver `lib/planRoute.ts` */
  route?: Exclude<TopicRoute, "core">;
  skippedReason?: string;
  /** proyecto de aplicación tras el tema, calibrado al nivel medido; ver `lib/planTopicProject.ts` */
  topicProject?: TopicProject;
  /** de dónde llegó al plan sin estar en su ruta original: `curriculum` = temas de referencia creados con «Crear con Antigravity» y añadidos con «Añadir al plan» */
  addedFrom?: "curriculum";
  revisionAddedAt?: string;
  /** identificador estable del tema (resiste cambios en la estructura de carpetas de la vault) */
  topicId?: string;
  /** tags o etiquetas metodológicas del tema */
  tags?: string[];
}

export interface WeekSlice {
  week: number;
  start: string;
  end: string;
  /** carpetas de los temas de esta semana, en orden */
  topics: string[];
  minutes: number;
  /** minutos disponibles esa semana para este subplan */
  capacityMinutes: number;
}

export interface RequiredGoal {
  goalId: string;
  itemId?: string;
  note: string;
}

export interface Deliverable {
  title: string;
  description: string;
  criteria: string[];
  /** proyecto existente enlazado */
  projectId?: string;
  status: DeliverableStatus;
}

/** Por qué un subplan se completó con reglas en vez de con la selección de la IA (solo cuando de verdad ocurrió). */
export interface SubplanFallback {
  kind: "rules" | "mixed";
  reason: string;
}

export interface Subplan {
  id: string;
  /** área elemental (Backend, Frontend…) en los planes por áreas; materia o área de vida en los antiguos */
  area: string;
  /** objetivo corto (una línea) del área; en los planes antiguos, la meta o el objetivo largo */
  objective: string;
  goalId?: string;
  goalItemIds?: string[];
  topics: PlannedTopic[];
  weeks: WeekSlice[];
  requiredGoals: RequiredGoal[];
  deliverable?: Deliverable;
  notes?: string;
  /** orientación pedagógica persistente para crear contenido del área */
  learningGuide?: string;
  /** id del área elemental (`backend`, `frontend`…): presente en los planes por áreas */
  areaId?: string;
  /** grupos internos del área, en orden (Bases · Lenguaje · Conocimientos) */
  groups?: AreaGroup[];
  /** semanas del plan en que el área está activa (secuencia por fases) */
  phase?: AreaPhase;
  fallback?: SubplanFallback;
}

/**
 * Pregunta pendiente de decidir al armar el plan (aditivo, sin subir FORMAT_VERSION). Hoy solo `deliverables`: «¿Quieres un
 * entregable para <subplan>?» cuando las precondiciones dicen «a discutir». Es el punto de extensión de la construcción
 * progresiva con preguntas: cada pregunta se responde con `mentor_plan_draft_answer` (hoy: Sí / No / Después).
 */
export interface OpenQuestion {
  id: string;
  /** subplan al que se refiere */
  subplanId?: string;
  text: string;
  options: string[];
}
export const DELIVERABLE_QUESTION_ID = "deliverables";
export const DELIVERABLE_QUESTION_OPTIONS = ["Sí", "No", "Después"] as const;

/** Pregunta POR SUBPLAN (planes antiguos): «¿Quieres un entregable para X?». */
export function deliverableQuestion(sub: Pick<Subplan, "id" | "area" | "objective">): OpenQuestion {
  return { id: DELIVERABLE_QUESTION_ID, subplanId: sub.id, text: `¿Quieres un entregable (proyecto de demostración) para ${subplanLabel(sub)}?`, options: [...DELIVERABLE_QUESTION_OPTIONS] };
}

/** UNA sola pregunta global de entregables para todo el plan por áreas (con excepciones por área al responder). */
export function globalDeliverableQuestion(): OpenQuestion {
  return { id: DELIVERABLE_QUESTION_ID, text: "¿Quieres un entregable (proyecto de demostración) por cada área del plan?", options: [...DELIVERABLE_QUESTION_OPTIONS] };
}

/**
 * Preguntas válidas: de un subplan que existe y que aún no tiene entregable (si ya lo tiene, la pregunta está respondida), o la pregunta
 * GLOBAL de entregables (sin subplan) mientras algún subplan siga sin entregable.
 */
export function sanitizeOpenQuestions(raw: unknown, subplans: readonly Subplan[]): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const seen = new Set<string>();
  for (const q of Array.isArray(raw) ? raw : []) {
    const id = oneLine(q?.id, 40);
    const hasSub = q?.subplanId !== undefined && q?.subplanId !== null && String(q.subplanId) !== "";
    const sub = hasSub ? subplans.find((s) => s.id === String(q.subplanId)) : undefined;
    if (!id || (hasSub && !sub)) continue;
    if (id === DELIVERABLE_QUESTION_ID && (sub ? !!sub.deliverable : subplans.every((s) => !!s.deliverable))) continue;
    const key = `${id}:${sub?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const options = (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => oneLine(o, 40)).filter(Boolean).slice(0, 6);
    const fallbackText = sub ? deliverableQuestion(sub).text : id === DELIVERABLE_QUESTION_ID ? globalDeliverableQuestion().text : id;
    out.push({ id, ...(sub ? { subplanId: sub.id } : {}), text: oneLine(q?.text, 300) || fallbackText, options: options.length ? options : [...DELIVERABLE_QUESTION_OPTIONS] });
  }
  return out;
}

export interface Plan {
  /** nombre del archivo sin `.json`: `<AAAA-MM>` (plan mensual heredado) o `<inicio>_<fin>` */
  id: string;
  /** primer y último día del plan (AAAA-MM-DD, ambos incluidos) */
  start: string;
  end: string;
  /** AAAA-MM: solo en los planes mensuales heredados (id = mes) */
  month?: string;
  createdAt: string;
  updatedAt: string;
  /** horas efectivas por semana (media del periodo) */
  hoursPerWeek?: number;
  /** las precondiciones con las que se armó (tiempo diario, días de estudio…) */
  preconditions?: PlanPreconditions;
  /** nombre editable; si falta se autogenera (`planName`) */
  name?: string;
  /** terminado/archivado a mano: deja de estar activo aunque su periodo no haya acabado */
  archived?: boolean;
  /** propuesto por el Mentor y aún sin mantener: se ve y se puede refinar, pero no alimenta «Hoy» ni cuenta como plan activo */
  proposed?: boolean;
  /** generado sin IA (plan automático determinista) */
  auto?: boolean;
  rationale?: string;
  /** pista «Programming practice»: kata diario + proyecto semanal full stack (+ mensual); ver `lib/practiceTrack.ts` */
  programmingPractice?: PracticeTrack;
  /** decisiones que quedaron pendientes al armar el plan (p. ej. entregables «a discutir») */
  openQuestions?: OpenQuestion[];
  /** «areas» = subplanes por áreas elementales con grupos y fases (estructura nueva); ausente = estructura antigua */
  structure?: "areas";
  /** ediciones a mano de entregables derivados (por id) y entregables extra; ver `lib/planAreas.ts` */
  deliverables?: PlanDeliverable[];
  /** propósitos de día / semana / mes escritos a mano (sustituyen al texto determinista) */
  purposes?: PlanPurposes;
  /** la última revisión de cobertura hecha con el Mentor (solo informa: no cambia temas); ver `lib/planCoverage.ts` */
  coverageReview?: CoverageReview;
  /** currículo de práctica del plan generado por la IA bajo demanda (ejercicios por semana y proyectos); ver `lib/planCurriculum.ts` */
  practiceCurriculum?: PracticeCurriculum;
  /** cómo se combinan las áreas, ya decidido: `together` (todas juntas cada día) o `phased` (por fases); ausente = por fases como siempre */
  areaMode?: "together" | "phased";
  /** la línea de justificación visible del modo y quién lo decidió */
  areaModeWhy?: string;
  areaModeBy?: AreaModeSource;
  /**
   * Cuándo (ISO) quedaron DEFINIDOS los entregables del plan: los fija la ejecución del plan (sistema de práctica y proyectos por área). Mientras
   * no exista (y no haya entregables manuales, de área ni currículo), los entregables están «por definir» (ver `deliverablesDefined`).
   */
  deliverablesDefinedAt?: string;
  /** ritmo diario manual: temas por día y mínimo diario (global y por área); ausente = reparto automático por minutos; ver `lib/planPace.ts` */
  pace?: DailyPace;
  /** temas añadidos a mano a un día (de la ruta, más adelante, o de la vault) y práctica diaria extra */
  extraTopics?: ExtraTopic[];
  extraPractice?: ExtraPractice[];
  subplans: Subplan[];
}
/** Nombre histórico: un plan mensual es un plan de periodo. */
export type MonthlyPlan = Plan;

export type TopicState = "sin_tratar" | "practicando" | "consolidado" | "completo" | "examen_pendiente" | "no_encontrado";

/** Lo mínimo de un tema de la vault para derivar su estado (cumple `TopicSnap`). */
export interface TopicLite {
  progress: TopicProgressSnap;
  attemptCount: number;
  lastAttemptAt?: string | null;
  /** ejercicios que el tema ya tiene en la vault */
  exerciseCount?: number;
}
export type TopicLiteLookup = (folder: string) => TopicLite | null | undefined;

// ── Fechas y semanas ─────────────────────────────────────────────────────

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const PLAN_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const two = (n: number): string => String(n).padStart(2, "0");

export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}`;
}

/** Semanas del mes: trozos de 7 días desde el día 1 (la última puede ser más corta). */
export function weekRanges(month: string): Array<{ week: number; start: string; end: string; days: number }> {
  const b = monthBounds(month);
  return weekRangesOf(b.start, b.end);
}

/** Semana (1..) a la que pertenece `date`: de un mes (AAAA-MM) o de un periodo `{start,end}`; 0 si es anterior, última+1 si posterior. */
export function weekOf(date: string, period: string | { start: string; end: string }): number {
  const p = typeof period === "string" ? monthBounds(period) : period;
  return weekIndex(date, p.start, p.end);
}

export type PlanStatus = "activo" | "futuro" | "terminado" | "propuesto";
export function planStatus(plan: Pick<Plan, "start" | "end" | "archived" | "proposed">, today: string): PlanStatus {
  if (plan.proposed) return "propuesto";
  if (plan.archived) return "terminado";
  return today < plan.start ? "futuro" : today > plan.end ? "terminado" : "activo";
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dmShort = (iso: string): string => `${Number(iso.slice(8))} ${MONTHS_ES[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Nombre autogenerado a partir de las ÁREAS: «Full stack web · 6 oct–5 abr» (el periodo una sola vez, sin sufijos «+N»). Con subplanes
 * antiguos sin `areaId` se usan sus áreas de vida («Programación · 6 oct–5 abr»).
 */
export function defaultPlanName(subplans: ReadonlyArray<Pick<Subplan, "area" | "objective"> & { areaId?: string }>, start: string, end: string): string {
  if (!subplans.length) return `Plan · ${dmShort(start)}–${dmShort(end)}`;
  return areasPlanName(subplans, start, end);
}
/** El nombre del plan: el editado o el autogenerado. */
export const planName = (p: Pick<Plan, "name" | "subplans" | "start" | "end" | "month">): string => {
  if (p.name?.trim()) return p.name.trim();
  if (p.month) {
    const [y, m] = p.month.split("-").map(Number);
    const t = new Date(y!, m! - 1, 1).toLocaleDateString("es", { month: "long", year: "numeric" });
    return `Plan de ${t}`;
  }
  return defaultPlanName(p.subplans, p.start, p.end);
};

// ── Estado derivado de un tema ───────────────────────────────────────────

/** Estado de práctica de un tema (derivado en vivo; nunca se guarda). */
export function topicState(t: TopicLite | null | undefined): TopicState {
  if (!t) return "no_encontrado";
  const p = t.progress;
  const pct = p.completenessPct;
  const skills = Object.values(p.skills);
  const allMastered = skills.length > 0 && skills.every((s) => s.mastered);
  const examMissing = p.topic.mastery.exam === "required" && !p.examPassed;
  if (t.attemptCount === 0 && pct <= 0) return "sin_tratar";
  if ((pct >= 100 || allMastered) && examMissing) return "examen_pendiente";
  if (pct >= 100) return "completo";
  if (pct >= 70) return "consolidado";
  return "practicando";
}

export const TOPIC_STATE_LABEL: Record<TopicState, string> = {
  sin_tratar: "Sin tratar",
  practicando: "Practicando",
  consolidado: "Consolidado",
  completo: "Completo",
  examen_pendiente: "Examen pendiente",
  no_encontrado: "No encontrado",
};

// ── Reparto semanal ──────────────────────────────────────────────────────

export interface Capacity {
  /** horas por semana (cada día vale lo mismo) */
  hoursPerWeek?: number;
  /** o bien: tiempo diario × días de estudio × ritmo, menos fechas bloqueadas */
  minutesPerDay?: number;
  studyDays?: number[];
  blockedDates?: string[];
  pace?: PlanPace;
  /** minutos de cada día reservados a otra cosa (la práctica): se restan de lo que da el día antes de repartir temas */
  reservedMinutes?: (date: string) => number;
  /** fracción (0..1) de lo que queda del día para este reparto: con áreas en paralelo, el área activa se lleva su parte; 0 = área inactiva */
  shareAt?: (date: string) => number;
}

export interface DistributeInput extends Capacity {
  /** AAAA-MM: el periodo es ese mes (plan mensual heredado) */
  month?: string;
  /** o un periodo libre */
  start?: string;
  end?: string;
  topics: ReadonlyArray<{ folder: string; title: string; skills?: string[]; estMinutes: number; group?: string }>;
  /** semanas (1..) en que el reparto puede colocar temas (fase del área); fuera de ellas la capacidad es 0 */
  window?: AreaPhase;
  /** primer día disponible (AAAA-MM-DD); por defecto, el inicio del periodo */
  from?: string;
  /** si todo cabe, reparte los temas a partes iguales por las semanas aprovechables (en vez de llenar las primeras) */
  spread?: boolean;
}

export interface Distribution {
  topics: PlannedTopic[];
  weeks: WeekSlice[];
  totalMinutes: number;
  availableMinutes: number;
  fits: boolean;
  requiredHoursPerWeek: number | null;
  warnings: string[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

function periodOf(i: { month?: string; start?: string; end?: string }): { start: string; end: string } {
  if (i.start !== undefined || i.end !== undefined) {
    if (!isDate(i.start) || !isDate(i.end) || i.end < i.start) throw new Error("Periodo inválido (inicio y fin AAAA-MM-DD).");
    if (daysBetween(i.start, i.end) + 1 > MAX_PERIOD_DAYS) throw new Error(`El periodo no puede pasar de ${MAX_PERIOD_DAYS} días.`);
    return { start: i.start, end: i.end };
  }
  if (!i.month || !MONTH_RE.test(i.month)) throw new Error("Mes inválido (AAAA-MM).");
  return monthBounds(i.month);
}

/** Minutos que da cada día según la capacidad; lanza si no hay capacidad positiva. */
function dayMinutesOf(c: Capacity): (date: string) => number {
  const share = c.shareAt;
  if (c.minutesPerDay !== undefined) {
    if (!(c.minutesPerDay > 0)) throw new Error("El tiempo diario debe ser mayor que 0.");
    const base = dayMinutes({ minutesPerDay: c.minutesPerDay, studyDays: c.studyDays ?? [1, 2, 3, 4, 5, 6, 7], blockedDates: c.blockedDates, pace: c.pace ?? "intenso" });
    const reserved = c.reservedMinutes;
    const net = reserved ? (date: string) => (base(date) > 0 ? Math.max(0, base(date) - reserved(date)) : 0) : base;
    return share ? (date) => net(date) * share(date) : net;
  }
  if (!(Number(c.hoursPerWeek) > 0)) throw new Error("Las horas por semana deben ser mayores que 0.");
  const perDay = (Number(c.hoursPerWeek) * 60) / 7;
  return share ? (date) => perDay * share(date) : () => perDay;
}

/**
 * Reparte los temas EN ORDEN por las semanas del periodo. Cada semana tiene la capacidad de sus días
 * aprovechables (desde `from`; solo días de estudio no bloqueados). Un tema entra en la semana actual si
 * cabe al menos la mitad de sus minutos (o la semana está vacía); si no se avanza. Lo que sobrepasa el
 * periodo se queda en la última semana y se avisa de cuántas horas por semana harían falta.
 */
export function distributeTopics(input: DistributeInput): Distribution {
  const period = periodOf(input);
  const dm = dayMinutesOf(input);
  const ranges = weekRangesOf(period.start, period.end);
  const from = input.from && DATE_RE.test(input.from) && input.from > period.start ? (input.from > period.end ? addDays(period.end, 1) : input.from) : period.start;
  const win = input.window;
  const weeks: WeekSlice[] = ranges.map((r) => {
    const days = eachDay(from > r.start ? from : r.start, r.end);
    const inside = !win || (r.week >= win.fromWeek && r.week <= win.toWeek);
    return { week: r.week, start: r.start, end: r.end, topics: [], minutes: 0, capacityMinutes: inside ? Math.round(days.reduce((n, d) => n + dm(d), 0)) : 0 };
  });
  const usable = weeks.filter((w) => w.capacityMinutes > 0);
  const availableMinutes = usable.reduce((n, w) => n + w.capacityMinutes, 0);
  const topics = input.topics.filter((t) => t.estMinutes > 0);

  const totalNeed = topics.reduce((n, t) => n + t.estMinutes, 0);
  // con holgura, cada semana aprovechable se llena solo hasta lo que le toca de forma pareja
  const target = input.spread && usable.length > 1 && totalNeed <= availableMinutes ? Math.ceil(totalNeed / usable.length) : Infinity;
  const budget = (w: WeekSlice): number => Math.min(w.capacityMinutes, target);
  let idx = Math.max(0, weeks.findIndex((w) => w.capacityMinutes > 0));
  if (win && !usable.length) idx = Math.min(weeks.length - 1, Math.max(0, win.fromWeek - 1));
  // con una fase (ventana de semanas) lo que sobra se queda en la última semana de la ventana, no más allá
  const lastIdx = win ? Math.min(weeks.length - 1, Math.max(idx, win.toWeek - 1)) : weeks.length - 1;
  let remaining = budget(weeks[idx]!);
  const planned: PlannedTopic[] = [];
  for (const t of topics) {
    while (idx < lastIdx && weeks[idx]!.topics.length > 0 && remaining < t.estMinutes * 0.5) {
      idx++;
      remaining = budget(weeks[idx]!);
    }
    const w = weeks[idx]!;
    w.topics.push(t.folder);
    w.minutes += t.estMinutes;
    remaining -= t.estMinutes;
    planned.push({ folder: t.folder, title: t.title, ...(t.skills?.length ? { skills: t.skills } : {}), targetWeek: w.week, estMinutes: t.estMinutes, ...(t.group ? { group: t.group } : {}) });
  }

  const totalMinutes = topics.reduce((n, t) => n + t.estMinutes, 0);
  const fits = totalMinutes <= availableMinutes;
  const fromDays = Math.max(0, daysBetween(from, period.end) + 1);
  const nominal = input.minutesPerDay === undefined ? Number(input.hoursPerWeek) : fromDays > 0 ? availableMinutes / 60 / (fromDays / 7) : 0;
  const requiredHoursPerWeek = availableMinutes > 0 ? r1((totalMinutes / availableMinutes) * nominal) : null;
  const warnings: string[] = [];
  if (!topics.length) warnings.push("No hay temas que repartir.");
  else if (!fits) {
    warnings.push(
      `No cabe en el periodo: harían falta unas ${requiredHoursPerWeek ?? "?"} h/semana (tienes ${r1(nominal)}) o quitar temas. Lo que sobra queda en la última semana.`,
    );
  }
  return { topics: planned, weeks, totalMinutes, availableMinutes, fits, requiredHoursPerWeek, warnings };
}

// ── Subplanes y plan completo ────────────────────────────────────────────

export interface SubplanSeed {
  id?: string;
  area: string;
  objective: string;
  goalId?: string;
  goalItemIds?: string[];
  topics: Array<{ folder: string; title: string; skills?: string[]; estMinutes: number; diagnostic?: boolean; group?: string; route?: PlannedTopic["route"]; skippedReason?: string; topicProject?: TopicProject; addedFrom?: "curriculum"; revisionAddedAt?: string }>;
  requiredGoals?: RequiredGoal[];
  deliverable?: Partial<Deliverable> & { title: string };
  notes?: string;
  learningGuide?: string;
  /** peso para repartir la capacidad entre subplanes (por defecto, sus minutos): el constructor guiado lo usa para «más tiempo a…» */
  weight?: number;
  /** área elemental (`backend`…) y sus grupos internos: el subplan es un ÁREA del plan por áreas */
  areaId?: string;
  groups?: AreaGroup[];
  /** semanas en que el área está activa; si falta en un plan por áreas, `buildPlan` secuencia las áreas por fases */
  phase?: AreaPhase;
  fallback?: SubplanFallback;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const oneLine = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function subplanKey(s: Pick<Subplan, "area" | "objective">): string {
  return `${fold(s.area)}|${fold(s.objective)}`;
}

function slugOf(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "x";
}

function cleanDeliverable(d: SubplanSeed["deliverable"]): Deliverable | undefined {
  if (!d) return undefined;
  const title = oneLine(d.title, 140);
  if (!title) return undefined;
  const status = (DELIVERABLE_STATUSES as readonly string[]).includes(String(d.status)) ? (d.status as DeliverableStatus) : "idea";
  const criteria = (Array.isArray(d.criteria) ? d.criteria : []).map((c) => oneLine(c, 200)).filter(Boolean).slice(0, 8);
  return {
    title,
    description: oneLine(d.description, 600),
    criteria,
    ...(d.projectId ? { projectId: String(d.projectId) } : {}),
    status,
  };
}

export interface BuiltPlan {
  plan: Plan;
  warnings: string[];
  fits: boolean;
  totalMinutes: number;
  availableMinutes: number;
  requiredHoursPerWeek: number | null;
}

export interface BuildOpts extends Capacity {
  /** AAAA-MM (plan mensual heredado: id = mes) o un periodo libre `start`/`end` */
  month?: string;
  start?: string;
  end?: string;
  id?: string;
  name?: string;
  from?: string;
  now?: string;
  createdAt?: string;
  preconditions?: PlanPreconditions;
  auto?: boolean;
  rationale?: string;
  programmingPractice?: PracticeTrack;
  openQuestions?: OpenQuestion[];
  /** false = llena primero las primeras semanas (más intenso) en vez de repartir parejo; por defecto, parejo con tiempo diario */
  spread?: boolean;
  /** modo ya decidido de las áreas (`together` = todas juntas todo el periodo, Automation al final); sin él, por fases */
  areaMode?: "together" | "phased";
  areaModeWhy?: string;
  areaModeBy?: AreaModeSource;
}

/**
 * Plan desde las semillas de los subplanes. La capacidad (horas por semana, o tiempo diario) se reparte
 * entre los subplanes en proporción a sus minutos; el plan "cabe" si la suma de minutos cabe en el periodo.
 */
export function buildPlan(seeds: readonly SubplanSeed[], opts: BuildOpts): BuiltPlan {
  const now = opts.now ?? new Date().toISOString();
  const period = periodOf(opts);
  // los temas «fuera de ruta» (skipped) no cuentan: ni minutos, ni capacidad, ni reparto (se conservan en el plan, atenuados)
  const liveMinutes = (s: SubplanSeed): number => s.topics.filter(isLive).reduce((n, t) => n + t.estMinutes, 0);
  const total = seeds.reduce((n, s) => n + liveMinutes(s), 0);
  const weightOf = (s: SubplanSeed): number => (s.weight !== undefined && s.weight > 0 ? s.weight : liveMinutes(s));
  const weightTotal = seeds.reduce((n, s) => n + weightOf(s), 0);
  const warnings: string[] = [];
  const used = new Set<string>();
  const subplans: Subplan[] = [];
  let totalMinutes = 0;
  let availableMinutes = 0;
  const perDayMode = opts.minutesPerDay !== undefined;
  const ranges = weekRangesOf(period.start, period.end);
  // PLAN POR ÁREAS: cada área tiene una fase (semanas en que está activa); en cada semana la capacidad se reparte solo entre las activas
  const byAreas = seeds.length > 0 && seeds.every((s) => !!s.areaId);
  const phases = new Map<number, AreaPhase>();
  if (byAreas) {
    const given = seeds.map((s) => s.phase);
    if (given.every(Boolean)) given.forEach((p, i) => phases.set(i, p!));
    else {
      // secuencia determinista por fases a partir del orden de las semillas y de sus pesos
      const dm = dayMinutesOf(perDayMode ? { minutesPerDay: opts.minutesPerDay, studyDays: opts.studyDays, blockedDates: opts.blockedDates, pace: opts.pace, ...(opts.reservedMinutes ? { reservedMinutes: opts.reservedMinutes } : {}) } : { hoursPerWeek: opts.hoursPerWeek });
      const from0 = opts.from && DATE_RE.test(opts.from) && opts.from > period.start ? opts.from : period.start;
      const caps = ranges.map((r) => eachDay(from0 > r.start ? (from0 > r.end ? addDays(r.end, 1) : from0) : r.start, r.end).reduce((n, d) => n + dm(d), 0));
      const result =
        opts.areaMode === "together"
          ? planTogetherPhases(seeds.map((s, i) => ({ key: String(i), weight: weightOf(s), ...(s.areaId ? { areaId: s.areaId } : {}) })), caps)
          : planAreaPhases(seeds.map((s, i) => ({ key: String(i), weight: weightOf(s), ...(s.areaId && PARALLEL_GROUP[s.areaId] ? { group: PARALLEL_GROUP[s.areaId] } : {}) })), caps);
      seeds.forEach((_, i) => phases.set(i, result[String(i)]!));
    }
  }
  const activeWeight = (week: number): number => seeds.reduce((n, s, i) => (phases.get(i)!.fromWeek <= week && week <= phases.get(i)!.toWeek ? n + weightOf(s) : n), 0);
  const weekOfDate = (date: string): number => Math.floor(daysBetween(period.start, date) / 7) + 1;
  seeds.forEach((seed, i) => {
    const share = total > 0 && weightTotal > 0 ? weightOf(seed) / weightTotal : 1 / Math.max(1, seeds.length);
    const win = byAreas ? phases.get(i)! : undefined;
    const shareAt = byAreas
      ? (date: string): number => {
          const w = weekOfDate(date);
          const all = activeWeight(w);
          return win && w >= win.fromWeek && w <= win.toWeek && all > 0 ? weightOf(seed) / all : 0;
        }
      : undefined;
    // un subplan sin temas (solo entregable) no consume horas: se le da un mínimo simbólico para poder calcular
    const cap: Capacity = byAreas
      ? perDayMode
        ? { minutesPerDay: opts.minutesPerDay, studyDays: opts.studyDays, blockedDates: opts.blockedDates, pace: opts.pace, ...(opts.reservedMinutes ? { reservedMinutes: opts.reservedMinutes } : {}), shareAt }
        : { hoursPerWeek: Math.max(0.1, Number(opts.hoursPerWeek)), shareAt }
      : perDayMode
        ? {
            minutesPerDay: Math.max(0.5, opts.minutesPerDay! * share),
            studyDays: opts.studyDays,
            blockedDates: opts.blockedDates,
            pace: opts.pace,
            ...(opts.reservedMinutes ? { reservedMinutes: (d: string) => opts.reservedMinutes!(d) * share } : {}),
          }
        : { hoursPerWeek: Math.max(0.1, Number(opts.hoursPerWeek) * share) };
    const liveTopics = seed.topics.filter(isLive);
    const dist = distributeTopics({ ...cap, start: period.start, end: period.end, topics: liveTopics, from: opts.from, spread: opts.spread ?? perDayMode, ...(win ? { window: win } : {}) });
    // lo que el seed trae aparte del reparto (ruta y proyecto del tema) vuelve a su tema; los saltados se conservan con la semana del tema vivo anterior
    const extraOf = new Map(seed.topics.map((t) => [t.folder, t] as const));
    const withExtras = (t: PlannedTopic): PlannedTopic => {
      const x = extraOf.get(t.folder);
      return { ...t, ...(x?.route && x.route !== "skipped" ? { route: x.route } : {}), ...(x?.topicProject ? { topicProject: x.topicProject } : {}), ...(x?.addedFrom ? { addedFrom: x.addedFrom } : {}), ...(x?.revisionAddedAt ? { revisionAddedAt: x.revisionAddedAt } : {}) };
    };
    const plannedBy = new Map(dist.topics.map((t) => [t.folder, t] as const));
    let lastWeek = dist.topics[0]?.targetWeek ?? win?.fromWeek ?? 1;
    const allTopics: PlannedTopic[] = [];
    for (const st of seed.topics) {
      const planned = plannedBy.get(st.folder);
      if (planned) {
        lastWeek = planned.targetWeek;
        allTopics.push(withExtras(planned));
      } else if (!isLive(st)) {
        allTopics.push({ folder: st.folder, title: st.title, ...(st.skills?.length ? { skills: st.skills } : {}), targetWeek: lastWeek, estMinutes: st.estMinutes, ...(st.group ? { group: st.group } : {}), route: "skipped", ...(st.skippedReason ? { skippedReason: st.skippedReason } : {}), ...(st.topicProject ? { topicProject: st.topicProject } : {}), ...(st.addedFrom ? { addedFrom: st.addedFrom } : {}), ...(st.revisionAddedAt ? { revisionAddedAt: st.revisionAddedAt } : {}) });
      }
    }
    totalMinutes += dist.totalMinutes;
    availableMinutes += total > 0 ? dist.availableMinutes : 0;
    let id = seed.id && /^[A-Za-z0-9_-]{1,40}$/.test(seed.id) ? seed.id : `s${i + 1}-${slugOf(seed.area)}`;
    while (used.has(id)) id += "x";
    used.add(id);
    const deliverable = cleanDeliverable(seed.deliverable);
    const diag = new Set(seed.topics.filter((t) => t.diagnostic).map((t) => t.folder));
    subplans.push({
      id,
      area: oneLine(seed.area, 80) || "General",
      objective: oneLine(seed.objective, 200),
      ...(seed.goalId ? { goalId: seed.goalId } : {}),
      ...(seed.goalItemIds?.length ? { goalItemIds: seed.goalItemIds } : {}),
      topics: allTopics.map((t) => (diag.has(t.folder) ? { ...t, diagnostic: true } : t)),
      weeks: dist.weeks,
      requiredGoals: (seed.requiredGoals ?? []).map((g) => ({ goalId: g.goalId, ...(g.itemId ? { itemId: g.itemId } : {}), note: oneLine(g.note, 200) })),
      ...(deliverable ? { deliverable } : {}),
      ...(seed.notes ? { notes: oneLine(seed.notes, 400) } : {}),
      ...(seed.learningGuide ? { learningGuide: oneLine(seed.learningGuide, 1600) } : {}),
      ...(seed.areaId ? { areaId: seed.areaId } : {}),
      ...(seed.groups?.length ? { groups: seed.groups } : {}),
      ...(win ? { phase: win } : {}),
      ...(seed.fallback ? { fallback: seed.fallback } : {}),
    });
  });
  const fits = totalMinutes <= availableMinutes || total === 0;
  // horas por semana efectivas del periodo entero (media) y lo que haría falta si no cabe
  const dm = dayMinutesOf(perDayMode ? opts : { hoursPerWeek: opts.hoursPerWeek });
  const periodMinutes = eachDay(period.start, period.end).reduce((n, d) => n + dm(d), 0);
  const weeksCount = (daysBetween(period.start, period.end) + 1) / 7;
  const hoursPerWeek = r1(periodMinutes / 60 / weeksCount);
  const requiredHoursPerWeek = availableMinutes > 0 ? r1((totalMinutes / availableMinutes) * hoursPerWeek) : null;
  if (!fits) {
    warnings.push(
      `No cabe en el periodo: harían falta unas ${requiredHoursPerWeek ?? "?"} h/semana (tienes ${hoursPerWeek}) o quitar temas. Lo que sobra queda en la última semana de ${byAreas ? "cada área" : "cada subplan"}.`,
    );
  } else if (total > 0 && totalMinutes < availableMinutes * 0.4) {
    warnings.push(`Te sobra tiempo: a ${hoursPerWeek} h/semana solo usas ${Math.round((totalMinutes / availableMinutes) * 100)}% del periodo.`);
  }
  if (!subplans.length) warnings.push("El plan no tiene áreas.");
  const legacyMonth = opts.start === undefined && opts.month && MONTH_RE.test(opts.month) ? opts.month : undefined;
  return {
    plan: {
      id: opts.id && PLAN_ID_RE.test(opts.id) ? opts.id : legacyMonth ?? `${period.start}_${period.end}`,
      name: oneLine(opts.name, 80) || defaultPlanName(subplans, period.start, period.end),
      start: period.start,
      end: period.end,
      ...(legacyMonth ? { month: legacyMonth } : {}),
      createdAt: opts.createdAt ?? now,
      updatedAt: now,
      hoursPerWeek,
      ...(opts.preconditions ? { preconditions: opts.preconditions } : {}),
      ...(opts.auto ? { auto: true } : {}),
      ...(opts.rationale ? { rationale: oneLine(opts.rationale, 600) } : {}),
      ...(opts.programmingPractice ? { programmingPractice: opts.programmingPractice } : {}),
      ...(byAreas ? { structure: "areas" as const } : {}),
      ...(byAreas && opts.areaMode ? { areaMode: opts.areaMode, ...(opts.areaModeWhy ? { areaModeWhy: oneLine(opts.areaModeWhy, 300) } : {}), ...(opts.areaModeBy ? { areaModeBy: opts.areaModeBy } : {}) } : {}),
      subplans,
      ...(sanitizeOpenQuestions(opts.openQuestions, subplans).length ? { openQuestions: sanitizeOpenQuestions(opts.openQuestions, subplans) } : {}),
    },
    warnings,
    fits,
    totalMinutes,
    availableMinutes,
    requiredHoursPerWeek,
  };
}

/**
 * Fusiona lo aceptado en un plan del mismo periodo. Un subplan con el mismo área+objetivo SUSTITUYE al anterior
 * conservando lo que no se puede recalcular (`completedAt` por tema, estado/proyecto del entregable);
 * los demás subplanes se mantienen.
 */
export function mergePlans(existing: Plan | null, incoming: Plan, now: string = new Date().toISOString()): Plan {
  if (!existing) return incoming;
  // un plan por áreas sustituye a uno de estructura antigua del mismo periodo (los temas completados se conservan por carpeta)
  const restructure = incoming.structure === "areas" && existing.structure !== "areas";
  const doneByFolder = new Map(existing.subplans.flatMap((s) => s.topics.filter((t) => t.completedAt).map((t) => [t.folder, t.completedAt!] as const)));
  const byKey = new Map(restructure ? [] : existing.subplans.map((s) => [subplanKey(s), s]));
  const taken = new Set<string>();
  const merged: Subplan[] = [];
  const ids = new Set<string>();
  const remap = new Map<string, string>();
  for (const s of incoming.subplans) {
    const old = byKey.get(subplanKey(s));
    if (old) taken.add(subplanKey(old));
    const done = restructure ? doneByFolder : new Map((old?.topics ?? []).filter((t) => t.completedAt).map((t) => [t.folder, t.completedAt!]));
    let id = old?.id ?? s.id;
    while (ids.has(id)) id += "x";
    ids.add(id);
    remap.set(s.id, id);
    merged.push({
      ...s,
      id,
      topics: s.topics.map((t) => (done.has(t.folder) ? { ...t, completedAt: done.get(t.folder)! } : t)),
      ...(s.deliverable
        ? { deliverable: { ...s.deliverable, status: old?.deliverable?.status ?? s.deliverable.status, ...((old?.deliverable?.projectId ?? s.deliverable.projectId) ? { projectId: old?.deliverable?.projectId ?? s.deliverable.projectId } : {}) } }
        : {}),
    });
  }
  for (const s of restructure ? [] : existing.subplans) {
    if (taken.has(subplanKey(s))) continue;
    let id = s.id;
    while (ids.has(id)) id += "x";
    ids.add(id);
    merged.push({ ...s, id });
  }
  const { auto: _auto, openQuestions: _oq, programmingPractice: _pp, structure: _st, ...rest } = existing;
  const practice = incoming.programmingPractice ?? existing.programmingPractice;
  const questions = sanitizeOpenQuestions(
    [...(incoming.openQuestions ?? []).map((q) => ({ ...q, subplanId: remap.get(String(q.subplanId)) ?? q.subplanId })), ...(existing.openQuestions ?? [])],
    merged,
  );
  return {
    ...rest,
    ...((incoming.structure ?? existing.structure) ? { structure: (incoming.structure ?? existing.structure)! } : {}),
    ...(practice ? { programmingPractice: practice } : {}),
    ...(questions.length ? { openQuestions: questions } : {}),
    hoursPerWeek: incoming.hoursPerWeek ?? existing.hoursPerWeek,
    ...((incoming.preconditions ?? existing.preconditions) ? { preconditions: incoming.preconditions ?? existing.preconditions } : {}),
    ...(incoming.areaMode ? { areaMode: incoming.areaMode, ...(incoming.areaModeWhy ? { areaModeWhy: incoming.areaModeWhy } : {}), ...(incoming.areaModeBy ? { areaModeBy: incoming.areaModeBy } : {}) } : {}),
    ...(incoming.auto ? { auto: true } : {}),
    updatedAt: now,
    subplans: merged,
  };
}

// ── Estado en vivo y registro de temas completados ───────────────────────

export interface TopicView extends PlannedTopic {
  state: TopicState;
  /** 0..100 */
  pct: number;
  found: boolean;
  lastAttemptAt?: string | null;
  /** ejercicios que el tema ya tiene en la vault (la práctica del plan los prioriza) */
  exercises?: number;
}

export interface SubplanView {
  id: string;
  topics: TopicView[];
  total: number;
  done: number;
  /** % medio de los temas, 0..100 */
  pct: number;
  /** semana (1..) del plan a la que apunta `today`, acotada al rango del plan */
  currentWeek: number;
}

export interface PlanSummary {
  /** ¿hay entregables DEFINIDOS? Mientras no, la UI los muestra «por definir» (ver `deliverablesDefined` en lib/planTopicsByArea.ts) */
  deliverablesDefined?: boolean;
  subplans: number;
  topics: number;
  done: number;
  pct: number;
  currentWeek: number;
  weeks: number;
}

export interface PlanDerived {
  subplans: SubplanView[];
  summary: PlanSummary;
}

export function deriveView(plan: Plan, lookup: TopicLiteLookup, today: string): PlanDerived {
  const weeks = weekRangesOf(plan.start, plan.end).length;
  const cur = Math.min(weeks, Math.max(1, weekIndex(today, plan.start, plan.end) || 1));
  const subplans: SubplanView[] = plan.subplans.map((s) => {
    const topics: TopicView[] = s.topics.map((t) => {
      const snap = lookup(t.folder) ?? null;
      const state = topicState(snap);
      const pct = snap ? Math.max(0, Math.min(100, Math.round(snap.progress.completenessPct))) : 0;
      return { ...t, state, pct: state === "completo" ? 100 : pct, found: !!snap, lastAttemptAt: snap?.lastAttemptAt ?? null, ...(snap?.exerciseCount ? { exercises: snap.exerciseCount } : {}) };
    });
    // los temas fuera de ruta se muestran pero no cuentan en el avance
    const counted = topics.filter(isLive);
    const done = counted.filter((t) => t.state === "completo" || !!t.completedAt).length;
    const pct = counted.length ? Math.round(counted.reduce((n, t) => n + (t.completedAt && t.state !== "completo" ? Math.max(t.pct, 100) : t.pct), 0) / counted.length) : 0;
    return { id: s.id, topics, total: counted.length, done, pct, currentWeek: cur };
  });
  const total = subplans.reduce((n, s) => n + s.total, 0);
  const done = subplans.reduce((n, s) => n + s.done, 0);
  const pct = total ? Math.round(subplans.reduce((n, s) => n + s.pct * s.total, 0) / total) : 0;
  return { subplans, summary: { subplans: subplans.length, topics: total, done, pct, currentWeek: cur, weeks, deliverablesDefined: deliverablesDefined(plan) } };
}

/**
 * Registro de temas completados: anota `completedAt` (fecha local) la PRIMERA vez que un tema del plan
 * se observa completo. No pisa fechas ya registradas ni las borra si luego baja el avance.
 */
export function refreshPlanProgress(
  plan: Plan,
  lookup: TopicLiteLookup,
  todayIso: string,
): { plan: Plan; changed: boolean; completed: string[] } {
  let changed = false;
  const completed: string[] = [];
  const subplans = plan.subplans.map((s) => ({
    ...s,
    topics: s.topics.map((t) => {
      if (t.completedAt) return t;
      if (topicState(lookup(t.folder) ?? null) !== "completo") return t;
      changed = true;
      completed.push(t.folder);
      return { ...t, completedAt: todayIso };
    }),
  }));
  return { plan: changed ? { ...plan, updatedAt: new Date().toISOString(), subplans } : plan, changed, completed };
}

/**
 * Pone (o recalibra) el `topicProject` de cada tema vivo y pendiente del plan, calibrado con el nivel declarado de su materia y lo MEDIDO
 * (`lookup`: progreso e intentos reales del vault). `overrides` = propuestas de la IA por carpeta: se recortan al nivel permitido. Puro; los
 * temas fuera de ruta o completados quedan sin proyecto. Devuelve el mismo plan si no hay nada que cambiar.
 */
export function withTopicProjects(plan: Plan, lookup: MasteryLookup, overrides?: ReadonlyMap<string, { title?: unknown; description?: unknown; level?: unknown }>): Plan {
  const declaredOf = (folder: string) => plan.preconditions?.levels[areaOfFolder(folder)];
  let changed = false;
  const subplans = plan.subplans.map((s) => {
    const projects = projectsForSubplan(s, declaredOf, lookup, overrides);
    return {
      ...s,
      topics: s.topics.map((t) => {
        const p = projects.get(t.folder);
        if (p) {
          if (JSON.stringify(t.topicProject) !== JSON.stringify(p)) changed = true;
          return { ...t, topicProject: p };
        }
        if (t.topicProject && (t.completedAt || !isLive(t))) {
          changed = true;
          const { topicProject: _tp, ...rest } = t;
          return rest;
        }
        return t;
      }),
    };
  });
  return changed ? { ...plan, updatedAt: new Date().toISOString(), subplans } : plan;
}

// ── Del plan al plan diario ──────────────────────────────────────────────

export interface PlanItem {
  kind: "topic" | "deliverable" | "project";
  /** id del plan del que viene (varios planes pueden estar activos a la vez) */
  planId: string;
  subplanId: string;
  /** texto corto del subplan, para el chip "Plan: …" */
  label: string;
  area: string;
  title: string;
  folder?: string;
  skills?: string[];
  estMinutes: number;
  targetWeek: number;
  /** la semana objetivo ya pasó */
  overdue: boolean;
  /** el reparto DIARIO del plan lo coloca en este día (agenda del plan) */
  scheduledToday?: boolean;
  /** minutos que el reparto diario le da HOY (un tema puede abarcar varios días) */
  todayMinutes?: number;
  /** agenda por enfoque: el tema de hoy es de teoría o de práctica (o de ambas) y el enfoque del día */
  role?: "theory" | "practice" | "both";
  focus?: string;
  /** proyecto diario: título del proyecto y temas del día a los que se conecta */
  connected?: string[];
}

export const DELIVERABLE_MINUTES = 45;

export function subplanLabel(s: Pick<Subplan, "area" | "objective"> & { areaId?: string }): string {
  // en un plan por áreas el área ya es el nombre corto: sin objetivo pegado ni truncado
  if (s.areaId) return s.area;
  const o = s.objective.trim();
  const base = o && fold(o) !== fold(s.area) ? `${s.area}: ${o}` : s.area;
  return base.length > 64 ? `${base.slice(0, 63).trim()}…` : base;
}

/**
 * Lo que los planes activos dicen que toca el día `date`: los temas aún sin completar cuya semana objetivo
 * es esta semana o una anterior (atrasados primero), y el entregable en la última semana (o cuando ya no
 * quedan temas) si no está hecho. Con planes solapados se combinan sin repetir un mismo tema.
 * `isDone` permite descartar temas ya completos en vivo. `byProgress` (cuando `date` es HOY) usa el reparto por avance: lo que toca hoy es
 * lo primero que falta de la ruta de cada área (el mismo que enseñan la Agenda y la Ejecución).
 */
export function planItemsFor(date: string, plans: readonly Plan[], isDone?: (folder: string) => boolean, byProgress = false): PlanItem[] {
  const out: PlanItem[] = [];
  const seenTopics = new Set<string>();
  const ordered = [...plans].sort((a, b) => a.start.localeCompare(b.start) || a.createdAt.localeCompare(b.createdAt));
  for (const plan of ordered) {
    if (plan.archived || plan.proposed || date < plan.start || date > plan.end) continue;
    const weeks = weekRangesOf(plan.start, plan.end).length;
    const cur = weekIndex(date, plan.start, plan.end);
    if (cur < 1) continue;
    // el reparto por días: lo que la agenda coloca hoy (con sus minutos) pasa por delante de lo demás de la semana
    let todayOf = new Map<string, number>();
    const roleOf = new Map<string, "theory" | "practice" | "both">();
    let focusToday = "";
    let dailyToday: { title: string; minutes: number; topics: string[] } | null = null;
    // temas extra de hoy que no son de la ruta (de la vault): los añade el estudiante a mano y también se asignan
    const vaultExtras: Array<{ folder: string; title: string; minutes: number; subplanId: string; area: string }> = [];
    try {
      const sch = buildSchedule(byProgress ? progressPlan(plan, { today: date, ...(isDone ? { isDone } : {}) }) : plan);
      const day = sch.byDate.get(date);
      for (const b of day?.blocks ?? []) for (const it of b.items) roleOf.set(it.folder, roleOf.has(it.folder) && roleOf.get(it.folder) !== b.kind ? "both" : b.kind);
      focusToday = day?.focus?.label ?? "";
      const dp = day && sch.mode === "focus" ? dailyProjectOf(plan, sch, day) : null;
      if (dp) dailyToday = { title: dp.title, minutes: dp.minutes, topics: dp.topics.map((t) => t.title) };
      const inPlan = new Set(plan.subplans.flatMap((x) => x.topics.map((t) => t.folder)));
      const seenExtra = new Set<string>();
      for (const t of day?.topics ?? []) {
        if (!t.extra || t.done || inPlan.has(t.folder) || seenExtra.has(t.folder)) continue;
        seenExtra.add(t.folder);
        vaultExtras.push({ folder: t.folder, title: t.title, minutes: t.minutes, subplanId: t.subplanId, area: t.area });
      }
      todayOf = new Map(
        [...new Set((day?.topics ?? []).filter((t) => !t.done).map((t) => t.folder))].map((f) => [f, (day?.topics ?? []).filter((t) => t.folder === f && !t.done).reduce((n, t) => n + t.minutes, 0)] as const),
      );
    } catch {
      /* sin agenda: solo la semana */
    }
    // sin haber empezado la ruta nada está atrasado (misma regla que `areaSets`): el número de semana es fijo, el avance no. Con el reparto por avance
    // (`byProgress`) lo pendiente nunca queda «atrasado» por pasar los días: la ruta manda y el aviso de constancia dice el ritmo que hace falta
    const started = plan.subplans.some((x) => x.topics.some((t) => !!t.completedAt || isDone?.(t.folder)));
    for (const s of plan.subplans) {
      const label = subplanLabel(s);
      let pending = 0;
      for (const t of s.topics) {
        if (t.completedAt || isDone?.(t.folder) || !isLive(t)) continue;
        pending++;
        // un tema que el estudiante adelantó a hoy (extra) o que el ritmo diario coloca hoy cuenta aunque su semana objetivo sea posterior
        if (t.targetWeek > cur && !todayOf.has(t.folder)) continue;
        if (seenTopics.has(t.folder)) continue;
        seenTopics.add(t.folder);
        out.push({
          kind: "topic",
          planId: plan.id,
          subplanId: s.id,
          label,
          area: s.area,
          title: t.title,
          folder: t.folder,
          ...(t.skills?.length ? { skills: t.skills } : {}),
          estMinutes: t.estMinutes,
          targetWeek: t.targetWeek,
          overdue: !byProgress && started && t.targetWeek < cur,
          ...(todayOf.has(t.folder) ? { scheduledToday: true, todayMinutes: todayOf.get(t.folder)! } : {}),
          ...(roleOf.has(t.folder) ? { role: roleOf.get(t.folder)! } : {}),
          ...(focusToday && todayOf.has(t.folder) ? { focus: focusToday } : {}),
        });
      }
      const d = s.deliverable;
      if (d && d.status !== "hecho" && (cur >= weeks || (pending === 0 && s.topics.length > 0))) {
        out.push({ kind: "deliverable", planId: plan.id, subplanId: s.id, label, area: s.area, title: d.title, estMinutes: DELIVERABLE_MINUTES, targetWeek: weeks, overdue: false });
      }
    }
    for (const x of vaultExtras) {
      if (seenTopics.has(x.folder)) continue;
      seenTopics.add(x.folder);
      const own = plan.subplans.find((sp) => sp.id === x.subplanId);
      out.push({ kind: "topic", planId: plan.id, subplanId: x.subplanId, label: own ? subplanLabel(own) : x.area, area: x.area, title: x.title, folder: x.folder, estMinutes: x.minutes, targetWeek: cur, overdue: false, scheduledToday: true, todayMinutes: x.minutes });
    }
    if (dailyToday) out.push({ kind: "project", planId: plan.id, subplanId: plan.subplans[0]?.id ?? "", label: plan.name ?? plan.id, area: focusToday || "Plan", title: dailyToday.title, estMinutes: dailyToday.minutes, targetWeek: cur, overdue: false, scheduledToday: true, todayMinutes: dailyToday.minutes, connected: dailyToday.topics, ...(focusToday ? { focus: focusToday } : {}) });
  }
  // atrasados primero, luego por semana objetivo y, dentro de una misma semana, lo que la agenda coloca HOY por delante
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.targetWeek - b.targetWeek || Number(!!b.scheduledToday) - Number(!!a.scheduledToday));
}

// ── Persistencia ─────────────────────────────────────────────────────────

function cleanTopic(raw: any): PlannedTopic | null {
  const folder = String(raw?.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder) return null;
  const skills = Array.isArray(raw.skills) ? [...new Set(raw.skills.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean))] as string[] : [];
  const t: PlannedTopic = {
    folder,
    title: oneLine(raw.title, 160) || folder.split("/").pop()!,
    targetWeek: Math.max(1, Math.round(Number(raw.targetWeek) || 1)),
    estMinutes: Math.max(0, Math.round(Number(raw.estMinutes) || 0)),
  };
  if (skills.length) t.skills = skills;
  if (DATE_RE.test(String(raw.completedAt ?? ""))) t.completedAt = String(raw.completedAt);
  if (raw.diagnostic === true) t.diagnostic = true;
  if (raw.pinned === true) t.pinned = true;
  const group = oneLine(raw.group, 40);
  if (group) t.group = group;
  Object.assign(t, sanitizeRouteFields(raw));
  const tp = sanitizeTopicProject(raw.topicProject);
  if (tp) t.topicProject = tp;
  if (raw.addedFrom === "curriculum") t.addedFrom = "curriculum";
  if (DATE_RE.test(String(raw.revisionAddedAt ?? ""))) t.revisionAddedAt = String(raw.revisionAddedAt);
  const topicId = oneLine(raw.topicId, 120);
  if (topicId) t.topicId = topicId;
  return t;
}

/**
 * Normaliza un plan leído de disco; null si no es utilizable. Acepta el formato de periodo (`start`/`end`) y
 * el mensual heredado (`month`: el periodo es el mes entero y el id es el mes). `fileId` = nombre del archivo.
 */
export function sanitizePlan(raw: any, fileId?: string): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  let start: string;
  let end: string;
  if (isDate(raw.start) && isDate(raw.end) && raw.end >= raw.start && daysBetween(raw.start, raw.end) + 1 <= MAX_PERIOD_DAYS) {
    start = raw.start;
    end = raw.end;
  } else if (MONTH_RE.test(String(raw.month ?? ""))) {
    ({ start, end } = monthBounds(String(raw.month)));
  } else return null;
  const bounds = MONTH_RE.test(String(raw.month ?? "")) ? monthBounds(String(raw.month)) : null;
  const month = bounds && bounds.start === start && bounds.end === end ? String(raw.month) : undefined;
  const idCandidates = [fileId, raw.id].map((v) => String(v ?? "")).filter((v) => PLAN_ID_RE.test(v));
  const id = idCandidates[0] ?? month ?? `${start}_${end}`;

  const ranges = weekRangesOf(start, end);
  const subplans: Subplan[] = [];
  const ids = new Set<string>();
  for (const [i, s] of (Array.isArray(raw.subplans) ? raw.subplans : []).entries()) {
    if (!s || typeof s !== "object") continue;
    let sid = /^[A-Za-z0-9_-]{1,40}$/.test(String(s.id ?? "")) ? String(s.id) : `s${i + 1}`;
    while (ids.has(sid)) sid += "x";
    ids.add(sid);
    const topics: PlannedTopic[] = (Array.isArray(s.topics) ? s.topics : []).map(cleanTopic).filter((t: PlannedTopic | null): t is PlannedTopic => t !== null);
    const weeks: WeekSlice[] = ranges.map((r) => {
      const inWeek = topics.filter((t) => isLive(t) && Math.min(ranges.length, t.targetWeek) === r.week);
      const saved = (Array.isArray(s.weeks) ? s.weeks : []).find((w: any) => Number(w?.week) === r.week);
      return {
        week: r.week,
        start: r.start,
        end: r.end,
        topics: inWeek.map((t) => t.folder),
        minutes: inWeek.reduce((n, t) => n + t.estMinutes, 0),
        capacityMinutes: Math.max(0, Math.round(Number(saved?.capacityMinutes) || 0)),
      };
    });
    const deliverable = s.deliverable && typeof s.deliverable === "object" ? cleanDeliverable(s.deliverable) : undefined;
    subplans.push({
      id: sid,
      area: oneLine(s.area, 80) || "General",
      objective: oneLine(s.objective, 200),
      ...(s.goalId ? { goalId: String(s.goalId) } : {}),
      ...(Array.isArray(s.goalItemIds) && s.goalItemIds.length ? { goalItemIds: s.goalItemIds.map(String) } : {}),
      topics: topics.map((t) => ({ ...t, targetWeek: Math.min(ranges.length, t.targetWeek) })),
      weeks,
      requiredGoals: (Array.isArray(s.requiredGoals) ? s.requiredGoals : [])
        .filter((g: any) => g && g.goalId)
        .map((g: any) => ({ goalId: String(g.goalId), ...(g.itemId ? { itemId: String(g.itemId) } : {}), note: oneLine(g.note, 200) })),
      ...(deliverable ? { deliverable } : {}),
      ...(s.notes ? { notes: oneLine(s.notes, 400) } : {}),
      ...(s.learningGuide ? { learningGuide: oneLine(s.learningGuide, 1600) } : {}),
      ...(oneLine(s.areaId, 40) ? { areaId: oneLine(s.areaId, 40) } : {}),
      ...(sanitizeGroups(s.groups).length ? { groups: sanitizeGroups(s.groups) } : {}),
      ...(sanitizePhase(s.phase, ranges.length) ? { phase: sanitizePhase(s.phase, ranges.length)! } : {}),
      ...(s.fallback && (s.fallback.kind === "rules" || s.fallback.kind === "mixed") ? { fallback: { kind: s.fallback.kind as "rules" | "mixed", reason: oneLine(s.fallback.reason, 240) } } : {}),
    });
  }
  const hours = Number(raw.hoursPerWeek);
  const practice = sanitizePracticeTrack(raw.programmingPractice, start, end);
  const questions = sanitizeOpenQuestions(raw.openQuestions, subplans);
  const curriculum = sanitizeCurriculum(raw.practiceCurriculum, scopeOfPlan({ start, end, subplans }));
  const pre = raw.preconditions && typeof raw.preconditions === "object" ? sanitizePreconditions({ ...raw.preconditions, start, end }, start) : undefined;
  const subIds = new Set(subplans.map((s) => s.id));
  const pace0 = sanitizePace(raw.pace);
  const paceAreas = pace0?.areas ? Object.fromEntries(Object.entries(pace0.areas).filter(([id]) => subIds.has(id))) : undefined;
  const { areas: _a, ...paceGlobal } = pace0 ?? {};
  const pace = pace0 && (paceGlobal.perDay || paceGlobal.minPerDay || (paceAreas && Object.keys(paceAreas).length)) ? { ...paceGlobal, ...(paceAreas && Object.keys(paceAreas).length ? { areas: paceAreas } : {}) } : undefined;
  const extraTopics = sanitizeExtraTopics(raw.extraTopics).filter((e) => e.date >= start && e.date <= end);
  const extraPractice = sanitizeExtraPractice(raw.extraPractice).filter((e) => e.date >= start && e.date <= end);
  return {
    id,
    start,
    end,
    ...(month ? { month } : {}),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    ...(hours > 0 ? { hoursPerWeek: hours } : {}),
    ...(pre ? { preconditions: pre } : {}),
    ...(oneLine(raw.name, 80) ? { name: oneLine(raw.name, 80) } : {}),
    ...(raw.archived === true ? { archived: true } : {}),
    ...(raw.proposed === true ? { proposed: true } : {}),
    ...(raw.auto === true ? { auto: true } : {}),
    ...(raw.rationale ? { rationale: oneLine(raw.rationale, 600) } : {}),
    ...(practice ? { programmingPractice: practice } : {}),
    ...(questions.length ? { openQuestions: questions } : {}),
    ...(raw.structure === "areas" ? { structure: "areas" as const } : {}),
    ...(raw.structure === "areas" && (raw.areaMode === "together" || raw.areaMode === "phased")
      ? { areaMode: raw.areaMode as "together" | "phased", ...(oneLine(raw.areaModeWhy, 300) ? { areaModeWhy: oneLine(raw.areaModeWhy, 300) } : {}), ...(["user", "ai", "rules"].includes(String(raw.areaModeBy)) ? { areaModeBy: raw.areaModeBy as AreaModeSource } : {}) }
      : {}),
    ...(sanitizePlanDeliverables(raw.deliverables).length ? { deliverables: sanitizePlanDeliverables(raw.deliverables) } : {}),
    ...(sanitizePurposes(raw.purposes) ? { purposes: sanitizePurposes(raw.purposes)! } : {}),
    ...(sanitizeCoverageReview(raw.coverageReview, subplans.map(areaKeyOf)) ? { coverageReview: sanitizeCoverageReview(raw.coverageReview, subplans.map(areaKeyOf))! } : {}),
    ...(curriculum ? { practiceCurriculum: curriculum } : {}),
    ...(pace ? { pace } : {}),
    ...(extraTopics.length ? { extraTopics } : {}),
    ...(extraPractice.length ? { extraPractice } : {}),
    ...(typeof raw.deliverablesDefinedAt === "string" && !Number.isNaN(Date.parse(raw.deliverablesDefinedAt)) ? { deliverablesDefinedAt: raw.deliverablesDefinedAt.slice(0, 40) } : {}),
    subplans,
  };
}

/** Un archivo por plan en `.notevault/mentor/plans/<id>.json` (los mensuales heredados: `<AAAA-MM>.json`). */
export class PlanStore {
  readonly vaultRoot: string;
  readonly dir: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.dir = path.join(this.vaultRoot, LAYOUT.mentor_plans_dir);
  }

  private _path(id: string): string {
    return path.join(this.vaultRoot, formatLayout(LAYOUT.mentor_plan, { id }));
  }

  load(id: string): Plan | null {
    if (!PLAN_ID_RE.test(id)) return null;
    return sanitizePlan(store.loadJson(this._path(id)), id);
  }

  save(plan: Plan): Plan {
    const clean = sanitizePlan(plan, plan.id);
    if (!clean) throw new Error("Plan inválido: falta el periodo (inicio y fin AAAA-MM-DD).");
    store.writeJson(this._path(clean.id), clean);
    return clean;
  }

  /** Ids de los planes guardados (nombre de archivo sin `.json`), orden alfabético. */
  ids(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => !isSyncConflict(f) && f.endsWith(".json") && PLAN_ID_RE.test(f.slice(0, -5)))
      .map((f) => f.slice(0, -5))
      .sort();
  }

  /** Manda el archivo del plan a la papelera de la vault (`mentor-plans`); false si no existía. */
  trash(id: string): boolean {
    if (!PLAN_ID_RE.test(id)) return false;
    return store.toTrash(this.vaultRoot, this._path(id), "mentor-plans") !== null;
  }

  /** Todos los planes legibles, por fecha de inicio (y de creación). */
  list(): Plan[] {
    return this.ids()
      .map((id) => this.load(id))
      .filter((p): p is Plan => p !== null)
      .sort((a, b) => a.start.localeCompare(b.start) || a.createdAt.localeCompare(b.createdAt));
  }

  /** Meses con plan mensual heredado, el más reciente primero. */
  months(): string[] {
    return this.ids().filter((id) => MONTH_RE.test(id) && this.load(id)).sort().reverse();
  }
}
