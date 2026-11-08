/**
 * The skill catalogue: what each skill trains, which topic types it fits, and the
 * one function that turns a topic into its skills.
 *
 * The problem it solves: every `.practica` file of the vault carried the *same*
 * eight skills (audited 2026-09-29 over 41 topics), so a topic about propositions
 * and connectives offered «Cálculo rápido» drills. The selection now goes through
 * `SkillSelector`, which is a plain interface: the shipped implementation is
 * deterministic (catalogue + topic type), and an AI can replace it later without
 * touching anything else — it only has to return the same shape.
 *
 * Additive on purpose: `core/practice/skills.ts` keeps the descriptions,
 * difficulties and assistance rules the rest of the app already reads.
 */

import { ENGLISH_BRANCHES, englishSkillSpec, type EnglishArea, type EnglishBranch } from "../../lib/englishSkillData.js";
import { domainOfSubject, type TopicKey } from "./domain.js";
import { type SkillDefinition, skillsForSubject } from "./skills.js";
import { type TopicType, normaliseTopicType } from "./topicType.js";

/** What a skill certifies, in the learner's words. Used by the matrix and the picker. */
export interface SkillCompetencies {
  /** Short labels, e.g. "Rigor formal" or "Cálculo mental". */
  competencies: readonly string[];
  /** Topic types this skill is worth practising in. */
  topicTypes: readonly TopicType[];
}

/**
 * Per-skill fit, subject-agnostic (skill ids are shared across subjects).
 *
 * `drill` is procedural only, on purpose: it is the clearest case of a skill that
 * has nothing to say about a theory topic.
 */
export const SKILL_FIT: Record<string, SkillCompetencies> = {
  // ── mathematics ──────────────────────────────────────────────────────────
  solve: { competencies: ["Modelado", "Traducción del enunciado"], topicTypes: ["procedural", "mixed"] },
  process: { competencies: ["Método paso a paso", "Consolidación de la técnica"], topicTypes: ["procedural", "mixed"] },
  prove: { competencies: ["Rigor formal", "Cadena deductiva completa"], topicTypes: ["theoretical", "mixed"] },
  counterexample: { competencies: ["Casos límite", "Refutación de hipótesis"], topicTypes: ["theoretical", "mixed"] },
  true_false: { competencies: ["Discernimiento de postulados", "Justificación del veredicto"], topicTypes: ["theoretical", "mixed"] },
  find_error: { competencies: ["Detección de falacias", "Localización del paso fallido"], topicTypes: ["theoretical", "mixed"] },
  explain: { competencies: ["Claridad conceptual", "Ejemplo propio"], topicTypes: ["theoretical", "mixed"] },
  drill: { competencies: ["Cálculo mental", "Estimación y agilidad"], topicTypes: ["procedural"] },
  // ── programming ─────────────────────────────────────────────────────────
  implement: { competencies: ["Código que cumple la especificación", "Casos de borde"], topicTypes: ["procedural", "mixed"] },
  debug: { competencies: ["Causa raíz frente a síntoma", "Depuración con evidencia"], topicTypes: ["procedural", "mixed"] },
  refactor: { competencies: ["Diseño sin cambiar comportamiento", "Criterios de mejora"], topicTypes: ["procedural", "mixed"] },
  design: { competencies: ["Contratos y esquemas", "Compromisos justificados"], topicTypes: ["procedural", "mixed"] },
  commands: { competencies: ["Secuencia exacta", "Elección segura"], topicTypes: ["procedural", "mixed"] },
  cloze: { competencies: ["Reconstruir desde el contexto", "Sintaxis y tipos"], topicTypes: ["procedural", "mixed"] },
  trace: { competencies: ["Predicción de la salida", "Estado paso a paso"], topicTypes: ["procedural", "mixed"] },
  review: { competencies: ["Fallos silenciosos", "Severidad y evidencia"], topicTypes: ["procedural", "mixed"] },
  test: { competencies: ["Casos normales, límites y errores", "Pruebas que fallan si el código falla"], topicTypes: ["procedural", "mixed"] },
  analyze: { competencies: ["Coste en tiempo y memoria", "Cuello de botella"], topicTypes: ["procedural", "mixed"] },
  decompose: { competencies: ["Entradas, salidas y casos límite", "Pasos en orden"], topicTypes: ["procedural", "mixed"] },
  port: { competencies: ["Mismo comportamiento en otro lenguaje", "Idioma del destino"], topicTypes: ["procedural", "mixed"] },
  pp_kata: { competencies: ["Lógica bajo tiempo", "Patrón y complejidad"], topicTypes: ["procedural", "mixed"] },
  query: { competencies: ["Consulta correcta", "Casos límite en los datos"], topicTypes: ["procedural", "mixed"] },
  // Concept skills: what a theory topic is practised with (nothing to code, plenty to decide and justify).
  pg_true_false: { competencies: ["Discernir ideas correctas de incorrectas", "Justificar con el mecanismo"], topicTypes: ["theoretical", "mixed"] },
  pg_classify: { competencies: ["Ubicar casos en su categoría", "Criterio que decide"], topicTypes: ["theoretical", "mixed"] },
  pg_compare: { competencies: ["Distinguir conceptos parecidos", "Elegir según la situación"], topicTypes: ["theoretical", "mixed"] },
  pg_quiz: { competencies: ["Reconocer la idea correcta", "Descartar conceptos erróneos"], topicTypes: ["theoretical", "mixed"] },
  project_structure: { competencies: ["Estructura de carpetas y configuración", "Entorno y comandos en orden"], topicTypes: ["procedural", "mixed"] },
  // ── english ─────────────────────────────────────────────────────────────
  writing: { competencies: ["Producción propia", "Cohesión y registro"], topicTypes: ["procedural", "mixed"] },
  rewrite: { competencies: ["Corrección del error", "Estructura objetivo"], topicTypes: ["procedural", "mixed"] },
  translate: { competencies: ["Fidelidad de sentido", "Registro natural"], topicTypes: ["procedural", "mixed"] },
};

