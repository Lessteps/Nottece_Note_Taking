// @vitest-environment jsdom
//
// Mentor — Planeación como espacio de trabajo: la página de cada ÁREA (cabecera, propiedades, nota de práctica, pestañas con teclado), sus cifras
// iguales a las de los selectores compartidos, los enlaces profundos antiguos que caen en estas páginas y la persistencia de la pestaña.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import { buildSchedule, progressPlan, topicsText, weekSummary } from "../../lib/planSchedule";
import { weekRangesOf } from "../../lib/planTime";
import { buildPracticeTrack } from "../../lib/practiceTrack";
import type { MentorPlan as PlanData, MentorPlanGet, MentorPlanRow } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { MODE_KEY } from "./mentorNav";
import { navTab, navView } from "./mentorTestNav";
import { openAgendaAt } from "./planShared";
import { scheduleOf } from "./agendaKit";

const ui = vi.hoisted(() => ({ askText: vi.fn(), confirmAction: vi.fn() }));
vi.mock("../ui", async (orig) => ({ ...(await orig<typeof import("../ui")>()), askText: ui.askText, confirmAction: ui.confirmAction }));

import { PlanWorkspace } from "./PlanWorkspace";

const START = "2026-10-05"; // lunes
const END = "2027-01-03";
const PID = `${START}_${END}`;
const TODAY = "2026-10-14";
const PRE = { start: START, end: END, minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "intenso" as const, goalIds: [], subjects: ["Programación"], levels: {}, deliverables: "yes" as const, practice: { kataMinutes: 30, sessionsPerWeek: 2, minutesPerSession: 60, monthly: true, focus: "rotate" as const } };
const WEEKS = weekRangesOf(START, END);
const mkTopics = (branch: string, n: number, group: string | undefined, first: number, step: number) =>
  Array.from({ length: n }, (_, i) => ({ folder: `Programación/${branch}/T${String(i + 1).padStart(2, "0")}`, title: `${branch.replace(/^[\d.\s]+/, "")} ${i + 1}`, estMinutes: 60, targetWeek: Math.min(WEEKS.length, first + Math.floor(i / step)), ...(group ? { group } : {}) }));
const slices = (topics: Array<{ folder: string; targetWeek: number }>) => WEEKS.map((w) => ({ week: w.week, start: w.start, end: w.end, topics: topics.filter((t) => t.targetWeek === w.week).map((t) => t.folder), minutes: 0, capacityMinutes: 0 }));

/** El plan ya organizado por áreas (Backend con Bases + Lenguaje + Conocimientos; Databases), con su práctica. */
function areasPlan(): PlanData {
  const be = [...mkTopics("1 Fundamentals", 6, "bases", 1, 2), ...mkTopics("2.1 Python", 5, "lang-python", 4, 2), ...mkTopics("4 Backend", 8, "core", 6, 2)];
  const db = mkTopics("6 Databases", 6, "core", 1, 2);
  return {
    id: PID, start: START, end: END, name: "Backend + Databases · 5 oct–3 ene", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", hoursPerWeek: 20, preconditions: PRE as never, structure: "areas",
    programmingPractice: buildPracticeTrack(PRE as never),
    subplans: [
      { id: "s1-backend", area: "Backend", areaId: "backend", objective: "Construir servicios y APIs sólidos y seguros", topics: be, weeks: slices(be), requiredGoals: [], phase: { fromWeek: 1, toWeek: 10 },
        groups: [{ id: "bases", title: "Bases", kind: "bases", order: 0 }, { id: "lang-python", title: "Lenguaje: Python", kind: "language", order: 10 }, { id: "core", title: "Conocimientos de backend", kind: "knowledge", order: 100 }],
        deliverable: { title: "API REST con persistencia y pruebas", description: "Un servicio pequeño", criteria: ["Endpoints documentados"], status: "idea" } },
      { id: "s2-databases", area: "Databases", areaId: "databases", objective: "Modelar, consultar y operar bases de datos", topics: db, weeks: slices(db), requiredGoals: [], phase: { fromWeek: 1, toWeek: 10 },
        groups: [{ id: "core", title: "Conocimientos de bases de datos", kind: "knowledge", order: 100 }] },
    ],
  } as PlanData;
}
const row = (over: Partial<MentorPlanRow> = {}): MentorPlanRow => ({ id: PID, start: START, end: END, name: "Backend + Databases · 5 oct–3 ene", period: "5 oct – 3 ene", status: "activo", archived: false, auto: false, subplans: 2, topics: 0, completed: 0, pct: 0, minutesPerDay: 240, programmingPractice: true, ...over });
const loaded = (p: PlanData, over: Partial<Extract<MentorPlanGet, { loading: false }>> = {}): MentorPlanGet => ({
  loading: false, id: PID, month: "2026-10", today: TODAY, status: "activo", plan: p,
  derived: {
    subplans: p.subplans.map((s) => ({ id: s.id, total: s.topics.length, done: 0, pct: 0, currentWeek: 2, topics: s.topics.map((t) => ({ ...t, state: "sin_tratar" as const, pct: 0, found: true })) })),
    summary: { subplans: p.subplans.length, topics: p.subplans.reduce((n, s) => n + s.topics.length, 0), done: 0, pct: 0, currentWeek: 2, weeks: 14 },
  },
  goals: {}, projects: {}, items: [], practiceItems: [], practice: { ppReady: true, kata: null, kataDoneDates: [], weeks: [] }, months: [], plans: [row()], aiConfigured: true, ...over,
});

