/**
 * NoteVault Topic Model and Topic Mastery Framework.
 * Discovered by tags and manifests (_tema.md).
 * Computes skill x difficulty progress matrices and completeness rules.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../frontmatter";
import type { ExerciseRef } from "./exerciseIndex";
import { attemptCounts, attemptPassed } from "./ledger";
import {
  type DifficultyLevel,
  skillsForSubject,
} from "./skills";
import { branchFromPath, isEnglishBranch, type EnglishBranch } from "../../lib/englishSkillData";
import { domainOfSubject } from "./domain";
import { skillsForBranch } from "./skillSelection";
import { type TopicType, normaliseTopicType } from "./topicType";

export interface TopicMasteryConfig {
  min_per_skill: number;
  target_difficulty: DifficultyLevel;
  exam: "required" | "optional" | "none";
}

export interface TopicManifest {
  type: "topic";
  subject: string;
  title: string;
  skills: string[];
  mastery: TopicMasteryConfig;
  /** Teórico · procedimental · mixto: decide qué skills se recomiendan (ver topicType.ts). */
  topic_type?: TopicType;
  /** English topics: gramática · escritura · lectura · escucha · habla. English has no topic type and no default branch. */
  branch?: EnglishBranch;
  /** English topics: the CEFR level of the topic (A1–C1); exercise difficulty is relative to it. */
  level?: string;
  exam_group?: string;
  /**
   * The AI's plan for THIS topic: which competencies it trains and how many passed
   * exercises each difficulty needs ([easy, medium, hard]; 0 = not practised there).
   * When present it replaces the fixed `min_per_skill` / `target_difficulty` rule.
   */
  plan?: Record<string, [number, number, number]>;
  path?: string;
  folder?: string;
}

export interface TopicCellProgress {
  skill: string;
  difficulty: DifficultyLevel;
  attempts: number;
  passes: number;
  bestScore: number | null;
  /** passes this cell needs according to the topic's plan; undefined without a plan */
  required?: number;
  /** exercise files that exist on disk for this cell */
  exerciseCount?: number;
}

/** `solve=3/4/2, process=2/3/0` ⇄ the plan map. Unknown or empty entries are dropped. */
export function parsePlanString(text: unknown): Record<string, [number, number, number]> | undefined {
  const out: Record<string, [number, number, number]> = {};
  for (const part of String(text ?? "").split(",")) {
    const m = /^\s*([a-z_]+)\s*=\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/i.exec(part);
    if (!m) continue;
    const counts: [number, number, number] = [Number(m[2]), Number(m[3]), Number(m[4])];
    if (counts[0] + counts[1] + counts[2] > 0) out[m[1]!.toLowerCase()] = counts;
  }
  return Object.keys(out).length ? out : undefined;
}

export function formatPlanString(plan: Record<string, [number, number, number]>): string {
  return Object.entries(plan).map(([skill, c]) => `${skill}=${c[0]}/${c[1]}/${c[2]}`).join(", ");
}

export interface TopicSkillProgress {
  skill: string;
  label: string;
  /** obligatory short Spanish description of what the skill trains */
  description: string;
  status: "not_started" | "practicing" | "consolidated";
  totalAttempts: number;
  totalPasses: number;
  bestScore: number | null;
  highestPassedDifficulty: DifficultyLevel | 0;
  cells: Record<DifficultyLevel, TopicCellProgress>;
  consolidated: boolean;
  mastered: boolean;
}

export interface TopicProgress {
  topic: TopicManifest;
  skills: Record<string, TopicSkillProgress>;
  examPassed: boolean;
  examScore: number | null;
  isComplete: boolean;
  completenessPct: number; // 0..100
  theoryNotesCount: number;
  exerciseNotesCount: number;
}

export interface DiscoveredTopicManifest {
  manifestPath: string;
  topicFolder: string;
  manifest: TopicManifest;
}

export const DEFAULT_MASTERY_CONFIG: TopicMasteryConfig = {
  min_per_skill: 6,
  target_difficulty: 3,
  exam: "required",
};

