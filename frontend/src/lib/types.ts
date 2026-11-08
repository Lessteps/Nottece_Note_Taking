import type { PlanPreconditions, ScopeTopic } from "./planTime";
import type { AreaGroup, AreaPhase, PlanDeliverable, PlanPurposes } from "./planAreas";
import type { BuildAnswer, BuildQuestion, BuildStage } from "./planBuild";
import type { CoverageReview, PlanCoverage } from "./planCoverage";
import type { PracticeItem, PracticeTrack, PhaseStatus, PracticePhase } from "./practiceTrack";
// Shapes returned by notevault_app/webapp/api.py. Keep in step with it.

export type RenderingMode = "auto" | "hardware" | "software";
export type AngleBackend = "default" | "d3d11" | "d3d11on12" | "gl" | "d3d9" | "vulkan";

export interface RenderingSettings {
  mode: RenderingMode;
  angle: AngleBackend;
  liteEffects: boolean;
  reduceMotion: boolean;
}

export interface GpuStatus {
  features: Record<string, string>;
  active: string[];
  angle: string;
}

export interface AppInfo {
  api_version: number;
  vault_name: string;
  vault_path: string;
  theme: "dark" | "light";
  rendering?: RenderingSettings;
  /** HOME aislado (pruebas y capturas): la app no enseña avisos de apoyo. */
  sandbox?: boolean;
}

export interface TreeEntry {
  type: "folder" | "note";
  name: string;
  /** Vault-relative POSIX path. */
  path: string;
  kind?: "note" | "code" | "canvas";
  has_children?: boolean;
}

export type Frontmatter = Record<string, unknown>;

export interface NoteData {
  path: string;
  name: string;
  title: string;
  kind: "note" | "code";
  raw: string;
  frontmatter: Frontmatter;
  body: string;
  /** mtime in seconds; sent back on save to detect outside edits. */
  modified: number;
  bookmarked: boolean;
}

export interface WriteResult {
  ok: boolean;
  conflict: boolean;
  modified: number;
}

export interface SearchHit {
  path: string;
  title: string;
  line_no: number;
  line: string;
}

export interface Mentions {
  linked: SearchHit[];
  unlinked: SearchHit[];
}

export interface Bookmark {
  path: string;
  label: string;
}

export interface IndexEntry {
  path: string;
  title: string;
}

// ── Tareas ─────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  name: string;
  created: string | null;
  start: string | null;
  start_time: string | null;
  due: string | null;
  due_time: string | null;
  status: string;
  subject: string;
  priority: number;
  reminder: string | null;
  reminder_done: boolean;
  body: string;
  repeat: string;
  repeat_until: string | null;
  repeat_label: string;
  overdue: boolean;
  done: boolean;
}

export type TaskFields = Partial<Omit<Task, "id" | "created" | "repeat_label" | "overdue" | "done">>;

export interface TasksMeta {
  statuses: string[];
  status_colors: Record<string, string>;
  done_status: string;
  priority_max: number;
  subjects: string[];
}

// ── Hábitos ────────────────────────────────────────────────────────────────

export interface HabitSubtask {
  id: string;
  name: string;
}

export interface Habit {
  id: string;
  name: string;
  icon: string;
  days: number[];
  subtasks: HabitSubtask[];
  repeat?: string;
  start_date?: string;
  end_date?: string;
  paused_from?: string;
  time?: string;
  duration_min?: number;
  in_calendar?: boolean;
  reminder_min?: number;
  colour?: string;
  notes?: string;
  area?: string;
  exercise_schedules?: Record<string, { time?: string; duration_min?: number; in_calendar?: boolean; end_time?: string; rest_min?: number; start_date?: string | null; end_date?: string | null }>;
  schedule: string;
}

export type HabitFields = Partial<Omit<Habit, "id" | "subtasks" | "schedule">>;

export interface HabitRangeDay {
  date: string;
  active: string[];
  done: string[];
  pct: number;
}

export interface HabitDayLog {
  date: string;
  active: string[];
  completed: Record<string, boolean>;
  subtasks: Record<string, Record<string, boolean>>;
  notes: string;
  journal: string;
}

export interface HabitRates {
  day: number | null;
  week: number | null;
  month: number | null;
  year: number | null;
}

export interface HabitStats {
  today: string;
  day: number;
  week: number;
  month: number;
  year: number;
  streak: number;
  habits: Record<string, HabitRates>;
}

// ── Calendario ─────────────────────────────────────────────────────────────

export interface Occurrence {
  id: string;
  title: string;
  kind: string; // routine | event | habit | exercise | task | project | issue | goal_item | saving
  date: string;
  start: string | null;
  duration_min: number | null;
  colour: string;
  done: boolean;
  source: string;
  editable: boolean;
  checkable: boolean;
  links: Array<Record<string, string>>;
  reminder_min: number | null;
}

export interface CalItem {
  kind: "event" | "routine" | "task";
  id: string;
  date: string;
  title: string;
  start: string | null;
  duration: number | null;
  location: string;
  description: string;
  reminder_min: number | null;
  colour: string | null;
  repeat: string;
  until: string | null;
  subject: string;
}

export interface CalPayload {
  mode: "create" | "edit";
  kind: "event" | "task";
  orig: { kind?: string; id?: string; date?: string };
  title: string;
  date: string;
  start: string | null;
  duration: number | null;
  repeat: string;
  until: string | null;
  location: string;
  description: string;
  subject: string;
  reminder_min: number | null;
  colour: string;
}

export interface CalSettings {
  day_start_hour: number;
  day_end_hour: number;
  default_duration_min: number;
}

export interface CalRoutine {
  id: string;
  title: string;
  start: string | null;
  duration_min: number | null;
  colour: string;
  repeat: string;
  describe: string;
  active_from: string | null;
  active_until: string | null;
  notes: string;
  reminder_min: number | null;
}

// ── Áreas y adjuntos ───────────────────────────────────────────────────────

export interface Area {
  id: string;
  name: string;
  icon: string;
  colour: string;
  order: number;
  archived: boolean;
}

// ── Proyectos ──────────────────────────────────────────────────────────────

export interface ProjectFolder {
  id: string;
  path: string;
  name: string;
  /** The destination folder: new notes are created here. Exactly one per project. */
  target: boolean;
  /** Linked but no longer on disk. */
  missing?: boolean;
}

/** One node of a linked folder's tree, as the explorer receives it. */
export interface FolderEntry {
  name: string;
  rel: string;
  dir: boolean;
  size: number;
  modified: number;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  status: string;
  status_colour: string;
  area: string;
  colour: string;
  icon: string;
  created: string | null;
  start: string | null;
  deadline: string | null;
  columns: string[];
  done_column: string;
  in_calendar: boolean;
  description: string;
  days_left: number | null;
  overdue: boolean;
  /** Windows folders the project works in (the Notas tab). */
  folders: ProjectFolder[];
}

export interface IssueSummary {
  total: number;
  done: number;
  open: number;
  overdue: number;
  progress: number;
  estimate_min: number;
  estimate_done_min: number;
  done_this_week?: number;
  days_left?: number | null;
}

export interface ProjectCard extends Project {
  summary: IssueSummary;
  throughput: number[];
  next_due: { key: string; title: string; due: string } | null;
}

export interface Issue {
  id: string;
  number: number;
  key: string;
  type: string;
  icon: string;
  type_colour: string;
  parent: string;
  title: string;
  status: string;
  priority: number;
  order: number;
  estimate_min: number | null;
  labels: string[];
  created: string | null;
  start: string | null;
  due: string | null;
  due_time: string;
  repeat: string;
  repeat_until: string | null;
  in_calendar: boolean;
  reminder: string | null;
  done_at: string | null;
  attachments: string[];
  updated: string | null;
  description: string;
  children: string[];
  done: boolean;
  overdue: boolean;
  linked_folder: string;
  linked_notes: string[];
}

export interface ProjectDetail {
  project: Project;
  progress: number;
  issues: Issue[];
  stats: {
    summary: IssueSummary;
    by_status: Array<[string, number]>;
    by_priority: Array<[number, number]>;
    by_type: Array<[string, number]>;
    submetas: Array<IssueSummary & { id: string }>;
    burndown: { days: string[]; remaining: Array<number | null>; ideal: number[] };
    throughput: Array<[string, number]>;
    cycle_days: number | null;
  };
}

export interface ProjectsMeta {
  statuses: string[];
  status_colours: Record<string, string>;
  types: string[];
  type_icons: Record<string, string>;
  type_colours: Record<string, string>;
  palette: string[];
  default_columns: string[];
}

