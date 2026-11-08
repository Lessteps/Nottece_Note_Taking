// Calendario state: the view, the day in focus, the type filters, the
// blocks of the range on screen and the editor.

import { create } from "zustand";
import { persistField } from "./navState";
import { api } from "../lib/bridge";
import { addDays, parseIso, weekStart } from "../lib/habits";
import { isoDate, todayIso } from "../lib/tasks";
import type { CalItem, CalSettings, Occurrence } from "../lib/types";
import { useApp } from "./app";

export type CalView = "dia" | "semana" | "mes" | "agenda";
export type ZoomInterval = 60 | 45 | 30 | 15 | 10 | 5;
export const ZOOM_LEVELS: ZoomInterval[] = [60, 45, 30, 15, 10, 5];

export interface EditorState {
  mode: "create" | "edit";
  kind: "event" | "task";
  item: CalItem;
}

const FILTER_KEY = "nv.calendar.filters";
const ZOOM_KEY = "nv.calendar.zoom";

function loadZoom(): ZoomInterval {
  try {
    const raw = Number(localStorage.getItem(ZOOM_KEY));
    if ([60, 45, 30, 15, 10, 5].includes(raw)) return raw as ZoomInterval;
  } catch {
    // fallback
  }
  return 60;
}

function loadFilters(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** The dates the current view shows. */
export function viewRange(view: CalView, day: string): [string, string] {
  if (view === "dia") return [day, day];
  if (view === "semana") {
    const first = weekStart(day);
    return [first, addDays(first, 6)];
  }
  if (view === "agenda") return [day, addDays(day, 27)];
  const d = parseIso(day);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = isoDate(new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)));
  return [start, addDays(start, 41)];
}

interface CalState {
  view: CalView;
  day: string;
  filters: Record<string, boolean>;
  settings: CalSettings | null;
  days: Record<string, Occurrence[]>;
  loading: boolean;
  editor: EditorState | null;
  integratedBlockOcc: Occurrence | null;
  routinesOpen: boolean;
  selectedOccId: string | null;
  zoom: ZoomInterval;

  setView: (v: CalView) => void;
  setDay: (d: string) => void;
  setSelectedOccId: (id: string | null) => void;
  setZoom: (z: ZoomInterval) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  step: (sign: number) => void;
  setFilter: (kind: string, on: boolean) => void;
  load: () => Promise<void>;
  openCreate: (day: string, start: number | null, end: number | null, kind?: "event" | "task") => void;
  openEdit: (occ: Occurrence) => Promise<void>;
  closeEditor: () => void;
  openIntegratedBlock: (occ: Occurrence) => void;
  closeIntegratedBlock: () => void;
  setRoutinesOpen: (open: boolean) => void;
  setDone: (occ: Occurrence, done: boolean) => Promise<void>;
  move: (occ: Occurrence, day: string, start: string, duration: number) => Promise<void>;
}

function fail(e: unknown) {
  useApp.getState().toast("error", (e as Error).message);
}

let loadSeq = 0;

export const useCalendar = create<CalState>((set, get) => ({
  view: "semana",
  day: todayIso(),
  filters: loadFilters(),
  settings: null,
  days: {},
  loading: false,
  editor: null,
  integratedBlockOcc: null,
  routinesOpen: false,
  selectedOccId: null,
  zoom: loadZoom(),

  setSelectedOccId: (selectedOccId) => set({ selectedOccId }),

  setZoom: (zoom) => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // ignore
    }
    set({ zoom });
  },

  zoomIn: () => {
    const current = get().zoom;
    const idx = ZOOM_LEVELS.indexOf(current);
    if (idx < ZOOM_LEVELS.length - 1) {
      const next = ZOOM_LEVELS[idx + 1]!;
      try {
        localStorage.setItem(ZOOM_KEY, String(next));
      } catch {
        // ignore
      }
      set({ zoom: next });
    }
  },

  zoomOut: () => {
    const current = get().zoom;
    const idx = ZOOM_LEVELS.indexOf(current);
    if (idx > 0) {
      const prev = ZOOM_LEVELS[idx - 1]!;
      try {
        localStorage.setItem(ZOOM_KEY, String(prev));
      } catch {
        // ignore
      }
      set({ zoom: prev });
    }
  },

  setView: (view) => {
    set({ view, editor: null, integratedBlockOcc: null });
    void get().load();
  },
  setDay: (day) => {
    set({ day, editor: null, integratedBlockOcc: null });
    void get().load();
  },
  step: (sign) => {
    const { view, day } = get();
    if (view === "dia") get().setDay(addDays(day, sign));
    else if (view === "semana" || view === "agenda") get().setDay(addDays(day, 7 * sign));
    else {
      const d = parseIso(day);
      get().setDay(isoDate(new Date(d.getFullYear(), d.getMonth() + sign, 1)));
    }
  },
  setFilter: (kind, on) => {
    const filters = { ...get().filters, [kind]: on };
    set({ filters });
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* per-viewer convenience only */
    }
  },

  load: async () => {
    const seq = ++loadSeq;
    const [first, last] = viewRange(get().view, get().day);
    set({ loading: true });
    try {
      const [days, settings] = await Promise.all([
        api.calRange(first, last), get().settings ? Promise.resolve(get().settings!) : api.calSettings()]);
      if (seq === loadSeq) set({ days, settings, loading: false });
    } catch (e) {
      if (seq === loadSeq) set({ loading: false });
      fail(e);
    }
  },

  openCreate: (day, start, end, kind = "event") => {
    const s = start ?? null;
    set({
      editor: {
        mode: "create",
        kind,
        item: {
          kind: kind === "task" ? "task" : "event", id: "", date: day, title: "",
          start: s === null ? null : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
          duration: s === null || end === null ? null : Math.max(15, end - s),
          location: "", description: "", reminder_min: null, colour: "#039be5",
          repeat: "", until: null, subject: "",
        },
      },
    });
  },

  openEdit: async (occ) => {
    try {
      const item = await api.calItem(occ.date, occ.id, occ.kind);
      set({ editor: { mode: "edit", kind: item.kind === "task" ? "task" : "event", item } });
    } catch (e) {
      fail(e);
    }
  },
  closeEditor: () => set({ editor: null }),
  openIntegratedBlock: (occ) => set({ integratedBlockOcc: occ }),
  closeIntegratedBlock: () => set({ integratedBlockOcc: null }),
  setRoutinesOpen: (routinesOpen) => set({ routinesOpen }),

  setDone: async (occ, done) => {
    const before = get().days;
    set((s) => ({
      days: {
        ...s.days,
        [occ.date]: (s.days[occ.date] ?? []).map((o) => (o.id === occ.id ? { ...o, done } : o)),
      },
    }));
    try {
      await api.calSetDone(occ.date, occ.id, done);
      void get().load();
    } catch (e) {
      set({ days: before });
      fail(e);
    }
  },

  move: async (occ, day, start, duration) => {
    const before = get().days;
    set((s) => {
      const days = { ...s.days };
      days[occ.date] = (days[occ.date] ?? []).filter((o) => o.id !== occ.id);
      days[day] = [...(days[day] ?? []), { ...occ, date: day, start, duration_min: duration }];
      return { days };
    });
    try {
      await api.calMove(occ, day, start, duration);
      void get().load();
    } catch (e) {
      set({ days: before });
      fail(e);
    }
  },
}));

// La vista interna del módulo se recuerda entre reinicios.
persistField(useCalendar, "view", "calendar.view");
