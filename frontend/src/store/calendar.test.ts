import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalItem, CalSettings, Occurrence } from "../lib/types";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    calRange: vi.fn(),
    calSettings: vi.fn(),
    calItem: vi.fn(),
    calSetDone: vi.fn(),
    calMove: vi.fn(),
  },
}));

vi.mock("../lib/bridge", () => ({ api: apiMock }));

import { useCalendar, viewRange } from "./calendar";
import { useApp } from "./app";

function occ(over: Partial<Occurrence> = {}): Occurrence {
  return {
    id: "o1", title: "Evento", kind: "event", date: "2026-09-29",
    start: "10:00", duration_min: 60, colour: "#039be5", done: false,
    source: "agenda", editable: true, checkable: true, links: [], reminder_min: null,
    ...over,
  };
}

function calItem(over: Partial<CalItem> = {}): CalItem {
  return {
    kind: "event", id: "o1", date: "2026-09-29", title: "Evento",
    start: "10:00", duration: 60, location: "", description: "",
    reminder_min: null, colour: "#039be5", repeat: "", until: null, subject: "",
    ...over,
  };
}

function settings(): CalSettings {
  return { day_start_hour: 6, day_end_hour: 22, default_duration_min: 60 };
}

function reset() {
  vi.clearAllMocks();
  useCalendar.setState({
    view: "semana", day: "2026-09-29", filters: {}, settings: null,
    days: {}, loading: false, editor: null, routinesOpen: false,
  });
  useApp.setState({ toasts: [] });
}

beforeEach(reset);

describe("viewRange", () => {
  it("dia covers a single day", () => {
    expect(viewRange("dia", "2026-09-29")).toEqual(["2026-09-29", "2026-09-29"]);
  });
  it("semana spans Monday to Sunday around the day", () => {
    const [first, last] = viewRange("semana", "2026-09-29");
    expect(new Date(`${first}T12:00`).getDay()).toBe(1); // Monday
    expect(new Date(`${last}T12:00`).getDay()).toBe(0); // Sunday
    expect(first <= "2026-09-29" && "2026-09-29" <= last).toBe(true);
  });
  it("agenda covers 28 days from the day", () => {
    expect(viewRange("agenda", "2026-09-29")).toEqual(["2026-09-29", "2026-10-26"]);
  });
  it("mes covers a 42-day Monday-first grid", () => {
    const [first, last] = viewRange("mes", "2026-09-15");
    expect(new Date(`${first}T12:00`).getDay()).toBe(1);
    const days = (new Date(`${last}T12:00`).getTime() - new Date(`${first}T12:00`).getTime()) / 86400000;
    expect(days).toBe(41);
    expect(first <= "2026-09-01" && "2026-09-30" <= last).toBe(true);
  });
});

describe("navigation", () => {
  it("step moves by view size", () => {
    const s = () => useCalendar.getState();
    apiMock.calRange.mockResolvedValue({});
    apiMock.calSettings.mockResolvedValue(settings());
    s().setDay("2026-09-29");
    useCalendar.setState({ view: "dia" });
    s().step(1);
    expect(useCalendar.getState().day).toBe("2026-09-30");
    useCalendar.setState({ view: "semana", day: "2026-09-29" });
    s().step(1);
    expect(useCalendar.getState().day).toBe("2026-10-06");
    useCalendar.setState({ view: "agenda", day: "2026-09-29" });
    s().step(-1);
    expect(useCalendar.getState().day).toBe("2026-09-22");
    useCalendar.setState({ view: "mes", day: "2026-09-15" });
    s().step(1);
    expect(useCalendar.getState().day).toBe("2026-10-01");
  });
  it("setView/setDay close the editor", () => {
    apiMock.calRange.mockResolvedValue({});
    apiMock.calSettings.mockResolvedValue(settings());
    useCalendar.setState({ editor: { mode: "create", kind: "event", item: calItem() } });
    useCalendar.getState().setView("dia");
    expect(useCalendar.getState().editor).toBeNull();
    useCalendar.setState({ editor: { mode: "create", kind: "event", item: calItem() } });
    useCalendar.getState().setDay("2026-09-30");
    expect(useCalendar.getState().editor).toBeNull();
  });
  it("setFilter merges kinds", () => {
    useCalendar.getState().setFilter("habit", false);
    useCalendar.getState().setFilter("task", true);
    expect(useCalendar.getState().filters).toEqual({ habit: false, task: true });
  });
});

describe("load", () => {
  it("fills days + settings and clears loading", async () => {
    apiMock.calRange.mockResolvedValue({ "2026-09-29": [occ()] });
    apiMock.calSettings.mockResolvedValue(settings());
    await useCalendar.getState().load();
    const s = useCalendar.getState();
    expect(s.days["2026-09-29"]).toHaveLength(1);
    expect(s.settings?.day_start_hour).toBe(6);
    expect(s.loading).toBe(false);
  });
  it("a stale response never overwrites a newer load", async () => {
    let resolveFirst!: (v: Record<string, Occurrence[]>) => void;
    apiMock.calRange.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    apiMock.calRange.mockResolvedValue({ "2026-09-29": [occ({ id: "nuevo" })] });
    apiMock.calSettings.mockResolvedValue(settings());
    const first = useCalendar.getState().load();
    await useCalendar.getState().load();
    resolveFirst({ "2026-09-29": [occ({ id: "viejo" })] });
    await first;
    expect(useCalendar.getState().days["2026-09-29"]?.[0]?.id).toBe("nuevo");
  });
  it("a failure clears loading and toasts", async () => {
    apiMock.calRange.mockRejectedValue(new Error("caído"));
    await useCalendar.getState().load();
    expect(useCalendar.getState().loading).toBe(false);
    expect(useApp.getState().toasts.at(-1)?.text).toContain("caído");
  });
});

