// Mentor: informe del estudiante, candidatos de estudio y registro de sesiones.
//
// Todo el cálculo vive en core/mentor (puro y testeado); aquí solo se arma el
// contexto con los managers de la vault y se validan las entradas de la UI. La IA
// (fase siguiente) consume `mentor_brief().text`: nunca lee notas completas.

import * as fs from "node:fs";
import * as path from "node:path";
import * as store from "../../core/store.js";
import { AIConfig, sendChat, type ChatMessage, type SendOpts } from "../../core/aiClient.js";
import { CORE_GROUP_ID, evaluateAreaMethodology, FRONTEND_SUBJECT_GROUPS, frontendGroupForFolder } from "../../lib/planAreas.js";
import { ApiError } from "../../core/errors.js";
import { examSlug, listExamRecords } from "../../core/practice/exams.js";
import { loadAllAttempts } from "../../core/practice/ledger.js";
import { cachedTopicSnaps, clearTopicSnapCache } from "./topicSnapCache.js";
import { outdatedByFolder } from "./skillFreshness.js";
import { hubSnapshot } from "../../core/practice/recommender.js";
import { manifestsFromNotes, type TopicManifest } from "../../core/practice/topic.js";
import { FILTER_ACTIVE, ITEM_DONE } from "../../core/goalManager.js";
import { allocate, buildCandidates } from "../../core/mentor/candidates.js";
import { buildPracticeTrack, practiceDayMinutes, practiceItemsFor, sanitizePracticeTrack, suggestionsOf, type PracticeItem } from "../../lib/practiceTrack.js";
import { derivePracticeStatus, kataDates, manualPracticeOf, phasesDone, ppAreaDir, readPpProjects, type PracticeStatus } from "../../core/mentor/practiceState.js";
import { loadProfile, suggestFocus } from "../../core/ppractice/profile.js";
import { objectiveText, resolveObjective, sanitizeObjective, subjectLabel } from "../../core/mentor/objective.js";
import {
  canonicalTopicId,
  checkPlanVaultSync,
  reconcilePlanWithVault,
  resolveAndEnsureTopicAssets,
} from "../../core/mentor/topicIdResolver.js";
import {
  buildPlan,
  DELIVERABLE_STATUSES,
  deriveView,
  mergePlans,
  MONTH_RE,
  PLAN_ID_RE,
  PlanStore,
  planItemsFor,
  planName,
  planStatus,
  refreshPlanProgress,
  topicState,
  withTopicProjects,
  type DeliverableStatus,
  type Plan,
  type PlanItem,
  type SubplanSeed,
  type TopicLiteLookup,
} from "../../core/mentor/plan.js";
import { branchAllowed, branchOfFolder, classifyBranch, detectBranchIntent, periodLabel, sanitizeNotes, weekRangesOf } from "../../lib/planTime.js";
import { resolveLanguages } from "../../lib/planLanguages.js";
import { isLive, routeOf, routeOfPlan, sanitizeRouteFields, validateSkips, type RouteEntry } from "../../lib/planRoute.js";
import type { MasteryLookup } from "../../lib/planTopicProject.js";
import {
  BUILD_ID_RE,
  computeBuild,
  emptyAi,
  isBuildStage,
  makeAnswer,
  MAX_BUILD_QUESTIONS,
  newBuildId,
  PlanBuildStore,
  stageIndex,
  summaryOf,
  type AnswerInput,
  type BuildAiState,
  type BuildCtx,
  type BuildStage,
  type PlanBuild,
} from "../../core/mentor/planBuild.js";
import {
  applyOps,
  ChangeStore,
  changeMessages,
  deltaText,
  MAX_COMMENT_CHARS,
  opsFromText,
  parseChangeReply,
  viewOf,
  type ChangeEntry,
  type ChangeOp,
} from "../../core/mentor/planChange.js";
import { generateByParts, PipelineCancel } from "../../core/mentor/planPipeline.js";
import { canReorganize, reorganizeByAreas } from "../../core/mentor/planReorganize.js";
import { PLAN_DELIVERABLE_STATUSES, resolveAreaMode, sanitizeGroups, type AreaGroup } from "../../lib/planAreas.js";
import { buildSchedule, deliverablesOf, progressPlan } from "../../lib/planSchedule.js";
import { basesClassifier } from "../../lib/planTopicsByArea.js";
import { CurriculumCancel, generateCurriculum } from "../../core/mentor/planCurriculumAi.js";
import { areaKeyOf, computeCoverage, COVERAGE_DISCLAIMER, MAX_PROFILE_CHARS, parseCoverageReply, sanitizeCriteria } from "../../lib/planCoverage.js";
import { buildPlanTopicRows } from "../../lib/planTopicCatalog.js";
import { EXTRA_PRACTICE_KINDS, isIsoDate, parsePace, type ExtraPractice, type ExtraPracticeKind } from "../../lib/planPace.js";
import { coverageMessages } from "../../core/mentor/planCoverageAi.js";
import { parseScopeReply, parseTopicsReply, scopeMessages, topicsMessages } from "../../core/mentor/planBuildAi.js";
import {
  areaOfFolder,
  adjustedMinutes,
  autoSeeds,
  defaultDeliverableFor,
  buildPlanMessages,
  composeFromPreconditions,
  dynamicCatalogMax,
  resolveBranches,
  markDiagnostics,
  parsePreconditionReply,
  planCatalog,
  preconditionsProblem,
  resolveScope,
  sanitizePreconditions,
  scopeTopics,
  seedsFromReply,
  preconditionsRequest,
  type GoalScope,
  type PlanPreconditions,
} from "../../core/mentor/planSpec.js";
import {
  buildChatMessages,
  composePlanDraft,
  parseChatResponse,
  planDraftSummary,
  planWindow,
  type PlanContext,
  type PlanDraft,
} from "../../core/mentor/planDraft.js";
import { buildStudentBrief, toPromptText, type BriefContext, type QueueHint } from "../../core/mentor/brief.js";
import { adherence, BLOCK_STATUSES, sanitizeSession, SessionLog, type BlockStatus } from "../../core/mentor/sessionLog.js";
import { aiUnavailableReason, planToBlocks, proposePlan, type ProposedBlock, type SendFn } from "../../core/mentor/planner.js";
import { snapshotTopics, type TopicSnap } from "../../core/mentor/topics.js";
import { ChatStore, pendingDraft, type ChatLog, type ChatTurnRecord } from "../../core/mentor/chatLog.js";
import {
  buildTopicCatalog,
  composeDraft,
  estimateTopicMinutes,
  fold,
  scheduleGoal,
  type ChatTurn,
} from "../../core/mentor/goalDraft.js";
import { studyAreas, topicsPanel } from "../../core/mentor/panels.js";
import { sectionData, type StudyPendingData, type TasksData, type TopicsData } from "../../core/mentor/brief.js";
import { StudyErrorManager } from "../../core/studyErrorManager.js";
import { StudySRSManager } from "../../core/studySrsManager.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { clampInt } from "../common.js";
import { registerScanInvalidation, vaultScan } from "../vaultScan.js";
import { parseTopicLink } from "../../core/practice/topicLinks.js";
import { goalsApi } from "./goals.js";
import { mentorAskApi } from "./mentorAsk.js";
import { mentorCoverageApi } from "./mentorCoverage.js";
import { designsOf } from "./mentorDesign.js";
import { mentorExecuteApi } from "./mentorExecute.js";
import { mentorTimeLogApi } from "./mentorTimeLog.js";
import { mentorRecordsApi } from "./mentorRecords.js";
import { dailyProjectDoneOf, mentorProjectsApi } from "./mentorProjects.js";
import { mentorAreaPracticeApi } from "./mentorAreaPractice.js";
import { mentorPlanFoldersApi } from "./mentorPlanFolders.js";
import { mentorAreaTimesApi } from "./mentorAreaTimes.js";
import { mentorProjectLinksApi } from "./mentorProjectLinks.js";
import { mentorPlanDossierApi } from "./mentorPlanDossier.js";
import { buildExternalPlanDoc, externalPlanChatPrompt, externalPlanShortPrompt } from "../../lib/planExternal.js";
import { mentorPlanDepthApi } from "./mentorPlanDepth.js";
import { masterSyllabusApi, writeMasterSyllabus } from "./masterSyllabus.js";
import { mentorDayCloseApi } from "./mentorDayClose.js";
import { DayCloseStore } from "../../core/mentor/dayClose.js";
import { projectsApi } from "./projects.js";
import { studyIndexCold } from "./study.js";
import { curriculumAreas } from "../../core/curriculum/catalog.js";
import { areaFolderOf, regroupByUnits } from "../../core/mentor/planRegroup.js";
import { planHealth, type HealthIssue } from "../../lib/planHealth.js";
import { addTopicsToPlan, CURRICULUM_PLAN_TARGET, curriculumAreaOfFolder, findAreaSubplan, knowledgeTargetOfFolder, siblingPlacement, type AddTopicItem } from "../../core/mentor/planAddTopics.js";

const DEFAULT_BRIEF_CHARS = 6000;

/** Cancelación de una llamada larga de IA: `abort` = no hacer nada; `auto` = seguir con el plan automático (sin IA). */
class CancelError extends Error {
  constructor(readonly mode: "abort" | "auto") {
    super(mode === "auto" ? "Seguir sin IA." : "Cancelado por ti.");
  }
}
interface Job {
  key: string;
  label: string;
  since: number;
  waiters: Set<(e: Error) => void>;
  cancelled?: "abort" | "auto";
  /** al cancelar se aborta: las llamadas en vuelo MATAN su petición o su proceso de Claude Code */
  controller: AbortController;
}
const JOBS = new WeakMap<AppState, Map<string, Job>>();
function jobsOf(app: AppState): Map<string, Job> {
  let m = JOBS.get(app);
  if (!m) JOBS.set(app, (m = new Map()));
  return m;
}

/** Operaciones en vuelo del constructor guiado por vault (un plan en construcción hace una cosa a la vez). */
const INFLIGHT = new WeakMap<AppState, Map<string, { key: string; p: Promise<unknown> }>>();
function inflightOf(app: AppState): Map<string, { key: string; p: Promise<unknown> }> {
  let m = INFLIGHT.get(app);
  if (!m) INFLIGHT.set(app, (m = new Map()));
  return m;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function needDate(value: unknown): string {
  const d = String(value ?? "");
  if (!DATE_RE.test(d)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
  return d;
}

export function clearTopicSnapsCache(): void {
  clearTopicSnapCache();
}
registerScanInvalidation(clearTopicSnapsCache);

/**
 * Foto de todos los temas de la vault (misma fuente que `study_topic_dashboard`). Se reutiliza mientras no cambien el escaneo de la vault ni los
 * intentos y exámenes en disco (ver `topicSnapCache.ts`): el Mentor la pide en cada cambio de vista.
 */
function topicSnaps(app: AppState): TopicSnap[] {
  const scan = vaultScan(app);
  return cachedTopicSnaps(app.root, scan, () => buildTopicSnaps(app, scan)).slice();
}

function buildTopicSnaps(app: AppState, scan: ReturnType<typeof vaultScan>): TopicSnap[] {
  const byFolder = new Map<string, { folder: string; manifest: TopicManifest }>();
  for (const found of manifestsFromNotes(scan.notes)) {
    const folder = app.rel(found.topicFolder).replace(/\\/g, "/");
    if (!byFolder.has(folder)) {
      byFolder.set(folder, { folder, manifest: { ...found.manifest, path: app.rel(found.manifestPath), folder } });
    }
  }
  const examMap = new Map<string, any>();
  for (const rec of listExamRecords(app.root)) {
    examMap.set(examSlug(rec.topic_or_group), rec);
  }
  const examFor = (manifest: TopicManifest) => {
    const byTitle = examMap.get(examSlug(manifest.title));
    if (byTitle?.passed) return byTitle;
    if (manifest.exam_group) {
      const byGroup = examMap.get(examSlug(manifest.exam_group));
      if (byGroup?.passed) return byGroup;
      if (byGroup && !byTitle) return byGroup;
    }
    return byTitle ?? null;
  };
  const snaps = snapshotTopics({
    manifests: [...byFolder.values()],
    exercises: scan.exercises,
    attempts: loadAllAttempts(app.root),
    noteRels: scan.notes.map((n) => n.rel),
    examFor,
  });
  return snaps;
}

/** Lo MEDIDO de cada tema (progreso e intentos reales de la vault): calibra los proyectos de tema y «Reducir a lo esencial». */
function masteryLookup(app: AppState): MasteryLookup {
  const snaps = new Map(topicSnaps(app).map((t) => [t.folder, t] as const));
  return (folder) => {
    const s = snaps.get(folder);
    return s ? { pct: s.progress.completenessPct, attempts: s.attemptCount } : undefined;
  };
}

/** Cola del recomendador (la misma del hub de Estudio), resumida; vacía si falla. */
function studyQueue(app: AppState): QueueHint[] {
  try {
    const snap = hubSnapshot(app.root, app.vault.notePaths(), null, null);
    return snap.queue.items.slice(0, 8).map((q) => ({
      kind: q.kind,
      subject: q.subject,
      title: q.title,
      reason: q.reason,
      ...(q.exercise?.rel ? { exercise: q.exercise.rel } : {}),
    }));
  } catch {
    return [];
  }
}

export function briefContext(app: AppState, log: SessionLog): BriefContext {
  const m = app.mgrs();
  const now = new Date();
  return {
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    goals: m.goals,
    tasks: m.tasks,
    projects: m.projects,
    srs: new StudySRSManager(app.root),
    errors: new StudyErrorManager(app.root),
    topics: () => topicSnaps(app),
    sessions: () => log.recent(14),
    queue: () => studyQueue(app),
    memory: () => new DayCloseStore(app.root).memory(),
  };
}

const localDate = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Historial para la IA: los borradores se resumen en JSON compacto para que sepa qué propuso. */
function toHistory(turns: readonly ChatTurnRecord[]): ChatTurn[] {
  return turns.slice(-20).map((t) => ({
    role: t.role,
    content: t.planDraft
      ? planDraftSummary(t.planDraft)
      : t.draft
      ? JSON.stringify({
          type: "goal_draft",
          name: t.draft.name,
          hoursPerWeek: t.draft.schedule.hoursPerWeek,
          durationWeeks: Math.round((Date.parse(t.draft.schedule.end) - Date.parse(t.draft.schedule.start)) / (7 * 86400000)),
          topics: t.draft.topics.map((x) => ({ folder: x.folder, skills: x.skills, why: x.why })),
        })
      : t.content,
  }));
}

/** Metas y proyectos reales que la IA puede referenciar en un plan del mes. */
/** El alcance de un plan a partir de las precondiciones (el mismo cálculo que «Generar plan»): ramas, temas elegidos y catálogo real. */
function externalPlanScope(app: AppState, pre0: PlanPreconditions, today: string) {
  const all = buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 });
  const goals = goalScopes(app);
  const pre = resolveBranches(pre0, all, goals.filter((g) => pre0.goalIds.includes(g.id)).map((g) => g.name));
  const scope = resolveScope(pre, all, goals);
  const catalog = planCatalog(scope, dynamicCatalogMax(pre, scope, today), `${pre.freeObjective ?? ""} ${pre.notes ?? ""}`);
  if (!catalog.length) throw new ApiError("No hay temas pendientes en lo que elegiste. Elige metas con temas enlazados o materias con temas sin completar.");
  return { pre, scope, catalog, goals };
}