const DEFAULT_FIT: SkillCompetencies = { competencies: [], topicTypes: ["mixed"] };

/** A catalogue entry: the skill plus what it certifies and where it fits. */
export interface CatalogSkill extends SkillDefinition {
  competencies: readonly string[];
  /** Topic types it fits (mathematics, programming). Empty for English skills. */
  topicTypes: readonly TopicType[];
  /** English only: the branches it can be practised in (vocabulary skills fit all of them). */
  branches?: readonly EnglishBranch[];
  /** English only: the branch it belongs to, or `vocabulary` for the cross-cutting layer. */
  area?: EnglishArea;
  /** True when it comes from the vault's own catalogue, not from the shipped one. */
  custom: boolean;
}

/** Skills added from the vault (a topic that needs something the catalogue lacks). */
const CUSTOM: Record<string, CatalogSkill[]> = {};

export interface CustomSkillSpec {
  id: string;
  label: string;
  description: string;
  competencies?: readonly string[];
  topicTypes?: readonly TopicType[];
  allowedDifficulties?: SkillDefinition["allowedDifficulties"];
  allowedAssistance?: SkillDefinition["allowedAssistance"];
}

/** A subject's custom skill: registered by the vault's catalogue file, not shipped. */
export function defineCustomSkill(subject: string, spec: CustomSkillSpec): CatalogSkill {
  const base = skillsForSubject(subject)[0]!;
  return {
    ...base,
    id: spec.id,
    label: spec.label,
    description: spec.description,
    subject,
    competencies: spec.competencies ?? [],
    topicTypes: spec.topicTypes ?? ["mixed"],
    allowedDifficulties: spec.allowedDifficulties ?? base.allowedDifficulties,
    allowedAssistance: spec.allowedAssistance ?? base.allowedAssistance,
    custom: true,
  };
}

