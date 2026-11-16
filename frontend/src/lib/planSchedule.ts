// Agenda del Plan del Mentor: ASIGNACIÓN DIARIA determinista (qué temas, práctica y entregables tocan cada día) y resúmenes por
// semana y por mes, con textos de propósito generados por plantillas.
//
// Módulo PURO y compartido (núcleo, API y renderer): sin node:* ni DOM. Parte de lo que el plan ya guarda (temas con su semana
// objetivo `targetWeek` y su secuencia dentro del área, las precondiciones y la pista de práctica) y no escribe nada: el reparto
// por días se RECALCULA siempre igual (misma entrada → misma salida), así que nunca se queda desfasado respecto al plan.
//
// Algoritmo (por semana, en orden):
//  1. Capacidad de cada día = tiempo diario × ritmo (0 en días sin estudio o bloqueados) − minutos de práctica de ese día.
//  2. Cada área (subplan) tiene en la semana una cola de temas: primero los FIJADOS (`pinned`) de esa semana, luego lo que se arrastra
//     de semanas anteriores y luego los demás temas con esa `targetWeek`, en el orden del área (grupos incluidos).
//  3. La capacidad de la semana se reparte entre las áreas con demanda en proporción a su demanda; con holgura el reparto es parejo
//     por días (nivelado), con sobrecarga cada día se llena entero y lo que no cabe se arrastra a la semana siguiente.
//  4. Un tema que supera los minutos de un día ocupa varios (partes 1/n, 2/n…); nunca se coloca antes de su semana objetivo.
//  5. En la última semana, lo que no cabe se amontona en el último día de estudio (marcado como desbordado).
//  Los temas ya completados (`completedAt`) se anotan en el día en que se completaron y no consumen capacidad.
//
// REPARTO POR AVANCE (`asOf`, ver `progressPlan`): cuando el plan lleva una fecha «hoy», los días anteriores NO reparten trabajo pendiente: lo que
// falta se coloca desde hoy hacia delante, SIEMPRE en el orden de la ruta de cada área (nunca un tema posterior antes de uno anterior sin
// terminar) y con las mismas reglas de capacidad. Lo hecho se queda donde se hizo; lo pendiente nunca queda «atrasado» por haber pasado los días:
// se recalcula en cada carga a partir del avance real, sin IA y sin que nadie lo ejecute. Si lo que falta no cabe antes de la fecha de fin, se
// mantiene el orden, se reparte hasta donde llega la capacidad y el resto se amontona en el último día (desbordado); el aviso de constancia
// (`planCatchUp`) dice el ritmo que hace falta.
//
// Planes POR ÁREAS (`structure: "areas"`): el reparto es POR ENFOQUE (ver `planDayFocus.ts`): cada día tiene un enfoque (Backend…) y sus
// bloques obligatorios de teoría y práctica (Backend = teoría de backend + práctica de Python + teoría y práctica de bases de datos el MISMO
// día), los fundamentos se intercalan como lógica aplicada (no se adelantan) y cada día lleva su proyecto diario. Los planes antiguos
// conservan el algoritmo de arriba.

import { addDays, daysBetween, eachDay, isoDow, weekRangesOf } from "./planTime.js";
import { type AreaGroup, type PlanDeliverable, type PlanDeliverableStatus, type PlanPurposes } from "./planAreas.js";
import { FOCUS_LABEL, PHASE_LABEL, PRACTICE_PHASES, practiceDayMinutes, weekTitle, type PhaseStatus, type PracticePhase, type PracticeTrack } from "./practiceTrack.js";
import { buildFocusSchedule, type BlockKind, type DayBlock, type DayFocus } from "./planDayFocus.js";
import { isLive } from "./planRoute.js";
import { topicProjectId, type TopicProject } from "./planTopicProject.js";
import { dailyId, dailyProjectOf, shortOf, weeklyProjectOf, type PracticeCurriculum } from "./planCurriculum.js";
import { chainIndex, planChain, type ChainSignals } from "./planChain.js";
import type { DailyPace, ExtraPractice, ExtraTopic } from "./planPace.js";
import { applyOverlay, planOverlay, planWithoutExtraRoute, validAsOf } from "./planPaceSchedule.js";

// ── Entrada estructural (la cumplen `Plan` del núcleo y `MentorPlan` del renderer) ──

export interface ScheduleTopic {
  folder: string;
  title: string;
  estMinutes: number;
  targetWeek: number;
  completedAt?: string;
  revisionAddedAt?: string;
  pinned?: boolean;
  group?: string;
  /** ruta: `skipped` queda fuera del reparto y de las cuentas (ver `planRoute.ts`) */
  route?: string;
  /** proyecto de aplicación tras el tema (ver `planTopicProject.ts`) */
  topicProject?: TopicProject;
}

export interface ScheduleSubplan {
  id: string;
  area: string;
  areaId?: string;
  objective: string;
  topics: ScheduleTopic[];
  groups?: AreaGroup[];
  phase?: { fromWeek: number; toWeek: number };
  deliverable?: { title: string; description: string; criteria: string[]; status: "idea" | "en_curso" | "hecho" };
}

export interface SchedulePlan {
  id: string;
  start: string;
  end: string;
  hoursPerWeek?: number;
  preconditions?: {
    minutesPerDay: number;
    studyDays: number[];
    blockedDates?: string[];
    pace: "suave" | "normal" | "intenso";
    /** lo que eligió el estudiante al crear el plan (el modo ya decidido está en `areaMode` del plan) */
    areaMode?: "together" | "phased" | "ai";
    /** lenguajes con práctica diaria propia (rotación por peso) */
    languages?: ReadonlyArray<{ id: string; weight?: number; required?: boolean; why?: string }>;
  };
  /** cómo se combinan las áreas, ya decidido (ausente = por fases como siempre) */
  areaMode?: "together" | "phased";
  programmingPractice?: PracticeTrack;
  subplans: ScheduleSubplan[];
  deliverables?: PlanDeliverable[];
  purposes?: PlanPurposes;
  /** «areas» = plan por áreas: agenda por enfoque */
  structure?: "areas";
  /** currículo de práctica del plan generado por la IA (opcional); ver `planCurriculum.ts` */
  practiceCurriculum?: PracticeCurriculum;
  /** «hoy» del reparto por avance: lo pendiente se coloca desde esta fecha (ver `progressPlan`); ausente = reparto por calendario */
  asOf?: string;
  /** ritmo diario manual (temas por día y mínimo, global y por área); ausente = reparto automático por minutos (ver `planPace.ts`) */
  pace?: DailyPace;
  /** temas añadidos a mano a un día (de la ruta, más adelante, o de la vault) y práctica extra del día */
  extraTopics?: ExtraTopic[];
  extraPractice?: ExtraPractice[];
}

/**
 * El plan listo para el reparto POR AVANCE: fija «hoy» y da por completos los temas que `isDone` dice que lo están (avance real de la práctica)
 * aunque aún no tengan `completedAt` (se anotan hoy). Puro; devuelve el mismo plan si no hay nada que cambiar.
 */
export function progressPlan<P extends SchedulePlan>(plan: P, o: { today: string; isDone?: (folder: string) => boolean }): P {
  let changed = false;
  const subplans = plan.subplans.map((s) => ({
    ...s,
    topics: s.topics.map((t) => {
      if (t.completedAt || !o.isDone?.(t.folder)) return t;
      changed = true;
      return { ...t, completedAt: o.today };
    }),
  }));
  // los temas extra de la vault (fuera del plan) se dan por hechos con el avance real, igual que los de la ruta
  const extraDone = plan.extraTopics?.some((e) => !e.doneAt && o.isDone?.(e.folder)) ?? false;
  if (extraDone) changed = true;
  const extraTopics = extraDone ? plan.extraTopics!.map((e) => (!e.doneAt && o.isDone?.(e.folder) ? { ...e, doneAt: o.today } : e)) : undefined;
  if (plan.asOf === o.today && !changed) return plan;
  return { ...plan, asOf: o.today, ...(changed ? { subplans } : {}), ...(extraTopics ? { extraTopics } : {}) };
}

