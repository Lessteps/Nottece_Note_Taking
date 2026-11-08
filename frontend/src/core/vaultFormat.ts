/**
 * The single place that names the vault file format.
 * Ported from notevault_app/core/vault_format.py.
 *
 * docs/VAULT_FORMAT.md is the human contract; this module is the machine one.
 */

export const FORMAT_VERSION = 4;

export const DATA_DIR = ".notevault";

export const RESERVED_DIRS = [DATA_DIR] as const;

export const LEGACY_DIRS = ["habits", "ejercicio", "tareas", "proyectos"] as const;

export const BOOKMARKS_FILE = ".notevault-bookmarks.json";

export const LAYOUT = {
  data_dir: DATA_DIR,
  habits_dir: `${DATA_DIR}/habits`,
  habits_config: `${DATA_DIR}/habits/habits_config.json`,
  habits_day: `${DATA_DIR}/habits/{year}/{month:02d}/{date}.md`,
  exercise_dir: `${DATA_DIR}/ejercicio`,
  exercise_profile: `${DATA_DIR}/ejercicio/perfil.json`,
  exercises: `${DATA_DIR}/ejercicio/exercises.json`,
  library: `${DATA_DIR}/ejercicio/biblioteca.json`,
  favorites: `${DATA_DIR}/ejercicio/biblioteca-favoritos.json`,
  exercise_day: `${DATA_DIR}/ejercicio/{year}/{month:02d}/{date}.json`,
  exercise_videos_dir: `${DATA_DIR}/ejercicio/videos`,
  tasks_dir: `${DATA_DIR}/tareas`,
  task: `${DATA_DIR}/tareas/{id}.md`,
  projects_dir: `${DATA_DIR}/proyectos`,
  project: `${DATA_DIR}/proyectos/{id}/{id}.md`,
  project_issues_dir: `${DATA_DIR}/proyectos/{id}/issues`,
  issue: `${DATA_DIR}/proyectos/{project}/issues/{id}.md`,
  project_v3: `${DATA_DIR}/proyectos/{id}.md`,
  bookmarks: BOOKMARKS_FILE,
  trash_dir: `${DATA_DIR}/.papelera`,
  areas_dir: `${DATA_DIR}/areas`,
  area: `${DATA_DIR}/areas/{id}.json`,
  goals_dir: `${DATA_DIR}/metas`,
  goal: `${DATA_DIR}/metas/{id}/goal.md`,
  goal_items_dir: `${DATA_DIR}/metas/{id}/items`,
  goal_item: `${DATA_DIR}/metas/{goal}/items/{id}.md`,
  goal_log_day: `${DATA_DIR}/metas/registro/{year}/{month:02d}/{date}.json`,
  finance_dir: `${DATA_DIR}/finanzas`,
  finance_category: `${DATA_DIR}/finanzas/categorias/{id}.json`,
  finance_goal: `${DATA_DIR}/finanzas/metas/{id}.json`,
  finance_day: `${DATA_DIR}/finanzas/{year}/{month:02d}/{date}.json`,
  finance_attachments: `${DATA_DIR}/finanzas/adjuntos/{year}/{month:02d}`,
  finance_recurring: `${DATA_DIR}/finanzas/recurrentes.json`,
  finance_rules: `${DATA_DIR}/finanzas/reglas.json`,
  finance_settings: `${DATA_DIR}/finanzas/ajustes.json`,
  nutrition_dir: `${DATA_DIR}/alimentacion`,
  nutrition_profile: `${DATA_DIR}/alimentacion/perfil.json`,
  nutrition_settings: `${DATA_DIR}/alimentacion/ajustes.json`,
  nutrition_foods: `${DATA_DIR}/alimentacion/alimentos.json`,
  nutrition_recipes: `${DATA_DIR}/alimentacion/recetas.json`,
  nutrition_day: `${DATA_DIR}/alimentacion/{year}/{month:02d}/{date}.json`,
  agenda_dir: `${DATA_DIR}/agenda`,
  agenda_routines: `${DATA_DIR}/agenda/routines.json`,
  agenda_events_dir: `${DATA_DIR}/agenda/events`,
  agenda_events_day: `${DATA_DIR}/agenda/events/{year}/{month:02d}/{date}.json`,
  agenda_settings: `${DATA_DIR}/agenda/settings.json`,
  workspaces_dir: `${DATA_DIR}/workspaces`,
  workspace: `${DATA_DIR}/workspaces/{id}.json`,
  study_dir: `${DATA_DIR}/estudio`,
  study_exercises_dir: `${DATA_DIR}/estudio/ejercicios`,
  study_exercise: `${DATA_DIR}/estudio/ejercicios/{id}.json`,
  study_srs_dir: `${DATA_DIR}/estudio/srs`,
  study_srs_item: `${DATA_DIR}/estudio/srs/{id}.json`,
  study_errors_dir: `${DATA_DIR}/estudio/errores`,
  study_error: `${DATA_DIR}/estudio/errores/{id}.json`,
  study_goals_dir: `${DATA_DIR}/estudio/metas`,
  study_goal: `${DATA_DIR}/estudio/metas/{id}.json`,
  study_projects_dir: `${DATA_DIR}/estudio/proyectos`,
  study_project: `${DATA_DIR}/estudio/proyectos/{id}.json`,
  study_attempts_dir: `${DATA_DIR}/estudio/intentos`,
  study_attempt: `${DATA_DIR}/estudio/intentos/{id}.json`,
  study_error_digest: `${DATA_DIR}/estudio/errores/ERROR_LOG.md`,
  study_handoff_dir: `${DATA_DIR}/estudio/handoff`,
  study_handoff_request: `${DATA_DIR}/estudio/handoff/requests/{id}.json`,
  study_handoff_response: `${DATA_DIR}/estudio/handoff/responses/{id}.json`,
  study_ledger_dir: `${DATA_DIR}/estudio/ledger`,
  study_ledger: `${DATA_DIR}/estudio/ledger/{id}.json`,
  study_exams_dir: `${DATA_DIR}/estudio/exams`,
  study_exam: `${DATA_DIR}/estudio/exams/{id}.json`,
  study_pp_dir: `${DATA_DIR}/estudio/pp`,
  study_pp_profile: `${DATA_DIR}/estudio/pp/profile.json`,
  kb_canvas_manifest: `${DATA_DIR}/estudio/kb_canvas_manifest.json`,
  mentor_dir: `${DATA_DIR}/mentor`,
  mentor_sessions_dir: `${DATA_DIR}/mentor/sessions`,
  mentor_session: `${DATA_DIR}/mentor/sessions/{date}.json`,
  mentor_chat: `${DATA_DIR}/mentor/chat.json`,
  mentor_chats_dir: `${DATA_DIR}/mentor/chats`,
  mentor_chat_file: `${DATA_DIR}/mentor/chats/{id}.json`,
  mentor_chats_index: `${DATA_DIR}/mentor/chats/index.json`,
  mentor_plans_dir: `${DATA_DIR}/mentor/plans`,
  mentor_plan: `${DATA_DIR}/mentor/plans/{id}.json`,
  mentor_plan_builds_dir: `${DATA_DIR}/mentor/plans/_building`,
  mentor_plan_build: `${DATA_DIR}/mentor/plans/_building/{id}.json`,
  mentor_plan_history_dir: `${DATA_DIR}/mentor/plans/_history/{id}`,
  mentor_plan_history: `${DATA_DIR}/mentor/plans/_history/{id}/{n}.json`,
  web_dir: `${DATA_DIR}/web`,
  web_bookmarks: `${DATA_DIR}/web/marcadores.json`,
  web_restrictions: `${DATA_DIR}/web/restricciones.json`,
  web_history_day: `${DATA_DIR}/web/historial/{year}/{month:02d}/{date}.json`,
  web_usage_day: `${DATA_DIR}/web/uso/{year}/{month:02d}/{date}.json`,
} as const;

