// Estado DERIVADO del Sistema de práctica por área (puro, compartido): qué katas de cada área están hechos, la racha, el progreso por habilidad y la
// semana de lunes a domingo. Sale de los intentos del ledger y de las marcas manuales; no guarda nada. Ver `core/mentor/areaPracticeState.ts` (el almacén
// de las marcas y la lectura de la carpeta) y docs/VAULT_FORMAT.md.

import { AREA_SKILLS } from "./planAreaPractice.js";
import type { AreaKataDue, AreaPracticeView, AreaSkillProgress, AreaWeekDay, AreaWeeklyRow } from "./areaPracticeView.js";
import { areaFolderOf, areaLabelOf, areaPracticeSystem, broughtForwardKatas, declaredLevelOf, areaKataDates, kataForDay, kataLevel, levelFromDeclared, practiceAreasOf, skillOfDay, type AreaKata, type KataPlanLike } from "./areaPracticeSystem.js";
import { addDays, isoDow, weekRangesOf } from "./planTime.js";
import { weeklyPieceOf, monthlyPieceOf } from "./planAreaPractice.js";

export type DayMark = "done" | "skipped";
/** área → fecha → marca */
export type AreaMarks = Record<string, Record<string, DayMark>>;

const PP_FOLDER = "programming_practice";
const KATA_SKILL = "pp_kata";

/** Nota mínima (0–100) de un intento calificado para dar el kata por bueno: la misma que el ledger (`PASS_SCORE`). */
export const KATA_PASS_SCORE = 75;
/** Un kata solo se puede saltar si ya se hizo esta parte de los katas que tocaban hasta hoy (70 %). */
export const KATA_SKIP_MIN_RATIO = 0.7;

/**
 * ¿Este intento VERIFICA el kata? Solo cuenta un intento calificado (por la IA o por la corrección interna de NoteVault, da igual: ambos dejan
 * `verdict` y `score` en el ledger) con nota suficiente, sin haber visto la solución ni haberse rendido. Un intento sin calificar, o fallido,
 * es práctica pero no da el kata por hecho.
 */
export function kataAttemptVerified(a: Record<string, any> | undefined): boolean {
  if (!a) return false;
  const verdict = String(a.verdict ?? "ungraded").trim().toLowerCase();
  if (!verdict || verdict === "ungraded") return false;
  if (a.solution_seen || a.gave_up || String(a.outcome ?? "").trim().toLowerCase() === "gave_up") return false;
  return (parseInt(String(a.score), 10) || 0) >= KATA_PASS_SCORE;
}

/**
 * Fechas (AAAA-MM-DD) en que hubo un intento VERIFICADO del kata diario (`pp_kata`; ver `kataAttemptVerified`), de todos los intentos de la vault.
 * Con `area` solo cuentan los katas de ESA área: los intentos cuya skill es `pp_kata:<área>` o cuya nota vive en `programming_practice/<carpeta>/katas/`.
 * Sin `area` cuenta todos los katas (el kata global de siempre).
 */
