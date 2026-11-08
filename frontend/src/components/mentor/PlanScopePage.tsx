// Mentor — Planeación: UNA página del plan, al estilo de un documento: la Vista general (todo el plan), la de cada ÁREA o la de Bases.
// Cabecera (título grande, bloque de propiedades y la nota de práctica con el Mentor) y pestañas «Semana N · Calendario · Temas/Por área ·
// Proyectos». La semana, el mes, el calendario y el detalle de un día son las piezas de siempre de la Agenda, filtradas por el alcance de la página.
//
// Las claves guardadas son las de siempre: el área elegida (`mentor.agendaArea.<plan>`), la vista Semana|Mes (`mentor.agendaView.<plan>`) y la fecha
// pedida por un enlace profundo (`mentor.agendaDate.<plan>`, consumida una vez). La pestaña de cada página se recuerda en `mentor.pageTab.<plan>.<alcance>`.

import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { canShift, clampToPlan, dateLabel, deliverablesText, dayBlockCounts, longDateLabel, monthSummary, periodTitle, shiftAnchor, topicsText, weekSummary, type AgendaView } from "../../lib/planSchedule";
import { daysBetween, isDate, weeksLabel } from "../../lib/planTime";
import { BASES_KEY } from "../../lib/planAreaTopics";
import { orderedAreas } from "../../lib/planTopicsByArea";
import { routeStarted } from "../../lib/planTopicTime";
import type { MentorPlan, MentorPlanStatus } from "../../lib/types";
import { useNavState, usePersistedNav } from "../../store/navState";
import { Chip, GhostButton } from "../common/forms";
import { cn } from "../ui";
import { AgendaCalendar } from "./AgendaCalendar";
import { AreaTimeInline, AreaTimesPanel } from "./AreaTimeEditor";
import { PracticeCurriculumBar, MonthProjects, WeekProjects } from "./AgendaDayFocus";
import { DayDetail, MonthDetail, WeekDetail } from "./AgendaViews";
import { AreaDot, DeliverablesPendingNote } from "./AreaViews";
import { activeAreas, areaState, normalizePageTab, scopeDeliverables, scopeInfo, scopeKey, scopePeriodSummary, scopeProgress, scopeRouteEnd, type PageScope } from "./mentorAreas";
import { hasBasesRoute, PAGE_BASES, pageAreaId, PLAN_NAV_PREFIX } from "./mentorNav";
import { MonthlyDeliverables } from "./MonthlyDeliverables";
import { DeliverableLine, useAgendaModel, type AgendaModel } from "./agendaKit";
import { AreaWeek } from "./PlanAreaWeek";
import { PhaseMonthTable } from "./PlanMonths";
import { AddTopicSlot } from "./PlanPageSlots";
import { PlanAreaTopics } from "./PlanAreaTopics";
import { PhaseTimeline } from "./PlanSubplans";
import { Tabs, TabPanel, type TabDef } from "./planKit";
import { openPractice } from "./PracticeCard";
import { ProgressBar } from "./parts";
import { agendaDateKey, agendaViewKey, pageTabKey, STATUS_COLOUR, STATUS_LABEL, type Loaded } from "./planShared";
import { DepthBanner } from "./DepthBanner";
import { MethodologyWarningBanner } from "./MethodologyWarningBanner";
import { useAutoOrganize } from "./useAutoOrganize";
import { useAutoSync } from "./useAutoSync";
import { VaultSyncBanner } from "./VaultSyncBanner";
import { api } from "../../lib/bridge";

const PREFIX = "page-tabs";
const SECTION = "text-[13px] font-semibold uppercase tracking-wider text-faint";
const PROP_LABEL = "w-28 flex-none text-[13px] font-medium text-faint";

