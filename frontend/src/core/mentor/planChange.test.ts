// Cambios pedidos a un plan con comentarios: aplicar un parche con recálculo semanal determinista, intérprete por palabras clave (sin IA)
// y validación estricta del parche de la IA (temas inventados, ramas excluidas, semanas fuera del plan, fechas y minutos ignorados).

import { describe, expect, it } from "vitest";
import { sanitizePreconditions } from "../../lib/planTime.js";
import type { CatalogTopic } from "./goalDraft.js";
import { sanitizePlan, type Plan } from "./plan.js";
import { applyOps, opsFromText, parseChangeReply, type ChangeCtx } from "./planChange.js";
import { composeFromPreconditions } from "./planSpec.js";

const TODAY = "2026-10-06";
const t = (branch: string, n: number, est = 60): CatalogTopic[] =>
  Array.from({ length: n }, (_, i) => ({ folder: `Programación/${branch}/T${String(i + 1).padStart(2, "0")}`, title: `${branch.replace(/^[\d.\s]+/, "")} ${i + 1}`, subject: "Programación", skills: [], completenessPct: 0, estMinutes: est }));
const ALL = [...t("4 Backend", 6), ...t("5 Frontend", 6), ...t("3 Desktop Apps (Electron)", 4), ...t("8 Mobile", 4), ...t("6 Databases", 4)];
const ctx: ChangeCtx = { today: TODAY, all: ALL };

