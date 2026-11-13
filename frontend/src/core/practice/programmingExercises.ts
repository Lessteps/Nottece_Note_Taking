/**
 * Programming exercises: how they are asked for and written down. They are NOT mathematics exercises: the statement
 * carries code, the language follows the area of the Programación space, the judge reasons about behaviour, and
 * the discipline (backend, frontend, desktop…) frames the scenario and the failure modes worth training.
 */

import { disciplineFor, programmingDisciplineOfPath } from "./disciplineCatalog.js";
import { archetypeOf, archetypePromptBlock } from "./programmingArchetype.js";
import { MODES } from "./modes.js";
import type { AssistanceLevel, DifficultyLevel } from "./skills.js";
import type { TopicManifest } from "./topic.js";

/** The language the code of a discipline is written in (the exercise says it, the grader reads it). */
const LANGUAGE_OF: Record<string, string> = {
  programming_logic: "Python 3 (or plain pseudocode when the topic is language-agnostic)",
  python: "Python 3.12",
  javascript: "modern JavaScript (ES2023, no types)",
  typescript: "TypeScript 5 in strict mode",
  desktop: "TypeScript 5 (Electron main, preload and renderer)",
  backend: "Python 3.12 with FastAPI, or TypeScript on Node when the topic says so",
  frontend: "TypeScript with React function components and hooks",
  sql: "PostgreSQL SQL (SQLite where the topic says so)",
  automation: "Python 3.12, TypeScript, or the n8n / Power Automate node names when the topic is about them",
  mobile: "TypeScript with React Native (Kotlin for native modules)",
  devtools: "shell / PowerShell commands, Dockerfile, YAML and config files",
  programming_practice: "Python 3.12 or TypeScript 5 (the learner picks; the statement must work in both)",
};

export const languageOfDiscipline = (id: string): string => LANGUAGE_OF[id] ?? LANGUAGE_OF.programming_logic!;

/** What each kind of exercise must look like, on top of the mode's own instruction. */
const SHAPE_OF_MODE: Record<string, string> = {
  implement: "Give a precise specification with concrete inputs and the exact expected outputs (a small table of cases, including edge cases). The solution is a reference implementation.",
  debug: "Give code that looks fine and runs, but misbehaves on specific inputs; state the symptom and one failing case. The bug must be found by reasoning about behaviour, never by spotting syntax. The solution names the line, the root cause and the fix.",
  find_error: "Give code with one or two real behavioural errors; the learner must locate and justify them. The solution names each error, why it is wrong and the correction.",
  refactor: "Give working code with real design problems (duplication, mixed responsibilities, hidden coupling) and the criteria to improve; behaviour must stay identical. The solution is the refactored code plus what changed and why.",
  design: "Give a real requirement with constraints; the answer is a schema, module breakdown or contract. The solution explains each decision and the trade-off it accepts.",
  commands: "Give a concrete starting state (files, branches, containers) and a target state; the answer is the exact sequence of commands. The solution replays it.",
  explain: "Ask the learner to explain a mechanism or a decision with an example. The solution is a model explanation with the key ideas the rubric checks.",
  cloze: "Give working code with 2 to 4 key blanks that carry the concept; the answer fills them. The solution is the full code.",
  trace: "Give short code and concrete inputs; the learner writes the output and a trace table of the key variables. The solution IS that exact table and output, computed with care.",
  review: "Give a plausible, working-looking piece of code with 2 to 4 REAL planted problems (wrong on some input, unsafe, not idempotent, leaking, hidden assumption); no cosmetic ones. The solution lists each planted problem with severity and fix.",
  test: "Give a function or a specification (and, when useful, a buggy variant). The learner writes tests. The solution is a reference test suite and lists which bug each test would catch.",
  analyze: "Give code that works but does not scale, with a size of input that makes the cost matter. The solution states the complexity as written, the bottleneck, and the improved version with its complexity.",
  decompose: "Give a real requirement. The learner writes the plan (inputs and outputs, edge cases, ordered steps or a module breakdown), not the code. The solution is a model plan.",
  port: "Give working code in one language and name the target language. The solution is the idiomatic equivalent and lists the language differences that matter.",
  query: "Give a schema with a few sample rows and a question. The solution is the query, the result on the sample and why edge cases (NULLs, ties, empty groups) are handled.",
  pp_kata: "Give one self-contained logic problem built on a pattern (arrays and strings, hashing, recursion, sorting and searching, two pointers, stacks and queues, trees and graphs, dynamic programming) with a precise statement, a table of inputs and expected outputs including edge cases. The solution is a reference solution, the pattern it uses and its complexity. No trick questions and no memorised-puzzle names.",
  pg_true_false: "Give 4 to 6 short statements about the concept, about half of them false in a subtle way (a plausible misconception, a swapped cause, an absolute word such as 'always' or 'never'). The learner marks each true or false and justifies it. The solution lists every verdict, the reason, and the corrected statement for each false one. No code has to be written.",
  pg_classify: "Give 5 to 8 concrete cases (a snippet to read, a log line, a requirement) and the categories of the topic, including borderline cases. The learner places each case and names the deciding criterion. The solution gives the category and the criterion for each case.",
  pg_quiz: "Give 4 to 6 numbered multiple-choice questions. Layout (the app renders it as clickable cards, keep it exact): `1. <question or short real scenario>` on one line, then `A) ...`, `B) ...`, `C) ...`, `D) ...` on their own lines, exactly one correct option each. Distractors are real misconceptions about this topic. The solution lists `1. <letter> — <reason>` for every question and names the misconception behind each distractor.",
  project_structure: "Describe a small realistic project and its constraints (OS, tool, what must run). The learner writes (a) the file/folder tree, one path per line, folders ending in `/` (e.g. `pyproject.toml`, `.venv/`, `src/app/__init__.py`, `tests/test_app.py`), (b) the setup commands in order, one per line, and (c) when relevant the import line that works from a given file. Variants: repair a broken tree, list what must not be committed, place a new module. The solution gives the reference tree, the commands and why each piece is where it is. Never ask to trace, debug or refactor a program.",
  pg_compare: "Name two or three easily confused concepts of this topic and give two small real situations. The learner states what is the same, what differs and which concept fits each situation and why. The solution gives the decisive difference and the assignment of each situation.",
};

