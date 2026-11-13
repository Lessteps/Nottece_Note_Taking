/**
 * Index of the vault's practice notes (and of notes that carry concept cards).
 *
 * Reads only frontmatter for exercises; results are cached per file by mtime and size so
 * refreshing the Estudio hub costs one stat per note after the first scan.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../frontmatter.js";
import { disciplineFor, normalizeSkillCode } from "./disciplineCatalog.js";
import { isPracticeFrontmatter } from "./exerciseNote.js";
import { modeFor } from "./modes.js";

export const GROUP_FOLDERS = new Set([
  "ejercicios",
  "exercises",
  "demostraciones",
  "proofs",
  "practica",
  "pr\u00e1ctica",
]);

// Exercises without an explicit `skill:` are placed in a skill by what they train.
export const MODE_SKILLS: Record<string, Record<string, string>> = {
  math_general: {
    prove: "01",
    solve: "02",
    process: "02",
    explain: "03",
    counterexample: "04",
    true_false: "04",
    find_error: "04",
  },
};

export const DRILL_SKILLS: Record<string, string> = {
  arithmetic: "01",
  fractions: "02",
  powers: "03",
  percent: "04",
  derivatives: "05",
};

const _CARDS_RE = /^##\s+(tarjetas|cards|flashcards)\s*$/im;
const _TRUE = new Set(["true", "yes", "si", "s\u00ed", "1"]);

export interface ExerciseRef {
  path: string;
  rel: string;
  note_id: string;
  title: string;
  subject: string;
  discipline: string;
  skill: string;
  mode: string;
  difficulty: number;
  concept: string;
  chapter: string;
  chapter_title: string;
  integration: boolean;
}

export interface CardNote {
  path: string;
  rel: string;
  concept_id: string;
  title: string;
  subject: string;
  frontmatter: Record<string, any>;
  text: string;
}

/** A note as the scan saw it: enough to classify it without reading it again. */
export interface NoteFacts {
  path: string;
  rel: string;
  frontmatter: Record<string, any>;
}

export class VaultScan {
  exercises: ExerciseRef[] = [];
  card_notes: CardNote[] = [];
  /**
   * Every note the scan read, with its frontmatter: the cheap source for
   * vault-wide questions ("which notes are topic manifests?"). `card_notes` is not
   * a substitute — it only holds notes that carry cards.
   */
  notes: NoteFacts[] = [];

  get cardNotes(): CardNote[] {
    return this.card_notes;
  }

  set cardNotes(val: CardNote[]) {
    this.card_notes = val;
  }

  by_id(): Record<string, ExerciseRef> {
    const res: Record<string, ExerciseRef> = {};
    for (const e of this.exercises) {
      res[e.note_id] = e;
    }
    return res;
  }

  byId(): Record<string, ExerciseRef> {
    return this.by_id();
  }
}

function _int(value: any, fallback: number): number {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}

export function isTrue(value: any): boolean {
  if (value === true) return true;
  return _TRUE.has(String(value ?? "").trim().toLowerCase());
}

export function skillKey(
  discipline: string,
  mode: string,
  skill: string = "",
  drill: string = ""
): string {
  const code = normalizeSkillCode(skill);
  if (code) return code;
  if (discipline === "math_drill") {
    return DRILL_SKILLS[String(drill || "").toLowerCase()] || "";
  }
  return MODE_SKILLS[discipline]?.[mode] || "";
}

function _chapter(filePath: string, vaultRoot: string): [string, string] {
  let folder = path.dirname(filePath);
  const base = path.basename(folder).toLowerCase();
  if (GROUP_FOLDERS.has(base) && path.resolve(folder) !== path.resolve(vaultRoot)) {
    folder = path.dirname(folder);
  }
  let rel: string;
  try {
    rel = path.relative(vaultRoot, folder).replace(/\\/g, "/");
  } catch {
    rel = folder.replace(/\\/g, "/");
  }
  const key = rel === "" ? "." : rel;
  const folderName = path.basename(folder) || "Vault";
  return [key, folderName];
}

function _isIntegration(fm: Record<string, any>): boolean {
  const skills = fm.skills;
  const meta = String(fm.meta ?? "").trim();
  const practice = String(fm.practice ?? "").trim().toLowerCase();
  return (
    isTrue(fm.integration) ||
    meta === "2" ||
    practice === "integracion" ||
    practice === "integraci\u00f3n" ||
    (Array.isArray(skills) && skills.length >= 2)
  );
}

