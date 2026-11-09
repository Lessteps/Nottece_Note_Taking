import { describe, expect, it } from "vitest";
import { ExerciseNote } from "./exerciseNote";
import { gradeProjectStructure, parseStructureAnswer } from "./projectStructureGrade";

describe("parseStructureAnswer", () => {
  it("extracts paths, commands, notes and terminal verification status", () => {
    const raw = `
### Estructura de archivos y carpetas
.venv/
main.py
utils/helpers.py
tests/test_helpers.py

### Secuencia de comandos en orden
1. python -m venv .venv
2. source .venv/bin/activate
3. python main.py

### Justificación
La carpeta .venv/ mantiene las dependencias del proyecto aisladas sin colisiones globales.

### Verificación en Terminal
- Estado: Ejecutado con éxito (Exit code 0)
- Comandos verificados: python -m venv .venv; python main.py
    `.trim();

    const parsed = parseStructureAnswer(raw);
    expect(parsed.paths).toEqual([".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"]);
    expect(parsed.commands).toEqual(["python -m venv .venv", "source .venv/bin/activate", "python main.py"]);
    expect(parsed.notes).toContain("aisladas");
    expect(parsed.terminalVerified).toBe(true);
    expect(parsed.terminalExitCode).toBe(0);
  });
});

describe("gradeProjectStructure", () => {
  const sampleExercise = new ExerciseNote({
    subject: "programming",
    discipline: "python",
    mode: "project_structure",
    statement: "Organiza un proyecto llamado my_project con .venv/, main.py, utils/helpers.py y tests/test_helpers.py. Comandos: python -m venv .venv y python main.py.",
    solution: `
1. Estructura:
.venv/
main.py
utils/helpers.py
tests/test_helpers.py

2. Comandos:
python -m venv .venv
python main.py
    `.trim(),
    rubric: [
      "Incluye .venv/, main.py, utils/helpers.py y tests/test_helpers.py.",
      "Especifica el comando python -m venv .venv para crear el entorno virtual.",
      "Especifica la ejecución python main.py desde la raíz.",
    ],
  });

  it("grades a complete verified submission as correct (100% score)", () => {
    const answer = `
### Estructura de archivos y carpetas
.venv/
main.py
utils/helpers.py
tests/test_helpers.py

### Secuencia de comandos en orden
1. python -m venv .venv
2. python main.py

### Justificación
Aísla dependencias con .venv e importa utils.helpers desde main.py.

### Verificación en Terminal
- Estado: Ejecutado con éxito (Exit code 0)
    `.trim();

    const result = gradeProjectStructure(sampleExercise, answer);
    expect(result.score).toBe(100);
    expect(result.verdict).toBe("correct");
    expect(result.rubric.every(Boolean)).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.feedback).toContain("¡Excelente trabajo!");
  });

  it("detects missing paths and returns partial verdict with errors", () => {
    const answer = `
### Estructura de archivos y carpetas
main.py

### Secuencia de comandos en orden
1. python -m venv .venv
2. python main.py
    `.trim();

    const result = gradeProjectStructure(sampleExercise, answer);
    expect(result.score).toBeLessThan(100);
    expect(result.verdict).not.toBe("correct");
    expect(result.rubric[0]).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.category).toBe("procedural");
  });

  it("detects wrong command order (running main.py before venv)", () => {
    const answer = `
### Estructura de archivos y carpetas
.venv/
main.py
utils/helpers.py
tests/test_helpers.py

### Secuencia de comandos en orden
1. python main.py
2. python -m venv .venv
    `.trim();

    const result = gradeProjectStructure(sampleExercise, answer);
    expect(result.rubric[1]).toBe(false);
    expect(result.errors.some((e) => e.description.includes("orden"))).toBe(true);
  });
});

