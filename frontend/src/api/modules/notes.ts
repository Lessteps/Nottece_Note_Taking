// Ported from the note-level, file tree, search and knowledge methods
// of notevault_app/webapp/api.py.

import * as fs from "node:fs";
import { markOwnWrite } from "../../core/ownWrites.js";
import { archiveCanvasAlternates } from "../../core/canvas/canvasVersions.js";
import * as path from "node:path";
import { ApiError } from "../../core/errors.js";
import { kindFor } from "../../core/fileKinds.js";
import {
  parseFrontmatter,
  sanitizeProperties,
  VALID_STATUSES,
  VALID_SUBJECTS,
  VALID_TYPES,
} from "../../core/frontmatter.js";
import { resolveAttachment } from "../../core/attachments.js";
import { KnowledgeGraph } from "../../core/knowledgeGraph.js";
import { EnglishVocabularyManager } from "../../core/englishVocabularyManager.js";
import { Note } from "../../core/vaultManager.js";
import {
  IMAGE_EXTS,
  jsonSafe,
  MAX_ATTACHMENT_BYTES,
  MAX_WRITE_BYTES,
  setFrontmatterKeys,
  type AppState,
} from "../appState.js";

/** One record per line; git separates the fields inside it with US (0x1f). */
const SPLIT_LINE = "\n";
const SPLIT_FIELD = "\u001f";

function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Run git inside the vault. Returns "" when there is no repository or nothing to
 * report, and null from `strict` calls so callers can tell "missing" from "empty".
 */
function git(root: string, args: string[], strict = false): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf-8",
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return out;
  } catch {
    return strict ? null : "";
  }
}

