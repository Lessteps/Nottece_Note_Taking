import { afterEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { bindDailyProject, saveDailyProjectAnswer } from "./dailyProjectRepo";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nv-kata-repo-"));
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("crea un repositorio mensual compartido y conserva cada solución enviada", () => {
  const pp = path.join(root, "programming_practice"); fs.mkdirSync(pp);
  const base = { planId: "plan1", monthId: "mm:2026-10", monthTitle: "API", noteId: "pp.kata.backend.001", notePath: "programming_practice/backend/katas/001.md", area: "backend", day: 1 };
  for (const area of ["backend", "frontend"]) {
    const folder = path.join(pp, area, "katas"); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "001.md"), "---\ntype: exercise\ntitle: Ejemplo\n---\n\n## Statement\n\nResuelve el reto.\n\n## Solution\n\nSecreto\n");
  }
  const repo = path.join(root, bindDailyProject(root, pp, base));
  expect(execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()).toBe(repo);
  saveDailyProjectAnswer(root, base.noteId, base.notePath, "print(1)", "python");
  saveDailyProjectAnswer(root, base.noteId, base.notePath, "print(2)", "python");
  const dir = path.join(repo, "backend", "kata-001");
  expect(fs.readdirSync(dir).filter(x => x.endsWith(".py"))).toHaveLength(2);
  expect(fs.readFileSync(path.join(repo, "README.md"), "utf8")).toContain("API");
  const statement = fs.readFileSync(path.join(dir, "Enunciado.md"), "utf8");
  expect(statement).toContain("Resuelve el reto"); expect(statement).not.toContain("Secreto");
  const frontend = { ...base, noteId: "pp.kata.frontend.001", notePath: "programming_practice/frontend/katas/001.md", area: "frontend" };
  expect(path.join(root, bindDailyProject(root, pp, frontend))).toBe(repo);
  expect(path.join(root, bindDailyProject(root, pp, { ...base, monthId: "mm:2026-11" }))).toBe(repo);
  saveDailyProjectAnswer(root, frontend.noteId, frontend.notePath, "const x = 1", "javascript");
  expect(fs.readdirSync(path.join(repo, "frontend", "kata-001")).some(x => x.endsWith(".js"))).toBe(true);
  expect(fs.readdirSync(dir).filter(x => x.endsWith(".py"))).toHaveLength(2);
});
