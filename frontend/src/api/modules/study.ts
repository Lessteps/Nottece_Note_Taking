// Ported from notevault_app/webapp/modules/study.py
// Estudio: the study side panel of Notas — the area's daily queue (exercises
// to practise, spaced reviews, concept cards), its ledger of skills and the
// error log of its subject.

import * as fs from "node:fs";
import * as path from "node:path";
import { ApiError } from "../../core/errors.js";
import { parseFrontmatter } from "../../core/frontmatter.js";
import { loadCard } from "../../core/practice/cards.js";
import { DISCIPLINES, skillOf } from "../../core/practice/disciplineCatalog.js";
import { writeErrorDigest } from "../../core/practice/errorLog.js";
import type { ExerciseRef } from "../../core/practice/exerciseIndex.js";
import { BANDS, attemptPassed } from "../../core/practice/ledger.js";
import { MODES } from "../../core/practice/modes.js";
import {
  hubSnapshot,
  pickExercise,
  skillLabel,
} from "../../core/practice/recommender.js";
import { StudyArea, detectStudyArea } from "../../core/practice/studyArea.js";
import { ensureExerciseSetFile, ensureProjectsViewFile, projectsFolderOf, ensureOverviewFile, ensureTopicViewFiles, isExerciseFolder, folderHasTopicsBelow, isSubjectRoot, isTopicFolder, mapNoteOf, overviewFileText, viewFileName } from "../../core/practice/viewFiles.js";
import { StudyErrorManager } from "../../core/studyErrorManager.js";
import { StudySRSManager } from "../../core/studySrsManager.js";
import { LAYOUT } from "../../core/vaultFormat.js";
import { WorkspaceManager } from "../../core/workspaceManager.js";
import {
  type TopicManifest,
  computeTopicProgress,
  createDefaultTopicManifest,
  findAncestorTopicManifest,
  manifestsFromNotes,
  serializeTopicManifest,
} from "../../core/practice/topic.js";
import {
  type QuantityOption,
  type TheoryNoteContext,
  buildTopicSession,
  parseExerciseArray,
  type SessionAIClient,
} from "../../core/practice/sessionBuilder.js";
import {
  type ExamItemSubmission,
  type ExamSession,
  type ExamGrader,
  assembleGroupedExam,
  assembleTopicExam,
  gradeAndAggregateExam,
  loadExamRecordForTopic,
} from "../../core/practice/exams.js";
import { loadAllAttempts } from "../../core/practice/ledger.js";
import { clearExerciseIndexCache, warmNoteCache } from "../../core/practice/exerciseIndex.js";
import { AIConfig, sendChat } from "../../core/aiClient.js";
import { currentAiSignal } from "../../core/aiAbort.js";
import {
  applyPlanToPractica,
  buildReevaluationMessages,
  buildSkillOptionsMessages,
  fitPlanToArchetype,
  parsePracticePlan,
  parseSkillOptions,
  planCount,
  readPlanFromPractica,
  setFrontmatterKey,
  type PracticePlan,
} from "../../core/practice/practicePlan.js";
import { routeContextOf, taughtBeforeOf } from "../../core/practice/routeContext.js";
import { listReviews, rescheduleReview } from "../../core/practice/reviewFiles.js";
import { listVocabReviews } from "../../core/practice/vocabReviews.js";
import { loadReviewSettings, saveReviewSettings } from "../reviewSettings.js";
import { runReviewTest } from "../reviewHooks.js";
import { catalogFor } from "../../core/practice/skillSelection.js";
import { readSkillTemplates } from "../../core/practice/skillTemplates.js";
import { BRANCH_LABELS, classifyTopic, domainOfSubject, isEnglishSubject, keyOf, type Classification } from "../../core/practice/domain.js";
import { EnglishVocabularyManager } from "../../core/englishVocabularyManager.js";
import { ENGLISH_VOCABULARY_FOLDER, isEnglishBranch, isVocabularySkill, WORD_CLASSES, type WordClass } from "../../lib/englishSkillData.js";
import { listUnclassified, recordUnclassified, resolveUnclassified } from "../topicClassification.js";
import {
  learningPromptLines,
  learningStatus,
  readLearning,
  seedFromErrorLog,
  setLearningEnabled,
} from "../../core/practice/learningLog.js";
import { AppConfig } from "../appConfig.js";
import type { DifficultyLevel } from "../../core/practice/skills.js";
import type { AppState } from "../appState.js";
import { clearVaultScanCache, hasVaultScan, vaultScan } from "../vaultScan.js";
import { isoDate } from "../common.js";
import { stampSkillVersion } from "./skillFreshness.js";

// `vaultScan` vive en ../vaultScan.ts (sin ciclo con appState); se reexporta aquí.
export { vaultScan };

export const STUDY_IDS = ["mathematics", "programming", "english"] as const;

function exerciseDict(ex: ExerciseRef, rel: string): Record<string, unknown> {
  const disc = DISCIPLINES[ex.discipline];
  const skill = disc && ex.skill ? skillOf(disc, ex.skill) : null;
  const mode = MODES[ex.mode];
  return {
    path: rel,
    note_id: ex.note_id,
    title: ex.title,
    discipline: disc ? disc.title : ex.discipline,
    skill: skill ? `${ex.skill} ${skill.title.split(" (")[0]}` : ex.skill,
    mode: mode ? mode.label : ex.mode,
    difficulty: ex.difficulty,
  };
}

function studyRel(app: AppState, p: string | null | undefined): string {
  if (!p) return "";
  try {
    const abs = path.resolve(app.root, p);
    return app.rel(abs);
  } catch {
    return "";
  }
}

/** The `_skills/` templates that guide the AI's exercise design (see core/practice/skillTemplates). */
export function skillTemplates(app: AppState, topicFolderRel: string): TheoryNoteContext[] {
  return readSkillTemplates(app.root, topicFolderRel);
}

function getStudyArea(app: AppState, rel: string): StudyArea | null {
  const absPath = app.resolve(rel, { allowRoot: true });
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  const isDir = stat.isDirectory();
  const ext = path.extname(absPath).toLowerCase();
  if (!isDir && ext !== ".md" && ext !== ".canvas") {
    return null;
  }
  let r = absPath !== app.root ? app.rel(absPath) : "";
  if (isDir) {
    r += "/_";
  }
  let fm: Record<string, any> = {};
  if (!isDir && ext === ".md") {
    try {
      const fd = fs.openSync(absPath, "r");
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const text = buf.toString("utf-8", 0, bytesRead);
      const [parsed] = parseFrontmatter(text);
      if (parsed && typeof parsed === "object") {
        fm = parsed;
      }
    } catch {
      fm = {};
    }
  }
  const workspaces = new WorkspaceManager(app.root).workspaces();
  return detectStudyArea(r, fm, workspaces);
}

interface CachedStudySnapshot {
  data: any;
  timestamp: number;
}

const _snapshotCache = new Map<string, CachedStudySnapshot>();
const SNAPSHOT_CACHE_TTL_MS = 30_000;

/** The per-subject dashboard is expensive (it scans the whole vault), so it is memoed. */
const _dashboardCache = new Map<string, { data: unknown; timestamp: number }>();
const _dashboardRefreshing = new Set<string>();

/**
 * True once `warmStudyIndex` has read every note into the per-file cache, so a
 * later `scanVault` is cheap. Until then, blocks like the topic dashboard must
 * not pay the cold read themselves (see `study_topic_dashboard`).
 */
let _indexWarmed = false;
/** Vaults whose background scan has already been kicked off. */
const _scanKicked = new Set<string>();

/**
 * True while the vault index is still cold (nothing scanned yet and the background warm-up
 * not finished); in that case it also starts the scan in the background. Callers that need
 * the whole-vault scan (the Mentor) answer `loading` instead of blocking the main process.
 */
