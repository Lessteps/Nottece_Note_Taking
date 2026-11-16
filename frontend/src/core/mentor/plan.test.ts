import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAYOUT } from "../vaultFormat.js";
import {
  addMonths,
  buildPlan,
  deriveView,
  distributeTopics,
  mergePlans,
  PlanStore,
  planItemsFor,
  planName,
  planStatus,
  refreshPlanProgress,
  sanitizePlan,
  topicState,
  weekOf,
  weekRanges,
  type MonthlyPlan,
  type TopicLite,
} from "./plan.js";

const lite = (over: { pct?: number; attempts?: number; exam?: string; examPassed?: boolean; mastered?: boolean[] } = {}): TopicLite => ({
  attemptCount: over.attempts ?? 3,
  progress: {
    topic: { title: "T", subject: "programming", mastery: { exam: over.exam ?? "none" } },
    skills: Object.fromEntries((over.mastered ?? [false]).map((m, i) => [`s${i}`, { mastered: m, status: "", totalAttempts: 1, bestScore: null }])),
    examPassed: over.examPassed ?? false,
    examScore: null,
    completenessPct: over.pct ?? 40,
  },
});

const T = (n: number, est = 60) => ({ folder: `P/T${n}`, title: `Tema ${n}`, estMinutes: est });