// ── Salida ──────────────────────────────────────────────────────────────

export interface DayTopic {
  subplanId: string;
  areaId?: string;
  area: string;
  folder: string;
  title: string;
  /** minutos de este tema en ESTE día */
  minutes: number;
  group?: string;
  groupTitle?: string;
  /** parte del tema (1..parts) cuando abarca varios días */
  part: number;
  parts: number;
  /** posición del tema en la ruta del área (1..total) */
  position: number;
  total: number;
  /** ya completado (se anota el día en que se completó) */
  done: boolean;
  /** no cupo en la capacidad y se amontonó al final del plan */
  overflow?: boolean;
  /** agenda por enfoque: bloque principal en que se trabaja y su papel (teoría o práctica) */
  blockId?: string;
  role?: BlockKind;
  /** fundamento intercalado como lógica aplicada al lenguaje */
  applied?: boolean;
  /** el estudiante lo añadió a mano a este día (tema extra) */
  extra?: boolean;
  /** lo colocó el ritmo diario manual (temas por día), no el reparto por minutos */
  paced?: boolean;
}

/** El proyecto de aplicación de un tema, colocado el día en que se completa el tema. */
export interface DayTopicProject {
  id: string;
  subplanId: string;
  areaId?: string;
  area: string;
  folder: string;
  title: string;
  project: TopicProject;
  /** minutos de ese día para el proyecto (de los del proyecto diario) */
  minutes: number;
}

export interface DayPractice {
  /** práctica añadida a mano a este día (con minutos ya resueltos) */
  extra?: Array<ExtraPractice & { minutes: number }>;
  kata?: { minutes: number };
  project?: { minutes: number; phases: PracticePhase[]; week: number; focus: string; theme?: string };
}

export interface ScheduleDay {
  date: string;
  /** semana del plan (1..) */
  week: number;
  /** día ISO 1..7 */
  dow: number;
  /** día de estudio no bloqueado */
  study: boolean;
  blocked: boolean;
  capacityMinutes: number;
  topicMinutes: number;
  practiceMinutes: number;
  topics: DayTopic[];
  practice: DayPractice;
  /** agenda por enfoque (planes por áreas): enfoque del día, bloques obligatorios y minutos del proyecto diario y del repaso */
  focus?: DayFocus;
  blocks?: DayBlock[];
  projectMinutes?: number;
  reviewMinutes?: number;
  /** minutos del bloque diario de práctica de lenguaje */
  languageMinutes?: number;
  /** proyectos de aplicación de los temas que se completan ese día */
  topicProjects?: DayTopicProject[];
  /** el día lleva temas del ritmo manual: su capacidad sigue a esos temas */
  paced?: boolean;
}

/** El modo de áreas ya decidido de un plan: `together` solo si el plan es por áreas y lo declara (o lo eligió el estudiante); si no, por fases. */
export function effectiveAreaMode(plan: Pick<SchedulePlan, "areaMode" | "preconditions" | "structure">): "together" | "phased" {
  if (plan.structure !== "areas") return "phased";
  return plan.areaMode ?? (plan.preconditions?.areaMode === "together" ? "together" : "phased");
}

export interface PlanSchedule {
  start: string;
  end: string;
  weeks: number;
  days: ScheduleDay[];
  byDate: Map<string, ScheduleDay>;
  /** «focus» = agenda por enfoque (plan por áreas); «legacy» = reparto por áreas en paralelo */
  mode?: "focus" | "legacy";
}

const MIN_CHUNK = 10;
/** con holgura, cada área reparte sus temas de forma pareja por días, pero nunca con trozos por debajo de esto (min) */
const LEVEL_FLOOR = 45;
const r0 = (n: number): number => Math.round(n);

interface Seg {
  sub: ScheduleSubplan;
  topic: ScheduleTopic;
  order: number;
  remaining: number;
  chunks: Array<{ date: string; minutes: number; overflow?: boolean }>;
}

/** Capacidad base de cada día (sin práctica): tiempo diario × ritmo en días de estudio no bloqueados. */
function baseCapacity(plan: SchedulePlan): (date: string) => number {
  const pre = plan.preconditions;
  if (!pre) {
    const perDay = ((plan.hoursPerWeek ?? 10) * 60) / 7;
    return () => perDay;
  }
  const study = new Set(pre.studyDays);
  const blocked = new Set(pre.blockedDates ?? []);
  const f = pre.pace === "suave" ? 0.7 : pre.pace === "normal" ? 0.85 : 1;
  return (d) => (study.has(isoDow(d)) && !blocked.has(d) ? pre.minutesPerDay * f : 0);
}

export function buildSchedule(planIn: SchedulePlan): PlanSchedule {
  // los temas «fuera de ruta» no se reparten ni cuentan (se quedan en el plan y en la vault, atenuados)
  const plan: SchedulePlan = planIn.subplans.some((s) => s.topics.some((t) => !isLive(t))) ? { ...planIn, subplans: planIn.subplans.map((s) => ({ ...s, topics: s.topics.filter(isLive) })) } : planIn;
  // ritmo diario y extras manuales (ver planPace.ts): sin ellos, el reparto de siempre
  const ov = planOverlay(plan);
  if (!ov) return buildScheduleBase(plan);
  const sch = buildScheduleBase(ov.reduced);
  const asOf = validAsOf(plan);
  let auto: ((subplanId: string, date: string) => number) | undefined;
  if (ov.paced.some((p) => !p.perDay)) {
    // «solo mínimo»: lo que daría el reparto automático (sin los temas que se añadieron como extra) con el mínimo diario como suelo
    const autoSch = buildScheduleBase(planWithoutExtraRoute(ov));
    const mine = new Map(ov.paced.map((p) => [p.sub.id, new Set(p.queue.map((t) => t.folder))] as const));
    auto = (subId, date) => new Set((autoSch.byDate.get(date)?.topics ?? []).filter((t) => !t.done && t.subplanId === subId && mine.get(subId)?.has(t.folder)).map((t) => t.folder)).size;
  }
  const { pacedDates } = applyOverlay(ov, sch, { ...(asOf ? { asOf } : {}), ...(auto ? { auto } : {}) });
  finishDays(plan, sch.days);
  // el tiempo de un día con ritmo manual sigue a sus temas: la capacidad nunca queda por debajo de lo asignado
  for (const d of sch.days) {
    if (!pacedDates.has(d.date)) continue;
    d.paced = true;
    d.capacityMinutes = Math.max(d.capacityMinutes, d.topicMinutes);
  }
  return sch;
}