export function studyIndexCold(app: AppState): boolean {
  if (hasVaultScan(app.root) || _indexWarmed) return false;
  if (!_scanKicked.has(app.root)) {
    _scanKicked.add(app.root);
    setImmediate(() => {
      try {
        vaultScan(app);
      } catch {
        /* the renderer's retry will surface any error */
      } finally {
        _scanKicked.delete(app.root);
      }
    });
  }
  return true;
}

export function clearStudySnapshotCache(): void {
  _snapshotCache.clear();
  _dashboardCache.clear();
  clearVaultScanCache();
  _scanKicked.clear();
}

/**
 * Read the vault into the per-file cache in the background, once the window is up.
 *
 * The first study view opened in a cold process used to wait for the whole vault to
 * be read (measured: 30 s over 2 107 notes, with the main process blocked the whole
 * time). Warming it here — in batches, yielding between them — moves that cost to
 * right after launch, where nothing is waiting for it.
 */
export async function warmStudyIndex(): Promise<{ notes: number; ms: number }> {
  const app = getWarmApp();
  if (!app) return { notes: 0, ms: 0 };
  const started = Date.now();
  const notes = await warmNoteCache(app.vault.notePaths());
  try {
    vaultScan(app);
  } catch {}
  _indexWarmed = true;
  return { notes, ms: Date.now() - started };
}

/** Set by the registry (the study module is built against an AppState). */
let warmApp: AppState | null = null;
function getWarmApp(): AppState | null {
  return warmApp;
}
export function setWarmApp(app: AppState): void {
  warmApp = app;
}

function resolveTopicDir(app: AppState, relPath: string): string {
  try {
    const abs = app.resolve(relPath, { allowRoot: true });
    let dir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    const base = path.basename(dir).toLowerCase();
    if (["ejercicios", "exercises", "demostraciones", "proofs", "practica"].includes(base)) {
      const parent = path.dirname(dir);
      if (parent !== app.root) dir = parent;
    }
    return app.rel(dir);
  } catch {
    return "";
  }
}

export function findTopicManifest(
  app: AppState,
  topicFolder: string,
): { path: string; manifest: TopicManifest } | null {
  try {
    const absDir = app.resolve(topicFolder, { allowRoot: true });
    const found = findAncestorTopicManifest(absDir, app.root);
    if (found) {
      const relPath = app.rel(found.manifestPath);
      const relFolder = app.rel(found.topicFolder);
      return {
        path: relPath,
        manifest: {
          ...found.manifest,
          path: relPath,
          folder: relFolder,
        },
      };
    }
  } catch {}
  return null;
}

/**
 * A reasoning model spends part of max_tokens thinking before it writes, so the
 * chat's small budget (1500 by default) returns an EMPTY answer for anything
 * structured (measured with deepseek: exercises and practice plans came back
 * blank). Structured calls get a generous budget, and one bigger retry when the
 * answer still comes back empty.
 */
const STRUCTURED_BUDGETS = [6000, 14000, 24000];
/**
 * `accept` lets a caller reject an answer that is not usable yet — typically one cut
 * off by the token limit — and retry with the next, bigger budget.
 */
export async function askStructured(
  cfg: AIConfig,
  messages: Array<{ role: string; content: string }>,
  accept: (reply: string) => boolean = () => true,
): Promise<string> {
  let reply = "";
  for (const budget of STRUCTURED_BUDGETS) {
    const wide = new AIConfig({ ...cfg.toDict(), max_tokens: Math.max(cfg.max_tokens, budget), include_note: false });
    const signal = currentAiSignal(); // «Ejecutar plan» cancela de verdad: la señal ambiental mata la petición
    reply = signal ? await sendChat(wide, messages as any, { signal }) : await sendChat(wide, messages as any);
    if (reply.trim() && accept(reply)) return reply;
  }
  return reply;
}

/** The topic's own theory notes (everything that is not a view file or the manifest). */
export function readTheoryNotes(app: AppState, absDir: string): TheoryNoteContext[] {
  const out: TheoryNoteContext[] = [];
  let files: fs.Dirent[] = [];
  try {
    files = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith(".md") || f.name.startsWith("_tema")) continue;
    if (/\.(practica|resumen)\.md$/i.test(f.name)) continue;
    try {
      const full = path.join(absDir, f.name);
      out.push({ rel: app.rel(full), title: f.name.replace(/\.md$/i, ""), content: fs.readFileSync(full, "utf-8") });
    } catch {
      /* unreadable note: skip it */
    }
  }
  return out;
}

/**
 * What a topic is classified by: its type (mathematics, programming) or its branch (English).
 * An English topic with no branch is NOT given a default: it is logged as pending and this throws,
 * so the user resolves it explicitly (`study_topic_classify`).
 */
export function classifyForTopic(app: AppState, normFolder: string, manifest: TopicManifest): Classification {
  const subject = manifest.subject || "mathematics";
  const r = classifyTopic({
    subject,
    name: manifest.title,
    folderRel: normFolder.replace(/\\/g, "/"),
    manifestType: manifest.topic_type ?? null,
    manifestBranch: manifest.branch ?? null,
  });
  if (r.ok) return r.value;
  recordUnclassified(app.root, { folder: normFolder.replace(/\\/g, "/"), subject, name: manifest.title, suggestion: r.suggestion, reason: r.reason });
  throw new ApiError(`${r.reason}${r.suggestion ? ` Sugerencia: ${BRANCH_LABELS[r.suggestion]}.` : ""} Elige la rama en «Clasificar tema».`);
}

/**
 * Asks the AI which competencies a topic should train and how many exercises per
 * difficulty, and stores the answer in the topic's `.practica.md`.
 *
 * It rewrites the plan of an EXISTING `.practica.md`. It only creates a missing practice view when the caller says `createView` — and only the
 * explicit actions do (the "Re-evaluar" button, "Generar tema", a confirmed "Ejecutar plan"); anything implicit gets a clear error instead.
 */
