// @vitest-environment jsdom
//
// «Temas por área» — selección, filtro por estado, barra de acciones en lote, diálogo de confirmación y cola secuencial.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import type { PlanTopicRow } from "../../lib/planTopicCatalog";
import { estimateAiCalls, matchesStatus, planBulk } from "../../lib/topicSelection";
import type { AreaTopicRow } from "../../lib/planAreaTopics";
import type { MentorPlan } from "../../lib/types";
import { useApp } from "../../store/app";

vi.mock("./openTopic", () => ({ openTopic: vi.fn(), openTopicNote: vi.fn(), openTopicCanvas: vi.fn() }));
import { PlanAreaTopics } from "./PlanAreaTopics";

const F = (n: string) => `P/4/${n}`;
const topic = (n: string, week: number) => ({ folder: F(n), title: n, targetWeek: week, estMinutes: 30 });
const PLAN = {
  id: "p1",
  subplans: [{ id: "s1", area: "Backend", objective: "", topics: [topic("A", 1), topic("B", 2), topic("C", 3), topic("D", 4)], weeks: [], requiredGoals: [] }],
} as unknown as MentorPlan;
const row = (n: string, over: Partial<PlanTopicRow> = {}): PlanTopicRow => ({
  folder: F(n), title: n, branch: "Backend", inPlan: true, exists: true, topicType: "unknown", theory: true, contract: true, canvas: true,
  manifest: true, skills: 3, exercises: 5, score: 100, complete: true, gaps: 0, ...over,
});
// A completo · B sin mapa y desactualizado · C sin ejercicios · D sin nada (ni nota)
const ROWS = [
  row("A"),
  row("B", { canvas: false, complete: false, outdated: { theory: true } }),
  row("C", { exercises: 0, complete: false }),
  row("D", { theory: false, canvas: false, manifest: false, exercises: 0, complete: false }),
];

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const byTest = (id: string) => host.querySelector<HTMLElement>(`[data-testid=${id}]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];
const click = async (id: string) => { await act(async () => { byTest(id)!.click(); }); await flush(); };
const PARTS = ["theory", "map", "practice", "exercises"] as const;
/** Deja marcada SOLO esa pieza (o las piezas dadas) en la barra y pulsa «Regenerar lo marcado». */
const regen = async (...want: Array<(typeof PARTS)[number]>) => {
  for (const p of PARTS) { const el = byTest(`bulk-check-${p}`) as HTMLInputElement; if (el.checked && !want.includes(p) && !el.disabled) await click(`bulk-check-${p}`); }
  for (const p of want) { const el = byTest(`bulk-check-${p}`) as HTMLInputElement; if (!el.checked) await click(`bulk-check-${p}`); }
  await click("bulk-regen");
};
const clickEl = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const rowEl = (n: string) => host.querySelector<HTMLElement>(`[data-testid=area-row][data-folder="${F(n)}"]`)!;
const check = (n: string) => clickEl(rowEl(n).querySelector<HTMLElement>("[data-testid=row-select]")!);
const rows = () => [...host.querySelectorAll("[data-testid=area-row]")].map((r) => r.getAttribute("data-folder")!.replace("P/4/", ""));
const mount = async () => { await act(async () => { root.render(<PlanAreaTopics plan={PLAN} />); }); await flush(); await flush(); };
const job = (folder: string, over: Record<string, unknown> = {}) => ({ id: `j-${folder}`, folder, what: "map", log: ["✓ hecho"], done: true, error: "", finished: 2, total: 2, backup: ".trash/regenerar/x", restored: false, created: [], archived: [], ...over });
const bulk = (id: string) => byTest(id) as HTMLButtonElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorPlanTopicCatalog").mockResolvedValue({ loading: false, rows: ROWS });
  vi.spyOn(api, "aiSettings").mockResolvedValue({ config: { is_bridge: false }, providers: [], models: [] } as never);
  vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: { planId: "p1", at: "", scope: {}, areas: [], tasks: [], totals: { tasks: 0, required: 0, aiCalls: 0, files: 0, minutes: 0, byKind: {} }, manual: [], aiConfigured: true, maxWeek: 4 }, execution: null, aiConfigured: true } as never);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Temas por área — selección y filtro", () => {
  it("la barra de acciones se ve siempre: sin selección, desactivada y con la pista", async () => {
    await mount();
    expect(byTest("bulk-bar")).toBeTruthy();
    expect(byTest("bulk-count")!.textContent).toContain("Selecciona temas para regenerar");
    for (const w of ["regen", "missing"]) expect(bulk(`bulk-${w}`).disabled).toBe(true);
  });

  it("una casilla por tema: al marcar, la barra cuenta y activa los botones", async () => {
    await mount();
    await check("B");
    expect(byTest("bulk-count")!.textContent).toBe("1 tema seleccionado");
    expect(bulk("bulk-missing").disabled).toBe(false);
    // «Regenerar» espera a que se marque qué regenerar
    expect(bulk("bulk-regen").disabled).toBe(true);
    await click("bulk-check-theory");
    expect(bulk("bulk-regen").disabled).toBe(false);
    expect(bulk("bulk-regen").textContent).toContain("Regenerar teoría");
    await click("bulk-check-theory");
    await check("C");
    expect(byTest("bulk-count")!.textContent).toBe("2 temas seleccionados");
    await check("B");
    await check("C");
    expect(bulk("bulk-regen").disabled).toBe(true);
  });

  it("la casilla de la cabecera selecciona todo lo visible y vuelve a quitarlo", async () => {
    await mount();
    await click("select-all");
    expect(byTest("bulk-count")!.textContent).toBe("4 temas seleccionados");
    await click("select-all");
    expect(byTest("bulk-count")!.textContent).toContain("Selecciona temas");
  });

  it("el filtro por estado reduce la tabla y «seleccionar todos» solo toma lo visible", async () => {
    await mount();
    expect(byTest("status-filter-noMap")!.textContent).toContain("2");
    await click("status-filter-noMap");
    expect(rows()).toEqual(["B", "D"]);
    await click("select-all");
    expect(byTest("bulk-count")!.textContent).toBe("2 temas seleccionados");
    await click("status-filter-noExercises");
    expect(rows()).toEqual(["C", "D"]); // B ya no se ve, así que ya no cuenta
    expect(byTest("bulk-count")!.textContent).toBe("1 tema seleccionado");
    await click("status-filter-outdated");
    expect(rows()).toEqual(["B"]);
    await click("status-filter-complete");
    expect(rows()).toEqual(["A"]);
    await click("status-filter-noTheory");
    expect(rows()).toEqual(["D"]);
    await click("status-filter-all");
    expect(rows()).toEqual(["A", "B", "C", "D"]);
  });

  it("el menú de selección: todos, solo los que faltan, solo sin ejercicios, solo desactualizados y limpiar", async () => {
    await mount();
    const pick = async (k: string) => { await click("bulk-select-menu"); await click(`sel-${k}`); };
    await pick("missing");
    expect(byTest("bulk-count")!.textContent).toBe("3 temas seleccionados"); // B, C, D
    await pick("noExercises");
    expect(byTest("bulk-count")!.textContent).toBe("2 temas seleccionados"); // C, D
    await pick("outdated");
    expect(byTest("bulk-count")!.textContent).toBe("1 tema seleccionado"); // B
    await pick("all");
    expect(byTest("bulk-count")!.textContent).toBe("4 temas seleccionados");
    await pick("clear");
    expect(byTest("bulk-count")!.textContent).toContain("Selecciona temas");
  });

  it("cada fila tiene sus cuatro acciones rápidas siempre visibles", async () => {
    await mount();
    const quick = [...rowEl("B").querySelectorAll<HTMLButtonElement>("[data-testid=row-quick] button")];
    expect(quick.map((b) => b.getAttribute("aria-label"))).toEqual(["Regenerar teoría de B", "Regenerar mapa de B", "Regenerar práctica de B", "Regenerar ejercicios de B"]);
    expect(quick.every((b) => !b.disabled)).toBe(true);
    // D no tiene nota ni práctica: teoría, mapa y ejercicios no se pueden, con su motivo
    const d = [...rowEl("D").querySelectorAll<HTMLButtonElement>("[data-testid=row-quick] button")];
    expect(d.map((b) => b.disabled)).toEqual([true, true, false, true]);
    expect(d[0]!.title).toContain("no tiene teoría");
  });
});

describe("Temas por área — lote", () => {
  it("el diálogo dice qué se reemplaza, cuántos temas, las llamadas a la IA y la copia en .trash; cancelar no lanza nada", async () => {
    const start = vi.spyOn(api, "studyTopicRegenerate");
    await mount();
    await check("A");
    await check("B");
    await regen("theory");
    const text = byTest("bulk-confirm")!.textContent!;
    expect(byTest("bulk-confirm-lead")!.textContent).toContain("REEMPLAZAR la teoría de 2 temas");
    expect(text).toContain("A");
    expect(byTest("bulk-confirm-calls")!.textContent).toContain("2");
    expect(byTest("bulk-confirm-backup")!.textContent).toContain(".trash/regenerar");
    await click("bulk-confirm-cancel");
    expect(byTest("bulk-confirm")).toBeNull();
    expect(start).not.toHaveBeenCalled();
    // el mapa no usa IA
    await regen("map");
    expect(byTest("bulk-confirm-calls")!.textContent).toContain("No usa la IA");
  });

  it("varias casillas = UN solo lote: «teoría + práctica» pide una tarea con las dos y el diálogo lo dice", async () => {
    vi.spyOn(api, "studyTopicRegenerate");
    await mount();
    await check("A");
    await regen("theory", "practice");
    const lead = byTest("bulk-confirm-lead")!.textContent!;
    expect(lead).toContain("la teoría y la práctica");
    // el mapa se rehace con la teoría: su casilla queda marcada y bloqueada
    expect((byTest("bulk-check-map") as HTMLInputElement).disabled).toBe(true);
  });

  it("los temas que no se pueden regenerar se omiten y se dice por qué", async () => {
    await mount();
    await check("B");
    await check("D");
    await regen("map");
    expect(byTest("bulk-confirm-skipped")!.textContent).toContain("D: Este tema no tiene teoría");
    expect(byTest("bulk-confirm-lead")!.textContent).toContain("de 1 tema");
  });

  it("cola secuencial: un tema a la vez, uno falla y los demás siguen; resumen al final", async () => {
    const order: string[] = [];
    let running = 0;
    let maxParallel = 0;
    vi.spyOn(api, "studyTopicRegenerate").mockImplementation(async (folder, what, confirm) => {
      expect(confirm).toBe(true);
      expect(what).toBe("map");
      order.push(folder);
      running++;
      maxParallel = Math.max(maxParallel, running);
      return { jobId: folder };
    });
    vi.spyOn(api, "studyTopicRegenerateStatus").mockImplementation(async (id) => {
      running--;
      return job(id, id === F("B") ? { error: "el canvas no pasó la verificación" } : {}) as never;
    });
    await mount();
    await click("select-all");
    await regen("map");
    expect(byTest("bulk-confirm-skipped")).toBeTruthy(); // D no tiene nota
    await click("bulk-confirm-run");
    await flush(); await flush(); await flush(); await flush();
    expect(order).toEqual([F("A"), F("B"), F("C")]);
    expect(maxParallel).toBe(1);
    const items = all("bulk-summary-item").map((e) => [e.textContent, e.dataset.state]);
    expect(items).toEqual([["✓ A", "ok"], ["✗ B: el canvas no pasó la verificación", "error"], ["✓ C", "ok"]]);
    expect(byTest("bulk-summary")!.textContent).toContain("2 bien, 1 con error");
    await click("bulk-summary-close");
    expect(byTest("bulk-progress")).toBeNull();
  });

  it("mientras corre muestra «2/3 · tema · mapa…» y se puede detener entre temas: lo pendiente queda sin hacer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const start = vi.spyOn(api, "studyTopicRegenerate").mockImplementation(async (folder) => ({ jobId: folder }));
    vi.spyOn(api, "studyTopicRegenerateStatus").mockImplementation(async (id) => {
      if (id === F("A")) await gate;
      return job(id) as never;
    });
    await mount();
    await check("A");
    await check("B");
    await check("C");
    await regen("map");
    await click("bulk-confirm-run");
    await flush();
    expect(byTest("bulk-progress-line")!.textContent).toContain("1/3 · A · mapa…");
    expect(bulk("bulk-regen").disabled).toBe(true); // no se lanza otra cola encima
    await click("bulk-stop");
    expect(bulk("bulk-stop").disabled).toBe(true);
    release();
    await flush(); await flush(); await flush(); await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(all("bulk-summary-item").map((e) => e.dataset.state)).toEqual(["ok", "cancelled", "cancelled"]);
    expect(byTest("bulk-summary")!.textContent).toContain("2 sin hacer");
  });

  it("si el trabajo ni siquiera arranca (excepción), cuenta como fallo y la cola sigue", async () => {
    vi.spyOn(api, "studyTopicRegenerate").mockImplementation(async (folder) => {
      if (folder === F("A")) throw new Error("Ya hay una regeneración en curso de este tema.");
      return { jobId: folder };
    });
    vi.spyOn(api, "studyTopicRegenerateStatus").mockImplementation(async (id) => job(id) as never);
    await mount();
    await check("A");
    await check("B");
    await regen("map");
    await click("bulk-confirm-run");
    await flush(); await flush(); await flush(); await flush();
    expect(all("bulk-summary-item").map((e) => e.dataset.state)).toEqual(["error", "ok"]);
  });

  it("con la IA en modo puente los botones de regenerar siguen activos (el motor es el agente externo)", async () => {
    vi.mocked(api.aiSettings).mockResolvedValue({ config: { is_bridge: true }, providers: [], models: [] } as never);
    await mount();
    await check("B");
    for (const w of ["theory", "map", "practice", "exercises"]) expect((byTest(`bulk-check-${w}`) as HTMLInputElement).disabled).toBe(false);
    expect(bulk("bulk-regen").title).not.toContain("puente");
    expect((rowEl("B").querySelector("[data-testid=quick-map]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("una acción rápida de fila pasa por el mismo diálogo y la misma cola", async () => {
    const start = vi.spyOn(api, "studyTopicRegenerate").mockResolvedValue({ jobId: "j" });
    vi.spyOn(api, "studyTopicRegenerateStatus").mockResolvedValue(job("x") as never);
    await mount();
    await clickEl(rowEl("C").querySelector<HTMLElement>("[data-testid=quick-practice]")!);
    expect(byTest("bulk-confirm-lead")!.textContent).toContain("la práctica de 1 tema");
    await click("bulk-confirm-run");
    await flush(); await flush(); await flush();
    expect(start).toHaveBeenCalledWith(F("C"), "practice", true, "app");
  });

  it("«Generar lo que falta» abre el diálogo de «Ejecutar plan» con el alcance del primer tema elegido", async () => {
    await mount();
    await check("A"); // completo: no tiene nada que generar
    await check("C");
    await click("bulk-missing");
    await flush(); await flush();
    expect(byTest("exec-scope-topic")!.textContent).toContain("C");
    expect(api.mentorExecutionReport).toHaveBeenCalledWith("p1", expect.objectContaining({ mode: "topic", folder: F("C") }));
  });

  it("«Generar lo que falta» sin nada pendiente avisa y no abre nada", async () => {
    const toast = vi.fn();
    useApp.setState({ toast } as never);
    await mount();
    await check("A");
    await click("bulk-missing");
    expect(toast).toHaveBeenCalledWith("info", expect.stringContaining("no les falta nada"));
    expect(byTest("exec-scope-topic")).toBeNull();
  });
});

describe("topicSelection (puro)", () => {
  const r = (over: Partial<AreaTopicRow> = {}): AreaTopicRow => ({ folder: "f", title: "t", week: 1, group: "", completed: false, route: "core", exists: true, theory: true, canvas: true, manifest: true, exercises: 2, incomplete: false, ...over });
  it("filtros por estado", () => {
    expect(matchesStatus(r(), "complete")).toBe(true);
    expect(matchesStatus(r({ canvas: false }), "complete")).toBe(false);
    expect(matchesStatus(r({ canvas: false }), "noMap")).toBe(true);
    expect(matchesStatus(r({ manifest: false }), "noPractice")).toBe(true);
    expect(matchesStatus(r({ exercises: 0 }), "noExercises")).toBe(true);
    expect(matchesStatus(r({ theory: false }), "noTheory")).toBe(true);
    expect(matchesStatus(r({ outdated: { theory: true } }), "outdated")).toBe(true);
    expect(matchesStatus(r(), "outdated")).toBe(false);
    expect(matchesStatus(r({ outdated: {} }), "outdated")).toBe(false);
  });
  it("estimación de llamadas: el mapa no usa IA; «todo» suma", () => {
    expect(estimateAiCalls(r(), "map")).toBe(0);
    expect(estimateAiCalls(r(), "theory")).toBe(1);
    expect(estimateAiCalls(r({ planExercises: 8 }), "exercises")).toBe(8);
    expect(estimateAiCalls(r({ planExercises: 8 }), "all")).toBe(10);
  });
  it("planBulk omite fuera de plan e inexistentes (el modo puente ya no omite: queda el agente externo)", () => {
    const p = planBulk([r({ folder: "a" }), r({ folder: "b", route: "skipped" }), r({ folder: "c", exists: false })], "theory", false);
    expect(p.run.map((x) => x.folder)).toEqual(["a"]);
    expect(p.skipped.map((x) => x.row.folder)).toEqual(["b", "c"]);
    expect(planBulk([r()], "theory", true).run).toHaveLength(1);
  });
});
