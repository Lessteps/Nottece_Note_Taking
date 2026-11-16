// @vitest-environment jsdom
//
// Mentor — Plan: una sub-interfaz por plan (barra lateral), resumen de planes, estado vacío, cabecera con las
// precondiciones, una fila por área con una tarjeta desplegable por subplan, acciones (renombrar, archivar,
// eliminar), vista "Esta semana", borrador pendiente con acciones y la tarjeta plan_draft en el chat.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import type { MentorChatTurn, MentorPlan as PlanData, MentorPlanDraft, MentorPlanGet, MentorPlanRow } from "../../lib/types";
import { useApp } from "../../store/app";
import { useAssistant } from "../../store/assistant";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { MODE_KEY } from "./mentorNav";
import { gotoSection, navTab, navView } from "./mentorTestNav";

const ui = vi.hoisted(() => ({ askText: vi.fn(), confirmAction: vi.fn() }));
vi.mock("../ui", async (orig) => ({ ...(await orig<typeof import("../ui")>()), askText: ui.askText, confirmAction: ui.confirmAction }));

import { MentorAssistant } from "./MentorAssistant";
import { MentorModule } from "./MentorModule";
import { MentorPlan } from "./MentorPlan";
import { PlanWorkspace } from "./PlanWorkspace";

const START = "2026-10-06";
const END = "2026-11-05";
const PID = `${START}_${END}`;
const FUND = "Programación/Python/1 Fundamentos";
const APIS = "Programación/Python/2 APIs web";

const week = (n: number, topics: string[]) => ({ week: n, start: `2026-10-${String(6 + 7 * (n - 1)).padStart(2, "0")}`, end: `2026-10-${String(12 + 7 * (n - 1)).padStart(2, "0")}`, topics, minutes: 60 * topics.length, capacityMinutes: 240 });

const plan = (over: Partial<PlanData> = {}): PlanData => ({
  id: PID,
  start: START,
  end: END,
  name: "Backend · 6 oct–5 nov",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  hoursPerWeek: 14.9,
  preconditions: { start: START, end: END, minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "normal", goalIds: ["g1"], subjects: ["Programación"], levels: {}, deliverables: "yes" },
  subplans: [
    {
      id: "s1-programacion", area: "Programación", objective: "Desarrollo Backend", goalId: "g1",
      topics: [
        { folder: FUND, title: "1 Fundamentos", targetWeek: 1, estMinutes: 60, completedAt: "2026-10-08" },
        { folder: APIS, title: "2 APIs web", targetWeek: 2, estMinutes: 60 },
      ],
      weeks: [week(1, [FUND]), week(2, [APIS]), week(3, []), week(4, [])],
      requiredGoals: [{ goalId: "g1", itemId: "i1", note: "submeta diaria" }],
      deliverable: { title: "API de inventario", description: "CRUD con tests", criteria: ["CRUD completo", "tests pasan"], projectId: "p1", status: "en_curso" },
    },
    {
      id: "s2-ingles", area: "Inglés", objective: "Hablar con confianza",
      topics: [], weeks: [week(1, []), week(2, []), week(3, []), week(4, [])], requiredGoals: [],
      deliverable: { title: "Presentación en inglés", description: "", criteria: [], status: "idea" },
    },
  ],
  ...over,
});

const row = (id: string, name: string, over: Partial<MentorPlanRow> = {}): MentorPlanRow => ({
  id, start: START, end: END, name, period: "6 oct – 5 nov", status: "activo", archived: false, auto: false, subplans: 2, topics: 2, completed: 1, pct: 70, minutesPerDay: 240, ...over,
});

const rows = (): MentorPlanRow[] => [row(PID, "Backend · 6 oct–5 nov")];

