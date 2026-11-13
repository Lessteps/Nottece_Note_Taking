// El informe de «Ejecutar plan»: qué falta crear, agrupado por área y tema, con estimación y en el orden de la agenda; el alcance; la selección de
// tareas ejecutables de la cola.

import { describe, expect, it } from "vitest";
import { areaFiles } from "./areaPracticeSystem";
import { buildExecutionReport, DEFAULT_SCOPE, estimateMinutes, inScope, practiceCells, progressOf, runnable, blockedBy, type ReportInput, type TaskState } from "./planExecution";
import { evaluateTopicDesign, type TopicDesign, type TopicDesignInput } from "./topicDesign";
import type { CoverageReview } from "./planCoverage";

const READING_OK = "---\ntopic_type: mixed\n---\n## Requires\n## Explanation\n### What it is\n### Mental model\n## Examples\n### Example 1\n### Example 2\n### Example 3\n## Common mistakes\n### Mistake 1\n### Mistake 2\n### Mistake 3\n### Mistake 4\n## Connections\n## Cards\n### 1 · a\n### 2 · a\n### 3 · a\n### 4 · a\n### 5 · a\n### 6 · a\n";
const f = (n: string) => `Programación/4 Backend/${n}`;
const design = (folder: string, o: Partial<TopicDesignInput>): TopicDesign =>
  evaluateTopicDesign({ folder, title: folder.split("/").pop()!, subject: "programming", exists: true, files: [], exercises: [], ...o });
const man = { topicType: "mixed", skills: ["implement", "pg_true_false"] };
it("enumera todas las dificultades previstas incluso cuando no hay ejercicios todavía", () => {
  const d = design(f("4.7 Nuevo"), { manifest: { topicType: "mixed", skills: ["implement", "pg_true_false"], plan: { implement: [4, 4, 0], pg_true_false: [4, 0, 0] } } });
  expect(practiceCells(d, true).map((c) => `${c.skill}:${c.difficulty}`).sort()).toEqual(["implement:1", "implement:2", "pg_true_false:1"]);
});
it("detecta cantidades pendientes dentro de una dificultad ya existente", () => {
  const d = design(f("4.7 Parcial"), { manifest: { topicType: "mixed", skills: ["implement"], plan: { implement: [4, 0, 0] } }, exercises: [{ skill: "implement", difficulty: 1 }] });
  expect(practiceCells(d, true)).toEqual([{ skill: "implement", difficulty: 1, required: false }]);
});
const complete = (folder: string) =>
  design(folder, { files: ["T.md", "T — mapa.canvas", "T.practica.md"], theoryText: READING_OK, manifest: man, exercises: [1, 2, 3].flatMap((d) => ["implement", "pg_true_false"].map((skill) => ({ skill, difficulty: d }))) });

const topics = [
  { folder: f("4.1 Listo"), title: "4.1 Listo", areaKey: "backend", area: "Backend", week: 1 },
  { folder: f("4.2 SinCanvas"), title: "4.2 SinCanvas", areaKey: "backend", area: "Backend", week: 1 },
  { folder: f("4.3 SinTeoria"), title: "4.3 SinTeoria", areaKey: "backend", area: "Backend", week: 3 },
  { folder: f("4.4 NoExiste"), title: "4.4 NoExiste", areaKey: "backend", area: "Backend", week: 2 },
  { folder: "Programación/5 Frontend/5.1 Botones", title: "5.1 Botones", areaKey: "frontend", area: "Frontend", week: 1 },
  { folder: f("4.5 Hecho"), title: "4.5 Hecho", areaKey: "backend", area: "Backend", week: 1, completed: true },
  { folder: f("4.6 Fuera"), title: "4.6 Fuera", areaKey: "backend", area: "Backend", week: 1, skipped: true },
];
const designs = new Map<string, TopicDesign>([
  [f("4.1 Listo"), complete(f("4.1 Listo"))],
  // teoría y manifiesto, sin canvas ni ejercicios
  [f("4.2 SinCanvas"), design(f("4.2 SinCanvas"), { files: ["T.md", "T.practica.md"], theoryText: READING_OK, manifest: man })],
  // solo manifiesto (y una nota con defectos en otro tema)
  [f("4.3 SinTeoria"), design(f("4.3 SinTeoria"), { files: ["T.practica.md"], manifest: man })],
  [f("4.4 NoExiste"), design(f("4.4 NoExiste"), { exists: false })],
  ["Programación/5 Frontend/5.1 Botones", design("Programación/5 Frontend/5.1 Botones", { files: ["B.md"], theoryText: "# B\n\n## Requires\n" })],
  [f("4.5 Hecho"), design(f("4.5 Hecho"), { files: [] })],
  [f("4.6 Fuera"), design(f("4.6 Fuera"), { files: [] })],
]);

