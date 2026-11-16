// «Generar tema» (`study_topic_generate`) escribe SOLO lo del tema pedido: ni vistas de los temas hermanos ni el esqueleto del espacio.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ store: {} as Record<string, unknown>, convDir: "" }));
vi.mock("../appConfig.js", () => ({
  AppConfig: {
    get_ai_config: () => ({ ...hoisted.store }),
    set_ai_config: (d: Record<string, unknown>) => Object.assign(hoisted.store, d),
    get_conversations_dir: () => hoisted.convDir,
  },
}));

import { AppState } from "../appState.js";
import { studySpaceApi } from "./studySpace.js";

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

async function run(api: ReturnType<typeof studySpaceApi>, folder: string): Promise<void> {
  const { jobId } = api.study_topic_generate(folder, "", { theory: false, practice: false, map: false });
  for (let i = 0; i < 300; i++) {
    if (api.study_space_status(jobId).done) return;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error("no terminó");
}

let root: string;
beforeEach(() => {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
  hoisted.convDir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_conv_"));
  Object.assign(hoisted.store, { provider: "openai", api_key: "k", model: "m", base_url: "http://x" });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nv_topicgen_"));
  fs.mkdirSync(path.join(root, "Programación", "1 Area", "1.1 Uno"), { recursive: true });
  fs.mkdirSync(path.join(root, "Programación", "1 Area", "1.2 Dos"), { recursive: true });
  fs.writeFileSync(path.join(root, "Programación", "Programación.resumen.md"), "---\nsubject: programming\ntitle: Programación\n---\n# P\n");
});

describe("study_topic_generate: solo el tema pedido", () => {
  it("acepta un tema en una subcarpeta y no crea vistas de temas hermanos", async () => {
    const rel = "Programación/5 Frontend/HTML/5.1 HTML";
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    const api = studySpaceApi(new AppState(root));
    await run(api, rel);
    expect(fs.existsSync(path.join(root, rel, "5.1 HTML.practica.md"))).toBe(true);
  });

  it("crea el archivo de práctica de ESE tema y no toca a los hermanos ni reescribe el temario o los mapas", async () => {
    const api = studySpaceApi(new AppState(root));
    await run(api, "Programación/1 Area/1.1 Uno");
    const files = walk(path.join(root, "Programación")).map((f) => path.relative(path.join(root, "Programación"), f).split(path.sep).join("/"));
    expect(files).toContain("1 Area/1.1 Uno/1.1 Uno.practica.md");
    // el hermano, el temario del espacio, el resumen del área y los mapas NO se crean
    expect(files.some((f) => f.startsWith("1 Area/1.2 Dos/"))).toBe(false);
    expect(files).not.toContain("00 Temario.md");
    expect(files.some((f) => f.endsWith(".canvas"))).toBe(false);
    expect(files).not.toContain("1 Area/1 Area.resumen.md");
    expect(files.some((f) => f.endsWith(".teorica.md"))).toBe(false);
  });

  it("no rehace las skills por defecto si el espacio ya tiene su carpeta _skills", async () => {
    const skills = path.join(root, "Programación", "_skills");
    fs.mkdirSync(skills, { recursive: true });
    fs.writeFileSync(path.join(skills, "mia_skill.md"), "# mía\n");
    const api = studySpaceApi(new AppState(root));
    await run(api, "Programación/1 Area/1.1 Uno");
    expect(fs.readdirSync(skills)).toEqual(["mia_skill.md"]);
  });
});
