import type { Exercise } from "./types";

export interface ExerciseScheduleItem {
  time: string; // Hora de inicio (HH:MM)
  end_time?: string; // Hora de fin (HH:MM)
  duration_min: number; // Duración activa en minutos
  rest_min?: number; // Tiempo de descanso posterior en minutos
  start_date?: string | null; // Fecha inicio vigencia
  end_date?: string | null; // Fecha fin vigencia
  in_calendar?: boolean;
}

export function parseRestMinutes(restStr?: string): number {
  if (!restStr || restStr === "—") return 1;
  const m = restStr.match(/(\d+)\s*min/);
  if (m) return Math.max(1, parseInt(m[1]!, 10));
  const s = restStr.match(/(\d+)\s*seg/);
  if (s) return Math.max(1, Math.round(parseInt(s[1]!, 10) / 60));
  return 1;
}

export function parseExerciseSets(seriesReps?: string): number {
  if (!seriesReps) return 3;
  const minMatch = seriesReps.match(/(\d+)\s*[-–]\s*(\d+)\s*min/);
  if (minMatch) return Math.max(5, parseInt(minMatch[2]!, 10));
  const m = seriesReps.match(/(\d+)\s*[xX×]/);
  if (m) return Math.max(1, parseInt(m[1]!, 10));
  return 3;
}

/** Formatea minutos del día a "HH:MM" */
export function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Convierte "HH:MM" a minutos del día */
export function timeToMin(timeStr?: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Suma minutos a una hora "HH:MM" */
export function addMinutesToTime(timeStr: string, minutes: number): string {
  const m = timeToMin(timeStr) + minutes;
  return minToTime(m);
}

/**
 * Calcula la distribución automática de ejercicios dentro del plazo de 2 horas (ej. 11:00 a 13:00),
 * teniendo en cuenta series, repeticiones y descansos para que no sobrepase las 2 horas.
 */
export function autoDistributeExercises(
  exercises: Exercise[],
  startClock = "11:00",
  maxDurationMin = 120,
): Record<string, ExerciseScheduleItem> {
  if (!exercises.length) return {};

  const startMin = timeToMin(startClock);

  const items = exercises.map((ex) => {
    let dur = 10;
    let rest = parseRestMinutes(ex.rest);

    const nameLower = ex.name.toLowerCase();
    if (nameLower.includes("calentamiento")) {
      dur = 8;
      rest = 2;
    } else if (nameLower.includes("estiramientos")) {
      dur = 8;
      rest = 0;
    } else if (nameLower.includes("trote")) {
      dur = 35;
      rest = 2;
    } else {
      const sets = parseExerciseSets(ex.series_reps);
      const isCompound = /bench|squat|deadlift|overhead|pull-ups|press/i.test(ex.name);
      const setWorkMin = 1;
      const setRestMin = isCompound ? 2 : 1;
      dur = Math.max(5, sets * setWorkMin + (sets - 1) * setRestMin);
      rest = isCompound ? 2 : 1;
    }

    return { id: ex.id, dur, rest };
  });

  const totalRaw = items.reduce((sum, it) => sum + it.dur + it.rest, 0);
  if (totalRaw > maxDurationMin) {
    const scale = maxDurationMin / totalRaw;
    for (const it of items) {
      it.dur = Math.max(4, Math.round(it.dur * scale));
      it.rest = Math.max(1, Math.round(it.rest * scale));
    }
  }

  let cur = startMin;
  const result: Record<string, ExerciseScheduleItem> = {};

  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const isLast = i === items.length - 1;
    let dur = it.dur;
    const rest = isLast ? 0 : it.rest;

    if (cur + dur + rest > startMin + maxDurationMin) {
      dur = Math.max(3, startMin + maxDurationMin - cur - rest);
    }

    const end = cur + dur;
    result[it.id] = {
      time: minToTime(cur),
      end_time: minToTime(end),
      duration_min: dur,
      rest_min: rest,
      in_calendar: true,
    };

    cur = end + rest;
  }

  return result;
}