export interface PlanScopePageProps {
  data: Loaded;
  plan: MentorPlan;
  scope: PageScope;
  /** nombre del plan (el título de la Vista general) */
  planName: string;
  state: MentorPlanStatus;
  onChanged: (p: MentorPlan) => void;
  announce: (msg: string) => void;
  /** abre otra página de Planeación por su id de la barra (`pl:area/<subplan>`, `pl:bases`…) */
  onOpenPage: (navId: string) => void;
  /** la fecha que se mira, compartida entre las páginas mientras el plan está abierto (null = hoy) */
  anchorState: readonly [string | null, (d: string | null) => void];
  /** Vista general: lo que enseñan «Detalles» (resumen completo) y «Por área» (los temas de todas las áreas) */
  renderDetails?: () => ReactNode;
  renderByArea?: () => ReactNode;
  /** Vista general: avisos de la parte alta (falta generar, «todas las áreas desde el día 1», añadir un área) */
  renderNotices?: () => ReactNode;
  detailsBadge?: { n: number; label: string };
  /** avisos de la parte alta (plan propuesto, estructura antigua): van justo bajo el título para no romper el orden de los encabezados */
  topNotice?: ReactNode;
  /** pestaña por omisión cuando una clave antigua (`planSection`, `agendaView`) pide una concreta */
  defaultTab?: string;
}

