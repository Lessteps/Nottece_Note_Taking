// Verificación de metodología — qué áreas del currículo de referencia mira cada pestaña, y el PROMPT para que cualquier IA (Antigravity, un modelo
// remoto, un chat) revise los temas y diga cuáles faltan o deben partirse en subtemas. Puro y determinista: sin disco, red ni IA.

export interface MethodologyScope {
  /** `all` = todas las áreas del plan; `area` = un área del plan (subplan); `group` = una asignatura dentro de un área */
  kind: "all" | "area" | "group";
  /** nombre visible: «Todas las áreas», «Frontend», «HTML» */
  label: string;
  areaName?: string;
  /** id de la asignatura (`html`, `css`, el de un lenguaje…) */
  groupId?: string;
  groupTitle?: string;
}

export interface ScopeTopic {
  folder: string;
  title: string;
  group?: string;
}

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Ids de las áreas del currículo de referencia (`html`, `css`, `atomic-design`, `js-reference`, `java`, `python`, `javascript`, `typescript`, `electron`, `backend`, `databases`, `automation`, `mobile`, `tooling`) que cuenta un texto («HTML», «JavaScript», «Frontend»…). */
export function curriculumIdsOfText(text: string): string[] {
  const t = fold(text);
  const out: string[] = [];
  if (/\bhtml\b/.test(t)) out.push("html");
  if (/\bcss\b/.test(t)) out.push("css");
  if (/atomic/.test(t)) out.push("atomic-design");
  if (/javascript|\bjs\b|typescript|\bts\b/.test(t)) out.push("js-reference");
  if (/javascript|\bjs\b/.test(t)) out.push("javascript");
  if (/typescript|\bts\b/.test(t)) out.push("typescript");
  if (/python/.test(t)) out.push("python");
  if (/\bjava\b/.test(t)) out.push("java");
  // áreas de conocimiento con su propio currículo de referencia
  if (/electron|desktop/.test(t)) out.push("electron");
  if (/backend|back-end/.test(t)) out.push("backend");
  if (/database|base de datos|bases de datos|\bsql\b|postgres|mysql|sqlite/.test(t)) out.push("databases");
  if (/automation|automatiz/.test(t)) out.push("automation");
  if (/mobile|movil/.test(t)) out.push("mobile");
  if (/tooling|quality/.test(t)) out.push("tooling");
  if (/frontend|front-end|front end/.test(t)) for (const id of ["html", "css", "atomic-design", "js-reference"]) if (!out.includes(id)) out.push(id);
  return out;
}

/** Áreas del currículo que verifica un alcance. Vacío = no hay referencia para ese alcance (p. ej. Python): se dice, no se inventa. */
export function curriculumIdsOfScope(scope: Pick<MethodologyScope, "kind" | "areaName" | "groupId" | "groupTitle">, allIds: readonly string[]): string[] {
  if (scope.kind === "all") return [...allIds];
  const ids = scope.kind === "group" ? curriculumIdsOfText(`${scope.groupId ?? ""} ${scope.groupTitle ?? ""}`) : curriculumIdsOfText(scope.areaName ?? "");
  return ids.filter((id) => allIds.includes(id));
}

/**
 * Reglas de metodología que la IA debe aplicar al revisar. Es el mismo criterio que usa el catálogo: en materias que se aprenden por patrones
 * (HTML, CSS, funciones y métodos de un lenguaje) hay UNA nota por elemento / propiedad / método; los temas grandes se parten en subtemas lineales.
 */
export const METHODOLOGY_RULES: readonly string[] = [
  "Choose a learning methodology appropriate to the subject, learner's current level and goal. Explain the choice and how notes, exercises, feedback and spaced review support it.",
  "Split broad topics only when that makes learning and practice clearer. For HTML elements and CSS properties, consider individual reference topics where useful; do not impose that structure on other subjects.",
  "Place prerequisites before dependent concepts and connect theory to realistic practice. Explain dependencies and identify missing or duplicated topics.",
  "For every recommendation explain its educational purpose, assessment method and how it fits the existing plan. Ask the learner for missing context instead of inventing it.",
];

/** El prompt de revisión: temas del alcance + reglas → la IA contesta qué temas faltan y cuáles partir. */
export function reviewPrompt(scope: MethodologyScope, topics: readonly ScopeTopic[], areaFolders: readonly string[] = []): string {
  const list = topics.length ? topics.map((t) => `- ${t.title}${t.group ? ` [${t.group}]` : ""} (${t.folder})`).join("\n") : "(no topics yet)";
  return [`Evaluate the learning methodology for «${scope.label}». The topic list is context; do not audit or reorder the plan.`, "", "## Principles", ...METHODOLOGY_RULES.map((r, i) => `${i + 1}. ${r}`), "", "## Current topics for context", list, ...(areaFolders.length ? ["", "## Scope folders", ...areaFolders.map((f) => `- ${f}`)] : []), "", "## Response", "1. Suitable learning approach and why it fits the subject and learner.", "2. How theory and examples should teach the concepts.", "3. Practice, feedback and assessment strategies, with examples.", "4. Review and evidence of mastery; adaptations for difficulty or missing context.", "5. Questions for the learner and limitations. Do not reorder topics or modify files."].join("\n");
}

/** Prompt para que una IA externa revise qué ÁREAS faltan en el plan (no los temas de cada una). */
export function areasReviewPrompt(planAreas: ReadonlyArray<{ name: string; topics: number }>, vaultFolders: ReadonlyArray<{ label: string; topics: number }>): string {
  return [
    "Review the AREAS of my study plan (not the topics inside them) and tell me which areas or subjects are MISSING for a working junior full-stack developer.",
    "",
    "## Areas in the plan",
    ...(planAreas.length ? planAreas.map((a) => `- ${a.name} (${a.topics} topics)`) : ["(none)"]),
    "",
    "## Vault folders with topics that are NOT in the plan",
    ...(vaultFolders.length ? vaultFolders.map((f) => `- ${f.label} (${f.topics} topics)`) : ["(none)"]),
    "",
    "## Rules",
    ...METHODOLOGY_RULES.map((r, i) => `${i + 1}. ${r}`),
    "",
    "## Answer format",
    "1. **Missing areas** — name, why it matters, and the sub-subjects it needs (for patterns subjects like HTML and CSS: one topic per element / property).",
    "2. **Vault folders to add to the plan** — which of the listed folders belong in the plan, and as a new area or as a subject of an existing one.",
    "3. **Areas that should be split** — any area mixing unrelated subjects.",
  ].join("\n");
}

/** El orden que una IA devolvió en el bloque ```json de su respuesta (`{ "order": [carpetas] }`), o null si no hay uno usable. Solo texto: la app valida contra el plan. */
export function parseOrderReply(text: string): string[] | null {
  const blocks = [...String(text ?? "").matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]!);
  for (const b of blocks.reverse()) {
    try {
      const obj = JSON.parse(b) as { order?: unknown };
      if (Array.isArray(obj.order)) {
        const order = obj.order.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 400);
        if (order.length) return order.slice(0, 2000);
      }
    } catch {
      /* no era JSON */
    }
  }
  return null;
}
