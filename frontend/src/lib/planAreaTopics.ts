// Plan, sub-vista «Temas por área»: las pestañas (una por área del plan, calculadas a partir del plan) y, dentro de cada área, las pestañas de
// sus grupos (Bases, Lenguaje, Conocimientos…) y las filas de temas con lo que existe de cada uno. Módulo PURO: no lee nada; une el plan con
// el catálogo de la vault (`lib/planTopicCatalog.ts`), para que la vista se actualice sola cuando cambian las áreas o los temas del plan.

import { areaKeyOf } from "./planCoverage.js";
import type { OutdatedSkills, PlanTopicRow } from "./planTopicCatalog.js";
import type { MentorPlan, MentorSubplan } from "./types.js";

/** Una pestaña de área. */
export interface AreaTab {
  /** clave estable del área (`areaId` o id del subplan): es la que usa el alcance de «Ejecutar plan» */
  key: string;
  area: string;
  subplanId: string;
  total: number;
  done: number;
  /** temas del plan (en ruta) a los que aún les falta nota, mapa, .practica o ejercicios */
  missing: number;
}

/** Una pestaña de grupo dentro de un área; `id === ""` es «Todos». */
export interface GroupTab {
  id: string;
  title: string;
  total: number;
  missing: number;
}

/** Una fila: un tema del plan con lo que existe de él en la vault. */
export interface AreaTopicRow {
  folder: string;
  title: string;
  week: number;
  group: string;
  completed: boolean;
  route: "core" | "optional" | "skipped";
  /** lo que existe; sin fila de catálogo (tema del plan que aún no está en la vault) todo es «falta» */
  exists: boolean;
  theory: boolean;
  canvas: boolean;
  manifest: boolean;
  exercises: number;
  planExercises?: number;
  /** le falta algo de lo que se puede generar */
  incomplete: boolean;
  /** piezas hechas con una versión anterior de su skill: piden regenerarse (botón verde) */
  outdated?: OutdatedSkills;
  practiceMismatch?: boolean;
}

import type { PlanSchedule } from "./planSchedule.js";

const naturalCmp = (a: string, b: string): number => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

const routeOf = (r: string | undefined): AreaTopicRow["route"] => (r === "optional" || r === "skipped" ? r : "core");

/** Lo que le falta a una fila para poder generarse (el catálogo ya dice si está «completo» según el diseño). */
export const needsGenerate = (r: PlanTopicRow | undefined): boolean => !r || !r.complete || !r.theory || !r.canvas || !r.manifest || r.exercises === 0;

/** Id del grupo «Bases» de un área (los fundamentos no son de la ruta de ningún área: van en su propia pestaña). */
const basesGroupOf = (sub: MentorSubplan): string | undefined => (sub.groups ?? []).find((g) => g.kind === "bases")?.id;

/** Clave de la pestaña virtual de Bases. */
export const BASES_KEY = "__bases";

/** Las filas de un área, en el orden progresivo de la ruta (según el reparto en ejecución, o por semana y orden natural). Sin Bases salvo que se pidan. */
export function areaTopicRows(sub: MentorSubplan, catalog: ReadonlyArray<PlanTopicRow>, withBases = false, schedule?: PlanSchedule): AreaTopicRow[] {
  const by = new Map(catalog.map((r) => [r.folder, r] as const));
  const bases = withBases ? undefined : basesGroupOf(sub);
  const schedOrder = new Map<string, { dayIndex: number; orderInDay: number; week: number }>();
  if (schedule) {
    schedule.days.forEach((d, dayIndex) => {
      d.topics.forEach((t, orderInDay) => {
        if (!schedOrder.has(t.folder)) {
          schedOrder.set(t.folder, { dayIndex, orderInDay, week: d.week });
        }
      });
    });
  }
  return sub.topics
    .filter((t) => !(bases && t.group === bases))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const soA = schedOrder.get(a.t.folder);
      const soB = schedOrder.get(b.t.folder);
      if (soA && soB) {
        return soA.dayIndex - soB.dayIndex || soA.orderInDay - soB.orderInDay || naturalCmp(a.t.folder, b.t.folder);
      }
      if (soA) return -1;
      if (soB) return 1;
      return a.t.targetWeek - b.t.targetWeek || naturalCmp(a.t.folder, b.t.folder) || a.i - b.i;
    })
    .map(({ t }) => {
      const c = by.get(t.folder);
      const so = schedOrder.get(t.folder);
      return {
        folder: t.folder,
        title: t.title,
        week: so?.week ?? t.targetWeek,
        group: t.group ?? "",
        completed: !!t.completedAt,
        route: routeOf(t.route),
        exists: !!c?.exists,
        theory: !!c?.theory,
        canvas: !!c?.canvas,
        manifest: !!c?.manifest,
        exercises: c?.exercises ?? 0,
        ...(c?.planExercises ? { planExercises: c.planExercises } : {}),
        incomplete: needsGenerate(c),
        ...(c?.outdated ? { outdated: c.outdated } : {}),
        ...(c?.practiceMismatch ? { practiceMismatch: true } : {}),
      };
    });
}