/** When the topic is a CONCEPT (topic_type theoretical) these skills are asked about ideas, not about code. */
const CONCEPT_SHAPE_OF_MODE: Record<string, string> = {
  find_error: "Give a short explanation or a list of statements about the concept in which ONE OR TWO claims are wrong in a subtle, plausible way (a swapped cause, a missing condition, a mixed-up term). The learner finds the wrong claim(s), explains why each is wrong and rewrites it correctly. No code has to be fixed. The solution names each wrong claim, the reason and the corrected claim.",
  explain: "Ask the learner to explain how the concept works and why it matters, with an example of their own, in a concrete situation (a failing request, a slow page, a lost file). No code has to be written. The solution is a model explanation with the key ideas the rubric checks.",
};

/**
 * What the learner has READ of a note, as context for the exercises: the explanation (what it is + mental model), the first examples and the cards.
 * The old prompt gave only the first 1200 characters, so the AI filled the gap with what it knew about the topic and asked about things the note never
 * taught. Capped per note so five notes still fit.
 */
export function taughtContent(content: string, cap = 4500): string {
  const text = content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const section = (name: string): string => new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(text)?.[1]?.trim() ?? "";
  const parts = [section("Explanation"), section("Examples").slice(0, 1500), section("Cards").slice(0, 1200)].filter(Boolean);
  const joined = (parts.length ? parts.join("\n\n") : text).trim();
  return joined.slice(0, cap);
}

