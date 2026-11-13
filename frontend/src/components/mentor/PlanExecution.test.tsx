// @vitest-environment jsdom
//
// Mentor — «Ejecutar plan»: «Analizar el plan» deja un informe agrupado con coste y orden por semanas; el diálogo de confirmación (alcance, qué se
// crea, que NO se sobrescribe nada); con la IA sin configurar «Ejecutar» queda desactivado con su explicación; el progreso de la ejecución con
// pausar / reanudar / cancelar; y «Mantener y ejecutar» en el banner del plan propuesto.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import { areaFiles } from "../../lib/areaPracticeSystem";
import { buildExecutionReport, newReportDefaults, progressOf, type ExecutionScope, type ExecutionState, type TaskState } from "../../lib/executionFixtures";
import type { MentorExecutionView, MentorPlan as PlanData, MentorPlanGet, MentorPlanRow } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { ExecutionPanel, ReportList, useExecution } from "./PlanExecution";
import { ModuleVisible } from "../ModuleHost";
import type { CoverageState } from "./PlanCoverage";

const ui = vi.hoisted(() => ({ askText: vi.fn(), confirmAction: vi.fn() }));
vi.mock("../ui", async (orig) => ({ ...(await orig<typeof import("../ui")>()), askText: ui.askText, confirmAction: ui.confirmAction }));

import { PlanWorkspace } from "./PlanWorkspace";

const START = "2026-10-06";
const END = "2027-04-05";
const PID = `${START}_${END}`;
const F = (n: string) => `Programación/4 Backend/${n}`;

const plan = (over: Partial<PlanData> = {}): PlanData =>
  ({
    id: PID, start: START, end: END, name: "Plan", createdAt: START, updatedAt: START, structure: "areas",
    preconditions: { start: START, end: END, minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5], pace: "normal", goalIds: [], subjects: ["Programación"], levels: {}, deliverables: "no" },
    subplans: [{ id: "s1", area: "Backend", areaId: "backend", objective: "Backend", topics: [{ folder: F("4.1 A"), title: "4.1 A", targetWeek: 1, estMinutes: 60 }], weeks: [], requiredGoals: [] }],
    ...over,
  }) as never;

const report = (scope: Partial<ExecutionScope> = {}) => buildExecutionReport(newReportDefaults(), scope);
const view = (state: Partial<ExecutionState> = {}, tasks?: TaskState[]): MentorExecutionView => {
  const rep = report();
  const st: ExecutionState = {
    version: 1, planId: PID, id: "run-1", status: "running", scope: rep.scope, createdAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:01:00.000Z", log: ["10:00:01 empieza"],
    tasks: tasks ?? rep.tasks.map((t) => ({ ...t, status: "pending" as const, attempts: 0, created: [], skippedFiles: [], warnings: [] })),
    ...state,
  };
  return { state: st, progress: progressOf(st) };
};

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const mountEl = async (el: React.ReactNode) => { await act(async () => { root.render(el); }); await flush(); await flush(); await flush(); };
const click = async (el: Element | null | undefined) => {
  expect(el, "elemento no encontrado").toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
  await flush();
  await flush();
};
const button = (label: string | RegExp, within: ParentNode = host) =>
  [...within.querySelectorAll("button")].find((b) => (typeof label === "string" ? b.textContent?.includes(label) || b.getAttribute("aria-label")?.includes(label) : label.test(b.textContent ?? "")))!;
const cov = (over: Partial<CoverageState> = {}): CoverageState => ({ coverage: null, review: null, aiConfigured: true, loading: false, error: "", reload: vi.fn(), setReview: vi.fn(), ...over });
const mountPanel = (c: CoverageState = cov()) => mountEl(<ExecutionPanel plan={plan()} cov={c} onPlan={vi.fn()} announce={vi.fn()} />);

