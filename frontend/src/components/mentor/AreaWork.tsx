// Mentor — Ejecución: el TRABAJO de un área (o de las Bases), con cuatro vistas en vez de una lista larga:
//   · Hoy: los temas que tocan hoy (con su parte y sus minutos).
//   · Semana: todos los temas repartidos esta semana (los de hoy llevan el aviso «Hoy»).
//   · Pendientes: lo que tocaba hasta hoy y no se terminó («Atrasado» si es de un día anterior).
//   · Repasos: el repaso espaciado de los temas del área — vencidos u hoy, esta semana, la próxima y después — con el acceso directo a la práctica
//     de repaso de cada tema. Es el MISMO calendario de repasos del módulo de estudio (`Repaso/<tema>.md`): practicar un tema lo reprograma.
// Debajo va la práctica diaria del área (katas). Solo lectura sobre el plan.

import { CalendarClock, Play, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AreaPracticeView } from "../../lib/areaPracticeView";
import type { MentorPlan } from "../../lib/types";
import { api } from "../../lib/bridge";
import { bucketReviews, dueText, type ReviewRow } from "../../lib/planReviews";
import { dateLabel } from "../../lib/planSchedule";
import { executionLists, fillSubjectRows, MIN_SUBJECT_TOPICS, type AreaSets } from "../../lib/planAreaLists";
import { useMentor } from "../../store/mentor";
import { usePomodoro } from "../../store/pomodoro";
import { mentorAssignment } from "../../lib/pomodoro";
import { cn } from "../ui";
import { Chip, GhostButton, PrimaryButton } from "../common/forms";
import { AddExtraTopic } from "./AddExtraTopic";
import { AreaPracticeBlock } from "./AreaPracticeBlock";
import { bumpPlanVersion } from "./extraKit";
import { ExtraPracticeSection } from "./ExtraPracticeSection";
import { paceNeedText, requiredPace } from "../../lib/planRequiredPace";
import { openTopic } from "./openTopic";
import { ProgressBar } from "./parts";
import { TopicRow, type BoardPractice, type BoardRow } from "./PlanBoard";
import { usePersistedNav } from "../../store/navState";

export type WorkView = "hoy" | "semana" | "pendientes" | "repasos";
const VIEWS: ReadonlyArray<{ id: WorkView; label: string }> = [
  { id: "hoy", label: "Temas de hoy" },
  { id: "semana", label: "Temas de la semana" },
  { id: "pendientes", label: "Pendientes" },
  { id: "repasos", label: "Por repasar" },
];

type ReviewsData = { today: string; items: import("../../lib/types").ReviewItem[] };
// La barra lateral (hints de la Ejecución) y `PlanRun` piden los repasos a la vez: una sola lectura en vuelo, compartida.
let reviewsInflight: Promise<ReviewsData> | null = null;
function fetchReviews(): Promise<ReviewsData> {
  if (!reviewsInflight) {
    reviewsInflight = api
      .studyReviewsList()
      .then((r): ReviewsData => (r && Array.isArray(r.items) ? r : { today: "", items: [] }))
      .catch((): ReviewsData => ({ today: "", items: [] }))
      .finally(() => {
        reviewsInflight = null;
      });
  }
  return reviewsInflight;
}

/** Los repasos del módulo de estudio, leídos una vez y recargados cuando cambia el plan. `enabled=false` no lee nada (p. ej. en Planeación). */
export function useReviewItems(enabled = true) {
  const planVersion = useMentor((s) => s.planVersion);
  const [data, setData] = useState<ReviewsData | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(() => {
    void fetchReviews().then((r) => alive.current && setData(r));
  }, []);
  useEffect(() => {
    if (enabled) load();
  }, [load, planVersion, enabled]);
  return { data, reload: load };
}

const dueColour = (inDays: number): string => (inDays < 0 ? "var(--nv-danger)" : inDays === 0 ? "var(--nv-warn)" : "var(--nv-accent)");

