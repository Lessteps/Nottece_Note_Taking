/**
 * NoteVault Vault Manager
 * Ported from notevault_app/core/vault_manager.py.
 *
 * Reads and writes real .md files from a vault directory on disk.
 * Handles file tree, frontmatter, and note CRUD.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ATTACHMENTS_DIR, fsPath } from "./attachments";
import { formatDate } from "./dates";
import { insideVault, relPosix } from "./paths";
import { DATA_DIR, LEGACY_DIRS, RESERVED_DIRS as FMT_RESERVED_DIRS } from "./vaultFormat";

export const RESERVED_DIRS = new Set<string>(FMT_RESERVED_DIRS);

export const IGNORED_DIRS = new Set<string>([
  "node_modules", "__pycache__", "site-packages", "venv", ".venv", "env",
  "dist", "build", "target", "out", "bin", "obj", ".git", ".idea",
  ".vscode", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".next",
  ".gradle", ".cache", "vendor", "Lib", "Scripts",
]);

/**
 * Tope de seguridad del escaneo, NO un límite de diseño: una vault de estudio real pasa de 9 000 notas (3 por tema más sus ejercicios). Con 4 000 el
 * escaneo se cortaba en silencio y los temas que caían después dejaban de existir para la app (no entraban al plan, no salían en «Añadir más temas»).
 * Si algún día se alcanza, `scanTruncated` lo dice en voz alta en vez de callar.
 */
export const MAX_SCAN_NOTES = 60_000;
export const EXCLUDE_FILE = "explorer-ignore.txt";

export function isIgnoredDir(dirPath: string): boolean {
  const name = path.basename(dirPath);
  return IGNORED_DIRS.has(name) || name.startsWith(".") || name === ATTACHMENTS_DIR;
}

export function loadExcludedTopDirs(root: string): Set<string> {
  const p = path.join(root, DATA_DIR, EXCLUDE_FILE);
  if (!fs.existsSync(p)) return new Set();
  try {
    const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
    const out = new Set<string>();
    for (const raw of lines) {
      const name = raw.trim();
      if (name && !name.startsWith("#")) {
        out.add(name);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

export function isReserved(filePath: string, root: string): boolean {
  try {
    const rel = relPosix(root, filePath);
    if (!rel) return false;
    const firstPart = rel.split("/")[0]!;
    return RESERVED_DIRS.has(firstPart);
  } catch {
    return false;
  }
}

export function normaliseVaultRoot(p: string): string {
  const resolved = path.resolve(p);
  return path.basename(resolved) === DATA_DIR ? path.dirname(resolved) : resolved;
}

export function migrateVault(root: string): string[] {
  const moved: string[] = [];
  const dataRoot = path.join(root, DATA_DIR);

  // Lifting nested .notevault/.notevault
  const nested = path.join(dataRoot, DATA_DIR);
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    const walkNested = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkNested(full);
        } else if (entry.isFile()) {
          const rel = relPosix(nested, full);
          const dest = path.join(dataRoot, rel);
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.renameSync(full, dest);
            moved.push(relPosix(root, dest));
          }
        }
      }
    };
    walkNested(nested);
    try {
      fs.rmSync(nested, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  for (const name of LEGACY_DIRS) {
    const oldDir = path.join(root, name);
    if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
      continue;
    }
    const newDir = path.join(dataRoot, name);

    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(path.dirname(newDir), { recursive: true });
      fs.renameSync(oldDir, newDir);
      moved.push(name);
      continue;
    }

    const walkOld = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkOld(full);
        } else if (entry.isFile()) {
          const rel = relPosix(oldDir, full);
          const dest = path.join(newDir, rel);
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.renameSync(full, dest);
            moved.push(relPosix(root, full));
          }
        }
      }
    };
    walkOld(oldDir);

    try {
      const remaining = fs.readdirSync(oldDir);
      if (!remaining.length) {
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  }

  return moved;
}