describe("semanas del mes", () => {
  it("trocea el mes en semanas de 7 días desde el día 1", () => {
    const w = weekRanges("2026-10");
    expect(w.map((x) => [x.week, x.start, x.end])).toEqual([
      [1, "2026-10-01", "2026-10-07"],
      [2, "2026-10-08", "2026-10-14"],
      [3, "2026-10-15", "2026-10-21"],
      [4, "2026-10-22", "2026-10-28"],
      [5, "2026-10-29", "2026-10-31"],
    ]);
    expect(weekRanges("2026-02")).toHaveLength(4);
    expect(weekOf("2026-10-08", "2026-10")).toBe(2);
    expect(weekOf("2026-09-30", "2026-10")).toBe(0);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});

describe("topicState (derivado en vivo)", () => {
  it("clasifica sin tratar / practicando / consolidado / completo / examen pendiente / no encontrado", () => {
    expect(topicState(null)).toBe("no_encontrado");
    expect(topicState(lite({ pct: 0, attempts: 0 }))).toBe("sin_tratar");
    expect(topicState(lite({ pct: 35 }))).toBe("practicando");
    expect(topicState(lite({ pct: 80 }))).toBe("consolidado");
    expect(topicState(lite({ pct: 100, mastered: [true] }))).toBe("completo");
    expect(topicState(lite({ pct: 100, mastered: [true], exam: "required" }))).toBe("examen_pendiente");
    expect(topicState(lite({ pct: 100, mastered: [true], exam: "required", examPassed: true }))).toBe("completo");
    // dominó todas las skills pero falta aprobar el examen
    expect(topicState(lite({ pct: 90, mastered: [true, true], exam: "required" }))).toBe("examen_pendiente");
  });
});

describe("distributeTopics: reparto semanal", () => {
  it("reparte los temas por semanas según las horas por semana y avisa de cuántos hay en cada una", () => {
    // 4 h/semana = 240 min; 4 temas de 60 min -> 4 por semana
    const d = distributeTopics({ month: "2026-10", hoursPerWeek: 4, topics: Array.from({ length: 10 }, (_, i) => T(i + 1)) });
    expect(d.fits).toBe(true);
    expect(d.topics.map((t) => t.targetWeek)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(d.weeks[0]!.topics).toEqual(["P/T1", "P/T2", "P/T3", "P/T4"]);
    expect(d.weeks[0]!.minutes).toBe(240);
    expect(d.weeks[4]!.topics).toEqual([]);
    expect(d.totalMinutes).toBe(600);
  });

  it("conserva el orden de los temas y sus skills", () => {
    const d = distributeTopics({ month: "2026-10", hoursPerWeek: 2, topics: [{ ...T(1), skills: ["debug"] }, T(2), T(3)] });
    expect(d.topics.map((t) => t.folder)).toEqual(["P/T1", "P/T2", "P/T3"]);
    expect(d.topics[0]!.skills).toEqual(["debug"]);
    expect(d.topics.map((t) => t.targetWeek)).toEqual([1, 1, 2]);
  });

  it("avisa si no cabe y deja lo que sobra en la última semana", () => {
    // 1 h/semana x ~4,4 semanas = ~264 min; 10 temas de 60 = 600
    const d = distributeTopics({ month: "2026-10", hoursPerWeek: 1, topics: Array.from({ length: 10 }, (_, i) => T(i + 1)) });
    expect(d.fits).toBe(false);
    expect(d.warnings[0]).toContain("No cabe en el periodo");
    expect(d.requiredHoursPerWeek).toBeGreaterThan(2);
    expect(Math.max(...d.topics.map((t) => t.targetWeek))).toBe(5);
    expect(d.topics).toHaveLength(10);
  });

  it("el mes en curso reparte desde hoy: las semanas pasadas no reciben temas", () => {
    const d = distributeTopics({ month: "2026-10", hoursPerWeek: 4, topics: [T(1), T(2)], from: "2026-10-16" });
    expect(d.weeks[0]!.capacityMinutes).toBe(0);
    expect(d.weeks[1]!.capacityMinutes).toBe(0);
    expect(d.topics.every((t) => t.targetWeek >= 3)).toBe(true);
  });

  it("rechaza horas no positivas o un mes inválido", () => {
    expect(() => distributeTopics({ month: "2026-10", hoursPerWeek: 0, topics: [] })).toThrow();
    expect(() => distributeTopics({ month: "2026-13", hoursPerWeek: 3, topics: [] })).toThrow();
  });
});

describe("buildPlan / mergePlans", () => {
  const seeds = [
    { area: "Programación", objective: "Backend", topics: [T(1), T(2)], deliverable: { title: "API", criteria: ["CRUD"] } },
    { area: "Inglés", objective: "B2", topics: [{ folder: "E/T1", title: "Reading", estMinutes: 60 }] },
  ];

  it("reparte las horas entre subplanes y genera ids únicos y semanas por subplan", () => {
    const b = buildPlan(seeds, { month: "2026-10", hoursPerWeek: 6, now: "2026-10-01T00:00:00Z" });
    expect(b.plan.subplans.map((s) => s.id)).toEqual(["s1-programacion", "s2-ingles"]);
    expect(b.plan.subplans[0]!.weeks).toHaveLength(5);
    expect(b.plan.subplans[0]!.deliverable).toMatchObject({ title: "API", status: "idea", criteria: ["CRUD"] });
    expect(b.fits).toBe(true);
    expect(b.plan.hoursPerWeek).toBe(6);
  });

  it("mergePlans sustituye el subplan del mismo área+objetivo conservando completedAt y el estado del entregable", () => {
    const first = buildPlan(seeds, { month: "2026-10", hoursPerWeek: 6, now: "2026-10-01T00:00:00Z" }).plan;
    first.subplans[0]!.topics[0]!.completedAt = "2026-10-03";
    first.subplans[0]!.deliverable!.status = "en_curso";
    const incoming = buildPlan([{ ...seeds[0]!, topics: [T(1), T(3)] }], { month: "2026-10", hoursPerWeek: 6 }).plan;
    const merged = mergePlans(first, incoming);
    expect(merged.subplans).toHaveLength(2); // el de Inglés se mantiene
    const back = merged.subplans.find((s) => s.area === "Programación")!;
    expect(back.id).toBe("s1-programacion");
    expect(back.topics.map((t) => t.folder)).toEqual(["P/T1", "P/T3"]);
    expect(back.topics[0]!.completedAt).toBe("2026-10-03");
    expect(back.deliverable!.status).toBe("en_curso");
  });
});

describe("refreshPlanProgress: registro de temas completados", () => {
  const plan = (): MonthlyPlan => buildPlan([{ area: "A", objective: "o", topics: [T(1), T(2)] }], { month: "2026-10", hoursPerWeek: 6 }).plan;
  const world: Record<string, TopicLite> = { "P/T1": lite({ pct: 100, mastered: [true] }), "P/T2": lite({ pct: 30 }) };

  it("anota completedAt solo de los temas completos y una única vez", () => {
    const first = refreshPlanProgress(plan(), (f) => world[f], "2026-10-09");
    expect(first.changed).toBe(true);
    expect(first.completed).toEqual(["P/T1"]);
    expect(first.plan.subplans[0]!.topics.map((t) => t.completedAt)).toEqual(["2026-10-09", undefined]);
    // otro día: no pisa la fecha
    const second = refreshPlanProgress(first.plan, (f) => world[f], "2026-10-20");
    expect(second.changed).toBe(false);
    expect(second.plan.subplans[0]!.topics[0]!.completedAt).toBe("2026-10-09");
  });

  it("no borra la fecha si el avance baja después, y el tema sigue contando como hecho", () => {
    const first = refreshPlanProgress(plan(), (f) => world[f], "2026-10-09").plan;
    const regress = refreshPlanProgress(first, () => lite({ pct: 20 }), "2026-10-21");
    expect(regress.changed).toBe(false);
    const view = deriveView(first, () => lite({ pct: 20 }), "2026-10-21");
    expect(view.subplans[0]!.done).toBe(1);
  });
});

describe("deriveView", () => {
  it("deriva estado, % y progreso global del plan", () => {
    const p = buildPlan([{ area: "A", objective: "o", topics: [T(1), T(2)] }], { month: "2026-10", hoursPerWeek: 6 }).plan;
    const v = deriveView(p, (f) => (f === "P/T1" ? lite({ pct: 100, mastered: [true] }) : f === "P/T2" ? lite({ pct: 40 }) : null), "2026-10-09");
    expect(v.subplans[0]!.topics.map((t) => [t.state, t.pct])).toEqual([["completo", 100], ["practicando", 40]]);
    expect(v.summary).toMatchObject({ subplans: 1, topics: 2, done: 1, pct: 70, currentWeek: 2, weeks: 5 });
    const missing = deriveView(p, () => null, "2026-10-09");
    expect(missing.subplans[0]!.topics.every((t) => t.state === "no_encontrado" && !t.found)).toBe(true);
  });
});

describe("planItemsFor: del plan mensual al plan diario", () => {
  const p = (): MonthlyPlan =>
    buildPlan(
      [{ area: "Programación", objective: "Backend", topics: Array.from({ length: 6 }, (_, i) => T(i + 1)), deliverable: { title: "API de inventario" } }],
      { month: "2026-10", hoursPerWeek: 3 },
    ).plan;

  it("devuelve los temas de esta semana y los atrasados primero", () => {
    const plan = p();
    const wk = plan.subplans[0]!.topics.map((t) => t.targetWeek);
    expect(wk).toEqual([1, 1, 1, 2, 2, 2]);
    const w2 = planItemsFor("2026-10-09", [plan]);
    // dentro de una misma semana objetivo, lo que el reparto DIARIO coloca hoy (T3) va por delante
    expect(w2.map((i) => i.folder)).toEqual(["P/T3", "P/T1", "P/T2", "P/T4", "P/T5", "P/T6"]);
    expect(w2[0]).toMatchObject({ scheduledToday: true });
    expect(w2[0]!.todayMinutes).toBeGreaterThan(0);
    // sin haber empezado la ruta nada está atrasado, por mucho que la semana 1 ya pasó
    expect(w2.some((i) => i.overdue)).toBe(false);
    // con algo ya hecho, lo de la semana 1 sin hacer sí es atraso
    const started = planItemsFor("2026-10-09", [plan], (f) => f === "P/T6");
    expect(started.slice(0, 3).every((i) => i.overdue)).toBe(true);
    expect(started[3]!.overdue).toBe(false);
    // con el reparto por avance (lo que usa el Mentor) cumplir el ritmo no deja nada «atrasado» por pasar la semana objetivo
    expect(planItemsFor("2026-10-09", [plan], (f) => f === "P/T6", true).some((i) => i.overdue)).toBe(false);
    expect(w2.every((i) => i.label === "Programación: Backend")).toBe(true);
    // el primer día del mes solo toca la semana 1
    expect(planItemsFor("2026-10-02", [plan]).map((i) => i.folder)).toEqual(["P/T1", "P/T2", "P/T3"]);
  });

  it("omite lo completado (registro o en vivo) y otro mes", () => {
    const plan = p();
    plan.subplans[0]!.topics[0]!.completedAt = "2026-10-03";
    const items = planItemsFor("2026-10-09", [plan], (f) => f === "P/T2");
    expect(items.map((i) => i.folder)).not.toContain("P/T1");
    expect(items.map((i) => i.folder)).not.toContain("P/T2");
    expect(planItemsFor("2026-11-02", [plan])).toEqual([]);
  });

  it("el entregable toca en la última semana, o cuando ya no quedan temas, hasta marcarlo hecho", () => {
    const plan = p();
    expect(planItemsFor("2026-10-09", [plan]).some((i) => i.kind === "deliverable")).toBe(false);
    expect(planItemsFor("2026-10-30", [plan]).find((i) => i.kind === "deliverable")).toMatchObject({ title: "API de inventario" });
    for (const t of plan.subplans[0]!.topics) t.completedAt = "2026-10-05";
    expect(planItemsFor("2026-10-09", [plan]).map((i) => i.kind)).toEqual(["deliverable"]);
    plan.subplans[0]!.deliverable!.status = "hecho";
    expect(planItemsFor("2026-10-09", [plan])).toEqual([]);
  });
});

describe("PlanStore / sanitizePlan", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_plan_"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("conserva la fecha de revisión de un tema al guardar y cargar", () => {
    const st = new PlanStore(dir);
    const plan = buildPlan([{ area: "A", objective: "o", topics: [T(1)] }], { month: "2026-10", hoursPerWeek: 3 }).plan;
    plan.subplans[0]!.topics[0]!.revisionAddedAt = "2026-11-13";
    st.save(plan);
    expect(st.load("2026-10")!.subplans[0]!.topics[0]!.revisionAddedAt).toBe("2026-11-13");
  });

  it("guarda y carga en .notevault/mentor/plans/<mes>.json y lista los meses", () => {
    const st = new PlanStore(dir);
    expect(st.months()).toEqual([]);
    const plan = buildPlan([{ area: "A", objective: "o", topics: [T(1)] }], { month: "2026-10", hoursPerWeek: 3 }).plan;
    st.save(plan);
    st.save(buildPlan([{ area: "A", objective: "o", topics: [T(1)] }], { month: "2026-11", hoursPerWeek: 3 }).plan);
    expect(fs.existsSync(path.join(dir, ".notevault", "mentor", "plans", "2026-10.json"))).toBe(true);
    expect(st.months()).toEqual(["2026-11", "2026-10"]);
    expect(st.load("2026-10")!.subplans[0]!.topics[0]!.folder).toBe("P/T1");
    expect(st.load("nope")).toBeNull();
    expect(() => st.save({ ...plan, month: undefined, start: "oct", end: "nov" })).toThrow();
  });

  it("sanea un archivo corrupto o editado a mano sin romperse", () => {
    expect(sanitizePlan(null)).toBeNull();
    expect(sanitizePlan({ month: "x" })).toBeNull();
    const p = sanitizePlan({
      month: "2026-10",
      subplans: [{ id: "a b", area: "", topics: [{ folder: "P\\T1", targetWeek: 99, estMinutes: "30", completedAt: "ayer" }, {}], deliverable: { title: "X", status: "raro" } }, 7],
    })!;
    expect(p.subplans).toHaveLength(1);
    expect(p.subplans[0]).toMatchObject({ id: "s1", area: "General" });
    expect(p.subplans[0]!.topics).toEqual([{ folder: "P/T1", title: "T1", targetWeek: 5, estMinutes: 30 }]);
    expect(p.subplans[0]!.deliverable!.status).toBe("idea");
  });
});

