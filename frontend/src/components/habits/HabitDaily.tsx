// Diaria: one day's checklist, subtasks, a one-line note and the journal.

import { Calendar, CalendarCheck, ChevronDown, Dumbbell, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays } from "../../lib/habits";
import { shortDate, todayIso } from "../../lib/tasks";
import { clearPending, markPending, useApp } from "../../store/app";
import { useCalendar } from "../../store/calendar";
import { useHabits } from "../../store/habits";
import { cn, IconButton } from "../ui";
import { GymExercisesList } from "./GymExercisesList";
import { HabitEditModal } from "./HabitEditModal";
import { HabitCheck, Header, NavButtons } from "./parts";

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function DayText() {
  const log = useHabits((s) => s.log);
  const setDayText = useHabits((s) => s.setDayText);
  const [notes, setNotes] = useState("");
  const [journal, setJournal] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const date = log?.date;

  useEffect(() => {
    setNotes(log?.notes ?? "");
    setJournal(log?.journal ?? "");
    // Only when the day changes: typing must not be overwritten by echoes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const pending = useRef<[string, string, string] | null>(null);
  const flush = async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    clearPending("habit-day");
    if (p) await setDayText(p[0], p[1], p[2]);
  };
  const save = (n: string, j: string) => {
    if (!date) return;
    pending.current = [date, n, j];
    markPending("habit-day", flush);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };
  // Leaving the view or changing the day writes what was typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => void flush(), [date]);

  return (
    <div className="space-y-3">
      <input
        value={notes}
        maxLength={500}
        onChange={(e) => {
          setNotes(e.target.value);
          save(e.target.value, journal);
        }}
        placeholder="Nota del día…"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent"
      />
      <textarea
        value={journal}
        onChange={(e) => {
          setJournal(e.target.value);
          save(notes, e.target.value);
        }}
        placeholder="Diario: ¿cómo fue el día?"
        rows={8}
        className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-[13px] leading-relaxed text-text outline-none placeholder:text-faint focus:border-accent"
      />
    </div>
  );
}

export function HabitDaily() {
  const day = useHabits((s) => s.day);
  const setDay = useHabits((s) => s.setDay);
  const log = useHabits((s) => s.log);
  const habits = useHabits((s) => s.habits);
  const setDone = useHabits((s) => s.setDone);
  const setSubtask = useHabits((s) => s.setSubtask);
  const update = useHabits((s) => s.update);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [gymExpanded, setGymExpanded] = useState(false);

  const weekday = WEEKDAY_NAMES[new Date(`${day}T12:00:00`).getDay()];
  const active = habits.filter((h) => log?.active.includes(h.id));
  const rest = habits.filter((h) => !log?.active.includes(h.id));
  const done = active.filter((h) => log?.completed[h.id]).length;
  const editingHabit = habits.find((h) => h.id === editingHabitId);

  return (
    <>
      <Header title="Diaria">
        <NavButtons
          label={`${weekday} ${shortDate(day)}`}
          onPrev={() => void setDay(addDays(day, -1))}
          onNext={() => void setDay(addDays(day, 1))}
          onToday={() => void setDay(todayIso())}
        />
        <button
          type="button"
          onClick={() => {
            useCalendar.getState().setDay(day);
            useApp.getState().setModule("calendario");
          }}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-dim hover:bg-hover hover:text-text transition-colors"
          title="Ver este día en el calendario"
        >
          <Calendar size={13} />
          <span>Ver en calendario</span>
        </button>
      </Header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-[980px] grid-cols-[1fr_340px] gap-6">
          <section>
            <div className="mb-2 flex items-baseline font-mono text-[10.5px] uppercase tracking-wider text-faint">
              <span>Hábitos de hoy</span>
              <span className="ml-auto normal-case">{done}/{active.length}</span>
            </div>
            <ul className="space-y-1.5">
              {active.map((h) => {
                const isDone = Boolean(log?.completed[h.id]);
                return (
                  <li key={h.id} className="group rounded-xl border border-line bg-card px-3 py-2.5 transition-colors hover:border-line-strong">
                    <div className="flex items-center gap-3">
                      <HabitCheck
                        habit={h}
                        active
                        done={isDone}
                        label={h.name}
                        onToggle={(v) => void setDone(day, h.id, v)}
                      />
                      <span className="w-5 text-center">{h.icon}</span>
                      <span className={cn("flex-1 text-[13.5px]", isDone ? "text-faint line-through" : "text-text")}>
                        {h.name}
                      </span>
                      {h.id === "gym" && (
                        <button
                          type="button"
                          onClick={() => setGymExpanded((v) => !v)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                            gymExpanded
                              ? "border-amber-500/50 bg-amber-500/20 text-amber-400"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
                          )}
                          title="Desplegar ejercicios del día para asignarles horario en el calendario"
                        >
                          <Dumbbell size={12} />
                          <span>Ejercicios</span>
                          <ChevronDown
                            size={12}
                            className={cn("transition-transform duration-200", gymExpanded && "rotate-180")}
                          />
                        </button>
                      )}
                      {h.time && <span className="font-mono text-[11px] text-faint">{h.time}</span>}
                      <IconButton
                        title={`Ver ${h.name} en el calendario`}
                        aria-label={`Ver ${h.name} en el calendario`}
                        active={Boolean(h.in_calendar)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!h.in_calendar) {
                            void update(h.id, { in_calendar: true });
                          }
                          useCalendar.getState().setDay(day);
                          useCalendar.getState().setSelectedOccId(`habit:${h.id}`);
                          useApp.getState().setModule("calendario");
                        }}
                        className={cn(
                          "transition-all",
                          h.in_calendar
                            ? "opacity-100 bg-accent-soft text-accent-text hover:bg-accent-soft/80"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-faint hover:text-text hover:bg-hover",
                        )}
                      >
                        {h.in_calendar ? <CalendarCheck size={13} /> : <Calendar size={13} />}
                      </IconButton>
                      <IconButton
                        title={`Editar hábito: ${h.name}`}
                        onClick={() => setEditingHabitId(h.id)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 text-faint hover:text-text hover:bg-hover"
                      >
                        <Pencil size={13} />
                      </IconButton>
                    </div>
                    {h.id === "gym" && gymExpanded && (
                      <GymExercisesList
                        day={day}
                        habit={h}
                        onUpdate={(schedules) => void update(h.id, { exercise_schedules: schedules })}
                      />
                    )}
                    {h.subtasks.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-[62px]">
                        {h.subtasks.map((s) => (
                          <li key={s.id}>
                            <label className="flex items-center gap-2 text-[12.5px] text-dim">
                              <input
                                type="checkbox"
                                className="accent-[var(--nv-accent)]"
                                checked={Boolean(log?.subtasks[h.id]?.[s.id])}
                                onChange={(e) => void setSubtask(day, h.id, s.id, e.target.checked)}
                              />
                              {s.name}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
              {!active.length && <li className="text-[13px] text-faint">Hoy no toca ningún hábito.</li>}
            </ul>
            {rest.length > 0 && (
              <div className="mt-4 text-[12px] text-faint">
                <span className="mb-1.5 block">No tocan hoy:</span>
                <div className="flex flex-wrap gap-2">
                  {rest.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setEditingHabitId(h.id)}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-line bg-card/60 px-2.5 py-1 text-dim transition-colors hover:border-line-strong hover:bg-card hover:text-text"
                      title={`Editar hábito: ${h.name}`}
                    >
                      <span>{h.icon}</span>
                      <span>{h.name}</span>
                      <Pencil size={11} className="opacity-40 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Notas y diario</div>
            <DayText />
          </section>
        </div>
      </div>
      {editingHabit && (
        <HabitEditModal habit={editingHabit} onClose={() => setEditingHabitId(null)} />
      )}
    </>
  );
}
