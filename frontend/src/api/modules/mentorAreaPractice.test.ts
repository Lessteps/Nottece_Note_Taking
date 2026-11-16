// API del Sistema de práctica por área: estado por área, la práctica que toca en una fecha y las marcas manuales (solo datos de la app).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));
vi.mock("../appConfig.js", () => ({
  AppConfig: { get_ai_config: () => ({ ...hoisted.store }), set_ai_config: (d: Record<string, unknown>) => Object.assign(hoisted.store, d) },
}));

import { createAreaPracticeFolders } from "../../core/mentor/areaPracticeFolders.js";
import { buildPlan, PlanStore } from "../../core/mentor/plan.js";
import { addDays } from "../../lib/planTime.js";
import { AppState } from "../appState.js";
import { clearVaultScanCache } from "../vaultScan.js";
import { mentorApi } from "./mentor.js";
import { practiceApi } from "./practice.js";
import * as aiClient from "../../core/aiClient.js";

let dir: string;
let app: AppState;
let id = "";
const two = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const TODAY = iso(new Date());
const START = addDays(TODAY, -9);
const END = addDays(TODAY, 40);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_areaapi_"));
  fs.mkdirSync(path.join(dir, "Programación", "programming_practice"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Programación", "Programación.resumen.md"), "---\nsubject: programming\n---\n", "utf-8");
  clearVaultScanCache();
  app = new AppState(dir);
  const seed = (n: string) => ({ area: "Programación", objective: n, topics: [{ folder: `Programación/${n}/01 T`, title: `${n} 1`, estMinutes: 60 }] });
  const built = buildPlan([seed("Backend"), seed("Frontend")], { id: `${START}_${END}`, start: START, end: END, minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6, 7], pace: "intenso", from: START, preconditions: { start: START, end: END, minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6, 7], pace: "intenso", goalIds: [], subjects: ["Programación"], levels: {}, deliverables: "no", freeObjective: "x" } as never, name: "Plan" }).plan;
  new PlanStore(dir).save({
    ...built,
    structure: "areas",
    programmingPractice: { kata: { minutesPerDay: 25, days: [1, 2, 3, 4, 5, 6, 7] } },
    subplans: built.subplans.map((s, i) => ({ ...s, areaId: i === 0 ? "backend" : "frontend", area: i === 0 ? "Backend" : "Frontend" })),
  });
  id = built.id;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const api = () => mentorApi(app, vi.fn());

/** Deja en el ledger un intento del kata de un área: calificado (por defecto, aprobado) o sin calificar. */
let seq = 0;
function attempt(areaId: string, date: string, extra: Record<string, unknown> = { verdict: "correct", score: 90 }): void {
  const folder = path.join(dir, ".notevault", "estudio", "intentos");
  fs.mkdirSync(folder, { recursive: true });
  const noteId = `k${seq++}`;
  fs.writeFileSync(path.join(folder, `${noteId}.json`), JSON.stringify({ note_id: noteId, note_path: `Programación/programming_practice/${areaId}/katas/001 x.md`, attempts: [{ at: `${date}T10:00:00`, skill: "pp_kata", mode: "pp_kata", ...extra }] }), "utf-8");
}

describe("mentor_area_practice", () => {
  it("devuelve el sistema de cada área del plan: carpeta aún no creada, katas, habilidades y semanas; solo lee", () => {
    const before = fs.readdirSync(path.join(dir, "Programación", "programming_practice")).length;
    const r: any = api().mentor_area_practice({ id });
    expect(r.today).toBe(TODAY);
    expect(r.ppReady).toBe(true);
    expect(r.ppBase).toBe("Programación/programming_practice");
    expect(r.areas.map((a: any) => a.areaId)).toEqual(["backend", "frontend"]);
    const b = r.areas[0];
    expect(b.folderReady).toBe(false);
    expect(b.kata.plannedDays).toBe(10);
    expect(b.kata.doneDays).toBe(0);
    expect(b.kata.todayPlanned).toBe(true);
    expect(b.kata.next).toMatchObject({ date: TODAY, fileReady: false });
    expect(b.kata.next.kata.skillName).toBeTruthy();
    expect(b.skills.length).toBeGreaterThanOrEqual(5);
    expect(b.weeks.length).toBeGreaterThan(5);
    expect(fs.readdirSync(path.join(dir, "Programación", "programming_practice")).length).toBe(before);
    expect(() => api().mentor_area_practice({ id: "../x" })).toThrow(/Plan inválido/);
  });

  it("cuando la carpeta existe (creada por «Ejecutar plan») lo refleja y el kata de hoy tiene archivo", () => {
    createAreaPracticeFolders({ ppDir: path.join(dir, "Programación", "programming_practice"), areas: ["backend"], katasPerArea: 12 });
    const b = (api().mentor_area_practice({ id }) as any).areas[0];
    expect(b.folderReady).toBe(true);
    expect(b.kata.next.fileReady).toBe(true);
  });

  it("mentor_area_practice_on: un kata por área en una fecha, y nada en una fecha sin kata", () => {
    const on: any = api().mentor_area_practice_on({ id, date: TODAY });
    expect(on.items.map((i: any) => i.areaId)).toEqual(["backend", "frontend"]);
    expect(on.items[0]).toMatchObject({ day: 10, minutes: expect.any(Number), rel: expect.stringMatching(/^backend\/katas\/010 /) });
    expect((api().mentor_area_practice_on({ id, date: addDays(END, 5) }) as any).items).toEqual([]);
    expect(() => api().mentor_area_practice_on({ id, date: "mañana" })).toThrow(/Fecha inválida/);
  });
});

