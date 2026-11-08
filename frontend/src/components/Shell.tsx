// App chrome: top bar (with unified tab strip), icon rail, status bar, toasts.

import {
  Calendar, CircleCheck, Copy, Dumbbell, Flag, Globe, House, Kanban, Minus, Moon, PanelLeft, PanelRight,
  PenLine, Pin, PinOff, Plus, Square, SquareCheck, Sun, Wallet, X, Cloud, CloudUpload,
  CircleAlert, Settings, FileCode2, FileText, LayoutDashboard, GraduationCap, Apple,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { api, isElectron } from "../lib/bridge";
import { useApp, type AppTab, type ModuleId } from "../store/app";
import { cn, openMenu } from "./ui";
import { useVaultDialog } from "./VaultDialog";
import { useTabDrag } from "../store/tabDrag";
import { useSettingsDialog } from "./settings/SettingsDialog";
import { newNoteIn } from "./notes/FileTree";
import { TopBarPomodoro } from "./TopBarPomodoro";
import { BUILD_STAMP } from "../buildInfo";

// ── Module registry ─────────────────────────────────────────────────────────

export const MODULES: Array<{ id: ModuleId; label: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { id: "home", label: "Vista General", Icon: House },
  { id: "calendario", label: "Calendario", Icon: Calendar },
  { id: "habits", label: "Hábitos", Icon: CircleCheck },
  { id: "ejercicio", label: "Ejercicio", Icon: Dumbbell },
  { id: "alimentacion", label: "Alimentación", Icon: Apple },
  { id: "proyectos", label: "Proyectos", Icon: Kanban },
  { id: "metas", label: "Metas", Icon: Flag },
  { id: "finanzas", label: "Finanzas", Icon: Wallet },
  { id: "notas", label: "Notas", Icon: PenLine },
  { id: "tareas", label: "Tareas", Icon: SquareCheck },
  { id: "web", label: "Navegador Web", Icon: Globe },
];

export function moduleLabel(id: ModuleId): string {
  return MODULES.find((m) => m.id === id)?.label
    ?? (id === "web" ? "Navegador Web" : id === "player" ? "Reproductor de inglés" : id === "mentor" ? "Mentor" : id);
}

function moduleIcon(id: ModuleId): ComponentType<{ size?: number; strokeWidth?: number }> {
  return MODULES.find((m) => m.id === id)?.Icon ?? (id === "mentor" ? GraduationCap : PenLine);
}

// ── Tab label / icon helpers ────────────────────────────────────────────────

function tabLabel(tab: AppTab, notes: Record<string, { title: string; kind: string }>): string {
  if (tab.kind === "module") return moduleLabel(tab.id);
  if (tab.kind === "web") return "Navegador";
  if (tab.kind === "canvas") {
    return tab.path.split("/").pop()?.replace(/\.canvas$/i, "") ?? tab.path;
  }
  return notes[tab.path]?.title ?? tab.path.split("/").pop()?.replace(/\.md$/, "") ?? tab.path;
}

function TabIcon({ tab, notes }: { tab: AppTab; notes: Record<string, { kind: string }> }) {
  if (tab.kind === "module") {
    const Icon = moduleIcon(tab.id);
    return <Icon size={13} strokeWidth={1.8} />;
  }
  if (tab.kind === "web") return <Globe size={13} strokeWidth={1.8} />;
  if (tab.kind === "canvas") return <LayoutDashboard size={13} strokeWidth={1.8} className="text-mint" />;
  const kind = notes[tab.path]?.kind;
  return kind === "code"
    ? <FileCode2 size={13} className="flex-none text-mint" />
    : <FileText size={13} className="flex-none text-accent-text" />;
}

/**
 * The browser's surface and its pages: they belong to the right-hand rail, not
 * to the horizontal bar (see `components/web/WebRail.tsx`).
 */
export function isBrowserTab(t: { kind: string; id?: string }): boolean {
  return t.kind === "web" || (t.kind === "module" && t.id === "web");
}

// ── Unified Tab Strip ───────────────────────────────────────────────────────

function TabStrip() {
  const openTabs = useApp((s) => s.openTabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const pinnedTabIds = useApp((s) => s.pinnedTabIds);
  const notes = useApp((s) => s.notes);
  const previewTabId = useApp((s) => s.previewTabId);
  const { setActiveTab, closeTab, pinTab, unpinTab, keepTab } = useApp.getState();
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useTabDrag((s) => s.drag);
  const dragging = useTabDrag((s) => s.draggingTabId);
  const [dropAt, setDropAt] = useState<{ tabId: string; side: "left" | "right" } | null>(null);
  // The browser is not a tab: its pages live in the right-hand rail, and the
  // surface that shows them is not listed here either. The strip carries notes,
  // canvases and the other functionalities only.
  const stripTabs = openTabs.filter((t) => !isBrowserTab(t));

  // The strip hides its scrollbar (it would eat the bar's height), so it has to
  // bring the tab you are on into view by itself.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeTabId) return;
    const el = document.getElementById(`tab-${activeTabId.replace(/[^a-z0-9]/gi, "-")}`);
    if (!el) return;
    const view = strip.getBoundingClientRect();
    const tab = el.getBoundingClientRect();
    if (tab.left < view.left) strip.scrollLeft -= view.left - tab.left + 8;
    else if (tab.right > view.right) strip.scrollLeft += tab.right - view.right + 8;
  }, [activeTabId, openTabs.length, stripTabs.length]);

  return (
    <div
      ref={stripRef}
      onWheel={(e) => {
        const strip = stripRef.current;
        if (!strip || strip.scrollWidth <= strip.clientWidth) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        strip.scrollLeft += e.deltaY;
      }}
      className="nv-tabstrip flex min-w-0 flex-1 items-end overflow-x-auto pl-2"
      role="tablist"
      aria-label="Pestañas abiertas"
    >
      {stripTabs.map((tab) => {
        const isActive = tab.tabId === activeTabId;
        const isPinned = pinnedTabIds.has(tab.tabId);
        const isDirty = (tab.kind === "note" && notes[tab.path]?.dirty) ||
          (tab.kind === "note" && notes[tab.path]?.saving);
        const label = tabLabel(tab, notes as Record<string, { title: string; kind: string }>);

        return (
          <div
            key={tab.tabId}
            id={`tab-${tab.tabId.replace(/[^a-z0-9]/gi, "-")}`}
            role="tab"
            aria-selected={isActive}
            title={tab.kind === "note" || tab.kind === "canvas" ? tab.path : label}
            onClick={() => setActiveTab(tab.tabId)}
            onDoubleClick={() => keepTab(tab.tabId)}
            onAuxClick={(e) => e.button === 1 && !isPinned && void closeTab(tab.tabId)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_MIME, tab.tabId);
              e.dataTransfer.effectAllowed = "move";
              drag(tab.tabId);
            }}
            onDragEnd={() => {
              drag(null);
              setDropAt(null);
            }}
            onDragOver={(e) => {
              if (!dragging || dragging === tab.tabId) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const side = e.clientX < r.left + r.width / 2 ? "left" : "right";
              if (dropAt?.tabId !== tab.tabId || dropAt.side !== side) setDropAt({ tabId: tab.tabId, side });
            }}
            onDragLeave={() => setDropAt((d) => (d?.tabId === tab.tabId ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData(TAB_MIME) || dragging;
              const side = dropAt?.tabId === tab.tabId ? dropAt.side : "right";
              setDropAt(null);
              drag(null);
              if (draggedId) useApp.getState().splitTab(draggedId, tab.tabId, side);
            }}
            onContextMenu={(e) => openMenu(e, [
              ...(tab.tabId === previewTabId ? [{ label: "Mantener abierta", icon: <Pin />, onSelect: () => keepTab(tab.tabId) }] : []),
              isPinned
                ? { label: "Dejar de fijar", icon: <PinOff />, onSelect: () => unpinTab(tab.tabId) }
                : { label: "Fijar", icon: <Pin />, onSelect: () => pinTab(tab.tabId) },
              { label: "Cerrar", icon: <X />, onSelect: () => !isPinned && void closeTab(tab.tabId) },
              {
                label: "Cerrar las demás", onSelect: () => {
                  for (const t of useApp.getState().openTabs) {
                    if (t.tabId !== tab.tabId && !useApp.getState().pinnedTabIds.has(t.tabId)) {
                      void closeTab(t.tabId);
                    }
                  }
                },
              },
            ])}
            className={cn(
              "group relative flex h-full w-[148px] flex-none cursor-pointer items-center gap-1.5 border-r border-line px-2.5 text-[12px]",
              dragging === tab.tabId && "opacity-50",
              dropAt?.tabId === tab.tabId && (dropAt.side === "left"
                ? "shadow-[inset_2px_0_0_var(--nv-accent)]"
                : "shadow-[inset_-2px_0_0_var(--nv-accent)]"),
              isActive
                ? "bg-surface text-text shadow-[inset_0_2px_0_var(--nv-accent)]"
                : "text-dim hover:bg-hover hover:text-text",
            )}
          >
            <TabIcon tab={tab} notes={notes as Record<string, { kind: string }>} />
            <span className={cn("min-w-0 flex-1 truncate", tab.tabId === previewTabId && "italic")} data-preview={tab.tabId === previewTabId ? "true" : undefined}>{label}</span>
            {isPinned ? (
              <Pin size={11} className="flex-none text-accent-text" />
            ) : (
              <button
                type="button"
                title="Cerrar pestaña"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.tabId);
                }}
                className={cn(
                  "relative grid h-4 w-4 flex-none place-items-center rounded text-faint hover:bg-hover hover:text-text",
                  !isActive && "opacity-0 group-hover:opacity-100",
                )}
              >
                {isDirty ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent group-hover:hidden" />
                    <X size={11} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={11} />
                )}
              </button>
            )}
          </div>
        );
      })}
      {/* New note button */}
      <button
        type="button"
        title="Nueva nota (Ctrl+P)"
        onClick={() => void newNoteIn("")}
        className="mb-1 ml-1 grid h-6 w-6 flex-none place-items-center rounded text-faint hover:bg-hover hover:text-text"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// ── TopBar ──────────────────────────────────────────────────────────────────