export interface ProjectNoteEntry {
  path: string;
  dir: boolean;
  name: string;
  size?: number;
  modified?: number;
}

// ── Metas ──────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  name: string;
  area: string;
  status: string;
  status_colour: string;
  priority: number;
  start: string | null;
  end: string | null;
  icon: string;
  colour: string;
  in_overview: boolean;
  order: number | null;
  created: string | null;
  description: string;
  overdue: boolean;
  days_left: number | null;
  linked_folder: string;
  linked_notes: string[];
}

export interface GoalCard extends Goal {
  progress: number;
  counts: [number, number];
  adherence7: number | null;
  daily: number[];
  next: { name: string; date: string } | null;
  overdue_items: number;
  habits: Array<{ id: string; name: string; icon: string }>;
}

/** Espejo de core/practice/topicLinks.ts (pct 0..100). */
export interface TopicLinkItemProgress {
  link: string;
  topic: string;
  title: string;
  skills: string[];
  broken: boolean;
  done: boolean;
  pct: number;
}
export interface TopicLinkProgress {
  done: boolean;
  pct: number;
  links: TopicLinkItemProgress[];
  missing: Array<{ topic: string; skill: string; reason: "not_mastered" | "exam" | "unknown_skill" | "broken" | "no_skills" }>;
  broken: string[];
}

/** Espejo de core/practice/practiceLinks.ts (pct 0..100). */
export interface PracticeLinkItemProgress {
  link: string;
  kind: "kata" | "project";
  label: string;
  detail: string;
  noData: boolean;
  broken: boolean;
  done: boolean;
  pct: number;
}
export interface PracticeLinkProgress {
  done: boolean;
  pct: number;
  links: PracticeLinkItemProgress[];
  noData: boolean;
}
export interface PracticeCatalog {
  ready: boolean;
  projects: Array<{ folder: string; title: string; state: "spec" | "building" | "defended" | "done"; focus: string; date: string }>;
}
/** Nodo de `goals_tree`: submeta con sus hijas anidadas, enlaces y progreso derivado. */
export interface GoalTreeNode {
  id: string; goal: string; parent: string; name: string; status: string; priority: number;
  start: string | null; due: string | null; progress: number; done: boolean; is_leaf: boolean; counts: [number, number];
  topic_links: string[]; topic_progress: TopicLinkProgress | null;
  practice_links: string[]; practice_progress: PracticeLinkProgress | null;
  habit_links: string[];
  children: GoalTreeNode[];
}
export interface GoalTree { goal: Goal; progress: number; counts: [number, number]; items: GoalTreeNode[] }

export interface GoalItem {
  id: string;
  goal: string;
  parent: string;
  name: string;
  status: string;
  priority: number;
  order: number;
  start: string | null;
  due: string | null;
  due_time: string;
  duration_min: number | null;
  repeat: string;
  repeat_until: string | null;
  in_calendar: boolean;
  reminder_min: number | null;
  target: number | null;
  unit: string;
  value: number | null;
  habit_links: string[];
  /** `<carpeta-del-tema>` o `<carpeta>#skill1+skill2`; con enlaces la submeta se cumple sola. */
  topic_links: string[];
  /** Avance calculado de los `topic_links`; null si no hay enlaces. */
  topic_progress: TopicLinkProgress | null;
  /** `kata:daily[#week=N|#streak=N]`, `project:weekly|monthly[#foco]`, `project:folder:<carpeta>`. Cumplimiento derivado. */
  practice_links: string[];
  /** Avance calculado de los `practice_links`; null si no hay enlaces. */
  practice_progress: PracticeLinkProgress | null;
  done_at: string | null;
  created: string | null;
  notes: string;
  category: string;
  is_priority: boolean;
  children: string[];
  is_leaf: boolean;
  measurable: boolean;
  schedule: string;
  progress: number;
  counts: [number, number];
  adherence7: number | null;
  adherence30: number | null;
  streak: number;
  done_today: boolean;
  value_today: number | null;
  late: boolean;
  linked_folder: string;
  linked_notes: string[];
}

export interface GoalDetail {
  goal: Goal;
  items: GoalItem[];
  categories: string[];
  stats: {
    progress: number;
    counts: [number, number];
    adherence7: number | null;
    adherence30: number | null;
    best_streak: number;
    days_left: number | null;
  };
  history: {
    days: string[];
    daily: number[];
    repeating: Array<{ id: string; name: string; cells: Array<number | null>; streak: number; progress: number }>;
    completed: Array<{ id: string; name: string; done_at: string }>;
  };
}

export interface GoalsTodayRow {
  goal: { id: string; name: string; icon: string; colour: string; area: string };
  item: {
    id: string; name: string; priority: number; due: string | null; due_time: string;
    repeating: boolean; measurable: boolean; target: number | null; unit: string;
  };
  done: boolean;
  value: number | null;
  late: boolean;
  streak: number;
}

export interface GoalsSidebar {
  today: number;
  areas: Record<string, number>;
  no_area: number;
  all: number;
  filters: Record<string, number>;
}

export interface GoalsMeta {
  statuses: string[];
  status_colours: Record<string, string>;
  item_statuses: string[];
  filters: string[];
}

// ── Finanzas ───────────────────────────────────────────────────────────────

export type MovementType = "gasto" | "ingreso" | "ahorro" | "retiro";

export interface Movement {
  id: string;
  type: MovementType;
  amount_cents: number;
  currency: string;
  category?: string;
  goal?: string;
  what?: string;
  reason?: string;
  time?: string;
  attachments: string[];
  created?: string;
  date: string;
}

export interface FinCategory {
  id: string;
  name: string;
  icon: string;
  colour: string;
  kind: "gasto" | "ingreso";
  budget_month_cents: number;
  order: number;
  archived: boolean;
}

export interface FinGoal {
  id: string;
  name: string;
  icon: string;
  colour: string;
  target_cents: number;
  currency: string;
  start: string;
  deadline: string;
  show_in_daily: boolean;
  cadence: { mode: "rule"; rule: string } | { mode: "period"; period: "week" | "month" };
  suggested_cents: number;
  status: string;
  created: string;
  notes: string;
}

export interface FinRecurring {
  id: string;
  type: MovementType;
  amount_cents: number;
  what: string;
  category: string;
  goal: string;
  rule: string;
  start: string;
  end: string;
  archived: boolean;
  last: string;
}

export interface FinPace {  saved: number;
  remaining: number;
  per_day: number | null;
  per_week: number | null;
  per_month: number | null;
  days_left: number | null;
}

export type FinTotals = Record<MovementType | "balance" | "neto" | "disponible", number>;

export interface FinMeta {
  types: MovementType[];
  type_labels: Record<MovementType, string>;
  type_colours: Record<MovementType, string>;
  goal_statuses: string[];
  currency: string;
  categories: FinCategory[];
  goals: FinGoal[];
}

export interface FinSidebar {
  pending: number;
  month: FinTotals;
  general: number;
  goals: Array<{ id: string; icon: string; name: string; saved: number }>;
  total_saved: number;
}

export interface FinCheck {
  goal: FinGoal;
  checked: boolean;
  ids: string[];
  pace: FinPace;
  first: string;
  last: string;
}

export interface FinImportItem {
  date: string;
  type: MovementType;
  amount_cents: number;
  what?: string;
  category?: string;
  goal?: string;
  reason?: string;
  time?: string;
  currency?: string;
}

export interface FinExportData {
  movements: Movement[];
  categories: FinCategory[];
  goals: FinGoal[];
  currency: string;
  total_count: number;
}

export interface FinRule {
  id: string;
  pattern: string;
  category: string;
  type?: MovementType;
  created?: string;
}

export interface FinDuplicateMatch {
  index: number;
  existingId: string;
  existingWhat: string;
  existingAmountCents: number;
  existingDate: string;
  existingType: string;
  reason: string;
}

// ── Ejercicio ──────────────────────────────────────────────────────────────

export interface Exercise {
  id: string;
  day: string;
  name: string;
  video: string;
  video_path: string;
  series_reps: string;
  rest: string;
  how_to: string;
  has_video: boolean;
  video_name: string;
  /** What the body map paints. Ids come from the muscle catalogue. */
  muscles: { primary: string[]; secondary: string[] };
  /**
   * Slug de la entrada de la biblioteca de la que se copió. Vacío si se
   * escribió a mano. Con esto, «¿esto viene de la Biblioteca?» es un dato y no
   * una comparación de nombres.
   */
  source?: string;
  /**
   * Huella de los campos que se copiaron (nombre, cómo hacerlo, músculos).
   * Cuando la entrada de origen cambia, deja de coincidir y el ejercicio se
   * marca como desfasado. Solo lo escribe la biblioteca, nunca tú.
   */
  sourceFp?: string;
}