const kataWeeks = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5];
const input = (o: Partial<ReportInput> = {}): ReportInput => ({
  planId: "p",
  topics,
  areas: [{ key: "backend", area: "Backend", areaId: "backend" }, { key: "frontend", area: "Frontend", areaId: "frontend" }],
  designs,
  review: null,
  ppReady: true,
  areaFiles: (areaId, katas, fromDay) => areaFiles(areaId, { katasPerArea: katas, fromDay }).map((x) => ({ rel: x.rel, exists: false })),
  kataWeeks,
  aiConfigured: true,
  now: "2026-10-09T10:00:00.000Z",
  ...o,
});

describe("informe de ejecución", () => {
  const report = buildExecutionReport(input());
  const ids = report.tasks.map((t) => t.id);

  it("lista exactamente lo que falta: nada para el tema completo, el completado ni el que está fuera de ruta", () => {
    expect(ids).toContain(`canvas:${f("4.2 SinCanvas")}`);
    expect(ids).toContain(`practice:${f("4.2 SinCanvas")}`);
    expect(ids).toContain(`theory:${f("4.3 SinTeoria")}`);
    expect(ids).toContain(`topic_new:${f("4.4 NoExiste")}`);
    expect(ids.filter((i) => /4\.1 Listo|4\.5 Hecho|4\.6 Fuera/.test(i))).toEqual([]);
    // sin teoría: la teoría genera también el canvas; no hay tarea de canvas aparte
    expect(ids).not.toContain(`canvas:${f("4.3 SinTeoria")}`);
    // el tema con teoría pero con defectos de estructura no se reescribe: va a «revisar a mano»
    expect(report.manual.map((m) => m.title)).toEqual(["5.1 Botones"]);
    expect(report.manual[0]!.gaps.join(" ")).toContain("no cumple el contrato");
  });

  it("agrupa por área y por tema", () => {
    expect(report.areas.map((a) => a.area)).toEqual(["Backend", "Frontend"]);
    expect(report.areas[0]!.topics.map((t) => t.title)).toEqual(["4.2 SinCanvas", "4.3 SinTeoria", "4.4 NoExiste"]);
    expect(report.areas[0]!.areaTasks.map((t) => t.kind)).toEqual(["area_folder"]);
  });

  it("ordena por la agenda: semana, área, tema y paso (teoría → canvas → manifiesto → ejercicios)", () => {
    const withWeek = report.tasks.filter((t) => t.folder);
    expect(withWeek.map((t) => t.week)).toEqual([...withWeek.map((t) => t.week)].sort((a, b) => a - b));
    const w1 = ids.filter((i) => i.endsWith(f("4.2 SinCanvas")));
    expect(w1).toEqual([`canvas:${f("4.2 SinCanvas")}`, `practice:${f("4.2 SinCanvas")}`]);
    expect(ids.indexOf(`theory:${f("4.3 SinTeoria")}`)).toBeGreaterThan(ids.indexOf(`topic_new:${f("4.4 NoExiste")}`)); // 4.4 es de la semana 2, 4.3 de la 3
    // tiene manifiesto: sus ejercicios ya se conocen y esperan a la teoría
    const dep = report.tasks.find((t) => t.id === `practice:${f("4.3 SinTeoria")}`)!;
    expect(dep.dependsOn).toEqual([`theory:${f("4.3 SinTeoria")}`]);
    expect(dep.args).toMatchObject({ cells: [{ skill: "implement", difficulty: 1 }, { skill: "pg_true_false", difficulty: 1 }] });
  });

  it("estima el coste: llamadas de IA, archivos y minutos con concurrencia 2", () => {
    const calls = report.tasks.reduce((n, t) => n + t.aiCalls, 0);
    expect(report.totals.aiCalls).toBe(calls);
    expect(report.totals.minutes).toBe(estimateMinutes(calls, report.tasks.length));
    expect(estimateMinutes(10, 12)).toBe(5);
    expect(estimateMinutes(0, 3)).toBe(1);
    expect(estimateMinutes(0, 0)).toBe(0);
    expect(report.totals.byKind.canvas).toBe(2); // 4.2 y 5.1 (que tiene nota pero no canvas)
    expect(report.totals.files).toBeGreaterThan(10);
    // el canvas de un tema que ya tiene nota no cuesta IA
    expect(report.tasks.find((t) => t.kind === "canvas")!.aiCalls).toBe(0);
  });

  it("las tareas de un tema dependen en cadena y solo de lo que está en el informe", () => {
    const manifestOnly = buildExecutionReport(input({ designs: new Map([[f("4.4 NoExiste"), design(f("4.4 NoExiste"), { exists: true, files: ["T.md"], theoryText: READING_OK })]]), topics: [topics[3]!] }), { includeAreaPractice: false });
    expect(manifestOnly.tasks.map((t) => t.kind)).toEqual(["canvas", "manifest", "practice"]);
    const m = manifestOnly.tasks.find((t) => t.kind === "manifest")!;
    const p = manifestOnly.tasks.find((t) => t.kind === "practice")!;
    expect(m.dependsOn).toEqual([]);
    expect(p.dependsOn).toEqual([m.id]);
    expect(p.args).toMatchObject({ unknown: true });
    const gen = report.tasks.find((t) => t.id === `topic_new:${f("4.4 NoExiste")}`)!;
    const gp = report.tasks.find((t) => t.id === `practice:${f("4.4 NoExiste")}`)!;
    expect(gp.dependsOn).toEqual([gen.id]);
  });
});

