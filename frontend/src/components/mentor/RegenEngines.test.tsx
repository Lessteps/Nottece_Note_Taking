// @vitest-environment jsdom
//
// «Regenerar» con elección de motor: el selector (radio) de los diálogos de un tema y de lote, lo que se activa según el modo de la IA, la elección
// recordada, y la tarea para un agente externo (frase para copiar, validar, restaurar con confirmación).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import * as clipboard from "../../lib/clipboard";
import type { PlanTopicRow } from "../../lib/planTopicCatalog";
import type { MentorPlan, RegenEnginesView, RegenHandoff } from "../../lib/types";
import { useRegenEngine } from "../../store/regenEngine";

vi.mock("./openTopic", () => ({ openTopic: vi.fn(), openTopicNote: vi.fn(), openTopicCanvas: vi.fn() }));
import { PlanAreaTopics } from "./PlanAreaTopics";

const F = (n: string) => `P/4/${n}`;
const topic = (n: string, week: number) => ({ folder: F(n), title: n, targetWeek: week, estMinutes: 30 });
const PLAN = { id: "p1", subplans: [{ id: "s1", area: "Backend", objective: "", topics: [topic("A", 1), topic("B", 2)], weeks: [], requiredGoals: [] }] } as unknown as MentorPlan;
const row = (n: string): PlanTopicRow => ({ folder: F(n), title: n, branch: "Backend", inPlan: true, exists: true, topicType: "unknown", theory: true, contract: true, canvas: true, manifest: true, skills: 3, exercises: 5, score: 100, complete: true, gaps: 0 });
const ROWS = [row("A"), row("B")];

const engines = (over: Partial<RegenEnginesView> & { app?: boolean; claude?: boolean } = {}): RegenEnginesView => {
  const { app = true, claude = false, ...rest } = over;
  return {
    mode: "api", provider: "deepseek", providerLabel: "DeepSeek (API key)", model: "deepseek-flash", hasKey: true, isClaude: false, recommended: app ? "app" : "handoff",
    engines: [
      { id: "app", label: "Con la app", available: app, reason: app ? "" : "La IA de la app está en modo puente (sin API): no puede regenerar sola.", detail: "La app llama a su proveedor de IA (DeepSeek (API key) · deepseek-flash)." },
      { id: "claude", label: "Con Claude (API key)", available: claude, reason: claude ? "" : "El proveedor de IA configurado no es Claude. En los ajustes de IA elige «Claude (API key)».", detail: "Exige que el proveedor sea Claude." },
      { id: "handoff", label: "Con Antigravity / Claude Code", available: true, reason: "", detail: "La app NO llama a ninguna IA: escribe un archivo de tarea." },
    ],
    ...rest,
  };
};
const BRIDGE = engines({ app: false, mode: "bridge", provider: "bridge_claude", providerLabel: "Claude web (sin API)", model: "" });

const handoff = (over: Partial<RegenHandoff> = {}): RegenHandoff => ({
  id: "h1", what: "theory", createdAt: "2026-10-23T10:20:30.000Z", task: "P/_handoff/regenerar/h1.md", taskAbs: "C:/v/P/_handoff/regenerar/h1.md", resultDir: "P/_handoff/regenerar/h1.resultado", folder: "P/_handoff/regenerar",
  prompt: "Read `C:/v/P/_handoff/regenerar/h1.md` and execute it.", status: "waiting", log: [], ready: { found: 0, expected: 2 },
  topics: [{ folder: F("A"), title: "A", backup: ".trash/regenerar/x_A", state: "pending", done: [], problems: [], created: [], restored: false }], ...over,
});

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const byTest = (id: string) => host.querySelector<HTMLElement>(`[data-testid=${id}]`);
const input = (id: string) => byTest(id) as HTMLInputElement;
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
const mount = async () => { await act(async () => { root.render(<PlanAreaTopics plan={PLAN} />); }); await flush(); await flush(); };
const job = (folder: string) => ({ id: `j-${folder}`, folder, what: "theory", log: ["✓ hecho"], done: true, error: "", finished: 3, total: 3, backup: ".trash/regenerar/x", restored: false, created: [], archived: [] });

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* sin almacenamiento */ }
  useRegenEngine.setState({ choice: null, effective: "app", handoffs: {} });
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