function planOf(folders: CatalogTopic[], over: Record<string, unknown> = {}): Plan {
  const pre = sanitizePreconditions({ start: TODAY, end: "2026-11-05", minutesPerDay: 120, studyDays: [1, 2, 3, 4, 5, 6], pace: "intenso", subjects: ["Programación"], deliverables: "yes", branches: { Programación: ["4 Backend", "5 Frontend", "6 Databases"] }, branchPreset: "fullstack", branchExcluded: ["3 Desktop Apps (Electron)", "8 Mobile"], ...over }, TODAY);
  const draft = composeFromPreconditions([{ area: "Programación", objective: "Full stack", topics: folders.map((c) => ({ folder: c.folder, title: c.title, estMinutes: c.estMinutes })), requiredGoals: [], deliverable: { title: "Proyecto", description: "", criteria: [], status: "idea" } }], pre, { today: TODAY, auto: true, rationale: "x" });
  return sanitizePlan({ id: draft.id, start: draft.start, end: draft.end, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z", hoursPerWeek: draft.hoursPerWeek, preconditions: pre, auto: true, subplans: draft.subplans, proposed: true })!;
}

describe("applyOps: parche + recálculo semanal determinista", () => {
  const base = planOf([...ALL.slice(0, 6), ...ALL.slice(6, 12)]);
  const sub = base.subplans[0]!.id;
  const folders = (p: Plan) => p.subplans.flatMap((s) => s.topics.map((x) => x.folder));

  it("conserva la guía pedagógica al recalcular el plan", () => {
    const guided = structuredClone(base);
    guided.subplans[0]!.learningGuide = "Explica desde cero";
    const result = applyOps(guided, [{ op: "set_deliverable", subplan: sub, enabled: false }], ctx);
    expect(result.applied).toBe(1);
    expect(result.plan.subplans[0]!.learningGuide).toBe("Explica desde cero");
    expect(sanitizePlan(JSON.parse(JSON.stringify(result.plan)))!.subplans[0]!.learningGuide).toBe("Explica desde cero");
  });

  it("conserva la marca de revisión al recalcular el plan", () => {
    const marked = structuredClone(base);
    marked.subplans[0]!.topics[0]!.revisionAddedAt = "2026-11-13";
    const result = applyOps(marked, [{ op: "set_deliverable", subplan: sub, enabled: false }], ctx);
    expect(result.applied).toBe(1);
    expect(result.plan.subplans[0]!.topics.find((topic) => topic.folder === marked.subplans[0]!.topics[0]!.folder)?.revisionAddedAt).toBe("2026-11-13");
  });

  it("quitar temas y añadir otros del catálogo recalcula las semanas y resume el cambio", () => {
    const r = applyOps(base, [{ op: "remove_topic", folder: ALL[0]!.folder }, { op: "add_topic", subplan: sub, folder: ALL.at(-1)!.folder }], ctx);
    expect(r.applied).toBe(2);
    expect(r.delta).toMatchObject({ added: 1, removed: 1 });
    expect(folders(r.plan)).not.toContain(ALL[0]!.folder);
    expect(folders(r.plan)).toContain(ALL.at(-1)!.folder);
    expect(r.plan.subplans.flatMap((s) => s.topics).find((topic) => topic.folder === ALL.at(-1)!.folder)?.revisionAddedAt).toBe(TODAY);
    expect(r.changed).toContain(ALL.at(-1)!.folder);
    // el reparto sigue ordenado por semanas y dentro del periodo
    const weeks = r.plan.subplans[0]!.topics.map((x) => x.targetWeek);
    expect([...weeks].sort((a, b) => a - b)).toEqual(weeks);
    expect(Math.max(...weeks)).toBeLessThanOrEqual(5);
    expect(r.plan.proposed).toBe(true); // sigue siendo el mismo plan propuesto
    expect(r.fits).toBe(true);
  });

  it("mover un tema a una semana lo fija (pinned) y el recálculo posterior la respeta; fuera del plan se ignora", () => {
    const f = ALL[2]!.folder;
    const moved = applyOps(base, [{ op: "move_topic", folder: f, week: 4 }, { op: "move_topic", folder: f, week: 99 }], ctx);
    const topic = moved.plan.subplans[0]!.topics.find((x) => x.folder === f)!;
    expect(topic.targetWeek).toBe(4);
    expect(topic.pinned).toBe(true);
    expect(moved.delta.moved).toBeGreaterThanOrEqual(1);
    const later = applyOps(moved.plan, [{ op: "remove_topic", folder: ALL[0]!.folder }], ctx);
    expect(later.plan.subplans[0]!.topics.find((x) => x.folder === f)!.targetWeek).toBe(4);
  });

  it("los temas ya completados conservan su semana y su fecha", () => {
    const done = structuredClone(base);
    done.subplans[0]!.topics[0] = { ...done.subplans[0]!.topics[0]!, completedAt: "2026-10-07" };
    const wk = done.subplans[0]!.topics[0]!.targetWeek;
    const r = applyOps(done, [{ op: "remove_topic", folder: ALL[3]!.folder }], ctx);
    const kept = r.plan.subplans[0]!.topics.find((x) => x.folder === done.subplans[0]!.topics[0]!.folder)!;
    expect(kept.completedAt).toBe("2026-10-07");
    expect(kept.targetWeek).toBe(wk);
  });

  it("entregable: añadir y quitar, y quitar un subplan completo", () => {
    const without = applyOps(base, [{ op: "set_deliverable", subplan: sub, enabled: false }], ctx);
    expect(without.plan.subplans[0]!.deliverable).toBeUndefined();
    expect(without.delta.deliverables).toBe(-1);
    const withIt = applyOps(without.plan, [{ op: "set_deliverable", subplan: sub, enabled: true }], ctx);
    expect(withIt.plan.subplans[0]!.deliverable).toBeTruthy();
    const gone = applyOps(base, [{ op: "remove_subplan", subplan: sub }], ctx);
    expect(gone.plan.subplans).toHaveLength(0);
  });

  it("si el cambio no cabe lo avisa, ofrece opciones calculadas y cada una lo arregla; «más ligero» recorta", () => {
    const many = [...ALL, ...t("9 Tooling", 40)];
    const r = applyOps(base, [{ op: "add_subplan", area: "Extra", objective: "Todo", folders: many.slice(20).map((x) => x.folder) }], { ...ctx, all: many });
    expect(r.fits).toBe(false);
    expect(r.warnings[0]).toContain("no cabe");
    const ids = r.fixOptions.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["trim", "extend", "raise"]));
    for (const o of r.fixOptions) {
      const fixed = applyOps(r.plan, [o.op], { ...ctx, all: many });
      expect(fixed.applied).toBe(1);
      expect(fixed.fits).toBe(true);
    }
    const heavy = planOf(many.slice(0, 50));
    const light = applyOps(heavy, [{ op: "lighter" }], { ...ctx, all: many });
    expect(folders(light.plan).length).toBeLessThan(folders(heavy).length);
    expect(light.fits).toBe(true);
  });

  it("sin cambios reales no escribe nada (applied = 0) y un tema inventado no entra", () => {
    const r = applyOps(base, [{ op: "add_topic", subplan: sub, folder: "Programación/Inventado/X" }, { op: "remove_topic", folder: "no/existe" }], ctx);
    expect(r.applied).toBe(0);
    expect(r.plan).toBe(base);
  });

  it("«restart» (empezar hoy) mueve el comienzo hacia delante, conserva el fin y reparte desde ahí; fuera de rango no hace nada", () => {
    const r = applyOps(base, [{ op: "restart", date: "2026-10-13" }], { ...ctx, today: "2026-10-13" });
    expect(r.applied).toBe(1);
    expect(r.plan.start).toBe("2026-10-13");
    expect(r.plan.end).toBe(base.end);
    expect(r.plan.preconditions!.start).toBe("2026-10-13");
    // todos los temas siguen ahí y caben en las semanas que quedan
    expect(r.plan.subplans.flatMap((s) => s.topics).length).toBe(base.subplans.flatMap((s) => s.topics).length);
    // hacia atrás, el mismo día o con menos de dos semanas de margen: nada
    expect(applyOps(base, [{ op: "restart", date: "2026-10-01" }], ctx).applied).toBe(0);
    expect(applyOps(base, [{ op: "restart", date: base.start }], ctx).applied).toBe(0);
    expect(applyOps(base, [{ op: "restart", date: "2026-11-01" }], ctx).applied).toBe(0);
  });

  it("subir el tiempo diario o ampliar el periodo respeta los límites", () => {
    const raised = applyOps(base, [{ op: "raise_minutes", minutes: 180 }, { op: "raise_minutes", minutes: 5000 }], ctx);
    expect(raised.plan.preconditions!.minutesPerDay).toBe(180);
    const extended = applyOps(base, [{ op: "extend_to", date: "2026-11-30" }, { op: "extend_to", date: "2090-01-01" }], ctx);
    expect(extended.plan.end).toBe("2026-11-30");
  });
});

