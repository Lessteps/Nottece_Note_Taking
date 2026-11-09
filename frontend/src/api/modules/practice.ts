// Ported from notevault_app/webapp/modules/practice.py
// Práctica: exercise notes (frontmatter `type: exercise`) answered in the
// app and graded by an AI teacher (HTTP, a web chat through the clipboard, or
// a handoff file another agent answers).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AIConfig,
  AIError,
  BRIDGE_URLS,
  buildBridgePrompt,
  sendChat,
} from "../../core/aiClient.js";
import { runLanguageFor } from "../../core/codeDebugger.js";
import { ApiError } from "../../core/errors.js";
import { parseFrontmatter } from "../../core/frontmatter.js";
import { PracticeAttemptStore } from "../../core/practice/attempts.js";
import { disciplineFor, skillOf } from "../../core/practice/disciplineCatalog.js";
import { DRILL_KINDS, type DrillItem, check as checkDrill, generate as generateDrill, summarize as summarizeDrill } from "../../core/practice/drills.js";
import { applyResult, recentErrors } from "../../core/practice/errorLog.js";
import {
  type ExerciseNote,
  isPracticeFrontmatter,
  parseExercise,
} from "../../core/practice/exerciseNote.js";
import {
  GradeParseError,
  type GradeResult,
  buildGradingMessages,
  parseGradeReply,
} from "../../core/practice/grading.js";
import {
  closeRequest,
  pendingForNote,
  readRequest,
  readResponse,
  responsePath,
  writeRequest,
} from "../../core/practice/handoff.js";
import { MODES, modeFor } from "../../core/practice/modes.js";
import { attemptPassed } from "../../core/practice/ledger.js";
import { recordTopicPractice } from "../../core/practice/reviewFiles.js";
import { EnglishVocabularyManager } from "../../core/englishVocabularyManager.js";
import { isEnglishSubject } from "../../core/practice/domain.js";
import { isoDate } from "../../core/practice/reviewSchedule.js";
import { isVocabularySkill } from "../../lib/englishSkillData.js";
import { gradeDictation } from "../../core/english/dictationGrade.js";
import { gradeProjectStructure } from "../../core/practice/projectStructureGrade.js";
import { recordLearning } from "../../core/practice/learningLog.js";
import { findAncestorTopicManifest } from "../../core/practice/topic.js";
import { parseTimer } from "../../core/practice/timer.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { clampInt } from "../common.js";
import { clearStudySnapshotCache } from "./study.js";

export const MAX_ANSWER = 60_000;
const _REQ_RE = /^req_\d{14}_[0-9a-f]{6}$/;
const DRILL_TTL = 3 * 3600 * 1000; // 3 hours in ms

interface DrillSession {
  at: number;
  rel: string;
  items: DrillItem[];
  results: Array<[DrillItem, string, boolean, number]>;
}

const _drillSessions = new Map<string, DrillSession>();

function getDrillSessions(): Map<string, DrillSession> {
  const now = Date.now();
  for (const [k, v] of _drillSessions.entries()) {
    if (now - v.at > DRILL_TTL) {
      _drillSessions.delete(k);
    }
  }
  return _drillSessions;
}

function resultDict(r: GradeResult): Record<string, unknown> {
  return {
    score: r.score,
    verdict: r.verdict,
    rubric: [...r.rubric],
    errors: r.errors.map((e) => ({
      category: e.category,
      anchor: e.anchor,
      description: e.description,
      evidence: e.evidence,
      fix: e.fix,
    })),
    feedback: r.feedback,
    next_step: r.next_step,
    example: r.example,
  };
}

function historyList(attempts: any[]): Array<Record<string, unknown>> {
  return (attempts || []).slice(-30).map((a) => ({
    at: a.at || "",
    score: parseInt(String(a.score || 0), 10) || 0,
    verdict: a.verdict || "",
    quality: a.quality ?? null,
    seconds: a.seconds || 0,
    transport: a.transport || "",
  }));
}

function getExercise(app: AppState, rel: string): [string, ExerciseNote] {
  const p = app.resolve(rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    throw new ApiError("No es una nota.");
  }
  if (!stat.isFile() || path.extname(p).toLowerCase() !== ".md") {
    throw new ApiError("No es una nota.");
  }
  const text = fs.readFileSync(p, "utf-8");
  const [fm] = parseFrontmatter(text);
  if (!isPracticeFrontmatter(fm)) {
    throw new ApiError("Esta nota no es un ejercicio (type: exercise).");
  }
  try {
    return [p, parseExercise(text, p)];
  } catch (e: any) {
    throw new ApiError(`No se pudo leer el ejercicio: ${e.message || e}`);
  }
}

