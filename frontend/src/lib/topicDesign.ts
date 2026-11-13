// CHECKLIST DE DISEÑO DE UN TEMA COMPLETO. La cobertura del plan ya no mide solo «tiene alguna nota» y «tiene ejercicios»: mide cada tema
// contra el sistema de skills de diseño de la vault (`Programación/_skills/*.md`: `resumen_teorico_skill`, `mapa_skill`, `practica_skill`,
// `subtemas_skill`), que define qué artefactos tiene un tema bien diseñado:
//
//   · la NOTA DE TEORÍA `<tema>/<tema>.md` con el contrato de estructura (Requires · Explanation{What it is, Mental model} · Examples ×3 ·
//     Common mistakes ×4-5 · Connections · Cards ×6-9) y `topic_type` en el frontmatter;
//   · el MAPA (canvas) del tema `<tema> — mapa.canvas`, que se genera leyendo la nota;
//   · el MANIFIESTO de práctica `<tema>.practica.md` (o `_tema.md`) con `topic_type`, `skills`, `min_per_skill`, `target_difficulty`, `exam`;
//   · que las SKILLS del manifiesto encajen con el tipo (teórico = solo skills de concepto; procedimental = skills de código del área;
//     mixto = concepto + código) y con la rama (`practica_skill` §3);
//   · los ARCHIVOS DE PRÁCTICA (`<tema>/Ejercicios/<skill>/…`): al menos uno por skill (básico) y uno por skill y dificultad (escalera).
//
// Módulo PURO y compartido (núcleo, API y renderer): sin node:* ni DOM. Recibe lo que ya se escaneó de la vault (`TopicDesignInput`) y devuelve,
// por tema, el resultado de cada artefacto, una PUNTUACIÓN de completitud de diseño (0-100) y los FALTANTES concretos («falta el canvas»,
// «sin manifiesto de skills», «sin práctica en la skill design a dificultad 2»), cada uno con la acción que lo arregla (`fix`). No lee la vault
// ni escribe nada: la detección sobre disco vive en `core/mentor/topicDesignScan.ts`. La revisión de la IA recibe este checklist y estos
// resultados (nunca las notas) y juzga la calidad del diseño; ver `core/mentor/planCoverageAi.ts`.

import { classifyBranch } from "./planTime.js";

export type TopicDesignType = "theoretical" | "procedural" | "mixed";
export const TOPIC_TYPE_NAME: Record<TopicDesignType, string> = { theoretical: "Teórico", procedural: "Procedimental", mixed: "Mixto" };

/** Cómo se arregla un faltante: qué función existente de la app lo crea. `manual` = hay algo que ya existe y la app NO lo reescribe (se revisa a mano o se le pide al Mentor). */
export const DESIGN_FIXES = ["theory", "canvas", "manifest", "practice", "topic", "manual"] as const;
export type DesignFix = (typeof DESIGN_FIXES)[number];

export const ARTIFACT_IDS = ["theory", "contract", "canvas", "manifest", "skills_fit", "branch_skills", "practice_basic", "practice_ladder"] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

export type ArtifactLevel = "required" | "recommended";

// ── Tablas de la skill `practica_skill` ─────────────────────────────────

/** Skills de CONCEPTO (no se escribe código). */
export const CONCEPT_SKILLS: readonly string[] = ["pg_true_false", "pg_classify", "pg_compare", "explain", "find_error"];
/** Skills de código que no deben aparecer en un tema teórico. */
export const CODE_ONLY_SKILLS: readonly string[] = ["implement", "debug", "refactor", "commands", "cloze", "trace", "test", "query"];
/** Skills que no tienen dificultad 1 (columna «No level 1» de la skill). */
export const NO_LEVEL_ONE: readonly string[] = ["debug", "design", "review", "analyze", "port"];

/** Skills de código recomendadas por clase de rama, de la más útil a la menos (`practica_skill` §3). */
export const BRANCH_CODE_SKILLS: Readonly<Record<string, readonly string[]>> = {
  fundamentals: ["trace", "implement", "decompose", "debug", "test", "analyze"],
  language: ["implement", "trace", "debug", "refactor", "review", "test"],
  desktop: ["design", "implement", "debug", "review", "decompose", "test"],
  backend: ["design", "implement", "review", "debug", "test", "decompose"],
  frontend: ["implement", "debug", "review", "refactor", "test", "decompose"],
  databases: ["query", "design", "analyze", "debug", "review"],
  automation: ["design", "implement", "debug", "review", "decompose"],
  mobile: ["design", "analyze", "implement", "review", "port"],
  tooling: ["commands", "debug", "find_error", "design", "review", "explain"],
};