//
// One single bar: it is the window's title bar (the window has no OS frame), so
// it holds the brand and vault, the workspace icons, the open tabs, the sync
// state and the window controls in the same row. Nothing is stacked above it.

/** El tipo de dato que viaja al arrastrar una pestaña. */
export const TAB_MIME = "application/x-notevault-tab";

export function TopBar() {
  return (
    <header
      className="nv-titlebar flex h-10 flex-none items-stretch border-b border-line bg-bg"
      onDoubleClick={(e) => {
        // Double-clicking the bar maximizes, the way any title bar does.
        if ((e.target as Element).closest("button, [role=tab]")) return;
        void api.windowToggleMaximize().catch(() => undefined);
      }}
    >
      {/* Workspace icons: the explorer panel and its three views */}
      <WorkspaceIcons />

      {/* Tab strip takes the remaining space */}
      <TabStrip />

      {/* Sync state + Pomodoro global + panel derecho + window controls on the right */}
      <div className="flex flex-none items-center gap-2 border-l border-line px-2.5">
        <TopBarPomodoro />
        <SyncState />
        <RightPanelToggle />
      </div>
      <WindowControls />
    </header>
  );
}

// ── Workspace icons ─────────────────────────────────────────────────────────

function WorkspaceIcons() {
  const explorerOpen = useApp((s) => s.explorerOpen);
  const toggleExplorer = useApp((s) => s.toggleExplorer);

  // The three view shortcuts that used to live here are gone: the explorer panel
  // carries its own tabs (Archivos · Buscar · Marcadores · Etiquetas · Grafo), so
  // the strip gives that space back to the tabs. Only the panel toggle stays,
  // because it is the one thing that belongs to the window and not to a module.
  return (
    // Exactly as wide as the icon rail below it (w-12), full height, closed by a rule: the
    // toggle sits directly above the rail and the tabs start after a clear divider.
    <button
      type="button"
      title="Panel lateral izquierdo (Ctrl+\)"
      aria-label="Panel lateral izquierdo"
      aria-pressed={explorerOpen}
      onClick={toggleExplorer}
      className={cn(
        "grid w-12 flex-none place-items-center border-r border-line transition-colors hover:bg-hover",
        explorerOpen ? "text-text" : "text-faint hover:text-text",
      )}
    >
      <PanelLeft size={17} strokeWidth={1.8} />
    </button>
  );
}

