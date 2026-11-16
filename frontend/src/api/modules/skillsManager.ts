// SKILLS: las instrucciones con las que se generan las piezas de un tema (nota de teoría, mapa, archivo de práctica). Esta API deja VERLAS, EDITARLAS a
// mano, ver sus versiones anteriores (como máximo MAX_PAST) y pedir cambios en lenguaje normal: con la IA de la app (api o modelo local) o como un
// prompt para pegar en Antigravity / cualquier IA. Una petición NUNCA guarda por sí sola: devuelve una propuesta y la persona decide guardarla.
//
// El historial vive en `.notevault/skills_history/<materia>/<tipo>/<fecha>_<versión>.md` (la skill sigue siendo el archivo `_skills/*.md` de la vault).
// Cada guardado cambia el hash de la skill, y con él la app ve sola qué piezas quedan hechas con otra versión (`skillFreshness`).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { AIConfig } from "../../core/aiClient.js";
import { ApiError } from "../../core/errors.js";
import { shortVersion } from "../../lib/skillStamp.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";
import { askStructured } from "./study.js";

export const MAX_PAST = 3;
/** Las skills que se gestionan: cada tipo es el archivo que genera una pieza del tema. */
export const SKILL_KINDS = {
  theory: { file: "resumen_teorico_skill.md", label: "Notas de teoría (md)", makes: "la nota de teoría `<tema>/<tema>.md`" },
  canvas: { file: "mapa_skill.md", label: "Mapa (canvas)", makes: "el mapa explicativo `<tema> — mapa.canvas`" },
  ejercicios: { file: "ejercicios_skill.md", label: "Ejercicios", makes: "los ejercicios de práctica" },
  practica: { file: "practica_skill.md", label: "Archivos de práctica", makes: "el archivo de práctica `<tema>.practica.md` y sus ejercicios" },
} as const;
export type SkillKind = keyof typeof SKILL_KINDS;
const KINDS = Object.keys(SKILL_KINDS) as SkillKind[];
/** Tope del texto de una skill: son instrucciones, no libros. */
const MAX_CHARS = 120_000;

export interface SkillVersion {
  id: string;
  savedAt: string;
  version: string;
  words: number;
}
export interface SkillInfo {
  subject: string;
  kind: SkillKind;
  label: string;
  file: string;
  version: string | null;
  words: number;
  updatedAt: string | null;
  past: SkillVersion[];
}

const wc = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const versionOfText = (text: string): string => shortVersion(createHash("sha1").update(text.replace(/\r\n/g, "\n")).digest("hex"));
const stampName = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

