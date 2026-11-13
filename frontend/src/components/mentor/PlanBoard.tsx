// Mentor — Plan, vista de ejecución: las piezas comunes del tablero: la fila de un tema (`TopicRow`, cuya flecha ofrece ir al apunte (.md) o al
// archivo de práctica) y el avance de cada área (`ProgressOverview`). Solo lectura: marcar un tema como completado lo decide la práctica.
// Respeta la ruta sólida (`lib/planGate.ts`): los temas repartidos después del primer día sin terminar salen bloqueados.

import { BookOpen, CalendarDays, Compass, Dumbbell, LayoutDashboard, Lock, Network, Target, Timer } from "lucide-react";
import { useId, useState } from "react";
import { usePomodoro } from "../../store/pomodoro";
import { useApp } from "../../store/app";
import { mentorAssignment } from "../../lib/pomodoro";
import type { WorkKind } from "../../lib/timeLog";
import { dateLabel } from "../../lib/planSchedule";
import { orderedAreas } from "../../lib/planTopicsByArea";
import type { TopicTimeTag } from "../../lib/planTopicTime";
import type { MentorPlan, MentorTopicView } from "../../lib/types";
import { cn } from "../ui";
import { focusColour } from "./agendaKit";
import { ExtraTag } from "./extraKit";
import { openTopic, openTopicCanvas, openTopicNote } from "./openTopic";
import { openPlanAgenda, openPlanGeneral, openPlanTopic } from "./mentorNav";
import { openAgendaAt } from "./planShared";
import { TopicNoteLinks } from "./TopicNoteLinks";
import { InsightToggle, TopicInsight } from "./TopicInsight";
import { ProgressBar } from "./parts";
import type { AreaPracticeState } from "./PracticeCard";
import { RowMenu } from "./RowMenu";
import { SectionHeading } from "./planKit";
import { STATE_LABEL, type Loaded } from "./planShared";
import type { AreaPracticeView } from "../../lib/areaPracticeView";

export interface BoardRow {
  folder: string;
  /** grupo del área al que pertenece (Bases, Lenguaje: Python, Conocimientos…) */
  group?: string;
  /** texto secundario (parte, minutos…) */
  meta?: string;
  title: string;
  week: number;
  state: MentorTopicView["state"];
  done: boolean;
  exercises: number;
  unlockOn?: string;
  /** nivel de avance del tema (0–100), para enseñarlo en la fila */
  pct?: number;
  /** aviso a la derecha de la fila («Hoy», «Atrasado»…) */
  tag?: { text: string; colour?: string };
  /** etiqueta de tiempo: cuándo toca el tema y si ya pasó su tiempo (pendiente) */
  time?: TopicTimeTag;
  agendaDate?: string;
  /** minutos de este tema en el día y su texto secundario («Teoría + Práctica»), para las tarjetas de área del resumen */
  minutes?: number;
  sub?: string;
  /** tema añadido a mano a este día: lleva la marca «Extra» y, si hay `remove`, la × que lo quita */
  extra?: { remove?: () => void };
  /** si la fila es de Teoría o de Práctica (al asignarla al Pomodoro el bloque nace con ese tipo); sin dato, Teoría */
  work?: "theory" | "practice";
  outdated?: boolean;
}

const TIME_COLOUR: Record<TopicTimeTag["status"], string> = { done: "var(--nv-mint)", scheduled: "var(--nv-faint, #888)", current: "var(--nv-accent)", pending: "var(--nv-warn)" };

/** La etiqueta de tiempo de un tema: «Programado · 22 oct», «En su tiempo · 20 oct» o «Pendiente · 15 – 16 oct» (la fecha es la de su reparto). */
export function TimeChip({ time, onClick }: { time: TopicTimeTag; onClick?: () => void }) {
  if (time.status === "done") return null;
  const c = TIME_COLOUR[time.status];
  if (onClick) return <button type="button" onClick={onClick} className="flex-none whitespace-nowrap rounded-md border px-1.5 py-0.5 text-left font-mono text-[11px] font-semibold tracking-wide hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" style={{ color: c, borderColor: `${c}66`, background: `${c}1a` }} data-testid="board-time" data-time-status={time.status} title="Abrir el calendario de planeación para este tema">{time.text} · {time.label}</button>;
  return (
    <span className="flex-none whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide" style={{ color: c, borderColor: `${c}66`, background: `${c}1a` }} data-testid="board-time" data-time-status={time.status}>
      {time.text} · {time.label}
    </span>
  );
}