export const artifactLabel: Record<ArtifactId, string> = {
  theory: "Nota de teoría",
  contract: "Estructura de la nota (contrato de la skill)",
  canvas: "Mapa (canvas) del tema",
  manifest: "Manifiesto de práctica con skills",
  skills_fit: "Skills acordes al tipo de tema",
  branch_skills: "Skills de código de la rama",
  practice_basic: "Práctica: al menos un ejercicio por skill",
  practice_ladder: "Práctica: escalera de dificultades",
};

/** Peso de cada artefacto en la puntuación (la suma de los que aplican es el 100 %). */
export const ARTIFACT_WEIGHT: Record<ArtifactId, number> = { theory: 25, contract: 15, canvas: 15, manifest: 15, skills_fit: 5, branch_skills: 5, practice_basic: 15, practice_ladder: 5 };

/** Una línea por artefacto: cómo se detecta en la vault (se muestra a la persona y se entrega a la IA). */
export const ARTIFACT_DETECTION: Record<ArtifactId, string> = {
  theory: "existe un .md en la carpeta del tema que no es ejercicio, ni `.practica.md`, ni empieza por `_` o `.`",
  contract: "la nota tiene las secciones Requires, Explanation (What it is, How it is organised, How it works in the real world; las notas antiguas: What it is, Mental model), Examples (3), Common mistakes (≥3), Connections y Cards (6-9)",
  canvas: "hay un archivo `*.canvas` en la carpeta del tema (`<tema> — mapa.canvas`)",
  manifest: "existe `<tema>.practica.md` o `_tema.md` con `skills` y `topic_type`",
  skills_fit: "teórico: solo skills de concepto; procedimental: al menos una skill de código de la rama; mixto: concepto y código",
  branch_skills: "procedimental/mixto: el manifiesto incluye al menos 2 de las skills de código recomendadas para la rama",
  practice_basic: "`Ejercicios/<skill>/` tiene al menos un ejercicio de cada skill del manifiesto",
  practice_ladder: "hay ejercicios de cada skill en cada dificultad que pide el plan del manifiesto (o 1..dificultad objetivo)",
};

// ── Entrada ─────────────────────────────────────────────────────────────

export interface TopicDesignInput {
  /** carpeta del tema, POSIX relativa a la vault («Programación/4 Backend/4.3 REST API design») */
  folder: string;
  title: string;
  /** materia (`programming`, `mathematics`, `english`…): solo `programming` usa el contrato completo */
  subject?: string;
  /** la carpeta del tema existe en la vault */
  exists: boolean;
  /** nombres de archivo de la carpeta del tema (sin subcarpetas) */
  files: string[];
  /** texto de la nota de teoría, si se leyó */
  theoryText?: string;
  /** manifiesto leído */
  manifest?: { topicType?: string; skills: string[]; plan?: Record<string, [number, number, number]>; targetDifficulty?: number } | null;
  /** ejercicios del tema (skill y dificultad 1-3 de cada uno) */
  exercises: ReadonlyArray<{ skill: string; difficulty: number }>;
}

export interface ArtifactResult {
  id: ArtifactId;
  label: string;
  level: ArtifactLevel;
  ok: boolean;
  weight: number;
  /** qué se encontró (lo que prueba que está) */
  found?: string;
}

export interface DesignGap {
  artifact: ArtifactId;
  level: ArtifactLevel;
  /** frase concreta («Falta el canvas», «Sin práctica en la skill design a dificultad 2») */
  text: string;
  fix: DesignFix;
  skill?: string;
  difficulty?: number;
}

export interface TopicDesign {
  folder: string;
  title: string;
  branch: string;
  topicType: TopicDesignType | "unknown";
  /** `programming` = checklist completo; `generic` = teoría, manifiesto y práctica (otras materias) */
  profile: "programming" | "generic";
  items: ArtifactResult[];
  /** 0-100: peso de lo que está / peso de lo que aplica */
  score: number;
  /** 0-100 solo con los artefactos obligatorios */
  requiredScore: number;
  /** todos los obligatorios están */
  complete: boolean;
  gaps: DesignGap[];
}

