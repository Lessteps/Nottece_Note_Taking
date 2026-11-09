/**
 * Deterministic local grader for project structure and command exercises (no AI required).
 * Evaluates file paths, sequential commands, terminal execution verification, and architecture justification.
 */

import type { GradeError, GradeResult } from "./grading.js";
import type { ExerciseNote } from "./exerciseNote.js";

export interface ParsedStructureAnswer {
  paths: string[];
  commands: string[];
  notes: string;
  terminalVerified: boolean;
  terminalExitCode: number | null;
}

export function parseStructureAnswer(answer: string): ParsedStructureAnswer {
  const lines = (answer || "").split("\n").map((l) => l.trim());
  const paths: string[] = [];
  const commands: string[] = [];
  let notes = "";
  let terminalVerified = false;
  let terminalExitCode: number | null = null;

  let section: "tree" | "cmds" | "notes" | "term" = "tree";

  for (const l of lines) {
    if (/^###\s*Estructura/i.test(l)) {
      section = "tree";
      continue;
    }
    if (/^###\s*Comandos|Secuencia/i.test(l)) {
      section = "cmds";
      continue;
    }
    if (/^###\s*Notas|Justificaci|Explicaci/i.test(l)) {
      section = "notes";
      continue;
    }
    if (/^###\s*Verificaci|Terminal/i.test(l)) {
      section = "term";
      continue;
    }

    if (section === "tree") {
      if (l && !l.startsWith("```") && !l.startsWith("#")) {
        const p = l.replace(/^[-*•]\s+/, "").replace(/^[├└│─\s]+/, "").trim();
        if (p && p !== "proyecto/" && !paths.includes(p)) paths.push(p);
      }
    } else if (section === "cmds") {
      const c = l.replace(/^\d+[\.\)]\s+/, "").replace(/^[-*•\$]\s+/, "").trim();
      if (c && !c.startsWith("```") && !commands.includes(c)) commands.push(c);
    } else if (section === "notes") {
      if (l && !l.startsWith("#")) {
        notes = notes ? `${notes}\n${l}` : l;
      }
    } else if (section === "term") {
      if (/exit\s*code\s*0/i.test(l) || /éxito|exitosamente|passed/i.test(l)) {
        terminalVerified = true;
        terminalExitCode = 0;
      }
    }
  }

  return { paths, commands, notes, terminalVerified, terminalExitCode };
}