describe("planes de periodo libre", () => {
  it("distributeTopics con un periodo, días de estudio y ritmo: 2 semanas, lunes a viernes, 2 h/día", () => {
    // 2 semanas desde un lunes: 10 días de estudio × 120 min × 100 % = 1200 min
    const d = distributeTopics({ start: "2026-10-05", end: "2026-10-18", minutesPerDay: 120, studyDays: [1, 2, 3, 4, 5], pace: "intenso", topics: Array.from({ length: 8 }, (_, i) => T(i + 1, 120)) });
    expect(d.weeks).toHaveLength(2);
    expect(d.weeks.map((w) => w.capacityMinutes)).toEqual([600, 600]);
    expect(d.availableMinutes).toBe(1200);
    expect(d.fits).toBe(true);
    expect(d.weeks[0]!.topics.length).toBeGreaterThanOrEqual(4);
    expect(d.topics.at(-1)!.targetWeek).toBe(2);
  });

  it("un periodo que empieza a mitad de semana y las fechas bloqueadas", () => {
    const base = { start: "2026-10-07", end: "2026-10-13", minutesPerDay: 60, studyDays: [1, 2, 3, 4, 5, 6, 7], pace: "intenso" as const, topics: [T(1, 60)] };
    expect(distributeTopics(base).availableMinutes).toBe(420);
    expect(distributeTopics({ ...base, blockedDates: ["2026-10-08", "2026-10-09"] }).availableMinutes).toBe(300);
    // desde hoy (10-10) la primera semana es parcial
    expect(distributeTopics({ ...base, from: "2026-10-10" }).weeks[0]!.capacityMinutes).toBe(240);
  });

  it("avisa si no cabe en el periodo con la capacidad real", () => {
    const d = distributeTopics({ start: "2026-10-05", end: "2026-10-11", minutesPerDay: 60, studyDays: [1, 2, 3], pace: "normal", topics: [T(1, 120), T(2, 120)] });
    expect(d.fits).toBe(false);
    expect(d.warnings[0]).toContain("No cabe en el periodo");
    expect(() => distributeTopics({ start: "2026-10-05", end: "2026-10-01", minutesPerDay: 60, topics: [] })).toThrow();
    expect(() => distributeTopics({ start: "2026-10-05", end: "2026-10-11", minutesPerDay: 0, topics: [] })).toThrow();
  });

  it("buildPlan de periodo libre: id <inicio>_<fin>, nombre autogenerado, horas efectivas y precondiciones", () => {
    const pre = { start: "2026-10-06", end: "2026-11-05", minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "normal" as const, goalIds: [], subjects: ["P"], levels: {}, deliverables: "yes" as const };
    const b = buildPlan([{ area: "P", objective: "Backend", topics: [T(1), T(2)] }], { id: "2026-10-06_2026-11-05", start: pre.start, end: pre.end, minutesPerDay: 240, studyDays: pre.studyDays, pace: "normal", preconditions: pre, auto: true });
    expect(b.plan).toMatchObject({ id: "2026-10-06_2026-11-05", start: "2026-10-06", end: "2026-11-05", auto: true });
    expect(b.plan.month).toBeUndefined();
    // el nombre sale de las ÁREAS (sin «+N» ni repetir el periodo)
    expect(b.plan.name).toBe("P · 6 oct–5 nov");
    expect(b.plan.subplans[0]!.weeks).toHaveLength(5);
    expect(b.plan.hoursPerWeek).toBeGreaterThan(10);
    expect(b.plan.preconditions!.minutesPerDay).toBe(240);
  });

  it("weekOf acepta un mes o un periodo", () => {
    expect(weekOf("2026-10-14", { start: "2026-10-07", end: "2026-10-30" })).toBe(2);
    expect(weekOf("2026-10-06", { start: "2026-10-07", end: "2026-10-30" })).toBe(0);
  });
});