const loaded = (over: Partial<Extract<MentorPlanGet, { loading: false }>> = {}): MentorPlanGet => ({
  loading: false,
  id: PID,
  month: "2026-10",
  today: "2026-10-12",
  status: "activo",
  plan: plan(),
  derived: {
    subplans: [
      {
        id: "s1-programacion", total: 2, done: 1, pct: 70, currentWeek: 2,
        topics: [
          { ...plan().subplans[0]!.topics[0]!, state: "completo", pct: 100, found: true },
          { ...plan().subplans[0]!.topics[1]!, state: "practicando", pct: 40, found: true },
        ],
      },
      { id: "s2-ingles", total: 0, done: 0, pct: 0, currentWeek: 2, topics: [] },
    ],
    summary: { subplans: 2, topics: 2, done: 1, pct: 70, currentWeek: 2, weeks: 5 },
  },
  goals: { g1: { name: "Desarrollo Backend", pct: 35, items: { i1: { name: "Practicar APIs a diario", pct: 20 } } } },
  projects: { p1: { id: "p1", name: "API de inventario", status: "En curso" } },
  items: [
    { kind: "topic", planId: PID, subplanId: "s1-programacion", label: "Programación: Desarrollo Backend", area: "Programación", title: "2 APIs web", folder: APIS, estMinutes: 60, targetWeek: 2, overdue: false },
  ],
  months: [],
  plans: rows(),
  aiConfigured: true,
  ...over,
});

const none = (): MentorPlanGet => loaded({ id: null, plan: null, derived: null, items: [], plans: [] });

const draft = (over: Partial<MentorPlanDraft> = {}): MentorPlanDraft => ({
  month: "2026-10", hoursPerWeek: 6, rationale: "Primero bases y luego APIs.", subplans: plan().subplans, warnings: ["No cabe en el periodo: harían falta unas 8 h/semana."],
  fits: false, totalMinutes: 120, availableMinutes: 100, requiredHoursPerWeek: 8, from: START, discarded: ["Programación/Django/Inventado"], why: {}, ...over,
});
const bot = (id: string, content: string, extra: Partial<MentorChatTurn> = {}): MentorChatTurn => ({ id, role: "assistant", content, at: "2026-10-05T10:00:03", ...extra });

let host: HTMLDivElement;
let root: Root;

const flush = () => act(async () => { await Promise.resolve(); });
const mountEl = async (el: React.ReactNode) => { await act(async () => { root.render(el); }); await flush(); await flush(); };
// «Mi plan» enseña una sub-vista a la vez: elige la que la prueba necesita
const section = (id: string) => gotoSection(host, id, click);
const button = (label: string | RegExp, within: ParentNode = host) =>
  [...within.querySelectorAll("button")].find((b) => (typeof label === "string" ? b.textContent?.includes(label) || b.getAttribute("aria-label")?.includes(label) : label.test(b.textContent ?? "")))!;
const click = async (el: Element | undefined) => {
  expect(el, "botón no encontrado").toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
};
const openTab = (id: string) => click(navTab(host, id));

