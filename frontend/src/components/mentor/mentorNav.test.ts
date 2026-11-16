// Mentor — navegación pura: la ruta recordada y sus valores antiguos, el modo por defecto y los ítems de la barra de cada modo.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavState } from "../../store/navState";
import { api } from "../../lib/bridge";
import {
  activePlaneacionId, asMode, defaultModeOf, ejecucionLinks, hasBasesRoute, modeSubject, normalizeTab, openPlanAgenda, openPlanGeneral, openPlanTopic, planeacionLinks, resolvePlanPage, resolveRoute, selectEjecucion, selectPlaneacion, TOPIC_HIGHLIGHT_KEY,
} from "./mentorNav";
import { agendaAreaKey, agendaViewKey, pageTabKey, planSectionKey, planTabKey } from "./planShared";

const plans = [
  { id: "a", status: "futuro" as const },
  { id: "b", status: "activo" as const },
];
const base = { plans, plansLoaded: true, builds: [{ id: "k" }], buildsLoaded: true };
const route = (stored: string, over: Partial<typeof base> = {}) => resolveRoute({ stored, ...base, ...over });

describe("resolveRoute", () => {
  it("un plan o una construcción existentes se abren tal cual", () => {
    expect(route("plan:a")).toEqual({ kind: "plan", planId: "a" });
    expect(route("build:k")).toEqual({ kind: "build", buildId: "k" });
  });

  it("sin elegir abre el plan en curso, o el primero, o el resumen si no hay planes", () => {
    expect(route("")).toEqual({ kind: "plan", planId: "b" });
    expect(route("", { plans: [{ id: "a", status: "futuro" }] })).toEqual({ kind: "plan", planId: "a" });
    expect(route("", { plans: [] })).toEqual({ kind: "overview", creating: false });
    // mientras la lista de planes no ha cargado no se adivina ninguno
    expect(route("", { plansLoaded: false })).toEqual({ kind: "overview", creating: false });
  });

  it("un plan o una construcción que ya no existen vuelven al plan en curso; sin cargar la lista se confía en lo guardado", () => {
    expect(route("plan:zzz")).toEqual({ kind: "plan", planId: "b" });
    expect(route("build:zzz")).toEqual({ kind: "plan", planId: "b" });
    expect(route("plan:zzz", { plansLoaded: false })).toEqual({ kind: "plan", planId: "zzz" });
    expect(route("build:zzz", { buildsLoaded: false })).toEqual({ kind: "build", buildId: "zzz" });
  });

  it("los valores antiguos de la barra siguen siendo rutas válidas (ocultas), «plan» es el resumen y «nuevo» abre el formulario", () => {
    for (const v of ["hoy", "cierre", "metas", "proyectos", "notas"] as const) expect(route(v)).toEqual({ kind: "aux", view: v });
    expect(route("plan")).toEqual({ kind: "overview", creating: false });
    expect(route("nuevo")).toEqual({ kind: "overview", creating: true });
  });

  it("un valor desconocido no rompe: cae al plan en curso", () => {
    expect(route("inventado")).toEqual({ kind: "plan", planId: "b" });
  });
});

describe("modo", () => {
  it("por defecto, Ejecución para un plan mantenido y Planeación para uno propuesto, terminado o inexistente", () => {
    expect(defaultModeOf({ status: "activo" })).toBe("ejecucion");
    expect(defaultModeOf({ status: "futuro" })).toBe("ejecucion");
    expect(defaultModeOf({ status: "propuesto" })).toBe("planeacion");
    expect(defaultModeOf({ status: "terminado" })).toBe("planeacion");
    expect(defaultModeOf(undefined)).toBe("planeacion");
  });

  it("lo guardado manda sobre el defecto; un valor inválido se ignora", () => {
    expect(asMode("planeacion", "ejecucion")).toBe("planeacion");
    expect(asMode("ejecucion", "planeacion")).toBe("ejecucion");
    expect(asMode("plan", "ejecucion")).toBe("ejecucion");
    expect(asMode("", "planeacion")).toBe("planeacion");
  });

  it("sin la fila del listado, el estado sale del propio plan", () => {
    expect(modeSubject({ status: "activo" }, null)).toEqual({ status: "activo" });
    expect(modeSubject(undefined, null)).toBeUndefined();
    expect(modeSubject(undefined, { proposed: true })).toEqual({ status: "propuesto" });
    expect(modeSubject(undefined, { archived: true })).toEqual({ status: "terminado" });
    expect(modeSubject(undefined, {})).toEqual({ status: "activo" });
  });
});

const group = (kind: "bases" | "none") => ({ id: "g1", title: "Bases", kind: kind === "bases" ? "bases" : "knowledge", order: 1 });
const topic = (folder: string, g?: string) => ({ folder, title: folder, ...(g ? { group: g } : {}) });
const sub = (id: string, area: string, areaId: string | undefined, withBases = false) =>
  ({ id, area, ...(areaId ? { areaId } : {}), topics: [topic(`${id}/a`, withBases ? "g1" : undefined)], ...(withBases ? { groups: [group("bases")] } : {}) }) as never;
