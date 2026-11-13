/**
 * One in-memory copy of every note's text.
 * Ported from notevault_app/core/vault_index.py.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fsPath } from "./attachments";
import { toPosix } from "./paths";

export const WALK_INTERVAL_MS = 300_000; // 5 minutos (reactivo ante cambios; evita polling I/O cada 30 s)

export class IndexedNote {
  path: string;
  title: string;
  text: string;
  private _lower: string | null = null;

  constructor(filePath: string, title: string, text: string, lower?: string) {
    this.path = toPosix(path.resolve(filePath));
    this.title = title;
    this.text = text;
    if (lower !== undefined) {
      this._lower = lower;
    }
  }

  get lower(): string {
    if (this._lower === null) {
      this._lower = this.text.toLowerCase();
    }
    return this._lower;
  }
}

export interface VaultIndexTarget {
  vaultRoot: string;
  notePaths(limit?: number): string[];
}

export class VaultIndex {
  private static shared = new Map<string, VaultIndex>();

  static forVault(vault: VaultIndexTarget): VaultIndex {
    const root = toPosix(path.resolve(vault.vaultRoot));
    let index = VaultIndex.shared.get(root);
    if (!index) {
      index = new VaultIndex(vault);
      VaultIndex.shared.set(root, index);
    }
    index.vault = vault;
    return index;
  }

  vault: VaultIndexTarget;
  private entries = new Map<string, [[number, number], IndexedNote]>();
  private walked = 0;
  private isReady = false;

  constructor(vault: VaultIndexTarget) {
    this.vault = vault;
  }

  get ready(): boolean {
    return this.isReady;
  }

  notes(force: boolean = false): IndexedNote[] {
    const now = performance.now();
    const fresh = this.isReady && !force && now - this.walked < WALK_INTERVAL_MS;
    if (fresh) {
      return Array.from(this.entries.values()).map(([, note]) => note);
    }

    const known = new Map(this.entries);
    const nextEntries = new Map<string, [[number, number], IndexedNote]>();

    for (const p of this.vault.notePaths()) {
      const resolved = fsPath(p);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolved);
      } catch {
        continue;
      }

      const stamp: [number, number] = [stat.mtimeMs, stat.size];
      const normPath = toPosix(path.resolve(p));
      const cached = known.get(normPath);
      if (cached && cached[0][0] === stamp[0] && cached[0][1] === stamp[1]) {
        nextEntries.set(normPath, cached);
        continue;
      }

      try {
        const text = fs.readFileSync(resolved, "utf-8");
        const title = path.parse(p).name;
        nextEntries.set(normPath, [stamp, new IndexedNote(normPath, title, text)]);
      } catch {
        continue;
      }
    }

    this.entries = nextEntries;
    this.walked = now;
    this.isReady = true;
    return Array.from(nextEntries.values()).map(([, note]) => note);
  }

  cachedNotes(): IndexedNote[] {
    return Array.from(this.entries.values()).map(([, note]) => note);
  }

  update(filePath: string, text: string): void {
    const norm = toPosix(path.resolve(filePath));
    try {
      const stat = fs.statSync(fsPath(filePath));
      const stamp: [number, number] = [stat.mtimeMs, stat.size];
      const title = path.parse(filePath).name;
      this.entries.set(norm, [stamp, new IndexedNote(norm, title, text)]);
    } catch {
      // Ignore stat error
    }
  }

  forget(filePath: string): void {
    const norm = toPosix(path.resolve(filePath));
    this.entries.delete(norm);
    this.walked = 0;
  }

  invalidate(): void {
    this.walked = 0;
    this.isReady = false;
  }

  clear(): void {
    this.entries.clear();
    this.walked = 0;
    this.isReady = false;
  }
}
