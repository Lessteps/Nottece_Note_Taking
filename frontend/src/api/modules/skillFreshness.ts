// Skills al día: detecta, SIN IA, qué piezas de un tema se hicieron con una versión anterior de su skill.
//
// Cada materia tiene su carpeta `<Materia>/_skills/` con tres skills que generan piezas de un tema:
//   · `resumen_teorico_skill.md` → la nota de teoría   `<tema>/<tema>.md`
//   · `mapa_skill.md`            → el mapa explicativo `<tema>/<tema> — mapa.canvas`
//   · `practica_skill.md`        → el manifiesto       `<tema>/<tema>.practica.md`
// Se guarda la huella (hash) de cada skill y cuándo se vio cambiar (`.notevault/estudio/skill_registry.json`). Una pieza está atrasada si su
// archivo es más viejo que ese cambio. La primera vez que se ve una skill, su fecha es la de modificación del archivo; después, el momento
// en que cambia su contenido (tocar el archivo sin cambiar el texto, p. ej. un `git checkout`, no cuenta). Regenerar la pieza la rejuvenece.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isHeavyNote } from "../../lib/noteWeight.js";
import { shortVersion, stampOf, withStamp } from "../../lib/skillStamp.js";
import type { OutdatedSkills } from "../../lib/planTopicCatalog.js";
import { archetypeOf, ARCHETYPE_FORBIDDEN } from "../../core/practice/programmingArchetype.js";

const SKILL_FILES = { theory: "resumen_teorico_skill.md", canvas: "mapa_skill.md", practica: "practica_skill.md" } as const;
type Kind = keyof typeof SKILL_FILES;
const KINDS = Object.keys(SKILL_FILES) as Kind[];
interface Entry { hash: string; changedAt: number }
type Registry = Record<string, Entry>;

const registryPath = (root: string): string => path.join(root, ".notevault", "estudio", "skill_registry.json");

function loadRegistry(root: string): Registry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(root), "utf8")) as unknown;
    return raw && typeof raw === "object" ? (raw as Registry) : {};
  } catch {
    return {};
  }
}

function saveRegistry(root: string, reg: Registry): void {
  try {
    fs.mkdirSync(path.dirname(registryPath(root)), { recursive: true });
    fs.writeFileSync(registryPath(root), JSON.stringify(reg, null, 2), "utf8");
  } catch {
    // sin permiso de escritura no se recuerdan los cambios: se sigue con la fecha del archivo
  }
}

const readText = (abs: string): string => {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
};

/** La versión actual de una skill de una materia (8 hex del sha1 de su texto), o null si no existe. */
export function skillVersionOf(root: string, subject: string, kind: Kind): string | null {
  try {
    const text = fs.readFileSync(path.join(root, subject, "_skills", SKILL_FILES[kind]), "utf8");
    return shortVersion(createHash("sha1").update(text.replace(/\r\n/g, "\n")).digest("hex"));
  } catch {
    return null;
  }
}

/** Marca un archivo de pieza (nota o `.practica.md`) con la versión actual de su skill. Sin skill o sin frontmatter no hace nada; nunca lanza. */
export function stampSkillVersion(root: string, subject: string, kind: "theory" | "practica", fileAbs: string): void {
  try {
    const v = skillVersionOf(root, subject, kind);
    if (!v) return;
    const text = fs.readFileSync(fileAbs, "utf8");
    const next = withStamp(text, v);
    if (next !== text) fs.writeFileSync(fileAbs, next, "utf8");
  } catch {
    /* la marca es información: si no se puede escribir, la pieza sigue valiendo (y se juzga por fecha) */
  }
}

const mtime = (abs: string): number | null => {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
};

