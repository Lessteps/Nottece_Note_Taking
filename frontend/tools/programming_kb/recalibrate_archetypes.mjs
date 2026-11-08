#!/usr/bin/env node
// Recalibrates topic practice manifests (.practica.md) across the Programación knowledge-base according to their practice archetype:
// - Removes nonsense code skills (debug, refactor, trace) from setup / conceptual topics.
// - Sets tailored skills: project_structure, commands, pg_quiz, pg_true_false, explain, find_error.
//
// Usage:
//   node tools/programming_kb/recalibrate_archetypes.mjs [--write] [pattern]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve Programación path
const DEFAULT_KB = path.resolve(__dirname, "../../../../knowledge-base/Programación");
const SPACE = (process.env.PKB_SPACE || DEFAULT_KB).replace(/\\/g, "/");

const args = process.argv.slice(2);
const writeMode = args.includes("--write");
const patternArg = args.find((a) => !a.startsWith("--"));
const filterPattern = patternArg ? new RegExp(patternArg, "i") : null;

// Pure archetype detection adapted for mjs script
const SETUP_WORDS = [
  "project structure", "virtual environment", "venv", "virtualenv", "pip", "pipx", "poetry", "uv", "pyproject", "requirements",
  "package manager", "npm", "pnpm", "yarn", "package json", "node modules", "modules and the import", "import statement", "imports",
  "packages and init", "init py", "main guard", "name main", "installation", "install", "setup", "set up", "tooling", "toolchain",
  "configuration", "config file", "environment variables", "env file", "dotenv", "dockerfile", "docker", "compose", "git", "gitignore",
  "terminal", "command line", "cli", "shell", "linter", "formatter", "editor", "ide", "folder structure", "directory structure",
  "monorepo", "workspace", "tsconfig", "bundler", "vite", "webpack",
];

const CONCEPT_WORDS = [
  "what the", "what is", "what are", "introduction", "overview", "model", "architecture", "principles", "principle", "philosophy",
  "trust boundary", "stateless", "invariants", "domain logic", "trade off", "tradeoffs", "theory", "history", "why", "concepts",
  "semantics", "lifecycle", "life cycle", "responsibilities", "client server", "paradigm", "mental model", "the role of",
];

const CODE_WORDS = [
  "implement", "build a", "write a", "function", "class", "loop", "algorithm", "query", "endpoint", "handler", "test", "async",
  "decorator", "comprehension", "recursion", "sorting", "parsing", "functions", "classes", "loops", "testing", "tests",
];

function foldName(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectArchetype(title) {
  const name = ` ${foldName(title.replace(/^\s*\d+(?:\.\d+)*\s+/, ""))} `;
  const hit = (words) => words.some((w) => name.includes(` ${foldName(w)} `));
  const code = hit(CODE_WORDS);
  if (hit(SETUP_WORDS) && !code) return "setup";
  if (hit(CONCEPT_WORDS) && !code) return "concept";
  return "code";
}

const ARCHETYPE_SKILLS = {
  concept: ["pg_quiz", "pg_true_false", "pg_classify", "pg_compare", "explain", "find_error"],
  setup: ["project_structure", "commands", "pg_quiz", "pg_true_false", "explain", "find_error"],
};

console.log(`Scanning space at: ${SPACE}`);
console.log(`Mode: ${writeMode ? "WRITE (changes applied)" : "DRY-RUN (pass --write to save)"}`);

if (!fs.existsSync(SPACE)) {
  console.error(`Error: Space directory does not exist: ${SPACE}`);
  process.exit(1);
}

let modified = 0;
let scanned = 0;

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      scanDir(full);
    } else if (entry.isFile() && entry.name.endsWith(".practica.md")) {
      scanned++;
      checkManifest(full);
    }
  }
}

function checkManifest(practicaPath) {
  const title = path.basename(practicaPath, ".practica.md");
  if (filterPattern && !filterPattern.test(title)) return;

  const raw = fs.readFileSync(practicaPath, "utf-8");
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fmMatch) return;

  const fmLines = fmMatch[1].split("\n");
  const skillsLine = fmLines.find((l) => l.trim().startsWith("skills:"));
  if (!skillsLine) return;

  const arch = detectArchetype(title);
  if (arch !== "setup" && arch !== "concept") return;

  // Check if manifest has inappropriate coding skills or lacks archetype skills
  const forbiddenSkills = arch === "setup"
    ? ["implement", "debug", "refactor", "trace"]
    : ["implement", "debug", "refactor", "trace", "design", "commands"];

  const hasForbidden = forbiddenSkills.some((s) => skillsLine.includes(s));
  const lacksRequired = arch === "setup" && !skillsLine.includes("project_structure");

  if (!hasForbidden && !lacksRequired) return;

  const newSkills = ARCHETYPE_SKILLS[arch];
  const newSkillsStr = `skills: [${newSkills.map((s) => `"${s}"`).join(", ")}]`;

  // Update frontmatter
  let updatedFm = fmMatch[1].replace(/^skills:.*$/m, newSkillsStr);
  if (arch === "concept" && !updatedFm.includes("topic_type: theoretical")) {
    updatedFm = updatedFm.replace(/^topic_type:.*$/m, "topic_type: theoretical");
  }
  if (arch === "setup") {
    updatedFm = updatedFm.replace(/implement=/g, "project_structure=");
  }

  let updatedRaw = raw.replace(fmMatch[0], `---\n${updatedFm.trim()}\n---`);
  if (arch === "setup") {
    updatedRaw = updatedRaw.replace(/Implementar \(`implement`\)/g, "Estructura de proyecto (`project_structure`)");
    updatedRaw = updatedRaw.replace(/"skill":"implement"/g, '"skill":"project_structure"');
  }

  console.log(`[${arch.toUpperCase()}] ${title}`);
  console.log(`  Old: ${skillsLine.trim()}`);
  console.log(`  New: ${newSkillsStr}`);

  if (writeMode) {
    fs.writeFileSync(practicaPath, updatedRaw, "utf-8");
    console.log("  -> Saved.");
  }
  modified++;
}

scanDir(SPACE);

console.log(`\nScan complete: ${scanned} manifests scanned, ${modified} matched archetype recalibration.`);
if (!writeMode && modified > 0) {
  console.log(`Run with --write to apply these changes.`);
}