describe("selector de motor — estados", () => {
  it("con un proveedor con clave: «Con la app» marcado, Claude desactivado con su motivo y el agente externo disponible", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(engines());
    await mount();
    await check("A");
    await regen("theory");
    expect(byTest("engine-choice")).toBeTruthy();
    expect(input("engine-app").checked).toBe(true);
    expect(input("engine-app").disabled).toBe(false);
    expect(input("engine-claude").disabled).toBe(true);
    expect(byTest("engine-claude-reason")!.textContent).toContain("no es Claude");
    expect(input("engine-handoff").disabled).toBe(false);
    expect(byTest("engine-cost")!.textContent).toContain("DeepSeek");
    expect(byTest("engine-cost")!.textContent).toContain("Llamadas a la IA aproximadas");
    expect(byTest("engine-settings")).toBeTruthy(); // enlace a los ajustes de IA
    expect(byTest("bulk-confirm-run")!.textContent).toContain("Regenerar teoría");
  });

  it("con la IA en modo puente: solo el agente externo, ya marcado, y el botón dice «Crear tarea»", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    await mount();
    await check("A");
    await regen("theory");
    expect(input("engine-app").disabled).toBe(true);
    expect(input("engine-claude").disabled).toBe(true);
    expect(input("engine-handoff").checked).toBe(true);
    expect(byTest("engine-app-reason")!.textContent).toContain("modo puente");
    expect(byTest("bulk-confirm-run")!.textContent).toContain("Crear tarea para el agente");
    expect(byTest("engine-cost")!.textContent).toContain("La app no llama a la IA");
  });

  it("el mapa no usa IA: el diálogo no pide motor", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    await mount();
    await check("A");
    await regen("map");
    expect(byTest("engine-choice")).toBeNull();
    expect(byTest("bulk-confirm-calls")!.textContent).toContain("No usa la IA");
  });

  it("la elección se recuerda para la próxima vez; si ya no está disponible se cae al recomendado", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(engines({ claude: true }));
    await mount();
    await check("A");
    await regen("theory");
    await clickEl(input("engine-claude"));
    expect(window.localStorage.getItem("nv.regen.engine")).toBe("claude");
    await click("bulk-confirm-cancel");
    await regen("theory");
    expect(input("engine-claude").checked).toBe(true);
    // hoy Claude ya no está: se cae a «app» sin perder el valor guardado
    await click("bulk-confirm-cancel");
    vi.mocked(api.studyRegenEngines).mockResolvedValue(engines({ claude: false }));
    await regen("theory");
    expect(input("engine-app").checked).toBe(true);
    expect(input("engine-claude").checked).toBe(false);
  });
});

describe("motor Claude y motor de la app", () => {
  it("con «Con Claude» el trabajo se lanza con ese motor", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(engines({ claude: true }));
    const start = vi.spyOn(api, "studyTopicRegenerate").mockResolvedValue({ jobId: "j" });
    vi.spyOn(api, "studyTopicRegenerateStatus").mockImplementation(async () => job(F("A")) as never);
    await mount();
    await check("A");
    await regen("theory");
    await clickEl(input("engine-claude"));
    await click("bulk-confirm-run");
    await flush(); await flush(); await flush();
    expect(start).toHaveBeenCalledWith(F("A"), "theory", true, "claude");
  });
});