function buildScheduleBase(plan: SchedulePlan): PlanSchedule {
  const ranges = weekRangesOf(plan.start, plan.end);
  const allDays = eachDay(plan.start, plan.end);
  const base = baseCapacity(plan);
  const blockedSet = new Set(plan.preconditions?.blockedDates ?? []);
  const practiceMin = practiceDayMinutes(plan.programmingPractice, { blockedDates: plan.preconditions?.blockedDates, from: plan.start });
  const track = plan.programmingPractice;
  const sessionOf = new Map<string, { minutes: number; phases: PracticePhase[]; week: number; focus: string; theme?: string }>();
  for (const w of track?.weeklyProject?.weeks ?? []) {
    for (const s of w.sessions) sessionOf.set(s.date, { minutes: s.minutes, phases: s.phases, week: w.week, focus: FOCUS_LABEL[w.focus], ...(w.theme ? { theme: w.theme } : {}) });
  }
  const kataDays = new Set(track?.kata?.days ?? []);

  const days: ScheduleDay[] = allDays.map((date) => {
    const dow = isoDow(date);
    const cap = Math.max(0, base(date) - (base(date) > 0 ? practiceMin(date) : 0));
    const kata = track?.kata && kataDays.has(dow) && !blockedSet.has(date) ? { minutes: track.kata.minutesPerDay } : undefined;
    const project = sessionOf.get(date);
    return {
      date,
      week: Math.floor(daysBetween(plan.start, date) / 7) + 1,
      dow,
      study: base(date) > 0,
      blocked: blockedSet.has(date),
      capacityMinutes: r0(cap),
      topicMinutes: 0,
      practiceMinutes: (kata?.minutes ?? 0) + (project?.minutes ?? 0),
      topics: [],
      practice: { ...(kata ? { kata } : {}), ...(project ? { project } : {}) },
    };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));
  // reparto por avance: los días anteriores a «hoy» ya no reparten trabajo pendiente (lo que falta empieza hoy, o el siguiente día de estudio)
  const asOf = plan.asOf && plan.asOf > plan.start && plan.asOf <= plan.end ? plan.asOf : undefined;
  const capOf = (d: string): number => (asOf && d < asOf ? 0 : Math.max(0, base(d) - (base(d) > 0 ? practiceMin(d) : 0)));

  // posición de cada tema en la ruta de su área (por semana objetivo y orden guardado)
  const groupTitle = new Map<string, Map<string, string>>();
  for (const s of plan.subplans) groupTitle.set(s.id, new Map((s.groups ?? []).map((g) => [g.id, g.title])));
  const clampWeek = (w: number): number => Math.min(ranges.length, Math.max(1, Math.round(w) || 1));

  if (plan.structure === "areas") {
    // ── agenda por enfoque (planes por áreas) ──
    const langs = plan.preconditions?.languages;
    const res = buildFocusSchedule({ start: plan.start, end: plan.end, subplans: plan.subplans, areaMode: effectiveAreaMode(plan), ...(langs?.length ? { languages: langs.map((l) => ({ id: l.id, ...(l.weight ? { weight: l.weight } : {}) })) } : {}) }, { capOf, weekOf: (d) => Math.floor(daysBetween(plan.start, d) / 7) + 1, ...(asOf ? { byProgress: true } : {}) });
    const total = new Map(plan.subplans.map((s) => [s.id, s.topics.length] as const));
    const position = new Map<string, number>();
    for (const s of plan.subplans) s.topics.forEach((t, i) => position.set(`${s.id}|${t.folder}`, i + 1));
    const topicOf = new Map<string, { sub: ScheduleSubplan; t: ScheduleTopic }>();
    for (const s of plan.subplans) for (const t of s.topics) topicOf.set(`${s.id}|${t.folder}`, { sub: s, t });
    for (const [key, chunks] of res.chunks) {
      const hit = topicOf.get(key);
      if (!hit) continue;
      const parts = chunks.length;
      chunks.forEach((c, i) => {
        const day = byDate.get(c.date);
        if (!day) return;
        day.topics.push({
          subplanId: hit.sub.id,
          ...(hit.sub.areaId ? { areaId: hit.sub.areaId } : {}),
          area: hit.sub.area,
          folder: hit.t.folder,
          title: hit.t.title,
          minutes: Math.max(1, r0(c.minutes)),
          ...(hit.t.group ? { group: hit.t.group, groupTitle: groupTitle.get(hit.sub.id)?.get(hit.t.group) ?? hit.t.group } : {}),
          part: i + 1,
          parts,
          position: position.get(key) ?? 1,
          total: total.get(hit.sub.id) ?? 1,
          done: false,
          ...(c.overflow ? { overflow: true } : {}),
          ...(c.blockId ? { blockId: c.blockId } : {}),
          ...(c.role ? { role: c.role } : {}),
          ...(c.applied ? { applied: true } : {}),
        });
      });
    }
    for (const day of days) {
      const f = res.days.get(day.date);
      if (!f) continue;
      // cada elemento de un bloque sabe qué parte del tema es
      for (const b of f.blocks) {
        for (const it of b.items) {
          const ch = res.chunks.get(`${it.subplanId}|${it.folder}`) ?? [];
          const idx = ch.findIndex((c) => c.date === day.date && !c.overflow);
          it.part = idx + 1;
          it.parts = ch.length;
        }
      }
      if (f.focus) day.focus = f.focus;
      day.blocks = f.blocks;
      day.projectMinutes = f.projectMinutes;
      day.reviewMinutes = f.reviewMinutes;
      if (f.languageMinutes) day.languageMinutes = f.languageMinutes;
    }
    // proyecto de aplicación de cada tema: el día en que se completa (o el siguiente día con tiempo de proyecto)
    const studyDates = days.filter((d) => d.study);
    for (const sub of plan.subplans) {
      for (const t of sub.topics) {
        if (!t.topicProject || t.completedAt) continue;
        const last = [...(res.chunks.get(`${sub.id}|${t.folder}`) ?? [])].reverse().find((c) => !c.overflow);
        if (!last) continue;
        let day = byDate.get(last.date);
        if (day && !day.projectMinutes) {
          const next = studyDates.find((d) => d.date > last.date && d.projectMinutes);
          if (next) day = next;
        }
        if (!day) continue;
        (day.topicProjects ??= []).push({ id: topicProjectId(t.folder), subplanId: sub.id, ...(sub.areaId ? { areaId: sub.areaId } : {}), area: sub.area, folder: t.folder, title: t.title, project: t.topicProject, minutes: 0 });
      }
    }
    for (const d of days) {
      if (!d.topicProjects?.length) continue;
      const each = d.projectMinutes ? Math.max(10, Math.round((d.projectMinutes * 0.6) / d.topicProjects.length)) : 0;
      for (const tp of d.topicProjects) tp.minutes = each;
    }
    addCompleted(plan, byDate, groupTitle);
    finishDays(plan, days);
    return { start: plan.start, end: plan.end, weeks: ranges.length, days, byDate, mode: "focus" };
  }

  const segs: Seg[] = [];
  const subIndex = new Map(plan.subplans.map((s, i) => [s.id, i]));
  plan.subplans.forEach((sub) => {
    sub.topics.forEach((t, order) => {
      if (t.completedAt) return;
      segs.push({ sub, topic: t, order, remaining: Math.max(1, t.estMinutes), chunks: [] });
    });
  });

  // ── simulación semana a semana ──
  const carry = new Map<string, Seg[]>();
  const lastStudy = [...days].reverse().find((d) => capOf(d.date) > 0)?.date ?? plan.end;
  ranges.forEach((_range, wi) => {
    const week = wi + 1;
    const isLast = week === ranges.length;
    const weekDays = days.filter((d) => d.week === week);
    const queues = new Map<string, Seg[]>();
    for (const sub of plan.subplans) {
      const fresh = segs.filter((s) => s.sub === sub && clampWeek(s.topic.targetWeek) === week);
      const pinned = fresh.filter((s) => s.topic.pinned).sort((a, b) => a.order - b.order);
      const rest = fresh.filter((s) => !s.topic.pinned).sort((a, b) => a.order - b.order);
      const q = [...pinned, ...(carry.get(sub.id) ?? []), ...rest];
      if (q.length) queues.set(sub.id, q);
    }
    carry.clear();
    const demand = new Map([...queues].map(([id, q]) => [id, q.reduce((n, s) => n + s.remaining, 0)] as const));
    const totalDemand = [...demand.values()].reduce((n, x) => n + x, 0);
    const weekCap = weekDays.reduce((n, d) => n + capOf(d.date), 0);
    if (totalDemand <= 0) return;
    const scale = weekCap > 0 ? Math.min(1, totalDemand / weekCap) : 0;
    const slack = scale < 0.999;
    for (const [subId, q] of queues) {
      const share = (demand.get(subId) ?? 0) / totalDemand;
      for (const d of weekDays) {
        // `full` = lo que de verdad le toca a esta área hoy (límite duro); `level` = el reparto NIVELADO por días con holgura (con un mínimo
        // razonable para que un tema no se parta en trocitos de 8 minutos)
        const full = capOf(d.date) * share;
        if (full <= 0.5) continue;
        const level = slack ? Math.min(full, Math.max(full * scale, Math.min(full, LEVEL_FLOOR))) : full;
        let used = 0;
        while (q.length) {
          const seg = q[0]!;
          const room = level - used;
          const hard = full - used;
          if (hard < 0.5) break;
          // si el tema cabe (con un pequeño pase de hasta un 35 % sobre lo nivelado cuando hay holgura) se hace entero hoy
          let take = 0;
          if (seg.remaining <= hard + 0.5 && seg.remaining <= (slack ? room * 1.35 + 5 : room + 0.5)) take = seg.remaining;
          else {
            const part = Math.min(room, hard);
            const fresh = seg.chunks.length === 0;
            if (part >= (fresh ? Math.max(MIN_CHUNK, Math.min(30, seg.remaining * 0.4)) : MIN_CHUNK)) take = part;
            else break; // el día está lleno para este tema: sigue mañana
          }
          seg.chunks.push({ date: d.date, minutes: take });
          seg.remaining -= take;
          used += take;
          if (seg.remaining < 0.5) q.shift();
        }
        if (!q.length) break;
      }
      if (q.length) {
        if (isLast) {
          // no cabe: se amontona en el último día de estudio, marcado como desbordado
          for (const seg of q) {
            seg.chunks.push({ date: lastStudy, minutes: seg.remaining, overflow: true });
            seg.remaining = 0;
          }
        } else carry.set(subId, q);
      }
    }
  });

  // ── a los días ──
  const total = new Map(plan.subplans.map((s) => [s.id, s.topics.length] as const));
  const position = new Map<string, number>();
  for (const s of plan.subplans) s.topics.forEach((t, i) => position.set(`${s.id}|${t.folder}`, i + 1));
  const order = (s: ScheduleSubplan): number => subIndex.get(s.id) ?? 0;
  for (const seg of segs) {
    const parts = seg.chunks.length;
    seg.chunks.forEach((c, i) => {
      const day = byDate.get(c.date);
      if (!day) return;
      const minutes = Math.max(1, r0(c.minutes));
      day.topics.push({
        subplanId: seg.sub.id,
        ...(seg.sub.areaId ? { areaId: seg.sub.areaId } : {}),
        area: seg.sub.area,
        folder: seg.topic.folder,
        title: seg.topic.title,
        minutes,
        ...(seg.topic.group ? { group: seg.topic.group, groupTitle: groupTitle.get(seg.sub.id)?.get(seg.topic.group) ?? seg.topic.group } : {}),
        part: i + 1,
        parts,
        position: position.get(`${seg.sub.id}|${seg.topic.folder}`) ?? 1,
        total: total.get(seg.sub.id) ?? 1,
        done: false,
        ...(c.overflow ? { overflow: true } : {}),
      });
    });
  }
  void order;
  addCompleted(plan, byDate, groupTitle);
  finishDays(plan, days);
  return { start: plan.start, end: plan.end, weeks: ranges.length, days, byDate, mode: "legacy" };
}