/** Un día del plan con temas (el reparto diario nivela, así que no todos los días tienen). */
const busyDay = (): string => buildSchedule(progressPlan(areasPlan() as never, { today: TODAY })).days.find((d) => d.week >= 2 && d.topics.length >= 1 && d.practice.kata)!.date;

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const mountEl = async (el: React.ReactNode) => { await act(async () => { root.render(el); }); await flush(); await flush(); };
const click = async (el: Element | null | undefined) => {
  expect(el, "elemento no encontrado").toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
};
const byTest = (id: string, within: ParentNode = host) => within.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
const nav = (id: string) => host.querySelector<HTMLElement>(`[data-testid='nav-pl:${id}']`)!;
const key = async (el: Element, k: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }); await flush(); };
const tabsText = () => [...host.querySelectorAll("[role=tab]")].map((t) => t.textContent);
const open = async (p: PlanData = areasPlan()) => {
  vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(p));
  await mountEl(<PlanWorkspace planId={PID} />);
};

beforeEach(() => {
  localStorage.clear();
  ui.askText.mockReset();
  ui.confirmAction.mockReset();
  useNavState.setState({ values: { [MODE_KEY]: "planeacion" } });
  useMentor.setState({ planVersion: 0, plans: [], plansLoaded: false, pendingObjective: null });
  useApp.setState({ module: "mentor" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorPlanChanges").mockResolvedValue([]);
  vi.spyOn(api, "mentorPlanList").mockResolvedValue([row()]);
  vi.spyOn(api, "mentorAiStatus").mockResolvedValue({ busy: false, label: "", elapsed: 0 });
  vi.spyOn(api, "mentorPlanTopicCatalog").mockResolvedValue({ loading: false, rows: [] });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("página de un área", () => {
  it("muestra la guía pedagógica guardada del área", async () => {
    const p = areasPlan();
    p.subplans.find((s) => s.id === "s1-backend")!.learningGuide = "Empezar desde cero";
    await open(p);
    await click(nav("area/s1-backend"));
    expect(byTest("learning-guide").textContent).toContain("Empezar desde cero");
    expect(byTest("learning-guide").textContent).toContain("se incluye al generar");
  });
  it("cabecera: título grande, propiedades (Estado, Fechas, Progreso), la nota de práctica con el Mentor y las pestañas del área", async () => {
    await open();
    await click(nav("area/s1-backend"));
    expect(nav("area/s1-backend").getAttribute("aria-current")).toBe("page");
    expect(byTest("plan-page-title").tagName).toBe("H1");
    expect(byTest("plan-page-title").textContent).toBe("Backend");
    const props = byTest("plan-props").textContent!;
    expect(props).toContain("Estado");
    expect(props).toContain("Pendiente"); // el área de prueba todavía no tiene actividad
    expect(props).toContain("Fechas");
    expect(props).toMatch(/5 oct 2026 – \d+ \w+ 2027?/); // las fechas del PLAN, no las de la fase del área
    expect(props).toMatch(/\d+(,\d)? semanas/);
    expect(props).toContain("Progreso");
    expect(byTest("prop-progress-text").textContent).toMatch(/^Semana 2 · \d+ temas pendientes$/);
    // la nota de práctica con sus dos acciones
    const tip = byTest("practice-curriculum-bar");
    expect(tip.textContent).toContain("Práctica de Backend con Mentor IA");
    expect(byTest("practice-curriculum-generate").textContent).toContain("Backend");
    expect(byTest("practice-curriculum-templates").textContent).toContain("Solo plantillas de Backend");
    expect(tabsText()).toEqual(["Semana 2", "Calendario", "Temas Backend", "Proyectos"]);
    // la ruta de migas en la barra de accesos
    expect(byTest("plan-crumb").textContent).toContain("Backend");
  });

  it("las pestañas siguen el patrón WAI-ARIA (flechas, Inicio/Fin) y la elegida se recuerda por página", async () => {
    await open();
    await click(nav("area/s1-backend"));
    const list = host.querySelector("[role=tablist]")!;
    expect(list.getAttribute("aria-label")).toBe("Secciones de Backend");
    const tabs = () => [...host.querySelectorAll<HTMLElement>("[role=tab]")];
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    await key(list, "ArrowRight");
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(byTest("agenda-calendar")).toBeTruthy();
    expect(host.querySelector("[role=tabpanel]:not([hidden])")!.getAttribute("aria-labelledby")).toBe(tabs()[1]!.id);
    await key(list, "End");
    expect(tabs()[3]!.getAttribute("aria-selected")).toBe("true");
    expect(useNavState.getState().values[`mentor.pageTab.${PID}.s1-backend`]).toBe("proyectos");
    await key(list, "Home");
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
    // cada página recuerda la suya: Databases sigue en Semana mientras Backend queda en Calendario
    await key(list, "ArrowRight");
    await click(nav("area/s2-databases"));
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
    await click(nav("area/s1-backend"));
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    // y sobrevive a volver a abrir el plan
    act(() => root.unmount());
    root = createRoot(host);
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("las cifras de la semana son las de los selectores compartidos (byWeekArea / dayByArea): las mismas que la Agenda general y la Ejecución", async () => {
    const p = areasPlan();
    await open(p);
    const { byWeekArea, schedule } = scheduleOf(p, TODAY, []);
    const cell = byWeekArea.weeks[1]!.cells.find((c) => c.subplanId === "s1-backend")!;
    await click(nav("area/s1-backend"));
    expect(byTest("week-stat-done-value").textContent).toBe(`${cell.done}/${cell.topics.length}`);
    expect(byTest("agenda-week").textContent).not.toMatch(/\d+(,\d+)? h de /);
    expect(byTest("agenda-week-counts").textContent).toContain(topicsText(cell.topics.length));
    // las filas de los días: 7, en el orden del reparto
    const rows = [...host.querySelectorAll("[data-testid=agenda-week-day]")];
    expect(rows).toHaveLength(7);
    const days = schedule.days.filter((d) => d.week === 2);
    rows.forEach((r, i) => {
      expect(r.getAttribute("data-date")).toBe(days[i]!.date);
      expect(r.querySelector("[data-testid=agenda-week-day-count]")!.textContent).toMatch(/^(sin temas|\d+ temas?)$/);
    });
    // la Vista general cuenta los temas de la semana con el mismo reparto
    await click(nav("general"));
    const w = weekSummary(p as never, schedule, 2, []);
    expect(byTest("agenda-week-counts").textContent).toContain(topicsText(w!.topics));
  });

  it("«Ver día» abre el detalle del día dentro de la página del área y «Volver a Semana N» regresa", async () => {
    await open();
    await click(nav("area/s1-backend"));
    const d = busyDay();
    await click(host.querySelector(`[data-testid=agenda-week-day][data-date='${d}'] button`));
    expect(byTest("agenda-day")).toBeTruthy();
    expect(byTest("agenda-day-back").textContent).toContain("Semana 2");
    expect(byTest("plan-page-title").textContent).toBe("Backend");
    await click(byTest("agenda-day-back"));
    expect(byTest("agenda-week")).toBeTruthy();
  });

  it("«Temas Backend» es el catálogo de ese área: sin la barra de áreas de la vista general", async () => {
    await open();
    await click(nav("area/s1-backend"));
    await click(host.querySelector("#page-tabs-tab-temas"));
    expect(byTest("plan-areas-view")).toBeTruthy();
    expect(host.querySelector("[data-testid=area-tabs]")).toBeNull();
  });

  it("los ganchos del ritmo diario y de «tema extra» existen como componentes con nombre y no pintan nada todavía", async () => {
    const slots = await import("./PlanPageSlots");
    expect(typeof slots.PaceSlot).toBe("function");
    expect(typeof slots.AddTopicSlot).toBe("function");
    await open();
    await click(nav("area/s1-backend"));
    expect(host.querySelectorAll("[data-testid=agenda-week-day]")).toHaveLength(7);
  });
});

describe("Vista general", () => {
  it("lleva las propiedades con las áreas activas (enlaces a sus páginas), la nota de práctica del plan y las pestañas Semana · Calendario · Por área · Proyectos · Detalles", async () => {
    await open();
    expect(nav("general").getAttribute("aria-current")).toBe("page");
    expect(byTest("plan-page-title").textContent).toBe("Backend + Databases · 5 oct–3 ene");
    expect(tabsText()).toEqual(["Semana 2", "Calendario", "Por área", "Proyectos", "Detalles"]);
    expect(byTest("practice-curriculum-bar").textContent).toContain("Práctica del plan con Mentor IA");
    expect(byTest("practice-curriculum-templates").textContent).toBe("Solo plantillas (sin IA)");
    const chips = [...host.querySelectorAll("[data-testid=prop-area-chip]")];
    expect(chips.map((c) => c.textContent!.trim())).toEqual(["Backend", "Databases", "Bases"]);
    await click(chips[1]!);
    expect(byTest("plan-page-title").textContent).toBe("Databases");
    expect(nav("area/s2-databases").getAttribute("aria-current")).toBe("page");
  });

  it("«Por área» enseña una tarjeta por área con su avance y cada una abre su página; el menú «…» conserva renombrar, archivar y eliminar", async () => {
    await open();
    await click(host.querySelector("#page-tabs-tab-area"));
    const cards = [...host.querySelectorAll("[data-testid=plan-area-card]")];
    expect(cards.map((c) => c.getAttribute("data-area"))).toEqual(["s1-backend", "s2-databases", "bases"]);
    expect(cards[0]!.textContent).toMatch(/\d+\/\d+ temas/);
    await click(cards[0]!);
    expect(byTest("plan-page-title").textContent).toBe("Backend");
    await click(nav("general"));
    expect(byTest("plan-menu")).toBeTruthy();
    expect(["rename", "archive", "delete"].every((a) => byTest(`plan-action-${a}`))).toBe(true);
    expect(byTest("plan-ask-changes").textContent).toContain("Preguntar o ajustar");
  });
});

describe("enlaces profundos y claves antiguas", () => {
  it("openAgendaAt(fecha) abre la página del área elegida en esa fecha; con vista «mes» enseña el mes y con «dia» el detalle del día", async () => {
    await open();
    await click(nav("area/s1-backend"));
    await act(async () => { openAgendaAt(PID, "2026-11-10"); });
    await flush();
    expect(nav("area/s1-backend").getAttribute("aria-current")).toBe("page");
    expect(byTest("agenda-month")).toBeTruthy();
    expect((byTest("agenda-date") as HTMLInputElement).value).toBe("2026-11-10");
    expect(useNavState.getState().values[`mentor.agendaDate.${PID}`]).toBe(""); // consumida una vez
    await act(async () => { openAgendaAt(PID, "2026-11-12", "dia"); });
    await flush();
    expect(byTest("agenda-day")).toBeTruthy();
    expect(byTest("agenda-title").textContent!.toLowerCase()).toContain("12 de noviembre");
    expect(useNavState.getState().values[`mentor.agendaView.${PID}`]).toBe("semana");
    await act(async () => { openAgendaAt(PID, "2026-11-13", "calendario"); });
    await flush();
    expect(byTest("agenda-calendar")).toBeTruthy();
  });

  it("las claves antiguas (pestaña «semana», área «__bases», un área que ya no existe, sub-vistas de Mi plan) caen en la página que les toca", async () => {
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [`mentor.planTab.${PID}`]: "semana", [`mentor.agendaArea.${PID}`]: "s2-databases" } });
    await open();
    expect(byTest("plan-page-title").textContent).toBe("Databases");
    act(() => root.unmount());
    root = createRoot(host);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [`mentor.planTab.${PID}`]: "agenda", [`mentor.agendaArea.${PID}`]: "__bases" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("plan-page-title").textContent).toBe("Bases");
    expect(nav("bases").getAttribute("aria-current")).toBe("page");
    act(() => root.unmount());
    root = createRoot(host);
    // un área que ya no existe vuelve a la Vista general; «Registros» sigue siendo una página propia
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [`mentor.planTab.${PID}`]: "agenda", [`mentor.agendaArea.${PID}`]: "fantasma" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(nav("general").getAttribute("aria-current")).toBe("page");
    await click(nav("registros"));
    expect(nav("registros").getAttribute("aria-current")).toBe("page");
    expect(useNavState.getState().values[`mentor.planSection.${PID}`]).toBe("registros");
    expect(host.querySelector("[data-testid=plan-agenda]")).toBeNull();
  });

  it("la vista «calendario» guardada de la Agenda abre la pestaña Calendario de la página", async () => {
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [`mentor.planTab.${PID}`]: "agenda", [`mentor.agendaView.${PID}`]: "calendario" } });
    await open();
    expect(byTest("agenda-calendar")).toBeTruthy();
    expect(navView(host, "calendario").getAttribute("aria-selected")).toBe("true");
    expect(navTab(host, "agenda").getAttribute("aria-current")).toBe("page");
  });
});

