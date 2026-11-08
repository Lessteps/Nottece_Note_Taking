// Temporizador de ejercicios y repeticiones (Workout Timer)
// Inspirado en el Pomodoro de Mentor, adaptado para series de entrenamiento,
// cronometraje de repeticiones y descansos automáticos con aviso sonoro.

import { create } from "zustand";
import { api } from "../lib/bridge";
import { parseRestSeconds, playRestBeep } from "./restTimer";

export type WorkoutPhase = "idle" | "work" | "rest";

export interface CompletedSet {
  setNumber: number;
  weight: number;
  reps: number;
  durationSec: number;
  completedAt: number;
}

export interface WorkoutTimerState {
  exerciseId: string | null;
  exerciseName: string;
  day: string;
  totalSets: number;
  currentSet: number;
  targetReps: string;
  restSeconds: number;
  phase: WorkoutPhase;
  running: boolean;
  remainingSeconds: number;
  elapsedSeconds: number;
  completedSets: CompletedSet[];
  modalOpen: boolean;
  sound: boolean;

  openTimer: (
    ex?: { id: string; name: string; series_reps?: string; rest?: string },
    day?: string,
  ) => void;
  closeModal: () => void;
  setTotalSets: (n: number) => void;
  setRestSeconds: (s: number) => void;
  startSet: () => void;
  finishSet: (reps?: number, weight?: number) => Promise<void>;
  startRest: (seconds?: number) => void;
  skipRest: () => void;
  pause: () => void;
  resume: () => void;
  addSeconds: (delta: number) => void;
  reset: () => void;
  toggleSound: () => void;
}

let timerInterval: ReturnType<typeof setInterval> | null = null;

function clearWorkoutInterval() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/** Extrae el número de series sugerido (ej. "4x10-12" -> 4). */
export function parseSeriesCount(raw?: string): number {
  if (!raw) return 4;
  const m = raw.match(/(\d+)\s*[xX×]/);
  if (m) {
    const val = Number(m[1]);
    if (val > 0 && val <= 20) return val;
  }
  const plain = Number(raw.trim());
  if (plain > 0 && plain <= 20) return plain;
  return 4;
}

export const useWorkoutTimer = create<WorkoutTimerState>((set, get) => ({
  exerciseId: null,
  exerciseName: "Entrenamiento",
  day: "",
  totalSets: 4,
  currentSet: 1,
  targetReps: "10-12",
  restSeconds: 90,
  phase: "idle",
  running: false,
  remainingSeconds: 0,
  elapsedSeconds: 0,
  completedSets: [],
  modalOpen: false,
  sound: true,

  openTimer: (ex, day) => {
    const state = get();
    if (ex && ex.id !== state.exerciseId) {
      clearWorkoutInterval();
      const sets = parseSeriesCount(ex.series_reps);
      const rest = parseRestSeconds(ex.rest ?? "90s");
      set({
        exerciseId: ex.id,
        exerciseName: ex.name,
        day: day ?? "",
        totalSets: sets,
        currentSet: 1,
        targetReps: ex.series_reps || "10-12",
        restSeconds: rest,
        phase: "idle",
        running: false,
        remainingSeconds: 0,
        elapsedSeconds: 0,
        completedSets: [],
        modalOpen: true,
      });
    } else {
      set({ modalOpen: true });
    }
  },

  closeModal: () => set({ modalOpen: false }),

  setTotalSets: (totalSets) => set({ totalSets: Math.max(1, Math.min(20, totalSets)) }),

  setRestSeconds: (restSeconds) => set({ restSeconds: Math.max(5, Math.min(600, restSeconds)) }),

  startSet: () => {
    clearWorkoutInterval();
    set({
      phase: "work",
      running: true,
      elapsedSeconds: 0,
    });

    timerInterval = setInterval(() => {
      const state = get();
      if (!state.running || state.phase !== "work") return;
      set({ elapsedSeconds: state.elapsedSeconds + 1 });
    }, 1000);
  },

  finishSet: async (reps = 10, weight = 0) => {
    clearWorkoutInterval();
    const state = get();
    const completedSet: CompletedSet = {
      setNumber: state.currentSet,
      weight,
      reps,
      durationSec: state.elapsedSeconds,
      completedAt: Date.now(),
    };

    const newCompleted = [...state.completedSets, completedSet];

    // Guardar en backend si hay ejercicio y día
    if (state.exerciseId && state.day) {
      try {
        await api.exMark(state.day, state.exerciseId, true, weight, reps, "");
      } catch {
        // Ignorar si falla el guardado offline
      }
    }

    if (state.currentSet >= state.totalSets) {
      // Todas las series completadas
      if (state.sound) playRestBeep();
      set({
        phase: "idle",
        running: false,
        completedSets: newCompleted,
        elapsedSeconds: 0,
        remainingSeconds: 0,
      });
      return;
    }

    // Iniciar descanso para la siguiente serie
    const nextSet = state.currentSet + 1;
    set({
      completedSets: newCompleted,
      currentSet: nextSet,
      phase: "rest",
      running: true,
      remainingSeconds: state.restSeconds,
      elapsedSeconds: 0,
    });

    timerInterval = setInterval(() => {
      const s = get();
      if (!s.running || s.phase !== "rest") return;

      if (s.remainingSeconds <= 1) {
        clearWorkoutInterval();
        if (s.sound) playRestBeep();
        set({
          phase: "idle",
          running: false,
          remainingSeconds: 0,
        });
      } else {
        set({ remainingSeconds: s.remainingSeconds - 1 });
      }
    }, 1000);
  },

  startRest: (customSeconds) => {
    clearWorkoutInterval();
    const state = get();
    const secs = customSeconds !== undefined ? customSeconds : state.restSeconds;

    set({
      phase: "rest",
      running: true,
      remainingSeconds: secs,
      elapsedSeconds: 0,
    });

    timerInterval = setInterval(() => {
      const s = get();
      if (!s.running || s.phase !== "rest") return;

      if (s.remainingSeconds <= 1) {
        clearWorkoutInterval();
        if (s.sound) playRestBeep();
        set({
          phase: "idle",
          running: false,
          remainingSeconds: 0,
        });
      } else {
        set({ remainingSeconds: s.remainingSeconds - 1 });
      }
    }, 1000);
  },

  skipRest: () => {
    clearWorkoutInterval();
    set({
      phase: "idle",
      running: false,
      remainingSeconds: 0,
    });
  },

  pause: () => {
    set({ running: false });
  },

  resume: () => {
    set({ running: true });
  },

  addSeconds: (delta) => {
    const s = get();
    if (s.phase === "rest") {
      set({ remainingSeconds: Math.max(5, s.remainingSeconds + delta) });
    }
  },

  reset: () => {
    clearWorkoutInterval();
    set({
      exerciseId: null,
      exerciseName: "Entrenamiento",
      phase: "idle",
      running: false,
      currentSet: 1,
      remainingSeconds: 0,
      elapsedSeconds: 0,
      completedSets: [],
    });
  },

  toggleSound: () => set((s) => ({ sound: !s.sound })),
}));