/** Completados: se anotan el día en que se completaron (acotado al plan) y no consumen capacidad. */
function addCompleted(plan: SchedulePlan, byDate: Map<string, ScheduleDay>, groupTitle: Map<string, Map<string, string>>): void {
  for (const sub of plan.subplans) {
    sub.topics.forEach((t, i) => {
      if (!t.completedAt) return;
      const when = t.completedAt < plan.start ? plan.start : t.completedAt > plan.end ? plan.end : t.completedAt;
      const day = byDate.get(when);
      if (!day) return;
      day.topics.push({
        subplanId: sub.id,
        ...(sub.areaId ? { areaId: sub.areaId } : {}),
        area: sub.area,
        folder: t.folder,
        title: t.title,
        minutes: Math.max(1, t.estMinutes),
        ...(t.group ? { group: t.group, groupTitle: groupTitle.get(sub.id)?.get(t.group) ?? t.group } : {}),
        part: 1,
        parts: 1,
        position: i + 1,
        total: sub.topics.length,
        done: true,
      });
    });
  }
}

function finishDays(plan: SchedulePlan, days: ScheduleDay[]): void {
  const subOrder = new Map(plan.subplans.map((s, i) => [s.id, i] as const));
  for (const d of days) {
    // los subplanes desconocidos (el cubo «Extra») van al final; dentro de un área, lo añadido a mano detrás de lo que le tocaba
    d.topics.sort((a, b) => Number(a.done) - Number(b.done) || (subOrder.get(a.subplanId) ?? 1e6) - (subOrder.get(b.subplanId) ?? 1e6) || Number(!!a.extra) - Number(!!b.extra) || a.position - b.position);
    d.topicMinutes = d.topics.filter((t) => !t.done).reduce((n, t) => n + t.minutes, 0);
  }
}

// ── Entregables derivados ───────────────────────────────────────────────