beforeEach(() => {
  localStorage.clear();
  ui.askText.mockReset();
  ui.confirmAction.mockReset();
  useNavState.setState({ values: { [MODE_KEY]: "planeacion" } }); // las pruebas de la vista de plan abren la cara «plan»
  useMentor.setState({ panels: null, turns: [], pending: null, chatId: null, chatTitle: "Nueva conversación", chats: [], historyOpen: false, chatLoaded: false, sending: false, notice: null, creating: false, createdGoalId: null, warming: false, panelsError: "", planMode: false, composerSeed: "", acceptingPlan: false, planVersion: 0, pendingObjective: null, plans: [], plansLoaded: false, generatingPlan: false });
  useApp.setState({ module: "mentor" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorChatLoad").mockResolvedValue({ turns: [], pending: null });
  vi.spyOn(api, "mentorOverview").mockResolvedValue({ loading: true });
  vi.spyOn(api, "mentorPlanList").mockResolvedValue(rows());
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Mentor — sub-interfaz de un plan", () => {
  it("cabecera con las precondiciones, una fila por área y una tarjeta por subplan", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(host.textContent).toContain("Backend · 6 oct–5 nov");
    const header = host.querySelector("[data-testid=plan-props]")!;
    expect(header.textContent).toContain("Activo");
    await section("datos");
    const pre = host.querySelector("[data-testid=plan-preconditions]")!.textContent!;
    expect(pre).toContain("6 oct – 5 nov");
    expect(pre).toContain("4 h/día");
    const days = [...host.querySelectorAll("[data-testid=plan-days] li")].map((li) => li.textContent);
    expect(days).toEqual(["Llunes, activo", "Mmartes, activo", "Xmiércoles, activo", "Jjueves, activo", "Vviernes, activo", "Ssábado, activo", "Ddomingo, sin estudio"]);
    expect(pre).toContain("Normal");
    await section("areas");
    expect(host.querySelectorAll("section[aria-label='Programación'], section[aria-label='Inglés']")).toHaveLength(2);
    const cards = host.querySelectorAll("[data-testid=subplan-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("Desarrollo Backend");
    expect(cards[0]!.textContent).toContain("70 %");
    expect(cards[0]!.textContent).toContain("1/2 temas");
    expect(cards[0]!.textContent).toContain("Entregable: En curso");
    await section("resumen");
    expect(host.querySelector("[data-testid=plan-summary]")!.textContent).toContain("2 subplanes · 1/2 temas completados · 70 % global · semana 2 de 5");
    expect(host.querySelector("[data-testid=subplan-detail]")).toBeNull();
  });

  it("pide ese plan por su id", async () => {
    const get = vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(get).toHaveBeenCalledWith(PID);
  });

  it("al desplegar muestra semanas, temas con estado y registro, metas requeridas y entregable", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    await section("areas");
    const toggle = button("Desarrollo Backend")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(host.querySelector("[data-testid=subplan-detail]")!.id);
    const detail = host.querySelector("[data-testid=subplan-detail]")!;
    // las semanas se pintan solo al abrir su desplegable
    expect(detail.querySelectorAll("[data-testid=plan-week]")).toHaveLength(0);
    await click(button("Semanas (4)", detail));
    expect(detail.querySelectorAll("[data-testid=plan-week]")).toHaveLength(4);
    expect(detail.querySelectorAll("[data-testid=plan-week]")[1]!.className).toContain("border-accent");
    expect(detail.querySelectorAll("[data-testid=plan-week]")[0]!.textContent).toContain("6–12 oct");
    const topics = detail.querySelectorAll("[data-testid=plan-topic]");
    expect(topics[0]!.textContent).toContain("Completo");
    expect(topics[0]!.textContent).toContain("completado el");
    expect(topics[1]!.textContent).toContain("Practicando");
    expect(topics[1]!.textContent).toContain("sin completar");
    expect(detail.querySelector("[data-testid=plan-required-goal]")!.textContent).toContain("20 %");
    expect(button("Abrir en Metas", detail)).toBeTruthy();
    const d = detail.querySelector("[data-testid=plan-deliverable]")!;
    expect(d.textContent).toContain("tests pasan");
    expect(button("Abrir en Proyectos", d)).toBeTruthy();
    await click(toggle);
    expect(host.querySelector("[data-testid=subplan-detail]")).toBeNull();
  });

  it("el estado del entregable NO es editable: se calcula solo", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const update = vi.spyOn(api, "mentorPlanUpdateDeliverable").mockResolvedValue(plan());
    await mountEl(<PlanWorkspace planId={PID} />);
    await section("areas");
    await click(button("Desarrollo Backend"));
    const detail = host.querySelector("[data-testid=subplan-detail]")!;
    expect(detail.querySelectorAll("input, textarea")).toHaveLength(0);
    expect(detail.querySelectorAll("select")).toHaveLength(0);
    expect(detail.querySelector("[data-testid=deliverable-derived-status]")!.textContent).toContain("se calcula solo");
    expect(update).not.toHaveBeenCalled();
  });

  it("el subplan sin proyecto lo presenta como propuesta de entregable", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    await section("areas");
    await click(button("Hablar con confianza"));
    const d = host.querySelector("[data-testid=plan-deliverable]")!;
    expect(d.textContent).toContain("Propuesta");
    expect(button("Abrir en Proyectos", d)).toBeUndefined();
  });

  it("la Agenda (vista Día) enseña lo que toca hoy y 'Planear mi día con esto' lleva a Hoy", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ today: "2026-10-13", plans: [row(PID, "A"), row("2026-10-10_2026-10-31", "B")] }));
    await mountEl(<PlanWorkspace planId={PID} />);
    await openTab("agenda");
    await click(navView(host, "dia"));
    const items = host.querySelectorAll("[data-testid=agenda-topic]");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("2 APIs web");
    expect(host.querySelector("[data-testid=agenda-day-counts]")!.textContent).toContain("1 tema");
    await click(button("Planear mi día con esto"));
    expect(useMentor.getState().pendingObjective).toEqual({ type: "plan" });
    expect(useNavState.getState().values["mentor.view"]).toBe("hoy");
  });

  it("un plan que ya no existe lo avisa y vuelve al resumen", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ id: "x", plan: null, derived: null }));
    await mountEl(<PlanWorkspace planId="x" />);
    expect(host.querySelector("[data-testid=plan-missing]")).toBeTruthy();
    await click(button("Volver al resumen"));
    expect(useNavState.getState().values["mentor.view"]).toBe("plan");
  });

  it("renombrar guarda el nombre elegido", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const rename = vi.spyOn(api, "mentorPlanRename").mockResolvedValue(plan({ name: "Mi plan" }));
    ui.askText.mockResolvedValue("Mi plan");
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(button("Renombrar"));
    expect(ui.askText).toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(PID, "Mi plan");
    // cancelar no renombra
    rename.mockClear();
    ui.askText.mockResolvedValue(null);
    await click(button("Renombrar"));
    expect(rename).not.toHaveBeenCalled();
  });

  it("terminar/archivar y reactivar", async () => {
    const get = vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const archive = vi.spyOn(api, "mentorPlanArchive").mockResolvedValue(plan({ archived: true }));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(button("Terminar / archivar"));
    expect(archive).toHaveBeenCalledWith(PID, true);
    get.mockResolvedValue(loaded({ plan: plan({ archived: true }), status: "terminado" }));
    await act(async () => { useMentor.setState((st) => ({ planVersion: st.planVersion + 1 })); });
    await flush();
    await click(button("Reactivar"));
    expect(archive).toHaveBeenLastCalledWith(PID, false);
  });

  it("eliminar pide confirmación y, si se acepta, manda el plan a la papelera y vuelve al resumen", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const del = vi.spyOn(api, "mentorPlanDelete").mockResolvedValue({ id: PID, plans: [] });
    ui.confirmAction.mockResolvedValue(false);
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(button("Eliminar"));
    expect(ui.confirmAction).toHaveBeenCalled();
    expect(String(ui.confirmAction.mock.calls[0]![1])).toContain("papelera");
    expect(del).not.toHaveBeenCalled();
    ui.confirmAction.mockResolvedValue(true);
    await click(button("Eliminar"));
    expect(del).toHaveBeenCalledWith(PID);
    expect(useNavState.getState().values["mentor.view"]).toBe("plan");
  });
});