export interface ExerciseEntry {
  done?: boolean;
  weight?: number;
  reps?: number;
  notes?: string;
}

export interface ExerciseDay {
  date: string;
  day: string;
  exercises: Exercise[];
  log: Record<string, ExerciseEntry>;
  pct: number;
}

export interface ExerciseOverview {
  week: number;
  month: number;
  year: number;
  grid: Record<string, number>;
  breakdown: Array<{ day: string; rows: Array<{ id: string; name: string; done: number; total: number }> }>;
}

/** One period of the Ejercicio module: everything done over everything due. */
export interface ExercisePeriod {
  done: number;
  total: number;
  pct: number;
  /** Days of the period that had a routine and at least one exercise done. */
  trained: number;
  /** Days of the period that had a routine. */
  due: number;
}

export interface ExerciseStats {
  year: number;
  today: { done: number; total: number; pct: number };
  week: ExercisePeriod;
  month: ExercisePeriod;
  anual: ExercisePeriod;
  /** `current` is the run ending today; `best`, the longest of the year. */
  streak: { current: number; best: number };
}

export type { ExerciseGoal, WeightRecord, BodyProfile } from "./exerciseTypes";

// ── Vista General ─────────────────────────────────────────────────────────

export interface HomeOverview {
  today: string;
  habits: Array<{ id: string; name: string; icon: string; done: boolean; subs: [number, number] }>;
  exercise: { day: string; rows: Array<{ id: string; name: string; series_reps: string; how_to: string; entry: ExerciseEntry }> };
  tasks: { today: HomeTask[]; overdue: HomeTask[] };
  projects: {
    issues: Array<{ project: { id: string; name: string; colour: string; done_column: string; first_column: string }; id: string; key: string; title: string; due: string; done: boolean }>;
    active: Array<{ id: string; name: string; icon: string; colour: string; progress: number }>;
  };
  finance: { day: FinTotals; month: FinTotals; prev: FinTotals; checks: Array<{ goal: { id: string; name: string; icon: string; colour: string; suggested_cents: number }; checked: boolean }> };
  goals: {
    list: Array<{ id: string; name: string; icon: string; colour: string; progress: number }>;
    items: Array<{ goal: { id: string; name: string; icon: string; colour: string }; item: { id: string; name: string; priority: number; due_time: string; measurable: boolean; target: number | null; unit: string }; done: boolean }>;
    any: boolean;
  };
}

export interface HomeTask {
  id: string; name: string; status: string; subject: string; priority: number; due: string | null; done: boolean;
}

export interface VaultInfo {
  path: string;
  name: string;
  current?: boolean;
  exists?: boolean;
  markdown: number;
  folders: number;
  code_markers: number;
  truncated: boolean;
  obsidian: boolean;
}

// ── Asistente ──────────────────────────────────────────────────────────────

/** A fragment of a file attached to a user turn. */
export interface ConversationContext {
  path: string;
  start_line?: number;
  end_line?: number;
  text: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  at: number;
  ms?: number;
  stopped?: boolean;
  error?: boolean;
  contexts?: ConversationContext[];
  vote?: 0 | 1 | -1;
}

export interface ConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  count: number;
  model: string;
}

export interface Conversation extends ConversationMeta {
  messages: ConversationMessage[];
}

export interface AiConfig {
  provider: string;
  base_url: string;
  model: string;
  has_key: boolean;
  temperature: number;
  max_tokens: number;
  include_note: boolean;
  is_bridge: boolean;
  /** Claude Code: ruta opcional de claude.exe y timeout por llamada (s). */
  claude_path?: string;
  claude_timeout_s?: number;
}

export interface AiProvider {
  key: string;
  label: string;
  hint: string;
  needs_key: boolean;
  needs_url: boolean;
  default_url: string;
  default_model: string;
  /** Curated models of this provider, offered by the model selector. */
  default_models: string[];
  bridge: boolean;
}

export interface PracticeResult {
  score: number;
  verdict: "correct" | "partial" | "incorrect" | string;
  rubric: boolean[];
  errors: Array<{ category: string; anchor: string; description: string; evidence: string; fix: string }>;
  feedback: string;
  next_step: string;
  example: string;
}

export interface PracticeAttempt { at: string; score: number; verdict: string; quality: number | null; seconds: number; transport: string }

export interface PracticePending { id: string; answer: string; hints_used: number; seconds: number; solution_seen: boolean }

export interface PracticeExercise {
  path: string;
  note_id: string;
  title: string;
  subject: string;
  discipline: string;
  skill: string;
  mode: { id: string; label: string; answer_kind: "text" | "code" | "short" | "drill" };
  difficulty: number;
  level: string;
  assistance: "helper" | "nohelp";
  timer: import("./practiceTimer").TimerSpec;
  statement: string;
  /** English listening: the text the app plays aloud (shown only after grading). */
  audio_text?: string;
  /** English listening from the player: the stretch of a vault media file that is the audio (seconds). */
  media?: { file: string; source?: string; start: number; end: number } | null;
  code: string;
  code_lang: string;
  /** The language the code of this exercise can be run in from the debugger panel ("" when there is nothing to run). */
  run_language: string;
  hints: string[];
  has_solution: boolean;
  rubric: string[];
  drill: { kind: string; label: string; items: number } | null;
  draft: string;
  history: PracticeAttempt[];
  pending: PracticePending | null;
}

export interface PracticeGraded { graded: true; result: PracticeResult; quality: number | null; history: PracticeAttempt[]; solution?: string }
export interface PracticeWaiting {
  graded: false;
  waiting?: boolean;
  request?: string;
  request_path?: string;
  response_file?: string;
  bridge?: boolean;
  prompt?: string;
  url?: string;
  label?: string;
}

export interface LadderInfo {
  path: string;
  title: string;
  subject: string;
  technique: string;
  difficulty: number;
  statement: string;
  steps: number;
  levels: Array<{ number: number; label: string }>;
  state: { current: number; passed: number[]; best: Record<string, number>; count: Record<string, number> };
  history: Array<PracticeAttempt & { level: number }>;
  pending: { id: string; level: number } | null;
}

export interface LadderLevel {
  level: number;
  label: string;
  task: string;
  timer: import("./practiceTimer").TimerSpec;
  fields: string[];
  order?: number[];
  hidden?: number[];
  steps?: Array<{ text: string; why?: string }>;
  variants?: string[];
  variant?: number;
}

export interface LadderData { fields: string[]; order?: number[]; hidden?: number[]; variant?: number }
export interface LadderGraded { graded: true; result: PracticeResult; quality: number | null; rubric: string[]; passed: boolean; message: string; current: number; proof?: string }

export interface StudyExerciseRef { path: string; note_id: string; title: string; discipline: string; skill: string; mode: string; difficulty: number }
export interface StudySnapshot {
  area: { subject: string; title: string; subject_title: string; folder: string };
  exercises: number;
  queue: {
    items: Array<{
      kind: string; title: string; reason: string;
      exercise?: StudyExerciseRef;
      card?: { srs_id: string; source: string; kind: string; question: string; answer: string; missing: boolean };
    }>;
    gaps: string[];
    counts: { recommendations: number; srs_exercises: number; cards: number; total: number };
  };
  ledgers: Array<{
    title: string;
    skills: Array<{
      code: string; title: string; status: "not_started" | "practicing" | "consolidated"; label: string;
      best: number | null; is_due: boolean; due: string; interval_days: number | null; bands: string[];
      exercises: number; attempted: number; practice: string; practice_title: string;
    }>;
  }>;
  concepts: Array<{ title: string; done: number; total: number; best: number | null }>;
  errors: Array<{
    id: string; repeat_count: number; category: string; skill: string; anchor: string;
    description: string; fix: string; seen: string; note: string; source: string;
  }>;
}

