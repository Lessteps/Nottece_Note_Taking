/**
 * NoteVault Schedule Manager.
 *
 * Data layer for the Calendario (time & scheduling) module.
 * Handles routines, day events, per-day overrides, calendar settings,
 * and merges derived occurrences from habits, exercise, tasks, and projects.
 * Ported from notevault_app/core/schedule_manager.py.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { addDays, todayIso, weekday } from "./dates";
import { ExerciseManager } from "./exerciseManager";
import { HabitManager } from "./habitManager";
import { ProjectManager } from "./projectManager";
import { parseDate, Recurrence } from "./recurrence";
import {
  DEFAULT_SETTINGS,
  dumpJson,
  loadJson,
  Occurrence,
  sanitizeDayFile,
  sanitizeEvent,
  sanitizeRoutine,
  sanitizeSettings,
} from "./scheduleFormat";
import { STATUS_DONE as TASK_DONE, STATUS_TODO as TASK_TODO, TaskManager } from "./taskManager";
import { formatLayout, LAYOUT, WEEKDAY_KEYS } from "./vaultFormat";

export { Occurrence };

export const HABIT_PREFIX = "habit:";

function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function routineOn(routine: Record<string, any>, d: Date): boolean {
  let rule = Recurrence.parse(routine.repeat);
  if (!rule.repeats) {
    const days = Array.isArray(routine.days)
      ? routine.days
          .map((k: string) => WEEKDAY_KEYS.indexOf(k as any))
          .filter((idx: number) => idx >= 0)
      : [];
    rule = Recurrence.fromWeekdays(days);
    if (!rule.repeats) return false;
  }
  return rule.occursOn(
    d,
    parseDate(routine.active_from),
    parseDate(routine.active_until),
  );
}
export const routine_on = routineOn;

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  const isAllDayA = a.start === null ? 0 : 1;
  const isAllDayB = b.start === null ? 0 : 1;
  if (isAllDayA !== isAllDayB) return isAllDayA - isAllDayB;
  const startA = a.start || "";
  const startB = b.start || "";
  if (startA !== startB) return startA.localeCompare(startB);
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
}

function reminder(item: Record<string, any>): number | null {
  const value = item.reminder_min;
  return typeof value === "number" && !isNaN(value) && value >= 0 ? value : null;
}

export class ScheduleManager {
  vaultRoot: string;
  agendaDir: string;
  agendaRoutines: string;
  agendaEventsDir: string;
  agendaSettings: string;

  habitMgr: HabitManager;
  exerciseMgr: ExerciseManager;
  taskMgr: TaskManager;
  projectMgr: ProjectManager;

  private _routinesCache: Record<string, any>[] | null = null;
  private _routinesMtime = 0;

  private _settingsCache: Record<string, any> | null = null;
  private _settingsMtime = 0;

  private _dayFilesCache = new Map<string, [number, Record<string, any>]>();
  private _sources = new Map<string, any>();

  constructor(
    vaultRoot: string,
    habitMgr?: HabitManager | null,
    exerciseMgr?: ExerciseManager | null,
    taskMgr?: TaskManager | null,
    projectMgr?: ProjectManager | null,
  ) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.agendaDir = path.join(this.vaultRoot, LAYOUT.agenda_dir);
    this.agendaRoutines = path.join(this.vaultRoot, LAYOUT.agenda_routines);
    this.agendaEventsDir = path.join(this.vaultRoot, LAYOUT.agenda_events_dir);
    this.agendaSettings = path.join(this.vaultRoot, LAYOUT.agenda_settings);

    this.habitMgr = habitMgr || new HabitManager(this.vaultRoot);
    this.exerciseMgr = exerciseMgr || new ExerciseManager(this.vaultRoot);
    this.taskMgr = taskMgr || new TaskManager(this.vaultRoot);
    this.projectMgr = projectMgr || new ProjectManager(this.vaultRoot);
  }

  // ── External sources ──────────────────────────────────────────────────

  register_source(name: string, provider: any): void {
    this._sources.set(name, provider);
  }
  registerSource(name: string, provider: any): void {
    this.register_source(name, provider);
  }

  unregister_source(name: string): void {
    this._sources.delete(name);
  }
  unregisterSource(name: string): void {
    this.unregister_source(name);
  }

  sources(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of this._sources.entries()) {
      out[k] = v;
    }
    return out;
  }

  private _sourceFor(occurrenceId: string): any {
    for (const provider of this._sources.values()) {
      const prefixes = provider.prefixes;
      if (Array.isArray(prefixes) && prefixes.some((p: string) => occurrenceId.startsWith(p))) {
        return provider;
      }
      const prefix = provider.prefix;
      if (Array.isArray(prefix)) {
        if (prefix.some((p: string) => occurrenceId.startsWith(p))) {
          return provider;
        }
      } else if (prefix && typeof prefix === "string" && occurrenceId.startsWith(prefix)) {
        return provider;
      }
    }
    return null;
  }

  private _external(first: Date, last: Date): Record<string, Occurrence[]> {
    const merged: Record<string, Occurrence[]> = {};
    for (const [name, provider] of this._sources.entries()) {
      try {
        const found = provider.occurrences(first, last) || {};
        for (const [key, occs] of Object.entries(found)) {
          if (Array.isArray(occs)) {
            merged[key] = merged[key] || [];
            merged[key].push(...(occs as Occurrence[]));
          }
        }
      } catch (err) {
        console.error(`Calendar source ${name} failed:`, err);
      }
    }
    return merged;
  }

  // ── Routines ──────────────────────────────────────────────────────────

  routines(): Record<string, any>[] {
    if (!fs.existsSync(this.agendaRoutines)) {
      return [];
    }
    let mtime = 0;
    try {
      mtime = fs.statSync(this.agendaRoutines).mtimeMs;
    } catch {
      return [];
    }

    if (this._routinesCache === null || mtime !== this._routinesMtime) {
      const data = loadJson<any[]>(this.agendaRoutines);
      if (Array.isArray(data)) {
        this._routinesCache = data
          .filter((r) => r && typeof r === "object")
          .map((r) => sanitizeRoutine(r));
      } else {
        this._routinesCache = [];
      }
      this._routinesMtime = mtime;
    }
    return [...this._routinesCache];
  }

  private _saveRoutines(routinesList: Record<string, any>[]): void {
    fs.mkdirSync(this.agendaDir, { recursive: true });
    const sanitized = routinesList.map((r) => sanitizeRoutine(r));
    const text = dumpJson(sanitized);
    fs.writeFileSync(this.agendaRoutines, text, "utf-8");
    this._routinesCache = sanitized;
    try {
      this._routinesMtime = fs.statSync(this.agendaRoutines).mtimeMs;
    } catch {
      this._routinesMtime = 0;
    }
  }

  add_routine(fields: Record<string, any>): Record<string, any> {
    const rList = this.routines();
    const routine = sanitizeRoutine(fields);
    rList.push(routine);
    this._saveRoutines(rList);
    return routine;
  }
  addRoutine(fields: Record<string, any>): Record<string, any> {
    return this.add_routine(fields);
  }

  update_routine(
    routineId: string,
    fields: Record<string, any>,
  ): Record<string, any> | null {
    const rList = this.routines();
    let target: Record<string, any> | null = null;
    for (let i = 0; i < rList.length; i++) {
      const cur = rList[i];
      if (cur && cur.id === routineId) {
        Object.assign(cur, fields);
        rList[i] = sanitizeRoutine(cur);
        target = rList[i]!;
        break;
      }
    }
    if (target) {
      this._saveRoutines(rList);
    }
    return target;
  }
  updateRoutine(
    routineId: string,
    fields: Record<string, any>,
  ): Record<string, any> | null {
    return this.update_routine(routineId, fields);
  }

  remove_routine(routineId: string): boolean {
    const rList = this.routines();
    const newList = rList.filter((r) => r.id !== routineId);
    if (newList.length !== rList.length) {
      this._saveRoutines(newList);
      return true;
    }
    return false;
  }
  removeRoutine(routineId: string): boolean {
    return this.remove_routine(routineId);
  }

  // ── Settings ──────────────────────────────────────────────────────────

  settings(): Record<string, any> {
    if (!fs.existsSync(this.agendaSettings)) {
      return { ...DEFAULT_SETTINGS };
    }
    let mtime = 0;
    try {
      mtime = fs.statSync(this.agendaSettings).mtimeMs;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }

    if (this._settingsCache === null || mtime !== this._settingsMtime) {
      const data = loadJson<Record<string, any>>(this.agendaSettings);
      this._settingsCache = sanitizeSettings(data);
      this._settingsMtime = mtime;
    }
    return { ...this._settingsCache };
  }

  update_settings(fields: Record<string, any>): Record<string, any> {
    const cur = this.settings();
    Object.assign(cur, fields);
    const sanitized = sanitizeSettings(cur);
    fs.mkdirSync(this.agendaDir, { recursive: true });
    fs.writeFileSync(this.agendaSettings, dumpJson(sanitized), "utf-8");
    this._settingsCache = sanitized;
    try {
      this._settingsMtime = fs.statSync(this.agendaSettings).mtimeMs;
    } catch {
      this._settingsMtime = 0;
    }
    return { ...this._settingsCache };
  }
  updateSettings(fields: Record<string, any>): Record<string, any> {
    return this.update_settings(fields);
  }

  // ── Day Files ─────────────────────────────────────────────────────────

  get_day_file_path(d: Date): string {
    const rel = formatLayout(LAYOUT.agenda_events_day, {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      date: todayIso(d),
    });
    return path.join(this.vaultRoot, rel);
  }
  getDayFilePath(d: Date): string {
    return this.get_day_file_path(d);
  }

  get_day_file(d: Date): Record<string, any> {
    const p = this.get_day_file_path(d);
    const dateStr = todayIso(d);
    if (!fs.existsSync(p)) {
      return sanitizeDayFile(null, dateStr);
    }

    let mtime = 0;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      return sanitizeDayFile(null, dateStr);
    }

    const cached = this._dayFilesCache.get(dateStr);
    if (cached && cached[0] === mtime) {
      return JSON.parse(JSON.stringify(cached[1]));
    }

    const raw = loadJson<Record<string, any>>(p);
    const sanitized = sanitizeDayFile(raw, dateStr);
    this._dayFilesCache.set(dateStr, [mtime, sanitized]);
    return JSON.parse(JSON.stringify(sanitized));
  }
  getDayFile(d: Date): Record<string, any> {
    return this.get_day_file(d);
  }

  save_day_file(d: Date, data: Record<string, any>): void {
    const p = this.get_day_file_path(d);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const dateStr = todayIso(d);
    const sanitized = sanitizeDayFile(data, dateStr);
    const text = dumpJson(sanitized);
    fs.writeFileSync(p, text, "utf-8");
    let mtime = 0;
    try {
      mtime = fs.statSync(p).mtimeMs;
    } catch {
      mtime = 0;
    }
    this._dayFilesCache.set(dateStr, [mtime, sanitized]);
  }
  saveDayFile(d: Date, data: Record<string, any>): void {
    this.save_day_file(d, data);
  }

  // ── Day events ────────────────────────────────────────────────────────

  add_event(d: Date, fields: Record<string, any>): Record<string, any> {
    const dayData = this.get_day_file(d);
    const ev = sanitizeEvent(fields);
    dayData.events.push(ev);
    this.save_day_file(d, dayData);
    return ev;
  }
  addEvent(d: Date, fields: Record<string, any>): Record<string, any> {
    return this.add_event(d, fields);
  }

  update_event(
    d: Date,
    eventId: string,
    fields: Record<string, any>,
  ): Record<string, any> | null {
    const dayData = this.get_day_file(d);
    let target: Record<string, any> | null = null;
    for (const ev of dayData.events) {
      if (ev.id === eventId) {
        Object.assign(ev, fields);
        target = sanitizeEvent(ev);
        break;
      }
    }
    if (target) {
      this.save_day_file(d, dayData);
    }
    return target;
  }
  updateEvent(
    d: Date,
    eventId: string,
    fields: Record<string, any>,
  ): Record<string, any> | null {
    return this.update_event(d, eventId, fields);
  }

  remove_event(d: Date, eventId: string): boolean {
    const dayData = this.get_day_file(d);
    const newEvents = dayData.events.filter((ev: any) => ev.id !== eventId);
    if (newEvents.length !== dayData.events.length) {
      dayData.events = newEvents;
      this.save_day_file(d, dayData);
      return true;
    }
    return false;
  }
  removeEvent(d: Date, eventId: string): boolean {
    return this.remove_event(d, eventId);
  }

  // ── Query & Resolve Occurrences ───────────────────────────────────────

  day(d: Date): Occurrence[] {
    const out = this._resolveDay(
      d,
      this.routines(),
      this.get_day_file(d),
      this.taskMgr.tasks(),
      this._projects(),
    );
    const dateKey = todayIso(d);
    const extra = this._external(d, d)[dateKey] || [];
    if (extra.length) {
      out.push(...extra);
      out.sort(compareOccurrences);
    }
    return out;
  }

  private _projects(): any[] {
    if (this._sources.has("proyectos")) {
      return [];
    }
    return this.projectMgr.projects();
  }

  private _resolveDay(
    d: Date,
    routinesList: Record<string, any>[],
    dayData: Record<string, any>,
    tasksList: any[],
    projectsList: any[],
  ): Occurrence[] {
    const wkey = WEEKDAY_KEYS[weekday(d)]!;
    const out: Occurrence[] = [];

    // 1. Routines
    const overrides = dayData.overrides || {};

    // Routines from previous day that spill over midnight into today
    const prevD = addDays(d, -1);
    for (const r of routinesList) {
      if (!routineOn(r, prevD)) continue;
      const rStart = r.start ? String(r.start).split(":") : null;
      if (!rStart || rStart.length < 2) continue;
      const sMin = Number(rStart[0]) * 60 + Number(rStart[1]);
      const totalDur = r.duration_min ?? 60;
      if (sMin + totalDur > 1440) {
        const spill = sMin + totalDur - 1440;
        out.push(
          new Occurrence({
            id: `${r.id}_spill`,
            title: r.title || "Rutina",
            kind: "routine",
            date: new Date(d),
            start: "00:00",
            duration_min: Math.min(1440, spill),
            colour: r.colour || "blue",
            links: r.links || [],
            done: false,
            source: "routine",
            editable: true,
            reminder_min: null,
          }),
        );
      }
    }

    for (const r of routinesList) {
      if (!routineOn(r, d)) continue;

      const rid = r.id;
      let startT: string | null = null;
      let dur: number | null = null;
      let isDone = false;

      if (rid in overrides) {
        const ov = overrides[rid];
        const st = ov.status;
        if (st === "skipped") {
          continue;
        } else if (st === "moved") {
          startT = ov.start ?? r.start;
          dur = ov.duration_min ?? r.duration_min;
          isDone = Boolean(ov.done);
        } else if (st === "done") {
          startT = r.start;
          dur = r.duration_min;
          isDone = true;
        } else {
          startT = r.start;
          dur = r.duration_min;
          isDone = false;
        }
      } else {
        startT = r.start;
        dur = r.duration_min;
        isDone = false;
      }

      if (startT && dur) {
        const parts = String(startT).split(":");
        if (parts.length >= 2) {
          const sMin = Number(parts[0]) * 60 + Number(parts[1]);
          if (sMin + dur > 1440) {
            dur = 1440 - sMin;
          }
        }
      }

      out.push(
        new Occurrence({
          id: rid,
          title: r.title || "Rutina",
          kind: "routine",
          date: new Date(d),
          start: startT,
          duration_min: dur,
          colour: r.colour || "blue",
          links: r.links || [],
          done: isDone,
          source: "routine",
          editable: true,
          reminder_min: reminder(r),
        }),
      );
    }

    // 2. Day events
    for (const ev of dayData.events || []) {
      out.push(
        new Occurrence({
          id: ev.id || "",
          title: ev.title || "Evento",
          kind: "event",
          date: new Date(d),
          start: ev.start || null,
          duration_min: ev.duration_min ?? null,
          colour: ev.colour || "orange",
          links: ev.links || [],
          done: Boolean(ev.done),
          source: "event",
          editable: true,
          reminder_min: reminder(ev),
        }),
      );
    }

    // 3. Tasks
    for (const t of tasksList) {
      if (!t.occurs_on(d)) continue;
      const repeating = t.rule.repeats;
      let startTime: string | null;
      if (repeating || isSameDay(t.due, d)) {
        startTime = t.due_time || null;
      } else {
        startTime = t.start_time || null;
      }
      out.push(
        new Occurrence({
          id: `task_${t.id}`,
          title: t.name,
          kind: "task",
          date: new Date(d),
          start: startTime,
          duration_min: startTime ? 60 : null,
          colour: "#3f51b5",
          links: [{ type: "task", id: t.id }],
          done: t.is_done && (!repeating || isSameDay(d, t.due)),
          source: "task",
          editable: Boolean(startTime),
        }),
      );
    }

    // 4. Projects
    for (const p of projectsList) {
      let isMatch = false;
      if (
        p.start &&
        p.deadline &&
        p.start.getTime() <= d.getTime() &&
        d.getTime() <= p.deadline.getTime()
      ) {
        isMatch = true;
      } else if (p.start && !p.deadline && isSameDay(p.start, d)) {
        isMatch = true;
      } else if (p.deadline && !p.start && isSameDay(p.deadline, d)) {
        isMatch = true;
      }

      if (isMatch) {
        const clock =
          p.start_time || (p.extra && p.extra.start_time) || null;
        const startTime = p.start && isSameDay(p.start, d) && clock ? clock : null;
        out.push(
          new Occurrence({
            id: `project_${p.id}`,
            title: p.name,
            kind: "project",
            date: new Date(d),
            start: startTime,
            duration_min: startTime ? 60 : null,
            colour: p.color || "#a78bfa",
            links: [{ type: "project", id: p.id }],
            done: p.is_done,
            source: "project",
            editable: false,
          }),
        );
      }
    }

    // 5. Exercises
    const gymHabit = this.habitMgr.habits().find((h) => h.id === "gym");
    const schedules = (gymHabit?.exercise_schedules as Record<string, { time?: string; duration_min?: number; in_calendar?: boolean; rest_min?: number }> | undefined) || {};

    const dayExercises = this.exerciseMgr.exercises_for_day(wkey);
    if (dayExercises.length > 0) {
      const isDone = this.exerciseMgr.day_pct(d) >= 1.0;
      out.push(
        new Occurrence({
          id: `exercise_${todayIso(d)}`,
          title: "Ejercicio",
          kind: "exercise",
          date: new Date(d),
          start: null,
          duration_min: null,
          colour: "#ff9632",
          links: [{ type: "exercise", id: "ejercicio" }],
          done: isDone,
          source: "exercise",
          editable: false,
        }),
      );

      const exLog = this.exerciseMgr.getLog(d);

      for (const ex of dayExercises) {
        const sched = schedules[ex.id];
        if (sched && sched.time && sched.in_calendar !== false) {
          const isExDone = Boolean(exLog?.entries?.[ex.id]?.done);
          const restText = typeof sched.rest_min === "number" && sched.rest_min > 0 ? ` (+${sched.rest_min}m descanso)` : "";
          out.push(
            new Occurrence({
              id: `ex_${ex.id}_${todayIso(d)}`,
              title: `🏋️ ${ex.name}${restText}`,
              kind: "exercise",
              date: new Date(d),
              start: sched.time,
              duration_min: typeof sched.duration_min === "number" && sched.duration_min > 0 ? sched.duration_min : 20,
              colour: "#ff9632",
              links: [{ type: "exercise", id: ex.id }],
              done: isExDone,
              source: "exercise",
              editable: false,
            }),
          );
        }
      }
    }

    // 6. Habits
    const habitsToday = this.habitMgr.habits_for_day(d);
    if (habitsToday.length > 0) {
      const log = this.habitMgr.get_day(d);
      const grouped: Record<string, any>[] = [];
      const hasScheduledExercises = dayExercises.some((ex) => {
        const s = schedules[ex.id];
        return s && s.time && s.in_calendar !== false;
      });

      for (const h of habitsToday) {
        if (!h.in_calendar || (h.id === "gym" && hasScheduledExercises)) {
          grouped.push(h);
          continue;
        }
        const clock = h.time || null;
        const duration =
          typeof h.duration_min === "number" && h.duration_min > 0
            ? h.duration_min
            : 30;
        out.push(
          new Occurrence({
            id: `${HABIT_PREFIX}${h.id}`,
            title: `${h.icon || ""} ${h.name}`.trim(),
            kind: "habit",
            date: new Date(d),
            start: clock,
            duration_min: clock ? duration : null,
            colour: h.colour || "#7c5af0",
            links: [{ type: "habit", id: h.id }],
            done: Boolean(log.completed[h.id]),
            source: "habit",
            editable: false,
            reminder_min: clock ? reminder(h) : null,
          }),
        );
      }
      if (grouped.length > 0) {
        out.push(
          new Occurrence({
            id: `habit_${todayIso(d)}`,
            title: "Hábitos",
            kind: "habit",
            date: new Date(d),
            start: null,
            duration_min: null,
            colour: "#7c5af0",
            links: [{ type: "habit", id: "habits" }],
            done: grouped.every((h) => Boolean(log.completed[h.id])),
            source: "habit",
            editable: false,
          }),
        );
      }
    }

    // 7. Sort
    out.sort(compareOccurrences);
    return out;
  }

  range(first: Date, last: Date): Record<string, Occurrence[]> {
    const routinesList = this.routines();
    const tasksList = this.taskMgr.tasks();
    const projectsList = this._projects();
    const external = this._external(first, last);

    const result: Record<string, Occurrence[]> = {};
    let curr = new Date(first);
    while (curr.getTime() <= last.getTime()) {
      const dateKey = todayIso(curr);
      const dayData = this.get_day_file(curr);
      const occs = this._resolveDay(
        curr,
        routinesList,
        dayData,
        tasksList,
        projectsList,
      );
      if (external[dateKey]) {
        occs.push(...external[dateKey]);
        occs.sort(compareOccurrences);
      }
      result[dateKey] = occs;
      curr = addDays(curr, 1);
    }
    return result;
  }

  // ── Actions ───────────────────────────────────────────────────────────

  move(d: Date, occurrenceId: string, start: string, durationMin: number): void {
    if (occurrenceId.startsWith("ev_")) {
      this.update_event(d, occurrenceId, { start, duration_min: durationMin });
      return;
    }

    const dayData = this.get_day_file(d);
    const overrides = dayData.overrides || {};
    const existing = overrides[occurrenceId] || {};
    Object.assign(existing, {
      status: "moved",
      start,
      duration_min: durationMin,
    });
    overrides[occurrenceId] = existing;
    dayData.overrides = overrides;
    this.save_day_file(d, dayData);
  }

  skip(d: Date, occurrenceId: string): void {
    if (occurrenceId.startsWith("ev_")) {
      this.remove_event(d, occurrenceId);
      return;
    }

    const dayData = this.get_day_file(d);
    const overrides = dayData.overrides || {};
    overrides[occurrenceId] = { status: "skipped" };
    dayData.overrides = overrides;
    this.save_day_file(d, dayData);
  }

  set_done(d: Date, occurrenceId: string, done: boolean): void {
    const provider = this._sourceFor(occurrenceId);
    if (provider !== null) {
      if (typeof provider.setDone === "function") {
        provider.setDone(d, occurrenceId, done);
      } else if (typeof provider.set_done === "function") {
        provider.set_done(d, occurrenceId, done);
      }
      return;
    }
    if (occurrenceId.startsWith("ex_")) {
      const parts = occurrenceId.split("_");
      const exId = parts.slice(1, -1).join("_");
      if (exId) {
        this.exerciseMgr.markDone(d, exId, done);
        return;
      }
    }
    if (occurrenceId.startsWith(HABIT_PREFIX)) {
      this.habitMgr.setDone(d, occurrenceId.slice(HABIT_PREFIX.length), done);
      return;
    }
    if (occurrenceId.startsWith("task_")) {
      this.taskMgr.update(occurrenceId.slice("task_".length), {
        status: done ? TASK_DONE : TASK_TODO,
      });
      return;
    }
    if (occurrenceId.startsWith("ev_")) {
      this.update_event(d, occurrenceId, { done });
      return;
    }

    const dayData = this.get_day_file(d);
    const overrides = dayData.overrides || {};
    if (done) {
      const existing = overrides[occurrenceId] || {};
      if (existing.status === "moved") {
        existing.done = true;
      } else {
        overrides[occurrenceId] = { status: "done" };
      }
    } else {
      delete overrides[occurrenceId];
    }

    dayData.overrides = overrides;
    this.save_day_file(d, dayData);
  }
  setDone(d: Date, occurrenceId: string, done: boolean): void {
    this.set_done(d, occurrenceId, done);
  }
}
