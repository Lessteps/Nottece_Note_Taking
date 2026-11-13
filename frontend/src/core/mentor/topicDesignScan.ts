/**
 * Detección en disco del diseño de los temas de un plan: lista la carpeta de cada tema, lee su nota de teoría y su manifiesto de práctica
 * y entrega a `lib/topicDesign.ts` (puro) lo que necesita. SOLO LEE: nunca escribe en la vault. Los ejercicios vienen del escaneo de la vault
 * (skill y dificultad de cada nota de ejercicio) para no releer cientos de archivos.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { evaluateTopicDesign, hasTheoryFile, type TopicDesign, type TopicDesignInput } from "../../lib/topicDesign.js";
import { parseFrontmatter } from "../frontmatter.js";
import { parsePlanString } from "../practice/topic.js";

export interface DesignScanTopic {
  folder: string;
  title: string;
  /** ruta absoluta de su manifiesto, si la vault tiene uno */
  manifestPath?: string;
  subject?: string;
}

export interface DesignScanContext {
  /** raíz de la vault */
  root: string;
  /** ejercicios de la vault (`ExerciseRef`): solo se usan la ruta, la skill y la dificultad */
  exercises: ReadonlyArray<{ rel?: string; path: string; skill: string; mode?: string; difficulty: number }>;
}

const MAX_THEORY_CHARS = 400_000;

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf-8").slice(0, MAX_THEORY_CHARS);
  } catch {
    return undefined;
  }
}

/** El manifiesto tal como está escrito en el archivo (lo declarado, sin las skills por defecto de la materia). */
export function readRawManifest(file: string): TopicDesignInput["manifest"] {
  const text = readText(file);
  if (text === undefined) return null;
  const [fm] = parseFrontmatter(text);
  if (!fm || typeof fm !== "object") return null;
  const raw = (fm as Record<string, any>).skills;
  const skills = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : []).map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean);
  const plan = parsePlanString((fm as Record<string, any>).plan);
  const planSkills = plan ? Object.keys(plan) : [];
  const target = Number((fm as Record<string, any>).target_difficulty);
  return {
    ...((fm as Record<string, any>).topic_type ? { topicType: String((fm as Record<string, any>).topic_type) } : {}),
    skills: skills.length ? skills : planSkills,
    ...(plan ? { plan } : {}),
    ...(Number.isFinite(target) ? { targetDifficulty: target } : {}),
  };
}

/** Evalúa el diseño de cada tema de `topics`. Nunca lanza: un tema ilegible cuenta como carpeta sin nada. */
export function scanTopicDesigns(topics: readonly DesignScanTopic[], ctx: DesignScanContext): Map<string, TopicDesign> {
  const out = new Map<string, TopicDesign>();
  for (const t of topics) {
    const abs = path.join(ctx.root, ...t.folder.split("/"));
    let files: string[] = [];
    let exists = false;
    try {
      files = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
      exists = true;
    } catch {
      exists = false;
    }
    let manifest: TopicDesignInput["manifest"] = null;
    if (exists) {
      const mfile = t.manifestPath ?? (() => {
        const name = path.basename(abs);
        for (const c of [`${name}.practica.md`, "_tema.md", "tema.md"]) if (files.includes(c)) return path.join(abs, c);
        return undefined;
      })();
      if (mfile) manifest = readRawManifest(mfile);
    }
    const theoryName = files.filter((f) => hasTheoryFile([f])).sort((a, b) => Number(b === `${path.basename(abs)}.md`) - Number(a === `${path.basename(abs)}.md`))[0];
    const theoryText = theoryName ? readText(path.join(abs, theoryName)) : undefined;
    const prefix = t.folder + "/";
    const exercises = ctx.exercises
      .filter((e) => (e.rel || e.path).replace(/\\/g, "/").startsWith(prefix))
      // la skill de un ejercicio puede estar en `mode` o en `skill` (se acepta cualquiera de las dos)
      .flatMap((e) => [...new Set([String(e.mode ?? ""), String(e.skill ?? "")].filter(Boolean))].map((skill) => ({ skill, difficulty: e.difficulty })));
    out.set(
      t.folder,
      evaluateTopicDesign({
        folder: t.folder,
        title: t.title,
        ...(t.subject ? { subject: t.subject } : {}),
        exists,
        files,
        ...(theoryText !== undefined ? { theoryText } : {}),
        manifest,
        exercises,
      }),
    );
  }
  return out;
}

/**
 * Los ejercicios de un tema leídos del DISCO (carpeta `Ejercicios/<skill>/…` y cualquier nota `type: exercise` bajo el tema), sin el escaneo
 * de toda la vault. Es lo que usa «Ejecutar plan» para validar el resultado de una tarea justo después de escribirlo.
 */
export function diskExercises(root: string, folder: string, maxFiles = 600): Array<{ path: string; rel: string; skill: string; mode: string; difficulty: number }> {
  const out: Array<{ path: string; rel: string; skill: string; mode: string; difficulty: number }> = [];
  const base = path.join(root, ...folder.split("/"));
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md") && !e.name.startsWith("_")) {
        const text = readText(full);
        if (text === undefined) continue;
        const [fm] = parseFrontmatter(text.slice(0, 4000));
        if (!fm || String((fm as Record<string, any>).type ?? "").toLowerCase() !== "exercise") continue;
        const f = fm as Record<string, any>;
        if (f.archived === true || String(f.archived).toLowerCase() === "true") continue;
        out.push({ path: full, rel: path.relative(root, full).split(path.sep).join("/"), skill: String(f.skill ?? ""), mode: String(f.mode ?? f.skill ?? ""), difficulty: Math.max(1, Math.min(3, Number(f.difficulty) || 1)) });
      }
    }
  };
  walk(base, 0);
  return out;
}
