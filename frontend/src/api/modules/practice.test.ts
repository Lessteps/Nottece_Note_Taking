import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as aiClient from "../../core/aiClient.js";
import { BRIDGE_CHATGPT } from "../../core/aiClient.js";
import { ApiError } from "../../core/errors.js";
import { PracticeAttemptStore } from "../../core/practice/attempts.js";
import { AppConfig } from "../appConfig.js";
import { AppState } from "../appState.js";
import { practiceApi } from "./practice.js";

const ROOT = path.resolve(__dirname, "../../../..");
const MATH_FILE = path.join(
  ROOT,
  "docs",
  "knowledge_base",
  "examples",
  "Matemáticas",
  "1 Lógica y demostración",
  "1.10 Inducción matemática",
  "Ejercicios",
  "1.10-E01 Suma de los primeros impares.md",
);
const DRILL_FILE = path.join(
  ROOT,
  "docs",
  "knowledge_base",
  "examples",
  "practice",
  "P-DRILL-01 Fracciones sprint.md",
);

const REPLY = JSON.stringify({
  score: 80,
  verdict: "partial",
  rubric: [true, true, true, false, true],
  errors: [
    { category: "logical", description: "x", evidence: "y", fix: "z" },
  ],
  feedback: "Bien.",
  next_step: "Repasa.",
  example: "k^2",
});