export async function reevaluateTopic(app: AppState, folder: string, opts: { createView?: boolean } = {}): Promise<{ plan: PracticePlan; path: string; reply: string }> {
  const normFolder = app.rel(app.resolve(folder, { allowRoot: true }));
  const found = findTopicManifest(app, normFolder);
  if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
  const manifest = found.manifest;
  const topicAbs = app.resolve(manifest.folder || normFolder, { allowRoot: true });

  const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
  if (cfg.is_bridge) {
    throw new ApiError("El proveedor de IA está en modo puente; no se puede re-evaluar automáticamente.");
  }

  const subject = manifest.subject || "mathematics";
  const cls = classifyForTopic(app, normFolder, manifest);
  const topicType = cls.topicType;
  const catalog = catalogFor(subject);
  const route = subject === "programming" ? routeContextOf(topicAbs, manifest.title, topicType) : null;
  const messages = buildReevaluationMessages({
    subject,
    title: manifest.title,
    topicType,
    archetype: route?.archetype,
    taughtBefore: route?.taughtBefore,
    branch: cls.branch,
    catalog,
    theory: readTheoryNotes(app, topicAbs),
    templates: skillTemplates(app, normFolder),
    currentSkills: manifest.skills,
  });

  const reply = await askStructured(cfg, messages);
  let plan = parsePracticePlan(reply, catalog, keyOf(cls));
  if (!plan) {
    const snippet = String(reply ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new ApiError(`La IA no devolvió un plan de práctica válido. Respuesta: «${snippet || "vacía"}»`);
  }
  if (route) {
    plan = fitPlanToArchetype(plan, route.archetype, catalog);
  }
  if (cls.domain !== "english") plan.topicType = plan.topicType ?? topicType;

  const practicaAbs = path.join(topicAbs, viewFileName(path.basename(topicAbs), "practica"));
  if (!fs.existsSync(practicaAbs)) {
    if (!opts.createView) throw new ApiError("Este tema aún no tiene su archivo .practica: créalo primero con «Crear vista de práctica» (no se escribe nada sin pedirlo).");
    ensureTopicViewFiles(app.root, topicAbs);
  }
  if (!fs.existsSync(practicaAbs)) throw new ApiError("No se pudo crear el archivo .practica del tema.");
  const labels = Object.fromEntries(catalog.map((s) => [s.id, s.label]));
  fs.writeFileSync(practicaAbs, applyPlanToPractica(fs.readFileSync(practicaAbs, "utf-8"), plan, labels), "utf-8");
  stampSkillVersion(app.root, normFolder.split("/")[0] ?? "", "practica", practicaAbs);

  clearExerciseIndexCache();
  clearStudySnapshotCache();
  return { plan, reply, path: app.rel(practicaAbs).split(path.sep).join("/") };
}

/**
 * The competency checklist of a topic for the chat: which skills the AI recommends and, for every
 * skill of the catalogue, why and how it would be practised here. Writes nothing: the user ticks
 * and accepts in the chat, and only then is the matrix changed.
 */
export async function topicSkillOptions(app: AppState, folder: string) {
  const normFolder = app.rel(app.resolve(folder, { allowRoot: true })).replace(/\\/g, "/");
  const found = findTopicManifest(app, normFolder);
  if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
  const manifest = found.manifest;
  const topicAbs = app.resolve(manifest.folder || normFolder, { allowRoot: true });
  const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
  if (cfg.is_bridge) throw new ApiError("El proveedor de IA está en modo puente; no se puede re-evaluar automáticamente.");

  const subject = manifest.subject || "mathematics";
  const cls = classifyForTopic(app, normFolder, manifest);
  const topicType = cls.topicType;
  const catalog = catalogFor(subject);
  const route = subject === "programming" ? routeContextOf(topicAbs, manifest.title, topicType) : null;
  const messages = buildSkillOptionsMessages({
    subject,
    title: manifest.title,
    topicType,
    archetype: route?.archetype,
    taughtBefore: route?.taughtBefore,
    branch: cls.branch,
    catalog,
    theory: readTheoryNotes(app, topicAbs),
    templates: skillTemplates(app, normFolder),
    currentSkills: manifest.skills,
  });
  const reply = await askStructured(cfg, messages, (r) => parseSkillOptions(r, catalog, keyOf(cls)) !== null);
  const parsed = parseSkillOptions(reply, catalog, keyOf(cls));
  if (!parsed) {
    const snippet = String(reply ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new ApiError(`La IA no devolvió la lista de competencias. Respuesta: «${snippet || "vacía"}»`);
  }
  const current = new Set((manifest.skills ?? []).map((s) => s.toLowerCase()));
  return {
    topic: normFolder,
    title: manifest.title,
    topicType: parsed.topicType ?? topicType,
    summary: parsed.summary,
    skills: parsed.options.map((o) => ({ ...o, current: current.has(o.skill) })),
  };
}

/** The AI client the session builders share: two tries, then nothing (never a crash). */
function makeSessionAiClient(): SessionAIClient {
  return {
    async generateExercises(messages) {
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      if (cfg.is_bridge) return [];
      // A model now and then returns nothing usable: one more try before giving up.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const found = parseExerciseArray(await askStructured(cfg, messages as any));
          if (found.length) return found;
        } catch {
          /* network or provider error: retry once */
        }
      }
      return [];
    },
  };
}

/** English vocabulary skills are built around the shared word bank: the words due first, then the topic's own. */
export function vocabularyWords(app: AppState, subject: string, skill: string, topicTitle: string): { words?: string[]; wordIds?: string[] } {
  if (!isEnglishSubject(subject) || !isVocabularySkill(skill)) return {};
  const picked = new EnglishVocabularyManager(app.root).sessionWords(topicTitle, 10, isoDate(new Date())!);
  return picked.length
    ? { words: picked.map((w) => `${w.word} — ${w.meaning} (${w.part_of_speech}, ${w.level})`), wordIds: picked.map((w) => w.id) }
    : {};
}

/** The first top-level folder whose overview says it is an English space; null when there is none. */
export function englishSpaceFolder(app: AppState): string | null {
  for (const d of fs.readdirSync(app.root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".") || d.name.startsWith("_")) continue;
    try {
      const head = fs.readFileSync(path.join(app.root, d.name, `${d.name}.resumen.md`), "utf-8").slice(0, 800);
      const subject = /^subject:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(head)?.[1];
      if (subject && isEnglishSubject(subject)) return d.name;
    } catch {
      /* not a space */
    }
  }
  return null;
}