/** Replace the custom skills of a subject (used when the vault's catalogue loads). */
export function registerCustomSkills(subject: string, specs: readonly CustomSkillSpec[]): void {
  CUSTOM[subject.toLowerCase()] = specs.map((s) => defineCustomSkill(subject, s));
}

export function customSkillsFor(subject: string): readonly CatalogSkill[] {
  return CUSTOM[String(subject ?? "").toLowerCase()] ?? [];
}

/** The subject's catalogue: the shipped skills enriched with their fit, plus any custom ones. */
export function catalogFor(subject: string): CatalogSkill[] {
  const english = domainOfSubject(subject) === "english";
  const shipped = skillsForSubject(subject).map((skill) => {
    if (english) {
      // English skills carry their own competencies and branches: they never read the maths fit table.
      const spec = englishSkillSpec(skill.id);
      return {
        ...skill,
        competencies: spec?.competencies ?? [],
        topicTypes: [],
        branches: spec ? (spec.area === "vocabulary" ? ENGLISH_BRANCHES.map((b) => b.id) : [spec.area as EnglishBranch]) : [],
        ...(spec ? { area: spec.area } : {}),
        custom: false,
      } satisfies CatalogSkill;
    }
    const fit = SKILL_FIT[skill.id] ?? DEFAULT_FIT;
    return {
      ...skill,
      competencies: fit.competencies,
      topicTypes: fit.topicTypes,
      custom: false,
    } satisfies CatalogSkill;
  });
  const custom = customSkillsFor(subject).filter((c) => !shipped.some((s) => s.id === c.id));
  return [...shipped, ...custom];
}

export function catalogSkill(subject: string, skillId: string): CatalogSkill | undefined {
  const id = String(skillId ?? "").trim().toLowerCase();
  return catalogFor(subject).find((s) => s.id === id);
}

/** Whether a skill fits a topic's classification: its type (maths, programming) or its branch (English). */
export function fitsKey(skill: Pick<CatalogSkill, "topicTypes" | "branches">, key: string): boolean {
  return skill.branches ? skill.branches.includes(key as EnglishBranch) : skill.topicTypes.includes(key as TopicType);
}

/** Skill ids that carry meaning for a topic type, in catalogue order. */
export function skillsForTopicType(subject: string, topicType: TopicType): string[] {
  return catalogFor(subject)
    .filter((s) => fitsKey(s, topicType))
    .map((s) => s.id);
}

/** The skills a branch topic offers by default: its own branch's, in order (vocabulary is chosen, not assumed). */
export function skillsForBranch(subject: string, branch: EnglishBranch): string[] {
  return catalogFor(subject)
    .filter((s) => s.area === branch)
    .map((s) => s.id);
}

/** `TopicKey` re-export for callers that classify by type or by branch. */
export type { TopicKey };

/** Which skills of a subject are read as theory, for `detectTopicType`. */
export function theoreticalSkills(subject: string): string[] {
  return catalogFor(subject)
    .filter((s) => s.topicTypes.includes("theoretical"))
    .map((s) => s.id);
}

/* ─────────────────────────────────────────────────────────────────────────────
   The selection step, behind an interface an AI can replace.
   ───────────────────────────────────────────────────────────────────────── */

export interface SkillSelectionRequest {
  subject: string;
  /** The topic's type (`detectTopicType` or the manifest's own field). Mathematics and programming. */
  topicType?: TopicType;
  /** The topic's branch. English (required there: an English topic has no default). */
  branch?: EnglishBranch;
  /** The topic's title (context for a future AI selector; unused by the rule). */
  title?: string;
  /** The manifest's own `skills:`, when it declares them. */
  declaredSkills?: readonly string[];
  /** `practice:` modes of the topic's exercises, as written in the notes. */
  practiceModes?: readonly string[];
  /** Where the type came from, for the report. */
  topicTypeWhy?: string;
  /** Cap on the recommended list (default 6). */
  maxSkills?: number;
}

