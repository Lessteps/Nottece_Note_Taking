// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { GymExercisesList } from "./GymExercisesList";
import type { Habit } from "../../lib/types";
import { api } from "../../lib/bridge";
import { useCalendar } from "../../store/calendar";
import { useApp } from "../../store/app";

vi.mock("../../lib/bridge", () => ({
  api: {
    exDays: vi.fn(),
  },
}));

describe("GymExercisesList", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockHabit: Habit = {
    id: "gym",
    name: "Ir al gimnasio",
    icon: "🏋",
    days: [0, 1, 2, 3, 4, 5, 6],
    subtasks: [],
    time: "11:00",
    duration_min: 120,
    schedule: "todos los días",
    exercise_schedules: {
      ex1: { time: "11:05", end_time: "11:30", duration_min: 25, rest_min: 2, in_calendar: true },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.exDays as any).mockResolvedValue([
      {
        date: "2026-11-07",
        day: "sabado",
        exercises: [
          { id: "ex1", name: "Press banca", series_reps: "4x10", rest: "90s" },
          { id: "ex2", name: "Aperturas con mancuernas", series_reps: "3x12", rest: "60s" },
        ],
        log: {},
        pct: 0,
      },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renderiza los ejercicios del día con sus rangos de horario y descansos", async () => {
    await act(async () => {
      root.render(<GymExercisesList day="2026-11-07" habit={mockHabit} onUpdate={vi.fn()} />);
    });

    expect(container.textContent).toContain("Press banca");
    expect(container.textContent).toContain("Aperturas con mancuernas");
    expect(container.textContent).toContain("11:05 – 11:30");
    expect(container.textContent).toContain("+2m descanso");
  });

  it("permite auto-distribuir la rutina entre las 11:00 y las 13:00 con descanso", async () => {
    const onUpdate = vi.fn();
    await act(async () => {
      root.render(<GymExercisesList day="2026-11-07" habit={mockHabit} onUpdate={onUpdate} />);
    });

    const autoBtn = container.querySelector<HTMLButtonElement>('button[title*="11:00 y las 13:00"]');
    expect(autoBtn).toBeDefined();

    act(() => {
      autoBtn!.click();
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ex1: expect.objectContaining({ time: "11:00", in_calendar: true }),
        ex2: expect.objectContaining({ in_calendar: true }),
      }),
    );
  });

  it("abre el modal de edición al hacer clic en el botón de editar", async () => {
    await act(async () => {
      root.render(<GymExercisesList day="2026-11-07" habit={mockHabit} onUpdate={vi.fn()} />);
    });

    const editBtns = container.querySelectorAll<HTMLButtonElement>('button[aria-label*="Configurar horario"]');
    expect(editBtns.length).toBeGreaterThan(0);

    act(() => {
      editBtns[0]!.click();
    });

    expect(document.body.textContent).toContain("Configurar ejercicio: Press banca");
    expect(document.body.textContent).toContain("Fecha de inicio (Desde)");
    expect(document.body.textContent).toContain("Tiempo de descanso (minutos)");
  });

  it("navega al calendario al hacer clic en Ver en calendario", async () => {
    const onUpdate = vi.fn();
    await act(async () => {
      root.render(<GymExercisesList day="2026-11-07" habit={mockHabit} onUpdate={onUpdate} />);
    });

    const calBtns = container.querySelectorAll<HTMLButtonElement>('button[title*="en el calendario"]');
    expect(calBtns.length).toBeGreaterThan(0);

    act(() => {
      calBtns[0]!.click();
    });

    expect(useCalendar.getState().day).toBe("2026-11-07");
    expect(useCalendar.getState().selectedOccId).toBe("ex_ex1_2026-11-07");
    expect(useApp.getState().module).toBe("calendario");
  });
});
