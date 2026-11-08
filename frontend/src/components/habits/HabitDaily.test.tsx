// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HabitDaily } from "./HabitDaily";
import { useHabits } from "../../store/habits";
import type { Habit, HabitDayLog } from "../../lib/types";

describe("HabitDaily — Botón de editar hábito", () => {
  let container: HTMLDivElement;

  const mockHabits: Habit[] = [
    {
      id: "h-agua",
      name: "Tomar un vaso de agua",
      icon: "💧",
      schedule: "todos los días",
      days: [0, 1, 2, 3, 4, 5, 6],
      repeat: "",
      time: "08:00",
      duration_min: 5,
      colour: "#06b6d4",
      in_calendar: false,
      area: "Salud",
      notes: "Un vaso al despertar",
      subtasks: [],
    },
    {
      id: "h-leer",
      name: "Lectura",
      icon: "📖",
      schedule: "fines de semana",
      days: [0, 6],
      repeat: "",
      duration_min: 30,
      colour: "#8b5cf6",
      in_calendar: false,
      area: "Estudio",
      notes: "",
      subtasks: [],
    },
  ];

  const mockLog: HabitDayLog = {
    date: "2026-11-06",
    active: ["h-agua"],
    completed: {},
    subtasks: {},
    notes: "",
    journal: "",
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    useHabits.setState({
      day: "2026-11-06",
      habits: mockHabits,
      log: mockLog,
      loaded: true,
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it("renderiza el botón de editar al lado de cada hábito activo", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const editBtn = container.querySelector('button[title="Editar hábito: Tomar un vaso de agua"]');
    expect(editBtn).not.toBeNull();
  });

  it("abre el modal de edición al hacer clic en el botón de editar", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const editBtn = container.querySelector('button[title="Editar hábito: Tomar un vaso de agua"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();

    await act(async () => {
      editBtn.click();
    });

    const modal = document.querySelector('[role="dialog"][aria-label="Editar hábito"]');
    expect(modal).not.toBeNull();
    const inputs = modal?.querySelectorAll("input");
    expect((inputs?.[1] as HTMLInputElement)?.value).toBe("Tomar un vaso de agua");
    expect(modal?.textContent).toContain("Se repite");
    expect(modal?.textContent).toContain("Hora");
  });

  it("cierra el modal de edición al hacer clic en Listo o en el botón Cerrar", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const editBtn = container.querySelector('button[title="Editar hábito: Tomar un vaso de agua"]') as HTMLButtonElement;
    await act(async () => {
      editBtn.click();
    });

    let modal = document.querySelector('[role="dialog"][aria-label="Editar hábito"]');
    expect(modal).not.toBeNull();

    const listoBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Listo");
    expect(listoBtn).toBeDefined();

    await act(async () => {
      listoBtn?.click();
    });

    modal = document.querySelector('[role="dialog"][aria-label="Editar hábito"]');
    expect(modal).toBeNull();
  });

  it("permite abrir la edición de hábitos que no tocan hoy", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const restBtn = container.querySelector('button[title="Editar hábito: Lectura"]') as HTMLButtonElement;
    expect(restBtn).not.toBeNull();

    await act(async () => {
      restBtn.click();
    });

    const modal = document.querySelector('[role="dialog"][aria-label="Editar hábito"]');
    expect(modal).not.toBeNull();
    const inputs = modal?.querySelectorAll("input");
    expect((inputs?.[1] as HTMLInputElement)?.value).toBe("Lectura");
  });

  it("lleva al calendario y selecciona el hábito al pulsar Ver en el calendario", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const calBtn = container.querySelector('button[title*="Ver Tomar un vaso de agua en el calendario"]') as HTMLButtonElement;
    expect(calBtn).not.toBeNull();

    await act(async () => {
      calBtn.click();
    });

    // Debe cambiar de módulo a calendario y fijar el hábito seleccionado
    const { useApp } = await import("../../store/app");
    const { useCalendar } = await import("../../store/calendar");
    expect(useApp.getState().module).toBe("calendario");
    expect(useCalendar.getState().day).toBe("2026-11-06");
    expect(useCalendar.getState().selectedOccId).toBe("habit:h-agua");
  });

  it("renderiza el botón Ver en calendario en el encabezado de la vista Diaria", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const headerCalBtn = container.querySelector('button[title="Ver este día en el calendario"]') as HTMLButtonElement;
    expect(headerCalBtn).not.toBeNull();
    expect(headerCalBtn.textContent).toContain("Ver en calendario");
  });
});