export function gradeProjectStructure(ex: ExerciseNote, answer: string): GradeResult {
  const parsed = parseStructureAnswer(answer);
  const rubricLen = ex.rubric && ex.rubric.length > 0 ? ex.rubric.length : 3;
  const rubricResults: boolean[] = [];
  const errors: GradeError[] = [];

  const fullText = `${ex.statement || ""}\n${ex.solution || ""}\n${(ex.rubric || []).join("\n")}`.toLowerCase();

  // 1. Evaluate file structure
  const hasVenv = parsed.paths.some((p) => p.includes(".venv"));
  const hasMain = parsed.paths.some((p) => p === "main.py" || p.endsWith("/main.py") || p.includes("app.py"));

  // Check specific files mentioned in rubric or solution
  const potentialKeywords = [".venv", "main.py", "helpers.py", "formatters.py", "database.py", "test_", "text.py", "settings.py", "requirements.txt"];
  const requiredKeywords = potentialKeywords.filter((kw) => fullText.includes(kw));
  const missingFiles = requiredKeywords.filter((kw) => !parsed.paths.some((p) => p.includes(kw)));

  // 2. Evaluate sequential commands
  const hasVenvCmd = parsed.commands.some((c) => c.includes("venv"));
  const hasRunCmd = parsed.commands.some((c) => c.includes("main.py") || c.includes("start") || c.includes("pytest"));
  const venvIdx = parsed.commands.findIndex((c) => c.includes("venv"));
  const runIdx = parsed.commands.findIndex((c) => c.includes("main.py") || c.includes("start"));
  const orderCorrect = venvIdx === -1 || runIdx === -1 ? true : venvIdx < runIdx;

  // 3. Evaluate each rubric item
  for (let i = 0; i < rubricLen; i++) {
    const itemText = ((ex.rubric && ex.rubric[i]) || "").toLowerCase();

    const isCommandItem =
      itemText.includes("comando") ||
      itemText.includes("secuencia") ||
      itemText.includes("ejecut") ||
      itemText.includes("python ") ||
      itemText.includes("pip ") ||
      itemText.includes("terminal");

    const isJustificationItem =
      itemText.includes("import") ||
      itemText.includes("justific") ||
      itemText.includes("sintaxis") ||
      itemText.includes("explica") ||
      itemText.includes("aislamiento") ||
      itemText.includes("razón");

    if (isCommandItem) {
      // Check command rubric
      const pass = hasVenvCmd && (hasRunCmd || !fullText.includes("main.py")) && orderCorrect;
      rubricResults.push(pass);
      if (!pass) {
        if (!orderCorrect) {
          errors.push({
            category: "procedural",
            anchor: "Orden de comandos",
            description: "El orden de ejecución de comandos es incorrecto: debes crear el entorno virtual antes de ejecutar la aplicación.",
            evidence: parsed.commands.join(" -> "),
            fix: "Reordena los comandos colocando 'python -m venv .venv' antes de 'python main.py'.",
          });
        } else {
          errors.push({
            category: "procedural",
            anchor: "Comandos de terminal",
            description: "Faltan comandos de terminal esenciales para el entorno y ejecución.",
            evidence: parsed.commands.join(", ") || "(sin comandos)",
            fix: "Incluye 'python -m venv .venv' y 'python main.py' en la secuencia.",
          });
        }
      }
    } else if (isJustificationItem) {
      // Check import / justification rubric
      const noteLower = parsed.notes.toLowerCase();
      const ansLower = answer.toLowerCase();
      const hasImportWord =
        noteLower.includes("import") ||
        noteLower.includes("from ") ||
        ansLower.includes("from ") ||
        noteLower.includes("aisla") ||
        noteLower.includes("dependencia") ||
        parsed.notes.split(/\s+/).length >= 8;
      rubricResults.push(hasImportWord);
      if (!hasImportWord) {
        errors.push({
          category: "conceptual",
          anchor: "Justificación de arquitectura",
          description: "La justificación técnica de imports o aislamiento está ausente o es demasiado breve.",
          evidence: parsed.notes || "(vacío)",
          fix: "Explica cómo se importa el módulo (ej. 'from utils import ...') y la razón de aislar dependencias.",
        });
      }
    } else {
      // Check structure rubric
      const pass = missingFiles.length === 0 && (hasVenv || !fullText.includes(".venv")) && (hasMain || !fullText.includes("main.py"));
      rubricResults.push(pass);
      if (!pass && errors.length === 0) {
        errors.push({
          category: "procedural",
          anchor: "Estructura de archivos",
          description: missingFiles.length > 0 ? `Faltan elementos requeridos en la estructura: ${missingFiles.join(", ")}` : "La estructura de archivos está incompleta.",
          evidence: parsed.paths.join(", ") || "(vacío)",
          fix: `Añade las carpetas y archivos indicados en los requisitos (${requiredKeywords.join(", ")}).`,
        });
      }
    }
  }

  // Calculate score
  const passedCount = rubricResults.filter(Boolean).length;
  let score = Math.round((passedCount / rubricLen) * 100);

  // Bonus for real terminal execution:
  // If the learner verified the commands in the terminal with exit code 0, confirm full mastery
  if (parsed.terminalVerified && score >= 60 && errors.length === 0) {
    score = 100;
  }

  const verdict = score >= 85 ? "correct" : score >= 50 ? "partial" : "incorrect";

  let feedback = "";
  let nextStep = "";

  if (verdict === "correct") {
    feedback = "¡Excelente trabajo! Has construido la arquitectura del proyecto con la jerarquía de carpetas correcta, ordenaste la secuencia exacta de comandos de terminal y confirmaste la ejecución en el sandbox.";
    nextStep = "Continúa con el siguiente ejercicio para dominar las técnicas de empaquetado y configuración.";
  } else if (verdict === "partial") {
    feedback = `Has avanzado en la configuración del proyecto (${passedCount} de ${rubricLen} requisitos cumplidos), pero quedan detalles por corregir en la estructura de archivos o en el orden de los comandos.`;
    nextStep = "Revisa las rutas faltantes o ajusta el orden en la cola de ejecución antes de volver a entregar.";
  } else {
    feedback = "La solución entregada aún no cumple los requisitos básicos de estructura del proyecto y comandos de entorno.";
    nextStep = "Añade las carpetas y archivos requeridos, ordena la secuencia en la terminal y ejecuta para validar.";
  }

  return {
    score,
    verdict,
    rubric: rubricResults,
    errors,
    feedback,
    next_step: nextStep,
    example: ex.solution.trim(),
  };
}
