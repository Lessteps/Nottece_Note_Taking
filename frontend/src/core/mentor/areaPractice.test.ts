// Sistema de práctica por área en la vault: crear las carpetas (dryRun y sin sobrescribir), el estado de los katas derivado del ledger y de las
// marcas manuales, y que el kata global de siempre siga funcionando.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kataForDay, kataDatesOfPlan, type KataPlanLike } from "../../lib/areaPracticeSystem.js";
import { AreaPracticeStore, deriveAreaPractice, existingAreaFiles, sanitizeMarks } from "./areaPracticeState.js";
import { createAreaPracticeFolders } from "./areaPracticeFolders.js";
import { kataDates } from "./practiceState.js";

let dir: string;
let pp: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_area_"));
  pp = path.join(dir, "Programación", "programming_practice");
  fs.mkdirSync(pp, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

describe("createAreaPracticeFolders", () => {
  it("dryRun calcula lo que crearía sin tocar el disco", () => {
    const r = createAreaPracticeFolders({ ppDir: pp, areas: ["backend", "frontend"], katasPerArea: 3, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.created).toContain("backend/README.md");
    expect(r.created).toContain("frontend/skills.md");
    expect(r.created.filter((f) => /^backend\/katas\/\d{3} /.test(f))).toHaveLength(3);
    expect(r.folders).toEqual(expect.arrayContaining(["backend", "backend/katas", "backend/projects", "frontend"]));
    expect(walk(pp)).toEqual([]);
  });

  it("crea la carpeta de cada área con sus archivos y katas, e ignora las áreas desconocidas", () => {
    const r = createAreaPracticeFolders({ ppDir: pp, areas: ["backend", "tooling", "nope"], katasPerArea: 4 });
    expect(r.ignored).toEqual(["nope"]);
    expect(r.failed).toEqual([]);
    expect(fs.existsSync(path.join(pp, "backend", "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(pp, "tooling-and-quality", "skills.md"))).toBe(true);
    expect(fs.readdirSync(path.join(pp, "backend", "katas")).filter((f) => /^\d{3} /.test(f))).toHaveLength(4);
    // el contenido de un kata es la nota de ejercicio de la plantilla
    const k = kataForDay("backend", 1, 1)!;
    expect(fs.readFileSync(path.join(pp, "backend", "katas", k.file), "utf-8")).toContain("kata_skill: pp_kata:backend");
    expect(fs.existsSync(path.join(dir, "Programación", "backend"))).toBe(false); // nada fuera de programming_practice
  });

  it("NUNCA sobrescribe: lo editado se queda y una segunda ejecución solo añade lo que falta", () => {
    createAreaPracticeFolders({ ppDir: pp, areas: ["backend"], katasPerArea: 2 });
    fs.writeFileSync(path.join(pp, "backend", "README.md"), "MI README", "utf-8");
    const k1 = kataForDay("backend", 1, 1)!;
    fs.writeFileSync(path.join(pp, "backend", "katas", k1.file), "MI KATA", "utf-8");
    const again = createAreaPracticeFolders({ ppDir: pp, areas: ["backend"], katasPerArea: 4 });
    expect(again.created.filter((f) => f.includes("/katas/")).length).toBe(2); // solo los kata 3 y 4
    expect(again.skipped).toEqual(expect.arrayContaining(["backend/README.md", `backend/katas/${k1.file}`]));
    expect(fs.readFileSync(path.join(pp, "backend", "README.md"), "utf-8")).toBe("MI README");
    expect(fs.readFileSync(path.join(pp, "backend", "katas", k1.file), "utf-8")).toBe("MI KATA");
    // un tercer intento no crea nada
    expect(createAreaPracticeFolders({ ppDir: pp, areas: ["backend"], katasPerArea: 4 }).created).toEqual([]);
  });

  it("existingAreaFiles lee lo que hay (carpetas y katas) sin lanzar", () => {
    expect(existingAreaFiles(null, ["backend"])).toEqual({ folders: new Set(), files: new Set() });
    createAreaPracticeFolders({ ppDir: pp, areas: ["backend"], katasPerArea: 2 });
    const e = existingAreaFiles(pp, ["backend", "frontend"]);
    expect([...e.folders]).toEqual(["backend"]);
    expect(e.files.size).toBeGreaterThanOrEqual(3);
  });
});

describe("kataDates: el kata global sigue igual y cada área filtra los suyos", () => {
  const attempts = {
    g: { note_id: "g", note_path: "Programación/programming_practice/kata/Ejercicios/pp_kata/a.md", attempts: [{ at: "2026-10-05T10:00:00", skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] },
    b: { note_id: "b", note_path: "Programación/programming_practice/backend/katas/001 x.md", attempts: [{ at: "2026-10-06T10:00:00", skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] },
    f: { note_id: "f", note_path: "Programación/programming_practice/frontend/katas/001 y.md", attempts: [{ at: "2026-10-07T10:00:00", skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] },
    l: { note_id: "l", note_path: "otra/nota.md", attempts: [{ at: "2026-10-08T10:00:00", skill: "pp_kata:backend", verdict: "correct", score: 90 }, { at: "2026-10-09T10:00:00", skill: "implement" }] },
  };
  it("sin área cuenta todos los katas (comportamiento de siempre) y no el resto de skills", () => {
    expect([...kataDates(attempts)].sort()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });
  it("con área solo cuenta los de esa carpeta o con la skill pp_kata:<área>", () => {
    expect([...kataDates(attempts, { id: "backend", folder: "backend" })].sort()).toEqual(["2026-10-06", "2026-10-08"]);
    expect([...kataDates(attempts, { id: "frontend", folder: "frontend" })]).toEqual(["2026-10-07"]);
    expect([...kataDates(attempts, { id: "databases", folder: "databases" })]).toEqual([]);
  });
});

describe("estado derivado por área", () => {
  const plan: KataPlanLike & { id: string } = {
    id: "p",
    start: "2026-10-05",
    end: "2026-11-01",
    programmingPractice: { kata: { days: [1, 2, 3, 4, 5], minutesPerDay: 25 } },
    preconditions: { blockedDates: [], levels: { Programación: "basico" } },
    subplans: [{ area: "Backend", areaId: "backend" }, { area: "Frontend", areaId: "frontend" }],
  };
  const att = (note: string, ...dates: string[]) => ({ note_id: note, note_path: `Programación/programming_practice/${note}/katas/001 x.md`, attempts: dates.map((d) => ({ at: `${d}T10:00:00`, skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 })) });
  const base = { plan, attempts: { b: att("backend", "2026-10-05", "2026-10-06", "2026-10-08"), f: att("frontend", "2026-10-05") }, marks: {}, existing: { folders: new Set(["backend"]), files: new Set<string>() } };

  it("mantiene pendiente el primer kata si se completa antes uno posterior", () => {
    const record = { note_path: "Programación/programming_practice/backend/katas/002 second.md", attempts: [{ at: "2026-10-05T10:00:00", skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] };
    const actual = deriveAreaPractice({ ...base, attempts: { two: record }, today: "2026-10-05" });
    expect(actual[0]!.kata.doneDays).toBe(1);
    expect(actual[0]!.kata.completedIndices).toEqual([2]);
    expect(actual[0]!.kata.next!.kata.day).toBe(1);
  });

  it("avanza varios katas distintos completados el mismo día sin contar repeticiones", () => {
    const record = (file: string) => ({ note_path: `Programación/programming_practice/backend/katas/${file}`, attempts: [{ at: "2026-10-05T10:00:00", skill: "pp_kata", mode: "pp_kata", verdict: "correct", score: 90 }] });
    const actual = deriveAreaPractice({ ...base, attempts: { one: record("001 first.md"), two: record("002 second.md"), retry: record("002 second.md") }, today: "2026-10-05" });
    expect(actual[0]!.kata.doneDays).toBe(2);
    expect(actual[0]!.kata.next!.kata.day).toBe(3);
  });

  it("katas hechos, racha, progreso por habilidad y semana de lunes a domingo", () => {
    const [b, f] = deriveAreaPractice({ ...base, today: "2026-10-08" });
    expect(b!.areaId).toBe("backend");
    expect(b!.kata).toMatchObject({ plannedDays: 4, doneDays: 3, todayPlanned: true, todayDone: true, todayIndex: 4 });
    expect(b!.kata.streak).toBe(1); // hoy (08) está hecho y el 07 no: la racha es solo hoy
    expect(f!.kata).toMatchObject({ doneDays: 1, todayDone: false });
    // se hicieron 3 katas (en las fechas que sean): cuentan los tres primeros, el 4.º (hoy) sigue pendiente
    expect(b!.skills.slice(0, 4).map((s) => `${s.done}/${s.planned}`)).toEqual(["1/1", "1/1", "1/1", "0/1"]);
    expect(b!.skills[0]!.pct).toBe(100);
    expect(b!.kata.week.map((d) => d.state)).toEqual(["done", "done", "done", "pending", "pending", "none", "none"]);
    expect(b!.kata.week.find((d) => d.today)!.date).toBe("2026-10-08");
    expect(b!.folderReady).toBe(true);
    expect(f!.folderReady).toBe(false);
    expect(b!.level).toBe(1);
    // el kata siguiente es el 4.º (el primero sin hacer), con su ruta y su resumen
    expect(b!.kata.next!.kata.id).toBe("backend-004");
    expect(b!.kata.next!.rel).toBe(`backend/katas/${b!.kata.next!.kata.file}`);
    expect(b!.kata.next!.summary.length).toBeGreaterThan(20);
    expect(b!.kata.next!.fileReady).toBe(false);
  });

  it("el kata no avanza con el calendario: pasan los días y sigue siendo el primero sin hacer", () => {
    const none = { ...base, attempts: {} };
    const day1 = deriveAreaPractice({ ...none, today: "2026-10-05" })[0]!;
    const week3 = deriveAreaPractice({ ...none, today: "2026-10-23" })[0]!;
    expect(day1.kata.next!.kata.id).toBe("backend-001");
    expect(week3.kata.next!.kata.id).toBe("backend-001");
    expect(week3.kata.doneDays).toBe(0);
    expect(week3.kata.due.map((k) => k.day)).toEqual([1]);
    expect(week3.level).toBe(1);
    // hacer uno (aunque sea fuera de su fecha) lo avanza al siguiente
    const one = deriveAreaPractice({ ...none, attempts: { b: att("backend", "2026-10-23") }, today: "2026-10-23" })[0]!;
    expect(one.kata.next!.kata.id).toBe("backend-002");
  });

  it("un kata ADELANTADO y hecho se consume una vez: su día original deja de listarse y la secuencia no se salta nada", () => {
    const withExtra = (x: Array<{ id: string; kind: string; date: string; area: string; kataDate: string; title: string; done: boolean }>) => ({ ...base, attempts: { b: att("backend", "2026-10-05") }, plan: { ...plan, subplans: [{ id: "s-be", area: "Backend", areaId: "backend" }, { id: "s-fe", area: "Frontend", areaId: "frontend" }], extraPractice: x } });
    const ahead = { id: "x1", kind: "kata" as const, date: "2026-10-06", area: "s-be", kataDate: "2026-10-09", title: "k", done: true };
    const plain = deriveAreaPractice({ ...withExtra([]), today: "2026-10-06" })[0]!;
    const b = deriveAreaPractice({ ...withExtra([ahead]), today: "2026-10-06" })[0]!;
    expect(plain.kata.consumed).toEqual([]);
    expect(b.kata.consumed).toEqual(["2026-10-09"]);
    // el original (vie 9, kata nº 5) ya no cuenta ni se lista en la semana; hoy sigue tocando el nº 2
    expect(plain.kata.week.map((d) => d.planned)).toEqual([true, true, true, true, true, false, false]);
    expect(b.kata.week.map((d) => d.planned)).toEqual([true, true, true, true, false, false, false]);
    expect(b.kata.next!.kata.id).toBe("backend-002");
    expect(b.kata.todayIndex).toBe(2);
    // el kata adelantado (nº 5) cuenta como hecho en su habilidad
    expect(b.skills.reduce((n, s) => n + s.done, 0)).toBe(2);
    // al hacer los katas 2, 3 y 4 en sus días, el siguiente salta el 5 (consumido) y es el 6
    const later = deriveAreaPractice({ ...withExtra([ahead]), attempts: { b: att("backend", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08") }, today: "2026-10-12" })[0]!;
    expect(later.kata.next!.kata.id).toBe("backend-006");
    // sin hacerlo (aún no `done`, sin intento ese día) no se consume
    expect(deriveAreaPractice({ ...withExtra([{ ...ahead, done: false }]), today: "2026-10-06" })[0]!.kata.consumed).toEqual([]);
    // hecho por intento verificado en un día que no es de kata (sábado 10): se consume y ese intento no cuenta como kata del calendario
    const sat = deriveAreaPractice({ ...withExtra([{ ...ahead, date: "2026-10-10", done: false }]), attempts: { b: att("backend", "2026-10-05", "2026-10-10") }, today: "2026-10-10" })[0]!;
    expect(sat.kata.consumed).toEqual(["2026-10-09"]);
    expect(sat.kata.doneDays).toBe(1);
  });

  it("las marcas manuales cuentan, se pueden quitar y se guardan solo en los datos de la app", () => {
    const store = new AreaPracticeStore(dir);
    store.mark("p", "frontend", "2026-10-06", "done");
    store.mark("p", "frontend", "2026-10-07", "skipped");
    const marks = store.load("p");
    const [, f] = deriveAreaPractice({ ...base, marks, today: "2026-10-08" });
    expect(f!.kata.doneDays).toBe(2); // intento del 05 + marca del 06
    expect(f!.kata.week.map((d) => d.state).slice(0, 4)).toEqual(["done", "done", "skipped", "pending"]);
    store.mark("p", "frontend", "2026-10-06", null);
    expect(store.load("p")).toEqual({ frontend: { "2026-10-07": "skipped" } });
    expect(fs.existsSync(path.join(dir, ".notevault", "mentor", "area-practice", "p.json"))).toBe(true);
    expect(walk(path.join(dir, "Programación")).filter((f) => f.endsWith(".md"))).toEqual([]);
  });

  it("el nivel sube con los katas hechos (cada 40) y las marcas inválidas se descartan", () => {
    const many = Array.from({ length: 45 }, (_, i) => `2026-${String(Math.floor(i / 28) + 10).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`);
    const long = { ...plan, start: "2026-01-01", end: "2026-12-31", programmingPractice: { kata: { days: [1, 2, 3, 4, 5, 6, 7], minutesPerDay: 25 } } };
    const [b] = deriveAreaPractice({ ...base, plan: long, attempts: { b: att("backend", ...many) }, today: "2026-12-31" });
    expect(b!.kata.doneDays).toBe(45);
    expect(b!.level).toBe(2);
    expect(b!.levelSource).toBe("measured");
    expect(sanitizeMarks({ marks: { backend: { "2026-10-06": "done", "x": "done", "2026-10-07": "mal" }, "Mal Id": { "2026-10-06": "done" } } })).toEqual({ backend: { "2026-10-06": "done" } });
    expect(kataDatesOfPlan(long).length).toBeGreaterThan(300);
  });

  it("sin días de kata no hay estado de kata, pero el área existe", () => {
    const [b] = deriveAreaPractice({ ...base, plan: { ...plan, programmingPractice: undefined }, today: "2026-10-08" });
    expect(b!.kata.next).toBeNull();
    expect(b!.kata.plannedDays).toBe(0);
  });
});
