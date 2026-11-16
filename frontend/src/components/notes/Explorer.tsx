import {
  ArrowLeft, Bookmark, GraduationCap, LayoutDashboard, Waypoints, ChevronsDownUp, Hash, Database, FilePlus, Files, FolderPlus, Network, RefreshCw, Search, ChevronLeft,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/bridge";
import type { Bookmark as BookmarkT, SearchHit } from "../../lib/types";
import { useApp, type ExplorerTab } from "../../store/app";
import { cn, IconButton } from "../ui";
import { useVirtualList } from "../../lib/useVirtualList";
import { FileTree, newCanvasIn, newFolderIn, newNoteIn } from "./FileTree";
import { GraphPanel } from "./GraphPanel";
import { useConceptMap } from "../canvas/ConceptMapDialog";
import { useStudyFolders } from "../study/StudyFoldersDialog";
import { RouteToggle } from "../study/RouteUi";

const TABS: Array<{ id: ExplorerTab; label: string; icon: ReactNode }> = [
  { id: "files", label: "Files", icon: <Files size={14} /> },
  { id: "search", label: "Search", icon: <Search size={14} /> },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark size={14} /> },
  { id: "tags", label: "Etiquetas", icon: <Hash size={14} /> },
  { id: "graph", label: "Grafo", icon: <Network size={14} /> },
];

export function Explorer({ width }: { width: number }) {
  const tab = useApp((s) => s.explorerTab);
  const setTab = useApp((s) => s.setExplorerTab);
  const info = useApp((s) => s.info);
  return (
    <aside className="flex flex-none flex-col border-r border-line bg-panel" style={{ width }}>
      <div className="flex h-10 flex-none items-center gap-1 overflow-hidden border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex h-7 flex-none items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
              tab === t.id ? "bg-accent-soft text-text" : "text-dim hover:bg-hover hover:text-text",
            )}
          >
            {t.icon}
            {tab === t.id && t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => useApp.getState().toggleExplorer()}
          title="Plegar explorador (Ctrl+\)"
          aria-label="Plegar explorador"
          className="ml-auto grid h-7 w-7 flex-none place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "files" && <FilesPanel />}
        {tab === "search" && <SearchPanel />}
        {tab === "bookmarks" && <BookmarksPanel />}
        {tab === "tags" && <TagsPanel />}
        {tab === "graph" && <GraphPanel />}
      </div>

      <div className="m-2 flex flex-none items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
        <Database size={14} className="text-dim" />
        <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-text">
          {info?.vault_name ?? "…"}
        </span>
      </div>
    </aside>
  );
}