export function studyApi(app: AppState) {
  return {
    /** The competency checklist the chat shows when re-evaluating a topic's practice. */
    async study_topic_skill_options(folder: string) {
      return topicSkillOptions(app, folder);
    },

    study_area(rel: string) {
      const area = getStudyArea(app, rel);
      if (!area) {
        return null;
      }
      return {
        subject: area.subject,
        folder: area.folder,
        title: area.title,
        subject_title: area.subject_title,
      };
    },

    study_snapshot(rel: string) {
      const area = getStudyArea(app, rel);
      if (!area) {
        throw new ApiError("Esta nota no está en un área de estudio.");
      }
      const cacheKey = `${app.root}::${area.subject}::${area.folder}`;
      const cached = _snapshotCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < SNAPSHOT_CACHE_TTL_MS) {
        return cached.data;
      }
      const snap = hubSnapshot(app.root, app.vault.notePaths(), null, area);
      const srs = new StudySRSManager(app.root);
      const items: Array<Record<string, unknown>> = [];

      for (const it of snap.queue.items) {
        const row: Record<string, unknown> = {
          kind: it.kind,
          title: it.title,
          reason: it.reason,
        };
        if (it.exercise) {
          row.exercise = exerciseDict(it.exercise, studyRel(app, it.exercise.path));
        } else if (it.srs_item) {
          const card = loadCard(app.root, it.srs_item);
          row.card = {
            srs_id: it.srs_item.id,
            source: String(it.srs_item.source_note || ""),
            kind: card ? card.kind : "",
            question: card ? card.question : "",
            answer: card ? card.answer : "",
            missing: card === null,
          };
        }
        items.push(row);
      }

      const attempted = new Set<string>();
      for (const [nid, d] of Object.entries(snap.attempts)) {
        if (Array.isArray(d.attempts) && d.attempts.length > 0) {
          attempted.add(nid);
        }
      }

      const today = isoDate(new Date())!;
      const due: Record<string, string> = {};
      for (const i of snap.srs_items) {
        if (i.entity_type === "exercise" && i.next_review <= today) {
          due[i.entity_id] = i.next_review;
        }
      }

      const ledgers: Array<Record<string, unknown>> = [];
      for (const ledger of Object.values(snap.ledgers)) {
        const rows: Array<Record<string, unknown>> = [];
        for (const row of ledger.skills) {
          const refs = snap.exercises.filter(
            (e) => e.discipline === ledger.discipline && e.skill === row.code,
          );
          const ex =
            pickExercise(refs, attempted, due) || (refs.length > 0 ? refs[0]! : null);
          rows.push({
            code: row.code,
            title: String(row.title || "").split(" (")[0],
            status: row.status,
            label: row.label,
            best: row.best ?? null,
            is_due: Boolean(row.is_due),
            due: row.due || "",
            interval_days: row.interval_days ?? null,
            bands: (BANDS as readonly string[]).filter((b) =>
              (row.bands || []).includes(b),
            ),
            exercises: row.exercises,
            attempted: row.attempted_exercises,
            practice: ex ? studyRel(app, ex.path) : "",
            practice_title: ex ? ex.title : "",
          });
        }
        ledgers.push({ title: ledger.title, skills: rows });
      }

      const chapters = new Map<string, [string, ExerciseRef[]]>();
      for (const e of snap.exercises) {
        if (!chapters.has(e.chapter)) {
          chapters.set(e.chapter, [e.chapter_title, []]);
        }
        chapters.get(e.chapter)![1].push(e);
      }
      const sortedKeys = Array.from(chapters.keys()).sort();
      const conceptRows: Array<Record<string, unknown>> = [];
      for (const key of sortedKeys) {
        const [title, refs] = chapters.get(key)!;
        let done = 0;
        let best: number | null = null;
        for (const e of refs) {
          const atts = snap.attempts[e.note_id]?.attempts || [];
          if (atts.some((a: any) => attemptPassed(a))) {
            done += 1;
          }
          const scores = atts
            .filter((a: any) => a.verdict !== "ungraded")
            .map((a: any) => parseInt(String(a.score || 0), 10));
          if (scores.length > 0) {
            best = Math.max(best ?? 0, Math.max(...scores));
          }
        }
        conceptRows.push({ title, done, total: refs.length, best });
      }

      const byId = new Map(snap.exercises.map((e) => [e.note_id, e]));
      const errors: Array<Record<string, unknown>> = [];
      for (const err of snap.errors) {
        const ref = byId.get(err.note_id || err.exercise_id || "");
        let source = ref ? studyRel(app, ref.path) : "";
        if (!source && err.source_note) {
          const p = path.resolve(app.root, String(err.source_note));
          if (fs.existsSync(p)) {
            source = studyRel(app, p);
          }
        }
        errors.push({
          id: err.id,
          repeat_count: err.repeat_count,
          category: err.category,
          skill: err.discipline
            ? skillLabel(err.discipline, ref ? ref.skill : err.skill || "")
            : "",
          anchor: err.anchor || "",
          description: err.description_en || err.explanation || "",
          fix: err.fix_en || err.expected || "",
          seen: String(err.last_seen || err.occurred_at || "").slice(0, 10),
          note: ref ? ref.title : err.note_id || err.topic || "",
          source,
        });
      }
      errors.sort((a, b) => String(b.seen).localeCompare(String(a.seen)));
      errors.sort((a, b) => Number(b.repeat_count) - Number(a.repeat_count));
      srs.allItems(); // warm cache

      const result = {
        area: {
          subject: area.subject,
          title: area.title,
          subject_title: area.subject_title,
          folder: area.folder,
        },
        exercises: snap.exercises.length,
        queue: {
          items,
          gaps: snap.queue.gaps
            .map((g: any) => g.message)
            .filter(Boolean),
          counts: snap.queue.counts,
        },
        ledgers,
        concepts: conceptRows,
        errors,
      };
      _snapshotCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    },

    study_card_grade(srs_id: string, quality: number) {
      clearStudySnapshotCache();
      const q =
        typeof quality === "number"
          ? Math.trunc(quality)
          : parseInt(String(quality), 10);
      if (!Number.isFinite(q) || ![1, 3, 4, 5].includes(q)) {
        throw new ApiError("Calificación inválida.");
      }
      if (new StudySRSManager(app.root).review(String(srs_id), q) === null) {
        throw new ApiError("Esa tarjeta ya no existe.");
      }
      return { ok: true };
    },

    study_error_resolve(error_id: string) {
      clearStudySnapshotCache();
      if (new StudyErrorManager(app.root).markResolved(String(error_id)) === null) {
        throw new ApiError("Ese error ya no existe.");
      }
      writeErrorDigest(app.root);
      return { ok: true };
    },

    study_error_digest() {
      const digestPath = path.join(app.root, LAYOUT.study_error_digest);
      try {
        return { text: fs.readFileSync(digestPath, "utf-8") };
      } catch {
        return {
          text: "Todavía no hay ERROR_LOG.md: se genera al corregir el primer intento.",
        };
      }
    },

    study_folders() {
      const ws = new WorkspaceManager(app.root);
      const out: Array<Record<string, unknown>> = [];
      for (const wid of STUDY_IDS) {
        const w = ws.get(wid);
        if (!w) continue;
        const folder = ws.findExistingFolder(wid);
        const indexPath = folder ? path.join(folder, "00 Índice.md") : null;
        out.push({
          id: wid,
          name: w.name,
          icon: w.icon || "📁",
          exists: folder !== null,
          index: indexPath && fs.existsSync(indexPath) ? studyRel(app, indexPath) : "",
        });
      }
      return out;
    },

    study_folder_create(ws_id: string, with_structure = true) {
      if (!STUDY_IDS.includes(ws_id as any)) {
        throw new ApiError("Espacio de estudio desconocido.");
      }
      const res = new WorkspaceManager(app.root).ensureFolder(
        ws_id,
        Boolean(with_structure),
      );
      return {
        path: app.rel(res.path),
        created: res.created,
        index: res.index ? studyRel(app, res.index) : "",
      };
    },

    /**
     * The view file of a folder: the topic's `practica` file for a topic folder,
     * the `resumen` overview otherwise.
     *
     * READ-ONLY by default: opening a folder or following a link must never write
     * notes into the vault. Without `create`, a missing view comes back as
     * `{ ok: false, missing: true, path: <where it would live> }` so the UI can ask the
     * person ("Crear vista de práctica") and call again with `create = true`.
     * With `create`, only the view files of that folder are written (never a
     * placeholder `.teorica.md`; existing theory notes are tagged `type: teorica`).
     */
    study_view_ensure(rel: string, create = false) {
      const abs = app.resolve(rel, { allowRoot: true });
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        throw new ApiError("Esa carpeta no existe.");
      }
      // A file was passed: use the folder it lives in.
      const folderAbs = stat.isDirectory() ? abs : path.dirname(abs);
      const posixRel = (p: string) => app.rel(p).split(path.sep).join("/");
      // `Ejercicios` and its per-skill folders open as a navigable set of exercises.
      if (stat.isDirectory() && !isSubjectRoot(app.root, folderAbs) && isExerciseFolder(folderAbs)) {
        const target = path.join(folderAbs, viewFileName(path.basename(folderAbs), "ejercicios"));
        if (!create && !fs.existsSync(target)) return { ok: false, kind: "ejercicios", missing: true, path: posixRel(target), created: [], errors: [] };
        const { file, created } = ensureExerciseSetFile(folderAbs);
        if (created) clearExerciseIndexCache();
        return {
          ok: true,
          kind: "ejercicios",
          path: posixRel(file),
          created: created ? [app.rel(file)] : [],
          errors: [],
        };
      }
      // programming_practice/projects (and its _specs folder) open the weekly-project workspace.
      const projectsAbs = stat.isDirectory() ? projectsFolderOf(folderAbs) : null;
      if (projectsAbs) {
        const target = path.join(projectsAbs, viewFileName(path.basename(projectsAbs), "proyectos"));
        if (!create && !fs.existsSync(target)) return { ok: false, kind: "proyectos", missing: true, path: posixRel(target), created: [], errors: [] };
        const { file, created } = ensureProjectsViewFile(projectsAbs);
        return { ok: true, kind: "proyectos", path: posixRel(file), created: created ? [app.rel(file)] : [], errors: [] };
      }
      // The subject root groups areas: it gets its overview and nothing else.
      const subjectRoot = isSubjectRoot(app.root, folderAbs);
      const topic = !subjectRoot && isTopicFolder(app.root, folderAbs);
      if (!topic && !subjectRoot && !folderHasTopicsBelow(app.root, folderAbs)) {
        // A plain folder has no view: the explorer falls back to expanding it.
        return { ok: false, kind: "none", path: "", created: [], errors: [] };
      }
      const kind = topic ? "practica" : "resumen";
      const fileAbs = topic
        ? path.join(folderAbs, `${path.basename(folderAbs)}.practica.md`)
        : path.join(folderAbs, `${path.basename(folderAbs)}.resumen.md`);
      if (!create) {
        const exists = fs.existsSync(fileAbs);
        return { ok: exists, kind, ...(exists ? {} : { missing: true }), path: app.rel(fileAbs), created: [], tagged: [], errors: [] };
      }
      const result = topic
        ? ensureTopicViewFiles(app.root, folderAbs)
        : ensureOverviewFile(app.root, folderAbs);

      const created = [...result.created];
      const tagged = [...result.tagged];
      if (created.length || tagged.length) {
        clearExerciseIndexCache();
        clearStudySnapshotCache();
      }
      return {
        ok: fs.existsSync(fileAbs),
        kind,
        path: app.rel(fileAbs),
        created: created.map((c) => app.rel(c)),
        /** theory notes marked `type: teorica` by this call */
        tagged: tagged.map((t) => app.rel(t)),
        errors: result.errors.map((e) => app.rel(e)),
      };
    },

    /** The canvas of the topic the given path belongs to, if it has one. */
    study_topic_map(rel: string) {
      const abs = app.resolve(rel, { allowRoot: true });
      let folderAbs: string;
      try {
        folderAbs = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        throw new ApiError("Esa ruta no existe.");
      }
      const found = findAncestorTopicManifest(abs, app.root);
      const topicAbs = found ? found.topicFolder : folderAbs;
      const map = mapNoteOf(topicAbs);
      return { ok: Boolean(map), path: map ? app.rel(map) : "" };
    },

    study_topic_get(rel: string) {
      const absPath = app.resolve(rel, { allowRoot: true });
      const found = findAncestorTopicManifest(absPath, app.root);

      let topicFolder: string;
      if (found) {
        topicFolder = app.rel(found.topicFolder);
      } else {
        topicFolder = resolveTopicDir(app, rel);
        if (!topicFolder) {
          return { is_topic: false, folder: "", can_convert: false };
        }
      }

      const scan = vaultScan(app);
      const normFolder = topicFolder.replace(/\\/g, "/");
      const topicExercises = scan.exercises.filter((e) => {
        const p = (e.rel || e.path).replace(/\\/g, "/");
        return p.startsWith(normFolder + "/");
      });

      // Scan theory notes in topic folder and all subfolders
      const theoryNotes: Array<{ rel: string; title: string }> = [];
      const exercisePaths = new Set(topicExercises.map((e) => (e.rel || e.path).replace(/\\/g, "/")));
      for (const np of app.vault.notePaths()) {
        const normNp = np.replace(/\\/g, "/");
        if (
          normNp.startsWith(normFolder + "/") &&
          !normNp.endsWith("/_tema.md") &&
          !normNp.endsWith("/tema.md")
        ) {
          if (!exercisePaths.has(normNp)) {
            const baseName = path.basename(normNp).replace(/\.md$/, "");
            theoryNotes.push({
              rel: normNp,
              title: baseName,
            });
          }
        }
      }

      if (!found) {
        return {
          is_topic: false,
          folder: topicFolder,
          can_convert: topicExercises.length > 0 || theoryNotes.length > 0,
        };
      }

      const attempts = loadAllAttempts(app.root);
      const manifestWithRelPaths: TopicManifest = {
        ...found.manifest,
        path: app.rel(found.manifestPath),
        folder: topicFolder,
      };

      const examRec = loadExamRecordForTopic(
        app.root,
        manifestWithRelPaths,
      );
      const progress = computeTopicProgress(
        manifestWithRelPaths,
        topicExercises,
        attempts,
        examRec,
        theoryNotes.length,
      );

      return {
        is_topic: true,
        folder: topicFolder,
        topic: manifestWithRelPaths,
        progress,
        theory_notes: theoryNotes,
        exercises: topicExercises.map((e) => {
          const savedAttempts = attempts[e.note_id]?.attempts;
          const history = Array.isArray(savedAttempts) ? savedAttempts : [];
          return { ...exerciseDict(e, studyRel(app, e.path)), mode_id: e.mode, skill_id: e.skill, completed: history.some((a: Record<string, unknown>) => attemptPassed(a)), history };
        }),
        can_convert: false,
      };
    },

    study_topic_convert(folder: string) {
      const absDir = app.resolve(folder, { allowRoot: true });
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        throw new ApiError("Carpeta no encontrada.");
      }
      const manifestPath = path.join(absDir, "_tema.md");
      if (fs.existsSync(manifestPath)) {
        throw new ApiError("El tema ya tiene un archivo de manifiesto (_tema.md).");
      }
      const scan = vaultScan(app);
      const folderRel = app.rel(absDir);
      const topicExercises = scan.exercises.filter((e) =>
        (e.rel || e.path).replace(/\\/g, "/").startsWith(folderRel + "/"),
      );
      const area = getStudyArea(app, folderRel);
      const subject = area ? area.subject : "mathematics";
      const manifest = createDefaultTopicManifest(
        folderRel,
        path.basename(absDir),
        subject,
        topicExercises,
      );
      const text = serializeTopicManifest(manifest);
      fs.writeFileSync(manifestPath, text, "utf-8");
      clearExerciseIndexCache();
      clearStudySnapshotCache();
      return { ok: true, path: app.rel(manifestPath), manifest };
    },

    async study_topic_session_build(
      folder: string,
      skill: string,
      difficulty: number,
      quantity = "3-5",
      assistance = "no_help",
      fillOnly = false,
    ) {
      const normFolder = app.rel(app.resolve(folder, { allowRoot: true }));
      const found = findTopicManifest(app, normFolder);
      if (!found) {
        throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
      }
      const scan = vaultScan(app);
      const diff = Math.min(
        3,
        Math.max(1, parseInt(String(difficulty), 10) || 2),
      ) as DifficultyLevel;
      const ast = assistance === "helper" ? "helper" : "no_help";
      const qty = (quantity || "3-5") as QuantityOption;

      // "ai": the count comes from the topic's practice plan; without one, ask the AI first.
      let aiCount: number | null = null;
      if (qty === "ai") {
        const topicAbsForPlan = app.resolve(found.manifest.folder || normFolder, { allowRoot: true });
        const practicaAbs = path.join(topicAbsForPlan, viewFileName(path.basename(topicAbsForPlan), "practica"));
        const readPlan = () => {
          try {
            return readPlanFromPractica(fs.readFileSync(practicaAbs, "utf-8"));
          } catch {
            return null;
          }
        };
        // Sin plan NO se llama a la IA por debajo (reescribiría el `.practica.md` sin que la persona lo pida): se avisa con un error claro.
        const plan = readPlan();
        if (!plan) throw new ApiError("Este tema aún no tiene un plan de práctica de la IA. Pulsa «Re-evaluar competencias» (o «Regenerar práctica») primero, o elige otra cantidad de ejercicios.");
        aiCount = planCount(plan, skill, diff);
      }

      // Extract theory notes
      const absDir = app.resolve(normFolder);
      const theoryNotes: TheoryNoteContext[] = [];
      try {
        const files = fs.readdirSync(absDir, { withFileTypes: true });
        for (const f of files) {
          if (f.isFile() && f.name.endsWith(".md") && !f.name.startsWith("_tema")) {
            const full = path.join(absDir, f.name);
            const content = fs.readFileSync(full, "utf-8");
            theoryNotes.push({
              rel: app.rel(full),
              title: f.name.replace(/\.md$/, ""),
              content,
            });
          }
        }
      } catch {}

      // The `_skills/` templates steer the prompt (how a concept/practice note
      // is shaped, which exercise types exist) alongside the topic's own theory.
      theoryNotes.push(...skillTemplates(app, normFolder));

      const aiClient = makeSessionAiClient();

      const plan = await buildTopicSession(
        found.manifest,
        normFolder,
        {
          skill,
          difficulty: diff,
          quantity: qty,
          assistance: ast,
          planCount: aiCount,
          learning: fillOnly ? [] : learningPromptLines(app.root, normFolder.replace(/\\/g, "/"), skill),
          taughtBefore: taughtBeforeOf(absDir),
          ...vocabularyWords(app, found.manifest.subject, skill, found.manifest.title),
        },
        scan.exercises,
        theoryNotes,
        aiClient,
      );

      for (const ex of plan.exercises) {
        if (ex.isNew && ex.content) {
          const targetAbs = app.resolve(ex.path, { allowRoot: false, mustExist: false });
          fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
          fs.writeFileSync(targetAbs, ex.content, "utf-8");
        }
      }

      if (plan.generatedCount > 0) {
        clearExerciseIndexCache();
        clearStudySnapshotCache();
      }

      return {
        ok: true,
        skill: plan.skill,
        difficulty: plan.difficulty,
        assistance: plan.assistance,
        target_count: plan.targetCount,
        existing_count: plan.existingCount,
        generated_count: plan.generatedCount,
        exercises: plan.exercises.map((e) => ({
          id: e.id,
          title: e.title,
          path: e.path,
          is_new: e.isNew,
        })),
        first_exercise: plan.exercises[0]?.path ?? "",
      };
    },

    /**
     * A vocabulary session from the shared word bank (no topic needed): exercises of one `vc_` skill built around
     * the words due first, saved in `<English space>/Vocabulario/Ejercicios/<skill>/`. Their reviews follow the grade.
     */
    async study_vocab_session(skill = "vc_recall", quantity = "3-5", wordClass = "") {
      const sk = String(skill || "").trim().toLowerCase();
      if (!isVocabularySkill(sk)) throw new ApiError("Elige una competencia de vocabulario (recuerdo, reconocimiento, uso, familias, colocaciones o sinónimos).");
      const space = englishSpaceFolder(app);
      if (!space) throw new ApiError("Todavía no hay un espacio de inglés: genera uno primero.");
      const today = isoDate(new Date())!;
      const cls = (WORD_CLASSES as readonly string[]).includes(wordClass) ? (wordClass as WordClass) : null;
      const words = new EnglishVocabularyManager(app.root).sessionWords("", 10, today, cls);
      if (!words.length) throw new ApiError("El banco de palabras está vacío: añade palabras al calendario de repasos o mínalas desde el reproductor.");
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      if (cfg.is_bridge) throw new ApiError("El proveedor de IA está en modo puente; no se puede generar automáticamente.");
      const folder = `${space}/${ENGLISH_VOCABULARY_FOLDER}`;
      const manifest: TopicManifest = {
        type: "topic",
        subject: "english",
        title: "Vocabulario",
        skills: [sk],
        mastery: { min_per_skill: 6, target_difficulty: 3, exam: "none" },
        folder,
      };
      const plan = await buildTopicSession(
        manifest,
        folder,
        {
          skill: sk,
          difficulty: 2,
          quantity: (quantity || "3-5") as QuantityOption,
          assistance: "no_help",
          words: words.map((w) => `${w.word} — ${w.meaning} (${w.part_of_speech}, ${w.level})`),
          wordIds: words.map((w) => w.id),
        },
        vaultScan(app).exercises,
        [],
        makeSessionAiClient(),
      );
      for (const ex of plan.exercises) {
        if (ex.isNew && ex.content) {
          const abs = app.resolve(ex.path, { allowRoot: false, mustExist: false });
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, ex.content, "utf-8");
        }
      }
      if (plan.generatedCount > 0) {
        clearExerciseIndexCache();
        clearStudySnapshotCache();
      }
      return { ok: true, skill: sk, exercises: plan.exercises.map((e) => ({ id: e.id, title: e.title, path: e.path, is_new: e.isNew })), first_exercise: plan.exercises[0]?.path ?? "" };
    },

    /** How a topic is classified: its type (maths, programming) or its branch (English), or why it is not. */
    study_topic_classification(folder: string) {
      const rel = app.rel(app.resolve(folder, { allowRoot: true })).replace(/\\/g, "/");
      const found = findTopicManifest(app, rel);
      if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
      const m = found.manifest;
      const r = classifyTopic({ subject: m.subject || "mathematics", name: m.title, folderRel: rel, manifestType: m.topic_type ?? null, manifestBranch: m.branch ?? null });
      return r.ok
        ? { ok: true, domain: r.value.domain, branch: r.value.branch ?? null, topicType: r.value.topicType ?? null, via: r.value.via }
        : { ok: false, domain: r.domain, reason: r.reason, suggestion: r.suggestion, branch: null, topicType: null, via: null };
    },

    /** Resolves an unclassified English topic EXPLICITLY: writes its branch into its practice file. */
    study_topic_classify(folder: string, branch: string) {
      const b = String(branch ?? "").trim().toLowerCase();
      if (!isEnglishBranch(b)) throw new ApiError("Elige una rama: gramática, escritura, lectura, escucha o habla.");
      const rel = app.rel(app.resolve(folder, { allowRoot: true })).replace(/\\/g, "/");
      const found = findTopicManifest(app, rel);
      if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
      if (domainOfSubject(found.manifest.subject || "") !== "english") throw new ApiError("Solo los temas de inglés se clasifican por rama.");
      const topicAbs = app.resolve(found.manifest.folder || rel, { allowRoot: true });
      const practicaAbs = path.join(topicAbs, viewFileName(path.basename(topicAbs), "practica"));
      // «Clasificar tema» es una acción explícita cuyo resultado se guarda en el `.practica.md`: solo aquí se crea si falta (tema con marcador antiguo).
      if (!fs.existsSync(practicaAbs)) ensureTopicViewFiles(app.root, topicAbs);
      fs.writeFileSync(practicaAbs, setFrontmatterKey(fs.readFileSync(practicaAbs, "utf-8"), "branch", b), "utf-8");
      resolveUnclassified(app.root, rel);
      clearExerciseIndexCache();
      clearStudySnapshotCache();
      return { ok: true, branch: b };
    },

    /** English topics still waiting to be classified. */
    study_unclassified_list() {
      return listUnclassified(app.root);
    },

    /** Per competency of a topic: is its mistakes record on, and how many mistakes it holds. */
    study_learning_status(folder: string) {
      const rel = app.rel(app.resolve(folder, { allowRoot: true })).replace(/\\/g, "/");
      return learningStatus(app.root, rel);
    },

    /** The "Activar registro de errores" box of one competency of one topic. */
    study_learning_set(folder: string, skill: string, enabled: boolean) {
      const rel = app.rel(app.resolve(folder, { allowRoot: true })).replace(/\\/g, "/");
      const found = findTopicManifest(app, rel);
      if (!found) throw new ApiError("Esta carpeta no tiene un manifiesto de tema.");
      const sk = String(skill || "").toLowerCase();
      const existing = readLearning(app.root, rel, sk);
      const seed = existing ? [] : seedFromErrorLog(app.root, rel, found.manifest.subject, sk);
      const rec = setLearningEnabled(app.root, rel, found.manifest.title, sk, Boolean(enabled), seed);
      return { skill: sk, enabled: rec.enabled, entries: rec.entries.length };
    },

    /** The topic review notes (spaced repetition), soonest first. */
    study_reviews_list() {
      const today = isoDate(new Date())!;
      // Topic reviews and, for English, the scheduled words of the shared word bank.
      const items = [...listReviews(app.root, today), ...listVocabReviews(app.root, today)].sort((a, b) => a.next.localeCompare(b.next) || a.topic.localeCompare(b.topic, "es", { numeric: true }));
      return { today, items };
    },

    /** Moves the pending review of a topic to another day. */
    study_review_reschedule(relPath: string, date: string) {
      const item = rescheduleReview(app.root, String(relPath ?? ""), String(date ?? ""));
      clearStudySnapshotCache();
      return item;
    },

    /** The reminder preferences (on/off and the hour from which a due review is announced). */
    study_review_settings() {
      return loadReviewSettings();
    },
    study_review_settings_set(settings: unknown) {
      return saveReviewSettings(settings);
    },
    /** Shows a real notification now, so the user can see that reminders work. */
    study_review_notify_test() {
      return runReviewTest();
    },

    /** Re-reads the topic's theory with the AI and rewrites its practice plan. */
    async study_topic_reevaluate(folder: string) {
      const { plan, path: practicePath } = await reevaluateTopic(app, folder, { createView: true }); // botón explícito
      return { ok: true, plan, path: practicePath };
    },

    /** The stored practice plan of a topic (null when it has none yet). */
    study_topic_plan(folder: string) {
      const normFolder = app.rel(app.resolve(folder, { allowRoot: true }));
      const found = findTopicManifest(app, normFolder);
      if (!found) return { plan: null };
      const topicAbs = app.resolve(found.manifest.folder || normFolder, { allowRoot: true });
      try {
        const text = fs.readFileSync(path.join(topicAbs, viewFileName(path.basename(topicAbs), "practica")), "utf-8");
        return { plan: readPlanFromPractica(text) };
      } catch {
        return { plan: null };
      }
    },

    /**
     * A session that draws from every topic of an area (or the whole subject),
     * instead of one topic: the exercises that already exist in the area's
     * topics are filtered by skill and difficulty. Nothing is generated here —
     * the per-topic builder keeps owning generation.
     */
    study_area_session_build(
      folder: string,
      skill: string,
      difficulty: number,
      quantity = "6-10",
      assistance = "no_help",
    ) {
      const normFolder = app.rel(app.resolve(folder, { allowRoot: true })).split(path.sep).join("/").replace(/^\/+|\/+$/g, "");
      const scan = vaultScan(app);
      const prefix = normFolder ? `${normFolder}/` : "";
      const inArea = scan.exercises.filter((e) => String(e.rel || e.path || "").split(path.sep).join("/").startsWith(prefix));

      const diff = Math.min(3, Math.max(1, parseInt(String(difficulty), 10) || 2));
      const wantSkill = String(skill || "").trim().toLowerCase();
      const hasSkill = (e: (typeof inArea)[number]) =>
        (e.mode || "").toLowerCase() === wantSkill || (e.skill || "").toLowerCase() === wantSkill;

      // Skill + difficulty first, then skill, then difficulty, then anything.
      const tiers = [
        inArea.filter((e) => hasSkill(e) && e.difficulty === diff),
        inArea.filter((e) => hasSkill(e)),
        inArea.filter((e) => e.difficulty === diff),
        inArea,
      ];
      const picked = tiers.find((t) => t.length) ?? [];
      const wanted = quantity === "3-5" ? 5 : quantity === "11+" ? 12 : quantity === "all" ? picked.length : 10;
      const chosen = picked.slice(0, Math.max(1, wanted));

      return {
        ok: chosen.length > 0,
        skill: wantSkill || "solve",
        difficulty: diff,
        assistance: assistance === "helper" ? "helper" : "no_help",
        target_count: wanted,
        existing_count: inArea.length,
        generated_count: 0,
        exercises: chosen.map((e) => ({
          id: e.note_id,
          title: e.title,
          path: e.rel || e.path,
          is_new: false,
        })),
        first_exercise: chosen[0]?.rel ?? "",
      };
    },

    study_exam_assemble: async (
      topicFolder?: string,
      examGroup?: string,
      targetDifficulty?: number,
    ) => {
      const scan = vaultScan(app);
      const allExercises = scan.exercises;
      const targetDiff = (targetDifficulty && targetDifficulty >= 1 && targetDifficulty <= 3
        ? targetDifficulty
        : 3) as DifficultyLevel;

      if (topicFolder) {
        const found = findTopicManifest(app, topicFolder);
        if (!found) {
          throw new ApiError(`No se encontró manifest de tema en "${topicFolder}"`);
        }
        const normFolder = topicFolder.replace(/\\/g, "/");
        const topicExercises = allExercises.filter((ex) => {
          const p = (ex.rel || ex.path).replace(/\\/g, "/");
          return p.startsWith(normFolder + "/");
        });

        const session = await assembleTopicExam(found.manifest, topicExercises, {
          targetDifficulty: targetDiff,
        });
        return { ok: true, session };
      }

      if (examGroup) {
        const matchedTopics: TopicManifest[] = [];
        const topicMap = new Map<string, ExerciseRef[]>();

        const folderSet = new Set<string>();
        for (const np of app.vault.notePaths()) {
          const dir = path.dirname(np).replace(/\\/g, "/");
          if (dir && dir !== ".") {
            folderSet.add(dir);
            const parent = path.dirname(dir).replace(/\\/g, "/");
            if (parent && parent !== ".") folderSet.add(parent);
          }
        }

        for (const f of folderSet) {
          const found = findTopicManifest(app, f);
          if (found && found.manifest.exam_group?.toLowerCase() === examGroup.toLowerCase()) {
            if (!matchedTopics.some((t) => t.title === found.manifest.title)) {
              matchedTopics.push(found.manifest);
              const normF = f.replace(/\\/g, "/");
              const exs = allExercises.filter((ex) => {
                const p = (ex.rel || ex.path).replace(/\\/g, "/");
                return p.startsWith(normF + "/");
              });
              topicMap.set(found.manifest.title, exs);
            }
          }
        }

        if (matchedTopics.length === 0) {
          throw new ApiError(`No se encontraron temas para el grupo de examen "${examGroup}"`);
        }

        const session = await assembleGroupedExam(examGroup, matchedTopics, topicMap, {
          targetDifficulty: targetDiff,
        });
        return { ok: true, session };
      }

      throw new ApiError("Debe especificar topicFolder o examGroup");
    },

    study_exam_submit: async (
      session: ExamSession,
      submissions: ExamItemSubmission[],
    ) => {
      const grader: ExamGrader = async (item, answerText) => {
        if (!answerText.trim()) {
          return { score: 0, passed: false, feedback: "Sin respuesta." };
        }
        const aiCfg = AIConfig.fromDict(AppConfig.get_ai_config());
        if (aiCfg.base_url || aiCfg.api_key) {
          const messages = [
            {
              role: "system" as const,
              content: `Eres un evaluador riguroso de exámenes de matemáticas y programación. Evalúa la respuesta del alumno sin indulgencia. Devuelve ÚNICAMENTE un objeto JSON: {"score": <número 0..100>, "passed": <true si score >= 70, false si no>, "feedback": "<retroalimentación en español, concisa>"}.`,
            },
            {
              role: "user" as const,
              content: `Ejercicio: ${item.title}\nHabilidad: ${item.skill} (Dificultad: ${item.difficulty}/3)\nTema: ${item.topicTitle}\n\nEnunciado:\n${item.statement}\n\nRespuesta del alumno:\n${answerText}`,
            },
          ];
          try {
            const reply = await askStructured(aiCfg, messages);
            const match = reply.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              const score = typeof parsed.score === "number" ? parsed.score : 70;
              return {
                score,
                passed: Boolean(parsed.passed ?? score >= 70),
                feedback: String(parsed.feedback || "Evaluado por IA."),
              };
            }
          } catch {
            // fallback
          }
        }

        const hasSubstance = answerText.trim().length > 30;
        return {
          score: hasSubstance ? 75 : 40,
          passed: hasSubstance,
          feedback: hasSubstance
            ? "Respuesta registrada y calificada."
            : "Respuesta incompleta o insuficiente.",
        };
      };

      const { record, itemResults } = await gradeAndAggregateExam(
        session,
        submissions,
        grader,
        app.root,
      );

      clearStudySnapshotCache();

      return {
        ok: true,
        record,
        item_results: itemResults,
      };
    },

    /**
     * Draft the whole syllabus of a subject with the AI and lay it out on disk:
     * one folder per area (with its `.resumen.md` overview) and one folder per
     * topic. Existing folders and overviews are left untouched.
     */
    study_generate_syllabus: async (subject: string) => {
      const name = String(subject || "").trim();
      if (!name) throw new ApiError("Indica el nombre de la materia.");
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      if (cfg.is_bridge) {
        throw new ApiError("El proveedor de IA está en modo puente; no se puede generar automáticamente.");
      }

      const ask = (prompt: string): Promise<string> => askStructured(cfg, [{ role: "user", content: prompt }]);

      const areasResponse = await ask(
        `Eres un experto en diseño curricular. Dame las 8-12 áreas principales de «${name}» ` +
          `numeradas (ej: "1 Aritmética", "2 Álgebra"). Solo la lista, sin explicaciones.`,
      );
      const topicsResponse = await ask(
        `Dadas estas áreas de ${name}:\n${areasResponse}\n\n` +
          `Para cada área, da de 6 a 12 temas numerados (ej: "1.1 Números naturales"). ` +
          `Formato: AREA > temas. Sin explicaciones extra.`,
      );
      const structured = await ask(
        `Convierte este temario en JSON. Solo JSON, sin comentarios:\n${topicsResponse}\n\n` +
          `{"areas":[{"name":"1 Aritmética","folder":"1 Aritmética elemental y operativa",` +
          `"topics":[{"name":"1.1 Números naturales","folder":"1.1 Números naturales enteros y recta numérica"}]}]}`,
      );

      const match = structured.match(/\{[\s\S]*\}/);
      if (!match) throw new ApiError("La IA no pudo estructurar el temario.");
      let plan: { areas?: Array<{ name?: string; folder?: string; topics?: Array<{ name?: string; folder?: string }> }> };
      try {
        plan = JSON.parse(match[0]);
      } catch {
        throw new ApiError("La IA devolvió un temario con formato inválido.");
      }

      const subjectDir = path.join(app.root, name);
      fs.mkdirSync(subjectDir, { recursive: true });
      const created: string[] = [];
      const folders: string[] = [];

      for (const area of plan.areas ?? []) {
        const areaFolder = String(area.folder || area.name || "").trim().replace(/[\\/]+$/g, "");
        if (!areaFolder) continue;
        const areaDir = path.join(subjectDir, areaFolder);
        fs.mkdirSync(areaDir, { recursive: true });
        folders.push(app.rel(areaDir).replace(/\\/g, "/"));

        const overview = path.join(areaDir, viewFileName(areaFolder, "resumen"));
        if (!fs.existsSync(overview)) {
          const scope = `${name}/${areaFolder}`.replace(/\\/g, "/");
          fs.writeFileSync(overview, overviewFileText(String(area.name || areaFolder), name, scope), "utf-8");
          created.push(app.rel(overview).replace(/\\/g, "/"));
        }

        for (const topic of area.topics ?? []) {
          const topicFolder = String(topic.folder || topic.name || "").trim().replace(/[\\/]+$/g, "");
          if (!topicFolder) continue;
          const topicDir = path.join(areaDir, topicFolder);
          fs.mkdirSync(topicDir, { recursive: true });
          folders.push(app.rel(topicDir).replace(/\\/g, "/"));
        }
      }

      clearStudySnapshotCache();
      return { ok: true, created, folders, plan };
    },

    study_topic_dashboard: async function dashboard(subjectFilter?: string, refreshing?: boolean): Promise<any> {
      const cacheKey = `${app.root}::${subjectFilter ?? ""}`;
      const cachedDashboard = _dashboardCache.get(cacheKey) as
        | { data: { subjects: string[]; areas: string[]; topics: unknown[] }; timestamp: number }
        | undefined;
      if (cachedDashboard && !refreshing) {
        if (Date.now() - cachedDashboard.timestamp >= SNAPSHOT_CACHE_TTL_MS && !_dashboardRefreshing.has(cacheKey)) {
          // Only the TTL ran out (a write would have dropped the entry): opening the area
          // note must not pay the ~0.5 s vault walk on the main process. Answer with the
          // last payload now and rebuild it right after the reply is on its way.
          _dashboardRefreshing.add(cacheKey);
          setTimeout(() => {
            void dashboard(subjectFilter, true)
              .catch(() => undefined)
              .finally(() => _dashboardRefreshing.delete(cacheKey));
          }, 50);
        }
        return cachedDashboard.data;
      }
      // A cold process would block the renderer for as long as it takes to read
      // every note (measured: 30 s over 2 107 notes). Return a provisional empty
      // payload instead and let the startup warm — or this background scan — fill
      // the cache; the view retries until the real data arrives.
      if (!hasVaultScan(app.root) && !_indexWarmed) {
        if (!_scanKicked.has(app.root)) {
          _scanKicked.add(app.root);
          setImmediate(() => {
            try {
              vaultScan(app);
            } catch {
              /* the renderer's retry will surface any error */
            } finally {
              _scanKicked.delete(app.root);
            }
          });
        }
        return { subjects: [], areas: [], topics: [], loading: true };
      }
      const scan = vaultScan(app);
      const allExercises = scan.exercises;
      const attempts = loadAllAttempts(app.root);

      // The manifests come from the notes the scan already read: enumerating them by
      // name and type costs nothing, while the per-folder climb re-read every note of
      // the vault (measured on the real vault: 593 folders → 2 680 ms, for 42 topics).
      const foundMap = new Map<string, { folder: string; manifest: TopicManifest }>();
      for (const found of manifestsFromNotes(scan.notes)) {
        const title = found.manifest.title;
        if (foundMap.has(title)) continue;
        const folder = app.rel(found.topicFolder).replace(/\\/g, "/");
        foundMap.set(title, {
          folder,
          manifest: { ...found.manifest, path: app.rel(found.manifestPath), folder },
        });
      }

      const items: Array<{
        folder: string;
        area: string;
        subject: string;
        manifest: TopicManifest;
        progress: ReturnType<typeof computeTopicProgress>;
      }> = [];
      const subjectsSet = new Set<string>();
      const areasSet = new Set<string>();

      for (const { folder, manifest } of foundMap.values()) {
        if (subjectFilter && manifest.subject.toLowerCase() !== subjectFilter.toLowerCase()) {
          continue;
        }

        const normFolder = folder.replace(/\\/g, "/");
        const topicExercises = allExercises.filter((ex) => {
          const p = (ex.rel || ex.path).replace(/\\/g, "/");
          return p.startsWith(normFolder + "/");
        });

        const parentDir = path.dirname(normFolder);
        const areaName = parentDir && parentDir !== "." ? path.basename(parentDir) : manifest.exam_group || "General";

        const examRec = loadExamRecordForTopic(app.root, manifest);
        const progress = computeTopicProgress(
          manifest,
          topicExercises,
          attempts,
          examRec,
          0,
        );

        subjectsSet.add(manifest.subject);
        areasSet.add(areaName);

        items.push({
          folder,
          area: areaName,
          subject: manifest.subject,
          manifest,
          progress,
        });
      }

      items.sort((a, b) => a.area.localeCompare(b.area) || a.manifest.title.localeCompare(b.manifest.title));

      const payload = {
        subjects: Array.from(subjectsSet),
        areas: Array.from(areasSet),
        topics: items,
      };
      _dashboardCache.set(cacheKey, { data: payload, timestamp: Date.now() });
      return payload;
    },
  };
}