beforeEach(() => {
  localStorage.clear();
  ui.confirmAction.mockReset();
  ui.confirmAction.mockResolvedValue(true);
  useNavState.setState({ values: {} });
  useMentor.setState({ planVersion: 0, plans: [], plansLoaded: false });
  useApp.setState({ module: "mentor" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: null, active: false });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("consultas de ejecución en segundo plano", () => {
  it("deja de consultar al ocultar el Mentor y actualiza al volver", async () => {
    const status = vi.mocked(api.mentorExecutionStatus);
    status.mockResolvedValue({ execution: view(), active: true });
    function Probe() { useExecution(PID); return null; }
    vi.useFakeTimers();
    try {
      await mountEl(<ModuleVisible.Provider value={true}><Probe /></ModuleVisible.Provider>);
      expect(status).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(status).toHaveBeenCalledTimes(2);
      await act(async () => { root.render(<ModuleVisible.Provider value={false}><Probe /></ModuleVisible.Provider>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(status).toHaveBeenCalledTimes(2);
      await act(async () => { root.render(<ModuleVisible.Provider value={true}><Probe /></ModuleVisible.Provider>); });
      expect(status).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});

describe("Informe de generación", () => {
  it("alterna áreas sin leer un evento liberado durante la actualización", async () => {
    await mountEl(<ReportList report={report()} />);
    const area = host.querySelector<HTMLDetailsElement>("[data-testid=exec-area]")!;
    expect(area.open).toBe(true);
    await act(async () => { area.open = false; area.dispatchEvent(new Event("toggle")); });
    expect(area.open).toBe(false);
    await act(async () => { area.open = true; area.dispatchEvent(new Event("toggle")); });
    expect(area.open).toBe(true);
  });
});

describe("«Analizar el plan»", () => {
  it("corre la revisión de la IA sobre el checklist y deja el informe agrupado, con coste y orden", async () => {
    const review = vi.spyOn(api, "mentorPlanCoverageReview").mockResolvedValue({ loading: false, source: "ai", review: { at: "2026-10-09T10:00:00.000Z", source: "ai", summary: "x", areas: [], discarded: 0 }, plan: plan(), coverage: {} as never });
    const rep = vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: report(), execution: null, aiConfigured: true });
    const c = cov();
    await mountEl(<ExecutionPanel plan={plan()} cov={c} onPlan={vi.fn()} announce={vi.fn()} />);
    expect(host.querySelector("[data-testid=exec-report]")).toBeNull();
    await click(host.querySelector("[data-testid=exec-analyze]"));
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]![0]).toBe(PID);
    expect(rep).toHaveBeenCalled();
    expect(c.setReview).toHaveBeenCalled();
    const totals = host.querySelector("[data-testid=exec-totals]")!.textContent!;
    expect(totals).toContain("Tareas");
    expect(totals).toMatch(/Llamadas a la IA\s*≈ \d+/);
    expect(totals).toMatch(/Tiempo\s*(≈ \d+ min|menos de 1 min|≈ [\d,]+ h)/);
    const areaEl = host.querySelector("[data-testid=exec-area]")!;
    expect(areaEl.querySelector("summary")!.textContent).toContain("Backend");
    expect(areaEl.hasAttribute("open")).toBe(true);
    const topics = [...areaEl.querySelectorAll("[data-testid=exec-topic]")].map((t) => t.querySelector("h5")!.textContent);
    expect(topics[0]).toContain("4.2 SinCanvas");
    expect(topics[0]).toContain("diseño");
    expect(areaEl.textContent).toContain("Canvas de «SinCanvas»");
    expect(areaEl.textContent).toContain("sem. 1");
    expect(areaEl.textContent).toContain("sin IA"); // el canvas no cuesta IA
    expect(host.querySelector("[data-testid=exec-manual]")!.textContent).toContain("Para revisar a mano (1)");
    expect(host.querySelector("[data-testid=exec-note]")!.textContent).toContain("Informe listo");
    expect(host.querySelector<HTMLButtonElement>("[data-testid=exec-open-dialog]")!.disabled).toBe(false);
  });

  it("sin IA configurada: el análisis determinista funciona y «Ejecutar» queda desactivado con su explicación", async () => {
    const review = vi.spyOn(api, "mentorPlanCoverageReview");
    vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: report(), execution: null, aiConfigured: false });
    await mountPanel(cov({ aiConfigured: false }));
    expect(host.querySelector("[data-testid=exec-disabled-why]")!.textContent).toContain("la IA no está configurada");
    await click(host.querySelector("[data-testid=exec-analyze]"));
    expect(review).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid=exec-note]")!.textContent).toContain("La IA no está configurada");
    expect(host.querySelector("[data-testid=exec-totals]")).toBeTruthy();
    expect(host.querySelector<HTMLButtonElement>("[data-testid=exec-open-dialog]")!.disabled).toBe(true);
  });

  it("con todo hecho dice que no falta nada", async () => {
    vi.spyOn(api, "mentorPlanCoverageReview").mockResolvedValue({ loading: true });
    vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: buildExecutionReport(newReportDefaults({ designsOf: "complete" }), { includeAreaPractice: false }), execution: null, aiConfigured: true });
    await mountPanel(cov({ aiConfigured: false }));
    await click(host.querySelector("[data-testid=exec-analyze]"));
    expect(host.querySelector("[data-testid=exec-nothing]")!.textContent).toContain("No falta nada");
    expect(host.querySelector<HTMLButtonElement>("[data-testid=exec-open-dialog]")!.disabled).toBe(true);
  });
});

