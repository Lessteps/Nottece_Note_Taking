// Validates exercise notes against the contract the app reads (see docs/ANTIGRAVITY_PLAN_CONTENT_GENERATION.md §4).
//
//   node tools/programming_kb/exercises_check.mjs                 every exercise under C:\PROGRAMMING\Programación
//   node tools/programming_kb/exercises_check.mjs "^10\."         only topics whose folder matches the regex
//   node tools/programming_kb/exercises_check.mjs --recent 60     only files modified in the last 60 minutes
//
// Exit code 1 when any file fails. Plain Node 24, no dependencies.

import fs from "node:fs";
import path from "node:path";
import { ROOT, scanTopics } from "./exercises_status.mjs";

const args = process.argv.slice(2);
const recentIdx = args.indexOf("--recent");
const recentMin = recentIdx >= 0 ? Number(args[recentIdx + 1]) : 0;
const rest = recentIdx < 0 ? args : args.filter((_, i) => i !== recentIdx && i !== recentIdx + 1);
const re = rest.length ? new RegExp(rest[0]) : null;

const NAME_RE = /^ej_([a-z_]+)_d([1-3])_(\d{6,})_(\d+)\.md$/;
const SECTIONS = ["## Statement", "## Hints", "## Solution", "## Rubric"];
const PLACEHOLDER = /(\[TODO\]|\bTODO:|\bTBD\b|lorem ipsum|to be written)/;

function check(file, topicName, skills) {
  const problems = [];
  const base = path.basename(file);
  const m = NAME_RE.exec(base);
  const text = fs.readFileSync(file, "utf8");
  if (!m) problems.push(`file name must match ej_<skill>_d<1-3>_<batch>_<n>.md (got "${base}")`);
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!fm) return [...problems, "missing frontmatter"];
  const get = (k) => new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m").exec(fm[1])?.[1] ?? "";
  if (get("type") !== "exercise") problems.push(`frontmatter type must be "exercise" (got "${get("type")}")`);
  if (get("subject") !== "programming") problems.push(`frontmatter subject must be "programming"`);
  if (!get("title")) problems.push("frontmatter title is empty");
  if (get("topic") !== topicName) problems.push(`frontmatter topic must be "${topicName}" (got "${get("topic")}")`);
  const mode = get("mode");
  if (!skills.includes(mode)) problems.push(`mode "${mode}" is not a skill of this topic (${skills.join(", ")})`);
  if (m && mode && m[1] !== mode) problems.push(`file name skill "${m[1]}" differs from mode "${mode}"`);
  if (m && mode && path.basename(path.dirname(file)) !== mode) problems.push(`file must live in Ejercicios/${mode}/`);
  const d = Number(get("difficulty"));
  if (![1, 2, 3].includes(d)) problems.push(`difficulty must be 1, 2 or 3 (got "${get("difficulty")}")`);
  if (m && d && Number(m[2]) !== d) problems.push(`file name difficulty d${m[2]} differs from frontmatter difficulty ${d}`);
  if (!["nohelp", "helper"].includes(get("assistance"))) problems.push(`assistance must be nohelp or helper (got "${get("assistance")}")`);
  if (!get("discipline")) problems.push("frontmatter discipline is empty");

  const body = text.slice(fm[0].length);
  let last = -1;
  for (const s of SECTIONS) {
    const i = body.indexOf(`\n${s}\n`);
    if (i < 0) problems.push(`missing section "${s}"`);
    else if (i < last) problems.push(`section "${s}" is out of order`);
    else last = i;
  }
  const section = (name, next) => {
    const a = body.indexOf(`\n${name}\n`);
    if (a < 0) return "";
    const b = next ? body.indexOf(`\n${next}\n`, a + 1) : body.length;
    return body.slice(a + name.length + 2, b < 0 ? body.length : b).trim();
  };
  const statement = section("## Statement", "## Hints");
  const solution = section("## Solution", "## Rubric");
  const rubric = section("## Rubric", null);
  const minStatement = d === 1 ? 160 : d === 2 ? 240 : 320;
  if (statement.length < minStatement) problems.push(`statement too short for difficulty ${d} (${statement.length} < ${minStatement} chars)`);
  if (solution.length < 80) problems.push(`solution too short (${solution.length} < 80 chars)`);
  const items = rubric.split("\n").filter((l) => /^- \[ \] \S/.test(l));
  if (items.length < 3) problems.push(`rubric needs at least 3 "- [ ]" items (found ${items.length})`);
  const fences = (body.match(/^```/gm) ?? []).length;
  if (fences % 2) problems.push("unbalanced ``` code fences");
  if (PLACEHOLDER.test(statement) || PLACEHOLDER.test(solution)) problems.push("placeholder text left in the note");
  return problems;
}

let files = 0;
let bad = 0;
for (const t of scanTopics(ROOT)) {
  if (re && !re.test(t.folder) && !re.test(path.basename(t.folder))) continue;
  const exDir = path.join(t.dir, "Ejercicios");
  if (!fs.existsSync(exDir)) continue;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        if (recentMin && Date.now() - fs.statSync(p).mtimeMs > recentMin * 60000) continue;
        files += 1;
        const problems = check(p, path.basename(t.dir), t.skills);
        if (problems.length) {
          bad += 1;
          console.log(`FAIL ${path.relative(ROOT, p).split(path.sep).join("/")}`);
          for (const pr of problems) console.log(`     - ${pr}`);
        }
      }
    }
  };
  walk(exDir);
}
console.log(`\nchecked ${files} exercise notes: ${files - bad} ok, ${bad} failing`);
process.exit(bad ? 1 : 0);
