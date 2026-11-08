import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseSeriesCount, useWorkoutTimer } from "./workoutTimer";

describe("workoutTimer store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkoutTimer.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parseSeriesCount extrae el número de series correctamente", () => {
    expect(parseSeriesCount("4x10-12")).toBe(4);
    expect(parseSeriesCount("3 × 15")).toBe(3);
    expect(parseSeriesCount("5")).toBe(5);
    expect(parseSeriesCount("")).toBe(4);
    expect(parseSeriesCount(undefined)).toBe(4);
  });

  it("inicia una serie y cuenta los segundos transcurridos", () => {
    const timer = useWorkoutTimer.getState();
    timer.openTimer({ id: "ex1", name: "Press banca", series_reps: "4x10", rest: "60s" }, "2026-11-07");

    expect(useWorkoutTimer.getState().exerciseName).toBe("Press banca");
    expect(useWorkoutTimer.getState().totalSets).toBe(4);
    expect(useWorkoutTimer.getState().phase).toBe("idle");

    useWorkoutTimer.getState().startSet();
    expect(useWorkoutTimer.getState().phase).toBe("work");
    expect(useWorkoutTimer.getState().running).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(useWorkoutTimer.getState().elapsedSeconds).toBe(3);
  });

  it("completar una serie inicia automáticamente el descanso", async () => {
    const timer = useWorkoutTimer.getState();
    timer.openTimer({ id: "ex1", name: "Press banca", series_reps: "3x10", rest: "30s" }, "2026-11-07");
    timer.startSet();

    vi.advanceTimersByTime(20000); // 20s de trabajo
    await useWorkoutTimer.getState().finishSet(10, 50);

    const s = useWorkoutTimer.getState();
    expect(s.completedSets).toHaveLength(1);
    expect(s.completedSets[0]!.reps).toBe(10);
    expect(s.completedSets[0]!.weight).toBe(50);
    expect(s.currentSet).toBe(2);
    expect(s.phase).toBe("rest");
    expect(s.remainingSeconds).toBe(30);

    // Contar 10s de descanso
    vi.advanceTimersByTime(10000);
    expect(useWorkoutTimer.getState().remainingSeconds).toBe(20);

    // Añadir 15s de descanso
    useWorkoutTimer.getState().addSeconds(15);
    expect(useWorkoutTimer.getState().remainingSeconds).toBe(35);
  });
});