export function buildProgrammingExercisePrompt(
  manifest: TopicManifest,
  theory: ReadonlyArray<{ title: string; content: string }>,
  skill: string,
  difficulty: DifficultyLevel,
  assistance: AssistanceLevel,
  count: number,
  learning: readonly string[] = [],
  /** titles of the topics taught before this one in the route (same area, in order): the AI must not go beyond them */
  taughtBefore: readonly string[] = [],
): Array<{ role: "system" | "user"; content: string }> {
  const disciplineId = programmingDisciplineOfPath(manifest.folder ?? "");
  const discipline = disciplineFor({ subject: "programming", discipline: disciplineId, mode: skill });
  const mode = MODES[skill];
  const language = languageOfDiscipline(discipline.id);
  const level = difficulty === 1 ? "Beginner: only the fundamentals of the topic" : difficulty === 2 ? "Intermediate: combined cases and standard reasoning" : "Advanced: edge cases, non-trivial integration, full rigour";
  const helper = assistance === "helper";
  const theorySummary = theory
    .slice(0, 5)
    .map((t) => `### ${t.title}\n${taughtContent(t.content)}`)
    .join("\n\n");
  const archetype = archetypeOf({ title: manifest.title, topicType: manifest.topic_type, taughtBefore });
  const conceptTopic = manifest.topic_type === "theoretical" || archetype === "concept" || archetype === "setup";
  const anchors = discipline.skills.map((s) => `- ${s.title}: ${s.anchors.join("; ")}`).join("\n");

  const system = [
    "You are NoteVault's expert exercise creator for PROGRAMMING. The learner is a developer in training whose priority is Windows desktop apps with Electron and TypeScript, plus backend, frontend, databases and automation with Python and TypeScript.",
    `Topic: "${manifest.title}". Discipline: ${discipline.title}. Language of the code: ${language}.`,
    `Skill to train: ${skill}${mode ? ` — ${mode.label}` : ""}. Level: ${level}.`,
    `Discipline framing: ${discipline.framing}`,
    mode ? `What this skill asks of the learner: ${mode.act}` : "",
    `Shape of the exercise: ${(conceptTopic ? CONCEPT_SHAPE_OF_MODE[skill] : undefined) ?? SHAPE_OF_MODE[skill] ?? "A concrete task that trains exactly this skill."}`,
    archetype === "concept" || manifest.topic_type === "theoretical" ? "This topic is a CONCEPT, not a procedure: never ask the learner to write code or commands. Situations may quote a short snippet, a log excerpt or a request/response to READ and reason about." : "",
    archetypePromptBlock(archetype, taughtBefore),
    "CRITICAL RULES:",
    "1. Every exercise is about the specific concepts of THIS topic, never generic filler; the topic's central mechanism must be what is being tested.",
    "1b. TAUGHT-ONLY: the learner has read ONLY the theory notes given below (and the topics they require). Use only the terms, functions, syntax and ideas those notes explain. If a word or feature is not in the notes, do not use it in the statement, the hints or the code, and never ask about it. A true/false item, a classification case or a trace must be answerable from what the note says. At level 1 reuse the situations of the note's own examples with different values.",
    "2. Every exercise is real and applied (a script, a pipeline step, a business rule, concrete data). Never toy drills with names like data1 or valueA.",
    "3. Write EVERYTHING in English: title, statement, hints, solution and rubric. Code goes in fenced code blocks (```python, ```ts, ```sql…). The statement is self-contained: it includes every piece of code and data the learner needs.",
    "4. The expected result must be verifiable by reasoning: give exact expected outputs for concrete inputs. Never ask for something that needs to run the code to know the answer.",
    "5. Bugs and problems must be found by reasoning about behaviour and output, never by spotting a syntax error or a style issue.",
    helper
      ? "6. Assistance is HELPER: hints give progressive guidance on what to look at and why, never the answer."
      : "6. Include 1–3 optional progressive hints for every exercise, without revealing the solution. They are shown only when the learner enables Helper; no-help attempts remain possible.",
    "7. Mastery signal only: the solution gives the expected result and a model answer; it never lectures a long derivation.",
    anchors ? `Realistic failure modes of this discipline (use them when the skill involves finding problems):\n${anchors}` : "",
    "OUTPUT: return ONLY a valid JSON array of exercise objects, no other text. Each object has:",
    '  "title": string (short, in English)',
    '  "statement": string (English, with fenced code blocks)',
    '  "hints": array of strings (English)',
    '  "solution": string (the model answer: code and, where useful, a short explanation)',
    '  "rubric": array of 3 to 5 strings (verifiable checklist criteria)',
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Generate ${count} exercise${count > 1 ? "s" : ""} for topic "${manifest.title}".`,
    theorySummary ? `\nContext from the topic's theory notes:\n${theorySummary}\n` : "",
    `Skill: ${skill}. Level: ${level}. Assistance: ${assistance}.`,
    learning.length
      ? [
          "",
          "The student's ERROR RECORD for this competency (most recent first):",
          ...learning.map((l) => `- ${l}`),
          "Write about 60% of the exercises to attack EXACTLY these mistakes (the same kind of failure, with other code and another context, never repeating a statement) and the rest to train the whole competency.",
        ].join("\n")
      : "",
    "",
    "Return ONLY the JSON array.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The exercise note of a programming exercise: with its discipline and language, so it is graded as programming. */
export function formatProgrammingExerciseNote(
  manifest: TopicManifest,
  skill: string,
  difficulty: DifficultyLevel,
  assistance: AssistanceLevel,
  ex: { title: string; statement: string; hints: string[]; solution: string; rubric: string[] },
): string {
  const disciplineId = programmingDisciplineOfPath(manifest.folder ?? "");
  const hints = ex.hints.map((h) => `- ${h.trim()}`).join("\n");
  const rubric = ex.rubric.map((r) => `- [ ] ${r.trim()}`).join("\n");
  return `---
type: exercise
subject: ${manifest.subject}
title: "${ex.title.replace(/"/g, '\\"')}"
mode: ${skill}
discipline: ${disciplineId}
difficulty: ${difficulty}
assistance: ${assistance === "no_help" ? "nohelp" : "helper"}
topic: "${manifest.title.replace(/"/g, '\\"')}"
---

# ${ex.title}

## Statement
${ex.statement.trim()}

## Hints
${hints || "- (No hints for this exercise.)"}

## Solution
${ex.solution.trim()}

## Rubric
${rubric || "- [ ] Correct behaviour and edge cases covered."}
`;
}
