// @vitest-environment jsdom
//
// Area C of FIX_VIEWS: the topic view follows the reference design —
// "PRÁCTICA DEL TEMA" + SRS chips, numbered title, Resumen / Practicar tema
// toggle, the ESTADO GLOBAL hero with its ring and cards, the skill × difficulty
// matrix with a description on every row, the SRS card and the keyboard hint.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../../lib/bridge";
import { MATHEMATICS_SKILLS } from "../../lib/skills";
import type { StudySnapshot, TopicData } from "../../lib/types";
import { toOpenNote } from "../../store/app";
import { TopicFileView } from "./TopicFileView";

const note = toOpenNote({
  path: "Matemáticas/1 Aritmética/1.12 Porcentajes/1.12 Porcentajes.practica.md",
  title: "1.12 Porcentajes",
  kind: "note",
  raw: "---\ntype: practica\n---\n\n# Práctica\n",
  frontmatter: { type: "practica", subject: "mathematics" },
  modified: 1,
  bookmarked: false,
} as never);

const SKILL_IDS = ["solve", "process", "prove", "counterexample", "true_false", "find_error", "drill", "explain"];

const progressSkills = Object.fromEntries(
  SKILL_IDS.map((id) => {
    const definition = MATHEMATICS_SKILLS.find((s) => s.id === id)!;
    const emptyCell = { attempts: 0, passes: 0, bestScore: null };
    return [
      id,
      {
        skill: id,
        label: definition.label,
        description: definition.description,
        status: "not_started",
        totalAttempts: 0,
        totalPasses: 0,
        bestScore: null,
        highestPassedDifficulty: 0,
        cells: { 1: { ...emptyCell, skill: id, difficulty: 1 }, 2: { ...emptyCell, skill: id, difficulty: 2 }, 3: { ...emptyCell, skill: id, difficulty: 3 } },
        consolidated: false,
        mastered: false,
      },
    ];
  }),
);

const topicData = {
  is_topic: true,
  folder: "Matemáticas/1 Aritmética/1.12 Porcentajes",
  topic: {
    type: "topic",
    subject: "mathematics",
    title: "1.12 Porcentajes",
    skills: SKILL_IDS,
    mastery: { min_per_skill: 6, target_difficulty: 3, exam: "required" },
  },
  progress: {
    completenessPct: 0,
    skills: progressSkills,
    examPassed: false,
    examScore: null,
    isComplete: false,
    theoryNotesCount: 1,
    exerciseNotesCount: 0,
  },
  exercises: [],
  theory_notes: [],
} as unknown as TopicData;

const snapshot = {
  area: { subject: "mathematics", title: "Matemáticas", subject_title: "Matemáticas", folder: "Matemáticas" },
  exercises: 0,
  queue: { items: [], gaps: [], counts: { recommendations: 0, srs_exercises: 0, cards: 0, total: 0 } },
  ledgers: [],
} as unknown as StudySnapshot;

let container: HTMLDivElement;

function mount(data: TopicData = topicData) {
  vi.spyOn(api, "studyTopicGet").mockResolvedValue(data);
  vi.spyOn(api, "studySnapshot").mockResolvedValue(snapshot);
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<TopicFileView note={note} />);
  });
}

const text = () => container.textContent ?? "";

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("TopicFileView", () => {
  it("shows the reference header: chips, numbered title, toggle, refresh and avatar", async () => {
    mount();
    await settle();

    expect(text()).toContain("Práctica del tema");
    expect(text()).toContain("SRS al día");
    expect(text()).toContain("1.12"); // the number, apart from the title
    expect(text()).toContain("Porcentajes");
    expect(container.querySelector('[role="tablist"][aria-label="Vista del tema"]')).toBeTruthy();
    expect(text()).toContain("Practicar tema");
    expect(container.querySelector('button[aria-label="Recargar"]')).toBeTruthy();
    // The avatar carries the subject's initials.
    expect(container.querySelector('span[title="Matemáticas"]')?.textContent).toBe("M");
  });

  it("renders the ESTADO GLOBAL hero with the ring, the goal cards and the actions", async () => {
    mount();
    await settle();

    expect(text()).toContain("Estado global");
    expect(text()).toContain("Dominio del Tema");
    expect(text()).toContain("0%"); // the ring's label
    expect(text()).toContain("Meta por Skill");
    expect(text()).toContain("Dificultad 3");
    expect(text()).toContain("Mínimo 6 ejercicios c/u");
    expect(text()).toContain("Examen Final");
    expect(text()).toContain("Bloqueado");
    expect(text()).toContain("8 competencias sin iniciar");
    expect(text()).toContain("Iniciar Práctica Global");
    expect(text()).toContain("Tomar examen");
    // The ring is a real chart, not a number in a circle.
    expect(container.querySelectorAll("svg[role=img]").length).toBeGreaterThan(0);
  });

  it("lists every competency with its description, the three difficulties and its own action", async () => {
    mount();
    await settle();

    expect(text().toLowerCase()).toContain("matriz de competencias");
    expect(text()).toContain("SKILL × DIFICULTAD");
    expect(text().toLowerCase()).toContain("habilidad pedagógica");
    for (const heading of ["★ Fácil", "•• Med", "••• Dif"]) {
      expect(text(), `missing ${heading}`).toContain(heading);
    }
    for (const skill of MATHEMATICS_SKILLS) {
      expect(text(), `“${skill.label}” is missing from the matrix`).toContain(skill.label);
      expect(text(), `“${skill.label}” has no description`).toContain(skill.description);
    }
    expect(text()).toContain("0 / 6");
    expect(text()).toContain("Pendiente");
    // Expand toggle + action button per row inside the matrix.
    expect([...container.querySelectorAll("table button")].length).toBe(SKILL_IDS.length * 2);
  });

  it("opens the configurator on the competency of the row that was clicked", async () => {
    mount();
    await settle();

    const row = [...container.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("Contraejemplo"))!;
    const action = [...row.querySelectorAll("button")].find((b) => b.textContent?.includes("Practicar"))!;
    await act(async () => {
      action.click();
      await Promise.resolve();
    });
    await settle();

    const configure = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Configurar ayuda"));
    if (configure) {
      await act(async () => {
        configure.click();
        await Promise.resolve();
      });
      await settle();
    }

    expect(text()).toContain("Competencia a entrenar");
    const selected = [...container.querySelectorAll("button[aria-pressed=true]")].map((b) => b.textContent ?? "");
    expect(selected.some((s) => s.includes("Contraejemplo"))).toBe(true);
  });

  it("shows the SRS card with its count, its interval action and the empty state", async () => {
    mount();
    await settle();

    expect(text()).toContain("Repasos pendientes (SRS) de este tema");
    expect(text()).toContain("Configurar intervalos");
    expect(text()).toContain("Todos los repasos espaciados de este tema están al día");
    expect(text()).toContain("Atajo de teclado");
    expect(text()).toContain("Espacio");
  });

  it("keeps the convert fallback for a folder that is not a topic yet", async () => {
    mount({ is_topic: false, folder: "Matemáticas/1 Aritmética/1.13 Suelta" } as unknown as TopicData);
    await settle();

    expect(text()).toContain("Convertir en tema");
  });
});