export interface WebRules {
  enabled: boolean;
  mode: "blocklist" | "allowlist";
  blocked_domains: string[];
  blocked_patterns: string[];
  allowed_domains: string[];
  daily_limits: Record<string, number>;
  confirm_to_relax: boolean;
}
export interface WebOverview {
  bookmarks: Array<{ id: string; title: string; url: string; folder?: string }>;
  history: Array<{ time: string; url: string; title: string }>;
  history_days: string[];
  day: string;
  usage: Array<{ host: string; seconds: number }>;
  week: Array<{ date: string; seconds: number }>;
  restrictions: WebRules;
  limits: Array<{ domain: string; minutes: number; used: number }>;
  presets: string[];
  relax_phrase: string;
  embedded: boolean;
}

/** A podcast, film or TED talk of the learner's library, with its transcript. */
export interface EnglishSource {
  id: string;
  kind: "podcast" | "movie" | "ted";
  title: string;
  media: string;
  transcript: string;
  added: string;
  has_media: boolean;
  has_transcript: boolean;
  /** the transcript has times (SRT/VTT); plain text is read sentence by sentence */
  timed: boolean;
}

export interface EnglishRecording {
  id: string;
  name: string;
  size: number;
  modified: number;
}

export interface CodeRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  ms: number;
  timed_out: boolean;
  truncated: boolean;
  runtime: string;
}

export interface CodeStep {
  line: number;
  fn: string;
  depth: number;
  vars: Array<[string, string]>;
  out: number;
  ret?: string;
  exc?: string;
}

export interface CodeTrace extends CodeRun {
  steps: CodeStep[];
  steps_truncated: boolean;
}

export interface CodeRuntime {
  id: string;
  label: string;
  available: boolean;
  runtime: string;
}

export interface PlayerMedia {
  id: string;
  url: string;
  name: string;
  seconds: number;
  pairs: import("./player").Pair[];
  en_file: string;
  es_file: string;
}

export interface TopicMasteryConfig {
  min_per_skill: number;
  target_difficulty: 1 | 2 | 3;
  exam: "required" | "optional" | "none";
}

export interface TopicManifest {
  type: "topic";
  subject: string;
  title: string;
  skills: string[];
  mastery: TopicMasteryConfig;
  exam_group?: string;
  /** The AI's plan for this topic: passes needed per skill at [easy, medium, hard]. */
  plan?: Record<string, [number, number, number]>;
  path?: string;
  folder?: string;
}

export interface TopicCellProgress {
  skill: string;
  difficulty: 1 | 2 | 3;
  attempts: number;
  passes: number;
  bestScore: number | null;
  /** passes this cell needs per the topic's plan (undefined without a plan) */
  required?: number;
}

export interface TopicSkillProgress {
  skill: string;
  label: string;
  description: string;
  status: "not_started" | "practicing" | "consolidated";
  totalAttempts: number;
  totalPasses: number;
  bestScore: number | null;
  highestPassedDifficulty: 1 | 2 | 3 | 0;
  cells: Record<1 | 2 | 3, TopicCellProgress>;
  consolidated: boolean;
  mastered: boolean;
}

export interface TopicProgress {
  topic: TopicManifest;
  skills: Record<string, TopicSkillProgress>;
  examPassed: boolean;
  examScore: number | null;
  isComplete: boolean;
  completenessPct: number;
  theoryNotesCount: number;
  exerciseNotesCount: number;
}

export interface TopicData {
  is_topic: boolean;
  folder: string;
  topic?: TopicManifest;
  progress?: TopicProgress;
  theory_notes?: Array<{ rel: string; title: string }>;
  exercises?: StudyExerciseRef[];
  can_convert?: boolean;
}

export interface TopicSessionResult {
  ok: boolean;
  skill: string;
  difficulty: number;
  assistance: string;
  target_count: number;
  existing_count: number;
  generated_count: number;
  exercises: Array<{ id: string; title: string; path: string; is_new: boolean }>;
  first_exercise: string;
}

export interface ExamSkillVerdict {
  passed: boolean;
  score: number;
  totalQuestions?: number;
}

export interface ExamRecord {
  id: string;
  topic_or_group: string;
  passed: boolean;
  score: number;
  skills: Record<string, ExamSkillVerdict>;
  created_at: string;
  duration_seconds: number;
  topicsCovered?: string[];
}

export interface ExamExerciseItem {
  id: string;
  title: string;
  topicTitle: string;
  skill: string;
  difficulty: 1 | 2 | 3;
  statement: string;
  filePath?: string;
  isNew?: boolean;
}

export interface ExamSession {
  id: string;
  title: string;
  topicOrGroup: string;
  isGrouped: boolean;
  targetDifficulty: 1 | 2 | 3;
  topics: TopicManifest[];
  items: ExamExerciseItem[];
  timeLimitMinutes: number;
  assistance: "no_help";
}

export interface ExamItemSubmission {
  itemId: string;
  answerText: string;
}

export interface ExamItemGradingResult {
  itemId: string;
  skill: string;
  score: number;
  passed: boolean;
  feedback: string;
}

export interface TopicDashboardItem {
  folder: string;
  area: string;
  subject: string;
  manifest: TopicManifest;
  progress: TopicProgress;
}

export interface TopicDashboardData {
  subjects: string[];
  areas: string[];
  topics: TopicDashboardItem[];
  /** True when the vault index is still warming and the payload is provisional. */
  loading?: boolean;
}



export interface PracticePlanSkill {
  skill: string;
  counts: Record<1 | 2 | 3, number>;
  why: string;
}

export interface PracticePlan {
  skills: PracticePlanSkill[];
  summary: string;
  topicType?: "theoretical" | "procedural" | "mixed";
}

export interface ReviewItem {
  path: string;
  topic: string;
  topicPath: string;
  subject: string;
  subjectFolder: string;
  next: string;
  last: string;
  level: number;
  inDays: number;
  skills: string[];
  practicedDays: number;
  /** the pending review and the ones after it, if each is done on its date */
  upcoming: Array<{ date: string; interval: number; level: number }>;
  /** `vocab` for a word of the English word bank; absent for topic reviews */
  kind?: "topic" | "vocab";
}

// ── programming_practice (weekly projects in four phases) ─────────────────
export type PpState = "spec" | "building" | "defended" | "done";
export interface PpProject { folder: string; title: string; state: PpState; focus: string; client: string; score?: number }
export interface PpStatus {
  space: string;
  ready: boolean;
  projects: PpProject[];
  kataReady: boolean;
  weaknesses: Array<{ label: string; layer: string; count: number; status: string }>;
  suggestedFocus: string | null;
  summary: string;
}
export interface PpIdea { title: string; problem: string; client: string; focus: string; hours: number; why: string }
export interface PpEstimate {
  layers: Array<{ layer: string; files: number; left: number; tokens: number }>;
  totalTokens: number;
  skipped: number;
  changed: number | null;
  checks: Array<{ label: string; skip: string }>;
  previousDefenses: number;
}
export interface PpIssue { severity: "high" | "medium" | "low"; file: string; line?: number; problem: string; why: string; fix: string }
export interface PpDefense {
  n: number;
  rel: string;
  final: { functional: boolean; score: number; summary: string; mustFix: string[]; questions: Array<{ id: string; question: string; why: string }> };
  layers: Array<{ layer: string; verdict: string; issues: PpIssue[]; strengths: string[] }>;
  checks: Array<{ label: string; status: string; ms: number }>;
  conversationId: string;
}
export interface PpGrade { score: number; items: Array<{ id: string; verdict: string; feedback: string }>; summary: string; gaps: string[] }
export interface PpPostmortem {
  postmortem: { score: number; summary: string; weaknesses: Array<{ label: string; layer: string }>; strengths: string[]; styleNotes: string[]; nextFocus?: string };
  rel?: string;
  summary: string;
  conversationId: string;
}

// ── Mentor (informe, candidatos y registro de sesiones; ver core/mentor) ──
export interface MentorBriefSection {
  id: string;
  title: string;
  priority: number;
  summary: string;
  signals: string[];
  lines: Array<{ text: string; weight: number }>;
  /** datos tipados por proveedor; la UI no los necesita para pintar, solo `lines` */
  data: unknown;
}
export interface MentorBrief {
  version: 1;
  date: string;
  weekday: string;
  sections: MentorBriefSection[];
  skipped: string[];
}
export interface MentorBriefResult { brief: MentorBrief; text: string }
export type MentorCandidateKind =
  | "srs_review" | "error_fix" | "continue_topic" | "next_topic"
  | "untreated_diagnostic" | "task_deadline" | "goal_item" | "plan_item"
  | "programming_practice_kata" | "programming_practice_project";