describe("Mentor — resumen de planes", () => {
  it("sin ningún plan: estado vacío que invita a crear el primero con el formulario", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    vi.spyOn(api, "mentorPlanOptions").mockResolvedValue({ loading: true });
    await mountEl(<MentorPlan />);
    const empty = host.querySelector("[data-testid=plan-empty]")!;
    expect(empty.textContent).toContain("Aún no tienes ningún plan");
    expect(host.querySelectorAll("[data-testid=plan-card]")).toHaveLength(0);
    expect(host.querySelector("[data-testid=plan-form]")).toBeNull();
    await click(button("Crear mi primer plan", empty));
    expect(host.querySelector("[data-testid=plan-form]")).toBeTruthy();
  });

  it("sin IA lo avisa en el estado vacío", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ id: null, plan: null, derived: null, items: [], plans: [], aiConfigured: false }));
    await mountEl(<MentorPlan />);
    expect(host.querySelector("[data-testid=plan-empty]")!.textContent).toContain("La IA no está configurada");
  });

  it("lista una tarjeta por plan con periodo, estado y progreso; al abrirla navega a su sub-interfaz", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(
      loaded({ plans: [row("a", "Plan A"), row("b", "Plan B", { status: "futuro", pct: 0 }), row("c", "Plan C", { status: "terminado", pct: 100 })] }),
    );
    await mountEl(<MentorPlan />);
    const cards = host.querySelectorAll("[data-testid=plan-card]");
    expect(cards).toHaveLength(3);
    expect(cards[0]!.textContent).toContain("Activo");
    expect(cards[1]!.textContent).toContain("Futuro");
    expect(cards[2]!.textContent).toContain("Terminado");
    expect(cards[0]!.textContent).toContain("6 oct – 5 nov");
    expect(cards[0]!.textContent).toContain("70 %");
    expect(cards[0]!.textContent).toContain("4 h/día");
    await click(button("Abrir plan Plan B"));
    expect(useNavState.getState().values["mentor.view"]).toBe("plan:b");
  });

  it("'＋ Nuevo plan' abre el formulario de precondiciones", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanOptions").mockResolvedValue({ loading: true });
    await mountEl(<MentorPlan />);
    await click(button("＋ Nuevo plan"));
    expect(host.querySelector("[data-testid=plan-form]")).toBeTruthy();
  });

  it("'Pedirlo al Mentor' abre el asistente en una conversación de plan", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorChatNew").mockResolvedValue({ id: "c2", title: "", turns: [], pending: null });
    useAssistant.setState({ open: false });
    await mountEl(<MentorPlan />);
    await click(button("Pedirlo al Mentor"));
    expect(useAssistant.getState().open).toBe(true);
    expect(useMentor.getState().planMode).toBe(true);
  });

  it("el borrador pendiente se destaca con calendario plegable y Aceptar / Descartar; aceptar navega al plan nuevo", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    const accept = vi.spyOn(api, "mentorPlanDraftAccept").mockResolvedValue({ id: "2026-10-12_2026-11-11", month: "2026-10", start: "2026-10-12", end: "2026-11-11", subplans: 2, topics: 2, warnings: [], fits: true });
    vi.spyOn(api, "mentorPlanDraftDiscard").mockResolvedValue({ turns: [], pending: null });
    useMentor.setState({ turns: [bot("a1", "Primero bases y luego APIs.", { planDraft: draft({ auto: true, coverage: "Lo elegido necesita ~2 h y tienes 50 h: sobran 48 h.", fits: true, warnings: [] }) })], pending: "a1", chatLoaded: true, chatId: "c1" });
    await mountEl(<MentorPlan />);
    const card = host.querySelector("[data-testid=plan-draft]")!;
    expect(card.textContent).toContain("Borrador del plan de");
    expect(card.textContent).toContain("Plan automático");
    expect(card.textContent).toContain("sobran 48 h");
    expect(card.textContent).toContain("Programación/Django/Inventado");
    expect(host.querySelector("[data-testid=plan-empty]")).toBeNull();
    expect(host.querySelector("[data-testid=draft-calendar]")).toBeNull();
    await click(button("Ver calendario semanal", card));
    expect(card.querySelector("[data-testid=draft-calendar]")!.textContent).toContain("Semana 1");
    await click(button("Aceptar plan", card));
    expect(accept).toHaveBeenCalledWith("a1", "c1");
    expect(useNavState.getState().values["mentor.view"]).toBe("plan:2026-10-12_2026-11-11");
  });

  it("Descartar el borrador no acepta nada", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    const accept = vi.spyOn(api, "mentorPlanDraftAccept");
    const discard = vi.spyOn(api, "mentorPlanDraftDiscard").mockResolvedValue({ turns: [], pending: null });
    useMentor.setState({ turns: [bot("a1", "x", { planDraft: draft() })], pending: "a1", chatLoaded: true, chatId: "c1" });
    await mountEl(<MentorPlan />);
    await click(button("Descartar", host.querySelector("[data-testid=plan-draft]")!));
    expect(discard).toHaveBeenCalledWith("a1");
    expect(accept).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid=plan-draft]")).toBeNull();
  });
});