/** El menú de un tema: apunte (.md), archivo de práctica, canvas explicativo, asignarlo al Pomodoro o ir a la planeación. */
export function TopicMenu({ folder, title, trigger, className, work, areaKey, planId }: { folder: string; title: string; trigger?: React.ReactNode; className?: string; /** tipo de trabajo de la fila (Teoría / Práctica) y área del Mentor: el bloque del Pomodoro nace ya con ellos */ work?: WorkKind; areaKey?: string; planId?: string }) {
  const assignTopic = usePomodoro((s) => s.assignTopic);
  return (
    <RowMenu
      title={title}
      {...(trigger ? { trigger } : {})}
      {...(className ? { className } : {})}
      items={[
        { id: "note", label: "Abrir apunte (.md)", icon: <BookOpen size={16} aria-hidden className="text-accent-text" />, onClick: () => void openTopicNote(folder), testid: "board-open-note" },
        { id: "practice", label: "Abrir archivo de práctica", icon: <Dumbbell size={16} aria-hidden className="text-mint" />, onClick: () => void openTopic(folder), testid: "board-open-practice" },
        { id: "canvas", label: "Abrir canvas explicativo", icon: <Network size={16} aria-hidden className="text-accent-text" />, onClick: () => void openTopicCanvas(folder), testid: "board-open-canvas" },
        { id: "pomodoro", label: "Asignar al Pomodoro", icon: <Timer size={16} aria-hidden className="text-warn" />, onClick: () => assignTopic(work || areaKey ? mentorAssignment(work ?? "theory", { folder, title, ...(areaKey ? { areaKey } : {}) }) : { folder, title }), testid: "board-assign-pomodoro" },
        {
          id: "planning",
          label: "Ir a la planeación",
          icon: <Compass size={16} aria-hidden className="text-accent-text" />,
          testid: "board-go-planning",
          children: [
            { id: "planning-topic", label: "Ir al tema en específico", icon: <Target size={15} aria-hidden className="text-accent-text" />, onClick: () => void openPlanTopic(planId, folder, areaKey), testid: "board-go-planning-topic" },
            { id: "planning-general", label: "Ir a la vista general", icon: <LayoutDashboard size={15} aria-hidden className="text-dim" />, onClick: () => void openPlanGeneral(planId), testid: "board-go-planning-general" },
            { id: "planning-agenda", label: "Ir al calendario de planeación", icon: <CalendarDays size={15} aria-hidden className="text-mint" />, onClick: () => void openPlanAgenda(planId, areaKey), testid: "board-go-planning-agenda" },
          ],
        },
      ]}
    />
  );
}