export type LayoutKey = keyof typeof LAYOUT;

/** Format a layout template like "{DATA_DIR}/habits/{year}/{month:02d}/{date}.md". */
export function formatLayout(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)(?::(\d+)d)?\}/g, (_, key, width) => {
    const val = vars[key];
    if (val === undefined) return `{${key}}`;
    if (width) {
      return String(val).padStart(Number(width), "0");
    }
    return String(val);
  });
}

// 0 = Monday, matching datetime.date.weekday().
export const WEEKDAY_KEYS = [
  "lunes", "martes", "miercoles", "jueves",
  "viernes", "sabado", "domingo",
] as const;

export const DATE_FMT = "%Y-%m-%d";
export const DATETIME_FMT = "%Y-%m-%dT%H:%M";

// Enumerations a client must accept verbatim.
export const TASK_STATUSES = ["Sin empezar", "En progreso", "Completado", "Bloqueado"] as const;
export const PROJECT_STATUSES = ["Planeado", "En curso", "Pausado", "Terminado"] as const;
export const PRIORITY_RANGE = [1, 3] as const;

// Frontmatter keys, per entity.
export const TASK_KEYS = [
  "id", "name", "created", "start", "due", "status", "subject",
  "priority", "reminder", "reminder_done",
] as const;

export const PROJECT_KEYS = [
  "id", "name", "status", "color", "created", "start", "deadline",
] as const;

