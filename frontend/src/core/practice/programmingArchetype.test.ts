import { describe, expect, it } from "vitest";
import { archetypeOf, archetypePromptBlock, fitSkillsToArchetype } from "./programmingArchetype";

describe("archetypeOf", () => {
  it.each([
    ["2.1.1 Project structure, virtual environments and imports", "setup"],
    ["2.1.1.1 Python virtual environments with venv", "setup"],
    ["2.1.1.2 Modules and the import statement", "setup"],
    ["2.1.1.3 Packages and __init__.py", "setup"],
    ["2.1.2 Variables, primitive types and conversions", "early_code"],
    ["2.1.5 Control flow and loops", "early_code"],
    ["4.1 What the backend is", "concept"],
    ["4.1.1 The client-server model and the trust boundary", "concept"],
    ["4.1.2 Stateless request-response architecture", "concept"],
    ["2.1.10 Classes and encapsulation", "code"],
    ["4.6 Backend with Python", "code"],
  ])("%s → %s", (title, want) => {
    expect(archetypeOf({ title })).toBe(want);
  });

  it("does not take «client» for the «cli» tool", () => {
    expect(archetypeOf({ title: "4.9 Client libraries for HTTP" })).not.toBe("setup");
  });
});

describe("fitSkillsToArchetype", () => {
  it("drops debug/refactor/trace from a setup topic and adds the structure skills", () => {
    const out = fitSkillsToArchetype(["pg_true_false", "explain", "implement", "trace", "debug", "refactor"], "setup");
    expect(out).not.toContain("debug");
    expect(out).not.toContain("refactor");
    expect(out).not.toContain("trace");
    expect(out[0]).toBe("project_structure");
    expect(out.length).toBeLessThanOrEqual(6);
  });
  it("leaves code topics alone", () => {
    expect(fitSkillsToArchetype(["implement", "debug"], "code")).toEqual(["implement", "debug"]);
  });
});

describe("archetypePromptBlock", () => {
  it("lists what was taught and the forbidden skills", () => {
    const t = archetypePromptBlock("setup", ["2.0 First program"]);
    expect(t).toContain("2.0 First program");
    expect(t).toContain("Forbidden skills");
    expect(t).toContain("debug");
  });
});
