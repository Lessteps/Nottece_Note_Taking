// Mentor — Plan, VISTA DE EJECUCIÓN: la cara del plan para el día a día. La barra lateral (modo Ejecución) elige la vista y cada una enseña SOLO lo suyo:
//   · Hoy (general): el resumen de hoy (qué toca, la ruta sólida), el presupuesto de estudio, el avance de cada área y lo que viene.
//   · una pestaña por área: lo que toca hoy en esa área, su sesión (Pomodoro y registro de horas) y su ruta completa.
//   · Bases: los fundamentos que se intercalan en todas las áreas (no son de la ruta de Backend ni de ninguna otra).
//   · Proyectos: el proyecto diario y el semanal.
//   · Registros: el historial de lo practicado (PlanRecords).
// Es de SOLO LECTURA sobre el plan: no renombra, no reparte, no ajusta, no ejecuta. Todo se calcula con el mismo modelo de agenda que la
// vista de plan (`useAgendaModel`), así que ambas vistas nunca discrepan.

import { CalendarDays, Info, ListPlus, Lock } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../lib/bridge";
import { areaSets } from "../../lib/planAreaLists";
import { planGateByArea } from "../../lib/planGate";
import { catchUpOf } from "../../lib/planCatchUp";
import { bucketReviews, dueText, reviewsOfTopics, type ReviewRow } from "../../lib/planReviews";
import { addDays } from "../../lib/planTime";
import { clampToPlan, dateLabel, longDateLabel, type ScheduleDay } from "../../lib/planSchedule";
import { dailyProjectOf, weeklyProjectOf } from "../../lib/planCurriculum";
import { areaRouteTopics, basesClassifier, basesRouteTopics, dayBases, dayByArea, orderedAreas, type DayAreaEntry } from "../../lib/planTopicsByArea";
import type { PlanDeliverable } from "../../lib/planAreas";
import { routeStarted, timeTagOf, topicTimes } from "../../lib/planTopicTime";
import { minutesOn, minutesText } from "../../lib/timeLog";
import type { MentorPlan } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { usePomodoro } from "../../store/pomodoro";
import { useNavState, usePersistedNav } from "../../store/navState";
import { Chip, GhostButton, PrimaryButton } from "../common/forms";
import { cn } from "../ui";
import { useTimeLog } from "./AreaSession";
import { useReviewItems, type UpcomingWeekView, type WeekDayView } from "./AreaWork";
import { InterruptedRunBanner } from "./ExecutionBar";
import { openTopic } from "./openTopic";
import { AddExtraTopic } from "./AddExtraTopic";
import { bumpPlanVersion, removeExtraTopic } from "./extraKit";
import { ExtraPracticeSection } from "./ExtraPracticeSection";
import { DeliverableLine, focusColour, plural, useAgendaModel } from "./agendaKit";
import { hm, ProgressBar } from "./parts";
import { ProgressOverview, type BoardRow } from "./PlanBoard";
import { usePlanAreaPractice } from "./PracticeCard";
import { RunProjects } from "./PlanRunPractice";
import { RunArea, RunBases, type TodayCard } from "./PlanRunTabs";
import { InteractiveRoute } from "./InteractiveRoute";
import { AreaFolds, CatchUpCard, FocusCard, foldItemOf, ReviewIntervals, UpcomingCard, type FoldItem, type LateArea } from "./PlanRunGeneral";
import { SectionHeading } from "./planKit";
import { DAY_LONG, openAgendaAt, type Loaded } from "./planShared";
import { hasBasesRoute as planHasBasesRoute, RUN_TAB_GENERAL, RUN_TAB_RECORDS, runAreaTab, runAreaInteractiveTab, runAreaInformativeTab, runTabKey } from "./mentorNav";
import { PlanRecords } from "./PlanRecords";

import { VaultSyncBanner } from "./VaultSyncBanner";

const UPCOMING_DAYS = 5;
const DELIVERABLES_SHOWN = 4;
const NO_DUE: readonly PlanDeliverable[] = [];
const card = "rounded-2xl border border-line bg-card p-5";