function FilesPanel() {
  const [filter, setFilter] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const version = useApp((s) => s.treeVersion);
  const refreshTree = useApp((s) => s.refreshTree);
  const active = useApp((s) => s.active);
  const folderOfActive = active && active.includes("/") ? active.slice(0, active.lastIndexOf("/")) : "";

  useEffect(() => {
    api.stats().then((s) => setCount(s.notes)).catch(() => setCount(null));
  }, [version]);

  const collapseAll = () => {
    localStorage.setItem("nv.tree.expanded", "[]");
    refreshTree();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 flex-none items-center gap-0.5 px-2">
        <IconButton title="Nueva nota" onClick={() => void newNoteIn(folderOfActive)}>
          <FilePlus size={15} />
        </IconButton>
        <IconButton title="Nueva carpeta" onClick={() => void newFolderIn(folderOfActive)}>
          <FolderPlus size={15} />
        </IconButton>
        <IconButton title="Nuevo canvas" onClick={() => void newCanvasIn(folderOfActive)}>
          <LayoutDashboard size={15} />
        </IconButton>
        <IconButton title="Generar mapa conceptual" onClick={() => useConceptMap.getState().set(true)}>
          <Waypoints size={15} />
        </IconButton>
        <IconButton title="Espacios de estudio" onClick={() => useStudyFolders.getState().set(true)}>
          <GraduationCap size={15} />
        </IconButton>
        <div className="flex-1" />
        <IconButton title="Recargar" onClick={refreshTree}>
          <RefreshCw size={14} />
        </IconButton>
        <IconButton title="Colapsar carpetas" onClick={collapseAll}>
          <ChevronsDownUp size={15} />
        </IconButton>
      </div>
      <div className="flex-none px-2 pb-1.5">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={13} className="flex-none text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por nombre…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
          />
          {count !== null && (
            <span className="flex-none rounded border border-line bg-elevated px-1.5 font-mono text-[10px] text-faint">
              {count}
            </span>
          )}
        </label>
      </div>
      <RouteToggle className="flex-none px-2.5 pb-1.5" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree filter={filter} />
      </div>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    if (!query) return [text];
    const q = query.toLowerCase();
    const out: string[] = [];
    let rest = text;
    for (;;) {
      const i = rest.toLowerCase().indexOf(q);
      if (i < 0 || !q) {
        out.push(rest);
        break;
      }
      out.push(rest.slice(0, i), rest.slice(i, i + q.length));
      rest = rest.slice(i + q.length);
    }
    return out;
  }, [text, query]);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent-text">{p}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const openNote = useApp((s) => s.openNote);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api.search(q, 200)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const groups = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m.entries()];
  }, [hits]);

  const rows = useMemo(() => {
    const list: Array<
      | { kind: "header"; path: string; title: string }
      | { kind: "hit"; path: string; line_no: number; line: string }
    > = [];
    for (const [path, hitList] of groups) {
      list.push({ kind: "header", path, title: hitList[0]!.title });
      for (const h of hitList.filter((x: SearchHit) => x.line_no > 0).slice(0, 6)) {
        list.push({ kind: "hit", path, line_no: h.line_no, line: h.line });
      }
    }
    return list;
  }, [groups]);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchVirtual = useVirtualList({
    itemCount: rows.length,
    itemHeight: 28,
    containerRef: searchContainerRef,
    overscan: 6,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none p-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent">
          <Search size={13} className="text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en todas las notas…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
          />
        </label>
        {hits && (
          <div className="px-1 pt-2 font-mono text-[10.5px] text-faint">
            {busy ? "Buscando…" : `${hits.length} coincidencias en ${groups.length} notas`}
          </div>
        )}
      </div>
      <div ref={searchContainerRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div style={{ height: searchVirtual.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${searchVirtual.startOffset}px)` }}>
            {rows.slice(searchVirtual.startIndex, searchVirtual.endIndex).map((r, i) =>
              r.kind === "header" ? (
                <button
                  key={`${r.path}:h:${searchVirtual.startIndex + i}`}
                  type="button"
                  onClick={() => void openNote(r.path)}
                  className="mt-1 w-full truncate rounded px-1.5 py-1 text-left text-[12.5px] font-semibold text-text hover:bg-hover"
                >
                  {r.title}
                </button>
              ) : (
                <button
                  key={`${r.path}:${r.line_no}`}
                  type="button"
                  onClick={() => void openNote(r.path, { line: r.line_no })}
                  className="block w-full truncate rounded px-1.5 py-0.5 pl-4 text-left text-[12px] text-dim hover:bg-hover"
                >
                  <span className="mr-1.5 font-mono text-[10px] text-faint">{r.line_no}</span>
                  <Highlight text={r.line} query={query.trim()} />
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BookmarksPanel() {
  const version = useApp((s) => s.bookmarkVersion);
  const openNote = useApp((s) => s.openNote);
  const [items, setItems] = useState<BookmarkT[] | null>(null);
  useEffect(() => {
    api.bookmarks().then(setItems).catch(() => setItems([]));
  }, [version]);
  return (
    <div className="h-full overflow-y-auto p-2">
      {items?.length === 0 && (
        <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
          Aún no hay marcadores. Usa el icono de marcador de una nota para añadirla aquí.
        </p>
      )}
      {items?.map((b) => (
        <button
          key={b.path}
          type="button"
          onClick={() => void openNote(b.path)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-dim hover:bg-hover hover:text-text"
        >
          <Bookmark size={14} className="flex-none text-accent-text" />
          <span className="truncate">{b.label}</span>
        </button>
      ))}
    </div>
  );
}

function TagsPanel() {
  const version = useApp((s) => s.treeVersion);
  const openNote = useApp((s) => s.openNote);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }> | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [notes, setNotes] = useState<Array<{ path: string; title: string }>>([]);

  useEffect(() => {
    api.tagsList().then(setTags).catch(() => setTags([]));
  }, [version]);
  useEffect(() => {
    if (!picked) return;
    api.tagNotes(picked).then(setNotes).catch(() => setNotes([]));
  }, [picked, version]);

  if (picked) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 flex-none items-center gap-1 px-2">
          <IconButton title="Volver a las etiquetas" onClick={() => setPicked(null)}>
            <ArrowLeft size={14} />
          </IconButton>
          <span className="truncate text-[12.5px] font-semibold text-accent-text">#{picked}</span>
          <span className="ml-auto font-mono text-[10.5px] text-faint">{notes.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
          {notes.map((n) => (
            <button
              key={n.path}
              type="button"
              title={n.path}
              onClick={() => void openNote(n.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-dim hover:bg-hover hover:text-text"
            >
              <span className="truncate">{n.title}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const q = filter.trim().toLowerCase().replace(/^#/, "");
  const shown = (tags ?? []).filter((t) => !q || t.tag.toLowerCase().includes(q));
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none p-2 pb-1.5">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent">
          <Hash size={13} className="flex-none text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar etiquetas…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
        {tags === null && <p className="px-2 py-3 text-[12px] text-faint">Leyendo el vault…</p>}
        {tags?.length === 0 && (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
            Ninguna nota tiene etiquetas. Escribe #etiqueta en una nota o añádela en sus propiedades.
          </p>
        )}
        {shown.map((t) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => setPicked(t.tag)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-dim hover:bg-hover hover:text-text"
          >
            <span className="truncate text-accent-text">#{t.tag}</span>
            <span className="ml-auto flex-none rounded border border-line bg-elevated px-1.5 font-mono text-[10px] text-faint">
              {t.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
