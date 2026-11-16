import { describe, expect, it } from "vitest";
import { learningContextOf } from "./learningPlanContext.js";
import { sanitizePlan } from "./plan.js";

describe("learning context", () => {
  it("uses live practice completion and saved guide without assuming planned topics are mastered", () => {
    const p = sanitizePlan({ id: "2026-10-06_2027-04-05", start: "2026-10-06", end: "2027-04-05", subplans: [{ id: "s", area: "Backend", objective: "API", learningGuide: "Teach from zero", topics: [{ folder: "P/A/one", title: "One", group: "g", targetWeek: 1, estMinutes: 30 }, { folder: "P/A/two", title: "Two", group: "g", targetWeek: 2, estMinutes: 30 }] }] })!;
    p.preconditions = { freeObjective: "FULLSTACK_AI_GOAL", levels: {} } as never;
    const progress = { completenessPct: 100, skills: {}, topic: { mastery: { exam: "optional" } }, examPassed: false };
    const snapshots = new Map([["P/A/one", { progress, attemptCount: 2 }], ["P/A/two", { progress: { ...progress, completenessPct: 25 }, attemptCount: 1 }]] as never);
    const text = learningContextOf(p, "P/A/two", snapshots as never);
    expect(text).toContain("FULLSTACK_AI_GOAL"); expect(text).toContain("Learner level: not declared");
    expect(text).toContain("Teach from zero"); expect(text).toContain("1 of 2 topics completed"); expect(text).toContain("1 recorded attempts; 25%"); expect(text).toContain("Planned before does not mean mastered");
    expect(sanitizePlan(JSON.parse(JSON.stringify(p)))!.subplans[0]!.learningGuide).toBe("Teach from zero");
  });
});
