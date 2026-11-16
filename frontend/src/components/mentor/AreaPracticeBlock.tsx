// Mentor — la PRÁCTICA diaria de un área, dentro de la tarjeta del área en «Cómo voy» (junto a sus temas).
//
// Lista TODOS los katas que tocaban hasta hoy y siguen sin hacerse (más el de hoy), no solo el de hoy: si el contador dice 0/6 hay seis retos.
// Cada fila tiene su casilla (marca el día) y la flecha con el acceso directo al kata, que existe siempre: si el archivo falta, se crea al abrirlo.

import { BookOpen, Check, Dumbbell, SkipForward, Timer, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../lib/bridge";
import { KATA_LEVEL_LABEL } from "../../lib/areaPracticeSystem";
import type { AreaKataDue, AreaPracticeView } from "../../lib/areaPracticeView";
import { mentorAssignment } from "../../lib/pomodoro";
import { dateLabel } from "../../lib/planSchedule";
import { usePomodoro } from "../../store/pomodoro";
import { useApp } from "../../store/app";
import { useNavState } from "../../store/navState";
import { cn } from "../ui";
import { focusColour } from "./agendaKit";
import { type AreaPracticeState, practiceAreaKey } from "./PracticeCard";
import { openPlanTab } from "./planShared";
import { RowMenu, type MenuAction } from "./RowMenu";

const VISIBLE = 3;

function KataRow({ planId, area, d, mark, showDates = true }: { planId: string; area: AreaPracticeView; d: AreaKataDue; mark: AreaPracticeState["mark"]; showDates?: boolean }) {
  const toast = useApp((s) => s.toast);
  const colour = focusColour(area.areaId);
  const done = d.state === "done";
  const late = !d.today && d.state === "pending";
  const skipOk = area.kata.skip.allowed;
  const open = async (): Promise<void> => {
    try {
      const r = await api.mentorAreaKataOpen(planId, area.areaId, d.date);
      await useApp.getState().openNote(r.rel);
      if (r.projectWarning) toast("error", r.projectWarning);
      else if (r.projectRepo) toast("info", `Repositorio mensual: ${r.projectRepo}`);
      else if (r.created) toast("info", "Kata creado en tu vault y abierto.");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const items: MenuAction[] = [
    { id: "open", label: "Abrir kata (.md)", icon: <BookOpen size={16} aria-hidden className="text-accent-text" />, onClick: () => void open(), testid: "kata-open" },
    ...(!done ? [{ id: "done", label: "Verificar y marcar hecho", icon: <Check size={16} aria-hidden className="text-mint" />, onClick: () => void mark(area.areaId, d.date, "done"), testid: "kata-mark-done" }] : []),
    ...(d.state === "pending" ? [{ id: "skip", label: `${d.today ? "Saltar hoy" : "Saltar este día"}${skipOk ? "" : ` (pide ${area.kata.skip.neededPct} %)`}`, icon: <SkipForward size={16} aria-hidden />, onClick: () => { if (skipOk) void mark(area.areaId, d.date, "skipped"); else toast("info", `Para saltar un kata hace falta haber hecho al menos el ${area.kata.skip.neededPct} % de los que tocaban hasta hoy: llevas el ${area.kata.skip.pct} %.`); }, testid: "kata-mark-skip" }] : []),
    ...(done || d.state === "skipped" ? [{ id: "undo", label: "Quitar marca", icon: <Undo2 size={16} aria-hidden />, onClick: () => void mark(area.areaId, d.date, null), testid: "kata-mark-undo" }] : []),
    { id: "pomodoro", label: "Asignar al Pomodoro", icon: <Timer size={16} aria-hidden className="text-warn" />, onClick: () => usePomodoro.getState().assignTopic(mentorAssignment("practice", { folder: `manual:kata:${area.areaId}:${d.date}`, title: `Kata: ${d.title}`, kind: "task", areaKey: area.areaId })), testid: "kata-assign-pomodoro" },
    { id: "area", label: `Ver práctica de ${area.label}`, icon: <Dumbbell size={16} aria-hidden className="text-mint" />, onClick: () => { useNavState.getState().set(practiceAreaKey(planId), area.areaId); openPlanTab(planId, "practica"); }, testid: "kata-area" },
  ];
  return (
    <li className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors", d.today ? "border-accent/40 bg-surface" : "border-line bg-surface/50 hover:bg-surface")} data-testid="kata-row" data-state={d.state} data-date={d.date}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Quitar la marca de" : "Verificar y marcar como hecho"}: ${d.title}`}
        title={done ? undefined : "Se marca solo si hay un intento calificado de este kata (nota de 75 o más)"}
        onClick={() => void mark(area.areaId, d.date, done ? null : "done")}
        className="grid h-5 w-5 flex-none place-items-center rounded-md border text-[12px] font-bold text-white"
        style={done ? { background: colour, borderColor: colour } : { borderColor: "var(--nv-line, currentColor)" }}
        data-testid="kata-check"
      >
        {done ? "✓" : null}
      </button>
      <span className={cn("min-w-0 flex-1 text-[15px] leading-snug", (done || d.state === "skipped") && "text-faint line-through decoration-faint/60")}>
        {d.title}
        <span className="block text-[13.5px] font-normal text-dim">
          {d.skillName} · {KATA_LEVEL_LABEL[d.level]} · {d.minutes} min{showDates ? ` · ${d.today ? "hoy" : dateLabel(d.date)}` : ""}
          {d.state === "skipped" ? " · saltado" : ""}
        </span>
      </span>
      {late && showDates && <span className="flex-none rounded-md border border-warn/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-warn">Atrasado</span>}
      <RowMenu title={d.title} items={items} />
    </li>
  );
}

/** El bloque de práctica de un área: contador, lista de katas por hacer y el siguiente si hoy no toca. */
export function AreaPracticeBlock({ planId, area, mark, extra, showDates = true }: { planId: string; area: AreaPracticeView; mark: AreaPracticeState["mark"]; showDates?: boolean; /** la práctica extra del día y «Añadir práctica» */ extra?: ReactNode }) {
  const [all, setAll] = useState(false);
  const colour = focusColour(area.areaId);
  const pending = area.kata.due.filter((d) => d.state !== "done").length;
  const list = all ? area.kata.due : area.kata.due.slice(0, VISIBLE);
  const next = area.kata.next;
  const upcoming: AreaKataDue | null =
    !area.kata.due.length && next
      ? { day: next.kata.day, date: next.date, state: "pending", today: false, title: next.kata.title, skillName: next.kata.skillName, level: next.kata.level, minutes: next.kata.minutes, summary: next.summary, rel: next.rel, fileReady: next.fileReady }
      : null;
  return (
    <div className="rounded-2xl border border-line bg-card p-4" data-testid="area-practice-block" data-area={area.areaId}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-bold" style={{ color: colour }}>Práctica diaria</h3>
        <span className="text-[14px] text-dim" data-testid="area-practice-count">
          {pending > 0 ? `${pending} ${pending === 1 ? "reto por hacer" : "retos por hacer"}` : !showDates ? "sin retos pendientes" : area.kata.todayPlanned ? "al día" : "hoy no toca"}
          {area.kata.streak > 0 ? ` · racha ${area.kata.streak}` : ""}
        </span>
        <span className="flex-1" />
        {area.kata.due.length > VISIBLE && (
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="inline-flex min-h-8 items-center text-[13.5px] font-medium underline-offset-2 hover:underline" style={{ color: colour }} data-testid="area-practice-more">
            {all ? "Ver menos" : `Ver los ${area.kata.due.length} retos`}
          </button>
        )}
      </div>
      <ul className="space-y-2" aria-label={`Práctica diaria de ${area.label}`}>
        {list.map((d) => <KataRow key={d.date} planId={planId} area={area} d={d} mark={mark} showDates={showDates} />)}
        {upcoming && <KataRow planId={planId} area={area} d={upcoming} mark={mark} showDates={showDates} />}
      </ul>
      {!list.length && !upcoming && <p className="px-2.5 py-2 text-[14px] text-faint">Este plan no tiene katas en esta área.</p>}
      {extra}
    </div>
  );
}