// ── Detección sobre el texto de la nota (contrato de `resumen_teorico_skill`) ──

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface TheoryReading {
  topicType?: string;
  hasSections: Record<"requires" | "explanation" | "whatItIs" | "mentalModel" | "examples" | "mistakes" | "connections" | "cards", boolean>;
  examples: number;
  mistakes: number;
  cards: number;
}

/** Lee la estructura de una nota de teoría (acepta los encabezados en inglés y sus equivalentes en español). Ignora los bloques de código. */
export function readTheory(text: string): TheoryReading {
  const lines = text.replace(/\r/g, "").split("\n");
  let fm = "";
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      fm = lines.slice(1, end).join("\n");
      start = end + 1;
    }
  }
  const topicType = /^topic_type:\s*["']?([a-z]+)["']?\s*$/m.exec(fm)?.[1];
  let fence = false;
  const h2: string[] = [];
  const h3: Array<{ parent: string; title: string }> = [];
  for (const raw of lines.slice(start)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m2 = /^##\s+(.+?)\s*$/.exec(raw);
    if (m2) {
      h2.push(fold(m2[1]!));
      continue;
    }
    const m3 = /^###\s+(.+?)\s*$/.exec(raw);
    if (m3) h3.push({ parent: h2[h2.length - 1] ?? "", title: fold(m3[1]!) });
  }
  const has = (re: RegExp): boolean => h2.some((h) => re.test(h));
  const under = (re: RegExp): number => h3.filter((h) => re.test(h.parent)).length;
  const reExamples = /^(examples?|ejemplos?)\b/;
  const reMistakes = /^(common mistakes|errores)/;
  const reCards = /^(cards|tarjetas)\b/;
  return {
    ...(topicType ? { topicType } : {}),
    hasSections: {
      requires: has(/^(requires|requiere|prerequisites|prerrequisitos)\b/),
      explanation: has(/^(explanation|explicacion)\b/),
      whatItIs: h3.some((h) => /^(what it is|que es)\b/.test(h.title)),
      mentalModel: h3.some((h) => /^(mental model|modelo mental|how it is organi[sz]ed|how it works)\b/i.test(h.title)),
      examples: has(reExamples),
      mistakes: has(reMistakes),
      connections: has(/^(connections|conexiones)\b/),
      cards: has(reCards),
    },
    examples: under(reExamples),
    mistakes: under(reMistakes),
    cards: under(reCards),
  };
}

/**
 * Lo que le falta a una nota de teoría para cumplir el contrato (frases concretas); vacío = cumple. El `topic_type` del frontmatter no se exige
 * aquí: las notas que genera la app no lo llevan y el tipo se toma del manifiesto (si ninguno lo declara, lo avisa `skills_fit`).
 */
export function contractProblems(r: TheoryReading): string[] {
  const out: string[] = [];
  const s = r.hasSections;
  if (!s.requires) out.push("falta la sección Requires");
  if (!s.explanation) out.push("falta la sección Explanation");
  else {
    if (!s.whatItIs) out.push("falta «What it is» en Explanation");
    if (!s.mentalModel) out.push("falta un módulo tras «What it is» en Explanation («How it is organised» y «How it works in the real world», o «Mental model»)");
  }
  if (!s.examples) out.push("falta la sección Examples");
  else if (r.examples < 3) out.push(`Examples tiene ${r.examples} de 3 ejemplos`);
  if (!s.mistakes) out.push("falta la sección Common mistakes");
  else if (r.mistakes < 3) out.push(`Common mistakes tiene ${r.mistakes} de 3 errores`);
  if (!s.connections) out.push("falta la sección Connections");
  if (!s.cards) out.push("falta la sección Cards");
  else if (r.cards < 6) out.push(`Cards tiene ${r.cards} de 6 tarjetas`);
  return out;
}

// ── Utilidades ──────────────────────────────────────────────────────────

const THEORY_FILE = (name: string): boolean => {
  const n = name.toLowerCase();
  return n.endsWith(".md") && !n.startsWith("_") && !n.startsWith(".") && !n.endsWith(".practica.md") && !n.endsWith(".resumen.md") && !n.endsWith(".proyectos.md");
};
export const hasTheoryFile = (files: readonly string[]): boolean => files.some(THEORY_FILE);
export const hasCanvasFile = (files: readonly string[]): boolean => files.some((f) => f.toLowerCase().endsWith(".canvas"));

