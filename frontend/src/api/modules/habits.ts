import { ApiError } from "../../core/errors.js";
import {
  addDays,
  parseIsoDate,
  todayIso,
  weekday,
} from "../../core/dates.js";
import {
  HabitConfig,
  HabitDay,
  HabitManager,
  habitActiveOn,
  habitScheduleText,
  OPTIONAL_KEYS,
} from "../../core/habitManager.js";
import { Recurrence } from "../../core/recurrence.js";
import type { AppState } from "../appState.js";
import {
  clampInt,
  isoDate,
  oneLine,
  optDate,
  optTime,
} from "../common.js";

export const MAX_RANGE_DAYS = 400;
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

function habitOut(h: HabitConfig): Record<string, unknown> {
  const allowed = new Set([
    "id",
    "name",
    "icon",
    "days",
    "subtasks",
    ...(OPTIONAL_KEYS as readonly string[]),
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) {
    if (allowed.has(k)) {
      out[k] = v;
    }
  }
  out.schedule = habitScheduleText(h);
  return out;
}

function habitFields(fields: unknown): {
  core: Record<string, any>;
  opts: Record<string, any>;
} {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new ApiError("Datos de hábito inválidos.");
  }
  const f = fields as Record<string, any>;
  const core: Record<string, any> = {};
  const opts: Record<string, any> = {};

  if ("name" in f) {
    core.name = oneLine(f.name, 120) || "Nuevo hábito";
  }
  if ("icon" in f) {
    core.icon = oneLine(f.icon, 8);
  }
  if ("days" in f) {
    const rawDays = Array.isArray(f.days) ? f.days : [];
    const days = Array.from(
      new Set(rawDays.map((d: unknown) => clampInt(d, 0, 6, 0)))
    ).sort((a, b) => a - b);
    core.days = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  }
  if ("repeat" in f) {
    opts.repeat = Recurrence.parse(oneLine(f.repeat, 60)).toString();
  }
  for (const key of ["start_date", "end_date", "paused_from"]) {
    if (key in f) {
      const d = optDate(f[key]);
      opts[key] = d ? isoDate(d) : null;
    }
  }
  if ("time" in f) {
    opts.time = optTime(f.time);
  }
  for (const [key, hi] of [
    ["duration_min", 24 * 60],
    ["reminder_min", 24 * 60],
  ] as const) {
    if (key in f) {
      opts[key] =
        f[key] === null || f[key] === undefined || f[key] === ""
          ? null
          : clampInt(f[key], 0, hi, 0);
    }
  }
  if ("in_calendar" in f) {
    opts.in_calendar = Boolean(f.in_calendar);
  }
  if ("colour" in f) {
    const c = oneLine(f.colour, 7);
    if (c && !COLOUR_RE.test(c)) {
      throw new ApiError("Color inválido.");
    }
    opts.colour = c || null;
  }
  if ("notes" in f) {
    opts.notes = oneLine(f.notes, 500) || null;
  }
  if ("area" in f) {
    opts.area = oneLine(f.area, 80) || null;
  }
  if ("exercise_schedules" in f) {
    if (f.exercise_schedules && typeof f.exercise_schedules === "object" && !Array.isArray(f.exercise_schedules)) {
      opts.exercise_schedules = f.exercise_schedules;
    } else {
      opts.exercise_schedules = null;
    }
  }
  return { core, opts };
}

function needHabit(mgr: HabitManager, habitId: unknown): HabitConfig {
  const h = mgr.getHabit(String(habitId));
  if (h === null) {
    throw new ApiError("Ese hábito ya no existe.");
  }
  return h;
}

