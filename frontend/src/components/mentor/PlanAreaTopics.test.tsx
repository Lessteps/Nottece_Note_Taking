// @vitest-environment jsdom
//
// Sub-vista «Temas por área»: sub-barra con las áreas del plan, sub-barra de grupos dentro de cada área, tabla de temas y «Generar todo».

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import type { PlanTopicRow } from "../../lib/planTopicCatalog";
import type { MentorPlan } from "../../lib/types";

const openTopic = vi.fn();
vi.mock("./openTopic", () => ({ openTopic: (f: string) => openTopic(f), openTopicNote: vi.fn(), openTopicCanvas: vi.fn() }));
import { PlanAreaTopics } from "./PlanAreaTopics";
import { useNavState } from "../../store/navState";
import { TOPIC_HIGHLIGHT_KEY } from "./mentorNav";

const topic = (folder: string, week: number, over: Record<string, unknown> = {}) => ({ folder, title: folder.split("/").pop()!, targetWeek: week, estMinutes: 30, ...over });
const sub = (id: string, area: string, topics: unknown[], groups?: unknown[]) => ({ id, area, objective: "", topics, weeks: [], requiredGoals: [], ...(groups ? { groups } : {}) });
const PLAN = {
  id: "p1",
  subplans: [
    sub("s1", "Backend", [topic("P/4/4.1 HTTP", 1, { group: "bases" }), topic("P/4/4.2 REST", 2, { group: "kn" })], [
      { id: "bases", title: "Bases", kind: "bases", order: 1 },
      { id: "kn", title: "Conocimientos", kind: "knowledge", order: 2 },
    ]),
    { ...sub("s2", "Frontend", [topic("P/5/5.1 DOM", 1)]), areaId: "frontend" },
  ],
} as unknown as MentorPlan;
const row = (folder: string, over: Partial<PlanTopicRow> = {}): PlanTopicRow => ({
  folder, title: folder.split("/").pop()!, branch: "Backend", inPlan: true, exists: true, topicType: "unknown", theory: true, contract: true, canvas: true,
  manifest: true, skills: 3, exercises: 5, score: 100, complete: true, gaps: 0, ...over,
});
const ROWS = [row("P/4/4.1 HTTP"), row("P/4/4.2 REST", { canvas: false, exercises: 0, complete: false })];

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const byTest = (id: string) => host.querySelector<HTMLElement>(`[data-testid=${id}]`);
const titles = () => [...host.querySelectorAll("[data-testid=area-open]")].map((e) => e.textContent);
const click = async (id: string) => { await act(async () => { byTest(id)!.click(); }); };
const mount = async (plan: MentorPlan) => { await act(async () => { root.render(<PlanAreaTopics plan={plan} />); }); await flush(); await flush(); };

beforeEach(() => {
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorPlanTopicCatalog").mockResolvedValue({ loading: false, rows: ROWS });
  vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: { planId: "p1", at: "", scope: {}, areas: [], tasks: [], totals: { tasks: 0, required: 0, aiCalls: 0, files: 0, minutes: 0, byKind: {} }, manual: [], aiConfigured: true, maxWeek: 4 }, execution: null, aiConfigured: true } as never);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  openTopic.mockClear();
  useNavState.getState().clear();
});

describe("PlanAreaTopics — tareas externas", () => {
  const t = { id: "h1", what: "theory", createdAt: "2026-10-23T10:20:30.000Z", task: "x.md", taskAbs: "x.md", resultDir: "r", folder: "f", prompt: "p", status: "waiting", log: [], ready: { found: 0, expected: 1 }, topics: [] };
  it("«Tareas externas (N)» solo se ve si hay tareas guardadas", async () => {
    vi.spyOn(api, "studyTopicRegenerateHandoffList").mockResolvedValue([]);
    await mount(PLAN);
    await flush();
    expect(byTest("external-tasks")).toBeNull();
  });
  it("con tareas guardadas enseña «Tareas externas (1)»", async () => {
    vi.spyOn(api, "studyTopicRegenerateHandoffList").mockResolvedValue([t] as never);
    await mount(PLAN);
    await flush();
    expect(byTest("external-tasks-toggle")!.textContent).toContain("Tareas externas (1)");
  });
});

