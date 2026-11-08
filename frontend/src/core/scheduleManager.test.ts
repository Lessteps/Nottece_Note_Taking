import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { ProjectManager } from "./projectManager";
import { ScheduleManager } from "./scheduleManager";
import { TaskManager } from "./taskManager";

const D = new Date(2026, 8, 14); // Monday, 2026-09-14

describe("ScheduleManager", () => {
  let tempDir: string;
  let sm: ScheduleManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nv-sched-test-"));
    sm = new ScheduleManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("routines CRUD", () => {
    const rt = sm.add_routine({
      title: "Estudio backend",
      days: ["lunes", "martes", "miercoles"],
      start: "07:30",
      duration_min: 90,
    });
    expect(rt.id.startsWith("rt_")).toBe(true);

    const routines = sm.routines();
    expect(routines.length).toBe(1);
    expect(routines[0]?.title).toBe("Estudio backend");

    // Update
    const updated = sm.update_routine(rt.id, { title: "Estudio Python" });
    expect(updated?.title).toBe("Estudio Python");

    // Remove
    expect(sm.remove_routine(rt.id)).toBe(true);
    expect(sm.routines().length).toBe(0);
  });

  it("day events and overrides (move, skip)", () => {
    const rt = sm.add_routine({
      title: "Rutina diaria",
      days: ["lunes"],
      start: "08:00",
      duration_min: 60,
    });
    const ev = sm.add_event(D, {
      title: "Reunión",
      start: "11:00",
      duration_min: 45,
    });

    // Query day (2026-09-14 is Monday)
    let occs = sm.day(D);
    expect(occs.some((o) => o.id === rt.id)).toBe(true);
    expect(occs.some((o) => o.id === ev.id)).toBe(true);

    // Test move
    sm.move(D, rt.id, "09:00", 90);
    occs = sm.day(D);
    const rtOcc = occs.find((o) => o.id === rt.id);
    expect(rtOcc?.start).toBe("09:00");
    expect(rtOcc?.duration_min).toBe(90);

    // Test skip
    sm.skip(D, rt.id);
    occs = sm.day(D);
    expect(occs.some((o) => o.id === rt.id)).toBe(false);
  });

  it("derived occurrences from tasks and projects", () => {
    const tm = new TaskManager(tempDir);
    tm.create("Tarea con hora", { due: D, due_time: "14:00" });

    const pm = new ProjectManager(tempDir);
    pm.create("Proyecto activo", { start: D, deadline: addDays(D, 5) });

    const occs = sm.day(D);
    const taskOcc = occs.find((o) => o.kind === "task");
    expect(taskOcc).toBeDefined();
    expect(taskOcc?.start).toBe("14:00");
    expect(taskOcc?.editable).toBe(true);

    const projOcc = occs.find((o) => o.kind === "project");
    expect(projOcc).toBeDefined();
  });

  it("range queries return occurrences across dates", () => {
    sm.add_routine({
      title: "Morning routine",
      days: ["lunes", "martes", "miercoles", "jueves", "viernes"],
    });
    sm.add_event(D, { title: "Event 1" });

    const first = new Date(2026, 8, 1);
    const last = new Date(2026, 8, 30);

    const res = sm.range(first, last);
    expect(Object.keys(res).length).toBe(30);
  });

  it("does not throw ReferenceError when querying day with habits on rest days (0 exercises)", () => {
    const saturday = new Date(2026, 10, 7); // 2026-11-07
    sm.habitMgr.add_habit("Hábito sábado", "⭐", [6], { in_calendar: true });
    expect(() => sm.day(saturday)).not.toThrow();
  });
});