const asType = (v: unknown): TopicDesignType | null => {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "theoretical" || t === "procedural" || t === "mixed" ? t : null;
};

/** La clase de rama de un tema («Programación/4 Backend/4.3 REST» → `backend`). */
export function branchClassOf(folder: string): string {
  const seg = folder.split("/").filter(Boolean)[1] ?? "";
  return classifyBranch(seg);
}

/** Dificultades que debe tener una skill: las del plan del manifiesto, o de 1 (2 si no admite el 1) hasta la dificultad objetivo. */
export function requiredDifficulties(skill: string, manifest: NonNullable<TopicDesignInput["manifest"]>): number[] {
  const plan = manifest.plan?.[skill];
  if (plan) return [1, 2, 3].filter((d) => (plan[d - 1] ?? 0) > 0);
  const target = Math.max(1, Math.min(3, manifest.targetDifficulty ?? 3));
  const from = NO_LEVEL_ONE.includes(skill) ? 2 : 1;
  const out: number[] = [];
  for (let d = from; d <= target; d++) out.push(d);
  return out;
}

const skillName = (s: string): string => `\`${s}\``;

/** Evalúa el diseño de UN tema. Determinista: la misma entrada da siempre el mismo resultado. */
export function evaluateTopicDesign(inp: TopicDesignInput): TopicDesign {
  const branch = branchClassOf(inp.folder);
  const programming = !inp.subject || /^(programming|programaci)/i.test(inp.subject);
  const profile: TopicDesign["profile"] = programming ? "programming" : "generic";
  const reading = inp.theoryText !== undefined ? readTheory(inp.theoryText) : undefined;
  const type: TopicDesignType | "unknown" = asType(inp.manifest?.topicType) ?? asType(reading?.topicType) ?? "unknown";
  const effective: TopicDesignType = type === "unknown" ? "mixed" : type;
  const items: ArtifactResult[] = [];
  const gaps: DesignGap[] = [];
  const add = (id: ArtifactId, level: ArtifactLevel | null, ok: boolean, found: string | undefined, gap: Omit<DesignGap, "artifact" | "level">[]): void => {
    if (!level) return;
    items.push({ id, label: artifactLabel[id], level, ok, weight: ARTIFACT_WEIGHT[id], ...(found ? { found } : {}) });
    if (!ok) for (const g of gap) gaps.push({ artifact: id, level, ...g });
  };

  if (!inp.exists) {
    // el tema del plan no está en la vault: todo falta, y se arregla creando el tema
    add("theory", "required", false, undefined, [{ text: "La carpeta del tema no existe en la vault", fix: "topic" }]);
    return finish(inp, branch, type, profile, items, gaps);
  }

  // 1. nota de teoría
  const theory = hasTheoryFile(inp.files);
  add("theory", "required", theory, theory ? inp.files.find(THEORY_FILE) : undefined, [{ text: "Falta la nota de teoría", fix: "theory" }]);

  // 2. contrato de la nota
  const problems = reading ? contractProblems(reading) : [];
  if (theory && reading) {
    add("contract", programming ? "required" : "recommended", problems.length === 0, problems.length === 0 ? `${reading.examples} ejemplos · ${reading.mistakes} errores · ${reading.cards} tarjetas` : undefined, problems.map((p) => ({ text: `La nota no cumple el contrato: ${p}`, fix: "manual" as const })));
  } else if (theory) {
    // no se leyó el texto: no se puede juzgar el contrato (no se cuenta ni a favor ni en contra)
  } else {
    add("contract", programming ? "required" : "recommended", false, undefined, [{ text: "Sin nota no hay estructura que cumpla el contrato", fix: "theory" }]);
  }

  // 3. mapa (canvas)
  const canvas = hasCanvasFile(inp.files);
  add("canvas", programming ? "required" : "recommended", canvas, canvas ? inp.files.find((f) => f.toLowerCase().endsWith(".canvas")) : undefined, [{ text: theory ? "Falta el canvas del tema" : "Falta el canvas del tema (se genera de la nota de teoría)", fix: theory ? "canvas" : "theory" }]);

  // 4. manifiesto
  const man = inp.manifest;
  const manifestOk = !!man && man.skills.length > 0;
  add("manifest", "required", manifestOk, manifestOk ? `${man!.skills.length} skills${man!.topicType ? ` · tipo ${man!.topicType}` : ""}` : undefined, [
    { text: man ? "El manifiesto no define skills" : "Sin manifiesto de skills (.practica.md)", fix: man ? "manual" : "manifest" },
  ]);

  if (manifestOk) {
    const skills = man!.skills.map((s) => s.toLowerCase());
    // 5. skills acordes al tipo
    const fitProblems: string[] = [];
    if (type === "unknown") fitProblems.push("el tema no declara `topic_type`");
    if (effective === "theoretical") {
      const bad = skills.filter((s) => CODE_ONLY_SKILLS.includes(s));
      if (bad.length) fitProblems.push(`un tema teórico no admite ${bad.map(skillName).join(", ")}`);
    } else {
      const codeSkills = skills.filter((s) => !CONCEPT_SKILLS.includes(s) && s !== "pp_kata");
      if (!codeSkills.length) fitProblems.push("un tema procedimental o mixto necesita al menos una skill de código");
      if (effective === "mixed" && !skills.some((s) => CONCEPT_SKILLS.includes(s))) fitProblems.push("un tema mixto necesita una skill de concepto (p. ej. `pg_true_false` o `explain`)");
    }
    if (programming) add("skills_fit", "required", fitProblems.length === 0, fitProblems.length === 0 ? `tipo ${TOPIC_TYPE_NAME[effective].toLowerCase()}` : undefined, fitProblems.map((p) => ({ text: `Skills del manifiesto: ${p}`, fix: "manual" as const })));

    // 6. skills de la rama
    const recommended = BRANCH_CODE_SKILLS[branch];
    if (programming && recommended && effective !== "theoretical") {
      const hits = skills.filter((s) => recommended.includes(s));
      const need = Math.min(2, recommended.length);
      add("branch_skills", "recommended", hits.length >= need, hits.length >= need ? hits.map(skillName).join(", ") : undefined, [
        { text: `El manifiesto solo trae ${hits.length} de las skills recomendadas para esta rama (${recommended.slice(0, 4).map(skillName).join(", ")})`, fix: "manual" },
      ]);
    }

    // 7. práctica básica y escalera
    const bySkill = new Map<string, Set<number>>();
    const counts = new Map<string, number>();
    for (const e of inp.exercises) {
      const k = e.skill.toLowerCase();
      const d = Math.min(3, Math.max(1, Math.round(e.difficulty) || 1));
      if (!bySkill.has(k)) bySkill.set(k, new Set());
      bySkill.get(k)!.add(d);
      const key = `${k}:${d}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const noPractice = skills.filter((s) => !bySkill.has(s));
    add("practice_basic", "required", noPractice.length === 0, noPractice.length === 0 ? `${inp.exercises.length} ejercicios` : undefined, noPractice.map((s) => ({ text: `Sin práctica en la skill ${skillName(s)}`, fix: "practice" as const, skill: s, difficulty: requiredDifficulties(s, man!)[0] ?? 1 })));
    const ladder: DesignGap[] = [];
    for (const s of skills) {
      for (const d of requiredDifficulties(s, man!)) {
        const have = counts.get(`${s}:${d}`) ?? 0;
        const want = man!.plan?.[s]?.[d - 1] ?? 1;
        if (have < want && !(noPractice.includes(s) && d === (requiredDifficulties(s, man!)[0] ?? 1))) ladder.push({ artifact: "practice_ladder", level: "recommended", text: `Práctica en la skill ${skillName(s)} a dificultad ${d}: ${have} de ${want} ejercicios`, fix: "practice", skill: s, difficulty: d });
      }
    }
    if (noPractice.length === skills.length) {
      items.push({ id: "practice_ladder", label: artifactLabel.practice_ladder, level: "recommended", ok: false, weight: ARTIFACT_WEIGHT.practice_ladder });
      gaps.push(...ladder);
    } else {
      items.push({ id: "practice_ladder", label: artifactLabel.practice_ladder, level: "recommended", ok: ladder.length === 0, weight: ARTIFACT_WEIGHT.practice_ladder, ...(ladder.length === 0 ? { found: "todas las dificultades" } : {}) });
      gaps.push(...ladder);
    }
  } else {
    // sin manifiesto no se puede juzgar la práctica: cuenta como no hecha
    add("practice_basic", "required", false, undefined, [{ text: man ? "Sin skills en el manifiesto no hay práctica por skill" : "Sin manifiesto no hay práctica por skill", fix: man ? "manual" : "manifest" }]);
    // los demás artefactos que dependen del manifiesto cuentan como no hechos (sin gap propio: lo arregla el manifiesto), así la puntuación es comparable
    if (programming) add("skills_fit", "required", false, undefined, []);
    if (programming && BRANCH_CODE_SKILLS[branch] && effective !== "theoretical") add("branch_skills", "recommended", false, undefined, []);
    add("practice_ladder", "recommended", false, undefined, []);
  }
  return finish(inp, branch, type, profile, items, gaps);
}

function finish(inp: TopicDesignInput, branch: string, type: TopicDesign["topicType"], profile: TopicDesign["profile"], items: ArtifactResult[], gaps: DesignGap[]): TopicDesign {
  const total = items.reduce((n, i) => n + i.weight, 0);
  const got = items.filter((i) => i.ok).reduce((n, i) => n + i.weight, 0);
  const req = items.filter((i) => i.level === "required");
  const reqTotal = req.reduce((n, i) => n + i.weight, 0);
  const reqGot = req.filter((i) => i.ok).reduce((n, i) => n + i.weight, 0);
  const order: Record<ArtifactLevel, number> = { required: 0, recommended: 1 };
  gaps.sort((a, b) => order[a.level] - order[b.level] || ARTIFACT_IDS.indexOf(a.artifact) - ARTIFACT_IDS.indexOf(b.artifact));
  return {
    folder: inp.folder,
    title: inp.title,
    branch,
    topicType: type,
    profile,
    items,
    score: total ? Math.round((got / total) * 100) : 0,
    requiredScore: reqTotal ? Math.round((reqGot / reqTotal) * 100) : 0,
    complete: req.every((i) => i.ok),
    gaps,
  };
}

// ── Resumen por grupo de temas ──────────────────────────────────────────

export interface DesignSummary {
  topics: number;
  /** media de las puntuaciones */
  avgScore: number;
  complete: number;
  incomplete: number;
  /** faltantes obligatorios / recomendados */
  requiredGaps: number;
  recommendedGaps: number;
  /** nº de temas a los que les falta cada artefacto */
  byArtifact: Partial<Record<ArtifactId, number>>;
}

export function summarizeDesign(list: readonly TopicDesign[]): DesignSummary {
  const byArtifact: Partial<Record<ArtifactId, number>> = {};
  let requiredGaps = 0;
  let recommendedGaps = 0;
  for (const t of list) {
    for (const a of new Set(t.gaps.map((g) => g.artifact))) byArtifact[a] = (byArtifact[a] ?? 0) + 1;
    for (const g of t.gaps) g.level === "required" ? requiredGaps++ : recommendedGaps++;
  }
  return {
    topics: list.length,
    avgScore: list.length ? Math.round(list.reduce((n, t) => n + t.score, 0) / list.length) : 0,
    complete: list.filter((t) => t.complete).length,
    incomplete: list.filter((t) => !t.complete).length,
    byArtifact,
    requiredGaps,
    recommendedGaps,
  };
}

/** El checklist como datos compactos para la IA y para la interfaz (qué mide, cómo se detecta, si es obligatorio). */
export function checklistForAi(): Array<{ id: ArtifactId; what: string; detection: string; weight: number }> {
  return ARTIFACT_IDS.map((id) => ({ id, what: artifactLabel[id], detection: ARTIFACT_DETECTION[id], weight: ARTIFACT_WEIGHT[id] }));
}

/** «Falta canvas · sin manifiesto…» en una línea (los 3 primeros faltantes). */
export function gapsLine(d: TopicDesign, max = 3): string {
  const g = d.gaps.filter((x) => x.level === "required");
  const list = (g.length ? g : d.gaps).map((x) => x.text);
  const uniq = [...new Set(list)];
  return uniq.slice(0, max).join(" · ") + (uniq.length > max ? ` · +${uniq.length - max}` : "");
}