export const TASK_OPTIONAL_KEYS = ["repeat", "repeat_until"] as const;
export const HABIT_OPTIONAL_KEYS = [
  "repeat", "start_date", "end_date", "paused_from", "time",
  "duration_min", "in_calendar", "reminder_min", "colour", "notes",
  "area", "exercise_schedules",
] as const;

export const RECURRENCE_KINDS = ["daily", "weekly", "every", "monthly"] as const;

export const PRIORITIES = ["Baja", "Media", "Alta", "Urgente"] as const;
export const PRIORITY_RANGE_V4 = [1, 4] as const;

export const AREA_KEYS = ["id", "name", "icon", "colour", "order", "archived"] as const;

export const GOAL_STATUSES = ["Activa", "En pausa", "Completada", "Archivada"] as const;
export const GOAL_ITEM_STATUSES = ["Pendiente", "En curso", "Hecha"] as const;

export type FieldType = "id" | "str" | "int" | "num" | "bool" | "bool0" | "date" | "datetime" | "list";
export type FieldDef = readonly [string, FieldType];

export const GOAL_FIELDS: readonly FieldDef[] = [
  ["id", "id"], ["name", "str"], ["area", "id"], ["status", "str"],
  ["priority", "int"], ["start", "date"], ["end", "date"], ["icon", "str"],
  ["colour", "str"], ["in_overview", "bool"], ["order", "num"], ["created", "date"],
] as const;

export const GOAL_ITEM_FIELDS: readonly FieldDef[] = [
  ["id", "id"], ["goal", "id"], ["parent", "id"], ["name", "str"],
  ["status", "str"], ["priority", "int"], ["order", "num"], ["start", "date"],
  ["due", "date"], ["due_time", "str"], ["duration_min", "int"],
  ["repeat", "str"], ["repeat_until", "date"], ["in_calendar", "bool"],
  ["reminder_min", "int"], ["target", "num"], ["unit", "str"], ["value", "num"],
  ["habit_links", "list"], ["done_at", "date"], ["created", "date"],
  // Opcional y aditivo (se omite si está vacío): temas de estudio que cumplen la submeta.
  ["topic_links", "list"],
  // Opcional y aditivo (se omite si está vacío): enlaces al sistema Programming practice (kata diario, proyectos).
  ["practice_links", "list"],
] as const;

export const PROJECT_V4_STATUSES = PROJECT_STATUSES;
export const DEFAULT_COLUMNS = ["Por hacer", "En curso", "En revisión", "Hecho"] as const;
export const ISSUE_TYPES = ["Submeta", "Tarea", "Subtarea", "Error", "Mejora"] as const;

export const PROJECT_FIELDS: readonly FieldDef[] = [
  ["id", "id"], ["key", "id"], ["name", "str"], ["status", "str"],
  ["area", "id"], ["colour", "str"], ["icon", "str"], ["created", "date"],
  ["start", "date"], ["deadline", "date"], ["columns", "list"],
  ["done_column", "str"], ["in_calendar", "bool"],
] as const;

export const ISSUE_FIELDS: readonly FieldDef[] = [
  ["id", "id"], ["number", "int"], ["type", "str"], ["parent", "id"],
  ["title", "str"], ["status", "str"], ["priority", "int"], ["order", "num"],
  ["estimate_min", "int"], ["labels", "list"], ["created", "date"],
  ["start", "date"], ["due", "date"], ["due_time", "str"], ["repeat", "str"],
  ["repeat_until", "date"], ["in_calendar", "bool"], ["reminder", "datetime"],
  ["reminder_done", "bool"], ["done_at", "date"], ["attachments", "list"],
  ["updated", "datetime"],
] as const;

export const MOVEMENT_TYPES = ["gasto", "ingreso", "ahorro", "retiro"] as const;
export const FINANCE_GOAL_STATUSES = ["Activa", "En pausa", "Cumplida"] as const;

export const CATEGORY_KEYS = [
  "id", "name", "icon", "colour", "kind", "budget_month_cents",
  "order", "archived",
] as const;

export const FINANCE_GOAL_KEYS = [
  "id", "name", "icon", "colour", "target_cents", "currency",
  "start", "deadline", "show_in_daily", "cadence",
  "suggested_cents", "status", "created", "notes",
] as const;

export const MOVEMENT_KEYS = [
  "id", "type", "amount_cents", "currency", "category", "goal",
  "what", "reason", "time", "attachments", "created",
] as const;

export const DEFAULT_CURRENCY = "USD";

export const ATTACHMENT_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".pdf"] as const;

export const SYNC_CONFLICT_MARKER = ".sync-conflict-";

export function isSyncConflict(name: string): boolean {
  return String(name).includes(SYNC_CONFLICT_MARKER);
}