describe("compatibilidad de lectura de los planes mensuales", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_plan_legacy_"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const legacy = { month: "2026-10", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", hoursPerWeek: 6, subplans: [{ id: "s1", area: "A", objective: "o", topics: [{ folder: "P/T1", title: "T1", targetWeek: 2, estMinutes: 60 }] }] };

  it("un <AAAA-MM>.json sin start/end se lee como un plan de periodo (día 1 – último día)", () => {
    fs.mkdirSync(path.join(dir, ".notevault", "mentor", "plans"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".notevault", "mentor", "plans", "2026-10.json"), JSON.stringify(legacy), "utf-8");
    const st = new PlanStore(dir);
    const p = st.load("2026-10")!;
    expect(p).toMatchObject({ id: "2026-10", month: "2026-10", start: "2026-10-01", end: "2026-10-31", hoursPerWeek: 6 });
    expect(p.subplans[0]!.weeks).toHaveLength(5);
    expect(st.months()).toEqual(["2026-10"]);
    expect(st.list().map((x) => x.id)).toEqual(["2026-10"]);
    expect(planItemsFor("2026-10-09", [p]).map((i) => i.folder)).toEqual(["P/T1"]);
    expect(planItemsFor("2026-11-02", [p])).toEqual([]);
  });

  it("sin migración destructiva: leerlo no reescribe el archivo y guardarlo conserva el mes", () => {
    const file = path.join(dir, ".notevault", "mentor", "plans", "2026-10.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(legacy), "utf-8");
    const before = fs.readFileSync(file, "utf-8");
    const st = new PlanStore(dir);
    st.load("2026-10");
    st.list();
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
    st.save({ ...st.load("2026-10")!, name: "Mi mes" });
    const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(saved).toMatchObject({ id: "2026-10", month: "2026-10", start: "2026-10-01", end: "2026-10-31", name: "Mi mes" });
  });

  it("conviven con los planes de periodo libre", () => {
    const st = new PlanStore(dir);
    st.save(buildPlan([{ area: "A", objective: "o", topics: [T(1)] }], { month: "2026-10", hoursPerWeek: 3 }).plan);
    st.save(buildPlan([{ area: "B", objective: "p", topics: [T(2)] }], { start: "2026-10-12", end: "2026-10-25", minutesPerDay: 60 }).plan);
    expect(st.list().map((p) => p.id)).toEqual(["2026-10", "2026-10-12_2026-10-25"]);
    expect(st.months()).toEqual(["2026-10"]);
  });
});

