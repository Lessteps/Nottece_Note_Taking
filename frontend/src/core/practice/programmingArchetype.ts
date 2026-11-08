/**
 * Practice archetype of a PROGRAMMING topic: what the learner can sensibly practise with it, given what the topic is AND where it
 * sits in the route (what has been taught before it).
 *
 * The coarse `topic_type` (theoretical / procedural / mixed) is not enough: «2.1.1 Project structure, virtual environments and
 * imports» is "mixed", but at that point the learner has not written a single function, so asking them to debug or refactor code is
 * nonsense. The archetype narrows the skills:
 *
 *   concept     — ideas, models, architecture, trade-offs. Practised with recognition and justification (quiz, true/false, classify,
 *                 compare, explain, find the flaw). No code to write.
 *   setup       — project layout, environments, packages, imports, tooling, CLI, config. Practised by BUILDING the structure and the
 *                 commands (project_structure, commands) plus concept checks. No tracing/debugging/refactoring of programs.
 *   early_code  — the first code topics of a language: tiny programs only; nothing that needs functions/classes/tests to make sense.
 *   code        — everything else: the area's full code catalogue.
 *
 * Pure and deterministic: the same topic always gets the same archetype.
 */

import { foldName } from "./topicType";

export type PracticeArchetype = "concept" | "setup" | "early_code" | "code";

export const ARCHETYPE_LABELS: Record<PracticeArchetype, string> = {
  concept: "Conceptual",
  setup: "Entorno y estructura",
  early_code: "Primer código",
  code: "Código",
};

/** Skills each archetype is practised with, most useful first. */
export const ARCHETYPE_SKILLS: Record<PracticeArchetype, readonly string[]> = {
  concept: ["pg_quiz", "pg_true_false", "pg_classify", "pg_compare", "explain", "find_error"],
  setup: ["project_structure", "commands", "pg_quiz", "pg_true_false", "explain", "find_error"],
  early_code: ["pg_quiz", "pg_true_false", "explain", "trace", "implement", "cloze"],
  code: [],
};

/** Skills that make no sense for an archetype (they are removed from plans and manifests). */
export const ARCHETYPE_FORBIDDEN: Record<PracticeArchetype, readonly string[]> = {
  concept: ["implement", "trace", "debug", "refactor", "test", "review", "analyze", "port", "cloze", "drill", "query", "design", "decompose", "commands", "project_structure"],
  setup: ["trace", "debug", "refactor", "test", "review", "analyze", "port", "drill", "decompose"],
  early_code: ["refactor", "review", "test", "design", "port", "analyze"],
  code: [],
};

const SETUP_WORDS = [
  "project structure", "virtual environment", "venv", "virtualenv", "pip", "pipx", "poetry", "uv ", "pyproject", "requirements",
  "package manager", "npm", "pnpm", "yarn", "package json", "node modules", "modules and the import", "import statement", "imports",
  "packages and init", "init py", "main guard", "name main", "installation", "install", "setup", "set up", "tooling", "toolchain",
  "configuration", "config file", "environment variables", "env file", "dotenv", "dockerfile", "docker", "compose", "git ", "gitignore",
  "terminal", "command line", "cli", "shell", "linter", "formatter", "editor", "ide", "folder structure", "directory structure",
  "monorepo", "workspace", "tsconfig", "bundler", "vite", "webpack",
];

const CONCEPT_WORDS = [
  "what the", "what is", "what are", "introduction", "overview", "model", "architecture", "principles", "principle", "philosophy",
  "trust boundary", "stateless", "invariants", "domain logic", "trade off", "tradeoffs", "theory", "history", "why ", "concepts",
  "semantics", "lifecycle", "life cycle", "responsibilities", "client server", "paradigm", "mental model", "the role of",
];

/** Words that mean the topic is about writing/running code, even if a concept word appears. */
const CODE_WORDS = [
  "implement", "build a", "write a", "function", "class", "loop", "algorithm", "query", "endpoint", "handler", "test", "async",
  "decorator", "comprehension", "recursion", "sorting", "parsing", "functions", "classes", "loops", "testing", "tests", "algorithms",
  "queries", "endpoints",
];

/** First topics of each language (taught before functions): code practice must stay tiny. */
const EARLY_CODE_NUMBERS = /^2\.\d+\.(1|2|3|5)(\.\d+)?$/;