export function PlanRun({ data, plan }: { data: Loaded; plan: MentorPlan }) {
  const m = useAgendaModel(data, plan);
  const setPending = useMentor((s) => s.setPendingObjective);
  const summary = data.derived?.summary;
  const real = m.today;
  const before = real < plan.start;
  const after = real > plan.end;
  const date = clampToPlan(real, plan);
  const day: ScheduleDay | undefined = m.schedule.byDate.get(date);
  const due = m.dueByDate.get(date) ?? NO_DUE;
  const langBlocks = (day?.blocks ?? []).filter((b) => b.daily && b.status !== "omitted");
  const topicsToday = day?.topics ?? [];
  const doneToday = topicsToday.filter((t) => t.done).length;
  const pctToday = topicsToday.length ? Math.round((doneToday / topicsToday.length) * 100) : 0;
  const isToday = date === real && !before && !after;
  const canPlan = isToday && !plan.proposed && !plan.archived && (topicsToday.some((t) => !t.done) || !!day?.practice.project);
  const upcoming = useMemo(() => m.schedule.days.filter((d) => d.date > date && d.study).slice(0, UPCOMING_DAYS), [m.schedule, date]);
  const nextStudy = before ? m.schedule.days.find((d) => d.study) : undefined;
  const currentWeek = day?.week ?? summary?.currentWeek ?? 1;
  const deliverables = m.deliverablesDefined
    ? m.deliverables.filter((d) => d.status !== "hecho" && d.dueDate >= date).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, DELIVERABLES_SHOWN)
    : [];
  // La ruta ha empezado cuando hay algún tema trabajado; mientras no, no hay atrasos ni ruta bloqueada.
  const started = useMemo(() => routeStarted([...m.topicByFolder.values()].map((t) => t.state), plan.subplans.some((s) => s.topics.some((t) => t.completedAt))), [m.topicByFolder, plan.subplans]);
  // Ruta sólida POR ÁREA: cada área no avanza sin cerrar su día pendiente más antiguo (un atraso en Frontend no bloquea Backend).
  const gate = useMemo(() => {
    const g = planGateByArea(m.schedule.days.map((d) => ({ date: d.date, topics: d.topics.map((t) => ({ folder: t.folder, done: t.done, subplanId: t.subplanId })) })), (f) => m.topicByFolder.get(f)?.state === "completo");
    // sin empezar la ruta no hay ruta bloqueada: lo de hoy se puede abrir tal como lo reparte la Agenda
    return started ? g : { ...g, locked: new Map<string, string>() };
  }, [m.schedule, m.topicByFolder, started]);
  // Aviso de constancia: lo atrasado y el ritmo que hace falta para llegar a la fecha de fin.
  const catchUp = useMemo(() => {
    const study = m.schedule.days.filter((d) => d.study && d.date >= date && d.date <= plan.end);
    const cap = study.length ? Math.round(study.reduce((n, d) => n + d.capacityMinutes, 0) / study.length) : 0;
    return catchUpOf(m.schedule.days.map((d) => ({ date: d.date, study: d.study, topics: d.topics.map((t) => ({ folder: t.folder, title: t.title, minutes: t.minutes, done: t.done, area: t.area })) })), date, plan.end, (f) => m.topicByFolder.get(f)?.state === "completo", cap);
  }, [m.schedule, m.topicByFolder, date, plan.end]);
  // La práctica diaria de cada área vive en la pestaña de su área. Cada área debe tener su carpeta en programming_practice: si falta, NO se crea
  // sola (es escribir notas en la vault): se avisa con una tarjeta y solo se crea (estructura, sin katas, sin sobrescribir) al pulsar el botón.
  const ap = usePlanAreaPractice(plan.id);
  const [creatingFolders, setCreatingFolders] = useState(false);
  const missingFolders = ap.data?.ppReady ? ap.data.areas.filter((a) => !a.folderReady) : [];
  const createFolders = async (): Promise<void> => {
    if (creatingFolders) return;
    setCreatingFolders(true);
    try {
      const r = await api.mentorAreaPracticeSetup(plan.id);
      useApp.getState().toast("info", r.created.length ? `Se crearon ${plural(r.created.length, "archivo", "archivos")} de práctica.` : "Las carpetas de práctica ya estaban creadas.");
      ap.reload();
    } catch (e) {
      useApp.getState().toast("error", (e as Error).message || "No se pudieron crear las carpetas de práctica.");
    } finally {
      setCreatingFolders(false);
    }
  };
  // Etiqueta de tiempo de cada tema: su ventana de reparto. Nada está pendiente hasta que la ruta empieza y su tiempo pasa.
  const times = useMemo(
    () => topicTimes(m.schedule.days.map((d) => ({ date: d.date, topics: d.topics.map((t) => ({ folder: t.folder, done: t.done || m.topicByFolder.get(t.folder)?.state === "completo" })) }))),
    [m.schedule, m.topicByFolder],
  );
  const behind = started && !!gate.frontier && gate.frontier < date && !plan.proposed && !plan.archived;
  const titleOf = (folder: string): string => m.topicByFolder.get(folder)?.title ?? folder.split("/").pop() ?? folder;
  // El reparto es POR AVANCE (ver `lib/planSchedule`): lo pendiente se coloca siempre desde hoy y en el orden de la ruta, así que nada queda
  // «atrasado» por haber pasado los días. Lo único que se avisa es lo que de verdad no cabe antes de la fecha de fin (desbordado).
  const overflow = useMemo(() => {
    const seen = new Map<string, { folder: string; title: string; area: string }>();
    for (const d of m.schedule.days) for (const t of d.topics) if (t.overflow && !t.done && m.topicByFolder.get(t.folder)?.state !== "completo" && !seen.has(t.folder)) seen.set(t.folder, { folder: t.folder, title: t.title, area: t.area });
    return [...seen.values()];
  }, [m.schedule, m.topicByFolder]);
  const { entries: timeEntries } = useTimeLog(plan.id);

  const planToday = () => {
    setPending({ type: "plan" });
    useNavState.getState().set("mentor.view", "hoy");
  };

  // Lo de hoy por área. Los fundamentos («Bases») NO son de ningún área: se sacan de las tarjetas de área (`dayByArea` ya no los trae) y van
  // juntos, sin repetirse, a su pestaña (`dayBases`). La regla de qué tema es de qué área es UNA sola, la de `lib/planTopicsByArea`.
  const isBases = useMemo(() => basesClassifier(plan), [plan]);
  const notBases = useCallback((t: { subplanId: string; group?: string; applied?: boolean }) => !isBases(t), [isBases]);
  const reviewData = useReviewItems();
  const reviewItems = useMemo(() => reviewData.data?.items ?? [], [reviewData.data]);
  const topicByFolder = m.topicByFolder;
  const rowOf = useCallback((i: { folder: string; title: string; part: number; parts: number; minutes: number; extra?: boolean }, withBases: boolean, sub?: string, rowDate: string = date): BoardRow => {
    const state = topicByFolder.get(i.folder)?.state ?? "sin_tratar";
    const time = timeTagOf(times.get(i.folder), state === "completo", date, started);
    return {
      ...(time ? { time } : {}),
      agendaDate: date,
      ...(sub ? { sub } : {}),
      ...(i.extra ? { extra: { remove: () => void removeExtraTopic(plan.id, rowDate, i.folder, () => undefined) } } : {}),
      minutes: i.minutes,
      folder: i.folder,
      title: i.title,
      meta: `${withBases ? "Bases · " : ""}${i.parts > 1 ? `parte ${i.part}/${i.parts} · ` : ""}${hm(i.minutes)}`,
      week: currentWeek,
      state,
      done: state === "completo",
      exercises: 0,
      ...(data.practiceOutdated?.[i.folder] ? { outdated: true } : {}),
      pct: topicByFolder.get(i.folder)?.pct ?? 0,
      unlockOn: gate.locked.get(i.folder),
    };
  }, [topicByFolder, times, date, started, currentWeek, gate, plan.id, data.practiceOutdated]);
  const kindText = (k: Set<string>): string => (k.has("theory") && k.has("practice") ? "Teoría + Práctica" : k.has("practice") ? "Práctica" : k.has("theory") ? "Teoría" : "");
  /** Las tarjetas de área de un día (sin fundamentos); `planned` = proyección (sin bloqueo de la ruta sólida). */
  const cardsOf = useCallback((ents: DayAreaEntry[], planned = false): TodayCard[] =>
    ents.map((e) => {
      const flat = (e.blocks ?? []).flatMap((bl) => bl.items.map((it) => ({ it, kind: bl.kind })));
      const kinds = new Map<string, Set<string>>();
      for (const { it, kind } of flat) {
        const key = `${it.folder}:${it.part}`;
        (kinds.get(key) ?? kinds.set(key, new Set()).get(key)!).add(kind);
      }
      const subOf = (i: { folder: string; part: number; parts: number }): string => [kindText(kinds.get(`${i.folder}:${i.part}`) ?? new Set()), i.parts > 1 ? `Parte ${i.part} de ${i.parts}` : ""].filter(Boolean).join(" · ");
      const seen = new Set<string>();
      const own = flat.map((x) => x.it).filter((i) => (seen.has(`${i.folder}:${i.part}`) ? false : (seen.add(`${i.folder}:${i.part}`), true)));
      const rows = own.map((i) => {
        const row = rowOf(i, false, subOf(i));
        if (!planned) return row;
        const { unlockOn: _unlock, ...rest } = row;
        return rest;
      });
      return { entry: e, rows, colour: focusColour(e.areaId), doneN: rows.filter((r) => r.done).length };
    }), [rowOf]);
  const entries = useMemo(() => (day ? dayByArea(plan, day, due) : []), [plan, day, due]);
  const cards: TodayCard[] = useMemo(() => cardsOf(entries), [cardsOf, entries]);
  const basesRows: BoardRow[] = useMemo(
    () => (day ? dayBases(plan, day).map((i) => rowOf(i, true, [kindText(new Set(i.kinds)), i.parts > 1 ? `Parte ${i.part} de ${i.parts}` : ""].filter(Boolean).join(" · "))) : []),
    [plan, day, rowOf],
  );
  const cardOf = useMemo(() => new Map(cards.map((c) => [c.entry.subplanId, c] as const)), [cards]);
  const areaList = useMemo(() => orderedAreas(plan), [plan]);
  const hasBasesRoute = planHasBasesRoute(plan);
  const routeRowOf = useCallback((t: { folder: string; title: string; targetWeek: number; completedAt?: string }): BoardRow => {
    const state = topicByFolder.get(t.folder)?.state ?? "sin_tratar";
    const isDone = state === "completo" || !!t.completedAt;
    const time = timeTagOf(times.get(t.folder), isDone, date, started);
    return { ...(time ? { time } : {}), agendaDate: date, folder: t.folder, title: t.title, week: t.targetWeek, state, done: isDone, exercises: topicByFolder.get(t.folder)?.exercises ?? 0, pct: topicByFolder.get(t.folder)?.pct ?? 0, unlockOn: gate.locked.get(t.folder), ...(data.practiceOutdated?.[t.folder] ? { outdated: true } : {}) };
  }, [topicByFolder, times, date, started, gate, data.practiceOutdated]);
  // la ruta de un área: su pertenencia sale de `areaRouteTopics` (sin fundamentos), igual que los totales de la Agenda
  const routeOf = useCallback((subplanId: string): BoardRow[] => areaRouteTopics(plan, subplanId).map(routeRowOf), [plan, routeRowOf]);
  // Repaso espaciado (el mismo calendario del módulo de estudio): los repasos de cada área, unidos con los temas del plan
  const reviewsOf = useCallback((subplanId: string): ReviewRow[] => reviewsOfTopics(areaRouteTopics(plan, subplanId), reviewItems), [plan, reviewItems]);
  // la semana del área de aprendizaje se mide por el avance de la ruta (si no se ha completado nada, hoy es Semana 1)
  const learningWeekOf = useCallback((subplanId: string | null): number => {
    const topics = subplanId ? areaRouteTopics(plan, subplanId) : basesRouteTopics(plan);
    if (!topics.length) return 1;
    const done = topics.filter((t) => t.completedAt || topicByFolder.get(t.folder)?.state === "completo").length;
    if (done === 0) return 1;
    const firstIncomplete = topics.find((t) => !t.completedAt && topicByFolder.get(t.folder)?.state !== "completo");
    if (!firstIncomplete) return Math.max(1, m.schedule?.weeks ?? 12);
    const minWeek = Math.min(...topics.map((t) => t.targetWeek || 1));
    return Math.max(1, (firstIncomplete.targetWeek ?? minWeek) - minWeek + 1);
  }, [plan, topicByFolder, m.schedule]);

  // la semana en curso día a día: ventana de 7 días de estudio desde hoy mostrando temas actuales y prediciendo siguientes
  const weekDaysOf = useCallback((subplanId: string | null): WeekDayView[] => {
    const endOfCurWeek = addDays(date, 6);
    return m.schedule.days
      .filter((d) => d.study && d.date >= date && d.date <= endOfCurWeek)
      .map((d) => {
        const seen = new Set<string>();
        const rows: BoardRow[] = [];
        for (const t of d.topics) {
          if (subplanId ? t.subplanId !== subplanId || isBases(t) : !isBases(t)) continue;
          if (seen.has(t.folder)) continue;
          seen.add(t.folder);
          rows.push(rowOf(t, subplanId === null, undefined, d.date));
        }
        // la Semana enseña lo MISMO que la Agenda (Semana): cada día con sus temas repartidos, también los de días anteriores (lo no terminado va además a «Pendientes»)
        return { date: d.date, label: `${DAY_LONG[d.dow - 1] ?? ""} ${dateLabel(d.date)}`, rows };
      })
      .filter((d) => d.rows.length > 0 || d.date >= date);
  }, [m.schedule, date, isBases, rowOf]);

  // lo que viene: las semanas siguientes a la actual, por bloques de 7 días de estudio numeradas por avance
  const upcomingWeeksOf = useCallback((subplanId: string | null): UpcomingWeekView[] => {
    const endOfCurWeek = addDays(date, 6);
    const futureDays = m.schedule.days.filter((d) => d.study && d.date > endOfCurWeek);
    const currentLrnWeek = learningWeekOf(subplanId);
    const out: UpcomingWeekView[] = [];
    const CHUNK_DAYS = 7;
    for (let i = 0; i < futureDays.length; i += CHUNK_DAYS) {
      const chunk = futureDays.slice(i, i + CHUNK_DAYS);
      const weekNum = currentLrnWeek + Math.floor(i / CHUNK_DAYS) + 1;
      const views = chunk
        .map((d) => {
          const seen = new Set<string>();
          const rows: BoardRow[] = [];
          for (const t of d.topics) {
            if (t.done || (subplanId ? t.subplanId !== subplanId || isBases(t) : !isBases(t))) continue;
            if (seen.has(t.folder)) continue;
            seen.add(t.folder);
            const { unlockOn: _unlock, ...row } = rowOf(t, subplanId === null, undefined, d.date);
            rows.push({ ...row, week: weekNum });
          }
          return { date: d.date, label: `${DAY_LONG[d.dow - 1] ?? ""} ${dateLabel(d.date)}`, rows };
        })
        .filter((d) => d.rows.length > 0);
      if (views.length) out.push({ week: weekNum, start: chunk[0]!.date, end: chunk[chunk.length - 1]!.date, days: views });
    }
    return out;
  }, [m.schedule, date, learningWeekOf, isBases, rowOf]);
  const basesTopicList = useMemo(() => basesRouteTopics(plan), [plan]);
  const basesRoute: BoardRow[] = useMemo(() => basesTopicList.map(routeRowOf).sort((a, b) => a.week - b.week), [basesTopicList, routeRowOf]);
  const basesReviews = useMemo(() => reviewsOfTopics(basesTopicList, reviewItems), [basesTopicList, reviewItems]);
  const planBuckets = useMemo(() => {
    const allTopics = plan.subplans.flatMap((sp) => sp.topics.filter((t) => t.route !== "skipped").map((t) => ({ folder: t.folder, title: t.title })));
    return bucketReviews(reviewsOfTopics(allTopics, reviewItems), date);
  }, [plan, reviewItems, date]);

  const [upSel, setUpSel] = useState("");
  const upDay = upcoming.find((d) => d.date === upSel) ?? upcoming[0];
  const upCards = useMemo(() => (upDay ? cardsOf(dayByArea(plan, upDay, m.dueByDate.get(upDay.date) ?? []), true) : []), [upDay, plan, m.dueByDate, cardsOf]);
  // la vista de la Ejecución la elige la barra lateral (ítems de `ejecucionLinks`) y se recuerda por plan
  const [tabSel, setTabSel] = usePersistedNav<string>(runTabKey(plan.id), RUN_TAB_GENERAL);
  const tab = tabSel === RUN_TAB_GENERAL || tabSel === RUN_TAB_RECORDS || tabSel === "proyectos" || (tabSel === "bases" && (basesRows.length > 0 || hasBasesRoute)) || areaList.some((a) => [runAreaTab(a.subplanId), runAreaInteractiveTab(a.subplanId), runAreaInformativeTab(a.subplanId)].includes(tabSel)) ? tabSel : RUN_TAB_GENERAL;
  const go = (id: string): void => setTabSel(id);
  const areaTab = tab.startsWith("area:") ? areaList.find((a) => [runAreaTab(a.subplanId), runAreaInteractiveTab(a.subplanId), runAreaInformativeTab(a.subplanId)].includes(tab)) : undefined;
  // lo pesado de cada vista se calcula solo cuando esa vista está abierta (y no al cambiar de pestaña o de modo)
  const areaView = useMemo(() => {
    if (!areaTab) return undefined;
    const id = areaTab.subplanId;
    return { routeRows: routeOf(id), weekDays: weekDaysOf(id), upcoming: upcomingWeeksOf(id), sets: areaSets(m.schedule.days, id, date, currentWeek, started, notBases), reviews: reviewsOf(id), weekNumber: learningWeekOf(id) };
  }, [areaTab, routeOf, weekDaysOf, upcomingWeeksOf, m.schedule, date, currentWeek, started, notBases, reviewsOf, learningWeekOf]);
  const basesView = useMemo(() => {
    if (tab !== "bases") return undefined;
    return { weekDays: weekDaysOf(null), upcoming: upcomingWeeksOf(null), sets: areaSets(m.schedule.days, null, date, currentWeek, started, isBases), weekNumber: learningWeekOf(null) };
  }, [tab, weekDaysOf, upcomingWeeksOf, m.schedule, date, currentWeek, started, isBases, learningWeekOf]);

  const planned = day ? day.topicMinutes + day.practiceMinutes : 0;
  const capacity = day?.capacityMinutes ?? 0;
  const excess = planned - capacity;
  const loggedToday = minutesOn(timeEntries, date);
  const lateMinutes = useMemo(() => {
    const out = new Map<string, number>();
    for (const d of m.schedule.days) for (const t of d.topics) if (!t.done) out.set(t.folder, (out.get(t.folder) ?? 0) + t.minutes);
    return out;
  }, [m.schedule]);
  // tarjetas plegables de hoy: las áreas con temas o práctica y, aparte, los fundamentos (Bases)
  const todayFolds: FoldItem[] = useMemo(() => [
    ...cards.filter((c) => c.rows.length > 0 || c.entry.practiceMinutes > 0).map(foldItemOf),
    ...(basesRows.length ? [{ key: "bases", name: "Bases", colour: "var(--nv-accent)", rows: basesRows, minutes: basesRows.reduce((n, r) => n + (r.minutes ?? 0), 0) }] : []),
  ], [cards, basesRows]);
  // «Hoy» es EXACTAMENTE lo que la Agenda reparte hoy (sin sustituirlo por lo atrasado): lo atrasado va a «Pendientes» de cada área.
  const hoyFolds = todayFolds;
  const pendingToday = hoyFolds.flatMap((f) => f.rows).filter((r) => !r.done);
  const assignToday = (): void => {
    const { assignTopic } = usePomodoro.getState();
    for (const r of pendingToday) assignTopic({ folder: r.folder, title: r.title, kind: "topic" });
    useApp.getState().toast("info", `${plural(pendingToday.length, "tema asignado", "temas asignados")} al Pomodoro.`);
  };
  const firstPending = cards.find((c) => c.rows.some((r) => !r.done));
  const focusAreaKey = firstPending?.entry.areaId ?? firstPending?.entry.subplanId ?? "libre";
  const overflowByArea = [...new Set(overflow.map((o) => o.area))].map((area) => ({ area, count: overflow.filter((o) => o.area === area).length }));
  const lateAreas: LateArea[] = overflowByArea.map((a) => {
    const topics = overflow.filter((l) => l.area === a.area);
    const sp = plan.subplans.find((x) => x.area === a.area);
    return { area: a.area, subplanId: sp?.id, planId: plan.id, colour: focusColour(sp?.areaId), topics: topics.map((t) => ({ folder: t.folder, title: t.title })), minutes: Math.round(topics.reduce((n, t) => n + (lateMinutes.get(t.folder) ?? 0), 0)) };
  });

  return (
    <div className="space-y-6 pb-4" data-testid="plan-run">
      <VaultSyncBanner planId={plan.id} />
      <InterruptedRunBanner planId={plan.id} />
      {missingFolders.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3" data-testid="run-missing-folders">
          <Info size={15} aria-hidden className="flex-none text-faint" />
          <p className="min-w-0 flex-1 basis-60 text-[13.5px] text-dim">
            Faltan carpetas de práctica en {plural(missingFolders.length, "área", "áreas")} ({missingFolders.map((a) => a.label).join(", ")}). Crearlas añade notas a tu vault (README, matriz de práctica y habilidades); nunca sobrescribe.
          </p>
          <PrimaryButton onClick={() => void createFolders()} disabled={creatingFolders} data-testid="run-create-folders">Crear carpetas</PrimaryButton>
        </div>
      )}
      {tab === "general" && (
        <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_24rem]" data-testid="run-general">
          <div className="min-w-0 space-y-6">
            {/* HOY */}
            <section aria-labelledby="run-today-h" data-testid="run-today" className={cn(card, "space-y-5")}>
              <header className="flex flex-wrap items-start gap-x-3 gap-y-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                    {isToday ? "Hoy" : before ? "El plan aún no empieza" : after ? "El plan terminó" : "Día del plan"}
                    {day && <> · Semana {day.week}</>}
                  </p>
                  <h2 id="run-today-h" className="text-[26px] font-bold leading-tight first-letter:uppercase">{longDateLabel(date)}</h2>
                  {behind && gate.frontier && (
                    <p className="mt-0.5 text-[13px] font-medium text-warn" data-testid="run-resuming-frontier">
                      Retomando ruta desde el {longDateLabel(gate.frontier)} · Semana {day?.week ?? 1}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {day?.focus && (
                    <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold">
                      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: focusColour(day.focus.id) }} />
                      Enfoque: {day.focus.label}
                    </span>
                  )}
                  {day?.study && pendingToday.length > 0 && (
                    <GhostButton large onClick={assignToday} data-testid="run-assign-today"><ListPlus size={15} aria-hidden /> Asignar temas</GhostButton>
                  )}
                  {canPlan && (
                    <PrimaryButton large onClick={planToday} data-testid="run-plan-day">
                      <CalendarDays size={16} aria-hidden /> Planear mi día
                    </PrimaryButton>
                  )}
                </div>
              </header>

              {behind && gate.blockers.length > 0 && (
                <div role="status" className="rounded-xl border border-warn/60 bg-warn-soft px-4 py-3.5" data-testid="run-gate">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-warn"><Lock size={15} aria-hidden /> Ruta sólida: termina primero los temas del {longDateLabel(gate.frontier!)}</p>
                  <p className="mt-1 text-[14px] text-dim">Hasta cerrar ese día, lo que viene después queda bloqueado. Te falta: {gate.blockers.slice(0, 5).map(titleOf).join(" · ")}{gate.blockers.length > 5 ? ` y ${gate.blockers.length - 5} más` : ""}.</p>
                  <GhostButton className="mt-2" onClick={() => openAgendaAt(plan.id, gate.frontier!, "dia")}>Ver ese día en la Agenda</GhostButton>
                </div>
              )}
              {before && nextStudy && <p className="text-[15px] text-dim" data-testid="run-before">Empieza el {longDateLabel(nextStudy.date)}. Mientras, repasa el plan en «Vista de plan».</p>}
              {after && <p className="text-[15px] text-dim" data-testid="run-after">Este plan ya terminó. Revisa tu avance por área en la columna de la derecha.</p>}
              {day && !day.study && !before && !after && <p className="text-[15px] text-dim" data-testid="run-rest">{day.blocked ? "Día bloqueado: hoy no hay estudio programado." : "Día de descanso: hoy no hay estudio programado."}</p>}

              {day?.study && (
                <>
                  {entries.length === 0 && langBlocks.length === 0 && !day.practice.project && (
                    <p className="text-[14px] text-dim">Sin temas repartidos hoy: queda para repaso o para recuperar lo atrasado.</p>
                  )}
                  {hoyFolds.length > 0 && (
                    <div data-testid="run-composition" className="space-y-3">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">Áreas programadas para hoy</span>
                        <span className="flex-1" />
                        <Chip colour="var(--nv-faint)">{plural(todayFolds.length, "módulo", "módulos")} · {plural(topicsToday.length, "tema", "temas")}</Chip>
                      </p>
                      <AreaFolds items={hoyFolds} planId={plan.id} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[14.5px] text-dim">
                      <span><strong className="text-text">{doneToday}/{topicsToday.length}</strong> {topicsToday.length === 1 ? "tema hecho" : "temas hechos"} hoy</span>
                      <span className="flex-1" />
                      <span className="text-[13px]">{pctToday} % completado</span>
                    </div>
                    <ProgressBar pct={pctToday} thick label="Avance de hoy" />
                  </div>
                  {(day.practice.project || langBlocks.length > 0) && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {(day.practice.project || langBlocks.length > 0) && (
                        <ul className="flex flex-wrap gap-2" aria-label="Práctica del día" data-testid="run-practice">
                          {day.practice.project && <li><Chip large colour="var(--nv-practice, #c58be0)">Proyecto semanal · {hm(day.practice.project.minutes)}</Chip></li>}
                          {langBlocks.map((b) => <li key={b.id}><Chip large colour="var(--nv-accent)">{b.label} · {hm(b.minutes)}</Chip></li>)}
                        </ul>
                      )}
                      <span className="flex-1" />
                    </div>
                  )}
                  {due.length > 0 && m.deliverablesDefined && (
                    <ul className="space-y-2" aria-label="Entregables de hoy">
                      {due.map((d) => <DeliverableLine key={d.id} d={d} />)}
                    </ul>
                  )}
                </>
              )}
              {isToday && !plan.proposed && !plan.archived && (
                <div className="space-y-2 border-t border-line pt-3" data-testid="run-extras">
                  <div className="flex flex-wrap items-center gap-2">
                    <AddExtraTopic planId={plan.id} date={date} minDate={plan.start} maxDate={plan.end} label="Próximos temas" onChanged={bumpPlanVersion} />
                    <span className="text-[13px] text-dim">Los temas adelantados salen en «Temas de hoy» y en la Agenda de hoy.</span>
                  </div>
                  <ExtraPracticeSection plan={plan} date={date} all topics={topicsToday.map((t) => ({ folder: t.folder, title: t.title }))} />
                </div>
              )}
            </section>

            {/* LO QUE VIENE: solo en la vista general */}
            {upDay ? (
              <UpcomingCard days={upcoming} selected={upDay.date} onSelect={setUpSel} cards={upCards} onOpenAgenda={(d) => openAgendaAt(plan.id, d, "dia")}>
                {deliverables.length > 0 && (
                  <ul className="space-y-2" aria-label="Próximos entregables">
                    {deliverables.map((d) => <DeliverableLine key={d.id} d={d} showDate={dateLabel(d.dueDate)} />)}
                  </ul>
                )}
              </UpcomingCard>
            ) : deliverables.length > 0 ? (
              <section aria-labelledby="run-next-h" data-testid="run-next" className={cn(card, "space-y-3")}>
                <SectionHeading id="run-next-h" hint="Los entregables que vencen pronto.">Lo que viene</SectionHeading>
                <ul className="space-y-2" aria-label="Próximos entregables">
                  {deliverables.map((d) => <DeliverableLine key={d.id} d={d} showDate={dateLabel(d.dueDate)} />)}
                </ul>
              </section>
            ) : null}

            {/* AVISO DE CONSTANCIA */}
            {!plan.proposed && !plan.archived && !before && !after && overflow.length > 0 && (
              <CatchUpCard
                heading={`${plural(overflow.length, "tema no cabe", "temas no caben")} antes de la fecha de fin`}
                total={overflow.length}
                areas={lateAreas}
                summary={<>Para terminar el {longDateLabel(plan.end)} debes completar <strong>{plural(catchUp.remaining, "tema pendiente", "temas pendientes")}</strong> en {plural(catchUp.daysLeft, "día de estudio", "días de estudio")}: unos <strong>{String(catchUp.perDay).replace(".", ",")} temas por día</strong> (≈ {hm(catchUp.minutesPerDay)}).</>}
                warning={catchUp.capacityPerDay > 0 && catchUp.minutesPerDay > catchUp.capacityPerDay ? <p className="text-[13.5px] text-warn">Eso supera tu tiempo diario de teoría ({hm(catchUp.capacityPerDay)}): sube el tiempo diario o mueve la fecha de fin.</p> : undefined}
              />
            )}

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <Info size={15} aria-hidden className="flex-none text-faint" />
              <p className="min-w-0 flex-1 basis-60 text-[13px] text-faint">Desde aquí no se cambia el plan: solo se marca la práctica del día.</p>
              <GhostButton onClick={() => openAgendaAt(plan.id, date, "dia")}>Ver el día en la Agenda</GhostButton>
              <PrimaryButton onClick={() => useNavState.getState().set("mentor.view", "cierre")} data-testid="run-close-day">Cerrar el día con el Mentor</PrimaryButton>
            </div>
          </div>

          {/* Columna lateral: presupuesto, repasos, avance de cada área y tiempo de enfoque */}
          <aside aria-label="Resumen del día" className="min-w-0 space-y-5">
            {day?.study && (
              <section aria-labelledby="run-budget-h" className={cn(card, "space-y-3")} data-testid="run-budget">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Objetivo diario</p>
                    <h2 id="run-budget-h" className="text-[17px] font-bold">Presupuesto de estudio</h2>
                  </div>
                  {excess > 0 ? <Chip colour="var(--nv-warn)">+{excess} min exceso</Chip> : <Chip colour="var(--nv-mint)">{minutesText(loggedToday)} · Al día</Chip>}
                </div>
                <p className="flex items-baseline gap-2 text-[14.5px] text-dim">Tiempo estimado hoy <span className="flex-1" /><strong className="text-[19px] text-text">{hm(planned)}</strong> / {hm(capacity)}</p>
                <ProgressBar pct={capacity ? Math.min(100, Math.round((planned / capacity) * 100)) : 0} thick label="Tiempo estimado de hoy frente al disponible" />
                <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
                  <div className="rounded-xl border border-line bg-surface px-3 py-2"><dt className="text-dim">Temas para hoy</dt><dd className="text-[19px] font-bold">{doneToday} / {topicsToday.length}</dd></div>
                  <div className="rounded-xl border border-line bg-surface px-3 py-2"><dt className="text-dim">Proyecto semanal</dt><dd className="text-[19px] font-bold">{day.practice.project ? hm(day.practice.project.minutes) : "—"}</dd></div>
                </dl>
              </section>
            )}
            <section aria-labelledby="run-reviews-h" className={cn(card, "space-y-3")} data-testid="run-reviews">
              <div className="flex items-center gap-2">
                <h2 id="run-reviews-h" className="flex-1 text-[17px] font-bold">Repasos espaciados</h2>
                <Chip colour="var(--nv-faint)">{planBuckets.today.length} hoy</Chip>
              </div>
              {planBuckets.today.length === 0 ? (
                <p className="text-[13.5px] text-dim">No tienes repasos vencidos ni para hoy. Cada tema que practicas programa el siguiente repaso en intervalos óptimos.</p>
              ) : (
                <ul className="space-y-1.5" aria-label="Repasos para hoy">
                  {planBuckets.today.slice(0, 6).map((r) => (
                    <li key={r.path} className="flex items-center gap-2 text-[14px]" data-testid="run-review-row">
                      <span className="min-w-0 flex-1"><span className="block truncate">{r.title}</span><span className="block text-[12.5px] text-dim">{dueText(r.inDays)}</span></span>
                      <GhostButton onClick={() => void openTopic(r.folder)} aria-label={`Ir a la práctica de repaso de ${r.title}`}>Ir al repaso</GhostButton>
                    </li>
                  ))}
                </ul>
              )}
              {planBuckets.today.length > 6 && <p className="text-[12.5px] text-faint">Y {planBuckets.today.length - 6} más: míralos en la pestaña de cada área, en «Por repasar».</p>}
              <p className="text-[12.5px] text-faint">{planBuckets.week.length} esta semana · {planBuckets.nextWeek.length} la próxima</p>
              <ReviewIntervals />
            </section>
            <ProgressOverview plan={plan} data={data} compact onPick={(id) => go(`area:${id}`)} />
            <FocusCard
              planId={plan.id}
              areaKey={focusAreaKey}
              session={timeEntries.filter((e) => e.date === date).length + 1}
              loggedMinutes={loggedToday}
              goalMinutes={capacity}
              onBusy={() => useApp.getState().toast("info", "Termina la evaluación del bloque anterior para empezar otro.")}
            />
            {loggedToday > 0 && (
              <section aria-labelledby="run-hours-h" className={cn(card, "space-y-2")} data-testid="run-hours">
                <div className="flex items-baseline gap-2">
                  <h2 id="run-hours-h" className="flex-1 text-[17px] font-bold">Horas de hoy</h2>
                  <strong className="text-[17px]">{minutesText(loggedToday)}</strong>
                </div>
                <ul className="space-y-1 text-[14px]" aria-label="Horas de hoy por área">
                  {[...areaList.map((a) => ({ key: a.areaId ?? a.subplanId, name: a.area })), { key: "bases", name: "Bases" }, { key: "libre", name: "Sesión libre" }]
                    .map((a) => ({ ...a, min: minutesOn(timeEntries, date, a.key) }))
                    .filter((a) => a.min > 0)
                    .map((a) => <li key={a.key} className="flex"><span className="flex-1 text-dim">{a.name}</span><span className="font-semibold">{minutesText(a.min)}</span></li>)}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {areaTab && areaView && tab === runAreaInteractiveTab(areaTab.subplanId) && <InteractiveRoute area={areaTab.area} rows={areaView.routeRows} onInformative={() => go(runAreaInformativeTab(areaTab.subplanId))} />}

      {areaTab && areaView && tab !== runAreaInteractiveTab(areaTab.subplanId) && (
        <RunArea
          plan={plan}
          area={areaTab}
          card={cardOf.get(areaTab.subplanId)}
          routeRows={areaView.routeRows}
          weekDays={areaView.weekDays}
          upcoming={areaView.upcoming}
          sets={areaView.sets}
          reviews={areaView.reviews}
          date={date}
          practice={ap.data && ap.data.areas.length ? { areas: ap.data.areas, today: ap.data.today || m.today, mark: ap.mark } : undefined}
          dailyProject={day ? dailyProjectOf(plan, m.schedule, day) : null}
          {...(day && weeklyProjectOf(plan, m.schedule, day.week) ? { weeklyProjectTitle: weeklyProjectOf(plan, m.schedule, day.week)!.title } : {})}
          onGoProjects={() => go("proyectos")}
          weekNumber={areaView.weekNumber}
        />
      )}

      {tab === "bases" && basesView && <RunBases plan={plan} routeRows={basesRoute} todayRows={basesRows} weekDays={basesView.weekDays} upcoming={basesView.upcoming} sets={basesView.sets} reviews={basesReviews} date={date} />}

      {tab === "proyectos" && <RunProjects plan={plan} data={data} m={m} />}

      {tab === RUN_TAB_RECORDS && <PlanRecords planId={plan.id} />}
    </div>
  );
}
