// Horario por área del plan — «Backend a las 09:00, 60 min». Es UN solo dato por plan y área: el calendario general lo lee y la página del área lo edita,
// así que lo que se cambie en un sitio se ve en el otro. Puro: sin disco ni red. Vive fuera del plan (`.notevault/mentor/area-times/<planId>.json`)
// porque `sanitizePlan` descarta campos que no conoce y «Deshacer» restaura una instantánea del plan.

export interface AreaTime {
  /** HH:MM (24 h) */
  start: string;
  /** minutos del bloque; sin él, el bloque dura lo que pesan los temas y la práctica del día */
  durationMin?: number;
}

export type AreaTimes = Record<string, AreaTime>;

export const MIN_DURATION = 15;
export const MAX_DURATION = 480;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (s: unknown): s is string => typeof s === "string" && TIME_RE.test(s);

/** Lo que llega del disco o de la interfaz → solo horas válidas, ids de área razonables y duraciones dentro de rango. */
export function sanitizeAreaTimes(raw: unknown): AreaTimes {
  const out: AreaTimes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(key) || !v || typeof v !== "object") continue;
    const { start, durationMin } = v as Record<string, unknown>;
    if (!isTime(start)) continue;
    const d = typeof durationMin === "number" && Number.isFinite(durationMin) ? Math.round(durationMin) : undefined;
    out[key] = d !== undefined && d >= MIN_DURATION && d <= MAX_DURATION ? { start, durationMin: d } : { start };
  }
  return out;
}

/** Pone (o quita, con `null`) el horario de un área. */
export function setAreaTime(times: AreaTimes, key: string, value: AreaTime | null): AreaTimes {
  const next = { ...times };
  if (value === null) delete next[key];
  else Object.assign(next, sanitizeAreaTimes({ [key]: value }));
  return next;
}

export const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const fromMinutes = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface DayBlockIn {
  key: string;
  areaId?: string;
  /** minutos que pesan los temas y la práctica de ese día */
  minutes: number;
}
export interface DayBlockOut {
  key: string;
  start: string;
  durationMin: number;
  /** true = la hora la eligió el estudiante; false = se apila automáticamente */
  fixed: boolean;
}

export const DEFAULT_DAY_START = 9 * 60;
export const BLOCK_GAP = 15;
export const MIN_BLOCK = 30;
const LAST_START = 20 * 60;

/**
 * Coloca los bloques de un día: los de hora fija van donde dijo el estudiante; el resto se apila desde las 09:00, saltando lo ya ocupado
 * (con 15 min de respiro). Mismo orden de entrada, mismo resultado.
 */
export function placeBlocks(blocks: readonly DayBlockIn[], times: AreaTimes): DayBlockOut[] {
  const out: DayBlockOut[] = [];
  const busy: Array<[number, number]> = [];
  for (const b of blocks) {
    const t = times[b.key] ?? (b.areaId ? times[b.areaId] : undefined);
    if (!t) continue;
    const dur = Math.max(MIN_BLOCK, t.durationMin ?? b.minutes);
    const start = toMinutes(t.start);
    busy.push([start, start + dur]);
    out.push({ key: b.key, start: t.start, durationMin: dur, fixed: true });
  }

  // Si algún bloque temprano (ej. Backend a las 06:30) tiene hora fija anterior a las 09:00,
  // el cursor se adapta para apilar el resto de áreas inmediatamente a continuación.
  const minFixedStart = busy.length ? Math.min(...busy.map(([a]) => a)) : DEFAULT_DAY_START;
  let cursor = Math.min(DEFAULT_DAY_START, minFixedStart);

  const result: DayBlockOut[] = [];
  for (const b of blocks) {
    const fixed = out.find((o) => o.key === b.key);
    if (fixed) {
      result.push(fixed);
      cursor = Math.max(cursor, toMinutes(fixed.start) + fixed.durationMin + BLOCK_GAP);
      continue;
    }
    const dur = Math.max(MIN_BLOCK, b.minutes);
    let start = cursor;
    for (let i = 0; i < 24; i++) {
      const clash = busy.find(([a, z]) => start < z + BLOCK_GAP && start + dur + BLOCK_GAP > a);
      if (!clash) break;
      start = clash[1] + BLOCK_GAP;
    }
    start = Math.min(LAST_START, start);
    busy.push([start, start + dur]);
    cursor = start + dur + BLOCK_GAP;
    result.push({ key: b.key, start: fromMinutes(start), durationMin: dur, fixed: false });
  }
  return result;
}