describe("correcciones de Planeación: sin emojis, propiedades planas, sin horas y semana en orden de ruta", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;

  it("ni la barra, ni la cabecera, ni la página llevan emojis; las propiedades no son una tarjeta y la barra de progreso ocupa todo el ancho", async () => {
    await open();
    await click(nav("area/s1-backend"));
    expect(byTest("plan-head").textContent).not.toMatch(EMOJI);
    expect(byTest("plan-agenda").textContent).not.toMatch(EMOJI);
    expect(nav("general").textContent).not.toMatch(EMOJI);
    expect(nav("area/s1-backend").textContent).not.toMatch(EMOJI);
    expect(nav("area/s1-backend").textContent).toContain("Backend");
    const props = byTest("plan-props");
    expect(props.className).not.toMatch(/\bbg-card\b|\bborder\b|\brounded/);
    const bar = byTest("prop-progress").querySelector("[role=progressbar]")!.parentElement!.parentElement!;
    expect(bar.className).toContain("flex-1");
    await click(nav("general"));
    expect(byTest("plan-agenda").textContent).not.toMatch(EMOJI);
  });

  it("«Ver día» existe hoy y en días futuros, pero no en un día pasado en que no se hizo nada", async () => {
    await open();
    await click(nav("area/s1-backend"));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-testid=agenda-week-day]")];
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      const date = r.getAttribute("data-date")!;
      const has = [...r.querySelectorAll("button")].some((b) => b.textContent === "Ver día");
      expect(has, date).toBe(date >= TODAY);
    }
    const strip = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=agenda-week-strip-day]")];
    for (const b of strip) expect(b.disabled).toBe(b.getAttribute("data-date")! < TODAY);
  });

  it("la semana lista los temas en el orden de la ruta, con su número, y no cuenta horas: tarjetas de cumplimiento", async () => {
    const p = areasPlan();
    await open(p);
    await click(nav("area/s1-backend"));
    const route = p.subplans[0]!.topics.map((t) => t.folder);
    const folders = [...host.querySelectorAll("[data-testid=area-topic]")].map((r) => r.getAttribute("data-folder")!);
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.map((f) => route.indexOf(f))).toEqual([...folders.map((f) => route.indexOf(f))].sort((a, b) => a - b));
    expect([...host.querySelectorAll("[data-testid=area-topic-seq]")].map((e) => e.textContent)).toEqual(folders.map((_, i) => String(i + 1)));
    for (const id of ["done", "theory", "practice"]) expect(byTest(`week-stat-${id}-value`).textContent).toMatch(/^\d+\/\d+$/);
    expect(byTest("agenda-week").textContent).not.toMatch(/\d(,\d+)? h de /);
    expect(byTest("agenda-week").textContent).not.toContain("Estudio teórico");
    // el conmutador «Por día» agrupa por día con el mismo orden de ruta dentro de cada día
    await click(byTest("week-mode-dia"));
    const groups = [...host.querySelectorAll("[data-testid=week-day-group]")];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const idx = [...g.querySelectorAll("[data-testid=area-topic]")].map((r) => route.indexOf(r.getAttribute("data-folder")!));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
    expect(groups[0]!.querySelector("h4")!.textContent).toMatch(/·\s*\d+ temas?/);
  });
});