/** Una propiedad del bloque de la cabecera: etiqueta a la izquierda y valor a la derecha. */
function Prop({ label, children, testid }: { label: string; children: ReactNode; testid?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1" data-testid={testid}>
      <dt className={PROP_LABEL}>{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-[15px] text-text">{children}</dd>
    </div>
  );
}

const rangeLabel = (a: string, b: string): string => `${dateLabel(a)} ${a.slice(0, 4)} – ${dateLabel(b)} ${b.slice(0, 4)}`;

export function PlanScopePage(props: PlanScopePageProps) {
  const { data, plan, scope, planName, state, onChanged, announce, onOpenPage, anchorState, renderDetails, renderByArea, renderNotices, detailsBadge, topNotice, defaultTab } = props;
  const uid = useId();
  const m = useAgendaModel(data, plan);
  useAutoSync(plan, onChanged);
  useAutoOrganize(plan, onChanged);
  const info = scopeInfo(plan, scope, planName);
  const key = scopeKey(scope);
  const summary0 = data.derived?.summary;

  // ── pestaña de la página y vista del periodo (Semana | Mes) ──
  const [storedTab, setStoredTab] = usePersistedNav<string>(pageTabKey(plan.id, key), defaultTab ?? "semana");
  const tab = normalizePageTab(storedTab, scope);
  const [storedView, setStoredView] = usePersistedNav<string>(agendaViewKey(plan.id), "semana");
  const period: "semana" | "mes" = storedView === "mes" ? "mes" : "semana";
  // el detalle de un día («Ver día») se mira en la fecha ancla: con él abierto, anterior/siguiente/Hoy mueven el día
  const [dayOpen, setDayOpen] = useState(false);

  // ── la fecha que se mira (hoy por defecto; un plan futuro, desde su inicio; uno terminado, en su último día) ──
  const pendingDate = usePersistedNav<string>(agendaDateKey(plan.id), "")[0];
  const [shared, setShared] = anchorState;
  const anchor = clampToPlan(isDate(shared) ? shared : isDate(pendingDate) ? pendingDate : data.today, plan);
  const setAnchor = useCallback((d: string) => setShared(clampToPlan(d, plan)), [setShared, plan]);
  // un enlace profundo («ver este día / mes en la Agenda»): la fecha se consume una vez y la vista pedida se traduce a esta página
  useEffect(() => {
    if (!isDate(pendingDate)) return;
    const nav = useNavState.getState();
    const wanted = String(nav.values[agendaViewKey(plan.id)] ?? "");
    setShared(clampToPlan(pendingDate, plan));
    setDayOpen(wanted === "dia");
    if (wanted === "calendario") nav.set(pageTabKey(plan.id, key), "calendario");
    else if (wanted === "dia" || wanted === "semana" || wanted === "mes") nav.set(pageTabKey(plan.id, key), "semana");
    if (wanted === "dia" || wanted === "calendario") nav.set(agendaViewKey(plan.id), "semana");
    nav.set(agendaDateKey(plan.id), "");
  }, [pendingDate, plan, key, setShared]);
  useEffect(() => {
    if (shared && shared !== clampToPlan(shared, plan)) setShared(clampToPlan(shared, plan));
  }, [plan, shared, setShared]);

  const week = Math.floor(daysBetween(plan.start, anchor) / 7) + 1;
  const month = anchor.slice(0, 7);
  const navView: AgendaView = dayOpen ? "dia" : tab === "calendario" ? "mes" : period;
  const showNav = tab === "semana" || tab === "calendario" || tab === "proyectos";
  const delText = useCallback((n: number): string => (m.deliverablesDefined ? deliverablesText(n) : "entregables por definir"), [m.deliverablesDefined]);

  // ── resumen del periodo (para lectores de pantalla y atajos) ──
  const summary = useMemo(() => {
    const scoped = scope.kind !== "all";
    if (navView === "dia") {
      const d = m.schedule.byDate.get(anchor);
      if (!d) return "fuera del plan";
      if (scoped) return scopePeriodSummary(m, scope, anchor, anchor, m.deliverablesDefined);
      const c = dayBlockCounts(d);
      return `${d.focus ? `enfoque ${d.focus.label}, ${c.theory} ${c.theory === 1 ? "teoría" : "teorías"}, ${c.practice} ${c.practice === 1 ? "práctica" : "prácticas"}, ` : ""}${topicsText(d.topics.length)}, ${delText((m.dueByDate.get(anchor) ?? []).length)}`;
    }
    if (navView === "semana") {
      const w = weekSummary(plan, m.schedule, week, m.deliverablesDefined ? m.deliverables : []);
      if (!w) return "";
      return scoped ? scopePeriodSummary(m, scope, w.start, w.end, m.deliverablesDefined) : `${topicsText(w.topics)}, ${delText(w.deliverables.length)}`;
    }
    const s = monthSummary(plan, m.schedule, month, m.deliverablesDefined ? m.deliverables : []);
    if (!s) return "";
    return scoped ? scopePeriodSummary(m, scope, s.start, s.end, m.deliverablesDefined) : `${topicsText(s.topics)}, ${delText(s.deliverables.length)}`;
  }, [navView, anchor, m, plan, week, month, delText, scope]);
  const title = periodTitle(navView === "mes" || tab === "calendario" ? "mes" : navView, anchor, plan);
  const live = useRef("");
  const lastTitle = useRef("");
  const [liveText, setLiveText] = useState("");
  const first = useRef(true);
  useEffect(() => {
    const t = `${title}: ${summary}.`;
    if (first.current) {
      first.current = false;
      live.current = t;
      lastTitle.current = title;
      return;
    }
    if (live.current !== t) {
      live.current = t;
      setLiveText(t);
      // al panel general del plan solo llega un cambio de periodo (no un cambio de cifras por editar el plan: ese lo anuncia quien lo edita)
      if (lastTitle.current !== title) announce(t);
      lastTitle.current = title;
    }
  }, [title, summary, announce]);

  // ── navegación por el tiempo ──
  const shift = (delta: number): void => setAnchor(shiftAnchor(navView === "dia" ? "dia" : navView, anchor, delta, plan));
  const noun = navView === "dia" ? "día" : navView === "semana" ? "semana" : "mes";
  const NOUN = navView === "dia" ? "Día" : navView === "semana" ? "Semana" : "Mes";
  const w = weekSummary(plan, m.schedule, week, []);
  const chip = navView === "dia" ? dateLabel(anchor) + " " + anchor.slice(0, 4) : navView === "semana" && w ? rangeLabel(w.start, w.end).replace(/ \d{4} –/, " –") : monthSummary(plan, m.schedule, month, [])?.label ?? month;
  const pickDay = (date: string): void => {
    setAnchor(date);
    setDayOpen(true);
    announce(`Detalle del día ${longDateLabel(date)}.`);
  };
  const closeDay = (): void => {
    setDayOpen(false);
    queueMicrotask(() => document.getElementById(`${uid}-w`)?.focus?.());
  };
  const pickWeek = (date: string): void => {
    setAnchor(date);
    setStoredView("semana");
  };

  // ── propiedades de la cabecera ──
  const progress = scopeProgress(plan, m, scope);
  const overall = scope.kind === "all" && summary0 ? { pct: summary0.pct, done: summary0.done, total: summary0.topics } : null;
  const pct = overall?.pct ?? progress.pct;
  // «Fechas» son SIEMPRE las del plan (inicio–fin y sus semanas); lo que termina antes o después es la ruta propia del área («Tu ruta de X: termina ~fecha»)
  const dates = { start: plan.start, end: plan.end };
  const routeEnd = scopeRouteEnd(m, scope);
  const weeks = Math.round(((Date.parse(dates.end) - Date.parse(dates.start)) / 86400000 + 1) / 7 * 10) / 10;
  const currentWeek = summary0?.currentWeek ?? week;
  const aState = scope.kind === "all" ? null : areaState(plan, scope, progress, currentWeek);
  const planLive = state === "activo";
  const stateChip =
    scope.kind === "all" || !planLive ? (
      <Chip large colour={STATUS_COLOUR[state]}>{plan.proposed ? "Propuesto" : plan.archived ? "Archivado" : STATUS_LABEL[state]}</Chip>
    ) : aState === "completo" ? (
      <Chip large colour="var(--nv-mint)">Completo</Chip>
    ) : aState === "proximo" ? (
      <Chip large colour="var(--nv-accent)">Próximo</Chip>
    ) : (
      <Chip large colour="var(--nv-mint)">Activo</Chip>
    );
  const pending = overall ? overall.total - overall.done : progress.pending;
  const areas = activeAreas(plan, currentWeek);
  const showBases = hasBasesRoute(plan);

  const tabs: TabDef[] = useMemo(() => {
    const list: TabDef[] = [{ id: "semana", label: period === "mes" ? "Mes" : `Semana ${week}` }, { id: "calendario", label: "Calendario" }];
    if (scope.kind === "all") list.push({ id: "area", label: "Por área" });
    else list.push({ id: "temas", label: `Temas ${info.name}` });
    list.push({ id: "proyectos", label: "Proyectos" });
    if (scope.kind === "all") list.push({ id: "detalles", label: "Detalles", ...(detailsBadge && detailsBadge.n > 0 ? { badge: detailsBadge.n, badgeLabel: detailsBadge.label } : {}) });
    return list;
  }, [period, week, scope.kind, info.name, detailsBadge]);

  // gancho «tema extra» de cada fila de día
  const dayExtra = (date: string): ReactNode => <AddTopicSlot plan={plan} scope={scope} date={date} onChanged={onChanged} announce={announce} />;
  const status = data.today < plan.start ? "El plan aún no ha empezado: este es su calendario desde la fecha de inicio." : data.today > plan.end ? "El plan ya terminó: puedes repasar cualquier día." : "";

  const activeSubplan = scope.kind === "area" ? plan.subplans.find((s) => s.id === scope.subplanId) : null;
  const areaPhase = activeSubplan?.phase ?? { fromWeek: 1, toWeek: weeks };

  const handleAreaWeeksChange = async (fromWeek: number, toWeek: number) => {
    if (!activeSubplan) return;
    try {
      const res = await api.mentorPlanAreaUpdate({
        planId: plan.id,
        subplanId: activeSubplan.id,
        fromWeek,
        toWeek,
      });
      onChanged(res.plan);
      announce(`Semanas de ${info.title} actualizadas a Semanas ${fromWeek}–${toWeek}`);
    } catch (err: any) {
      announce(err?.message || "No se pudieron actualizar las semanas");
    }
  };

  const handleAreaStateChange = async (st: "en_curso" | "pendiente" | "completada") => {
    if (!activeSubplan) return;
    try {
      const res = await api.mentorPlanAreaUpdate({
        planId: plan.id,
        subplanId: activeSubplan.id,
        state: st,
      });
      onChanged(res.plan);
      announce(`Estado de ${info.title} cambiado a ${st}`);
    } catch (err: any) {
      announce(err?.message || "No se pudo cambiar el estado del área");
    }
  };

  return (
    <div className="space-y-5 pt-4 min-w-0 max-w-full" data-testid="plan-agenda" data-scope={key}>
      <VaultSyncBanner planId={plan.id} />
      <DepthBanner planId={plan.id} {...(activeSubplan ? { subplanId: activeSubplan.id } : {})} />
      <MethodologyWarningBanner
        plan={plan}
        subplan={activeSubplan}
        onChanged={onChanged}
        announce={announce}
      />
      <header data-testid="plan-head" className="space-y-3">
        <h1 id="plan-title" tabIndex={-1} className="font-serif text-[34px] font-bold leading-tight tracking-tight outline-none @3xl:text-[44px]" data-testid="plan-page-title">{info.title}</h1>
        <dl className="divide-y divide-line py-1" aria-label="Propiedades" data-testid="plan-props">
          <Prop label="Estado" testid="prop-state">
            {stateChip}
            {scope.kind === "area" && (
              <select
                aria-label={`Cambiar estado de ${info.title}`}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    void handleAreaStateChange(e.target.value as any);
                    e.target.value = "";
                  }
                }}
                className="ml-2 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-dim focus:outline-none"
                data-testid="select-area-state"
              >
                <option value="" disabled>Modificar estado…</option>
                <option value="en_curso">En curso</option>
                <option value="pendiente">Pendiente</option>
                <option value="completada">Completada</option>
              </select>
            )}
            {plan.auto && scope.kind === "all" && <Chip large colour="var(--nv-warn)">Plan automático</Chip>}
          </Prop>
          <Prop label="Fechas" testid="prop-dates">
            <span>{rangeLabel(dates.start, dates.end)}</span>
            <Chip large>{weeksLabel(weeks)}</Chip>
            {scope.kind === "area" && (
              <div className="ml-2 flex items-center gap-1.5 text-xs text-dim" data-testid="area-calendar-weeks">
                <span>Calendario: Sem.</span>
                <select
                  aria-label="Semana inicio"
                  value={areaPhase.fromWeek}
                  onChange={(e) => void handleAreaWeeksChange(Number(e.target.value), Math.max(Number(e.target.value), areaPhase.toWeek))}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
                  data-testid="select-area-from-week"
                >
                  {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
                <span>a</span>
                <select
                  aria-label="Semana fin"
                  value={areaPhase.toWeek}
                  onChange={(e) => void handleAreaWeeksChange(Math.min(Number(e.target.value), areaPhase.fromWeek), Number(e.target.value))}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
                  data-testid="select-area-to-week"
                >
                  {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
            )}
          </Prop>
          {routeEnd && routeEnd !== plan.end && (
            <Prop label="Tu ruta" testid="prop-route-end">
              <span className="text-[14px] text-dim">Tu ruta de {info.name}: termina ~{dateLabel(routeEnd)} {routeEnd.slice(0, 4)}</span>
            </Prop>
          )}
          <Prop label="Progreso" testid="prop-progress">
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1"><ProgressBar pct={pct} label={`Avance de ${info.title}`} /></div>
              <span className="whitespace-nowrap text-[14px] text-dim" data-testid="prop-progress-text">Semana {currentWeek} · {pending} {pending === 1 ? "tema pendiente" : "temas pendientes"}</span>
            </div>
          </Prop>
          {scope.kind === "all" && (
            <Prop label="Áreas activas" testid="prop-areas">
              <ul className="flex flex-wrap gap-1.5" aria-label="Áreas activas">
                {areas.map((a) => (
                  <li key={a.subplanId}>
                    <button type="button" onClick={() => onOpenPage(`${PLAN_NAV_PREFIX}${pageAreaId(a.subplanId)}`)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[14px] font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-testid="prop-area-chip" data-area={a.areaId ?? a.subplanId}>
                      <AreaDot {...(a.areaId ? { areaId: a.areaId } : {})} /> {a.area}
                    </button>
                  </li>
                ))}
                {showBases && (
                  <li>
                    <button type="button" onClick={() => onOpenPage(`${PLAN_NAV_PREFIX}${PAGE_BASES}`)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[14px] font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-testid="prop-area-chip" data-area="bases">
                      <AreaDot colour="var(--nv-accent)" /> Bases
                    </button>
                  </li>
                )}
              </ul>
            </Prop>
          )}
        </dl>
      </header>

      {topNotice}
      {scope.kind === "all" && renderNotices?.()}
      {status && <p className="text-[14px] text-dim" data-testid="agenda-status">{status}</p>}
      {plan.structure === "areas" && <PracticeCurriculumBar plan={plan} onChanged={onChanged} announce={announce} tip={scope.kind === "area" ? { area: info.name } : {}} />}

      <div className="space-y-3">
        <Tabs variant="underline" tabs={tabs} active={tab} onChange={(id) => { setStoredTab(id); setDayOpen(false); }} prefix={PREFIX} label={`Secciones de ${info.title}`} />

        {showNav && (
          <div role="group" aria-label="Navegación por el tiempo" className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="agenda-nav">
            <div role="group" aria-label="Periodo" className="inline-flex rounded-lg border border-line bg-card p-0.5" data-testid="agenda-period">
                {(["semana", "mes"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={tab !== "calendario" && !dayOpen && period === v} onClick={() => { setStoredView(v); setDayOpen(false); if (tab === "calendario") setStoredTab("semana"); }} data-testid={`agenda-period-${v}`} className={cn("min-h-9 rounded-md px-3 text-[14px] font-medium", tab !== "calendario" && !dayOpen && period === v ? "bg-accent text-white" : "text-dim hover:bg-hover hover:text-text")}>
                    {v === "semana" ? "Semana" : "Mes"}
                  </button>
                ))}
            </div>
            {dayOpen && (
              <button type="button" onClick={closeDay} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[14px] text-accent-text underline-offset-2 hover:underline" data-testid="agenda-day-back">
                <ArrowLeft size={15} aria-hidden /> Volver a Semana {week}
              </button>
            )}
            <span className="flex-1" />
            <GhostButton large aria-label={`${NOUN} anterior`} disabled={!canShift(navView, anchor, -1, plan)} onClick={() => shift(-1)} data-testid="agenda-prev">
              <ChevronLeft size={17} aria-hidden /><span className="sr-only">Anterior</span>
            </GhostButton>
            <GhostButton large onClick={() => setAnchor(data.today)} title={data.today < plan.start || data.today > plan.end ? "Hoy queda fuera del plan: va a su extremo más cercano" : `Ir a hoy (${noun} actual)`} data-testid="agenda-today">Hoy</GhostButton>
            <GhostButton large aria-label={`${NOUN} siguiente`} disabled={!canShift(navView, anchor, 1, plan)} onClick={() => shift(1)} data-testid="agenda-next">
              <ChevronRight size={17} aria-hidden /><span className="sr-only">Siguiente</span>
            </GhostButton>
            <Chip large className="px-3 py-1.5 text-[13.5px]" colour="var(--nv-dim)"><span data-testid="agenda-range">{chip}</span></Chip>
            <label className="flex items-center gap-2 text-[14px] text-dim">
              <span className="sr-only">Ir a la fecha</span>
              <input type="date" value={anchor} min={plan.start} max={plan.end} onChange={(e) => isDate(e.target.value) && setAnchor(e.target.value)} data-testid="agenda-date" aria-label="Ir a la fecha" className="min-h-10 rounded-lg border border-line bg-surface px-2 py-1 text-[14px] text-text" />
            </label>
          </div>
        )}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="agenda-live">{liveText}</p>
        <p className="sr-only" data-testid="agenda-title" aria-hidden>{title} · {summary}</p>
      </div>

      <TabPanel prefix={PREFIX} id="semana" active={tab === "semana"} className="pt-0">
        <>
          {tab === "semana" && (
            dayOpen ? (
              <DayDetail m={m} date={anchor} onChanged={onChanged} headingId={`${uid}-d`} areaFilter={scope.kind === "area" ? scope.subplanId : null} />
            ) : period === "mes" ? (
              <>
                <MonthDetail m={m} month={month} onPickWeek={pickWeek} onChanged={onChanged} headingId={`${uid}-m`} only={scope.kind === "area" ? scope.subplanId : null} />
                {scope.kind === "all" && summary0 && (
                  <details open data-testid="agenda-phases" className="mt-4 rounded-2xl border border-line bg-card p-4">
                    <summary className="inline-flex min-h-9 cursor-pointer items-center text-[15px] font-semibold">Fases del plan, mes a mes</summary>
                    <p className="mb-3 mt-1 text-[13.5px] text-dim">Qué trabaja cada área en cada mes: temas y semanas activas. Pulsa un mes para verlo arriba.</p>
                    <PhaseMonthTable data={data} plan={plan} onOpenMonth={(_month, firstDay) => { setAnchor(firstDay); setStoredView("mes"); }} />
                    <details className="mt-3" data-testid="agenda-phases-bars">
                      <summary className="inline-flex min-h-8 cursor-pointer items-center text-[14px] text-accent-text">Ver las fases por semanas</summary>
                      <div className="mt-2"><PhaseTimeline plan={plan} currentWeek={summary0.currentWeek} weeks={summary0.weeks} /></div>
                    </details>
                  </details>
                )}
              </>
            ) : scope.kind === "all" ? (
              <WeekDetail m={m} week={week} onPickDay={pickDay} onChanged={onChanged} headingId={`${uid}-w`} only={null} dayExtra={dayExtra} />
            ) : (
              <AreaWeek m={m} scope={scope} week={week} onPickDay={pickDay} onChanged={onChanged} headingId={`${uid}-w`} dayExtra={dayExtra} />
            )
          )}
        </>
      </TabPanel>

      <TabPanel prefix={PREFIX} id="calendario" active={tab === "calendario"} className="pt-0">
        <>
          {tab === "calendario" && (
            <>
              {scope.kind === "all" ? <AreaTimesPanel plan={plan} /> : scope.kind === "area" ? <AreaTimeInline plan={plan} subplanId={scope.subplanId} /> : null}
              <AgendaCalendar m={m} anchor={anchor} onSelect={setAnchor} onChanged={onChanged} hideFilter />
            </>
          )}
        </>
      </TabPanel>

      {scope.kind !== "all" && (
        <TabPanel prefix={PREFIX} id="temas" active={tab === "temas"} className="pt-0">
          <>
            {tab === "temas" && (
              <PlanAreaTopics
                plan={plan}
                only={scope.kind === "bases" ? BASES_KEY : scope.subplanId}
                progress={new Map([...m.topicByFolder].map(([f, t]) => [f, t.pct] as const))}
                schedule={m.schedule}
                today={m.today}
                started={routeStarted([...m.topicByFolder.values()].map((t) => t.state), plan.subplans.some((s) => s.topics.some((t) => t.completedAt)))}
              />
            )}
          </>
        </TabPanel>
      )}

      {scope.kind === "all" && (
        <TabPanel prefix={PREFIX} id="area" active={tab === "area"} className="pt-0">
          <>
            {tab === "area" && (
              <div className="space-y-6" data-testid="plan-by-area">
                <AreaCards plan={plan} m={m} onOpenPage={onOpenPage} showBases={showBases} />
                {renderByArea?.()}
              </div>
            )}
          </>
        </TabPanel>
      )}

      <TabPanel prefix={PREFIX} id="proyectos" active={tab === "proyectos"} className="pt-0">
        <>{tab === "proyectos" && <ProjectsTab data={data} m={m} scope={scope} week={week} month={month} period={period} onChanged={onChanged} headingId={`${uid}-p`} />}</>
      </TabPanel>

      {scope.kind === "all" && (
        <TabPanel prefix={PREFIX} id="detalles" active={tab === "detalles"} className="pt-0">
          <>{tab === "detalles" && renderDetails?.()}</>
        </TabPanel>
      )}
    </div>
  );
}

/** «Por área»: una tarjeta por área (y Bases) con su avance, que abre su página. */
function AreaCards({ plan, m, onOpenPage, showBases }: { plan: MentorPlan; m: AgendaModel; onOpenPage: (navId: string) => void; showBases: boolean }) {
  const items: Array<{ id: string; navId: string; areaId?: string; name: string; scope: PageScope }> = [
    ...orderedAreas(plan).map((a) => ({ id: a.subplanId, navId: `${PLAN_NAV_PREFIX}${pageAreaId(a.subplanId)}`, areaId: a.areaId, name: a.area, scope: { kind: "area", subplanId: a.subplanId } as PageScope })),
    ...(showBases ? [{ id: "bases", navId: `${PLAN_NAV_PREFIX}${PAGE_BASES}`, name: "Bases", scope: { kind: "bases" } as PageScope }] : []),
  ];
  return (
    <section aria-label="Áreas del plan" data-testid="plan-area-cards">
      <h2 className={cn(SECTION, "mb-2")}>Áreas del plan</h2>
      <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
        {items.map((it) => {
          const p = scopeProgress(plan, m, it.scope);
          return (
            <li key={it.id}>
              <button type="button" onClick={() => onOpenPage(it.navId)} className="flex w-full flex-col gap-2 rounded-2xl border border-line bg-card p-3.5 text-left hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-testid="plan-area-card" data-area={it.id} aria-label={`Abrir ${it.name}: ${p.done} de ${p.total} temas hechos`}>
                <span className="flex items-center gap-2 text-[16px] font-semibold"><AreaDot {...(it.areaId ? { areaId: it.areaId } : it.id === "bases" ? { colour: "var(--nv-accent)" } : {})} />{it.name}</span>
                <ProgressBar pct={p.pct} label={`Avance de ${it.name}`} />
                <span className="text-[13.5px] text-dim">{p.done}/{p.total} temas · {p.pending} {p.pending === 1 ? "pendiente" : "pendientes"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** «Proyectos»: los proyectos semanales y mensuales del periodo y los entregables de la página. */
function ProjectsTab({ data, m, scope, week, month, period, onChanged, headingId }: { data: Loaded; m: AgendaModel; scope: PageScope; week: number; month: string; period: "semana" | "mes"; onChanged: (p: MentorPlan) => void; headingId: string }) {
  const areaId = scope.kind === "area" ? m.plan.subplans.find((s) => s.id === scope.subplanId)?.areaId : undefined;
  // planes por áreas: la cadena día → semana → mes (con su avance derivado) ya contiene los proyectos diarios, semanales y mensuales
  const chained = m.plan.structure === "areas" && scope.kind !== "bases";
  const list = m.deliverables
    .filter((d) => d.kind !== "kata" && d.kind !== "daily_project")
    .filter((d) => !chained || (d.kind !== "weekly_project" && d.kind !== "monthly_project"))
    .filter((d) => scope.kind === "all" || scopeDeliverables(m.plan, scope, [d]).length > 0)
    .filter((d) => scope.kind !== "all" || (period === "mes" ? d.dueDate.startsWith(month) : weekRange(m, week, d.dueDate)));
  return (
    <div className="space-y-5" data-testid="plan-projects">
      {chained && <MonthlyDeliverables data={data} {...(areaId ? { areaId } : {})} />}
      {!chained && m.schedule.mode === "focus" && (period === "mes" ? <MonthProjects m={m} month={month} headingId={`${headingId}-m`} onChanged={onChanged} /> : <WeekProjects m={m} week={week} headingId={`${headingId}-w`} onChanged={onChanged} />)}
      {!(chained && list.length === 0) && <section aria-labelledby={`${headingId}-d`} data-testid="plan-projects-deliverables">
        <h3 id={`${headingId}-d`} className={cn(SECTION, "mb-2")}>
          {scope.kind === "all" ? `Entregables ${period === "mes" ? "del mes" : "de la semana"}` : scope.kind === "bases" ? "Entregables de Bases" : "Entregables del área"} <span className="font-normal normal-case tracking-normal text-dim">({deliverablesText(list.length)})</span>
        </h3>
        {!m.deliverablesDefined && m.plan.structure !== "areas" ? (
          <DeliverablesPendingNote />
        ) : list.length === 0 ? (
          <p className="text-[14px] text-dim">{scope.kind === "bases" ? "Bases no tiene entregables propios: sus temas se trabajan dentro de las áreas." : "Sin entregables en esta página."}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((d) => <DeliverableLine key={d.id} d={d} showDate={dateLabel(d.dueDate)} onOpenPractice={openPractice} />)}
          </ul>
        )}
      </section>}
    </div>
  );
}

const weekRange = (m: AgendaModel, week: number, date: string): boolean => {
  const days = m.schedule.days.filter((d) => d.week === week);
  return days.length > 0 && date >= days[0]!.date && date <= days[days.length - 1]!.date;
};