describe("opsFromText: sin IA, palabras clave", () => {
  const base = planOf([...ALL.slice(0, 16)]);
  const full = { ...ctx };

  it("«quita lo de desktop» / «sin mobile» quita por rama; «quita <tema>» por título", () => {
    const plan = planOf(ALL); // incluye ramas que el plan «full stack» había excluido, para poder quitarlas
    const r = opsFromText("Quita lo de desktop y sin mobile", plan, full);
    const folders = r.ops.filter((o) => o.op === "remove_topic").map((o) => (o as { folder: string }).folder);
    expect(folders.length).toBe(8);
    expect(folders.every((f) => /Desktop|Mobile/.test(f))).toBe(true);
    const byTitle = opsFromText("quita Frontend 2", plan, full);
    expect(byTitle.ops).toEqual([{ op: "remove_topic", folder: "Programación/5 Frontend/T02" }]);
  });

  it("entregables, pasar a una semana, más ligero y añadir una rama del catálogo", () => {
    expect(opsFromText("sin entregables", base, full).ops).toEqual([{ op: "set_deliverable", subplan: base.subplans[0]!.id, enabled: false }]);
    expect(opsFromText("pasa Backend 1 a la semana 3", base, full).ops).toEqual([{ op: "move_topic", folder: "Programación/4 Backend/T01", week: 3 }]);
    expect(opsFromText("hazlo más ligero", base, full).ops).toEqual([{ op: "lighter" }]);
    const add = opsFromText("añade mobile", base, full);
    expect(add.ops.filter((o) => o.op === "add_topic")).toHaveLength(4);
    expect((add.ops[0] as { folder: string }).folder).toContain("8 Mobile");
  });

  it("lo que no entiende devuelve vacío (el texto queda como pendiente en el historial)", () => {
    expect(opsFromText("hazlo como te parezca mejor, confío en ti", base, full).ops).toEqual([]);
    expect(opsFromText("", base, full).ops).toEqual([]);
  });
});