export interface SkillSelectionResult {
  /** Skill ids, in the order they should be offered. */
  skills: string[];
  topicType?: TopicType;
  branch?: EnglishBranch;
  /** Where the list came from. */
  source: "declared" | "catalogue" | "custom";
  /** Why, in one line, for the UI and the logs. */
  notes: string[];
  /** Catalogue entries of `skills`, ready to render (descriptions included). */
  entries: CatalogSkill[];
}

/** English: the skills of the topic's branch. There is no default branch: without one it is an error. */
function selectEnglish(request: SkillSelectionRequest, subject: string): SkillSelectionResult {
  const branch = request.branch;
  if (!branch) throw new Error("Un tema de inglés necesita su rama (gramática, escritura, lectura, escucha o habla) para elegir competencias.");
  const declared = (request.declaredSkills ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const known = declared.filter((id) => catalogSkill(subject, id));
  const max = Math.max(1, request.maxSkills ?? MAX_RECOMMENDED_SKILLS);
  const skills = known.length ? known : skillsForBranch(subject, branch).slice(0, max);
  return {
    skills,
    branch,
    source: known.length ? "declared" : "catalogue",
    notes: [known.length ? `los declara el propio tema (${known.length})` : `competencias de la rama ${branch}`],
    entries: skills.map((id) => catalogSkill(subject, id)!),
  };
}

/** The plug point: swap this implementation for an AI one and nothing else moves. */
export interface SkillSelector {
  id: string;
  select(request: SkillSelectionRequest): SkillSelectionResult;
}

export const MAX_RECOMMENDED_SKILLS = 6;

/**
 * The shipped selector: the topic's declared skills when it has them, otherwise the
 * catalogue's skills for its topic type, capped and never empty.
 */
export const deterministicSkillSelector: SkillSelector = {
  id: "catalogue-v1",
  select(request) {
    const subject = String(request.subject ?? "").trim().toLowerCase() || "mathematics";
    if (domainOfSubject(subject) === "english") return selectEnglish(request, subject);
    const topicType = normaliseTopicType(request.topicType) ?? "mixed";
    const declared = (request.declaredSkills ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const notes: string[] = [];

    if (declared.length) {
      const known = declared.filter((id) => catalogSkill(subject, id));
      const missing = declared.filter((id) => !catalogSkill(subject, id));
      if (missing.length) notes.push(`skills fuera del catálogo: ${missing.join(", ")}`);
      if (known.length) {
        notes.push(`los declara el propio tema (${known.length})`);
        const entries = known.map((id) => catalogSkill(subject, id)!);
        return {
          skills: known,
          topicType,
          // Una skill propia del vault cuenta como tal, aunque el tema la declare.
          source: entries.some((e) => e.custom) ? "custom" : "declared",
          notes,
          entries,
        };
      }
      notes.push("los declarados no están en el catálogo: se recomienda por tipo de tema");
    }

    const max = Math.max(1, request.maxSkills ?? MAX_RECOMMENDED_SKILLS);
    const recommended = skillsForTopicType(subject, topicType).slice(0, max);
    const fallback = recommended.length ? recommended : skillsForTopicType(subject, "mixed").slice(0, max);
    notes.push(
      recommended.length
        ? `recomendados por tipo de tema (${topicType})${request.topicTypeWhy ? `: ${request.topicTypeWhy}` : ""}`
        : `sin skills para «${topicType}»: se ofrecen los de un tema mixto`,
    );
    return {
      skills: fallback,
      topicType,
      source: "catalogue",
      notes,
      entries: fallback.map((id) => catalogSkill(subject, id)!),
    };
  },
};

/** Sugar for the common case: the recommendation for a topic. */
export function recommendSkillsForTopic(
  request: SkillSelectionRequest,
  selector: SkillSelector = deterministicSkillSelector,
): SkillSelectionResult {
  return selector.select(request);
}