describe("mentor_area_kata_mark", () => {
  it("«hecho» solo se acepta si el kata está verificado: un intento calificado con nota suficiente", () => {
    const err = /aún no está verificado/;
    expect(() => api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" })).toThrow(err);
    attempt("frontend", TODAY, {}); // sin calificar
    expect(() => api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" })).toThrow(err);
    attempt("frontend", TODAY, { verdict: "partial", score: 60 }); // calificado, pero por debajo del aprobado
    expect(() => api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" })).toThrow(err);
    attempt("frontend", TODAY, { verdict: "correct", score: 95, solution_seen: true }); // aprobado viendo la solución
    expect(() => api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" })).toThrow(err);
    attempt("backend", TODAY); // el intento de otra área no sirve
    expect(() => api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" })).toThrow(err);
    attempt("frontend", TODAY);
    const ok: any = api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" });
    expect(ok.areas.find((a: any) => a.areaId === "frontend").kata).toMatchObject({ doneDays: 1, todayDone: true });
  });

  it("un kata solo se puede saltar con el 70 % de los que tocaban hasta hoy hechos y verificados", () => {
    const view = () => (api().mentor_area_practice({ id }) as any).areas.find((a: any) => a.areaId === "backend").kata;
    expect(view().skip).toMatchObject({ allowed: false, pct: 0, neededPct: 70 });
    expect(() => api().mentor_area_kata_mark({ id, areaId: "backend", date: START, status: "skipped" })).toThrow(/al menos el 70 %/);
    // 7 de los 10 katas hechos y verificados: ya se puede saltar uno
    for (let i = 0; i < 7; i++) attempt("backend", addDays(START, i + 1));
    expect(view().skip).toMatchObject({ allowed: true, pct: 70 });
    const r: any = api().mentor_area_kata_mark({ id, areaId: "backend", date: TODAY, status: "skipped" });
    // saltar no avanza: sigue siendo el siguiente kata sin hacer (el 8.º), solo cambia su estado
    expect(r.areas.find((a: any) => a.areaId === "backend").kata.due[0]).toMatchObject({ day: 8, date: TODAY, state: "skipped" });
  });

  it("acepta la verificación de un reto futuro por su archivo sin contar dos veces el intento", () => {
    const future = addDays(TODAY, 1);
    const folder = path.join(dir, ".notevault", "estudio", "intentos"); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "ahead.json"), JSON.stringify({ note_id: "ahead", note_path: "Programación/programming_practice/backend/katas/011 x.md", attempts: [{ at: `${TODAY}T10:00:00`, skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] }));
    const result: any = api().mentor_area_kata_mark({ id, areaId: "backend", date: future, status: "done" });
    expect(result.areas.find((a: any) => a.areaId === "backend").kata.doneDays).toBe(1);
    expect(result.areas.find((a: any) => a.areaId === "backend").kata.next.kata.day).toBe(1);
  });

  it("marca hecho / saltado, se refleja en el estado y se quita; solo escribe datos de la app", () => {
    attempt("frontend", TODAY);
    attempt("backend", START);
    for (let i = 1; i <= 6; i++) attempt("backend", addDays(START, i + 1));
    const done: any = api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: "done" });
    const f = done.areas.find((a: any) => a.areaId === "frontend");
    expect(f.kata).toMatchObject({ doneDays: 1, todayDone: true });
    expect(done.areas.find((a: any) => a.areaId === "backend").kata.doneDays).toBe(7);
    expect(fs.existsSync(path.join(dir, ".notevault", "mentor", "area-practice", `${id}.json`))).toBe(true);
    const gone: any = api().mentor_area_kata_mark({ id, areaId: "frontend", date: TODAY, status: null });
    // quitar la marca no borra el intento verificado: el kata sigue hecho porque lo dice el ledger
    expect(gone.areas.find((a: any) => a.areaId === "frontend").kata.doneDays).toBe(1);
    // ninguna nota de la vault se tocó
    expect(fs.readdirSync(path.join(dir, "Programación")).sort()).toEqual(["Programación.resumen.md", "programming_practice"]);
  });

  it("exige verificación sin bloquear un reto por su fecha y rechaza áreas o estados inválidos", () => {
    expect(() => api().mentor_area_kata_mark({ id, areaId: "backend", date: addDays(TODAY, 1), status: "done" })).toThrow(/aún no está verificado/);
    expect(() => api().mentor_area_kata_mark({ id, areaId: "databases", date: TODAY, status: "done" })).toThrow(/no está en el plan/);
    expect(() => api().mentor_area_kata_mark({ id, areaId: "backend", date: TODAY, status: "raro" })).toThrow(/Estado inválido/);
  });
});

describe("mentor_area_kata_open: el acceso directo al kata siempre existe", () => {
  it("permite abrir cualquier reto planeado anterior o posterior sin depender del día actual", () => {
    const first: any = api().mentor_area_kata_open({ id, areaId: "backend", date: START });
    const next: any = api().mentor_area_kata_open({ id, areaId: "backend", date: addDays(TODAY, 5) });
    expect(first.date).toBe(START);
    expect(next.date).toBe(addDays(TODAY, 5));
    expect(first.rel).not.toBe(next.rel);
  });

  it("crea el kata que toca si falta (y su estructura mínima), devuelve su ruta y no sobrescribe nada", () => {
    const pp = path.join(dir, "Programación", "programming_practice");
    expect(fs.existsSync(path.join(pp, "backend"))).toBe(false);
    const r: any = api().mentor_area_kata_open({ id, areaId: "backend" });
    expect(r.created).toBe(true);
    expect(r.date).toBe(TODAY);
    expect(r.rel.startsWith("Programación/programming_practice/backend/katas/")).toBe(true);
    const abs = path.join(dir, ...r.rel.split("/"));
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.existsSync(path.join(pp, "backend", "skills.md"))).toBe(true);
    // el estado derivado ya ve el archivo
    const view: any = api().mentor_area_practice({ id });
    expect(view.areas[0].kata.next.fileReady).toBe(true);
    // abrir otra vez no lo vuelve a crear ni lo pisa
    fs.appendFileSync(abs, "\nmi respuesta\n", "utf-8");
    const again: any = api().mentor_area_kata_open({ id, areaId: "backend" });
    expect(again.created).toBe(false);
    expect(again.rel).toBe(r.rel);
    expect(fs.readFileSync(abs, "utf-8")).toContain("mi respuesta");
  });

  it("abre los katas de dos áreas en el mismo repositorio mensual y guarda la entrega", async () => {
    const backend: any = api().mentor_area_kata_open({ id, areaId: "backend", date: TODAY });
    const frontend: any = api().mentor_area_kata_open({ id, areaId: "frontend", date: TODAY });
    expect(backend.projectRepo).toBeTruthy();
    expect(frontend.projectRepo).toBe(backend.projectRepo);
    expect(fs.existsSync(path.join(dir, backend.projectRepo, ".git"))).toBe(true);
    Object.assign(hoisted.store, { provider: "lmstudio", base_url: "http://127.0.0.1:1234/v1", model: "test" });
    const spy = vi.spyOn(aiClient, "sendChat").mockResolvedValue(JSON.stringify({ score: 80, verdict: "partial", rubric: [true], errors: [], feedback: "Bien", next_step: "Continuar", example: "" }));
    try {
      const queued: any = await practiceApi(app).practice_grade(backend.rel, "print('borrador')", 0, 0, false, "handoff");
      expect(queued.graded).toBe(false);
      const kataDir = path.join(dir, backend.projectRepo, "backend", "kata-001");
      expect(fs.readdirSync(kataDir).filter((f) => f.startsWith("solucion-"))).toHaveLength(1);
      const result: any = await practiceApi(app).practice_grade(backend.rel, "print('hola')");
      expect(result.graded).toBe(true);
      expect(result.submissionError).toBeUndefined();
      const solutions = fs.readdirSync(kataDir).filter((f) => f.startsWith("solucion-"));
      expect(solutions).toHaveLength(2);
      expect(solutions.map((f) => fs.readFileSync(path.join(kataDir, f), "utf8"))).toContain("print('hola')");
    } finally { spy.mockRestore(); }
  });

  it("vincula una entrega abierta desde el explorador cuando pertenece a un único plan", async () => {
    const pp = path.join(dir, "Programación", "programming_practice");
    const created = createAreaPracticeFolders({ ppDir: pp, areas: ["backend"], katasPerArea: 1 });
    const rel = `Programación/programming_practice/${created.created.find((f) => f.includes("/katas/001 "))}`;
    Object.assign(hoisted.store, { provider: "lmstudio", base_url: "http://127.0.0.1:1234/v1", model: "test" });
    const spy = vi.spyOn(aiClient, "sendChat").mockResolvedValue(JSON.stringify({ score: 80, verdict: "partial", rubric: [true], errors: [], feedback: "Bien", next_step: "Continuar", example: "" }));
    try {
      const result: any = await practiceApi(app).practice_grade(rel, "respuesta directa");
      expect(result.graded).toBe(true);
      expect(result.submissionError).toBeUndefined();
      const repoRoot = path.join(pp, "projects", "daily-practice", id);
      const month = fs.readdirSync(repoRoot)[0]!;
      const solutionDir = path.join(repoRoot, month, "backend", "kata-001");
      expect(fs.readdirSync(solutionDir).filter((f) => f.startsWith("solucion-"))).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it("rechaza un área que no es del plan", () => {
    expect(() => api().mentor_area_kata_open({ id, areaId: "mobile" })).toThrow(/no está en el plan/);
  });
});

describe("katas atrasados y carpetas por área", () => {
  it("solo lista el siguiente kata sin hacer (los días que pasan no apilan atrasados) y hacerlo pasa al siguiente", () => {
    const r: any = api().mentor_area_practice({ id });
    const b = r.areas[0];
    expect(b.kata.plannedDays).toBe(10);
    expect(b.kata.due).toHaveLength(1);
    expect(b.kata.due[0]).toMatchObject({ day: 1, date: TODAY, today: true, state: "pending" });
    expect(b.kata.due[0].title).toBeTruthy();
    // un intento verificado (en la fecha que sea) lo da por hecho y el siguiente pasa a ser el 2.º
    attempt("backend", START);
    const after: any = api().mentor_area_practice({ id });
    expect(after.areas[0].kata.doneDays).toBe(1);
    expect(after.areas[0].kata.due).toHaveLength(1);
    expect(after.areas[0].kata.due[0]).toMatchObject({ day: 2, state: "pending" });
  });

  it("mentor_area_kata_open permite abrir cualquier kata del plan y rechaza fechas ajenas", () => {
    const r: any = api().mentor_area_kata_open({ id, areaId: "backend", date: TODAY });
    expect(r.date).toBe(TODAY);
    expect(r.created).toBe(true);
    expect(r.rel).toContain("001");
    expect(fs.existsSync(path.join(dir, ...r.rel.split("/")))).toBe(true);
    expect(api().mentor_area_kata_open({ id, areaId: "backend", date: START }).date).toBe(START);
    expect(() => api().mentor_area_kata_open({ id, areaId: "backend", date: "2020-01-01" })).toThrow(/no tiene kata/);
  });

  it("mentor_area_practice_setup deja la carpeta de CADA área con su .practica.md, sin katas y sin sobrescribir", () => {
    const pp = path.join(dir, "Programación", "programming_practice");
    const r: any = api().mentor_area_practice_setup({ id });
    for (const f of ["backend", "frontend"]) {
      expect(fs.existsSync(path.join(pp, f, "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(pp, f, `${f}.practica.md`))).toBe(true);
      expect(fs.existsSync(path.join(pp, f, "skills.md"))).toBe(true);
      expect(fs.readdirSync(path.join(pp, f, "katas")).filter((x) => x !== "README.md")).toEqual([]);
    }
    expect(fs.readFileSync(path.join(pp, "frontend", "frontend.practica.md"), "utf-8")).toContain("Accessibility");
    expect(r.view.areas.every((a: any) => a.folderReady)).toBe(true);
    // edita un archivo y vuelve a llamar: no lo pisa y no crea nada nuevo
    fs.appendFileSync(path.join(pp, "backend", "README.md"), "\nmi nota\n", "utf-8");
    const again: any = api().mentor_area_practice_setup({ id });
    expect(again.created).toEqual([]);
    expect(fs.readFileSync(path.join(pp, "backend", "README.md"), "utf-8")).toContain("mi nota");
  });
});