describe("alcance", () => {
  it("«solo semanas 1–1» deja solo lo de esa semana; «solo un área» solo esa área", () => {
    const w = buildExecutionReport(input(), { mode: "weeks", fromWeek: 1, toWeek: 1 });
    expect(w.tasks.filter((t) => t.folder).every((t) => t.week === 1)).toBe(true);
    expect(w.tasks.some((t) => t.id.includes("4.3 SinTeoria"))).toBe(false);
    const katasW1 = w.tasks.find((t) => t.id === "area_folder:backend")!;
    expect(katasW1.args).toMatchObject({ katas: 5, fromDay: 1 });
    const a = buildExecutionReport(input(), { mode: "area", areaKey: "frontend" });
    expect(a.tasks.every((t) => t.areaKey === "frontend")).toBe(true);
    expect(a.tasks.some((t) => t.id === "area_folder:frontend")).toBe(true);
    expect(inScope({ ...DEFAULT_SCOPE, mode: "area", areaKey: "x" }, { areaKey: "backend", week: 1 })).toBe(false);
    expect(buildExecutionReport(input(), { includeAreaPractice: false }).tasks.some((t) => t.kind === "area_folder")).toBe(false);
  });

  it("«solo un tema» crea únicamente lo de ese tema: sin práctica por área ni temas nuevos, y sin carpeta no hay nada", () => {
    const t = buildExecutionReport(input(), { mode: "topic", folder: f("4.3 SinTeoria") });
    expect(t.tasks.length).toBeGreaterThan(0);
    expect(t.tasks.every((x) => x.folder === f("4.3 SinTeoria"))).toBe(true);
    expect(t.tasks.some((x) => x.kind === "area_folder" || x.kind === "pp_init")).toBe(false);
    expect(buildExecutionReport(input(), { mode: "topic" }).tasks).toEqual([]);
    expect(inScope({ ...DEFAULT_SCOPE, mode: "topic", folder: "a" }, { areaKey: "x", week: 1, folder: "b" })).toBe(false);
  });

  it("los katas por área se limitan (60) y la instalación del módulo va primero si no está", () => {
    const r = buildExecutionReport(input({ ppReady: false, kataWeeks: Array.from({ length: 200 }, (_, i) => Math.floor(i / 5) + 1) }));
    expect(r.tasks[0]!.id).toBe("pp_init");
    const fb = r.tasks.find((t) => t.id === "area_folder:backend")!;
    expect(fb.args!.katas).toBe(60);
    expect(fb.dependsOn).toEqual(["pp_init"]);
    // si ya existe todo, no hay tarea de carpeta
    const all = buildExecutionReport(input({ areaFiles: (a, k, d) => areaFiles(a, { katasPerArea: k, fromDay: d }).map((x) => ({ rel: x.rel, exists: true })) }));
    expect(all.tasks.some((t) => t.kind === "area_folder")).toBe(false);
  });

  it("lo recomendado (escalera) y los temas nuevos propuestos solo entran si se piden", () => {
    const review = { at: "2026-10-09T00:00:00.000Z", source: "ai" as const, summary: "x", discarded: 0, areas: [{ key: "backend", area: "Backend", assessment: "", missing: [{ title: "Message queues", why: "colas" }], misplaced: [] }] } as CoverageReview;
    const base = buildExecutionReport(input({ review }));
    expect(base.tasks.some((t) => t.id.startsWith("topic_new:backend"))).toBe(false);
    expect(base.areas[0]!.proposals).toEqual([{ title: "Message queues", why: "colas", included: false }]);
    const withNew = buildExecutionReport(input({ review }), { includeNewTopics: true });
    const nt = withNew.tasks.find((t) => t.id.startsWith("topic_new:backend"))!;
    expect(nt).toMatchObject({ week: 1000, label: "Tema nuevo propuesto: «Message queues»" });
    expect(withNew.tasks[withNew.tasks.length - 1]!.id).toBe(nt.id); // al final
    const cells = practiceCells(designs.get(f("4.1 Listo"))!, true);
    expect(cells).toEqual([]);
    const sc = design(f("4.9 X"), { files: ["T.md", "T — mapa.canvas", "T.practica.md"], theoryText: READING_OK, manifest: man, exercises: [{ skill: "implement", difficulty: 1 }, { skill: "pg_true_false", difficulty: 1 }] });
    expect(practiceCells(sc, false)).toEqual([]);
    expect(practiceCells(sc, true).every((c) => !c.required && c.difficulty >= 2)).toBe(true);
    const ladder = buildExecutionReport(input({ topics: [{ folder: f("4.9 X"), title: "4.9 X", areaKey: "backend", area: "Backend", week: 1 }], designs: new Map([[f("4.9 X"), sc]]) }), { includeRecommended: true, includeAreaPractice: false });
    expect(ladder.tasks).toHaveLength(1);
    expect(ladder.tasks[0]).toMatchObject({ kind: "practice", required: false, aiCalls: 4 });
    expect(buildExecutionReport(input({ topics: [{ folder: f("4.9 X"), title: "4.9 X", areaKey: "backend", area: "Backend", week: 1 }], designs: new Map([[f("4.9 X"), sc]]) }), { includeAreaPractice: false }).tasks).toEqual([]);
  });
});

