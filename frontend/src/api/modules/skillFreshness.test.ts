import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { outdatedByFolder } from "./skillFreshness.js";

let root: string;
const put = (rel: string, text: string, ageMs = 0): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(abs, t, t);
};
const TOPIC = "Matemáticas/4 Backend/4.1 What the backend is";
const DAY = 86_400_000;

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "nv-skill-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("outdatedByFolder", () => {
  it("marca la pieza hecha antes del último cambio de su skill, y solo esa", () => {
    put("Matemáticas/_skills/resumen_teorico_skill.md", "v1", DAY);
    put("Matemáticas/_skills/mapa_skill.md", "v1", 3 * DAY);
    put(`${TOPIC}/4.1 What the backend is.md`, "nota", 2 * DAY);
    put(`${TOPIC}/4.1 What the backend is — mapa.canvas`, "{}", DAY / 2);
    expect(outdatedByFolder(root, [TOPIC]).get(TOPIC)).toEqual({ theory: true });
  });

  it("ve cuando cambia el texto de la skill y se quita al regenerar la pieza", () => {
    put("Matemáticas/_skills/resumen_teorico_skill.md", "v1", 5 * DAY);
    put(`${TOPIC}/4.1 What the backend is.md`, "nota", 4 * DAY);
    expect(outdatedByFolder(root, [TOPIC]).size).toBe(0);
    put("Matemáticas/_skills/resumen_teorico_skill.md", "v2");
    expect(outdatedByFolder(root, [TOPIC]).get(TOPIC)).toEqual({ theory: true });
    put(`${TOPIC}/4.1 What the backend is.md`, "nota nueva");
    expect(outdatedByFolder(root, [TOPIC]).size).toBe(0);
  });

  it("tocar la skill sin cambiar su texto no marca nada", () => {
    put("Matemáticas/_skills/resumen_teorico_skill.md", "v1", 5 * DAY);
    put(`${TOPIC}/4.1 What the backend is.md`, "nota", DAY);
    outdatedByFolder(root, [TOPIC]);
    put("Matemáticas/_skills/resumen_teorico_skill.md", "v1");
    expect(outdatedByFolder(root, [TOPIC]).size).toBe(0);
  });
});

describe("notas demasiado pesadas", () => {
  const body = (n: number): string => `# 2.1.1 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n\n### What it is\n**In one sentence.** ${"word ".repeat(n)}\n\n### Mental model\n**In the practice:** x\n\n## Examples\n**How you will apply it:** x\n\n## Common mistakes\nx\n`;
  it("una nota de Programación con la explicación pasada del límite sale como desactualizada; una corta, no", () => {
    const heavy = "Programación/2.1 Python/2.1.1 X", light = "Programación/2.1 Python/2.1.2 Y";
    put(`${heavy}/2.1.1 X.md`, body(700));
    put(`${light}/2.1.2 Y.md`, body(100));
    const out = outdatedByFolder(root, [heavy, light]);
    expect(out.get(heavy)).toMatchObject({ theory: true });
    expect(out.has(light)).toBe(false);
  });
});

describe("estructura en módulos funcionales", () => {
  const note = (mid: string): string => `# 2.1.5 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n\n### What it is\n**In one sentence.** word\n\n${mid}\n\n## Examples\n**How you will apply it:** x\n\n## Common mistakes\nx\n`;
  it("la nota con «How it is organised» + «How it works in the real world» está al día, igual que la antigua con «Mental model»; sin ninguna de las dos, no", () => {
    const a = "Programación/2.1 Python/2.1.5 A", b = "Programación/2.1 Python/2.1.6 B", c = "Programación/2.1 Python/2.1.7 C";
    put(`${a}/2.1.5 A.md`, note("### How it is organised\nx\n\n### How it works in the real world\nx"));
    put(`${b}/2.1.6 B.md`, note("### Mental model\nx\n- **In the practice:** y"));
    put(`${c}/2.1.7 C.md`, note("### Otra cosa\nx"));
    const out = outdatedByFolder(root, [a, b, c]);
    expect(out.has(a)).toBe(false);
    expect(out.has(b)).toBe(false);
    expect(out.get(c)).toMatchObject({ theory: true });
  });
});

describe("marca de versión de la skill", () => {
  const FM = (v: string): string => `---\ntitle: x\nskill_version: "${v}"\n---\n`;
  const GOOD = "# 2.1.5 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n\n### What it is\n**In one sentence.** w\n\n### How it is organised\nx\n\n### How it works in the real world\nx\n\n## Examples\n**How you will apply it:** x\n\n## Common mistakes\nx\n";
  it("con marca manda la marca (no la fecha): igual a la skill actual = al día aunque la skill sea más nueva; distinta = desactualizada", async () => {
    const { skillVersionOf } = await import("./skillFreshness.js");
    const f1 = "Programación/2.1 Python/2.1.5 A", f2 = "Programación/2.1 Python/2.1.6 B";
    put(`${f1}/2.1.5 A.md`, FM("00000000") + GOOD, 2 * DAY);
    put(`${f2}/2.1.6 B.md`, GOOD, 2 * DAY); // sin marca: cae a la fecha
    put("Programación/_skills/resumen_teorico_skill.md", "skill v2"); // más nueva que ambas notas
    const v = skillVersionOf(root, "Programación", "theory")!;
    put(`${f1}/2.1.5 A.md`, FM(v) + GOOD, 2 * DAY);
    const out = outdatedByFolder(root, [f1, f2]);
    expect(out.has(f1)).toBe(false); // la marca coincide
    expect(out.get(f2)).toMatchObject({ theory: true }); // sin marca y más vieja que la skill
    put(`${f1}/2.1.5 A.md`, FM("deadbeef") + GOOD, 0);
    expect(outdatedByFolder(root, [f1]).get(f1)).toMatchObject({ theory: true }); // marca de otra versión
  });
});