describe("parseChangeReply: validación estricta del parche de la IA", () => {
  const plan = planOf(ALL.slice(0, 12));
  const sub = plan.subplans[0]!.id;
  const catalog = ALL.filter((c) => !plan.subplans[0]!.topics.some((x) => x.folder === c.folder));

  it("descarta temas inventados y de ramas excluidas, semanas fuera del plan, y no lee fechas ni minutos", () => {
    const raw = JSON.stringify({
      ops: [
        { op: "add_topic", subplan: sub, folder: "Programación/Inventado/Zzz" },
        { op: "add_topic", subplan: sub, folder: "Programación/8 Mobile/T01" },
        { op: "add_topic", subplan: sub, folder: "Programación/6 Databases/T01", week: 2, minutes: 9999, date: "2030-01-01" },
        { op: "move_topic", folder: ALL[0]!.folder, week: 99 },
        { op: "remove_topic", folder: "no/existe" },
        { op: "remove_subplan", subplan: "s-inventado" },
        { op: "hackear", x: 1 },
      ],
      summary: "Añado SQL antes.",
    });
    const p = parseChangeReply(raw, plan, catalog, "Más SQL antes del backend");
    expect(p.ok).toBe(true);
    expect(p.ops).toEqual([{ op: "add_topic", subplan: sub, folder: "Programación/6 Databases/T01", week: 2 }]);
    expect(p.discarded).toEqual(expect.arrayContaining(["Programación/Inventado/Zzz", "Programación/8 Mobile/T01 (rama excluida)"]));
    expect(p.summary).toBe("Añado SQL antes.");
  });

  it("una rama excluida entra solo si el comentario la nombra de forma explícita", () => {
    const raw = JSON.stringify({ ops: [{ op: "add_topic", subplan: sub, folder: "Programación/8 Mobile/T01" }] });
    expect(parseChangeReply(raw, plan, catalog, "añade apps móviles Android").ops).toHaveLength(1);
    expect(parseChangeReply(raw, plan, catalog, "hazlo más corto").ops).toHaveLength(0);
  });

  it("basura o JSON sin ops → no ok; más de 40 operaciones se recortan; las minutos de práctica solo valen del conjunto permitido", () => {
    expect(parseChangeReply("lo siento, no puedo", plan, catalog, "x").ok).toBe(false);
    const many = JSON.stringify({ ops: Array.from({ length: 80 }, () => ({ op: "lighter" })) });
    expect(parseChangeReply(many, plan, catalog, "x").ops).toHaveLength(40);
    const withPractice = planOf(ALL.slice(0, 8), { practice: { kataMinutes: 30, sessionsPerWeek: 2, minutesPerSession: 90, monthly: false, focus: "rotate" } });
    const r = applyOps(withPractice, [{ op: "set_practice", kataMinutes: 37 }], ctx);
    expect(r.applied).toBe(0); // 37 no es una opción válida
    const ok = applyOps(withPractice, [{ op: "set_practice", kataMinutes: 15 }], ctx);
    expect(ok.plan.preconditions!.practice!.kataMinutes).toBe(15);
    expect(ok.plan.programmingPractice!.kata!.minutesPerDay).toBe(15);
  });
});