const THEORETICAL_SKILLS = new Set(["prove", "explain", "true_false", "counterexample"]);

export function isTheoreticalTopic(manifest: TopicManifest): boolean {
  if (!manifest.skills || manifest.skills.length === 0) return false;
  let theoreticalCount = 0;
  for (const s of manifest.skills) {
    if (THEORETICAL_SKILLS.has(s.toLowerCase())) theoreticalCount++;
  }
  return theoreticalCount >= manifest.skills.length / 2;
}

/**
 * Searches for a topic manifest (_tema.md, tema.md, or frontmatter with type:topic)
 * in the given path or by climbing UP ancestor directories until reaching rootDir or filesystem boundary.
 */
export function findAncestorTopicManifest(
  startPath: string,
  rootDir: string,
): DiscoveredTopicManifest | null {
  try {
    const absRoot = path.resolve(rootDir);
    let absStart = path.resolve(startPath);
    if (!absStart.startsWith(absRoot) && absStart !== absRoot) {
      absStart = path.resolve(rootDir, startPath);
    }

    let currDir: string;
    try {
      const st = fs.statSync(absStart);
      if (st.isFile()) {
        // If the startPath file itself is a topic manifest
        try {
          const raw = fs.readFileSync(absStart, "utf-8");
          const m = parseTopicManifest(raw, path.basename(absStart).replace(/\.md$/, ""));
          if (m) {
            m.path = absStart;
            m.folder = path.dirname(absStart);
            return { manifestPath: absStart, topicFolder: path.dirname(absStart), manifest: m };
          }
        } catch {}
        currDir = path.dirname(absStart);
      } else {
        currDir = absStart;
      }
    } catch {
      currDir = path.dirname(absStart);
    }

    while (true) {
      // 1. Check for _tema.md
      const preferred = path.join(currDir, "_tema.md");
      if (fs.existsSync(preferred)) {
        try {
          const raw = fs.readFileSync(preferred, "utf-8");
          const m = parseTopicManifest(raw, path.basename(currDir));
          if (m) {
            m.path = preferred;
            m.folder = currDir;
            return { manifestPath: preferred, topicFolder: currDir, manifest: m };
          }
        } catch {}
      }

      // 2. Check for tema.md
      const alt = path.join(currDir, "tema.md");
      if (fs.existsSync(alt)) {
        try {
          const raw = fs.readFileSync(alt, "utf-8");
          const m = parseTopicManifest(raw, path.basename(currDir));
          if (m) {
            m.path = alt;
            m.folder = currDir;
            return { manifestPath: alt, topicFolder: currDir, manifest: m };
          }
        } catch {}
      }

      // 3. Check any .md files in currDir
      try {
        const entries = fs.readdirSync(currDir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
            const p = path.join(currDir, ent.name);
            const raw = fs.readFileSync(p, "utf-8");
            const m = parseTopicManifest(raw, path.basename(currDir));
            if (m) {
              m.path = p;
              m.folder = currDir;
              return { manifestPath: p, topicFolder: currDir, manifest: m };
            }
          }
        }
      } catch {}

      // Stop condition: if we reached the rootDir or filesystem boundary
      if (path.resolve(currDir) === absRoot) {
        break;
      }
      const parent = path.dirname(currDir);
      if (parent === currDir || !parent.startsWith(absRoot)) {
        break;
      }
      currDir = parent;
    }
  } catch {}

  return null;
}

/**
 * Parse frontmatter string or object into a structured TopicManifest.
 */