function RightPanelToggle() {
  const rightPanelOpen = useApp((s) => s.rightPanelOpen);
  const toggleRightPanel = useApp((s) => s.toggleRightPanel);

  return (
    <button
      type="button"
      title="Panel derecho (plegar / desplegar)"
      aria-label="Panel derecho"
      aria-pressed={rightPanelOpen}
      onClick={toggleRightPanel}
      className={cn(
        "grid h-7 w-7 place-items-center rounded transition-colors hover:bg-hover",
        rightPanelOpen ? "text-text" : "text-faint hover:text-text",
      )}
    >
      <PanelRight size={15} strokeWidth={1.8} />
    </button>
  );
}

// ── Window controls ─────────────────────────────────────────────────────────

const CTRL = "grid w-11 place-items-center text-dim transition-colors hover:bg-hover hover:text-text";

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const electron = isElectron();

  useEffect(() => {
    if (!electron) return;
    let live = true;
    const read = () => {
      void api.windowState()
        .then((s) => { if (live) setMaximized(Boolean(s?.maximized)); })
        .catch(() => undefined);
    };
    read();
    // Maximizing from anywhere else (double click, Win+Up) keeps the icon honest.
    const off = api.onWindowState((s) => setMaximized(Boolean(s?.maximized)));
    window.addEventListener("resize", read);
    return () => {
      live = false;
      off();
      window.removeEventListener("resize", read);
    };
  }, [electron]);

  // pywebview and the dev bridge bring their own window chrome.
  if (!electron) return null;

  return (
    <div className="flex flex-none items-stretch border-l border-line">
      <button
        type="button"
        title="Minimizar"
        aria-label="Minimizar"
        onClick={() => void api.windowMinimize().catch(() => undefined)}
        className={CTRL}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        title={maximized ? "Restaurar" : "Maximizar"}
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        onClick={() => void api.windowToggleMaximize()
          .then((s) => setMaximized(Boolean(s?.maximized)))
          .catch(() => undefined)}
        className={CTRL}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        title="Cerrar"
        aria-label="Cerrar"
        onClick={() => void api.windowClose().catch(() => undefined)}
        className={cn(CTRL, "hover:bg-danger hover:text-white")}
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ── SyncState ───────────────────────────────────────────────────────────────

function SyncState() {
  const pending = useApp((s) => Object.values(s.notes).filter((n) => n.dirty || n.saving).length);
  const conflicts = useApp((s) => Object.values(s.notes).filter((n) => n.conflict).length);
  if (conflicts) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-warn">
        <CircleAlert size={12} /> Conflicto
      </span>
    );
  }
  return pending ? (
    <span className="flex items-center gap-1.5 text-[11px] text-dim">
      <CloudUpload size={12} /> Guardando…
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-[11px] text-mint">
      <Cloud size={12} /> Guardado
    </span>
  );
}