export interface MentorCandidate {
  id: string;
  kind: MentorCandidateKind;
  subject: string;
  topicFolder?: string;
  skills?: string[];
  estMinutes: number;
  score: number;
  reasons: string[];
  links: { goalId?: string; itemId?: string; topicFolder?: string; subplanId?: string; subplan?: string };
}
export interface MentorCandidatesResult {
  availableMinutes: number;
  /** todos los candidatos que caben, mejor primero */
  candidates: MentorCandidate[];
  /** subconjunto repartido con presupuesto por materia */
  plan: MentorCandidate[];
  plannedMinutes: number;
}
export type MentorBlockStatus = "planned" | "done" | "skipped" | "partial";
export interface MentorPlanBlock {
  candidateId: string;
  kind: string;
  subject: string;
  topicFolder?: string;
  minutes: number;
  status: MentorBlockStatus;
  reason?: string;
  note?: string;
  /** subplan del plan mensual del que viene (chip "Plan: …") */
  plan?: string;
}
export interface MentorSessionRecord {
  date: string;
  availableMinutes: number;
  objective?: string;
  blocks: MentorPlanBlock[];
  createdAt: string;
  acceptedAt?: string;
}
/** Objetivo de la sesión de Hoy (espejo de core/mentor/objective.ts). */
export type MentorSessionObjective =
  | { type: "none" }
  | { type: "tasks" }
  | { type: "review" }
  | { type: "plan" }
  | { type: "programming_practice" }
  | { type: "subject"; subject: string; label?: string }
  | { type: "goal"; goalId: string; itemIds?: string[]; label?: string }
  | { type: "custom"; text: string };
export interface MentorObjectiveOptions {
  goals: Array<{ goalId: string; name: string; area: string; kind: "daily" | "weekly" | "due" | "topics"; itemIds: string[]; hint: string }>;
  subjects: Array<{ subject: string; label: string; topics: number; open: number }>;
  tasksPending: number;
  plan: { month: string; items: number; id?: string; start?: string; end?: string; minutesPerDay?: number | null } | null;
  /** lo que la pista Programming practice de los planes activos pide hoy (kata + proyecto); null si ningún plan activo la tiene */
  programmingPractice?: { items: number } | null;
}
export interface MentorPlanRequest {
  availableMinutes: number;
  objective?: string;
  /** objetivo estructurado: influye de forma determinista en los candidatos */
  objectiveSpec?: MentorSessionObjective;
  userNote?: string;
  excludeSubjects?: string[];
  excludeCandidateIds?: string[];
}
export interface MentorProposedBlock {
  candidateId: string;
  minutes: number;
  reason: string;
  kind: MentorCandidateKind;
  subject: string;
  topicFolder?: string;
  skills?: string[];
  plan?: string;
}
export interface MentorProposedPlan { summary: string; blocks: MentorProposedBlock[]; notes?: string }
export type MentorProposeResult =
  | { loading: true }
  | {
      loading: false;
      availableMinutes: number;
      /** texto del objetivo de la sesión ya resuelto (para registrarlo al aceptar) */
      objective?: string;
      plan: MentorProposedPlan;
      source: "ai" | "fallback";
      candidates: MentorCandidate[];
      /** por qué se usó el plan automático */
      error?: string;
    };
export type MentorOverview =
  | { loading: true }
  | {
      loading: false;
      date: string;
      weekday: string;
      sections: Array<{ id: string; title: string; summary: string; signals: string[] }>;
      adherence: MentorAdherence;
      today: MentorSessionRecord | null;
      aiConfigured: boolean;
      objectives?: MentorObjectiveOptions;
    };
export interface MentorAdherenceCounts {
  total: number; done: number; partial: number; skipped: number; planned: number;
  pct: number | null;
}
export interface MentorAdherence {
  sessions: number;
  overall: MentorAdherenceCounts;
  bySubject: Record<string, MentorAdherenceCounts>;
  byKind: Record<string, MentorAdherenceCounts>;
  skippedSubjects: string[];
  typicalSessionMinutes: number | null;
}

// ── Mentor: conversación para crear metas y previsualizaciones (core/mentor/goalDraft.ts) ──
export interface MentorScheduledItem {
  name: string;
  folders: string[];
  topic_links: string[];
  minutes: number;
  start: string;
  due: string;
  weekFrom: number;
  weekTo: number;
}
export interface MentorGoalSchedule {
  start: string;
  end: string;
  weeks: number;
  hoursPerWeek: number;
  totalMinutes: number;
  availableMinutes: number;
  fits: boolean;
  requiredHoursPerWeek: number;
  items: MentorScheduledItem[];
  warnings: string[];
}
export interface MentorGoalDraft {
  name: string;
  area: string;
  description: string;
  topics: Array<{ folder: string; title: string; subject: string; skills: string[]; why: string; estMinutes: number }>;
  schedule: MentorGoalSchedule;
  discarded: string[];
}
export interface MentorChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  draft?: MentorGoalDraft;
  createdGoalId?: string;
  discarded?: boolean;
  planDraft?: MentorPlanDraft;
  acceptedPlan?: string;
  /** plan propuesto que el Mentor creó en este turno */
  createdPlan?: string;
}
export interface MentorChatState { id?: string | null; title?: string; turns: MentorChatTurn[]; pending: string | null }
export type MentorChatResult =
  | { loading: true }
  | ({ loading: false; kind: "question" | "draft" | "plan_draft" | "error" | "no_ai"; text: string; draft?: MentorGoalDraft; planDraft?: MentorPlanDraft } & MentorChatState);

// ── Mentor: plan mensual (core/mentor/plan.ts) ──
export type MentorDeliverableStatus = "idea" | "en_curso" | "hecho";
export type MentorTopicState = "sin_tratar" | "practicando" | "consolidado" | "completo" | "examen_pendiente" | "no_encontrado";
export interface MentorPlannedTopic {
  folder: string; title: string; skills?: string[]; targetWeek: number; estMinutes: number; completedAt?: string; diagnostic?: boolean; pinned?: boolean;
  /** grupo interno del área (Bases, Lenguaje: Python, Conocimientos…) */
  group?: string;
  /** ruta: ausente = en la ruta (`core`) · `optional` · `skipped` (fuera de ruta, atenuado; la nota NO se borra); ver `lib/planRoute.ts` */
  route?: "optional" | "skipped"; skippedReason?: string;
  /** proyecto de aplicación tras el tema, calibrado al nivel medido (ver `lib/planTopicProject.ts`) */
  topicProject?: import("./planTopicProject").TopicProject;
  /** llegó al plan con «Añadir al plan» (temas de referencia creados con el agente externo) */
  addedFrom?: "curriculum";
  /** identificador estable del tema (resiste cambios en la estructura de carpetas de la vault) */
  topicId?: string;
  tags?: string[];
}
export interface MentorWeekSlice { week: number; start: string; end: string; topics: string[]; minutes: number; capacityMinutes: number }
export interface MentorRequiredGoal { goalId: string; itemId?: string; note: string }
export interface MentorDeliverable { title: string; description: string; criteria: string[]; projectId?: string; status: MentorDeliverableStatus }
export interface MentorSubplan {
  id: string; area: string; objective: string; goalId?: string; goalItemIds?: string[];
  topics: MentorPlannedTopic[]; weeks: MentorWeekSlice[]; requiredGoals: MentorRequiredGoal[]; deliverable?: MentorDeliverable; notes?: string;
  /** plan por áreas: id del área elemental, sus grupos internos, sus semanas activas y, si se completó con reglas, por qué */
  areaId?: string; groups?: AreaGroup[]; phase?: AreaPhase; fallback?: { kind: "rules" | "mixed"; reason: string };
}
/** Decisión pendiente al armar el plan (hoy: entregables «a discutir»). */
export interface MentorOpenQuestion { id: string; subplanId?: string; text: string; options: string[] }
export interface MentorPlan {
  id: string; start: string; end: string; month?: string; name?: string; archived?: boolean; proposed?: boolean; createdAt: string; updatedAt: string;
  hoursPerWeek?: number; preconditions?: PlanPreconditions; auto?: boolean; rationale?: string; subplans: MentorSubplan[];
  /** pista Programming practice: kata diario + proyecto semanal full stack (+ mensual) */
  programmingPractice?: PracticeTrack;
  openQuestions?: MentorOpenQuestion[];
  /** «areas» = estructura por áreas elementales; ausente = estructura antigua (se puede «Reorganizar por áreas») */
  structure?: "areas";
  /** entregables editados a mano (por id) y extras; los de práctica y de área se derivan del plan */
  deliverables?: PlanDeliverable[];
  /** propósitos de día / semana / mes escritos a mano */
  purposes?: PlanPurposes;
  /** última revisión de cobertura con el Mentor (solo informa) */
  coverageReview?: CoverageReview;
  /** currículo de práctica del plan generado por la IA (ejercicios por semana y proyectos) */
  practiceCurriculum?: MentorPracticeCurriculum;
  /** cómo se combinan las áreas, ya decidido (`together` = todas juntas cada día · `phased` = por fases), por qué y quién lo decidió */
  areaMode?: "together" | "phased";
  areaModeWhy?: string;
  areaModeBy?: "user" | "ai" | "rules";
  /** cuándo (ISO) quedaron definidos los entregables (los fija la ejecución del plan); ausente y sin entregables propios = «por definir» */
  deliverablesDefinedAt?: string;
  /** ritmo diario manual (temas por día y mínimo, global y por área); ausente = reparto automático por minutos */
  pace?: import("./planPace").DailyPace;
  /** temas añadidos a mano a un día y práctica diaria extra (ver `lib/planPace.ts`) */
  extraTopics?: import("./planPace").ExtraTopic[];
  extraPractice?: import("./planPace").ExtraPractice[];
}
/** Candidatos para un tema extra (`mentor_plan_topic_candidates`): los siguientes de la ruta y los de la vault fuera del plan. */
export interface MentorTopicCandidate {
  folder: string;
  title: string;
  inPlan: boolean;
  /** solo temas del plan */
  area?: string;
  subplanId?: string;
  position?: number;
  total?: number;
  estMinutes?: number;
  targetWeek?: number;
  /** solo temas de la vault */
  subject?: string;
  /** fechas a las que ya se añadió como extra */
  addedDates: string[];
  /** solo con `upcoming`: semana del plan en que cae, día planeado, tipo (grupo), estado y el tema que va antes si aún no se puede adelantar */
  week?: number;
  plannedDate?: string;
  group?: string;
  state?: "pendiente" | "planeado" | "adelantado";
  /** ya está en el día pedido (planeado o adelantado) */
  onDay?: boolean;
  blockedBy?: string;
}
export type MentorTopicCandidates =
  | { loading: true }
  | {
      loading: false;
      ahead: MentorTopicCandidate[];
      vault: MentorTopicCandidate[];
      /** solo con `upcoming`: rango de fechas de cada semana, temas ya planeados ese día por área, el día pedido y la semana actual */
      weeks?: Record<string, { from: string; to: string }>;
      plannedByArea?: Record<string, number>;
      date?: string;
      currentWeek?: number;
    };