describe("diálogo de confirmación", () => {
  const open = async (aiConfigured = true) => {
    const rep = vi.spyOn(api, "mentorExecutionReport").mockImplementation(async (_id, scope) => ({ loading: false, report: report(scope ?? {}), execution: null, aiConfigured }));
    vi.spyOn(api, "mentorPlanCoverageReview").mockResolvedValue({ loading: false, source: "none", reason: "Sin IA por petición tuya.", coverage: {} as never });
    await mountPanel(cov({ aiConfigured }));
    await click(host.querySelector("[data-testid=exec-analyze]"));
    await click(host.querySelector("[data-testid=exec-open-dialog]"));
    return rep;
  };

  it("muestra qué se crea, el coste y que NO se borra ni se sobrescribe nada; confirmar empieza la ejecución con el alcance", async () => {
    await open();
    const start = vi.spyOn(api, "mentorExecutionStart").mockImplementation(async () => {
      vi.mocked(api.mentorExecutionStatus).mockResolvedValue({ execution: view(), active: true });
      return { loading: false, execution: view() };
    });
    const dlg = document.querySelector("[role=dialog]")!;
    expect(dlg.getAttribute("aria-label")).toBe("Ejecutar plan");
    expect(dlg.querySelector("[data-testid=exec-counts]")!.textContent).toContain("Canvas del tema: 1");
    expect(dlg.querySelector("[data-testid=exec-totals]")!.textContent).toContain("Llamadas a la IA");
    const safety = dlg.querySelector("[data-testid=exec-safety]")!.textContent!;
    expect(safety).toContain("No borra ni sobrescribe nada");
    expect(safety).toContain("pausar, reanudar y cancelar");
    expect(dlg.textContent).toContain("todo el plan");
    expect(dlg.querySelector("[data-testid=exec-no-ai]")).toBeNull();
    await click(dlg.querySelector("[data-testid=exec-confirm]"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toBe(PID);
    expect(start.mock.calls[0]![1]).toMatchObject({ mode: "all", includeAreaPractice: true, includeRecommended: false });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    // el progreso aparece en el panel
    expect(host.querySelector("[data-testid=exec-progress]")).toBeTruthy();
  });

  it("el alcance «solo algunas semanas» y «solo un área» recalcula el informe con ese alcance", async () => {
    const rep = await open();
    const dlg = () => document.querySelector("[role=dialog]")!;
    const radio = (label: string) => [...dlg().querySelectorAll("label")].find((l) => l.textContent?.includes(label))!.querySelector("input")!;
    await click(radio("Solo algunas semanas"));
    expect(rep).toHaveBeenLastCalledWith(PID, expect.objectContaining({ mode: "weeks", fromWeek: 1, toWeek: 4 }));
    expect(dlg().textContent).toContain("solo las semanas 1–4");
    await click(radio("Solo un área"));
    expect(rep).toHaveBeenLastCalledWith(PID, expect.objectContaining({ mode: "area", areaKey: "backend" }));
    expect(dlg().textContent).toContain("solo el área Backend");
  });

  it("ofrece el prompt externo para completar ejercicios sin IA interna", async () => {
    const folder = F("4.1 A");
    const base = report();
    const task = { ...base.tasks[0]!, kind: "practice" as const, folder };
    const single = { ...base, tasks: [task], totals: { ...base.totals, tasks: 1 } };
    vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: single, execution: null, aiConfigured: false });
    const handoff = { id: "external-1", what: "exercises", missingOnly: true, status: "waiting", prompt: "Prompt de prueba", topics: [{ title: "Tema", state: "pending", problems: [], created: [], done: [] }], ready: { found: 0, expected: 1 }, log: [] } as never;
    const create = vi.spyOn(api, "studyTopicRegenerateHandoff").mockResolvedValue(handoff);
    const { ExecuteDialog } = await import("./PlanExecution");
    await mountEl(<ExecuteDialog planId={PID} proposed={false} initialScope={{ mode: "topic", folder, includeRecommended: true, includeAreaPractice: false, includeNewTopics: false, includeKatasAi: false }} onClose={vi.fn()} onStarted={vi.fn()} />);
    await click(document.querySelector("[data-testid=exec-external]"));
    expect(create).toHaveBeenCalledWith(folder, "exercises", true, { missingOnly: true, includeRecommended: true });
    expect(document.querySelector("[data-testid=handoff-regen-prompt]")?.textContent).toBe("Prompt de prueba");
  });

  it("sin IA: el botón del diálogo está desactivado y lo explica", async () => {
    await open(false);
    // sin IA el panel ya desactiva «Ejecutar plan…»: se abre el diálogo por la señal
    expect(document.querySelector("[role=dialog]")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    vi.spyOn(api, "mentorExecutionReport").mockResolvedValue({ loading: false, report: report(), execution: null, aiConfigured: false });
    const { ExecuteDialog } = await import("./PlanExecution");
    await mountEl(<ExecuteDialog planId={PID} proposed={false} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect(document.querySelector("[data-testid=exec-no-ai]")!.textContent).toContain("está desactivado");
    expect(document.querySelector<HTMLButtonElement>("[data-testid=exec-confirm]")!.disabled).toBe(true);
  });
});

describe("progreso de la ejecución", () => {
  const withTasks = (statuses: TaskState["status"][], over: Partial<ExecutionState> = {}) => {
    const rep = report();
    const tasks = rep.tasks.slice(0, statuses.length).map((t, i) => ({ ...t, status: statuses[i]!, attempts: statuses[i] === "pending" ? 0 : 1, created: statuses[i] === "done" ? [`${t.folder ?? "x"}/nuevo.md`] : [], skippedFiles: [], warnings: [] }));
    return view({ ...over }, tasks);
  };

  it("muestra «n/total · Área · Tema», la barra y los botones según el estado: pausar y cancelar mientras corre", async () => {
    const status = vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: withTasks(["done", "done", "running", "pending", "pending"]), active: true });
    const paused = withTasks(["done", "done", "pending", "pending", "pending"], { status: "paused" });
    const pause = vi.spyOn(api, "mentorExecutionPause").mockImplementation(async () => {
      status.mockResolvedValue({ execution: paused, active: false });
      return { execution: paused };
    });
    await mountPanel();
    const p = host.querySelector("[data-testid=exec-progress]")!;
    expect(p.querySelector("[data-testid=exec-label]")!.textContent).toMatch(/^3\/5 · Backend · /);
    expect(p.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("40");
    expect(p.textContent).toContain("Ejecutando");
    expect(p.textContent).toContain("2 hechas");
    expect(p.querySelector("[data-testid=exec-resume]")).toBeNull();
    await click(p.querySelector("[data-testid=exec-pause]"));
    expect(pause).toHaveBeenCalledWith(PID);
    expect(host.querySelector("[data-testid=exec-progress]")!.textContent).toContain("En pausa");
    expect(host.querySelector("[data-testid=exec-resume]")).toBeTruthy();
    expect(host.querySelector("[data-testid=exec-pause]")).toBeNull();
  });

  it("reanudar y cancelar (con confirmación) llaman a la API", async () => {
    const status = vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: withTasks(["done", "pending", "pending"], { status: "paused" }), active: false });
    const resume = vi.spyOn(api, "mentorExecutionResume").mockImplementation(async () => {
      const v = withTasks(["done", "running", "pending"]);
      status.mockResolvedValue({ execution: v, active: true });
      return { execution: v };
    });
    const cancel = vi.spyOn(api, "mentorExecutionCancel").mockImplementation(async () => {
      const v = withTasks(["done", "cancelled", "cancelled"], { status: "cancelled" });
      status.mockResolvedValue({ execution: v, active: false });
      return { execution: v };
    });
    await mountPanel();
    await click(host.querySelector("[data-testid=exec-resume]"));
    expect(resume).toHaveBeenCalledWith(PID);
    await click(host.querySelector("[data-testid=exec-cancel]"));
    expect(ui.confirmAction).toHaveBeenCalledWith("Cancelar la ejecución", expect.stringContaining("Lo ya creado se queda"), expect.any(String), true);
    expect(cancel).toHaveBeenCalledWith(PID);
    expect(host.querySelector("[data-testid=exec-progress]")!.textContent).toContain("Cancelada");
    ui.confirmAction.mockResolvedValue(false);
  });

  it("al terminar lista los archivos creados con sus rutas (abren la nota) y los errores y avisos de cada tarea", async () => {
    const v = withTasks(["done", "failed", "done"], { status: "failed" });
    v.state.tasks[1]!.error = "La validación falló: no se creó el canvas";
    v.state.tasks[2]!.warnings = ["La nota no cumple el contrato: falta la sección Cards"];
    vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: v, active: false });
    const open = vi.fn().mockResolvedValue(undefined);
    useApp.setState({ openNote: open });
    await mountPanel();
    const p = host.querySelector("[data-testid=exec-progress]")!;
    expect(p.textContent).toContain("Con errores");
    expect(p.textContent).toContain("Reintentar lo que falló");
    expect(p.textContent).toContain("La validación falló: no se creó el canvas");
    expect(p.textContent).toContain("Aviso: La nota no cumple el contrato");
    const row = [...p.querySelectorAll("[data-testid=exec-task]")][0]!;
    await click(button("1 archivo creado", row));
    await click(row.querySelector("ul[aria-label='Archivos creados por esta tarea'] button"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/nuevo\.md$/));
  });
});

