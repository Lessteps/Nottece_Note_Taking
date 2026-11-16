// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HomeModule } from "./HomeModule";
import { api } from "../../lib/bridge";

describe("HomeModule", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    vi.spyOn(api, "homeOverview").mockResolvedValue({
      today: "2026-09-26",
      habits: [
        { id: "h1", name: "Tomar un vaso de agua", icon: "💧", done: false, subs: [0, 0] },
        { id: "h2", name: "Sin celular al despertar", icon: "📵", done: true, subs: [0, 0] },
      ],
      exercise: {
        day: "sabado",
        rows: [
          {
            id: "e1",
            name: "Towel / Barbell Hang",
            series_reps: "3 × 15-20 seg",
            how_to: "Agarre y descompresión escapular",
            entry: { done: false },
          },
        ],
      },
      tasks: {
        today: [{ id: "t1", name: "Revisar arquitectura", status: "Por hacer", subject: "Review", priority: 1, due: "2026-09-26", done: false }],
        overdue: [],
      },
      projects: {
        issues: [{ project: { id: "p1", name: "NoteVault", colour: "#8b7cf6", done_column: "Done", first_column: "Backlog" }, id: "i1", key: "NV-1", title: "Issue 1", due: "2026-09-26", done: false }],
        active: [{ id: "p1", name: "NoteVault", icon: "⚡", colour: "#8b7cf6", progress: 0.5 }],
      },
      finance: {
        day: { gasto: 0, ingreso: 0, ahorro: 0, retiro: 0, balance: 0, neto: 0, disponible: 0 },
        month: { gasto: 100, ingreso: 500, ahorro: 100, retiro: 0, balance: 342000, neto: 400, disponible: 300 },
        prev: { gasto: 80, ingreso: 400, ahorro: 50, retiro: 0, balance: 250000, neto: 320, disponible: 270 },
        checks: [],
      },
      goals: {
        list: [{ id: "g1", name: "Maestría Código", icon: "🎯", colour: "#22d3ee", progress: 0.75 }],
        items: [],
        any: true,
      },
    });

    vi.spyOn(api, "habitsStats").mockResolvedValue({
      today: "2026-09-26",
      day: 1,
      week: 1,
      month: 1,
      year: 1,
      streak: 14,
      habits: {},
    });

    vi.spyOn(api, "habitsRange").mockResolvedValue([
      { date: "2026-09-21", active: ["h1"], done: ["h1"], pct: 100 },
      { date: "2026-09-22", active: ["h1"], done: ["h1"], pct: 100 },
      { date: "2026-09-23", active: ["h1"], done: ["h1"], pct: 100 },
      { date: "2026-09-24", active: ["h1"], done: ["h1"], pct: 100 },
      { date: "2026-09-25", active: ["h1"], done: ["h1"], pct: 100 },
      { date: "2026-09-26", active: ["h1", "h2"], done: ["h2"], pct: 50 },
      { date: "2026-09-27", active: [], done: [], pct: 0 },
    ]);

    vi.spyOn(api, "calRange").mockResolvedValue({
      "2026-09-26": [
        {
          id: "c1",
          date: "2026-09-26",
          kind: "exercise",
          title: "Back etc. Workout",
          start: "08:30",
          duration_min: 42,
          done: false,
          checkable: true,
          colour: "#8b7cf6",
          source: "manual",
          editable: true,
          links: [],
          reminder_min: null,
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeChild(container);
  });

  it("renders header, focus engine banner, stat cards, and panels", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    // Verify Title & Subtitle
    expect(container.textContent).toContain("Vista General");
    expect(container.textContent).not.toContain("Sprint v");
    expect(container.textContent).toContain("NOTEVAULT FOCUS ENGINE");
    expect(container.textContent).toContain("14 Días de Racha activa");

    // Verify Stat Cards
    expect(container.textContent).toContain("HÁBITOS DE HOY");
    expect(container.textContent).toContain("EJERCICIO");
    expect(container.textContent).toContain("PROYECTOS");
    expect(container.textContent).toContain("TAREAS PARA HOY");
    expect(container.textContent).toContain("FINANZAS");

    // Verify Habit and Exercise Panels
    expect(container.textContent).toContain("Hábitos de hoy");
    expect(container.textContent).toContain("Tomar un vaso de agua");
    expect(container.textContent).toContain("Towel / Barbell Hang");

    // Verify Bottom Row Panels & Acceso Rápido
    expect(container.textContent).toContain("Progreso de Objetivos");
    expect(container.textContent).toContain("Ahorros");
    expect(container.textContent).toContain("Registrar Ahorro");

    act(() => {
      root.unmount();
    });
  });

  it("toggles habit completion optimistically", async () => {
    const habitsSetDoneSpy = vi.spyOn(api, "habitsSetDone").mockResolvedValue({ ok: true, pct: 100 });
    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    // Find the button for "Tomar un vaso de agua"
    const habitButton = container.querySelector('button[aria-label="Tomar un vaso de agua"]') as HTMLButtonElement;
    expect(habitButton).not.toBeNull();

    await act(async () => {
      habitButton.click();
    });

    expect(habitsSetDoneSpy).toHaveBeenCalledWith("2026-09-26", "h1", true);

    act(() => {
      root.unmount();
    });
  });

  it("toggles exercise completion optimistically (A2)", async () => {
    const exMarkSpy = vi.spyOn(api, "exMark").mockResolvedValue({ ok: true, pct: 100 });
    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    const exButton = container.querySelector('button[aria-label="Towel / Barbell Hang"]') as HTMLButtonElement;
    expect(exButton).not.toBeNull();

    await act(async () => {
      exButton.click();
    });

    expect(exMarkSpy).toHaveBeenCalledWith("2026-09-26", "e1", true, 0, 0, "");

    act(() => {
      root.unmount();
    });
  });

  it("toggles collapsible sections like agenda and habits", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    // Check Agenda section title
    expect(container.textContent).toContain("Agenda Diaria • Rutina");
    expect(container.textContent).toContain("Back etc. Workout");

    // Click Agenda chevron to collapse
    const agendaToggle = container.querySelector('[data-testid="toggle-agenda"]') as HTMLDivElement;
    expect(agendaToggle).not.toBeNull();

    await act(async () => {
      agendaToggle.click();
    });

    // Content inside should be collapsed
    expect(container.textContent).not.toContain("Back etc. Workout");
    expect(container.textContent).toContain("1 actividad");

    // Click again to expand
    await act(async () => {
      agendaToggle.click();
    });

    expect(container.textContent).toContain("Back etc. Workout");

    // Click Habits chevron to collapse
    const habitsToggle = container.querySelector('[data-testid="toggle-habits"]') as HTMLDivElement;
    expect(habitsToggle).not.toBeNull();
    expect(container.textContent).toContain("Today's Habits");

    await act(async () => {
      habitsToggle.click();
    });

    // Content inside habits should be collapsed (no banner or bottom button)
    expect(container.textContent).not.toContain("Today's Habits");

    // Test Colapsar todo / Expandir todo button
    const toggleAllBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Colapsar todo") || b.textContent?.includes("Expandir todo")
    );
    expect(toggleAllBtn).not.toBeUndefined();

    await act(async () => {
      toggleAllBtn!.click();
    });

    // Everything collapsed
    expect(container.textContent).not.toContain("Back etc. Workout");
    expect(container.textContent).not.toContain("Today's Habits");
    expect(toggleAllBtn!.textContent).toBe("Expandir todo");

    await act(async () => {
      toggleAllBtn!.click();
    });

    // Everything expanded again
    expect(container.textContent).toContain("Back etc. Workout");
    expect(container.textContent).toContain("Today's Habits");
    expect(toggleAllBtn!.textContent).toBe("Colapsar todo");

    act(() => {
      root.unmount();
    });
  });

  it("opens search modal and searches concrete items across categories", async () => {
    vi.spyOn(api, "noteIndex").mockResolvedValue([
      { title: "Nota de Arquitectura Backend", path: "Backend/Arquitectura.md" } as any,
    ]);

    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    // Find Search button in top bar or sidebar
    const searchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Buscar") || b.getAttribute("aria-label") === "Buscar en Vault"
    );
    expect(searchBtn).toBeDefined();

    await act(async () => {
      searchBtn!.click();
    });

    // Modal should be open
    expect(container.textContent).toContain("Vault Antigravity Search");
    const searchInput = container.querySelector('input[placeholder*="Buscar notas, tareas"]') as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    // Type query
    await act(async () => {
      searchInput.value = "arquitectura";
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Should find the task and note related to arquitectura
    expect(container.textContent).toContain("Revisar arquitectura");

    act(() => {
      root.unmount();
    });
  });

  it("opens food search modal and displays presets", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HomeModule />);
    });

    const addFoodBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Añadir alimento")
    );
    expect(addFoodBtns.length).toBeGreaterThan(0);

    await act(async () => {
      addFoodBtns[0]!.click();
    });

    // Modal should show
    expect(container.textContent).toContain("Añadir Alimento a");
    expect(container.textContent).toContain("Pechuga de Pollo 150g");

    act(() => {
      root.unmount();
    });
  });
});
