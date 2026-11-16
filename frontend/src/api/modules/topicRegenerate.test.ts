// «Regenerar» un tema: la copia de seguridad ANTES de reemplazar, la restauración si la generación falla y el archivo de los ejercicios antiguos.
// La IA va simulada con las piezas sustituibles (`hooks`); el resto (carpetas, copias, movimientos) es el código real sobre una vault temporal.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ store: {} as Record<string, unknown>, convDir: "" }));
vi.mock("../appConfig.js", () => ({
  AppConfig: {
    get_ai_config: () => ({ ...hoisted.store }),
    set_ai_config: (d: Record<string, unknown>) => Object.assign(hoisted.store, d),
    get_conversations_dir: () => hoisted.convDir,
  },
}));

import { PRACTICA, THEORY } from "../../core/mentor/designFixtures.js";
import { AppState } from "../appState.js";
import { topicRegenerateApi, type RegenHooks, type RegenJob } from "./topicRegenerate.js";

const FOLDER = "Programación/4 Backend/4.1 Uno";
let dir: string;
let app: AppState;
const abs = (rel: string) => path.join(dir, ...rel.split("/"));
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), text, "utf-8");
};
const read = (rel: string) => fs.readFileSync(abs(rel), "utf-8");
const exists = (rel: string) => fs.existsSync(abs(rel));
const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

const OLD_NOTE = THEORY("mixed");
const OLD_CANVAS = '{"nodes":[{"id":"old"}],"edges":[]}';
const OLD_EX = "---\ntype: exercise\nskill: implement\ndifficulty: 1\n---\n# viejo\n";