export function habitsApi(app: AppState) {
  const mgr = () => app.mgrs().habits;

  return {
    habits_list() {
      return mgr()
        .habits()
        .map((h) => habitOut(h));
    },

    habits_range(first: string, last: string) {
      const a = optDate(first);
      const b = optDate(last);
      if (!a || !b || b < a) {
        throw new ApiError("Rango de fechas inválido.");
      }
      const diffDays = Math.round(
        (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)
      );
      if (diffDays > MAX_RANGE_DAYS) {
        throw new ApiError("El rango es demasiado largo.");
      }
      const m = mgr();
      const habits = m.habits();
      const out: Array<Record<string, unknown>> = [];
      let curr = new Date(a);
      while (curr <= b) {
        const iso = todayIso(curr);
        const day = m.getDay(curr);
        const active = habits
          .filter((h) => habitActiveOn(h, curr))
          .map((h) => h.id);
        const done = active.filter((hid) => Boolean(day.completed[hid]));
        out.push({
          date: iso,
          active,
          done,
          pct: active.length ? done.length / active.length : 0.0,
        });
        curr = addDays(curr, 1);
      }
      return out;
    },

    habits_day(day: string) {
      const d = optDate(day);
      if (!d) {
        throw new ApiError("Fecha inválida.");
      }
      const m = mgr();
      const hd = m.getDay(d);
      const compOut: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(hd.completed)) {
        compOut[k] = Boolean(v);
      }
      return {
        date: todayIso(d),
        active: m
          .habits()
          .filter((h) => habitActiveOn(h, d))
          .map((h) => h.id),
        completed: compOut,
        subtasks: hd.subtasks,
        notes: hd.notes,
        journal: hd.journal,
      };
    },

    habits_stats(ref = "") {
      const raw = optDate(ref);
      const today = raw
        ? new Date(raw.getFullYear(), raw.getMonth(), raw.getDate())
        : parseIsoDate(todayIso())!;
      const todayIsoStr = todayIso(today);
      const m = mgr();
      const habits = m.habits();
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const dayOfWeek = weekday(today);
      const weekStart = addDays(today, -dayOfWeek);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const days: HabitDay[] = [];
      let d = new Date(yearStart);
      while (d <= today) {
        days.push(m.getDay(d));
        d = addDays(d, 1);
      }

      function overall(since: Date): number {
        const sinceIso = todayIso(since);
        const sel = days.filter((x) => x.date >= sinceIso);
        const vals = sel
          .filter((x) => x.activeHabits(habits).length > 0)
          .map((x) => x.completionPct(habits));
        return vals.length
          ? vals.reduce((acc, v) => acc + v, 0) / vals.length
          : 0.0;
      }

      function perHabit(h: HabitConfig, since: Date): number | null {
        const sinceIso = todayIso(since);
        const sel = days.filter(
          (x) => x.date >= sinceIso && habitActiveOn(h, x.date)
        );
        if (sel.length === 0) return null;
        const doneCount = sel.filter((x) => Boolean(x.completed[h.id])).length;
        return doneCount / sel.length;
      }

      let streak = 0;
      let curr = new Date(today);
      while (curr.getFullYear() === today.getFullYear() && m.dayPct(curr) > 0) {
        streak += 1;
        curr = addDays(curr, -1);
      }

      const habitsStats: Record<string, Record<string, number | null>> = {};
      for (const h of habits) {
        const isDueToday = habitActiveOn(h, today);
        const dayVal = isDueToday
          ? m.getDay(today).completed[h.id]
            ? 1.0
            : 0.0
          : null;
        habitsStats[h.id] = {
          day: dayVal,
          week: perHabit(h, weekStart),
          month: perHabit(h, monthStart),
          year: perHabit(h, yearStart),
        };
      }

      return {
        today: todayIsoStr,
        day: m.dayPct(today),
        week: overall(weekStart),
        month: overall(monthStart),
        year: overall(yearStart),
        streak,
        habits: habitsStats,
      };
    },

    habits_set_done(day: string, habitId: string, done: boolean) {
      const d = optDate(day);
      if (!d) {
        throw new ApiError("Fecha inválida.");
      }
      const m = mgr();
      needHabit(m, habitId);
      m.setDone(d, String(habitId), Boolean(done));
      return { ok: true, pct: m.dayPct(d) };
    },

    habits_set_subtask(
      day: string,
      habitId: string,
      subtaskId: string,
      done: boolean
    ) {
      const d = optDate(day);
      if (!d) {
        throw new ApiError("Fecha inválida.");
      }
      const m = mgr();
      const h = needHabit(m, habitId);
      if (!h.subtasks?.some((s) => s.id === subtaskId)) {
        throw new ApiError("Esa subtarea ya no existe.");
      }
      const hd = m.getDay(d);
      hd.setSubtask(h.id, String(subtaskId), Boolean(done));
      m.saveDay(hd);
      return { ok: true };
    },

    habits_set_day_text(day: string, notes = "", journal = "") {
      const d = optDate(day);
      if (!d) {
        throw new ApiError("Fecha inválida.");
      }
      const m = mgr();
      const hd = m.getDay(d);
      hd.notes = oneLine(notes, 500).replace(/"/g, "'");
      const text =
        journal === null || journal === undefined ? "" : String(journal);
      if (Buffer.byteLength(text, "utf-8") > 1024 * 1024) {
        throw new ApiError("El diario es demasiado largo.");
      }
      hd.journal = text
        .split(/\r?\n/)
        .map((ln) => (ln.trim() === "---" ? "—" : ln))
        .join("\n");
      m.saveDay(hd);
      return { ok: true };
    },

    habits_add(fields?: unknown) {
      const { core, opts } = habitFields(fields || {});
      const m = mgr();
      const h = m.addHabit(
        core.name || "Nuevo hábito",
        core.icon || "✓",
        core.days,
        opts
      );
      return habitOut(h);
    },

    habits_update(habitId: string, fields: unknown) {
      const m = mgr();
      needHabit(m, habitId);
      const { core, opts } = habitFields(fields);
      m.updateHabit(String(habitId), { ...core, ...opts });
      return habitOut(needHabit(m, habitId));
    },

    habits_remove(habitId: string) {
      const m = mgr();
      needHabit(m, habitId);
      m.removeHabit(String(habitId));
      return { ok: true };
    },

    habits_reorder(ids: unknown[]) {
      const m = mgr();
      const habits = m.habits();
      const order = new Map<string, number>();
      for (let n = 0; n < (ids || []).length; n++) {
        order.set(String(ids[n]), n);
      }
      const habitIds = new Set(habits.map((h) => h.id));
      if (
        order.size !== habitIds.size ||
        Array.from(order.keys()).some((id) => !habitIds.has(id))
      ) {
        throw new ApiError("El orden no coincide con los hábitos.");
      }
      m._habits = [...habits].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      );
      m.saveConfig();
      return { ok: true };
    },

    habits_add_subtask(habitId: string, name: string) {
      const m = mgr();
      needHabit(m, habitId);
      const clean = oneLine(name, 120);
      if (!clean) {
        throw new ApiError("La subtarea necesita un nombre.");
      }
      return m.addSubtask(String(habitId), clean) || {};
    },

    habits_remove_subtask(habitId: string, subtaskId: string) {
      const m = mgr();
      needHabit(m, habitId);
      m.removeSubtask(String(habitId), String(subtaskId));
      return { ok: true };
    },
  };
}
