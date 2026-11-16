import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("exercise CLI topic filters", () => {
  it("limits validation and status reports to the requested topic with or without options", () => {
    const root = mkdtempSync(path.join(tmpdir(), "notevault-exercises-"));
    roots.push(root);
    for (const name of ["1 Target", "2 Unrelated"]) {
      const folder = path.join(root, name);
      mkdirSync(path.join(folder, "Ejercicios", "explain"), { recursive: true });
      writeFileSync(path.join(folder, `${name}.practica.md`), 'skills: ["explain"]\n');
      writeFileSync(path.join(folder, "Ejercicios", "explain", "ej_explain_d1_20261113_1.md"), 'invalid exercise');
    }
    const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [path.resolve(`tools/programming_kb/${script}`), ...args], { env: { ...process.env, VAULT_PROGRAMMING: root }, encoding: "utf8" });
    for (const args of [["^1 Target"], ["--recent", "60", "^1 Target"]]) {
      const result = run("exercises_check.mjs", ...args);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("1 Target");
      expect(result.stdout).not.toContain("2 Unrelated");
      expect(result.stdout).toContain("checked 1 exercise notes");
    }
    for (const args of [["^1 Target"], ["--phase", "ladder", "^1 Target"], ["--next", "3", "^1 Target"]]) {
      const result = run("exercises_status.mjs", ...args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("1 Target");
      expect(result.stdout).not.toContain("2 Unrelated");
    }
  });
});