function practiceMessages(
  root: string,
  ex: ExerciseNote,
  answer: string,
  hints: number,
  seconds: number,
  seen: boolean,
) {
  let recent: any[] = [];
  try {
    recent = recentErrors(root, ex.subject);
  } catch {
    recent = [];
  }
  return buildGradingMessages(ex, answer, {
    hints_used: hints,
    seconds,
    solution_seen: seen,
    recent_errors: recent,
  });
}

function practiceApply(
  app: AppState,
  p: string,
  ex: ExerciseNote,
  result: GradeResult,
  transport: string,
  answer: string,
  hints: number,
  seconds: number,
  seen: boolean,
): Record<string, unknown> {
  const attempt = applyResult(app.root, ex, app.rel(p), {
    answer,
    hints_used: hints,
    seconds,
    solution_seen: seen,
    transport,
    result,
  });
  clearStudySnapshotCache();
  // The topic's review note follows every graded attempt, whatever the skill.
  try {
    recordTopicPractice(app.root, p, { skill: String(ex.mode || ""), passed: attemptPassed(attempt as Record<string, any>) });
  } catch {
    /* a review note that cannot be written must never break grading */
  }
  // English vocabulary: the words the exercise was built around follow the grade in their own reviews.
  try {
    const wordIds = Array.isArray(ex.frontmatter.words) ? ex.frontmatter.words.map((w: unknown) => String(w)) : [];
    if (wordIds.length && isEnglishSubject(ex.subject) && isVocabularySkill(ex.mode)) {
      const bank = new EnglishVocabularyManager(app.root);
      const passed = attemptPassed(attempt as Record<string, any>);
      const today = isoDate(new Date());
      for (const id of wordIds) bank.recordReview(id, passed, today);
    }
  } catch {
    /* the word bank never breaks grading */
  }
  // The mistakes of this attempt go to the competency's learning record, when its box is on.
  try {
    const found = findAncestorTopicManifest(p, app.root);
    if (found) {
      const at = new Date().toISOString();
      const base = { at, exercise: ex.note_id, title: ex.title, score: result.score };
      const entries = result.errors.length
        ? result.errors.map((e) => ({ ...base, category: e.category, description: e.description, evidence: e.evidence || answer, fix: e.fix }))
        : result.score < 60
          ? [{ ...base, category: "other", description: result.feedback, evidence: answer, fix: result.next_step }]
          : [];
      recordLearning(app.root, app.rel(found.topicFolder).replace(/\\/g, "/"), String(ex.mode || ""), entries);
    }
  } catch {
    /* the learning record never breaks grading */
  }
  const history = historyList(new PracticeAttemptStore(app.root).attempts(ex.note_id));
  return {
    graded: true,
    result: resultDict(result),
    quality: attempt.quality ?? null,
    history,
  };
}

function practiceRequest(
  app: AppState,
  p: string,
  ex: ExerciseNote,
  messages: Array<Record<string, any>>,
  answer: string,
  hints: number,
  seconds: number,
  seen: boolean,
): string {
  for (const old of pendingForNote(app.root, ex.note_id)) {
    closeRequest(app.root, old.id);
  }
  const meta = {
    note_id: ex.note_id,
    note_path: app.rel(p),
    subject: ex.subject,
    mode: ex.mode,
    answer,
    hints_used: hints,
    seconds,
    solution_seen: seen,
  };
  return writeRequest(app.root, "grade", messages, meta);
}