function ReviewList({ title, rows, colour, areaKey }: { title: string; rows: ReviewRow[]; colour: string; areaKey: string }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title} data-testid="review-bucket">
      <h4 className="mb-1.5 flex items-center gap-2 px-1 text-[13px] font-semibold uppercase tracking-wider text-faint">
        {title} <span className="rounded-md bg-hover px-1.5 text-[12px] normal-case tracking-normal text-dim">{rows.length}</span>
      </h4>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.path} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-surface px-3 py-2" data-testid="review-row" data-in-days={r.inDays}>
            <span className="min-w-0 flex-1 basis-56">
              <span className="block text-[15px] leading-snug">{r.title}</span>
              <span className="block text-[13px] text-dim">Repaso {r.level + 1} · {r.skills.slice(0, 3).join(", ") || "sin skills todavía"}</span>
            </span>
            <Chip colour={dueColour(r.inDays)}>{dueText(r.inDays)}</Chip>
            <GhostButton onClick={() => void openTopic(r.folder)} aria-label={`Ir a la práctica de repaso de ${r.title}`} data-testid="review-go">
              <Play size={13} aria-hidden style={{ color: colour }} /> Ir al repaso
            </GhostButton>
            <GhostButton onClick={() => usePomodoro.getState().assignTopic(mentorAssignment("review", { folder: r.folder, title: r.title, areaKey }))} aria-label={`Asignar el repaso de ${r.title} al Pomodoro`} data-testid="review-assign">
              <Timer size={13} aria-hidden /> Al Pomodoro
            </GhostButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Un día de la semana de un área, con sus temas. */
export interface WeekDayView {
  date: string;
  /** «Lunes 12 oct» */
  label: string;
  rows: BoardRow[];
}

/** Una semana futura del plan (proyección), día a día. */
export interface UpcomingWeekView {
  week: number;
  start: string;
  end: string;
  days: WeekDayView[];
}

const UPCOMING_STEP = 4;

