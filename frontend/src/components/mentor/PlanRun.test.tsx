// @vitest-environment jsdom
//
// Mentor — las dos caras de un plan: «Plan» (pestañas para armarlo y ajustarlo) y «Ejecución» (solo lectura: qué hago hoy, cómo voy en
// cada área y qué viene). Un plan mantenido abre en ejecución; uno propuesto, en plan; la elección se recuerda por plan.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import type { MentorPlan as PlanData, MentorPlanGet, MentorPlanRow } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { idlePomodoro } from "../../lib/pomodoro";
import { usePomodoro } from "../../store/pomodoro";
import { PlanWorkspace } from "./PlanWorkspace";
import { planSectionKey, planTabKey } from "./planShared";
import { MODE_KEY } from "./mentorNav";

const START = "2026-10-06";
const END = "2027-04-05";
const PID = `${START}_${END}`;
const TODAY = "2026-10-12";
const F1 = "Programación/1 Fundamentals/1.1 What programming is";
const F2 = "Programación/2.1 Python/2.1.1 Project structure";

const week = (n: number, topics: string[]) => ({ week: n, start: START, end: END, topics, minutes: 60 * topics.length, capacityMinutes: 240 });
const sub = (id: string, area: string, objective: string, folder: string) => ({
  id, area, objective, notes: "Temas en el orden natural de la materia.",
  topics: [{ folder, title: folder.split("/").pop()!, targetWeek: 1, estMinutes: 60 }], weeks: [week(1, [folder]), week(2, [])], requiredGoals: [],
});
const plan = (over: Partial<PlanData> = {}): PlanData => ({
  id: PID, start: START, end: END, name: "Reforzar bases", createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z", proposed: false,
  hoursPerWeek: 37, rationale: "Se prioriza lo que pidió el estudiante.",
  preconditions: { start: START, end: END, minutesPerDay: 420, studyDays: [1, 2, 3, 4, 5, 6, 7], pace: "intenso", goalIds: [], subjects: ["Programación"], levels: {}, deliverables: "no" } as never,
  subplans: [sub("s1", "Fundamentals", "Reforzar bases", F1), sub("s2", "Python", "Consolidar Python", F2)] as never,
  ...over,
});
const row = (over: Partial<MentorPlanRow> = {}): MentorPlanRow => ({ id: PID, start: START, end: END, name: "Reforzar bases", period: "6 oct – 5 abr", status: "activo", archived: false, auto: false, subplans: 2, topics: 2, completed: 0, pct: 0, minutesPerDay: 420, ...over });
const loaded = (p: PlanData = plan()): MentorPlanGet => ({
  loading: false, id: PID, month: "2026-10", today: TODAY, status: p.proposed ? "propuesto" : "activo", plan: p,
  derived: {
    subplans: p.subplans.map((s, i) => ({ id: s.id, total: s.topics.length, done: i, pct: i * 100, currentWeek: 1, topics: s.topics.map((t) => ({ ...t, state: i ? ("completo" as const) : ("sin_tratar" as const), pct: i * 100, found: true })) })),
    summary: { subplans: p.subplans.length, topics: p.subplans.length, done: 1, pct: 50, currentWeek: 1, weeks: 26 },
  },
  goals: {}, projects: {}, items: [], months: [], plans: [row()], aiConfigured: true,
});

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const mountEl = async (el: React.ReactNode) => { await act(async () => { root.render(el); }); await flush(); await flush(); };
const click = async (el: Element | null | undefined) => {
  expect(el, "elemento no encontrado").toBeTruthy();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
};
const byTest = (id: string) => (id === "board-menu" ? document : host).querySelector<HTMLElement>(`[data-testid=${id}]`);
const all = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];
/** la pestaña de la ejecución: `general`, `area:<subplan>`, `bases`, `proyectos` */
const runTab = (id: string) => host.querySelector<HTMLElement>(`[data-testid="nav-ej:${id}"]`);
const subItem = (id: string) => host.querySelector<HTMLElement>(`[data-testid="nav-pl:${id}"]`);
const work = () => byTest("area-work")!;
const view = async (id: string) => click(byTest(`work-view-${id}`));
const listed = () => [...work().querySelectorAll<HTMLElement>("[data-testid=work-list] [data-testid=board-topic]")];

