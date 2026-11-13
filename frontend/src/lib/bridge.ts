// The only door from the UI to Python.
//
// Inside the desktop app, pywebview injects `window.pywebview.api` (the
// public methods of NoteVaultApi). Opened in a browser from the dev bridge
// (python -m notevault_app.webapp.devserver), calls go over localhost HTTP
// with a per-run token. Both reject with an Error carrying Python's message.

import type {
  AiConfig, AiProvider, AppInfo, Area, Bookmark, VaultInfo, HomeOverview, Exercise, ExerciseDay, ExerciseOverview, FinCategory, FinCheck, FinGoal, FinMeta, FinPace, FinSidebar, FinTotals, Movement, Goal, GoalCard, GoalDetail, GoalItem, GoalsMeta, GoalsSidebar, GoalsTodayRow, Issue, Project, ProjectCard, ProjectDetail, ProjectFolder, FolderEntry, ProjectNoteEntry, ProjectsMeta, CalItem, CalPayload, CalRoutine, CalSettings, Habit, HabitDayLog, HabitFields, HabitRangeDay, HabitStats, HabitSubtask,
  IndexEntry, Mentions, NoteData, Occurrence, SearchHit, Task, TaskFields, TasksMeta, TreeEntry, WriteResult,
  RenderingSettings, GpuStatus, Conversation, ConversationMeta,
} from "./types";
import type { LibraryUserEntry } from "./libraryTypes";
import type { BodyProfile } from "./exerciseTypes";
import type { FinanceContextData } from "./financeCoachTypes";

type PyApi = Record<string, (...args: unknown[]) => Promise<unknown>>;

declare global {
  interface Window {
    pywebview?: { api: PyApi };
    nv?: {
      invoke: (method: string, args: unknown[]) => Promise<unknown>;
      onOpenReview?: (cb: () => void) => () => void;
      onCaptureRequest?: (cb: () => void) => () => void;
      onCaptureDone?: (cb: (data: { rel: string; name: string }) => void) => () => void;
      onVaultContentChanged?: (cb: () => void) => () => void;
      onWatchEvent?: (cb: (data: { eventType: string; relPath: string; fullPath: string }) => void) => () => void;
      onBrowserState?: (cb: (data: BrowserState) => void) => () => void;
      onWindowState?: (cb: (data: { maximized: boolean }) => void) => () => void;
      onAiStream?: (cb: (data: AiStreamEvent) => void) => () => void;
    };
  }
}

/** One event of a streamed assistant answer (channel `nv-ai-stream`). */
export interface AiStreamEvent {
  id: string;
  type: "start" | "delta" | "thinking" | "done" | "error";
  /** A token, for `delta` (answer) and `thinking` (model reasoning). */
  text?: string;
  /** The failure, for `error`. */
  message?: string;
  /** For `done`: the user cancelled, so the answer is partial. */
  stopped?: boolean;
}

/** A past revision of a file, as reported by the vault's git repository. */
export interface VersionRevision {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** site icon as a data URL, empty when unknown */
  favicon?: string;
  /** whether the native view is attached to the window */
  attached?: boolean;
}

type Transport = { kind: "pywebview" } | { kind: "http"; token: string } | { kind: "electron" };

let transport: Promise<Transport> | null = null;

/**
 * Decide once how to reach Python. pywebview fills in its API a moment after
 * the page loads, so wait for whichever answers first: the pywebview ready
 * event, or the dev bridge's token endpoint.
 */
function getTransport(): Promise<Transport> {
  transport ??= new Promise<Transport>((resolve, reject) => {
    let settled = false;
    const done = (t: Transport) => {
      if (!settled) {
        settled = true;
        resolve(t);
      }
    };
    if (window.nv) {
      done({ kind: "electron" });
      return;
    }
    if (window.pywebview?.api && Object.keys(window.pywebview.api).length) {
      done({ kind: "pywebview" });
      return;
    }
    window.addEventListener("pywebviewready", () => done({ kind: "pywebview" }), {
      once: true,
    });
    fetch("./__nv_dev_token")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { token?: string }) => {
        if (j.token) done({ kind: "http", token: j.token });
      })
      .catch(() => {
        /* not the dev bridge: pywebview will answer */
      });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("NoteVault: no hay conexión con Python."));
      }
    }, 15000);
  });
  return transport;
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === "object" && "message" in e) {
    return new Error(String((e as { message: unknown }).message));
  }
  return new Error(String(e));
}