export function exerciseRef(
  filePath: string,
  vaultRoot: string,
  fm: Record<string, any>
): ExerciseRef {
  const normalizedPath = path.resolve(filePath);
  const discipline = disciplineFor(fm).id;
  const mode = modeFor(fm).id;
  const [chapter, chapterTitle] = _chapter(normalizedPath, vaultRoot);
  let rel: string;
  try {
    rel = path.relative(vaultRoot, normalizedPath).replace(/\\/g, "/");
  } catch {
    rel = normalizedPath.replace(/\\/g, "/");
  }
  const stem = path.basename(normalizedPath, path.extname(normalizedPath));

  return {
    path: normalizedPath,
    rel,
    note_id: String(fm.id ?? "").trim() || stem,
    title: String(fm.title ?? "").trim() || stem,
    subject: String(fm.subject ?? "general").trim().toLowerCase(),
    discipline,
    skill: skillKey(discipline, mode, fm.skill, fm.drill),
    mode,
    difficulty: Math.max(1, Math.min(5, _int(fm.difficulty, 2))),
    concept: String(fm.concept ?? "").trim(),
    chapter,
    chapter_title: chapterTitle,
    integration: _isIntegration(fm),
  };
}

type CacheStamp = [number, number]; // [mtimeMs, size]
type CacheEntry = [Record<string, any>, string]; // [frontmatter, textIfCards]
const _cache = new Map<string, [CacheStamp, CacheEntry]>();

export function clearExerciseIndexCache(): void {
  _cache.clear();
}

/**
 * Read `paths` into the per-file cache in batches, yielding to the event loop
 * between them.
 *
 * The first `scanVault` of a cold process reads every note of the vault: measured
 * 30 s of disk I/O over 2 107 notes (0.35 ms each once the OS cache is warm). This
 * warming moves that cost off the click that needs it, and the yields keep the
 * main process answering IPC while it runs, instead of freezing the window.
 */
export async function warmNoteCache(paths: Iterable<string>, batch = 150): Promise<number> {
  let read = 0;
  let sinceYield = 0;
  for (const p of paths) {
    _read(p);
    read += 1;
    if (++sinceYield >= batch) {
      sinceYield = 0;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return read;
}

function _read(filePath: string): CacheEntry | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    return null;
  }
  const stamp: CacheStamp = [st.mtimeMs, st.size];
  const hit = _cache.get(filePath);
  if (hit && hit[0][0] === stamp[0] && hit[0][1] === stamp[1]) {
    return hit[1];
  }

  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let fm: Record<string, any> = {};
  if (text.startsWith("---")) {
    try {
      const [data] = parseFrontmatter(text);
      fm = (data as Record<string, any>) || {};
    } catch {
      fm = {};
    }
  }

  const hasCards = _CARDS_RE.test(text);
  const entry: CacheEntry = [
    typeof fm === "object" && fm !== null ? fm : {},
    hasCards ? text : "",
  ];
  _cache.set(filePath, [stamp, entry]);
  return entry;
}

export function scanVault(vaultRoot: string, paths: Iterable<string>): VaultScan {
  const resolvedRoot = path.resolve(vaultRoot);
  const scan = new VaultScan();

  for (const p of paths) {
    const absPath = path.resolve(p);
    const entry = _read(absPath);
    if (!entry) continue;

    const [fm, text] = entry;
    const rel = (() => {
      try {
        return path.relative(resolvedRoot, absPath).replace(/\\/g, "/");
      } catch {
        return absPath.replace(/\\/g, "/");
      }
    })();
    scan.notes.push({ path: absPath, rel, frontmatter: fm });
    if (isPracticeFrontmatter(fm)) {
      if (!isTrue(fm.archived)) scan.exercises.push(exerciseRef(absPath, resolvedRoot, fm));
    } else if (text) {
      const stem = path.basename(absPath, path.extname(absPath));
      scan.card_notes.push({
        path: absPath,
        rel,
        concept_id: String(fm.id ?? "").trim() || stem,
        title: String(fm.title ?? "").trim() || stem,
        subject: String(fm.subject ?? "general").trim().toLowerCase(),
        frontmatter: fm,
        text,
      });
    }
  }

  scan.exercises.sort((a, b) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase()));
  scan.card_notes.sort((a, b) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase()));
  return scan;
}