beforeEach(() => {
  localStorage.clear();
  useNavState.setState({ values: {} });
  useMentor.setState({ planVersion: 0, plans: [], plansLoaded: false });
  useApp.setState({ module: "mentor" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, "mentorPlanChanges").mockResolvedValue([]);
  vi.spyOn(api, "mentorProjectsList").mockResolvedValue({ route: "Programación/Mentor/Ruta X", exists: false, areas: [] });
  vi.spyOn(api, "mentorPlanList").mockResolvedValue([row()]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("vista de ejecución", () => {
  it("un plan mantenido abre en ejecución: hoy, avance por área y sin pestañas", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("plan-run")).toBeTruthy();
    expect(host.querySelector("[role=tablist]")).toBeNull();
    expect(byTest("mentor-mode-ejecucion")!.getAttribute("aria-checked")).toBe("true");
    expect(byTest("mentor-mode-planeacion")!.getAttribute("aria-checked")).toBe("false");
    expect(byTest("plan-mode")).toBeNull(); // el interruptor por plan de la cabecera ya no existe
    // hoy, con su semana
    expect(byTest("run-today")!.textContent).toContain("Semana 1");
    expect(byTest("run-today")!.textContent).toContain("12 de octubre");
    // la barra lateral (modo Ejecución): Hoy, una por área, Proyectos y Registros; la página no repite la barra
    expect([...host.querySelectorAll("aside nav > div > button")].map((b) => b.getAttribute("data-testid"))).toEqual(["nav-ej:general", "nav-ej:area:s1", "nav-ej:area:s2", "nav-ej:proyectos", "nav-ej:registros"]);
    expect(byTest("run-nav")).toBeNull();
    expect(runTab("general")!.getAttribute("aria-current")).toBe("page");
    // General: solo el avance de cada área en la columna lateral, sin listas de temas ni «Cómo voy»
    const ov = all("overview-area");
    expect(ov).toHaveLength(2);
    expect(ov[0]!.textContent).toContain("0 %");
    expect(ov[1]!.textContent).toContain("100 %");
    expect(byTest("board-global")!.textContent).toContain("50 %");
    expect(host.textContent).not.toContain("Cómo voy");
    expect(byTest("area-work")).toBeNull();
    // cada área tiene su pestaña con su trabajo: cuatro vistas (hoy, semana, pendientes, repasos)
    await click(runTab("area:s1"));
    expect(work().querySelector("h2")!.textContent).toBe("Fundamentals");
    expect([...byTest("work-views")!.querySelectorAll("button")].map((b) => b.getAttribute("data-testid"))).toEqual(["work-view-hoy", "work-view-semana", "work-view-pendientes", "work-view-repasos"]);
    expect(host.textContent).not.toContain("Con práctica");
    await click(runTab("area:s2"));
    expect(work().querySelector("h2")!.textContent).toBe("Python");
  });

  it("permite alternar entre la ruta interactiva y la informativa de un área", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await click(runTab("area:s1:interactiva"));
    expect(byTest("interactive-route")).toBeTruthy();
    expect(runTab("area:s1:interactiva")!.getAttribute("aria-current")).toBe("page");
    await click(runTab("area:s1:informativa"));
    expect(byTest("interactive-route")).toBeNull();
    expect(byTest("area-work")).toBeTruthy();
  });

  it("la vista general: áreas de hoy plegables, «Lo que viene» por día, tarjeta de Pomodoro y «Asignar temas»", async () => {
    const p = plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }, { ...sub("s2", "Databases", "Consolidar", F2), areaId: "databases" }] as never });
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(p));
    await mountEl(<PlanWorkspace planId={PID} />);
    const folds = all("area-fold");
    expect(folds.length).toBeGreaterThan(0);
    expect(folds[0]!.dataset.open).toBe("true");
    expect(folds.slice(1).every((f) => f.dataset.open === "false")).toBe(true);
    await click(folds[0]!.querySelector("button"));
    expect(all("area-fold")[0]!.dataset.open).toBe("false");
    expect(byTest("run-focus-clock")!.textContent).toBe("25:00");
    expect(byTest("run-focus-start")).toBeTruthy();
    expect(byTest("board-global")!.textContent).toContain("Progreso global");
  });

  it("ya no hay «Empezar hoy»: el reparto por avance coloca lo que falta desde hoy, en el orden de la ruta, sin que nadie lo pida", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(spreadAreas()));
    const change = vi.spyOn(api, "mentorPlanChange").mockResolvedValue({ loading: false, applied: true, entry: { changed: [] } } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("run-restart")).toBeNull();
    expect(byTest("run-restart-open")).toBeNull();
    expect(byTest("run-catchup")).toBeNull();
    expect(byTest("run-gate")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    // el primer tema de la ruta toca HOY (aunque el plan arrancó el 6 de octubre y hoy es 12)
    await click(runTab("area:s1"));
    expect(listed().map((r) => r.textContent).join(" ")).toContain("1.1 A");
  });

  it("es de solo lectura: ningún campo de texto ni acción que cambie el plan", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    const run = byTest("plan-run")!;
    expect(run.querySelector("textarea, input, select")).toBeNull();
    const labels = [...run.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => /guardar|aplicar|ejecutar|eliminar|renombrar|mantener/i.test(l))).toBe(false);
  });

  it("el interruptor global alterna Ejecución y Planeación (cambia la barra y el panel) y lo recuerda para todos los planes", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(byTest("mentor-mode-planeacion"));
    expect(host.querySelector("[data-testid='nav-pl:general']")).toBeTruthy();
    expect(runTab("general")).toBeNull();
    expect(byTest("plan-run")).toBeNull();
    expect(useNavState.getState().values[MODE_KEY]).toBe("planeacion");
    await click(byTest("mentor-mode-ejecucion"));
    expect(byTest("plan-run")).toBeTruthy();
    expect(host.querySelector("[data-testid='nav-pl:general']")).toBeNull();
    expect(useNavState.getState().values[MODE_KEY]).toBe("ejecucion");
  });

  it("un plan propuesto abre en la vista de plan (aún hay que decidir si se mantiene)", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(plan({ proposed: true })));
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(host.querySelector("[data-testid='nav-pl:general']")).toBeTruthy();
    expect(byTest("plan-run")).toBeNull();
    expect(byTest("plan-proposed-bar")).toBeTruthy();
  });

  it("«Ver en la Agenda» de un próximo día cambia a la vista de plan, pestaña Agenda", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    const next = all("run-upcoming-day");
    expect(next.length).toBeGreaterThan(0);
    await click(next[1]); // elegir otro día de «Lo que viene» solo cambia el día mostrado
    expect(byTest("run-upcoming-areas")).toBeTruthy();
    expect(useNavState.getState().values[MODE_KEY]).not.toBe("planeacion");
    await click(byTest("run-upcoming-open"));
    const v = useNavState.getState().values;
    expect(v[MODE_KEY]).toBe("planeacion");
    expect(v[planTabKey(PID)]).toBe("agenda");
    expect(host.querySelector("[data-testid='nav-pl:general']")!.getAttribute("aria-current")).toBe("page");
  });

  const spread = (): PlanData => {
    const A = "Programación/1 Fundamentals/1.1 A";
    const B = "Programación/1 Fundamentals/1.2 B";
    const big = (folder: string) => ({ folder, title: folder.split("/").pop()!, targetWeek: 1, estMinutes: 360 });
    return plan({ subplans: [{ ...sub("s1", "Fundamentals", "Reforzar bases", A), topics: [big(A), big(B)] }] as never });
  };

  /** plan por áreas (agenda por enfoque): dos temas largos de Backend en orden de ruta */
  const spreadAreas = (): PlanData => {
    const A = "Programación/1 Fundamentals/1.1 A";
    const B = "Programación/1 Fundamentals/1.2 B";
    const big = (folder: string) => ({ folder, title: folder.split("/").pop()!, targetWeek: 1, estMinutes: 360 });
    return plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", A), areaId: "backend", topics: [big(A), big(B)] }] as never });
  };
  /** Backend con un tema sin hacer y Databases con su tema ya completo */
  const twoAreas = (): PlanData => plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }, { ...sub("s2", "Databases", "Consolidar", F2), areaId: "databases" }] as never });

  /** la ruta ya empezó: el primer tema está en curso (sin eso nada puede estar pendiente) */
  const started = (p: PlanData): MentorPlanGet => {
    const l = loaded(p) as Extract<MentorPlanGet, { loading: false }>;
    l.derived!.subplans[0]!.topics[0]!.state = "practicando";
    return l;
  };

  it("sin haber empezado la ruta nada está pendiente, aunque el tiempo previsto de los temas ya haya pasado", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(spread()));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("pendientes");
    expect(listed()).toHaveLength(0);
    expect(byTest("work-empty")!.textContent).toContain("nada pendiente");
    await view("semana");
    expect(work().querySelector("[data-testid=board-time]")!.getAttribute("data-time-status")).toBe("scheduled");
  });

  it("con la ruta empezada, nada queda «pendiente» ni «atrasado» por haber pasado los días: lo que falta se coloca desde hoy", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(started(spreadAreas()));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("pendientes");
    expect(listed()).toHaveLength(0);
    await view("hoy");
    expect(listed().length).toBeGreaterThan(0);
    expect(listed().every((r) => r.querySelector("[data-testid=board-time]")?.getAttribute("data-time-status") !== "pending")).toBe(true);
    expect(byTest("run-catchup")).toBeNull();
  });

  it("«Temas de hoy» es exactamente lo que reparte la Agenda hoy: sin haber empezado no hay ruta bloqueada ni «Toca ahora» mezclado", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(spread()));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    // nada se reparte hoy a esta ruta (sus temas eran de días anteriores): «Hoy» queda vacío como la Agenda; lo anterior no se mezcla ni se bloquea
    expect(listed()).toHaveLength(0);
    expect(byTest("work-empty")!.textContent).toContain("Hoy no toca");
    expect(work().textContent).not.toContain("Toca ahora");
  });

  it("la pestaña general tampoco ofrece temas bloqueados: sin haber empezado, las áreas enseñan lo que sí se puede trabajar", async () => {
    const p = plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }] as never });
    const l = loaded(p) as Extract<MentorPlanGet, { loading: false }>;
    l.derived!.subplans[0]!.topics[0]!.state = "sin_tratar";
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(l);
    await mountEl(<PlanWorkspace planId={PID} />);
    const topics = [...host.querySelectorAll<HTMLElement>("[data-testid=day-topic]")];
    expect(topics.every((g) => g.dataset.state !== "bloqueado")).toBe(true);
  });

  it("la vista de la semana enseña debajo «Lo que viene»: la proyección de las semanas siguientes", async () => {
    const later = "Programación/1 Fundamentals/1.9 Later";
    const p = plan({ subplans: [{ ...sub("s1", "Fundamentals", "Reforzar bases", F1), topics: [{ folder: F1, title: "1.1", targetWeek: 1, estMinutes: 60 }, { folder: later, title: "1.9 Later", targetWeek: 3, estMinutes: 60 }] }] as never });
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(p));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("semana");
    const up = byTest("work-upcoming");
    expect(up).toBeTruthy();
    expect([...up!.querySelectorAll("[data-testid=upcoming-week]")].every((w) => Number(w.getAttribute("data-week")) > 1)).toBe(true);
  });

  it("ruta sólida por avance: hoy sale el primer tema sin terminar de la ruta; el siguiente no se adelanta ni hay aviso de atraso", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(started(spreadAreas()));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("hoy");
    const rows = listed();
    expect(rows[0]!.textContent).toContain("1.1 A");
    expect(rows[0]!.dataset.state).toBe("practicando");
    await click(runTab("general"));
    expect(byTest("run-gate")).toBeNull();
  });

  it("la flecha de un tema ofrece abrir el apunte (.md) o el archivo de práctica", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(twoAreas()));
    const ensure = vi.spyOn(api, "studyViewEnsure").mockResolvedValue({ ok: true, kind: "practica", path: "", created: [], errors: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("hoy");
    expect(byTest("board-menu")).toBeNull();
    await click(work().querySelector("[data-testid=board-arrow]"));
    const menu = byTest("board-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect([...menu.querySelectorAll("[role=menuitem]")].map((b) => b.textContent!.trim())).toEqual(["Abrir apunte (.md)", "Abrir archivo de práctica", "Abrir canvas explicativo", "Asignar al Pomodoro", "Ir a la planeación"]);
    await click(document.querySelector("[data-testid=board-open-practice]"));
    expect(ensure).toHaveBeenCalledWith(F1);
    expect(byTest("board-menu")).toBeNull();
  });

  it("las vistas del área: «Pendientes» queda vacío (nada se atrasa: lo que falta toca hoy) y lo hecho no sale", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(twoAreas()));
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    await view("pendientes");
    expect(listed()).toHaveLength(0);
    await view("hoy");
    expect(listed()).toHaveLength(1);
    expect(listed()[0]!.querySelector("[data-testid=board-tag]")!.textContent).toMatch(/Hoy/);
    await click(runTab("area:s2"));
    await view("pendientes");
    expect(byTest("work-empty")!.textContent).toContain("nada pendiente"); // el de Python ya está completo
  });

  it("«Temas de la semana» enseña la semana día a día con lo completado y el nivel de avance, y vale igual para cada área", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    for (const tab of ["area:s1", "area:s2"]) {
      await click(runTab(tab));
      await view("semana");
      const week = byTest("work-week");
      if (!week) {
        // sin nada desde hoy en adelante (y sin avance en los días anteriores) la semana queda en blanco
        expect(byTest("work-empty")).toBeTruthy();
        continue;
      }
      expect(byTest("week-summary")!.textContent).toMatch(/\d+ de \d+ temas completados esta semana/);
      expect(byTest("week-summary")!.textContent).toMatch(/Nivel de avance \d+ %/);
      const days = [...week.querySelectorAll<HTMLElement>("[data-testid=week-day]")];
      expect(days.length).toBeGreaterThan(0);
      expect(days.map((d) => d.dataset.date)).toEqual([...days.map((d) => d.dataset.date)].sort()); // en orden de fecha
      for (const d of days) expect(d.textContent).toMatch(/\d+\/\d+ hechos/);
    }
    // el tema completado de Python sale con su aviso «Hecho»
    expect(byTest("work-week")!.textContent).toContain("Hecho");
  });

  it("la cabecera del área enseña su objetivo y su estado; «Registros» de la barra abre el historial sin salir de la Ejecución", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    expect(byTest("area-header")!.textContent).toContain("Fundamentals");
    expect(byTest("area-subtitle")!.textContent).toBe("Reforzar bases");
    await click(runTab("registros"));
    await flush(); await flush();
    expect(byTest("plan-records")).toBeTruthy();
    expect(byTest("plan-run")).toBeTruthy(); // seguimos en la Ejecución
    expect(runTab("registros")!.getAttribute("aria-current")).toBe("page");
    expect(useNavState.getState().values[MODE_KEY]).not.toBe("planeacion");
  });

  it("en la semana, los días anteriores a hoy enseñan lo mismo que la Agenda (hechos o atrasados, no se ocultan)", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    await mountEl(<PlanWorkspace planId={PID} />);
    for (const tab of ["area:s1", "area:s2"]) {
      await click(runTab(tab));
      await view("semana");
      for (const d of byTest("area-work")!.querySelectorAll<HTMLElement>("[data-testid=week-day]")) {
        if ((d.dataset.date ?? "") >= TODAY) continue;
        const tags = [...d.querySelectorAll("[data-testid=board-topic]")].map((r) => r.querySelector("[data-testid=board-tag]")?.textContent);
        expect(tags.length, d.dataset.date).toBeGreaterThan(0);
        expect(tags.every((t) => t === "Hecho" || t === "Atrasado")).toBe(true); // s1 sin avance pero s2 hecha: la ruta ya empezó, lo no hecho es «Atrasado»
      }
    }
  });

  it("al bloque del Pomodoro se asignan los temas de hoy, el proyecto diario y tareas o proyectos escritos a mano", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    usePomodoro.setState({ p: idlePomodoro(), logVersion: 0 });
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    const panel = byTest("assign-panel")!;
    expect(panel).toBeTruthy();
    expect(byTest("assign-empty")!.textContent).toContain("sesión libre"); // cerrado: solo un resumen de una línea
    expect(byTest("assign-text")).toBeNull();
    await click(byTest("assign-toggle"));
    const today = byTest("assign-today");
    if (today) await click(today);
    const typeInto = async (el: HTMLInputElement, v: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await typeInto(byTest("assign-text") as HTMLInputElement, "Repasar el 422");
    await click(byTest("assign-add"));
    expect(usePomodoro.getState().p.assignedTopics.some((t) => t.kind === "task" && t.title === "Repasar el 422")).toBe(true);
    expect(host.querySelectorAll("[data-testid=assigned-item]").length).toBeGreaterThanOrEqual(1);
    usePomodoro.setState({ p: idlePomodoro() });
  });

  it("la barra de generación en segundo plano solo sale al planificar (modo Plan), no en el día a día (Ejecución)", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const state = { version: 1, planId: PID, id: "e1", status: "running", scope: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tasks: [{ id: "t1", kind: "practice", areaKey: "a", area: "A", title: "T", status: "running", attempts: 0, created: [], skipped: [], warnings: [], label: "x" }], log: [] };
    vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: { state, progress: { done: 0, failed: 0, skipped: 0, pending: 0, running: 1, total: 1, pct: 0, created: 0, label: "x" } }, active: true } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("plan-run")).toBeTruthy();
    expect(byTest("exec-bar")).toBeNull();
    await click(byTest("mentor-mode-planeacion"));
    expect(byTest("exec-bar")).toBeTruthy();
    await click(byTest("mentor-mode-ejecucion"));
    expect(byTest("exec-bar")).toBeNull();
  });

  it("una ejecución a medias (en pausa) NO se reanuda sola: sale un aviso con Reanudar / Descartar y solo el botón reanuda", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const state = { version: 1, planId: PID, id: "e1", status: "paused", scope: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tasks: [{ id: "t1", kind: "practice", areaKey: "a", area: "A", title: "T", status: "pending", attempts: 0, created: [], skipped: [], warnings: [], label: "x" }], log: [] };
    const view = { state, progress: { done: 0, failed: 0, skipped: 0, pending: 1, running: 0, total: 1, pct: 0, created: 0, label: "x" } };
    vi.spyOn(api, "mentorExecutionStatus").mockResolvedValue({ execution: view, active: false } as never);
    const resume = vi.spyOn(api, "mentorExecutionResume").mockResolvedValue({ execution: { ...view, state: { ...state, status: "running" } } } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    await flush();
    expect(byTest("run-resume-banner")!.textContent).toContain("Hay una ejecución a medias: ¿reanudar?");
    expect(byTest("run-discard")).toBeTruthy();
    expect(resume).not.toHaveBeenCalled();
    await click(byTest("run-resume"));
    expect(resume).toHaveBeenCalledWith(PID);
  });

  it("repaso espaciado: los repasos de los temas del área salen por cajón con su acceso directo a la práctica, y la pestaña avisa", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    const item = (topicPath: string, inDays: number) => ({ path: `Programación/Repaso/${topicPath.split("/").pop()}.md`, topic: topicPath.split("/").pop()!, topicPath, subject: "programming", subjectFolder: "Programación", next: "2026-10-12", last: "2026-10-09", level: 1, inDays, skills: ["explain"], practicedDays: 1, upcoming: [] });
    vi.spyOn(api, "studyReviewsList").mockResolvedValue({ today: TODAY, items: [item(F1, 0), item(F2, 5), item("Programación/9 Otro/9.1 Otro", 0)] } as never);
    const ensure = vi.spyOn(api, "studyViewEnsure").mockResolvedValue({ ok: true, kind: "practica", path: "", created: [], errors: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    // la tarjeta general lista el repaso de hoy (solo de temas del plan)
    expect(all("run-review-row")).toHaveLength(1);
    await click(runTab("area:s1"));
    expect(byTest("reviews-due-chip")!.textContent).toContain("1 repaso para hoy");
    await view("repasos");
    const rows = [...work().querySelectorAll<HTMLElement>("[data-testid=review-row]")];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Hoy");
    await click(rows[0]!.querySelector("[data-testid=review-go]"));
    expect(ensure).toHaveBeenCalledWith(F1);
    // el repaso de Python (en 5 días) cae en la próxima semana (hoy es lunes 12)
    await click(runTab("area:s2"));
    await view("repasos");
    expect(work().textContent).toContain("Esta semana");
    expect(work().textContent).toContain("En 5 días");
  });

  const due = (areaId: string, label: string, dates: string[]) =>
    dates.map((date, i) => ({ day: i + 1, date, state: "pending" as const, today: date === TODAY, title: `Kata ${i + 1} de ${label}`, skillName: "Endpoint design", level: 1, minutes: 20, summary: "Resumen", rel: `${areaId}/katas/00${i + 1}.md`, fileReady: false }));
  const areaView = (areaId: string, label: string, dates: string[]) => ({
    areaId, label, folder: areaId, folderReady: true, purpose: "p", name: label, languages: [], ledgerSkill: areaId, level: 1, levelSource: "declared", skills: [],
    kata: {
      skip: { allowed: false, pct: 0, neededPct: 70 }, plannedDays: dates.length, doneDays: 0, streak: 0, todayPlanned: true, todayDone: false, todayIndex: dates.length,
      next: null, week: [], due: due(areaId, label, dates).sort((x, y) => Number(y.today) - Number(x.today) || x.date.localeCompare(y.date)),
    },
    weekly: { title: "w", description: "d", week: 1, focus: false }, weeks: [], monthly: { title: "m", description: "d", blocks: [] },
  });
  const byArea = () => plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }, { ...sub("s2", "Databases", "Consolidar", F2), areaId: "databases" }] as never });

  it("la práctica diaria vive DENTRO de la tarjeta de su área y lista todos los retos por hacer, no solo el de hoy", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(byArea()));
    const dates = ["2026-10-07", "2026-10-08", TODAY];
    vi.spyOn(api, "mentorAreaPractice").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "Programación/programming_practice", areas: [areaView("backend", "Backend", dates), areaView("databases", "Databases", [TODAY])] } as never);
    const open = vi.spyOn(api, "mentorAreaKataOpen").mockResolvedValue({ rel: "Programación/programming_practice/backend/katas/001.md", created: true, date: "2026-10-07" });
    const mark = vi.spyOn(api, "mentorAreaKataMark").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "", areas: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("area:s1"));
    // ya no hay una sección «Práctica de hoy» aparte ni kata de lógica general
    expect(byTest("run-practice")).toBeNull();
    expect(host.textContent).not.toContain("Kata de lógica");
    await view("hoy");
    const backend = host.querySelector<HTMLElement>("[data-testid=run-area-tab][data-area=backend]")!;
    const block = backend.querySelector("[data-testid=area-practice-block]")!;
    expect(block).toBeTruthy();
    // 3 retos que tocaban hasta hoy: hoy primero y luego los atrasados del más antiguo al más reciente
    expect(block.querySelector("[data-testid=area-practice-count]")!.textContent).toContain("3 retos por hacer");
    const rows = [...block.querySelectorAll("[data-testid=kata-row]")] as HTMLElement[];
    expect(rows.map((r) => r.dataset.date)).toEqual([TODAY, "2026-10-07", "2026-10-08"]);
    expect(rows[1]!.textContent).toContain("Atrasado");
    // el acceso directo: la flecha de un kata atrasado abre ESE kata aunque su archivo aún no exista
    await click(rows[1]!.querySelector("[data-testid=board-arrow]"));
    expect([...byTest("board-menu")!.querySelectorAll("[role=menuitem]")].map((b) => b.textContent!.trim())).toEqual(["Abrir kata (.md)", "Verificar y marcar hecho", "Saltar este día (pide 70 %)", "Asignar al Pomodoro", "Ver práctica de Backend"]);
    await click(document.querySelector("[data-testid=kata-open]"));
    expect(open).toHaveBeenCalledWith(PID, "backend", "2026-10-07");
    // y se marca el día concreto con la casilla
    await click(rows[1]!.querySelector("[data-testid=kata-check]"));
    expect(mark).toHaveBeenCalledWith(PID, "backend", "2026-10-07", "done");
  });

  it("si faltan las carpetas de las áreas NO las crea al montar: avisa y las crea solo al pulsar el botón", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(byArea()));
    const missing = { ...areaView("backend", "Backend", [TODAY]), folderReady: false };
    vi.spyOn(api, "mentorAreaPractice").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "Programación/programming_practice", areas: [missing] } as never);
    const setup = vi.spyOn(api, "mentorAreaPracticeSetup").mockResolvedValue({ created: ["backend/README.md"], folders: [], view: { today: TODAY, ppReady: true, ppBase: "", areas: [missing] } } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    await flush();
    expect(setup).not.toHaveBeenCalled();
    expect(byTest("run-missing-folders")!.textContent).toContain("Faltan carpetas de práctica en 1 área");
    await click(byTest("run-create-folders"));
    await flush();
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(PID);
  });

  it("el proyecto semanal y el mensual están en «Proyectos» y el diario en la pestaña de cada área", async () => {
    const p = plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }, { ...sub("s2", "Databases", "Consolidar", F2), areaId: "databases" }] as never });
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(p));
    vi.spyOn(api, "mentorAreaPractice").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "", areas: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    // los proyectos tienen su propia pestaña: semanal y mensual
    expect(byTest("run-projects")).toBeNull();
    await click(runTab("proyectos"));
    expect(byTest("run-next")).toBeNull(); // «Lo que viene» es solo del resumen general
    const projects = byTest("run-projects")!;
    expect(byTest("run-project-weekly")!.textContent).toContain("Proyecto semanal");
    expect(projects.textContent).not.toContain("por definir");
    expect(projects.textContent).toContain("Entregable del mes");
    expect(byTest("weekly-areas")!.textContent).toContain("Resultado real");
    // El proyecto diario está en la pestaña de CADA área (no en «Proyectos»)
    await click(runTab("area:s1"));
    expect(byTest("area-daily-project")).not.toBeNull();
  });
});