// ── Icon Rail (launcher) ────────────────────────────────────────────────────

export function IconRail() {
  const activeTabId = useApp((s) => s.activeTabId);
  const openTabs = useApp((s) => s.openTabs);
  const setModule = useApp((s) => s.setModule);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);

  // Highlight the icon when that module's tab is the active one
  const activeModuleId = (() => {
    const tab = openTabs.find((t) => t.tabId === activeTabId);
    return tab?.kind === "module" ? tab.id : null;
  })();

  return (
    <nav aria-label="Módulos" className="flex w-12 flex-none flex-col items-center gap-1.5 border-r border-line bg-bg py-3">
      {MODULES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => setModule(id)}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg transition-colors",
            activeModuleId === id
              ? "bg-accent text-white shadow-[0_0_0_1px_var(--nv-accent)]"
              : "text-faint hover:bg-hover hover:text-text",
          )}
        >
          <Icon size={18} strokeWidth={1.8} />
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        title="Configuración"
        aria-label="Configuración"
        onClick={() => useSettingsDialog.getState().set(true)}
        className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-hover hover:text-text"
      >
        <Settings size={17} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="Cambiar tema"
        aria-label="Cambiar tema"
        onClick={toggleTheme}
        className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-hover hover:text-text"
      >
        {theme === "dark" ? <Moon size={17} strokeWidth={1.8} /> : <Sun size={17} strokeWidth={1.8} />}
      </button>
    </nav>
  );
}