async function finish(api: ReturnType<typeof topicRegenerateApi>, jobId: string): Promise<RegenJob> {
  for (let i = 0; i < 400; i++) {
    const st = api.study_topic_regenerate_status(jobId);
    if (st.done) return st;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  throw new Error("no terminó");
}
const make = (hooks: RegenHooks) => topicRegenerateApi(app, { pollMs: 5, now: () => new Date("2026-10-23T10:20:30Z"), ...hooks });

beforeEach(() => {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
  hoisted.convDir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_conv_"));
  Object.assign(hoisted.store, { provider: "openai", api_key: "k", model: "m", base_url: "http://x" });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_regen_"));
  fs.mkdirSync(path.join(dir, ".notevault"), { recursive: true }); // el generador del mapa busca la raíz de la vault por esta carpeta
  put("Programación/Programación.resumen.md", "---\nsubject: programming\ntitle: Programación\n---\n# P\n");
  put(`${FOLDER}/4.1 Uno.md`, OLD_NOTE);
  put(`${FOLDER}/4.1 Uno — mapa.canvas`, OLD_CANVAS);
  put(`${FOLDER}/4.1 Uno.practica.md`, PRACTICA(["pg_true_false", "implement"]));
  put(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_0.md`, OLD_EX);
  put(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_1.md`, OLD_EX);
  put(`${FOLDER}/Ejercicios/implement/mis_apuntes.md`, "# mío\n"); // no lo generó la app: no se toca
  app = new AppState(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("study_topic_regenerate — contrato", () => {
  it("exige la confirmación y un tipo válido; no escribe nada si falta", () => {
    const api = make({});
    expect(() => api.study_topic_regenerate(FOLDER, "theory")).toThrow(/confirmación/);
    expect(() => api.study_topic_regenerate(FOLDER, "theory", false)).toThrow(/confirmación/);
    expect(() => api.study_topic_regenerate(FOLDER, "todo", true)).toThrow(/Elige qué regenerar/);
    expect(() => api.study_topic_regenerate("Programación/4 Backend", "theory", true)).toThrow(/carpeta de un tema/);
    expect(exists(".trash")).toBe(false);
    expect(read(`${FOLDER}/4.1 Uno.md`)).toBe(OLD_NOTE);
  });

  it("con la IA en modo puente no regenera", () => {
    hoisted.store.provider = "bridge_claude";
    expect(() => make({}).study_topic_regenerate(FOLDER, "theory", true)).toThrow(/puente/);
  });
});

describe("regenerar la teoría", () => {
  it("respalda la nota y el canvas en .trash ANTES de reemplazar y deja la nueva", async () => {
    let seenBackup = false;
    const api = make({
      generateTheory: async () => {
        // en el momento de generar, la copia ya existe
        seenBackup = walk(abs(".trash")).some((f) => f.endsWith("4.1 Uno.md") && fs.readFileSync(f, "utf-8") === OLD_NOTE);
        put(`${FOLDER}/4.1 Uno.md`, "# NUEVA\n");
        return "";
      },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "theory", true).jobId);
    expect(seenBackup).toBe(true);
    expect(st.error).toBe("");
    expect(st.restored).toBe(false);
    expect(read(`${FOLDER}/4.1 Uno.md`)).toBe("# NUEVA\n");
    expect(st.backup).toBe(".trash/regenerar/2026-10-23_10-20-30_4.1 Uno");
    expect(read(`${st.backup}/4.1 Uno.md`)).toBe(OLD_NOTE);
    expect(read(`${st.backup}/4.1 Uno — mapa.canvas`)).toBe(OLD_CANVAS);
    expect(st.archived).toHaveLength(2);
  });

  it("si la generación falla RESTAURA la teoría y el canvas anteriores", async () => {
    const api = make({
      generateTheory: async () => {
        put(`${FOLDER}/4.1 Uno.md`, "# cortada"); // la IA dejó un borrador
        put(`${FOLDER}/4.1 Uno — mapa.canvas`, "{}");
        return "la teoría llegó cortada";
      },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "theory", true).jobId);
    expect(st.error).toContain("llegó cortada");
    expect(st.error).toContain("restauró");
    expect(st.restored).toBe(true);
    expect(read(`${FOLDER}/4.1 Uno.md`)).toBe(OLD_NOTE);
    expect(read(`${FOLDER}/4.1 Uno — mapa.canvas`)).toBe(OLD_CANVAS);
  });

  it("una excepción inesperada también deja el trabajo terminado con el error (no se queda colgado)", async () => {
    const api = make({ generateTheory: async () => { throw new Error("red caída"); } });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "theory", true).jobId);
    expect(st.done).toBe(true);
    expect(st.error).toContain("red caída");
    expect(read(`${FOLDER}/4.1 Uno.md`)).toBe(OLD_NOTE); // no llegó a tocarse
  });

  it("no admite dos regeneraciones a la vez del mismo tema", async () => {
    let release!: () => void;
    const api = make({ generateTheory: () => new Promise<string>((ok) => (release = () => ok(""))), reevaluate: async () => undefined });
    const { jobId } = api.study_topic_regenerate(FOLDER, "theory", true);
    expect(() => api.study_topic_regenerate(FOLDER, "practice", true)).toThrow(/en curso/);
    await new Promise((ok) => setTimeout(ok, 30));
    release();
    await finish(api, jobId);
    expect(() => api.study_topic_regenerate(FOLDER, "practice", true)).not.toThrow();
  });
});

describe("regenerar la práctica", () => {
  it("respalda el .practica y, si la IA falla, restaura el anterior", async () => {
    const old = read(`${FOLDER}/4.1 Uno.practica.md`);
    const api = make({
      reevaluate: async () => {
        put(`${FOLDER}/4.1 Uno.practica.md`, "roto");
        throw new Error("plan inválido");
      },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "practice", true).jobId);
    expect(st.error).toContain("plan inválido");
    expect(st.restored).toBe(true);
    expect(read(`${FOLDER}/4.1 Uno.practica.md`)).toBe(old);
    expect(read(`${st.backup}/4.1 Uno.practica.md`)).toBe(old);
  });

  it("con éxito deja la práctica nueva y la anterior respaldada", async () => {
    const old = read(`${FOLDER}/4.1 Uno.practica.md`);
    const api = make({ reevaluate: async () => put(`${FOLDER}/4.1 Uno.practica.md`, "nuevo plan") });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "practice", true).jobId);
    expect(st.error).toBe("");
    expect(read(`${FOLDER}/4.1 Uno.practica.md`)).toBe("nuevo plan");
    expect(read(`${st.backup}/4.1 Uno.practica.md`)).toBe(old);
  });
});