export function parseTopicManifest(
  rawTextOrFm: string | Record<string, any>,
  defaultTitle = "Tema sin título",
): TopicManifest | null {
  let fm: Record<string, any>;
  if (typeof rawTextOrFm === "string") {
    const [parsed] = parseFrontmatter(rawTextOrFm);
    if (!parsed || typeof parsed !== "object") return null;
    fm = parsed;
  } else {
    fm = rawTextOrFm;
  }

  const type = String(fm.type || "").trim().toLowerCase();
  const tag = String(fm.tag || "").trim().toLowerCase();
  const tags = Array.isArray(fm.tags)
    ? fm.tags.map((t: any) => String(t).trim().toLowerCase().replace(/^#/, ""))
    : typeof fm.tags === "string"
      ? fm.tags.split(/[,\s]+/).map((t) => t.trim().toLowerCase().replace(/^#/, ""))
      : [];

  const isTopic =
    type === "topic" ||
    // A `practica` view file carries the topic manifest (see viewFiles.ts).
    type === "practica" ||
    tag === "tema" ||
    tag === "topic" ||
    tags.includes("tema") ||
    tags.includes("topic");

  if (!isTopic) return null;

  const subject = String(fm.subject || "mathematics").trim().toLowerCase();
  const title = String(fm.title || defaultTitle).trim();

  // Validate declared skills against subject catalogue
  const subjectSkills = skillsForSubject(subject);
  const knownSkillIds = new Set(subjectSkills.map((s) => s.id));

  let rawSkills: string[] = [];
  if (Array.isArray(fm.skills)) {
    rawSkills = fm.skills.map((s: any) => String(s).trim().toLowerCase());
  } else if (typeof fm.skills === "string") {
    rawSkills = fm.skills.split(/[,\s]+/).map((s) => s.trim().toLowerCase());
  }

  const plan = parsePlanString(fm.plan);
  const planned = plan ? Object.keys(plan).filter((s) => knownSkillIds.has(s)) : [];
  const validSkills = (planned.length ? planned : rawSkills).filter((s) => knownSkillIds.has(s));
  // No declared skills: mathematics/programming offer the whole subject (as always). English does NOT: it
  // offers its branch's skills, and an unclassified topic (no `branch:`) offers none until it is classified.
  const declaredBranch = String(fm.branch ?? "").trim().toLowerCase();
  const skills =
    validSkills.length > 0
      ? validSkills
      : domainOfSubject(subject) === "english"
        ? isEnglishBranch(declaredBranch)
          ? skillsForBranch(subject, declaredBranch)
          : []
        : subjectSkills.map((s) => s.id);

  // Mastery config: supports nested object or flat/indented keys from parseFrontmatter
  const rawMastery = fm.mastery && typeof fm.mastery === "object" ? fm.mastery : {};
  const rawMin = rawMastery.min_per_skill ?? fm.min_per_skill ?? DEFAULT_MASTERY_CONFIG.min_per_skill;
  const minPerSkill = Math.max(1, parseInt(String(rawMin), 10) || 6);

  const rawDiff = rawMastery.target_difficulty ?? fm.target_difficulty ?? DEFAULT_MASTERY_CONFIG.target_difficulty;
  const rawTargetDiff = parseInt(String(rawDiff), 10);
  const targetDiff = (rawTargetDiff >= 1 && rawTargetDiff <= 3 ? rawTargetDiff : 3) as DifficultyLevel;

  const rawExam = rawMastery.exam ?? fm.exam ?? "required";
  const examSetting = String(rawExam).toLowerCase();
  const exam: "required" | "optional" | "none" =
    examSetting === "none" ? "none" : examSetting === "optional" ? "optional" : "required";

  const manifest: TopicManifest = {
    type: "topic",
    subject,
    title,
    skills,
    mastery: {
      min_per_skill: minPerSkill,
      target_difficulty: targetDiff,
      exam,
    },
  };

  if (fm.exam_group) {
    manifest.exam_group = String(fm.exam_group).trim();
  }

  const topicType = normaliseTopicType(fm.topic_type);
  if (topicType) {
    manifest.topic_type = topicType;
  }
  const branch = String(fm.branch ?? "").trim().toLowerCase();
  if (isEnglishBranch(branch)) manifest.branch = branch;
  const level = String(fm.level ?? "").trim().toUpperCase();
  if (/^(A1|A2|B1|B2|C1)$/.test(level)) manifest.level = level;

  if (plan && planned.length) {
    manifest.plan = Object.fromEntries(planned.map((sk) => [sk, plan[sk]!]));
  }

  return manifest;
}

/**
 * Widens a topic manifest's skills to ensure all subject catalogue skills (e.g. all 8 math skills)
 * are available, prioritizing declared skills first.
 */
export function widenTopicSkills(manifest: TopicManifest): string[] {
  const subjectSkills = skillsForSubject(manifest.subject || "mathematics");
  const widened: string[] = [];

  for (const s of manifest.skills || []) {
    if (!widened.includes(s.toLowerCase())) {
      widened.push(s.toLowerCase());
    }
  }
  for (const s of subjectSkills) {
    if (!widened.includes(s.id.toLowerCase())) {
      widened.push(s.id.toLowerCase());
    }
  }
  return widened;
}

/**
 * Serializes a TopicManifest to markdown file text with YAML frontmatter.
 */
export function serializeTopicManifest(manifest: TopicManifest): string {
  const lines = [
    "---",
    `type: topic`,
    `subject: ${manifest.subject}`,
    `title: "${manifest.title.replace(/"/g, '\\"')}"`,
    `skills: [${manifest.skills.join(", ")}]`,
    `mastery:`,
    `  min_per_skill: ${manifest.mastery.min_per_skill}`,
    `  target_difficulty: ${manifest.mastery.target_difficulty}`,
    `  exam: ${manifest.mastery.exam}`,
  ];

  if (manifest.topic_type) {
    lines.push(`topic_type: ${manifest.topic_type}`);
  }
  if (manifest.branch) {
    lines.push(`branch: ${manifest.branch}`);
  }
  if (manifest.level) {
    lines.push(`level: ${manifest.level}`);
  }

  if (manifest.exam_group) {
    lines.push(`exam_group: "${manifest.exam_group.replace(/"/g, '\\"')}"`);
  }

  lines.push("---");
  lines.push("");
  lines.push(`# ${manifest.title}`);
  lines.push("");
  lines.push("Nota de tema: define los objetivos y competencias requeridas para el dominio de este tema.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Create a sensible default manifest for a folder.
 */
export function createDefaultTopicManifest(
  folder: string,
  folderName: string,
  subject = "mathematics",
  existingExercises: ExerciseRef[] = [],
  examGroup?: string,
): TopicManifest {
  const normSubject = subject.toLowerCase();
  // English: the branch comes from the folder (Inglés/3 Lectura/…) and decides the skills. Outside a
  // branch folder the topic is left UNCLASSIFIED (no branch, no skills) instead of getting a default.
  if (domainOfSubject(normSubject) === "english") {
    const branch = branchFromPath(folder);
    return {
      type: "topic",
      subject: normSubject,
      title: folderName,
      skills: branch ? skillsForBranch(normSubject, branch) : [],
      mastery: { ...DEFAULT_MASTERY_CONFIG },
      exam_group: examGroup,
      ...(branch ? { branch } : {}),
      folder,
    };
  }
  const availableSkills = skillsForSubject(normSubject);

  // If there are existing exercises, gather which skills are already represented
  const presentSkills = new Set<string>();
  for (const ex of existingExercises) {
    if (ex.mode) presentSkills.add(ex.mode.toLowerCase());
  }

  // Include represented skills first, then rest of available skills
  const orderedSkills: string[] = [];
  for (const s of availableSkills) {
    if (presentSkills.has(s.id)) orderedSkills.push(s.id);
  }
  for (const s of availableSkills) {
    if (!orderedSkills.includes(s.id)) orderedSkills.push(s.id);
  }

  return {
    type: "topic",
    subject: normSubject,
    title: folderName,
    skills: orderedSkills,
    mastery: { ...DEFAULT_MASTERY_CONFIG },
    exam_group: examGroup,
    folder,
  };
}

/**
 * Calculates the skill x difficulty progress matrix and completeness for a topic.
 */
export function computeTopicProgress(
  topic: TopicManifest,
  exercises: ExerciseRef[],
  attempts: Record<string, any>,
  examRecord?: { passed: boolean; score?: number } | null,
  theoryNotesCount = 0,
): TopicProgress {
  const subjectSkills = skillsForSubject(topic.subject);
  const skillLabelMap = new Map(subjectSkills.map((s) => [s.id, s.label]));
  const skillDescriptionMap = new Map(subjectSkills.map((s) => [s.id, s.description]));

  const skillsProgress: Record<string, TopicSkillProgress> = {};

  for (const skillId of topic.skills) {
    const planned = topic.plan?.[skillId];
    const cells: Record<DifficultyLevel, TopicCellProgress> = {
      1: { skill: skillId, difficulty: 1, attempts: 0, passes: 0, bestScore: null, exerciseCount: 0, ...(planned ? { required: planned[0] } : {}) },
      2: { skill: skillId, difficulty: 2, attempts: 0, passes: 0, bestScore: null, exerciseCount: 0, ...(planned ? { required: planned[1] } : {}) },
      3: { skill: skillId, difficulty: 3, attempts: 0, passes: 0, bestScore: null, exerciseCount: 0, ...(planned ? { required: planned[2] } : {}) },
    };

    let totalAttempts = 0;
    let totalPasses = 0;
    let bestScore: number | null = null;
    let highestPassedDiff: DifficultyLevel | 0 = 0;

    // Filter exercises that train this skill
    const matchingExercises = exercises.filter(
      (e) => (e.mode || "").toLowerCase() === skillId || (e.skill || "").toLowerCase() === skillId,
    );

    for (const ex of matchingExercises) {
      const diff = Math.min(3, Math.max(1, ex.difficulty)) as DifficultyLevel;
      const cell = cells[diff];
      cell.exerciseCount = (cell.exerciseCount ?? 0) + 1;
      const exEntry = attempts[ex.note_id];
      const exAttempts = Array.isArray(exEntry) ? exEntry : exEntry?.attempts || [];

      let passedThisExercise = false;
      for (const a of exAttempts) {
        if (!attemptCounts(a)) continue;
        totalAttempts++;
        cell.attempts++;

        const passed = attemptPassed(a);
        if (passed && (!planned || !passedThisExercise)) {
          passedThisExercise = true;
          totalPasses++;
          cell.passes++;
          if (diff > highestPassedDiff) {
            highestPassedDiff = diff;
          }
        }

        const score = typeof a.score === "number" ? a.score : parseInt(String(a.score || 0), 10);
        if (!Number.isNaN(score)) {
          if (cell.bestScore === null || score > cell.bestScore) {
            cell.bestScore = score;
          }
          if (bestScore === null || score > bestScore) {
            bestScore = score;
          }
        }
      }
    }

    let consolidated: boolean;
    let mastered: boolean;
    if (planned) {
      // With the AI's plan the matrix cells ARE the requirement: mastered when every
      // planned cell has its passes, consolidated from half of what is planned.
      const needed = ([1, 2, 3] as const).filter((d) => (cells[d].required ?? 0) > 0);
      mastered = needed.every((d) => cells[d].passes >= cells[d].required!);
      const planTotal = needed.reduce((n, d) => n + cells[d].required!, 0);
      const done = needed.reduce((n, d) => n + Math.min(cells[d].passes, cells[d].required!), 0);
      consolidated = mastered || (planTotal > 0 && done * 2 >= planTotal);
    } else {
      // Consolidated: >= min_per_skill passes and passed at least once at target or intermediate
      consolidated =
        totalPasses >= topic.mastery.min_per_skill &&
        (highestPassedDiff >= Math.min(2, topic.mastery.target_difficulty) ||
          (bestScore !== null && bestScore >= 75));
      // Mastered: consolidated AND reached target_difficulty
      mastered = consolidated && highestPassedDiff >= topic.mastery.target_difficulty;
    }

    const status: "not_started" | "practicing" | "consolidated" =
      totalAttempts === 0 ? "not_started" : consolidated ? "consolidated" : "practicing";

    skillsProgress[skillId] = {
      skill: skillId,
      label: skillLabelMap.get(skillId) ?? skillId,
      description: skillDescriptionMap.get(skillId) ?? "",
      status,
      totalAttempts,
      totalPasses,
      bestScore,
      highestPassedDifficulty: highestPassedDiff,
      cells,
      consolidated,
      mastered,
    };
  }

  const examPassed = Boolean(examRecord?.passed);
  const examScore = examRecord?.score ?? null;

  // Completeness calculation
  const totalSkills = topic.skills.length;
  let masteredSkillsCount = 0;
  for (const s of topic.skills) {
    if (skillsProgress[s]?.mastered) masteredSkillsCount++;
  }

  const examRequired = topic.mastery.exam === "required";
  const examWeight = examRequired ? 1 : 0;
  const totalUnits = totalSkills + examWeight;
  const completedUnits = masteredSkillsCount + (examRequired && examPassed ? 1 : 0);

  const plannedCounts = topic.plan ? Object.values(skillsProgress).flatMap((skill) => ([1, 2, 3] as const).map((d) => skill.cells[d])) : [];
  const plannedTotal = plannedCounts.reduce((n, cell) => n + (cell.required ?? 0), 0);
  const plannedDone = plannedCounts.reduce((n, cell) => n + Math.min(cell.passes, cell.required ?? 0), 0);
  const completenessPct = plannedTotal > 0 ? Math.round((plannedDone / plannedTotal) * 100) : totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;
  const isComplete = masteredSkillsCount === totalSkills && (!examRequired || examPassed);

  return {
    topic,
    skills: skillsProgress,
    examPassed,
    examScore,
    isComplete,
    completenessPct,
    theoryNotesCount,
    exerciseNotesCount: exercises.length,
  };
}

export interface NoteForManifest {
  /** Vault-relative POSIX path of the note. */
  rel: string;
  /** Absolute path of the note. */
  path: string;
  frontmatter: Record<string, any>;
}

/** A manifest's file name: the new view file first, then the legacy names. */
function manifestNameRank(base: string): number {
  const low = base.toLowerCase();
  if (low.endsWith(".practica.md")) return 0;
  if (low === "_tema.md") return 1;
  if (low === "tema.md") return 2;
  return 3;
}

/**
 * The vault's topic manifests, discovered from notes that have already been read.
 *
 * This replaces the per-folder climb for whole-vault sweeps:
 * `findAncestorTopicManifest` re-reads every `.md` of every folder it walks
 * (measured: 593 folders → a second full vault read, 2 680 ms warm), while this
 * needs no I/O at all. Same rules as `parseTopicManifest`: a manifest is a note
 * whose frontmatter parses as a topic (`type: topic`, `type: practica` — the
 * `<folder>.practica.md` view file — or a `tema`/`topic` tag), and the topic is
 * the folder the manifest lives in.
 */
export function manifestsFromNotes(notes: Iterable<NoteForManifest>): DiscoveredTopicManifest[] {
  const best = new Map<string, { found: DiscoveredTopicManifest; rank: number }>();
  for (const note of notes) {
    const rel = note.rel.replace(/\\/g, "/");
    const folderRel = path.posix.dirname(rel);
    const folderName = path.posix.basename(folderRel) || path.posix.basename(path.posix.dirname(folderRel));
    const manifest = parseTopicManifest(note.frontmatter, folderName || "Tema sin título");
    if (!manifest) continue;
    const rank = manifestNameRank(path.posix.basename(rel));
    const prev = best.get(folderRel);
    if (prev && prev.rank <= rank) continue;
    const folderAbs = path.dirname(note.path);
    best.set(folderRel, {
      rank,
      found: {
        manifestPath: note.path,
        topicFolder: folderAbs,
        manifest: { ...manifest, path: note.path, folder: folderAbs },
      },
    });
  }
  return [...best.values()].map((entry) => entry.found);
}
