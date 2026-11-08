import { CalendarCheck, Clock, Dumbbell } from "lucide-react";
import { useState } from "react";
import type { Exercise } from "../../lib/types";
import { addMinutesToTime, timeToMin, type ExerciseScheduleItem } from "../../lib/exerciseScheduler";
import { Modal, PrimaryButton } from "../common/forms";

const base = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-accent";
const field = `${base} w-full`;
const labelCls = "mb-1 block font-mono text-[10.5px] uppercase tracking-wider text-faint";

interface GymExerciseEditModalProps {
  exercise: Exercise;
  schedule?: ExerciseScheduleItem;
  defaultTime?: string;
  onSave: (updated: ExerciseScheduleItem) => void;
  onClose: () => void;
  onGoCalendar?: () => void;
}

export function GymExerciseEditModal({
  exercise,
  schedule,
  defaultTime = "11:00",
  onSave,
  onClose,
  onGoCalendar,
}: GymExerciseEditModalProps) {
  const initialTime = schedule?.time || defaultTime;
  const initialDur = schedule?.duration_min || 15;
  const initialRest = schedule?.rest_min !== undefined ? schedule.rest_min : 2;
  const initialEndTime = schedule?.end_time || addMinutesToTime(initialTime, initialDur);

  const [time, setTime] = useState(initialTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [durationMin, setDurationMin] = useState(initialDur);
  const [restMin, setRestMin] = useState(initialRest);
  const [startDate, setStartDate] = useState(schedule?.start_date || "");
  const [endDate, setEndDate] = useState(schedule?.end_date || "");
  const [inCalendar, setInCalendar] = useState(schedule?.in_calendar !== false);

  // Al cambiar la hora de inicio: recalcula la hora de fin según la duración
  const handleTimeChange = (newTime: string) => {
    setTime(newTime);
    if (newTime) {
      setEndTime(addMinutesToTime(newTime, durationMin));
    }
  };

  // Al cambiar la hora de fin: recalcula la duración
  const handleEndTimeChange = (newEndTime: string) => {
    setEndTime(newEndTime);
    if (time && newEndTime) {
      const startM = timeToMin(time);
      const endM = timeToMin(newEndTime);
      const diff = endM >= startM ? endM - startM : 24 * 60 - startM + endM;
      if (diff > 0) {
        setDurationMin(diff);
      }
    }
  };

  // Al cambiar la duración: recalcula la hora de fin
  const handleDurationChange = (dur: number) => {
    const d = Math.max(1, isNaN(dur) ? 15 : dur);
    setDurationMin(d);
    if (time) {
      setEndTime(addMinutesToTime(time, d));
    }
  };

  const handleSave = () => {
    onSave({
      time,
      end_time: endTime,
      duration_min: durationMin,
      rest_min: restMin,
      start_date: startDate || null,
      end_date: endDate || null,
      in_calendar: inCalendar,
    });
    onClose();
  };

  const nextStart = addMinutesToTime(endTime, restMin);

  return (
    <Modal title={`Configurar ejercicio: ${exercise.name}`} onClose={onClose}>
      <div className="space-y-4">
        {/* Cabecera del ejercicio */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
            <Dumbbell size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-bold text-text">{exercise.name}</div>
            <div className="flex items-center gap-2 text-[12px] text-faint">
              {exercise.series_reps && <span className="text-dim">{exercise.series_reps}</span>}
              {exercise.rest && <span>· Descanso recomendado: {exercise.rest}</span>}
            </div>
          </div>
        </div>

        {/* Vigencia: Fecha de inicio y Fecha de fin */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Fecha de inicio (Desde)</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={labelCls}>Fecha de fin (Hasta)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={field}
            />
          </div>
        </div>

        {/* Horario: Hora de inicio y Hora de fin */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Hora de inicio</label>
            <input
              type="time"
              value={time}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={labelCls}>Hora de fin</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => handleEndTimeChange(e.target.value)}
              className={field}
            />
          </div>
        </div>

        {/* Duración activa y Descanso posterior */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Duración activa (minutos)</label>
            <input
              type="number"
              min={1}
              max={180}
              value={durationMin}
              onChange={(e) => handleDurationChange(parseInt(e.target.value, 10))}
              className={field}
            />
          </div>
          <div>
            <label className={labelCls}>Tiempo de descanso (minutos)</label>
            <input
              type="number"
              min={0}
              max={60}
              value={restMin}
              onChange={(e) => setRestMin(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className={field}
            />
          </div>
        </div>

        {/* Resumen del horario con descanso */}
        <div className="rounded-xl border border-line bg-surface/30 p-2.5 text-[12px] text-dim flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Clock size={13} className="text-amber-400" />
            <span>
              <b>{time}</b> a <b>{endTime}</b> ({durationMin} min) + <b>{restMin} min</b> descanso
            </span>
          </span>
          <span className="text-[11px] text-faint">
            Siguiente: {nextStart}
          </span>
        </div>

        {/* Checkbox de calendario y botón Ver en calendario */}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <label className="flex items-center gap-2 text-[13px] text-dim cursor-pointer">
            <input
              type="checkbox"
              className="accent-[var(--nv-accent)]"
              checked={inCalendar}
              onChange={(e) => setInCalendar(e.target.checked)}
            />
            <span>Mostrar en el calendario</span>
          </label>

          {onGoCalendar && (
            <button
              type="button"
              onClick={() => {
                handleSave();
                onGoCalendar();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-dim hover:bg-hover hover:text-text transition-colors"
            >
              <CalendarCheck size={13} className="text-amber-400" />
              <span>Ver en calendario</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-dim hover:bg-hover hover:text-text"
          >
            Cancelar
          </button>
          <PrimaryButton onClick={handleSave}>Listo</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