export function kataDatesOf(attempts: Record<string, Record<string, any>>, area?: { id: string; folder: string }): Set<string> {
  const out = new Set<string>();
  const marker = area ? `/${PP_FOLDER}/${area.folder}/katas/`.toLowerCase() : "";
  for (const data of Object.values(attempts)) {
    const notePath = area ? `/${String(data?.note_path ?? "").replace(/\\/g, "/")}`.toLowerCase() : "";
    for (const a of Array.isArray(data?.attempts) ? data.attempts : []) {
      const skill = String(a?.skill ?? "");
      const mode = String(a?.mode ?? "");
      if (area) {
        const mine = skill === `${KATA_SKILL}:${area.id}` || mode === `${KATA_SKILL}:${area.id}` || ((skill === KATA_SKILL || mode === KATA_SKILL) && notePath.includes(marker));
        if (!mine) continue;
      } else if (skill !== KATA_SKILL && mode !== KATA_SKILL) continue;
      if (!kataAttemptVerified(a)) continue;
      const d = String(a?.at ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.add(d);
    }
  }
  return out;
}

/** Los retos verificados distintos cuentan por archivo, incluso si se completan el mismo día. */
export function verifiedKataFilesOf(attempts: Record<string, Record<string, any>>, area: { id: string; folder: string }): Set<string> {
  const out = new Set<string>();
  const marker = `/${PP_FOLDER}/${area.folder}/katas/`.toLowerCase();
  for (const data of Object.values(attempts)) {
    const notePath = `/${String(data?.note_path ?? "").replace(/\\/g, "/")}`.toLowerCase();
    if (!notePath.includes(marker)) continue;
    const valid = (Array.isArray(data?.attempts) ? data.attempts : []).some((attempt: Record<string, any>) => {
      const skill = String(attempt?.skill ?? ""); const mode = String(attempt?.mode ?? "");
      return (skill === KATA_SKILL || mode === KATA_SKILL || skill === `${KATA_SKILL}:${area.id}` || mode === `${KATA_SKILL}:${area.id}`) && kataAttemptVerified(attempt);
    });
    if (valid) out.add(notePath);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z][a-z0-9-]{0,30}$/;

/** Lee las marcas guardadas (descarta lo que no sea válido). */
export function sanitizeMarks(raw: unknown): AreaMarks {
  const out: AreaMarks = {};
  const marks = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).marks : undefined) as Record<string, unknown> | undefined;
  for (const [area, days] of Object.entries(marks && typeof marks === "object" ? marks : {})) {
    if (!ID_RE.test(area) || !days || typeof days !== "object") continue;
    for (const [date, v] of Object.entries(days as Record<string, unknown>)) {
      if (DATE_RE.test(date) && (v === "done" || v === "skipped")) (out[area] ??= {})[date] = v;
    }
  }
  return out;
}

// ── Estado derivado ─────────────────────────────────────────────────────

export interface AreaPracticeInput {
  plan: KataPlanLike & { id: string; programmingPractice?: KataPlanLike["programmingPractice"] & { weeklyProject?: { weeks: Array<{ week: number; focus: string }> }; monthlyProject?: { blocks: Array<{ fromWeek: number; toWeek: number; theme?: string }> } } };
  today: string;
  attempts: Record<string, Record<string, any>>;
  marks: AreaMarks;
  /** carpeta de áreas existentes y archivos de kata que ya existen (rutas relativas a `programming_practice/`) */
  existing: { folders: ReadonlySet<string>; files: ReadonlySet<string> };
}

/** Primera frase del enunciado, para la tarjeta («Design the HTTP API for loans…»). */
export const kataSummary = (k: AreaKata): string => {
  const m = /\*\*Task \([^)]*\)\.\*\*\s*([^\n]+)/.exec(k.statement);
  return (m?.[1] ?? k.title).slice(0, 220);
};

/** La regla para saltar un kata: hace falta haber hecho (verificado) al menos el 70 % de los que tocaban hasta hoy. */
export function kataSkipRule(done: number, planned: number): { allowed: boolean; pct: number; neededPct: number } {
  const ratio = planned > 0 ? done / planned : 1;
  return { allowed: ratio >= KATA_SKIP_MIN_RATIO, pct: Math.round(ratio * 100), neededPct: Math.round(KATA_SKIP_MIN_RATIO * 100) };
}