export async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const t = await getTransport();
  if (t.kind === "electron") {
    try {
      return (await window.nv!.invoke(method, args)) as T;
    } catch (e) {
      throw asError(e);
    }
  }
  if (t.kind === "pywebview") {
    const fn = window.pywebview?.api?.[method];
    if (!fn) throw new Error(`Método desconocido: ${method}`);
    try {
      return (await fn(...args)) as T;
    } catch (e) {
      throw asError(e);
    }
  }
  const res = await fetch(`./api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-NoteVault-Token": t.token },
    body: JSON.stringify({ args }),
  });
  const payload = (await res.json()) as { result?: T; error?: string };
  if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload.result as T;
}

export const getRendering = () => call<RenderingSettings>("get_rendering");
export const setRendering = (patch: Partial<RenderingSettings>) => call<RenderingSettings>("set_rendering", patch);
export const gpuStatus = () => call<GpuStatus>("gpu_status");
export const relaunchApp = () => call<{ ok: boolean }>("relaunch_app");

/** An area the AI proposed for a study space, with its topics. */
export type ProposedArea = { name: string; topics: Array<{ name: string }> };

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  stats: () => call<{ notes: number }>("stats"),
  setTheme: (theme: "dark" | "light") => call<{ theme: string }>("set_theme", theme),
  openExternal: (url: string) => call<{ ok: boolean }>("open_external", url),
  /** Show a vault file in the OS file manager, or open a vault folder ("" = the vault root). */
  revealPath: (path: string) => call<{ ok: boolean; folder: boolean }>("reveal_path", path),
  setUnsaved: (count: number) => call<{ ok: boolean }>("set_unsaved", count),
  getRendering,
  setRendering,
  gpuStatus,
  relaunchApp,

  listDir: (path = "") => call<TreeEntry[]>("list_dir", path),
  noteIndex: () => call<IndexEntry[]>("note_index"),

  readNote: (path: string) => call<NoteData>("read_note", path),
  writeNote: (path: string, raw: string, expectedModified: number | null) =>
    call<WriteResult>("write_note", path, raw, expectedModified),
  createNote: (title: string, folder = "") => call<{ path: string }>("create_note", title, folder),
  createFolder: (name: string, parent = "") =>
    call<{ path: string }>("create_folder", name, parent),
  rename: (path: string, newName: string) => call<{ path: string }>("rename", path, newName),
  remove: (path: string) => call<{ ok: boolean }>("delete", path),
  move: (path: string, destFolder: string) => call<{ path: string }>("move", path, destFolder),

  resolveLink: (target: string) => call<{ path: string | null }>("resolve_link", target),
  search: (query: string, limit = 100) => call<SearchHit[]>("search", query, limit),
  mentions: (path: string) => call<Mentions>("mentions", path),

  bookmarks: () => call<Bookmark[]>("bookmarks"),
  toggleBookmark: (path: string) => call<{ bookmarked: boolean }>("toggle_bookmark", path),

  readAttachment: (notePath: string, name: string) =>
    call<{ data_url: string }>("read_attachment", notePath, name),

  // Tareas
  tasksMeta: () => call<TasksMeta>("tasks_meta"),
  tasksList: () => call<Task[]>("tasks_list"),
  tasksInRange: (first: string, last: string) =>
    call<Array<{ date: string; id: string }>>("tasks_in_range", first, last),
  tasksCreate: (fields: TaskFields = {}) => call<Task>("tasks_create", fields),
  tasksUpdate: (id: string, fields: TaskFields) => call<Task>("tasks_update", id, fields),
  tasksDelete: (id: string) => call<{ ok: boolean }>("tasks_delete", id),
  tasksDueReminders: () => call<Task[]>("tasks_due_reminders"),
  tasksMarkReminderShown: (id: string) => call<{ ok: boolean }>("tasks_mark_reminder_shown", id),

  // Hábitos
  habitsList: () => call<Habit[]>("habits_list"),
  habitsRange: (first: string, last: string) => call<HabitRangeDay[]>("habits_range", first, last),
  habitsDay: (day: string) => call<HabitDayLog>("habits_day", day),
  habitsStats: (ref = "") => call<HabitStats>("habits_stats", ref),
  habitsSetDone: (day: string, id: string, done: boolean) =>
    call<{ ok: boolean; pct: number }>("habits_set_done", day, id, done),
  habitsSetSubtask: (day: string, id: string, sub: string, done: boolean) =>
    call<{ ok: boolean }>("habits_set_subtask", day, id, sub, done),
  habitsSetDayText: (day: string, notes: string, journal: string) =>
    call<{ ok: boolean }>("habits_set_day_text", day, notes, journal),
  habitsAdd: (fields: HabitFields = {}) => call<Habit>("habits_add", fields),
  habitsUpdate: (id: string, fields: HabitFields) => call<Habit>("habits_update", id, fields),
  habitsRemove: (id: string) => call<{ ok: boolean }>("habits_remove", id),
  habitsReorder: (ids: string[]) => call<{ ok: boolean }>("habits_reorder", ids),
  habitsAddSubtask: (id: string, name: string) => call<HabitSubtask>("habits_add_subtask", id, name),
  habitsRemoveSubtask: (id: string, sub: string) => call<{ ok: boolean }>("habits_remove_subtask", id, sub),

  // Calendario
  calRange: (first: string, last: string) => call<Record<string, Occurrence[]>>("cal_range", first, last),
  calSettings: () => call<CalSettings>("cal_settings"),
  calItem: (day: string, id: string, kind: string) => call<CalItem>("cal_item", day, id, kind),
  calSave: (p: CalPayload) => call<{ ok: boolean; message: string }>("cal_save", p),
  calDelete: (orig: { kind: string; id: string; date: string }, scope: "one" | "all" = "all") =>
    call<{ ok: boolean }>("cal_delete", orig, scope),
  calMove: (occ: Occurrence, day: string, start: string, duration: number) =>
    call<{ ok: boolean }>("cal_move", occ, day, start, duration),
  calSetDone: (day: string, id: string, done: boolean) => call<{ ok: boolean }>("cal_set_done", day, id, done),
  calRoutines: () => call<CalRoutine[]>("cal_routines"),
  calRoutineSave: (id: string | null, fields: Partial<CalRoutine>) =>
    call<{ ok: boolean }>("cal_routine_save", id, fields),
  calRoutineRemove: (id: string) => call<{ ok: boolean }>("cal_routine_remove", id),

  // Áreas y adjuntos
  areasList: (includeArchived = false) => call<Area[]>("areas_list", includeArchived),
  areasSave: (id: string, fields: Partial<Area>) => call<Area>("areas_save", id, fields),
  areasArchive: (id: string, archived = true) => call<{ ok: boolean }>("areas_archive", id, archived),
  areasCreateSuggested: () => call<Area[]>("areas_create_suggested"),
  attachAdd: (module: string, owner: string, filename: string, dataB64: string) =>
    call<{ ref: string }>("attach_add", module, owner, filename, dataB64),
  attachRead: (ref: string) => call<{ name: string; mime: string; data_url: string }>("attach_read", ref),
  attachOpen: (ref: string) => call<{ ok: boolean }>("attach_open", ref),
  attachRemove: (ref: string) => call<{ ok: boolean }>("attach_remove", ref),

  // Proyectos
  projectsMeta: () => call<ProjectsMeta>("projects_meta"),
  projectsList: () => call<ProjectCard[]>("projects_list"),
  projectsGet: (pid: string) => call<ProjectDetail>("projects_get", pid),
  projectsCreate: (fields: Record<string, unknown>) => call<Project>("projects_create", fields),
  projectsUpdate: (pid: string, fields: Record<string, unknown>) => call<Project>("projects_update", pid, fields),
  projectsDelete: (pid: string) => call<{ ok: boolean }>("projects_delete", pid),
  issueCreate: (pid: string, fields: Partial<Issue>) => call<Issue>("projects_issue_create", pid, fields),
  issueUpdate: (pid: string, xid: string, fields: Partial<Issue>) =>
    call<Issue>("projects_issue_update", pid, xid, fields),
  issueMove: (pid: string, xid: string, status: string, index: number) =>
    call<{ ok: boolean }>("projects_issue_move", pid, xid, status, index),
  issueDelete: (pid: string, xid: string) => call<{ ok: boolean }>("projects_issue_delete", pid, xid),
  projectNotesList: (pid: string) => call<ProjectNoteEntry[]>("projects_notes_list", pid),
  projectNoteRead: (pid: string, rel: string) =>
    call<{ path: string; raw: string; modified: number }>("projects_note_read", pid, rel),
  projectNoteWrite: (pid: string, rel: string, raw: string) =>
    call<{ ok: boolean; modified: number }>("projects_note_write", pid, rel, raw),
  projectNoteCreate: (pid: string, folder: string, name: string, isFolder = false) =>
    call<{ path: string }>("projects_note_create", pid, folder, name, isFolder),
  projectNoteDelete: (pid: string, rel: string) => call<{ ok: boolean }>("projects_note_delete", pid, rel),

  // Proyectos · carpetas vinculadas (Notas)
  pickFolder: () => call<{ path: string | null }>("projects_pick_folder"),
  projectFolders: (pid: string) => call<ProjectFolder[]>("projects_folders", pid),
  projectFolderLink: (pid: string, folderPath: string) =>
    call<{ folder: ProjectFolder; folders: ProjectFolder[]; warning: string }>("projects_folder_link", pid, folderPath),
  projectFolderUnlink: (pid: string, folderId: string) =>
    call<{ folders: ProjectFolder[] }>("projects_folder_unlink", pid, folderId),
  projectFolderTarget: (pid: string, folderId: string) =>
    call<{ folders: ProjectFolder[] }>("projects_folder_target", pid, folderId),
  projectFolderTree: (pid: string, folderId: string) =>
    call<{ folder: ProjectFolder; entries: FolderEntry[] }>("projects_folder_tree", pid, folderId),
  projectFileRead: (pid: string, folderId: string, rel: string) =>
    call<{ raw: string; modified: number; size: number; kind: string; readonly: boolean }>("projects_file_read", pid, folderId, rel),
  projectFileWrite: (pid: string, folderId: string, rel: string, raw: string, expectedModified: number | null = null) =>
    call<{ ok: boolean; conflict: boolean; modified: number }>("projects_file_write", pid, folderId, rel, raw, expectedModified),
  projectFileCreate: (pid: string, folderId: string, rel: string, name: string, isFolder = false) =>
    call<{ entry: FolderEntry }>("projects_file_create", pid, folderId, rel, name, isFolder),
  projectFileRename: (pid: string, folderId: string, rel: string, newName: string) =>
    call<{ entry: FolderEntry }>("projects_file_rename", pid, folderId, rel, newName),
  projectFileMove: (pid: string, folderId: string, rel: string, destRel: string, destFolderId = "") =>
    call<{ entry: FolderEntry }>("projects_file_move", pid, folderId, rel, destRel, destFolderId),
  projectFileDelete: (pid: string, folderId: string, rel: string) =>
    call<{ ok: boolean }>("projects_file_delete", pid, folderId, rel),
  projectFileOpen: (pid: string, folderId: string, rel: string, mode: "open" | "reveal" = "open") =>
    call<{ ok: boolean }>("projects_file_open", pid, folderId, rel, mode),
  projectFileData: (pid: string, folderId: string, rel: string) =>
    call<{ data_url: string; mime: string; size: number }>("projects_file_data", pid, folderId, rel),
  projectNotesMigrate: (pid: string, folderId: string) =>
    call<{ moved: string[]; skipped: string[] }>("projects_notes_migrate", pid, folderId),
  projectNotesLegacy: (pid: string) => call<{ dir: string; files: string[] }>("projects_notes_legacy", pid),

  // Metas
  goalsMeta: () => call<GoalsMeta>("goals_meta"),
  goalsSidebar: () => call<GoalsSidebar>("goals_sidebar"),
  goalsList: (filter: string, area: string) => call<GoalCard[]>("goals_list", filter, area),
  goalsGet: (gid: string) => call<GoalDetail>("goals_get", gid),
  goalsToday: (day = "", gid = "") => call<{ date: string; rows: GoalsTodayRow[] }>("goals_today", day, gid),
  goalsCreate: (fields: Partial<Goal>, submetas: string[] = []) => call<Goal>("goals_create", fields, submetas),
  goalsUpdate: (gid: string, fields: Partial<Goal>) => call<Goal>("goals_update", gid, fields),
  goalsDelete: (gid: string) => call<{ ok: boolean }>("goals_delete", gid),
  goalItemCreate: (gid: string, name: string, parent = "", fields: Partial<GoalItem> = {}, subtasks: string[] = []) =>
    call<GoalItem>("goals_item_create", gid, name, parent, fields, subtasks),
  goalItemUpdate: (gid: string, iid: string, fields: Partial<GoalItem>) => call<GoalItem>("goals_item_update", gid, iid, fields),
  goalsTopicLinksProgress: (links: string[]) =>
    call<import("./types").TopicLinkProgress>("goals_topic_links_progress", links),
  goalsPracticeLinksProgress: (links: string[]) =>
    call<import("./types").PracticeLinkProgress>("goals_practice_links_progress", links),
  goalsPracticeCatalog: () => call<import("./types").PracticeCatalog>("goals_practice_catalog"),
  goalsTree: (goalId = "") => call<import("./types").GoalTree[]>("goals_tree", { goalId }),
  goalItemPromote: (gid: string, iid: string) => call<Goal>("goals_item_promote", gid, iid),
  goalDemote: (gid: string, targetGid: string, parent = "") => call<GoalItem>("goals_goal_demote", gid, targetGid, parent),
  goalItemMoveTo: (gid: string, iid: string, targetGid: string, parent = "") =>
    call<GoalItem>("goals_item_move_to", gid, iid, targetGid, parent),
  goalItemDelete: (gid: string, iid: string) => call<{ ok: boolean }>("goals_item_delete", gid, iid),
  goalItemMove: (gid: string, iid: string, parent: string, index: number) =>
    call<{ ok: boolean }>("goals_item_move", gid, iid, parent, index),
  goalItemIndent: (gid: string, iid: string, direction: number) => call<{ ok: boolean }>("goals_item_indent", gid, iid, direction),
  goalSetDone: (gid: string, iid: string, day: string, done: boolean, value: number | string | null = null) =>
    call<{ ok: boolean }>("goals_set_done", gid, iid, day, done, value),

  // Mentor
  mentorBrief: (opts: { maxChars?: number; only?: string[]; exclude?: string[] } = {}) =>
    call<import("./types").MentorBriefResult>("mentor_brief", opts),
  mentorCandidates: (opts: { availableMinutes: number; maxSubjects?: number; objective?: import("./types").MentorSessionObjective }) =>
    call<import("./types").MentorCandidatesResult>("mentor_candidates", opts),
  mentorSessionSave: (record: import("./types").MentorSessionRecord) =>
    call<import("./types").MentorSessionRecord>("mentor_session_save", record),
  mentorSessionLoad: (date: string) => call<import("./types").MentorSessionRecord | null>("mentor_session_load", date),
  mentorSessionRecent: (n = 14) => call<import("./types").MentorSessionRecord[]>("mentor_session_recent", n),
  mentorSessionMarkBlock: (date: string, candidateId: string, status: import("./types").MentorBlockStatus, note?: string) =>
    call<import("./types").MentorSessionRecord | null>("mentor_session_mark_block", date, candidateId, status, note),
  mentorAdherence: (n = 30) => call<import("./types").MentorAdherence>("mentor_adherence", n),
  mentorOverview: () => call<import("./types").MentorOverview>("mentor_overview"),
  mentorPlanPropose: (opts: import("./types").MentorPlanRequest) =>
    call<import("./types").MentorProposeResult>("mentor_plan_propose", opts),
  mentorPlanAccept: (opts: { date?: string; availableMinutes: number; objective?: string; blocks: import("./types").MentorProposedBlock[] }) =>
    call<import("./types").MentorSessionRecord>("mentor_plan_accept", opts),
  mentorBlockStatus: (date: string, candidateId: string, status: import("./types").MentorBlockStatus, note?: string) =>
    call<import("./types").MentorSessionRecord>("mentor_block_status", date, candidateId, status, note),
  mentorChatLoad: () => call<import("./types").MentorChatState>("mentor_chat_load"),
  mentorChatClear: () => call<import("./types").MentorChatState>("mentor_chat_clear"),
  mentorChat: (message: string, chatId?: string, mode?: "plan") => call<import("./types").MentorChatResult>("mentor_chat", { message, chatId, mode }),
  mentorPlanList: () => call<import("./types").MentorPlanListRow[]>("mentor_plan_list"),
  mentorPlanGet: (id?: string) => call<import("./types").MentorPlanGet>("mentor_plan_get", { id }),
  mentorPlanOptions: () => call<import("./types").MentorPlanOptions>("mentor_plan_options"),
  mentorPlanGenerate: (preconditions: import("./planTime").PlanPreconditions) => call<import("./types").MentorPlanGenerateResult>("mentor_plan_generate", { preconditions }),
  /** Compatibilidad: genera un BORRADOR en el chat (sin crear el plan). */
  mentorPlanGenerateDraft: (preconditions: import("./planTime").PlanPreconditions) => call<import("./types").MentorPlanGenerateResult>("mentor_plan_generate_draft", { preconditions }),
  /** «Generar plan»: crea YA el plan propuesto (`noAi` = plan automático sin IA). */
  mentorPlanGenerateNow: (preconditions: import("./planTime").PlanPreconditions, noAi = false) => call<import("./types").MentorPlanGenerateResult>("mentor_plan_generate", { preconditions, ...(noAi ? { noAi: true } : {}) }),
  mentorPlanKeep: (id: string) => call<import("./types").MentorPlan>("mentor_plan_keep", { id }),
  /** Responde la pregunta de entregables: sin `subplanId` es la GLOBAL del plan por áreas; con él, la de un subplan. */
  mentorPlanAnswer: (opts: { id: string; subplanId?: string; answer: "yes" | "no" | "later"; questionId?: string }) => call<import("./types").MentorPlan>("mentor_plan_answer", opts),
  /** Excepción por área tras la pregunta global: añade o quita el proyecto propio de un área. */
  mentorPlanAreaDeliverable: (opts: { id: string; subplanId: string; enabled: boolean }) => call<import("./types").MentorPlan>("mentor_plan_area_deliverable", opts),
  /** Escribe (o borra, con texto vacío) el propósito de un día, semana o mes. */
  mentorPlanPracticeGenerate: (id: string, opts: { noAi?: boolean; all?: boolean } = {}) => call<{ loading: true } | { loading: false; plan: import("./types").MentorPlan; entry: import("./types").MentorChangeEntry; history: import("./types").MentorChangeEntry[]; aiUsed: boolean; calls: number }>("mentor_plan_practice_generate", { id, ...opts }),
  mentorPlanSetPurpose: (opts: { id: string; scope: "day" | "week" | "month"; key: string; text: string }) => call<import("./types").MentorPlan>("mentor_plan_set_purpose", opts),
  /** Ritmo diario manual (temas por día y mínimo, global y por área); `pace` vacío o nulo vuelve al reparto automático. Devuelve el plan. */
  mentorPlanPaceSet: (opts: { id: string; pace: import("./planPace").DailyPace | null }) => call<import("./types").MentorPlan>("mentor_plan_pace_set", opts),
  /** Añade un tema extra a un día (hoy por defecto): de la ruta (más adelante) o de la vault. Devuelve el plan. */
  mentorPlanExtraTopicAdd: (opts: { id: string; folder: string; date?: string; area?: string; estMinutes?: number }) => call<import("./types").MentorPlan>("mentor_plan_extra_topic_add", opts),
  mentorPlanExtraTopicRemove: (opts: { id: string; folder: string; date: string }) => call<import("./types").MentorPlan>("mentor_plan_extra_topic_remove", opts),
  /** Práctica diaria extra de un día (kata, ejercicio o texto libre). */
  mentorPlanExtraPracticeAdd: (opts: { id: string; title: string; kind?: import("./planPace").ExtraPracticeKind; date?: string; minutes?: number; note?: string; area?: string; folder?: string; rel?: string; kataDate?: string }) => call<import("./types").MentorPlan>("mentor_plan_extra_practice_add", opts),
  mentorPlanExtraPracticeUpdate: (opts: { id: string; practiceId: string; title?: string; kind?: import("./planPace").ExtraPracticeKind; date?: string; minutes?: number | null; note?: string; area?: string; folder?: string; done?: boolean }) => call<import("./types").MentorPlan>("mentor_plan_extra_practice_update", opts),
  mentorPlanExtraPracticeRemove: (opts: { id: string; practiceId: string }) => call<import("./types").MentorPlan>("mentor_plan_extra_practice_remove", opts),
  /** Candidatos para añadir como tema extra: los siguientes de la ruta y los temas de la vault fuera del plan. */
  mentorPlanExerciseCandidates: (opts: { id: string; area?: string; limit?: number }) => call<import("./types").MentorExerciseCandidates>("mentor_plan_exercise_candidates", opts),
  mentorPlanTopicCandidates: (opts: { id: string; query?: string; area?: string; limit?: number; upcoming?: boolean; date?: string; horizon?: number; group?: string }) => call<import("./types").MentorTopicCandidates>("mentor_plan_topic_candidates", opts),
  /** «Reorganizar por áreas»: convierte un plan de estructura antigua; queda en el historial y se puede deshacer. */
  mentorPlanReorganize: (id: string) => call<{ plan: import("./types").MentorPlan; entry: import("./types").MentorChangeEntry; history: import("./types").MentorChangeEntry[]; applied: true }>("mentor_plan_reorganize", { id }),
  /** Cobertura de teoría y práctica de cada área del plan contra la vault (determinista) y la última revisión guardada. */
  mentorPlanCoverage: (id: string) => call<import("./types").MentorPlanCoverage>("mentor_plan_coverage", { id }),
  mentorPlanTopicCatalog: (id: string) => call<import("./types").MentorPlanTopicCatalog>("mentor_plan_topic_catalog", { id }),
  /** «Revisar cobertura con el Mentor»: una llamada a la IA (clave de estado `coverage:<id>`); guarda `coverageReview` en el plan. */
  mentorPlanCoverageReview: (id: string, profile?: string, criteria?: import("./planCoverage").CoverageCriteria) => call<import("./types").MentorCoverageReviewResult>("mentor_plan_coverage_review", { id, ...(profile ? { profile } : {}), ...(criteria ? { criteria } : {}) }),
  /** «Ejecutar plan»: el informe de lo que falta crear (solo lee). */
  mentorExecutionReport: (id: string, scope?: Partial<import("./planExecution").ExecutionScope>) => call<import("./types").MentorExecutionReportResult>("mentor_execution_report", { id, ...(scope ? { scope } : {}) }),
  /** «Plan para otra IA»: escribe un .md con lo que falta crear (para Antigravity, Gemini, Codex…). No usa la IA de la app. */
  mentorExecutionHandoff: (id: string, scope?: Partial<import("./planExecution").ExecutionScope>) => call<{ loading: true } | { loading: false; path: string; rel: string; markdown: string; items: number; files: number }>("mentor_execution_handoff", { id, ...(scope ? { scope } : {}) }),
  mentorExecutionStatus: (id: string) => call<{ execution: import("./types").MentorExecutionView | null; active: boolean }>("mentor_execution_status", { id }),
  /** Empieza la ejecución en segundo plano. SOLO tras la confirmación de la persona en el diálogo (`confirm: true`). */
  mentorExecutionStart: (id: string, scope: Partial<import("./planExecution").ExecutionScope>) => call<import("./types").MentorExecutionStartResult>("mentor_execution_start", { id, scope, confirm: true }),
  /** «Verificar»: contrasta la ejecución guardada con la vault y marca como hechas las tareas ya cubiertas (sin IA). */
  mentorExecutionVerify: (id: string) => call<{ execution: import("./types").MentorExecutionView | null; verified: number; trimmed: number; remaining: number }>("mentor_execution_verify", { id }),
  /** Plan para Antigravity: esquematiza lo que falta en planes pequeños y escribe el documento de cada uno bajo demanda. */
  mentorHandoffScheme: (id: string, opts: { perCell?: number; maxFiles?: number; ladder?: boolean; ai?: boolean } = {}) =>
    call<{ loading: true } | { loading: false; scheme: import("./types").MentorHandoffScheme | null }>("mentor_handoff_scheme", { id, ...opts }),
  mentorHandoffGet: (id: string) => call<{ scheme: import("./types").MentorHandoffScheme | null }>("mentor_handoff_get", { id }),
  mentorHandoffWrite: (id: string, packageId: string) => call<{ path: string; rel: string; prompt: string; scheme: import("./types").MentorHandoffScheme }>("mentor_handoff_write", { id, packageId }),
  mentorExecutionPause: (id: string) => call<{ execution: import("./types").MentorExecutionView | null }>("mentor_execution_pause", { id }),
  mentorExecutionResume: (id: string) => call<{ execution: import("./types").MentorExecutionView | null }>("mentor_execution_resume", { id }),
  /** Registro de horas de estudio por área (Pomodoro y bloques a mano). */
  mentorTimeLogGet: (id: string) => call<{ entries: import("./timeLog").TimeEntry[]; assessments?: import("./timeLog").Assessment[] }>("mentor_timelog_get", { id }),
  /** La evaluación obligatoria al acabar un bloque de foco. */
  mentorTimeLogAssess: (opts: { id: string; areaKey: string; date: string; minutes: number; topics: string[]; understanding: number; focus: number; outcomes: Array<{ title: string; status: "done" | "partial" | "none" }>; practiced: boolean; learned: string; doubt: string; errors: string; work?: import("./timeLog").WorkKind }) => call<{ assessments: import("./timeLog").Assessment[]; assessment: import("./timeLog").Assessment }>("mentor_timelog_assess", opts),
  mentorTimeLogAdd: (opts: { id: string; areaKey: string; date: string; minutes: number; kind?: "pomodoro" | "manual"; note?: string; work?: import("./timeLog").WorkKind; topics?: string[] }) => call<{ entries: import("./timeLog").TimeEntry[]; entry: import("./timeLog").TimeEntry }>("mentor_timelog_add", opts),
  /** Tiempo REAL registrado (nunca estimado) por área y tipo de trabajo, en un rango de fechas. */
  mentorTimeLogSummary: (id: string, opts: { from?: string; to?: string; areaKey?: string } = {}) => call<import("./timeLog").TimeLogSummary>("mentor_timelog_summary", { id, ...opts }),
  mentorTimeLogDelete: (id: string, entryId: string) => call<{ entries: import("./timeLog").TimeEntry[] }>("mentor_timelog_delete", { id, entryId }),
  /** Registros de sesión: la sesión con su evidencia y su nota legible en `_registro/`. */
  mentorRecordSave: (opts: { id: string; areaKey: string; areaName?: string; date: string; startedAt: number; minutes: number; mode: string; assigned: Array<{ kind: string; folder: string; title: string; status: string }>; assessmentId?: string; assessment?: { understanding: number; focus: number; practiced: boolean; learned: string; doubt: string; errors: string } }) =>
    call<{ record: import("./sessionRecords").SessionRecord; rel: string; duplicate: boolean }>("mentor_record_save", opts),
  mentorRecordsList: (id: string) => call<import("./sessionRecords").RecordsList>("mentor_records_list", { id }),
  /** «Repensar el plan con mis registros»: propone (una llamada de IA o por reglas); no cambia nada. */
  mentorRecordsRethink: (id: string, noAi = false) => call<{ proposals: import("./sessionRecords").ProposalView[]; source: "ai" | "rules"; note?: string }>("mentor_records_rethink", { id, ...(noAi ? { noAi: true } : {}) }),
  mentorProposalSet: (id: string, proposalId: string, status: "open" | "dismissed" | "applied") => call<{ proposals: import("./sessionRecords").ProposalView[] }>("mentor_proposal_set", { id, proposalId, status }),
  /** Crea la nota de refuerzo o la nota puente de una propuesta (nunca sobrescribe); con `preview` solo dice qué crearía. */
  mentorProposalApply: (id: string, proposalId: string, preview = false) => call<{ rel: string; created: boolean; source: "ai" | "rules"; aiCalls?: number }>("mentor_proposal_apply", { id, proposalId, ...(preview ? { preview: true } : {}) }),
  /** Lo que hay en disco bajo la carpeta de la ruta: áreas → tipos → proyectos con su avance. */
  mentorDeliverablesProgress: (id: string) => call<{ dailyProjectDone: Record<string, string[]> }>("mentor_deliverables_progress", { id }),
  mentorProjectsList: (id: string) => call<import("./projectTemplates").ProjectsListing>("mentor_projects_list", { id }),
  /** Crea la estructura de carpetas de proyectos de la ruta y, si se pasa un proyecto, su carpeta con la plantilla de archivos (nunca sobrescribe). */
  mentorProjectsScaffold: (opts: { id: string; areaKeys?: string[]; project?: Record<string, unknown> }) =>
    call<{ route: string; skeleton: string[]; projects: Array<{ areaKey: string; area: string; dir: string; readme: string; created: string[]; existed: string[] }>; created: string[]; existed: string[] }>("mentor_projects_scaffold", opts),
  mentorExecutionCancel: (id: string) => call<{ execution: import("./types").MentorExecutionView | null }>("mentor_execution_cancel", { id }),
  /** Sistema de práctica por área: katas, habilidades y proyectos de cada área del plan. */
  /** «Áreas» del Mentor: avance de solo lectura por espacio / área / tema (una llamada por nivel). */
  mentorAreasOverview: (opts: { level?: "spaces" | "areas" | "topics"; space?: string; area?: string } = {}) =>
    call<{ level: string; space?: string; area?: string; rows: unknown[]; areas?: unknown[]; loading?: boolean }>("mentor_areas_overview", opts),
  mentorAreaPractice: (id: string) => call<import("./types").MentorAreaPractice>("mentor_area_practice", { id }),
  mentorAreaPracticeOn: (id: string, date: string) => call<{ items: Array<{ areaId: string; label: string; day: number; rel: string; title: string; skill: string; level: number; minutes: number }> }>("mentor_area_practice_on", { id, date }),
  /** Acceso directo al kata de un área: lo crea si falta (nunca sobrescribe) y devuelve su ruta en la vault. */
  mentorAreaKatasAhead: (id: string, area?: string) => call<{ katas: import("./types").MentorKataAhead[] }>("mentor_area_katas_ahead", { id, ...(area ? { area } : {}) }),
  mentorAreaKataOpen: (id: string, areaId: string, date?: string) => call<{ rel: string; created: boolean; date: string }>("mentor_area_kata_open", { id, areaId, ...(date ? { date } : {}) }),
  /** Deja la carpeta de cada área del plan en programming_practice (README, .practica.md, habilidades…). Nunca sobrescribe. */
  mentorAreaPracticeSetup: (id: string) => call<{ created: string[]; folders: string[]; view: import("./types").MentorAreaPractice }>("mentor_area_practice_setup", { id }),
  mentorAreaKataMark: (id: string, areaId: string, date: string, status: "done" | "skipped" | null) => call<import("./types").MentorAreaPractice>("mentor_area_kata_mark", { id, areaId, date, status }),
  /** Cierre del día: el registro sin IA, la revisión al cerrar y la memoria del Mentor. */
  mentorDayRecord: (date?: string) => call<import("./types").MentorDayView>("mentor_day_record", date ? { date } : {}),
  mentorDayClose: (opts: { date?: string; mood?: number; feeling?: string; notes?: string; noAi?: boolean }) => call<import("./types").MentorDayView>("mentor_day_close", opts),
  mentorMemory: () => call<{ memory: import("./types").MentorMemory }>("mentor_memory_get", {}),
  mentorCorrectionTask: (id: string) => call<{ memory: import("./types").MentorMemory; taskId: string }>("mentor_correction_task", { id }),
  mentorCorrectionSet: (id: string, status: "open" | "done" | "dismissed") => call<{ memory: import("./types").MentorMemory }>("mentor_correction_set", { id, status }),
  mentorPlanCoverageAccept: (id: string, areaKey: string, title: string, accepted = true) => call<{ review: import("./planCoverage").CoverageReview }>("mentor_plan_coverage_accept", { id, areaKey, title, accepted }),
  mentorPlanRouteSet: (opts: { id: string; folders: string[]; route: "core" | "optional" | "skipped"; reason?: string; label?: string }) =>
    call<import("./types").MentorRouteChangeResult>("mentor_plan_route_set", opts),
  /** «Añadir al plan»: los temas de referencia validados entran al final de la ruta de su área (html/css/js → Frontend, java → Java); idempotente. */
  mentorPlanAddTopics: (opts: { planId: string; folders: string[]; subplanId?: string }) => call<import("./types").MentorAddTopicsResult>("mentor_plan_add_topics", opts),
  mentorPlanAreaCreate: (opts: { planId: string; name: string; objective?: string; fromWeek?: number; toWeek?: number }) =>
    call<{ plan: import("./types").MentorPlan; subplan: import("./types").MentorSubplan }>("mentor_plan_area_create", opts),
  mentorPlanAreaUpdate: (opts: { planId: string; subplanId: string; fromWeek?: number; toWeek?: number; objective?: string; state?: "en_curso" | "pendiente" | "completada" }) =>
    call<{ plan: import("./types").MentorPlan; subplan: import("./types").MentorSubplan }>("mentor_plan_area_update", opts),
  mentorPlanFixMethodology: (opts: { planId: string; subplanId: string; groupId?: string }) =>
    call<{ plan: import("./types").MentorPlan; addedCount: number }>("mentor_plan_fix_methodology", opts),
  mentorPlanTopicUpdate: (opts: { planId: string; subplanId?: string; folder: string; targetWeek?: number; completed?: boolean; route?: "core" | "optional" | "skipped"; tags?: string[] }) =>
    call<{ plan: import("./types").MentorPlan; topic: import("./types").MentorPlannedTopic }>("mentor_plan_topic_update", opts),
  mentorTopicResolve: (opts: { folder: string; topicId?: string; title?: string; areaId?: string; ensureCanvas?: boolean }) =>
    call<{ found: boolean; folder: string; topicId: string; relocated: boolean; theoryNote: string | null; practiceNote: string | null; canvasFile: string | null; canvasGenerated: boolean }>("mentor_topic_resolve", opts),
  mentorPlanVaultCheck: (planId: string) =>
    call<{ planId: string; needsSync: boolean; relocatedCount: number; missingCanvasCount: number; unindexedCount: number; relocated: Array<{ oldFolder: string; newFolder: string; title: string; topicId: string }>; missingCanvases: Array<{ folder: string; title: string; topicId: string }> }>("mentor_plan_vault_check", { planId }),
  mentorPlanVaultReconcile: (planId: string, generateCanvases = true) =>
    call<{ plan: import("./types").MentorPlan; changedPlan: boolean; relocatedCount: number; generatedCanvases: number; indexedCount: number }>("mentor_plan_vault_reconcile", { planId, generateCanvases }),
  mentorPlanSubjectAddTopics: (opts: { planId: string; subplanId: string; groupId: string; topics: Array<{ folder?: string; title: string; estMinutes?: number; targetWeek?: number }> }) =>
    call<{ plan: import("./types").MentorPlan; added: number }>("mentor_plan_subject_add_topics", opts),
  mentorPlanGroupCreate: (opts: { planId: string; subplanId: string; title: string }) => call<{ plan: import("./types").MentorPlan; group: import("./planAreas").AreaGroup }>("mentor_plan_group_create", opts),
  mentorPlanGroupRename: (opts: { planId: string; subplanId: string; groupId: string; title: string }) => call<{ plan: import("./types").MentorPlan; group: import("./planAreas").AreaGroup }>("mentor_plan_group_rename", opts),
  mentorPlanGroupDelete: (opts: { planId: string; subplanId: string; groupId: string; fallbackGroupId?: string }) => call<{ plan: import("./types").MentorPlan; moved: number }>("mentor_plan_group_delete", opts),
  mentorPlanTopicsMoveGroup: (opts: { planId: string; subplanId: string; folders: string[]; groupId?: string; newGroupTitle?: string }) => call<{ plan: import("./types").MentorPlan; changed: number; targetGroupId: string; targetGroupTitle: string }>("mentor_plan_topics_move_group", opts),
  mentorFolderRolesGet: () => call<import("./folderRoles").FolderRolesFile>("mentor_folder_roles_get", {}),
  mentorFolderRoleSet: (opts: { folder: string; role: import("./folderRoles").FolderRoleKind; objective?: string }) => call<import("./folderRoles").FolderRolesFile>("mentor_folder_role_set", opts),
  mentorFolderRoleClear: (opts: { folder: string }) => call<import("./folderRoles").FolderRolesFile>("mentor_folder_role_clear", opts),
  mentorFolderAutoAddSet: (opts: { enabled: boolean }) => call<import("./folderRoles").FolderRolesFile>("mentor_folder_auto_add_set", opts),
  mentorMethodologyReview: (opts: { prompt: string }) => call<{ aiConfigured: boolean; text: string }>("mentor_methodology_review", opts),
  mentorPlanProjectLinks: (opts: { planId: string }) => call<{ links: Record<string, { projectId: string; name: string; issues: { total: number; done: number }; monthId: string }> }>("mentor_plan_project_links", opts),
  mentorPlanProjectCreate: (opts: { planId: string; monthId: string }) => call<{ link: { projectId: string; name: string; issues: { total: number; done: number }; monthId: string }; created: boolean }>("mentor_plan_project_create", opts),
  /** Skills (instrucciones de generación): lista, lectura, guardado con historial, restauración y peticiones de cambio (IA de la app o prompt). */
  skillsList: () => call<{ subjects: Array<{ subject: string; skills: import("./types").SkillInfo[] }>; maxPast: number }>("skills_list"),
  skillsGet: (o: { subject: string; kind: string; versionId?: string }) => call<{ text: string; info: import("./types").SkillInfo; versionId?: string }>("skills_get", o),
  skillsSave: (o: { subject: string; kind: string; text: string }) => call<import("./types").SkillInfo>("skills_save", o),
  skillsRestore: (o: { subject: string; kind: string; versionId: string }) => call<import("./types").SkillInfo>("skills_restore", o),
  skillsAiEdit: (o: { subject: string; kind: string; instruction: string; mode: "prompt" | "app" }) => call<{ mode: "prompt" | "app"; prompt: string; proposal?: string }>("skills_ai_edit", o),
  mentorPlanDepth: (opts: { planId: string }) => call<{ gaps: Array<{ subplanId: string; areaId: string; area: string; groupId: string; groupTitle: string; groupKind: string; chapters: number; missingPieces: number; coarseCount: number; sample: string[] }>; standard: { minPieces: number; minMinutes: number } }>("mentor_plan_depth", opts),
  mentorPlanDepthHandoff: (opts: { planId: string; subplanId: string; groupId: string }) => call<{ rel: string; abs: string; shortPrompt: string; chapters: number }>("mentor_plan_depth_handoff", opts),
  mentorPlanExternalPrompt: (preconditions: import("./planTime").PlanPreconditions) => call<{ loading: true } | { loading: false; rel: string; abs: string; answerRel: string; answerAbs: string; shortPrompt: string; chatPrompt: string; topics: number }>("mentor_plan_external_prompt", { preconditions }),
  mentorPlanExternalAccept: (preconditions: import("./planTime").PlanPreconditions, from: { reply?: string; answerRel?: string }) => call<{ loading: true } | Extract<import("./types").MentorPlanGenerateResult, { kind: "plan_created" }>>("mentor_plan_external_accept", { preconditions, ...from }),
  mentorPlanDossier: (opts: { id: string; question?: string }) => call<{ rel: string; abs: string; answerRel: string; answerAbs: string; shortPrompt: string; topics: number }>("mentor_plan_dossier", opts),
  mentorMasterSyllabus: (opts?: { spaces?: string[] }) => call<{ spaces: Array<{ space: string; topics: number; changed: boolean; md: string; json: string }> }>("mentor_master_syllabus", opts ?? {}),
  mentorPlanSyncReference: (opts: { planId: string }) => call<{ loading: true } | { loading: false; added: string[]; message: string; tidied?: boolean; health?: Array<{ code: string; area: string; message: string; items?: string[] }>; plan?: import("./types").MentorPlan }>("mentor_plan_sync_reference", opts),
  mentorPlanHealth: (opts: { planId: string }) => call<{ loading: true } | { loading: false; issues: Array<{ code: string; area: string; message: string; items?: string[] }> }>("mentor_plan_health", opts),
  mentorAreaTimesGet: (opts: { planId: string }) => call<{ times: import("./areaTimes").AreaTimes }>("mentor_area_times_get", opts),
  mentorAreaTimeSet: (opts: { planId: string; subplanId: string; start: string | null; durationMin?: number | null }) => call<{ times: import("./areaTimes").AreaTimes }>("mentor_area_time_set", opts),
  mentorPlanFolderCandidates: (opts: { planId: string }) => call<{ candidates: Array<{ folder: string; label: string; role?: import("./folderRoles").FolderRoleKind; objective?: string; topicCount: number; estMinutes: number }> }>("mentor_plan_folder_candidates", opts),
  mentorPlanFolderPreview: (opts: { planId: string; folder: string; mode: "area" | "subject"; subplanId?: string; name?: string; objective?: string }) => call<{ preview: { duplicates: import("./types").ReviewDuplicate[]; impact: import("./types").ReviewImpact; warnings: string[]; fits: boolean } }>("mentor_plan_folder_preview", opts),
  mentorPlanFolderAdd: (opts: { planId: string; folder: string; mode: "area" | "subject"; subplanId?: string; name?: string; objective?: string; source?: "manual" | "auto" }) => call<{ plan: import("./types").MentorPlan; review: import("./types").PlanReview }>("mentor_plan_folder_add", opts),
  mentorPlanFolderSync: (opts: { planId: string }) => call<{ added: import("./types").PlanReview[]; candidates: Array<any> }>("mentor_plan_folder_sync", opts),
  mentorPlanReviewList: (opts: { planId: string }) => call<{ reviews: import("./types").PlanReview[] }>("mentor_plan_review_list", opts),
  mentorPlanReviewResolve: (opts: { planId: string; reviewId: string; action: "keep" | "remove"; objective?: string }) => call<{ resolved: boolean; plan?: import("./types").MentorPlan }>("mentor_plan_review_resolve", opts),
  /** La RUTA del plan activo (o de todos los activos, o la de `planId`): cada tema con su ruta (core · optional · skipped) y su semana objetivo. Solo lee; nunca borra notas. */
  mentorRoute: (planId?: string) => call<import("./types").MentorRoute>("mentor_route", planId ? { planId } : {}),
  mentorPlanReduce: (opts: { id: string; areaId?: string; groupId?: string; max?: number }) => call<import("./types").MentorRouteChangeResult>("mentor_plan_reduce", opts),
  mentorPlanChange: (opts: { id: string; comment?: string; ops?: Array<Record<string, unknown>>; label?: string; noAi?: boolean; intent?: "fix" | "adjust" }) => call<import("./types").MentorChangeResult>("mentor_plan_change", opts),
  mentorPlanAsk: (id: string, question: string, opts: { noAi?: boolean } = {}) => call<import("./types").MentorAskResult>("mentor_plan_ask", { id, question, ...opts }),
  mentorPlanIntent: (id: string, text: string, opts: { noAi?: boolean } = {}) => call<import("./types").MentorIntentResult>("mentor_plan_intent", { id, text, ...opts }),
  mentorPlanChanges: (id: string) => call<import("./types").MentorChangeEntry[]>("mentor_plan_changes", { id }),
  mentorPlanChangeUndo: (id: string) => call<{ plan: import("./types").MentorPlan; history: import("./types").MentorChangeEntry[] }>("mentor_plan_change_undo", { id }),
  mentorAiStatus: (key: string) => call<import("./types").MentorAiStatus>("mentor_ai_status", { key }),
  mentorAiCancel: (key: string, mode: "abort" | "auto" = "abort") => call<{ cancelled: boolean }>("mentor_ai_cancel", { key, mode }),
  mentorPlanBuildStart: (preconditions: import("./planTime").PlanPreconditions, id?: string) => call<import("./types").MentorBuildResult>("mentor_plan_build_start", { preconditions, ...(id ? { id } : {}) }),
  mentorPlanBuildGet: (id: string) => call<import("./types").MentorBuildResult>("mentor_plan_build_get", { id }),
  mentorPlanBuildList: () => call<import("./types").MentorBuildSummary[]>("mentor_plan_build_list"),
  mentorPlanBuildAnswer: (opts: { id: string; questionId: string; choice?: string; answer?: string; skip?: boolean; delegate?: boolean }) => call<import("./types").MentorBuildResult>("mentor_plan_build_answer", opts),
  mentorPlanBuildBack: (id: string, stage: import("./planBuild").BuildStage) => call<import("./types").MentorBuildResult>("mentor_plan_build_back", { id, stage }),
  mentorPlanBuildFinishNow: (id: string) => call<import("./types").MentorBuildResult>("mentor_plan_build_finish_now", { id }),
  mentorPlanBuildAbandon: (id: string) => call<{ id: string; builds: import("./types").MentorBuildSummary[] }>("mentor_plan_build_abandon", { id }),
  mentorPlanBuildAccept: (id: string) => call<import("./types").MentorPlanAccepted | { loading: true }>("mentor_plan_build_accept", { id }),
  mentorPlanRename: (id: string, name: string) => call<import("./types").MentorPlan>("mentor_plan_rename", { id, name }),
  mentorPlanArchive: (id: string, archived: boolean) => call<import("./types").MentorPlan>("mentor_plan_archive", { id, archived }),
  mentorPlanDelete: (id: string) => call<{ id: string; plans: import("./types").MentorPlanRow[] }>("mentor_plan_delete", { id }),
  mentorPlanDraftAccept: (turnId: string, chatId?: string) => call<import("./types").MentorPlanAccepted>("mentor_plan_draft_accept", { turnId, chatId }),
  /** Responde una pregunta pendiente del borrador (entregables): yes añade la propuesta, no la descarta, later la deja. */
  mentorPlanDraftAnswer: (opts: { turnId: string; chatId?: string; subplanId?: string; answer: "yes" | "no" | "later"; questionId?: string }) =>
    call<{ turns: import("./types").MentorChatTurn[]; pending: string | null; planDraft: import("./types").MentorPlanDraft }>("mentor_plan_draft_answer", opts),
  mentorPlanDraftDiscard: (turnId: string) => call<import("./types").MentorChatState>("mentor_plan_draft_discard", turnId),
  /** Mismo efecto que `mentorPlanDraftDiscard` (nombre corto del contrato). */
  mentorPlanDiscard: (turnId: string) => call<import("./types").MentorChatState>("mentor_plan_discard", turnId),
  /** Cambia el estado de un entregable: el de un área (`subplanId`) o uno de la agenda (`deliverableId`: kata:<fecha>, wp:<semana>, mp:<semana>, area:<subplan>, x:<n>), con archivos opcionales. */
  mentorPlanUpdateDeliverable: (opts: { id: string; subplanId?: string; deliverableId?: string; status?: import("./types").MentorDeliverableStatus | import("./planAreas").PlanDeliverableStatus; projectId?: string | null; files?: Array<{ path?: string; note: string }> }) =>
    call<import("./types").MentorPlan>("mentor_plan_update_deliverable", opts),
  mentorChatsList: () => call<import("./types").MentorChatMeta[]>("mentor_chats_list"),
  mentorChatNew: () => call<import("./types").MentorChatState>("mentor_chat_new"),
  mentorChatOpen: (id: string) => call<import("./types").MentorChatState>("mentor_chat_open", id),
  mentorChatRename: (id: string, title: string) => call<{ id: string; title: string }>("mentor_chat_rename", id, title),
  mentorChatDelete: (id: string) => call<import("./types").MentorChatState>("mentor_chat_delete", id),
  mentorDraftDiscard: (turnId: string) => call<import("./types").MentorChatState>("mentor_draft_discard", turnId),
  mentorGoalCreate: (draft: import("./types").MentorGoalDraft, turnId?: string) =>
    call<import("./types").MentorGoalCreated>("mentor_goal_create", { draft, turnId }),
  mentorPanels: () => call<import("./types").MentorPanels>("mentor_panels"),

  // Finanzas
  finMeta: () => call<FinMeta>("fin_meta"),
  finSidebar: () => call<FinSidebar>("fin_sidebar"),
  finRange: (first: string, last: string) => call<Movement[]>("fin_range", first, last),
  finMonthExtras: (year: number, month: number) =>
    call<{ budgets: Array<{ category: FinCategory; used: number; budget: number }>; this: FinTotals; prev: FinTotals }>(
      "fin_month_extras", year, month),
  finDueChecks: (day: string) => call<FinCheck[]>("fin_due_checks", day),
  finDiarioBundle: (day: string) => call<{
    movements: Movement[]; checks: FinCheck[];
    month: import("./types").FinTotals; budget: number;
    budgets: Array<{ category: FinCategory; used: number; budget: number }>;
  }>("fin_diario_bundle", day),
  finNewId: () => call<{ id: string }>("fin_new_id"),
  finAdd: (day: string, fields: Partial<Movement>) => call<Movement>("fin_add", day, fields),
  finUpdate: (day: string, id: string, fields: Partial<Movement>, newDay = "") =>
    call<Movement>("fin_update", day, id, fields, newDay),
  finDelete: (day: string, id: string) => call<{ ok: boolean }>("fin_delete", day, id),
  finDeleteMany: (pairs: Array<[string, string]>) => call<{ ok: boolean }>("fin_delete_many", pairs),
  finCategorySave: (id: string, fields: Partial<FinCategory>) => call<FinCategory>("fin_category_save", id, fields),
  finCategoryDelete: (id: string) => call<{ ok: boolean }>("fin_category_delete", id),
  finCategoryMove: (id: string, delta: number) => call<{ ok: boolean }>("fin_category_move", id, delta),
  finGoals: () => call<{ goals: Array<FinGoal & { pace: FinPace; projection: string | null }>; general: number }>("fin_goals"),
  finGoal: (id: string) => call<{
    goal: FinGoal; pace: FinPace; projection: string | null; days: Array<{ date: string; net: number }>;
    months: Array<[string, number]>; movements: Movement[];
  }>("fin_goal", id),
  finGoalSave: (id: string, fields: Partial<FinGoal>) => call<FinGoal>("fin_goal_save", id, fields),
  finGoalDelete: (id: string) => call<{ ok: boolean }>("fin_goal_delete", id),
  finAssignGeneral: (goal: string) => call<{ moved: number }>("fin_assign_general", goal),
  finRecurringList: () => call<Array<import("./types").FinRecurring>>("fin_recurring_list"),
  finRecurringSave: (id: string, fields: Partial<import("./types").FinRecurring>) =>
    call<import("./types").FinRecurring>("fin_recurring_save", id, fields),
  finRecurringDelete: (id: string) => call<{ ok: boolean }>("fin_recurring_delete", id),
  finRecurringRun: (today: string) => call<{ created: number }>("fin_recurring_run", today),
  finBudgetGet: () => call<{ month_budget_cents: number }>("fin_budget_get"),
  finBudgetSet: (cents: number) => call<{ month_budget_cents: number }>("fin_budget_set", cents),
  finSearch: (query: string, kind = "", category = "", offset = 0) =>
    call<{ total: number; movements: Array<import("./types").Movement> }>("fin_search", query, kind, category, offset),
  finImportBatch: (items: import("./types").FinImportItem[]) =>
    call<{ imported: number; movements: Array<import("./types").Movement> }>("fin_import_batch", items),
  finExportAll: () =>
    call<import("./types").FinExportData>("fin_export_all"),
  finRulesGet: () =>
    call<{ rules: import("./types").FinRule[] }>("fin_rules_get"),
  finRulesSave: (fields: Partial<import("./types").FinRule>) =>
    call<import("./types").FinRule>("fin_rules_save", fields),
  finRulesDelete: (id: string) =>
    call<{ ok: boolean }>("fin_rules_delete", id),
  finFindDuplicates: (candidates: Array<{ date: string; amount_cents: number; what?: string; type?: string }>) =>
    call<{ duplicates: import("./types").FinDuplicateMatch[] }>("fin_find_duplicates", candidates),
  // Ejercicio
  exMeta: () => call<{ days: Array<{ key: string; name: string; subtitle: string; glyph: string }> }>("ex_meta"),
  exList: () => call<Exercise[]>("ex_list"),
  exStats: (year = 0) => call<import("./types").ExerciseStats>("ex_stats", year),
  exDays: (first: string, last: string) => call<ExerciseDay[]>("ex_days", first, last),
  exMark: (day: string, id: string, done: boolean, weight: number | string = 0, reps: number | string = 0, notes = "") =>
    call<{ ok: boolean; pct: number }>("ex_mark", day, id, done, weight, reps, notes),
  exOverview: (year = 0, exerciseId = "") => call<ExerciseOverview>("ex_overview", year, exerciseId),
  exHistory: (id: string, year = 0) => call<Array<{ date: string; weight: number; reps: number; volume: number; e1rm: number | null }>>("ex_history", id, year),
  exSave: (id: string, fields: Partial<Exercise>) => call<Exercise>("ex_save", id, fields),
  exRemove: (id: string) => call<{ ok: boolean }>("ex_remove", id),
  exLinkVideos: () => call<{ linked: string[]; already: string[]; missing: string[] }>("ex_link_videos"),
  exLibraryList: () => call<LibraryUserEntry[]>("ex_library_list"),
  exLibrarySave: (fields: { name: string; slug?: string; equipment?: string; muscles?: unknown; how_to?: string; video_path?: string }) =>
    call<{ entry: LibraryUserEntry; wrote: boolean; created: boolean; updatedFrom?: string }>("ex_library_save", fields),
  exLibraryRemove: (slug: string) => call<boolean>("ex_library_remove", slug),
  exLibraryVideoUrl: (slug: string) => call<{ url: string; name: string }>("ex_library_video_url", slug),
  exLibraryPickVideo: () => call<{ ok: boolean; video_path?: string }>("ex_library_pick_video"),
  exFavorites: () => call<string[]>("ex_favorites"),
  exFavoriteToggle: (slug: string) => call<{ slug: string; on: boolean }>("ex_favorite_toggle", slug),
  exProfile: () => call<BodyProfile>("ex_profile"),
  exProfileSave: (updates: Partial<BodyProfile>) =>
    call<BodyProfile>("ex_profile_save", updates),
  exWeightAdd: (date: string, weight: number) =>
    call<BodyProfile>("ex_weight_add", date, weight),
  exWeightRemove: (date: string) =>
    call<BodyProfile>("ex_weight_remove", date),
  exCoachContext: () =>
    call<{ profile: BodyProfile; exercisesCount: number; currentWeight: number | null; goal: string }>("ex_coach_context"),
  exCoachConversations: () => call<ConversationMeta[]>("ex_coach_conversations"),
  exCoachConversationGet: (id: string) => call<Conversation | null>("ex_coach_conversation_get", id),
  exCoachConversationSave: (id: string | null, messages: unknown, model?: string, title?: string) =>
    call<Conversation>("ex_coach_conversation_save", id, messages, model, title),
  exCoachConversationRename: (id: string, title: string) =>
    call<Conversation>("ex_coach_conversation_rename", id, title),
  exCoachConversationDelete: (id: string) =>
    call<{ ok: boolean }>("ex_coach_conversation_delete", id),
  exCoachAiTitle: (id: string, question: string, answer?: string) =>
    call<{ title: string; fallback: boolean; error?: string }>("ex_coach_ai_title", id, question, answer),
  exCoachChatStream: (id: string, history: Array<{ role: string; content: string }>, question: string) =>
    call<{ reply?: string; stopped?: boolean; bridge?: boolean; prompt?: string; url?: string; label?: string }>(
      "ex_coach_chat_stream", id, history, question,
    ),
  exCoachChatCancel: (id: string) => call<{ ok: boolean }>("ex_coach_chat_cancel", id),
  finCoachContext: () => call<FinanceContextData>("fin_coach_context"),
  finCoachConversations: () => call<ConversationMeta[]>("fin_coach_conversations"),
  finCoachConversationGet: (id: string) => call<Conversation | null>("fin_coach_conversation_get", id),
  finCoachConversationSave: (id: string | null, messages: unknown, model?: string, title?: string) =>
    call<Conversation>("fin_coach_conversation_save", id, messages, model, title),
  finCoachConversationRename: (id: string, title: string) =>
    call<Conversation>("fin_coach_conversation_rename", id, title),
  finCoachConversationDelete: (id: string) =>
    call<{ ok: boolean }>("fin_coach_conversation_delete", id),
  finCoachAiTitle: (id: string, question: string, answer?: string) =>
    call<{ title: string; fallback: boolean; error?: string }>("fin_coach_ai_title", id, question, answer),
  finCoachChatStream: (id: string, history: Array<{ role: string; content: string }>, question: string) =>
    call<{ reply?: string; stopped?: boolean; bridge?: boolean; prompt?: string; url?: string; label?: string }>(
      "fin_coach_chat_stream", id, history, question,
    ),
  finCoachChatCancel: (id: string) => call<{ ok: boolean }>("fin_coach_chat_cancel", id),
  exVideoUrl: (id: string) => call<{ url: string; name: string }>("ex_video_url", id),
  exOpenVideo: (id: string) => call<{ ok: boolean }>("ex_open_video", id),
  exPickVideo: (id: string) => call<{ ok: boolean }>("ex_pick_video", id),
  vaultList: () => call<VaultInfo[]>("vault_list"),
  vaultPick: () => call<{ ok: boolean; fallback?: boolean } & Partial<VaultInfo>>("vault_pick"),
  vaultCreate: (name: string) => call<{ ok: boolean; fallback?: boolean; path?: string }>("vault_create", name),
  vaultOpen: (path: string) => call<{ ok: boolean; name: string; path: string }>("vault_open", path),
  knowledgeGraph: () => call<{ nodes: import("./graph").GraphNode[]; edges: import("./graph").GraphEdge[] }>("knowledge_graph"),
  aiSettings: () => call<{ config: AiConfig; providers: AiProvider[]; models: string[] }>("ai_settings"),
  aiSettingsSave: (fields: Partial<AiConfig> & { api_key?: string; clear_key?: boolean }) => call<AiConfig>("ai_settings_save", fields),
  aiModels: () => call<string[]>("ai_models"),
  aiTest: () => call<{ ok: boolean; reply: string }>("ai_test"),
  aiWorkspace: (rel: string) => call<{ id: string; name: string; icon: string }>("ai_workspace", rel),
  aiChat: (history: Array<{ role: string; content: string }>, question: string, noteRel = "", selection = "") =>
    call<{ reply?: string; bridge?: boolean; prompt?: string; url?: string; label?: string }>("ai_chat", history, question, noteRel, selection),
  /** Streamed chat: the answer arrives over onAiStream, the promise holds it whole. */
  aiChatStream: (id: string, history: Array<{ role: string; content: string }>, question: string, noteRel = "", selection = "", mode = "", folders: string[] = [], files: string[] = []) =>
    call<{ reply?: string; stopped?: boolean; bridge?: boolean; prompt?: string; url?: string; label?: string }>(
      "ai_chat_stream", id, history, question, noteRel, selection, mode, folders, files,
    ),
  /** What a chat action would create (nothing is written). */
  assistantActionPreview: (action: unknown) =>
    call<{ title: string; warnings: string[]; open: string; ops: Array<{ kind: "mkdir" | "write"; rel: string; exists: boolean; overwrite: boolean }> }>(
      "assistant_action_preview", action,
    ),
  /** Runs an action the user accepted. */
  assistantActionApply: (action: unknown) =>
    call<{ ok: boolean; written: string[]; skipped: string[]; open: string; backedUp?: string[] }>("assistant_action_apply", action),
  /** ¿Hay una generación del Mentor / un «Regenerar» en curso (turno compartido)? */
  assistantGenerationBusy: () => call<boolean>("assistant_generation_busy"),
  /** Anota en el historial de cambios del plan que una acción del chat tocó su ruta (no modifica el plan). */
  assistantPlanNote: (planId: string, comment: string, summary = "") => call<{ ok: boolean; n: number }>("assistant_plan_note", planId, comment, summary),
  aiChatCancel: (id: string) => call<{ ok: boolean }>("ai_chat_cancel", id),
  onAiStream: (cb: (ev: AiStreamEvent) => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onAiStream) {
      return window.nv.onAiStream(cb);
    }
    return () => {};
  },

  // ── Historial de conversaciones (privado, en los datos de la app) ────
  conversationList: () => call<ConversationMeta[]>("conversation_list"),
  conversationGet: (id: string) => call<Conversation>("conversation_get", id),
  conversationSave: (id: string | null, messages: unknown[], model = "", title = "") =>
    call<Conversation>("conversation_save", id, messages, model, title),
  conversationRename: (id: string, title: string) => call<Conversation>("conversation_rename", id, title),
  conversationDelete: (id: string) => call<{ ok: boolean }>("conversation_delete", id),
  aiTitle: (id: string, question: string, answer = "") =>
    call<{ title: string; fallback?: boolean; error?: string }>("ai_title", id, question, answer),
  notePropertiesMeta: () => call<{ subjects: string[]; types: string[]; statuses: string[] }>("note_properties_meta"),
  noteSetProperties: (rel: string, props: Record<string, unknown>, expectedModified: number | null = null) =>
    call<WriteResult>("note_set_properties", rel, props, expectedModified),
  englishSentences: () => call<string[]>("english_sentences"),
  englishSpeak: (text: string) => call<{ ok: boolean }>("english_speak", text),
  revealInOs: (rel: string) => call<{ ok: boolean }>("reveal_in_os", rel),
  duplicate: (rel: string) => call<{ path: string }>("duplicate", rel),
  openInDefaultApp: (rel: string) => call<{ ok: boolean }>("open_in_default_app", rel),
  openInNewWindow: (rel: string) => call<{ ok: boolean }>("window_open_new", rel),
  versionHistory: (rel: string) => call<{ hash: string; date: string; author: string; subject: string }[]>("version_history", rel),
  versionFile: (rel: string, hash: string) => call<{ content: string }>("version_file", rel, hash),
  homeOverview: () => call<HomeOverview>("home_overview"),
  templatesList: () => call<{ folder: string; templates: Array<{ name: string; title: string }> }>("templates_list"),
  templateText: (name: string, title = "") => call<{ text: string }>("template_text", name, title),
  noteFromTemplate: (name: string, title: string, folder = "") => call<{ path: string }>("note_from_template", name, title, folder),
  dailyNote: () => call<{ path: string }>("daily_note"),
  tagsList: () => call<Array<{ tag: string; count: number }>>("tags_list"),
  tagNotes: (tag: string) => call<Array<{ path: string; title: string }>>("tag_notes", tag),
  canvasRead: (rel: string) => call<{ path: string; title: string; doc: import("./canvas").CanvasDoc; modified: number }>("canvas_read", rel),
  canvasWrite: (rel: string, doc: import("./canvas").CanvasDoc, expectedModified: number | null) =>
    call<WriteResult>("canvas_write", rel, doc, expectedModified),
  canvasCreate: (title: string, folder = "") => call<{ path: string }>("canvas_create", title, folder),
  canvasList: () => call<Array<{ path: string; title: string }>>("canvas_list"),
  canvasImages: () => call<Array<{ path: string; title: string }>>("canvas_images"),
  canvasMedia: (rel: string) => call<{ data_url: string }>("canvas_media", rel),
  canvasFileInfo: (rel: string) =>
    call<{ exists: boolean; kind?: string; title?: string; path?: string; text?: string }>("canvas_file_info", rel),
  practiceLoad: (rel: string) => call<import("./types").PracticeExercise>("practice_load", rel),
  practiceSolution: (rel: string) => call<{ solution: string }>("practice_solution", rel),
  practiceSaveDraft: (rel: string, text: string) => call<{ ok: boolean }>("practice_save_draft", rel, text),
  practiceGrade: (rel: string, answer: string, hints: number, seconds: number, solutionSeen: boolean, via = "") =>
    call<import("./types").PracticeGraded | import("./types").PracticeWaiting>("practice_grade", rel, answer, hints, seconds, solutionSeen, via),
  practiceReply: (rel: string, request: string, text = "") =>
    call<import("./types").PracticeGraded | import("./types").PracticeWaiting>("practice_reply", rel, request, text),
  practiceDiscard: (rel: string, request: string) => call<{ ok: boolean }>("practice_discard", rel, request),
  practiceGiveUp: (rel: string, seconds: number, hints: number) => call<import("./types").PracticeGraded>("practice_give_up", rel, seconds, hints),
  practiceDrillStart: (rel: string) => call<{ session: string; prompts: string[] }>("practice_drill_start", rel),
  practiceDrillCheck: (session: string, index: number, given: string, seconds: number) =>
    call<{ ok: boolean; answer: string }>("practice_drill_check", session, index, given, seconds),
  practiceDrillFinish: (session: string, seconds: number) => call<import("./types").PracticeGraded>("practice_drill_finish", session, seconds),
  ladderLoad: (rel: string) => call<import("./types").LadderInfo>("ladder_load", rel),
  ladderLevel: (rel: string, level: number) => call<import("./types").LadderLevel>("ladder_level", rel, level),
  ladderSaveDraft: (rel: string, level: number, data: import("./types").LadderData) => call<{ ok: boolean }>("ladder_save_draft", rel, level, data),
  ladderGrade: (rel: string, level: number, data: import("./types").LadderData, seconds: number, solutionSeen: boolean, via = "") =>
    call<import("./types").LadderGraded | import("./types").PracticeWaiting>("ladder_grade", rel, level, data, seconds, solutionSeen, via),
  ladderReply: (rel: string, request: string, text = "") =>
    call<import("./types").LadderGraded | import("./types").PracticeWaiting>("ladder_reply", rel, request, text),
  ladderDiscard: (rel: string, request: string) => call<{ ok: boolean }>("ladder_discard", rel, request),
  ladderProof: (rel: string) => call<{ proof: string }>("ladder_proof", rel),
  ladderGiveUp: (rel: string, level: number, data: import("./types").LadderData, seconds: number) =>
    call<import("./types").LadderGraded>("ladder_give_up", rel, level, data, seconds),
  studyArea: (rel: string) => call<{ subject: string; folder: string; title: string; subject_title: string } | null>("study_area", rel),
  studySnapshot: (rel: string) => call<import("./types").StudySnapshot>("study_snapshot", rel),
  studyTopicGet: (rel: string) => call<import("./types").TopicData>("study_topic_get", rel),
studyTopicMap: (rel: string) => call<{ ok: boolean; path: string }>("study_topic_map", rel),
  /** The view file of a folder: practica or resumen. READ-ONLY unless `create` (then it writes the view files; `missing` = it does not exist yet). */
  studyViewEnsure: (rel: string, create = false) =>
    call<{ ok: boolean; kind: "practica" | "resumen" | "ejercicios" | "proyectos" | "none"; path: string; missing?: boolean; created: string[]; tagged?: string[]; errors: string[] }>("study_view_ensure", rel, create),
  studyTopicConvert: (folder: string) => call<{ ok: boolean; path: string; manifest: any }>("study_topic_convert", folder),
  studyTopicSessionBuild: (
    folder: string,
    skill: string,
    difficulty: number,
    quantity: string,
    assistance: string,
  ) => call<import("./types").TopicSessionResult>("study_topic_session_build", folder, skill, difficulty, quantity, assistance),
  /** AI reads the topic's theory and rewrites its practice plan (skills x difficulty counts). */
  /** Mistakes record per competency of a topic: is the box on, how many mistakes it holds. */
  studyLearningStatus: (folder: string) => call<Record<string, { enabled: boolean; entries: number }>>("study_learning_status", folder),
  studyLearningSet: (folder: string, skill: string, enabled: boolean) =>
    call<{ skill: string; enabled: boolean; entries: number }>("study_learning_set", folder, skill, enabled),
  /** The competency checklist for the chat: recommended ones, and how every skill would be practised here. */
  studyTopicSkillOptions: (folder: string) =>
    call<import("../lib/assistantModes").ParsedSkills & { current?: boolean }>("study_topic_skill_options", folder),
  /** How a topic is classified (type for maths/programming, branch for English) or why it is not. */
  studyTopicClassification: (folder: string) =>
    call<{ ok: boolean; domain: string; branch: string | null; topicType: string | null; via: string | null; reason?: string; suggestion?: string | null }>("study_topic_classification", folder),
  /** Resolves an unclassified English topic explicitly by giving it a branch. */
  studyTopicClassify: (folder: string, branch: string) => call<{ ok: boolean; branch: string }>("study_topic_classify", folder, branch),
  studyUnclassifiedList: () => call<Array<{ folder: string; name: string; suggestion: string | null; reason: string }>>("study_unclassified_list"),
  studyTopicReevaluate: (folder: string) =>
    call<{ ok: boolean; plan: import("./types").PracticePlan; path: string }>("study_topic_reevaluate", folder),
  /** The topic review notes: when each practised topic is due again. */
  /** Moves the pending review of a topic to another day (YYYY-MM-DD). */
  studyReviewReschedule: (path: string, date: string) => call<import("./types").ReviewItem>("study_review_reschedule", path, date),
  studyReviewSettings: () => call<{ enabled: boolean; hour: number }>("study_review_settings"),
  studyReviewSettingsSet: (settings: { enabled: boolean; hour: number }) => call<{ enabled: boolean; hour: number }>("study_review_settings_set", settings),
  studyReviewNotifyTest: () => call<{ supported: boolean; due: number }>("study_review_notify_test"),
  /** Adds a word to the English word bank; with a date it is scheduled for review that day. */
  enVocabAdd: (word: string, meaning = "", level = "B1", nextReview = "") =>
    call<{ ok: boolean; id: string; word: string; next_review: string }>("en_vocab_add", word, meaning, level, nextReview),
  /** A vocabulary session from the shared word bank (vc_ skill): words of ONE class (verb, noun…; empty = the class with most words due). */
  studyVocabSession: (skill = "vc_recall", quantity = "3-5", wordClass = "") =>
    call<{ ok: boolean; skill: string; first_exercise: string; exercises: Array<{ id: string; title: string; path: string; is_new: boolean }> }>("study_vocab_session", skill, quantity, wordClass),
  studyReviewsList: () =>
    call<{ today: string; items: import("./types").ReviewItem[] }>("study_reviews_list"),
  /** The AI proposes areas and topics for a subject (nothing is written). */
  studySpacePropose: (subject: string, scope: string, objective: string, existingFolder = "") =>
    call<{ areas: ProposedArea[]; conversationId: string }>("study_space_propose", subject, scope, objective, existingFolder),
  studySpaceGenerate: (request: unknown) => call<{ jobId: string; conversationId: string }>("study_space_generate", request),
  studyTopicGenerate: (folder: string, conversationId = "") => call<{ jobId: string; conversationId: string }>("study_topic_generate", folder, conversationId),
  studySpaceStatus: (jobId: string) =>
    call<{ id: string; folder: string; log: string[]; done: boolean; error: string; finished: number; total: number; conversationId: string }>("study_space_status", jobId),
  /** Regenera la teoría / práctica / ejercicios de un tema (respalda antes lo que reemplaza). Exige `confirm: true`. */
  studyTopicRegenerate: (folder: string, what: "theory" | "map" | "practice" | "exercises" | "all", confirm: boolean, engine?: "app" | "claude") => call<{ jobId: string }>("study_topic_regenerate", folder, what, confirm, engine ?? "app"),
  /** Motores con los que se puede regenerar ahora mismo (la IA de la app, Claude o un agente externo), según los ajustes de IA. */
  studyRegenEngines: () => call<import("./types").RegenEnginesView>("study_regen_engines"),
  /** Tarea para un agente externo (Antigravity / Claude Code): respalda y escribe el archivo de la tarea en la vault. `folders`: un tema o un lote. */
  studyTopicRegenerateHandoff: (folders: string | string[], what: "theory" | "practice" | "exercises" | "all" | "theory+practice" | "theory+exercises" | "practice+exercises", confirm: boolean, options?: { missingOnly?: boolean; includeRecommended?: boolean; work?: Array<{ folder: string; steps: Array<"theory" | "map" | "practice" | "exercises"> }> }) => call<import("./types").RegenHandoff>("study_topic_regenerate_handoff", folders, what, confirm, options),
  studyTopicRegenerateHandoffStatus: (id: string) => call<import("./types").RegenHandoff>("study_topic_regenerate_handoff_status", id),
  /** Las tareas para agentes externos guardadas en la vault (reabrirlas tras reiniciar la app). */
  studyTopicRegenerateHandoffList: () => call<import("./types").RegenHandoff[]>("study_topic_regenerate_handoff_list"),
  /** Valida lo que escribió el agente y lo aplica; con `restore` (confirmado) devuelve las copias de los temas con error. */
  studyTopicRegenerateValidate: (id: string, restore = false) => call<import("./types").RegenHandoff>("study_topic_regenerate_validate", id, restore),
  /** «Crear con Antigravity»: escribe SOLO la tarea (sin IA) para que un agente externo cree los temas de referencia que faltan. Exige `confirm: true`; máximo 40 temas (lotes de ≤ 25). */
  studyCurriculumHandoff: (input: { areaId: string; entryIds: string[]; withExercises?: boolean; confirm: boolean }) => call<import("./types").CurriculumHandoff>("study_curriculum_handoff", input),
  studyCurriculumHandoffBatches: (input: { areaId: string; importance?: string; size?: number; withExercises?: boolean; refreshOnly?: boolean; confirm: boolean }) => call<import("./types").CurriculumQueue>("study_curriculum_handoff_batches", input),
  studyCurriculumHandoffValidateAll: (input: { areaId: string }) => call<import("./types").CurriculumHandoff[]>("study_curriculum_handoff_validate_all", input),
  studyCurriculumHandoffDiscard: (input: { areaId: string }) => call<{ removed: number }>("study_curriculum_handoff_discard", input),
  studyCurriculumAutoEngine: () => call<{ ready: boolean; reason: string; label: string }>("study_curriculum_auto_engine"),
  studyCurriculumAutoStart: (input: { areaId: string; importance?: string; entryIds?: string[]; confirm: boolean }) => call<{ jobId: string; total: number }>("study_curriculum_auto_start", input),
  studyCurriculumAutoStatus: (jobId: string) => call<import("./types").CurriculumAutoJob>("study_curriculum_auto_status", jobId),
  studyCurriculumAutoCancel: (jobId: string) => call<{ ok: boolean }>("study_curriculum_auto_cancel", jobId),
  studyCurriculumHandoffStatus: (id: string) => call<import("./types").CurriculumHandoff>("study_curriculum_handoff_status", id),
  studyCurriculumHandoffValidate: (id: string) => call<import("./types").CurriculumHandoff>("study_curriculum_handoff_validate", id),
  /** Cobertura del currículo de referencia (HTML, CSS, JS reference, Java) frente a los temas existentes. */
  studyCurriculumCoverage: (opts: { space?: string; fresh?: boolean } = {}) => call<import("./curriculum").CurriculumCoverage>("study_curriculum_coverage", opts),
  studyCurriculumHandoffList: () => call<import("./types").CurriculumHandoff[]>("study_curriculum_handoff_list"),
  studyTopicRegenerateStatus: (jobId: string) =>
    call<import("./types").TopicRegenerateJob>("study_topic_regenerate_status", jobId),
  studySpaceList: () => call<string[]>("study_space_list"),
  studySpaceSubject: (rel: string) => call<string>("study_space_subject", rel),
  studyTopicPlan: (folder: string) =>
    call<{ plan: import("./types").PracticePlan | null }>("study_topic_plan", folder),
  studyTopicDashboard: (subject?: string) => call<import("./types").TopicDashboardData>("study_topic_dashboard", subject),
  /** AI-drafts a subject's areas/topics and creates the folder tree + overviews. */
  studyGenerateSyllabus: (subject: string) =>
    call<{ ok: boolean; created: string[]; folders: string[]; plan: unknown }>("study_generate_syllabus", subject),
  /** A session drawn from every topic of an area (see `study_area_session_build`). */
  studyAreaSessionBuild: (
    folder: string,
    skill: string,
    difficulty: number,
    quantity: string,
    assistance: string,
  ) => call<import("./types").TopicSessionResult>("study_area_session_build", folder, skill, difficulty, quantity, assistance),
  studyExamAssemble: (
    topicFolder?: string,
    examGroup?: string,
    targetDifficulty?: number,
  ) => call<{ ok: boolean; session: import("./types").ExamSession }>("study_exam_assemble", topicFolder, examGroup, targetDifficulty),
  studyExamSubmit: (
    session: import("./types").ExamSession,
    submissions: import("./types").ExamItemSubmission[],
  ) => call<{ ok: boolean; record: import("./types").ExamRecord; item_results: import("./types").ExamItemGradingResult[] }>("study_exam_submit", session, submissions),
  studyCardGrade: (srsId: string, quality: number) => call<{ ok: boolean }>("study_card_grade", srsId, quality),
  studyErrorResolve: (id: string) => call<{ ok: boolean }>("study_error_resolve", id),
  studyErrorDigest: () => call<{ text: string }>("study_error_digest"),
  mapTemplates: () => call<Array<{ name: string; yaml: string }>>("map_templates"),
  mapBuild: (yaml: string, folder: string, name: string) => call<{ ok: boolean; path?: string; errors?: string[] }>("map_build", yaml, folder, name),
  mapGenerate: (order: string, context: string[], extra: string, template: string, folder: string, name: string) =>
    call<{ ok: boolean; path?: string; errors?: string[]; bridge?: boolean; prompt?: string; url?: string; label?: string }>(
      "map_generate", order, context, extra, template, folder, name),
  webOverview: (day = "") => call<import("./types").WebOverview>("web_overview", day),
  webNormalize: (text: string) => call<{ url: string; host: string }>("web_normalize", text),
  webBookmarkAdd: (title: string, url: string) => call<{ id: string; title: string; url: string }>("web_bookmark_add", title, url),
  webBookmarkRemove: (url: string) => call<{ ok: boolean }>("web_bookmark_remove", url),
  webHistoryClear: () => call<{ ok: boolean }>("web_history_clear"),
  webRestrictionsSave: (data: import("./types").WebRules, phrase = "") =>
    call<{ ok: boolean; needs_phrase?: boolean; phrase?: string; restrictions?: import("./types").WebRules }>("web_restrictions_save", data, phrase),
  webPreset: (data: import("./types").WebRules, name: string) => call<import("./types").WebRules>("web_preset", data, name),
  webOpen: (text: string) => call<{ ok: boolean; blocked?: boolean; reason?: string; system?: boolean }>("web_open", text),
  studyFolders: () => call<Array<{ id: string; name: string; icon: string; exists: boolean; index: string }>>("study_folders"),
  studyFolderCreate: (id: string, structure: boolean) => call<{ path: string; created: boolean; index: string }>("study_folder_create", id, structure),
  enPlayerPick: () => call<import("./types").PlayerMedia & { ok: boolean }>("en_player_pick"),
  enSourceList: () => call<{ items: import("./types").EnglishSource[]; kinds: { id: string; label: string }[]; folder: string }>("en_source_list"),
  enSourceAdd: (kind: string, title = "", withTranscript = true, copy = true) =>
    call<{ ok: boolean; source?: import("./types").EnglishSource }>("en_source_add", kind, title, withTranscript, copy),
  enSourcePaste: (kind: string, title: string, text: string, attachTo = "") =>
    call<{ ok: boolean; timed: boolean; source?: import("./types").EnglishSource }>("en_source_paste", kind, title, text, attachTo),
  enRecordingSave: (name: string, data: string, ext = "webm") => call<{ ok: boolean; id: string; size: number }>("en_recording_save", name, data, ext),
  codeRuntimes: () => call<{ items: import("./types").CodeRuntime[] }>("code_runtimes"),
  codeRun: (language: string, code: string, stdin = "") => call<import("./types").CodeRun>("code_run", language, code, stdin),
  practicePickCodeFile: () => call<{ok:boolean;name?:string;text?:string}>("practice_pick_code_file"),
  codeTrace: (language: string, code: string, stdin = "") => call<import("./types").CodeTrace>("code_trace", language, code, stdin),
  // programming_practice: the weekly project pipeline (build → construct → defend → postmortem)
  ppStatus: () => call<import("./types").PpStatus>("pp_status"),
  ppInit: () => call<{ ok: boolean; area: string; created: string[] }>("pp_init"),
  ppProfile: () => call<{ weaknesses: Array<{ label: string; layer: string; count: number; status: string }>; strengths: Array<{ label: string; count: number }>; style: string[]; summary: string; suggestedFocus: string | null }>("pp_profile"),
  ppIdeas: (opts: { focus?: string; client?: string; notes?: string } = {}) =>
    call<{ ideas: import("./types").PpIdea[]; focus: string | null; conversationId: string }>("pp_ideas", opts),
  ppBuild: (req: { idea?: Partial<import("./types").PpIdea>; focus?: string; client?: string; notes?: string; week?: number }) =>
    call<{ folder: string; rel: string; conversationId: string }>("pp_build", req),
  ppPlan: (opts: { weeks?: number; notes?: string } = {}) =>
    call<{ plan: Array<import("./types").PpIdea & { week: number }>; rel: string; conversationId: string }>("pp_plan", opts),
  ppConstruct: (folder: string) => call<{ ok: boolean; rel: string }>("pp_construct", folder),
  ppDefendEstimate: (folder: string, onlyChanged = false) => call<import("./types").PpEstimate>("pp_defend_estimate", folder, onlyChanged),
  ppDefend: (folder: string, opts: { runChecks?: boolean; onlyChanged?: boolean } = {}) => call<import("./types").PpDefense>("pp_defend", folder, opts),
  ppDefendGrade: (folder: string, answers: Record<string, string>) => call<{ grade: import("./types").PpGrade; conversationId: string }>("pp_defend_grade", folder, answers),
  ppPostmortem: (folder: string) => call<import("./types").PpPostmortem>("pp_postmortem", folder),
  ppKataPostmortem: () => call<import("./types").PpPostmortem>("pp_kata_postmortem"),
  enRecordingList: () => call<{ items: import("./types").EnglishRecording[] }>("en_recording_list"),
  enRecordingUrl: (id: string) => call<{ url: string }>("en_recording_url", id),
  enRecordingRename: (id: string, name: string) => call<{ ok: boolean; id: string }>("en_recording_rename", id, name),
  enRecordingRemove: (id: string) => call<{ ok: boolean }>("en_recording_remove", id),
  enSourceTranscript: (id: string) => call<{ ok: boolean; source?: import("./types").EnglishSource }>("en_source_transcript", id),
  enSourceRemove: (id: string) => call<{ ok: boolean }>("en_source_remove", id),
  enSourceOpen: (id: string, seconds = 0) => call<import("./types").PlayerMedia & { ok: boolean; source: import("./types").EnglishSource; plain: string }>("en_source_open", id, seconds),
  enSourceSession: (id: string, kind: "dictation" | "shadowing" | "podcast" = "dictation", count = 5) =>
    call<{ ok: boolean; paths?: string[]; first?: string; count?: number; audio?: string; reason?: string; message?: string }>("en_source_session", id, kind, count),
  enPlayerOpen: (file: string, seconds = 0) => call<import("./types").PlayerMedia & { ok: boolean }>("en_player_open", file, seconds),
  enPlayerSubtitles: (id: string, track: "en" | "es") =>
    call<{ ok: boolean; pairs?: import("./player").Pair[]; en_file?: string; es_file?: string }>("en_player_subtitles", id, track),
  /** A dictation exercise from the sentence being played (ok:false + message when it cannot be made). */
  enPlayerDictation: (id: string, seconds: number, kind: "dictation" | "shadowing" | "podcast" = "dictation") =>
    call<{ ok: boolean; message?: string; reason?: string; path?: string; text?: string; from_media?: boolean }>("en_player_dictation", id, seconds, kind),
  enPlayerLink: (id: string, seconds: number) => call<{ link: string }>("en_player_link", id, seconds),
  enPlayerMine: (id: string, fields: { sentence: string; seconds: number; mode: "translate" | "cloze"; target: string; level: string; reference_es: string }) =>
    call<{ path: string; stamp: string }>("en_player_mine", id, fields),
  saveTextAs: (name: string, text: string) => call<{ ok: boolean; fallback?: boolean; path?: string }>("save_text_as", name, text),
  /** A review notification was clicked: open the Repaso calendar. */
  onOpenReview: (cb: () => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onOpenReview) return window.nv.onOpenReview(cb);
    return () => undefined;
  },
  captureStart: (folder: string) => call<{ ok: boolean }>("capture_start", folder),
  onCaptureRequest: (cb: () => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onCaptureRequest) return window.nv.onCaptureRequest(cb);
    return () => undefined;
  },
  onCaptureDone: (cb: (data: { rel: string; name: string }) => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onCaptureDone) return window.nv.onCaptureDone(cb);
    return () => undefined;
  },
  /** El contenido de la vault cambió fuera de la app: las cachés ya se limpiaron; la interfaz solo vuelve a leer. */
  onVaultContentChanged: (cb: () => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onVaultContentChanged) return window.nv.onVaultContentChanged(cb);
    return () => undefined;
  },
  onWatchEvent: (cb: (data: { eventType: string; relPath: string; fullPath: string }) => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onWatchEvent) {
      return window.nv.onWatchEvent(cb);
    }
    return () => {};
  },
  browserAttach: (bounds: BrowserBounds, url?: string) => call<BrowserState>("browser_attach", bounds, url),
  browserDetach: () => call<{ ok: boolean }>("browser_detach"),
  browserSetBounds: (bounds: BrowserBounds) => call<{ ok: boolean }>("browser_set_bounds", bounds),
  browserNavigate: (url: string) => call<BrowserState>("browser_navigate", url),
  browserAction: (action: "back" | "forward" | "reload" | "stop") => call<BrowserState>("browser_action", action),
  browserState: () => call<BrowserState>("browser_state"),
  browserDestroy: () => call<{ ok: boolean }>("browser_destroy"),
  onBrowserState: (cb: (state: BrowserState) => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onBrowserState) {
      return window.nv.onBrowserState(cb);
    }
    return () => {};
  },

  // ── Window controls (the app draws its own title bar) ────────────────
  windowMinimize: () => call<{ maximized: boolean }>("window_minimize"),
  windowToggleMaximize: () => call<{ maximized: boolean }>("window_toggle_maximize"),
  windowClose: () => call<{ ok: boolean }>("window_close"),
  windowState: () => call<{ maximized: boolean }>("window_state"),
  onWindowState: (cb: (state: { maximized: boolean }) => void): (() => void) => {
    if (typeof window !== "undefined" && window.nv?.onWindowState) {
      return window.nv.onWindowState(cb);
    }
    return () => {};
  },

  // ── Alimentación / Nutrición ──────────────────────────────────────────────
  nutriDay: (date: string) => call<import("./nutritionTypes").NutriDayLog>("nutri_day", date),
  nutriDaySummary: (date: string) => call<import("./nutritionTypes").NutriDaySummary>("nutri_day_summary", date),
  nutriItemAdd: (date: string, meal: import("./nutritionTypes").NutriMealType, item: Partial<import("./nutritionTypes").NutriFoodItem>) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_item_add", date, meal, item),
  nutriItemUpdate: (date: string, meal: import("./nutritionTypes").NutriMealType, itemId: string, updates: Partial<import("./nutritionTypes").NutriFoodItem>) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_item_update", date, meal, itemId, updates),
  nutriItemDelete: (date: string, meal: import("./nutritionTypes").NutriMealType, itemId: string) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_item_delete", date, meal, itemId),
  nutriWaterSet: (date: string, ml: number) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_water_set", date, ml),
  nutriNotesSet: (date: string, notes: string) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_notes_set", date, notes),
  nutriMealCopy: (fromDate: string, toDate: string, meal: import("./nutritionTypes").NutriMealType) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_meal_copy", fromDate, toDate, meal),
  nutriDayCopy: (fromDate: string, toDate: string) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_day_copy", fromDate, toDate),
  nutriTrends: (days = 7, endDate?: string) =>
    call<import("./nutritionTypes").NutriTrendsData>("nutri_trends", days, endDate),
  nutriFoodsList: () =>
    call<{ foods: import("./nutritionTypes").NutriFoodLibraryEntry[] }>("nutri_foods_list"),
  nutriFoodSave: (entry: Partial<import("./nutritionTypes").NutriFoodLibraryEntry>) =>
    call<import("./nutritionTypes").NutriFoodLibraryEntry>("nutri_food_save", entry),
  nutriFoodDelete: (id: string) =>
    call<{ ok: boolean }>("nutri_food_delete", id),
  // Recetas
  nutriRecipesList: () =>
    call<{ recipes: import("./nutritionTypes").NutriRecipe[] }>("nutri_recipes_list"),
  nutriRecipeSave: (entry: Partial<import("./nutritionTypes").NutriRecipe>) =>
    call<import("./nutritionTypes").NutriRecipe>("nutri_recipe_save", entry),
  nutriRecipeDelete: (id: string) =>
    call<{ ok: boolean }>("nutri_recipe_delete", id),
  nutriRecipeConsume: (date: string, meal: string, recipeId: string, servings = 1) =>
    call<import("./nutritionTypes").NutriDaySummary>("nutri_recipe_consume", date, meal, recipeId, servings),
  nutriReportGenerate: (days = 7, endDate?: string) =>
    call<{
      markdown: string;
      csv: { header: string[]; rows: (string | number)[][] };
      trends: import("./nutritionTypes").NutriTrendsData;
    }>("nutri_report_generate", days, endDate),
  nutriSettingsGet: () =>
    call<import("./nutritionTypes").NutriTargets>("nutri_settings_get"),
  nutriSettingsSave: (settings: Partial<import("./nutritionTypes").NutriTargets>) =>
    call<import("./nutritionTypes").NutriTargets>("nutri_settings_save", settings),
  nutriSuggestTargets: () =>
    call<{
      suggested: import("./nutritionTypes").NutriTargets;
      profileData: { weight: number; goal: string; gender: string; age: number };
    }>("nutri_suggest_targets"),
  nutriProfileGet: () =>
    call<import("./nutritionTypes").NutriProfile>("nutri_profile_get"),
  nutriProfileSave: (fields: Partial<import("./nutritionTypes").NutriProfile>) =>
    call<import("./nutritionTypes").NutriProfile>("nutri_profile_save", fields),
  // Coach Nutricional IA
  nutriCoachContext: () =>
    call<{
      date: string;
      caloriesRemaining: number;
      targetCalories: number;
      consumedCalories: number;
      consumedProtein: number;
      targetProtein: number;
      consumedWater: number;
      targetWater: number;
      goal: string;
      weight: number | null;
      foodsCount: number;
    }>("nutri_coach_context"),
  nutriCoachChatStream: (answerId: string, history: Array<{ role: string; content: string }>, question: string) =>
    call<{ streaming?: boolean; id?: string; bridge?: boolean; url?: string; prompt?: string; label?: string }>(
      "nutri_coach_chat_stream", answerId, history, question,
    ),
  nutriCoachChatCancel: (id: string) =>
    call<{ ok: boolean }>("nutri_coach_chat_cancel", id),
  nutriCoachConversations: () =>
    call<import("./types").ConversationMeta[]>("nutri_coach_conversations"),
  nutriCoachConversationGet: (id: string) =>
    call<import("./types").Conversation | null>("nutri_coach_conversation_get", id),
  nutriCoachConversationSave: (id: string | null, messages: unknown, model?: string, title?: string) =>
    call<import("./types").Conversation>("nutri_coach_conversation_save", id, messages, model, title),
  nutriCoachConversationRename: (id: string, title: string) =>
    call<{ ok: boolean; title: string }>("nutri_coach_conversation_rename", id, title),
  nutriCoachConversationDelete: (id: string) =>
    call<{ ok: boolean }>("nutri_coach_conversation_delete", id),
  nutriCoachAiTitle: (id: string, question: string, answer: string) =>
    call<{ title: string }>("nutri_coach_ai_title", id, question, answer),
  nutriEstimateDish: (description: string) =>
    call<import("./nutritionTypes").EstimatedDishResult>("nutri_estimate_dish", description),
  nutriScanLabel: (dataUrl: string) =>
    call<import("./nutritionTypes").ScannedNutritionLabel>("nutri_scan_label", dataUrl),
};

/**
 * True when the UI runs inside the Electron shell, the only host that has a
 * window of its own to minimise/maximise/close (pywebview and the dev bridge
 * bring their own chrome).
 */
export const isElectron = (): boolean =>
  typeof window !== "undefined" && Boolean(window.nv);