export function TopicRow({ r, colour, areaKey, planId }: { r: BoardRow; colour: string; /** área del Mentor de la lista que la pinta (para el Pomodoro) */ areaKey?: string; planId?: string }) {
  const locked = !!r.unlockOn;
  const assigned = usePomodoro((s) => s.p.assignedTopics.some((t) => t.folder === r.folder));
  const working = !r.done && !locked && r.state !== "sin_tratar";
  // detalle del tema (teoría, ejercicios, última práctica, repaso) desplegado bajo la fila; no lee nada hasta abrirse
  const [insight, setInsight] = useState(false);
  const insightId = useId();
  return (
    <li
      className={cn("flex flex-wrap items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition-colors", locked ? "border-transparent opacity-55" : "border-transparent hover:border-line hover:bg-surface", working && "border-line bg-surface")}
      data-testid="board-topic"
      data-state={locked ? "bloqueado" : r.done ? "completo" : r.state}
    >
      {!locked && <InsightToggle open={insight} onToggle={() => setInsight((v) => !v)} title={r.title} controls={insightId} className="-mr-1" />}
      <span
        aria-hidden
        className="grid h-5 w-5 flex-none place-items-center rounded-md border text-[12px] font-bold text-white"
        style={r.done ? { background: colour, borderColor: colour } : { borderColor: "var(--nv-line, currentColor)" }}
      >
        {r.done ? "✓" : locked ? <Lock size={11} className="text-faint" /> : null}
      </span>
      {(() => {
        const label = (
          <>
            {r.title}
            {r.meta ? <span className="text-[13.5px] font-normal text-dim"> · {r.meta}</span> : null}
            <span className="sr-only">, {locked ? `bloqueado hasta terminar el ${dateLabel(r.unlockOn!)}` : r.done ? "completado" : STATE_LABEL[r.state]}</span>
          </>
        );
        // basis fija: en una ventana estrecha la fila pasa los chips a la línea de abajo en vez de dejar el título en una palabra por línea
        const cls = cn("min-w-0 flex-1 basis-[13rem] break-words text-[15px] leading-snug", r.done && "text-faint line-through decoration-faint/60");
        // pulsar el tema abre sus opciones: apunte (.md), archivo de práctica, canvas, Pomodoro y planeación
        return locked ? <span className={cls}>{label}</span> : <span className={cls}><TopicMenu folder={r.folder} title={r.title} trigger={label} {...(r.work ? { work: r.work } : {})} {...(areaKey ? { areaKey } : {})} planId={planId} className="w-full rounded-md hover:text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" /></span>;
      })()}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {r.outdated && (
          <>
            <button type="button" onClick={() => { void openPlanTopic(planId, r.folder, areaKey); }} className="flex-none rounded-md border border-danger/60 bg-danger-soft px-1.5 py-0.5 text-left font-mono text-[10.5px] font-semibold uppercase tracking-wide text-danger hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" title="Abrir este tema en Planeación para corregir su práctica" data-testid="run-practice-outdated">Práctica desactualizada</button>
            {r.time && <TimeChip time={r.time} onClick={r.time.status === "current" && planId && r.agendaDate ? () => { openAgendaAt(planId, r.agendaDate!, "dia"); useApp.getState().toast("info", `Agenda abierta para hoy: ${r.title} está en su tiempo (${r.time!.label}).`); } : undefined} />}
          </>
        )}
        {!r.outdated && r.time && <TimeChip time={r.time} onClick={r.time.status === "current" && planId && r.agendaDate ? () => { openAgendaAt(planId, r.agendaDate!, "dia"); useApp.getState().toast("info", `Agenda abierta para hoy: ${r.title} está en su tiempo (${r.time!.label}).`); } : undefined} />}
        {r.extra && <ExtraTag title={r.title} {...(r.extra.remove ? { onRemove: r.extra.remove } : {})} />}
        {!locked && <TopicNoteLinks folder={r.folder} title={r.title} />}
        {!r.done && !locked && (r.pct ?? 0) > 0 && (
          <span className="flex-none font-mono text-[12px] text-dim" data-testid="board-pct" title="Nivel de avance del tema">{r.pct} %</span>
        )}
        {r.tag && (
          <span className="flex-none rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide" style={{ color: r.tag.colour ?? colour, borderColor: `${r.tag.colour ?? colour}66`, background: `${r.tag.colour ?? colour}1a` }} data-testid="board-tag">
            {r.tag.text}
          </span>
        )}
        {assigned && (
          <span className="flex-none flex items-center gap-1 rounded-md border border-warn/60 bg-warn-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-warn uppercase tracking-wide">
            <Timer size={11} aria-hidden /> Pomodoro
          </span>
        )}
        {working && !r.tag && !assigned && (
          <span className="flex-none rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide" style={{ color: colour, borderColor: `${colour}66`, background: `${colour}1a` }}>
            {r.state === "practicando" ? "Activo" : STATE_LABEL[r.state]}
          </span>
        )}
        {locked ? (
          <span className="flex-none text-[12.5px] text-faint" title={`Termina antes los temas del ${dateLabel(r.unlockOn!)}`}>
            <span className="sr-only">Bloqueado</span>
            <Lock size={14} aria-hidden />
          </span>
        ) : (
          <TopicMenu folder={r.folder} title={r.title} {...(r.work ? { work: r.work } : {})} {...(areaKey ? { areaKey } : {})} planId={planId} />
        )}
      </div>
      {insight && !locked && (
        <div id={insightId} className="basis-full pb-1 pl-8" data-testid="board-topic-insight">
          <TopicInsight folder={r.folder} title={r.title} {...(planId ? { planId } : {})} compact />
        </div>
      )}
    </li>
  );
}

