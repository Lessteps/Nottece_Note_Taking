import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../appConfig.js", () => ({ AppConfig: { get_ai_config: () => ({ provider: "openai", api_key: "k", model: "m" }), set_ai_config: () => undefined, get_conversations_dir: () => "/tmp/x" } }));
import { AppState } from "../appState.js";
import { MAX_PAST, skillsManagerApi } from "./skillsManager.js";
import { readSkillTemplates } from "../../core/practice/skillTemplates.js";

let dir: string;
let clock = 0;
const mk = (hooks: Parameters<typeof skillsManagerApi>[1] = {}) => skillsManagerApi(new AppState(dir), { now: () => new Date(Date.UTC(2026, 9, 30, 12, 0, clock++)), ...hooks });
const skillPath = (f: string) => path.join(dir, "Programación", "_skills", f);

beforeEach(() => {
  clock = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_skills_"));
  fs.mkdirSync(path.join(dir, "Programación", "_skills"), { recursive: true });
  for (const f of ["resumen_teorico_skill.md", "mapa_skill.md", "practica_skill.md"]) fs.writeFileSync(skillPath(f), `# ${f}\nversion 0\n`);
  fs.mkdirSync(path.join(dir, "Matemáticas"), { recursive: true }); // una materia sin skills no aparece
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("gestor de skills", () => {
  it("crea una skill personalizada en .notevault y la incluye en las plantillas de su materia", () => {
    const api = mk();
    const created = api.skills_custom_create({ subject: "Programación", name: "revisar_ejercicios", text: "Comprobar pistas" });
    expect(created.file).toBe(".notevault/skills/Programación/revisar_ejercicios.md");
    expect(api.skills_custom_list({ subject: "Programación" })).toHaveLength(1);
    expect(readSkillTemplates(dir, "Programación/tema").some((s) => s.title === "revisar_ejercicios" && s.content.includes("Comprobar pistas"))).toBe(true);
    expect(readSkillTemplates(dir, "Matemáticas/tema").some((s) => s.title === "revisar_ejercicios")).toBe(false);
    expect(() => api.skills_custom_create({ subject: "Programación", name: "revisar_ejercicios", text: "otro" })).toThrow();
    expect(() => api.skills_custom_create({ subject: "Programación", name: "../escape", text: "otro" })).toThrow();
  });
  it("lista las skills de cada materia, incluida ejercicios, con su versión", () => {
    const r = mk().skills_list();
    expect(r.subjects.map((s) => s.subject)).toEqual(["Programación"]);
    expect(r.subjects[0]!.skills.map((s) => s.kind)).toEqual(["theory", "canvas", "ejercicios", "practica"]);
    expect(r.subjects[0]!.skills[0]).toMatchObject({ file: "Programación/_skills/resumen_teorico_skill.md", past: [] });
    expect(r.subjects[0]!.skills[0]!.version).toMatch(/^[0-9a-f]{8}$/);
    expect(r.maxPast).toBe(3);
  });

  it("guardar archiva lo anterior; solo se conservan las últimas 3 versiones pasadas; guardar lo mismo no crea versión", () => {
    const api = mk();
    for (let i = 1; i <= 5; i++) api.skills_save({ subject: "Programación", kind: "theory", text: `# t\nversion ${i}\n` });
    const info = api.skills_list().subjects[0]!.skills[0]!;
    expect(info.past).toHaveLength(MAX_PAST);
    // las pasadas son las 3 más recientes antes de la actual (4, 3 y 2): la 0 y la 1 ya se podaron
    const texts = info.past.map((p) => api.skills_get({ subject: "Programación", kind: "theory", versionId: p.id }).text.trim().split("\n")[1]);
    expect(texts).toEqual(["version 4", "version 3", "version 2"]);
    expect(fs.readFileSync(skillPath("resumen_teorico_skill.md"), "utf8")).toContain("version 5");
    api.skills_save({ subject: "Programación", kind: "theory", text: "# t\nversion 5\n" });
    expect(api.skills_list().subjects[0]!.skills[0]!.past).toHaveLength(MAX_PAST);
  });

  it("restaurar una versión pasada la pone como actual (y archiva la que había)", () => {
    const api = mk();
    api.skills_save({ subject: "Programación", kind: "canvas", text: "# m\nuna\n" });
    api.skills_save({ subject: "Programación", kind: "canvas", text: "# m\ndos\n" });
    const first = api.skills_list().subjects[0]!.skills[1]!.past.find((p) => api.skills_get({ subject: "Programación", kind: "canvas", versionId: p.id }).text.includes("una"))!;
    api.skills_restore({ subject: "Programación", kind: "canvas", versionId: first.id });
    expect(fs.readFileSync(skillPath("mapa_skill.md"), "utf8")).toContain("una");
    expect(api.skills_list().subjects[0]!.skills[1]!.past.some((p) => api.skills_get({ subject: "Programación", kind: "canvas", versionId: p.id }).text.includes("dos"))).toBe(true);
  });

  it("rechaza lo inválido: skill o materia inexistente, vacío, rutas, versión inventada", () => {
    const api = mk();
    expect(() => api.skills_save({ subject: "Programación", kind: "otra", text: "x" })).toThrow("no existe");
    expect(() => api.skills_save({ subject: "Matemáticas", kind: "theory", text: "x" })).toThrow("no tiene skills");
    expect(() => api.skills_save({ subject: "../x", kind: "theory", text: "x" })).toThrow("no tiene skills");
    expect(() => api.skills_save({ subject: "Programación", kind: "theory", text: "   " })).toThrow("vacía");
    expect(() => api.skills_get({ subject: "Programación", kind: "theory", versionId: "../../etc/passwd" })).toThrow("no existe");
    expect(() => api.skills_get({ subject: "Programación", kind: "theory", versionId: "nope" })).toThrow("ya no está");
  });

  it("pedir un cambio: modo prompt devuelve el texto para Antigravity con la skill y la petición, sin tocar nada", async () => {
    const before = fs.readFileSync(skillPath("practica_skill.md"), "utf8");
    const r = await mk().skills_ai_edit({ subject: "Programación", kind: "practica", instruction: "Que las preguntas verdadero/falso sean 6", mode: "prompt" });
    expect(r.mode).toBe("prompt");
    expect(r.prompt).toContain("Que las preguntas verdadero/falso sean 6");
    expect(r.prompt).toContain("version 0");
    expect(r.prompt).toContain("COMPLETE new text");
    expect(fs.readFileSync(skillPath("practica_skill.md"), "utf8")).toBe(before);
  });

  it("pedir un cambio con la IA de la app devuelve una PROPUESTA y no guarda; con la IA en modo puente explica qué hacer", async () => {
    const ask = vi.fn().mockResolvedValue("```markdown\n# nueva\nversion 9\n```");
    const before = fs.readFileSync(skillPath("mapa_skill.md"), "utf8");
    const r = await mk({ ask }).skills_ai_edit({ subject: "Programación", kind: "canvas", instruction: "Añade un panel", mode: "app" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.proposal).toBe("# nueva\nversion 9");
    expect(fs.readFileSync(skillPath("mapa_skill.md"), "utf8")).toBe(before);
    await expect(mk().skills_ai_edit({ subject: "Programación", kind: "canvas", instruction: "  x ", mode: "app" })).rejects.toThrow("qué quieres cambiar");
  });
});

describe("errores de la IA", () => {
  it("un fallo del proveedor se convierte en un mensaje claro que ofrece el prompt, sin guardar nada", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("AIError: HTTP 401: Authentication Fails"));
    await expect(mk({ ask }).skills_ai_edit({ subject: "Programación", kind: "theory", instruction: "Acorta la explicación", mode: "app" })).rejects.toThrow(/no pudo responder: HTTP 401.*Copiar prompt/);
    expect(fs.readFileSync(skillPath("resumen_teorico_skill.md"), "utf8")).toContain("version 0");
  });
});
