// What exercise notes exist per topic, per skill and per difficulty, and which cells are still missing.
//
//   node tools/programming_kb/exercises_status.mjs                 table per area (topics, theory, basic, ladder, files)
//   node tools/programming_kb/exercises_status.mjs --next 12       the next 12 missing cells, in work order
//   node tools/programming_kb/exercises_status.mjs --next 12 "^10\." only the topics whose folder name matches the regex
//   node tools/programming_kb/exercises_status.mjs --phase ladder  work on difficulty 2 and 3 (default phase: min)
//
// A CELL is (topic, skill, difficulty). The targets are fixed:
//   phase "min":     difficulty 1 → 1 exercise per skill of every topic (what the app's coverage check asks for: «práctica básica»).
//   phase "basic":   difficulty 1 → 3 exercises per skill of every topic (a real practice session).
//   phase "ladder":  difficulty 2 and 3 → 2 exercises each per skill of every topic.
// The skills of a topic are the ones in the `skills: [...]` line of its `<topic>.practica.md` (do not change them).
// Plain Node 24, no dependencies. The vault root is C:\PROGRAMMING\Programación (override with VAULT_PROGRAMMING).

import fs from "node:fs";
import path from "node:path";

export const ROOT = process.env.VAULT_PROGRAMMING || "C:\\PROGRAMMING\\Programación";
export const TARGET = { min: { 1: 1 }, basic: { 1: 3 }, ladder: { 2: 2, 3: 2 } };

const natural = (a, b) => a.localeCompare(b, "en", { numeric: true });

/** Every topic folder (one that holds `<name>.practica.md`) with its skills and the exercises that exist. */
export function scanTopics(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const name = path.basename(dir);
    const practica = entries.find((e) => e.isFile() && e.name === `${name}.practica.md`);
    if (practica) {
      const text = fs.readFileSync(path.join(dir, practica.name), "utf8");
      const m = /^skills:\s*\[(.*?)\]/m.exec(text);
      const skills = m ? m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
      const theory = entries.some((e) => e.isFile() && e.name === `${name}.md`);
      const have = {};
      const exDir = path.join(dir, "Ejercicios");
      if (fs.existsSync(exDir)) {
        const files = [];
        const w = (d) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) w(path.join(d, e.name));
            else if (e.name.endsWith(".md")) files.push(path.join(d, e.name));
          }
        };
        w(exDir);
        for (const f of files) {
          const head = fs.readFileSync(f, "utf8").slice(0, 700);
          const mode = /^mode:\s*"?([A-Za-z0-9_]+)"?/m.exec(head)?.[1] ?? /^skill:\s*"?([A-Za-z0-9_]+)"?/m.exec(head)?.[1];
          const diff = Number(/^difficulty:\s*(\d)/m.exec(head)?.[1] ?? 0);
          if (mode && diff >= 1 && diff <= 3) ((have[mode] ??= {})[diff] = (have[mode][diff] ?? 0) + 1);
        }
      }
      out.push({ folder: path.relative(root, dir).split(path.sep).join("/"), dir, skills, theory, have });
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".") || e.name === "programming_practice" || e.name === "Ejercicios") continue;
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return out.sort((a, b) => natural(a.folder, b.folder));
}

/** The missing cells of a topic for a phase: `{ skill, difficulty, have, need }`. */
export function missingCells(topic, phase) {
  const cells = [];
  for (const [diff, need] of Object.entries(TARGET[phase])) {
    for (const skill of topic.skills) {
      const have = topic.have[skill]?.[diff] ?? 0;
      if (have < need) cells.push({ skill, difficulty: Number(diff), have, need });
    }
  }
  return cells;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
if (isMain) {
  const args = process.argv.slice(2);
  const nextIdx = args.indexOf("--next");
  const phaseIdx = args.indexOf("--phase");
  const phase = phaseIdx >= 0 ? args[phaseIdx + 1] : "min";
  if (!TARGET[phase]) {
    console.error(`Unknown phase "${phase}" (use min, basic or ladder).`);
    process.exit(2);
  }
  const rest = args.filter((_, i) => !(nextIdx >= 0 && (i === nextIdx || i === nextIdx + 1)) && !(phaseIdx >= 0 && (i === phaseIdx || i === phaseIdx + 1)));
  const re = rest.length ? new RegExp(rest[0]) : null;
  const topics = scanTopics().filter((t) => !re || re.test(t.folder) || re.test(path.basename(t.folder)));

  if (nextIdx >= 0) {
    const n = Number(args[nextIdx + 1]) || 10;
    let shown = 0;
    for (const t of topics) {
      const cells = missingCells(t, phase);
      if (!cells.length) continue;
      console.log(`${t.folder}`);
      for (const c of cells) console.log(`    ${c.skill}  difficulty ${c.difficulty}: have ${c.have}, need ${c.need}  → write ${c.need - c.have}`);
      shown += 1;
      if (shown >= n) break;
    }
    if (!shown) console.log(`Nothing missing in phase "${phase}".`);
  } else {
    const rows = new Map();
    for (const t of topics) {
      const area = t.folder.split("/")[0];
      const r = rows.get(area) ?? { topics: 0, theory: 0, min: 0, basic: 0, ladder: 0, files: 0, cells: 0 };
      r.topics += 1;
      r.theory += t.theory ? 1 : 0;
      r.min += t.skills.length && missingCells(t, "min").length === 0 ? 1 : 0;
      r.basic += t.skills.length && missingCells(t, "basic").length === 0 ? 1 : 0;
      r.ladder += t.skills.length && missingCells(t, "ladder").length === 0 ? 1 : 0;
      r.files += Object.values(t.have).reduce((n, d) => n + Object.values(d).reduce((a, b) => a + b, 0), 0);
      r.cells += missingCells(t, phase).reduce((n, c) => n + (c.need - c.have), 0);
      rows.set(area, r);
    }
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad("area", 30)}${pad("topics", 8)}${pad("theory", 8)}${pad("min", 8)}${pad("basic", 8)}${pad("ladder", 8)}${pad("files", 8)}to write (${phase})`);
    let total = 0;
    for (const [area, r] of rows) {
      console.log(`${pad(area, 30)}${pad(r.topics, 8)}${pad(r.theory, 8)}${pad(r.min, 8)}${pad(r.basic, 8)}${pad(r.ladder, 8)}${pad(r.files, 8)}${r.cells}`);
      total += r.cells;
    }
    console.log(`\nExercise files still to write in phase "${phase}": ${total}`);
  }
}
