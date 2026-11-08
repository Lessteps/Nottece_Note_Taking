// Catálogo de temas de la vault para la sub-vista «Temas» del plan: TODOS los temas (no solo los del plan) con lo que existe de cada uno
// (nota de teoría, contrato de la nota, mapa .canvas, manifiesto .practica.md, ejercicios), su puntuación de diseño y, si están en el plan,
// su área, su semana objetivo y si ya se completó. Módulo PURO y compartido (API y renderer): sin node:* ni DOM; no lee nada, recibe lo
// ya escaneado y devuelve filas; los filtros, los contadores y el orden también viven aquí para poder probarlos sin la vista.

import { routeOf, type TopicRoute } from "./planRoute.js";
import type { TopicDesign, TopicDesignType } from "./topicDesign.js";

/** Una fila del catálogo: un tema de la vault (o del plan, aunque su carpeta aún no exista). */
export interface PlanTopicRow {
  folder: string;
  title: string;
  /** rama de la vault (2.º tramo de la ruta, sin la numeración) */
  branch: string;
  /** el tema está en la lista de temas del plan */
  inPlan: boolean;
  /** área del plan (solo si está en el plan) */
  area?: string;
  targetWeek?: number;
  completedAt?: string;
  route?: TopicRoute;
  /** la carpeta del tema existe en la vault */
  exists: boolean;
  topicType: TopicDesignType | "unknown";
  /** nota de teoría `.md` */
  theory: boolean;
  /** la nota cumple el contrato de estructura; `null` = no se pudo juzgar (sin nota, o no aplica) */
  contract: boolean | null;
  /** mapa `.canvas` */
  canvas: boolean;
  /** manifiesto `.practica.md` / `_tema.md` con skills */
  manifest: boolean;
  /** skills del manifiesto (0 sin manifiesto) */
  skills: number;
  exercises: number;
  /** ejercicios que pide el plan del tema, cuando se conoce */
  planExercises?: number;
  /** 0-100, puntuación de diseño; `null` si no se calculó */
  score: number | null;
  complete: boolean;
  /** número de faltantes de diseño */
  gaps: number;
  /** piezas hechas con una versión anterior de su skill (la skill cambió después de generarlas); ver `api/modules/skillFreshness.ts` */
  outdated?: OutdatedSkills;
}

/** Qué piezas de un tema quedaron atrás respecto de su skill: la nota de teoría, el mapa explicativo y el manifiesto `.practica`. */
export interface OutdatedSkills {
  theory?: true;
  canvas?: true;
  practica?: true;
  exercises?: true;
}

export type PlanTopicCatalog = PlanTopicRow[];

/** Lo que hace falta de un tema de la vault (de `topicSnaps`). */
export interface CatalogSnapInput {
  folder: string;
  title: string;
  theoryNotes: number;
  exerciseCount: number;
  planExercises?: number;
  skills: number;
}

/** Lo que hace falta de un tema del plan. */
export interface CatalogPlanTopicInput {
  folder: string;
  title: string;
  area: string;
  targetWeek: number;
  completedAt?: string;
  route?: string;
}

export const cleanBranchName = (n: string): string => n.replace(/^[\d.\s_-]+/, "");

/** La rama de una carpeta de tema: «Programación/4 Backend/4.3 REST» → «Backend». Sin 2.º tramo, el primero. */
export function branchOfFolder(folder: string): string {
  const parts = folder.split("/").filter(Boolean);
  const seg = parts.length > 2 ? parts[1]! : parts[0] ?? "";
  return cleanBranchName(seg) || seg;
}

/** Orden natural de carpetas («2 Backend» antes de «10 Frontend», «4.3» antes de «4.10»). */
export const folderCompare = (a: string, b: string): number => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