export function deriveAreaPractice(inp: AreaPracticeInput): AreaPracticeView[] {
  const { plan, today } = inp;
  const ranges = weekRangesOf(plan.start, plan.end);
  const out: AreaPracticeView[] = [];
  for (const a of practiceAreasOf(plan)) {
    const sys = areaPracticeSystem(a.areaId);
    const allDates = areaKataDates(plan, a.areaId);
    if (!sys) continue;
    const folder = areaFolderOf(a.areaId);
    const attemptDates = kataDatesOf(inp.attempts, { id: a.areaId, folder });
    const marks = inp.marks[a.areaId] ?? {};
    const stateOf = (d: string): "done" | "skipped" | "pending" => (attemptDates.has(d) || marks[d] === "done" ? "done" : marks[d] === "skipped" ? "skipped" : "pending");
    // Katas ADELANTADOS ya hechos (marcados hechos, o con un intento verificado ese día si no era día de kata): se CONSUMEN una vez. Su fecha
    // original deja de listarse y de contarse, y el resto de la secuencia sigue su orden sin saltarse ni repetir contenido.
    const consumedIdx: number[] = [];
    const extraDoneDates = new Set<string>();
    for (const x of broughtForwardKatas(plan, a.areaId)) {
      const idx = allDates.indexOf(x.kataDate) + 1;
      if (idx < 1 || consumedIdx.includes(idx)) continue;
      const byAttempt = x.date <= today && !allDates.includes(x.date) && attemptDates.has(x.date);
      if (!x.done && !byAttempt) continue;
      consumedIdx.push(idx);
      if (byAttempt) extraDoneDates.add(x.date);
    }
    const consumed = new Set(consumedIdx);
    const origIdx: number[] = [];
    allDates.forEach((_, i) => { if (!consumed.has(i + 1)) origIdx.push(i + 1); });
    const dates = origIdx.map((i) => allDates[i - 1]!);
    const orig = (pos: number): number => origIdx[pos - 1] ?? pos;
    const past = dates.filter((d) => d <= today);
    // El contenido NO avanza con el calendario: el kata que toca es el siguiente a los que de verdad se hicieron (intento verificado o marca «hecho»),
    // sin importar en qué fecha. Los días de kata solo marcan el ritmo previsto (qué toca «hoy» y cuántos van atrasados).
    const doneAll = new Set<string>([...attemptDates, ...Object.entries(marks).filter(([, v]) => v === "done").map(([d]) => d)]);
    for (const d of extraDoneDates) doneAll.delete(d);
    // Conserva el cómputo histórico por día y permite avanzar varios retos verificados en un día.
    // Los adelantados ya consumidos se cuentan por separado para evitar duplicarlos.
    const completedIndices = new Set([...verifiedKataFilesOf(inp.attempts, { id: a.areaId, folder })]
      .map((file) => Number(/\/(\d+) [^/]+$/.exec(file)?.[1] ?? 0))
      .filter((index) => index > 0 && index <= allDates.length && !consumed.has(index)));
    const doneCount = Math.max(doneAll.size, completedIndices.size);
    // Los registros antiguos solo guardaban el día: preserva ese progreso completando huecos en orden,
    // pero no confundas un reto posterior verificado con el primero de la ruta.
    for (let i = 1; completedIndices.size < doneCount && i <= dates.length; i++) completedIndices.add(orig(i));
    const doneDates = past.filter((d) => stateOf(d) === "done");
    const declared = declaredLevelOf(plan.preconditions?.levels, a.areaId);
    const level = kataLevel(declared, doneCount);
    // racha: días de kata seguidos con kata hecho hasta hoy (hoy abierto no la corta)
    const todayPlanned = dates.includes(today);
    const closed = todayPlanned && stateOf(today) !== "done" ? past.slice(0, -1) : past;
    let streak = 0;
    for (let i = closed.length - 1; i >= 0 && stateOf(closed[i]!) === "done"; i--) streak++;

    // katas hechos por habilidad (el kata nº i usa la habilidad `skillOfDay(i)`) frente a los que tocaban hasta hoy
    const skills: AreaSkillProgress[] = (AREA_SKILLS[a.areaId] ?? []).map((s) => ({ id: s.id, name: s.name, why: s.why, measure: s.measure, levels: s.levels, done: 0, planned: 0, pct: 0 }));
    const lastCompletedPosition = Math.max(0, ...[...completedIndices].map((index) => origIdx.indexOf(index) + 1));
    for (let i = 1; i <= Math.max(past.length, doneCount, lastCompletedPosition); i++) {
      const row = skills.find((s) => s.id === skillOfDay(a.areaId, orig(i))?.id);
      if (!row) continue;
      if (i <= past.length) row.planned++;
      if (completedIndices.has(orig(i))) row.done++;
    }
    for (const j of consumedIdx) {
      const row = skills.find((s) => s.id === skillOfDay(a.areaId, j)?.id);
      if (row) { row.planned++; row.done++; }
    }
    for (const s of skills) s.pct = s.planned ? Math.min(100, Math.round((s.done / s.planned) * 100)) : 0;

    // el siguiente kata SIN HACER (nº doneCount+1) y la fecha prevista en el calendario
    const nextIndex = dates.findIndex((_, i) => !completedIndices.has(orig(i + 1))) + 1;
    const plannedDate = nextIndex ? dates[nextIndex - 1] : undefined;
    // si ya le tocaba y hoy es día de kata, es «el kata de hoy» (aunque su fecha original fuera antes); si va adelantado, su fecha prevista
    const nextDate = plannedDate && plannedDate <= today && todayPlanned ? today : plannedDate;
    const nextDay = nextIndex ? orig(nextIndex) : 0;
    const nextKata = nextIndex ? kataForDay(a.areaId, nextDay, level) : null;
    const rel = nextKata ? `${folder}/katas/${nextKata.file}` : "";

    // lo pendiente: solo el siguiente kata, y solo si ya le tocaba (si va adelantado a lo previsto no se lista como atrasado)
    const due: AreaKataDue[] = [];
    if (nextKata && nextDate && plannedDate && plannedDate <= today) {
      due.push({ day: nextDay, date: nextDate, state: marks[nextDate] === "skipped" ? "skipped" : "pending", today: nextDate === today, title: nextKata.title, skillName: nextKata.skillName, level: nextKata.level, minutes: nextKata.minutes, summary: kataSummary(nextKata), rel, fileReady: inp.existing.files.has(rel) });
    }

    // semana de lunes a domingo que contiene hoy (o la última del plan)
    const mon = addDays(today, 1 - isoDow(today));
    const week: AreaWeekDay[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(mon, i);
      const idx = dates.indexOf(date) + 1;
      return { date, dow: i + 1, planned: idx > 0, state: idx > 0 ? (completedIndices.has(orig(idx)) ? "done" : date > today ? "pending" : stateOf(date) === "skipped" ? "skipped" : "pending") : "none", today: date === today, ...(idx > 0 ? { index: orig(idx) } : {}) };
    });

    // semanas del plan: título del proyecto del área, habilidades de sus katas, foco del proyecto full stack
    const focusWeeks = new Map((plan.programmingPractice?.weeklyProject?.weeks ?? []).map((w) => [w.week, w.focus]));
    const weeks: AreaWeeklyRow[] = ranges.map((r, i) => {
      const inWeek = dates.filter((d) => d >= r.start && d <= r.end);
      const skillNames = [...new Set(inWeek.map((d) => skillOfDay(a.areaId, allDates.indexOf(d) + 1)?.name ?? "").filter(Boolean))];
      const piece = weeklyPieceOf(a.areaId, i + 1, skillNames);
      return {
        week: i + 1,
        start: r.start,
        end: r.end,
        title: piece?.title ?? `Proyecto semanal ${i + 1}`,
        skills: skillNames,
        focus: focusWeeks.get(i + 1) === a.areaId,
        current: today >= r.start && today <= r.end,
        doneKatas: inWeek.filter((d) => completedIndices.has(orig(dates.indexOf(d) + 1))).length,
        katas: inWeek.length,
      };
    });
    const cur = weeks.find((w) => w.current) ?? weeks.find((w) => w.start > today) ?? weeks[weeks.length - 1];
    const curPiece = cur ? weeklyPieceOf(a.areaId, cur.week, cur.skills) : null;
    const month = monthlyPieceOf(a.areaId, "");
    out.push({
      areaId: a.areaId,
      label: areaLabelOf(a.areaId),
      folder,
      folderReady: inp.existing.folders.has(folder),
      purpose: sys.purpose,
      name: sys.name,
      languages: sys.languages,
      ledgerSkill: sys.ledgerSkill,
      level,
      levelSource: doneCount >= 40 && level > levelFromDeclared(declared) ? "measured" : "declared",
      skills,
      kata: {
        skip: kataSkipRule(doneDates.length, past.length),
        plannedDays: past.length,
        doneDays: doneCount,
        completedIndices: [...new Set([...completedIndices, ...consumedIdx])].sort((x, y) => x - y),
        streak,
        todayPlanned,
        todayDone: todayPlanned && stateOf(today) === "done",
        todayIndex: todayPlanned ? nextDay : 0,
        next: nextKata && nextDate ? { kata: nextKata, date: nextDate, rel, fileReady: inp.existing.files.has(rel), summary: kataSummary(nextKata) } : null,
        week,
        due,
        consumed: consumedIdx.map((i) => allDates[i - 1]!).sort(),
      },
      weekly: { title: curPiece?.title ?? sys.weekly.title, description: curPiece?.description ?? sys.weekly.summary, week: cur?.week ?? null, focus: !!cur?.focus },
      weeks,
      monthly: { title: month?.title.replace(/ · $/, "") ?? sys.monthly.title, description: month?.description ?? sys.monthly.summary, blocks: plan.programmingPractice?.monthlyProject?.blocks ?? [] },
    });
  }
  return out;
}