export function notesApi(app: AppState) {
  return {
    save_text_as(suggestedName: string, text: string): Record<string, unknown> {
      if (!app.window) {
        return { ok: false, fallback: true };
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as {
          dialog?: { showSaveDialogSync(w: unknown, opts: Record<string, unknown>): string | undefined };
        };
        const cleanName = String(suggestedName || "export.csv")
          .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
          .slice(0, 120);
        const name = /\.(csv|txt|md)$/i.test(cleanName) ? cleanName : `${cleanName}.csv`;
        const data = String(text ?? "");
        if (Buffer.byteLength(data, "utf-8") > MAX_WRITE_BYTES) {
          throw new ApiError("El archivo es demasiado grande.");
        }
        if (!electron?.dialog) return { ok: false, fallback: true };
        const chosen = electron.dialog.showSaveDialogSync(app.window, { defaultPath: name });
        if (!chosen) return { ok: false };
        // UTF-8 with BOM so Excel reads accents correctly.
        fs.writeFileSync(chosen, "\uFEFF" + data, "utf-8");
        return { ok: true, path: chosen };
      } catch (e) {
        if (e instanceof ApiError) throw e;
        return { ok: false, fallback: true };
      }
    },

    list_dir(rel = ""): Record<string, unknown>[] {
      const folder = app.resolve(rel, { allowRoot: true });
      if (!fs.statSync(folder).isDirectory()) {
        throw new ApiError("No es una carpeta.");
      }
      // Las variantes generadas antiguas se guardan en papelera solo si existe el mapa principal.
      try { archiveCanvasAlternates(app.root, folder); } catch { /* no impedir abrir la carpeta si no se puede archivar */ }
      return app.service.childrenOf(folder).map((i) => app.entry(i));
    },

    note_index(limit = 5000): { path: string; title: string }[] {
      const lim = Math.max(1, Math.min(Number(limit) || 5000, 20000));
      const out: { path: string; title: string }[] = [];
      for (const p of app.vault.notePaths(lim)) {
        let relPath: string;
        try {
          relPath = app.rel(p);
        } catch {
          continue;
        }
        if (relPath.split("/").some((part) => part.startsWith("."))) continue;
        out.push({ path: relPath, title: path.parse(p).name });
      }
      return out;
    },

    read_note(rel: string): Record<string, unknown> {
      const p = app.resolve(rel);
      const kind = kindFor(p);
      if (!fs.statSync(p).isFile() || (kind !== "note" && kind !== "code")) {
        throw new ApiError("Ese archivo no se puede abrir como nota.");
      }
      const raw = fs.readFileSync(p, "utf-8");
      let fm: Record<string, unknown> = {};
      let body = raw;
      if (kind === "note") {
        const [parsedFm, parsedBody] = parseFrontmatter(raw);
        fm = parsedFm as Record<string, unknown>;
        body = parsedBody;
      }
      const stat = fs.statSync(p);
      return {
        path: app.rel(p),
        name: path.basename(p),
        title: kind === "code" ? path.basename(p) : path.parse(p).name,
        kind,
        raw,
        frontmatter: jsonSafe(fm ?? {}) as Record<string, unknown>,
        body,
        modified: stat.mtimeMs / 1000,
        bookmarked: app.service.isBookmarked(p),
      };
    },

    write_note(
      rel: string,
      raw: string,
      expected_modified?: number | null,
    ): { ok: boolean; conflict?: boolean; modified: number } {
      if (typeof raw !== "string") {
        throw new ApiError("Contenido inválido.");
      }
      if (Buffer.byteLength(raw, "utf-8") > MAX_WRITE_BYTES) {
        throw new ApiError("La nota supera el tamaño máximo (10 MB).");
      }
      const p = app.resolve(rel, { mustExist: false });
      const kind = kindFor(p);
      if (kind === "code" && !fs.existsSync(p)) {
        throw new ApiError("Solo se pueden editar archivos de código existentes.");
      }
      if (kind !== "note" && kind !== "code") {
        throw new ApiError("Solo se pueden guardar notas (.md).");
      }
      if (expected_modified !== undefined && expected_modified !== null && fs.existsSync(p)) {
        const mtime = fs.statSync(p).mtimeMs / 1000;
        if (Math.abs(mtime - Number(expected_modified)) > 1e-4) {
          return { ok: false, conflict: true, modified: mtime };
        }
      }
      const existed = fs.existsSync(p);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, raw, "utf-8");
      app.service.noteWritten(p, raw);
      // editar una nota que ya existía no cambia la estructura de la vault: su eco en el vigilante no debe disparar la relectura de planes y temas
      if (existed) markOwnWrite(p);
      return { ok: true, conflict: false, modified: fs.statSync(p).mtimeMs / 1000 };
    },

    create_note(title: string, folder_rel = ""): { path: string } {
      const t = (title || "").trim();
      if (!t) {
        throw new ApiError("El título está vacío.");
      }
      const folder = app.resolve(folder_rel, { allowRoot: true });
      if (!fs.statSync(folder).isDirectory()) {
        throw new ApiError("No es una carpeta.");
      }
      const note = app.service.createNote(t, folder);
      return { path: app.rel(note.path) };
    },

    create_folder(name: string, parent_rel = ""): { path: string } {
      const n = (name || "").trim();
      if (!n || n.startsWith(".")) {
        throw new ApiError("Nombre de carpeta inválido.");
      }
      const parent = app.resolve(parent_rel, { allowRoot: true });
      const folder = app.service.createFolder(n, parent);
      return { path: app.rel(folder) };
    },

    rename(rel: string, new_name: string): { path: string } {
      const p = app.resolve(rel);
      const n = (new_name || "").trim();
      if (!n || n.startsWith(".")) {
        throw new ApiError("Nombre inválido.");
      }
      return { path: app.rel(app.service.renamePath(p, n)) };
    },

    delete(rel: string): { ok: boolean } {
      const p = app.resolve(rel);
      app.service.deletePath(p);
      return { ok: true };
    },

    move(rel: string, dest_folder_rel: string): { path: string } {
      const src = app.resolve(rel);
      const dest = app.resolve(dest_folder_rel, { allowRoot: true });
      if (!fs.statSync(dest).isDirectory()) {
        throw new ApiError("El destino no es una carpeta.");
      }
      if (fs.statSync(src).isDirectory()) {
        const relToSrc = path.relative(src, dest);
        if (dest === src || (!relToSrc.startsWith("..") && !path.isAbsolute(relToSrc))) {
          throw new ApiError("No se puede mover una carpeta dentro de sí misma.");
        }
      }
      return { path: app.rel(app.service.movePath(src, dest)) };
    },

    resolve_link(target: string): { path: string | null } {
      const clean = (target || "").split("#")[0]!.split("|")[0]!.trim();
      if (!clean || clean.replace(/\\/g, "/").split("/").includes("..")) {
        return { path: null };
      }
      // Exact vault path first: [[folder/Note.md]] and [[folder/Note]]
      const cand1 = path.resolve(app.root, clean);
      if (isInside(app.root, cand1) && fs.existsSync(cand1) && fs.statSync(cand1).isFile()) {
        return { path: app.rel(cand1) };
      }
      const cand2 = path.resolve(app.root, clean.endsWith(".md") ? clean : `${clean}.md`);
      if (isInside(app.root, cand2) && fs.existsSync(cand2) && fs.statSync(cand2).isFile()) {
        return { path: app.rel(cand2) };
      }

      // Check note index for exact name/stem match
      const targetLower = clean.toLowerCase();
      const notes = app.service.index.ready ? app.service.index.cachedNotes() : app.service.index.notes();
      for (const entry of notes) {
        const p = entry.path;
        const stem = path.parse(p).name.toLowerCase();
        if (stem === targetLower || stem.replace(/_/g, " ") === targetLower.replace(/_/g, " ")) {
          return { path: app.rel(p) };
        }
      }

      // Unambiguous prefix match
      const matches: string[] = [];
      for (const entry of notes) {
        const p = entry.path;
        const stem = path.parse(p).name.toLowerCase();
        if (stem.startsWith(targetLower) || stem.replace(/_/g, " ").startsWith(targetLower.replace(/_/g, " "))) {
          matches.push(p);
        }
      }
      if (matches.length === 1) {
        return { path: app.rel(matches[0]!) };
      }

      return { path: null };
    },

    search(
      query: string,
      limit = 100,
    ): { path: string; title: string; line_no: number; line: string }[] {
      const q = (query || "").trim();
      if (!q) return [];
      const lim = Math.max(1, Math.min(Number(limit) || 100, 500));
      return app.service.search(q, lim).map((h) => ({
        path: app.rel(h.path),
        title: h.title,
        line_no: h.line_no,
        line: h.line,
      }));
    },

    mentions(rel: string): {
      linked: { path: string; title: string; line_no: number; line: string }[];
      unlinked: { path: string; title: string; line_no: number; line: string }[];
    } {
      const p = app.resolve(rel);
      const note = new Note(p, app.root);
      const [linked, unlinked] = app.service.mentions(note);
      const row = (m: { path: string; title: string; line_no: number; line: string }) => ({
        path: app.rel(m.path),
        title: m.title,
        line_no: m.line_no,
        line: m.line,
      });
      return {
        linked: linked.map(row),
        unlinked: unlinked.map(row),
      };
    },

    bookmarks(): { path: string; label: string }[] {
      const out: { path: string; label: string }[] = [];
      for (const b of app.service.bookmarksRich()) {
        if (b.type !== "note") continue;
        try {
          const p = app.resolve(b.target || "");
          out.push({ path: app.rel(p), label: b.label || path.parse(p).name });
        } catch {
          continue;
        }
      }
      return out;
    },

    toggle_bookmark(rel: string): { bookmarked: boolean } {
      const p = app.resolve(rel);
      return { bookmarked: Boolean(app.service.toggleBookmark(p)) };
    },

    note_properties_meta(): {
      subjects: string[];
      types: string[];
      statuses: string[];
    } {
      return {
        subjects: Array.from(VALID_SUBJECTS),
        types: Array.from(VALID_TYPES),
        statuses: Array.from(VALID_STATUSES),
      };
    },

    note_set_properties(
      rel: string,
      props: Record<string, unknown>,
      expected_modified?: number | null,
    ): { ok: boolean; conflict?: boolean; modified: number } {
      if (!props || typeof props !== "object") {
        throw new ApiError("Propiedades inválidas.");
      }
      const clean: Record<string, unknown> = {};
      const validSub = new Set<string>(VALID_SUBJECTS);
      const validTypes = new Set<string>(VALID_TYPES);
      const validStatuses = new Set<string>(VALID_STATUSES);

      if (typeof props.subject === "string" && validSub.has(props.subject)) {
        clean.subject = props.subject;
      }
      if (typeof props.type === "string" && validTypes.has(props.type)) {
        clean.type = props.type;
      }
      if (typeof props.status === "string" && validStatuses.has(props.status)) {
        clean.status = props.status;
      }
      if ("topic" in props) {
        const topic = String(props.topic || "")
          .replace(/[\r\n\t\x00-\x1f]+/g, " ")
          .trim()
          .slice(0, 120);
        clean.topic = topic || null;
      }
      if ("difficulty" in props) clean.difficulty = props.difficulty;
      if ("mastery" in props) clean.mastery = props.mastery;
      if ("tags" in props) {
        const rawTags = Array.isArray(props.tags)
          ? props.tags
          : String(props.tags || "").split(",");
        const tags = rawTags
          .map((t) => String(t).replace(/[\[\]"',#\r\n\t\x00-\x1f]+/g, "").trim())
          .filter(Boolean);
        clean.tags = tags.slice(0, 30).map((t) => t.slice(0, 40));
        if ((clean.tags as string[]).length === 0) clean.tags = null;
      }

      const sanitized = sanitizeProperties(clean);
      const p = app.resolve(rel);
      if (kindFor(p) !== "note") {
        throw new ApiError("Solo notas .md.");
      }
      if (expected_modified !== undefined && expected_modified !== null && fs.existsSync(p)) {
        const mtime = fs.statSync(p).mtimeMs / 1000;
        if (Math.abs(mtime - Number(expected_modified)) > 1e-4) {
          return { ok: false, conflict: true, modified: mtime };
        }
      }

      const raw = fs.readFileSync(p, "utf-8");
      // setFrontmatterKeys preserves the note's own line endings.
      const text = setFrontmatterKeys(raw, sanitized);
      fs.writeFileSync(p, text, "utf-8");
      app.service.noteWritten(p, text);
      return { ok: true, conflict: false, modified: fs.statSync(p).mtimeMs / 1000 };
    },

    english_sentences(): string[] {
      const mgr = new EnglishVocabularyManager(app.root);
      const out: string[] = [];
      for (const item of mgr.allWords()) {
        if (Array.isArray(item.examples)) {
          for (const ex of item.examples) {
            if (typeof ex === "string" && ex.trim()) out.push(ex.trim());
          }
        }
      }
      return out.slice(0, 500).length > 0
        ? out.slice(0, 500)
        : [
            "The algorithm processes the data efficiently.",
            "She implemented the feature in less than an hour.",
            "We need to refactor this function before merging.",
            "The deadline was postponed until next Friday.",
            "He submitted a pull request with comprehensive tests.",
          ];
    },

    english_speak(text: string): { ok: boolean } {
      if (process.platform !== "win32") return { ok: false };
      const safe = String(text || "")
        .replace(/[\r\n\x00-\x1f]+/g, " ")
        .slice(0, 2000)
        .replace(/'/g, "''");
      const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoiceByHints('en'); $s.Speak('${safe}')`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
          stdio: "ignore",
          detached: true,
        }).unref();
      } catch {
        return { ok: false };
      }
      return { ok: true };
    },

    duplicate(rel: string): { path: string } {
      const src = app.resolve(rel);
      if (!fs.statSync(src).isFile()) {
        throw new ApiError("Solo se pueden copiar archivos.");
      }
      const dir = path.dirname(src);
      const ext = path.extname(src);
      const base = path.basename(src, ext);
      let target = path.join(dir, `${base} (copia)${ext}`);
      let n = 2;
      while (fs.existsSync(target)) {
        target = path.join(dir, `${base} (copia ${n})${ext}`);
        n += 1;
      }
      fs.copyFileSync(src, target);
      return { path: app.rel(target) };
    },

    open_in_default_app(rel: string): { ok: boolean } {
      const p = app.resolve(rel, { allowRoot: true });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as {
          shell?: { openPath(p: string): Promise<string> };
        };
        if (electron?.shell) void electron.shell.openPath(p);
      } catch {
        // Ignore outside electron runtime
      }
      return { ok: true };
    },

    /** Past revisions of a file, straight from the vault's git repository. */
    version_history(rel: string): { hash: string; date: string; author: string; subject: string }[] {
      const p = app.resolve(rel, { allowRoot: true });
      if (!isInside(app.root, p)) {
        throw new ApiError("El archivo está fuera del vault.");
      }
      const out = git(app.root, [
        "log",
        "--follow",
        "--no-color",
        "--date=iso-strict",
        "--pretty=format:%H%x1f%ad%x1f%an%x1f%s",
        "--",
        p,
      ]);
      if (!out) return [];
      return out
        .split(SPLIT_LINE)
        .filter((line) => line.trim())
        .map((line) => {
          const [hash = "", date = "", author = "", subject = ""] = line.split(SPLIT_FIELD);
          return { hash, date, author, subject };
        });
    },

    /** The content of a file as it was in a given revision. */
    version_file(rel: string, hash: string): { content: string } {
      const p = app.resolve(rel, { allowRoot: true });
      if (!isInside(app.root, p)) {
        throw new ApiError("El archivo está fuera del vault.");
      }
      const clean = String(hash || "").trim();
      if (!/^[0-9a-f]{7,40}$/i.test(clean)) {
        throw new ApiError("Revisión inválida.");
      }
      const repoPath = path.relative(app.root, p).split(path.sep).join("/");
      const content = git(app.root, ["show", `${clean}:${repoPath}`], true);
      if (content === null) {
        throw new ApiError("Esa revisión no contiene el archivo.");
      }
      return { content };
    },

    reveal_in_os(rel: string): { ok: boolean } {
      const p = app.resolve(rel, { allowRoot: true });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as {
          shell?: {
            openPath(p: string): Promise<string>;
            showItemInFolder(p: string): void;
          };
        };
        if (electron?.shell) {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            void electron.shell.openPath(p);
          } else {
            electron.shell.showItemInFolder(p);
          }
        }
      } catch {
        // Ignore outside electron runtime
      }
      return { ok: true };
    },

    knowledge_graph(): ReturnType<KnowledgeGraph["buildGraph"]> {
      return new KnowledgeGraph(app.root).buildGraph();
    },

    read_attachment(note_rel: string, name: string): { data_url: string } {
      const note = app.resolve(note_rel);
      const cleanName = (name || "").trim();
      if (
        !cleanName ||
        cleanName.startsWith("/") ||
        cleanName.startsWith("\\") ||
        (cleanName.length > 2 && cleanName[1] === ":")
      ) {
        throw new ApiError("Adjunto inválido.");
      }
      const found = resolveAttachment(note, cleanName, app.root);
      if (!found) {
        throw new ApiError(`No se encontró el adjunto: ${cleanName}`);
      }
      const abs = path.resolve(found);
      if (!isInside(app.root, abs)) {
        throw new ApiError("El adjunto está fuera del vault.");
      }
      const ext = path.extname(abs).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        throw new ApiError("Solo se muestran imágenes.");
      }
      const stat = fs.statSync(abs);
      if (stat.size > MAX_ATTACHMENT_BYTES) {
        throw new ApiError("La imagen es demasiado grande (15 MB).");
      }
      const mimes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
      };
      const mime = mimes[ext] || "application/octet-stream";
      const data = fs.readFileSync(abs).toString("base64");
      return { data_url: `data:${mime};base64,${data}` };
    },
  };
}
