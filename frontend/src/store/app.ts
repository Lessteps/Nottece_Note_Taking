// App state. One store, plain actions; components read slices of it.

import { create } from "zustand";
import { api } from "../lib/bridge";
import type { AppInfo, Frontmatter, NoteData, RenderingSettings } from "../lib/types";

export type ModuleId =
  | "home" | "calendario" | "habits" | "ejercicio" | "alimentacion" | "proyectos"
  | "metas" | "finanzas" | "notas" | "tareas" | "web" | "player" | "mentor";

export type ViewMode = "read" | "edit" | "split";
export type ExplorerTab = "files" | "search" | "bookmarks" | "tags" | "graph";

// ── Unified tab model ───────────────────────────────────────────────────────

export type AppTab =
  | { kind: "module"; id: ModuleId; tabId: string }
  | { kind: "note"; path: string; tabId: string }
  | { kind: "canvas"; path: string; tabId: string }
  | { kind: "web"; tabId: string };

/** A tab as callers open it: `openTab` derives the id from the target. */
export type TabSpec =
  | { kind: "module"; id: ModuleId }
  | { kind: "note"; path: string }
  | { kind: "canvas"; path: string }
  | { kind: "web" };


/** Stable id for a module tab (one per module). */
function moduleTabId(id: ModuleId): string { return `module:${id}`; }

const PINNED_KEY = "nv.pinnedTabs";

/** Pinned tabs are remembered **per vault**: the same tab id (`note:1.1 …`)
 *  points at a different file in another vault, so a single global list would
 *  pin unrelated tabs when the vault changes. */
export function pinnedStorageKey(vault: string | null | undefined): string {
  return vault ? `${PINNED_KEY}:${vault}` : PINNED_KEY;
}