/** Lo que se sabe del estado de la práctica (subconjunto de `MentorPracticeStatus`). */
export interface PracticeStatusLike {
  /** fechas (AAAA-MM-DD) con kata hecho */
  kataDoneDates?: string[];
  /** por fecha (AAAA-MM-DD): áreas cuya carpeta de proyecto diario de ese día está completa (la señal del avance de la cadena diario → semanal → mensual) */
  dailyProjectDone?: Record<string, string[]>;
  weeks: Array<{ week: number; phases: Record<PracticePhase, PhaseStatus> }>;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAYS_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const dateLabel = (iso: string): string => `${Number(iso.slice(8))} ${MONTHS_ES[Number(iso.slice(5, 7)) - 1]}`;
export const longDateLabel = (iso: string): string => `${DAYS_LONG[isoDow(iso) - 1]} ${Number(iso.slice(8))} de ${MONTHS_LONG[Number(iso.slice(5, 7)) - 1]}`;
export const monthName = (month: string): string => {
  const t = MONTHS_LONG[Number(month.slice(5, 7)) - 1] ?? month;
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} ${month.slice(0, 4)}`;
};

const RANK: Record<PlanDeliverableStatus, number> = { pendiente: 0, en_curso: 1, hecho: 2 };
const bestStatus = (a: PlanDeliverableStatus, b: PlanDeliverableStatus): PlanDeliverableStatus => (RANK[b] > RANK[a] ? b : a);
const fromPhaseStatuses = (st: PhaseStatus[]): PlanDeliverableStatus => (st.length && st.every((s) => s === "hecho") ? "hecho" : st.some((s) => s === "hecho" || s === "en_curso") ? "en_curso" : "pendiente");
function areaProjectStatus(areaId: string | undefined, chain: { months: ReadonlyArray<{ areaIds: string[]; status: PlanDeliverableStatus; done: number }> } | null): PlanDeliverableStatus {
  const ms = (chain?.months ?? []).filter((m) => !areaId || m.areaIds.includes(areaId));
  return ms.length && ms.every((m) => m.status === "hecho") ? "hecho" : ms.some((m) => m.done > 0) ? "en_curso" : "pendiente";
}

/**
 * Todos los entregables del plan: los de PRÁCTICA derivados de la pista (un archivo de kata por día con kata, un proyecto por semana,
 * uno por bloque mensual), los de ÁREA (`Subplan.deliverable`) y los guardados a mano. El ESTADO de cada derivado sale de lo que el
 * estudiante completa (`practice` y las carpetas de proyecto): `Plan.deliverables` solo aporta sus archivos, nunca el estado.
 */
export function deliverablesOf(plan: SchedulePlan, practice?: PracticeStatusLike | null, schedule?: PlanSchedule): PlanDeliverable[] {
  const out: PlanDeliverable[] = [];
  const stored = new Map((plan.deliverables ?? []).map((d) => [d.id, d]));
  const used = new Set<string>();
  const push = (d: PlanDeliverable): void => {
    const man = stored.get(d.id);
    used.add(d.id);
    // el proyecto diario se deriva siempre del reparto actual: del guardado solo se conservan los archivos; el ESTADO nunca se anota a mano (se deriva de lo que el estudiante completa)
    if (!man) return void out.push(d);
    const merged: PlanDeliverable = { ...d, ...man, status: d.status, kind: d.kind, source: d.source, ...(d.kind === "daily_project" || d.kind === "topic_project" ? { title: d.title, description: d.description, dueDate: d.dueDate, criteria: d.criteria } : {}) };
    // el área sale siempre de lo derivado (lo anotado a mano no la fija)
    if (d.areaId) merged.areaId = d.areaId;
    else delete merged.areaId;
    if (d.areaIds) merged.areaIds = d.areaIds;
    else delete merged.areaIds;
    out.push(merged);
  };
  const track = plan.programmingPractice;
  const blocked = new Set(plan.preconditions?.blockedDates ?? []);
  const kataDone = new Set(practice?.kataDoneDates ?? []);
  // la cadena diario → semanal → mensual (planes por áreas): su avance sale SOLO de lo que el estudiante completa
  const areasPlan = plan.structure === "areas";
  const sch0 = areasPlan ? (schedule ?? buildSchedule(plan)) : schedule;
  const signals: ChainSignals = {
    ...(practice?.dailyProjectDone ? { dailyProjectDone: practice.dailyProjectDone } : {}),
    weeksDone: new Set((practice?.weeks ?? []).filter((x) => PRACTICE_PHASES.every((p) => x.phases[p] === "hecho")).map((x) => x.week)),
  };
  const chainModel = areasPlan && sch0 ? planChain(plan, sch0, signals) : null;
  const chain = chainModel ? chainIndex(chainModel) : null;
  if (track?.kata) {
    const kd = new Set(track.kata.days);
    for (const date of eachDay(plan.start, plan.end)) {
      if (!kd.has(isoDow(date)) || blocked.has(date)) continue;
      push({
        id: `kata:${date}`,
        kind: "kata",
        title: `Kata del ${dateLabel(date)}`,
        description: "Archivo con tu solución del reto de lógica del día, con casos de prueba y una nota sobre su complejidad.",
        dueDate: date,
        criteria: ["Resuelve el reto", "Incluye casos de prueba", "Anota la complejidad y qué mejorarías"],
        status: kataDone.has(date) ? "hecho" : "pendiente",
        source: "practice",
      });
    }
  }
  const weeks = track?.weeklyProject?.weeks ?? [];
  for (const w of weeks) {
    if (!w.sessions.length) continue;
    const st = practice?.weeks.find((x) => x.week === w.week);
    const cw = plan.practiceCurriculum?.weeks.find((x) => x.week === w.week)?.weeklyProject;
    push({
      id: `wp:${w.week}`,
      kind: "weekly_project",
      title: cw?.title ?? weekTitle(w),
      description: cw?.description ?? "Proyecto semanal full stack (frontend + backend + base de datos): especificación, construcción, defensa y postmortem.",
      dueDate: w.sessions[w.sessions.length - 1]!.date,
      criteria: PRACTICE_PHASES.map((p) => `${PHASE_LABEL[p]} hecha`),
      areaId: "all",
      status: bestStatus(st ? fromPhaseStatuses(PRACTICE_PHASES.map((p) => st.phases[p])) : "pendiente", chain?.weeks.get(`wp:${w.week}`)?.status ?? "pendiente"),
      source: "practice",
    });
  }
  const ranges = weekRangesOf(plan.start, plan.end);
  // si la pista trae bloque mensual de Programming practice, se incluye ese proyecto mensual
  for (const b of track?.monthlyProject?.blocks ?? []) {
    const lastWeek = weeks.filter((w) => w.week >= b.fromWeek && w.week <= b.toWeek && w.sessions.length).at(-1);
    const due = lastWeek?.sessions.at(-1)?.date ?? ranges[Math.min(ranges.length, b.toWeek) - 1]?.end ?? plan.end;
    const inside = weeks.filter((w) => w.week >= b.fromWeek && w.week <= b.toWeek && w.sessions.length).map((w) => practice?.weeks.find((x) => x.week === w.week));
    const cmonth = plan.practiceCurriculum?.monthly.find((x) => x.month === ranges[b.fromWeek - 1]?.start.slice(0, 7));
    const all = inside.length > 0 && inside.every((s) => s && PRACTICE_PHASES.every((p) => s.phases[p] === "hecho"));
    push({
      id: `mp:${b.fromWeek}`,
      kind: "monthly_project",
      title: cmonth?.title ?? (b.theme ? `Proyecto mensual: ${b.theme}` : `Proyecto mensual · semanas ${b.fromWeek}–${b.toWeek}`),
      description: cmonth?.description ?? "Un proyecto mayor que integra los proyectos semanales del bloque.",
      dueDate: due,
      criteria: ["Integra lo hecho en los proyectos semanales", "Se puede ejecutar y explicar de principio a fin"],
      areaId: "all",
      status: all ? "hecho" : inside.some((s) => s && PRACTICE_PHASES.some((p) => s.phases[p] === "hecho")) ? "en_curso" : "pendiente",
      source: "practice",
    });
  }
  // agenda por enfoque: proyecto DIARIO (todos los días de estudio), SEMANAL (sin pista) y MENSUAL (sin pista mensual)
  if (plan.structure === "areas") {
    const sch = sch0!;
    for (const day of sch.days) {
      const p = dailyProjectOf(plan, sch, day);
      if (!p) continue;
      push({ id: p.id, kind: "daily_project", title: p.title, description: p.description, dueDate: day.date, ...areaFields(p.areaIds), criteria: ["Aplica los temas de teoría y práctica del día", "Se puede ejecutar y explicar", "Suma una pieza al proyecto semanal"], status: chain?.pieces.get(p.id)?.status ?? "pendiente", source: p.source === "ai" ? "ai" : "practice" });
      // proyecto de aplicación de los temas que se completan este día (calibrado al nivel; cuenta como entregable)
      for (const tp of day.topicProjects ?? []) {
        push({
          id: tp.id,
          kind: "topic_project",
          title: `Proyecto del tema: ${tp.project.title}`,
          description: tp.project.description,
          dueDate: day.date,
          ...areaFields(tp.areaId ? [tp.areaId] : []),
          criteria: [`Aplica «${shortOf(tp.title)}» de forma real`, `Nivel ${tp.project.level}: no pidas más de lo que ya dominas`, "Funciona y puedes explicarlo"],
          // sin señal propia: se completa con la pieza de su día
          status: chain?.pieces.get(dailyId(day.date))?.status ?? "pendiente",
          source: tp.project.source === "ai" ? "ai" : "practice",
        });
      }
    }
    for (let w = 1; w <= ranges.length; w++) {
      if (weeks.some((x) => x.week === w && x.sessions.length)) continue;
      const wp = weeklyProjectOf(plan, sch, w);
      const last = sch.days.filter((d) => d.week === w && d.study).at(-1);
      if (!wp || !last) continue;
      push({ id: wp.id, kind: "weekly_project", title: wp.title, description: wp.description, dueDate: last.date, ...areaFields(wp.areaIds), criteria: ["Integra los mini-proyectos diarios de la semana", "Se puede ejecutar de principio a fin"], status: chain?.weeks.get(wp.id)?.status ?? "pendiente", source: wp.source === "ai" ? "ai" : "practice" });
    }
    // UN proyecto mensual (= el entregable del mes) por mes del plan, con su estado derivado de sus semanas (si no viene de la pista)
    if (!track?.monthlyProject?.blocks?.length) {
      for (const mth of chain ? [...chain.months.values()] : []) {
        push({ id: mth.id, kind: "monthly_project", title: mth.title, description: mth.goal, dueDate: mth.dueDate, ...areaFields(mth.areaIds), criteria: mth.criteria, status: mth.status, source: mth.source === "ai" ? "ai" : "practice" });
      }
    }
  }
  for (const sub of plan.subplans) {
    const d = sub.deliverable;
    if (!d) continue;
    const toWeek = Math.min(ranges.length, Math.max(1, sub.phase?.toWeek ?? ranges.length));
    push({
      id: `area:${sub.id}`,
      kind: "area_project",
      title: d.title,
      description: d.description,
      ...(sub.areaId ? { areaId: sub.areaId } : {}),
      dueDate: ranges[toWeek - 1]?.end ?? plan.end,
      criteria: d.criteria,
      // el proyecto de área también se deriva: hecho cuando lo están los meses en que participa el área
      status: areaProjectStatus(sub.areaId, chainModel),
      source: "ai",
    });
  }
  for (const [id, d] of stored) if (!used.has(id)) out.push(d);
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** Campos de área de un entregable: un área = `areaId`; varias = proyecto integrador (`areaId: "all"` + `areaIds`); ninguna = sin área. */
function areaFields(ids: readonly string[]): { areaId?: string; areaIds?: string[] } {
  const u = [...new Set(ids)];
  return u.length === 1 ? { areaId: u[0]! } : u.length > 1 ? { areaId: "all", areaIds: u } : {};
}

export interface DeliverableCount {
  total: number;
  done: number;
  pending: number;
}

export function countDeliverables(list: readonly PlanDeliverable[]): DeliverableCount {
  const done = list.filter((d) => d.status === "hecho").length;
  return { total: list.length, done, pending: list.length - done };
}

export const deliverablesBetween = (list: readonly PlanDeliverable[], from: string, to: string): PlanDeliverable[] => list.filter((d) => d.dueDate >= from && d.dueDate <= to);

/** Filtro de `deliverablesBy`: un día (AAAA-MM-DD), una semana del plan (1..), un mes (AAAA-MM) y/o un área (`backend`…; también los integradores que la incluyen). */
export interface DeliverableQuery {
  day?: string;
  week?: number;
  month?: string;
  area?: string;
  kind?: PlanDeliverable["kind"];
  status?: PlanDeliverableStatus;
}

/** ¿Pertenece el entregable al área? Lo propio del área y los proyectos integradores que la incluyen. */
export const deliverableInArea = (d: PlanDeliverable, area: string): boolean => d.areaId === area || (area === "all" ? false : d.areaId === "all" && (!d.areaIds || d.areaIds.includes(area)));

/**
 * Los entregables de un plan filtrados por día, semana, mes y/o ÁREA (función pura): `deliverablesBy(plan, { week: 3, area: "frontend" })`.
 * Sin filtro devuelve todos. El resultado sale de `deliverablesOf` (derivados del plan + anotados a mano).
 */
export function deliverablesBy(plan: SchedulePlan, q: DeliverableQuery, practice?: PracticeStatusLike | null, schedule?: PlanSchedule): PlanDeliverable[] {
  const sch = schedule ?? buildSchedule(plan);
  let list = deliverablesOf(plan, practice, sch);
  if (q.day) list = list.filter((d) => d.dueDate === q.day);
  if (q.week !== undefined) {
    const r = weekRangesOf(plan.start, plan.end)[q.week - 1];
    list = r ? deliverablesBetween(list, r.start, r.end) : [];
  }
  if (q.month) list = list.filter((d) => d.dueDate.startsWith(q.month!));
  if (q.area) list = list.filter((d) => deliverableInArea(d, q.area!));
  if (q.kind) list = list.filter((d) => d.kind === q.kind);
  if (q.status) list = list.filter((d) => d.status === q.status);
  return list;
}

export interface AreaDeliverableRow {
  /** id del área (`backend`…), `all` (integradores) o `practice` (sin área: katas…) */
  id: string;
  name: string;
  total: number;
  done: number;
  pending: number;
}

/**
 * Desglose por ÁREA de una lista de entregables, que PARTICIONA la lista (la suma de las filas = el total): cada entregable cuenta en el área a
 * la que pertenece; los proyectos integradores van en «Integradores» y los que no tienen área (katas) en «Práctica». Para el filtro «ver los de
 * Backend» use `deliverableInArea`, que además incluye los integradores que la contienen.
 */
export function deliverableAreaRows(list: readonly PlanDeliverable[], areaOrder: ReadonlyArray<{ id: string; name: string }>): AreaDeliverableRow[] {
  const key = (d: PlanDeliverable): string => d.areaId ?? "practice";
  const rows = new Map<string, AreaDeliverableRow>();
  const names = new Map(areaOrder.map((a) => [a.id, a.name] as const));
  const row = (id: string): AreaDeliverableRow => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { id, name: id === "all" ? "Integradores" : id === "practice" ? "Práctica" : (names.get(id) ?? id), total: 0, done: 0, pending: 0 }));
    return r;
  };
  for (const a of areaOrder) row(a.id);
  for (const d of list) {
    const r = row(key(d));
    r.total++;
    if (d.status === "hecho") r.done++;
    else r.pending++;
  }
  row("all");
  row("practice");
  const order = [...areaOrder.map((a) => a.id), "all", "practice"];
  return [...rows.values()].filter((r) => r.total > 0 || names.has(r.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** «Backend 12 · Frontend 12 · Databases 5 · Integradores 8»: el resumen por área en una línea. */
export const areaRowsText = (rows: readonly AreaDeliverableRow[]): string => rows.map((r) => `${r.name} ${r.total}`).join(" · ");

/** «1 entregable» / «3 entregables» / «sin entregables». */
export const deliverablesText = (n: number): string => (n === 0 ? "sin entregables" : `${n} ${n === 1 ? "entregable" : "entregables"}`);
export const topicsText = (n: number): string => (n === 0 ? "sin temas" : `${n} ${n === 1 ? "tema" : "temas"}`);

// ── Resúmenes por semana y por mes ──────────────────────────────────────

export interface AreaLoad {
  areaId?: string;
  area: string;
  subplanId: string;
  /** temas distintos tocados */
  topics: number;
  minutes: number;
  /** títulos de esos temas, en orden */
  titles: string[];
}

export interface WeekSummary {
  week: number;
  start: string;
  end: string;
  /** temas distintos (no hechos aún o hechos) con alguna parte en la semana */
  topics: number;
  topicsDone: number;
  topicMinutes: number;
  practiceMinutes: number;
  capacityMinutes: number;
  byArea: AreaLoad[];
  deliverables: PlanDeliverable[];
  katas: number;
  projectSessions: number;
  purpose: string;
  autoPurpose: string;
  /** estructura por enfoque (agenda por enfoque): días por enfoque y horas de teoría vs práctica */
  focus?: FocusStats;
}

export interface MonthSummary {
  month: string;
  label: string;
  start: string;
  end: string;
  weeks: WeekSummary[];
  topics: number;
  topicMinutes: number;
  byArea: AreaLoad[];
  deliverables: PlanDeliverable[];
  milestones: string[];
  purpose: string;
  autoPurpose: string;
  focus?: FocusStats;
}

const dayRows = (s: PlanSchedule, from: string, to: string): ScheduleDay[] => s.days.filter((d) => d.date >= from && d.date <= to);

function loadByArea(days: readonly ScheduleDay[]): AreaLoad[] {
  const m = new Map<string, AreaLoad & { folders: Map<string, string> }>();
  for (const d of days) {
    for (const t of d.topics) {
      if (t.applied) continue; // los fundamentos (Bases) no son de ningún área: ver `lib/planTopicsByArea`
      const e = m.get(t.subplanId) ?? { ...(t.areaId ? { areaId: t.areaId } : {}), area: t.area, subplanId: t.subplanId, topics: 0, minutes: 0, titles: [], folders: new Map<string, string>() };
      e.folders.set(t.folder, t.title);
      e.minutes += t.minutes;
      m.set(t.subplanId, e);
    }
  }
  return [...m.values()].map(({ folders, ...rest }) => ({ ...rest, topics: folders.size, titles: [...folders.values()] }));
}

const shortTitle = (t: string): string => t.replace(/^[\d.\s_-]+/, "").trim() || t;
const listTitles = (titles: readonly string[], max = 2): string => {
  const u = [...new Set(titles.map(shortTitle))];
  const head = u.slice(0, max).join(" y ");
  return u.length > max ? `${head} y ${u.length - max} más` : head;
};
const kindVerb = (g: AreaGroup["kind"] | undefined, area: string): string =>
  g === "bases" ? "afianzar los fundamentos" : g === "language" ? "practicar el lenguaje" : `avanzar en la ruta de ${area.toLowerCase()}`;

const groupKinds = (plan: SchedulePlan): Map<string, AreaGroup["kind"]> => {
  const m = new Map<string, AreaGroup["kind"]>();
  for (const s of plan.subplans) for (const g of s.groups ?? []) m.set(`${s.id}|${g.id}`, g.kind);
  return m;
};

/** Propósito determinista de un día a partir de su contenido (áreas, temas, práctica, entregables). */
export function dayPurposeAuto(plan: SchedulePlan, day: ScheduleDay, due: readonly PlanDeliverable[] = []): string {
  if (day.blocked) return "Día bloqueado: sin estudio.";
  if (!day.study) return "Día de descanso.";
  if (day.focus) {
    // agenda por enfoque: el propósito sale de la estructura del día (enfoque, teoría, práctica, reto de lógica y proyecto)
    const extras: string[] = [];
    if (day.practice.kata) extras.push("reto de lógica");
    if (day.practice.project) extras.push(`sesión del proyecto semanal (${day.practice.project.phases.map((p) => PHASE_LABEL[p].toLowerCase()).join(" + ")})`);
    if (day.projectMinutes) extras.push("proyecto diario");
    const real = due.filter((d) => d.kind !== "kata" && d.kind !== "daily_project");
    if (real.length) extras.push(`entrega: ${real.map((d) => d.title).join(", ")}`);
    const line = day.focus.line.replace(/^Hoy:s*/, "");
    const first = (day.blocks ?? []).flatMap((b) => b.items).filter((i) => !i.applied)[0];
    const topic = first ? ` (${shortOf(first.title)})` : "";
    return `Enfoque ${day.focus.label}${topic}: ${line}${extras.length ? `; ${extras.join("; ")}` : ""}.`;
  }
  const kinds = groupKinds(plan);
  const pending = day.topics.filter((t) => !t.done);
  const parts: string[] = [];
  const byArea = new Map<string, DayTopic[]>();
  for (const t of pending.length ? pending : day.topics) byArea.set(t.subplanId, [...(byArea.get(t.subplanId) ?? []), t]);
  for (const [sid, list] of [...byArea].slice(0, 2)) {
    const first = list[0]!;
    const cont = list.every((t) => t.part > 1);
    const verb = cont ? "continuar" : kindVerb(first.group ? kinds.get(`${sid}|${first.group}`) : undefined, first.area);
    parts.push(`${first.area} · ${listTitles(list.map((t) => t.title))}: ${verb}`);
  }
  if (byArea.size > 2) parts.push(`${byArea.size - 2} áreas más`);
  const extras: string[] = [];
  if (day.practice.kata) extras.push("kata de lógica");
  if (day.practice.project) extras.push(`sesión del proyecto semanal (${day.practice.project.phases.map((p) => PHASE_LABEL[p].toLowerCase()).join(" + ")})`);
  const real = due.filter((d) => d.kind !== "kata");
  if (real.length) extras.push(`entrega: ${real.map((d) => d.title).join(", ")}`);
  if (!parts.length) return extras.length ? `Práctica del día: ${extras.join("; ")}.` : "Repaso libre y recuperación.";
  return `${parts.join("; ")}${extras.length ? `; ${extras.join("; ")}` : ""}.`;
}

export function dayPurpose(plan: SchedulePlan, day: ScheduleDay, due: readonly PlanDeliverable[] = []): { text: string; auto: string; manual: boolean } {
  const auto = dayPurposeAuto(plan, day, due);
  const manual = plan.purposes?.day?.[day.date];
  return { text: manual || auto, auto, manual: !!manual };
}

export function weekSummary(plan: SchedulePlan, sch: PlanSchedule, week: number, all: readonly PlanDeliverable[] = []): WeekSummary | null {
  const r = weekRangesOf(plan.start, plan.end)[week - 1];
  if (!r) return null;
  const days = dayRows(sch, r.start, r.end);
  const byArea = loadByArea(days);
  const folders = new Set<string>();
  const doneFolders = new Set<string>();
  for (const d of days) for (const t of d.topics) (t.done ? doneFolders : folders).add(t.folder);
  const deliverables = deliverablesBetween(all, r.start, r.end);
  const real = deliverables.filter((d) => d.kind !== "kata");
  const pend = days.flatMap((d) => d.topics.filter((t) => !t.done));
  const seq = [...new Map(pend.map((t) => [t.folder, t])).values()];
  const areas = byArea.map((a) => a.area);
  const fstats = focusStatsOf(days);
  const autoPurposeBase = !seq.length && !byArea.length
    ? `Semana ${week} · práctica y repaso${real.length ? `; entrega: ${real.map((d) => d.title).join(", ")}` : ""}.`
    : `Semana ${week} · ${areas.slice(0, 2).join(" y ")}${areas.length > 2 ? " y más" : ""}: ${
        seq.length > 1 ? `de ${shortTitle(seq[0]!.title)} a ${shortTitle(seq[seq.length - 1]!.title)}` : shortTitle((seq[0] ?? days.flatMap((d) => d.topics)[0])?.title ?? "repaso")
      }${real.length ? `; entrega: ${real.map((d) => d.title).join(", ")}` : ""}.`;
  const autoPurpose = sch.mode === "focus" && fstats.byFocus.length ? `Semana ${week} · ${seq.length} ${seq.length === 1 ? "tema" : "temas"} en ${areas.length} ${areas.length === 1 ? "área" : "áreas"}: teoría y práctica${real.length ? `; entrega: ${real.map((d) => d.title).join(", ")}` : ""}.` : autoPurposeBase;
  const manual = plan.purposes?.week?.[String(week)];
  return {
    focus: fstats,
    week,
    start: r.start,
    end: r.end,
    topics: folders.size + doneFolders.size,
    topicsDone: doneFolders.size,
    topicMinutes: days.reduce((n, d) => n + d.topicMinutes, 0),
    practiceMinutes: days.reduce((n, d) => n + d.practiceMinutes, 0),
    capacityMinutes: days.reduce((n, d) => n + d.capacityMinutes, 0),
    byArea,
    deliverables,
    katas: days.filter((d) => d.practice.kata).length,
    projectSessions: days.filter((d) => d.practice.project).length,
    purpose: manual || autoPurpose,
    autoPurpose,
  };
}

/** Mes de calendario `AAAA-MM` recortado al plan; null si no se solapa. */
export function monthSummary(plan: SchedulePlan, sch: PlanSchedule, month: string, all: readonly PlanDeliverable[] = []): MonthSummary | null {
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const start = first < plan.start ? plan.start : first;
  const end = monthEnd > plan.end ? plan.end : monthEnd;
  if (end < start) return null;
  const days = dayRows(sch, start, end);
  const weeks = [...new Set(days.map((d) => d.week))].map((w) => weekSummary(plan, sch, w, all)!).filter(Boolean);
  const byArea = loadByArea(days).sort((a, b) => b.minutes - a.minutes);
  const folders = new Set(days.flatMap((d) => d.topics.map((t) => t.folder)));
  const deliverables = deliverablesBetween(all, start, end);
  const milestones: string[] = [];
  for (const s of plan.subplans) {
    if (!s.phase) continue;
    const ranges = weekRangesOf(plan.start, plan.end);
    const a = ranges[s.phase.fromWeek - 1];
    const b = ranges[s.phase.toWeek - 1];
    if (a && a.start >= start && a.start <= end && s.phase.fromWeek > 1) milestones.push(`Empieza ${s.area} (${dateLabel(a.start)})`);
    if (b && b.end >= start && b.end <= end) milestones.push(`Termina ${s.area} (${dateLabel(b.end)})`);
  }
  for (const d of deliverables) if (d.kind === "monthly_project" || d.kind === "area_project") milestones.push(`Entrega: ${d.title} (${dateLabel(d.dueDate)})`);
  const topAreas = byArea.slice(0, 2).map((a) => a.area);
  const mstats = focusStatsOf(days);
  const autoPurposeBase = byArea.length
    ? `${monthName(month)} · ${topAreas.join(" y ")}: ${folders.size} ${folders.size === 1 ? "tema" : "temas"} en ${weeks.length} ${weeks.length === 1 ? "semana" : "semanas"}${milestones.length ? `; hito: ${milestones[0]}` : ""}.`
    : `${monthName(month)} · práctica y repaso${milestones.length ? `; hito: ${milestones[0]}` : ""}.`;
  const autoPurpose = sch.mode === "focus" && mstats.byFocus.length ? `${monthName(month)}: ${folders.size} ${folders.size === 1 ? "tema" : "temas"} en ${weeks.length} ${weeks.length === 1 ? "semana" : "semanas"}${milestones.length ? `; hito: ${milestones[0]}` : ""}.` : autoPurposeBase;
  const manual = plan.purposes?.month?.[month];
  return {
    focus: mstats,
    month,
    label: monthName(month),
    start,
    end,
    weeks,
    topics: folders.size,
    topicMinutes: days.reduce((n, d) => n + d.topicMinutes, 0),
    byArea,
    deliverables,
    milestones,
    purpose: manual || autoPurpose,
    autoPurpose,
  };
}

/** Meses (AAAA-MM) que toca el plan, en orden. */
export function planMonths(plan: Pick<SchedulePlan, "start" | "end">): string[] {
  const out: string[] = [];
  let y = Number(plan.start.slice(0, 4));
  let m = Number(plan.start.slice(5, 7));
  const endKey = plan.end.slice(0, 7);
  for (let i = 0; i < 40; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// ── Estructura por enfoque (semana / mes) ───────────────────────────────

export interface FocusStats {
  /** días de estudio con enfoque, por enfoque (orden de aparición) */
  byFocus: Array<{ id: string; label: string; days: number }>;
  studyDays: number;
  theoryMinutes: number;
  practiceMinutes: number;
  projectMinutes: number;
  reviewMinutes: number;
  /** bloques de teoría y de práctica obligatorios (con tema o repaso) */
  theoryBlocks: number;
  practiceBlocks: number;
}

/** Cuántos días de cada enfoque y cuántas horas de teoría vs práctica tiene un conjunto de días (semana o mes). */
export function focusStatsOf(days: readonly ScheduleDay[]): FocusStats {
  const by = new Map<string, { id: string; label: string; days: number }>();
  let theory = 0;
  let practice = 0;
  let project = 0;
  let review = 0;
  let tb = 0;
  let pb = 0;
  let study = 0;
  for (const d of days) {
    if (d.study) study++;
    if (d.focus) {
      const e = by.get(d.focus.id + d.focus.label) ?? { id: d.focus.id, label: d.focus.label, days: 0 };
      e.days++;
      by.set(d.focus.id + d.focus.label, e);
    }
    for (const b of d.blocks ?? []) {
      if (b.status === "omitted") continue;
      if (b.kind === "theory") {
        theory += b.minutes;
        tb++;
      } else {
        practice += b.minutes;
        pb++;
      }
    }
    project += d.projectMinutes ?? 0;
    review += d.reviewMinutes ?? 0;
    practice += d.practiceMinutes;
  }
  return { byFocus: [...by.values()], studyDays: study, theoryMinutes: theory, practiceMinutes: practice + project, projectMinutes: project, reviewMinutes: review, theoryBlocks: tb, practiceBlocks: pb };
}

/** «2 teorías, 2 prácticas»: los bloques con contenido de un día (para etiquetas de lector de pantalla). */
export function dayBlockCounts(day: ScheduleDay): { theory: number; practice: number } {
  const live = (day.blocks ?? []).filter((b) => b.status !== "omitted");
  return { theory: live.filter((b) => b.kind === "theory").length, practice: live.filter((b) => b.kind === "practice").length };
}

// ── Navegación por periodos (día · semana · mes) ────────────────────────

export type AgendaView = "dia" | "semana" | "mes" | "calendario";
export const AGENDA_VIEWS: ReadonlyArray<{ id: AgendaView; label: string }> = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "calendario", label: "Calendario" },
];

/** Una fecha dentro del plan: las anteriores van al inicio y las posteriores al final. */
export const clampToPlan = (date: string, plan: Pick<SchedulePlan, "start" | "end">): string => (date < plan.start ? plan.start : date > plan.end ? plan.end : date);

/** Mueve la fecha ancla `delta` periodos (día, semana del plan, mes); siempre dentro del plan. */
export function shiftAnchor(view: AgendaView, anchor: string, delta: number, plan: Pick<SchedulePlan, "start" | "end">): string {
  if (view === "dia") return clampToPlan(addDays(anchor, delta), plan);
  if (view === "semana") {
    const w = Math.floor(daysBetween(plan.start, anchor) / 7) + delta;
    return clampToPlan(addDays(plan.start, Math.max(0, w) * 7), plan);
  }
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return clampToPlan(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`, plan);
}