/** Un ejercicio ya planeado de un tema de la ruta, aún sin intentos (`mentor_plan_exercise_candidates`). */
export interface MentorExerciseCandidate {
  subplanId: string;
  area: string;
  folder: string;
  topic: string;
  rel: string;
  title: string;
  difficulty?: number;
  /** día en que cae el tema en el reparto */
  date?: string;
  addedDates: string[];
}
/** Un kata planeado del área que aún no toca (`mentor_area_katas_ahead`). */
export interface MentorKataAhead {
  areaId: string;
  subplanId: string;
  area: string;
  day: number;
  date: string;
  title: string;
  skill: string;
  level: number;
  minutes: number;
  addedDates: string[];
}
export type MentorExerciseCandidates = { loading: true } | { loading: false; exercises: MentorExerciseCandidate[] };
/** currículo de práctica del plan generado por la IA (ejercicios por semana y proyectos) */
export type MentorPracticeCurriculum = import("./planCurriculum").PracticeCurriculum;
export type MentorMonthlyPlan = MentorPlan;
/** Cobertura de teoría y práctica del plan contra la vault, y la revisión guardada (`mentor_plan_coverage`). */
export type MentorPlanCoverage = { loading: true } | { loading: false; coverage: PlanCoverage; review: CoverageReview | null; aiConfigured: boolean };
/** Catálogo de TODOS los temas de la vault con lo que existe de cada uno y su lugar en el plan (`mentor_plan_topic_catalog`); ver `lib/planTopicCatalog.ts`. */
export type MentorPlanTopicCatalog = { loading: true } | { loading: false; rows: import("./planTopicCatalog").PlanTopicRow[] };
/** Resultado de «Revisar cobertura con el Mentor» (`mentor_plan_coverage_review`): `source: "none"` = sin IA (no se guarda nada). */
export type MentorCoverageReviewResult =
  | { loading: true }
  | { loading: false; source: "ai"; review: CoverageReview; plan: MentorPlan; coverage: PlanCoverage }
  | { loading: false; source: "none"; reason: string; coverage: PlanCoverage };
/** «Ejecutar plan»: informe (qué falta crear y cuánto cuesta) y estado de la cola de ejecución; ver `lib/planExecution.ts`. */
export type MentorExecutionReport = import("./planExecution").ExecutionReport;
export interface MentorExecutionView { state: import("./planExecution").ExecutionState; progress: import("./planExecution").ExecutionProgress }
export type MentorExecutionReportResult = { loading: true } | { loading: false; report: MentorExecutionReport; execution: MentorExecutionView | null; aiConfigured: boolean };
/** Esquema de traspaso para otra IA (`mentor_handoff_*`): lo que falta por crear, repartido en planes pequeños; ver `lib/handoffPlan.ts`. */
export interface MentorHandoffScheme {
  version: 1;
  planId: string;
  createdAt: string;
  source: "rules" | "ai";
  note?: string;
  options: { perCell: number; maxFiles: number; maxTheory: number; ladder: boolean };
  packages: import("./handoffPlan").HandoffPackage[];
  totals: { packages: number; files: number; topics: number };
  pending: { packages: number; files: number; topics: number };
}
export type MentorExecutionStartResult = { loading: true } | { loading: false; execution: MentorExecutionView | null };
/** Sistema de práctica por área de un plan (`mentor_area_practice`); ver `lib/areaPracticeView.ts`. */
export interface MentorAreaPractice { today: string; ppReady: boolean; ppBase: string; areas: import("./areaPracticeView").AreaPracticeView[] }
export interface MentorTopicView extends MentorPlannedTopic { state: MentorTopicState; pct: number; found: boolean; exercises?: number }
export interface MentorSubplanView { id: string; topics: MentorTopicView[]; total: number; done: number; pct: number; currentWeek: number }
export interface MentorPlanDerived {
  subplans: MentorSubplanView[];
  summary: { subplans: number; topics: number; done: number; pct: number; currentWeek: number; weeks: number; /** ¿hay entregables definidos? (si no, se muestran «por definir») */ deliverablesDefined?: boolean };
}
export interface MentorPlanItem {
  kind: "topic" | "deliverable" | "project"; planId: string; subplanId: string; label: string; area: string; title: string;
  /** agenda por enfoque: papel del tema hoy, enfoque del día y (proyecto diario) los temas a los que se conecta */
  role?: "theory" | "practice" | "both"; focus?: string; connected?: string[];
  folder?: string; skills?: string[]; estMinutes: number; targetWeek: number; overdue: boolean; scheduledToday?: boolean; todayMinutes?: number;
}
export interface MentorPlanDraft {
  id?: string; start?: string; end?: string;
  preconditions?: PlanPreconditions; auto?: boolean; coverage?: string; fallbackReason?: string;
  month: string; hoursPerWeek: number; rationale: string; subplans: MentorSubplan[]; warnings: string[]; fits: boolean;
  totalMinutes: number; availableMinutes: number; requiredHoursPerWeek: number | null; from: string; discarded: string[];
  why: Record<string, string>;
  programmingPractice?: PracticeTrack;
  openQuestions?: MentorOpenQuestion[];
  weights?: Record<string, number>;
  compact?: boolean;
  structure?: "areas";
  areaMode?: "together" | "phased";
  areaModeWhy?: string;
  areaModeBy?: "user" | "ai" | "rules";
}
/** Estado derivado de la práctica de un plan (módulo `programming_practice` + registro manual de «Hoy»). */
export interface MentorPracticeStatus {
  ppReady: boolean;
  kata: { plannedDays: number; doneDays: number; streak: number; todayPlanned: boolean; todayDone: boolean } | null;
  /** fechas de días de kata ya hechos */
  kataDoneDates?: string[];
  weeks: Array<{
    week: number;
    phases: Record<PracticePhase, PhaseStatus>;
    project?: { folder: string; title: string; state: "spec" | "building" | "defended" | "done"; score?: number };
    current: boolean;
    source: "pp" | "manual" | "mixed" | "none";
  }>;
}
export type MentorPlanGet =
  | { loading: true }
  | {
      loading: false; id: string | null; month: string; today: string; status?: MentorPlanStatus; plan: MentorPlan | null; derived: MentorPlanDerived | null;
      goals: Record<string, { name: string; pct: number; items: Record<string, { name: string; pct: number }> }>;
      projects: Record<string, { id: string; name: string; status: string }>;
      items: MentorPlanItem[]; practiceItems?: PracticeItem[]; practice?: MentorPracticeStatus | null;
      /** por fecha, las áreas con su proyecto diario COMPLETO (la señal de avance de la cadena de entregables) */
      dailyProjectDone?: Record<string, string[]>;
      months: string[]; plans: MentorPlanRow[]; aiConfigured: boolean;
    };