/** Pinned tab ids remembered for `vault` (empty set when nothing was pinned). */
export function loadPinnedIds(vault: string | null | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(pinnedStorageKey(vault));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function savePinned(vault: string | null | undefined, ids: Set<string>) {
  try { localStorage.setItem(pinnedStorageKey(vault), JSON.stringify([...ids])); } catch {}
}

// ── Note / open‑note model ──────────────────────────────────────────────────

export interface OpenNote {
  path: string;
  title: string;
  kind: "note" | "code";
  raw: string;
  frontmatter: Frontmatter;
  /** The YAML text `frontmatter` was parsed from. */
  fmText: string;
  modified: number;
  bookmarked: boolean;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  /** "\r\n" or "\n": the editor writes back the file's own line endings. */
  eol: "\r\n" | "\n";
  /** Line to reveal once the note is shown (search hits, backlinks). */
  revealLine?: number;
}

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

// An empty block (`---` straight followed by `---`) has no newline between the two fences, so it is
// its own first alternative; otherwise the content runs to the first `---` line.
const FRONTMATTER = /^---\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/;

/** The markdown after the YAML block (same split as the Python side). */
export function bodyOf(raw: string): string {
  const m = FRONTMATTER.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

function frontmatterText(raw: string): string {
  return FRONTMATTER.exec(raw)?.[1] ?? "";
}

/** Note data from the bridge → the shape the views render. */
export function toOpenNote(d: NoteData, revealLine?: number): OpenNote {
  return fromData(d, revealLine);
}

function fromData(d: NoteData, revealLine?: number): OpenNote {
  return {
    path: d.path,
    title: d.title,
    kind: d.kind,
    raw: d.raw,
    frontmatter: d.frontmatter,
    fmText: frontmatterText(d.raw),
    modified: d.modified,
    bookmarked: d.bookmarked,
    dirty: false,
    saving: false,
    conflict: false,
    eol: d.raw.includes("\r\n") ? "\r\n" : "\n",
    revealLine,
  };
}

interface State {
  info: AppInfo | null;
  theme: "dark" | "light";
  /** Identity of the open vault (`vault_path`): pinned tabs are stored per vault. */
  vault: string;
  /** Legacy: the module currently shown — kept for backward compat but driven by active tab. */
  module: ModuleId;
  mode: ViewMode;
  explorerTab: ExplorerTab;
  explorerOpen: boolean;
  rightPanelOpen: boolean;
  inspectorOpen: boolean;
  /** El esquema muscular ocupando el panel derecho. Solo tiene sentido en Ejercicio. */
  muscleOpen: boolean;

  // ── Unified tab strip ──────────────────────────────────────────────
  openTabs: AppTab[];
  activeTabId: string | null;
  pinnedTabIds: Set<string>;
  /**
   * The one reusable "preview" tab (italic title): what explorer clicks, links and
   * Mentor actions open. The next navigation replaces it; editing it, double-clicking
   * it or opening it explicitly in a new tab makes it permanent. Not persisted.
   */
  previewTabId: string | null;

  // ── Note state (notes open in note/canvas tabs) ────────────────────
  /** Note data keyed by vault-relative path. */
  notes: Record<string, OpenNote>;
  /** Bumped whenever the file tree must be re-read. */
  treeVersion: number;
  /** Bumped when bookmarks change. */
  bookmarkVersion: number;
  switcherOpen: boolean;
  paletteOpen: boolean;
  /** A second note shown to the right of the active one (split view). */
  side: string | null;
  /** The drawing pad while it has no file yet (folder = where the file will go once created). */
  inkDraft: { folder: string } | null;
  setInkDraft: (draft: { folder: string } | null) => void;
  /**
   * El modulo que ocupa el panel derecho. Las notas y los canvas usan `side`
   * (su panel ya sabe pintarlos); el resto de funcionalidades viven aqui.
   */
  sideModule: ModuleId | null;
  cursor: { line: number; col: number } | null;
  toasts: Toast[];

  init: () => Promise<void>;
  // Module-level launcher: focuses or creates a module tab.
  setModule: (m: ModuleId) => void;
  setMode: (m: ViewMode) => void;
  setExplorerTab: (t: ExplorerTab) => void;
  toggleExplorer: () => void;
  toggleRightPanel: () => void;
  toggleInspector: () => void;
  setMuscleOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setSwitcher: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  openSide: (path: string | null) => Promise<void>;
  setSideModule: (module: ModuleId | null) => void;
  /**
   * Soltar una pestaña sobre otra: la de `draggedId` pasa al panel dividido.
   * A la derecha el destino se queda como nota principal; a la izquierda se
   * intercambian, que es lo que espera quien arrastra hacia ese lado.
   */
  splitTab: (draggedId: string, targetId: string | null, side: "left" | "right") => void;
  setCursor: (c: { line: number; col: number } | null) => void;

  // ── Tab actions ────────────────────────────────────────────────────
  /** Notes and canvases opened with `preview` reuse the preview tab; the rest are permanent. */
  openTab: (tab: TabSpec, opts?: { preview?: boolean }) => void;
  closeTab: (tabId: string) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  /** Makes the preview tab a permanent one (double-click, edit). */
  keepTab: (tabId: string) => void;
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;

  // ── Note actions ───────────────────────────────────────────────────
  /** Opens in the preview tab; `pin: true` opens (or keeps) it as a permanent tab ("Abrir en pestaña nueva"). */
  openNote: (path: string, opts?: { line?: number; pin?: boolean }) => Promise<void>;
  /** Close a note tab by note path (legacy alias used by EditorArea). */
  closeNoteTab: (path: string) => Promise<void>;
  setActive: (path: string) => void;
  editRaw: (path: string, raw: string) => void;
  save: (path: string, opts?: { force?: boolean }) => Promise<void>;
  reload: (path: string) => Promise<void>;
  toggleBookmark: (path: string) => Promise<void>;
  pathRenamed: (from: string, to: string) => void;
  pathDeleted: (path: string) => void;
  refreshTree: () => void;
  clearReveal: (path: string) => void;
  /** Carpeta que el explorador de notas debe abrir y resaltar (la pone «Ver en NoteVault»; el árbol la consume). */
  revealFolder: { path: string; n: number } | null;
  showFolder: (path: string) => void;

  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;

  // ── Derived from the tab list (refreshed on every update) ──────────
  /** Active note path (from the active note/canvas tab). */
  active: string | null;
  /** Back-compat: note path → tab list. */
  tabs: string[];
}

/** Views that show files outside the note tabs (the canvas) follow these. */
export const pathEvents = {
  opened: new Set<(path: string) => void>(),
  renamed: new Set<(from: string, to: string) => void>(),
  deleted: new Set<(path: string) => void>(),
};

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Notes this app just wrote. The file watcher reports our own saves too, and
// reloading them re-reads the file and rebuilds the editor for nothing.
const recentWrites = new Map<string, number>();
const WRITE_ECHO_MS = 2500;

/** True when the change the watcher is reporting is probably our own save. */
export function wasJustWritten(path: string): boolean {
  const at = recentWrites.get(path);
  return at !== undefined && Date.now() - at < WRITE_ECHO_MS;
}
const AUTOSAVE_MS = 1200;
let toastSeq = 0;

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
}

export function applyRenderingSettings(r: Partial<RenderingSettings>) {
  if (typeof document === "undefined") return;
  if (r.liteEffects) {
    document.documentElement.dataset.perf = "lite";
  } else {
    delete document.documentElement.dataset.perf;
  }
  if (r.reduceMotion) {
    document.documentElement.dataset.motion = "reduced";
  } else {
    delete document.documentElement.dataset.motion;
  }
}

export const applyRendering = applyRenderingSettings;

// ── Helpers ─────────────────────────────────────────────────────────────────


/** Returns the module id that drives the active view for a given tab. */
function tabModuleId(tab: AppTab): ModuleId {
  if (tab.kind === "module") return tab.id;
  if (tab.kind === "note" || tab.kind === "canvas") return "notas";
  return "web";
}

/** Pick the tab to activate after closing `closedId`. */
function pickNext(tabs: AppTab[], closedId: string, currentId: string | null): string | null {
  if (currentId !== closedId) return currentId;
  const idx = tabs.findIndex((t) => t.tabId === closedId);
  const remaining = tabs.filter((t) => t.tabId !== closedId);
  if (!remaining.length) return null;
  return remaining[Math.min(idx, remaining.length - 1)]!.tabId;
}

/**
 * Pick the tab to activate when `closedId` is gone for good (file deleted).
 *
 * Never the first tab of the strip: the neighbour you were looking at wins —
 * same functionality first, then any note or canvas, then anything left. Deleting
 * a note that had a map open next to it keeps you on the map instead of throwing
 * you back to Vista General.
 */
function pickSurvivor(before: AppTab[], remaining: AppTab[], closedId: string): string | null {
  if (!remaining.length) return null;
  const idx = before.findIndex((t) => t.tabId === closedId);
  const closed = idx >= 0 ? before[idx]! : null;
  const closedModule = closed ? tabModuleId(closed) : null;
  const rank = (tab: AppTab, at: number) => {
    const sameModule = closedModule !== null && tabModuleId(tab) === closedModule ? 0 : 1;
    const isFile = tab.kind === "note" || tab.kind === "canvas" ? 0 : 1;
    return sameModule * 10 + isFile * 5 + (at === -1 ? 0 : 0);
  };
  const positions = remaining.map((tab) => ({ tab, at: before.findIndex((t) => t.tabId === tab.tabId) }));
  const distance = (at: number) => (idx < 0 ? at : Math.abs(at - idx));
  positions.sort((a, b) => {
    const ra = rank(a.tab, a.at);
    const rb = rank(b.tab, b.at);
    if (ra !== rb) return ra - rb;
    const da = distance(a.at);
    const db = distance(b.at);
    if (da !== db) return da - db;
    return a.at - b.at;
  });
  return positions[0]!.tab.tabId;
}

/**
 * Puts `tab` in the strip the way a desktop editor does. A *preview* tab (what a
 * single click in the explorer, a link or a Mentor action opens) takes the place
 * of the previous preview instead of piling up; a permanent one is just added.
 * A tab that is already open is only focused (and made permanent if asked to).
 * The preview is never replaced when it is locked, edited or unsaved: it stays.
 */
function placeTab(
  st: Pick<State, "openTabs" | "previewTabId" | "pinnedTabIds" | "notes" | "side">,
  tab: AppTab,
  preview: boolean,
): Pick<State, "openTabs" | "previewTabId" | "notes" | "side"> {
  const { openTabs, previewTabId } = st;
  if (openTabs.some((t) => t.tabId === tab.tabId)) {
    return {
      openTabs,
      previewTabId: !preview && previewTabId === tab.tabId ? null : previewTabId,
      notes: st.notes,
      side: st.side,
    };
  }
  if (!preview) return { openTabs: [...openTabs, tab], previewTabId, notes: st.notes, side: st.side };
  const old = previewTabId ? openTabs.find((t) => t.tabId === previewTabId) : undefined;
  const replaceable =
    old &&
    !st.pinnedTabIds.has(old.tabId) &&
    (old.kind === "note" || old.kind === "canvas") &&
    !(old.kind === "note" && (st.notes[old.path]?.dirty || st.notes[old.path]?.saving));
  if (!old || !replaceable) {
    return { openTabs: [...openTabs, tab], previewTabId: tab.tabId, notes: st.notes, side: st.side };
  }
  let notes = st.notes;
  if (old.kind === "note") {
    notes = { ...st.notes };
    delete notes[old.path];
  }
  return {
    openTabs: openTabs.map((t) => (t.tabId === old.tabId ? tab : t)),
    previewTabId: tab.tabId,
    notes,
    side: old.kind === "note" && st.side === old.path ? null : st.side,
  };
}

/** A state update: a partial state, or a function of the current state. */
type Patch = Partial<State> | ((state: State) => State | Partial<State>);

/** The note/canvas shown by the active tab (null for module/web tabs). */
function activePathOf(s: Pick<State, "openTabs" | "activeTabId">): string | null {
  if (!s.activeTabId) return null;
  const t = s.openTabs.find((x) => x.tabId === s.activeTabId);
  if (!t || (t.kind !== "note" && t.kind !== "canvas")) return null;
  return t.path;
}

/** Back-compat: every open note/canvas path, in tab order. */
function noteTabPaths(s: Pick<State, "openTabs">): string[] {
  return s.openTabs
    .filter((t) => t.kind === "note" || t.kind === "canvas")
    .map((t) => (t as { path: string }).path);
}

export const useApp = create<State>((setState, get) => {
  // `active`, `tabs` and `module` are derived from the tab list. They are real
  // fields and not getters because zustand copies the state on every update
  // (Object.assign), which turns an accessor into a frozen value — a getter would
  // keep reporting whatever it returned during the first update. So every update
  // re-derives them here, which also keeps `module` (the view App renders) from
  // ever disagreeing with the active tab: a note/canvas tab always shows Notes.
  const set = (patch: Patch): void => {
    setState(patch);
    const st = get();
    const tab = st.openTabs.find((t) => t.tabId === st.activeTabId);
    setState({
      active: activePathOf(st),
      tabs: noteTabPaths(st),
      module: tab ? tabModuleId(tab) : st.module,
    });
  };

  return {
  info: null,
  theme: "dark",
  vault: "",
  module: "home",
  mode: "read",
  explorerTab: "files",
  explorerOpen: true,
  rightPanelOpen: true,
  revealFolder: null,
  inspectorOpen: true,
  muscleOpen: false,
  openTabs: [],
  activeTabId: null,
  pinnedTabIds: new Set<string>(),
  previewTabId: null,
  notes: {},
  treeVersion: 0,
  bookmarkVersion: 0,
  switcherOpen: false,
  paletteOpen: false,
  side: null,
  inkDraft: null,
  sideModule: null,
  cursor: null,
  toasts: [],

  // Derived from openTabs / activeTabId by `set` above.
  active: null,
  tabs: [],

  init: async () => {
    try {
      const info = await api.appInfo();
      applyTheme(info.theme);
      if (info.rendering) {
        applyRenderingSettings(info.rendering);
      } else {
        const r = await api.getRendering().catch(() => null);
        if (r) applyRenderingSettings(r);
      }
      const pinned = loadPinnedIds(info.vault_path || info.vault_name);
      set({ info, theme: info.theme, vault: info.vault_path || info.vault_name, pinnedTabIds: pinned });
      // Open the "home" module tab by default if no tabs
      if (get().openTabs.length === 0) {
        get().setModule("home");
      }
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  // ── Module launcher: focuses or creates a module tab ────────────────
  setModule: (m) => {
    const id = moduleTabId(m);
    const { openTabs } = get();
    const existing = openTabs.find((t) => t.tabId === id);
    if (existing) {
      set({ activeTabId: id, module: m });
      return;
    }
    const tab: AppTab = { kind: "module", id: m, tabId: id };
    set({ openTabs: [...openTabs, tab], activeTabId: id, module: m });
  },

  setMode: (mode) => set({ mode }),
  setExplorerTab: (explorerTab) => set({ explorerTab, explorerOpen: true }),
  showFolder: (path) => {
    get().setModule("notas");
    set((st) => ({ explorerTab: "files", explorerOpen: true, revealFolder: { path, n: (st.revealFolder?.n ?? 0) + 1 } }));
  },
  toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  setMuscleOpen: (muscleOpen) => set({ muscleOpen }),
  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    set({ theme });
    api.setTheme(theme).catch(() => undefined);
  },
  setTheme: (theme) => {
    if (get().theme === theme) return;
    applyTheme(theme);
    set({ theme });
    api.setTheme(theme).catch(() => undefined);
  },
  setSwitcher: (switcherOpen) => set({ switcherOpen, paletteOpen: false }),
  setPalette: (paletteOpen) => set({ paletteOpen, switcherOpen: false }),

  setSideModule: (module) => {
    set({ sideModule: module });
  },

  splitTab: (draggedId, targetId, side) => {
    const st = get();
    const dragged = st.openTabs.find((t) => t.tabId === draggedId);
    const found = targetId ? st.openTabs.find((t) => t.tabId === targetId) : undefined;
    if (!dragged || (found && dragged.tabId === found.tabId)) return;
    const isFile = (t: AppTab | undefined): t is Extract<AppTab, { path: string }> =>
      Boolean(t) && (t!.kind === "note" || t!.kind === "canvas");
    const keepTargetAsMain = side === "left" && isFile(found);
    const targetFile = isFile(found) ? found : null;

    if (isFile(dragged)) {
      // The notes module paints its right pane from `side`.
      set({ sideModule: null });
      if (keepTargetAsMain && targetFile) {
        set({ activeTabId: dragged.tabId, module: tabModuleId(dragged) });
        void get().openSide(targetFile.path);
      } else {
        void get().openSide(dragged.path);
      }
      return;
    }
    if (dragged.kind === "module" && dragged.id !== "notas") {
      // Anything that is not a note needs its own pane: the right column shows
      // the module itself, with the tab as its only header.
      set({ sideModule: dragged.id, side: null });
      if (keepTargetAsMain) {
        set({ activeTabId: dragged.tabId, module: tabModuleId(dragged) });
      }
      return;
    }
    // A web page lives in its own rail; there is nothing to split.
  },

  setInkDraft: (inkDraft) => set(inkDraft ? { inkDraft, side: null, module: "notas" } : { inkDraft }),

  openSide: async (path) => {
    if (!path) {
      set({ side: null, inkDraft: null });
      return;
    }
    const st = get();
    if (!st.notes[path]) {
      try {
        const data = await api.readNote(path);
        const newTab: AppTab = { kind: "note", path, tabId: `note:${path}` };
        set((s2) => ({
          notes: { ...s2.notes, [path]: fromData(data) },
          openTabs: s2.openTabs.some((t) => t.tabId === newTab.tabId)
            ? s2.openTabs
            : [...s2.openTabs, newTab],
        }));
      } catch (e) {
        get().toast("error", (e as Error).message);
        return;
      }
    }
    const active = get().active;
    // A note shown in the split pane is one you are working with: keep its tab.
    set((st) => ({
      side: path, inkDraft: null, module: "notas",
      previewTabId: st.previewTabId === `note:${path}` ? null : st.previewTabId,
    }));
    if (!active || active === path) {
      // Activate a different note tab if possible
      const other = get().openTabs.find((t) => (t.kind === "note" || t.kind === "canvas") && t.tabId !== `note:${path}`);
      if (other) set({ activeTabId: other.tabId });
    }
  },

  setCursor: (cursor) => set({ cursor }),

  // ── Generic tab ops ──────────────────────────────────────────────────
  openTab: (tabSpec, opts) => {
    let newTab: AppTab;
    let id: string;
    const kind = tabSpec.kind;
    if (kind === "module") {
      const spec = tabSpec as { kind: "module"; id: ModuleId };
      id = moduleTabId(spec.id);
      newTab = { kind: "module", id: spec.id, tabId: id };
    } else if (kind === "note") {
      const spec = tabSpec as { kind: "note"; path: string };
      id = `note:${spec.path}`;
      newTab = { kind: "note", path: spec.path, tabId: id };
    } else if (kind === "canvas") {
      const spec = tabSpec as { kind: "canvas"; path: string };
      id = `canvas:${spec.path}`;
      newTab = { kind: "canvas", path: spec.path, tabId: id };
    } else {
      id = "web";
      newTab = { kind: "web", tabId: id };
    }
    const { openTabs } = get();
    const exists = openTabs.find((t) => t.tabId === id);
    const file = newTab.kind === "note" || newTab.kind === "canvas";
    const placed = placeTab(get(), newTab, file && opts?.preview === true);
    set({ ...placed, activeTabId: id, module: tabModuleId(exists ?? newTab) });
  },

  keepTab: (id) => {
    if (get().previewTabId === id) set({ previewTabId: null });
  },

  closeTab: async (tabIdToClose) => {
    const s = get();
    if (s.pinnedTabIds.has(tabIdToClose)) return; // pinned → cannot close
    const tab = s.openTabs.find((t) => t.tabId === tabIdToClose);
    if (!tab) return;
    // Save dirty note before closing
    if (tab.kind === "note" && s.notes[tab.path]?.dirty) {
      await s.save(tab.path);
    }
    const isWeb = tab.kind === "web" || (tab.kind === "module" && tab.id === "web");
    if (isWeb) {
      const remainingWeb = s.openTabs.some(
        (t) => t.tabId !== tabIdToClose && (t.kind === "web" || (t.kind === "module" && t.id === "web")),
      );
      if (!remainingWeb) {
        void api.browserDestroy().catch(() => undefined);
      }
    }
    const nextId = pickNext(s.openTabs, tabIdToClose, s.activeTabId);
    const nextTab = nextId ? get().openTabs.find((t) => t.tabId === nextId) : null;
    set((st) => {
      const newTabs = st.openTabs.filter((t) => t.tabId !== tabIdToClose);
      const newNotes = { ...st.notes };
      if (tab.kind === "note") delete newNotes[tab.path];
      return {
        openTabs: newTabs,
        notes: newNotes,
        activeTabId: nextId,
        previewTabId: st.previewTabId === tabIdToClose ? null : st.previewTabId,
        module: nextTab ? tabModuleId(nextTab) : st.module,
        side: tab.kind === "note" && st.side === tab.path ? null : st.side,
      };
    });
  },

  setActiveTab: (id) => {
    const tab = get().openTabs.find((t) => t.tabId === id);
    if (!tab) return;
    set({ activeTabId: id, module: tabModuleId(tab) });
  },

  pinTab: (id) => {
    const pinned = new Set(get().pinnedTabIds);
    pinned.add(id);
    savePinned(get().vault, pinned);
    set({ pinnedTabIds: pinned, previewTabId: get().previewTabId === id ? null : get().previewTabId });
  },

  unpinTab: (id) => {
    const pinned = new Set(get().pinnedTabIds);
    pinned.delete(id);
    savePinned(get().vault, pinned);
    set({ pinnedTabIds: pinned });
  },

  // ── Note actions ─────────────────────────────────────────────────────
  openNote: async (path, opts) => {
    pathEvents.opened.forEach((f) => f(path));
    const s = get();
    const noteTabId = `note:${path}`;
    const preview = opts?.pin !== true;
    const newTab: AppTab = { kind: "note", path, tabId: noteTabId };
    if (s.notes[path]) {
      set((st) => {
        const placed = placeTab(st, newTab, preview);
        const notes = placed.notes[path] ? placed.notes : st.notes;
        return {
          ...placed,
          activeTabId: noteTabId,
          module: "notas",
          side: placed.side === path ? st.active : placed.side,
          notes: opts?.line !== undefined
            ? { ...notes, [path]: { ...notes[path]!, revealLine: opts.line } }
            : notes,
        };
      });
      return;
    }
    try {
      const data = await api.readNote(path);
      set((st) => {
        // The note may have been opened while the file was being read.
        const placed = placeTab(st, newTab, preview);
        return {
          ...placed,
          module: "notas",
          notes: { ...placed.notes, [path]: st.notes[path] ?? fromData(data, opts?.line) },
          activeTabId: noteTabId,
        };
      });
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  /** Close note tab by path (legacy api used by Ctrl-W and old references). */
  closeNoteTab: async (path) => {
    return get().closeTab(`note:${path}`);
  },

  /** Legacy `setActive`: activates a note by path. */
  setActive: (path) => {
    const noteTabId = `note:${path}`;
    const st = get();
    const tab = st.openTabs.find((t) => t.tabId === noteTabId);
    if (tab) {
      set({ activeTabId: noteTabId, module: "notas", side: st.side === path ? st.active : st.side });
    }
  },

  editRaw: (path, raw) => {
    set((st) => {
      const n = st.notes[path];
      if (!n || n.raw === raw) return st;
      // Editing a note makes its preview tab permanent.
      return {
        notes: { ...st.notes, [path]: { ...n, raw, dirty: true } },
        previewTabId: st.previewTabId === `note:${path}` ? null : st.previewTabId,
      };
    });
    const prev = saveTimers.get(path);
    if (prev) clearTimeout(prev);
    saveTimers.set(path, setTimeout(() => void get().save(path), AUTOSAVE_MS));
  },

  save: async (path, opts) => {
    const t = saveTimers.get(path);
    if (t) {
      clearTimeout(t);
      saveTimers.delete(path);
    }
    const n = get().notes[path];
    if (!n || (!n.dirty && !opts?.force) || n.saving) return;
    const raw = n.raw;
    set((st) => ({ notes: { ...st.notes, [path]: { ...st.notes[path]!, saving: true } } }));
    try {
      const res = await api.writeNote(path, raw, opts?.force ? null : n.modified);
      set((st) => {
        const cur = st.notes[path];
        if (!cur) return st;
        if (res.conflict) {
          return { notes: { ...st.notes, [path]: { ...cur, saving: false, conflict: true } } };
        }
        recentWrites.set(path, Date.now());
        return {
          notes: {
            ...st.notes,
            [path]: {
              ...cur,
              saving: false,
              conflict: false,
              modified: res.modified,
              // Still dirty if the user kept typing while we were saving.
              dirty: cur.raw !== raw,
            },
          },
        };
      });
      // The YAML block changed: re-read it (Python parses it) so the
      // metadata card shows what was just saved.
      const savedFm = frontmatterText(raw);
      if (!res.conflict && savedFm !== n.fmText) {
        const fresh = await api.readNote(path).catch(() => null);
        if (fresh) {
          set((st) => {
            const cur = st.notes[path];
            return cur
              ? { notes: { ...st.notes, [path]: { ...cur, frontmatter: fresh.frontmatter, fmText: savedFm } } }
              : st;
          });
        }
      }
    } catch (e) {
      set((st) => {
        const cur = st.notes[path];
        return cur ? { notes: { ...st.notes, [path]: { ...cur, saving: false } } } : st;
      });
      get().toast("error", `No se pudo guardar: ${(e as Error).message}`);
    }
  },

  reload: async (path) => {
    try {
      const data = await api.readNote(path);
      const cur = get().notes[path];
      if (cur?.dirty) {
        set((st) => ({ notes: { ...st.notes, [path]: { ...st.notes[path]!, conflict: true } } }));
        return;
      }
      set((st) => ({ notes: { ...st.notes, [path]: fromData(data) } }));
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  toggleBookmark: async (path) => {
    try {
      const { bookmarked } = await api.toggleBookmark(path);
      set((st) => {
        const n = st.notes[path];
        return {
          bookmarkVersion: st.bookmarkVersion + 1,
          notes: n ? { ...st.notes, [path]: { ...n, bookmarked } } : st.notes,
        };
      });
    } catch (e) {
      get().toast("error", (e as Error).message);
    }
  },

  /** A file or folder moved: re-key any open tab under it. */
  pathRenamed: (from, to) => {
    pathEvents.renamed.forEach((f) => f(from, to));
    set((st) => {
      const remap = (p: string) =>
        p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p;
      const remapTabId = (tabId: string) => {
        if (tabId.startsWith("note:")) {
          const p = tabId.slice("note:".length);
          const np = remap(p);
          return np === p ? tabId : `note:${np}`;
        }
        if (tabId.startsWith("canvas:")) {
          const p = tabId.slice("canvas:".length);
          const np = remap(p);
          return np === p ? tabId : `canvas:${np}`;
        }
        return tabId;
      };
      const notes: Record<string, OpenNote> = {};
      for (const [p, n] of Object.entries(st.notes)) {
        const np = remap(p);
        notes[np] = np === p ? n : { ...n, path: np, title: np.split("/").pop()!.replace(/\.md$/, "") };
      }
      const openTabs = st.openTabs.map((t) => {
        if (t.kind === "note") {
          const np = remap(t.path);
          return np === t.path ? t : { ...t, path: np, tabId: `note:${np}` };
        }
        if (t.kind === "canvas") {
          const np = remap(t.path);
          return np === t.path ? t : { ...t, path: np, tabId: `canvas:${np}` };
        }
        return t;
      });
      // Remap the activeTabId: the renamed note keeps being the active one, and
      // renaming anything else leaves the active tab exactly where it was.
      // (Matching "any tab of the same kind" moved the user to the first note
      // of the strip whenever a different file was renamed.)
      const oldActive = st.openTabs.find((t) => t.tabId === st.activeTabId);
      const remappedActive =
        oldActive && (oldActive.kind === "note" || oldActive.kind === "canvas")
          ? remap(oldActive.path)
          : null;
      const activeTabId = remappedActive
        ? (openTabs.find(
            (t) =>
              (t.kind === "note" || t.kind === "canvas") &&
              (t as { path: string }).path === remappedActive,
          )?.tabId ?? st.activeTabId)
        : st.activeTabId;
      const pinnedTabIds = new Set([...st.pinnedTabIds].map(remapTabId));
      return {
        notes,
        openTabs,
        activeTabId,
        pinnedTabIds,
        previewTabId: st.previewTabId ? remapTabId(st.previewTabId) : null,
        side: st.side ? remap(st.side) : null,
        treeVersion: st.treeVersion + 1,
      };
    });
    savePinned(get().vault, get().pinnedTabIds);
  },

  pathDeleted: (path) => {
    pathEvents.deleted.forEach((f) => f(path));
    set((st) => {
      const gone = (p: string) => p === path || p.startsWith(path + "/");
      const pinnedGone = (tabId: string) => {
        if (tabId.startsWith("note:")) return gone(tabId.slice("note:".length));
        if (tabId.startsWith("canvas:")) return gone(tabId.slice("canvas:".length));
        return false;
      };
      const openTabs = st.openTabs.filter((t) => {
        if (t.kind === "note" || t.kind === "canvas") return !gone(t.path);
        return true;
      });
      const notes = Object.fromEntries(Object.entries(st.notes).filter(([p]) => !gone(p)));
      const activeTabId = st.activeTabId
        ? openTabs.find((t) => t.tabId === st.activeTabId)
          ? st.activeTabId
          : pickSurvivor(st.openTabs, openTabs, st.activeTabId)
        : null;
      const activeTab = activeTabId ? openTabs.find((t) => t.tabId === activeTabId) : null;
      const pinnedTabIds = new Set([...st.pinnedTabIds].filter((id) => !pinnedGone(id)));
      return {
        openTabs,
        notes,
        activeTabId,
        pinnedTabIds,
        previewTabId: st.previewTabId && openTabs.some((t) => t.tabId === st.previewTabId) ? st.previewTabId : null,
        module: activeTab ? tabModuleId(activeTab) : st.module,
        side: st.side && gone(st.side) ? null : st.side,
        treeVersion: st.treeVersion + 1,
      };
    });
    savePinned(get().vault, get().pinnedTabIds);
  },

  refreshTree: () => set((st) => ({ treeVersion: st.treeVersion + 1 })),

  clearReveal: (path) =>
    set((st) => {
      const n = st.notes[path];
      return n && n.revealLine !== undefined
        ? { notes: { ...st.notes, [path]: { ...n, revealLine: undefined } } }
        : st;
    }),

  toast: (kind, text) => {
    const id = ++toastSeq;
    set((st) => ({ toasts: [...st.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 3500);
  },
  dismiss: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
  };
});

// Tell Python how many notes (and other pending edits) are unsaved, so
// closing the window can wait for them (run_web.py). Only sent when the
// number changes.
let reportedUnsaved = 0;
const pendingEdits = new Map<string, () => Promise<void>>();

function reportUnsaved() {
  const st = useApp.getState();
  const n = Object.values(st.notes).filter((x) => x.dirty || x.saving).length + pendingEdits.size;
  if (n !== reportedUnsaved) {
    reportedUnsaved = n;
    api.setUnsaved(n).catch(() => undefined);
  }
}
useApp.subscribe(reportUnsaved);

/** A module with a debounced write registers it here until it is flushed. */
export function markPending(key: string, flush: () => Promise<void>) {
  pendingEdits.set(key, flush);
  reportUnsaved();
}

export function clearPending(key: string) {
  if (pendingEdits.delete(key)) reportUnsaved();
}

/** Save everything before the window closes. */
export async function flushAll(): Promise<void> {
  const { notes, save } = useApp.getState();
  const others = [...pendingEdits.values()];
  await Promise.all([
    ...Object.values(notes).filter((n) => n.dirty).map((n) => save(n.path)),
    ...others.map((f) => f().catch(() => undefined)),
  ]);
}