/** Un tema cuenta como «por generar» si está en ruta, sin completar y le falta algo. */
export const pendingGenerate = (r: AreaTopicRow): boolean => r.route !== "skipped" && !r.completed && r.incomplete;

/** Las filas de Bases de todo el plan, juntas y sin repetirse (un mismo tema de Bases suele estar en varias áreas). */
export function basesTopicRows(plan: Pick<MentorPlan, "subplans">, catalog: ReadonlyArray<PlanTopicRow>, schedule?: PlanSchedule): AreaTopicRow[] {
  const seen = new Set<string>();
  const out: AreaTopicRow[] = [];
  for (const s of plan.subplans) {
    const id = basesGroupOf(s);
    if (!id) continue;
    for (const r of areaTopicRows({ ...s, topics: s.topics.filter((t) => t.group === id && !seen.has(t.folder)) }, catalog, true, schedule)) {
      seen.add(r.folder);
      out.push(r);
    }
  }
  return out.sort((a, b) => a.week - b.week || naturalCmp(a.folder, b.folder));
}

/** Las pestañas de área, en el orden del plan (sin Bases: esa tiene su pestaña aparte, `BASES_KEY`). */
export function areaTabsOf(plan: Pick<MentorPlan, "subplans">, catalog: ReadonlyArray<PlanTopicRow>): AreaTab[] {
  return plan.subplans.map((s) => {
    const rows = areaTopicRows(s, catalog);
    return { key: areaKeyOf(s), area: s.area, subplanId: s.id, total: rows.length, done: rows.filter((r) => r.completed).length, missing: rows.filter(pendingGenerate).length };
  });
}

/** Las pestañas de grupo de un área: «Todos» y cada grupo con temas (los temas sin grupo conocido caen en «Otros»). Sin grupos, solo «Todos». */
export function groupTabsOf(sub: MentorSubplan, rows: ReadonlyArray<AreaTopicRow>): GroupTab[] {
  const groups = (sub.groups ?? []).filter((g) => g.kind !== "bases");
  const all: GroupTab = { id: "", title: "Todos", total: rows.length, missing: rows.filter(pendingGenerate).length };
  if (!groups.length) return [all];
  const known = new Set(groups.map((g) => g.id));
  const tabs: GroupTab[] = [...groups].sort((a, b) => a.order - b.order).map((g) => {
    const list = rows.filter((r) => r.group === g.id);
    return { id: g.id, title: g.title, total: list.length, missing: list.filter(pendingGenerate).length };
  });
  const rest = rows.filter((r) => !known.has(r.group));
  if (rest.length) tabs.push({ id: "__otros", title: "Otros", total: rest.length, missing: rest.filter(pendingGenerate).length });
  return [all, ...tabs];
}

/** Las filas de un grupo (`""` = todas, en orden progresivo de ejecución; un grupo concreto, en su orden natural). */
export function rowsOfGroup(sub: MentorSubplan, rows: ReadonlyArray<AreaTopicRow>, groupId: string): AreaTopicRow[] {
  if (!groupId) return [...rows];
  if (groupId === "__otros") {
    const known = new Set((sub.groups ?? []).map((g) => g.id));
    return rows.filter((r) => !known.has(r.group)).sort((a, b) => naturalCmp(a.folder, b.folder));
  }
  return rows.filter((r) => r.group === groupId).sort((a, b) => naturalCmp(a.folder, b.folder));
}
