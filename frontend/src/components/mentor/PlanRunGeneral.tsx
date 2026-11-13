// Mentor — Ejecución, pestaña «Plan de estudio»: las piezas de la vista general. Solo pintan lo que PlanRun ya calculó (nada se guarda aquí).
//
//  · `AreaFolds`: las áreas de un día como tarjetas plegables (punto de color, nombre, nº de temas y horas, estado) con sus temas dentro.
//  · `UpcomingCard`: «Lo que viene» — pestañas de los próximos días y, del elegido, su distribución por área.
//  · `CatchUpCard`: «Vas atrasado en N temas» — los temas atrasados por área, plegables, y el ritmo que hace falta para llegar a la fecha de fin.
//  · `FocusCard`: «Pomodoro & Práctica» — el reloj global del Pomodoro y el tiempo acumulado de hoy.
//  · `ReviewIntervals`: los intervalos del repaso espaciado.

import { AlertTriangle, ChevronDown, Pause, Play, Settings2, Timer } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/bridge";
import { clock, FOCUS_CHOICES, remainingMs } from "../../lib/pomodoro";
import { dateLabel, longDateLabel, type ScheduleDay } from "../../lib/planSchedule";
import { usePomodoro } from "../../store/pomodoro";
import { Chip, GhostButton, PrimaryButton } from "../common/forms";
import { cn } from "../ui";
import { useModuleVisible } from "../ModuleHost";
import { plural } from "./agendaKit";
import { hm, ProgressBar } from "./parts";
import { TimeChip, TopicMenu, type BoardRow } from "./PlanBoard";
import { TopicNoteLinks } from "./TopicNoteLinks";
import { STATE_LABEL } from "./planShared";
import type { TodayCard } from "./PlanRunTabs";

const EYEBROW = "font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-faint";

// ── Un tema dentro de una tarjeta de área ───────────────────────────────

export function DayTopicRow({ r, colour, areaKey, planId }: { r: BoardRow; colour: string; areaKey?: string; planId?: string }) {
  const locked = !!r.unlockOn;
  return (
    <li className={cn("flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5", locked && "opacity-60")} data-testid="day-topic" data-state={locked ? "bloqueado" : r.done ? "completo" : r.state}>
      <span aria-hidden className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border text-[11px] font-bold text-white" style={r.done ? { background: colour, borderColor: colour } : { borderColor: "var(--nv-line, currentColor)" }}>
        {r.done ? "✓" : null}
      </span>
      <span className="min-w-0 flex-1">
        {locked ? (
          <span className="block truncate text-[14.5px] font-semibold">{r.title}</span>
        ) : (
          <TopicMenu folder={r.folder} title={r.title} areaKey={areaKey} planId={planId} trigger={<span className={cn("block truncate text-[14.5px] font-semibold", r.done && "text-faint line-through decoration-faint/60")}>{r.title}</span>} className="w-full rounded-md hover:text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
        )}
        {r.sub && <span className="block truncate text-[12.5px] text-dim">{r.sub}</span>}
        <span className="sr-only">{locked ? "bloqueado" : r.done ? "completado" : STATE_LABEL[r.state]}</span>
      </span>
      {r.time && <TimeChip time={r.time} />}
      {!locked && <TopicNoteLinks folder={r.folder} title={r.title} />}
      {r.minutes ? <span className="flex-none whitespace-nowrap rounded-md bg-hover px-2 py-0.5 font-mono text-[12px] text-dim">{r.minutes} min</span> : null}
    </li>
  );
}

// ── Una tarjeta de área plegable ────────────────────────────────────────

export interface FoldItem {
  key: string;
  name: string;
  colour: string;
  rows: BoardRow[];
  minutes: number;
}

type FoldBadge = { text: string; colour: string } | null;