export type MentorPlanStatus = "activo" | "futuro" | "terminado" | "propuesto";
export interface MentorPlanRow {
  id: string; start: string; end: string; month?: string; name: string; period: string; status: MentorPlanStatus; archived: boolean; auto: boolean;
  subplans: number; topics: number; completed: number; pct: number; minutesPerDay: number | null; programmingPractice?: boolean; structure?: "areas";
}
/** Compatibilidad: antes solo había planes mensuales. */
export type MentorPlanListRow = MentorPlanRow;
export interface MentorPlanAccepted { id: string; month: string; start: string; end: string; subplans: number; topics: number; warnings: string[]; fits: boolean }
export type MentorPlanOptions =
  | { loading: true }
  | {
      loading: false; today: string; aiConfigured: boolean;
      goals: Array<{ id: string; name: string; area: string; end: string | null; topics: number; minutes: number }>;
      areas: Array<{ id: string; name: string; total: number; pending: number; minutes: number; branches?: Array<{ name: string; total: number; pending: number; kind: string }> }>;
      topics: ScopeTopic[];
    };
export type MentorPlanGenerateResult =
  | { loading: true }
  | ({ loading: false; kind: "plan_draft"; source: "ai" | "auto"; text: string; planDraft: MentorPlanDraft; chatId: string } & MentorChatState)
  | ({ loading: false; kind: "plan_created"; source: "ai" | "auto"; text: string; planId: string; planDraft: MentorPlanDraft; chatId: string } & MentorChatState);

// ── Constructor guiado del plan (core/mentor/planBuild.ts) ──
export interface MentorBuildStep { stage: BuildStage; state: "done" | "current" | "pending"; summary: string }
export interface MentorSkeletonRow { key: string; area: string; objective: string; topics: number; minutes: number; hours: number; sharePct: number }
export interface MentorPlanBuild {
  id: string; createdAt: string; updatedAt: string; pre: PlanPreconditions; effective: PlanPreconditions; stage: BuildStage; steps: MentorBuildStep[];
  answers: BuildAnswer[]; draft: MentorPlanDraft | null; skeleton: MentorSkeletonRow[] | null; openQuestion?: BuildQuestion; source: "ai" | "rules";
  questionCount: number; maxQuestions: number; status: "building" | "review" | "abandoned"; finishing: boolean; name: string;
}
export interface MentorBuildSummary {
  id: string; name: string; period: string; stage: BuildStage; stageNumber: number; stages: number; status: "building" | "review" | "abandoned";
  question: string | null; questionId?: string; options?: Array<{ id: string; label: string }>; allowText?: boolean; updatedAt: string; source: "ai" | "rules";
}
export type MentorBuildResult = { loading: true } | { loading: false; build: MentorPlanBuild; summary: MentorBuildSummary };
/** Estado de una llamada larga de la IA («pensando…»). */
export interface MentorAiStatus { busy: boolean; label: string; elapsed: number }
export interface MentorChangeDelta { added: number; removed: number; moved: number; deliverables: number; structure?: number; texts?: number }
export interface MentorFixOption { id: string; label: string; op: Record<string, unknown> }
export interface MentorChangeEntry {
  n: number; at: string; comment: string; status: "applied" | "pending" | "undone" | "answered"; source: "ai" | "rules" | "none"; summary: string;
  /** pregunta, corrección o ajuste (ausente = ajuste) y, en las preguntas, la respuesta del Mentor */
  kind?: "question" | "fix" | "adjust"; answer?: string;
  delta: MentorChangeDelta; changed: string[]; warnings: string[]; fixOptions: MentorFixOption[];
}
export type MentorChangeResult = { loading: true } | { loading: false; plan: MentorPlan; entry: MentorChangeEntry; history: MentorChangeEntry[]; applied: boolean };
/** «Preguntar»: la respuesta del Mentor sobre el plan (no cambia nada). */
export type MentorAskResult = { loading: true } | { loading: false; answer: string; source: "ai" | "rules" | "none"; understood: boolean; entry: MentorChangeEntry; history: MentorChangeEntry[] };
/** Clasificación de lo escrito: `confident: false` trae la pregunta de aclaración. */
export interface MentorIntentResult { intent: "question" | "fix" | "adjust"; confident: boolean; ask?: string; source: "ai" | "rules" }
export interface MentorGoalCreated { goalId: string; name: string; items: number; schedule: MentorGoalSchedule }
export interface MentorGoalItemSlim {
  id: string; parent: string; name: string; status: string; due: string | null; start: string | null;
  is_leaf: boolean; progress: number; topic_links: string[]; topic_progress: TopicLinkProgress | null; late: boolean;
  priority: number; category: string; schedule: string; is_priority: boolean; counts: [number, number]; done_today: boolean;
}
export interface MentorIssueSlim {
  id: string; key: string; title: string; status: string; priority: number; parent: string;
  due: string | null; overdue: boolean; icon: string; type: string; type_colour: string;
}
export type MentorProjectCard = ProjectCard & { issues: MentorIssueSlim[] };
export interface MentorChatMeta { id: string; title: string; createdAt: string; updatedAt: string; count: number; active: boolean }
export interface MentorTopicRow {
  folder: string; title: string; subject: string; completenessPct: number; lastAttemptDays: number | null; pendingSkills: string[];
}
export interface MentorAreaTopic {
  folder: string; title: string; group: string; status: "complete" | "in_progress" | "untreated"; examPending: boolean;
  completenessPct: number; lastAttemptDays: number | null; weakSkills: string[];
}
export interface MentorStudyArea {
  id: string; name: string; icon: string; colour: string; lifeArea: string;
  total: number; inProgress: number; untreated: number; complete: number; examPending: number; avgPct: number;
  srsDue: number; errors: number;
  next: { kind: string; title: string; folder?: string } | null;
  groups: Array<{ key: string; title: string; topics: MentorAreaTopic[] }>;
}
export type MentorPanels =
  | { loading: true }
  | {
      loading: false;
      goals: Array<{ card: GoalCard; items: MentorGoalItemSlim[] }>;
      areas: Array<{ id: string; name: string; icon: string; colour: string }>;
      projects: MentorProjectCard[];
      study: {
        topics: { total: number; inProgress: number; untreated: number; complete: number; inProgressList: MentorTopicRow[]; untreatedList: MentorTopicRow[]; recentList: MentorTopicRow[] };
        areas: MentorStudyArea[];
        srs: { dueTotal: number; bySubject: Array<{ subject: string; count: number; oldestOverdueDays: number; lapses: number }> };
        errors: { unresolved: number; repeaters: Array<{ id: string; subject: string; topic: string; skill: string; category: string; repeatCount: number; lastSeenDays: number | null }> };
      };
    };

/** `mentor_route`: la ruta del plan activo (o de todos los activos) para el explorador de notas y el estudio con el Mentor. Solo lee. */
export interface MentorRoute {
  today: string;
  plans: Array<{
    planId: string;
    name: string;
    status: "activo" | "futuro" | "terminado" | "propuesto";
    start: string;
    end: string;
    currentWeek: number;
    counts: { core: number; optional: number; skipped: number };
    topics: Array<import("./planRoute").RouteEntry>;
  }>;
  /** por carpeta de tema: core/optional si algún plan lo tiene en ruta; skipped solo si todos los que lo tienen lo saltan */
  byFolder: Record<string, { planId: string; route: "core" | "optional" | "skipped"; targetWeek: number; weekStart: string; area: string; skippedReason?: string }>;
}