describe("regenerar los ejercicios", () => {
  it("archiva los ej_*.md en .trash (sin tocar lo que no generó la app) y genera un juego nuevo", async () => {
    const built: string[] = [];
    const api = make({
      buildExercises: async (folder, skill, difficulty) => {
        const rel = `${folder}/Ejercicios/${skill}/ej_${skill}_d${difficulty}_new_${built.length}.md`;
        put(rel, `---\ntype: exercise\nskill: ${skill}\ndifficulty: ${difficulty}\n---\n# nuevo\n`);
        built.push(rel);
        return [rel];
      },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "exercises", true).jobId);
    expect(st.error).toBe("");
    expect(exists(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(false);
    expect(exists(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_1.md`)).toBe(false);
    expect(read(`${st.backup}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(OLD_EX);
    expect(read(`${st.backup}/Ejercicios/implement/ej_implement_d1_1_1.md`)).toBe(OLD_EX);
    expect(exists(`${FOLDER}/Ejercicios/implement/mis_apuntes.md`)).toBe(true);
    expect(built.length).toBeGreaterThan(0);
    expect(st.created.length).toBe(built.length);
    expect(st.archived).toHaveLength(2);
    for (const rel of built) expect(exists(rel)).toBe(true);
  });

  it("si no se genera ninguno, DEVUELVE los ejercicios anteriores", async () => {
    const api = make({ buildExercises: async () => { throw new Error("la IA no respondió"); } });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "exercises", true).jobId);
    expect(st.error).toContain("la IA no respondió");
    expect(st.restored).toBe(true);
    expect(read(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(OLD_EX);
    expect(read(`${FOLDER}/Ejercicios/implement/ej_implement_d1_1_1.md`)).toBe(OLD_EX);
  });
});

describe("regenerar el mapa", () => {
  it("respalda el canvas y actualiza el mapa principal (sin IA)", async () => {
    const api = make({ generateTheory: async () => { throw new Error("no debe usar la IA"); } });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "map", true).jobId);
    expect(st.error).toBe("");
    expect(st.what).toBe("map");
    expect(read(`${st.backup}/4.1 Uno — mapa.canvas`)).toBe(OLD_CANVAS);
    expect(JSON.parse(read(`${FOLDER}/4.1 Uno — mapa.canvas`)).nodes.length).toBeGreaterThan(1);
    expect(read(`${FOLDER}/4.1 Uno.md`)).toBe(OLD_NOTE); // la nota no se toca
  });

  it("sin canvas previo lo crea; sin nota de teoría falla con un mensaje claro", async () => {
    fs.rmSync(abs(`${FOLDER}/4.1 Uno — mapa.canvas`));
    const api = make({});
    const ok = await finish(api, api.study_topic_regenerate(FOLDER, "map", true).jobId);
    expect(ok.error).toBe("");
    expect(exists(`${FOLDER}/4.1 Uno — mapa.canvas`)).toBe(true);
    fs.rmSync(abs(`${FOLDER}/4.1 Uno.md`));
    const bad = await finish(api, api.study_topic_regenerate(FOLDER, "map", true).jobId);
    expect(bad.error).toContain("no tiene nota");
  });
});

describe("regenerar todo", () => {
  it("encadena teoría, práctica y ejercicios; se para en el primer fallo", async () => {
    const order: string[] = [];
    const api = make({
      generateTheory: async () => { order.push("theory"); return ""; },
      reevaluate: async () => { order.push("practice"); throw new Error("plan inválido"); },
      buildExercises: async () => { order.push("exercises"); return []; },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "all", true).jobId);
    expect(order).toEqual(["theory", "practice"]);
    expect(st.error).toContain("plan inválido");
    expect(st.finished).toBe(2);
    expect(st.total).toBe(3);
  });

  it("con todo bien hace los tres pasos en orden", async () => {
    const order: string[] = [];
    const api = make({
      generateTheory: async () => { order.push("theory"); return ""; },
      reevaluate: async () => { order.push("practice"); },
      buildExercises: async (_f, skill, d) => { order.push("exercises"); const rel = `${FOLDER}/Ejercicios/${skill}/ej_${skill}_d${d}_n_${order.length}.md`; put(rel, "# n"); return [rel]; },
    });
    const st = await finish(api, api.study_topic_regenerate(FOLDER, "all", true).jobId);
    expect(st.error).toBe("");
    expect(order.slice(0, 2)).toEqual(["theory", "practice"]);
    expect(order[2]).toBe("exercises");
    expect(st.finished).toBe(3);
  });
});