describe("practiceApi", () => {
  let tmpDir: string;
  let app: AppState;
  let api: ReturnType<typeof practiceApi>;
  let aiConfigData: Record<string, unknown>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_practice_web_"));
    fs.copyFileSync(MATH_FILE, path.join(tmpDir, "Impares.md"));
    fs.copyFileSync(DRILL_FILE, path.join(tmpDir, "Drill.md"));
    fs.writeFileSync(path.join(tmpDir, "Plain.md"), "# nada\n", "utf-8");

    app = new AppState(tmpDir);
    api = practiceApi(app);

    aiConfigData = {
      provider: "lmstudio",
      base_url: "http://127.0.0.1:1234/v1",
      model: "m",
    };
    vi.spyOn(AppConfig, "get_ai_config").mockImplementation(() => ({
      ...aiConfigData,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("test_load", () => {
    const ex = api.practice_load("Impares.md") as Record<string, any>;
    expect(ex.mode.id).toBe("prove");
    expect(ex.hints).toHaveLength(3);
    expect(ex.rubric).toHaveLength(5);
    expect(ex.timer.kind).toBe("countdown");
    expect(ex.solution).toBeUndefined();

    expect(() => api.practice_load("Plain.md")).toThrow(ApiError);
    expect(() => api.practice_load("../x.md")).toThrow(ApiError);
  });

  it("grades an English dictation against its transcript with no AI call", async () => {
    const sendSpy = vi.spyOn(aiClient, "sendChat").mockResolvedValue(REPLY);
    fs.writeFileSync(
      path.join(tmpDir, "Dictado.md"),
      `---
type: exercise
subject: english
title: "Dictado"
mode: ls_dictation
discipline: english_listening
difficulty: 1
level: A2
assistance: nohelp
---

# Dictado

## Enunciado
Escribe lo que oigas.

## Texto del audio
The next train leaves at ten to six.

## Solución
The next train leaves at ten to six.

## Rúbrica
- [ ] Todas las palabras
- [ ] Ortografía
- [ ] Terminaciones
`,
      "utf-8",
    );
    const out = (await api.practice_grade("Dictado.md", "the next train leave at ten six")) as Record<string, any>;
    expect(out.graded).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(out.result.feedback).toContain("Te faltaron: «to»");
    expect(out.result.score).toBeLessThan(90);
    const exact = (await api.practice_grade("Dictado.md", "The next train leaves at ten to six.")) as Record<string, any>;
    expect(exact.result.score).toBe(100);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("grades a programming project_structure lab deterministically with no AI call", async () => {
    const sendSpy = vi.spyOn(aiClient, "sendChat").mockResolvedValue(REPLY);
    fs.writeFileSync(
      path.join(tmpDir, "Lab.md"),
      `---
type: exercise
subject: programming
discipline: python
mode: project_structure
title: Estructura de Proyecto
---
# Estructura
## Statement
Crea \`.venv/\`, \`main.py\` y ejecuta \`python -m venv .venv\` y \`python main.py\`.
## Solution
.venv/
main.py
## Rubric
- [ ] Incluye .venv/ y main.py
- [ ] Ejecuta python -m venv .venv y python main.py
`,
      "utf-8",
    );

    const submission = `
### Estructura de archivos y carpetas
.venv/
main.py

### Secuencia de comandos en orden
1. python -m venv .venv
2. python main.py

### Justificación
Aislamiento de dependencias para el proyecto.

### Verificación en Terminal
- Estado: Ejecutado con éxito (Exit code 0)
`;

    const out = (await api.practice_grade("Lab.md", submission)) as Record<string, any>;
    expect(out.graded).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(out.result.score).toBe(100);
    expect(out.result.verdict).toBe("correct");
    expect(out.result.feedback).toContain("¡Excelente trabajo!");
  });

  it("test_http_grading_records_the_attempt", async () => {
    const sendSpy = vi.spyOn(aiClient, "sendChat").mockResolvedValue(REPLY);

    const out = (await api.practice_grade(
      "Impares.md",
      "Caso base... paso inductivo...",
      1,
      300,
      false,
    )) as Record<string, any>;

    expect(out.graded).toBe(true);
    expect(out.result.score).toBe(80);
    expect(out.history).toHaveLength(1);

    expect(sendSpy).toHaveBeenCalled();
    const sentMessages = sendSpy.mock.calls[0]![1];
    expect(sentMessages[sentMessages.length - 1]!.content).toContain("Caso base");

    const attempts = new PracticeAttemptStore(tmpDir).attempts(
      "mat.logica.induccion.e01",
    );
    expect(attempts).toHaveLength(1);
    const att = attempts[0]!;
    expect(att.hints_used).toBe(1);
    expect(att.seconds).toBe(300);
    expect(att.transport).toBe("http");

    await expect(api.practice_grade("Impares.md", "   ")).rejects.toThrow(
      ApiError,
    );
  });

  it("test_bad_ai_reply_is_an_error_not_a_grade", async () => {
    vi.spyOn(aiClient, "sendChat").mockResolvedValue("no sé");

    await expect(api.practice_grade("Impares.md", "respuesta")).rejects.toThrow(
      ApiError,
    );

    const attempts = new PracticeAttemptStore(tmpDir).attempts(
      "mat.logica.induccion.e01",
    );
    expect(attempts).toEqual([]);
  });

  it("test_bridge_request_then_pasted_reply", async () => {
    aiConfigData.provider = BRIDGE_CHATGPT;

    const out = (await api.practice_grade(
      "Impares.md",
      "mi demostración",
      0,
      60,
      false,
    )) as Record<string, any>;

    expect(out.graded).toBe(false);
    expect(out.bridge).toBe(true);
    expect(out.prompt).toContain("mi demostración");

    const req = out.request as string;
    const loaded = api.practice_load("Impares.md") as Record<string, any>;
    expect(loaded.pending?.id).toBe(req);

    const waitingReply = api.practice_reply("Impares.md", req) as Record<string, any>;
    expect(waitingReply.waiting).toBe(true);

    const done = api.practice_reply(
      "Impares.md",
      req,
      "```json\n" + REPLY + "\n```",
    ) as Record<string, any>;
    expect(done.result.score).toBe(80);

    const loadedAfter = api.practice_load("Impares.md") as Record<string, any>;
    expect(loadedAfter.pending).toBeNull();

    expect(() => api.practice_reply("Impares.md", "../../x")).toThrow(ApiError);
  });

  it("test_bridge_prompt_via_button_without_bridge_provider", async () => {
    aiConfigData.provider = "openai";
    const out = (await api.practice_grade(
      "Impares.md",
      "def solve(): pass",
      0,
      45,
      false,
      "bridge",
    )) as Record<string, any>;

    expect(out.graded).toBe(false);
    expect(out.bridge).toBe(true);
    expect(out.prompt).toContain("def solve(): pass");
    expect(out.url).toBe("https://chatgpt.com");

    const req = out.request as string;
    const done = api.practice_reply(
      "Impares.md",
      req,
      REPLY,
    ) as Record<string, any>;
    expect(done.result.score).toBe(80);

    const attempts = new PracticeAttemptStore(tmpDir).attempts(
      "mat.logica.induccion.e01",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.transport).toBe("bridge");
  });

  it("test_handoff_file_answered_by_an_agent", async () => {
    const out = (await api.practice_grade(
      "Impares.md",
      "respuesta",
      0,
      0,
      false,
      "handoff",
    )) as Record<string, any>;

    fs.writeFileSync(out.response_file, REPLY, "utf-8");

    const finished = api.practice_reply("Impares.md", out.request) as Record<
      string,
      any
    >;
    expect(finished.graded).toBe(true);
  });

  it("test_give_up_shows_solution_and_records_zero", () => {
    const out = api.practice_give_up("Impares.md", 30) as Record<string, any>;
    expect(out.solution).toContain("Caso base");
    expect(out.result.score).toBe(0);
  });

  it("test_drill", () => {
    const ex = api.practice_load("Drill.md") as Record<string, any>;
    expect(ex.mode.answer_kind).toBe("drill");

    const s = api.practice_drill_start("Drill.md") as Record<string, any>;
    expect(s.prompts).toHaveLength(ex.drill.items);

    const first = api.practice_drill_check(s.session, 0, "0") as Record<
      string,
      any
    >;
    expect(first.answer).toBeDefined();

    expect(() => api.practice_drill_check(s.session, 5, "1")).toThrow(ApiError);

    const out = api.practice_drill_finish(s.session, 40) as Record<string, any>;
    expect(out.graded).toBe(true);

    expect(() => api.practice_drill_finish(s.session)).toThrow(ApiError);
  });
});