// ── StatusBar ───────────────────────────────────────────────────────────────

export function StatusBar() {
  const active = useApp((s) => s.active);
  const notes = useApp((s) => s.notes);
  const note = active ? notes[active] : undefined;
  const cursor = useApp((s) => s.cursor);
  const mode = useApp((s) => s.mode);
  const info = useApp((s) => s.info);
  const words = note ? (note.raw.match(/\S+/g)?.length ?? 0) : 0;
  return (
    <footer className="flex h-7 flex-none items-center gap-3 border-t border-line bg-bg px-3 font-mono text-[10.5px] text-faint">
      {/* The vault switcher lives here: the top bar only carries tabs. */}
      <button
        type="button"
        title="Cambiar de vault"
        onClick={() => useVaultDialog.getState().set(true)}
        className="flex items-center gap-1.5 text-mint hover:text-text"
      >
        <Cloud size={12} /> {info?.vault_name ?? "vault"}
      </button>
      {note && (
        <>
          <Sep />
          <span>UTF-8 · {note.eol === "\r\n" ? "CRLF" : "LF"}</span>
          <Sep />
          <span>
            {mode !== "read" && cursor ? `Ln ${cursor.line}, Col ${cursor.col} · ` : ""}
            {words.toLocaleString("es")} palabras
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3"><span title="Cuándo se compiló esta versión de NoteVault" data-testid="build-stamp">compilado {BUILD_STAMP}</span><span>{note ? note.path : "Sin nota abierta"}</span></span>
    </footer>
  );
}

function Sep() {
  return <span className="text-line-strong">|</span>;
}

// ── Toasts ──────────────────────────────────────────────────────────────────

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-[380px] items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] shadow-xl",
            t.kind === "error"
              ? "border-danger/40 bg-card text-text"
              : "border-line-strong bg-card text-text",
          )}
        >
          {t.kind === "error" && <CircleAlert size={15} className="mt-px flex-none text-danger" />}
          <span className="flex-1">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="text-faint hover:text-text">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── ComingSoon ──────────────────────────────────────────────────────────────

export function ComingSoon({ module }: { module: ModuleId }) {
  return (
    <div className="grid flex-1 place-items-center bg-surface">
      <div className="max-w-md text-center">
        <div className="text-[15px] font-semibold text-text">{moduleLabel(module)}</div>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">
          Este módulo todavía vive en la app clásica. Se migra a la nueva interfaz en las
          próximas fases; mientras tanto ábrelo con <span className="font-mono text-accent-text">python run_app.py</span>.
        </p>
      </div>
    </div>
  );
}
