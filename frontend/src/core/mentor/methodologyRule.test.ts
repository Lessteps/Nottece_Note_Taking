import { describe, expect, it } from "vitest";
import { METHODOLOGY_RULE } from "./methodologyRule";
import { SKELETON_SYSTEM, TOPICS_COMPACT_SYSTEM, TOPICS_SYSTEM } from "./planBuildAi";
import { COVERAGE_SYSTEM_PROMPT } from "./planCoverageAi";
import { PLANNER_SYSTEM_PROMPT } from "./planner";
import { evaluateAreaMethodology } from "../../lib/planAreas";

describe("la metodología adaptada llega a la IA que arma o juzga un plan", () => {
  it.each([["esqueleto", SKELETON_SYSTEM], ["temas", TOPICS_SYSTEM], ["temas (compacto)", TOPICS_COMPACT_SYSTEM], ["planificador", PLANNER_SYSTEM_PROMPT], ["análisis de cobertura", COVERAGE_SYSTEM_PROMPT]])("%s", (_n, prompt) => {
    expect(prompt).toContain(METHODOLOGY_RULE);
    expect(METHODOLOGY_RULE).toMatch(/método de estudio adecuado/);
    expect(METHODOLOGY_RULE).toMatch(/no impongas esa regla/);
  });
});

describe("un plan nuevo de Frontend sin HTML y CSS desarrollados avisa solo", () => {
  const topic = (folder: string) => ({ folder, title: folder.split("/").pop()! });
  it("avisa con pocos temas y calla con los suficientes", () => {
    const few = evaluateAreaMethodology({ id: "frontend", areaId: "frontend", area: "Frontend", topics: [topic("Programación/5 Frontend/5.2 CSS")] });
    expect(few.map((w) => w.groupId)).toEqual(["html", "css"]);
    const html = Array.from({ length: 20 }, (_, i) => topic(`Programación/5 Frontend/HTML/5.18.${i + 1} x`));
    const css = Array.from({ length: 40 }, (_, i) => topic(`Programación/5 Frontend/CSS/5.19.${i + 1} y`));
    expect(evaluateAreaMethodology({ id: "frontend", areaId: "frontend", area: "Frontend", topics: [...html, ...css] })).toEqual([]);
  });
  it("no toca otras áreas", () => {
    expect(evaluateAreaMethodology({ id: "backend", areaId: "backend", area: "Backend", topics: [] })).toEqual([]);
  });
});
