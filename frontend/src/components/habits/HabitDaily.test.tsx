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

describe("HabitDaily — Pestañas de vista, filtros y organización Notion", () => {
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
      area: "Salud",
      subtasks: [],
    },
    {
      id: "h-prog",
      name: "Programar",
      icon: "💻",
      schedule: "todos los días",
      days: [0, 1, 2, 3, 4, 5, 6],
      repeat: "",
      time: "14:00",
      area: "Estudio",
      subtasks: [
        { id: "sub-1", name: "Estudiar arquitectura" },
        { id: "sub-2", name: "Practicar código" },
      ],
    },
    {
      id: "h-nofa",
      name: "Nofa",
      icon: "🚫",
      schedule: "todos los días",
      days: [0, 1, 2, 3, 4, 5, 6],
      repeat: "",
      time: "",
      area: "Disciplina",
      subtasks: [],
    },
  ];

  const mockLog: HabitDayLog = {
    date: "2026-11-06",
    active: ["h-agua", "h-prog", "h-nofa"],
    completed: { "h-agua": true },
    subtasks: { "h-prog": { "sub-1": true } },
    notes: "Prioridad 1: Entregar proyecto",
    journal: "Excelente día de concentración.",
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

  it("cambia entre pestañas: Lista de Hábitos, Línea de tiempo y Por categoría", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const timelineBtn = buttons.find((b) => b.textContent?.includes("Línea de tiempo"));
    const categoryBtn = buttons.find((b) => b.textContent?.includes("Por categoría"));
    const listBtn = buttons.find((b) => b.textContent?.includes("Lista de Hábitos"));

    expect(timelineBtn).toBeDefined();
    expect(categoryBtn).toBeDefined();
    expect(listBtn).toBeDefined();

    // Switch to Por categoría
    await act(async () => {
      categoryBtn?.click();
    });

    // Category section headers should now be visible
    expect(container.textContent).toContain("Salud");
    expect(container.textContent).toContain("Estudio");
    expect(container.textContent).toContain("Disciplina");

    // Switch to Línea de tiempo
    await act(async () => {
      timelineBtn?.click();
    });
    expect(container.textContent).toContain("Orden cronológico");

    // Switch back to Lista de Hábitos
    await act(async () => {
      listBtn?.click();
    });
    expect(container.textContent).toContain("Programados por hora");
  });

  it("filtra hábitos por Todos, Pendientes y Completados", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const filterSelect = container.querySelector('select[aria-label="Filtrar hábitos"]') as HTMLSelectElement;
    expect(filterSelect).not.toBeNull();

    // Default 'all': 3 habits present
    expect(container.textContent).toContain("Tomar un vaso de agua");
    expect(container.textContent).toContain("Programar");
    expect(container.textContent).toContain("Nofa");

    // Filter by 'pending' -> 'Tomar un vaso de agua' is completed, so only Programar and Nofa
    await act(async () => {
      filterSelect.value = "pending";
      filterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Tomar un vaso de agua");
    expect(container.textContent).toContain("Programar");
    expect(container.textContent).toContain("Nofa");

    // Filter by 'completed' -> only 'Tomar un vaso de agua'
    await act(async () => {
      filterSelect.value = "completed";
      filterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Tomar un vaso de agua");
    expect(container.textContent).not.toContain("Programar");
    expect(container.textContent).not.toContain("Nofa");
  });

  it("permite ordenar hábitos por hora, nombre o estado", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const sortSelect = container.querySelector('select[aria-label="Ordenar hábitos"]') as HTMLSelectElement;
    expect(sortSelect).not.toBeNull();

    // Change to 'name' (alphabetical: Nofa, Programar, Tomar un vaso de agua)
    await act(async () => {
      sortSelect.value = "name";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(sortSelect.value).toBe("name");
  });

  it("el botón Marcar todos / Desmarcar todos completa o desmarca todos los hábitos activos", async () => {
    const setDoneSpy = vi.fn();
    useHabits.setState({ setDone: setDoneSpy });

    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const toggleAllBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Marcar todos"),
    );
    expect(toggleAllBtn).toBeDefined();

    await act(async () => {
      toggleAllBtn?.click();
    });

    // h-prog and h-nofa were not completed, so setDone should have been called for them
    expect(setDoneSpy).toHaveBeenCalledWith("2026-11-06", "h-prog", true);
    expect(setDoneSpy).toHaveBeenCalledWith("2026-11-06", "h-nofa", true);
  });

  it("renderiza y conmuta subtareas anidadas", async () => {
    const setSubtaskSpy = vi.fn();
    useHabits.setState({ setSubtask: setSubtaskSpy });

    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    expect(container.textContent).toContain("Estudiar arquitectura");
    expect(container.textContent).toContain("Practicar código");

    const subCheckbox = container.querySelector('input[type="checkbox"]:not([role])') as HTMLInputElement;
    expect(subCheckbox).not.toBeNull();

    await act(async () => {
      subCheckbox.click();
    });

    expect(setSubtaskSpy).toHaveBeenCalled();
  });

  it("permite navegar por fechas (Día anterior, Día siguiente, Hoy)", async () => {
    const setDaySpy = vi.fn();
    useHabits.setState({ setDay: setDaySpy });

    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const prevBtn = container.querySelector('button[aria-label="Día anterior"]') as HTMLButtonElement;
    const nextBtn = container.querySelector('button[aria-label="Día siguiente"]') as HTMLButtonElement;
    const todayBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Hoy");

    expect(prevBtn).not.toBeNull();
    expect(nextBtn).not.toBeNull();
    expect(todayBtn).toBeDefined();

    await act(async () => {
      prevBtn.click();
    });
    expect(setDaySpy).toHaveBeenCalledWith("2026-11-05");

    await act(async () => {
      nextBtn.click();
    });
    expect(setDaySpy).toHaveBeenCalledWith("2026-11-07");

    await act(async () => {
      todayBtn?.click();
    });
    expect(setDaySpy).toHaveBeenCalled();
  });

  it("las Notas del día y el Diario de reflexión permiten edición y atajos", async () => {
    const setDayTextSpy = vi.fn();
    useHabits.setState({ setDayText: setDayTextSpy });

    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitDaily />);
    });

    const textareas = container.querySelectorAll("textarea");
    expect(textareas.length).toBe(2);

    const notesArea = textareas[0] as HTMLTextAreaElement;
    const journalArea = textareas[1] as HTMLTextAreaElement;

    expect(notesArea.value).toBe("Prioridad 1: Entregar proyecto");
    expect(journalArea.value).toBe("Excelente día de concentración.");

    // Click on format shortcut button (Negrita)
    const boldBtn = container.querySelector('button[title="Insertar negrita"]') as HTMLButtonElement;
    expect(boldBtn).not.toBeNull();

    await act(async () => {
      boldBtn.click();
    });

    expect(notesArea.value).toContain("**Importante:**");

    // Click on Energy level selector
    const energyBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Alto");
    expect(energyBtn).toBeDefined();

    await act(async () => {
      energyBtn?.click();
    });

    // Archivar entrada button triggers immediate flush
    const archiveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Archivar entrada"),
    );
    expect(archiveBtn).toBeDefined();

    await act(async () => {
      archiveBtn?.click();
    });

    expect(setDayTextSpy).toHaveBeenCalled();
  });
});