/** «Lo que viene»: los temas de las semanas siguientes, con su etiqueta de tiempo. Es la proyección del plan: se ve aunque la ruta sólida aún no los desbloquee. */
function UpcomingWeeks({ weeks, colour, areaKey, planId }: { weeks: UpcomingWeekView[]; colour: string; areaKey: string; planId?: string }) {
  const [shown, setShown] = useState(UPCOMING_STEP);
  if (!weeks.length) return null;
  return (
    <section aria-label="Lo que viene" className="space-y-3" data-testid="work-upcoming">
      <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wider text-faint">
        Lo que viene <span className="font-normal normal-case tracking-normal text-dim">· proyección de las próximas semanas</span>
      </h3>
      {weeks.slice(0, shown).map((w) => (
        <section key={w.week} aria-label={`Semana ${w.week}`} className="rounded-2xl border border-line bg-card p-3" data-testid="upcoming-week" data-week={w.week}>
          <h4 className="mb-1.5 flex flex-wrap items-center gap-2 px-1 text-[14px] font-semibold">
            Semana {w.week}
            <span className="font-mono text-[12.5px] font-normal text-dim">{dateLabel(w.start)} – {dateLabel(w.end)}</span>
          </h4>
          {w.days.map((d) => (
            <div key={d.date} data-date={d.date}>
              <p className="px-1 pt-1 text-[12.5px] font-medium text-dim first-letter:uppercase">{d.label}</p>
              <ul className="space-y-0.5" aria-label={`Temas de ${d.label}`}>
                {d.rows.map((r) => <TopicRow key={`${r.folder}:${r.meta ?? ""}`} r={r} colour={colour} areaKey={areaKey} planId={planId} />)}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {shown < weeks.length && (
        <GhostButton large="md" onClick={() => setShown((n) => n + UPCOMING_STEP)} data-testid="upcoming-more">Ver {Math.min(UPCOMING_STEP, weeks.length - shown)} semanas más</GhostButton>
      )}
    </section>
  );
}

/** La semana en curso: un cajón por día, lo completado y el nivel de avance (media del avance de cada tema; un tema hecho cuenta 100 %). */
function WeekView({ days, today, colour, upcoming, areaKey, planId, weekNumber }: { days: WeekDayView[]; today: string; colour: string; upcoming?: UpcomingWeekView[]; areaKey: string; planId?: string; weekNumber?: number }) {
  const unique = new Map<string, BoardRow>();
  for (const d of days) for (const r of d.rows) if (!unique.has(r.folder) || r.done) unique.set(r.folder, r);
  const all = [...unique.values()];
  const done = all.filter((r) => r.done).length;
  const level = all.length ? Math.round(all.reduce((n, r) => n + (r.done ? 100 : r.pct ?? 0), 0) / all.length) : 0;
  return (
    <div className="space-y-4" data-testid="work-week">
      <div className="rounded-2xl border border-line bg-card p-4" data-testid="week-summary">
        <p className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
          {weekNumber ? <strong className="text-[18px]">Semana {weekNumber} · </strong> : null}
          <strong className="text-[18px]">{done} de {all.length}</strong> temas completados esta semana
          <span className="flex-1" />
          <span className="text-dim">Nivel de avance <strong className="text-text">{level} %</strong></span>
        </p>
        <div className="mt-2"><ProgressBar pct={level} thick label="Nivel de avance de la semana" /></div>
      </div>
      {days.map((d) => {
        const isToday = d.date === today;
        const doneN = d.rows.filter((r) => r.done).length;
        const rows = d.rows.map((r) => ({
          ...r,
          tag: r.done ? { text: "Hecho", colour: "var(--nv-mint)" } : isToday ? { text: "Hoy", colour } : d.date < today && r.time?.status === "pending" ? { text: "Atrasado", colour: "var(--nv-warn)" } : undefined,
        }));
        return (
          <section key={d.date} aria-label={d.label} className={cn("rounded-2xl border bg-card p-3", isToday ? "border-accent/60" : "border-line")} data-testid="week-day" data-date={d.date}>
            <h4 className="mb-1.5 flex flex-wrap items-center gap-2 px-1 text-[14px] font-semibold">
              <span className="first-letter:uppercase">{d.label}</span>
              {isToday && <Chip colour={colour}>Hoy</Chip>}
              <span className="flex-1" />
              <span className="font-mono text-[12.5px] font-normal text-dim">{doneN}/{d.rows.length} hechos</span>
            </h4>
            {rows.length === 0 ? (
              <p className="px-2 py-1.5 text-[13.5px] text-faint">Sin temas de esta ruta este día.</p>
            ) : (
              <ul className="space-y-0.5" aria-label={`Temas de ${d.label}`}>
                {rows.map((r) => <TopicRow key={`${r.folder}:${r.meta ?? ""}`} r={r} colour={colour} areaKey={areaKey} planId={planId} />)}
              </ul>
            )}
          </section>
        );
      })}
      {upcoming && <UpcomingWeeks weeks={upcoming} colour={colour} areaKey={areaKey} planId={planId} />}
    </div>
  );
}

export function AreaWork({ plan, subplanId, planId, areaName, areaId, subtitle, loggedMinutes = 0, rows, todayRows, weekDays, upcoming, sets, today, colour, practice, reviews, plannedMinutes, onStartBlock, weekNumber }: {
  /** el plan y el área (id de subplan): con ellos la Ejecución deja añadir temas y práctica extra a hoy */
  plan?: MentorPlan;
  subplanId?: string;
  planId: string;
  areaName: string;
  areaId?: string;
  /** el objetivo del área, bajo el título */
  subtitle?: string;
  /** minutos ya registrados hoy en esta área */
  loggedMinutes?: number;
  /** todos los temas de la ruta (sin Bases en un área) */
  rows: BoardRow[];
  /** los temas de hoy, con su parte y sus minutos */
  todayRows: BoardRow[];
  /** la semana en curso día a día (lunes a domingo) */
  weekDays?: WeekDayView[];
  /** las semanas siguientes (proyección), debajo de la semana en curso */
  upcoming?: UpcomingWeekView[];
  sets: AreaSets;
  today: string;
  colour: string;
  practice?: BoardPractice;
  /** los repasos de los temas de esta área (ya unidos con el plan) */
  reviews: ReviewRow[];
  plannedMinutes: number;
  onStartBlock?: () => void;
  weekNumber?: number;
}) {
  const areaKey = subplanId ?? areaId ?? "bases";
  const sub = plan?.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
  const [selectedSubject, setSelectedSubject] = usePersistedNav<string>(
    `mentor.runSubject.${plan?.id ?? "none"}.${subplanId ?? "none"}`,
    "all"
  );

  // El plan tiene fecha de inicio y de fin fijas: el ritmo necesario se pre-calcula por lotes en todaySubjectGroups
  const subjectGroups = useMemo(() => {
    // los fundamentos («Bases») no son una asignatura del área: tienen su propia pestaña
    const own = (sub?.groups ?? []).filter((g) => g.kind !== "bases");
    const groups = own.length > 0
      ? own
      : [{ id: "core", title: "Temas generales", kind: "knowledge" as const, order: 100 }];
    const allTopics = sub?.topics ?? [];
    return groups.map((g) => {
      const gTopics = allTopics.filter((t) => (t.group ?? "core") === g.id);
      const doneN = gTopics.filter((t) => !!t.completedAt).length;
      return {
        id: g.id,
        title: g.title,
        done: doneN,
        total: gTopics.length,
        pct: gTopics.length > 0 ? Math.round((doneN / gTopics.length) * 100) : 0,
      };
    });
  }, [sub]);

  const buckets = useMemo(() => bucketReviews(reviews, today), [reviews, today]);
  const todayTag = { text: "Hoy", colour };
  const lists = useMemo(() => {
    // UNA sola definición (`executionLists`): Hoy = lo que la Agenda reparte hoy a esta ruta; lo atrasado va a «Pendientes», no se mezcla en «Hoy»
    const l = executionLists(rows, todayRows, sets);
    const todayList = l.hoy.map((r) => ({ ...r, tag: todayTag }));
    const week = l.semana.map((r) => ({ ...r, tag: r.done ? { text: "Hecho", colour: "var(--nv-mint)" } : sets.today.has(r.folder) ? todayTag : undefined }));
    const pending = l.pendientes.map((r) => ({ ...r, tag: { text: "Atrasado", colour: "var(--nv-warn)" } }));
    return { hoy: todayList, semana: week, pendientes: pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, todayRows, sets, colour]);

  const weekCount = weekDays ? new Set(weekDays.flatMap((d) => d.rows.map((r) => r.folder))).size : lists.semana.length;
  const counts: Record<WorkView, number> = { hoy: lists.hoy.length, semana: weekCount, pendientes: lists.pendientes.length, repasos: reviews.length };
  const [sel, setSel] = useState<WorkView>("hoy");
  const view = sel;
  const showSubjects = view === "hoy" && !!sub && subjectGroups.some((g) => g.total > 0);
  const pa = practice?.areas.find((x) => x.areaId === areaId);
  const reviewsDue = buckets.today.length;
  const pendingToday = todayRows.filter((r) => !r.done).length;

  const todaySubjectGroups = useMemo(() => {
    if (!sub || view !== "hoy") return [];
    const topicGroup = new Map<string, string>();
    const groupFolders = new Map<string, Set<string>>();
    const groupEstMinutes = new Map<string, number>();

    for (const g of subjectGroups) {
      groupFolders.set(g.id, new Set<string>());
      groupEstMinutes.set(g.id, 0);
    }

    for (const t of sub.topics) {
      const gid = t.group ?? "core";
      topicGroup.set(t.folder, gid);
      const set = groupFolders.get(gid);
      if (set) set.add(t.folder);
      if (t.route !== "skipped" && t.route !== "optional") {
        groupEstMinutes.set(gid, (groupEstMinutes.get(gid) ?? 0) + (t.estMinutes ?? 0));
      }
    }

    // Required pace calculation in a single batch
    const groupsToPace = subjectGroups
      .filter((g) => g.total - g.done > 0)
      .map((g) => ({
        id: g.id,
        title: g.title,
        total: g.total,
        pending: g.total - g.done,
        totalMinutes: groupEstMinutes.get(g.id) ?? 0,
      }));

    const paceNeedMap = new Map<string, string>();
    if (plan && groupsToPace.length > 0) {
      const r = requiredPace({
        today,
        start: plan.start,
        end: plan.end,
        studyDays: plan.preconditions?.studyDays ?? [],
        ...(plan.preconditions?.minutesPerDay ? { minutesPerDay: plan.preconditions.minutesPerDay } : {}),
        groups: groupsToPace,
      });
      const endLabel = new Date(`${plan.end}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "short" });
      for (const g of r.groups) {
        paceNeedMap.set(g.id, paceNeedText(g, endLabel));
      }
    }

    return subjectGroups.map((grp) => {
      const inGroup = groupFolders.get(grp.id) ?? new Set<string>();
      const grpRows = lists.hoy.filter((r) => (topicGroup.get(r.folder) ?? "core") === grp.id);
      const nextRows = fillSubjectRows(rows, inGroup, grpRows);
      const paceText = paceNeedMap.get(grp.id);

      return {
        grp,
        grpRows,
        nextRows,
        paceText,
      };
    });
  }, [sub, view, subjectGroups, lists.hoy, rows, today, plan]);

  return (
    <section aria-label={`Trabajo de ${areaName}`} data-testid="area-work" className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="area-header">
        <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-xl text-[18px] font-bold text-white" style={{ background: colour }}>{areaName.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] font-bold leading-tight">{areaName}</h2>
            <Chip colour={pendingToday > 0 ? colour : "var(--nv-mint)"}>{pendingToday > 0 ? "En curso" : todayRows.length ? "Al día" : "Sin temas hoy"}</Chip>
            {reviewsDue > 0 && (
              <button type="button" onClick={() => setSel("repasos")} className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-warn/60 bg-warn-soft px-2 text-[12.5px] font-semibold text-warn" data-testid="reviews-due-chip">
                <CalendarClock size={13} aria-hidden /> {reviewsDue} {reviewsDue === 1 ? "repaso" : "repasos"} para hoy
              </button>
            )}
          </div>
          {subtitle && <p className="mt-0.5 line-clamp-2 text-[14px] text-dim" data-testid="area-subtitle">{subtitle}</p>}
        </div>
        {plannedMinutes > 0 && (
          <div className="min-w-44 rounded-xl border border-line bg-card px-3.5 py-2" data-testid="area-today-progress">
            <p className="text-[12px] text-dim">Tiempo registrado hoy</p>
            <p className="font-mono text-[15px] font-bold">{loggedMinutes} / {plannedMinutes} min</p>
            <div className="mt-1"><ProgressBar pct={Math.min(100, Math.round((loggedMinutes / plannedMinutes) * 100))} label="Tiempo registrado hoy frente al previsto" /></div>
          </div>
        )}
        {onStartBlock && <PrimaryButton large onClick={onStartBlock} data-testid="start-block"><Play size={14} aria-hidden /> Iniciar bloque</PrimaryButton>}
      </header>

      <div role="group" aria-label="Qué ver" className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-card p-1" data-testid="work-views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setSel(v.id)}
            data-testid={`work-view-${v.id}`}
            className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium", view === v.id ? "bg-accent text-white" : "text-dim hover:bg-hover hover:text-text")}
          >
            {v.label}
            <span className={cn("rounded-md px-1.5 text-[12px]", view === v.id ? "bg-white/20" : "bg-hover text-dim")}>{counts[v.id]}</span>
          </button>
        ))}
      </div>

      {view === "semana" && subjectGroups.length > 1 && (
        <nav aria-label="Asignaturas de la semana" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface p-1.5" data-testid="week-subjects-subnav">
          <button
            type="button"
            aria-pressed={selectedSubject === "all"}
            onClick={() => setSelectedSubject("all")}
            data-testid="week-subject-tab-all"
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              selectedSubject === "all" ? "bg-accent text-white" : "text-dim hover:bg-hover hover:text-text"
            )}
          >
            Todas las asignaturas ({lists.semana.length})
          </button>
          {subjectGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={selectedSubject === g.id}
              onClick={() => setSelectedSubject(g.id)}
              data-testid={`week-subject-tab-${g.id}`}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                selectedSubject === g.id ? "bg-accent text-white" : "text-dim hover:bg-hover hover:text-text"
              )}
            >
              <span>{g.title}</span>
              <span className={cn("rounded-full px-1.5 py-0.2 text-[11px]", selectedSubject === g.id ? "bg-white/20 text-white" : "bg-card text-dim")}>
                {g.done}/{g.total}
              </span>
            </button>
          ))}
        </nav>
      )}

      {view === "semana" && weekDays ? (
        weekCount === 0 ? (
          <div className="space-y-4">
            <p className="rounded-2xl border border-dashed border-line p-5 text-[14.5px] text-dim" data-testid="work-empty">Esta semana no hay temas repartidos en esta ruta.</p>
            {upcoming && <UpcomingWeeks weeks={upcoming} colour={colour} areaKey={areaKey} planId={planId} />}
          </div>
        ) : (
          <WeekView days={weekDays} today={today} colour={colour} areaKey={areaKey} planId={planId} weekNumber={weekNumber} {...(upcoming ? { upcoming } : {})} />
        )
      ) : view !== "repasos" ? (
        lists[view].length === 0 && !showSubjects ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-[14.5px] text-dim" data-testid="work-empty">
            {view === "hoy" ? "Hoy no toca ningún tema de esta ruta." : view === "semana" ? "Esta semana no hay temas repartidos en esta ruta." : "No tienes nada pendiente: un tema pasa aquí solo cuando se acaba su tiempo previsto sin completarlo."}
          </p>
        ) : (
          <div className="rounded-2xl border border-line bg-card p-3">
            {view === "hoy" && (
              <p className="mb-1.5 flex items-center gap-2 px-1.5 pt-0.5 font-mono text-[12px] font-semibold uppercase tracking-wider text-dim" data-testid="session-plan-header">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: colour }} /> Plan de sesión de hoy
                <span className="flex-1" />
                {plannedMinutes > 0 && <span className="normal-case tracking-normal">{plannedMinutes} min en total</span>}
              </p>
            )}
            {view === "hoy" && lists.hoy.length === 0 && <p className="mb-2 px-1.5 text-[14px] text-dim" data-testid="work-empty">Hoy no toca ningún tema de esta ruta. Estas son tus asignaturas: puedes adelantar los próximos temas de cualquiera.</p>}
            {view === "hoy" && sub ? (
              <div className="space-y-4">
                {todaySubjectGroups.map(({ grp, grpRows, nextRows, paceText }) => {
                  // TODAS las asignaturas con temas se ven en Ejecución, también las que hoy no tienen nada (HTML, CSS…): así se pueden seguir y adelantar
                  if (!grpRows.length && grp.total === 0) return null;
                  return (
                    <div key={grp.id} className="space-y-1.5" data-testid="today-subject-group" data-subject={grp.id} data-today={grpRows.length ? "true" : "false"}>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1 pt-1.5">
                        <span className="text-[13px] font-bold text-accent-text">{grp.title}</span>
                        <span className="text-[12px] font-medium text-dim" data-testid={`subject-progress-inline-${grp.id}`}>
                          {grp.done}/{grp.total} ({grp.pct}%)
                        </span>
                        {paceText && (
                          <span className="basis-full text-[12px] text-dim" data-testid={`subject-pace-${grp.id}`} title="Ritmo necesario para terminar esta asignatura en la fecha de fin del plan (días de estudio)">
                            Ritmo necesario: {paceText}
                          </span>
                        )}
                      </div>
                      {grpRows.length ? (
                        <ul className="space-y-1" aria-label={grp.title} data-testid="work-list">
                          {grpRows.map((r) => (
                            <TopicRow key={`${r.folder}:${r.meta ?? ""}`} r={r} colour={colour} areaKey={areaKey} planId={planId} />
                          ))}
                        </ul>
                      ) : (
                        <p className="px-1 text-[13.5px] text-dim" data-testid="subject-nothing-today">
                          Hoy no toca nada de esta asignatura ({grp.total - grp.done} {grp.total - grp.done === 1 ? "tema pendiente" : "temas pendientes"}){nextRows.length ? ": estos son los siguientes de su ruta." : "."}
                        </p>
                      )}
                      {nextRows.length > 0 && (
                        <ul className="space-y-1" aria-label={`Siguientes de ${grp.title}`} data-testid="subject-next-list" data-min={MIN_SUBJECT_TOPICS}>
                          {nextRows.map((r) => (
                            <TopicRow key={`next:${r.folder}`} r={{ ...r, tag: { text: "Siguiente", colour: "var(--nv-faint)" } }} colour={colour} areaKey={areaKey} planId={planId} />
                          ))}
                        </ul>
                      )}
                      {plan && subplanId && (
                        <div className="pt-1" data-testid="subject-add-topic" data-subject={grp.id}>
                          <AddExtraTopic planId={planId} date={today} area={subplanId} lockArea lockSession minDate={plan.start} maxDate={plan.end} subject={{ id: grp.id, title: grp.title, info: `${grp.done}/${grp.total} hechos (${grp.pct}%)` }} label={`Añadir más temas de ${grp.title}`} onChanged={bumpPlanVersion} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-1" aria-label={VIEWS.find((v) => v.id === view)!.label} data-testid="work-list">
                {lists[view].map((r) => <TopicRow key={`${r.folder}:${r.meta ?? ""}`} r={r} colour={colour} areaKey={areaKey} planId={planId} />)}
              </ul>
            )}
          </div>
        )
      ) : reviews.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-5 text-[14.5px] text-dim" data-testid="work-empty">
          Aún no hay repasos programados en esta ruta. Cada tema que practiques programa su primer repaso a los 3 días y los siguientes a los 7, 14, 30, 60 y 120.
        </p>
      ) : (
        <div className="space-y-4 rounded-2xl border border-line bg-card p-4" data-testid="work-reviews">
          <ReviewList title="Vencidos y de hoy" rows={buckets.today} colour={colour} areaKey={areaKey} />
          <ReviewList title="Esta semana" rows={buckets.week} colour={colour} areaKey={areaKey} />
          <ReviewList title="La próxima semana" rows={buckets.nextWeek} colour={colour} areaKey={areaKey} />
          <ReviewList title="Más adelante" rows={buckets.later} colour={colour} areaKey={areaKey} />
          <p className="px-1 text-[13px] text-faint">Son los mismos repasos del módulo de estudio: practicar un tema lo reprograma solo.</p>
        </div>
      )}

      {view === "hoy" && plan && subplanId && (
        <div className="flex flex-wrap items-center gap-2" data-testid="work-add-topic">
          <AddExtraTopic planId={planId} date={today} area={subplanId} lockArea lockSession minDate={plan.start} maxDate={plan.end} label="Añadir más temas al aprendizaje diario" onChanged={bumpPlanVersion} />
          <span className="text-[13px] text-dim">Mira los próximos temas de esta área y añádelos a la sesión diaria.</span>
        </div>
      )}

      {pa && practice ? (
        <AreaPracticeBlock
          planId={planId}
          area={pa as AreaPracticeView}
          mark={practice.mark}
          {...(plan && subplanId ? { extra: <ExtraPracticeSection plan={plan} date={today} subplanId={subplanId} topics={todayRows.map((r) => ({ folder: r.folder, title: r.title }))} /> } : {})}
        />
      ) : plan && subplanId ? (
        <ExtraPracticeSection plan={plan} date={today} subplanId={subplanId} topics={todayRows.map((r) => ({ folder: r.folder, title: r.title }))} standalone />
      ) : null}
    </section>
  );
}

/** Empieza un foco del Pomodoro en un área (el atajo «Iniciar bloque»); si ya hay uno en marcha, no hace nada. */
export function startAreaBlock(planId: string, areaKey: string): boolean {
  const st = usePomodoro.getState();
  if (st.p.phase !== "idle") return false;
  st.start(planId, areaKey);
  return true;
}