describe("Bases: no son de la ruta de ningún área", () => {
  const B1 = "Programación/1 Fundamentals/1.7 Specifying a problem";
  const B2 = "Programación/1 Fundamentals/1.8 Algorithms";
  const K1 = "Programación/4 Backend/4.2 HTTP";
  const topic = (folder: string, group: string, w = 1) => ({ folder, title: folder.split("/").pop()!, targetWeek: w, estMinutes: 30, group });
  const groups = [{ id: "bases", title: "Bases", kind: "bases", order: 1 }, { id: "core", title: "Conocimientos de backend", kind: "knowledge", order: 2 }];
  const withBases = () => plan({
    structure: "areas",
    subplans: [
      { ...sub("s1", "Backend", "x", K1), areaId: "backend", groups, topics: [topic(B1, "bases"), topic(B2, "bases", 2), topic(K1, "core")] },
      { ...sub("s2", "Frontend", "y", F2), areaId: "frontend", groups: [groups[0], { id: "fe", title: "Frontend", kind: "knowledge", order: 2 }], topics: [topic(B1, "bases"), topic(F2, "fe")] },
    ] as never,
  });

  it("la ruta de un área deja fuera los temas de Bases, que van juntos y sin repetirse en su propia pestaña", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(withBases()));
    vi.spyOn(api, "mentorAreaPractice").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "", areas: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(runTab("bases")).toBeTruthy();
    await click(runTab("area:s1"));
    for (const v of ["hoy", "semana", "pendientes"]) {
      await view(v);
      expect(work().textContent, `vista ${v}`).not.toMatch(/1\.7 Specifying|1\.8 Algorithms/); // Bases no es de la ruta de Backend
    }
    await click(runTab("bases"));
    expect(work().querySelector("h2")!.textContent).toBe("Bases de programación");
    // 1.7 está en Backend y en Frontend: en Bases sale una sola vez cada día (los temas largos sí se repiten en varios días)
    await view("semana");
    for (const day of work().querySelectorAll("[data-testid=week-day]")) {
      const n = [...day.querySelectorAll("[data-testid=board-topic]")].filter((r) => r.textContent!.includes("1.7 Specifying")).length;
      expect(n).toBeLessThanOrEqual(1);
    }
    await view("pendientes");
    expect(work().textContent).toMatch(/1\.8 Algorithms|nada pendiente/);
  });
});

