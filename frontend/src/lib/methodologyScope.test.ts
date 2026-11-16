import { describe, expect, it } from "vitest";
import { curriculumIdsOfScope, curriculumIdsOfText, parseOrderReply, reviewPrompt } from "./methodologyScope";

const ALL = ["html", "css", "atomic-design", "js-reference", "java", "python", "javascript", "typescript", "electron", "backend", "databases", "automation", "mobile", "tooling"];

describe("methodologyScope", () => {
  it("reconoce HTML, CSS, JavaScript y Frontend por nombre", () => {
    expect(curriculumIdsOfText("HTML")).toEqual(["html"]);
    expect(curriculumIdsOfText("Lenguaje JavaScript")).toEqual(["js-reference", "javascript"]);
    expect(curriculumIdsOfText("Frontend")).toEqual(["html", "css", "atomic-design", "js-reference"]);
    expect(curriculumIdsOfText("Python")).toEqual(["python"]);
    expect(curriculumIdsOfText("Lenguaje: TypeScript")).toEqual(["js-reference", "typescript"]);
    expect(curriculumIdsOfText("Backend")).toEqual(["backend"]);
    expect(curriculumIdsOfText("Lógica de programación")).toEqual([]);
  });

  it("todas → todas; asignatura → la suya; área sin referencia → vacío", () => {
    expect(curriculumIdsOfScope({ kind: "all" }, ALL)).toEqual(ALL);
    expect(curriculumIdsOfScope({ kind: "group", groupId: "css", groupTitle: "CSS", areaName: "Frontend" }, ALL)).toEqual(["css"]);
    expect(curriculumIdsOfScope({ kind: "area", areaName: "Lógica de programación" }, ALL)).toEqual([]);
    expect(curriculumIdsOfScope({ kind: "area", areaName: "Backend" }, ALL)).toEqual(["backend"]);
  });

  it("el prompt lleva las reglas, los temas y el formato de respuesta", () => {
    const p = reviewPrompt({ kind: "group", label: "CSS" }, [{ folder: "P/5/5.2 CSS", title: "CSS", group: "css" }]);
    expect(p).toContain("learning methodology appropriate to the subject");
    expect(p).toContain("- CSS [css] (P/5/5.2 CSS)");
    expect(p).toContain("Practice, feedback and assessment");
    expect(p).toContain("do not audit or reorder the plan");
  });
});

describe("orden que devuelve la IA", () => {
  it("la lectura de orden sigue disponible para otros flujos", () => {
    expect(parseOrderReply('Texto…\n```json\n{ "order": ["a/b", "c/d"], "missing": ["x"] }\n```\n')).toEqual(["a/b", "c/d"]);
    expect(parseOrderReply("sin bloque")).toBeNull();
    expect(parseOrderReply('```json\n{ "order": [] }\n```')).toBeNull();
    expect(parseOrderReply("```json\nno es json\n```")).toBeNull();
  });
});