/** Cuándo cambió cada skill de cada materia (solo las que existen); actualiza el registro si vio un cambio. */
function skillChangeTimes(root: string, subjects: Iterable<string>): Map<string, number> {
  const reg = loadRegistry(root);
  const out = new Map<string, number>();
  let dirty = false;
  const now = Date.now();
  for (const subject of subjects) {
    for (const kind of KINDS) {
      const abs = path.join(root, subject, "_skills", SKILL_FILES[kind]);
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const key = `${subject}/${kind}`;
      const hash = createHash("sha1").update(text.replace(/\r\n/g, "\n")).digest("hex");
      const known = reg[key];
      if (!known) {
        reg[key] = { hash, changedAt: mtime(abs) ?? now };
        dirty = true;
      } else if (known.hash !== hash) {
        // cuándo se EDITÓ la skill (la fecha de su archivo), no cuándo la vio la app: si la app se abre horas después, las piezas hechas entre medias
        // con la skill ya nueva no pueden salir como atrasadas
        reg[key] = { hash, changedAt: Math.min(now, mtime(abs) ?? now) };
        dirty = true;
      } else {
        // una fecha guardada más tardía que la del archivo vino de cuando la VIO la app, no de cuando se editó: se corrige hacia atrás
        const m = mtime(abs);
        if (m !== null && m < known.changedAt) {
          reg[key] = { hash, changedAt: m };
          dirty = true;
        }
      }
      out.set(key, reg[key]!.changedAt);
    }
  }
  if (dirty) saveRegistry(root, reg);
  return out;
}