describe("pestaña «Mi plan»: sub-barra de secciones y aviso de lo que falta generar", () => {
  const coverage = (practice: number) => ({
    loading: false as const,
    coverage: { areas: [], totals: { topics: 2, theory: 2, practice, outOfPlan: 0 }, ppReady: true },
    review: null,
    aiConfigured: true,
  });
  const openPlanTab = async () => {
    useNavState.setState({ values: { [MODE_KEY]: "planeacion" } });
    await mountEl(<PlanWorkspace planId={PID} />);
  };

  it("avisa arriba del todo de que falta generar los ejercicios y lleva a «Ejecutar plan»", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue(coverage(0) as never);
    await openPlanTab();
    const notice = byTest("generate-notice")!;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain("Falta generar contenido");
    expect(notice.textContent).toContain("2 de 2 temas");
    expect(notice.textContent).toContain("Ejecutar plan");
    // vive arriba de la Vista general, antes que las pestañas
    const tabs = host.querySelector("[role=tablist]")!;
    expect(notice.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector("#sec-generar")).toBeTruthy();
  });

  it("«Ir a Ejecutar plan» cambia a esa sub-vista y la recuerda", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue(coverage(0) as never);
    await openPlanTab();
    await act(async () => { byTest("generate-go")!.click(); });
    expect(useNavState.getState().values[planSectionKey(PID)]).toBe("ejecutar");
    await flush(); await flush();
    expect(host.querySelector("#sec-ejecutar")).toBeTruthy();
    expect(byTest("generate-notice")).toBeNull();
  });

  it("no avisa cuando ya hay ejercicios en todos los temas", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue(coverage(2) as never);
    await openPlanTab();
    expect(byTest("generate-notice")).toBeNull();
  });

  it("la barra lista la Vista general, las áreas y «Más»; la Vista general abre en Semana y el resumen vive en «Detalles»", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue(coverage(0) as never);
    await openPlanTab();
    // la página ya no lleva sub-barra ni sub-ítems anidados en «Mi plan»
    expect(byTest("plan-subnav")).toBeNull();
    expect(subItem("plan")).toBeNull();
    const ids = [...host.querySelectorAll("aside nav > div > button")].map((b) => (b as HTMLElement).dataset.testid!.replace("nav-pl:", ""));
    expect(ids.slice(0, 1)).toEqual(["general"]);
    expect(ids.slice(-3)).toEqual(["registros", "preparar", "cambios"]);
    expect(subItem("general")!.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector("#sec-resumen")).toBeNull(); // la pestaña Semana es la de por defecto
    await click(host.querySelector("#page-tabs-tab-detalles"));
    expect(host.querySelector("#sec-resumen")).toBeTruthy();
    expect(host.querySelector("#sec-datos")).toBeTruthy(); // los datos clave están dentro de Detalles

    await act(async () => { subItem("preparar")!.click(); });
    await flush(); await flush();
    expect(host.querySelector("#sec-preparar")).toBeTruthy();
    expect(host.querySelector("#sec-resumen")).toBeNull();
    expect(subItem("preparar")!.getAttribute("aria-current")).toBe("page");
    expect(useNavState.getState().values[planSectionKey(PID)]).toBe("preparar");
  });

  it("una sub-vista guardada que ya no es visible vuelve a la Vista general", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue(coverage(2) as never);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [planSectionKey(PID)]: "fases" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(subItem("plan/fases")).toBeNull();
    expect(subItem("general")!.getAttribute("aria-current")).toBe("page");
    expect(byTest("plan-agenda")).toBeTruthy();
  });
});