describe("PlanAreaTopics", () => {
  it("una pestaña por área del plan; la primera abierta, con sus temas en orden de ruta y lo que falta marcado con texto", async () => {
    await mount(PLAN);
    const tabs = [...byTest("area-tabs")!.querySelectorAll("button")].map((b) => b.dataset.testid);
    expect(tabs).toEqual(["area-tabs-s1", "area-tabs-frontend", "area-tabs-__bases"]); // Bases no es de ningún área: pestaña propia
    expect(byTest("area-tabs-s1")!.getAttribute("aria-pressed")).toBe("true");
    expect(byTest("area-tabs-s1")!.textContent).toContain("por generar"); // el aviso también va escrito para lectores de pantalla
    expect(titles()).toEqual(["4.2 REST"]);
    const rest = host.querySelectorAll("[data-testid=area-row]")[0]!;
    expect(rest.textContent).toContain("Sin mapa");
    expect(rest.textContent).toContain("Sin ejercicios");
    expect(byTest("area-summary")!.textContent).toContain("1 por generar");
  });

  it("cambia de área y de grupo con las sub-barras; abrir un tema lo abre", async () => {
    await mount(PLAN);
    expect(byTest("group-tabs")).toBeTruthy();
    await click("group-tabs-kn");
    expect(titles()).toEqual(["4.2 REST"]);
    await click("area-tabs-frontend");
    expect(titles()).toEqual(["5.1 DOM"]);
    expect(byTest("group-tabs")!.querySelectorAll("button")).toHaveLength(1); // sin grupos solo hay «Todos»: la barra sigue para poder añadir una asignatura
    await click("area-tabs-__bases");
    expect(titles()).toEqual(["4.1 HTTP"]);
    expect(byTest("generate-area")).toBeNull(); // Bases se genera tema a tema
    await click("area-tabs-s1");
    expect(titles()).toEqual(["4.2 REST"]); // al volver, el grupo se reinicia a «Todos»
    // pulsar el tema ofrece sus opciones: apunte, archivo de práctica, canvas y Pomodoro
    await click("area-open");
    expect([...document.querySelectorAll("[data-testid=board-menu] [role=menuitem]")].map((b) => b.textContent!.trim())).toEqual(["Abrir apunte (.md)", "Abrir archivo de práctica", "Abrir canvas explicativo", "Asignar al Pomodoro", "Ir a la planeación"]);
    await act(async () => { document.querySelector<HTMLElement>("[data-testid=board-open-practice]")!.click(); });
    expect(openTopic).toHaveBeenCalledWith("P/4/4.2 REST");
  });

  it("«Generar todo» abre el diálogo con el alcance de ese tema; lo completo no se puede generar", async () => {
    await mount(PLAN);
    await click("area-tabs-__bases");
    expect([...host.querySelectorAll<HTMLButtonElement>("[data-testid=generate-topic]")][0]!.disabled).toBe(true); // HTTP está completo
    await click("area-tabs-s1");
    const btns = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=generate-topic]")];
    expect(btns[0]!.disabled).toBe(false);
    await act(async () => { btns[0]!.click(); });
    await flush(); await flush();
    expect(byTest("exec-scope-topic")!.textContent).toContain("4.2 REST");
    expect(api.mentorExecutionReport).toHaveBeenCalledWith("p1", expect.objectContaining({ mode: "topic", folder: "P/4/4.2 REST", includeRecommended: true }));
  });

  it("«Generar el área» usa el alcance del área", async () => {
    await mount(PLAN);
    await act(async () => { byTest("generate-area")!.click(); });
    await flush(); await flush();
    expect(api.mentorExecutionReport).toHaveBeenCalledWith("p1", expect.objectContaining({ mode: "area", areaKey: "s1" }));
  });

  it("si el plan cambia de áreas la sub-barra se actualiza sola", async () => {
    await mount(PLAN);
    await click("area-tabs-frontend");
    await mount({ ...PLAN, subplans: PLAN.subplans.slice(0, 1) } as MentorPlan);
    expect(byTest("area-tabs-frontend")).toBeNull();
    expect(titles()).toEqual(["4.2 REST"]);
  });
});

const BRIDGE_ENGINES = { mode: "bridge", provider: "bridge_claude", providerLabel: "Claude web (sin API)", model: "", hasKey: false, isClaude: false, recommended: "handoff", engines: [
  { id: "app", label: "Con la app", available: false, reason: "La IA de la app está en modo puente (sin API): no puede regenerar sola.", detail: "d" },
  { id: "claude", label: "Con Claude (API key)", available: false, reason: "La IA de la app está en modo puente (sin API): no puede regenerar sola.", detail: "d" },
  { id: "handoff", label: "Con Antigravity / Claude Code", available: true, reason: "", detail: "d" },
] };