export interface ArchetypeInput {
  number?: string;
  title: string;
  /** declared topic_type of the manifest, if any */
  topicType?: string;
  /** titles of the topics taught before this one in the route (same area, in order) */
  taughtBefore?: readonly string[];
}

/** The topic number at the start of a title («2.1.1.1 Python virtual…» → «2.1.1.1»). */
export const numberOf = (title: string): string => /^\s*(\d+(?:\.\d+)*)\s/.exec(title)?.[1] ?? "";

export function archetypeOf(input: ArchetypeInput): PracticeArchetype {
  const number = input.number || numberOf(input.title);
  const name = ` ${foldName(input.title.replace(/^\s*\d+(?:\.\d+)*\s+/, ""))} `;
  // whole-word match on the folded name (padded with spaces), so «cli» does not match «client»
  const hit = (words: readonly string[]) => words.some((w) => name.includes(` ${foldName(w)} `));
  const code = hit(CODE_WORDS);
  if (hit(SETUP_WORDS) && !code) return "setup";
  if (input.topicType === "theoretical") return "concept";
  if (hit(CONCEPT_WORDS) && !code) return "concept";
  // first topics of a language, or a route that has barely started
  if (EARLY_CODE_NUMBERS.test(number)) return "early_code";
  if (input.taughtBefore && input.taughtBefore.length < 3 && /^2\./.test(number)) return "early_code";
  return "code";
}

/** Keep only the skills an archetype allows; fill with its defaults when nothing is left. */
export function fitSkillsToArchetype(skills: readonly string[], arch: PracticeArchetype, max = 6): string[] {
  const banned = new Set(ARCHETYPE_FORBIDDEN[arch]);
  const kept = skills.filter((s) => !banned.has(s));
  if (arch === "code") return kept.slice(0, max);
  const out = [...kept];
  for (const s of ARCHETYPE_SKILLS[arch]) if (!out.includes(s)) out.push(s);
  // the archetype's own skills go first so the practice opens with what fits best
  const order = (s: string) => {
    const i = ARCHETYPE_SKILLS[arch].indexOf(s);
    return i < 0 ? 100 : i;
  };
  return out.sort((a, b) => order(a) - order(b)).slice(0, max);
}

/** The prompt block that tells the AI what kind of practice this topic needs and what the learner already knows. */
export function archetypePromptBlock(arch: PracticeArchetype, taughtBefore: readonly string[] = []): string {
  const seen = taughtBefore.length
    ? `The learner has studied ONLY these earlier topics of the route (in order): ${taughtBefore.slice(-15).join("; ")}. Anything not in that list and not in this topic has NOT been taught yet.`
    : "This is one of the FIRST topics of its area: assume nothing of this area has been taught before it.";
  const rules: Record<PracticeArchetype, string> = {
    concept:
      "PRACTICE ARCHETYPE: concept. The topic is about ideas, not code. Practise it with recognition and justification only: multiple choice with misconception-based distractors (pg_quiz), true/false with justification, classifying cases, comparing look-alike concepts, explaining, spotting the flaw in a statement. Do NOT ask to implement, trace, debug, refactor or test code.",
    setup:
      "PRACTICE ARCHETYPE: setup (environment / project structure / tooling). The learner has not written real programs yet. Practise it by BUILDING things: recreate or repair a project layout (folders, config files, __init__.py, tests/), choose and order the setup commands, decide which import works from which file, diagnose a broken layout or environment (project_structure, commands, find_error), plus concept checks (pg_quiz, pg_true_false, explain). Do NOT ask to trace, debug or refactor programs: there is no program to work on yet.",
    early_code:
      "PRACTICE ARCHETYPE: early code. Only tiny programs made of what has been taught so far (no functions, classes, exceptions, tests or async unless they appear in the taught list). Prefer predicting output, filling a gap, writing 3-10 line scripts and concept checks. Do NOT ask to refactor, review or test.",
    code: "PRACTICE ARCHETYPE: code. Use the area's code skills, but never rely on a concept that is taught later in the route.",
  };
  const forbidden = ARCHETYPE_FORBIDDEN[arch];
  return [rules[arch], seen, forbidden.length ? `Forbidden skills for this topic: ${forbidden.join(", ")}.` : ""].filter(Boolean).join("\n");
}
