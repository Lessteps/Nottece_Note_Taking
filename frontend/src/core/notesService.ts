/**
 * NoteVault Notes Service
 * Ported from notevault_app/core/notes_service.py.
 *
 * Everything the notes explorer needs beyond plain file CRUD: bookmarks,
 * full-text search, numeric ordering, and linked / unlinked mentions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ATTACHMENTS_DIR } from "./attachments";
import { kindFor } from "./fileKinds";
import { relPosix, toPosix } from "./paths";
import { TagIndex } from "./tagIndex";
import { IndexedNote, VaultIndex } from "./vaultIndex";
import { isIgnoredDir, isReserved, Note, VaultManager } from "./vaultManager";

export const BOOKMARKS_FILE = ".notevault-bookmarks.json";

const DIGITS = /(\d+)/;
const WIKILINK_SCAN_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const ALIAS_KEYS = ["aliases", "alias"];

export function norm(s: string): string {
  return (s ?? "").replace(/_/g, " ");
}

export function variants(s: string): Set<string> {
  const str = s ?? "";
  return new Set([str, str.replace(/_/g, " "), str.replace(/ /g, "_")]);
}

export function frontmatterNames(text: string): string[] {
  if (!text || !text.startsWith("---")) return [];
  const end = text.indexOf("\n---", 3);
  if (end === -1) return [];

  const fmText = text.slice(3, end);
  const names: string[] = [];
  const lines = fmText.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i]!.trim();
    i++;
    if (!rawLine || rawLine.startsWith("#") || !rawLine.includes(":")) continue;

    const idx = rawLine.indexOf(":");
    const key = rawLine.slice(0, idx).trim().toLowerCase();
    const val = rawLine.slice(idx + 1).trim();

    if (key === "title") {
      const v = val.replace(/^["']|["']$/g, "").trim();
      if (v) names.push(v);
    } else if (ALIAS_KEYS.includes(key)) {
      if (val.startsWith("[") && val.endsWith("]")) {
        const items = val
          .slice(1, -1)
          .split(",")
          .map((x) => x.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        names.push(...items);
      } else if (val) {
        names.push(val.replace(/^["']|["']$/g, "").trim());
      } else {
        // Block list
        while (i < lines.length) {
          const item = lines[i]!.trim();
          if (item.startsWith("-")) {
            names.push(item.slice(1).trim().replace(/^["']|["']$/g, ""));
            i++;
          } else if (!item || item.startsWith(" ")) {
            i++;
          } else {
            break;
          }
        }
      }
    }
  }

  return names.filter((n) => n.trim().length > 0).map((n) => n.toLowerCase());
}

export function linkIdentifiers(
  note: { path: string; raw?: string; text?: string },
  vaultRoot: string,
  rawText?: string,
): [Set<string>, Set<string>] {
  const ids = new Set<string>();
  const needles = new Set<string>();

  const stem = path.parse(note.path).name.toLowerCase();
  const name = path.basename(note.path).toLowerCase();

  ids.add(stem);
  ids.add(name);
  ids.add(norm(stem));
  ids.add(norm(name));
  ids.add(stem.replace(/ /g, "_"));
  ids.add(name.replace(/ /g, "_"));

  needles.add(stem);
  needles.add(norm(stem));
  needles.add(stem.replace(/ /g, "_"));

  try {
    const rel = relPosix(vaultRoot, note.path).toLowerCase();
    const relNs = rel.replace(/\.[^/.]+$/, "");
    ids.add(rel);
    ids.add(relNs);
    ids.add(norm(rel));
    ids.add(norm(relNs));
    ids.add(rel.replace(/ /g, "_"));
    ids.add(relNs.replace(/ /g, "_"));
  } catch {
    // Ignore
  }

  const text = rawText ?? note.raw ?? note.text ?? "";
  for (const nm of frontmatterNames(text)) {
    ids.add(nm);
    ids.add(norm(nm));
    ids.add(nm.replace(/ /g, "_"));
    needles.add(nm);
    needles.add(norm(nm));
    needles.add(nm.replace(/ /g, "_"));
  }

  ids.delete("");
  needles.delete("");
  return [ids, needles];
}

export function wikilinkMatches(line: string, targetIds: Set<string>): boolean {
  for (const wm of line.matchAll(WIKILINK_SCAN_RE)) {
    const rawTarget = (wm[1] ?? "").trim().toLowerCase();
    if (!rawTarget) continue;
    const name = path.basename(rawTarget).toLowerCase();
    const stem = path.parse(rawTarget).name.toLowerCase();
    for (const cand of [rawTarget, name, stem]) {
      if (targetIds.has(cand) || targetIds.has(norm(cand))) {
        return true;
      }
    }
  }
  return false;
}

/** Natural sort comparator for filenames with digit runs. */
export function compareNumeric(a: string, b: string): number {
  const aChunks = a.split(DIGITS);
  const bChunks = b.split(DIGITS);
  const len = Math.max(aChunks.length, bChunks.length);

  for (let i = 0; i < len; i++) {
    const ac = aChunks[i];
    const bc = bChunks[i];
    if (ac === undefined) return -1;
    if (bc === undefined) return 1;

    const isNumA = i % 2 === 1;
    const isNumB = i % 2 === 1;

    if (isNumA && isNumB) {
      const na = parseInt(ac, 10);
      const nb = parseInt(bc, 10);
      if (na !== nb) return na - nb;
    } else {
      const cmp = ac.toLowerCase().localeCompare(bc.toLowerCase());
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

export interface BookmarkEntry {
  type: string;
  target: string;
  label: string;
}

export interface SearchHit {
  path: string;
  title: string;
  line_no: number;
  line: string;
}

export interface Mention {
  path: string;
  title: string;
  line_no: number;
  line: string;
  linked: boolean;
}

export interface ExplorerItem {
  type: "folder" | "note";
  name: string;
  path: string;
  kind?: string;
  children?: ExplorerItem[] | null;
}

export interface QueryFilters {
  tags: string[];
  path_frags: string[];
  properties: string[];
  phrases: string[];
  terms: string[];
}

export class NotesService {
  vault: VaultManager;
  index: VaultIndex;
  private bookmarksCache: [BookmarkEntry[], number | null] = [[], null];

  constructor(vault: VaultManager) {
    this.vault = vault;
    this.index = VaultIndex.forVault(vault);
  }

  get root(): string {
    return this.vault.vaultRoot;
  }

  private bookmarksPath(): string {
    return path.join(this.root, BOOKMARKS_FILE);
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────

  private migrateBookmark(entry: unknown): BookmarkEntry {
    if (typeof entry === "string") {
      return { type: "note", target: entry, label: path.parse(entry).name };
    }
    const o = entry as Record<string, unknown>;
    return {
      type: String(o["type"] ?? "note"),
      target: String(o["target"] ?? ""),
      label: String(o["label"] ?? path.parse(String(o["target"] ?? "")).name),
    };
  }

  bookmarksRich(): BookmarkEntry[] {
    const p = this.bookmarksPath();
    let stamp: number | null = null;
    try {
      stamp = fs.statSync(p).mtimeMs;
    } catch {
      this.bookmarksCache = [[], null];
      return [];
    }

    const [cached, cachedStamp] = this.bookmarksCache;
    if (cachedStamp === stamp) {
      return [...cached];
    }

    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      const entries = Array.isArray(raw) ? raw.map((e) => this.migrateBookmark(e)) : [];
      this.bookmarksCache = [entries, stamp];
      return [...entries];
    } catch {
      this.bookmarksCache = [[], stamp];
      return [];
    }
  }

  bookmarks(): string[] {
    const out: string[] = [];
    for (const bm of this.bookmarksRich()) {
      if (bm.type === "note") {
        const full = path.join(this.root, bm.target);
        if (fs.existsSync(full)) {
          out.push(full);
        }
      }
    }
    return out;
  }

  private saveBookmarksRich(entries: BookmarkEntry[]): void {
    fs.writeFileSync(this.bookmarksPath(), JSON.stringify(entries, null, 2), "utf-8");
    this.bookmarksCache = [[], null];
  }

  isBookmarked(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return this.bookmarksRich().some((b) => b.type === "note" && path.resolve(path.join(this.root, b.target)) === resolved);
  }

  toggleBookmark(filePath: string): boolean {
    const p = path.resolve(filePath);
    let rel: string;
    try {
      rel = relPosix(this.root, p);
    } catch {
      return false;
    }

    const entries = this.bookmarksRich();
    for (let i = 0; i < entries.length; i++) {
      const bm = entries[i]!;
      if (bm.type === "note" && bm.target === rel) {
        entries.splice(i, 1);
        this.saveBookmarksRich(entries);
        return false;
      }
    }

    entries.push({ type: "note", target: rel, label: path.parse(p).name });
    this.saveBookmarksRich(entries);
    return true;
  }

  addBookmark(bmType: string, target: string, label: string = ""): void {
    const entries = this.bookmarksRich();
    for (const bm of entries) {
      if (bm.type === bmType && bm.target === target) return;
    }
    entries.push({ type: bmType, target, label: label || target });
    this.saveBookmarksRich(entries);
  }

  removeBookmarkRich(bmType: string, target: string): void {
    const entries = this.bookmarksRich().filter(
      (b) => !(b.type === bmType && b.target === target),
    );
    this.saveBookmarksRich(entries);
  }

  removeBookmark(filePath: string): void {
    try {
      const rel = relPosix(this.root, filePath);
      this.removeBookmarkRich("note", rel);
    } catch {
      // Ignore
    }
  }

  // ── Tree ──────────────────────────────────────────────────────────────

  tree(numericSort: boolean = true): ExplorerItem[] {
    return this.childrenOf(this.root, numericSort);
  }

  childrenOf(folderPath: string, numericSort: boolean = true): ExplorerItem[] {
    const folder = path.resolve(folderPath);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return [];
    }

    const folders: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      try {
        if (entry.isDirectory()) {
          if (isIgnoredDir(full) || entry.name === ATTACHMENTS_DIR) continue;
          if (folder === this.root && isReserved(full, this.root)) continue;
          folders.push(full);
        } else if (!entry.name.startsWith(".") && kindFor(full)) {
          files.push(full);
        }
      } catch {
        continue;
      }
    }

    const sortFn = numericSort
      ? (a: string, b: string) => compareNumeric(path.basename(a), path.basename(b))
      : (a: string, b: string) => path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase());

    folders.sort(sortFn);
    files.sort(sortFn);

    const items: ExplorerItem[] = folders.map((f) => ({
      type: "folder",
      name: path.basename(f),
      path: f,
      children: null,
    }));

    for (const f of files) {
      const kind = kindFor(f);
      items.push({
        type: "note",
        kind,
        name: kind === "code" ? path.basename(f) : path.parse(f).name,
        path: f,
      });
    }

    return items;
  }

  hasChildren(folderPath: string): boolean {
    const folder = path.resolve(folderPath);
    try {
      const entries = fs.readdirSync(folder, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        try {
          if (entry.isDirectory()) {
            if (isIgnoredDir(full) || entry.name === ATTACHMENTS_DIR) continue;
            if (folder === this.root && isReserved(full, this.root)) continue;
            return true;
          }
          if (kindFor(full)) return true;
        } catch {
          continue;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  notesInFolder(folderPath: string, recursive: boolean = false): string[] {
    const folder = path.resolve(folderPath);
    if (!fs.existsSync(folder)) return [];
    const out: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            recursive &&
            !entry.name.startsWith(".") &&
            !["node_modules", "__pycache__"].includes(entry.name) &&
            !isReserved(full, this.root)
          ) {
            walk(full);
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          if (!isReserved(full, this.root)) {
            out.push(full);
          }
        }
      }
    };

    walk(folder);
    return out.sort((a, b) => compareNumeric(path.basename(a), path.basename(b)));
  }

  // ── Search ────────────────────────────────────────────────────────────

  static _parse_query(raw: string): QueryFilters {
    const filters: QueryFilters = {
      tags: [],
      path_frags: [],
      properties: [],
      phrases: [],
      terms: [],
    };

    let rest = raw ?? "";
    for (const m of rest.matchAll(/"([^"]+)"/g)) {
      filters.phrases.push(m[1]!.toLowerCase());
    }
    rest = rest.replace(/"[^"]*"/g, "");

    for (const token of rest.split(/\s+/)) {
      if (!token) continue;
      if (token.includes(":")) {
        const idx = token.indexOf(":");
        const keyL = token.slice(0, idx).toLowerCase();
        const valL = token.slice(idx + 1).toLowerCase();
        if (keyL === "tag") {
          filters.tags.push(valL);
        } else if (keyL === "path") {
          filters.path_frags.push(valL);
        } else if (keyL === "property" || keyL === "prop") {
          filters.properties.push(valL);
        } else {
          filters.properties.push(`${keyL}:${valL}`);
        }
      } else {
        filters.terms.push(token.toLowerCase());
      }
    }

    return filters;
  }

  private noteMatches(note: IndexedNote, filters: QueryFilters, tagIdx?: TagIndex | null): boolean {
    if (filters.tags.length) {
      const idx = tagIdx || TagIndex.forVault(this);
      const noteTagsLower = idx.tagsForPath(note.path).map((t) => t.toLowerCase());
      for (const wanted of filters.tags) {
        if (!noteTagsLower.some((t) => t.includes(wanted))) {
          return false;
        }
      }
    }

    const rel = toPosix(note.path).toLowerCase();
    for (const frag of filters.path_frags) {
      if (!rel.includes(frag)) {
        return false;
      }
    }

    if (filters.properties.length) {
      let fmText = "";
      if (note.text.startsWith("---")) {
        const end = note.text.indexOf("\n---", 3);
        if (end !== -1) {
          fmText = note.text.slice(3, end).toLowerCase();
        }
      }
      for (const prop of filters.properties) {
        if (prop.includes(":")) {
          const idx = prop.indexOf(":");
          const key = prop.slice(0, idx);
          const val = prop.slice(idx + 1);
          if (!fmText.includes(key) || !fmText.includes(val)) {
            return false;
          }
        } else {
          if (!fmText.includes(prop)) {
            return false;
          }
        }
      }
    }

    for (const phrase of filters.phrases) {
      if (!note.lower.includes(phrase) && !note.title.toLowerCase().includes(phrase)) {
        return false;
      }
    }

    for (const term of filters.terms) {
      if (!note.title.toLowerCase().includes(term) && !note.lower.includes(term)) {
        return false;
      }
    }

    return true;
  }

  search(query: string, limit: number = 200): SearchHit[] {
    const raw = (query ?? "").trim();
    if (!raw) return [];

    const filters = NotesService._parse_query(raw);
    const hasOperators =
      filters.tags.length > 0 ||
      filters.path_frags.length > 0 ||
      filters.properties.length > 0 ||
      filters.phrases.length > 0;

    const notes = this.index.ready ? this.index.cachedNotes() : this.index.notes();
    const hits: SearchHit[] = [];

    if (hasOperators || filters.terms.length) {
      let tagIdx: TagIndex | null = null;
      if (filters.tags.length) {
        tagIdx = TagIndex.forVault(this);
        if (notes.length) {
          tagIdx.build(notes);
        }
      }

      for (const note of notes) {
        if (!this.noteMatches(note, filters, tagIdx)) {
          continue;
        }

        let matchedLines = false;
        const lines = note.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const ll = line.toLowerCase();
          const relevant =
            filters.terms.some((t) => ll.includes(t)) ||
            filters.phrases.some((p) => ll.includes(p)) ||
            (!filters.terms.length && !filters.phrases.length);

          if (relevant) {
            hits.push({
              path: note.path,
              title: note.title,
              line_no: i + 1,
              line: line.trim().slice(0, 180),
            });
            matchedLines = true;
            if (hits.length >= limit) return hits;
          }
        }

        if (!matchedLines) {
          hits.push({
            path: note.path,
            title: note.title,
            line_no: 0,
            line: note.title,
          });
          if (hits.length >= limit) return hits;
        }
      }
    } else {
      const q = raw.toLowerCase();
      for (const note of notes) {
        if (note.title.toLowerCase().includes(q)) {
          hits.push({ path: note.path, title: note.title, line_no: 0, line: note.title });
          if (hits.length >= limit) return hits;
        }
        if (!note.lower.includes(q)) continue;

        const lines = note.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.toLowerCase().includes(q)) {
            hits.push({
              path: note.path,
              title: note.title,
              line_no: i + 1,
              line: line.trim().slice(0, 180),
            });
            if (hits.length >= limit) return hits;
          }
        }
      }
    }

    return hits;
  }

  // ── Mentions ──────────────────────────────────────────────────────────

  mentions(note: { path: string; title?: string; raw?: string; text?: string }): [Mention[], Mention[]] {
    const title = (note.title || path.parse(note.path).name).trim();
    if (!title) return [[], []];

    const linked: Mention[] = [];
    const unlinked: Mention[] = [];

    const [targetIds, nameNeedles] = linkIdentifiers(note, this.vault.vaultRoot);
    if (!nameNeedles.size) return [[], []];

    const plainRes: RegExp[] = [];
    for (const n of nameNeedles) {
      if (n.length >= 3) {
        plainRes.push(new RegExp(`(?<![\\w\\[])${escapeRegex(n)}(?![\\w\\]])`, "i"));
      }
    }

    const normTarget = toPosix(path.resolve(note.path));
    for (const other of this.index.notes()) {
      if (toPosix(path.resolve(other.path)) === normTarget) {
        continue;
      }
      if (!Array.from(nameNeedles).some((n) => other.lower.includes(n))) {
        continue;
      }

      const lines = other.text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (wikilinkMatches(line, targetIds)) {
          linked.push({
            path: other.path,
            title: other.title,
            line_no: i + 1,
            line: line.trim().slice(0, 200),
            linked: true,
          });
        } else if (plainRes.some((rx) => rx.test(line))) {
          unlinked.push({
            path: other.path,
            title: other.title,
            line_no: i + 1,
            line: line.trim().slice(0, 200),
            linked: false,
          });
        }
      }
    }

    return [linked, unlinked];
  }

  linkifyMention(notePath: string, lineNo: number, targetTitle: string): boolean {
    const p = path.resolve(notePath);
    let text: string;
    try {
      text = fs.readFileSync(p, "utf-8");
    } catch {
      return false;
    }

    const lines = text.split("\n");
    if (!lines.length) return false;

    const titleClean = targetTitle.trim();
    if (!titleClean) return false;

    const titleEsc = escapeRegex(titleClean);
    let pattern = `(?<![\\w\\[])(${titleEsc})(?![\\w\\]])`;
    if (titleClean.includes("_") || titleClean.includes(" ")) {
      const alt = escapeRegex(
        titleClean.includes("_") ? titleClean.replace(/_/g, " ") : titleClean.replace(/ /g, "_"),
      );
      pattern = `(?<![\\w\\[])(${titleEsc}|${alt})(?![\\w\\]])`;
    }
    const rx = new RegExp(pattern, "i");

    const idx = lineNo - 1;
    const candidateIndices: number[] = [];
    if (idx >= 0 && idx < lines.length) candidateIndices.push(idx);
    for (let offset = 1; offset < 5; offset++) {
      if (idx - offset >= 0 && idx - offset < lines.length) candidateIndices.push(idx - offset);
      if (idx + offset >= 0 && idx + offset < lines.length) candidateIndices.push(idx + offset);
    }

    let replaced = false;
    for (const i of candidateIndices) {
      const line = lines[i]!;
      if (rx.test(line)) {
        lines[i] = line.replace(rx, `[[${titleClean}]]`);
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (rx.test(line)) {
          lines[i] = line.replace(rx, `[[${titleClean}]]`);
          replaced = true;
          break;
        }
      }
    }

    if (replaced) {
      const newText = lines.join("\n");
      try {
        fs.writeFileSync(p, newText, "utf-8");
        this.noteWritten(p, newText);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  // ── Mutations ─────────────────────────────────────────────────────────

  createNote(title: string, folder?: string | null): Note {
    return this.vault.createNote(title, folder);
  }

  createFolder(name: string, parent?: string | null): string {
    return this.vault.createFolder(name, parent);
  }

  renamePath(targetPath: string, newName: string): string {
    const p = path.resolve(targetPath);
    const safe = newName.replace(/[\\/:*?"<>|]/g, "_").trim();
    if (!safe) return p;

    let target: string;
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      target = path.join(path.dirname(p), safe);
    } else if (kindFor(p) === "note") {
      target = path.join(path.dirname(p), safe.endsWith(".md") ? safe : `${safe}.md`);
    } else {
      target = path.join(path.dirname(p), path.extname(safe) ? safe : `${safe}${path.extname(p)}`);
    }

    if (target === p || fs.existsSync(target)) {
      return p;
    }

    fs.renameSync(p, target);
    this.index.forget(p);
    return target;
  }

  deletePath(targetPath: string): void {
    const p = path.resolve(targetPath);
    const trash = path.join(this.root, ".trash");
    fs.mkdirSync(trash, { recursive: true });
    let dest = path.join(trash, path.basename(p));
    let counter = 1;
    const parsed = path.parse(p);
    while (fs.existsSync(dest)) {
      dest = path.join(trash, `${parsed.name}_${counter}${parsed.ext}`);
      counter++;
    }
    fs.renameSync(p, dest);
    this.index.forget(p);
    this.removeBookmark(p);
  }

  movePath(srcPath: string, destFolder: string): string {
    const newPath = this.vault.movePath(srcPath, destFolder);
    this.index.forget(srcPath);
    if (fs.existsSync(newPath) && fs.statSync(newPath).isFile()) {
      try {
        this.index.update(newPath, fs.readFileSync(newPath, "utf-8"));
      } catch {
        // Ignore
      }
    }
    return newPath;
  }

  noteWritten(filePath: string, text: string): void {
    this.index.update(filePath, text);
  }

  setVault(vault: VaultManager): void {
    this.vault = vault;
    this.index = VaultIndex.forVault(vault);
    this.bookmarksCache = [[], null];
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