describe("stampSkillVersion y quién la llama", () => {
  it("marca el archivo con la versión actual y es idempotente; sin skill no toca nada", async () => {
    const { stampSkillVersion, skillVersionOf } = await import("./skillFreshness.js");
    const { stampOf } = await import("../../lib/skillStamp.js");
    put("Programación/_skills/resumen_teorico_skill.md", "skill v1");
    put("Programación/T/T.md", "---\ntitle: x\n---\n# T\n");
    const f = path.join(root, "Programación/T/T.md");
    stampSkillVersion(root, "Programación", "theory", f);
    const once = fs.readFileSync(f, "utf8");
    expect(stampOf(once)).toBe(skillVersionOf(root, "Programación", "theory"));
    stampSkillVersion(root, "Programación", "theory", f);
    expect(fs.readFileSync(f, "utf8")).toBe(once);
    put("Otra/T/T.md", "---\ntitle: x\n---\n# T\n");
    stampSkillVersion(root, "Otra", "theory", path.join(root, "Otra/T/T.md"));
    expect(fs.readFileSync(path.join(root, "Otra/T/T.md"), "utf8")).not.toContain("skill_version");
  });

  it("guarda: todo módulo que escribe una nota o un .practica.md generado llama a stampSkillVersion (si añades otro escritor, márcalo)", () => {
    for (const f of ["topicRegenerateHandoff.ts", "curriculumHandoff.ts", "curriculumAuto.ts", "studySpace.ts", "study.ts"]) {
      expect(fs.readFileSync(path.join(__dirname, f), "utf8"), f).toContain("stampSkillVersion");
    }
  });
});

describe("el mapa y la fecha de cambio de la skill", () => {
  const MAP = JSON.stringify({ nodes: [{ id: "g", type: "group", label: "Explanation", x: 0, y: 0, width: 10, height: 10 }, { id: "t", type: "text", text: "## What it is\n**In one sentence.** x\n## How it works in the real world", x: 0, y: 0, width: 10, height: 10 }], edges: [] });
  const NOTE = "---\ntitle: x\n---\n# 2.1.5 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n\n### What it is\n**In one sentence.** w\n\n### How it is organised\nx\n\n### How it works in the real world\nx\n\n## Examples\n**How you will apply it:** x\n\n## Common mistakes\nx\n";
  const F = "Programación/2.1 Python/2.1.5 A";

  it("un mapa hecho DESPUÉS de editar la skill no sale atrasado aunque la app vea el cambio horas más tarde", () => {
    put("Programación/_skills/mapa_skill.md", "mapa v1", 5 * DAY);
    put(`${F}/2.1.5 A.md`, NOTE, 4 * DAY);
    put(`${F}/2.1.5 A — mapa.canvas`, MAP, 4 * DAY);
    expect(outdatedByFolder(root, [F]).size).toBe(0); // la app ve la skill v1
    put("Programación/_skills/mapa_skill.md", "mapa v2", 2 * DAY); // se edita hace 2 días…
    put(`${F}/2.1.5 A — mapa.canvas`, MAP, DAY); // …y el mapa se rehace hace 1 día
    expect(outdatedByFolder(root, [F]).has(F)).toBe(false); // antes: salía atrasado porque la app «vio» el cambio hoy
  });

  it("con la versión del mapa registrada manda ella: igual a la skill actual = al día; distinta = atrasado", async () => {
    const { skillVersionOf } = await import("./skillFreshness.js");
    put("Programación/_skills/mapa_skill.md", "mapa v1", DAY);
    put(`${F}/2.1.5 A.md`, NOTE, 4 * DAY);
    put(`${F}/2.1.5 A — mapa.canvas`, MAP, 4 * DAY); // más viejo que la skill: sin versión saldría atrasado
    expect(outdatedByFolder(root, [F]).get(F)).toMatchObject({ canvas: true });
    const v = skillVersionOf(root, "Programación", "canvas")!;
    put(".notevault/estudio/canvas_versions.json", JSON.stringify({ [`${F}/2.1.5 A — mapa.canvas`]: v }));
    expect(outdatedByFolder(root, [F]).has(F)).toBe(false);
    put(".notevault/estudio/canvas_versions.json", JSON.stringify({ [`${F}/2.1.5 A — mapa.canvas`]: "deadbeef" }));
    expect(outdatedByFolder(root, [F]).get(F)).toMatchObject({ canvas: true });
  });
});