describe("Mentor: la tarjeta plan_draft en el chat", () => {
  async function mountAssistant() {
    await mountEl(<MentorAssistant />);
  }

  it("resume el plan y ofrece Ver en Plan, Aceptar plan y Descartar", async () => {
    const accept = vi.spyOn(api, "mentorPlanDraftAccept").mockResolvedValue({ id: "2026-10", month: "2026-10", start: "2026-10-01", end: "2026-10-31", subplans: 2, topics: 2, warnings: [], fits: true });
    const discard = vi.spyOn(api, "mentorPlanDraftDiscard").mockResolvedValue({ turns: [], pending: null });
    vi.mocked(api.mentorChatLoad).mockResolvedValue({ id: "c1", title: "plan", turns: [bot("a1", "Primero bases y luego APIs.", { planDraft: draft() })], pending: "a1" });
    await mountAssistant();
    const card = host.querySelector("[data-testid=chat-plan-draft]")!;
    expect(card.textContent).toContain("Plan de 2026-10");
    expect(card.textContent).toContain("2 subplanes · 2 temas · 6 h/semana");
    expect(host.querySelector("[data-testid=chat-draft]")).toBeNull();
    expect(button("Crear meta", card)).toBeUndefined();
    await click(button("Ver en Plan", card));
    expect(useNavState.getState().values["mentor.view"]).toBe("plan");
    await click(button("Aceptar plan", card));
    expect(accept).toHaveBeenCalledWith("a1", "c1");
    await click(button("Descartar", card));
    expect(discard).toHaveBeenCalledWith("a1");
  });

  it("un borrador con precondiciones muestra su periodo y si es automático", async () => {
    vi.mocked(api.mentorChatLoad).mockResolvedValue({
      id: "c1", title: "plan", pending: "a1",
      turns: [bot("a1", "x", { planDraft: draft({ start: START, end: END, auto: true, preconditions: plan().preconditions }) })],
    });
    await mountAssistant();
    const t = host.querySelector("[data-testid=chat-plan-draft]")!.textContent!;
    expect(t).toContain("Plan del 6 oct – 5 nov");
    expect(t).toContain("automático");
  });

  it("el borrador muestra los comentarios (y avisa que solo la IA los usa si es automático)", async () => {
    const withNotes = { ...plan().preconditions!, notes: "tengo examen el 20" };
    useMentor.setState({ turns: [bot("a1", "x", { planDraft: draft({ start: START, end: END, auto: true, preconditions: withNotes }) })], pending: "a1", chatLoaded: true, chatId: "c1" });
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    await mountEl(<MentorPlan />);
    const n = host.querySelector("[data-testid=draft-notes]")!;
    expect(n.textContent).toContain("tengo examen el 20");
    expect(n.textContent).toContain("Los comentarios solo los usa la IA; este plan se generó automáticamente");
  });

  it("la cabecera del plan muestra los comentarios, plegables si son largos", async () => {
    const long = `${"quiero terminar primero lo de APIs. ".repeat(8)}\nsegunda línea`;
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ plan: { ...plan(), preconditions: { ...plan().preconditions!, notes: long } } } as any));
    await mountEl(<PlanWorkspace planId={PID} />);
    await section("alcance");
    const n = host.querySelector("[data-testid=plan-notes]")!;
    expect(n.textContent).not.toContain("segunda línea");
    await click(button("Ver todo", n));
    expect(host.querySelector("[data-testid=plan-notes]")!.textContent).toContain("segunda línea");
  });

  it("un plan ya aceptado o descartado no ofrece acciones", async () => {
    vi.mocked(api.mentorChatLoad).mockResolvedValue({
      id: "c1", title: "plan", pending: null,
      turns: [bot("a1", "x", { planDraft: draft(), acceptedPlan: "2026-10" }), bot("a2", "y", { planDraft: draft(), discarded: true })],
    });
    await mountAssistant();
    const cards = host.querySelectorAll("[data-testid=chat-plan-draft]");
    expect(cards[0]!.textContent).toContain("Aceptado");
    expect(cards[1]!.textContent).toContain("Descartado");
    expect(button("Aceptar plan", cards[0]!)).toBeUndefined();
  });

  it("una conversación de plan siembra el campo de mensaje y envía con mode=plan", async () => {
    const chat = vi.spyOn(api, "mentorChat").mockResolvedValue({ loading: false, kind: "question", text: "¿Horas?", pending: null, id: "c1", title: "t", turns: [{ id: "u1", role: "user", content: "Quiero un plan para este mes: backend", at: "x" }, bot("a1", "¿Horas?")] });
    vi.spyOn(api, "mentorChatNew").mockResolvedValue({ id: "c2", title: "", turns: [], pending: null });
    await mountAssistant();
    await act(async () => { await useMentor.getState().startPlanChat(); });
    await flush();
    const area = host.querySelector<HTMLTextAreaElement>("textarea[aria-label='Mensaje para el Mentor']")!;
    expect(area.value).toBe("Quiero un plan para este mes: ");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Quiero un plan para este mes: backend");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(host.querySelector("button[aria-label='Enviar al Mentor']")!);
    expect(chat).toHaveBeenCalledWith("Quiero un plan para este mes: backend", undefined, "plan");
  });
});