export function splitFrontmatter(raw: string): [Record<string, unknown>, string] {
  if (!raw.startsWith("---")) {
    return [{}, raw];
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return [{}, raw];
  }

  const fmText = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm: Record<string, unknown> = {};

  for (const line of fmText.split(/\r?\n/)) {
    if (line.includes(":")) {
      const idx = line.indexOf(":");
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        fm[k] = v
          .slice(1, -1)
          .split(",")
          .map((x) => x.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        fm[k] = v.replace(/^["']|["']$/g, "");
      }
    }
  }
  return [fm, body];
}

export class Note {
  path: string;
  vaultRoot: string;
  relPath: string;
  private rawContent: string | null = null;
  private fmCache: Record<string, unknown> | null = null;
  private bodyCache: string | null = null;

  constructor(filePath: string, vaultRoot: string) {
    this.path = path.resolve(filePath);
    this.vaultRoot = path.resolve(vaultRoot);
    this.relPath = relPosix(this.vaultRoot, this.path);
  }

  get title(): string {
    return path.parse(this.path).name;
  }

  get raw(): string {
    if (this.rawContent === null) {
      try {
        this.rawContent = fs.readFileSync(fsPath(this.path), "utf-8");
      } catch {
        this.rawContent = "";
      }
    }
    return this.rawContent;
  }

  get frontmatter(): Record<string, unknown> {
    if (this.fmCache === null) {
      const [fm, body] = splitFrontmatter(this.raw);
      this.fmCache = fm;
      this.bodyCache = body;
    }
    return this.fmCache;
  }

  get body(): string {
    if (this.bodyCache === null) {
      const [fm, body] = splitFrontmatter(this.raw);
      this.fmCache = fm;
      this.bodyCache = body;
    }
    return this.bodyCache;
  }

  get tags(): string[] {
    const fmTags = this.frontmatter["tags"];
    let tagsList: string[] = [];
    if (Array.isArray(fmTags)) {
      tagsList = fmTags.map(String);
    } else if (typeof fmTags === "string" && fmTags) {
      tagsList = [fmTags];
    }
    const inline = Array.from(this.body.matchAll(/(?<!\S)#([\w/-]+)/g), (m) => m[1]!);
    return Array.from(new Set([...tagsList, ...inline]));
  }

  get wikilinks(): string[] {
    return Array.from(this.raw.matchAll(/\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]/g), (m) => m[1]!);
  }

  get modifiedTime(): string {
    try {
      const stat = fs.statSync(fsPath(this.path));
      return formatDate(stat.mtime, "%Y-%m-%d %H:%M");
    } catch {
      return formatDate(new Date(), "%Y-%m-%d %H:%M");
    }
  }

  get createdTime(): string {
    try {
      const stat = fs.statSync(fsPath(this.path));
      return formatDate(stat.birthtime || stat.ctime, "%Y-%m-%d %H:%M");
    } catch {
      return formatDate(new Date(), "%Y-%m-%d %H:%M");
    }
  }

  get wordCount(): number {
    const text = this.body.trim();
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  reload(): void {
    this.rawContent = null;
    this.fmCache = null;
    this.bodyCache = null;
  }

  save(content: string): void {
    fs.writeFileSync(fsPath(this.path), content, "utf-8");
    this.reload();
  }
}

export interface ExplorerTreeNode {
  type: "folder" | "note";
  name: string;
  path: string;
  children?: ExplorerTreeNode[];
}

export class VaultManager {
  vaultRoot: string;
  private excludedTop: Set<string> = new Set();
  private excludedStamp: number | null = null;

  constructor(vaultRoot: string) {
    this.vaultRoot = normaliseVaultRoot(vaultRoot);
    fs.mkdirSync(this.vaultRoot, { recursive: true });
    migrateVault(this.vaultRoot);
    this.refreshExcluded();
  }

  private refreshExcluded(): void {
    const p = path.join(this.vaultRoot, DATA_DIR, EXCLUDE_FILE);
    let stamp: number | null = null;
    try {
      stamp = fs.statSync(p).mtimeMs;
    } catch {
      stamp = null;
    }
    if (stamp !== this.excludedStamp) {
      this.excludedStamp = stamp;
      this.excludedTop = loadExcludedTopDirs(this.vaultRoot);
    }
  }

  private isExcludedTop(entryPath: string): boolean {
    return (
      path.dirname(entryPath) === this.vaultRoot &&
      this.excludedTop.has(path.basename(entryPath))
    );
  }

  /** ¿El último escaneo se cortó por el tope? Nunca debería ser true: si lo es, faltan notas y hay que subir el tope. */
  scanTruncated = false;

  *walkNotePaths(limit: number = MAX_SCAN_NOTES): IterableIterator<string> {
    this.refreshExcluded();
    this.scanTruncated = false;
    let count = 0;
    const stack = [this.vaultRoot];

    while (stack.length) {
      const folder = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        try {
          if (entry.isDirectory()) {
            if (isIgnoredDir(full) || this.isExcludedTop(full)) {
              continue;
            }
            if (folder === this.vaultRoot && isReserved(full, this.vaultRoot)) {
              continue;
            }
            stack.push(full);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            if (isReserved(full, this.vaultRoot)) {
              continue;
            }
            yield full;
            count++;
            if (count >= limit) {
              this.scanTruncated = true;
              console.warn(`[vault] el escaneo se cortó en ${limit} notas: faltan notas en la app. Sube MAX_SCAN_NOTES.`);
              return;
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  notePaths(limit: number = MAX_SCAN_NOTES): string[] {
    return Array.from(this.walkNotePaths(limit)).sort();
  }

  /** Non-blocking variant of `notePaths` using parallel `fs.promises.readdir` batches so large vaults finish in <1s without freezing Windows. */
  async notePathsAsync(limit: number = MAX_SCAN_NOTES): Promise<string[]> {
    this.refreshExcluded();
    this.scanTruncated = false;
    const out: string[] = [];
    const queue = [this.vaultRoot];

    while (queue.length) {
      const batch = queue.splice(0, 32);
      const results = await Promise.all(
        batch.map(async (folder) => {
          try {
            const entries = await fs.promises.readdir(folder, { withFileTypes: true });
            return { folder, entries };
          } catch {
            return null;
          }
        }),
      );

      for (const res of results) {
        if (!res) continue;
        const { folder, entries } = res;
        for (const entry of entries) {
          const full = path.join(folder, entry.name);
          try {
            if (entry.isDirectory()) {
              if (isIgnoredDir(full) || this.isExcludedTop(full)) continue;
              if (folder === this.vaultRoot && isReserved(full, this.vaultRoot)) continue;
              queue.push(full);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
              if (isReserved(full, this.vaultRoot)) continue;
              out.push(full);
              if (out.length >= limit) {
                this.scanTruncated = true;
                console.warn(`[vault] el escaneo se cortó en ${limit} notas: faltan notas en la app. Sube MAX_SCAN_NOTES.`);
                return out.sort();
              }
            }
          } catch {
            continue;
          }
        }
      }
    }
    return out.sort();
  }

  canvasPaths(limit: number = MAX_SCAN_NOTES): string[] {
    this.refreshExcluded();
    const out: string[] = [];
    const stack = [this.vaultRoot];

    while (stack.length) {
      const folder = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        try {
          if (entry.isDirectory()) {
            if (isIgnoredDir(full) || this.isExcludedTop(full)) continue;
            if (folder === this.vaultRoot && isReserved(full, this.vaultRoot)) continue;
            stack.push(full);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".canvas")) {
            if (isReserved(full, this.vaultRoot)) continue;
            out.push(full);
            if (out.length >= limit) return out.sort();
          }
        } catch {
          continue;
        }
      }
    }
    return out.sort();
  }

  allNotes(limit: number = MAX_SCAN_NOTES): Note[] {
    return this.notePaths(limit).map((p) => new Note(p, this.vaultRoot));
  }

  allFolders(): string[] {
    this.refreshExcluded();
    const out: string[] = [];
    const stack = [this.vaultRoot];

    while (stack.length) {
      const folder = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(folder, entry.name);
        if (isIgnoredDir(full) || this.isExcludedTop(full)) continue;
        if (folder === this.vaultRoot && isReserved(full, this.vaultRoot)) continue;
        out.push(full);
        stack.push(full);
      }
    }
    return out.sort();
  }

  tree(): ExplorerTreeNode[] {
    this.refreshExcluded();
    return buildTree(this.vaultRoot, this.vaultRoot, this.excludedTop);
  }

  getNote(filePath: string): Note | null {
    const p = path.resolve(filePath);
    if (fs.existsSync(p) && p.toLowerCase().endsWith(".md")) {
      return new Note(p, this.vaultRoot);
    }
    return null;
  }

  createNote(title: string, folder?: string | null): Note {
    const parent = folder ? path.resolve(folder) : this.vaultRoot;
    fs.mkdirSync(parent, { recursive: true });
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "_");
    let candidate = path.join(parent, `${safeTitle}.md`);
    let counter = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(parent, `${safeTitle} ${counter}.md`);
      counter++;
    }
    const now = formatDate(new Date(), "%Y-%m-%d");
    const content = `---\ntitle: ${title}\ndate: ${now}\ntags: []\n---\n\n# ${title}\n\n`;
    fs.writeFileSync(candidate, content, "utf-8");
    return new Note(candidate, this.vaultRoot);
  }

  createFolder(name: string, parent?: string | null): string {
    const base = parent ? path.resolve(parent) : this.vaultRoot;
    const folder = path.join(base, name);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }

  renameNote(note: Note, newTitle: string): Note {
    const safe = newTitle.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "_");
    const newPath = path.join(path.dirname(note.path), `${safe}.md`);
    fs.renameSync(note.path, newPath);
    return new Note(newPath, this.vaultRoot);
  }

  deleteNote(note: Note): void {
    const trash = path.join(this.vaultRoot, ".trash");
    fs.mkdirSync(trash, { recursive: true });
    const dest = path.join(trash, path.basename(note.path));
    fs.renameSync(note.path, dest);
  }

  movePath(srcPath: string, destFolder: string): string {
    const src = path.resolve(srcPath);
    const dest = path.resolve(destFolder);

    if (!fs.existsSync(src)) {
      throw new Error(`Source not found: ${src}`);
    }
    if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) {
      throw new Error(`Destination is not a directory: ${dest}`);
    }
    if (!insideVault(this.vaultRoot, dest)) {
      throw new Error("Destination is outside the vault");
    }

    const relParts = relPosix(this.vaultRoot, dest).split("/");
    if (relParts.length && RESERVED_DIRS.has(relParts[0]!)) {
      throw new Error("Cannot move into a reserved folder");
    }

    // Prevent moving a folder into its own subtree
    if (fs.statSync(src).isDirectory()) {
      if (insideVault(src, dest)) {
        return src; // No-op
      }
    }

    let target = path.join(dest, path.basename(src));
    if (target === src) {
      return src; // Already in place
    }

    if (fs.existsSync(target)) {
      const parsed = path.parse(src);
      let counter = 2;
      while (fs.existsSync(target)) {
        target = path.join(dest, `${parsed.name} ${counter}${parsed.ext}`);
        counter++;
      }
    }

    fs.renameSync(src, target);
    return target;
  }

  stats(): { notes: number; folders: number; words: number } {
    let notes = 0;
    for (const _ of this.walkNotePaths()) {
      notes++;
    }
    return { notes, folders: 0, words: 0 };
  }
}

function buildTree(folder: string, root: string, excludedTop: Set<string>): ExplorerTreeNode[] {
  const items: ExplorerTreeNode[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return items;
  }

  entries.sort((a, b) => {
    if (a.isFile() !== b.isFile()) return a.isFile() ? 1 : -1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (folder === root && RESERVED_DIRS.has(entry.name)) continue;
      if (folder === root && excludedTop.has(entry.name)) continue;
      items.push({
        type: "folder",
        name: entry.name,
        path: full,
        children: buildTree(full, root, excludedTop),
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      items.push({
        type: "note",
        name: path.parse(entry.name).name,
        path: full,
      });
    }
  }

  return items;
}