/** La práctica diaria de cada área, que se pinta DENTRO de la tarjeta del área. */
export interface BoardPractice {
  areas: AreaPracticeView[];
  today: string;
  mark: AreaPracticeState["mark"];
}

/** Progreso de cada área en la vista general (solo avance, sin listas de temas); pulsar un área la abre en su pestaña. */
export function ProgressOverview({ plan, data, onPick, compact }: { plan: MentorPlan; data: Loaded; onPick?: (subplanId: string) => void; /** versión estrecha para la columna lateral: una columna y sin cabecera de sección */ compact?: boolean }) {
  const summary = data.derived?.summary;
  if (!summary) return null;
  const areas = orderedAreas(plan).map((a) => {
    const view = data.derived?.subplans.find((s) => s.id === a.subplanId);
    return { a, pct: view?.pct ?? 0, done: view?.done ?? 0, total: view?.total ?? 0 };
  });
  return (
    <section aria-labelledby="run-overview-h" data-testid="run-overview" className="space-y-3">
      {compact ? <h2 id="run-overview-h" className="sr-only">Ruta de áreas</h2> : <SectionHeading id="run-overview-h" hint={`Semana ${summary.currentWeek} de ${summary.weeks} · ${summary.done}/${summary.topics} temas completados.`}>Progreso general</SectionHeading>}
      <div
        className={cn(
          "rounded-2xl border p-4 @3xl:p-5",
          compact ? "border-white/10 bg-[#101216] text-[#f3f4f6] shadow-lg [&_[role=progressbar]]:bg-white/10" : "border-line bg-card",
        )}
        data-testid="board-global"
      >
        {compact && (
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">Progreso global</p>
              <h3 className="text-[17px] font-bold">Ruta de áreas</h3>
            </div>
            <span className="flex-none rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[12px] text-white/70">Semana {summary.currentWeek} de {summary.weeks}</span>
          </div>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {compact ? (
            <div>
              <span className="text-[34px] font-extrabold leading-none">{summary.pct} %</span>
              <p className="mt-1 text-[12.5px] text-white/60">Avance plan completo</p>
            </div>
          ) : (
            <>
              <h3 className="text-[17px] font-semibold">Plan completo</h3>
              <span className="flex-1" />
              <span className="text-[26px] font-extrabold leading-none text-accent-text">{summary.pct} %</span>
            </>
          )}
        </div>
        <div className="mt-3"><ProgressBar pct={summary.pct} thick label="Avance global del plan" /></div>
        <ul className={cn("mt-4 grid gap-x-8 gap-y-2.5", !compact && "@3xl:grid-cols-2")} aria-label="Avance por área">
          {areas.map(({ a, pct, done, total }) => (
            <li key={a.subplanId}>
              <button type="button" onClick={() => onPick?.(a.subplanId)} className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left", compact ? "hover:bg-white/10" : "hover:bg-hover")} data-testid="overview-area" aria-label={`${a.area}: ${pct} %, ${done} de ${total} temas. Abrir el área`}>
                <span aria-hidden className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: focusColour(a.areaId) }} />
                <span className={cn("flex-none truncate text-[14px]", compact ? "w-24" : "w-40")}>{a.area}</span>
                <span className="min-w-0 flex-1"><ProgressBar pct={pct} colour={focusColour(a.areaId)} label={`Avance de ${a.area}`} /></span>
                <span className={cn("w-20 flex-none text-right text-[12.5px]", compact ? "text-white/55" : "text-dim")}><strong className={compact ? "text-white" : "text-text"}>{pct} %</strong> · {done}/{total}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
