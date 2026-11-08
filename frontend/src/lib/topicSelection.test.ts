import { describe, expect, it } from "vitest";
import { exercisesGap } from "./topicSelection";
import type { AreaTopicRow } from "./planAreaTopics";

function mockRow(partial: Partial<AreaTopicRow>): AreaTopicRow {
  return {
    folder: "Programación/2.1 Python/2.1.1 Project structure",
    title: "2.1.1 Project structure",
    week: 1,
    group: "core",
    completed: false,
    route: "core",
    exists: true,
    theory: true,
    canvas: true,
    manifest: true,
    exercises: 0,
    planExercises: 12,
    incomplete: true,
    ...partial,
  };
}

describe("exercisesGap", () => {
  it("detects missing exercises when exercises count is 0", () => {
    const row = mockRow({ exercises: 0, planExercises: 8 });
    const gap = exercisesGap(row);
    expect(gap).not.toBeNull();
    expect(gap?.what).toBe("exercises");
    expect(gap?.missing).toBe(8);
    expect(gap?.title).toContain("no tiene ejercicios");
  });

  it("detects gap when existing exercises are fewer than planExercises", () => {
    const row = mockRow({ exercises: 4, planExercises: 10 });
    const gap = exercisesGap(row);
    expect(gap).not.toBeNull();
    expect(gap?.what).toBe("exercises");
    expect(gap?.missing).toBe(6);
    expect(gap?.title).toContain("Tiene 4 de 10 ejercicios");
  });

  it("returns null when exercises meet or exceed planExercises", () => {
    const row = mockRow({ exercises: 12, planExercises: 12 });
    expect(exercisesGap(row)).toBeNull();
  });

  it("returns practice+exercises when .practica is missing", () => {
    const row = mockRow({ manifest: false, exercises: 0 });
    const gap = exercisesGap(row);
    expect(gap).not.toBeNull();
    expect(gap?.what).toBe("practice+exercises");
  });

  it("returns null for non-existent or skipped topics", () => {
    expect(exercisesGap(mockRow({ exists: false }))).toBeNull();
    expect(exercisesGap(mockRow({ route: "skipped" }))).toBeNull();
    expect(exercisesGap(mockRow({ theory: false }))).toBeNull();
  });
});

