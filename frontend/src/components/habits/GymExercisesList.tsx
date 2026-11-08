import { useEffect, useState } from "react";
import { Calendar, CalendarCheck, Clock, Dumbbell, Pencil, Sparkles } from "lucide-react";
import { api } from "../../lib/bridge";
import type { Exercise, Habit } from "../../lib/types";
import { autoDistributeExercises, type ExerciseScheduleItem } from "../../lib/exerciseScheduler";
import { useApp } from "../../store/app";
import { useCalendar } from "../../store/calendar";
import { cn, IconButton } from "../ui";
import { GymExerciseEditModal } from "./GymExerciseEditModal";

interface GymExercisesListProps {
  day: string;
  habit: Habit;
  onUpdate: (
    schedules: Record<string, ExerciseScheduleItem>,
  ) => void;
}

export function GymExercisesList({ day, habit, onUpdate }: GymExercisesListProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .exDays(day, day)
      .then((days) => {
        if (!alive) return;
        setExercises(days[0]?.exercises ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [day]);

  const schedules = (habit.exercise_schedules as Record<string, ExerciseScheduleItem> | undefined) ?? {};

  const handleSaveExercise = (exId: string, updated: ExerciseScheduleItem) => {
    const current = { ...schedules };
    current[exId] = updated;
    onUpdate(current);
  };

  const handleAutoDistribute = () => {
    const distributed = autoDistributeExercises(exercises, habit.time || "11:00", 120);
    const updated = { ...schedules, ...distributed };
    onUpdate(updated);
  };

  const handleGoCalendar = (exId: string) => {
    const current = { ...schedules };
    if (!current[exId]?.time) {
      current[exId] = {
        time: habit.time || "11:00",
        duration_min: 20,
        rest_min: 2,
        in_calendar: true,
      };
      onUpdate(current);
    } else if (current[exId]?.in_calendar === false) {
      current[exId] = {
        ...current[exId]!,
        in_calendar: true,
      };
      onUpdate(current);
    }

    useCalendar.getState().setDay(day);
    useCalendar.getState().setSelectedOccId(`ex_${exId}_${day}`);
    useApp.getState().setModule("calendario");
  };

  if (loading) {
    return (
      <div className="mt-2.5 rounded-xl border border-line/60 bg-surface/50 p-3 text-[12px] text-faint">
        Cargando ejercicios de la rutina de hoy…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2.5 rounded-xl border border-line/60 bg-surface/50 p-3 text-[12px] text-danger">
        Error al cargar ejercicios: {error}
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div className="mt-2.5 rounded-xl border border-line/60 bg-surface/50 p-3 text-[12.5px] text-faint">
        No hay ejercicios programados en tu rutina para este día.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2.5">
      {/* Encabezado con contador y botón auto-distribuir */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line/40">
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-400">
          <Dumbbell size={13} />
          <span>Ejercicios del día ({exercises.length})</span>
        </div>
        <button
          type="button"
          onClick={handleAutoDistribute}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 transition-colors shadow-sm"
          title="Distribuir automáticamente todos los ejercicios entre las 11:00 y las 13:00 con tiempos de descanso calculados"
        >
          <Sparkles size={11} />
          <span>Auto-distribuir (11:00 a 13:00)</span>
        </button>
      </div>

      {/* Lista de ejercicios con apariencia similar a hábitos */}
      <ul className="space-y-1.5 pt-0.5">
        {exercises.map((ex) => {
          const sched = schedules[ex.id];
          const hasTime = Boolean(sched?.time);
          const inCal = hasTime && sched?.in_calendar !== false;
          const restVal = sched?.rest_min !== undefined ? sched.rest_min : 2;

          return (
            <li
              key={ex.id}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-card/90 px-3 py-2 transition-all hover:border-line-strong hover:bg-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-text">{ex.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-faint">
                  {ex.series_reps && <span className="text-dim">{ex.series_reps}</span>}
                  {sched?.duration_min && <span>· {sched.duration_min} min</span>}
                  {restVal > 0 && <span className="text-amber-400/90 font-mono">+{restVal}m descanso</span>}
                </div>
              </div>

              {/* Rango de horario asignado */}
              {sched?.time ? (
                <div className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-400">
                  <Clock size={11} />
                  <span>
                    {sched.time} – {sched.end_time || ""}
                  </span>
                </div>
              ) : (
                <span className="text-[11px] font-mono text-faint">Sin horario</span>
              )}

              {/* Botón de editar configuración (luzca similar a modificar hábito) */}
              <IconButton
                title={`Configurar horario y descanso: ${ex.name}`}
                aria-label={`Configurar horario y descanso: ${ex.name}`}
                onClick={() => setEditingExercise(ex)}
                className="text-faint hover:text-text hover:bg-hover"
              >
                <Pencil size={13} />
              </IconButton>

              {/* Botón ver en calendario */}
              <IconButton
                title={`Ver ${ex.name} en el calendario`}
                aria-label={`Ver ${ex.name} en el calendario`}
                active={inCal}
                onClick={() => handleGoCalendar(ex.id)}
                className={cn(
                  "transition-all",
                  inCal
                    ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                    : "text-faint hover:text-text hover:bg-hover",
                )}
              >
                {inCal ? <CalendarCheck size={13} /> : <Calendar size={13} />}
              </IconButton>
            </li>
          );
        })}
      </ul>

      {/* Modal de edición completa similar a HabitEditModal */}
      {editingExercise && (
        <GymExerciseEditModal
          exercise={editingExercise}
          schedule={schedules[editingExercise.id]}
          defaultTime={habit.time || "11:00"}
          onSave={(updated) => handleSaveExercise(editingExercise.id, updated)}
          onClose={() => setEditingExercise(null)}
          onGoCalendar={() => handleGoCalendar(editingExercise.id)}
        />
      )}
    </div>
  );
}
