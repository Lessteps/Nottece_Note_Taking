// Horario por área: la API valida y guarda, y el calendario general lo usa en vez de apilar desde las 09:00.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppState } from "../appState.js";
import { MentorCalendarSource } from "../../core/mentor/mentorCalendarSource.js";
import { PlanStore } from "../../core/mentor/plan.js";
import { mentorAreaTimesApi } from "./mentorAreaTimes.js";

let dir: string;
let app: AppState;
const PLAN_ID = "2026-10-06_2026-12-20";

const PLAN = {
  id: PLAN_ID,
  start: "2026-10-06",
  end: "2026-12-20",
  structure: "areas" as const,
  subplans: [
    { id: "frontend", area: "Frontend", areaId: "frontend", objective: "UI", topics: [{ folder: "P/5 Frontend/5.1 A", title: "5.1 A", estMinutes: 60, targetWeek: 1 }], weeks: [], requiredGoals: [] },
    { id: "backend", area: "Backend", areaId: "backend", objective: "API", topics: [{ folder: "P/6 Backend/6.1 B", title: "6.1 B", estMinutes: 60, targetWeek: 1 }], weeks: [], requiredGoals: [] },
  ],
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_area_times_"));
  app = new AppState(dir);
  new PlanStore(dir).save(PLAN as never);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("mentor_area_time_set / get", () => {
  it("guarda la hora de un área y la devuelve", () => {
    const api = mentorAreaTimesApi(app);
    expect(api.mentor_area_times_get({ planId: PLAN_ID }).times).toEqual({});
    expect(api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: "18:30", durationMin: 90 }).times).toEqual({ backend: { start: "18:30", durationMin: 90 } });
    expect(api.mentor_area_times_get({ planId: PLAN_ID }).times.backend).toEqual({ start: "18:30", durationMin: 90 });
  });

  it("quitar la hora vuelve al reparto automático", () => {
    const api = mentorAreaTimesApi(app);
    api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: "18:30" });
    expect(api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: null }).times).toEqual({});
  });

  it("rechaza horas mal formadas, duraciones fuera de rango y áreas que no son del plan", () => {
    const api = mentorAreaTimesApi(app);
    expect(() => api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: "25:00" })).toThrow(/HH:MM/);
    expect(() => api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: "10:00", durationMin: 5 })).toThrow(/entre/);
    expect(() => api.mentor_area_time_set({ planId: PLAN_ID, subplanId: "nada", start: "10:00" })).toThrow(/no está en el plan/);
    expect(() => api.mentor_area_times_get({ planId: "../x" })).toThrow(/Plan inválido/);
  });
});

describe("MentorCalendarSource con horario por área", () => {
  const all = (src: MentorCalendarSource) => Object.values(src.occurrences(new Date("2026-10-06T00:00:00"), new Date("2026-12-20T00:00:00"))).flat();

  it("sin horario, apila desde las 09:00; con horario, el área va a su hora", () => {
    const before = all(new MentorCalendarSource(dir));
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((o) => o.id.endsWith(":backend"))).toBe(true);
    expect(before.every((o) => o.start === "09:00" || o.start! > "09:00")).toBe(true);

    mentorAreaTimesApi(app).mentor_area_time_set({ planId: PLAN_ID, subplanId: "backend", start: "19:00", durationMin: 60 });
    const be = all(new MentorCalendarSource(dir)).filter((o) => o.id.endsWith(":backend"));
    expect(be.length).toBeGreaterThan(0);
    expect(be.every((o) => o.start === "19:00" && o.duration_min === 60)).toBe(true);
  });

  it("proyecta los temas de Backend según la sesión real de Full Stack Junior", () => {
    const src = new MentorCalendarSource("/home/drawn/projects/Lessteps/knowledge-base");
    const occs = src.occurrences(new Date("2026-11-08T00:00:00"), new Date("2026-11-08T23:59:59"));
    const dayOccs = occs["2026-11-08"];
    expect(dayOccs).toBeDefined();
    expect(dayOccs!.length).toBeGreaterThan(0);
    const backendOcc = dayOccs!.find((o) => o.id.includes("backend"));
    expect(backendOcc).toBeDefined();
    expect(backendOcc!.start).toBe("06:30");
    const blockLink = backendOcc!.links?.find((l) => l.type === "integrated_block") as any;
    expect(blockLink).toBeDefined();
    expect(blockLink.topics).toBeDefined();
    expect(blockLink.topics.length).toBe(3);
    const titles = blockLink.topics.map((t: any) => t.title);
    expect(titles).toContain("2.1.1 Project structure, virtual environments and imports");
    expect(titles).toContain("4.1 What the backend is");
    expect(titles).toContain("4.1.1 The client-server model and the trust boundary");
  });
});
