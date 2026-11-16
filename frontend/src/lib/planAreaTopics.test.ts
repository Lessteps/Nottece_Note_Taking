import { describe, expect, it } from "vitest";
import { areaTabsOf, areaTopicRows, basesTopicRows, groupTabsOf, pendingGenerate, rowsOfGroup } from "./planAreaTopics";
import type { PlanTopicRow } from "./planTopicCatalog";
import type { MentorPlan } from "./types";

const topic = (folder: string, week: number, over: Record<string, unknown> = {}) => ({ folder, title: folder.split("/").pop()!, targetWeek: week, estMinutes: 30, ...over });
const sub = (id: string, area: string, topics: unknown[], groups?: unknown[]) => ({ id, area, objective: "", topics, weeks: [], requiredGoals: [], ...(groups ? { groups } : {}) });
const plan = {
  subplans: [
    sub("s1", "Backend", [topic("P/4/4.2 REST", 2, { group: "kn" }), topic("P/4/4.1 HTTP", 1, { group: "bases" }), topic("P/4/4.3 Sueltos", 3, { group: "zzz", completedAt: "2026-10-01" }), topic("P/4/4.4 Fuera", 4, { group: "kn", route: "skipped" })], [
      { id: "kn", title: "Conocimientos", kind: "knowledge", order: 2 },
      { id: "bases", title: "Bases", kind: "bases", order: 1 },
    ]),
    { ...sub("s2", "Frontend", [topic("P/5/5.1 DOM", 1)]), areaId: "frontend" },
  ],
} as unknown as MentorPlan;

const row = (folder: string, over: Partial<PlanTopicRow> = {}): PlanTopicRow => ({
  folder, title: folder.split("/").pop()!, branch: "Backend", inPlan: true, exists: true, topicType: "unknown", theory: true, contract: true, canvas: true,
  manifest: true, skills: 3, exercises: 5, score: 100, complete: true, gaps: 0, ...over,
});
const catalog = [row("P/4/4.1 HTTP"), row("P/4/4.2 REST", { canvas: false, complete: false }), row("P/4/4.3 Sueltos", { exercises: 0 })];

describe("temas por área", () => {
  it("propaga la marca de revisión a la fila sin depender del catálogo", () => {
    const area = sub("x", "Backend", [topic("P/4/Nuevo", 1, { revisionAddedAt: "2026-11-13" })]) as MentorPlan["subplans"][number];
    expect(areaTopicRows(area, [])[0]).toMatchObject({ revisionAddedAt: "2026-11-13", exists: false });
  });

  it("una pestaña por área del plan, con su clave de alcance, los completados y lo que falta generar", () => {
    const tabs = areaTabsOf(plan, catalog);
    expect(tabs.map((t) => [t.key, t.area])).toEqual([["s1", "Backend"], ["frontend", "Frontend"]]);
    // sin el tema de Bases (HTTP): a REST le falta el mapa; Sueltos está completado (no cuenta); Fuera está fuera de ruta (no cuenta)
    expect(tabs[0]).toMatchObject({ total: 3, done: 1, missing: 1 });
    // DOM no está en la vault: falta todo
    expect(tabs[1]).toMatchObject({ total: 1, done: 0, missing: 1 });
  });

  it("las filas van en el orden de la ruta y un tema que aún no está en la vault sale con todo por hacer", () => {
    const rows = areaTopicRows(plan.subplans[0]!, catalog);
    expect(rows.map((r) => r.title)).toEqual(["4.2 REST", "4.3 Sueltos", "4.4 Fuera"]);
    expect(areaTopicRows(plan.subplans[0]!, catalog, true).map((r) => r.title)).toEqual(["4.1 HTTP", "4.2 REST", "4.3 Sueltos", "4.4 Fuera"]);
    expect(rows[2]).toMatchObject({ route: "skipped", exists: false, theory: false, incomplete: true });
    expect(pendingGenerate(rows[2]!)).toBe(false);
    expect(areaTopicRows(plan.subplans[1]!, catalog)[0]).toMatchObject({ exists: false, exercises: 0, incomplete: true });
  });

  it("las pestañas de grupo siguen el orden del área, sacan «Otros» y «Todos» va primero; sin grupos solo «Todos»", () => {
    const s = plan.subplans[0]!;
    const rows = areaTopicRows(s, catalog);
    const tabs = groupTabsOf(s, rows);
    expect(tabs.map((t) => [t.id, t.title, t.total])).toEqual([["", "Todos", 3], ["kn", "Conocimientos", 2], ["__otros", "Otros", 1]]);
    expect(rowsOfGroup(s, rows, "kn").map((r) => r.title)).toEqual(["4.2 REST", "4.4 Fuera"]);
    expect(rowsOfGroup(s, rows, "__otros").map((r) => r.title)).toEqual(["4.3 Sueltos"]);
    expect(rowsOfGroup(s, rows, "")).toHaveLength(3);
    expect(groupTabsOf(plan.subplans[1]!, areaTopicRows(plan.subplans[1]!, catalog))).toHaveLength(1);
  });

  it("Bases no es de ningún área: sus temas van juntos y sin repetirse aunque estén en varias áreas", () => {
    const shared = { ...plan, subplans: [...plan.subplans, { ...plan.subplans[1]!, id: "s3", topics: [topic("P/4/4.1 HTTP", 1, { group: "bases" })], groups: [{ id: "bases", title: "Bases", kind: "bases", order: 1 }] }] } as unknown as MentorPlan;
    expect(basesTopicRows(shared, catalog).map((r) => r.title)).toEqual(["4.1 HTTP"]);
    expect(basesTopicRows({ subplans: [plan.subplans[1]!] } as unknown as MentorPlan, catalog)).toEqual([]);
  });
});
