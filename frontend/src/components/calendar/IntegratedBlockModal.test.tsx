// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Occurrence } from "../../lib/types";
import { useCalendar } from "../../store/calendar";
import { activate, isIntegratedBlock } from "./actions";
import { IntegratedBlockModal } from "./IntegratedBlockModal";
import * as openTopicModule from "../mentor/openTopic";

const MOCK_PLAN = {
  id: "2026-10-06_2027-04-05",
  title: "Plan de Estudio",
  subplans: [
    {
      id: "s1-backend",
      area: "Backend",
      areaId: "backend",
      groups: [
        { id: "bases", title: "Bases" },
        { id: "lang-python", title: "Lenguaje: Python" },
        { id: "backend-fundamentals", title: "Backend fundamentals" },
      ],
      topics: [
        {
          folder: "Programación/1 Fundamentals/1.1 What programming is",
          title: "1.1 What programming is",
          group: "bases",
          targetWeek: 1,
        },
        {
          folder: "Programación/2 Python/2.1 Syntax",
          title: "2.1 Syntax",
          group: "lang-python",
          targetWeek: 2,
        },
        {
          folder: "Programación/4 Backend/4.1 What the backend is",
          title: "4.1 What the backend is",
          group: "backend-fundamentals",
          targetWeek: 3,
          completedAt: "2026-10-20",
        },
      ],
    },
  ],
};

vi.mock("../../lib/bridge", () => ({
  api: {
    mentorPlanList: vi.fn(async () => [
      { id: "2026-10-06_2027-04-05", name: "Plan", status: "activo" },
    ]),
    mentorPlanGet: vi.fn(async () => ({ plan: MOCK_PLAN })),
  },
}));

vi.mock("../mentor/openTopic", () => ({
  openTopic: vi.fn(async () => {}),
  openTopicNote: vi.fn(async () => {}),
  openTopicCanvas: vi.fn(async () => {}),
}));

describe("Bloques Integrados y Sub-eventos de Backend en Calendario", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    useCalendar.setState({ integratedBlockOcc: null, editor: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
  });

  it("isIntegratedBlock identifica bloques integrados y eventos de backend", () => {
    const blockOcc: Occurrence = {
      id: "mentor:block:2026-10-06_2027-04-05:2026-11-07:s1-backend",
      title: "⚡ Bloque Integrado: Backend",
      kind: "integrated_block",
      date: "2026-11-07",
      start: "09:00",
      duration_min: 120,
      colour: "#6366f1",
      done: false,
      source: "mentor",
      editable: false,
      checkable: false,
      links: [{
        type: "integrated_block",
        planId: "2026-10-06_2027-04-05",
        subplanId: "s1-backend",
        topicCount: 2,
        topics: [
          { folder: "P/1/1.1", title: "1.1 What programming is", group: "bases", done: false },
          { folder: "P/2/2.1", title: "2.1 Syntax", group: "lang-python", done: false },
        ],
      }] as any,
      reminder_min: null,
    };

    expect(isIntegratedBlock(blockOcc)).toBe(true);
  });

  it("activate() abre IntegratedBlockModal para bloques de backend", () => {
    const occ: Occurrence = {
      id: "mentor:block:p1:2026-11-07:backend",
      title: "⚡ Bloque Integrado: Backend",
      kind: "integrated_block",
      date: "2026-11-07",
      start: "09:00",
      duration_min: 60,
      colour: "#6366f1",
      done: false,
      source: "mentor",
      editable: false,
      checkable: false,
      links: [{ type: "integrated_block", planId: "p1", subplanId: "backend" }],
      reminder_min: null,
    };

    activate(occ, { clientX: 100, clientY: 100, preventDefault: () => {} });
    expect(useCalendar.getState().integratedBlockOcc).toEqual(occ);
  });

  it("IntegratedBlockModal muestra sub-eventos asignados para ese día por asignatura con acciones rápidas", async () => {
    const occ: Occurrence = {
      id: "mentor:block:2026-10-06_2027-04-05:2026-11-07:s1-backend",
      title: "⚡ Bloque Integrado: Backend",
      kind: "integrated_block",
      date: "2026-11-07",
      start: "09:00",
      duration_min: 120,
      colour: "#6366f1",
      done: false,
      source: "mentor",
      editable: false,
      checkable: false,
      links: [{
        type: "integrated_block",
        planId: "2026-10-06_2027-04-05",
        subplanId: "s1-backend",
        topicCount: 2,
        topics: [
          { folder: "Programación/1 Fundamentals/1.1 What programming is", title: "1.1 What programming is", group: "bases", done: false },
          { folder: "Programación/2 Python/2.1 Syntax", title: "2.1 Syntax", group: "lang-python", done: false },
        ],
      }] as any,
      reminder_min: null,
    };

    useCalendar.setState({ integratedBlockOcc: occ });

    await act(async () => {
      root!.render(<IntegratedBlockModal />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // En la vista de hoy deben aparecer los 2 sub-eventos de este día
    expect(container.textContent).toContain("Fundamentos de programación (Bases)");
    expect(container.textContent).toContain("Lenguaje: Python");
    expect(container.textContent).toContain("1.1 What programming is");
    expect(container.textContent).toContain("2.1 Syntax");

    // Verificar botones de acción rápida
    const buttons = Array.from(container.querySelectorAll("button"));
    const verTemaBtn = buttons.find((b) => b.textContent?.includes("Ver tema"));
    expect(verTemaBtn).toBeDefined();

    await act(async () => {
      verTemaBtn!.click();
    });
    expect(openTopicModule.openTopicNote).toHaveBeenCalledWith("Programación/1 Fundamentals/1.1 What programming is");

    const verPracticaBtn = buttons.find((b) => b.textContent?.includes("Ver práctica"));
    expect(verPracticaBtn).toBeDefined();

    await act(async () => {
      verPracticaBtn!.click();
    });
    expect(openTopicModule.openTopic).toHaveBeenCalledWith("Programación/1 Fundamentals/1.1 What programming is");

    const canvasBtn = buttons.find((b) => b.textContent?.includes("Canvas explicativo"));
    expect(canvasBtn).toBeDefined();

    await act(async () => {
      canvasBtn!.click();
    });
    expect(openTopicModule.openTopicCanvas).toHaveBeenCalledWith("Programación/1 Fundamentals/1.1 What programming is");
  });
});