/** La carpeta de primer nivel donde viven la mayoría de los temas (ahí va `_handoff`). */
function mostCommonSpace(folders: readonly string[]): string {
  const count = new Map<string, number>();
  for (const f of folders) {
    const top = f.split("/")[0] ?? "";
    if (top) count.set(top, (count.get(top) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Programación";
}

function planContext(app: AppState, today: string): PlanContext {
  const m = app.mgrs();
  return {
    month: today.slice(0, 7),
    today,
    goals: m.goals.goals(FILTER_ACTIVE).map((g) => ({
      id: g.id,
      name: g.name,
      items: m.goals.items(g.id).filter((i) => i.is_leaf && i.status !== ITEM_DONE).map((i) => ({ id: i.id, name: i.name })),
    })),
    projects: m.projects.projects().filter((p) => p.status === "En curso" || p.status === "Planeado").map((p) => ({ id: p.id, name: p.name })),
  };
}

/** Lo que el plan del mes dice que toca hoy (solo lee el plan). */
function todaysPlanItems(app: AppState, day: string = localDate()): PlanItem[] {
  return planItemsFor(day, new PlanStore(app.root).list(), undefined, day === localDate());
}

/** Estado derivado de la práctica de un plan (módulo `programming_practice` + registro manual de «Hoy»). */
function practiceStatusOf(app: AppState, plan: Plan, today: string, log: SessionLog, shared?: { projects: ReturnType<typeof readPpProjects>; kata: Set<string> }): PracticeStatus | null {
  if (!plan.programmingPractice) return null;
  const projects = shared?.projects ?? readPpProjects(app.root);
  const kata = shared?.kata ?? kataDates(loadAllAttempts(app.root));
  return derivePracticeStatus({ plan, today, projects, kataDates: kata, manual: manualPracticeOf(plan.id, log.recent(60)), ppReady: !!ppAreaDir(app.root) });
}

/** Lo que la pista Programming practice de los planes activos pide hoy (kata del día y sesión del proyecto semanal). */
function todaysPracticeItems(app: AppState, day: string = localDate()): PracticeItem[] {
  const plans = new PlanStore(app.root).list().filter((p) => p.programmingPractice && planStatus(p, day) === "activo");
  if (!plans.length) return [];
  const sl = new SessionLog(app.root);
  const shared = { projects: readPpProjects(app.root), kata: kataDates(loadAllAttempts(app.root)) };
  const status = new Map(plans.map((p) => [p.id, practiceStatusOf(app, p, day, sl, shared)]));
  return practiceItemsFor(
    day,
    plans,
    {
      kata: (id, d) => !!status.get(id)?.kata && d === day && status.get(id)!.kata!.todayDone,
      project: (id, week, phases) => phasesDone(status.get(id) ?? null, week, phases),
    },
    (p) => planName(p as Plan),
  );
}

/**
 * Responde la pregunta de entregables sobre una lista de subplanes. Sin `subplanId` es la pregunta GLOBAL del plan por áreas:
 * «yes» añade el proyecto propio de cada área que aún no lo tiene (y retira también las preguntas por subplan antiguas) y «no» descarta
 * la pregunta. Con `subplanId` es la de ese subplan (planes antiguos). Los entregables repetidos se evitan: cada área propone el suyo.
 */
function answerDeliverables<T extends { id: string; area: string; objective: string; areaId?: string; goalId?: string; deliverable?: { title: string; description: string; criteria: string[]; status: DeliverableStatus; projectId?: string } }>(
  subplans: readonly T[],
  open: ReadonlyArray<{ id: string; subplanId?: string; text: string; options: string[] }> | undefined,
  subplanId: string,
  answer: "yes" | "no",
): { subplans: T[]; openQuestions: Array<{ id: string; subplanId?: string; text: string; options: string[] }> } {
  const targets = subplanId ? subplans.filter((s) => s.id === subplanId) : subplans;
  const next = subplans.map((s) => {
    if (answer !== "yes" || !targets.includes(s) || s.deliverable) return s;
    const d = defaultDeliverableFor(s);
    return { ...s, deliverable: { title: d.title, description: d.description ?? "", criteria: d.criteria ?? [], status: "idea" as const } };
  });
  let rest = (open ?? []).filter((q) => (subplanId ? !(q.id === "deliverables" && q.subplanId === subplanId) : q.id !== "deliverables"));
  // si ya no queda ningún área sin proyecto, la pregunta global está respondida
  if (next.every((s) => !!s.deliverable)) rest = rest.filter((q) => q.id !== "deliverables");
  return { subplans: next, openQuestions: [...rest] };
}

/** Planes que contienen el día `day` (varios pueden estar activos a la vez). */
const activePlans = (plans: readonly Plan[], day: string): Plan[] => plans.filter((p) => planStatus(p, day) === "activo");

const planRow = (p: Plan, today: string, lookup?: TopicLiteLookup) => {
  const topics = p.subplans.reduce((n, s) => n + s.topics.length, 0);
  const view = lookup ? deriveView(p, lookup, today) : null;
  const completed = view ? view.summary.done : p.subplans.reduce((n, s) => n + s.topics.filter((t) => t.completedAt).length, 0);
  return {
    id: p.id,
    start: p.start,
    end: p.end,
    ...(p.month ? { month: p.month } : {}),
    name: planName(p),
    period: periodLabel(p.start, p.end),
    status: planStatus(p, today),
    archived: !!p.archived,
    auto: !!p.auto,
    subplans: p.subplans.length,
    topics,
    completed,
    pct: view ? view.summary.pct : topics ? Math.round((completed / topics) * 100) : 0,
    minutesPerDay: p.preconditions?.minutesPerDay ?? null,
    programmingPractice: !!p.programmingPractice,
    ...(p.structure ? { structure: p.structure } : {}),
  };
};

/** Activos primero (el más reciente arriba), luego futuros por fecha, luego terminados del más reciente al más antiguo. */
function sortRows<T extends { status: string; start: string; end: string }>(rows: T[]): T[] {
  const rank = { propuesto: 0, activo: 1, futuro: 2, terminado: 3 } as Record<string, number>;
  return [...rows].sort((a, b) => rank[a.status]! - rank[b.status]! || (a.status === "terminado" ? b.end.localeCompare(a.end) : a.status === "activo" ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
}

/** El plan que se muestra por defecto: el activo hoy; si no, el siguiente futuro; si no, el último terminado. */
function defaultPlan(plans: readonly Plan[], today: string): Plan | null {
  // un plan propuesto no es «el plan de hoy»: solo se ve si no hay otro
  const real = plans.filter((p) => !p.proposed);
  const pool = real.length ? real : plans;
  const rows = sortRows(pool.map((p) => planRow(p, today)));
  return pool.find((p) => p.id === rows[0]?.id) ?? null;
}

/** Primer foco de la rotación de proyectos: el que sugiere el perfil de `programming_practice`, si lo hay. */
function practiceStartFocus(app: AppState) {
  try {
    return suggestFocus(loadProfile(app.root)) ?? undefined;
  } catch {
    return undefined;
  }
}

const toIso = (d: Date | null | undefined): string | null => (d ? localDate(d) : null);

/** Metas activas con los temas que enlazan sus submetas (`topic_links`), para el alcance de un plan. */
function goalScopes(app: AppState): GoalScope[] {
  const m = app.mgrs();
  const areaName = new Map(m.areas.areas().map((a) => [a.id, a.name]));
  return m.goals.goals(FILTER_ACTIVE).map((g) => ({
    id: g.id,
    name: g.name,
    area: areaName.get(g.area) ?? "",
    end: toIso(g.end),
    items: m.goals
      .items(g.id)
      .filter((i) => i.is_leaf && i.status !== ITEM_DONE && i.topic_links.length > 0)
      .sort((a, b) => a.order - b.order || (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" }))
      .map((i) => ({
        id: i.id,
        name: i.name,
        links: i.topic_links
          .map((l: string) => parseTopicLink(l))
          .filter((l: ReturnType<typeof parseTopicLink>): l is NonNullable<ReturnType<typeof parseTopicLink>> => l !== null)
          .map((l: { topic: string; skills: string[] }) => ({ folder: l.topic, skills: l.skills })),
      })),
  }));
}

const midnight = (d = new Date()): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY = 86400000;

/** Opciones del selector "Objetivo de la sesión": metas que se cumplen a diario/semanalmente, materias y atajos. */
function objectiveOptions(app: AppState, brief: ReturnType<typeof buildStudentBrief>) {
  const m = app.mgrs();
  const today = midnight();
  const goals: Array<{ goalId: string; name: string; area: string; kind: "daily" | "weekly" | "due" | "topics"; itemIds: string[]; hint: string }> = [];
  for (const g of m.goals.goals(FILTER_ACTIVE)) {
    const leaves = m.goals.items(g.id).filter((i) => i.is_leaf && i.status !== ITEM_DONE);
    const daily = leaves.filter((i) => i.repeating && i.rule.freq === "daily");
    const weekly = leaves.filter((i) => i.repeating && i.rule.freq !== "daily");
    const due = leaves.filter((i) => !i.repeating && i.due && (i.due.getTime() - today.getTime()) / DAY <= 7);
    const topics = leaves.filter((i) => !i.repeating && i.topic_links.length > 0);
    const kind = daily.length ? "daily" : weekly.length ? "weekly" : due.length ? "due" : topics.length ? "topics" : null;
    if (!kind) continue;
    const picked = [...new Set([...daily, ...weekly, ...due, ...topics].map((i) => i.id))];
    const hint = kind === "daily" ? "a diario" : kind === "weekly" ? "semanal" : kind === "due" ? "vence esta semana" : "con temas de estudio";
    goals.push({ goalId: g.id, name: g.name, area: g.area, kind, itemIds: picked, hint });
  }
  const topics = sectionData<TopicsData>(brief, "topics")?.topics ?? [];
  const bySubject = new Map<string, { topics: number; open: number }>();
  for (const t of topics) {
    const e = bySubject.get(t.subject) ?? { topics: 0, open: 0 };
    e.topics++;
    if (t.status !== "complete") e.open++;
    bySubject.set(t.subject, e);
  }
  const subjects = [...bySubject.entries()]
    .map(([subject, v]) => ({ subject, label: subjectLabel(subject), topics: v.topics, open: v.open }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const day = localDate();
  const active = activePlans(new PlanStore(app.root).list(), day);
  const lead = [...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((p) => p.preconditions?.minutesPerDay) ?? active[0];
  return {
    goals,
    subjects,
    tasksPending: sectionData<TasksData>(brief, "tasks")?.tasks.length ?? 0,
    plan: active.length
      ? {
          month: (lead ?? active[0]!).start.slice(0, 7),
          id: (lead ?? active[0]!).id,
          start: (lead ?? active[0]!).start,
          end: (lead ?? active[0]!).end,
          items: planItemsFor(day, active).length,
          minutesPerDay: lead?.preconditions?.minutesPerDay ?? null,
        }
      : null,
    programmingPractice: active.some((p) => p.programmingPractice) ? { items: todaysPracticeItems(app, day).length } : null,
  };
}

/** El id de un área real a partir de su id o su nombre; "" si no existe (nunca se crea un área). */
function resolveArea(app: AppState, wanted: unknown): string {
  const w = fold(String(wanted ?? "").trim());
  if (!w) return "";
  const hit = app.mgrs().areas.areas().find((a) => !a.archived && (fold(a.id) === w || fold(a.name) === w));
  return hit ? hit.id : "";
}

/** Solo lo que pintan las previsualizaciones (sin historial ni adherencia). */
function slimItem(i: any) {
  return {
    id: i.id,
    parent: i.parent,
    name: i.name,
    status: i.status,
    due: i.due,
    start: i.start,
    is_leaf: i.is_leaf,
    progress: i.progress,
    topic_links: i.topic_links,
    topic_progress: i.topic_progress,
    late: i.late,
    priority: i.priority,
    category: i.category,
    schedule: i.schedule,
    is_priority: i.is_priority,
    counts: i.counts,
    done_today: i.done_today,
  };
}

/** Lo que pinta el panel de proyectos de cada issue abierto. */
function slimIssue(i: any) {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    status: i.status,
    priority: i.priority,
    parent: i.parent,
    due: i.due,
    overdue: i.overdue,
    icon: i.icon,
    type: i.type,
    type_colour: i.type_colour,
  };
}

/** `send` se inyecta solo en los tests; en la app es `sendChat`. */
export function mentorApi(app: AppState, send?: SendFn) {
  const log = () => new SessionLog(app.root);
  /** El índice `00 Units — <área>.md` de una carpeta de área de la vault (sus secciones son las asignaturas), o null. */
  const readUnitsIndex = (areaFolder: string): string | null => {
    try {
      return fs.readFileSync(path.join(app.root, areaFolder, `00 Units — ${areaFolder.split("/").pop()}.md`), "utf8");
    } catch {
      return null;
    }
  };
  /** Pone en orden un plan SIN IA: reparte los temas sueltos en las asignaturas del índice de su área y los ordena por número (y reparte las semanas). Devuelve el mismo objeto si no hizo falta nada. */
  /** Salud del plan (ver `lib/planHealth.ts`): lee la vault y el plan y devuelve lo que está mal, sin tocar nada. */
  const healthOf = (plan: Plan, offered: ReadonlySet<string>): HealthIssue[] => {
    const areas = curriculumAreas();
    const vaultTopics = topicSnaps(app).map((t) => {
      const aid = curriculumAreaOfFolder(t.folder, areas);
      const target = (aid ? CURRICULUM_PLAN_TARGET[aid] : undefined) ?? knowledgeTargetOfFolder(t.folder);
      return { folder: t.folder, areaId: target?.areaId ?? null };
    });
    const folderOf = (areaId: string): string | undefined => {
      const sub = plan.subplans.find((x) => x.areaId === areaId);
      return sub ? areaFolderOf(areaId, sub.topics.map((t) => t.folder)) : undefined;
    };
    // lo que falta por hacer frente a lo que el calendario ofrece de hoy al fin (teoría)
    let capacity: { neededMin: number; availableMin: number } | undefined;
    try {
      const today = localDate();
      const sch = buildSchedule(progressPlan(plan, { today }));
      const availableMin = sch.days.filter((d) => d.study && d.date >= today).reduce((n, d) => n + (d.capacityMinutes ?? 0), 0);
      const neededMin = plan.subplans.flatMap((s) => s.topics).filter((t) => isLive(t) && t.route !== "optional" && !t.completedAt).reduce((n, t) => n + (t.estMinutes || 0), 0);
      capacity = { neededMin, availableMin };
    } catch {
      capacity = undefined;
    }
    return planHealth({ plan, vaultTopics, offered, ...(capacity ? { capacity } : {}), unitsIndexOf: (areaId) => { const f = folderOf(areaId); return f ? readUnitsIndex(f) : null; }, scanTruncated: app.vault.scanTruncated });
  };
  const tidyPlan = (plan: Plan): { plan: Plan; changed: boolean; organized: boolean } => {
    let cur = regroupByUnits(plan, readUnitsIndex);
    let organized = false;
    try {
      const o = applyOps(cur, [{ op: "organize" }], { today: localDate(), all: [], startFocus: practiceStartFocus(app), mastery: masteryLookup(app) });
      if (o.applied) {
        cur = o.plan;
        organized = true;
      }
    } catch {
      /* se queda como entró: «Organizar» se puede lanzar a mano */
    }
    return { plan: cur, changed: cur !== plan, organized };
  };
  const chats = () => new ChatStore(app.root);
  /** La conversación activa del Mentor, o la indicada (así un turno en vuelo no salta de conversación). */
  const chatFor = (id?: unknown): ChatLog | null => (id ? chats().get(String(id)) : null) ?? chats().peek();
  const stateOf = (c: ChatLog | null) => {
    if (!c) return { id: null as string | null, title: "", turns: [] as ChatTurnRecord[], pending: null as string | null };
    const rec = c.record();
    return { id: rec.id as string | null, title: rec.title, turns: rec.turns, pending: pendingDraft(rec.turns)?.id ?? null };
  };

  function markBlock(date: unknown, candidateId: unknown, status: unknown, note?: unknown) {
    if (!(BLOCK_STATUSES as readonly string[]).includes(String(status))) throw new ApiError("Estado de bloque inválido.");
    const rec = log().markBlock(
      needDate(date),
      String(candidateId ?? ""),
      status as BlockStatus,
      note === undefined || note === null ? undefined : String(note),
    );
    if (!rec) throw new ApiError("Ese bloque ya no existe.");
    return rec;
  }

  function discardPlanDraft(turnId: unknown) {
    const turns = chatFor()?.patch(String(turnId ?? ""), { discarded: true });
    if (!turns) throw new ApiError("Ese borrador ya no existe.");
    return { turns, pending: pendingDraft(turns)?.id ?? null };
  }

  // ── Constructor guiado del plan (core/mentor/planBuild.ts) ──
  // ── Llamadas largas a la IA: estado («pensando…»), progreso y cancelación ──
  const jobs = jobsOf(app);
  interface JobHandle {
    send: (messages: ChatMessage[], o?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<string>;
    setLabel: (label: string) => void;
    cancelled: () => "abort" | "auto" | undefined;
  }
  async function withJob<T>(key: string, label: string, fn: (job: JobHandle) => Promise<T>): Promise<T> {
    const job: Job = { key, label, since: Date.now(), waiters: new Set(), controller: new AbortController() };
    jobs.set(key, job);
    const handle: JobHandle = {
      cancelled: () => job.cancelled,
      setLabel: (l) => {
        job.label = l;
      },
      send: (messages, o) => {
        if (job.cancelled) return Promise.reject(new CancelError(job.cancelled));
        const signal = o?.signal ? AbortSignal.any([job.controller.signal, o.signal]) : job.controller.signal;
        return new Promise<string>((resolve, reject) => {
          job.waiters.add(reject);
          aiSendRaw(messages, { signal, ...(o?.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }).then(resolve, (e) => reject(job.cancelled ? new CancelError(job.cancelled) : e)).finally(() => job.waiters.delete(reject));
        });
      },
    };
    try {
      return await fn(handle);
    } finally {
      jobs.delete(key);
    }
  }
  const aiSendRaw = async (messages: ChatMessage[], opts?: SendOpts): Promise<string> => (send ?? sendChat)(AIConfig.fromDict(AppConfig.get_ai_config()), messages, opts);
  const builds = () => new PlanBuildStore(app.root, localDate);
  const inflight = inflightOf(app);
  /** Una sola operación a la vez por plan en construcción: la misma (doble envío) comparte la llamada; otra distinta espera. */
  function guarded<T>(id: string, key: string, fn: () => Promise<T>): Promise<T> {
    const cur = inflight.get(id);
    if (cur) {
      if (cur.key === key) return cur.p as Promise<T>;
      throw new ApiError("El Mentor sigue pensando en este plan. Espera un momento.");
    }
    const p = fn().finally(() => {
      if (inflight.get(id)?.p === p) inflight.delete(id);
    });
    inflight.set(id, { key, p });
    return p;
  }
  const buildCtx = (): BuildCtx | null => {
    if (studyIndexCold(app)) return null;
    return {
      today: localDate(),
      all: buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 }),
      goals: goalScopes(app),
      startFocus: practiceStartFocus(app),
      aiOn: aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null,
    };
  };

  /** Recalcula el plan en construcción y, si una etapa lo pide, hace UNA llamada pequeña a la IA (validada; si falla o se cancela, sigue por reglas). */
  async function advance(b: PlanBuild, ctx: BuildCtx, finishing: boolean, job: JobHandle): Promise<PlanBuild> {
    let cur = b;
    for (let i = 0; i < 60; i++) {
      const input = { pre: cur.pre, answers: cur.answers, ai: cur.ai, maxQuestions: cur.maxQuestions };
      const comp = computeBuild(input, ctx, { finishing, noAi: i === 59 });
      if (comp.needs === "ai_scope" && comp.info) {
        const ai: BuildAiState = { ...cur.ai, scopeTried: true, errors: [...cur.ai.errors] };
        job.setLabel("Leyendo tus comentarios y preparando las preguntas…");
        try {
          const brief = buildStudentBrief(briefContext(app, log()));
          const parsed = parseScopeReply(await job.send(scopeMessages(brief, cur.pre, comp.info.areas, comp.info.rules, cur.answers), { timeoutMs: 120_000 }), comp.info.rules.map((r) => r.id));
          if (parsed.ok) Object.assign(ai, { scopeOk: true, questions: parsed.questions, rewrites: { ...ai.rewrites, ...parsed.rewrites } });
          else ai.errors.push(parsed.reason ?? "La IA no devolvió nada útil.");
        } catch (e) {
          if (e instanceof CancelError && e.mode === "abort") throw new ApiError("Cancelado.");
          ai.errors.push(e instanceof CancelError ? "Pediste seguir sin IA." : `La IA falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
        }
        cur = { ...cur, ai };
        continue;
      }
      if (comp.needs === "ai_topics" && comp.info?.block) {
        const block = comp.info.block;
        const key = block.slice(0, block.lastIndexOf("#"));
        const seed = comp.info.seeds[0]!;
        const ai: BuildAiState = { ...cur.ai, topicsDone: [...cur.ai.topicsDone, block], errors: [...cur.ai.errors].slice(-4) };
        job.setLabel(`Eligiendo temas de ${seed.area}${seed.objective ? ` · ${seed.objective}` : ""}…`.slice(0, 120));
        try {
          const brief = buildStudentBrief(briefContext(app, log()));
          const candidates = new Map([[key, new Set(seed.topics.map((t) => t.folder))]]);
          const parsed = parseTopicsReply(await job.send(topicsMessages(brief, cur.pre, [seed], cur.answers), { timeoutMs: 120_000 }), candidates);
          if (parsed.ok) {
            Object.assign(ai, {
              topicsOk: true,
              topicsOkBlocks: [...ai.topicsOkBlocks, block],
              order: { ...ai.order, [key]: [...(ai.order[key] ?? []), ...(parsed.order[key] ?? [])] },
              rewrites: { ...ai.rewrites, ...parsed.rewrites },
              discarded: [...new Set([...ai.discarded, ...parsed.discarded])].slice(0, 20),
            });
          } else ai.errors.push(parsed.reason ?? "La IA no devolvió nada útil.");
        } catch (e) {
          if (e instanceof CancelError && e.mode === "abort") throw new ApiError("Cancelado.");
          ai.errors.push(e instanceof CancelError ? "Pediste seguir sin IA." : `La IA falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
        }
        cur = { ...cur, ai };
        continue;
      }
      const { openQuestion: _old, ...rest } = cur;
      return {
        ...rest,
        stage: comp.stage,
        steps: comp.steps,
        draft: comp.draft,
        skeleton: comp.skeleton,
        effective: comp.effective,
        ...(comp.question ? { openQuestion: comp.question } : {}),
        status: comp.status,
        finishing,
        questionCount: cur.answers.length,
        source: cur.ai.scopeOk || cur.ai.topicsOk ? "ai" : "rules",
        name: comp.name,
      };
    }
    throw new ApiError("No se pudo calcular el plan en construcción.");
  }
  const loadBuild = (id: unknown): PlanBuild => {
    const sid = String(id ?? "");
    const b = BUILD_ID_RE.test(sid) ? builds().load(sid) : null;
    if (!b || b.status === "abandoned") throw new ApiError("Ese plan en construcción ya no existe.");
    return b;
  };
  const buildView = (b: PlanBuild) => ({ loading: false as const, build: b, summary: summaryOf(b) });
  /** El plan de una petición de ritmo y extras (`{ id }`) con su almacén, o error claro. */
  const paceTarget = (o: Record<string, any>): { st: PlanStore; plan: Plan } => {
    const id = String(o.id ?? "");
    if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
    const st = new PlanStore(app.root);
    const plan = st.load(id);
    if (!plan) throw new ApiError("Ese plan ya no existe.");
    return { st, plan };
  };
  /** La fecha de un extra (hoy por defecto) dentro del plan. */
  const extraDate = (plan: Plan, raw: unknown): string => {
    const date = raw === undefined || raw === null || raw === "" ? localDate() : String(raw);
    if (!isIsoDate(date)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
    if (date < plan.start || date > plan.end) throw new ApiError("Esa fecha no está en el plan.");
    return date;
  };
  /** Los campos de una práctica extra a partir de la petición, sobre una base (alta o edición). */
  const extraPracticeFields = (plan: Plan, o: Record<string, any>, base: Partial<ExtraPractice> & { id: string; date: string }, create: boolean): ExtraPractice => {
    const title = create || o.title !== undefined ? String(o.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160) : base.title ?? "";
    if (!title) throw new ApiError("Escribe un título para la práctica.");
    const kind = o.kind !== undefined ? String(o.kind) : base.kind ?? "custom";
    if (!(EXTRA_PRACTICE_KINDS as readonly string[]).includes(kind)) throw new ApiError("Tipo de práctica inválido (kata, exercise o custom).");
    let minutes = base.minutes;
    if (o.minutes !== undefined) {
      const m = o.minutes === null || o.minutes === "" ? 0 : Number(o.minutes);
      if (!Number.isInteger(m) || m < 0 || m > 600) throw new ApiError("Los minutos deben ser un entero de 0 a 600.");
      minutes = m > 0 ? m : undefined;
    }
    const area = o.area !== undefined ? String(o.area ?? "").trim() : base.area ?? "";
    if (area && !plan.subplans.some((s) => s.id === area)) throw new ApiError("Ese área ya no existe en el plan.");
    const note = o.note !== undefined ? String(o.note ?? "").replace(/\s+/g, " ").trim().slice(0, 400) : base.note ?? "";
    const folder = o.folder !== undefined ? String(o.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim() : base.folder ?? "";
    const rel = o.rel !== undefined ? String(o.rel ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim().slice(0, 300) : base.rel ?? "";
    const kataDate = o.kataDate !== undefined ? String(o.kataDate ?? "").trim() : base.kataDate ?? "";
    if (kataDate && !isIsoDate(kataDate)) throw new ApiError("Fecha de kata inválida (AAAA-MM-DD).");
    const date = o.date !== undefined && !create ? extraDate(plan, o.date) : base.date;
    const done = o.done !== undefined ? o.done === true : base.done === true;
    return {
      id: base.id,
      date,
      ...(area ? { area } : {}),
      title,
      ...(minutes ? { minutes } : {}),
      ...(note ? { note } : {}),
      kind: kind as ExtraPracticeKind,
      ...(done ? { done: true } : {}),
      ...(folder ? { folder } : {}),
      ...(rel ? { rel } : {}),
      ...(kataDate ? { kataDate } : {}),
    };
  };
  /** Dónde cae cada tema pendiente en el reparto del plan (primera fecha y semana fuera de los extras) y el rango de cada semana. */
  const placementOf = (plan: Plan) => {
    const placed = new Map<string, { date: string; week: number }>();
    const weeks = new Map<number, { from: string; to: string }>();
    let sch: ReturnType<typeof buildSchedule> | null = null;
    try {
      sch = buildSchedule(progressPlan(plan, { today: localDate() }));
    } catch {
      sch = null;
    }
    if (sch) {
      for (const d of sch.days) {
        const w = weeks.get(d.week);
        weeks.set(d.week, { from: w?.from ?? d.date, to: d.date });
        for (const t of d.topics) if (!t.extra && !placed.has(t.folder)) placed.set(t.folder, { date: d.date, week: d.week });
      }
    }
    return { sch, placed, weeks };
  };
  /**
   * «Próximos temas»: los temas pendientes de la ruta de cada área, en su orden, con la semana y el día en que caen, su estado y, si aún no se pueden
   * adelantar, el tema que va antes (`blockedBy`). Un tema se puede adelantar a `date` cuando todos los anteriores de su área están completos, ya
   * adelantados o ya caen ese día o antes. `horizon` = semanas por delante de la actual (por defecto 4). Solo lee.
   */
  const upcomingTopics = (plan: Plan, area: string, o: Record<string, any>) => {
    const date = o.date === undefined || o.date === null || o.date === "" ? localDate() : String(o.date);
    if (!isIsoDate(date)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
    // con una asignatura elegida se ven TODOS sus temas pendientes en orden (no solo los de las próximas semanas del área entera)
    const only = typeof o.group === "string" ? o.group.trim() : "";
    const horizon = only ? 26 : Math.max(1, Math.min(26, Math.round(Number(o.horizon)) || 4));
    const { sch, placed, weeks } = placementOf(plan);
    const isBases = basesClassifier(plan);
    const added = new Map<string, string[]>();
    for (const e of plan.extraTopics ?? []) added.set(e.folder, [...(added.get(e.folder) ?? []), e.date]);
    const weekOfDate = (d: string): number | undefined => sch?.byDate.get(d)?.week;
    const nowWeek = weekOfDate(localDate()) ?? weekOfDate(date) ?? 1;
    const ahead: Array<Record<string, unknown>> = [];
    const plannedByArea: Record<string, number> = {};
    for (const s of plan.subplans) {
      if (area && s.id !== area) continue;
      plannedByArea[s.id] = (sch?.byDate.get(date)?.topics ?? []).filter((t) => t.subplanId === s.id).length;
      let live = s.topics.filter((t) => isLive(t) && (area === "bases" || !isBases({ subplanId: s.id, ...(t.group ? { group: t.group } : {}) })) && (!only || (t.group ?? "core") === only) && t.route !== "optional");
      const origIndex = new Map(live.map((t, idx) => [t.folder, idx]));
      live = live.slice().sort((a, b) => {
        const pa = placed.get(a.folder);
        const pb = placed.get(b.folder);
        if (pa?.date && pb?.date) {
          const c = pa.date.localeCompare(pb.date);
          if (c !== 0) return c;
        } else if (pa?.date) {
          return -1;
        } else if (pb?.date) {
          return 1;
        }
        return (origIndex.get(a.folder) ?? 0) - (origIndex.get(b.folder) ?? 0);
      });
      const blockerByGroup = new Map<string, string>();
      live.forEach((t, i) => {
        if (t.completedAt) return;
        const dates = added.get(t.folder) ?? [];
        const p = placed.get(t.folder);
        const rawWeek = p?.week ?? (dates[0] ? weekOfDate(dates[0]) : undefined) ?? t.targetWeek;
        const onDay = dates.includes(date) || p?.date === date;
        const satisfied = dates.some((d) => d <= date) || (!!p && p.date <= date);
        const state = dates.length ? "adelantado" : p && p.date <= date ? "planeado" : "pendiente";
        if (rawWeek >= nowWeek && rawWeek <= nowWeek + horizon) {
          const relWeek = Math.max(1, rawWeek - nowWeek + 1);
          const group = t.group ? s.groups?.find((g) => g.id === t.group)?.title : undefined;
          const groupKey = t.group ?? "default";
          const blocker = blockerByGroup.get(groupKey);
          ahead.push({
            folder: t.folder, title: t.title, inPlan: true, area: s.area, subplanId: s.id, position: i + 1, total: live.length, estMinutes: t.estMinutes,
            targetWeek: t.targetWeek, addedDates: dates, week: relWeek, rawWeek, state, onDay,
            ...(p?.date ? { plannedDate: p.date } : {}),
            ...(group ? { group } : {}),
            ...(!satisfied && blocker ? { blockedBy: blocker } : {}),
          });
        }
        const groupKey = t.group ?? "default";
        if (!satisfied && !blockerByGroup.has(groupKey)) blockerByGroup.set(groupKey, t.title);
      });
    }
    const range: Record<string, { from: string; to: string }> = {};
    for (const r of ahead) {
      const rawW = (r.rawWeek as number | undefined) ?? (r.week as number);
      const w = weeks.get(rawW);
      if (w) range[String(r.week)] = w;
    }
    return { loading: false as const, ahead, vault: [] as unknown[], weeks: range, plannedByArea, date, currentWeek: 1 };
  };
  /** El plan de una petición de cobertura (`{ id }`), o error claro. */
  const coveragePlan = (opts: unknown): Plan => {
    const id = String(((opts && typeof opts === "object" ? opts : {}) as Record<string, any>).id ?? "");
    if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
    const plan = new PlanStore(app.root).load(id);
    if (!plan) throw new ApiError("Ese plan ya no existe.");
    return plan;
  };
  /** Cobertura determinista del plan contra TODOS los temas de la vault (notas de teoría y ejercicios por tema). */
  const coverageOf = (plan: Plan) => {
    const snaps = topicSnaps(app);
    // diseño de cada tema del plan contra el checklist de la vault (solo lee; ver `lib/topicDesign.ts`)
    const designs = designsOf(app, plan.subplans.flatMap((s) => s.topics.map((t) => ({ folder: t.folder, title: t.title, ...(snaps.find((x) => x.folder === t.folder)?.subject ? { subject: snaps.find((x) => x.folder === t.folder)!.subject } : {}) }))));
    const topics = snaps.map((t) => ({ folder: t.folder, title: t.title, theoryNotes: t.theoryNotes, exerciseCount: t.exerciseCount, ...(t.planExercises ? { planExercises: t.planExercises } : {}), completenessPct: t.progress.completenessPct, ...(designs.get(t.folder) ? { design: designs.get(t.folder)! } : {}) }));
    return { coverage: computeCoverage(plan, topics, { ppReady: !!ppAreaDir(app.root) }), snaps, designs };
  };
  let acceptRef: (opts: unknown) => any = () => {
    throw new ApiError("No disponible.");
  };

  const api = {
    mentor_brief(opts: unknown = {}) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const strs = (v: unknown): string[] | undefined =>
        Array.isArray(v) ? v.map((x) => String(x)).slice(0, 20) : undefined;
      const brief = buildStudentBrief(briefContext(app, log()), { only: strs(o.only), exclude: strs(o.exclude) });
      const maxChars = clampInt(o.maxChars, 500, 40000, DEFAULT_BRIEF_CHARS);
      return { brief, text: toPromptText(brief, maxChars) };
    },

    mentor_candidates(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const availableMinutes = clampInt(o.availableMinutes, 5, 720, 60);
      const brief = buildStudentBrief(briefContext(app, log()));
      const objective = sanitizeObjective(o.objective) ?? undefined;
      const candidates = buildCandidates(brief, { availableMinutes, objective, planItems: todaysPlanItems(app), practiceItems: todaysPracticeItems(app) });
      const plan = allocate(candidates, availableMinutes, {
        maxSubjects: o.maxSubjects === undefined ? undefined : clampInt(o.maxSubjects, 1, 10, 3),
      });
      return {
        availableMinutes,
        candidates,
        plan,
        plannedMinutes: plan.reduce((n, c) => n + c.estMinutes, 0),
      };
    },

    mentor_session_save(record: unknown) {
      const clean = sanitizeSession(record);
      if (!clean) throw new ApiError("Sesión inválida.");
      return log().save(clean);
    },

    mentor_session_load(date: unknown) {
      return log().load(needDate(date));
    },

    mentor_session_recent(n: unknown = 14) {
      return log().recent(clampInt(n, 1, 365, 14));
    },

    mentor_session_mark_block: markBlock,

    mentor_adherence(n: unknown = 30) {
      return adherence(log().recent(clampInt(n, 1, 365, 30)));
    },

    /**
     * "Lo que sé de ti": señales del informe en texto + adherencia reciente, para el panel
     * lateral de la pestaña. `loading` mientras el índice de la vault está frío (la vista
     * reintenta, igual que el dashboard de estudio).
     */
    mentor_overview() {
      if (studyIndexCold(app)) return { loading: true as const };
      const brief = buildStudentBrief(briefContext(app, log()));
      return {
        loading: false as const,
        date: brief.date,
        weekday: brief.weekday,
        sections: brief.sections.map((s) => ({ id: s.id, title: s.title, summary: s.summary, signals: s.signals })),
        adherence: adherence(log().recent(30)),
        today: log().load(localDate()),
        aiConfigured: aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null,
        objectives: objectiveOptions(app, brief),
      };
    },

    /**
     * Propone el plan de hoy: candidatos del informe + IA (o plan automático). Nunca escribe;
     * el plan solo se guarda al aceptarlo (`mentor_plan_accept`).
     */
    async mentor_plan_propose(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const availableMinutes = clampInt(o.availableMinutes, 5, 720, 60);
      if (studyIndexCold(app)) return { loading: true as const };
      const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map((x) => String(x)).slice(0, 50) : undefined);
      const brief = buildStudentBrief(briefContext(app, log()));
      const spec = sanitizeObjective(o.objectiveSpec) ?? undefined;
      const candidates = buildCandidates(brief, { availableMinutes, objective: spec, planItems: todaysPlanItems(app), practiceItems: todaysPracticeItems(app) });
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      const objective = (spec ? objectiveText(resolveObjective(spec, brief), brief) : "") || (o.objective ? String(o.objective).slice(0, 500) : "");
      const res = await proposePlan(
        cfg,
        {
          brief,
          candidates,
          availableMinutes,
          objective: objective || undefined,
          userNote: o.userNote ? String(o.userNote).slice(0, 500) : undefined,
          excludeSubjects: strs(o.excludeSubjects),
          excludeCandidateIds: strs(o.excludeCandidateIds),
        },
        send,
      );
      return {
        loading: false as const,
        availableMinutes,
        objective,
        plan: res.plan,
        source: res.source,
        candidates: res.candidates,
        ...(res.error ? { error: res.error } : {}),
      };
    },

    /**
     * Acepta el plan: guarda el `SessionRecord` del día (fuente de verdad, bloques `planned`).
     * Re-aceptar el mismo día conserva el estado de los bloques que siguen en el plan.
     * No se copia a la cola de estudio ni a la agenda: eso duplicaría datos (ver informe).
     */
    mentor_plan_accept(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const date = o.date ? needDate(o.date) : localDate();
      if (!Array.isArray(o.blocks) || !o.blocks.length) throw new ApiError("El plan no tiene bloques.");
      const blocks = planToBlocks({ blocks: o.blocks as ProposedBlock[] });
      const previous = log().load(date);
      for (const b of blocks) {
        const old = previous?.blocks.find((p) => p.candidateId === b.candidateId);
        if (old) {
          b.status = old.status;
          if (old.note) b.note = old.note;
        }
      }
      const clean = sanitizeSession({
        date,
        availableMinutes: clampInt(o.availableMinutes, 5, 720, 60),
        objective: o.objective ? String(o.objective) : undefined,
        blocks,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
      });
      if (!clean || !clean.blocks.length) throw new ApiError("Plan inválido.");
      return log().save(clean);
    },

    // ── Conversación con el Mentor: crear metas con el estudiante ─────────

    /** La conversación activa del Mentor y su borrador pendiente (si lo hay). */
    mentor_chat_load() {
      return stateOf(chatFor());
    },

    /** Compatibilidad: "limpiar" es empezar una conversación nueva (la anterior queda en el historial). */
    mentor_chat_clear() {
      return stateOf(chats().create());
    },

    // Historial del Mentor: conversaciones propias, aparte del historial del asistente.
    mentor_chats_list() {
      return chats().list();
    },

    mentor_chat_new() {
      return stateOf(chats().create());
    },

    mentor_chat_open(id: unknown) {
      const c = chats().open(String(id ?? ""));
      if (!c) throw new ApiError("Esa conversación ya no existe.");
      return stateOf(c);
    },

    mentor_chat_rename(id: unknown, title: unknown) {
      const next = String(title ?? "").trim();
      if (!next) throw new ApiError("Escribe un título.");
      const rec = chats().rename(String(id ?? ""), next);
      if (!rec) throw new ApiError("Esa conversación ya no existe.");
      return { id: rec.id, title: rec.title };
    },

    /** Borra una conversación (a la papelera) y devuelve la conversación que queda activa. */
    mentor_chat_delete(id: unknown) {
      const store = chats();
      if (!store.remove(String(id ?? ""))) throw new ApiError("Esa conversación ya no existe.");
      return stateOf(store.peek());
    },

    /**
     * Un turno de la conversación. La IA solo ve el informe, el catálogo de temas reales filtrado por
     * el pedido y la conversación; responde con una pregunta o un borrador, y el calendario lo calcula
     * la app. NUNCA escribe una meta: eso solo lo hace `mentor_goal_create` al confirmar.
     */
    async mentor_chat(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const message = String(o.message ?? "").trim().slice(0, 1500);
      if (!message) throw new ApiError("Escribe un mensaje para el Mentor.");
      if (studyIndexCold(app)) return { loading: true as const };
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      const unavailable = aiUnavailableReason(cfg);
      const existing = chatFor(o.chatId);
      const stored = existing?.load() ?? [];
      if (unavailable) {
        return { loading: false as const, kind: "no_ai" as const, text: unavailable, turns: stored, pending: pendingDraft(stored)?.id ?? null };
      }

      const history: ChatTurn[] = Array.isArray(o.history)
        ? o.history
            .filter((h: any) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
            .map((h: any) => ({ role: h.role as "user" | "assistant", content: String(h.content).slice(0, 3000) }))
            .slice(-20)
        : toHistory(stored);

      const brief = buildStudentBrief(briefContext(app, log()));
      const request = [...history.filter((h) => h.role === "user").map((h) => h.content), message].join(" ");
      const planMode = o.mode === "plan";
      const today = localDate();
      const snapsAll = topicSnaps(app);
      // refinando un borrador que salió de precondiciones: siguen siendo hechos fijos
      const prevPlan = pendingDraft(stored)?.planDraft;
      const allTopics = buildTopicCatalog(snapsAll, "", { max: 1_000_000 });
      const prePrev0: PlanPreconditions | null = prevPlan?.preconditions ? sanitizePreconditions(prevPlan.preconditions, today) : null;
      // también en el chat: si el borrador no traía ramas, se infieren («full stack», metas solo Backend/Frontend) y se respetan las excluidas
      const prePrev = prePrev0 ? resolveBranches(prePrev0, allTopics, goalScopes(app).filter((g) => prePrev0.goalIds.includes(g.id)).map((g) => g.name), message) : null;
      const scopePrev = prePrev ? resolveScope(prePrev, allTopics, goalScopes(app)) : null;
      const catalog = scopePrev ? planCatalog(scopePrev, dynamicCatalogMax(prePrev!, scopePrev, today), `${prePrev?.freeObjective ?? ""} ${prePrev?.notes ?? ""} ${message}`) : buildTopicCatalog(snapsAll, request, { max: planMode ? 80 : 60 });
      const planCtx = planContext(app, today);
      const areas = app.mgrs().areas.areas().filter((a) => !a.archived);
      const chatLog = existing ?? chats().create();
      const turns = chatLog.append({ role: "user", content: message });

      let raw = "";
      try {
        const extras = { today, areas: areas.map((a) => a.name), plan: planCtx, planMode };
        const msgs = prePrev && scopePrev ? buildPlanMessages(prePrev, brief, catalog, history, { ...extras, scope: scopePrev }, message) : buildChatMessages(message, brief, catalog, history, extras);
        raw = await withJob("chat", "El Mentor está pensando…", (job) => job.send(msgs));
      } catch (e) {
        return { loading: false as const, kind: "error" as const, text: `La IA falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400), turns, pending: pendingDraft(turns)?.id ?? null };
      }
      const parsed = parseChatResponse(raw, catalog, planCtx);
      if (!parsed.ok) {
        return { loading: false as const, kind: "error" as const, text: `${parsed.error} Reformula o inténtalo de nuevo.`, turns, pending: pendingDraft(turns)?.id ?? null };
      }
      if (parsed.reply.type === "question") {
        const next = chatLog.append({ role: "assistant", content: parsed.reply.text });
        return { loading: false as const, kind: "question" as const, text: parsed.reply.text, turns: next, pending: pendingDraft(next)?.id ?? null };
      }
      if (parsed.reply.type === "plan_draft") {
        let planDraft: PlanDraft | { missing: string };
        if (prePrev) {
          const { seeds, why } = seedsFromReply(parsed.reply, catalog, prePrev, new Map(goalScopes(app).map((g) => [g.id, g.name])));
          if (!seeds.length) return { loading: false as const, kind: "error" as const, text: "La IA no propuso ningún tema válido. Reformula o inténtalo de nuevo.", turns, pending: pendingDraft(turns)?.id ?? null };
          planDraft = composeFromPreconditions(seeds, prePrev, { today, auto: false, rationale: parsed.reply.rationale, discarded: parsed.reply.discarded, why, startFocus: practiceStartFocus(app), practiceSuggestions: parsed.reply.practice ?? suggestionsOf(prevPlan?.programmingPractice) });
        } else planDraft = composePlanDraft(parsed.reply, catalog, planCtx);
        if ("missing" in planDraft) {
          const text = `Antes de armar el plan del mes necesito saber ${planDraft.missing}.`;
          const next = chatLog.append({ role: "assistant", content: text });
          return { loading: false as const, kind: "question" as const, text, turns: next, pending: pendingDraft(next)?.id ?? null };
        }
        const text = parsed.reply.rationale || `Plan de ${planDraft.month}: ${planDraft.subplans.length} subplanes`;
        const next = chatLog.append({ role: "assistant", content: text, planDraft });
        return { loading: false as const, kind: "plan_draft" as const, text, planDraft, turns: next, pending: pendingDraft(next)?.id ?? null };
      }
      const reply = parsed.reply;
      const draft = composeDraft(reply, catalog, today, resolveArea(app, reply.area));
      if ("missing" in draft) {
        const text = `Antes de armar el calendario necesito saber ${draft.missing}.`;
        const next = chatLog.append({ role: "assistant", content: text });
        return { loading: false as const, kind: "question" as const, text, turns: next, pending: pendingDraft(next)?.id ?? null };
      }
      const text = reply.rationale || `Borrador: ${draft.name}`;
      const next = chatLog.append({ role: "assistant", content: text, draft });
      return { loading: false as const, kind: "draft" as const, text, draft, turns: next, pending: pendingDraft(next)?.id ?? null };
    },

    /** "Descartar": no escribe ninguna meta; solo marca el borrador. */
    mentor_draft_discard(turnId: unknown) {
      const turns = chatFor()?.patch(String(turnId ?? ""), { discarded: true });
      if (!turns) throw new ApiError("Ese borrador ya no existe.");
      return { turns, pending: pendingDraft(turns)?.id ?? null };
    },

    /**
     * "Crear meta": el ÚNICO camino de escritura. No se fía del calendario que mande la UI: vuelve a
     * calcularlo con los temas que existen AHORA (las carpetas inexistentes se descartan) y escribe la
     * meta y sus submetas con `topic_links` mediante GoalManager.
     */
    mentor_goal_create(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const d = (o.draft && typeof o.draft === "object" ? o.draft : {}) as Record<string, any>;
      const sch = (d.schedule && typeof d.schedule === "object" ? d.schedule : {}) as Record<string, any>;
      const start = needDate(sch.start);
      const end = needDate(sch.end);
      const hoursPerWeek = Number(sch.hoursPerWeek);
      if (!(hoursPerWeek > 0)) throw new ApiError("Horas por semana inválidas.");
      if (!Array.isArray(d.topics) || !d.topics.length) throw new ApiError("El borrador no tiene temas.");

      const snaps = new Map(topicSnaps(app).map((t) => [t.folder, t]));
      const seen = new Set<string>();
      const topics: Array<{ folder: string; title: string; skills: string[]; estMinutes: number; why: string }> = [];
      for (const t of d.topics.slice(0, 40) as any[]) {
        const folder = String(t?.folder ?? "").replace(/\\/g, "/");
        const snap = snaps.get(folder);
        if (!snap || seen.has(folder)) continue;
        seen.add(folder);
        const valid = new Set(Object.keys(snap.progress.skills));
        const skills = Array.isArray(t.skills) ? t.skills.map((x: unknown) => String(x).toLowerCase()).filter((x: string) => valid.has(x)) : [];
        topics.push({ folder, title: snap.title, skills, estMinutes: estimateTopicMinutes(snap), why: String(t?.why ?? "").replace(/\s+/g, " ").slice(0, 240) });
      }
      if (!topics.length) throw new ApiError("Ninguno de los temas del borrador existe ya en tu sistema.");
      let schedule;
      try {
        schedule = scheduleGoal({ topics, start, end, hoursPerWeek });
      } catch (e) {
        throw new ApiError((e as Error).message);
      }

      const goals = app.mgrs().goals;
      const name = String(d.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Nueva meta de estudio";
      const goal = goals.create_goal(name, {
        area: resolveArea(app, d.area),
        start,
        end,
        description: String(d.description ?? "").slice(0, 4000),
        priority: 2,
        in_overview: true,
      });
      const byFolder = new Map(topics.map((t) => [t.folder, t]));
      for (const it of schedule.items) {
        goals.create_item(goal.id, it.name, "", {
          start: it.start,
          due: it.due,
          duration_min: Math.min(100000, it.minutes),
          topic_links: it.topic_links,
          notes: it.folders.map((f) => byFolder.get(f)?.why ?? "").filter(Boolean).join("\n"),
        });
      }
      if (o.turnId) chatFor(o.chatId)?.patch(String(o.turnId), { createdGoalId: goal.id });
      return { goalId: goal.id, name: goal.name, items: schedule.items.length, schedule };
    },

    /**
     * Previsualizaciones de solo lectura para los paneles Metas / Proyectos / Notas. Todo sale de los
     * mismos managers que sus módulos; aquí no se edita nada.
     */
    mentor_panels() {
      if (studyIndexCold(app)) return { loading: true as const };
      const g = goalsApi(app);
      const goals = (g.goals_list("activas") as any[]).map((card) => {
        const detail = g.goals_get(card.id) as any;
        return { card, items: (detail.items as any[]).map(slimItem) };
      });
      const pApi = projectsApi(app);
      const projects = (pApi.projects_list() as any[])
        .filter((p) => p.status === "En curso" || p.status === "Planeado")
        .map((p) => {
          const open = ((pApi.projects_get(p.id) as any).issues as any[]).filter((i) => !i.done);
          return { ...p, issues: open.slice(0, 40).map(slimIssue) };
        });
      const brief = buildStudentBrief(briefContext(app, log()));
      const pending = sectionData<StudyPendingData>(brief, "study_pending");
      const snaps = topicSnaps(app);
      return {
        loading: false as const,
        goals,
        areas: app.mgrs().areas.areas().map((a) => ({ id: a.id, name: a.name, icon: a.icon, colour: a.colour })),
        projects,
        study: {
          topics: topicsPanel(snaps),
          areas: studyAreas(snaps, {
            lifeAreas: app.mgrs().areas.areas().map((a) => ({ id: a.id, name: a.name, icon: a.icon, colour: a.colour })),
            srsBySubject: pending?.srs.bySubject ?? [],
            errorsBySubject: pending?.errors.bySubject ?? {},
            queue: pending?.queue ?? [],
          }),
          srs: pending?.srs ?? { dueTotal: 0, bySubject: [] },
          errors: pending ? { unresolved: pending.errors.unresolved, repeaters: pending.errors.repeaters.slice(0, 5) } : { unresolved: 0, repeaters: [] },
        },
      };
    },

    mentor_block_status: markBlock,

    // ── Planes del Mentor sobre un periodo libre (core/mentor/plan.ts, planSpec.ts) ──

    /** Los planes con su periodo y estado (activo / futuro / terminado): activos primero. */
    mentor_plan_list() {
      const today = localDate();
      const snaps = studyIndexCold(app) ? null : new Map(topicSnaps(app).map((t) => [t.folder, t]));
      const lookup = snaps ? (f: string) => snaps.get(f) : undefined;
      return sortRows(new PlanStore(app.root).list().map((p) => planRow(p, today, lookup)));
    },

    /** Renombra un plan (el nombre se guarda en su archivo; vacío = volver al nombre autogenerado). */
    mentor_plan_rename(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const st = new PlanStore(app.root);
      const plan = PLAN_ID_RE.test(String(o.id ?? "")) ? st.load(String(o.id)) : null;
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const name = String(o.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      const { name: _old, ...rest } = plan;
      return st.save({ ...rest, ...(name ? { name } : {}), updatedAt: new Date().toISOString() });
    },

    /** Archiva (da por terminado) un plan o lo reactiva: deja de aportar a «Hoy» sin borrar nada. */
    mentor_plan_archive(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const st = new PlanStore(app.root);
      const plan = PLAN_ID_RE.test(String(o.id ?? "")) ? st.load(String(o.id)) : null;
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const { archived: _a, ...rest } = plan;
      return st.save({ ...rest, ...(o.archived === false ? {} : { archived: true }), updatedAt: new Date().toISOString() });
    },

    /** Elimina un plan: su archivo va a la papelera de la vault (`.notevault/.papelera/mentor-plans`), no se borra de forma dura. */
    mentor_plan_delete(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      if (!st.load(id)) throw new ApiError("Ese plan ya no existe.");
      if (!st.trash(id)) throw new ApiError("No se pudo eliminar el plan.");
      return { id, plans: sortRows(st.list().map((p) => planRow(p, localDate()))) };
    },

    /**
     * Lo que ofrece el formulario de precondiciones: metas activas con sus temas enlazados, materias con
     * temas y, por tema pendiente, sus minutos y qué metas lo enlazan (el cliente calcula en vivo con eso).
     */
    mentor_plan_options() {
      if (studyIndexCold(app)) return { loading: true as const };
      const all = buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 });
      const goals = goalScopes(app);
      const topics = scopeTopics(all, goals);
      const areas = new Map<string, { id: string; name: string; total: number; pending: number; minutes: number; branches: Record<string, { total: number; pending: number }> }>();
      for (const t of all) {
        const id = areaOfFolder(t.folder) || t.subject || "General";
        const e = areas.get(id) ?? { id, name: id, total: 0, pending: 0, minutes: 0, branches: {} };
        e.total++;
        const br = branchOfFolder(t.folder);
        if (br) {
          const be = (e.branches[br] ??= { total: 0, pending: 0 });
          be.total++;
          if (t.completenessPct < 100) be.pending++;
        }
        if (t.completenessPct < 100) {
          e.pending++;
          e.minutes += t.estMinutes;
        }
        areas.set(id, e);
      }
      return {
        loading: false as const,
        today: localDate(),
        aiConfigured: aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null,
        goals: goals.map((g) => {
          const mine = topics.filter((t) => t.goalIds.includes(g.id));
          return { id: g.id, name: g.name, area: g.area, end: g.end, topics: mine.length, minutes: mine.reduce((n, t) => n + t.minutes, 0) };
        }),
        areas: [...areas.values()]
          .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }))
          .map((a) => ({ ...a, branches: Object.entries(a.branches).sort((x, y) => x[0].localeCompare(y[0], "es", { numeric: true })).map(([name, v]) => ({ name, ...v, kind: classifyBranch(name) })) })),
        topics,
      };
    },

    /**
     * Un plan a partir de las PRECONDICIONES (periodo, tiempo diario, días de estudio, qué cubrir, nivel…).
     * Devuelve un BORRADOR (no escribe ningún plan): con IA, ella elige y ordena temas del catálogo real con las
     * precondiciones como hechos fijos; sin IA, o si falla, un plan automático determinista. El borrador queda
     * como turno pendiente del Mentor (se acepta o descarta igual que un `plan_draft`, y se puede refinar en el chat).
     */
    async mentor_plan_generate(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      const pre0 = sanitizePreconditions(o.preconditions && typeof o.preconditions === "object" ? o.preconditions : o, today);
      const problem = preconditionsProblem(pre0, today);
      if (problem) throw new ApiError(problem);
      if (studyIndexCold(app)) return { loading: true as const };
      if (jobs.has("generate")) throw new ApiError("Ya se está generando un plan. Espera a que termine o cancélalo.");

      const all = buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 });
      const goals = goalScopes(app);
      // ramas: si no vienen explícitas se infieren aquí («full stack», metas solo Backend/Frontend…); las excluidas no entran a nada
      const pre = resolveBranches(pre0, all, goals.filter((g) => pre0.goalIds.includes(g.id)).map((g) => g.name));
      const scope = resolveScope(pre, all, goals);
      const catalog = planCatalog(scope, dynamicCatalogMax(pre, scope, today), `${pre.freeObjective ?? ""} ${pre.notes ?? ""}`);
      if (!catalog.length) {
        throw new ApiError("No hay temas pendientes en lo que elegiste. Elige metas con temas enlazados o materias con temas sin completar.");
      }

      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      const unavailable = o.noAi === true ? "Pediste el plan automático (sin IA)" : aiUnavailableReason(cfg);
      const planCtx = planContext(app, today);
      return withJob("generate", `Eligiendo temas de ${[...new Set(scope.goalGroups.map((g) => g.area).concat(scope.areaGroups.map((g) => g.area)))].slice(0, 3).join(", ") || "tus metas"}…`, async (job) => {
        let draft: PlanDraft | null = null;
        let fallbackReason: string | undefined = unavailable ?? undefined;
        if (o.asDraft !== true) {
          // camino principal: esqueleto + un bloque de temas por subplan (en paralelo, con tiempo por llamada); lo que falla cae a reglas SOLO en ese bloque
          const brief = unavailable ? (null as never) : buildStudentBrief(briefContext(app, log()));
          let res;
          try {
            res = await generateByParts(pre, autoSeeds(pre, scope, goals), {
              aiOn: !unavailable,
              brief,
              send: (m, so) => job.send(m, so),
              cancelled: job.cancelled,
              onProgress: (_p, l) => job.setLabel(l),
              ...(o.concurrency ? { concurrency: clampInt(o.concurrency, 1, 6, 3) } : {}),
              ...(o.callTimeoutMs ? { callTimeoutMs: clampInt(o.callTimeoutMs, 50, 300000, 120000) } : {}),
              ...(o.budgetMs ? { budgetMs: clampInt(o.budgetMs, 100, 1800000, 480000) } : {}),
            });
          } catch (e) {
            if (e instanceof PipelineCancel || e instanceof CancelError) throw new ApiError("Generación cancelada.");
            throw e;
          }
          const why = unavailable ? (o.noAi === true ? "Lo pediste sin IA" : "La IA no está configurada") : `La IA no devolvió ningún tema válido (${res.warnings[0] ?? "sin detalle"})`;
          draft = composeFromPreconditions(markDiagnostics(res.seeds, pre), pre, {
            today,
            auto: !res.aiUsed,
            startFocus: practiceStartFocus(app),
            discarded: res.discarded,
            rationale: res.aiUsed ? res.rationale || "Plan armado por partes: esqueleto y temas de cada subplan elegidos por el Mentor." : `Plan automático con tus metas y materias elegidas, en su orden natural y sin lo ya completado. ${why}.`,
            ...(!res.aiUsed && !unavailable && res.warnings[0] ? { fallbackReason: res.warnings[0] } : {}),
            ...(res.areaProposal ? { areaProposal: res.areaProposal } : {}),
          });
          if (res.warnings.length) draft = { ...draft, warnings: [...draft.warnings, ...res.warnings] };
        } else if (!unavailable) {
          try {
            const brief = buildStudentBrief(briefContext(app, log()));
            const areaNames = app.mgrs().areas.areas().filter((a) => !a.archived).map((a) => a.name);
            const raw = await job.send(buildPlanMessages(pre, brief, catalog, [], { today, areas: areaNames, plan: planCtx, scope }));
            const parsed = parsePreconditionReply(raw, catalog, planCtx);
            if (parsed.ok) {
              const { seeds, why } = seedsFromReply(parsed.reply, catalog, pre, new Map(goals.map((g) => [g.id, g.name])), goals);
              if (seeds.length) {
                draft = composeFromPreconditions(seeds, pre, { today, auto: false, rationale: parsed.reply.rationale, discarded: parsed.reply.discarded, why, startFocus: practiceStartFocus(app), practiceSuggestions: parsed.reply.practice });
              } else fallbackReason = "La IA no propuso ningún tema válido.";
            } else fallbackReason = parsed.reason;
          } catch (e) {
            if (e instanceof CancelError && e.mode === "abort") throw new ApiError("Generación cancelada.");
            fallbackReason = e instanceof CancelError ? "Pediste el plan automático (sin IA)" : `La IA falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
          }
        }
        if (!draft) {
          const why = unavailable ? (o.noAi === true ? "Lo pediste sin IA" : "La IA no está configurada") : `La IA no devolvió un plan válido (${fallbackReason ?? "sin detalle"})`;
          draft = composeFromPreconditions(autoSeeds(pre, scope, goals), pre, {
            today,
            auto: true,
            startFocus: practiceStartFocus(app),
            rationale: `Plan automático con tus metas y materias elegidas, en su orden natural y sin lo ya completado. ${why}.`,
            ...(fallbackReason && !unavailable ? { fallbackReason } : {}),
          });
        }

        const active = chats().peek();
        const chatLog = active && active.load().length === 0 ? active : chats().create();
        chatLog.append({ role: "user", content: preconditionsRequest(pre, scope) });
        const text = draft.rationale || `Plan del ${draft.start} al ${draft.end}: ${draft.subplans.length} subplanes`;
        const source = draft.auto ? ("auto" as const) : ("ai" as const);
        if (o.asDraft === true) {
          // compatibilidad: el borrador separado que se acepta con `mentor_plan_draft_accept`
          const next = chatLog.append({ role: "assistant", content: text, planDraft: draft });
          return { loading: false as const, kind: "plan_draft" as const, source, text, planDraft: draft, turns: next, pending: pendingDraft(next)?.id ?? null, chatId: chatLog.record().id };
        }
        // camino principal: el plan se crea YA como plan real «propuesto» (se mantiene o se borra desde su sub-interfaz)
        const created = acceptRef({ draft, proposed: true }) as { id: string };
        const planName_ = planName(new PlanStore(app.root).load(created.id)!);
        const next = chatLog.append({ role: "assistant", content: `Plan creado: ${planName_}. ${draft.rationale}`.trim(), createdPlan: created.id });
        return { loading: false as const, kind: "plan_created" as const, source, text, planId: created.id, planDraft: draft, turns: next, pending: pendingDraft(next)?.id ?? null, chatId: chatLog.record().id };
      });
    },

    /**
     * «Crear el plan con otra IA» (Antigravity, un chat…): escribe en la vault el MISMO pedido que la app le haría a su IA (reglas, precondiciones fijas
     * y catálogo real) y devuelve la frase corta para pegar. No usa la IA de la app (no exige clave ni modelo local) ni crea ningún plan: eso ocurre en
     * `mentor_plan_external_accept` cuando la otra IA ya respondió.
     */
    mentor_plan_external_prompt(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      const pre0 = sanitizePreconditions(o.preconditions && typeof o.preconditions === "object" ? o.preconditions : o, today);
      const problem = preconditionsProblem(pre0, today);
      if (problem) throw new ApiError(problem);
      if (studyIndexCold(app)) return { loading: true as const };
      const { pre, scope, catalog } = externalPlanScope(app, pre0, today);
      const brief = buildStudentBrief(briefContext(app, log()));
      const areaNames = app.mgrs().areas.areas().filter((a) => !a.archived).map((a) => a.name);
      const request = preconditionsRequest(pre, scope);
      const messages = buildPlanMessages(pre, brief, catalog, [], { today, areas: areaNames, plan: planContext(app, today), scope }, request);
      const space = mostCommonSpace(catalog.map((t) => t.folder));
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
      const dir = path.join(app.root, space, "_handoff", "planes");
      const file = path.join(dir, `${stamp}_plan.md`);
      const answer = path.join(dir, `${stamp}_plan_respuesta.json`);
      const doc = buildExternalPlanDoc({ system: messages[0]!.content, request, answerAbs: answer, today, topics: catalog.length });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, doc, "utf-8");
      const rel = (p: string): string => path.relative(app.root, p).split(path.sep).join("/");
      return { loading: false as const, rel: rel(file), abs: file, answerRel: rel(answer), answerAbs: answer, shortPrompt: externalPlanShortPrompt(file, answer), chatPrompt: externalPlanChatPrompt(doc), topics: catalog.length };
    },

    /**
     * Crea el plan «propuesto» con la respuesta de la otra IA: pegada (`reply`) o leída del archivo (`answerRel`). La valida el mismo analizador que la IA de la
     * app: lo inventado se descarta, las precondiciones no se tocan y, si la respuesta no sirve, se explica por qué sin crear nada.
     */
    async mentor_plan_external_accept(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      const pre0 = sanitizePreconditions(o.preconditions && typeof o.preconditions === "object" ? o.preconditions : o, today);
      const problem = preconditionsProblem(pre0, today);
      if (problem) throw new ApiError(problem);
      let raw = typeof o.reply === "string" ? o.reply : "";
      if (!raw.trim() && typeof o.answerRel === "string" && o.answerRel) {
        const abs = path.resolve(app.root, ...o.answerRel.split("/"));
        const inside = path.relative(path.join(app.root), abs).split(path.sep);
        if (inside.includes("..") || !inside.includes("_handoff") || !inside.includes("planes")) throw new ApiError("Esa ruta no es una respuesta de plan.");
        if (!fs.existsSync(abs)) throw new ApiError("La otra IA todavía no escribió su respuesta. Cuando termine, vuelve a pulsar este botón (o pega su respuesta).");
        raw = fs.readFileSync(abs, "utf-8");
      }
      if (!raw.trim()) throw new ApiError("Pega la respuesta de la otra IA o espera a que escriba el archivo.");
      if (studyIndexCold(app)) return { loading: true as const };
      if (jobs.has("generate")) throw new ApiError("Ya se está generando un plan. Espera a que termine o cancélalo.");
      const { pre, catalog, goals } = externalPlanScope(app, pre0, today);
      const parsed = parsePreconditionReply(raw, catalog, planContext(app, today));
      if (!parsed.ok) throw new ApiError(`No pude usar esa respuesta: ${parsed.reason}`);
      const { seeds, why } = seedsFromReply(parsed.reply, catalog, pre, new Map(goals.map((g) => [g.id, g.name])), goals);
      if (!seeds.length) throw new ApiError("La respuesta no trae ningún tema válido del catálogo. Pídele que use solo las carpetas (folder) que aparecen en el archivo.");
      const draft = composeFromPreconditions(markDiagnostics(seeds, pre), pre, { today, auto: false, rationale: parsed.reply.rationale, discarded: parsed.reply.discarded, why, startFocus: practiceStartFocus(app), practiceSuggestions: parsed.reply.practice });
      const created = acceptRef({ draft, proposed: true }) as { id: string };
      const name = planName(new PlanStore(app.root).load(created.id)!);
      const active = chats().peek();
      const chatLog = active && active.load().length === 0 ? active : chats().create();
      chatLog.append({ role: "user", content: "Plan creado con otra IA (Antigravity / chat)." });
      const text = draft.rationale || `Plan del ${draft.start} al ${draft.end}: ${draft.subplans.length} subplanes`;
      const next = chatLog.append({ role: "assistant", content: `Plan creado: ${name}. ${draft.rationale}`.trim(), createdPlan: created.id });
      return { loading: false as const, kind: "plan_created" as const, source: "ai" as const, text, planId: created.id, planDraft: draft, turns: next, pending: pendingDraft(next)?.id ?? null, chatId: chatLog.record().id };
    },

    /**
     * Un plan con el estado de práctica DERIVADO en vivo (por defecto, el activo hoy). Al leerlo anota (una sola
     * vez) la fecha de los temas que ya están completos: es el registro de temas completados. `items` es lo que
     * toca hoy en TODOS los planes activos.
     */
    mentor_plan_get(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      let wanted = "";
      if (o.id) {
        wanted = String(o.id);
        if (!PLAN_ID_RE.test(wanted)) throw new ApiError("Plan inválido.");
      } else if (o.month) {
        wanted = String(o.month);
        if (!MONTH_RE.test(wanted)) throw new ApiError("Mes inválido (AAAA-MM).");
      }
      if (studyIndexCold(app)) return { loading: true as const };
      const st = new PlanStore(app.root);
      const plans = st.list();
      const snapMap = new Map(topicSnaps(app).map((t) => [t.folder, t]));
      const rows = sortRows(plans.map((p) => planRow(p, today, (f) => snapMap.get(f))));
      const aiConfigured = aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null;
      let plan = wanted ? st.load(wanted) : defaultPlan(plans, today);

      const snaps = snapMap;
      const lookup = (folder: string) => snaps.get(folder);
      const active = activePlans(plans, today);
      const done = new Set(active.flatMap((p) => p.subplans.flatMap((s) => s.topics.filter((t) => topicState(lookup(t.folder) ?? null) === "completo").map((t) => t.folder))));
      const items = planItemsFor(today, active, (f) => done.has(f), true);
      const practiceItems = todaysPracticeItems(app, today);
      const months = st.months();
      if (!plan) {
        return { loading: false as const, id: wanted || null, month: wanted && MONTH_RE.test(wanted) ? wanted : today.slice(0, 7), today, plan: null, derived: null, goals: {}, projects: {}, items, practiceItems, practice: null, months, plans: rows, aiConfigured };
      }

      const refreshed = refreshPlanProgress(plan, lookup, today);
      if (refreshed.changed) plan = st.save(refreshed.plan);
      const practice = practiceStatusOf(app, plan, today, log());
      const derived = deriveView(plan, lookup, today);
      const plannedFolders = plan.subplans.flatMap((s) => s.topics.map((t) => t.folder));
      const freshness = outdatedByFolder(app.root, plannedFolders);
      const practiceOutdated = Object.fromEntries(plannedFolders.flatMap((folder) => {
        const stale = freshness.get(folder);
        const snap = lookup(folder);
        const hasTheory = !!snap && snap.theoryNotes > 0;
        return stale?.exercises || stale?.practica || (hasTheory && snap.exerciseCount === 0) ? [[folder, true]] : [];
      }));

      const m = app.mgrs();
      const dayStart = midnight();
      const goals: Record<string, { name: string; pct: number; items: Record<string, { name: string; pct: number }> }> = {};
      for (const s of plan.subplans) {
        for (const id of [s.goalId, ...s.requiredGoals.map((g) => g.goalId)]) {
          if (!id || goals[id]) continue;
          const g = m.goals.get_goal(id);
          if (!g) continue;
          const goalItems: Record<string, { name: string; pct: number }> = {};
          for (const it of m.goals.items(id)) goalItems[it.id] = { name: it.name, pct: Math.round(Math.max(0, Math.min(1, m.goals.itemProgress(it, g, dayStart))) * 100) };
          goals[id] = { name: g.name, pct: Math.round(Math.max(0, Math.min(1, m.goals.progress(g, dayStart))) * 100), items: goalItems };
        }
      }
      const projects: Record<string, { id: string; name: string; status: string }> = {};
      for (const s of plan.subplans) {
        const pid = s.deliverable?.projectId;
        const p = pid ? m.projects.get(pid) : null;
        if (pid && p) projects[pid] = { id: p.id, name: p.name, status: p.status };
      }
      return {
        loading: false as const,
        id: plan.id,
        month: plan.month ?? plan.start.slice(0, 7),
        today,
        status: planStatus(plan, today),
        plan,
        derived,
        goals,
        projects,
        items,
        practiceItems,
        practice,
        dailyProjectDone: dailyProjectDoneOf(app.root, plan),
        practiceOutdated,
        months,
        plans: rows,
        aiConfigured,
      };
    },

    /**
     * "Aceptar plan": el ÚNICO camino de escritura de los planes. No se fía del reparto que mande la UI:
     * vuelve a validar los temas contra los que existen AHORA (los inventados se descartan), las metas y
     * los proyectos, y recalcula el reparto semanal (con la capacidad de las precondiciones, si las hay).
     * Un borrador mensual (sin precondiciones) se fusiona con el plan que ya hubiera ese mes; uno con
     * precondiciones crea el plan `<inicio>_<fin>` (o se fusiona con el de ese mismo periodo).
     */
    mentor_plan_draft_accept(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const turn = o.turnId ? chatFor(o.chatId)?.load().find((t) => t.id === String(o.turnId)) : undefined;
      const d = (turn?.planDraft ?? (o.draft && typeof o.draft === "object" ? o.draft : null)) as Record<string, any> | null;
      if (!d || !Array.isArray(d.subplans) || !d.subplans.length) throw new ApiError("El borrador del plan no tiene subplanes.");
      const today = localDate();
      const pre: PlanPreconditions | null = d.preconditions && typeof d.preconditions === "object" ? sanitizePreconditions(d.preconditions, today) : null;
      const hoursPerWeek = Number(d.hoursPerWeek);
      if (!pre && !(hoursPerWeek > 0)) throw new ApiError("Horas por semana inválidas.");
      if (pre) {
        const problem = preconditionsProblem(pre, today);
        if (problem) throw new ApiError(problem);
      }
      const win = planWindow(typeof d.month === "string" ? d.month : undefined, today);
      const ctx = planContext(app, today);
      const goalById = new Map(ctx.goals.map((g) => [g.id, g]));
      const projectIds = new Set(ctx.projects.map((p) => p.id));
      const snaps = new Map(topicSnaps(app).map((t) => [t.folder, t]));
      // las ramas excluidas no entran aunque el borrador las traiga (salvo lo que enlaza una meta elegida)
      const linked = new Set(pre?.branches ? goalScopes(app).filter((g) => pre.goalIds.includes(g.id)).flatMap((g) => g.items.flatMap((i) => i.links.map((l) => l.folder))) : []);

      let seeds: SubplanSeed[] = [];
      for (const s of d.subplans.slice(0, 12) as any[]) {
        const seen = new Set<string>();
        const topics: SubplanSeed["topics"] = [];
        // plan por áreas: el área y sus grupos internos viajan con el borrador (se revalidan: solo ids de área seguros y grupos conocidos)
        const areaId = /^[a-z][a-z0-9-]{0,39}$/.test(String(s?.areaId ?? "")) ? String(s.areaId) : undefined;
        const groups = areaId ? sanitizeGroups(s?.groups) : [];
        for (const t of (Array.isArray(s?.topics) ? s.topics : []).slice(0, 400) as any[]) {
          const folder = String(t?.folder ?? "").replace(/\\/g, "/");
          const snap = snaps.get(folder);
          if (!snap || seen.has(folder)) continue;
          if (pre && !branchAllowed(pre.branches, areaOfFolder(folder), branchOfFolder(folder)) && !linked.has(folder)) continue;
          seen.add(folder);
          const valid = new Set(Object.keys(snap.progress.skills));
          const skills = Array.isArray(t.skills) ? t.skills.map((x: unknown) => String(x).toLowerCase()).filter((x: string) => valid.has(x)) : [];
          const base = estimateTopicMinutes(snap);
          const group = groups.some((g) => g.id === String(t?.group)) ? String(t.group) : undefined;
          const rt = sanitizeRouteFields(t);
          topics.push({ folder, title: snap.title, ...(skills.length ? { skills } : {}), estMinutes: pre ? adjustedMinutes(base, areaOfFolder(folder), pre.levels) : base, ...(group ? { group } : {}), ...rt });
        }
        const goalId = goalById.has(String(s?.goalId)) ? String(s.goalId) : undefined;
        const requiredGoals = (Array.isArray(s?.requiredGoals) ? s.requiredGoals : [])
          .filter((g: any) => goalById.has(String(g?.goalId)))
          .map((g: any) => ({ goalId: String(g.goalId), ...(goalById.get(String(g.goalId))!.items.some((i) => i.id === String(g.itemId)) ? { itemId: String(g.itemId) } : {}), note: String(g.note ?? "") }));
        const dv = s?.deliverable && typeof s.deliverable === "object" ? s.deliverable : null;
        const deliverable = dv && String(dv.title ?? "").trim() && (!pre || pre.deliverables !== "no")
          ? { title: String(dv.title), description: String(dv.description ?? ""), criteria: Array.isArray(dv.criteria) ? dv.criteria.map(String) : [], ...(projectIds.has(String(dv.projectId)) ? { projectId: String(dv.projectId) } : {}), status: "idea" as DeliverableStatus }
          : undefined;
        if (!topics.length && !deliverable) continue;
        const weight = Number(d.weights && typeof d.weights === "object" ? d.weights[String(s?.id)] : 0);
        // las notas que ya trae el subplan (razón del Mentor, aviso de «completado con reglas»); la nota de diagnóstico se vuelve a derivar
        const keepNote = String(s?.notes ?? "").replace(/Nivel «no sé» en [^:]+: empieza con un diagnóstico corto de «[^»]*» para calibrar el resto\.\s*/g, "").trim();
        const fb = s?.fallback && (s.fallback.kind === "rules" || s.fallback.kind === "mixed") ? { kind: s.fallback.kind as "rules" | "mixed", reason: String(s.fallback.reason ?? "").replace(/s+/g, " ").trim().slice(0, 240) } : undefined;
        seeds.push({ ...(/^[A-Za-z0-9_-]{1,40}$/.test(String(s?.id ?? "")) ? { id: String(s.id) } : {}), area: String(s?.area ?? ""), objective: String(s?.objective ?? ""), ...(goalId ? { goalId } : {}), topics, requiredGoals, ...(deliverable ? { deliverable } : {}), ...(weight > 0 ? { weight } : {}), ...(keepNote ? { notes: keepNote.slice(0, 400) } : {}), ...(areaId ? { areaId } : {}), ...(groups.length ? { groups } : {}), ...(fb ? { fallback: fb } : {}) });
      }
      if (!seeds.length) throw new ApiError("Ninguno de los temas del borrador existe ya en tu sistema.");
      if (pre) seeds = markDiagnostics(seeds, pre);

      const st = new PlanStore(app.root);
      const from = pre ? (today > pre.start ? today : pre.start) : win.from;
      // la pista de práctica se recalcula aquí (determinista): del borrador solo se aceptan temas y focos validados
      const practice = pre?.practice ? buildPracticeTrack(pre, { from, startFocus: practiceStartFocus(app), suggestions: suggestionsOf(sanitizePracticeTrack(d.programmingPractice, pre.start, pre.end)) }) : undefined;
      // cómo se combinan las áreas y los lenguajes con práctica propia se resuelven aquí (la UI no decide): lo elegido, la propuesta del borrador o las reglas
      const seedAreaIds = seeds.map((s) => s.areaId).filter((a): a is string => !!a);
      const areaInfo = pre && seeds.length > 0 && seedAreaIds.length === seeds.length ? resolveAreaMode(pre.areaMode, seedAreaIds, { mode: d.areaMode, why: d.areaModeWhy, by: d.areaModeBy }) : undefined;
      const preEff = pre && pre.languages !== undefined ? { ...pre, languages: resolveLanguages(pre.languages, seedAreaIds) } : pre;
      const built = preEff
        ? buildPlan(seeds, {
            id: `${preEff.start}_${preEff.end}`,
            start: preEff.start,
            end: preEff.end,
            minutesPerDay: preEff.minutesPerDay,
            studyDays: preEff.studyDays,
            blockedDates: preEff.blockedDates,
            pace: preEff.pace,
            from,
            preconditions: preEff,
            ...(areaInfo ? { areaMode: areaInfo.mode, areaModeWhy: areaInfo.why, areaModeBy: areaInfo.by } : {}),
            ...(practice ? { programmingPractice: practice, reservedMinutes: practiceDayMinutes(practice, { blockedDates: preEff.blockedDates, from }) } : {}),
            ...(Array.isArray(d.openQuestions) ? { openQuestions: d.openQuestions } : {}),
            ...(d.auto ? { auto: true } : {}),
            ...(d.compact === true ? { spread: false } : {}),
            rationale: String(d.rationale ?? ""),
          })
        : buildPlan(seeds, { month: win.month, hoursPerWeek, from, rationale: String(d.rationale ?? "") });
      let saved: Plan;
      // el proyecto de aplicación de cada tema, calibrado con el nivel declarado y lo medido (los planes por áreas nuevos lo llevan desde el principio)
      const planned = built.plan.structure === "areas" ? withTopicProjects(built.plan, masteryLookup(app)) : built.plan;
      if (o.proposed === true) {
        // plan real «propuesto»: nunca se fusiona con otro; si el id está ocupado, se le añade un sufijo
        let pid = planned.id;
        for (let n = 2; st.load(pid); n++) pid = `${planned.id}-${n}`;
        saved = st.save({ ...planned, id: pid, proposed: true });
      } else saved = st.save(mergePlans(st.load(planned.id), planned));
      if (turn) chatFor(o.chatId)?.patch(turn.id, { acceptedPlan: saved.id });
      return {
        id: saved.id,
        month: saved.month ?? saved.start.slice(0, 7),
        start: saved.start,
        end: saved.end,
        subplans: saved.subplans.length,
        topics: saved.subplans.reduce((n, s) => n + s.topics.length, 0),
        warnings: built.warnings,
        fits: built.fits,
      };
    },

    /**
     * Responde una pregunta pendiente del BORRADOR (hoy: «¿quieres un entregable para <subplan>?»). Determinista y sin
     * IA: `yes` añade la propuesta de entregable al subplan, `no` la descarta y `later` la deja pendiente. Solo edita
     * el turno del borrador; el plan se escribe al aceptarlo. Es el punto de extensión de la construcción progresiva.
     */
    mentor_plan_draft_answer(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const chat = chatFor(o.chatId);
      const turn = chat?.load().find((t) => t.id === String(o.turnId ?? ""));
      const draft = turn?.planDraft;
      if (!chat || !turn || !draft) throw new ApiError("Ese borrador ya no existe.");
      if (turn.acceptedPlan || turn.discarded) throw new ApiError("Ese borrador ya se cerró.");
      const questionId = String(o.questionId ?? "deliverables");
      if (questionId !== "deliverables") throw new ApiError("Pregunta desconocida.");
      const answer = String(o.answer ?? "");
      if (!["yes", "no", "later"].includes(answer)) throw new ApiError("Respuesta inválida (yes, no o later).");
      // sin `subplanId` es la pregunta GLOBAL («¿un entregable por cada área?»); con él, la de un subplan (planes antiguos) o una excepción por área
      const subplanId = String(o.subplanId ?? "");
      if (subplanId && !draft.subplans.some((s) => s.id === subplanId)) throw new ApiError("Ese subplan ya no existe en el borrador.");
      let next = draft;
      if (answer !== "later") {
        const r = answerDeliverables(draft.subplans, draft.openQuestions, subplanId, answer as "yes" | "no");
        next = { ...draft, subplans: r.subplans, openQuestions: r.openQuestions };
        if (!next.openQuestions!.length) delete next.openQuestions;
      }
      const turns = chat.patch(turn.id, { planDraft: next });
      return { turns, pending: pendingDraft(turns ?? [])?.id ?? null, planDraft: next };
    },
    /** "Descartar" el borrador del plan: no escribe ningún plan; solo marca el borrador. */
    mentor_plan_draft_discard: discardPlanDraft,
    mentor_plan_discard: discardPlanDraft,

    /** Lo único editable del plan desde el Mentor: el estado del entregable de un subplan (y su proyecto). */
    mentor_plan_update_deliverable(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? o.month ?? "");
      if (o.month && !o.id && !MONTH_RE.test(id)) throw new ApiError("Mes inválido (AAAA-MM).");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      // El ESTADO de un entregable lo calcula la app a partir de lo que el estudiante completa (cadena diario → semanal → mensual): aquí no se
      // puede fijar. Solo se aceptan archivos y el proyecto enlazado; un `status` que no coincida con el calculado se rechaza.
      const raw = o.status === undefined || o.status === null ? "" : String(o.status);
      if (raw && !(DELIVERABLE_STATUSES as readonly string[]).includes(raw) && !(PLAN_DELIVERABLE_STATUSES as readonly string[]).includes(raw)) throw new ApiError("Estado de entregable inválido.");
      const refuse = (): never => {
        throw new ApiError("El estado de los entregables se calcula solo según lo que completas: no se puede marcar a mano.");
      };
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const deliverableId = String(o.deliverableId ?? "");
      // un entregable de la agenda (kata del día, proyecto semanal o mensual, extra) o el de un área por su id `area:<subplan>`
      const subId = deliverableId.startsWith("area:") ? deliverableId.slice(5) : String(o.subplanId ?? "");
      if (deliverableId && !deliverableId.startsWith("area:")) {
        const derived = deliverablesOf(plan, { weeks: [], ...(practiceStatusOf(app, plan, localDate(), log()) ?? {}), dailyProjectDone: dailyProjectDoneOf(app.root, plan) });
        const d = derived.find((x) => x.id === deliverableId);
        if (!d) throw new ApiError("Ese entregable ya no existe en el plan.");
        if (raw && (raw === "idea" ? "pendiente" : raw) !== d.status) refuse();
        const files = Array.isArray(o.files) ? (o.files as any[]).slice(0, 12).map((f) => ({ ...(f?.path ? { path: String(f.path).slice(0, 300) } : {}), note: String(f?.note ?? "").slice(0, 200) })) : d.files;
        const entry = { ...d, ...(files?.length ? { files } : {}) };
        const list = [...(plan.deliverables ?? []).filter((x) => x.id !== deliverableId), entry];
        return st.save({ ...plan, deliverables: list, updatedAt: new Date().toISOString() });
      }
      const sub = plan.subplans.find((s) => s.id === subId);
      if (!sub) throw new ApiError("Ese subplan ya no existe.");
      if (!sub.deliverable) throw new ApiError("Ese subplan no tiene entregable.");
      let projectId = sub.deliverable.projectId;
      if (o.projectId !== undefined) {
        const wanted = o.projectId === null ? "" : String(o.projectId);
        if (wanted && !app.mgrs().projects.get(wanted)) throw new ApiError("Ese proyecto no existe.");
        projectId = wanted || undefined;
      }
      if (raw && raw !== sub.deliverable.status && !(raw === "pendiente" && sub.deliverable.status === "idea")) refuse();
      sub.deliverable = { ...sub.deliverable, ...(projectId ? { projectId } : {}) };
      if (!projectId) delete sub.deliverable.projectId;
      plan.updatedAt = new Date().toISOString();
      return st.save(plan);
    },

    /**
     * Responde, sobre el plan YA GUARDADO, una pregunta que quedó pendiente al armarlo (hoy: «¿quieres un entregable para <subplan>?»,
     * la opción «Después»). `yes` añade la propuesta determinista de entregable (estado «idea»), `no` descarta la pregunta y `later`
     * la deja. Es lo único que cambia: ni temas ni reparto.
     */
    mentor_plan_answer(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const questionId = String(o.questionId ?? "deliverables");
      if (questionId !== "deliverables") throw new ApiError("Pregunta desconocida.");
      const answer = String(o.answer ?? (o.deliverable === true ? "yes" : o.deliverable === false ? "no" : ""));
      if (!["yes", "no", "later"].includes(answer)) throw new ApiError("Respuesta inválida (yes, no o later).");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      // sin `subplanId` es la pregunta GLOBAL de entregables del plan por áreas; con él, la de un subplan (planes antiguos)
      const subplanId = String(o.subplanId ?? "");
      if (subplanId && !plan.subplans.some((s) => s.id === subplanId)) throw new ApiError("Ese subplan ya no existe en el plan.");
      if (!(plan.openQuestions ?? []).some((q) => q.id === questionId && (q.subplanId ?? "") === subplanId)) throw new ApiError("Esa pregunta ya no está pendiente.");
      if (answer === "later") return plan;
      const r = answerDeliverables(plan.subplans, plan.openQuestions, subplanId, answer as "yes" | "no");
      const { openQuestions: _q, ...base } = plan;
      return st.save({ ...base, subplans: r.subplans, ...(r.openQuestions.length ? { openQuestions: r.openQuestions } : {}), updatedAt: new Date().toISOString() });
    },

    /**
     * Excepción por área tras la pregunta global: añade o quita el entregable (el proyecto) de UN área. Solo se quita si sigue en «idea»
     * (un entregable ya empezado o hecho no se borra por error).
     */
    mentor_plan_area_deliverable(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      const sub = plan?.subplans.find((s) => s.id === String(o.subplanId ?? ""));
      if (!plan || !sub) throw new ApiError("Ese área ya no existe en el plan.");
      if (o.enabled === true) {
        if (sub.deliverable) return plan;
        const d = defaultDeliverableFor(sub);
        sub.deliverable = { title: d.title ?? "", description: d.description ?? "", criteria: d.criteria ?? [], status: "idea" };
      } else {
        if (!sub.deliverable) return plan;
        if (sub.deliverable.status !== "idea") throw new ApiError("Ese entregable ya está en marcha: cambia su estado en lugar de quitarlo.");
        delete sub.deliverable;
      }
      plan.updatedAt = new Date().toISOString();
      return st.save(plan);
    },

    /** Escribe (o borra, con texto vacío) el propósito de un día, una semana o un mes. Es una edición directa, sin pasar por la IA. */
    mentor_plan_set_purpose(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const scope = String(o.scope ?? "");
      const key = String(o.key ?? "");
      const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      const weeks = Math.floor((Date.parse(plan.end) - Date.parse(plan.start)) / 86400000 / 7) + 1;
      const ok =
        scope === "day" ? /^\d{4}-\d{2}-\d{2}$/.test(key) && key >= plan.start && key <= plan.end
        : scope === "week" ? /^\d{1,3}$/.test(key) && Number(key) >= 1 && Number(key) <= weeks
        : scope === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/.test(key) && key >= plan.start.slice(0, 7) && key <= plan.end.slice(0, 7)
        : false;
      if (!ok) throw new ApiError("Ese día, semana o mes no está en el plan.");
      const purposes = JSON.parse(JSON.stringify(plan.purposes ?? {})) as NonNullable<Plan["purposes"]>;
      const bag = ((purposes as any)[scope] ??= {}) as Record<string, string>;
      if (text) bag[key] = text;
      else delete bag[key];
      if (!Object.keys(bag).length) delete (purposes as any)[scope];
      const { purposes: _p, ...base } = plan;
      return st.save({ ...base, ...(Object.keys(purposes).length ? { purposes } : {}), updatedAt: new Date().toISOString() });
    },

    // ── Ritmo diario y extras del día (ver lib/planPace.ts) ──

    /**
     * Fija (o quita, con `pace` vacío o nulo) el RITMO DIARIO del plan: temas por día y mínimo diario, global y por área. Enteros 0..20; el mínimo
     * no puede superar los temas por día. Sin ritmo manda el reparto automático por minutos. Devuelve el plan; la UI sube `planVersion`.
     */
    mentor_plan_pace_set(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      let pace;
      try {
        pace = parsePace(o.pace, plan.subplans.map((s) => s.id));
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      const { pace: _old, ...base } = plan;
      return st.save({ ...base, ...(pace ? { pace } : {}), updatedAt: new Date().toISOString() });
    },

    /**
     * Añade un TEMA EXTRA a un día (por defecto hoy): uno de la ruta que está más adelante (se adelanta por decisión del estudiante) o un tema de
     * la vault que no está en el plan. `area` (id de subplan) atribuye un tema de la vault a un área; sin él va al cubo «Extra».
     */
    mentor_plan_extra_topic_add(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      const date = extraDate(plan, o.date);
      const folder = String(o.folder ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
      if (!folder) throw new ApiError("Falta el tema que quieres añadir.");
      const area = String(o.area ?? "").trim();
      if (area && !plan.subplans.some((s) => s.id === area)) throw new ApiError("Ese área ya no existe en el plan.");
      if ((plan.extraTopics ?? []).some((e) => e.date === date && e.folder === folder)) throw new ApiError("Ese tema ya está añadido a ese día.");
      const hit = plan.subplans.flatMap((s) => s.topics.map((t) => ({ s, t }))).find((x) => x.t.folder === folder);
      const route = !!hit && isLive(hit.t);
      let title: string | undefined;
      if (route) {
        if (hit!.t.completedAt) throw new ApiError("Ese tema ya está completo.");
      } else {
        if (studyIndexCold(app)) throw new ApiError("El índice de la vault aún se está preparando: inténtalo de nuevo en un momento.");
        const snap = topicSnaps(app).find((t) => t.folder === folder);
        if (!snap && !hit) throw new ApiError("Ese tema no existe en la vault.");
        title = snap?.title ?? hit?.t.title;
      }
      const est = Math.round(Number(o.estMinutes));
      const entry = {
        date,
        folder,
        ...(!route ? { ...(area ? { area } : {}), ...(title ? { title } : {}), ...(est > 0 ? { estMinutes: Math.min(600, est) } : {}) } : {}),
        addedAt: new Date().toISOString(),
        source: "manual" as const,
      };
      return st.save({ ...plan, extraTopics: [...(plan.extraTopics ?? []), entry], updatedAt: new Date().toISOString() });
    },

    /** Quita un tema extra de un día. El tema vuelve a su sitio en la ruta (si era de la ruta) o desaparece de la agenda (si era de la vault). */
    mentor_plan_extra_topic_remove(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      const date = String(o.date ?? "");
      const folder = String(o.folder ?? "");
      const left = (plan.extraTopics ?? []).filter((e) => !(e.date === date && e.folder === folder));
      if (left.length === (plan.extraTopics ?? []).length) throw new ApiError("Ese tema extra ya no está en ese día.");
      const { extraTopics: _x, ...base } = plan;
      return st.save({ ...base, ...(left.length ? { extraTopics: left } : {}), updatedAt: new Date().toISOString() });
    },

    /** Añade un elemento de PRÁCTICA DIARIA extra a un día (por defecto hoy): kata, ejercicio de un tema o texto libre. */
    mentor_plan_extra_practice_add(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      const date = extraDate(plan, o.date);
      const item = extraPracticeFields(plan, o, { date, id: `xp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }, true);
      // la práctica ligada a un archivo o a un kata planeado no se repite en el mismo día
      const same = (plan.extraPractice ?? []).some((x) => x.date === date && ((item.rel && x.rel === item.rel) || (item.kataDate && x.kataDate === item.kataDate && (x.area ?? "") === (item.area ?? ""))));
      if (same) throw new ApiError("Esa práctica ya está añadida a ese día.");
      return st.save({ ...plan, extraPractice: [...(plan.extraPractice ?? []), item], updatedAt: new Date().toISOString() });
    },

    /** Edita un elemento de práctica extra (título, minutos, nota, tipo, fecha, área) o lo marca hecho (`done`). */
    mentor_plan_extra_practice_update(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      const id = String(o.practiceId ?? "");
      const cur = (plan.extraPractice ?? []).find((x) => x.id === id);
      if (!cur) throw new ApiError("Esa práctica ya no existe.");
      const next = extraPracticeFields(plan, o, cur, false);
      return st.save({ ...plan, extraPractice: (plan.extraPractice ?? []).map((x) => (x.id === id ? next : x)), updatedAt: new Date().toISOString() });
    },

    mentor_plan_extra_practice_remove(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { st, plan } = paceTarget(o);
      const id = String(o.practiceId ?? "");
      const left = (plan.extraPractice ?? []).filter((x) => x.id !== id);
      if (left.length === (plan.extraPractice ?? []).length) throw new ApiError("Esa práctica ya no existe.");
      const { extraPractice: _x, ...base } = plan;
      return st.save({ ...base, ...(left.length ? { extraPractice: left } : {}), updatedAt: new Date().toISOString() });
    },

    /**
     * Candidatos para añadir como tema extra: los SIGUIENTES temas de la ruta (más adelante, en orden; `area` = id de subplan para acotar) y los
     * demás temas de la vault que no están en el plan. `query` filtra por título o carpeta (sin tildes). Solo lee.
     */
    mentor_plan_topic_candidates(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { plan } = paceTarget(o);
      const area = String(o.area ?? "").trim();
      if (o.upcoming === true) return upcomingTopics(plan, area, o);
      if (studyIndexCold(app)) return { loading: true as const };
      const q = fold(String(o.query ?? "").trim());
      const limit = Math.max(1, Math.min(100, Math.round(Number(o.limit)) || 30));
      const match = (title: string, folder: string): boolean => !q || fold(title).includes(q) || fold(folder).includes(q);
      const added = new Map<string, string[]>();
      for (const e of plan.extraTopics ?? []) added.set(e.folder, [...(added.get(e.folder) ?? []), e.date]);
      const planFolders = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
      type Ahead = { folder: string; title: string; area: string; subplanId: string; inPlan: true; position: number; total: number; estMinutes: number; targetWeek: number; addedDates: string[] };
      const bySub: Ahead[][] = [];
      for (const s of plan.subplans) {
        if (area && s.id !== area) continue;
        const live = s.topics.filter((t) => isLive(t));
        const rows: Ahead[] = [];
        live.forEach((t, i) => {
          if (t.completedAt || !match(t.title, t.folder)) return;
          rows.push({ folder: t.folder, title: t.title, area: s.area, subplanId: s.id, inPlan: true, position: i + 1, total: live.length, estMinutes: t.estMinutes, targetWeek: t.targetWeek, addedDates: added.get(t.folder) ?? [] });
        });
        if (rows.length) bySub.push(rows);
      }
      // los siguientes de la ruta, intercalando las áreas para que una no tape a las demás
      const ahead: Ahead[] = [];
      for (let i = 0; ahead.length < limit && bySub.some((l) => l.length > i); i++) for (const l of bySub) if (l[i] && ahead.length < limit) ahead.push(l[i]!);
      const vault = topicSnaps(app)
        .filter((t) => !planFolders.has(t.folder) && match(t.title, t.folder))
        .slice(0, limit)
        .map((t) => ({ folder: t.folder, title: t.title, subject: t.subject, inPlan: false as const, addedDates: added.get(t.folder) ?? [] }));
      return { loading: false as const, ahead, vault };
    },

    /**
     * «Más práctica»: los ejercicios YA PLANEADOS de los temas de la ruta (las notas de ejercicio de la carpeta de cada tema) que aún no tienen ningún
     * intento, en el orden de la ruta de cada área y con el día en que cae su tema. `area` (id de subplan) acota; `limit` por área (8). Solo lee.
     */
    mentor_plan_exercise_candidates(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const { plan } = paceTarget(o);
      if (studyIndexCold(app)) return { loading: true as const };
      const area = String(o.area ?? "").trim();
      const limit = Math.max(1, Math.min(40, Math.round(Number(o.limit)) || 8));
      const { placed } = placementOf(plan);
      const attempts = loadAllAttempts(app.root);
      const tried = (id: string): boolean => {
        const e = (attempts as Record<string, any>)[id];
        return (Array.isArray(e) ? e : Array.isArray(e?.attempts) ? e.attempts : []).length > 0;
      };
      const exercises = vaultScan(app).exercises.map((e) => ({ ...e, relp: (e.rel || e.path).replace(/\\/g, "/") }));
      const added = new Map<string, string[]>();
      for (const x of plan.extraPractice ?? []) if (x.rel) added.set(x.rel, [...(added.get(x.rel) ?? []), x.date]);
      const out: Array<Record<string, unknown>> = [];
      for (const s of plan.subplans) {
        if (area && s.id !== area) continue;
        let n = 0;
        for (const t of s.topics.filter((x) => isLive(x) && !x.completedAt)) {
          const prefix = `${t.folder}/`;
          for (const ex of exercises.filter((e) => e.relp.startsWith(prefix)).sort((a, b) => a.relp.localeCompare(b.relp))) {
            if (n >= limit) break;
            if (tried(ex.note_id)) continue;
            n++;
            const date = placed.get(t.folder)?.date;
            out.push({ subplanId: s.id, area: s.area, folder: t.folder, topic: t.title, rel: ex.relp, title: ex.title, difficulty: ex.difficulty, addedDates: added.get(ex.relp) ?? [], ...(date ? { date } : {}) });
          }
          if (n >= limit) break;
        }
      }
      return { loading: false as const, exercises: out };
    },

    /**
     * «Generar la práctica del plan con el Mentor»: crea el currículo de práctica del plan (`Plan.practiceCurriculum`: ejercicios por semana
     * ligados a los temas que se practican, retos de lógica, proyecto semanal, mini-proyectos diarios y proyecto mensual). Solo se ejecuta cuando
     * el usuario lo pide. Por bloques de semanas en paralelo limitado (timeouts, cancelación real con `mentor_ai_cancel` clave
     * `practice:<id>`, progreso en `mentor_ai_status`); si un bloque falla cae a plantillas; sin IA todo son plantillas marcadas como
     * automáticas. Los temas con ejercicios en la vault los prioriza la app. Queda en el historial de cambios con la instantánea previa:
     * «Deshacer» lo revierte (`mentor_plan_change_undo`).
     */
    async mentor_plan_practice_generate(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (!plan.subplans.some((s) => s.topics.length)) throw new ApiError("Este plan no tiene temas.");
      if (studyIndexCold(app)) return { loading: true as const };
      return guarded(`plan:${id}`, "practice", () =>
        withJob(`practice:${id}`, "Preparando la práctica del plan…", async (job) => {
          const today = localDate();
          // los proyectos de tema se calibran con lo MEDIDO antes de preparar la agenda (la IA ve el nivel máximo permitido de cada uno)
          const look = masteryLookup(app);
          const calibrated = plan.structure === "areas" ? withTopicProjects(plan, look) : plan;
          const sch = buildSchedule(progressPlan(calibrated, { today }));
          const folders = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
          const counts = new Map<string, number>();
          for (const ex of vaultScan(app).exercises) {
            const parts = ex.rel.replace(/\\/g, "/").split("/");
            for (let i = parts.length - 1; i > 0; i--) {
              const dir = parts.slice(0, i).join("/");
              if (folders.has(dir)) {
                counts.set(dir, (counts.get(dir) ?? 0) + 1);
                break;
              }
            }
          }
          const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
          const aiOn = o.noAi !== true && aiUnavailableReason(cfg) === null;
          const objective = plan.preconditions?.freeObjective?.trim().slice(0, 300) || plan.subplans.map((s) => s.area).slice(0, 5).join(" + ");
          const weekNow = Math.floor((Date.parse(today) - Date.parse(plan.start)) / 86400000 / 7) + 1;
          let res;
          try {
            res = await generateCurriculum(calibrated, sch, {
              send: (messages, so) => job.send(messages, so),
              aiOn,
              existing: { count: (f) => counts.get(f) ?? 0 },
              fromWeek: o.all === true ? 1 : Math.max(1, Math.min(weekNow, sch.weeks)),
              objective,
              cancelled: job.cancelled,
              onProgress: (_p, label) => job.setLabel(label),
            });
          } catch (e) {
            if (e instanceof CurriculumCancel || e instanceof CancelError) throw new ApiError("Cancelado.");
            throw e;
          }
          const hist = new ChangeStore(app.root);
          const prev = plan.practiceCurriculum;
          const merged = prev && res.curriculum.weeks.length ? { ...res.curriculum, weeks: [...prev.weeks.filter((w) => !res.curriculum.weeks.some((x) => x.week === w.week)), ...res.curriculum.weeks].sort((a, b) => a.week - b.week), monthly: [...prev.monthly.filter((m) => !res.curriculum.monthly.some((x) => x.month === m.month)), ...res.curriculum.monthly] } : res.curriculum;
          // lo que propuso la IA para los proyectos de tema se recorta al nivel permitido (nunca lo sube)
          const projected = plan.structure === "areas" ? withTopicProjects(calibrated, look, new Map(Object.entries(res.topicProjects))) : plan;
          const saved = st.save({ ...projected, practiceCurriculum: merged, updatedAt: new Date().toISOString() });
          const nW = res.curriculum.weeks.length;
          const entry = hist.append(id, {
            at: new Date().toISOString(),
            comment: "Generar la práctica del plan",
            status: "applied",
            source: res.aiUsed ? "ai" : "rules",
            summary: `Práctica del plan: ${nW} ${nW === 1 ? "semana" : "semanas"} ${res.aiUsed ? "con el Mentor" : "con plantillas automáticas"}${res.warnings.length ? ` (${res.warnings.length} ${res.warnings.length === 1 ? "bloque" : "bloques"} con plantillas)` : ""}.`,
            delta: { added: 0, removed: 0, moved: 0, deliverables: 0 },
            changed: [],
            warnings: res.warnings,
            fixOptions: [],
            before: plan,
          });
          return { loading: false as const, plan: saved, entry: viewOf(entry), history: hist.list(id).map(viewOf), aiUsed: res.aiUsed, calls: res.calls };
        }),
      );
    },

    /**
     * «Reorganizar por áreas»: convierte un plan de estructura antigua (un subplan por rama de carpeta) a áreas elementales con grupos y
     * fases. Solo se ejecuta cuando el usuario lo pide. Determinista, conserva lo completado y los comentarios, y queda en el historial de
     * cambios con la instantánea previa: «Deshacer» lo revierte (`mentor_plan_change_undo`).
     */
    mentor_plan_reorganize(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.structure === "areas") throw new ApiError("Este plan ya está organizado por áreas.");
      if (!canReorganize(plan)) throw new ApiError("Este plan no tiene temas que reorganizar.");
      const hist = new ChangeStore(app.root);
      const res = reorganizeByAreas(plan, { today: localDate(), startFocus: practiceStartFocus(app), goals: goalScopes(app) });
      if (!res) throw new ApiError("No se pudo reorganizar el plan.");
      const saved = st.save(res.plan);
      const entry = hist.append(id, {
        at: new Date().toISOString(),
        comment: "Reorganizar por áreas",
        status: "applied",
        source: "rules",
        summary: res.summary,
        delta: { added: 0, removed: res.dropped.length, moved: res.moved, deliverables: 0, structure: saved.subplans.length },
        changed: res.changed,
        warnings: res.warnings,
        fixOptions: [],
        before: plan,
        ...(saved.name !== plan.name ? { nameAfter: saved.name ?? "" } : {}),
      });
      return { plan: saved, entry: viewOf(entry), history: hist.list(id).map(viewOf), applied: true as const };
    },

    // ── Ruta del plan: qué temas toca estudiar de verdad y cuáles se saltan (SIN borrar notas) ──

    /**
     * `mentor_route({ planId? })`: la RUTA del plan activo (o de todos los activos si no se indica `planId`) para el explorador de notas y el
     * estudio con el Mentor. Por plan: cada tema con su `route` (`core` · `optional` · `skipped`), su semana objetivo y el inicio de esa semana.
     * `byFolder` junta todos los planes por carpeta de tema: un tema cuenta como `core`/`optional` si algún plan lo tiene en ruta y como
     * `skipped` solo si todos los que lo tienen lo saltan. Solo lee: nunca modifica ni borra notas.
     */
    mentor_route(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      const st = new PlanStore(app.root);
      let plans: Plan[];
      if (o.planId) {
        const id = String(o.planId);
        if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
        const p = st.load(id);
        if (!p) throw new ApiError("Ese plan ya no existe.");
        plans = [p];
      } else plans = activePlans(st.list(), today);
      const byFolder: Record<string, { planId: string; route: "core" | "optional" | "skipped"; targetWeek: number; weekStart: string; area: string; skippedReason?: string }> = {};
      const out = plans.map((p) => {
        const ranges = weekRangesOf(p.start, p.end);
        const topics: RouteEntry[] = routeOfPlan(p, (w) => ranges[Math.min(ranges.length, Math.max(1, w)) - 1]?.start ?? p.start);
        for (const t of topics) {
          const prev = byFolder[t.folder];
          if (!prev || (prev.route === "skipped" && t.route !== "skipped")) byFolder[t.folder] = { planId: p.id, route: t.route, targetWeek: t.targetWeek, weekStart: t.weekStart, area: t.area, ...(t.skippedReason ? { skippedReason: t.skippedReason } : {}) };
        }
        const cur = Math.min(ranges.length, Math.max(1, Math.floor((Date.parse(today) - Date.parse(p.start)) / 86400000 / 7) + 1));
        return {
          planId: p.id,
          name: planName(p),
          status: planStatus(p, today),
          start: p.start,
          end: p.end,
          currentWeek: cur,
          counts: { core: topics.filter((t) => t.route === "core").length, optional: topics.filter((t) => t.route === "optional").length, skipped: topics.filter((t) => t.route === "skipped").length },
          topics,
        };
      });
      return { today, plans: out, byFolder };
    },

    /**
     * «Reducir a lo esencial» (DETERMINISTA, bajo petición del usuario): `mentor_plan_reduce({ id, areaId, groupId?, max })` salta los temas menos
     * necesarios de un área (o de un grupo, p. ej. Bases 75 → 30) hasta dejar como máximo `max` en la ruta, según reglas (dominado/medido, nivel
     * básico ya declarado, lo cubre la práctica de lenguaje, lo último de la ruta) y SIN saltar nunca un prerrequisito. NO borra notas ni quita
     * los temas del plan: quedan «fuera de ruta», atenuados y reactivables (`mentor_plan_route_set`). Las cuentas, el reparto semanal y los
     * proyectos de tema se recalculan. Queda en el historial con la instantánea previa: «Deshacer» lo revierte (`mentor_plan_change_undo`).
     * Devuelve `MentorRouteChangeResult`: `{ plan, entry, history, changed, skipped: [{ folder, title, reason }], live, message }`.
     */
    mentor_plan_reduce(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const ref = String(o.areaId ?? o.subplanId ?? "");
      const sub = ref ? plan.subplans.find((s) => s.areaId === ref || s.id === ref) : plan.subplans.length === 1 ? plan.subplans[0] : undefined;
      if (!sub) throw new ApiError("Indica el área del plan que quieres reducir.");
      const group = o.groupId ? (sub.groups ?? []).find((g) => g.id === String(o.groupId)) : undefined;
      if (o.groupId && !group) throw new ApiError("Ese grupo no está en el área.");
      const scopeTopics = group ? sub.topics.filter((t) => t.group === group.id) : sub.topics;
      const max = Math.max(1, Math.min(400, Math.round(Number(o.max) || 30)));
      const hist = new ChangeStore(app.root);
      const label = `Reducir a lo esencial: ${group ? group.title : sub.area} → ${max} temas`;
      const res = applyOps(plan, [{ op: "reduce_essentials", subplan: sub.id, ...(group ? { group: group.id } : {}), max }], { today: localDate(), all: [], startFocus: practiceStartFocus(app), mastery: masteryLookup(app) });
      if (!res.applied) {
        const live = scopeTopics.filter((t) => routeOf(t) !== "skipped").length;
        throw new ApiError(res.warnings[0] ?? `Ya hay ${live} temas en la ruta de ${group ? group.title : sub.area}: no hace falta reducir.`);
      }
      const saved = st.save(res.plan);
      const before = new Map(plan.subplans.flatMap((s) => s.topics.map((t) => [t.folder, routeOf(t)] as const)));
      const skipped = saved.subplans.flatMap((s) => s.topics.filter((t) => routeOf(t) === "skipped" && before.get(t.folder) !== "skipped").map((t) => ({ folder: t.folder, title: t.title, reason: t.skippedReason ?? "Fuera de ruta" })));
      const mine = saved.subplans.find((s) => s.id === sub.id)!;
      const live = (group ? mine.topics.filter((t) => t.group === group.id) : mine.topics).filter((t) => routeOf(t) !== "skipped").length;
      const entry = hist.append(id, {
        at: new Date().toISOString(),
        comment: label,
        status: "applied",
        source: "rules",
        summary: `${skipped.length} ${skipped.length === 1 ? "tema queda fuera de ruta" : "temas quedan fuera de ruta"} (no se borró ninguno): quedan ${live} en la ruta de ${group ? group.title : sub.area}.`,
        delta: res.delta,
        changed: res.changed,
        warnings: res.warnings,
        fixOptions: [],
        before: plan,
      });
      return { plan: saved, entry: viewOf(entry), history: hist.list(id).map(viewOf), changed: skipped.length, skipped, live, message: entry.summary, applied: true as const };
    },

    /**
     * Cambia la ruta de unos temas del plan (`mentor_plan_route_set({ id, folders, route, reason?, label? })`): `skipped` (fuera de ruta, validado:
     * nunca salta un prerrequisito de un tema que se queda ni un tema completado), `optional` o `core` (reactivar). No borra notas. Recalcula el
     * reparto y los proyectos de tema; con historial y «Deshacer». Devuelve `MentorRouteChangeResult` (`rejected` = los que no se pudieron saltar).
     */
    mentor_plan_route_set(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const route = String(o.route ?? "");
      if (route !== "core" && route !== "optional" && route !== "skipped") throw new ApiError("Ruta inválida (core, optional o skipped).");
      const wanted = [...new Set((Array.isArray(o.folders) ? (o.folders as unknown[]) : []).map((f) => String(f ?? "").replace(/\\/g, "/")).filter(Boolean))].slice(0, 400);
      if (!wanted.length) throw new ApiError("Elige al menos un tema.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const known = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
      let ok = wanted.filter((f) => known.has(f));
      let rejected: Array<{ folder: string; reason: string }> = wanted.filter((f) => !known.has(f)).map((folder) => ({ folder, reason: "no es un tema del plan" }));
      if (route === "skipped") {
        const v = validateSkips(
          plan.subplans.flatMap((s) => s.topics.map((t) => ({ folder: t.folder, title: t.title, estMinutes: t.estMinutes, ...(t.group ? { group: t.group } : {}), ...(t.route ? { route: t.route } : {}), ...(t.completedAt ? { completedAt: t.completedAt } : {}) }))),
          ok,
        );
        ok = v.ok;
        rejected = [...rejected, ...v.rejected];
      }
      const current = new Map(plan.subplans.flatMap((s) => s.topics.map((t) => [t.folder, routeOf(t)] as const)));
      ok = ok.filter((f) => current.get(f) !== route);
      if (!ok.length) throw new ApiError(rejected.length ? `No se pudo cambiar la ruta: ${rejected[0]!.reason}.` : "Esos temas ya estaban así en tu ruta.");
      const hist = new ChangeStore(app.root);
      const reason = String(o.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || (route === "skipped" ? "Fuera de ruta por decisión tuya" : "");
      const res = applyOps(plan, [{ op: "set_route", folders: ok, route, ...(reason ? { reason } : {}) }], { today: localDate(), all: [], startFocus: practiceStartFocus(app), mastery: masteryLookup(app) });
      if (!res.applied) throw new ApiError("No cambió nada.");
      const saved = st.save(res.plan);
      const n = ok.length;
      const summary =
        route === "skipped"
          ? `${n} ${n === 1 ? "tema sale" : "temas salen"} de tu ruta. Las notas siguen en tu vault: nada se borra y puedes volver a añadirlos.`
          : route === "optional"
            ? `${n} ${n === 1 ? "tema pasa" : "temas pasan"} a opcionales.`
            : `${n} ${n === 1 ? "tema vuelve" : "temas vuelven"} a tu ruta.`;
      const entry = hist.append(id, {
        at: new Date().toISOString(),
        comment: String(o.label ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || (route === "skipped" ? `Sacar ${n} ${n === 1 ? "tema" : "temas"} de la ruta` : route === "optional" ? `Marcar ${n} ${n === 1 ? "tema" : "temas"} como opcionales` : `Añadir ${n} ${n === 1 ? "tema" : "temas"} a tu ruta`),
        status: "applied",
        source: "rules",
        summary,
        delta: res.delta,
        changed: res.changed,
        warnings: [...res.warnings, ...rejected.slice(0, 5).map((r) => `No se pudo cambiar «${r.folder.split("/").pop()}»: ${r.reason}.`)],
        fixOptions: [],
        before: plan,
      });
      const titleOf = new Map(saved.subplans.flatMap((s) => s.topics.map((t) => [t.folder, t.title] as const)));
      return {
        plan: saved,
        entry: viewOf(entry),
        history: hist.list(id).map(viewOf),
        changed: n,
        ...(route === "skipped" ? { skipped: ok.map((folder) => ({ folder, title: titleOf.get(folder) ?? folder, reason })) } : {}),
        ...(rejected.length ? { rejected } : {}),
        live: saved.subplans.reduce((c, s) => c + s.topics.filter((t) => routeOf(t) !== "skipped").length, 0),
        message: summary,
      };
    },

    /**
     * «Añadir al plan»: `mentor_plan_add_topics({ planId, folders, subplanId? })` lleva al plan los temas de referencia creados por el agente externo
     * («Crear con Antigravity»). Cada carpeta debe ser un tema real de la vault. Se añaden AL FINAL de la ruta de su área (html · css · js-reference →
     * Frontend; java → Java; el área se crea si el plan no la tiene), en el orden del catálogo, sin tocar los temas que ya hay. `subplanId` fuerza el
     * área destino. Idempotente (lo que ya está en el plan se omite), nunca sobre planes archivados, con entrada en el historial y «Deshacer».
     */
    mentor_plan_add_topics(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado: elige un plan activo.");
      const wanted = [...new Set((Array.isArray(o.folders) ? (o.folders as unknown[]) : []).map((f) => String(f ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim()).filter(Boolean))].slice(0, 400);
      if (!wanted.length) throw new ApiError("Elige al menos un tema.");
      const forced = String(o.subplanId ?? "").trim();
      if (forced && !plan.subplans.some((s) => s.id === forced)) throw new ApiError("Ese área ya no existe en el plan.");
      // destino por tema (subplan y grupo): lo usa la sincronización para que una pieza nueva entre donde están sus hermanas
      const placements = (o.placements && typeof o.placements === "object" ? o.placements : {}) as Record<string, { subplanId?: unknown; groupId?: unknown }>;
      const snaps = new Map(topicSnaps(app).map((t) => [t.folder, t] as const));
      const est = new Map(buildTopicCatalog([...snaps.values()], "", { max: 1_000_000 }).map((c) => [c.folder, c.estMinutes] as const));
      const areas = curriculumAreas();
      const items: AddTopicItem[] = [];
      const rejected: Array<{ folder: string; reason: string }> = [];
      for (const folder of wanted) {
        const snap = snaps.get(folder);
        if (!snap) {
          rejected.push({ folder, reason: "no es un tema de la vault (falta su manifiesto de práctica)" });
          continue;
        }
        const minutes = est.get(folder) ?? 45;
        const place = placements[folder];
        const placeSub = place && typeof place.subplanId === "string" && plan.subplans.some((x) => x.id === place.subplanId) ? place.subplanId : "";
        if (placeSub) {
          items.push({ folder, title: snap.title, estMinutes: minutes, subplanId: placeSub, ...(typeof place!.groupId === "string" && place!.groupId ? { groupId: place!.groupId } : {}) });
          continue;
        }
        if (forced) {
          items.push({ folder, title: snap.title, estMinutes: minutes, subplanId: forced });
          continue;
        }
        const areaId = curriculumAreaOfFolder(folder, areas);
        const target = (areaId ? CURRICULUM_PLAN_TARGET[areaId] : undefined) ?? knowledgeTargetOfFolder(folder);
        if (!target) rejected.push({ folder, reason: "no es de un área de referencia: elige el área del plan donde añadirlo" });
        else items.push({ folder, title: snap.title, estMinutes: minutes, target });
      }
      if (!items.length) throw new ApiError(`No se añadió nada: ${rejected[0]!.reason}.`);
      const res = addTopicsToPlan(plan, items);
      const skipped = [...rejected, ...res.skipped];
      if (!res.added.length) return { plan, added: [] as string[], skipped, created: [] as string[], changed: 0, message: "Esos temas ya estaban en el plan: no hay nada que añadir." };
      const subTitle = (sid: string): string => res.plan.subplans.find((x) => x.id === sid)?.area ?? sid;
      const bySub = new Map<string, number>();
      for (const a of res.added) bySub.set(a.subplanId, (bySub.get(a.subplanId) ?? 0) + 1);
      const labelOf = (folder: string): string => {
        const aid = curriculumAreaOfFolder(folder, areas);
        return (aid ? areas.find((a) => a.id === aid)?.title : undefined) ?? areas.find((a) => folder.startsWith(`${a.space}/${a.areaFolder}/`))?.title ?? "";
      };
      const kinds = [...new Set(res.added.map((a) => labelOf(a.folder)).filter(Boolean))];
      const n = res.added.length;
      const where = [...bySub.entries()].map(([sid]) => subTitle(sid)).join(" y ");
      let summary = `Se añadieron ${n} ${n === 1 ? "tema" : "temas"} de referencia${kinds.length ? ` (${kinds.join(", ")})` : ""} al área ${where}, al final de su ruta.${res.created.length ? ` Se creó el área ${res.created.map((c) => c.area).join(" y ")}.` : ""}`;
      // ORGANIZAR solo: lo recién añadido entra con su orden por números (tema general y luego sus piezas) y repartido en semanas con la capacidad real, no apilado al final
      const tidied = tidyPlan(res.plan);
      const finalPlan = tidied.plan;
      const organized = tidied.organized ? " Se organizó por números y se repartió en semanas." : "";
      summary += organized;
      const saved = st.save(finalPlan);
      const hist = new ChangeStore(app.root);
      const entry = hist.append(id, {
        at: new Date().toISOString(),
        comment: `Añadir ${n} ${n === 1 ? "tema" : "temas"} de referencia al plan`,
        status: "applied",
        source: "rules",
        kind: "adjust",
        summary,
        delta: { added: n, removed: 0, moved: 0, deliverables: 0, ...(res.created.length ? { structure: res.created.length } : {}) },
        changed: res.added.map((a) => a.folder),
        warnings: skipped.slice(0, 5).map((r) => `«${r.folder.split("/").pop()}»: ${r.reason}.`),
        fixOptions: [],
        before: plan,
      });
      return { plan: saved, entry: viewOf(entry), history: hist.list(id).map(viewOf), added: res.added.map((a) => a.folder), addedTo: [...bySub.keys()], skipped, created: res.created.map((c) => c.id), changed: n, message: summary };
    },

    /**
     * SINCRONIZAR lo nuevo de la vault con el plan, SOLO: los temas de las áreas de referencia (HTML, CSS, JavaScript Reference → Frontend; Java → Java) que existen en la
     * vault, no están en el plan y cuya área SÍ está en el plan, entran solos (con su asignatura y organizados por números, como «Añadir al plan»). Lo que la persona
     * quitó a mano no vuelve: cada tema solo se ofrece UNA vez (`.notevault/mentor/plan-sync/<plan>.json` recuerda lo ya ofrecido). Idempotente; nada en planes archivados.
     */
    /** SALUD del plan: lo que está mal respecto a la vault (temas que faltan, asignaturas sin repartir, secciones confusas, orden). Solo lee. */
    mentor_plan_health(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const plan = new PlanStore(app.root).load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (studyIndexCold(app)) return { loading: true as const };
      const file = path.join(app.root, ".notevault", "mentor", "plan-sync", `${id}.json`);
      const offered = new Set<string>(((store.loadJson(file, null) as { offered?: unknown } | null)?.offered as string[] | undefined) ?? []);
      return { loading: false as const, issues: healthOf(plan, offered) };
    },

    mentor_plan_sync_reference(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const plan = new PlanStore(app.root).load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived || plan.proposed) return { loading: false as const, added: [] as string[], message: "" };
      if (studyIndexCold(app)) return { loading: true as const };
      const areas = curriculumAreas();
      const inPlan = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
      const file = path.join(app.root, ".notevault", "mentor", "plan-sync", `${id}.json`);
      const offered = new Set<string>(((store.loadJson(file, null) as { offered?: unknown } | null)?.offered as string[] | undefined) ?? []);
      const planBorn = Date.parse(plan.createdAt) || 0;
      const newerThanPlan = (folder: string): boolean => {
        try {
          return fs.statSync(path.join(app.root, folder, `${folder.split("/").pop()}.md`)).mtimeMs >= planBorn;
        } catch {
          return false;
        }
      };
      const candidates = topicSnaps(app)
        .map((t) => t.folder)
        .filter((f) => {
          if (inPlan.has(f)) return false;
          const aid = curriculumAreaOfFolder(f, areas);
          const reference = aid ? CURRICULUM_PLAN_TARGET[aid] : undefined;
          if (reference) return !!findAreaSubplan(plan, reference);
          // un tema de conocimiento (`6 Databases/6.4.1 SELECT`) nuevo desde que existe el plan: solo si su área ya está en él (lo que el estudiante quitó antes del plan no vuelve)
          const knowledge = knowledgeTargetOfFolder(f);
          if (knowledge && findAreaSubplan(plan, knowledge)) return newerThanPlan(f);
          // lo que no es de una rama de conocimiento (los lenguajes 2.1 Python · 2.2 JavaScript · 2.3 TypeScript, los fundamentos…): entra si su ÁREA ya está en el plan,
          // junto a sus hermanos (mismo subplan y mismo grupo). Sin esto, las piezas nuevas de un lenguaje no entraban nunca y el aviso de «capítulos gruesos» no se iba.
          return !!siblingPlacement(plan, f) && newerThanPlan(f);
        });
      // el temario general (Markdown + JSON) se mantiene solo: cada sincronización lo deja al día con lo que hay en la vault y en el plan
      const refreshMaster = (p: Plan): void => {
        try {
          writeMasterSyllabus(app, { spaces: [...new Set(p.subplans.flatMap((s) => s.topics.map((t) => t.folder.split("/")[0] ?? "")).filter(Boolean))] });
        } catch {
          /* el temario general es una ayuda: si falla, la sincronización sigue */
        }
      };
      const fresh = candidates.filter((f) => !offered.has(f)).slice(0, 400);
      if (!fresh.length) {
        // nada nuevo que añadir, pero lo que ya está puede estar sin asignatura o sin orden (temas que entraron antes de esta regla): se ordena solo
        const t = tidyPlan(plan);
        if (!t.changed) {
          refreshMaster(plan);
          return { loading: false as const, added: [] as string[], message: "", health: healthOf(plan, offered) };
        }
        const saved = new PlanStore(app.root).save(t.plan);
        refreshMaster(saved);
        return { loading: false as const, added: [] as string[], message: "", tidied: true as const, plan: saved, health: healthOf(saved, offered) };
      }
      const placements: Record<string, { subplanId: string; groupId?: string }> = {};
      for (const f of fresh) {
        // solo lo que NO tiene destino propio (área de referencia o rama de conocimiento): esos siguen su camino de siempre (HTML → su grupo, 6 Databases → su área…)
        const aid = curriculumAreaOfFolder(f, areas);
        if ((aid && CURRICULUM_PLAN_TARGET[aid]) || knowledgeTargetOfFolder(f)) continue;
        const place = siblingPlacement(plan, f);
        if (place) placements[f] = place;
      }
      const res = api.mentor_plan_add_topics({ planId: id, folders: fresh, placements }) as { added?: string[]; message?: string };
      // solo se da por OFRECIDO lo que se intentó (el tope de 400 por vuelta deja el resto para la siguiente; antes se marcaban todos y los que no cabían se perdían)
      for (const f of fresh) offered.add(f);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      store.writeJson(file, { offered: [...offered] });
      refreshMaster(new PlanStore(app.root).load(id) ?? plan);
      return { loading: false as const, ...res, added: res.added ?? [] };
    },

    /**
     * Crea una sub-asignatura / grupo en un subplan (`mentor_plan_group_create({ planId, subplanId, title })`).
     */
    mentor_plan_group_create(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const title = String(o.title ?? "").trim();
      if (!title) throw new ApiError("Indica un nombre para la sub-asignatura o grupo.");
      const subplanId = String(o.subplanId ?? "").trim();
      if (!subplanId) throw new ApiError("Indica el área o subplan.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("Ese área no existe en el plan.");
      if (!sub.groups) sub.groups = [];
      const slugId = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "grupo";
      if (sub.groups.some((g) => g.id === slugId || g.title.toLowerCase() === title.toLowerCase())) {
        throw new ApiError(`Ya existe un grupo llamado «${title}».`);
      }
      const maxOrder = sub.groups.reduce((m, g) => Math.max(m, g.order), 90);
      const newGroup: AreaGroup = {
        id: slugId,
        title,
        kind: "knowledge",
        order: maxOrder + 10,
      };
      sub.groups.push(newGroup);
      const saved = st.save(plan);
      const hist = new ChangeStore(app.root);
      hist.append(id, {
        at: new Date().toISOString(),
        comment: `Crear sub-asignatura «${title}» en ${sub.area}`,
        status: "applied",
        source: "rules",
        summary: `Se creó la sub-asignatura «${title}» en ${sub.area}.`,
        delta: { added: 0, removed: 0, moved: 0, deliverables: 0, structure: 1 },
        changed: [],
        warnings: [],
        fixOptions: [],
        before: plan,
      });
      return { plan: saved, group: newGroup };
    },

    /**
     * Crea una nueva área al final de `plan.subplans` (`mentor_plan_area_create({ planId, name, objective?, fromWeek?, toWeek? })`).
     */
    mentor_plan_area_create(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const name = String(o.name ?? "").trim();
      if (!name) throw new ApiError("Indica un nombre para el área.");
      const objective = String(o.objective ?? "").trim() || `Avanzar en ${name}`;
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "area";
      if (plan.subplans.some((s) => s.id === slug || s.area.toLowerCase() === name.toLowerCase())) {
        throw new ApiError(`Ya existe un área llamada «${name}».`);
      }
      const totalWeeks = Math.max(1, weekRangesOf(plan.start, plan.end).length);
      const fromWeek = Math.max(1, Math.min(totalWeeks, Math.round(Number(o.fromWeek) || 1)));
      const toWeek = Math.max(fromWeek, Math.min(totalWeeks, Math.round(Number(o.toWeek) || totalWeeks)));
      const newSub = {
        id: slug,
        area: name,
        areaId: slug,
        objective,
        topics: [],
        groups: [{ id: "core", title: `Conocimientos de ${name.toLowerCase()}`, kind: "knowledge" as const, order: 30 }],
        phase: { fromWeek, toWeek },
        weeks: [],
        requiredGoals: [],
      };
      plan.subplans.push(newSub);
      const saved = st.save(plan);
      return { plan: saved, subplan: newSub };
    },

    /**
     * Agrega uno o varios temas a una asignatura específica (`mentor_plan_subject_add_topics({ planId, subplanId, groupId, topics })`).
     * `topics` puede ser lista de `{ folder, title, estMinutes?, targetWeek? }`.
     */
    mentor_plan_subject_add_topics(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const subplanId = String(o.subplanId ?? "").trim();
      const groupId = String(o.groupId ?? "").trim() || "core";
      const rawTopics = Array.isArray(o.topics) ? o.topics : [];
      if (!rawTopics.length) throw new ApiError("Indica al menos un tema para agregar.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("El área indicada no existe en el plan.");
      const existingFolders = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
      let addedCount = 0;
      let maxWeek = sub.phase?.fromWeek ?? 1;
      for (const t of sub.topics) {
        if (Number(t.targetWeek) > maxWeek) maxWeek = Number(t.targetWeek);
      }
      for (const item of rawTopics) {
        const title = String(item?.title ?? "").trim();
        if (!title) continue;
        const folder = String(item?.folder ?? "").trim() || `${sub.area}/${groupId}/${title}`;
        if (existingFolders.has(folder)) continue;
        existingFolders.add(folder);
        const tw = Number(item?.targetWeek) > 0 ? Math.round(Number(item.targetWeek)) : maxWeek;
        sub.topics.push({
          folder,
          title,
          estMinutes: Number(item?.estMinutes) > 0 ? Number(item.estMinutes) : 45,
          group: groupId,
          targetWeek: tw,
          topicId: canonicalTopicId(sub.areaId ?? sub.id, folder),
        });
        addedCount++;
      }
      if (!addedCount) throw new ApiError("Los temas indicados ya están en el plan.");
      const saved = st.save(plan);
      return { plan: saved, added: addedCount };
    },

    /**
     * Actualiza las semanas en el calendario (`fromWeek`, `toWeek`), el objetivo o el estado global de un área
     * (`mentor_plan_area_update({ planId, subplanId, fromWeek?, toWeek?, objective?, state? })`).
     */
    mentor_plan_area_update(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const subplanId = String(o.subplanId ?? "").trim();
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("El área indicada no existe en el plan.");

      const totalWeeks = Math.max(1, weekRangesOf(plan.start, plan.end).length);
      if (o.fromWeek !== undefined || o.toWeek !== undefined) {
        const curFrom = sub.phase?.fromWeek ?? 1;
        const curTo = sub.phase?.toWeek ?? totalWeeks;
        const fromWeek = Math.max(1, Math.min(totalWeeks, Math.round(Number(o.fromWeek ?? curFrom) || 1)));
        const toWeek = Math.max(fromWeek, Math.min(totalWeeks, Math.round(Number(o.toWeek ?? curTo) || totalWeeks)));
        sub.phase = { fromWeek, toWeek };
        // Sincronizar temas del área dentro de la nueva ventana del calendario
        const span = Math.max(1, toWeek - fromWeek + 1);
        sub.topics.forEach((t, idx) => {
          if (t.targetWeek < fromWeek || t.targetWeek > toWeek) {
            t.targetWeek = fromWeek + (idx % span);
          }
        });
      }
      if (typeof o.objective === "string" && o.objective.trim()) {
        sub.objective = o.objective.trim();
      }
      if (o.state === "completada") {
        const today = localDate();
        for (const t of sub.topics) {
          if (t.route !== "skipped" && !t.completedAt) {
            t.completedAt = today;
          }
        }
      } else if (o.state === "pendiente") {
        for (const t of sub.topics) {
          delete t.completedAt;
        }
      } else if (o.state === "en_curso") {
        if (sub.topics.length > 0 && sub.topics.every((t) => !!t.completedAt)) {
          delete sub.topics[sub.topics.length - 1]!.completedAt;
        }
      }

      const saved = st.save(plan);
      const updatedSub = saved.subplans.find((s) => s.id === sub.id) ?? sub;
      return { plan: saved, subplan: updatedSub };
    },

    /**
     * Modifica el estado (`completed`, `route`) o la semana (`targetWeek`) de un tema del plan
     * (`mentor_plan_topic_update({ planId, subplanId?, folder, targetWeek?, completed?, route? })`).
     */
    mentor_plan_topic_update(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const folder = String(o.folder ?? "").trim();
      if (!folder) throw new ApiError("Indica el tema a actualizar.");
      const subplanId = String(o.subplanId ?? "").trim();
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");

      const sub = subplanId
        ? plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId)
        : plan.subplans.find((s) => s.topics.some((t) => t.folder === folder));
      if (!sub) throw new ApiError("El área indicada no existe en el plan.");
      const topic = sub.topics.find((t) => t.folder === folder);
      if (!topic) throw new ApiError("El tema indicado no existe en el área.");

      const totalWeeks = Math.max(1, weekRangesOf(plan.start, plan.end).length);
      if (o.targetWeek !== undefined) {
        topic.targetWeek = Math.max(1, Math.min(totalWeeks, Math.round(Number(o.targetWeek) || 1)));
        topic.pinned = true;
      }
      if (o.completed === true) {
        topic.completedAt = topic.completedAt || localDate();
      } else if (o.completed === false) {
        delete topic.completedAt;
      }
      if (o.route !== undefined) {
        const r = String(o.route ?? "");
        if (r === "core" || r === "") {
          delete topic.route;
          delete topic.skippedReason;
        } else if (r === "optional" || r === "skipped") {
          topic.route = r;
        }
      }
      if (Array.isArray(o.tags)) {
        topic.tags = o.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
      }

      const saved = st.save(plan);
      return { plan: saved, topic };
    },

    /**
     * Resuelve por ID la ubicación real de un tema en la vault aunque haya cambiado la estructura de carpetas
     * y, si `ensureCanvas` es true, genera el `.canvas` explicativo determinista si existe la nota `.md`.
     */
    mentor_topic_resolve(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const folder = String(o.folder ?? "").trim();
      if (!folder) throw new ApiError("Indica la carpeta del tema.");
      const res = resolveAndEnsureTopicAssets(app.root, {
        folder,
        ...(o.topicId ? { topicId: String(o.topicId) } : {}),
        ...(o.title ? { title: String(o.title) } : {}),
        ...(o.areaId ? { areaId: String(o.areaId) } : {}),
        ensureCanvas: o.ensureCanvas !== false,
      });
      if (res.canvasGenerated) {
        clearTopicSnapCache(app.root);
      }
      return res;
    },

    /**
     * Verifica si el plan tiene temas cuya estructura de carpetas cambió en la vault o a los que les falta
     * generar su `.canvas` explicativo.
     */
    mentor_plan_vault_check(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      return checkPlanVaultSync(app.root, plan);
    },

    /**
     * Corrige avisos metodológicos de un área (p. ej. HTML y CSS en Frontend):
     * añade o asegura las asignaturas correspondientes en los grupos, reclasifica temas y añade los recomendados.
     */
    mentor_plan_fix_methodology(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const subplanId = String(o.subplanId ?? "").trim();
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");

      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("El área indicada no existe en el plan.");

      const warnings = evaluateAreaMethodology(sub);
      if (!warnings.length) return { plan, addedCount: 0 };

      let groups = sub.groups ? [...sub.groups] : [];
      for (const fg of FRONTEND_SUBJECT_GROUPS) {
        if (!groups.some((g) => g.id === fg.id)) {
          groups.push({ ...fg });
        }
      }
      groups.sort((a, b) => a.order - b.order);
      sub.groups = groups;

      // Reclasificar temas existentes según frontendGroupForFolder
      for (const t of sub.topics) {
        const fg = frontendGroupForFolder(t.folder);
        if (fg && (!t.group || t.group === CORE_GROUP_ID)) {
          t.group = fg.id;
        }
      }

      // Solo estructura: la asignatura y la reclasificación. Los temas (uno por elemento o propiedad) salen del currículo de referencia con
      // «Verificar metodología» → Antigravity; antes se metían 3 + 4 notas genéricas que no enseñaban nada.
      const addedCount = 0;

      const saved = st.save(plan);
      clearTopicSnapCache(app.root);
      return { plan: saved, addedCount };
    },

    /**
     * Escanea la vault por IDs de tema, actualiza las rutas de carpetas del plan que hayan cambiado de lugar,
     * guarda `.notevault/mentor/topic_id_index.json` y genera los `.canvas` explicativos pendientes.
     */
    mentor_plan_vault_reconcile(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const res = reconcilePlanWithVault(app.root, plan, { generateCanvases: o.generateCanvases !== false });
      const saved = res.changedPlan ? st.save(res.plan) : plan;
      if (res.changedPlan || res.generatedCanvases > 0) {
        clearTopicSnapCache(app.root);
      }
      return {
        plan: saved,
        changedPlan: res.changedPlan,
        relocatedCount: res.relocatedCount,
        generatedCanvases: res.generatedCanvases,
        indexedCount: res.indexedCount,
      };
    },

    /**
     * Renombra una sub-asignatura / grupo en un subplan (`mentor_plan_group_rename({ planId, subplanId, groupId, title })`).
     */
    mentor_plan_group_rename(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const title = String(o.title ?? "").trim();
      if (!title) throw new ApiError("Indica el nuevo nombre.");
      const subplanId = String(o.subplanId ?? "").trim();
      const groupId = String(o.groupId ?? "").trim();
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("Ese área no existe en el plan.");
      const grp = (sub.groups ?? []).find((g) => g.id === groupId);
      if (!grp) throw new ApiError("Ese grupo no existe.");
      grp.title = title;
      const saved = st.save(plan);
      return { plan: saved, group: grp };
    },

    /**
     * Elimina una sub-asignatura / grupo de un subplan y reubica sus temas (`mentor_plan_group_delete({ planId, subplanId, groupId, fallbackGroupId? })`).
     */
    mentor_plan_group_delete(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const subplanId = String(o.subplanId ?? "").trim();
      const groupId = String(o.groupId ?? "").trim();
      if (groupId === "bases" || groupId === "core") throw new ApiError("Los grupos principales no se pueden eliminar.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("Ese área no existe en el plan.");
      const grp = (sub.groups ?? []).find((g) => g.id === groupId);
      if (!grp) throw new ApiError("Ese grupo no existe.");
      const fallback = String(o.fallbackGroupId ?? "").trim() || (sub.groups?.find((g) => g.id !== groupId && g.id !== "bases")?.id ?? "core");
      sub.groups = (sub.groups ?? []).filter((g) => g.id !== groupId);
      let moved = 0;
      for (const t of sub.topics) {
        if (t.group === groupId) {
          t.group = fallback;
          moved++;
        }
      }
      const saved = st.save(plan);
      return { plan: saved, moved };
    },

    /**
     * Mueve temas a otro grupo o sub-asignatura (`mentor_plan_topics_move_group({ planId, subplanId, folders, groupId, newGroupTitle? })`).
     */
    mentor_plan_topics_move_group(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.planId ?? o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const subplanId = String(o.subplanId ?? "").trim();
      let groupId = String(o.groupId ?? "").trim();
      const newTitle = String(o.newGroupTitle ?? "").trim();
      const folders = [...new Set((Array.isArray(o.folders) ? (o.folders as unknown[]) : []).map(String).filter(Boolean))];
      if (!folders.length) throw new ApiError("Elige al menos un tema.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (plan.archived) throw new ApiError("Ese plan está archivado.");
      const sub = plan.subplans.find((s) => s.id === subplanId || s.areaId === subplanId);
      if (!sub) throw new ApiError("Ese área no existe en el plan.");
      if (!sub.groups) sub.groups = [];
      if (newTitle && (!groupId || groupId === "__new")) {
        groupId = newTitle.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "grupo";
        if (!sub.groups.some((g) => g.id === groupId)) {
          const maxOrder = sub.groups.reduce((m, g) => Math.max(m, g.order), 90);
          sub.groups.push({ id: groupId, title: newTitle, kind: "knowledge", order: maxOrder + 10 });
        }
      }
      const grp = sub.groups.find((g) => g.id === groupId);
      if (!grp && groupId !== "core" && groupId !== "bases") {
        throw new ApiError("El grupo destino no existe.");
      }
      const changed: string[] = [];
      for (const t of sub.topics) {
        if (folders.includes(t.folder) && t.group !== groupId) {
          t.group = groupId;
          changed.push(t.folder);
        }
      }
      if (!changed.length) return { plan, changed: 0, message: "Los temas ya pertenecen a ese grupo." };
      const saved = st.save(plan);
      const hist = new ChangeStore(app.root);
      const targetName = grp?.title ?? groupId;
      hist.append(id, {
        at: new Date().toISOString(),
        comment: `Mover ${changed.length} temas a «${targetName}»`,
        status: "applied",
        source: "rules",
        summary: `Se movieron ${changed.length} temas a la sub-asignatura «${targetName}» en ${sub.area}.`,
        delta: { added: 0, removed: 0, moved: changed.length, deliverables: 0 },
        changed,
        warnings: [],
        fixOptions: [],
        before: plan,
      });
      return { plan: saved, changed: changed.length, targetGroupId: groupId, targetGroupTitle: targetName };
    },

    // ── Cobertura del plan: notas de teoría y práctica por área (determinista) + revisión con el Mentor (bajo demanda) ──

    /** Cobertura de teoría y práctica de cada área del plan contra la vault y la última revisión guardada. Solo lee. */
    mentor_plan_coverage(opts: unknown) {
      const plan = coveragePlan(opts);
      if (studyIndexCold(app)) return { loading: true as const };
      return {
        loading: false as const,
        coverage: coverageOf(plan).coverage,
        review: plan.coverageReview ?? null,
        aiConfigured: aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null,
      };
    },

    /**
     * Catálogo de TODOS los temas de la vault (no solo los del plan) con lo que existe de cada uno: nota, contrato, mapa, manifiesto,
     * ejercicios y diseño, y su área / semana / completado si están en el plan. Los temas del plan que aún no existen en la vault también
     * salen (sin nada creado). Solo lee.
     */
    mentor_plan_topic_catalog(opts: unknown) {
      const plan = coveragePlan(opts);
      if (studyIndexCold(app)) return { loading: true as const };
      const snaps = topicSnaps(app);
      const planTopics = plan.subplans.flatMap((s) => s.topics.map((t) => ({ folder: t.folder, title: t.title, area: s.area, targetWeek: t.targetWeek, ...(t.completedAt ? { completedAt: t.completedAt } : {}), ...(t.route ? { route: t.route } : {}) })));
      const subjectOf = new Map(snaps.map((t) => [t.folder, t.subject] as const));
      const titles = new Map<string, string>([...planTopics.map((t) => [t.folder, t.title] as const), ...snaps.map((t) => [t.folder, t.title] as const)]);
      const designs = designsOf(app, [...titles].map(([folder, title]) => ({ folder, title, ...(subjectOf.get(folder) ? { subject: subjectOf.get(folder)! } : {}) })));
      const rows = buildPlanTopicRows(
        snaps.map((t) => ({ folder: t.folder, title: t.title, theoryNotes: t.theoryNotes, exerciseCount: t.exerciseCount, ...(t.planExercises ? { planExercises: t.planExercises } : {}), skills: Object.keys(t.progress.skills ?? {}).length })),
        planTopics,
        designs,
      );
      // piezas hechas con una versión anterior de su skill (sin IA: huella de la skill contra la fecha de cada archivo)
      const outdated = outdatedByFolder(app.root, [...new Set([...rows.filter((r) => r.exists).map((r) => r.folder), ...planTopics.map((t) => t.folder)])]);
      return { loading: false as const, rows: rows.map((r) => {
        const stale = outdated.get(r.folder);
        return { ...r, ...(stale ? { outdated: stale } : {}), ...(r.exists && (!r.manifest || r.exercises === 0) ? { practiceMismatch: true } : {}) };
      }) };
    },

    /**
     * «Revisar cobertura con el Mentor»: UNA llamada a la IA con el objetivo, el perfil declarado, los títulos de los temas por área y el
     * resumen de cobertura (nunca las notas). La respuesta se valida (descarta lo que ya existe como tema, normaliza las áreas) y se guarda
     * como `coverageReview` en el plan; no crea notas ni cambia temas. Sin IA (o si falla o se cancela) no se guarda nada: `source: "none"`.
     */
    async mentor_plan_coverage_review(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = coveragePlan(o);
      const profile = String(o.profile ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PROFILE_CHARS);
      // con qué criterio se revisa (tendencias del mercado, mid-level, entrevistas, lo que pida el estudiante) y a qué nivel
      const criteria = sanitizeCriteria(o.criteria);
      if (studyIndexCold(app)) return { loading: true as const };
      const { coverage, snaps } = coverageOf(plan);
      const none = (reason: string) => ({ loading: false as const, source: "none" as const, reason, coverage });
      if (o.noAi === true) return none("Sin IA por petición tuya: se muestra solo la cobertura calculada.");
      if (aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) !== null) return none("La IA no está configurada: sin IA solo se muestra la cobertura calculada.");
      const id = plan.id;
      return guarded(`plan:${id}`, `coverage:${profile}:${JSON.stringify(criteria)}`, () =>
        withJob(`coverage:${id}`, "Revisando la cobertura del plan con tu objetivo…", async (job) => {
          const objective = plan.preconditions?.freeObjective?.trim() || plan.subplans.map((s) => s.objective).filter(Boolean).join(" · ");
          let text: string;
          try {
            text = await job.send(coverageMessages({ objective, profile, subplans: plan.subplans, coverage, criteria, levels: plan.preconditions?.levels as Record<string, string> | undefined, today: localDate() }) as ChatMessage[], { timeoutMs: 180_000 });
          } catch (e) {
            if (e instanceof CancelError) return none(e.mode === "abort" ? "Cancelaste la revisión: se muestra solo la cobertura calculada." : "Seguiste sin IA: se muestra solo la cobertura calculada.");
            return none(`La IA falló (${e instanceof Error ? e.message : String(e)}`.slice(0, 200) + "): se muestra solo la cobertura calculada.");
          }
          const parsed = parseCoverageReply(text, {
            areas: plan.subplans.map((s) => ({ key: areaKeyOf(s), area: s.area, groups: s.groups })),
            planTopics: plan.subplans.flatMap((s) => s.topics.map((t) => ({ folder: t.folder, title: t.title, key: areaKeyOf(s), done: !!t.completedAt }))),
            vaultTitles: snaps.map((t) => t.title),
          });
          if (!parsed.ok) return none(`${parsed.reason} Se muestra solo la cobertura calculada.`);
          const st = new PlanStore(app.root);
          const fresh = st.load(id) ?? plan;
          const review = { at: new Date().toISOString(), source: "ai" as const, ...(profile ? { profile } : {}), criteria, disclaimer: COVERAGE_DISCLAIMER, ...parsed.review };
          const saved = st.save({ ...fresh, coverageReview: review });
          return { loading: false as const, source: "ai" as const, review: saved.coverageReview ?? review, plan: saved, coverage };
        }),
      );
    },

    // ── Constructor guiado: el plan se arma por etapas y se pregunta al estudiante conforme se arma ──

    /**
     * Empieza a armar un plan paso a paso con las precondiciones del formulario. Calcula la primera etapa (con IA, una llamada pequeña
     * si hay comentarios o preguntas que mejorar; sin IA, por reglas) y deja el estado en \`.notevault/mentor/plans/_building/<id>.json\`.
     * No escribe ningún plan.
     */
    async mentor_plan_build_start(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const today = localDate();
      const pre0 = sanitizePreconditions(o.preconditions && typeof o.preconditions === "object" ? o.preconditions : o, today);
      const problem = preconditionsProblem(pre0, today);
      if (problem) throw new ApiError(problem);
      const ctx = buildCtx();
      if (!ctx) return { loading: true as const };
      const pre = resolveBranches(pre0, ctx.all, ctx.goals.filter((g) => pre0.goalIds.includes(g.id)).map((g) => g.name));
      const wanted = o.id !== undefined ? String(o.id) : "";
      if (!planCatalog(resolveScope(pre, ctx.all, ctx.goals), 100).length) {
        throw new ApiError("No hay temas pendientes en lo que elegiste. Elige metas con temas enlazados o materias con temas sin completar.");
      }
      const now = new Date().toISOString();
      const id = BUILD_ID_RE.test(wanted) && !builds().load(wanted) ? wanted : newBuildId();
      return guarded(id, "start", () => withJob(`build:${id}`, "Preparando el alcance de tu plan…", async (job) => {
        const first: PlanBuild = {
          id, createdAt: now, updatedAt: now, pre, effective: pre, stage: "alcance", steps: [], answers: [], draft: null, skeleton: null,
          source: "rules", questionCount: 0, maxQuestions: MAX_BUILD_QUESTIONS, status: "building", finishing: false, ai: emptyAi(), name: "",
        };
        return buildView(builds().save(await advance(first, ctx, false, job)));
      }));
    },

    /** El estado guardado de un plan en construcción (sin recalcular: funciona aunque el índice de la vault esté frío). */
    mentor_plan_build_get(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      return buildView(loadBuild(o.id));
    },

    /** Los planes en construcción (el último tocado primero), en resumen para la barra lateral, el resumen y el chat. */
    mentor_plan_build_list() {
      return builds().list().map(summaryOf);
    },

    /**
     * Responde la pregunta abierta: \`choice\` (id de una opción), \`text\` (se interpreta como una opción solo si es inequívoco; las
     * preguntas de la IA admiten texto libre), \`skip\` (valor por defecto) o \`delegate\` («que decida el Mentor»). La respuesta la aplica
     * código determinista al recalcular. Un doble envío no duplica la llamada.
     */
    async mentor_plan_build_answer(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const b = loadBuild(o.id);
      if (b.status !== "building" || !b.openQuestion) throw new ApiError("Este plan no tiene ninguna pregunta abierta.");
      const q = b.openQuestion;
      if (String(o.questionId ?? q.id) !== q.id) throw new ApiError("Esa pregunta ya no está abierta.");
      const input: AnswerInput = { choice: o.choice === undefined ? undefined : String(o.choice), text: o.answer !== undefined ? String(o.answer) : o.text !== undefined ? String(o.text) : undefined, skip: o.skip === true, delegate: o.delegate === true };
      const ctx = buildCtx();
      if (!ctx) return { loading: true as const };
      return guarded(b.id, `answer:${q.id}:${input.choice ?? ""}:${input.text ?? ""}:${input.skip}:${input.delegate}`, () =>
        withJob(`build:${b.id}`, "Aplicando tu respuesta y preparando lo siguiente…", async (job) => {
          let ans;
          try {
            ans = makeAnswer(q, input, new Date().toISOString());
          } catch (e) {
            throw new ApiError((e as Error).message);
          }
          return buildView(builds().save(await advance({ ...b, answers: [...b.answers, ans] }, ctx, false, job)));
        }),
      );
    },

    /** «Volver a una etapa» / «Cambiar respuesta»: descarta las respuestas de esa etapa en adelante y rehace desde ahí. */
    async mentor_plan_build_back(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const b = loadBuild(o.id);
      if (!isBuildStage(o.stage)) throw new ApiError("Etapa inválida.");
      const stage = o.stage as BuildStage;
      const ctx = buildCtx();
      if (!ctx) return { loading: true as const };
      return guarded(b.id, `back:${stage}`, () => withJob(`build:${b.id}`, "Rehaciendo desde esa etapa…", async (job) => buildView(builds().save(await advance({ ...b, answers: b.answers.filter((a) => stageIndex(a.stage) < stageIndex(stage)) }, ctx, false, job)))));
    },

    /** «Generar ya con lo que hay»: completa lo que falta con valores razonables (una llamada a la IA para los temas, o determinista) y pasa a Revisión. */
    async mentor_plan_build_finish_now(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const b = loadBuild(o.id);
      const ctx = buildCtx();
      if (!ctx) return { loading: true as const };
      return guarded(b.id, "finish", () => withJob(`build:${b.id}`, "Completando lo que falta con valores razonables…", async (job) => buildView(builds().save(await advance({ ...b, finishing: true }, ctx, true, job)))));
    },

    /** «Abandonar»: el estado va a la papelera de la vault (`.notevault/.papelera/mentor-plans`). */
    mentor_plan_build_abandon(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const b = loadBuild(o.id);
      if (inflight.has(b.id)) throw new ApiError("El Mentor sigue pensando en este plan. Espera un momento.");
      if (!builds().trash(b.id)) throw new ApiError("No se pudo abandonar el plan en construcción.");
      return { id: b.id, builds: builds().list().map(summaryOf) };
    },

    /**
     * «Aceptar plan» de un plan en construcción: recalcula TODO desde las precondiciones y las respuestas (no se fía del estado que
     * mande la UI), exige estar en Revisión y escribe el plan por el camino de siempre (que vuelve a validar temas, metas, proyectos y
     * capacidad). Después el estado de construcción se elimina.
     */
    mentor_plan_build_accept(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const b = loadBuild(o.id);
      if (inflight.has(b.id)) throw new ApiError("El Mentor sigue pensando en este plan. Espera un momento.");
      const ctx = buildCtx();
      if (!ctx) return { loading: true as const };
      const comp = computeBuild({ pre: b.pre, answers: b.answers, ai: b.ai, maxQuestions: b.maxQuestions }, ctx, { finishing: b.finishing, noAi: true });
      if (comp.status !== "review" || !comp.draft) throw new ApiError("Al plan aún le faltan etapas: responde las preguntas o pulsa «Generar ya con lo que hay».");
      const out = acceptRef({ draft: comp.draft, proposed: true });
      builds().remove(b.id);
      return out;
    },

    // ── Estado y cancelación de las llamadas largas de la IA (generar plan, constructor, chat, cambios) ──

    /** ¿Sigue pensando la IA? Claves: `generate`, `chat`, `build:<id>`, `change:<id>`. `label` dice qué hace; `elapsed`, los segundos. */
    mentor_ai_status(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const j = jobs.get(String(o.key ?? ""));
      return j ? { busy: true as const, label: j.label, elapsed: Math.round((Date.now() - j.since) / 1000) } : { busy: false as const, label: "", elapsed: 0 };
    },

    /** Cancela una llamada larga: `mode: "abort"` (por defecto) la aborta sin efectos; `mode: "auto"` sigue con el plan automático (sin IA). */
    mentor_ai_cancel(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const j = jobs.get(String(o.key ?? ""));
      if (!j) return { cancelled: false };
      j.cancelled = o.mode === "auto" ? "auto" : "abort";
      j.controller.abort();
      for (const w of [...j.waiters]) w(new CancelError(j.cancelled));
      return { cancelled: true };
    },

    // ── Plan propuesto: mantener / borrar, y pedir cambios con comentarios ──

    /** «Mantener plan»: el plan propuesto deja de serlo (pasa a activo o futuro según sus fechas). «Borrar» es `mentor_plan_delete` (papelera). */
    mentor_plan_keep(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      if (!plan.proposed) throw new ApiError("Ese plan ya está mantenido.");
      const { proposed: _p, ...rest } = plan;
      return st.save({ ...rest, updatedAt: new Date().toISOString() });
    },

    /** El historial de cambios pedidos a un plan (sin las instantáneas). */
    mentor_plan_changes(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      return new ChangeStore(app.root).list(id).map(viewOf);
    },

    /**
     * Pedir cambios al plan con un comentario (o con operaciones de ajuste calculadas por la app: `ops`). La IA lo traduce a un parche
     * validado; sin IA, o si falla, hay un intérprete por palabras clave; lo que no se entiende queda como «pendiente» (el texto no se
     * pierde). El reparto semanal se recalcula siempre con la capacidad real. Cada cambio guarda una instantánea para «Deshacer».
     */
    async mentor_plan_change(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const plan = st.load(id);
      if (!plan) throw new ApiError("Ese plan ya no existe.");
      const comment = sanitizeNotes(o.comment, MAX_COMMENT_CHARS);
      const kind = o.intent === "fix" ? ("fix" as const) : ("adjust" as const);
      const direct: ChangeOp[] | null = Array.isArray(o.ops)
        ? (o.ops as any[])
            .filter((x) => x && ["trim_to_fit", "extend_to", "restart", "raise_minutes", "lighter", "set_area_mode", "add_area", "organize", "add_deliverable", "edit_deliverable", "remove_deliverable"].includes(String(x.op)))
            .map((x) => (x.op === "add_area" ? { op: "add_area" as const, areaId: String(x.areaId ?? "").slice(0, 40) } : x.op === "extend_to" ? { op: "extend_to" as const, date: String(x.date ?? "") } : x.op === "restart" ? { op: "restart" as const, date: String(x.date ?? "") } : x.op === "raise_minutes" ? { op: "raise_minutes" as const, minutes: Number(x.minutes) } : x.op === "set_area_mode" ? { op: "set_area_mode" as const, mode: x.mode === "phased" ? ("phased" as const) : ("together" as const) } : x.op === "remove_deliverable" ? { op: "remove_deliverable" as const, id: String(x.id ?? "").slice(0, 20) } : x.op === "edit_deliverable" ? { op: "edit_deliverable" as const, id: String(x.id ?? "").slice(0, 20), ...(typeof x.title === "string" ? { title: x.title.slice(0, 140) } : {}), ...(typeof x.description === "string" ? { description: x.description.slice(0, 600) } : {}), ...(Array.isArray(x.criteria) ? { criteria: x.criteria.map((c: unknown) => String(c).slice(0, 200)).slice(0, 8) } : {}), ...(typeof x.subplan === "string" ? { subplan: x.subplan.slice(0, 80) } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(String(x.dueDate ?? "")) ? { dueDate: String(x.dueDate) } : {}) } : x.op === "add_deliverable" ? { op: "add_deliverable" as const, title: String(x.title ?? "").slice(0, 140), description: String(x.description ?? "").slice(0, 600), criteria: (Array.isArray(x.criteria) ? x.criteria : []).map((c: unknown) => String(c).slice(0, 200)).slice(0, 8), ...(typeof x.subplan === "string" && x.subplan ? { subplan: x.subplan.slice(0, 80) } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(String(x.dueDate ?? "")) ? { dueDate: String(x.dueDate) } : {}) } : x.op === "organize" ? { op: "organize" as const, ...(typeof x.subplan === "string" ? { subplan: x.subplan.slice(0, 80) } : {}), ...(Array.isArray(x.order) ? { order: x.order.map((f: unknown) => String(f).slice(0, 400)).slice(0, 2000) } : {}) } : { op: x.op as "trim_to_fit" | "lighter" }))
        : null;
      if (!comment && !direct?.length) throw new ApiError("Escribe qué quieres cambiar en el plan.");
      if (studyIndexCold(app)) return { loading: true as const };
      return guarded(`plan:${id}`, `change:${comment}:${JSON.stringify(direct)}`, () =>
        withJob(`change:${id}`, "Aplicando tu comentario al plan…", async (job) => {
          const today = localDate();
          const all = buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 });
          const ctx = { today, all, startFocus: practiceStartFocus(app), mastery: masteryLookup(app) };
          const hist = new ChangeStore(app.root);
          const label = comment || String(o.label ?? "Ajuste propuesto por la app").slice(0, 200);
          let ops: ChangeOp[] = direct ?? [];
          let summary = "";
          let source: ChangeEntry["source"] = direct ? "rules" : "none";
          let note = "";
          if (!direct) {
            const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
            if (o.noAi !== true && aiUnavailableReason(cfg) === null) {
              try {
                const pre = plan.preconditions;
                const scope = pre ? resolveScope(pre, all, goalScopes(app)) : null;
                const inPlan = new Set(plan.subplans.flatMap((s) => s.topics.map((t) => t.folder)));
                const base = scope ? planCatalog(scope, dynamicCatalogMax(pre!, scope, today), comment) : buildTopicCatalog(topicSnaps(app), comment, { max: 120 });
                // ramas excluidas que el comentario nombra de forma explícita (el estudiante manda)
                const named = fold(comment);
                const extraClasses = detectBranchIntent(comment).extra;
                const extra = all.filter((t) => t.completenessPct < 100 && branchOfFolder(t.folder) && (extraClasses.includes(classifyBranch(branchOfFolder(t.folder)) as never) || named.includes(fold(branchOfFolder(t.folder)).replace(/^[\d.\s_-]+/, "")))).slice(0, 150);
                const catalog = [...new Map([...base, ...extra].filter((t) => !inPlan.has(t.folder) && t.completenessPct < 100).map((t) => [t.folder, t])).values()].slice(0, 320);
                const brief = buildStudentBrief(briefContext(app, log()));
                const parsed = parseChangeReply(await job.send(changeMessages(brief, plan, comment, catalog, hist.list(id))), plan, catalog, comment);
                if (parsed.ok && parsed.ops.length) {
                  ops = parsed.ops;
                  summary = parsed.summary;
                  source = "ai";
                } else note = parsed.ok ? parsed.summary || "La IA no propuso ningún cambio aplicable." : (parsed.reason ?? "La IA no devolvió un parche válido.");
              } catch (e) {
                if (e instanceof CancelError && e.mode === "abort") note = "Cancelaste la llamada: el comentario queda pendiente.";
                else note = e instanceof CancelError ? "Pediste seguir sin IA." : `La IA falló: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
                if (e instanceof CancelError && e.mode === "abort") ops = [];
              }
            } else note = o.noAi === true ? "Sin IA por petición tuya." : "La IA no está configurada.";
            if (!ops.length && !note.startsWith("Cancelaste")) {
              const r = opsFromText(comment, plan, ctx);
              if (r.ops.length) {
                ops = r.ops;
                summary = r.summary;
                source = "rules";
              }
            }
          }
          // ramas: si el plan no las trae y el comentario (o el nombre de sus metas) dice «full stack», se aplican y se quitan los temas de las excluidas
          if (plan.preconditions && !direct) {
            const goalNames = plan.subplans.filter((sp) => sp.goalId).map((sp) => sp.objective);
            const inf = resolveBranches(plan.preconditions, all, goalNames, comment);
            if (inf.branches && !plan.preconditions.branches) ops = [{ op: "set_branches", branches: inf.branches, preset: inf.branchPreset ?? "fullstack", excluded: inf.branchExcluded ?? [] }, ...ops];
          }
          let res = ops.length ? applyOps(plan, ops, ctx) : null;
          if (res && !res.applied && source === "ai") {
            const r = opsFromText(comment, plan, ctx);
            res = r.ops.length ? applyOps(plan, r.ops, ctx) : res;
            if (res.applied) {
              summary = r.summary;
              source = "rules";
            }
          }
          const now = new Date().toISOString();
          if (!res || !res.applied) {
            const entry = hist.append(id, {
              at: now,
              comment: label,
              status: "pending",
              kind,
              source: "none",
              summary: `${note ? `${note} ` : ""}${ops.length ? "Los cambios pedidos no modificaron nada." : "No pude aplicar este comentario: queda guardado como pendiente. Reescríbelo o usa frases como «quita desktop» o «pasa X a la semana 5»."}`.trim(),
              delta: { added: 0, removed: 0, moved: 0, deliverables: 0 },
              changed: [],
              warnings: [],
              fixOptions: [],
            });
            return { loading: false as const, plan, entry: viewOf(entry), history: hist.list(id).map(viewOf), applied: false };
          }
          const saved = st.save(res.plan);
          const entry = hist.append(id, {
            at: now,
            comment: label,
            status: "applied",
            kind,
            source,
            summary: summary || deltaText(res.delta),
            delta: res.delta,
            changed: res.changed,
            warnings: res.warnings,
            fixOptions: res.fixOptions,
            before: plan,
          });
          return { loading: false as const, plan: saved, entry: viewOf(entry), history: hist.list(id).map(viewOf), applied: true };
        }),
      );
    },

    /** «Deshacer» el último cambio aplicado: restaura la instantánea previa (conserva el nombre y si el plan está propuesto o mantenido). */
    mentor_plan_change_undo(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const id = String(o.id ?? "");
      if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
      const st = new PlanStore(app.root);
      const cur = st.load(id);
      if (!cur) throw new ApiError("Ese plan ya no existe.");
      const hist = new ChangeStore(app.root);
      const last = [...hist.list(id)].reverse().find((e) => e.status === "applied" && e.before);
      if (!last?.before) throw new ApiError("No hay ningún cambio que deshacer.");
      const { proposed: _p, archived: _a, name: _n, coverageReview: _cr, ...base } = last.before;
      // el nombre actual se conserva (renombrar no es un cambio del plan), salvo que el propio cambio lo hubiera puesto y nadie lo haya tocado después
      const name = last.nameAfter !== undefined && (cur.name ?? "") === last.nameAfter ? last.before.name : cur.name;
      const restored = st.save({ ...base, ...(cur.proposed ? { proposed: true } : {}), ...(cur.archived ? { archived: true } : {}), ...(name ? { name } : {}), ...(cur.coverageReview ? { coverageReview: cur.coverageReview } : {}), updatedAt: new Date().toISOString() });
      hist.save(id, { ...last, status: "undone" });
      return { plan: restored, history: hist.list(id).map(viewOf) };
    },
  };
  acceptRef = api.mentor_plan_draft_accept;
  return {
    ...api,
    // faltantes de la revisión de cobertura añadidos a la propuesta (ver `mentorCoverage.ts`)
    ...mentorCoverageApi(app),
    // «Ejecutar plan» (informe, cola en segundo plano, pausa/cancelación) y Sistema de práctica por área (ver mentorExecute.ts y mentorAreaPractice.ts)
    ...mentorExecuteApi(app, { ...(send ? { send } : {}), today: () => localDate() }),
    // registro de horas por área (Pomodoro y bloques a mano)
    ...mentorTimeLogApi(app),
    // carpetas de proyectos por ruta y área, con su plantilla de archivos (nunca sobrescribe)
    ...mentorProjectsApi(app),
    // registros de sesión: evidencia, notas legibles en `_registro/`, patrones y propuestas del Mentor (solo propone)
    ...mentorRecordsApi(app, { ...(send ? { send: send as never } : {}), today: () => localDate() }),
    ...mentorAreaPracticeApi(app, { today: () => localDate() }),
    // Cierre del día y memoria del Mentor: registro sin IA + una revisión al cerrar (ver mentorDayClose.ts)
    ...mentorDayCloseApi(app, { withJob, guarded, cancelMode: (e) => (e instanceof CancelError ? e.mode : undefined), today: () => localDate(), activePlans: (day) => activePlans(new PlanStore(app.root).list(), day), topicSnaps: () => topicSnaps(app), cold: () => studyIndexCold(app) }),
    // «Preguntas, correcciones y ajustes»: clasificar lo escrito y responder preguntas sin tocar el plan (ver `mentorAsk.ts`)
    ...mentorAskApi(app, { withJob, guarded, cancelMode: (e) => (e instanceof CancelError ? e.mode : undefined), today: () => localDate() }),
    // Carpetas de la vault añadidas como áreas o sub-asignaturas (ver `mentorPlanFolders.ts`)
    // Hora de estudio de cada área (calendario general ↔ página del área; ver `mentorAreaTimes.ts`)
    ...mentorAreaTimesApi(app),
    // El proyecto mensual como proyecto REAL del módulo Proyectos (ver `mentorProjectLinks.ts`)
    ...mentorProjectLinksApi(app),
    // «Preguntar con otra IA»: el dosier del plan para que Antigravity responda sin la app abierta (ver `mentorPlanDossier.ts`)
    ...mentorPlanDossierApi(app),
    ...mentorPlanDepthApi(app),
    ...masterSyllabusApi(app),
    ...mentorPlanFoldersApi(app, { allTopics: () => buildTopicCatalog(topicSnaps(app), "", { max: 1_000_000 }), today: () => localDate() }),
    /** Compatibilidad: el flujo anterior (un BORRADOR en el chat que se acepta aparte); el camino principal crea el plan propuesto. */
    mentor_plan_generate_draft: (opts: unknown) => api.mentor_plan_generate({ ...((opts && typeof opts === "object" ? opts : {}) as object), asDraft: true }),
  };
}