describe("agente externo — un tema", () => {
  const expandTheory = async () => {
    await clickEl(rowEl("A").querySelector<HTMLElement>("[data-testid=row-expand]")!);
    await flush();
    await click("regen-theory-button");
    await flush();
  };

  it("crea la tarea (sin llamar a la IA), enseña la frase para copiar y la carpeta, y cuenta lo que el agente ya escribió", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    const run = vi.spyOn(api, "studyTopicRegenerate");
    const create = vi.spyOn(api, "studyTopicRegenerateHandoff").mockResolvedValue(handoff());
    const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue(true);
    const reveal = vi.spyOn(api, "revealPath").mockResolvedValue({ ok: true, folder: false });
    await mount();
    await expandTheory();
    expect(byTest("regen-dialog")).toBeTruthy();
    expect(input("engine-handoff").checked).toBe(true);
    await click("regen-confirm");
    await flush();
    expect(create).toHaveBeenCalledWith(F("A"), "theory", true);
    expect(run).not.toHaveBeenCalled();
    expect(byTest("handoff-regen-panel")).toBeTruthy();
    expect(byTest("handoff-regen-prompt")!.textContent).toContain("execute it");
    expect(byTest("handoff-regen-ready")!.textContent).toContain("0 de 2");
    await click("handoff-regen-copy");
    expect(copy).toHaveBeenCalledWith(handoff().prompt);
    await click("handoff-regen-open");
    expect(reveal).toHaveBeenCalledWith("P/_handoff/regenerar/h1.md");
  });

  it("validar con éxito marca el tema y quita el botón; si falla enseña los motivos y permite restaurar CON confirmación", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    const copied = vi.spyOn(clipboard, "copyText").mockResolvedValue(true);
    vi.spyOn(api, "studyTopicRegenerateHandoff").mockResolvedValue(handoff());
    const bad = handoff({ status: "failed", topics: [{ ...handoff().topics[0]!, state: "error", problems: ["Estructura: falta la sección Explicación"] }] });
    const restored = handoff({ status: "restored", topics: [{ ...handoff().topics[0]!, state: "restored", restored: true }] });
    const validate = vi.spyOn(api, "studyTopicRegenerateValidate").mockResolvedValueOnce(bad).mockResolvedValueOnce(restored);
    await mount();
    await expandTheory();
    await click("regen-confirm");
    await click("handoff-regen-validate");
    expect(validate).toHaveBeenLastCalledWith("h1", false);
    expect(byTest("handoff-regen-topics")!.textContent).toContain("no pasó la validación");
    expect(byTest("handoff-regen-topics")!.textContent).toContain("falta la sección Explicación");
    await click("handoff-regen-copy-errors");
    expect(copied).toHaveBeenCalledWith(expect.stringContaining("Estructura: falta la sección Explicación"));
    expect(byTest("handoff-regen-validate")).toBeTruthy(); // se puede corregir y validar otra vez
    // restaurar pide confirmación
    await click("handoff-regen-restore");
    expect(validate).toHaveBeenCalledTimes(1);
    await click("handoff-regen-restore-cancel");
    expect(validate).toHaveBeenCalledTimes(1);
    await click("handoff-regen-restore");
    await click("handoff-regen-restore-confirm");
    expect(validate).toHaveBeenLastCalledWith("h1", true);
    expect(byTest("handoff-regen-panel")!.getAttribute("data-status")).toBe("restored");
    expect(byTest("handoff-regen-validate")).toBeNull();
  });

  it("una validación buena deja el panel en «validado»", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    vi.spyOn(api, "studyTopicRegenerateHandoff").mockResolvedValue(handoff());
    vi.spyOn(api, "studyTopicRegenerateValidate").mockResolvedValue(handoff({ status: "validated", topics: [{ ...handoff().topics[0]!, state: "ok", done: ["theory"] }] }));
    await mount();
    await expandTheory();
    await click("regen-confirm");
    await click("handoff-regen-validate");
    expect(byTest("handoff-regen-panel")!.getAttribute("data-status")).toBe("validated");
    expect(byTest("handoff-regen-topics")!.textContent).toContain("validado");
    expect(byTest("handoff-regen-restore")).toBeNull();
  });
});

describe("agente externo — lote", () => {
  it("UNA sola tarea con todos los temas elegidos y el panel en la zona de progreso", async () => {
    vi.spyOn(api, "studyRegenEngines").mockResolvedValue(BRIDGE);
    const run = vi.spyOn(api, "studyTopicRegenerate");
    const create = vi.spyOn(api, "studyTopicRegenerateHandoff").mockResolvedValue(handoff({
      topics: [F("A"), F("B")].map((f) => ({ folder: f, title: f.slice(-1), backup: ".trash/regenerar/x", state: "pending" as const, done: [], problems: [], created: [], restored: false })),
    }));
    await mount();
    await check("A");
    await check("B");
    await regen("theory");
    expect(byTest("bulk-confirm-lead")!.textContent).toContain("2 temas");
    await click("bulk-confirm-run");
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith([F("A"), F("B")], "theory", true);
    expect(run).not.toHaveBeenCalled();
    expect(byTest("bulk-progress")).toBeNull();
    expect(byTest("handoff-regen-panel")!.textContent).toContain("2 temas");
    // «Ocultar» cierra el panel y la cola
    await click("handoff-regen-close");
    expect(byTest("handoff-regen-panel")).toBeNull();
  });
});
