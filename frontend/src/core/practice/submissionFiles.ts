import * as fs from "node:fs";
import * as path from "node:path";
import type { ExerciseNote } from "./exerciseNote.js";
import { MODES } from "./modes.js";

/** Guarda una entrega individual sin reemplazar archivos escritos por el usuario. */
export function writePracticeSubmission(root: string, ex: ExerciseNote, notePath: string, attempt: Record<string, any>, index: number): string | null {
  if (ex.subject !== "programming") return null;
  const absolute = path.resolve(root, notePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(absolute)) throw new Error("No se encontró el ejercicio dentro de la vault.");
  const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error("El ejercicio apunta fuera de la vault.");
  const base = path.join(path.dirname(absolute), path.basename(absolute, path.extname(absolute)));
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error("La carpeta de entrega no puede ser un enlace simbólico.");
  const dirname = `intento-${String(index).padStart(3, "0")}`;
  let folder = path.join(base, dirname);
  for (let suffix = 2; fs.existsSync(folder); suffix++) {
    const marker = path.join(folder, "entrega.json");
    try {
      const prior = JSON.parse(fs.readFileSync(marker, "utf8")) as { note_id?: string; attempt_index?: number };
      if (prior.note_id === ex.note_id && prior.attempt_index === index) return path.relative(root, folder).split(path.sep).join("/");
    } catch { /* carpeta ajena: se preserva y se usa otra */ }
    folder = path.join(base, `${dirname}-${suffix}`);
  }
  const answer = String(attempt.answer ?? "");
  const lang = `${ex.code_lang} ${ex.frontmatter.language ?? ""} ${ex.discipline}`.toLowerCase();
  const extension = /\b(python|py)\b/.test(lang) ? "py" : /\b(typescript|ts)\b/.test(lang) ? "ts" : /\b(javascript|js)\b/.test(lang) ? "js" : /\bjava\b/.test(lang) ? "java" : /\b(sql|postgresql)\b/.test(lang) ? "sql" : "";
  const code = MODES[ex.mode]?.answer_kind === "code" && extension;
  const fenced = /^\s*```(?:[\w+.-]+)?\s*\n([\s\S]*?)\n```\s*$/.exec(answer);
  const solution = fenced ? fenced[1]! : answer;
  const readme = [`# ${ex.title}`, "", `Ejercicio: ${notePath}`, `Intento: ${index}`, `Fecha: ${String(attempt.at ?? "")}`, `Resultado: ${String(attempt.score ?? "—")}/100 · ${String(attempt.verdict ?? "")}`, "", "## Enunciado", "", ex.statement, "", "## Entrega", "", code ? `Código entregado en \`solucion.${extension}\`.` : answer, "", "## Retroalimentación", "", String(attempt.feedback ?? ""), ""].join("\n");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(folder);
  try {
    fs.writeFileSync(path.join(folder, "README.md"), readme, { encoding: "utf8", flag: "wx" });
    if (code) fs.writeFileSync(path.join(folder, `solucion.${extension}`), solution.endsWith("\n") ? solution : `${solution}\n`, { encoding: "utf8", flag: "wx" });
    fs.writeFileSync(path.join(folder, "entrega.json"), JSON.stringify({ note_id: ex.note_id, attempt_index: index, note_path: notePath }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    // La carpeta acaba de crearse y solo contiene archivos de esta operación.
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  return path.relative(root, folder).split(path.sep).join("/");
}