const planWith = (subplans: unknown[], practice = false) => ({ subplans, ...(practice ? { programmingPractice: {} as never } : {}) }) as never;

describe("ítems de Planeación", () => {
  it("Vista general, una página por área (en el orden fijo) y «Más» con Entregables, Registros, Preparar plan y Preguntas y ajustes", () => {
    const l = planeacionLinks(planWith([sub("s2", "Frontend", "frontend"), sub("s1", "Backend", "backend")]));
    expect(l.map((x) => x.label)).toEqual(["Vista general", "Backend", "Frontend", "Agregar una nueva área", "Entregables", "Registros", "Preparar plan", "Preguntas y ajustes"]);
    expect(l.map((x) => x.id)).toEqual(["pl:general", "pl:area/s1", "pl:area/s2", "pl:add-area", "pl:entregables", "pl:registros", "pl:preparar", "pl:cambios"]);
    // sin sub-ítems anidados: ya no hay «Agenda › Día · Semana · Mes · Calendario» ni «Mi plan› Resumen…»
    expect(l.every((x) => !x.subs)).toBe(true);
    // los rótulos de sección y las áreas
    expect(l.find((x) => x.id === "pl:general")).toMatchObject({ section: "Planificación" });
    expect(l.find((x) => x.id === "pl:entregables")!.section).toBe("Más");
    expect(l.filter((x) => x.section).length).toBe(2);
    expect(l.find((x) => x.id === "pl:area/s1")!.areaId).toBe("backend");
    expect(l.find((x) => x.id === "pl:area/s2")!.areaId).toBe("frontend");
  });

  it("«Bases» va la última de las áreas solo si el plan tiene fundamentos; «Práctica» solo si tiene la pista", () => {
    const l = planeacionLinks(planWith([sub("s1", "Backend", "backend", true)], true));
    expect(l.map((x) => x.label)).toEqual(["Vista general", "Backend", "Agregar una nueva área", "Bases", "Entregables", "Registros", "Preparar plan", "Práctica", "Preguntas y ajustes"]);
    expect(l.some((x) => x.id === "pl:bases")).toBe(true);
  });

  it("la pista de cada área es su avance «hechos/ruta» (el mismo de la Ejecución)", () => {
    const hints = new Map([["area:s1", { done: 3, total: 12, due: 2 }], ["bases", { done: 0, total: 0, due: 0 }]]);
    const l = planeacionLinks(planWith([sub("s1", "Backend", "backend")]), 0, { hints });
    expect(l.find((x) => x.id === "pl:area/s1")!.hint).toBe("3/12");
  });

  it("las decisiones pendientes de entregables salen como insignia con su lectura", () => {
    const e = planeacionLinks(planWith([]), 2).find((x) => x.id === "pl:entregables")!;
    expect(e.badge).toBe(2);
    expect(e.hint).toBe("2 pendientes de decidir");
    expect(planeacionLinks(planWith([])).find((x) => x.id === "pl:entregables")!.badge).toBeUndefined();
  });

  it("el ítem activo sale de la pestaña, la sub-vista y el área guardadas (claves antiguas incluidas)", () => {
    const ids = ["s1", "s2"];
    // Mi plan: Resumen y Temas por área ahora son la Vista general; Registros y Preparar, ítems de «Más»
    expect(activePlaneacionId("plan", "resumen", "", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("plan", "temas", "", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("plan", "fases", "", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("plan", "preparar", "", ids, false)).toBe("pl:preparar");
    expect(activePlaneacionId("plan", "ejecutar", "", ids, false)).toBe("pl:preparar");
    expect(activePlaneacionId("plan", "sec-registros", "", ids, false)).toBe("pl:registros");
    // la Agenda (y «semana», su antigua pestaña) es la página del área elegida, o la Vista general sin área
    expect(activePlaneacionId("agenda", "resumen", "", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("semana", "resumen", "s2", ids, false)).toBe("pl:area/s2");
    expect(activePlaneacionId("agenda", "resumen", "__bases", ids, false)).toBe("pl:bases");
    expect(activePlaneacionId("agenda", "resumen", "ya-no-existe", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("cambios", "resumen", "", ids, false)).toBe("pl:cambios");
    expect(activePlaneacionId("practica", "resumen", "", ids, false)).toBe("pl:general");
    expect(activePlaneacionId("practica", "resumen", "", ids, true)).toBe("pl:practica");
    expect(resolvePlanPage("agenda", "resumen", "s1", ids, false)).toEqual({ kind: "area", subplanId: "s1" });
  });

  it("la pestaña guardada se normaliza: «semana» es la Agenda y «Práctica» exige la pista", () => {
    expect(normalizeTab("semana", false)).toBe("agenda");
    expect(normalizeTab("practica", false)).toBe("plan");
    expect(normalizeTab("practica", true)).toBe("practica");
    expect(normalizeTab("inventada", true)).toBe("plan");
  });
});

describe("selecciones de la barra", () => {
  beforeEach(() => useNavState.setState({ values: {} }));

  it("Planeación escribe las mismas claves que leen la vista del plan y la página del área", () => {
    selectPlaneacion("p1", "pl:registros");
    let v = useNavState.getState().values;
    expect(v[planTabKey("p1")]).toBe("plan");
    expect(v[planSectionKey("p1")]).toBe("registros");
    selectPlaneacion("p1", "pl:area/s2");
    v = useNavState.getState().values;
    expect(v[planTabKey("p1")]).toBe("agenda");
    expect(v[agendaAreaKey("p1")]).toBe("s2");
    selectPlaneacion("p1", "pl:bases");
    expect(useNavState.getState().values[agendaAreaKey("p1")]).toBe("__bases");
    selectPlaneacion("p1", "pl:entregables");
    expect(useNavState.getState().values[planTabKey("p1")]).toBe("entregables");
    // la Vista general: la pestaña «Mi plan», Resumen y sin área
    selectPlaneacion("p1", "pl:general");
    v = useNavState.getState().values;
    expect(v[planTabKey("p1")]).toBe("plan");
    expect(v[planSectionKey("p1")]).toBe("resumen");
    expect(v[agendaAreaKey("p1")]).toBe("");
  });

  it("Ejecución guarda la vista por plan", () => {
    selectEjecucion("p1", "ej:area:s1");
    selectEjecucion("p2", "ej:bases");
    const v = useNavState.getState().values;
    expect(v["mentor.runTab.p1"]).toBe("area:s1");
    expect(v["mentor.runTab.p2"]).toBe("bases");
  });
});

describe("ítems de Ejecución", () => {
  const sub = (id: string, area: string, areaId: string | undefined, bases = false) => ({
    id, area, ...(areaId ? { areaId } : {}),
    groups: bases ? [{ id: "g1", kind: "bases" }] : [],
    topics: bases ? [{ group: "g1", route: "path" }] : [],
  });

  it("Hoy, una por área (en el orden fijo de las áreas), Bases si el plan las tiene, Proyectos y Registros", () => {
    const plan = { subplans: [sub("s2", "Frontend", "frontend"), sub("s1", "Backend", "backend", true)] } as never;
    const l = ejecucionLinks(plan);
    expect(l.map((x) => x.label)).toEqual(["Hoy", "Backend", "Frontend", "Bases", "Prácticas diarias", "Proyectos", "Registros"]);
    expect(l.map((x) => x.tab)).toEqual(["general", "area:s1", "area:s2", "bases", "practicas-diarias", "proyectos", "registros"]);
    expect(l[1]!.id).toBe("ej:area:s1");
  });

  it("sin grupo de Bases en la ruta no hay «Bases»", () => {
    const plan = { subplans: [sub("s1", "Backend", "backend")] } as never;
    expect(hasBasesRoute(plan)).toBe(false);
    expect(ejecucionLinks(plan).map((x) => x.label)).toEqual(["Hoy", "Backend", "Prácticas diarias", "Proyectos", "Registros"]);
  });
});

describe("openPlanTopic, openPlanAgenda, openPlanGeneral", () => {
  beforeEach(() => {
    useNavState.getState().clear();
    vi.spyOn(api, "mentorPlanGet").mockResolvedValue({
      loading: false,
      plan: {
        id: "p1",
        subplans: [
          { id: "sub-1", area: "Backend", areaId: "backend", topics: [{ folder: "P/4/4.1 HTTP" }] },
          { id: "sub-2", area: "Frontend", areaId: "frontend", topics: [{ folder: "P/5/5.1 DOM" }] },
        ],
      },
    } as never);
  });

  it("openPlanTopic resuelve el subplanId correcto a partir del folder y activa temas del área", async () => {
    await openPlanTopic("p1", "P/4/4.1 HTTP");
    const v = useNavState.getState().values;
    expect(v["mentor.mode"]).toBe("planeacion");
    expect(v[agendaAreaKey("p1")]).toBe("sub-1");
    expect(v[pageTabKey("p1", "sub-1")]).toBe("temas");
    expect(v[TOPIC_HIGHLIGHT_KEY]).toBe("P/4/4.1 HTTP");
  });

  it("openPlanAgenda activa el calendario en vista general y área", () => {
    openPlanAgenda("p1", "sub-1");
    const v = useNavState.getState().values;
    expect(v["mentor.mode"]).toBe("planeacion");
    expect(v[planTabKey("p1")]).toBe("agenda");
    expect(v[pageTabKey("p1", "all")]).toBe("calendario");
    expect(v[pageTabKey("p1", "sub-1")]).toBe("calendario");
  });

  it("openPlanGeneral activa la vista general en semana", () => {
    openPlanGeneral("p1");
    const v = useNavState.getState().values;
    expect(v["mentor.mode"]).toBe("planeacion");
    expect(v[planTabKey("p1")]).toBe("plan");
    expect(v[pageTabKey("p1", "all")]).toBe("semana");
  });
});

