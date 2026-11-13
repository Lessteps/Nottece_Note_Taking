// «Regenerar con un agente externo»: la tarea que se escribe (skills incrustadas, contrato, copias), la validación del resultado con restauración,
// la disponibilidad de los motores según el modo de la IA y el lote. Vault temporal real; no hay ninguna IA.

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
import { regenEngines } from "./regenEngines.js";
import { topicRegenerateApi } from "./topicRegenerate.js";
import { topicRegenerateHandoffApi } from "./topicRegenerateHandoff.js";
import { AIConfig } from "../../core/aiClient.js";

const AREA = "Programación/4 Backend";
const A = `${AREA}/4.1 Uno`;
const B = `${AREA}/4.2 Dos`;
let dir: string;
let app: AppState;
const abs = (rel: string) => path.join(dir, ...rel.split("/"));
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), text, "utf-8");
};
const read = (rel: string) => fs.readFileSync(abs(rel), "utf-8");
const exists = (rel: string) => fs.existsSync(abs(rel));
const NOW = () => new Date("2026-10-23T10:20:30Z");
const make = () => topicRegenerateHandoffApi(app, { now: NOW });

const OLD_NOTE = THEORY("mixed").replace("# 4.3 T", "# 4.1 Uno");
const NEW_NOTE = OLD_NOTE.replace("mm", "mm NUEVO");
const SKILL = "# resumen_teorico_skill\nCONTRATO-DE-TEORIA: ejemplos de 4 viñetas.\n";
const OLD_EX = "---\ntype: exercise\nmode: implement\ndifficulty: 1\n---\n# viejo\n";
const PLAN_JSON = JSON.stringify({ topic_type: "mixed", skills: [{ skill: "implement", difficulties: { 1: 2, 2: 0, 3: 0 }, why: "porque sí" }], summary: "plan nuevo" });
const ex = (n: number) => ({ title: `Ejercicio ${n}`, statement: `Escribe una función número ${n} que haga algo útil con la lista.`, hints: ["pista"], solution: `Solución completa del ejercicio ${n}.`, rubric: ["Compila", "Casos borde", "Claridad"] });