export function practiceApi(app: AppState) {
  const aiCfg = (): AIConfig => AIConfig.fromDict(AppConfig.get_ai_config());

  return {
    practice_load(rel: string) {
      const [p, ex] = getExercise(app, rel);
      const mode = MODES[ex.mode] || modeFor(ex.frontmatter);
      const disc = disciplineFor(ex.frontmatter);
      const skill = disc && ex.skill ? skillOf(disc, ex.skill) : null;
      const spec = parseTimer(ex.timer, ex.minutes, mode.timer);
      const store = new PracticeAttemptStore(app.root);
      const data = store.load(ex.note_id);
      let pending: Record<string, unknown> | null = null;
      const reqs = pendingForNote(app.root, ex.note_id);
      if (reqs.length > 0) {
        const r = reqs[reqs.length - 1]!;
        pending = {
          id: String(r.id),
          answer: String(r.answer || ""),
          hints_used: clampInt(r.hints_used, 0, 50, 0),
          seconds: clampInt(r.seconds, 0, 10 ** 7, 0),
          solution_seen: Boolean(r.solution_seen),
        };
      }
      return {
        path: app.rel(p),
        note_id: ex.note_id,
        title: ex.title,
        subject: ex.subject,
        discipline: disc.title,
        skill: skill ? `${ex.skill} ${skill.title}` : "",
        mode: { id: mode.id, label: mode.label, answer_kind: mode.answer_kind },
        difficulty: ex.difficulty,
        level: ex.level,
        assistance: ex.assistance,
        timer: {
          kind: spec.kind,
          seconds: spec.seconds,
          break_seconds: spec.break_seconds,
        },
        statement: ex.statement,
        audio_text: ex.audio_text,
        media: ex.frontmatter.media || ex.frontmatter.source
          ? { file: String(ex.frontmatter.media ?? ""), source: String(ex.frontmatter.source ?? ""), start: Number(ex.frontmatter.media_start) || 0, end: Number(ex.frontmatter.media_end) || 0 }
          : null,
        code: ex.code,
        code_lang: ex.code_lang,
        run_language: runLanguageFor(ex.subject, disc?.id ?? "", ex.code_lang),
        hints: ex.hints,
        has_solution: Boolean(ex.solution.trim()),
        rubric: ex.rubric,
        drill:
          mode.answer_kind === "drill"
            ? {
                kind: ex.drill && ex.drill in DRILL_KINDS ? ex.drill : "arithmetic",
                label: DRILL_KINDS[ex.drill] || "Aritmética",
                items: ex.items,
              }
            : null,
        draft: data.draft,
        history: historyList(data.attempts),
        pending,
      };
    },

    practice_solution(rel: string) {
      const [, ex] = getExercise(app, rel);
      return { solution: ex.solution };
    },

    practice_save_draft(rel: string, text: string) {
      const [p, ex] = getExercise(app, rel);
      new PracticeAttemptStore(app.root).saveDraft(
        ex.note_id,
        app.rel(p),
        String(text || "").slice(0, MAX_ANSWER),
      );
      return { ok: true };
    },

    async practice_grade(
      rel: string,
      answer: string,
      hints_used = 0,
      seconds = 0,
      solution_seen = false,
      via = "",
    ) {
      const ans = String(answer || "").trim().slice(0, MAX_ANSWER);
      if (!ans) {
        throw new ApiError("Escribe una respuesta antes de entregarla.");
      }
      const hints = clampInt(hints_used, 0, 50, 0);
      const secs = clampInt(seconds, 0, 10 ** 7, 0);
      const seen = Boolean(solution_seen);

      const [p, ex] = getExercise(app, rel);
      new PracticeAttemptStore(app.root).saveDraft(ex.note_id, app.rel(p), ans);
      // A dictation is graded by comparing it with its transcript: exact, instant, offline and with no AI at all.
      if (isEnglishSubject(ex.subject) && ex.mode === "ls_dictation" && (ex.audio_text || "").trim()) {
        return practiceApply(app, p, ex, gradeDictation(ex.audio_text!, ans, ex.rubric.length), "local", ans, hints, secs, seen);
      }
      // Project structure and terminal command labs are graded deterministically from their solution and rubric:
      // exact, instant, offline and with no AI at all.
      if (ex.mode === "project_structure" || (ex.subject === "programming" && ex.mode === "commands")) {
        return practiceApply(app, p, ex, gradeProjectStructure(ex, ans), "local", ans, hints, secs, seen);
      }
      const messages = practiceMessages(app.root, ex, ans, hints, secs, seen);
      const cfg = aiCfg();

      if (via === "handoff" || cfg.is_bridge) {
        const req = practiceRequest(app, p, ex, messages, ans, hints, secs, seen);
        const respPath = responsePath(app.root, req).replace(/\\/g, "/");
        const reqRel = `.notevault/estudio/handoff/requests/${req}.md`;
        const reqAbs = path.join(app.root, reqRel).replace(/\\/g, "/");
        const out: Record<string, unknown> = {
          graded: false,
          request: req,
          request_file: reqRel,
          response_file: respPath,
          request_path: reqAbs,
        };
        if (via !== "handoff") {
          out.bridge = true;
          out.prompt = buildBridgePrompt(messages as any);
          out.url = BRIDGE_URLS[cfg.provider] || "";
          out.label = cfg.info.label;
        }
        return out;
      }

      let reply: string;
      try {
        reply = await sendChat(cfg, messages as any);
      } catch (e: any) {
        throw new ApiError(
          `No se pudo corregir: ${e instanceof AIError ? e.message : e.message || e}`,
        );
      }

      const [p2, ex2] = getExercise(app, rel);
      let result: GradeResult;
      try {
        result = parseGradeReply(reply, ex2.rubric.length);
      } catch (e: any) {
        throw new ApiError(e instanceof GradeParseError ? e.message : String(e));
      }
      return practiceApply(app, p2, ex2, result, "http", ans, hints, secs, seen);
    },

    practice_reply(rel: string, request: string, text = "") {
      const reqId = String(request || "");
      if (!_REQ_RE.test(reqId)) {
        throw new ApiError("Solicitud inválida.");
      }
      const [p, ex] = getExercise(app, rel);
      const req = readRequest(app.root, reqId);
      if (!req || req.note_id !== ex.note_id) {
        throw new ApiError("Esa solicitud ya no está pendiente.");
      }
      const transport = text ? "bridge" : "handoff";
      const reply = String(text || "") || readResponse(app.root, reqId);
      if (!reply) {
        return { graded: false, waiting: true };
      }
      let result: GradeResult;
      try {
        result = parseGradeReply(reply, ex.rubric.length);
      } catch (e: any) {
        throw new ApiError(e instanceof GradeParseError ? e.message : String(e));
      }
      closeRequest(app.root, reqId);
      return practiceApply(
        app,
        p,
        ex,
        result,
        transport,
        String(req.answer || ""),
        clampInt(req.hints_used, 0, 50, 0),
        clampInt(req.seconds, 0, 10 ** 7, 0),
        Boolean(req.solution_seen),
      );
    },

    practice_discard(rel: string, request: string) {
      const reqId = String(request || "");
      if (!_REQ_RE.test(reqId)) {
        throw new ApiError("Solicitud inválida.");
      }
      const [, ex] = getExercise(app, rel);
      const req = readRequest(app.root, reqId);
      if (req && req.note_id === ex.note_id) {
        closeRequest(app.root, reqId);
      }
      return { ok: true };
    },

    practice_give_up(rel: string, seconds = 0, hints_used = 0) {
      const [p, ex] = getExercise(app, rel);
      const result: GradeResult = {
        score: 0,
        verdict: "incorrect",
        rubric: new Array(ex.rubric.length).fill(false),
        errors: [],
        feedback: "Viste la solución sin entregar una respuesta.",
        next_step:
          "Estudia la solución y vuelve a escribirla de memoria mañana, sin mirarla.",
        example: "",
        raw: "",
      };
      const out = practiceApply(
        app,
        p,
        ex,
        result,
        "local",
        "",
        clampInt(hints_used, 0, 50, 0),
        clampInt(seconds, 0, 10 ** 7, 0),
        true,
      );
      out.solution = ex.solution;
      return out;
    },

    practice_drill_start(rel: string) {
      const [p, ex] = getExercise(app, rel);
      const kind = ex.drill && ex.drill in DRILL_KINDS ? ex.drill : "arithmetic";
      const items = generateDrill(kind, Math.min(ex.items, 200), ex.difficulty);
      const sid = crypto.randomBytes(8).toString("hex");
      getDrillSessions().set(sid, {
        at: Date.now(),
        rel: app.rel(p),
        items,
        results: [],
      });
      return { session: sid, prompts: items.map((i) => i.prompt) };
    },

    practice_drill_check(session: string, index: number, given: string, seconds = 0) {
      const s = getDrillSessions().get(String(session));
      if (!s) {
        throw new ApiError("La sesión de cálculo terminó.");
      }
      const i = clampInt(index, 0, 10 ** 6, 0);
      if (i !== s.results.length || i >= s.items.length) {
        throw new ApiError("Respuesta fuera de orden.");
      }
      const item = s.items[i]!;
      const text = String(given || "").slice(0, 200);
      const ok = checkDrill(item, text);
      const secs = Math.max(0, Math.min(3600, Number(seconds) || 0));
      s.results.push([item, text, ok, secs]);
      return { ok, answer: item.answer };
    },

    practice_drill_finish(session: string, seconds = 0) {
      const s = getDrillSessions().get(String(session));
      if (!s) {
        throw new ApiError("La sesión de cálculo terminó.");
      }
      getDrillSessions().delete(String(session));
      const remaining: Array<[DrillItem, string, boolean, number]> = s.items
        .slice(s.results.length)
        .map((item) => [item, "", false, 0.0]);
      const results = [...s.results, ...remaining];
      const result = summarizeDrill(results);
      const transcript = results
        .map(
          ([item, given, ok]) =>
            `${item.prompt} = ${given || "—"}  ${ok ? "✓" : "✗ (" + item.answer + ")"}`,
        )
        .join("\n");
      const [p, ex] = getExercise(app, s.rel);
      return practiceApply(
        app,
        p,
        ex,
        result,
        "local",
        transcript,
        0,
        clampInt(seconds, 0, 10 ** 7, 0),
        false,
      );
    },
  };
}
