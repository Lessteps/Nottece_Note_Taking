import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExerciseNote } from "./exerciseNote.js";
import { ensureKataWorkspace } from "./kataWorkspace.js";
import { writePracticeSubmission } from "./submissionFiles.js";

describe("ensureKataWorkspace y resolución de katas", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nv-kata-ws-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("al crear o abrir una kata crea la carpeta con la doc (README.md) y el archivo normal de código (solucion.py)", () => {
    const kataRel = "Programación/programming_practice/backend/katas/001 Endpoint design - loans.md";
    const kataAbs = path.join(root, kataRel);
    fs.mkdirSync(path.dirname(kataAbs), { recursive: true });
    fs.writeFileSync(kataAbs, [
      "---",
      "type: exercise",
      "subject: programming",
      "discipline: programming_practice",
      "title: Endpoint design - loans",
      "mode: pp_kata",
      "area: backend",
      "---",
      "# Endpoint design - loans",
      "## Statement",
      "Diseña la API de préstamos.",
      "## Rubric",
      "- [ ] Usa verbos HTTP adecuados",
    ].join("\n"), "utf8");

    const ex = new ExerciseNote({
      note_id: "kata_001",
      title: "Endpoint design - loans",
      statement: "Diseña la API de préstamos.",
      subject: "programming",
      discipline: "programming_practice",
      mode: "pp_kata",
      frontmatter: { area: "backend" },
    });

    const info = ensureKataWorkspace(root, kataRel, ex);
    expect(info).not.toBeNull();
    expect(info?.extension).toBe("py");

    const companionDir = path.join(root, "Programación/programming_practice/backend/katas/001 Endpoint design - loans");
    expect(fs.existsSync(companionDir)).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "solucion.py"))).toBe(true);

    const readme = fs.readFileSync(path.join(companionDir, "README.md"), "utf8");
    expect(readme).toContain("Endpoint design - loans");
    expect(readme).toContain("Diseña la API de préstamos.");

    const code = fs.readFileSync(path.join(companionDir, "solucion.py"), "utf8");
    expect(code).toContain("def solucion():");
  });

  it("para áreas frontend o typescript genera solucion.ts", () => {
    const kataRel = "Programación/programming_practice/frontend/katas/001 Boton UI.md";
    const kataAbs = path.join(root, kataRel);
    fs.mkdirSync(path.dirname(kataAbs), { recursive: true });
    fs.writeFileSync(kataAbs, "---\ntype: exercise\narea: frontend\n---\n# Boton UI\n## Statement\nComponente", "utf8");

    const ex = new ExerciseNote({
      note_id: "kata_fe",
      title: "Boton UI",
      statement: "Componente",
      subject: "programming",
      discipline: "programming_practice",
      mode: "pp_kata",
      frontmatter: { area: "frontend" },
    });

    const info = ensureKataWorkspace(root, kataRel, ex);
    expect(info?.extension).toBe("ts");
    const companionDir = path.join(root, "Programación/programming_practice/frontend/katas/001 Boton UI");
    expect(fs.existsSync(path.join(companionDir, "solucion.ts"))).toBe(true);
  });

  it("al resolver una kata, writePracticeSubmission crea la carpeta de intento con README.md, solucion.py y actualiza la solucion principal", () => {
    const kataRel = "Programación/programming_practice/backend/katas/001 Endpoint design - loans.md";
    const kataAbs = path.join(root, kataRel);
    fs.mkdirSync(path.dirname(kataAbs), { recursive: true });
    fs.writeFileSync(kataAbs, "# Kata\n## Statement\nDiseña la API.", "utf8");

    const ex = new ExerciseNote({
      note_id: "kata_001",
      title: "Endpoint design - loans",
      statement: "Diseña la API.",
      subject: "programming",
      discipline: "programming_practice",
      mode: "pp_kata",
      frontmatter: { area: "backend" },
    });

    // Inicializa la carpeta
    ensureKataWorkspace(root, kataRel, ex);

    // Resuelve la kata
    const attempt = {
      at: "2026-11-18T10:00:00",
      answer: "```python\ndef solution():\n    return {'status': 'ok'}\n```",
      score: 95,
      verdict: "correct",
      feedback: "Excelente diseño REST.",
    };

    const subRel = writePracticeSubmission(root, ex, kataRel, attempt, 1);
    expect(subRel).not.toBeNull();

    const intentoDir = path.join(root, subRel!);
    expect(fs.existsSync(path.join(intentoDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(intentoDir, "solucion.py"))).toBe(true);
    expect(fs.existsSync(path.join(intentoDir, "entrega.json"))).toBe(true);

    const intentoReadme = fs.readFileSync(path.join(intentoDir, "README.md"), "utf8");
    expect(intentoReadme).toContain("Excelente diseño REST.");
    expect(intentoReadme).toContain("solucion.py");

    const intentoCode = fs.readFileSync(path.join(intentoDir, "solucion.py"), "utf8");
    expect(intentoCode).toContain("return {'status': 'ok'}");

    // Comprueba que el archivo de código normal en la carpeta del kata se actualizó
    const companionCode = fs.readFileSync(
      path.join(root, "Programación/programming_practice/backend/katas/001 Endpoint design - loans/solucion.py"),
      "utf8",
    );
    expect(companionCode).toContain("return {'status': 'ok'}");
  });
});

