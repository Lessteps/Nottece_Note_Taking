/** Local project workspace for a planned daily kata. No remote or commits are created. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PlanStore } from "./plan.js";
import { parseExercise } from "../practice/exerciseNote.js";
import { localDateOf, ppAreaDir } from "./practiceState.js";
import { areaKataDates, areaFolderOf, isPracticeAreaId, practiceAreasOf } from "../../lib/areaPracticeSystem.js";
import { planChain } from "../../lib/planChain.js";
import { buildSchedule, progressPlan } from "../../lib/planSchedule.js";

type Binding = { repo: string; planId: string; area: string; day: number; notePath: string; monthTitle: string };
const key = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 24);
const segment = (s: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error("Identificador de proyecto inválido");
  return s;
};
const bindingPath = (root: string, noteId: string) => path.join(root, ".notevault", "mentor", "kata-project-bindings", `${key(noteId)}.json`);
function safeDir(base: string, parts: string[]): string {
  let dir = fs.realpathSync(base);
  for (const part of parts) {
    dir = path.join(dir, segment(part));
    try { fs.mkdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("La carpeta del proyecto no es segura");
  }
  return dir;
}
function writeNew(file: string, content: string) {
  try { fs.writeFileSync(file, content, { flag: "wx", encoding: "utf8" }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
}
export function bindDailyProject(root: string, ppDir: string, input: { planId: string; monthId: string; monthTitle: string; area: string; day: number; noteId: string; notePath: string }): string {
  const month = segment(input.monthId.replace(/^mm:/, ""));
  const area = segment(input.area);
  const previousFile = bindingPath(root, input.noteId);
  if (fs.existsSync(previousFile)) {
    const previous = JSON.parse(fs.readFileSync(previousFile, "utf8")) as Binding;
    if (previous.planId === input.planId && previous.notePath === input.notePath && previous.area === area && previous.day === input.day) {
      const expectedParent = path.join(fs.realpathSync(ppDir), "projects", "daily-practice", segment(input.planId));
      const existingRepo = path.resolve(root, previous.repo);
      if (path.dirname(existingRepo) === expectedParent && fs.existsSync(path.join(existingRepo, ".git"))) return path.relative(root, existingRepo).split(path.sep).join("/");
    }
  }
  if (!Number.isSafeInteger(input.day) || input.day < 1) throw new Error("Kata inválido");
  const repo = safeDir(ppDir, ["projects", "daily-practice", segment(input.planId), month]);
  const git = path.join(repo, ".git");
  if (!fs.existsSync(git)) execFileSync("git", ["init", "--quiet", repo], { stdio: "pipe", timeout: 15000 });
  if (!fs.lstatSync(git).isDirectory()) throw new Error("El repositorio del proyecto no es válido");
  writeNew(path.join(repo, "README.md"), `# ${input.monthTitle}\n\nProyecto local de práctica diaria. Las carpetas por área contienen las soluciones guardadas desde NoteVault.\n`);
  const kata = safeDir(repo, [area, `kata-${String(input.day).padStart(3, "0")}`]);
  writeNew(path.join(kata, "README.md"), `# Kata ${input.day}\n\nÁrea: ${area}\n\nEnunciado original en la vault: ${input.notePath}\n`);
  const source = path.resolve(root, input.notePath);
  const sourceRel = path.relative(path.resolve(root), source);
  if (!sourceRel || sourceRel.startsWith("..") || path.isAbsolute(sourceRel)) throw new Error("Kata fuera de la vault");
  const exercise = parseExercise(fs.readFileSync(source, "utf8"), input.notePath);
  writeNew(path.join(kata, "Enunciado.md"), `# ${exercise.title}\n\n${exercise.statement}\n`);
  const binding: Binding = { repo: path.relative(root, repo), planId: input.planId, area, day: input.day, notePath: input.notePath, monthTitle: input.monthTitle };
  const file = bindingPath(root, input.noteId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(binding, null, 2) + "\n");
  return path.relative(root, repo).split(path.sep).join("/");
}
export function saveDailyProjectAnswer(root: string, noteId: string, notePath: string, answer: string, language: string): void {
  const file = bindingPath(root, noteId);
  if (!fs.existsSync(file)) return;
  const b = JSON.parse(fs.readFileSync(file, "utf8")) as Binding;
  if (b.notePath !== notePath || !Number.isSafeInteger(b.day) || b.day < 1) return;
  const repo = path.resolve(root, b.repo);
  const rel = path.relative(path.resolve(root), repo);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Repositorio fuera de la vault");
  const dir = safeDir(repo, [segment(b.area), `kata-${String(b.day).padStart(3, "0")}`]);
  const lang = language.toLowerCase();
  const ext = /typescript|\bts\b/.test(lang) ? "ts" : /javascript|\bjs\b|node/.test(lang) ? "js" : /python|\bpy\b/.test(lang) ? "py" : /sql/.test(lang) ? "sql" : "txt";
  const target = path.join(dir, `solucion-${key(answer).slice(0, 12)}.${ext}`);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("La solución no puede ser un enlace simbólico");
  writeNew(target, answer);
}

/** Resolve a kata opened directly from the note browser only when its plan is unambiguous. */
export function ensureDailyProjectBinding(root: string, noteId: string, notePath: string, area: string, day: number): void {
  const existing = bindingPath(root, noteId);
  if (fs.existsSync(existing)) {
    const binding = JSON.parse(fs.readFileSync(existing, "utf8")) as Binding;
    if (binding.notePath !== notePath) throw new Error("El identificador del kata ya está vinculado a otra nota; ábrelo desde su plan.");
    return;
  }
  if (!isPracticeAreaId(area) || !Number.isSafeInteger(day) || day < 1) throw new Error("El kata no tiene un área o número válido.");
  const ppDir = ppAreaDir(root);
  if (!ppDir) throw new Error("No se encontró programming_practice.");
  const expectedDir = path.join(ppDir, areaFolderOf(area), "katas");
  if (path.dirname(path.resolve(root, notePath)) !== path.resolve(expectedDir)) throw new Error("El kata no está en la carpeta esperada.");
  const candidates = new PlanStore(root).list().filter((plan) => !plan.archived && !plan.proposed && practiceAreasOf(plan).some((a) => a.areaId === area) && !!areaKataDates(plan, area)[day - 1]);
  if (candidates.length !== 1) throw new Error("Abre el kata desde la práctica diaria del plan para elegir su proyecto mensual.");
  const plan = candidates[0]!;
  const date = areaKataDates(plan, area)[day - 1]!;
  const chain = planChain(plan as never, buildSchedule(progressPlan(plan as never, { today: localDateOf(new Date()) })));
  const contains = (m: (typeof chain.months)[number]) => m.weeks.some((week) => date >= week.start && date <= week.end);
  const month = chain.months.find(contains) ?? planChain(plan as never, buildSchedule(plan as never)).months.find(contains);
  if (!month) throw new Error("El kata no tiene un proyecto mensual asociado en el plan.");
  bindDailyProject(root, ppDir, { planId: plan.id, monthId: month.id, monthTitle: month.title, area: areaFolderOf(area), day, noteId, notePath });
}