/** Une los temas de la vault con los del plan y su diseño. Un tema del plan que no está en la vault igual sale (sin nada creado). */
export function buildPlanTopicRows(
  snaps: ReadonlyArray<CatalogSnapInput>,
  plan: ReadonlyArray<CatalogPlanTopicInput>,
  designs: ReadonlyMap<string, TopicDesign>,
): PlanTopicRow[] {
  const byFolder = new Map<string, PlanTopicRow>();
  const planOf = new Map(plan.map((p) => [p.folder, p] as const));
  const make = (folder: string, title: string, snap?: CatalogSnapInput): PlanTopicRow => {
    const d = designs.get(folder);
    const item = (id: string) => d?.items.find((i) => i.id === id);
    const p = planOf.get(folder);
    const theoryItem = item("theory");
    const contractItem = item("contract");
    const manifestItem = item("manifest");
    const canvasItem = item("canvas");
    return {
      folder,
      title,
      branch: branchOfFolder(folder),
      inPlan: !!p,
      ...(p ? { area: p.area, targetWeek: p.targetWeek, route: routeOf(p), ...(p.completedAt ? { completedAt: p.completedAt } : {}) } : {}),
      exists: !!snap || (d ? !d.gaps.some((g) => g.fix === "topic") : false),
      topicType: d?.topicType ?? "unknown",
      theory: theoryItem ? theoryItem.ok : (snap?.theoryNotes ?? 0) > 0,
      contract: contractItem ? contractItem.ok : null,
      canvas: !!canvasItem?.ok,
      manifest: manifestItem ? manifestItem.ok : (snap?.skills ?? 0) > 0,
      skills: snap?.skills ?? 0,
      exercises: snap?.exerciseCount ?? 0,
      ...(snap?.planExercises ? { planExercises: snap.planExercises } : {}),
      score: d ? d.score : null,
      complete: !!d?.complete,
      gaps: d?.gaps.length ?? 0,
    };
  };
  for (const s of snaps) byFolder.set(s.folder, make(s.folder, s.title, s));
  for (const p of plan) if (!byFolder.has(p.folder)) byFolder.set(p.folder, make(p.folder, p.title));
  return [...byFolder.values()].sort((a, b) => folderCompare(a.folder, b.folder));
}

// ── Filtros, contadores y orden (los usa la vista) ─────────────────────

/** Qué le falta a un tema, para los chips. */
export const MISSING_FILTERS = ["sin-nota", "sin-mapa", "sin-practica", "sin-ejercicios", "completos"] as const;
export type MissingFilter = (typeof MISSING_FILTERS)[number];
export const MISSING_LABEL: Record<MissingFilter, string> = {
  "sin-nota": "Sin nota",
  "sin-mapa": "Sin mapa",
  "sin-practica": "Sin .practica",
  "sin-ejercicios": "Sin ejercicios",
  completos: "Completos",
};

export const matchesMissing = (r: PlanTopicRow, f: MissingFilter): boolean => {
  switch (f) {
    case "sin-nota": return !r.theory;
    case "sin-mapa": return !r.canvas;
    case "sin-practica": return !r.manifest;
    case "sin-ejercicios": return r.exercises === 0;
    case "completos": return r.complete;
  }
};

export interface CatalogCounters { topics: number; withNote: number; withCanvas: number; withPractica: number; withExercises: number; complete: number }

export function catalogCounters(rows: ReadonlyArray<PlanTopicRow>): CatalogCounters {
  return {
    topics: rows.length,
    withNote: rows.filter((r) => r.theory).length,
    withCanvas: rows.filter((r) => r.canvas).length,
    withPractica: rows.filter((r) => r.manifest).length,
    withExercises: rows.filter((r) => r.exercises > 0).length,
    complete: rows.filter((r) => r.complete).length,
  };
}

export interface CatalogFilter {
  query?: string;
  /** rama (nombre sin numeración); vacío o ausente = todas */
  branch?: string;
  /** todos los chips marcados tienen que cumplirse */
  missing?: ReadonlyArray<MissingFilter>;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterCatalog(rows: ReadonlyArray<PlanTopicRow>, f: CatalogFilter): PlanTopicRow[] {
  const q = fold((f.query ?? "").trim());
  return rows.filter((r) => {
    if (f.branch && r.branch !== f.branch) return false;
    if (f.missing?.some((m) => !matchesMissing(r, m))) return false;
    if (q && !fold(`${r.title} ${r.folder} ${r.area ?? ""}`).includes(q)) return false;
    return true;
  });
}

export type CatalogSort = "plan" | "folder";

/** «plan»: los del plan primero por semana objetivo (y carpeta); los de fuera del plan al final, por carpeta. «folder»: orden de carpetas. */
export function sortCatalog(rows: ReadonlyArray<PlanTopicRow>, by: CatalogSort): PlanTopicRow[] {
  const out = [...rows];
  if (by === "folder") return out.sort((a, b) => folderCompare(a.folder, b.folder));
  return out.sort((a, b) => {
    if (a.inPlan !== b.inPlan) return a.inPlan ? -1 : 1;
    const w = (a.targetWeek ?? 0) - (b.targetWeek ?? 0);
    return w || folderCompare(a.folder, b.folder);
  });
}

/** Las ramas distintas, en orden de aparición por carpeta. */
export function branchesOf(rows: ReadonlyArray<PlanTopicRow>): string[] {
  return [...new Set([...rows].sort((a, b) => folderCompare(a.folder, b.folder)).map((r) => r.branch))];
}

/** Las ramas conectadas a la ruta: las que tienen al menos un tema del plan. */
export const routeBranchesOf = (rows: ReadonlyArray<PlanTopicRow>): string[] => branchesOf(rows.filter((r) => r.inPlan));
