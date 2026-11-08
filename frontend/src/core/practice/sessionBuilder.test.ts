import { describe, expect, it, vi } from "vitest";
import {
  buildExerciseGenerationPrompt,
  buildTopicSession,
  filterTopicExercises,
  formatExerciseNote,
  resolveTargetQuantity,
  type SessionAIClient,
} from "./sessionBuilder";
import type { TopicManifest } from "./topic";
import type { ExerciseRef } from "./exerciseIndex";

describe("Session Builder", () => {
  const sampleManifest: TopicManifest = {
    type: "topic",
    subject: "mathematics",
    title: "1.2 Inducción matemática",
    skills: ["prove", "process", "counterexample"],
    mastery: { min_per_skill: 4, target_difficulty: 3, exam: "required" },
    folder: "Matematicas/01 Induccion",
  };

  const sampleExercises: ExerciseRef[] = [
    {
      path: "/vault/Matematicas/01 Induccion/ejercicios/ex1.md",
      rel: "Matematicas/01 Induccion/ejercicios/ex1.md",
      note_id: "ex1",
      title: "Suma de enteros",
      subject: "mathematics",
      discipline: "math_algebra",
      skill: "",
      mode: "prove",
      difficulty: 2,
      concept: "",
      chapter: "",
      chapter_title: "",
      integration: false,
    },
    {
      path: "/vault/Matematicas/01 Induccion/ejercicios/ex2.md",
      rel: "Matematicas/01 Induccion/ejercicios/ex2.md",
      note_id: "ex2",
      title: "Desigualdad de Bernoulli",
      subject: "mathematics",
      discipline: "math_algebra",
      skill: "",
      mode: "prove",
      difficulty: 3,
      concept: "",
      chapter: "",
      chapter_title: "",
      integration: false,
    },
    {
      path: "/vault/Matematicas/01 Induccion/ejercicios/ex3.md",
      rel: "Matematicas/01 Induccion/ejercicios/ex3.md",
      note_id: "ex3",
      title: "Paso base falso",
      subject: "mathematics",
      discipline: "math_algebra",
      skill: "",
      mode: "counterexample",
      difficulty: 2,
      concept: "",
      chapter: "",
      chapter_title: "",
      integration: false,
    },
  ];

  it("filters topic exercises by folder, skill, and difficulty", () => {
    const diff2 = filterTopicExercises(sampleExercises, "Matematicas/01 Induccion", "prove", 2);
    expect(diff2.length).toBe(1);
    expect(diff2[0]?.note_id).toBe("ex1");

    const diff3 = filterTopicExercises(sampleExercises, "Matematicas/01 Induccion", "prove", 3);
    expect(diff3.length).toBe(1);
    expect(diff3[0]?.note_id).toBe("ex2");

    const none = filterTopicExercises(sampleExercises, "Matematicas/01 Induccion", "prove", 1);
    expect(none.length).toBe(0);
  });

  it("resolves target quantity for choices", () => {
    expect(resolveTargetQuantity("3-5", 10)).toBe(4);
    expect(resolveTargetQuantity("6-10", 10)).toBe(8);
    expect(resolveTargetQuantity("11+", 10)).toBe(12);
    expect(resolveTargetQuantity("all", 7)).toBe(7);
    expect(resolveTargetQuantity("auto", 2)).toBe(5);
  });

  it("builds exercise generation prompt specialized to topic and theory notes", () => {
    const prompt = buildExerciseGenerationPrompt(
      sampleManifest,
      [
        {
          rel: "Matematicas/01 Induccion/Principio de induccion.md",
          title: "Principio de inducción",
          content: "Sea P(n) una propiedad para todo n natural...",
        },
      ],
      "prove",
      3,
      "helper",
      2,
    );

    expect(prompt.length).toBe(2);
    const system = prompt[0]!.content;
    const user = prompt[1]!.content;

    expect(system).toContain("1.2 Inducción matemática");
    expect(system).toContain("prove");
    expect(system).toContain("HELPER");
    expect(user).toContain("Principio de inducción");
    expect(user).toContain("Sea P(n) una propiedad");
  });

  it("formats generated exercise note with markdown and frontmatter", () => {
    const content = formatExerciseNote(sampleManifest, "process", 2, "helper", {
      title: "Inducción con sumas",
      statement: "Prueba por inducción que $\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$.",
      hints: ["Paso base: comprueba para n = 1.", "Hipótesis inductiva: asume para k."],
      solution: "Para n=1: 1 = 1(2)/2 = 1. Hipótesis...",
      rubric: ["Paso base verificado", "Hipótesis formulada", "Paso inductivo algebraico"],
    });

    expect(content).toContain("type: exercise");
    expect(content).toContain("mode: process");
    expect(content).toContain("difficulty: 2");
    expect(content).toContain("assistance: helper");
    expect(content).toContain("## Enunciado");
    expect(content).toContain("## Pistas");
    expect(content).toContain("## Solución");
    expect(content).toContain("## Rúbrica");
  });

  it("builds session using existing exercises when sufficient", async () => {
    const aiStub: SessionAIClient = {
      generateExercises: vi.fn(),
    };

    const session = await buildTopicSession(
      sampleManifest,
      "Matematicas/01 Induccion",
      {
        skill: "prove",
        difficulty: 2,
        quantity: "all",
        assistance: "no_help",
      },
      sampleExercises,
      [],
      aiStub,
    );

    expect(session.exercises.length).toBe(1);
    expect(session.exercises[0]?.isNew).toBe(false);
    expect(session.exercises[0]?.id).toBe("ex1");
    expect(aiStub.generateExercises).not.toHaveBeenCalled();
  });

  it("calls AI client when more exercises are needed and creates new exercises", async () => {
    const aiStub: SessionAIClient = {
      generateExercises: vi.fn().mockResolvedValue([
        {
          title: "Inducción en desigualdades",
          statement: "Prueba que 2^n > n^2 para n >= 5.",
          hints: ["Comprueba el caso base n = 5."],
          solution: "Para n=5: 32 > 25...",
          rubric: ["Caso base n=5 comprobado", "Paso inductivo"],
        },
      ]),
    };

    const session = await buildTopicSession(
      sampleManifest,
      "Matematicas/01 Induccion",
      {
        skill: "prove",
        difficulty: 3,
        quantity: "3-5", // Target is 4, only 1 exists (ex2)
        assistance: "helper",
      },
      sampleExercises,
      [],
      aiStub,
    );

    expect(aiStub.generateExercises).toHaveBeenCalled();
    expect(session.existingCount).toBe(1);
    expect(session.generatedCount).toBe(1);
    expect(session.exercises.length).toBe(2);
    expect(session.exercises[0]?.isNew).toBe(false);
    expect(session.exercises[1]?.isNew).toBe(true);
    expect(session.exercises[1]?.content).toContain("Inducción en desigualdades");
  });

  it("creates deterministic fallback exercise when zero exist and AI generates nothing", async () => {
    const aiEmpty: SessionAIClient = {
      generateExercises: vi.fn().mockResolvedValue([]),
    };

    const session = await buildTopicSession(
      sampleManifest,
      "Matematicas/01 Induccion",
      {
        skill: "drill", // 0 exist in sampleExercises
        difficulty: 1,
        quantity: "3-5",
        assistance: "helper",
      },
      sampleExercises,
      [{ rel: "Matematicas/01 Induccion/01 Induccion.md", title: "01 Induccion", content: "El principio de inducción matemática consiste en..." }],
      aiEmpty,
    );

    expect(session.existingCount).toBe(0);
    expect(session.generatedCount).toBe(1);
    expect(session.exercises.length).toBe(1);
    expect(session.exercises[0]?.isNew).toBe(true);
    expect(session.exercises[0]?.content).toContain("type: exercise");
    expect(session.exercises[0]?.content).toContain("mode: drill");
    expect(session.exercises[0]?.content).toContain("1.2 Inducción matemática");
  });
});
