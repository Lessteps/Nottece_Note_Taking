// Detección del diseño de un tema en un vault temporal: un tema completo y otros incompletos (sin canvas, sin manifiesto, sin práctica,
// con skills que no encajan con el tipo). La puntuación y los faltantes son deterministas.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contractProblems, evaluateTopicDesign, gapsLine, readTheory, requiredDifficulties, summarizeDesign } from "../../lib/topicDesign.js";
import { diskExercises, scanTopicDesigns } from "./topicDesignScan.js";
import { scanVault } from "../practice/exerciseIndex.js";

import { PRACTICA, THEORY } from "./designFixtures.js";
const EXERCISE = (skill: string, difficulty: number) => ({ path: "", rel: "", skill, mode: skill, difficulty });

let dir: string;
const put = (rel: string, text = "x") => {
  const abs = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf-8");
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_design_"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const BASE = "Programación/4 Backend";
const skills = ["pg_true_false", "design", "implement"];

describe("lectura del contrato de la nota de teoría", () => {
  it("cuenta ejemplos, errores y tarjetas e ignora los # de dentro de los bloques de código", () => {
    const r = readTheory(THEORY());
    expect(r).toMatchObject({ topicType: "mixed", examples: 3, mistakes: 4, cards: 6 });
    expect(r.hasSections).toMatchObject({ requires: true, whatItIs: true, mentalModel: true, cards: true });
    expect(contractProblems(r)).toEqual([]);
  });
  it("lista lo que falta en frases concretas, también con los encabezados en español", () => {
    const p = contractProblems(readTheory(THEORY("mixed", { examples: 2, mistakes: 1, cards: 3 })));
    expect(p).toEqual(["Examples tiene 2 de 3 ejemplos", "Common mistakes tiene 1 de 3 errores", "Cards tiene 3 de 6 tarjetas"]);
    expect(contractProblems(readTheory(THEORY("mixed", { cardsSection: false })))).toContain("falta la sección Cards");
    expect(contractProblems(readTheory("# X\n\n## Explicación\n### Qué es\n### Modelo mental\n## Ejemplos\n## Tarjetas\n"))).toEqual(["falta la sección Requires", "Examples tiene 0 de 3 ejemplos", "falta la sección Common mistakes", "falta la sección Connections", "Cards tiene 0 de 6 tarjetas"]);
  });
});

describe("evaluateTopicDesign / scanTopicDesigns en un vault temporal", () => {
  it("un tema completo puntúa 100 y no tiene faltantes", () => {
    const f = `${BASE}/4.3 REST API design`;
    put(`${f}/4.3 REST API design.md`, THEORY());
    put(`${f}/4.3 REST API design — mapa.canvas`, "{}");
    put(`${f}/4.3 REST API design.practica.md`, PRACTICA(skills));
    const exercises = skills.flatMap((s) => [1, 2, 3].filter((d) => !(s === "design" && d === 1)).map((d) => EXERCISE(s, d))).map((e) => ({ ...e, rel: `${f}/Ejercicios/${e.skill}/x.md` }));
    const d = scanTopicDesigns([{ folder: f, title: "REST", subject: "programming" }], { root: dir, exercises }).get(f)!;
    expect(d.gaps).toEqual([]);
    expect(d).toMatchObject({ score: 100, complete: true, topicType: "mixed", branch: "backend", profile: "programming" });
    expect(d.items.map((i) => i.id)).toEqual(["theory", "contract", "canvas", "manifest", "skills_fit", "branch_skills", "practice_basic", "practice_ladder"]);
  });

  it("sin canvas, sin manifiesto y sin práctica: faltantes concretos con su acción y puntuación baja", () => {
    const a = `${BASE}/4.4 A`; // teoría y nada más
    const b = `${BASE}/4.5 B`; // teoría + canvas + manifiesto, sin ejercicios
    put(`${a}/4.4 A.md`, THEORY());
    put(`${b}/4.5 B.md`, THEORY());
    put(`${b}/4.5 B — mapa.canvas`, "{}");
    put(`${b}/4.5 B.practica.md`, PRACTICA(skills));
    const map = scanTopicDesigns([{ folder: a, title: "A", subject: "programming" }, { folder: b, title: "B", subject: "programming" }, { folder: `${BASE}/4.9 No existe`, title: "Z", subject: "programming" }], { root: dir, exercises: [] });
    const da = map.get(a)!;
    expect(da.complete).toBe(false);
    expect(da.gaps.map((g) => `${g.artifact}:${g.fix}`)).toEqual(["canvas:canvas", "manifest:manifest", "practice_basic:manifest"]);
    expect(da.gaps[0]!.text).toBe("Falta el canvas del tema");
    expect(da.gaps[1]!.text).toBe("Sin manifiesto de skills (.practica.md)");
    expect(da.score).toBe(40); // teoría 25 + contrato 15 (sin canvas, manifiesto ni práctica)
    const db = map.get(b)!;
    expect(db.gaps.filter((g) => g.level === "required").map((g) => g.text)).toEqual(["Sin práctica en la skill `pg_true_false`", "Sin práctica en la skill `design`", "Sin práctica en la skill `implement`"]);
    expect(db.gaps.every((g) => g.fix === "practice")).toBe(true);
    expect(gapsLine(db)).toContain("Sin práctica en la skill");
    expect(db.score).toBeGreaterThan(da.score);
    const dz = map.get(`${BASE}/4.9 No existe`)!;
    expect(dz.gaps).toEqual([expect.objectContaining({ fix: "topic", text: "La carpeta del tema no existe en la vault" })]);
    expect(dz.score).toBe(0);
    const sum = summarizeDesign([da, db, dz]);
    expect(sum).toMatchObject({ topics: 3, complete: 0, incomplete: 3 });
    expect(sum.byArtifact.canvas).toBe(1);
  });

  it("la escalera de dificultades: «sin práctica en la skill design a dificultad 2» y respeta el plan del manifiesto y «No level 1»", () => {
    const f = `${BASE}/4.6 C`;
    put(`${f}/4.6 C.md`, THEORY());
    put(`${f}/4.6 C — mapa.canvas`, "{}");
    put(`${f}/4.6 C.practica.md`, PRACTICA(["design", "implement"], "procedural", 'plan: "design=0/2/1, implement=2/0/0"\n'));
    const ex = [EXERCISE("design", 3), EXERCISE("implement", 1), EXERCISE("implement", 2)].map((e) => ({ ...e, rel: `${f}/Ejercicios/${e.skill}/x.md` }));
    const d = scanTopicDesigns([{ folder: f, title: "C", subject: "programming" }], { root: dir, exercises: ex }).get(f)!;
    expect(d.gaps.map((g) => g.text)).toEqual(["Práctica en la skill `design` a dificultad 2: 0 de 2 ejercicios", "Práctica en la skill `implement` a dificultad 1: 1 de 2 ejercicios"]);
    expect(d.gaps[0]).toMatchObject({ level: "recommended", skill: "design", difficulty: 2, fix: "practice" });
    expect(d.complete).toBe(true); // lo obligatorio está; la escalera solo es recomendada
    expect(requiredDifficulties("debug", { skills: ["debug"], targetDifficulty: 3 })).toEqual([2, 3]);
    expect(requiredDifficulties("implement", { skills: ["implement"], targetDifficulty: 2 })).toEqual([1, 2]);
  });

  it("conserva las notas archivadas sin incluirlas en los ejercicios activos", () => {
    const f = `${BASE}/4.6 C`;
    const active = `${f}/Ejercicios/implement/active.md`;
    const archived = `${f}/Ejercicios/implement/old.md`;
    put(active, "---\ntype: exercise\nmode: implement\ndifficulty: 1\n---\n# Activo");
    put(archived, "---\ntype: exercise\nmode: implement\ndifficulty: 1\narchived: true\n---\n# Histórico");
    expect(diskExercises(dir, f).map((e) => e.rel)).toEqual([active]);
    const scan = scanVault(dir, [path.join(dir, active), path.join(dir, archived)]);
    expect(scan.exercises.map((e) => e.rel)).toEqual([active]);
    expect(fs.existsSync(path.join(dir, archived))).toBe(true);
  });

  it("skills que no encajan con el tipo: un tema teórico con implement y un procedimental solo con conceptos", () => {
    const t = `${BASE}/4.7 T`;
    const p = `${BASE}/4.8 P`;
    for (const [f, type, sk] of [[t, "theoretical", ["pg_true_false", "implement"]], [p, "procedural", ["pg_true_false", "explain"]]] as const) {
      put(`${f}/${path.basename(f)}.md`, THEORY(type));
      put(`${f}/${path.basename(f)} — mapa.canvas`, "{}");
      put(`${f}/${path.basename(f)}.practica.md`, PRACTICA([...sk], type));
    }
    const map = scanTopicDesigns([{ folder: t, title: "T", subject: "programming" }, { folder: p, title: "P", subject: "programming" }], { root: dir, exercises: [] });
    expect(map.get(t)!.gaps.find((g) => g.artifact === "skills_fit")!.text).toContain("un tema teórico no admite `implement`");
    expect(map.get(p)!.gaps.find((g) => g.artifact === "skills_fit")!.text).toContain("al menos una skill de código");
    expect(map.get(p)!.complete).toBe(false);
  });

  it("otras materias usan el perfil genérico (el contrato y el canvas solo se recomiendan)", () => {
    const f = "Matemáticas/1 Álgebra/1.1 Sumas";
    put(`${f}/1.1 Sumas.md`, "# Sumas\n");
    put(`${f}/1.1 Sumas.practica.md`, PRACTICA(["solve"], "procedural").replace("programming", "mathematics"));
    const d = scanTopicDesigns([{ folder: f, title: "Sumas", subject: "mathematics" }], { root: dir, exercises: [{ path: "", rel: `${f}/Ejercicios/solve/a.md`, skill: "solve", mode: "solve", difficulty: 1 }] }).get(f)!;
    expect(d.profile).toBe("generic");
    expect(d.items.find((i) => i.id === "canvas")!.level).toBe("recommended");
    expect(d.items.some((i) => i.id === "skills_fit")).toBe(false);
    expect(d.complete).toBe(true);
  });

  it("es determinista y solo lee: el vault queda idéntico", () => {
    const f = `${BASE}/4.3 REST`;
    put(`${f}/4.3 REST.md`, THEORY());
    const snap = () => JSON.stringify(fs.readdirSync(path.join(dir, ...f.split("/"))).map((n) => [n, fs.statSync(path.join(dir, ...f.split("/"), n)).mtimeMs]));
    const before = snap();
    const a = scanTopicDesigns([{ folder: f, title: "REST", subject: "programming" }], { root: dir, exercises: [] });
    const b = scanTopicDesigns([{ folder: f, title: "REST", subject: "programming" }], { root: dir, exercises: [] });
    expect(a.get(f)).toEqual(b.get(f));
    expect(snap()).toBe(before);
    expect(evaluateTopicDesign({ folder: f, title: "x", exists: true, files: [], exercises: [] }).gaps[0]!.text).toBe("Falta la nota de teoría");
  });
});