function Fold({ item, badge, defaultOpen, testid, planId }: { item: FoldItem; badge: FoldBadge; defaultOpen: boolean; testid: string; planId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <li className="rounded-2xl border border-line bg-card" data-testid={testid} data-area={item.key} data-open={open}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-hover/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <span aria-hidden className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: item.colour }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12.5px] font-bold uppercase tracking-wider">{item.name}</span>
          <span className="block text-[12.5px] text-dim">{plural(item.rows.length, "tema", "temas")} · {hm(item.minutes)}</span>
        </span>
        {badge && <Chip colour={badge.colour}>{badge.text}</Chip>}
        <ChevronDown size={16} aria-hidden className={cn("flex-none text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul id={id} className="space-y-2 px-3 pb-3" aria-label={`Temas de ${item.name}`}>
          {item.rows.length === 0 ? <li className="px-1 py-1 text-[13.5px] text-dim">Sin temas nuevos: repaso y práctica de mantenimiento.</li> : item.rows.map((r) => <DayTopicRow key={`${r.folder}:${r.meta ?? ""}`} r={r} colour={item.colour} areaKey={item.key} planId={planId} />)}
        </ul>
      )}
    </li>
  );
}

/** Las áreas de un día, plegables. La primera con temas por hacer va abierta (y es la que está «en progreso»); el resto, cerradas. */
export function AreaFolds({ items, planned = false, testid = "area-fold", planId }: { items: FoldItem[]; planned?: boolean; testid?: string; planId?: string }) {
  const firstOpen = Math.max(0, items.findIndex((i) => i.rows.some((r) => !r.done)));
  return (
    <ul className="space-y-2.5" aria-label="Áreas del día">
      {items.map((it, idx) => {
        const allDone = it.rows.length > 0 && it.rows.every((r) => r.done);
        const badge: FoldBadge = planned ? { text: "Programado", colour: "var(--nv-accent)" } : allDone ? { text: "Completo", colour: "var(--nv-mint)" } : idx === firstOpen && it.rows.length ? { text: "En progreso", colour: "var(--nv-accent)" } : null;
        return <Fold key={it.key} item={it} badge={badge} defaultOpen={idx === firstOpen} testid={testid} planId={planId} />;
      })}
    </ul>
  );
}

export const foldItemOf = (c: TodayCard): FoldItem => ({ key: c.entry.subplanId, name: c.entry.area, colour: c.colour, rows: c.rows, minutes: c.entry.theoryMinutes + c.entry.practiceMinutes });

// ── «Lo que viene» ──────────────────────────────────────────────────────