/** ¿Se puede mover `delta` periodos sin salirse del plan? */
export function canShift(view: AgendaView, anchor: string, delta: number, plan: Pick<SchedulePlan, "start" | "end">): boolean {
  const next = shiftAnchor(view, anchor, delta, plan);
  if (view === "dia") return next !== anchor;
  if (view === "semana") return Math.floor(daysBetween(plan.start, next) / 7) !== Math.floor(daysBetween(plan.start, anchor) / 7);
  return next.slice(0, 7) !== anchor.slice(0, 7);
}

/** Texto del periodo mostrado: «martes 6 de octubre», «Semana 3 · 20–26 oct», «Octubre 2026». */
export function periodTitle(view: AgendaView, anchor: string, plan: Pick<SchedulePlan, "start" | "end">): string {
  if (view === "dia") return longDateLabel(anchor);
  if (view === "semana") {
    const w = Math.floor(daysBetween(plan.start, anchor) / 7) + 1;
    const r = weekRangesOf(plan.start, plan.end)[w - 1];
    return r ? `Semana ${w} · ${r.start.slice(0, 7) === r.end.slice(0, 7) ? `${Number(r.start.slice(8))}–${dateLabel(r.end)}` : `${dateLabel(r.start)} – ${dateLabel(r.end)}`}` : "Semana";
  }
  return monthName(anchor.slice(0, 7));
}

