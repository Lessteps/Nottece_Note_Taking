import * as fs from "node:fs";
import * as path from "node:path";
import type { ExerciseNote } from "./exerciseNote.js";
import { exerciseCodeExtension } from "./submissionFiles.js";

export interface KataWorkspaceInfo {
  folderRel: string;
  readmeRel: string;
  codeRel: string;
  extension: string;
}

/**
 * Asegura que una kata tenga su carpeta correspondiente con la documentación (README.md)
 * y el archivo normal de código (solucion.<ext>), exactamente igual que en el sistema de práctica de código.
 */
export function ensureKataWorkspace(
  root: string,
  kataRelPath: string,
  exercise?: Partial<ExerciseNote> | { title?: string; statement?: string; criteria?: string[]; rubric?: string[]; area?: string; skillName?: string; hints?: string[] },
): KataWorkspaceInfo | null {
  const absPath = path.resolve(root, kataRelPath);
  if (!fs.existsSync(absPath)) return null;

  // Carpeta complementaria del kata (sin la extensión .md)
  const baseDir = path.join(path.dirname(absPath), path.basename(absPath, path.extname(absPath)));
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Inferir lenguaje / extensión
  const frontmatter = ((exercise as ExerciseNote)?.frontmatter ?? exercise ?? {}) as Record<string, unknown>;
  const area = String(frontmatter.area ?? (exercise as any)?.area ?? "").toLowerCase();
  let ext = "py";
  if (exercise && "subject" in exercise && (exercise as ExerciseNote).subject === "programming") {
    ext = exerciseCodeExtension(exercise as ExerciseNote) || "py";
  } else {
    ext = area === "frontend" || area === "desktop" || area === "mobile" ? "ts" : area === "databases" ? "sql" : "py";
  }

  const title = exercise?.title || path.basename(absPath, path.extname(absPath));
  const statement = exercise?.statement || "";
  const criteria = (exercise as any)?.criteria || (exercise as any)?.rubric || [];
  const hints = (exercise as any)?.hints || [];

  const readmePath = path.join(baseDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    const docLines = [
      `# ${title}`,
      "",
      area ? `> Área: ${area}` : "",
      "",
      "## Enunciado",
      "",
      statement || "Resuelve el reto planteado en el archivo normal de código.",
      "",
    ];
    if (criteria.length > 0) {
      docLines.push("## Criterios de evaluación", "", ...criteria.map((c: string) => `- [ ] ${c}`), "");
    }
    if (hints.length > 0) {
      docLines.push("## Pistas", "", ...hints.map((h: string, i: number) => `### Pista ${i + 1}\n\n${h}`), "");
    }

    try {
      fs.writeFileSync(readmePath, docLines.filter((l) => l !== undefined).join("\n"), { encoding: "utf8", flag: "wx" });
    } catch { /* ya existe */ }
  }

  const codePath = path.join(baseDir, `solucion.${ext}`);
  if (!fs.existsSync(codePath)) {
    const commentPrefix = ext === "sql" ? "--" : ext === "ts" || ext === "js" ? "//" : "#";
    const starter = [
      `${commentPrefix} ${title}`,
      `${commentPrefix} Escribe tu solución aquí...`,
      "",
      ext === "py"
        ? "def solucion():\n    pass\n"
        : ext === "ts" || ext === "js"
          ? "export function solucion() {\n  // Tu código aquí\n}\n"
          : "-- Escribe tu consulta SQL aquí\n",
    ].join("\n");

    try {
      fs.writeFileSync(codePath, starter, { encoding: "utf8", flag: "wx" });
    } catch { /* ya existe */ }
  }

  return {
    folderRel: path.relative(root, baseDir).split(path.sep).join("/"),
    readmeRel: path.relative(root, readmePath).split(path.sep).join("/"),
    codeRel: path.relative(root, codePath).split(path.sep).join("/"),
    extension: ext,
  };
}