describe("área «Lógica de programación» y proyecto semanal", () => {
  const areasPlan = (extra: unknown[] = []) =>
    plan({ structure: "areas", subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }, { ...sub("s2", "Databases", "Consolidar", F2), areaId: "databases" }, ...extra] as never });

  it("un plan por áreas sin lógica ofrece añadirla y lo hace con la operación add_area", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(areasPlan()));
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue({ loading: false, coverage: { areas: [], totals: { topics: 2, theory: 2, practice: 2, outOfPlan: 0 }, ppReady: true }, review: null, aiConfigured: true } as never);
    const change = vi.spyOn(api, "mentorPlanChange").mockResolvedValue({ loading: false, applied: true, plan: areasPlan(), entry: { changed: ["logic"], summary: "ok" } } as never);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    const offer = byTest("add-logic-area")!;
    expect(offer.textContent).toContain("Lógica de programación");
    await click(byTest("add-logic-btn"));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ id: PID, ops: [{ op: "add_area", areaId: "logic" }] }));
  });

  it("si el plan ya tiene el área no se ofrece", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(areasPlan([{ ...sub("s3", "Lógica de programación", "Problemas", F1), areaId: "logic" }])));
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue({ loading: false, coverage: { areas: [], totals: { topics: 3, theory: 3, practice: 3, outOfPlan: 0 }, ppReady: true }, review: null, aiConfigured: true } as never);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("add-logic-area")).toBeNull();
  });

  it("el proyecto full stack de programming_practice va DENTRO del proyecto semanal, no como un proyecto aparte", async () => {
    const p = plan({
      structure: "areas",
      subplans: [{ ...sub("s1", "Backend", "Reforzar bases", F1), areaId: "backend" }] as never,
      programmingPractice: { kata: { minutesPerDay: 30, days: [1, 2, 3, 4, 5, 6, 7] }, weeklyProject: { sessionsPerWeek: 2, minutesPerSession: 60, focusMode: "rotate", weeks: [{ week: 1, start: START, end: "2026-10-12", focus: "backend", sessions: [{ date: TODAY, minutes: 60, phases: ["spec", "construct"] }] }] } } as never,
    });
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded(p));
    vi.spyOn(api, "mentorAreaPractice").mockResolvedValue({ today: TODAY, ppReady: true, ppBase: "", areas: [] } as never);
    await mountEl(<PlanWorkspace planId={PID} />);
    await click(runTab("proyectos"));
    const weekly = byTest("run-project-weekly")!;
    const pp = byTest("run-pp-project")!;
    expect(pp).toBeTruthy();
    expect(weekly.contains(pp)).toBe(true);
    expect(pp.textContent).toContain("cuatro fases");
  });
});