// ── Ruta del plan: pasar temas a «fuera de ruta» o devolverlos a la ruta (nunca borra nada de la vault) ──
export interface MentorRouteChangeResult {
  plan: MentorPlan;
  /** la entrada del historial del plan (deshacible con `mentor_plan_change_undo`) */
  entry?: MentorChangeEntry;
  history?: MentorChangeEntry[];
  /** temas que cambiaron de ruta */
  changed: number;
  /** los que se saltaron, con su motivo */
  skipped?: Array<{ folder: string; reason: string }>;
  /** los que NO se pudieron saltar (completados, prerrequisitos…), con su motivo */
  rejected?: Array<{ folder: string; reason: string }>;
  /** temas vivos que quedan en el alcance */
  live?: number;
}

/** `mentor_plan_add_topics`: temas de referencia añadidos al final de la ruta de su área. */
export interface MentorAddTopicsResult {
  plan: MentorPlan;
  entry?: MentorChangeEntry;
  history?: MentorChangeEntry[];
  /** carpetas añadidas (vacío = ya estaban todas) */
  added: string[];
  /** ids de los subplans que recibieron temas */
  addedTo?: string[];
  skipped: Array<{ folder: string; reason: string }>;
  /** ids de los subplans creados por la operación */
  created?: string[];
  changed: number;
  message: string;
}

// ── Cierre del día y memoria del Mentor (`mentor_day_record`, `mentor_day_close`, ver core/mentor/dayClose.ts) ──
export type MentorCorrectionKind = "redo" | "review" | "note_fix" | "practice" | "plan";
export type MentorCorrectionStatus = "open" | "task" | "done" | "dismissed";
export interface MentorDayRecord {
  date: string;
  builtAt: string;
  planned: { topics: number; minutes: number; done: number; pending: Array<{ folder: string; title: string }> };
  completed: string[];
  attempts: { total: number; counted: number; avgScore: number | null; minutes: number; wrong: number };
  weak: Array<{ key: string; discipline: string; skill: string; attempts: number; avgScore: number; errors: number }>;
  errorsByCategory: Record<string, number>;
  katas: { done: number; skipped: number };
  sessions?: { count: number; minutes: number; avgUnderstanding: number | null; avgFocus: number | null; doubts: string[]; errors: string[]; openTopics: number };
}
export interface MentorStudentDay { mood?: 1 | 2 | 3 | 4 | 5; feeling: string; notes: string }
export interface MentorDayReview {
  source: "ai" | "rules";
  summary: string;
  observations: string[];
  studentSaid: string[];
  corrections: Array<{ title: string; why: string; kind: MentorCorrectionKind; topic?: string }>;
}
export interface MentorCorrection { id: string; title: string; why: string; kind: MentorCorrectionKind; topic?: string; date: string; status: MentorCorrectionStatus; taskId?: string }
export interface MentorMemory {
  version: 1;
  updatedAt: string;
  closedDays: string[];
  observations: Array<{ date: string; text: string }>;
  studentSaid: Array<{ date: string; text: string }>;
  corrections: MentorCorrection[];
}
export type MentorDayView =
  | { loading: true }
  | { loading: false; date: string; record: MentorDayRecord; student: MentorStudentDay | null; review: MentorDayReview | null; closedAt: string | null; memory: MentorMemory; source?: "ai" | "rules"; note?: string };
// ── Alimentación / Nutrición ──────────────────────────────────────────────
export * from "./nutritionTypes";


/** Motores de regeneración (ver api/modules/regenEngines.ts). */
export type RegenEngineId = "app" | "claude" | "handoff";
export interface RegenEngineInfo {
  id: RegenEngineId;
  label: string;
  available: boolean;
  reason: string;
  detail: string;
}
export interface RegenEnginesView {
  mode: "bridge" | "connection" | "api";
  provider: string;
  providerLabel: string;
  model: string;
  hasKey: boolean;
  isClaude: boolean;
  engines: RegenEngineInfo[];
  recommended: RegenEngineId;
}
/** La tarea para un agente externo (ver api/modules/topicRegenerateHandoff.ts). */
export interface RegenHandoffTopic {
  folder: string;
  title: string;
  backup: string;
  state: "pending" | "ok" | "error" | "restored";
  done: string[];
  problems: string[];
  created: string[];
  restored: boolean;
}
export interface RegenHandoff {
  id: string;
  what: "theory" | "practice" | "exercises" | "all" | "theory+practice" | "theory+exercises" | "practice+exercises";
  createdAt: string;
  task: string;
  taskAbs: string;
  resultDir: string;
  folder: string;
  prompt: string;
  status: "waiting" | "validated" | "failed" | "restored";
  topics: RegenHandoffTopic[];
  log: string[];
  ready: { found: number; expected: number };
}

/** «Crear con Antigravity» (ver api/modules/curriculumHandoff.ts). */
export interface CurriculumProgress {
  folder: boolean;
  note: boolean;
  manifest: boolean;
  map: boolean;
  exercises: number;
  temario: boolean;
}
export interface CurriculumHandoffEntry {
  entryId: string;
  title: string;
  category: string;
  importance: string;
  number: string;
  name: string;
  folder: string;
  state: "pending" | "created" | "error";
  problems: string[];
  warnings: string[];
  progress: CurriculumProgress;
}
/** El trabajo del modo automático de «Temas por crear» (la app escribe los temas con su IA). */
export interface CurriculumAutoJob {
  id: string;
  areaId: string;
  areaTitle: string;
  total: number;
  finished: number;
  current: string;
  done: boolean;
  cancelled: boolean;
  error: string;
  log: string[];
  created: string[];
  failed: Array<{ title: string; reason: string }>;
  skipped: number;
}

/** La cola de un área: sus tareas pendientes en orden y el archivo maestro con UNA frase que las encadena. */
export interface CurriculumQueue {
  tasks: CurriculumHandoff[];
  master: { taskPath: string; taskAbs: string; shortPrompt: string; count: number };
}

export interface CurriculumHandoff {
  id: string;
  kind: "curriculum";
  areaId: string;
  areaTitle: string;
  space: string;
  areaFolder: string;
  withExercises: boolean;
  createdAt: string;
  taskPath: string;
  taskAbs: string;
  folder: string;
  shortPrompt: string;
  prompt: string;
  status: "waiting" | "validated" | "failed";
  entries: CurriculumHandoffEntry[];
  log: string[];
  ready: { found: number; expected: number };
}

/** Estado de un trabajo de `study_topic_regenerate` (teoría, práctica o ejercicios de un tema). */
export interface TopicRegenerateJob {
  id: string;
  folder: string;
  what: "theory" | "map" | "practice" | "exercises" | "all";
  log: string[];
  done: boolean;
  error: string;
  finished: number;
  total: number;
  /** carpeta de la copia de seguridad (relativa a la vault) */
  backup: string;
  /** falló y se devolvió lo anterior */
  restored: boolean;
  created: string[];
  archived: string[];
}

// ── Plan Reviews (Áreas y sub-asignaturas) ──────────────────────────────────

export interface ReviewDuplicate {
  addedTopic: string;
  matchedTopic: string;
  title: string;
}

export interface ReviewImpact {
  addedTopics: number;
  addedMinutes: number;
  weeklyMinutesBefore: number;
  weeklyMinutesAfter: number;
  fits: boolean;
  endDate: string;
  suggestedEnd?: string;
  fixOptions: Array<{ id: string; label: string; op?: unknown; reason?: string; kind?: string }>;
}

export type ReviewKind = "area" | "subject";
export type ReviewSource = "manual" | "auto";
export type ReviewStatus = "pending" | "kept";

export interface PlanReview {
  id: string;
  kind: ReviewKind;
  subplanId: string;
  subplanName: string;
  groupId?: string;
  groupTitle?: string;
  folder: string;
  objective: string;
  source: ReviewSource;
  addedAt: string;
  state: ReviewStatus;
  added: string[];
  duplicates: ReviewDuplicate[];
  impact: ReviewImpact;
  planId?: string;
}

export interface PendingReviewAction {
  reviewId: string;
  action: "accept" | "reject" | "adjust";
}

export interface FixResolution {
  type: "extend_end" | "increase_hours" | "skip_duplicates" | "as_optional";
  reviewId: string;
}

/** Una skill (instrucciones de generación de una pieza) con su versión actual y hasta 3 pasadas. */
export interface SkillInfo {
  subject: string;
  kind: "theory" | "canvas" | "practica";
  label: string;
  file: string;
  version: string | null;
  words: number;
  updatedAt: string | null;
  past: Array<{ id: string; savedAt: string; version: string; words: number }>;
}