beforeEach(() => {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
  hoisted.convDir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_conv_"));
  Object.assign(hoisted.store, { provider: "bridge_claude" });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_handoff_"));
  put("Programación/Programación.resumen.md", "---\nsubject: programming\ntitle: Programación\n---\n# P\n");
  put("Programación/_skills/resumen_teorico_skill.md", SKILL);
  for (const f of [A, B]) {
    const name = path.posix.basename(f);
    put(`${f}/${name}.md`, OLD_NOTE.replace("# 4.1 Uno", `# ${name}`));
    put(`${f}/${name} — mapa.canvas`, '{"nodes":[{"id":"old"}],"edges":[]}');
    put(`${f}/${name}.practica.md`, PRACTICA(["implement"]));
    put(`${f}/Ejercicios/implement/ej_implement_d1_1_0.md`, OLD_EX);
  }
  app = new AppState(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("motores de regeneración según el modo de la IA", () => {
  const view = (d: Record<string, unknown>) => regenEngines(AIConfig.fromDict(d));
  const by = (v: ReturnType<typeof view>, id: string) => v.engines.find((e) => e.id === id)!;

  it("en modo puente solo el agente externo está disponible y es el recomendado", () => {
    const v = view({ provider: "bridge_antigravity" });
    expect(v.mode).toBe("bridge");
    expect(by(v, "app").available).toBe(false);
    expect(by(v, "claude").available).toBe(false);
    expect(by(v, "handoff").available).toBe(true);
    expect(v.recommended).toBe("handoff");
  });

  it("con un proveedor con clave que no es Claude: «app» sí, «Claude» no (y dice dónde cambiarlo)", () => {
    const v = view({ provider: "deepseek", api_key: "k", model: "deepseek-flash" });
    expect(by(v, "app").available).toBe(true);
    expect(by(v, "claude").available).toBe(false);
    expect(by(v, "claude").reason).toContain("ajustes de IA");
    expect(by(v, "app").detail).toContain("deepseek");
    expect(v.recommended).toBe("app");
  });

  it("Claude con API key y Claude Code habilitan «Claude»; sin clave, no", () => {
    expect(by(view({ provider: "anthropic", api_key: "sk-ant", model: "claude-sonnet-4-6" }), "claude").available).toBe(true);
    expect(by(view({ provider: "anthropic" }), "claude").available).toBe(false);
    const cc = view({ provider: "claude_code", model: "sonnet" });
    expect(cc.mode).toBe("connection");
    expect(by(cc, "claude").available).toBe(true);
  });

  it("study_regen_engines lee los ajustes guardados", () => {
    expect(make().study_regen_engines().mode).toBe("bridge");
  });

  it("study_topic_regenerate: el motor «claude» exige proveedor Claude y «handoff» no corre aquí; el mapa corre aunque la IA esté en puente", () => {
    const api = topicRegenerateApi(app, { generateMap: () => ({ error: "" }), now: NOW });
    Object.assign(hoisted.store, { provider: "deepseek", api_key: "k" });
    expect(() => api.study_topic_regenerate(A, "theory", true, "claude")).toThrow(/no es Claude|Claude/);
    expect(() => api.study_topic_regenerate(A, "theory", true, "handoff")).toThrow(/handoff/);
    expect(() => api.study_topic_regenerate(A, "theory", true, "otro")).toThrow(/Motor desconocido/);
    hoisted.store.provider = "bridge_claude";
    expect(() => api.study_topic_regenerate(A, "theory", true)).toThrow(/puente/);
    expect(() => api.study_topic_regenerate(A, "map", true)).not.toThrow();
  });
});

describe("la tarea para el agente externo", () => {
  it("exige confirmación, un tipo válido y rechaza el mapa (no usa IA)", async () => {
    const api = make();
    await expect(api.study_topic_regenerate_handoff(A, "theory")).rejects.toThrow(/confirmación/);
    await expect(api.study_topic_regenerate_handoff(A, "map", true)).rejects.toThrow(/no usa IA/);
    await expect(api.study_topic_regenerate_handoff(A, "todo", true)).rejects.toThrow(/Elige qué regenerar/);
    await expect(api.study_topic_regenerate_handoff("Programación/4 Backend", "theory", true)).rejects.toThrow(/carpeta de un tema/);
    expect(exists(".trash")).toBe(false);
  });

  it("funciona con la IA en modo puente: escribe la tarea con carpeta, skill incrustada, contrato y copias", async () => {
    const h = await make().study_topic_regenerate_handoff(A, "theory", true);
    expect(h.status).toBe("waiting");
    expect(h.task).toBe("Programación/_handoff/regenerar/2026-10-23_10-20-30_4.1 Uno.md");
    expect(h.prompt).toContain(h.taskAbs);
    expect(h.prompt).toMatch(/^Read `.*` and execute it/);
    const md = read(h.task);
    expect(md).toContain(`\`${A}\``); // la carpeta exacta
    expect(md).toContain(`\`${A}/4.1 Uno.md\``); // el archivo que se escribe
    expect(md).toContain("CONTRATO-DE-TEORIA"); // la skill de la vault, incrustada
    expect(md).toContain("Do NOT draw or edit any `.canvas`");
    expect(md).toContain("## Tarjetas");
    expect(md).toContain("ZERO problems");
    expect(md).toContain(h.topics[0]!.backup);
    expect(md).toContain("## 5. When you finish");
    expect(md).toContain("- [ ] ");
    // copias hechas: nota y canvas (lo mismo que «Con la app»)
    expect(read(`${h.topics[0]!.backup}/4.1 Uno.md`)).toBe(read(`${A}/4.1 Uno.md`));
    expect(exists(`${h.topics[0]!.backup}/4.1 Uno — mapa.canvas`)).toBe(true);
    // todavía no toca el tema
    expect(read(`${A}/4.1 Uno.md`)).toContain("# 4.1 Uno");
    expect(exists(".notevault/regenerar/" + h.id + ".json")).toBe(true);
  });

  it("práctica: incrusta el prompt del diseñador y pide el JSON; ejercicios: una celda por archivo", async () => {
    const p = await make().study_topic_regenerate_handoff(A, "practice", true);
    const mdP = read(p.task);
    expect(mdP).toContain("practica.json");
    expect(mdP).toContain("Catalogue for subject");
    expect(exists(`${p.topics[0]!.backup}/4.1 Uno.practica.md`)).toBe(true);

    const e = await make().study_topic_regenerate_handoff(A, "exercises", true);
    const mdE = read(e.task);
    expect(mdE).toContain("ejercicios_implement_d1.json");
    expect(mdE).toContain("exactly the planned number of objects");
    expect(mdE).toContain("ejercicios_implement_d2.json");
    expect(mdE).toContain("ejercicios_implement_d3.json");
    expect(mdE).toContain('"title","statement","hints"');
    // los ejercicios actuales se COPIAN (no se mueven) hasta validar
    expect(exists(`${e.topics[0]!.backup}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(true);
    expect(exists(`${A}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(true);
  });

  it("un lote: UN solo archivo con todos los temas", async () => {
    const h = await make().study_topic_regenerate_handoff([A, B], "theory", true);
    expect(h.topics.map((t) => t.folder)).toEqual([A, B]);
    const md = read(h.task);
    expect(md).toContain(`\`${A}\``);
    expect(md).toContain(`\`${B}\``);
    expect(md.split("CONTRATO-DE-TEORIA").length - 1).toBe(1); // la skill va UNA vez, no por tema
    expect(h.topics[0]!.backup).not.toBe(h.topics[1]!.backup);
    expect(h.task).toContain("y 1 mas");
  });

  it("«todo» pide teoría, plan y ejercicios del plan nuevo", async () => {
    const h = await make().study_topic_regenerate_handoff(A, "all", true);
    const md = read(h.task);
    expect(md).toContain("#### Theory");
    expect(md).toContain("#### Practice plan");
    expect(md).toContain("ejercicios_<skill>_d<difficulty>.json");
  });

  it("una combinación («teoría + práctica») es UNA tarea con las dos cosas y sin ejercicios", async () => {
    const h = await make().study_topic_regenerate_handoff([A, B], "theory+practice", true);
    expect(h.what).toBe("theory+practice");
    const md = read(h.task);
    expect(md).toContain("Theory note and practice plan");
    expect(md).toContain("#### Theory");
    expect(md).toContain("#### Practice plan");
    expect(md).toContain("Base the plan on the theory note you write");
    expect(md).not.toContain("ejercicios_<skill>_d<difficulty>.json");
  });

  it("«teoría + ejercicios» usa las competencias del plan actual (no hay plan nuevo)", async () => {
    const h = await make().study_topic_regenerate_handoff(A, "theory+exercises", true);
    const md = read(h.task);
    expect(md).toContain("#### Theory");
    expect(md).not.toContain("#### Practice plan");
    expect(md).toMatch(/ejercicios_implement_d1/);
  });
});

describe("reabrir tareas guardadas", () => {
  it("lista las tareas de .notevault/regenerar (las nuevas primero) e ignora archivos dañados", async () => {
    const api = make();
    expect(api.study_topic_regenerate_handoff_list()).toEqual([]);
    const h1 = await api.study_topic_regenerate_handoff(A, "theory", true);
    const h2 = await api.study_topic_regenerate_handoff(B, "practice", true);
    fs.writeFileSync(abs(".notevault/regenerar/roto.json"), "{no es json", "utf-8");
    const list = api.study_topic_regenerate_handoff_list();
    expect(list.map((h) => h.id).sort()).toEqual([h1.id, h2.id].sort());
    expect(list.every((h) => h.status === "waiting" && h.prompt.length > 0)).toBe(true);
  });
});

describe("reabrir tareas guardadas", () => {
  it("lista las tareas de .notevault/regenerar e ignora archivos dañados", async () => {
    const api = make();
    expect(api.study_topic_regenerate_handoff_list()).toEqual([]);
    const h1 = await api.study_topic_regenerate_handoff(A, "theory", true);
    const h2 = await api.study_topic_regenerate_handoff(B, "practice", true);
    fs.writeFileSync(abs(".notevault/regenerar/roto.json"), "{no es json", "utf-8");
    const list = api.study_topic_regenerate_handoff_list();
    expect(list.map((h) => h.id).sort()).toEqual([h1.id, h2.id].sort());
    expect(list.every((h) => h.status === "waiting" && h.prompt.length > 0)).toBe(true);
  });
});

describe("validar lo que escribió el agente", () => {
  it("teoría: si el agente no cambió nada, no valida; con una nota buena la acepta, rehace el mapa y limpia cachés", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "theory", true);
    let st = await api.study_topic_regenerate_validate(h.id);
    expect(st.status).toBe("failed");
    expect(st.topics[0]!.problems[0]).toContain("no ha cambiado");
    expect(api.study_topic_regenerate_handoff_status(h.id).ready).toEqual({ found: 0, expected: 1 });

    put(`${A}/4.1 Uno.md`, NEW_NOTE.replace("# 4.1 Uno", "# 4.1 Uno"));
    expect(api.study_topic_regenerate_handoff_status(h.id).ready).toEqual({ found: 1, expected: 1 });
    st = await api.study_topic_regenerate_validate(h.id);
    expect(st.topics[0]!.problems).toEqual([]);
    expect(st.status).toBe("validated");
    expect(st.topics[0]!.state).toBe("ok");
    expect(read(`${A}/4.1 Uno.md`)).toContain("mm NUEVO");
    // el mapa se rehízo desde la nota; el canvas de antes (editado a mano, sin la marca de generado) se conserva y el nuevo va aparte
    expect(st.topics[0]!.created.some((f) => f.endsWith(".canvas"))).toBe(true);
    expect(read(`${A}/4.1 Uno — mapa.canvas`)).toContain('"id":"old"');
  });

  it("teoría cortada: falla con el motivo, deja lo del agente y «restaurar» devuelve la copia", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "theory", true);
    put(`${A}/4.1 Uno.md`, "---\nid: x\n---\n# 4.1 Uno\n\ncortada a la mitad");
    const bad = await api.study_topic_regenerate_validate(h.id);
    expect(bad.status).toBe("failed");
    expect(bad.topics[0]!.problems[0]).toContain("cortada");
    expect(read(`${A}/4.1 Uno.md`)).toContain("cortada a la mitad"); // sin tocar: el agente puede corregirla

    const back = await api.study_topic_regenerate_validate(h.id, true);
    expect(back.status).toBe("restored");
    expect(back.topics[0]!.restored).toBe(true);
    expect(read(`${A}/4.1 Uno.md`)).toBe(read(`${h.topics[0]!.backup}/4.1 Uno.md`));
    expect(read(`${A}/4.1 Uno — mapa.canvas`)).toContain('"id":"old"');
  });

  it("teoría con estructura rota (sin los cuatro campos): se rechaza con lo que falta", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "theory", true);
    put(`${A}/4.1 Uno.md`, NEW_NOTE.replace(/- \*\*Why it works:\*\* z\n/g, ""));
    const st = await api.study_topic_regenerate_validate(h.id);
    expect(st.status).toBe("failed");
    expect(st.topics[0]!.problems.some((p) => p.startsWith("Estructura:"))).toBe(true);
  });

  it("práctica: aplica el plan JSON con el parser de la app; uno inválido se rechaza", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "practice", true);
    expect((await api.study_topic_regenerate_validate(h.id)).topics[0]!.problems[0]).toContain("Falta");
    put(`${h.resultDir}/01 4.1 Uno/practica.json`, "no es json");
    expect((await api.study_topic_regenerate_validate(h.id)).topics[0]!.problems[0]).toContain("no es un plan válido");
    put(`${h.resultDir}/01 4.1 Uno/practica.json`, "```json\n" + PLAN_JSON + "\n```");
    const st = await api.study_topic_regenerate_validate(h.id);
    expect(st.status).toBe("validated");
    expect(read(`${A}/4.1 Uno.practica.md`)).toContain("implement=2/0/0");
  });

  it("completa solamente los ejercicios faltantes y conserva los anteriores", async () => {
    put(`${A}/4.1 Uno.practica.md`, PRACTICA(["implement"], "mixed", 'plan: "implement=4/2/0"\n'));
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "exercises", true, { missingOnly: true });
    const md = read(h.task);
    expect(md).toContain("difficulty 1 · 3 exercises");
    expect(md).toContain("difficulty 2 · 2 exercises");
    expect(md).toContain("Do not replace or remove existing exercises");
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`, JSON.stringify([ex(1), ex(2), ex(3)]));
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d2.json`, JSON.stringify([ex(4), ex(5)]));
    const result = await api.study_topic_regenerate_validate(h.id);
    expect(result.status).toBe("validated");
    expect(result.topics[0]!.created).toHaveLength(5);
    expect(read(`${A}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(OLD_EX);
  });

  it("valida en una sola tarea la práctica de un tema y los ejercicios faltantes de otro", async () => {
    put(`${A}/4.1 Uno.practica.md`, PRACTICA(["implement"], "mixed", 'plan: "implement=4/0/0"\n'));
    const api = make();
    const h = await api.study_topic_regenerate_handoff([A, B], "all", true, { missingOnly: true, work: [{ folder: A, steps: ["exercises"] }, { folder: B, steps: ["practice"] }] });
    expect(h.topics).toHaveLength(2);
    const md = read(h.task);
    expect(md).toContain("3 exercises");
    expect(md).toContain("02 4.2 Dos/practica.json");
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`, JSON.stringify([ex(1), ex(2), ex(3)]));
    put(`${h.resultDir}/02 4.2 Dos/practica.json`, PLAN_JSON);
    const done = await api.study_topic_regenerate_validate(h.id);
    expect(done.status).toBe("validated");
    expect(done.topics.map((t) => t.done)).toEqual([["exercises"], ["practice"]]);
    expect(read(`${A}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(OLD_EX);
    expect(read(`${B}/4.2 Dos.practica.md`)).toContain("implement=2/0/0");
  });

  it("actualiza la práctica y añade solo la diferencia del nuevo plan", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "all", true, { missingOnly: true, work: [{ folder: A, steps: ["practice", "exercises"] }] });
    expect(read(h.task)).toContain("Existing exercise counts");
    put(`${h.resultDir}/01 4.1 Uno/practica.json`, PLAN_JSON);
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`, JSON.stringify([ex(1)]));
    const done = await api.study_topic_regenerate_validate(h.id);
    expect(done.status).toBe("validated");
    expect(done.topics[0]!.created).toHaveLength(1);
    expect(read(`${A}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(OLD_EX);
  });

  it("no duplica ejercicios si la cantidad pendiente cambia después de crear la tarea", async () => {
    put(`${A}/4.1 Uno.practica.md`, PRACTICA(["implement"], "mixed", 'plan: "implement=4/0/0"\n'));
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "exercises", true, { missingOnly: true });
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`, JSON.stringify([ex(1), ex(2), ex(3)]));
    put(`${A}/Ejercicios/implement/added-later.md`, OLD_EX);
    const result = await api.study_topic_regenerate_validate(h.id);
    expect(result.status).toBe("failed");
    expect(result.topics[0]!.problems.join(" ")).toContain("cantidad pendiente");
    expect(result.topics[0]!.created).toHaveLength(0);
  });

  it("no deja un lote parcial si un nombre de ejercicio ya existe", async () => {
    put(`${A}/4.1 Uno.practica.md`, PRACTICA(["implement"], "mixed", 'plan: "implement=4/2/0"\n'));
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "exercises", true, { missingOnly: true });
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`, JSON.stringify([ex(1), ex(2), ex(3)]));
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d2.json`, JSON.stringify([ex(4), ex(5)]));
    const clock = vi.spyOn(Date, "now").mockReturnValue(123456789);
    try {
      const collision = `${A}/Ejercicios/implement/ej_implement_d2_123456789_1.md`;
      put(collision, "do not overwrite");
      const result = await api.study_topic_regenerate_validate(h.id);
      expect(result.status).toBe("failed");
      expect(result.topics[0]!.problems.join(" ")).toContain("no se sobrescribió ningún ejercicio");
      expect(read(collision)).toBe("do not overwrite");
      expect(exists(`${A}/Ejercicios/implement/ej_implement_d1_123456789_1.md`)).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("ejercicios: valida el esquema, escribe las notas y archiva los anteriores", async () => {
    put(`${A}/4.1 Uno.practica.md`, PRACTICA(["implement"], "mixed", 'plan: "implement=4/2/0"\n'));
    const api = make();
    const h = await api.study_topic_regenerate_handoff(A, "exercises", true);
    const out = `${h.resultDir}/01 4.1 Uno/ejercicios_implement_d1.json`;
    put(out, JSON.stringify([ex(1), { title: "roto", statement: "x" }, ex(3)]));
    const bad = await api.study_topic_regenerate_validate(h.id);
    expect(bad.topics[0]!.problems[0]).toContain("2 ejercicio(s) válido(s)");
    expect(exists(`${A}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(true); // los viejos siguen ahí

    put(out, JSON.stringify([ex(1), ex(2), ex(3), ex(4)]));
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d2.json`, JSON.stringify([ex(5), { ...ex(6), hints: [] }]));
    const withoutHints = await api.study_topic_regenerate_validate(h.id);
    expect(withoutHints.topics[0]!.problems.join(" ")).toContain("pistas");
    put(`${h.resultDir}/01 4.1 Uno/ejercicios_implement_d2.json`, JSON.stringify([ex(5), ex(6)]));
    const ok = await api.study_topic_regenerate_validate(h.id);
    expect(ok.status).toBe("validated");
    expect(ok.topics[0]!.created).toHaveLength(6);
    const files = fs.readdirSync(abs(`${A}/Ejercicios/implement`));
    expect(files.filter((f) => f.startsWith("ej_implement_d1_"))).toHaveLength(4);
    expect(files).not.toContain("ej_implement_d1_1_0.md"); // archivado
    expect(exists(`${ok.topics[0]!.backup}/Ejercicios/implement/ej_implement_d1_1_0.md`)).toBe(true);
    expect(read(`${A}/Ejercicios/implement/${files[0]}`)).toContain("type: exercise");
  });

  it("lote: cada tema se valida por separado y un fallo no tumba al otro; restaurar solo toca al que falló", async () => {
    const api = make();
    const h = await api.study_topic_regenerate_handoff([A, B], "theory", true);
    put(`${A}/4.1 Uno.md`, NEW_NOTE);
    put(`${B}/4.2 Dos.md`, "---\nid: y\n---\n# 4.2 Dos\n\ncortada");
    const st = await api.study_topic_regenerate_validate(h.id);
    expect(st.topics.map((t) => t.state)).toEqual(["ok", "error"]);
    expect(st.status).toBe("failed");
    const back = await api.study_topic_regenerate_validate(h.id, true);
    expect(back.topics.map((t) => t.state)).toEqual(["ok", "restored"]);
    expect(back.status).toBe("restored");
    expect(read(`${A}/4.1 Uno.md`)).toContain("mm NUEVO"); // el bueno se queda
    expect(read(`${B}/4.2 Dos.md`)).toContain("# 4.2 Dos");
    expect(read(`${B}/4.2 Dos.md`)).not.toContain("cortada");
  });
});

describe("ids de tarea con comas (títulos como «Project structure, virtual environments…»)", () => {
  it("una tarea creada con un tema cuyo título lleva coma se puede reabrir y validar (antes: «Esa tarea no existe»)", async () => {
    const T = `${AREA}/4.3 Uno, dos y tres`;
    put(`${T}/4.3 Uno, dos y tres.md`, OLD_NOTE);
    put(`${T}/4.3 Uno, dos y tres.practica.md`, PRACTICA(["implement"]));
    const h = await make().study_topic_regenerate_handoff(T, "theory", true);
    expect(h.id).not.toContain(",");
    // un id antiguo con coma (ya guardado en disco) también se acepta
    const legacy = "2026-10-30_09-26-38_4.3 Uno, dos y tres";
    fs.copyFileSync(abs(`.notevault/regenerar/${h.id}.json`), abs(`.notevault/regenerar/${legacy}.json`));
    expect(make().study_topic_regenerate_handoff_status(legacy).id).toContain("Uno");
    expect(() => make().study_topic_regenerate_handoff_status("../x")).toThrow("no existe");
  });
});

describe("no se pide de nuevo lo que ya está al día", () => {
  it("«todo» sobre temas con la teoría vieja (desactualizada) la sigue pidiendo", async () => {
    const h = await make().study_topic_regenerate_handoff(A, "theory+practice", true);
    expect(h.what).toBe("theory+practice");
  });
});

describe("invariante: todo id que la app crea, la app lo puede reabrir", () => {
  const TITLES = ["Uno, dos y tres", "Datos (y más) & cosas", "It's a test #1", "Año 2026; ñandú", "A+B = C", "Con [corchetes] y {llaves}", "x".repeat(80)];
  it.each(TITLES)("título «%s»: crear → listar → estado", async (title) => {
    const folder = `${AREA}/4.9 ${title}`;
    put(`${folder}/4.9 ${title}.md`, OLD_NOTE);
    put(`${folder}/4.9 ${title}.practica.md`, PRACTICA(["implement"]));
    const api = make();
    const h = await api.study_topic_regenerate_handoff(folder, "theory", true);
    expect(api.study_topic_regenerate_handoff_status(h.id).id).toBe(h.id);
    expect(api.study_topic_regenerate_handoff_list().some((x) => x.id === h.id)).toBe(true);
  });
});