describe("MentorModule: selector de plan", () => {
  const nav = () => [...host.querySelectorAll("aside nav button")].map((b) => b.textContent ?? "");
  const openSelector = async () => { await click(host.querySelector("[data-testid=mentor-plan-selector-btn]")!); };
  const options = () => [...host.querySelectorAll("[data-testid=mentor-plan-list] [role=option]")];

  it("los planes ya no son una sección de la barra: se alcanzan desde el selector, con «Todos los planes» al resumen", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    useNavState.setState({ values: { "mentor.view": "plan" } });
    await mountEl(<MentorModule />);
    expect(nav().some((t) => t.startsWith("Plan") || t.includes("Hoy") || t.includes("Metas"))).toBe(false);
    await openSelector();
    await click(host.querySelector("[data-testid=plan-all]")!);
    expect(host.textContent).toContain("Mentor — Planes");
  });

  it("0 planes: sin opciones de plan, el selector invita a crear y el panel muestra el estado vacío", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    useNavState.setState({ values: { "mentor.view": "plan" } });
    await mountEl(<MentorModule />);
    expect(nav()).toHaveLength(0);
    expect(host.querySelector("[data-testid=mentor-plan-current]")!.textContent).toBe("Sin plan");
    await openSelector();
    expect(options()).toHaveLength(0);
    expect(host.querySelector("[data-testid=plan-create]")).toBeTruthy();
    expect(host.querySelector("[data-testid=plan-empty]")).toBeTruthy();
  });

  it.each([1, 3, 5])("%i planes = %i opciones en el selector, cada una con su nombre, periodo y estado", async (n) => {
    const list = Array.from({ length: n }, (_, i) => row(`p${i}`, `Plan ${i + 1}`, { status: i === 0 ? "activo" : i % 2 ? "futuro" : "terminado", pct: i * 10 }));
    vi.mocked(api.mentorPlanList).mockResolvedValue(list);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ plans: list }));
    useNavState.setState({ values: { "mentor.view": "plan" } });
    await mountEl(<MentorModule />);
    await openSelector();
    expect(options()).toHaveLength(n);
    expect(options()[0]!.textContent).toContain("Plan 1");
    expect(options()[0]!.textContent).toContain("6 oct – 5 nov");
    expect(options()[0]!.textContent).toContain("Activo");
  });

  it("elegir un plan lo muestra y se recuerda; si el plan guardado ya no existe, se abre el plan en curso", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([row("p1", "Plan 1"), row("p2", "Plan 2")]);
    const get = vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded({ id: "p2", plan: plan({ id: "p2" }) }));
    useNavState.setState({ values: { [MODE_KEY]: "planeacion" } });
    await mountEl(<MentorModule />);
    // sin plan elegido y con planes, abre el que está en curso
    expect(get).toHaveBeenLastCalledWith("p1");
    await openSelector();
    await click(host.querySelector("[data-testid=plan-option-p2]")!);
    expect(useNavState.getState().values["mentor.view"]).toBe("plan:p2");
    expect(get).toHaveBeenLastCalledWith("p2");
    expect(host.querySelector("[data-testid=plan-props]")).toBeTruthy();
    expect(host.querySelector("[data-testid=mentor-plan-current]")!.textContent).toBe("Plan 2");
    // el plan guardado ya no existe: el plan en curso
    act(() => root.unmount());
    root = createRoot(host);
    useMentor.setState({ plans: [], plansLoaded: false });
    useNavState.setState({ values: { "mentor.view": "plan:zzz" } });
    vi.mocked(api.mentorPlanList).mockResolvedValue([row("p1", "Plan 1")]);
    get.mockResolvedValue(loaded());
    await mountEl(<MentorModule />);
    expect(host.querySelector("[data-testid=mentor-plan-current]")!.textContent).toBe("Plan 1");
  });
});