describe("PlanAreaTopics — panel desplegable «Regenerar»", () => {
  const job = (over: Record<string, unknown> = {}) => ({ id: "j1", folder: "P/4/4.2 REST", what: "theory", log: ["✓ Teoría regenerada."], done: true, error: "", finished: 3, total: 3, backup: ".trash/regenerar/x_4.2 REST", restored: false, created: [], archived: [], ...over });
  const ai = (bridge: boolean) => vi.spyOn(api, "aiSettings").mockResolvedValue({ config: { is_bridge: bridge }, providers: [], models: [] } as never);

  it("cada tema se despliega con las cuatro acciones y lo que existe de cada artefacto; desplegar no llama a nada", async () => {
    ai(false);
    const start = vi.spyOn(api, "studyTopicRegenerate");
    await mount(PLAN);
    expect(byTest("regen-panel")).toBeNull();
    await click("row-expand");
    await flush();
    expect(byTest("row-expand")!.getAttribute("aria-expanded")).toBe("true");
    expect(byTest("area-row-expanded")).toBeTruthy();
    expect(byTest("regen-theory")!.textContent).toContain("con nota");
    expect(byTest("regen-map")!.textContent).toContain("sin mapa");
    expect(byTest("regen-practice")!.textContent).toContain("existe");
    expect(byTest("regen-exercises")!.textContent).toContain("sin ejercicios");
    expect(["regen-theory-button", "regen-map-button", "regen-practice-button", "regen-exercises-button"].map((t) => byTest(t)!.textContent!.trim())).toEqual(["Regenerar teoría", "Regenerar mapa", "Regenerar práctica", "Regenerar ejercicios"]);
    expect(start).not.toHaveBeenCalled();
    await click("row-expand");
    expect(byTest("regen-panel")).toBeNull();
  });

  it("«Expandir todo» abre el panel de todos los temas de la tabla", async () => {
    ai(false);
    await mount(PLAN);
    await click("expand-all");
    expect(host.querySelectorAll("[data-testid=regen-panel]").length).toBe(1);
    expect(byTest("expand-all")!.textContent).toBe("Contraer todo");
  });

  it("pide confirmación diciendo que se reemplaza con copia de seguridad; cancelar no hace nada y confirmar lanza el trabajo", async () => {
    ai(false);
    const start = vi.spyOn(api, "studyTopicRegenerate").mockResolvedValue({ jobId: "j1" });
    const status = vi.spyOn(api, "studyTopicRegenerateStatus").mockResolvedValue(job() as never);
    await mount(PLAN);
    await click("row-expand");
    await flush();
    await click("regen-theory-button");
    const text = byTest("regen-dialog")!.textContent!;
    expect(text).toContain("REEMPLAZAR");
    expect(text).toContain("copia de seguridad");
    expect(text).toContain(".nuevo.canvas");
    await click("regen-cancel");
    expect(byTest("regen-dialog")).toBeNull();
    expect(start).not.toHaveBeenCalled();
    await click("regen-exercises-button");
    expect(byTest("regen-dialog")!.textContent).toContain("ARCHIVAR");
    expect(byTest("regen-dialog")!.textContent).toContain("historial de intentos");
    await click("regen-cancel");
    await click("regen-practice-button");
    await click("regen-confirm");
    await flush(); await flush();
    expect(start).toHaveBeenCalledWith("P/4/4.2 REST", "practice", true, "app");
    expect(status).toHaveBeenCalledWith("j1");
  });

  it("con la IA en modo puente las acciones siguen activas (queda el agente externo); en un tema fuera del plan están desactivadas con su explicación", async () => {
    ai(true);
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE_ENGINES as never);
    await mount(PLAN);
    await click("row-expand");
    await flush();
    for (const w of ["theory", "map", "practice", "exercises"]) {
      expect((byTest(`regen-${w}-button`) as HTMLButtonElement).disabled).toBe(false);
      expect(byTest(`regen-${w}-hint`)).toBeNull();
    }
    // tema fuera del plan
    const skipped = { ...PLAN, subplans: [sub("s1", "Backend", [topic("P/4/4.2 REST", 2, { route: "skipped" })])] } as unknown as MentorPlan;
    await mount(skipped);
    await flush();
    expect((byTest("regen-theory-button") as HTMLButtonElement | null)?.disabled ?? true).toBe(true);
  });

  it("sin práctica no se pueden regenerar los ejercicios (de ahí salen las competencias)", async () => {
    ai(false);
    vi.mocked(api.mentorPlanTopicCatalog).mockResolvedValue({ loading: false, rows: [row("P/4/4.2 REST", { manifest: false, exercises: 0, complete: false })] });
    await mount(PLAN);
    await click("row-expand");
    await flush();
    expect((byTest("regen-exercises-button") as HTMLButtonElement).disabled).toBe(true);
    expect(byTest("regen-exercises-hint")!.textContent).toContain("práctica");
    expect((byTest("regen-theory-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Ir a la planeación despliega 3 sub-opciones en hover/click", async () => {
    await mount(PLAN);
    await click("area-open");
    const planTrigger = document.querySelector<HTMLElement>("[data-testid=board-go-planning]")!;
    expect(planTrigger).toBeTruthy();
    await act(async () => {
      planTrigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await flush();
    const subOpts = [...document.querySelectorAll("[data-testid=board-menu-sub] [role=menuitem]")].map((b) => b.textContent?.trim());
    expect(subOpts).toEqual([
      "Ir al tema en específico",
      "Ir a la vista general",
      "Ir al calendario de planeación",
    ]);
  });

  it("resalta el tema en amarillo si viene de navegación y lo desactiva al pasar el mouse por encima", async () => {
    useNavState.getState().set(TOPIC_HIGHLIGHT_KEY, "P/4/4.2 REST");
    await mount(PLAN);
    const rowEl = host.querySelector<HTMLElement>("[data-testid=area-row]")!;
    expect(rowEl.className).toContain("bg-amber-300/35");

    await act(async () => {
      rowEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await flush();
    expect(rowEl.className).not.toContain("bg-amber-300/35");
  });
});

