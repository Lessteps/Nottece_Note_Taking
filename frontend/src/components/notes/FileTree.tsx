import { ChevronRight, FileCode2, FileText, Folder, FolderOpen, LayoutDashboard } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { api } from "../../lib/bridge";
import type { IndexEntry, TreeEntry } from "../../lib/types";
import { useVirtualList } from "../../lib/useVirtualList";
import { useApp } from "../../store/app";
import { copyText } from "../../lib/clipboard";
import { useAssistant } from "../../store/assistant";
import { generateTopicFrom } from "../study/StudySpaceDialog";
import { RouteBadge, useRouteView } from "../study/RouteUi";
import type { RouteInfo } from "../../store/mentorRoute";
import { fileMenuItems, pathFlavors, treeRootMenuItems, type PathFlavor } from "./fileMenu";
import { MoveEntryDialog } from "./MoveEntryDialog";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { askText, cn, confirmAction, openMenu } from "../ui";

const EXPANDED_KEY = "nv.tree.expanded";
export const DRAG_MIME = "application/x-notevault-path";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export async function newNoteIn(folder: string): Promise<void> {
  const title = await askText("Nueva nota", "", "Crear");
  if (!title) return;
  const s = useApp.getState();
  try {
    const { path } = await api.createNote(title, folder);
    s.refreshTree();
    await s.openNote(path);
    s.setMode("edit");
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

export async function newCanvasIn(folder: string): Promise<void> {
  const title = await askText("Nuevo canvas", "", "Crear");
  if (!title) return;
  const s = useApp.getState();
  try {
    const { path } = await api.canvasCreate(title, folder);
    s.refreshTree();
    s.openTab({ kind: "canvas", path });
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

export async function newFolderIn(parent: string): Promise<void> {
  const name = await askText("Nueva carpeta", "", "Crear");
  if (!name) return;
  const s = useApp.getState();
  try {
    await api.createFolder(name, parent);
    s.refreshTree();
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

export async function renameEntry(entry: TreeEntry) {
  const current = entry.type === "note" && entry.kind === "note" ? entry.name : entry.path.split("/").pop()!;
  const name = await askText("Renombrar", current, "Renombrar");
  if (!name || name === current) return;
  const s = useApp.getState();
  try {
    const { path } = await api.rename(entry.path, name);
    s.pathRenamed(entry.path, path);
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

async function trashEntry(entry: TreeEntry) {
  const ok = await confirmAction(
    "Mover a la papelera",
    `«${entry.name}» se moverá a la carpeta .trash del vault. Puedes recuperarlo desde ahí.`,
    "Mover a la papelera",
    true,
  );
  if (!ok) return;
  const s = useApp.getState();
  try {
    await api.remove(entry.path);
    s.pathDeleted(entry.path);
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

/**
 * Notion-style folder click: the folder's *name* opens its view file (the topic's
 * practice view, or the area's overview — only when it already exists: it is never created by a click) **and**
 * expands the folder so its own files render too; the chevron only expands and
 * collapses. Plain folders have no view, so they keep behaving as a plain toggle.
 */
export async function openFolderView(entry: TreeEntry, toggle: (path: string) => void, isOpen = false) {
  const s = useApp.getState();
  try {
    // Solo lectura: un clic en una carpeta nunca crea archivos. Sin vista, la carpeta solo se despliega.
    const view = await api.studyViewEnsure(entry.path);
    if (view.ok && view.path) {
      if (view.created.length || view.tagged?.length) s.refreshTree();
      // Expanding is not optional: the children have to render too, and a folder
      // that is already open must not be collapsed by the click.
      if (!isOpen) toggle(entry.path);
      await s.openNote(view.path);
      s.setMode("read");
      return;
    }
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
  toggle(entry.path);
}

/** Un clic abre en la pestaña de vista previa; `pin` (Ctrl+clic, rueda, menú) la abre como pestaña permanente. */
function openEntry(entry: TreeEntry, pin = false) {
  const s = useApp.getState();
  if (entry.kind === "canvas") {
    // A canvas is a tab like any other target; NotesModule loads it.
    s.openTab({ kind: "canvas", path: entry.path }, pin ? undefined : { preview: true });
    return;
  }
  void s.openNote(entry.path, pin ? { pin: true } : undefined);
}

/** Doble clic: la pestaña de vista previa del archivo pasa a ser permanente. */
function keepEntry(entry: TreeEntry) {
  useApp.getState().keepTab(`${entry.kind === "canvas" ? "canvas" : "note"}:${entry.path}`);
}

function EntryIcon({ entry, open }: { entry: TreeEntry; open: boolean }) {
  const cls = "h-4 w-4 flex-none";
  if (entry.type === "folder") {
    return open ? <FolderOpen className={cn(cls, "text-dim")} strokeWidth={1.7} />
      : <Folder className={cn(cls, "text-dim")} strokeWidth={1.7} />;
  }
  if (entry.kind === "code") return <FileCode2 className={cn(cls, "text-mint")} strokeWidth={1.7} />;
  if (entry.kind === "canvas") return <LayoutDashboard className={cn(cls, "text-warn")} strokeWidth={1.7} />;
  return <FileText className={cn(cls, "text-accent-text")} strokeWidth={1.7} />;
}

/**
 * Drop-target highlight lives outside React state: dragging over rows only
 * re-renders the rows whose highlight changes, never the whole tree.
 */
let dropTargetPath: string | null = null;
const dropListeners = new Set<() => void>();
function setDropTargetPath(next: string | null | ((t: string | null) => string | null)) {
  const v = typeof next === "function" ? next(dropTargetPath) : next;
  if (v === dropTargetPath) return;
  dropTargetPath = v;
  dropListeners.forEach((l) => l());
}
function subscribeDrop(cb: () => void) {
  dropListeners.add(cb);
  return () => void dropListeners.delete(cb);
}
function useIsDropTarget(path: string): boolean {
  return useSyncExternalStore(subscribeDrop, () => dropTargetPath === path);
}

function dropHandlers(folder: string, onDropInto: (src: string, folder: string) => void) {
  return {
    "data-dropzone": "1",
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTargetPath(folder);
    },
    onDragLeave: () => setDropTargetPath((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetPath(null);
      onDropInto(e.dataTransfer.getData(DRAG_MIME), folder);
    },
  };
}

export interface TreeRowProps {
  entry: TreeEntry;
  depth: number;
  open: boolean;
  isActive: boolean;
  isRevealed: boolean;
  routeInfo: RouteInfo | undefined;
  routePreview: boolean;
  toggle: (path: string) => void;
  onMenu: (entry: TreeEntry, e: React.MouseEvent) => void;
  onDropInto: (src: string, folder: string) => void;
}

/** One explorer row. Memoized: hovering is pure CSS and never touches React. */
export const TreeRow = memo(function TreeRow({
  entry, depth, open, isActive, isRevealed, routeInfo, routePreview, toggle, onMenu, onDropInto,
}: TreeRowProps) {
  const isFolder = entry.type === "folder";
  const isDrop = useIsDropTarget(entry.path);
  return (
    <div
      role="treeitem"
      aria-expanded={isFolder ? open : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, entry.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      {...(isFolder ? dropHandlers(entry.path, onDropInto) : {})}
      onClick={(e) => (isFolder ? void openFolderView(entry, toggle, open) : openEntry(entry, e.ctrlKey || e.metaKey))}
      onDoubleClick={() => !isFolder && keepEntry(entry)}
      onAuxClick={(e) => e.button === 1 && !isFolder && openEntry(entry, true)}
      onContextMenu={(e) => onMenu(entry, e)}
      className={cn(
        "group flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] [contain:layout_style]",
        isActive ? "bg-accent-soft text-text" : "text-dim hover:bg-hover hover:text-text",
        isDrop && "outline outline-1 outline-accent",
        isFolder && isRevealed && "ring-1 ring-accent bg-accent-soft",
        isFolder && routeInfo?.route === "skipped" && "opacity-60",
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      <button
        type="button"
        title={open ? "Contraer" : "Expandir"}
        aria-label={open ? `Contraer ${entry.name}` : `Expandir ${entry.name}`}
        onClick={(e) => {
          // The chevron expands; the name opens the folder's view.
          e.stopPropagation();
          if (isFolder) toggle(entry.path);
        }}
        className={cn(
          "grid h-4 w-4 flex-none place-items-center rounded",
          !isFolder || entry.has_children === false ? "invisible" : "hover:bg-hover",
        )}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 text-faint transition-transform", open && "rotate-90")} />
      </button>
      <EntryIcon entry={entry} open={open} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {isFolder && routeInfo && <RouteBadge info={routeInfo} compact preview={routePreview} />}
    </div>
  );
});

export function FileTree({ filter }: { filter: string }) {
  const version = useApp((s) => s.treeVersion);
  const active = useApp((s) => s.active);
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const expandedRef = useRef(expanded);
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  // La ruta del Mentor: un mapa carpeta → ruta calculado una vez por plan (ninguna fila hace llamadas)
  const route = useRouteView();
  const routeSnap = route.available ? route.snap : null;
  const routeOnly = route.only ? route.snap : null;

  const load = useCallback(async (path: string) => {
    try {
      const entries = await api.listDir(path);
      setChildren((c) => ({ ...c, [path]: entries }));
    } catch {
      // A folder that vanished: drop it from the expanded set.
      setExpanded((ex) => {
        const next = new Set(ex);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    expandedRef.current = expanded;
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  }, [expanded]);

  // «Ver en NoteVault»: abre todas las carpetas hasta la pedida, la carga y la resalta.
  const revealFolder = useApp((st) => st.revealFolder);
  useEffect(() => {
    if (!revealFolder) return;
    const parts = revealFolder.path.split("/").filter(Boolean);
    const chain = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setExpanded((ex) => new Set([...ex, ...chain]));
    for (const c of chain) void load(c);
  }, [revealFolder, load]);

  // (Re)load the root and every open folder whenever the tree changes.
  useEffect(() => {
    void load("");
    for (const p of expandedRef.current) void load(p);
    setIndex(null);
  }, [version, load]);

  // The filter searches every note, not just the folders already opened.
  useEffect(() => {
    if (filter && index === null) {
      api.noteIndex().then(setIndex).catch(() => setIndex([]));
    }
  }, [filter, index]);

  const toggle = useCallback((path: string) => {
    setExpanded((ex) => {
      const next = new Set(ex);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        void load(path);
      }
      return next;
    });
  }, [load]);

  const moveInto = useCallback(async (src: string, destFolder: string) => {
    if (!src || parentOf(src) === destFolder || src === destFolder) return;
    const s = useApp.getState();
    try {
      const { path } = await api.move(src, destFolder);
      s.pathRenamed(src, path);
      if (destFolder) {
        setExpanded((ex) => {
          const next = new Set(ex);
          next.add(destFolder);
          return next;
        });
        void load(destFolder);
      }
      void load(parentOf(src));
      void load("");
    } catch (e) {
      s.toast("error", (e as Error).message);
    }
  }, [load]);

  const onDropInto = useCallback((src: string, folder: string) => void moveInto(src, folder), [moveInto]);

  /** Every action the right-click menu offers for an entry. */
  const [moveEntry, setMoveEntry] = useState<TreeEntry | null>(null);
  const [historyEntry, setHistoryEntry] = useState<string | null>(null);

  const menuActions = useCallback((entry: TreeEntry) => {
    const s = useApp.getState();
    return {
      openInNewTab: () => openEntry(entry, true),
      openToTheRight: () => void s.openSide(entry.path),
      openInNewWindow: () => {
        void api.openInNewWindow(entry.path).catch((e: Error) => s.toast("error", e.message));
      },
      makeCopy: () => {
        void api
          .duplicate(entry.path)
          .then(({ path }) => {
            s.refreshTree();
            s.toast("info", `Copia creada: ${path.split("/").pop()}`);
          })
          .catch((e: Error) => s.toast("error", e.message));
      },
      moveToFolder: () => setMoveEntry(entry),
      toggleBookmark: () => void s.toggleBookmark(entry.path),
      copyPath: (flavor: PathFlavor) => {
        const root = useApp.getState().vault ?? "";
        const vaultName = root.split(/[\/]/).filter(Boolean).pop() ?? "vault";
        const value = pathFlavors(entry.path, root, vaultName)[flavor];
        void copyText(value).then((ok) =>
          s.toast(ok ? "info" : "error", ok ? `Ruta copiada: ${value}` : "No se pudo copiar la ruta."),
        );
      },
      versionHistory: () => setHistoryEntry(entry.path),
      openInDefaultApp: () => {
        void api.openInDefaultApp(entry.path).catch((e: Error) => s.toast("error", e.message));
      },
      revealInExplorer: () => {
        void api.revealInOs(entry.path).catch((e: Error) => s.toast("error", e.message));
      },
      rename: () => void renameEntry(entry),
      trash: () => void trashEntry(entry),
      newNoteHere: () => void newNoteIn(entry.path),
      newFolderHere: () => void newFolderIn(entry.path),
      newCanvasHere: () => void newCanvasIn(entry.path),
      addToChat: () => {
        const a = useAssistant.getState();
        if (entry.type === "folder") a.toggleFolder(entry.path);
        else a.toggleFile(entry.path);
        a.setOpen(true);
      },
      generateTopic: () => void generateTopicFrom(entry.path),
    };
  }, []);

  const openEntryMenu = useCallback((entry: TreeEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const known = useApp.getState().notes[entry.path]?.bookmarked;
    openMenu(
      e,
      fileMenuItems(
        { entry, bookmarked: known, canCopy: entry.type !== "folder", inChat: useAssistant.getState().folders.includes(entry.path) || useAssistant.getState().files.includes(entry.path) },
        menuActions(entry),
      ),
    );
  }, [menuActions]);
  const menuFor = (entry: TreeEntry) => (e: React.MouseEvent) => openEntryMenu(entry, e);

  const onEmptyContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useApp.getState();
    const collapseAll = () => {
      localStorage.setItem(EXPANDED_KEY, "[]");
      s.refreshTree();
    };
    openMenu(
      e,
      treeRootMenuItems({
        newNote: () => void newNoteIn(""),
        newFolder: () => void newFolderIn(""),
        newCanvas: () => void newCanvasIn(""),
        refresh: s.refreshTree,
        collapseAll,
        revealInExplorer: () => void api.revealPath("").catch((err: Error) => s.toast("error", err.message)),
      }),
    );
  };

  interface FlatTreeItem {
    entry: TreeEntry;
    depth: number;
  }

  const flatItems = useMemo<FlatTreeItem[]>(() => {
    const list: FlatTreeItem[] = [];
    // «Solo mi ruta»: solo los temas vivos del plan, sus carpetas contenedoras y lo que hay dentro de cada tema (nada se borra: solo se oculta)
    const insideLive = (p: string): boolean => {
      for (let q = p, i = 0; q && i < 12; i++) {
        if (routeOnly!.liveFolders.has(q)) return true;
        const cut = q.lastIndexOf("/");
        q = cut < 0 ? "" : q.slice(0, cut);
      }
      return false;
    };
    const shown = (e: TreeEntry): boolean => !routeOnly || (e.type === "folder" && routeOnly.ancestors.has(e.path)) || insideLive(e.path);
    function walk(entries: TreeEntry[] | undefined, depth: number) {
      if (!entries) return;
      for (const entry of entries) {
        if (!shown(entry)) continue;
        list.push({ entry, depth });
        if (entry.type === "folder" && expanded.has(entry.path)) {
          walk(children[entry.path], depth + 1);
        }
      }
    }
    walk(children[""], 0);
    return list;
  }, [children, expanded, routeOnly]);

  // al activar «Solo mi ruta» se abren las carpetas de materia y rama que llevan a los temas de la ruta
  useEffect(() => {
    if (!routeOnly) return;
    const top = [...routeOnly.ancestors].filter((p) => p.split("/").length <= 2);
    const missing = top.filter((p) => !expandedRef.current.has(p));
    if (!missing.length) return;
    setExpanded((ex) => new Set([...ex, ...missing]));
    for (const p of missing) void load(p);
  }, [routeOnly, load]);

  const treeContainerRef = useRef<HTMLDivElement>(null);
  // …y se desplaza hasta ella (una sola vez por petición, cuando la carpeta ya está en la lista plana)
  const scrolledFor = useRef(0);
  useEffect(() => {
    if (!revealFolder || scrolledFor.current === revealFolder.n) return;
    const i = flatItems.findIndex((it) => it.entry.path === revealFolder.path);
    if (i < 0) return;
    scrolledFor.current = revealFolder.n;
    const el = treeContainerRef.current;
    if (el) el.scrollTop = Math.max(0, i * 30 - 90);
  }, [revealFolder, flatItems]);

  const treeVirtual = useVirtualList({
    itemCount: flatItems.length,
    itemHeight: 30,
    containerRef: treeContainerRef,
    overscan: 6,
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || !index) return null;
    return index
      .filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .slice(0, 200);
  }, [filter, index]);

  const filteredContainerRef = useRef<HTMLDivElement>(null);
  const filteredVirtual = useVirtualList({
    itemCount: filtered?.length ?? 0,
    itemHeight: 46,
    containerRef: filteredContainerRef,
    overscan: 5,
  });

  if (filtered) {
    const visibleFiltered = filtered.slice(filteredVirtual.startIndex, filteredVirtual.endIndex);
    return (
      <div
        ref={filteredContainerRef}
        className="h-full overflow-y-auto px-2 py-1"
        onContextMenu={onEmptyContextMenu}
      >
        {filtered.length === 0 && <div className="px-2 py-3 text-[12px] text-faint">Sin coincidencias.</div>}
        <div style={{ height: filteredVirtual.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${filteredVirtual.startOffset}px)` }}>
            {visibleFiltered.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => void useApp.getState().openNote(n.path)}
                onContextMenu={(e) => {
                  menuFor({
                    type: "note",
                    name: n.title,
                    path: n.path,
                    kind: n.path.endsWith(".canvas") ? "canvas" : "note",
                  })(e);
                }}
                className={cn(
                  "flex h-[46px] w-full flex-col justify-center rounded-md px-2 py-1 text-left",
                  active === n.path ? "bg-accent-soft" : "hover:bg-hover",
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] text-text">
                  <FileText className="h-3.5 w-3.5 flex-none text-accent-text" /> <span className="truncate">{n.title}</span>
                </span>
                <span className="truncate pl-5 font-mono text-[10.5px] text-faint">{parentOf(n.path) || "/"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const visibleTree = flatItems.slice(treeVirtual.startIndex, treeVirtual.endIndex);

  return (
    <div
      ref={treeContainerRef}
      role="tree"
      className="h-full overflow-y-auto px-2 py-1"
      onContextMenu={onEmptyContextMenu}
      {...dropHandlers("", onDropInto)}
    >
      {children[""]?.length === 0 ? (
        <div className="px-2 py-3 text-[12px] text-faint">El vault está vacío. Crea tu primera nota.</div>
      ) : (
        <div style={{ height: treeVirtual.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${treeVirtual.startOffset}px)` }}>
            {visibleTree.map(({ entry, depth }) => (
              <TreeRow
                key={entry.path}
                entry={entry}
                depth={depth}
                open={entry.type === "folder" && expanded.has(entry.path)}
                isActive={active === entry.path}
                isRevealed={revealFolder?.path === entry.path}
                routeInfo={entry.type === "folder" ? routeSnap?.byFolder.get(entry.path) : undefined}
                routePreview={route.preview}
                toggle={toggle}
                onMenu={openEntryMenu}
                onDropInto={onDropInto}
              />
            ))}
          </div>
        </div>
      )}
      <div className="h-28 w-full cursor-default" aria-hidden="true" />
      {moveEntry && (
        <MoveEntryDialog
          entry={{ path: moveEntry.path, name: moveEntry.name, type: moveEntry.type }}
          onClose={() => setMoveEntry(null)}
          onDone={() => setMoveEntry(null)}
        />
      )}
      {historyEntry && <VersionHistoryDialog rel={historyEntry} onClose={() => setHistoryEntry(null)} />}
    </div>
  );
}