describe("planes solapados, nombre, archivo y papelera", () => {
  const mk = (start: string, end: string, folders: number[], over: Partial<MonthlyPlan> = {}): MonthlyPlan => ({
    ...buildPlan([{ area: "A", objective: `o${start}`, topics: folders.map((n) => T(n)) }], { start, end, minutesPerDay: 120, now: "2026-10-01T00:00:00Z" }).plan,
    ...over,
  });

  it("planItemsFor combina varios planes activos sin repetir un mismo tema", () => {
    const a = mk("2026-10-05", "2026-10-25", [1, 2]);
    const b = mk("2026-10-08", "2026-10-31", [2, 3]); // el tema 2 está en los dos
    const items = planItemsFor("2026-10-20", [a, b]);
    expect(items.map((i) => i.folder).sort()).toEqual(["P/T1", "P/T2", "P/T3"]);
    expect(new Set(items.map((i) => i.planId))).toEqual(new Set([a.id, b.id]));
  });

  it("solo cuenta los planes que contienen la fecha y no los archivados", () => {
    const a = mk("2026-10-05", "2026-10-11", [1]);
    const b = mk("2026-10-20", "2026-10-31", [2]);
    expect(planItemsFor("2026-10-08", [a, b]).map((i) => i.folder)).toEqual(["P/T1"]);
    expect(planItemsFor("2026-10-15", [a, b])).toEqual([]);
    expect(planItemsFor("2026-10-08", [{ ...a, archived: true }, b])).toEqual([]);
  });

  it("estado y nombre del plan", () => {
    const a = mk("2026-10-05", "2026-10-11", [1]);
    expect(planStatus(a, "2026-10-04")).toBe("futuro");
    expect(planStatus(a, "2026-10-08")).toBe("activo");
    expect(planStatus(a, "2026-10-12")).toBe("terminado");
    expect(planStatus({ ...a, archived: true }, "2026-10-08")).toBe("terminado");
    expect(planName(a)).toBe("A · 5 oct–11 oct");
    expect(planName({ ...a, name: "Mi plan" })).toBe("Mi plan");
  });

  it("trash manda el archivo a la papelera de la vault", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_plan_trash_"));
    try {
      const st = new PlanStore(dir);
      const p = st.save(mk("2026-10-05", "2026-10-11", [1]));
      expect(st.trash(p.id)).toBe(true);
      expect(st.load(p.id)).toBeNull();
      expect(st.trash(p.id)).toBe(false);
      expect(fs.readdirSync(path.join(dir, LAYOUT.trash_dir, "mentor-plans"))).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("distributeTopics con spread (planes por precondiciones)", () => {
  it("con holgura reparte los temas a partes iguales por las semanas en vez de llenar la primera", () => {
    const base = { start: "2026-10-05", end: "2026-10-18", minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "intenso" as const, topics: Array.from({ length: 6 }, (_, i) => T(i + 1, 60)) };
    expect(distributeTopics(base).topics.map((t) => t.targetWeek)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(distributeTopics({ ...base, spread: true }).topics.map((t) => t.targetWeek)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("si no cabe, usa toda la capacidad (sin repartir a la baja)", () => {
    const d = distributeTopics({ start: "2026-10-05", end: "2026-10-18", minutesPerDay: 60, studyDays: [1, 2, 3, 4, 5, 6], pace: "intenso", topics: Array.from({ length: 14 }, (_, i) => T(i + 1, 60)), spread: true });
    expect(d.fits).toBe(false);
    expect(d.weeks[0]!.topics.length).toBeGreaterThanOrEqual(5);
  });
});