describe("arquetipos de programación: practica y ejercicios desactualizados", () => {
  const SETUP = "Programación/2.1 Python/2.1.1 Project structure, virtual environments and imports";
  const INVALID_PRACTICA = `---\ntype: practica\nsubject: programming\ntitle: 2.1.1 Project structure, virtual environments and imports\ntopic_type: mixed\nskills: [pg_true_false, explain, implement]\nplan: "pg_true_false=4/0/0, explain=4/0/0, implement=4/0/0"\n---\n`;
  const VALID_PRACTICA = `---\ntype: practica\nsubject: programming\ntitle: 2.1.1 Project structure, virtual environments and imports\ntopic_type: mixed\nskills: [project_structure, commands, pg_quiz, pg_true_false, explain]\nplan: "project_structure=4/0/0, commands=4/0/0, pg_true_false=4/0/0, explain=4/0/0"\n---\n`;

  it("detecta .practica con habilidades prohibidas para el arquetipo setup (ej: implement)", () => {
    put(`${SETUP}/2.1.1 Project structure, virtual environments and imports.practica.md`, INVALID_PRACTICA);
    const out = outdatedByFolder(root, [SETUP]);
    expect(out.get(SETUP)).toMatchObject({ practica: true });
  });

  it("detecta carpeta Ejercicios con ejercicios de habilidades prohibidas o sin habilidades requeridas", () => {
    put(`${SETUP}/2.1.1 Project structure, virtual environments and imports.practica.md`, VALID_PRACTICA);
    put(`${SETUP}/Ejercicios/implement/ej_implement_1.md`, "---\nmode: implement\n---\ncode");
    put(`${SETUP}/Ejercicios/explain/ej_explain_1.md`, "---\nmode: explain\n---\nexplanation");
    const out = outdatedByFolder(root, [SETUP]);
    expect(out.get(SETUP)).toMatchObject({ exercises: true });
  });

  it("un tema setup con practica y ejercicios acordes al arquetipo no sale atrasado", () => {
    put(`${SETUP}/2.1.1 Project structure, virtual environments and imports.practica.md`, VALID_PRACTICA);
    put(`${SETUP}/Ejercicios/project_structure/ej_struct_1.md`, "---\nmode: project_structure\n---\nstructure");
    put(`${SETUP}/Ejercicios/explain/ej_explain_1.md`, "---\nmode: explain\n---\nexplanation");
    const out = outdatedByFolder(root, [SETUP]);
    expect(out.get(SETUP)?.practica).toBeFalsy();
    expect(out.get(SETUP)?.exercises).toBeFalsy();
  });
});

describe("verificación universal de notas y lienzos (múltiples materias y formatos)", () => {
  it("detecta notas truncadas por bloque de código sin cerrar", async () => {
    const { isTheoryOutdated } = await import("./skillFreshness.js");
    const unclosed = `# 1.1 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n### What it is\n**In one sentence.** x\n\n\`\`\`python\nprint("cut off midway")\n`;
    expect(isTheoryOutdated(unclosed, "Programación")).toBe(true);
  });

  it("detecta notas a las que les falta una sección requerida como ejemplos o errores", async () => {
    const { isTheoryOutdated } = await import("./skillFreshness.js");
    const noMistakes = `# 1.1 X\n\n## Requires\n*No prerequisites.*\n\n## Explanation\n### What it is\n**In one sentence.** x\n\n## Examples\n**How you will apply it:** x\n`;
    expect(isTheoryOutdated(noMistakes, "Programación")).toBe(true);
  });

  it("valida notas en español para Matemáticas e Inglés", async () => {
    const { isTheoryOutdated } = await import("./skillFreshness.js");
    const mathValid = `# 1.1 Suma\n\n## Requiere\n*Sin prerrequisitos.*\n\n## Explicación\n### Qué es\nDefinición.\n### Modelo mental\nAnalogía.\n\n## Ejemplos\nEjemplo 1.\n\n## Errores comunes\nError 1.\n`;
    expect(isTheoryOutdated(mathValid, "Matemáticas")).toBe(false);

    const mathMissingModel = `# 1.1 Suma\n\n## Requiere\n*Sin prerrequisitos.*\n\n## Explicación\n### Qué es\nDefinición.\n\n## Ejemplos\nEjemplo 1.\n\n## Errores comunes\nError 1.\n`;
    expect(isTheoryOutdated(mathMissingModel, "Matemáticas")).toBe(true);
  });

  it("detecta lienzos explicativos vacíos o sin nodos ni explicación", async () => {
    const { isCanvasOutdated } = await import("./skillFreshness.js");
    expect(isCanvasOutdated("", false)).toBe(true);
    expect(isCanvasOutdated(JSON.stringify({ nodes: [] }), false)).toBe(true);
    expect(isCanvasOutdated(JSON.stringify({ nodes: [{ id: "1", type: "text", text: "solo esto" }] }), false)).toBe(true);
  });
});
