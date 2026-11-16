// Mentor — pistas de la barra de Ejecución (avance y repasos), «Bases» por lo de hoy, modo antiguo por plan y enlaces profundos a la Ejecución.

import { beforeEach, describe, expect, it } from "vitest";
import { useNavState } from "../../store/navState";
import { ejecucionLinks, openRunView, runHints, runHintText, runTabOfTopic, storedModeOf } from "./mentorNav";

describe("pistas de la Ejecución", () => {
  const topic = (folder: string, extra: object = {}) => ({ folder, title: folder, estMinutes: 30, targetWeek: 1, ...extra });
  const plan = {
    subplans: [
      { id: "s1", area: "Backend", areaId: "backend", groups: [{ id: "b", kind: "bases" }], topics: [topic("P/a"), topic("P/b"), topic("P/c", { route: "skipped" }), topic("P/base", { group: "b" })] },
      { id: "s2", area: "Frontend", areaId: "frontend", groups: [], topics: [topic("P/f")] },
    ],
  } as never;
  const done = (t: { folder: string; completedAt?: string }) => t.folder === "P/a" || t.folder === "P/base" || !!t.completedAt;
  const review = (topicPath: string, inDays: number) => ({ path: `${topicPath}/r.md`, topic: "t", topicPath, next: "2026-10-23", level: 1, inDays, skills: [] });

  it("cuenta temas hechos / de la ruta (sin omitidos ni Bases) y repasos vencidos o de hoy, por vista", () => {
    const h = runHints(plan, done, [review("P/a", 0), review("P/b", -2), review("P/b", 3), review("P/f", 1), review("P/base", 0)]);
    expect(h.get("area:s1")).toEqual({ done: 1, total: 2, due: 2 });
    expect(h.get("area:s2")).toEqual({ done: 0, total: 1, due: 0 });
    expect(h.get("bases")).toEqual({ done: 1, total: 1, due: 1 });
  });

  it("el texto: «hechos/total · N ⟳», sin repasos no hay ⟳, vacío si no hay nada", () => {
    expect(runHintText({ done: 1, total: 2, due: 3 })).toBe("1/2 · 3 ⟳");
    expect(runHintText({ done: 0, total: 4, due: 0 })).toBe("0/4");
    expect(runHintText({ done: 0, total: 0, due: 2 })).toBe("2 ⟳");
    expect(runHintText({ done: 0, total: 0, due: 0 })).toBe("");
    expect(runHintText(undefined)).toBe("");
  });

  it("los ítems llevan la pista, y «Bases» sale también si hoy hay fundamentos aunque la ruta no tenga grupo", () => {
    const noBases = { subplans: [{ id: "s2", area: "Frontend", areaId: "frontend", groups: [], topics: [topic("P/f")] }] } as never;
    const hints = runHints(noBases, () => false, []);
    const links = ejecucionLinks(noBases, { hints });
    expect(links.find((l) => l.tab === "area:s2")!.hint).toBe("0/1");
    expect(links.find((l) => l.tab === "general")!.hint).toBeUndefined();
    expect(links.some((l) => l.tab === "bases")).toBe(false);
    expect(ejecucionLinks(noBases, { hints, basesToday: true }).map((l) => l.tab)).toEqual(["general", "area:s2", "bases", "practicas-diarias", "proyectos", "registros"]);
  });
});

describe("modo antiguo por plan y enlaces profundos a la Ejecución", () => {
  beforeEach(() => useNavState.setState({ values: {} }));

  it("sin modo global se adopta el antiguo del plan activo; el global manda; lo inválido se ignora", () => {
    expect(storedModeOf({ "mentor.planMode.p1": "planeacion" }, "p1")).toBe("planeacion");
    expect(storedModeOf({ "mentor.planMode.p1": "planeacion" }, "p2")).toBe("");
    expect(storedModeOf({ "mentor.mode": "ejecucion", "mentor.planMode.p1": "planeacion" }, "p1")).toBe("ejecucion");
    expect(storedModeOf({ "mentor.planMode.p1": "otro" }, "p1")).toBe("");
    expect(storedModeOf({ "mentor.planMode.p1": "ejecucion" }, undefined)).toBe("");
  });

  it("openRunView deja el plan en modo Ejecución, en esa vista; runTabOfTopic elige Bases o el área", () => {
    openRunView("p1", "area:s2");
    const v = useNavState.getState().values;
    expect(v["mentor.mode"]).toBe("ejecucion");
    expect(v["mentor.runTab.p1"]).toBe("area:s2");
    expect(v["mentor.view"]).toBe("plan:p1");
    expect(runTabOfTopic({ subplanId: "s2" })).toBe("area:s2");
    expect(runTabOfTopic({ subplanId: "s2", bases: true })).toBe("bases");
  });
});