describe("MentorModule: modo global y «Crear plan»", () => {
  const byTest = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const navIds = () => [...host.querySelectorAll("aside nav > div > button")].map((b) => b.getAttribute("data-testid")!);
  const p2 = row("p2", "Plan 2", { status: "futuro" });

  it("el interruptor Planeación | Ejecución cambia los ítems de la barra y el panel, y vale para todos los planes", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([row(PID, "Plan 1"), p2]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    useNavState.setState({ values: { "mentor.view": `plan:${PID}` } });
    await mountEl(<MentorModule />);
    // plan mantenido y en curso: abre en Ejecución
    expect(byTest("mentor-mode-ejecucion")!.getAttribute("aria-checked")).toBe("true");
    expect(navIds()).toEqual(["nav-ej:general", "nav-ej:area:s1-programacion", "nav-ej:area:s2-ingles", "nav-ej:practicas-diarias", "nav-ej:proyectos", "nav-ej:registros"]);
    expect(byTest("plan-run")).toBeTruthy();
    await click(byTest("mentor-mode-planeacion")!);
    expect(navIds()).toEqual(["nav-pl:general", "nav-pl:area/s1-programacion", "nav-pl:area/s2-ingles", "nav-pl:add-area", "nav-pl:entregables", "nav-pl:registros", "nav-pl:preparar", "nav-pl:cambios"]);
    expect(byTest("plan-run")).toBeNull();
    expect(byTest("plan-agenda")).toBeTruthy();
    expect(useNavState.getState().values["mentor.mode"]).toBe("planeacion");
    // cambiar de plan conserva el modo
    await click(byTest("mentor-plan-selector-btn")!);
    await click(byTest("plan-option-p2")!);
    expect(useNavState.getState().values["mentor.view"]).toBe("plan:p2");
    expect(byTest("mentor-mode-planeacion")!.getAttribute("aria-checked")).toBe("true");
    expect(navIds()[0]).toBe("nav-pl:general");
  });

  it("«Crear plan» abre el formulario de plan nuevo; al cerrarlo se vuelve al resumen y se puede abrir otra vez", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([row(PID, "Plan 1")]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanOptions").mockResolvedValue({ loading: true });
    useNavState.setState({ values: { "mentor.view": `plan:${PID}` } });
    await mountEl(<MentorModule />);
    await click(byTest("mentor-plan-selector-btn")!);
    await click(byTest("plan-create")!);
    expect(useNavState.getState().values["mentor.view"]).toBe("nuevo");
    expect(byTest("plan-form")).toBeTruthy();
    await click(host.querySelector("button[aria-label='Cerrar formulario']")!);
    expect(byTest("plan-form")).toBeNull();
    expect(useNavState.getState().values["mentor.view"]).toBe("plan");
    await click(byTest("mentor-plan-selector-btn")!);
    await click(byTest("plan-create")!);
    expect(byTest("plan-form")).toBeTruthy();
  });

  it("los valores antiguos de la barra abren su panel oculto y «Volver a mi plan» lleva al plan en curso; el selector se cierra con Escape", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([row(PID, "Plan 1")]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPanels").mockResolvedValue({ loading: true } as never);
    useNavState.setState({ values: { "mentor.view": "cierre" } });
    await mountEl(<MentorModule />);
    expect(navIds()).toEqual([]);
    await click(byTest("mentor-plan-selector-btn")!);
    expect(byTest("mentor-plan-list")).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(byTest("mentor-plan-list")).toBeNull();
    await click(byTest("today-back")!);
    expect(useNavState.getState().values["mentor.view"]).toBe(`plan:${PID}`);
    expect(byTest("plan-view")).toBeTruthy();
  });

  it("sin ningún plan la barra solo lleva el interruptor y el selector", async () => {
    vi.mocked(api.mentorPlanList).mockResolvedValue([]);
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(none());
    await mountEl(<MentorModule />);
    expect(navIds()).toEqual([]);
    expect(byTest("mentor-mode")).toBeTruthy();
    expect(byTest("mentor-plan-selector")).toBeTruthy();
    expect(byTest("plan-empty")).toBeTruthy();
  });
});