describe("Plan para Antigravity en «Mi plan»", () => {
  const pkg = (order: number, over: Record<string, unknown> = {}) => ({
    id: `exercises-backend-${order}`, order, kind: "exercises", areaKey: "backend", area: "Backend", title: `Ejercicios · Backend (${order}/2)`, why: "30 ejercicios en 2 temas",
    topics: [{ folder: F1, title: "1.1", week: 1, theory: false, cells: [{ skill: "explain", difficulty: 1, write: 3 }] }], files: 30, weeks: [1, 2] as [number, number], ...over,
  });
  const scheme = (written = false) => ({
    version: 1, planId: PID, createdAt: "t", source: "rules", options: { perCell: 3, maxFiles: 150, maxTheory: 8, ladder: false },
    packages: [pkg(1, written ? { written: { at: "t", path: "C:/V/Programación/_handoff/01.md" } } : {}), pkg(2)],
    totals: { packages: 2, files: 60, topics: 1 }, pending: { packages: written ? 1 : 2, files: 30, topics: 1 },
  });

  it("esquematiza con las opciones elegidas, lista los planes y genera uno bajo demanda", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue({ loading: false, coverage: { areas: [], totals: { topics: 2, theory: 2, practice: 2, outOfPlan: 0 }, ppReady: true }, review: null, aiConfigured: true } as never);
    vi.spyOn(api, "mentorHandoffGet").mockResolvedValue({ scheme: null });
    const build = vi.spyOn(api, "mentorHandoffScheme").mockResolvedValue({ loading: false, scheme: scheme(false) } as never);
    const write = vi.spyOn(api, "mentorHandoffWrite").mockResolvedValue({ path: "C:/V/Programación/_handoff/01.md", rel: "x", prompt: "Read it and execute it.", scheme: scheme(true) } as never);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [planSectionKey(PID)]: "antigravity" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    expect(byTest("handoff-panel")).toBeTruthy();
    expect(byTest("handoff-list")).toBeNull();
    await click(byTest("handoff-build"));
    expect(build).toHaveBeenCalledWith(PID, { perCell: 3, maxFiles: 150, ladder: false, ai: true });
    const items = all("handoff-package");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Ejercicios · Backend (1/2)");
    expect(items[0]!.textContent).toContain("30 archivos");
    expect(byTest("handoff-list")!.textContent).toContain("2 planes");
    await click(items[0]!.querySelector("[data-testid=handoff-write]"));
    expect(write).toHaveBeenCalledWith(PID, "exercises-backend-1");
    expect(all("handoff-package")[0]!.dataset.state).toBe("written");
    expect(byTest("handoff-path")!.textContent).toContain("_handoff");
  });

  it("recuerda el último esquema guardado al abrir", async () => {
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue(loaded());
    vi.spyOn(api, "mentorPlanCoverage").mockResolvedValue({ loading: false, coverage: { areas: [], totals: { topics: 2, theory: 2, practice: 2, outOfPlan: 0 }, ppReady: true }, review: null, aiConfigured: false } as never);
    vi.spyOn(api, "mentorHandoffGet").mockResolvedValue({ scheme: scheme(true) } as never);
    useNavState.setState({ values: { [MODE_KEY]: "planeacion", [planSectionKey(PID)]: "antigravity" } });
    await mountEl(<PlanWorkspace planId={PID} />);
    await flush();
    expect(all("handoff-package")).toHaveLength(2);
    expect((byTest("handoff-ai") as HTMLInputElement).disabled).toBe(true);
    expect(byTest("handoff-all")!.textContent).toContain("1 pendientes");
  });
});