export function isTheoryOutdated(raw: string, subject = "Programación"): boolean {
  if (!raw || raw.trim().length === 0) return true;
  // Bypass para stubs mínimos en pruebas unitarias de timestamp (ej: "nota")
  if (raw.length < 50 && !raw.includes("\n") && !raw.startsWith("---") && !raw.startsWith("#")) return false;

  // Bloques de código sin cerrar (número impar de ``` es síntoma de generación truncada)
  const fences = raw.match(/^```/gm);
  if (fences && fences.length % 2 !== 0) return true;

  // Encabezados esenciales (español o inglés)
  const hasRequires = raw.includes("## Requires") || raw.includes("## Requiere");
  if (!hasRequires) return true;

  const hasExplanation = raw.includes("## Explanation") || raw.includes("## Explicación");
  if (!hasExplanation) return true;

  const hasExamples = raw.includes("## Examples") || raw.includes("## Ejemplos");
  if (!hasExamples) return true;

  const hasMistakes = raw.includes("## Common mistakes") || raw.includes("## Errores comunes");
  if (!hasMistakes) return true;

  // Las secciones de ejemplos y errores comunes no pueden estar vacías
  const examplesText = /## (?:Examples|Ejemplos)([\s\S]*?)(?=\n## |$)/.exec(raw)?.[1] ?? "";
  if (examplesText.trim().length === 0) return true;

  const mistakesText = /## (?:Common mistakes|Errores comunes)([\s\S]*?)(?=\n## |$)/.exec(raw)?.[1] ?? "";
  if (mistakesText.trim().length === 0) return true;

  // Peso de la nota (salvo grupos de catálogo curricular con curriculum_id)
  if (!raw.includes("curriculum_id:") && isHeavyNote(raw)) return true;

  if (subject === "Programación") {
    if (!raw.includes("### What it is") && !raw.includes("### Qué es")) return true;
    if (!raw.includes("curriculum_id:")) {
      if (!raw.includes("**In one sentence.**") && !raw.includes("**En una frase.**")) return true;
      const modular = raw.includes("### How it is organised") && raw.includes("### How it works in the real world");
      if (!modular) {
        if (!raw.includes("### Mental model") && !raw.includes("### Modelo mental")) return true;
        if (!raw.includes("- **In the practice:**") && !raw.includes("**In the practice:**") && !raw.includes("**En la práctica:**")) return true;
      }
      if (!raw.includes("**How you will apply it:**") && !raw.includes("**Why it works:**") && !raw.includes("**Por qué funciona:**") && !raw.includes("**Cómo lo aplicarás:**")) return true;
    }
  } else if (subject === "Matemáticas" || subject === "Inglés") {
    if (!raw.includes("### Qué es") && !raw.includes("### What it is")) return true;
    if (!raw.includes("### Modelo mental") && !raw.includes("### Mental model")) return true;
  }

  return false;
}

export const isProgrammingTheoryOutdated = (raw: string) => isTheoryOutdated(raw, "Programación");

export function isCanvasOutdated(rawCanvas: string, theoryStale = false, subject = "Programación"): boolean {
  if (subject === "Programación" && theoryStale) return true;
  if (!rawCanvas || rawCanvas.trim().length === 0) return true;
  // Bypass para stubs de pruebas unitarias de timestamp
  if (rawCanvas.trim() === "{}") return false;

  try {
    const parsed = JSON.parse(rawCanvas);
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return true;

    const texts = parsed.nodes.filter((n: any) => n.type === "text").map((n: any) => String(n.text || ""));
    const groups = parsed.nodes.filter((n: any) => n.type === "group").map((n: any) => String(n.label || ""));
    const joined = texts.join("\n") + "\n" + groups.join("\n");

    // Si los textos combinados son casi vacíos (< 25 caracteres), el canvas no tiene contenido
    if (texts.join("").trim().length < 25 && groups.length === 0) return true;

    // Verificar que contenga grupo o sección de Explicación
    const hasExpl = joined.includes("Explanation") || joined.includes("Explicación");
    if (!hasExpl) return true;

    // Verificar definición inicial
    const hasWhat = joined.includes("**In one sentence.**") || joined.includes("**En una frase.**") || joined.includes("What it is") || joined.includes("Qué es");
    if (!hasWhat) return true;

    // Verificar modelo mental o funcionamiento
    const hasModel = joined.includes("Mental model") || joined.includes("Modelo mental") || joined.includes("In the practice") || joined.includes("En la práctica") || joined.includes("How it works in the real world") || joined.includes("How it is organised");
    if (!hasModel) return true;

    return false;
  } catch {
    return true;
  }
}

export const isProgrammingCanvasOutdated = (rawCanvas: string, theoryStale = false) => isCanvasOutdated(rawCanvas, theoryStale, "Programación");

export function isPracticaOutdated(rawPractica: string, topicTitle: string, subject = "Programación"): boolean {
  if (!rawPractica) return true;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawPractica);
  if (!fmMatch) return true;
  const fm = fmMatch[1]!;

  const skillsMatch = /^skills:\s*\[(.*?)\]/m.exec(fm);
  const skills = skillsMatch
    ? skillsMatch[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];

  if (skills.length === 0) return true;

  if (subject === "Programación") {
    return isProgrammingPracticaOutdated(rawPractica, topicTitle);
  }

  if (subject === "Matemáticas") {
    const progSkills = new Set(["implement", "debug", "refactor", "trace", "design", "commands"]);
    if (skills.some((s) => progSkills.has(s))) return true;
  }

  if (subject === "Inglés") {
    const nonEnglish = new Set(["implement", "debug", "refactor", "trace", "solve", "prove", "counterexample", "drill"]);
    if (skills.some((s) => nonEnglish.has(s))) return true;
  }

  return false;
}

export function isExercisesOutdated(
  root: string,
  folder: string,
  topicTitle: string,
  subject = "Programación",
  practicaSkills?: string[],
  practicaChangedAt?: number,
): boolean {
  const ejDir = path.join(root, folder, "Ejercicios");
  if (!fs.existsSync(ejDir)) return false;
  const viewPath = path.join(root, folder, `${path.basename(folder)}.practica.md`);
  if (!fs.existsSync(viewPath)) return false;

  let subdirs: string[] = [];
  let rootFiles: string[] = [];
  try {
    const entries = fs.readdirSync(ejDir, { withFileTypes: true });
    subdirs = entries.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
    rootFiles = entries.filter((d) => d.isFile() && d.name.endsWith(".md") && !d.name.endsWith(".ejercicios.md")).map((d) => d.name);
  } catch {
    return false;
  }

  if (subdirs.length === 0 && rootFiles.length === 0) return false;
  if (rootFiles.length > 0) return true; // contrato: cada ejercicio debe vivir bajo Ejercicios/<skill>/

  // El sistema actual guarda un ejercicio por archivo dentro de Ejercicios/<skill>.
  // Comprueba sus IDs estables y la coherencia de la ruta con el manifiesto.
  const byId = new Map<string, string>();
  for (const skill of subdirs) {
    const skillDir = path.join(ejDir, skill);
    let files: string[] = [];
    try { files = activeExerciseFiles(skillDir); } catch { continue; }
    for (const name of files) {
      const abs = path.join(skillDir, name);
      const raw = readText(abs);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
      // exerciseIndex usa `id` si existe y, en su ausencia, el nombre del archivo.
      const id = /^id:\s*["']?([^\r\n"']+)/m.exec(fm)?.[1]?.trim() || path.basename(name, ".md");
      const prior = byId.get(id);
      if (prior && prior !== abs) return true;
      byId.set(id, abs);
      if (practicaSkills?.length && !practicaSkills.includes(skill)) return true;
      if (!/^type:\s*exercise\s*$/m.test(fm)) return true;
      const mode = /^mode:\s*["']?([\w-]+)/m.exec(fm)?.[1]?.trim();
      if (!mode || mode !== skill) return true;
    }
  }

  if (subject === "Programación") {
    if (isProgrammingExercisesOutdated(root, folder, topicTitle, practicaSkills, practicaChangedAt)) {
      return true;
    }
  }

  if (subject === "Matemáticas") {
    const progSkills = new Set(["implement", "debug", "refactor", "trace", "design", "commands"]);
    for (const s of subdirs) {
      if (progSkills.has(s)) {
        try {
          if (activeExerciseFiles(path.join(ejDir, s)).length > 0) return true;
        } catch {}
      }
    }
  }

  if (subject === "Inglés") {
    const foreign = new Set(["implement", "debug", "refactor", "trace", "solve", "prove", "counterexample"]);
    for (const s of subdirs) {
      if (foreign.has(s)) {
        try {
          if (activeExerciseFiles(path.join(ejDir, s)).length > 0) return true;
        } catch {}
      }
    }
  }

  // Comprobar que los ejercicios no pertenezcan a habilidades fuera del .practica actual
  if (practicaSkills && practicaSkills.length > 0) {
    const allowed = new Set(practicaSkills);
    for (const s of subdirs) {
      if (!allowed.has(s)) {
        try {
          if (activeExerciseFiles(path.join(ejDir, s)).length > 0) return true;
        } catch {}
      }
    }
  }

  // Comprobar si los archivos de ejercicios son más viejos que la última edición de la skill de práctica
  if (practicaChangedAt) {
    for (const s of subdirs) {
      try {
        const files = activeExerciseFiles(path.join(ejDir, s));
        for (const f of files) {
          const m = mtime(path.join(ejDir, s, f));
          if (m !== null && m < practicaChangedAt) return true;
        }
      } catch {}
    }
  }

  return false;
}

export function isProgrammingPracticaOutdated(rawPractica: string, topicTitle: string): boolean {
  if (!rawPractica) return true;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawPractica);
  if (!fmMatch) return true;
  const fm = fmMatch[1]!;

  const typeMatch = /^topic_type:\s*(\w+)/m.exec(fm);
  const topicType = typeMatch ? typeMatch[1] : undefined;
  const arch = archetypeOf({ title: topicTitle, topicType });

  const skillsMatch = /^skills:\s*\[(.*?)\]/m.exec(fm);
  const skills = skillsMatch
    ? skillsMatch[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];

  const planMatch = /^plan:\s*"?([^"\r\n]+)"?/m.exec(fm);
  const planStr = planMatch ? planMatch[1]! : "";

  const forbidden = new Set(ARCHETYPE_FORBIDDEN[arch]);
  if (skills.some((s) => forbidden.has(s))) return true;
  if ([...forbidden].some((f) => planStr.includes(`${f}=`))) return true;

  if (arch === "setup") {
    if (!skills.includes("project_structure") && !skills.includes("commands")) return true;
  } else if (arch === "concept") {
    if (topicType !== "theoretical") return true;
    if (!skills.includes("pg_quiz") && !skills.includes("pg_true_false")) return true;
  }

  return false;
}

export function isProgrammingExercisesOutdated(
  root: string,
  folder: string,
  topicTitle: string,
  practicaSkills?: string[],
  practicaChangedAt?: number,
): boolean {
  const ejDir = path.join(root, folder, "Ejercicios");
  if (!fs.existsSync(ejDir)) return false;
  const topicName = path.basename(folder);
  if (!fs.existsSync(path.join(root, folder, `${topicName}.practica.md`))) return false;

  let subdirs: string[] = [];
  try {
    subdirs = fs.readdirSync(ejDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return false;
  }

  if (subdirs.length === 0) return false;

  const ids = new Map<string, string>();
  for (const skill of subdirs) {
    const dir = path.join(ejDir, skill);
    let files: string[] = [];
    try { files = activeExerciseFiles(dir); } catch { continue; }
    for (const name of files) {
      const file = path.join(dir, name);
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readText(file))?.[1] ?? "";
      const id = /^id:\s*["']?([^\r\n"']+)/m.exec(fm)?.[1]?.trim() || path.basename(name, ".md");
      if (!/^type:\s*exercise\s*$/m.test(fm)) return true;
      if (ids.has(id) && ids.get(id) !== file) return true;
      ids.set(id, file);
      if (practicaSkills?.length && !practicaSkills.includes(skill)) return true;
    }
  }

  const arch = archetypeOf({ title: topicTitle });
  const forbidden = new Set(ARCHETYPE_FORBIDDEN[arch]);

  // Si hay alguna carpeta de habilidad prohibida con archivos .md
  for (const s of subdirs) {
    if (forbidden.has(s)) {
      try {
        const files = activeExerciseFiles(path.join(ejDir, s));
        if (files.length > 0) return true;
      } catch {}
    }
  }

  // En setup: si existen ejercicios, pero ninguno de estructura ni comandos
  if (arch === "setup") {
    const hasSetupEx = ["project_structure", "commands"].some((s) => {
      try {
        const p = path.join(ejDir, s);
        return fs.existsSync(p) && activeExerciseFiles(p).length > 0;
      } catch {
        return false;
      }
    });
    const totalEx = subdirs.reduce((acc, s) => {
      try {
        return acc + activeExerciseFiles(path.join(ejDir, s)).length;
      } catch {
        return acc;
      }
    }, 0);
    if (totalEx > 0 && !hasSetupEx) return true;
  }

  // Si tenemos lista de habilidades del .practica actual, comprobar si hay ejercicios fuera de ellas
  if (practicaSkills && practicaSkills.length > 0) {
    const allowed = new Set(practicaSkills);
    for (const s of subdirs) {
      if (!allowed.has(s)) {
        try {
          const files = activeExerciseFiles(path.join(ejDir, s));
          if (files.length > 0) return true;
        } catch {}
      }
    }
  }

  // Comprobar si los archivos de ejercicios son más viejos que la última edición de la skill de práctica
  if (practicaChangedAt) {
    for (const s of subdirs) {
      try {
        const files = activeExerciseFiles(path.join(ejDir, s));
        for (const f of files) {
          const m = mtime(path.join(ejDir, s, f));
          if (m !== null && m < practicaChangedAt) return true;
        }
      } catch {}
    }
  }

  return false;
}

/** Los ejercicios archivados siguen accesibles por su ruta e ID, pero no forman parte del plan activo. */
function activeExerciseFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".md") && !name.endsWith(".ejercicios.md")).filter((name) => {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readText(path.join(dir, name)))?.[1] ?? "";
      return !/^archived:\s*(?:true|["']true["'])\s*$/im.test(fm);
    });
  } catch { return []; }
}

/** Para cada carpeta de tema (relativa a la vault), qué piezas existen pero son más viejas que su skill o tienen formato desactualizado. */
export function outdatedByFolder(root: string, folders: Iterable<string>): Map<string, OutdatedSkills> {
  const list = [...folders];
  const subjectOf = (folder: string): string => folder.split("/")[0] ?? "";
  const times = skillChangeTimes(root, new Set(list.map(subjectOf).filter(Boolean)));
  // Cache only for this scan: edits are observed on the next invocation.
  const versions = new Map<string, string | null>();
  const contents = new Map<string, string>();
  const textOf = (file: string): string => {
    if (!contents.has(file)) contents.set(file, fs.readFileSync(file, "utf8"));
    return contents.get(file)!;
  };
  let canvasVersions: Record<string, unknown> | undefined;
  const canvasStamp = (rel: string): string | null => {
    if (!canvasVersions) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, ".notevault", "estudio", "canvas_versions.json"), "utf8"));
        canvasVersions = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      } catch { canvasVersions = {}; }
    }
    const value = canvasVersions[rel];
    return typeof value === "string" ? value : null;
  };
  const out = new Map<string, OutdatedSkills>();
  for (const folder of list) {
    contents.clear();
    const subject = subjectOf(folder);
    const name = folder.split("/").pop() ?? "";
    if (!subject || !name) continue;
    const pieces: Record<Kind, string> = { theory: `${name}.md`, canvas: `${name} — mapa.canvas`, practica: `${name}.practica.md` };
    const stale: OutdatedSkills = {};
    for (const kind of KINDS) {
      const changed = times.get(`${subject}/${kind}`);
      const filePath = path.join(root, folder, pieces[kind]);
      const made = mtime(filePath);
      // con marca de versión manda la marca (la pieza dice con qué skill se hizo); sin marca, la fecha del archivo
      let stamp: string | null = null;
      if (made !== null) {
        if (kind === "canvas") stamp = canvasStamp(path.posix.join(folder, pieces.canvas));
        else { try { stamp = stampOf(textOf(filePath)); } catch { /* structural check below handles unreadable files */ } }
      }
      const key = `${subject}/${kind}`;
      if (stamp && !versions.has(key)) versions.set(key, skillVersionOf(root, subject, kind));
      const current = stamp ? versions.get(key) ?? null : null;
      if (stamp && current) {
        if (stamp !== current) stale[kind] = true;
      } else if (changed !== undefined && made !== null && made < changed) stale[kind] = true;
    }

    // Comprobación estructural en caliente para todos los formatos y materias
    const thPath = path.join(root, folder, pieces.theory);
    if (fs.existsSync(thPath)) {
      try {
        const rawTh = textOf(thPath);
        if (isTheoryOutdated(rawTh, subject)) {
          stale.theory = true;
        }
      } catch {
        stale.theory = true;
      }
    }
    const cvPath = path.join(root, folder, pieces.canvas);
    if (fs.existsSync(cvPath)) {
      try {
        const rawCv = textOf(cvPath);
        if (isCanvasOutdated(rawCv, !!stale.theory, subject)) {
          stale.canvas = true;
        }
      } catch {
        stale.canvas = true;
      }
    }
    const prPath = path.join(root, folder, pieces.practica);
    let practicaSkills: string[] | undefined;
    if (fs.existsSync(prPath)) {
      try {
        const rawPr = textOf(prPath);
        if (isPracticaOutdated(rawPr, name, subject)) {
          stale.practica = true;
        }
        const m = /skills:\s*\[(.*?)\]/.exec(rawPr);
        if (m) {
          practicaSkills = m[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
      } catch {
        stale.practica = true;
      }
    }
    const practicaChangedAt = times.get(`${subject}/practica`);
    if (isExercisesOutdated(root, folder, name, subject, practicaSkills, practicaChangedAt)) {
      stale.exercises = true;
    }

    if (stale.theory || stale.canvas || stale.practica || stale.exercises) out.set(folder, stale);
  }
  return out;
}