const ts = (id: string, status: TaskState["status"], o: Partial<TaskState> = {}): TaskState => ({ id, kind: "theory", areaKey: "backend", area: "Backend", folder: `F/${id}`, title: id, week: 1, required: true, aiCalls: 1, files: 1, label: id, dependsOn: [], status, attempts: 0, created: [], skippedFiles: [], warnings: [], ...o });

describe("cola: tareas ejecutables y progreso", () => {
  it("espera a las dependencias, no pasa de 2 y no toca dos veces la misma carpeta", () => {
    const tasks = [ts("a", "done"), ts("b", "pending", { dependsOn: ["a"], folder: "F/a" }), ts("c", "pending"), ts("d", "pending"), ts("e", "pending", { dependsOn: ["c"] })];
    expect(runnable(tasks).map((t) => t.id)).toEqual(["b", "c"]);
    expect(runnable([ts("a", "running"), ...tasks.slice(2)]).map((t) => t.id)).toEqual(["c"]);
    expect(runnable(tasks, 1).map((t) => t.id)).toEqual(["b"]);
  });
  it("una dependencia caída bloquea a sus dependientes", () => {
    const tasks = [ts("a", "failed"), ts("b", "pending", { dependsOn: ["a"] })];
    expect(runnable(tasks)).toEqual([]);
    expect(blockedBy(tasks).map((x) => x.task.id)).toEqual(["b"]);
  });
  it("el progreso se escribe «12/58 · Área · Tema»", () => {
    const tasks = [ts("a", "done"), ts("b", "done"), ts("c", "running", { area: "Backend", title: "4.3 REST API design", folder: "x/4.3 REST API design" }), ts("d", "pending")];
    const p = progressOf({ tasks });
    expect(p.label).toBe("3/4 · Backend · REST API design");
    expect(p).toMatchObject({ total: 4, done: 2, running: 1, pending: 1, pct: 50 });
  });
});
