// «Temas por área»: filtro por estado y reglas de la regeneración en lote (qué se puede regenerar de cada tema y cuánto cuesta).
// Puro y sin React: lo usan la tabla, la barra de acciones y los tests.

import type { AreaTopicRow } from "./planAreaTopics";

export type StatusFilter = "all" | "noTheory" | "noMap" | "noPractice" | "noExercises" | "complete";
export type RegenPart = "theory" | "map" | "practice" | "exercises";
/** Una pieza, «todo» o una combinación de piezas con IA (teoría + práctica…): lo que marcan las casillas de la barra. */
export type RegenKind = RegenPart | "all" | "theory+practice" | "theory+exercises" | "practice+exercises";

/** Lo que el servidor sabe regenerar en un solo trabajo (una pieza o «todo»); una combinación se hace pieza a pieza. */
export type SingleRegen = RegenPart | "all";

/** Las piezas con IA, en el orden en que se regeneran (la práctica sale de la teoría; los ejercicios, de la práctica). */
export const AI_PARTS: ReadonlyArray<Exclude<RegenPart, "map">> = ["theory", "practice", "exercises"];

/** Las piezas que se regeneran con un tipo (`all` = teoría, práctica y ejercicios). */
export const partsOf = (kind: RegenKind): RegenPart[] => (kind === "all" ? [...AI_PARTS] : (kind.split("+") as RegenPart[]));

/** Lo que marcan las casillas → un tipo. El mapa no usa IA: solo, es «map»; con otras piezas se rehace con la teoría (o aparte, ver `mapAlone`). Sin nada marcado, `null`. */
export function kindOfChecks(checked: ReadonlySet<RegenPart>): RegenKind | null {
  const ai = AI_PARTS.filter((p) => checked.has(p));
  if (ai.length === 0) return checked.has("map") ? "map" : null;
  if (ai.length === 3) return "all";
  return ai.join("+") as RegenKind;
}
/** ¿Se pide el mapa sin la teoría y junto a otras piezas? Entonces hay que rehacerlo aparte (con la teoría ya se rehace solo). */
export const mapAlone = (checked: ReadonlySet<RegenPart>): boolean => checked.has("map") && !checked.has("theory") && AI_PARTS.some((p) => checked.has(p));

export const STATUS_FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "noTheory", label: "Falta nota" },
  { key: "noMap", label: "Falta mapa" },
  { key: "noPractice", label: "Falta práctica" },
  { key: "noExercises", label: "Falta ejercicios" },
  { key: "complete", label: "Completo" },
];

/** ¿Tiene el tema todo lo que se puede generar (nota, mapa, .practica y ejercicios)? */
export const isComplete = (r: AreaTopicRow): boolean => r.theory && r.canvas && r.manifest && r.exercises > 0;

export function matchesStatus(r: AreaTopicRow, f: StatusFilter): boolean {
  switch (f) {
    case "noTheory": return !r.theory;
    case "noMap": return !r.canvas;
    case "noPractice": return !r.manifest;
    case "noExercises": return r.exercises === 0;
    case "complete": return isComplete(r);
    default: return true;
  }
}

export const LABEL: Record<RegenKind, string> = {
  theory: "Regenerar teoría",
  map: "Regenerar mapa",
  practice: "Regenerar práctica",
  exercises: "Regenerar ejercicios",
  all: "Regenerar todo",
  "theory+practice": "Regenerar teoría y práctica",
  "theory+exercises": "Regenerar teoría y ejercicios",
  "practice+exercises": "Regenerar práctica y ejercicios",
};
/** «la teoría», «el mapa»… para los mensajes. */
export const OBJECT: Record<RegenKind, string> = { theory: "la teoría", map: "el mapa", practice: "la práctica", exercises: "los ejercicios", all: "todo", "theory+practice": "la teoría y la práctica", "theory+exercises": "la teoría y los ejercicios", "practice+exercises": "la práctica y los ejercicios" };
/** Forma corta para el progreso («teoría…»). */
export const SHORT: Record<RegenKind, string> = { theory: "teoría", map: "mapa", practice: "práctica", exercises: "ejercicios", all: "todo", "theory+practice": "teoría y práctica", "theory+exercises": "teoría y ejercicios", "practice+exercises": "práctica y ejercicios" };

/**
 * Por qué NO se puede regenerar eso de ese tema ("" si se puede). La IA en modo puente YA NO bloquea: queda el motor «agente externo»
 * (Antigravity / Claude Code), que no usa la IA de la app; el selector de motor del diálogo desactiva los que no se pueden. _bridge se conserva
 * por compatibilidad con quien aún lo pasa.
 */
export function regenBlockedReason(row: AreaTopicRow, what: RegenKind, _bridge = false): string {
  if (row.route === "skipped") return "El tema está fuera del plan: no se regenera.";
  if (!row.exists) return "El tema aún no existe en la vault: usa «Generar todo».";
  const parts = partsOf(what);
  // si se rehace la práctica, ella da las competencias de los ejercicios y no exige nada previo (como «todo»)
  if (parts.includes("practice")) return "";
  if ((parts.includes("theory") || parts.includes("map")) && !row.theory) return "Este tema no tiene teoría todavía: usa «Generar todo».";
  if (parts.includes("exercises") && !row.manifest) return "Primero genera la práctica (.practica) del tema: de ahí salen las competencias.";
  return "";
}

/**
 * ¿Le faltan ejercicios al tema? Sin ninguno, o con menos de los que pide el plan de su `.practica`. Si ni siquiera tiene `.practica`,
 * se piden práctica + ejercicios (de la práctica salen las competencias). `null` si no falta nada o el tema no existe / está fuera del plan.
 */
export function exercisesGap(row: AreaTopicRow): { what: RegenKind; missing: number; title: string } | null {
  if (!row.exists || row.route === "skipped" || !row.theory) return null;
  const want = Math.max(1, row.planExercises ?? 1);
  const missing = Math.max(0, want - row.exercises);
  if (row.exercises > 0 && missing === 0) return null;
  if (!row.manifest) return { what: "practice+exercises", missing, title: "El tema no tiene práctica ni ejercicios: generar la .practica y sus ejercicios" };
  return row.exercises === 0
    ? { what: "exercises", missing, title: "El tema no tiene ejercicios: generarlos a partir de su .practica" }
    : { what: "exercises", missing, title: `Tiene ${row.exercises} de ${want} ejercicios: completar los que faltan` };
}

/** Llamadas a la IA que aproximadamente cuesta regenerar `what` en un tema (el mapa no usa IA). */
export function estimateAiCalls(row: AreaTopicRow, what: RegenKind): number {
  const exercises = Math.max(3, row.planExercises ?? row.exercises);
  const per: Record<RegenPart, number> = { theory: 1, map: 0, practice: 1, exercises };
  return partsOf(what).reduce((n, p) => n + per[p], 0);
}

export interface BulkPlan {
  what: RegenKind;
  /** temas que sí se regeneran */
  run: AreaTopicRow[];
  /** temas omitidos y por qué */
  skipped: Array<{ row: AreaTopicRow; reason: string }>;
  aiCalls: number;
}

export function planBulk(rows: ReadonlyArray<AreaTopicRow>, what: RegenKind, bridge: boolean): BulkPlan {
  const run: AreaTopicRow[] = [];
  const skipped: BulkPlan["skipped"] = [];
  for (const row of rows) {
    const reason = regenBlockedReason(row, what, bridge);
    if (reason) skipped.push({ row, reason });
    else run.push(row);
  }
  return { what, run, skipped, aiCalls: run.reduce((n, r) => n + estimateAiCalls(r, what), 0) };
}
