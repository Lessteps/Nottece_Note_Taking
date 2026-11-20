// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HabitHeatmap } from "./HabitHeatmap";
import { useHabits } from "../../store/habits";
import type { Habit, HabitRangeDay } from "../../lib/types";

describe("HabitHeatmap — Matriz de actividad y consistencia", () => {
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
      subtasks: [],
    },
    {
      id: "h-leer",
      name: "Lectura",
      icon: "📖",
      schedule: "todos los días",
      days: [0, 1, 2, 3, 4, 5, 6],
      repeat: "",
      time: "19:00",
      subtasks: [],
    },
    {
      id: "h-gym",
      name: "Gimnasio",
      icon: "🏋️",
      schedule: "todos los días",
      days: [0, 1, 2, 3, 4, 5, 6],
      repeat: "",
      time: "11:00",
      subtasks: [],
    },
  ];

  // Mock days:
  // 2026-11-10: 3 active, 2 done -> Majority fulfilled (66%) -> Should be green in General mode
  // 2026-11-11: 3 active, 1 done (h-leer) -> No majority (33%) -> Dark in General mode, but GREEN for h-leer in Individual mode!
  // 2026-11-12: 3 active, 0 done -> Dark in both modes
  const mockRows: Record<string, HabitRangeDay> = {
    "2026-11-10": {
      date: "2026-11-10",
      active: ["h-agua", "h-leer", "h-gym"],
      done: ["h-agua", "h-gym"],
      pct: 2 / 3,
    },
    "2026-11-11": {
      date: "2026-11-11",
      active: ["h-agua", "h-leer", "h-gym"],
      done: ["h-leer"],
      pct: 1 / 3,
    },
    "2026-11-12": {
      date: "2026-11-12",
      active: ["h-agua", "h-leer", "h-gym"],
      done: [],
      pct: 0,
    },
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    useHabits.setState({
      day: "2026-11-12",
      habits: mockHabits,
      rows: mockRows,
      loaded: true,
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it("renderiza el título, los botones de modo y la leyenda Menos / Más", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitHeatmap activeDay="2026-11-12" />);
    });

    expect(container.textContent).toContain("Matriz de Actividad y Hábitos");
    expect(container.textContent).toContain("General (Todos)");
    expect(container.textContent).toContain("Hábito individual");
    expect(container.textContent).toContain("Menos");
    expect(container.textContent).toContain("Más");
  });

  it("en modo General, se ilumina de forma proporcional y verde visible desde 1 hábito cumplido", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitHeatmap activeDay="2026-11-12" initialMode="general" />);
    });

    // 2026-11-10 had 2/3 done (66%): should be medium green (#2ea043 -> rgb(46, 160, 67))
    const btnMedium = container.querySelector('button[aria-label*="2026-11-10"]') as HTMLButtonElement;
    expect(btnMedium).not.toBeNull();
    expect(btnMedium.style.backgroundColor).toBe("rgb(46, 160, 67)");

    // 2026-11-11 had 1/3 done: having at least 1 habit done MUST light up visibly green (#1f883d -> rgb(31, 136, 61)) and NEVER be black
    const btnAtLeastOne = container.querySelector('button[aria-label*="2026-11-11"]') as HTMLButtonElement;
    expect(btnAtLeastOne).not.toBeNull();
    expect(btnAtLeastOne.style.backgroundColor).toBe("rgb(31, 136, 61)");
    expect(btnAtLeastOne.style.backgroundColor).not.toBe("rgb(22, 27, 34)");

    // 2026-11-12 had 0 done: must be dark background (#161b22 -> rgb(22, 27, 34))
    const btnZeroDone = container.querySelector('button[aria-label*="2026-11-12"]') as HTMLButtonElement;
    expect(btnZeroDone).not.toBeNull();
    expect(btnZeroDone.style.backgroundColor).toBe("rgb(22, 27, 34)");
  });

  it("en modo Hábito individual, se colorea verde brillante con un solo cumplimiento", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HabitHeatmap
          activeDay="2026-11-12"
          initialMode="individual"
          initialHabitId="h-leer"
        />,
      );
    });

    // On 2026-11-11, h-leer was done: with 1 single fulfillment, it MUST turn bright green!
    const btnLeer = container.querySelector('button[aria-label*="2026-11-11"]') as HTMLButtonElement;
    expect(btnLeer).not.toBeNull();
    // Full bright green #39d353 -> rgb(57, 211, 83)
    expect(btnLeer.style.backgroundColor).toBe("rgb(57, 211, 83)");

    // On 2026-11-10, h-leer was NOT done: must be dark
    const btnLeerNotDone = container.querySelector('button[aria-label*="2026-11-10"]') as HTMLButtonElement;
    expect(btnLeerNotDone).not.toBeNull();
    expect(btnLeerNotDone.style.backgroundColor).toBe("rgb(22, 27, 34)");
  });

  it("cambiar de modo General a Individual muestra el selector de hábito", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<HabitHeatmap activeDay="2026-11-12" initialMode="general" />);
    });

    let select = container.querySelector("select");
    expect(select).toBeNull();

    const indBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Hábito individual"),
    );
    expect(indBtn).toBeDefined();

    await act(async () => {
      indBtn?.click();
    });

    select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect(select?.textContent).toContain("Tomar un vaso de agua");
    expect(select?.textContent).toContain("Lectura");
    expect(select?.textContent).toContain("Gimnasio");
  });

  it("permite cambiar el hábito seleccionado en modo individual", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HabitHeatmap
          activeDay="2026-11-12"
          initialMode="individual"
          initialHabitId="h-agua"
        />,
      );
    });

    // 2026-11-10 had h-agua done -> bright green #39d353
    const btn10 = container.querySelector('button[aria-label*="2026-11-10"]') as HTMLButtonElement;
    expect(btn10.style.backgroundColor).toBe("rgb(57, 211, 83)");

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();

    await act(async () => {
      select.value = "h-leer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Now h-leer on 2026-11-10 was NOT done -> should be dark
    expect(btn10.style.backgroundColor).toBe("rgb(22, 27, 34)");
  });

  it("hacer clic en una celda llama a onSelectDay con la fecha", async () => {
    const onSelectDay = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HabitHeatmap
          activeDay="2026-11-12"
          onSelectDay={onSelectDay}
          initialMode="general"
        />,
      );
    });

    const btn = container.querySelector('button[aria-label*="2026-11-10"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    await act(async () => {
      btn.click();
    });

    expect(onSelectDay).toHaveBeenCalledWith("2026-11-10");
  });
});