export function skillsManagerApi(app: AppState, hooks: { now?: () => Date; ask?: (cfg: AIConfig, messages: Array<{ role: string; content: string }>) => Promise<string> } = {}) {
  const now = (): Date => (hooks.now ?? (() => new Date()))();
  const subjects = (): string[] => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(app.root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    } catch {
      return [];
    }
    return names.filter((n) => fs.existsSync(path.join(app.root, n, "_skills", SKILL_KINDS.theory.file))).sort();
  };
  const parse = (input: unknown): { subject: string; kind: SkillKind } => {
    const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const subject = String(o.subject ?? "");
    const kind = String(o.kind ?? "") as SkillKind;
    if (!KINDS.includes(kind)) throw new ApiError("Esa skill no existe: elige notas, mapa o práctica.");
    if (!subject || /[\\/]|\.\./.test(subject) || !subjects().includes(subject)) throw new ApiError("Esa materia no tiene skills.");
    return { subject, kind };
  };
  const fileOf = (subject: string, kind: SkillKind): string => path.join(app.root, subject, "_skills", SKILL_KINDS[kind].file);
  const histDir = (subject: string, kind: SkillKind): string => path.join(app.root, ".notevault", "skills_history", subject, kind);

  const pastOf = (subject: string, kind: SkillKind): SkillVersion[] => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(histDir(subject, kind)).filter((n) => n.endsWith(".md"));
    } catch {
      return [];
    }
    return names
      .sort()
      .reverse()
      .slice(0, MAX_PAST)
      .map((n) => {
        const text = fs.readFileSync(path.join(histDir(subject, kind), n), "utf-8");
        const [date = "", ver = ""] = n.replace(/\.md$/, "").split("_");
        return { id: n.replace(/\.md$/, ""), savedAt: date, version: ver, words: wc(text) };
      });
  };
  const infoOf = (subject: string, kind: SkillKind): SkillInfo => {
    const abs = fileOf(subject, kind);
    let text: string | null = null;
    let updatedAt: string | null = null;
    try {
      text = fs.readFileSync(abs, "utf-8");
      updatedAt = fs.statSync(abs).mtime.toISOString();
    } catch {
      /* la skill no existe aún */
    }
    return { subject, kind, label: SKILL_KINDS[kind].label, file: `${subject}/_skills/${SKILL_KINDS[kind].file}`, version: text === null ? null : versionOfText(text), words: text === null ? 0 : wc(text), updatedAt, past: pastOf(subject, kind) };
  };

  /** Guarda lo actual como versión pasada (si cambia) y recorta el historial a MAX_PAST. */
  const archive = (subject: string, kind: SkillKind, current: string): void => {
    const dir = histDir(subject, kind);
    fs.mkdirSync(dir, { recursive: true });
    const ver = versionOfText(current);
    if (fs.readdirSync(dir).some((n) => n.endsWith(`_${ver}.md`))) return; // ya está archivada
    fs.writeFileSync(path.join(dir, `${stampName(now())}_${ver}.md`), current, "utf-8");
    const all = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort().reverse();
    for (const old of all.slice(MAX_PAST)) fs.rmSync(path.join(dir, old), { force: true });
  };

  const write = (subject: string, kind: SkillKind, text: string): SkillInfo => {
    const body = text.replace(/\r\n/g, "\n");
    if (!body.trim()) throw new ApiError("La skill no puede quedar vacía.");
    if (body.length > MAX_CHARS) throw new ApiError(`La skill es demasiado larga (máximo ${MAX_CHARS} caracteres).`);
    const abs = fileOf(subject, kind);
    let current = "";
    try {
      current = fs.readFileSync(abs, "utf-8");
    } catch {
      /* primera vez */
    }
    if (current.replace(/\r\n/g, "\n") === body) return infoOf(subject, kind); // nada cambió: no se crea una versión vacía
    if (current) archive(subject, kind, current);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body.endsWith("\n") ? body : `${body}\n`, "utf-8");
    return infoOf(subject, kind);
  };

  /** El prompt que se pega en Antigravity (o en cualquier IA): la skill actual, el cambio pedido y lo que debe devolver. */
  const promptFor = (subject: string, kind: SkillKind, instruction: string, current: string): string =>
    [
      `You are editing an instruction file ("skill") that tells an AI how to write ${SKILL_KINDS[kind].makes} in a NoteVault study vault (subject: ${subject}).`,
      "",
      "## Change requested",
      instruction.trim(),
      "",
      "## Rules",
      "- Return the COMPLETE new text of the skill, nothing else: no explanations before or after, no code fence around the whole file.",
      "- Keep every part the change does not touch exactly as it is (headings, field names and counts are a contract that programs parse).",
      "- Keep the language of the file (English). Do not add commentary about what you changed.",
      "- Keep the file consistent with itself: if the change affects a number, a limit or a name that appears in several places, update all of them.",
      "",
      "## Current skill",
      "```markdown",
      current.replace(/\s+$/, ""),
      "```",
      "",
    ].join("\n");

  const getSkill = (input: unknown): { text: string; info: SkillInfo; versionId?: string } => {
      const { subject, kind } = parse(input);
      const o = input as Record<string, unknown>;
      const versionId = o.versionId === undefined ? undefined : String(o.versionId);
      if (versionId !== undefined) {
        if (!/^[\w-]+$/.test(versionId)) throw new ApiError("Esa versión no existe.");
        const file = path.join(histDir(subject, kind), `${versionId}.md`);
        if (!fs.existsSync(file)) throw new ApiError("Esa versión ya no está guardada (solo se conservan las últimas).");
        return { text: fs.readFileSync(file, "utf-8"), info: infoOf(subject, kind), versionId };
      }
      let text = "";
      try {
        text = fs.readFileSync(fileOf(subject, kind), "utf-8");
      } catch {
        if (kind !== "ejercicios") throw new ApiError("Esta skill aún no existe en la vault.");
      }
      return { text, info: infoOf(subject, kind) };
    };

  return {
    skills_custom_list(input: unknown): Array<{ name: string; file: string }> {
      const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const subject = String(o.subject ?? "");
      if (!subjects().includes(subject)) throw new ApiError("Esa materia no tiene skills.");
      const dir = path.join(app.root, ".notevault", "skills", subject);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith(".md")).map((f) => ({ name: f.name.slice(0, -3), file: `.notevault/skills/${subject}/${f.name}` }));
    },
    skills_custom_create(input: unknown): { file: string } {
      const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const subject = String(o.subject ?? ""), name = String(o.name ?? "").trim(), content = String(o.text ?? "").trim();
      if (!subjects().includes(subject)) throw new ApiError("Esa materia no tiene skills.");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new ApiError("Usa letras, números, guiones o guiones bajos para el nombre.");
      if (!content || content.length > MAX_CHARS) throw new ApiError("Escribe instrucciones válidas para la skill.");
      const dir = path.join(app.root, ".notevault", "skills", subject);
      fs.mkdirSync(dir, { recursive: true });
      try { fs.writeFileSync(path.join(dir, `${name}.md`), `${content}\n`, { encoding: "utf8", flag: "wx" }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ApiError("Ya existe una skill con ese nombre."); throw e; }
      return { file: `.notevault/skills/${subject}/${name}.md` };
    },

    skills_list(): { subjects: Array<{ subject: string; skills: SkillInfo[] }>; maxPast: number } {
      return { subjects: subjects().map((subject) => ({ subject, skills: KINDS.map((k) => infoOf(subject, k)) })), maxPast: MAX_PAST };
    },

    skills_get(input: unknown): { text: string; info: SkillInfo; versionId?: string } {
      return getSkill(input);
    },

    skills_save(input: unknown): SkillInfo {
      const { subject, kind } = parse(input);
      return write(subject, kind, String((input as Record<string, unknown>).text ?? ""));
    },

    skills_restore(input: unknown): SkillInfo {
      const { subject, kind } = parse(input);
      const got = getSkill({ subject, kind, versionId: (input as Record<string, unknown>).versionId });
      return write(subject, kind, got.text);
    },

    /** `mode: "prompt"` devuelve el texto para pegar en Antigravity; `mode: "app"` pide la propuesta a la IA configurada en la app (nunca guarda). */
    async skills_ai_edit(input: unknown): Promise<{ mode: "prompt" | "app"; prompt: string; proposal?: string }> {
      const { subject, kind } = parse(input);
      const o = input as Record<string, unknown>;
      const instruction = String(o.instruction ?? "").trim();
      if (instruction.length < 5) throw new ApiError("Escribe qué quieres cambiar en la skill.");
      if (instruction.length > 4000) throw new ApiError("La petición es demasiado larga (máximo 4000 caracteres).");
      const current = fs.readFileSync(fileOf(subject, kind), "utf-8");
      const prompt = promptFor(subject, kind, instruction, current);
      if (o.mode !== "app") return { mode: "prompt", prompt };
      const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
      if (cfg.is_bridge) throw new ApiError("La IA de la app está en modo puente (sin API ni modelo local). Usa «Copiar prompt» y pégalo en Antigravity.");
      const ask = hooks.ask ?? ((c, m) => askStructured(c, m));
      let reply = "";
      try {
        reply = await ask(cfg, [
          { role: "system", content: "You rewrite instruction files for a study app. Follow the user's rules exactly and return only the new file text." },
        { role: "user", content: prompt },
        ]);
      } catch (e) {
        // un error del proveedor (clave mala, sin saldo, modelo apagado) se dice en claro y se ofrece la salida que no depende de él
        throw new ApiError(`La IA de la app no pudo responder: ${(e as Error).message.replace(/^AIError:\s*/, "").slice(0, 200)}. Revisa su configuración en Ajustes o usa «Copiar prompt para Antigravity».`);
      }
      const proposal = reply.trim().replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/, "");
      if (!proposal) throw new ApiError("La IA no devolvió ningún texto. Inténtalo de nuevo o usa «Copiar prompt».");
      return { mode: "app", prompt, proposal };
    },
  };
}