describe("editor", () => {
  it("openCreate formats minutes and floors duration at 15", () => {
    useCalendar.getState().openCreate("2026-09-29", 600, 660, "event");
    expect(useCalendar.getState().editor).toMatchObject({
      mode: "create",
      item: { date: "2026-09-29", start: "10:00", duration: 60 },
    });
    useCalendar.getState().openCreate("2026-09-29", 600, 605, "task");
    expect(useCalendar.getState().editor).toMatchObject({
      kind: "task",
      item: { kind: "task", start: "10:00", duration: 15 },
    });
    useCalendar.getState().openCreate("2026-09-29", null, null);
    expect(useCalendar.getState().editor?.item.start).toBeNull();
    expect(useCalendar.getState().editor?.item.duration).toBeNull();
  });
  it("openEdit loads the item, failure toasts", async () => {
    apiMock.calItem.mockResolvedValue(calItem({ id: "o1" }));
    await useCalendar.getState().openEdit(occ());
    expect(useCalendar.getState().editor).toMatchObject({ mode: "edit", item: { id: "o1" } });
    apiMock.calItem.mockRejectedValueOnce(new Error("no"));
    await useCalendar.getState().openEdit(occ({ id: "zz" }));
    expect(useApp.getState().toasts.at(-1)?.text).toContain("no");
  });
  it("closeEditor/setRoutinesOpen are sync", () => {
    useCalendar.getState().openCreate("2026-09-29", null, null);
    useCalendar.getState().closeEditor();
    expect(useCalendar.getState().editor).toBeNull();
    useCalendar.getState().setRoutinesOpen(true);
    expect(useCalendar.getState().routinesOpen).toBe(true);
  });
});

describe("setDone/move (optimistic)", () => {
  it("setDone flips at once and rolls back on failure", async () => {
    useCalendar.setState({ days: { "2026-09-29": [occ({ id: "o1", done: false })] } });
    apiMock.calSetDone.mockResolvedValue({ ok: true });
    apiMock.calRange.mockResolvedValue({});
    apiMock.calSettings.mockResolvedValue(settings());
    await useCalendar.getState().setDone(occ({ id: "o1" }), true);
    expect(useCalendar.getState().days["2026-09-29"]?.[0]?.done).toBe(true);
  });
  it("setDone restores the day when the server refuses", async () => {
    const before = { "2026-09-29": [occ({ id: "o1", done: false })] };
    useCalendar.setState({ days: before });
    apiMock.calSetDone.mockRejectedValueOnce(new Error("no"));
    await useCalendar.getState().setDone(occ({ id: "o1" }), true);
    expect(useCalendar.getState().days).toEqual(before);
  });
  it("move relocates across days and rolls back on failure", async () => {
    useCalendar.setState({ days: { "2026-09-29": [occ({ id: "o1" })], "2026-09-30": [] } });
    apiMock.calMove.mockResolvedValue({ ok: true });
    apiMock.calRange.mockResolvedValue({});
    apiMock.calSettings.mockResolvedValue(settings());
    await useCalendar.getState().move(occ({ id: "o1" }), "2026-09-30", "11:00", 30);
    const s = useCalendar.getState();
    expect(s.days["2026-09-29"]).toEqual([]);
    expect(s.days["2026-09-30"]?.[0]).toMatchObject({ date: "2026-09-30", start: "11:00", duration_min: 30 });

    useCalendar.setState({ days: { "2026-09-29": [occ({ id: "o1" })], "2026-09-30": [] } });
    apiMock.calMove.mockRejectedValueOnce(new Error("no"));
    await useCalendar.getState().move(occ({ id: "o1" }), "2026-09-30", "11:00", 30);
    expect(useCalendar.getState().days["2026-09-29"]).toHaveLength(1);
  });
});

describe("zoom levels", () => {
  it("allows setting 5-minute zoom and stepping in/out", () => {
    useCalendar.getState().setZoom(60);
    expect(useCalendar.getState().zoom).toBe(60);

    // Zoom all the way in to 5 min
    useCalendar.getState().zoomIn(); // 45
    expect(useCalendar.getState().zoom).toBe(45);
    useCalendar.getState().zoomIn(); // 30
    useCalendar.getState().zoomIn(); // 15
    useCalendar.getState().zoomIn(); // 10
    useCalendar.getState().zoomIn(); // 5
    expect(useCalendar.getState().zoom).toBe(5);

    // Cannot zoom in past 5
    useCalendar.getState().zoomIn();
    expect(useCalendar.getState().zoom).toBe(5);

    // Zoom back out
    useCalendar.getState().zoomOut(); // 10
    expect(useCalendar.getState().zoom).toBe(10);

    // Direct setting
    useCalendar.getState().setZoom(5);
    expect(useCalendar.getState().zoom).toBe(5);
  });
});
