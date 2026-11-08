// Calendar helpers: minutes <-> "HH:MM", Spanish labels, and the column
// layout of overlapping blocks in the time grid.

import type { Occurrence } from "./types";

export const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export const GCAL_COLOURS: Array<[string, string]> = [
  ["#d50000", "Tomate"], ["#e67c73", "Flamenco"], ["#f4511e", "Mandarina"],
  ["#f6bf26", "Plátano"], ["#33b679", "Salvia"], ["#0b8043", "Albahaca"],
  ["#039be5", "Pavo real"], ["#3f51b5", "Arándano"], ["#7986cb", "Lavanda"],
  ["#8e24aa", "Uva"], ["#616161", "Grafito"],
];

export const REMINDERS: Array<[number | null, string]> = [
  [null, "Sin notificación"], [0, "A la hora de inicio"], [5, "5 minutos antes"],
  [10, "10 minutos antes"], [30, "30 minutos antes"], [60, "1 hora antes"], [1440, "1 día antes"],
];

export const KIND_FILTERS: Array<[string, string, string]> = [
  ["routine", "Rutinas", "#2dd4bf"], ["event", "Eventos", "#ff9632"], ["habit", "Hábitos", "#7c5af0"],
  ["exercise", "Ejercicio", "#ff9632"], ["task", "Tareas", "#2383e2"], ["project", "Proyectos", "#a78bfa"],
  ["issue", "Issues de proyectos", "#a78bfa"], ["goal_item", "Metas", "#33b679"], ["saving", "Ahorros", "#eab308"],
  ["integrated_block", "Bloques integrados", "#6366f1"],
  ["mentor_study", "Estudio (Mentor)", "#38bdf8"],
];

export function toMin(hm: string | null | undefined): number | null {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h! * 60 + m!;
}

export function toHm(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 510 -> "8:30" */
export function fmtHm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export interface Placed {
  occ: Occurrence;
  start: number;
  end: number;
  col: number;
  cols: number;
}

/** Side-by-side columns for blocks that overlap, like Google Calendar. */
export function layoutDay(occs: Occurrence[]): Placed[] {
  const items = occs
    .filter((o) => o.start)
    .map((o) => {
      const start = toMin(o.start)!;
      const dur = typeof o.duration_min === "number" && o.duration_min > 0 ? o.duration_min : 30;
      return { occ: o, start, end: Math.min(24 * 60, start + Math.max(5, dur)), col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const it of items) {
    if (group.length && it.start >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const used = new Set(group.filter((g) => g.end > it.start).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    it.col = col;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return out;
}

export function visible(occs: Occurrence[], filters: Record<string, boolean>): Occurrence[] {
  return occs.filter((o) => filters[o.kind] !== false);
}