describe("«Mantener y ejecutar» en el plan propuesto", () => {
  const row = (): MentorPlanRow => ({ id: PID, start: START, end: END, name: "Plan", period: "6 oct – 5 abr", status: "propuesto", archived: false, auto: false, subplans: 1, topics: 1, completed: 0, pct: 0, minutesPerDay: 240 });
  const loaded = (): MentorPlanGet => ({
    loading: false, id: PID, month: "2026-10", today: "2026-10-12", status: "propuesto", plan: plan({ proposed: true }),
    derived: { subplans: [{ id: "s1", total: 1, done: 0, pct: 0, currentWeek: 1, topics: [] }], summary: { subplans: 1, topics: 1, done: 0, pct: 0, currentWeek: 1, weeks: 26 } },
    goals: {}, projects: {}, items: [], months: [], plans: [row()], aiConfigured: true,
  });
  beforeEach(() => {
    vi.spyOn(api, "mentorPlanChanges").mockResolvedValue([]);
    vi.spyOn(api, "mentorPlanList").mockResolvedValue([row()]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue({ loading: false, coverage: { areas: [], totals: { topics: 0, theory: 0, practice: 0, outOfPlan: 0 }, ppReady: true }, review: null, aiConfigured: true });
  });

  it("junto a «Mantener plan» hay «Mantener y ejecutar»: abre el informe con confirmación y, al confirmar, mantiene y ejecuta", async () => {
    vi.spyOn(api, "mentorExecutionReport").mockImplementation(async (_id, scope) => ({ loading: false, report: report(scope ?? {}), execution: null, aiConfigured: true }));
    const keep = vi.spyOn(api, "mentorPlanKeep").mockResolvedValue({} as never);
    const start = vi.spyOn(api, "mentorExecutionStart").mockResolvedValue({ loading: false, execution: view() });
    await mountEl(<PlanWorkspace planId={PID} />);
    const bar = host.querySelector("[data-testid=plan-proposed-bar]")!;
    expect(button("Mantener plan", bar)).toBeTruthy();
    const both = host.querySelector("[data-testid=plan-keep-execute]")!;
    expect(both.textContent).toContain("Mantener y ejecutar");
    await click(both);
    const dlg = document.querySelector("[role=dialog]")!;
    expect(dlg.getAttribute("aria-label")).toBe("Mantener y ejecutar");
    expect(dlg.textContent).toContain("Se mantiene el plan");
    expect(dlg.textContent).toContain("No borra ni sobrescribe nada");
    // «Mantener plan» sigue siendo solo mantener: no ejecuta nada
    expect(start).not.toHaveBeenCalled();
    await click(dlg.querySelector("[data-testid=exec-confirm]"));
    expect(keep).toHaveBeenCalledWith(PID);
    expect(start).toHaveBeenCalledTimes(1);
    expect(keep.mock.invocationCallOrder[0]!).toBeLessThan(start.mock.invocationCallOrder[0]!);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("cancelar el diálogo no mantiene ni ejecuta nada", async () => {
    vi.spyOn(api, "mentorExecutionReport").mockImplementation(async (_id, scope) => ({ loading: false, report: report(scope ?? {}), execution: null, aiConfigured: true }));
    const keep = vi.spyOn(api, "mentorPlanKeep").mockResolvedValue({} as never);
    const start = vi.spyOn(api, "mentorExecutionStart");
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(host.querySelector("[data-testid=plan-keep-execute]"));
    await click(button("Cancelar", document.querySelector("[role=dialog]")!));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(keep).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});

void areaFiles;