export function UpcomingCard({ days, selected, onSelect, cards, focusLabel, onOpenAgenda, children }: {
  days: ScheduleDay[];
  selected: string;
  onSelect: (date: string) => void;
  cards: TodayCard[];
  focusLabel?: string;
  onOpenAgenda: (date: string) => void;
  /** más cosas debajo (los entregables que vencen pronto) */
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(true);
  const day = days.find((d) => d.date === selected) ?? days[0];
  if (!day) return null;
  const items = cards.filter((c) => c.rows.length > 0 || c.entry.practiceMinutes > 0).map(foldItemOf);
  const topics = new Set(day.topics.map((t) => t.folder)).size;
  return (
    <section aria-labelledby="run-next-h" data-testid="run-next" className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-60">
          <h2 id="run-next-h" className="text-[20px] font-bold">Lo que viene</h2>
          <p className="text-[13.5px] text-dim">Los próximos días de estudio y los entregables que vencen pronto.</p>
        </div>
        <Chip colour="var(--nv-faint)">Próximos {plural(days.length, "día", "días")}</Chip>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Próximos días">
        {days.map((d) => (
          <button key={d.date} type="button" aria-pressed={d.date === day.date} aria-label={longDateLabel(d.date)} onClick={() => onSelect(d.date)} className={cn("inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-semibold", d.date === day.date ? "border-text bg-text text-bg" : "border-line text-dim hover:bg-hover")} data-testid="run-upcoming-day" data-date={d.date}>
            {dateLabel(d.date)}
          </button>
        ))}
        <span className="flex-1" />
        <GhostButton onClick={() => onOpenAgenda(day.date)} aria-label={`Ver en la Agenda: ${longDateLabel(day.date)}`} data-testid="run-upcoming-open">Ver en la Agenda</GhostButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
        <span className="font-semibold">{day.focus?.label ?? focusLabel ?? "Estudio"}</span>
        <span className="text-dim">{plural(topics, "tema", "temas")} · {hm(day.topicMinutes + day.practiceMinutes)}</span>
        <span className="flex-1" />
        <button type="button" aria-expanded={shown} onClick={() => setShown((v) => !v)} className="inline-flex min-h-8 items-center gap-1 text-[13px] text-dim hover:text-text" data-testid="run-upcoming-toggle">
          {shown ? "Ocultar temas" : "Mostrar temas"} <ChevronDown size={14} aria-hidden className={cn("transition-transform", shown && "rotate-180")} />
        </button>
      </div>

      {shown && (
        <div className="space-y-2.5" data-testid="run-upcoming-areas">
          <p className="flex items-center gap-2 px-1"><span className={EYEBROW}>Distribución de módulos</span><span className="flex-1" /><span className="text-[12.5px] text-faint">{plural(items.length, "área asignada", "áreas asignadas")}</span></p>
          {items.length === 0 ? <p className="px-1 text-[14px] text-dim">Ese día no tiene temas repartidos: queda para repaso o para recuperar lo atrasado.</p> : <AreaFolds key={day.date} items={items} planned testid="upcoming-fold" />}
        </div>
      )}
      {children}
    </section>
  );
}

// ── «Vas atrasado» ──────────────────────────────────────────────────────

export interface LateArea {
  area: string;
  colour: string;
  topics: Array<{ folder: string; title: string }>;
  minutes: number;
  subplanId?: string;
  planId?: string;
}

export function CatchUpCard({ heading, total, areas, summary, warning }: { heading?: string; total: number; areas: LateArea[]; summary: ReactNode; warning?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section role="status" className="space-y-3 rounded-2xl border border-warn/50 bg-warn-soft p-5" data-testid="run-catchup">
      <header className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-warn text-white"><AlertTriangle size={18} /></span>
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-bold">{heading ?? `Vas atrasado en ${plural(total, "tema", "temas")}`} <Chip colour="var(--nv-warn)">Ajuste necesario</Chip></h2>
          <p className="text-[13px] text-dim">Pulsa para desplegar y ocultar los temas por área.</p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-9 items-center gap-1 text-[13px] text-dim hover:text-text" data-testid="run-catchup-toggle">
          {open ? "Ocultar detalles" : "Ver detalles"} <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </header>
      {open && (
        <ul className="space-y-2" aria-label="Atraso por área" data-testid="run-catchup-areas">
          {areas.map((a, i) => (
            <LateFold key={a.area} a={a} defaultOpen={i === 0} />
          ))}
        </ul>
      )}
      <p className="rounded-xl border border-warn/40 bg-card/70 px-4 py-3 text-[14px]" data-testid="run-catchup-summary">{summary}</p>
      {warning}
    </section>
  );
}

function LateFold({ a, defaultOpen }: { a: LateArea; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <li className="rounded-2xl border border-line bg-card" data-area={a.area}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left hover:bg-hover/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <span aria-hidden className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: a.colour }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-bold uppercase tracking-wider">{a.area}</span>
        <Chip colour="var(--nv-warn)">{plural(a.topics.length, "atrasado", "atrasados")}</Chip>
        <span className="flex-none text-[12.5px] text-dim">~{hm(a.minutes)} estimadas</span>
        <ChevronDown size={16} aria-hidden className={cn("flex-none text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul id={id} className="space-y-1 px-4 pb-3" aria-label={`Atrasados de ${a.area}`}>
          {a.topics.map((t) => (
            <li key={t.folder} className="flex items-center gap-2 text-[14px]" data-testid="late-topic">
              <span aria-hidden className="inline-block h-1.5 w-1.5 flex-none rounded-full bg-warn" />
              <TopicMenu folder={t.folder} title={t.title} areaKey={a.subplanId ?? a.area} planId={a.planId} trigger={<span className="block truncate">{t.title}</span>} className="w-full rounded-md hover:text-accent-text" />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Repaso espaciado ────────────────────────────────────────────────────

const INTERVALS = ["3d", "7d", "14d", "30d", "60d", "120d"] as const;

export function ReviewIntervals() {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Intervalos del repaso espaciado" data-testid="run-review-intervals">
      {INTERVALS.map((i) => <li key={i} className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12px] text-dim">{i}</li>)}
    </ul>
  );
}

// ── Pomodoro & Práctica ─────────────────────────────────────────────────

export function FocusCard({ areaKey, planId, session, loggedMinutes, goalMinutes, onBusy }: { areaKey: string; planId: string; session: number; loggedMinutes: number; goalMinutes: number; onBusy: () => void }) {
  const p = usePomodoro((s) => s.p);
  const { start, pause, resume, setDurations } = usePomodoro.getState();
  const [now, setNow] = useState(() => Date.now());
  const visible = useModuleVisible();
  useEffect(() => {
    if (!visible || p.phase === "idle" || !p.running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [p.phase, p.running, visible]);
  const idle = p.phase === "idle";
  const left = idle ? p.focusMin * 60_000 : remainingMs(p, now);
  const status = idle ? `Bloque de ${p.focusMin} min listo` : p.phase === "break" ? "Descanso" : p.running ? "En foco" : "En pausa";
  const dot = idle ? "var(--nv-mint)" : p.running ? "var(--nv-accent)" : "var(--nv-warn)";
  const cycle = (): void => {
    if (!idle) return;
    const i = FOCUS_CHOICES.indexOf(p.focusMin as (typeof FOCUS_CHOICES)[number]);
    setDurations(FOCUS_CHOICES[(i + 1) % FOCUS_CHOICES.length]!, p.breakMin);
  };
  const pct = goalMinutes > 0 ? Math.min(100, Math.round((loggedMinutes / goalMinutes) * 100)) : 0;
  return (
    <section aria-labelledby="run-focus-h" className="space-y-3 rounded-2xl border border-line bg-card p-5" data-testid="run-focus">
      <header className="flex items-center gap-3">
        <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-text text-bg"><Timer size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className={EYEBROW}>Tiempo de enfoque</p>
          <h2 id="run-focus-h" className="text-[16px] font-bold">Pomodoro &amp; Práctica</h2>
        </div>
        <Chip colour="var(--nv-faint)">Sesión #{session}</Chip>
      </header>
      <div className="space-y-3 rounded-xl border border-line bg-surface px-4 py-4 text-center">
        <p className="inline-flex items-center gap-2 text-[12.5px] text-dim"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} /> {status}</p>
        <p className="font-mono text-[40px] font-bold leading-none tabular-nums" data-testid="run-focus-clock" aria-live="off">{clock(left)}</p>
        <div className="flex items-center gap-2">
          {idle ? (
            <PrimaryButton large className="flex-1" onClick={() => (p.pendingAssessment ? onBusy() : start(planId, areaKey))} data-testid="run-focus-start"><Play size={14} aria-hidden /> Iniciar Pomodoro</PrimaryButton>
          ) : (
            <PrimaryButton large className="flex-1" onClick={() => (p.running ? pause() : resume())} data-testid="run-focus-toggle">{p.running ? <><Pause size={14} aria-hidden /> Pausar</> : <><Play size={14} aria-hidden /> Continuar</>}</PrimaryButton>
          )}
          <GhostButton large onClick={cycle} disabled={!idle} title={idle ? `Duración del bloque: ${p.focusMin} min (pulsa para cambiar)` : "Solo se cambia entre bloques"} aria-label={`Duración del bloque: ${p.focusMin} minutos`} data-testid="run-focus-duration"><Settings2 size={15} aria-hidden /></GhostButton>
        </div>
      </div>
      <div>
        <p className="flex items-baseline gap-2 text-[13px] text-dim">Tiempo registrado hoy <span className="flex-1" /><strong className="text-[15px] text-text" data-testid="run-focus-logged">{loggedMinutes} min</strong>{goalMinutes > 0 && <span>/ Meta {hm(goalMinutes)}</span>}</p>
        <div className="mt-1.5"><ProgressBar pct={pct} label="Tiempo registrado hoy frente a la meta" /></div>
      </div>
      <p className="text-[12.5px] text-faint">{loggedMinutes === 0 ? "Aún no has registrado tiempo. Abre un área y empieza un Pomodoro para sincronizar tus avances automáticamente." : "Cada bloque que guardas queda en el registro de horas del área."}</p>
    </section>
  );
}

// ── «Empezar hoy» ───────────────────────────────────────────────────────

const COLD_RETRY_MS = 1500;
const COLD_RETRY_MAX = 40;

/**
 * Aviso de la vista general cuando el plan arrancó antes de que empieces a estudiar (o vas atrasado): ofrece mover el comienzo a hoy.
 * Aplica la operación determinista `restart` (repartir todo lo que falta desde hoy hasta la misma fecha de fin; lo completado se conserva),
 * pide confirmación y se puede deshacer, aquí mismo o en «Preguntas y ajustes».
 */
export function RestartBar({ planId, start, end, today, late, started, onDone }: { planId: string; start: string; end: string; today: string; late: number; started: boolean; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const body = { id: planId, ops: [{ op: "restart", date: today }], label: "Empezar el plan hoy" };
      let r = await api.mentorPlanChange(body);
      for (let i = 0; r.loading && i < COLD_RETRY_MAX; i++) {
        await new Promise((ok) => setTimeout(ok, COLD_RETRY_MS));
        r = await api.mentorPlanChange(body);
      }
      if (r.loading) throw new Error("El índice de la vault tarda demasiado en estar listo. Inténtalo de nuevo en un momento.");
      if (!alive.current) return;
      if (!r.applied) {
        setError("No se pudo mover el comienzo: quedan menos de dos semanas de plan o la fecha ya es la de inicio.");
        return;
      }
      setConfirming(false);
      setDone(true);
      onDone();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.mentorPlanChangeUndo(planId);
      if (!alive.current) return;
      setDone(false);
      onDone();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (done) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-mint/50 bg-card px-4 py-3" data-testid="run-restart-done">
        <p role="status" className="min-w-0 flex-1 basis-64 text-[14px]"><strong>Listo: tu plan empieza hoy.</strong> Los temas que faltan se repartieron desde {dateLabel(today)} hasta el {dateLabel(end)}.</p>
        <GhostButton disabled={busy} onClick={() => void undo()} data-testid="run-restart-undo">Deshacer</GhostButton>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border-2 border-accent/50 bg-card px-4 py-3.5" data-testid="run-restart">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-[16px] font-semibold">{started ? `Vas atrasado en ${plural(late, "tema", "temas")}: ¿replanificar desde hoy?` : "Tu plan empezó antes de que empezaras a estudiar"}</h2>
          <p className="text-[14px] text-dim">
            El plan arrancó el {dateLabel(start)}. {started ? "Replanificar" : "Empezar hoy"} reparte lo que falta desde {dateLabel(today)} hasta el {dateLabel(end)}, empezando por el primer tema de la ruta. No pierdes nada de lo hecho.
          </p>
        </div>
        <PrimaryButton large disabled={busy || confirming} onClick={() => setConfirming(true)} data-testid="run-restart-open">{started ? "Replanificar desde hoy" : "Empezar hoy"}</PrimaryButton>
      </div>
      {confirming && (
        <div role="group" aria-label="Confirmar" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-3" data-testid="run-restart-confirm" onKeyDown={(e) => { if (e.key === "Escape") setConfirming(false); }}>
          <p className="min-w-0 flex-1 basis-64 text-[14px]">Cambia las fechas de todos los temas pendientes. Queda en «Preguntas y ajustes» y se puede deshacer.</p>
          <PrimaryButton disabled={busy} onClick={() => void apply()} data-testid="run-restart-apply">Aplicar</PrimaryButton>
          <GhostButton disabled={busy} onClick={() => setConfirming(false)}>Cancelar</GhostButton>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[14px] text-danger">{error}</p>}
    </section>
  );
}
