import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { api } from "./lib/bridge";
import { listenForCaptures } from "./lib/screenCapture";
import { flushAll, useApp, wasJustWritten } from "./store/app";
import { shouldRefreshTree } from "./lib/watchFlush";
import { MiniPlayer } from "./components/english/MiniPlayer";
import { ComingSoon, IconRail, MODULES as MODULE_LABELS, StatusBar, Toasts, TopBar, TAB_MIME } from "./components/Shell";
import { ModuleHost } from "./components/ModuleHost";
import { useTabDrag } from "./store/tabDrag";
import { X } from "lucide-react";
import { RightPanel } from "./components/notes/RightPanel";
import { ReviewCalendar, useReviewCalendar } from "./components/study/ReviewCalendar";
import { renameEntry } from "./components/notes/FileTree";
import { DialogHost, MenuHost } from "./components/ui";
import { SupportNotice } from "./components/SupportNotice";
import { VaultDialog } from "./components/VaultDialog";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { PomodoroTicker } from "./components/mentor/AreaSession";
import { PomodoroAssessmentModal } from "./components/mentor/PomodoroAssessmentModal";
import { AiSettingsDialog } from "./components/notes/AssistantPanel";
import { QuickSwitcher } from "./components/notes/QuickSwitcher";
import { CommandPalette, openDailyNote, ShortcutsDialog, useShortcutsDialog } from "./components/notes/CommandPalette";
import { useTasks } from "./store/tasks";
import { useCanvas } from "./store/canvas";
import type { ModuleId } from "./store/app";

// Modules load on first use: startup parses less code.
function lazyModule(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
const MODULES: Partial<Record<ModuleId, ComponentType>> = {
  notas: lazyModule(() => import("./components/notes/NotesModule"), "NotesModule"),
  home: lazyModule(() => import("./components/home/HomeModule"), "HomeModule"),
  tareas: lazyModule(() => import("./components/tasks/TasksModule"), "TasksModule"),
  habits: lazyModule(() => import("./components/habits/HabitsModule"), "HabitsModule"),
  calendario: lazyModule(() => import("./components/calendar/CalendarModule"), "CalendarModule"),
  proyectos: lazyModule(() => import("./components/projects/ProjectsModule"), "ProjectsModule"),
  metas: lazyModule(() => import("./components/goals/GoalsModule"), "GoalsModule"),
  ejercicio: lazyModule(() => import("./components/exercise/ExerciseModule"), "ExerciseModule"),
  alimentacion: lazyModule(() => import("./components/nutrition/NutritionModule"), "NutritionModule"),
  finanzas: lazyModule(() => import("./components/finance/FinanceModule"), "FinanceModule"),
  web: lazyModule(() => import("./components/web/WebModule"), "WebModule"),
  player: lazyModule(() => import("./components/english/EnglishPlayer"), "EnglishPlayer"),
  mentor: lazyModule(() => import("./components/mentor/MentorModule"), "MentorModule"),
};

/** The host renders one module at a time; this is how each of them is built. */
const renderModule = (id: ModuleId) => <ModuleView module={id} />;

function ModuleView({ module }: { module: ModuleId }) {
  const View = MODULES[module];
  if (!View) return <ComingSoon module={module} />;
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center bg-surface text-[13px] text-faint">Cargando…</div>}>
      <View />
    </Suspense>
  );
}

/**
 * The window must never navigate: a remote page loaded in it would get the
 * Python bridge. Every link click is caught here; web links open in the
 * system browser, everything else is handled by the view that owns it.
 */
function useNavigationGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      // A file we generated (a CSV export) downloads; it never navigates.
      if (href.startsWith("blob:") && a.hasAttribute("download")) return;
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) {
        api.openExternal(href).catch((err: Error) => useApp.getState().toast("error", err.message));
      }
    };
    const stop = (e: DragEvent) => {
      // Dropping a file must not open it in place of the app.
      if (!(e.target as Element | null)?.closest?.("[data-dropzone]")) e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F2 renames the file on screen, unless a text field is being edited.
      if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const el = e.target as HTMLElement | null;
        if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.closest(".cm-editor"))) return;
        const st = useApp.getState();
        const tab = st.openTabs.find((t) => t.tabId === st.activeTabId);
        if (tab?.kind === "note") {
          e.preventDefault();
          const note = st.notes[tab.path];
          void renameEntry({ type: "note", kind: note?.kind === "code" ? "code" : "note", name: note?.title ?? tab.path.split("/").pop()!, path: tab.path });
        } else if (tab?.kind === "canvas") {
          e.preventDefault();
          void renameEntry({ type: "note", kind: "canvas", name: tab.path.split("/").pop()!, path: tab.path });
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const s = useApp.getState();
      const key = e.key.toLowerCase();
      if (e.shiftKey && key === "p") {
        e.preventDefault();
        s.setPalette(true);
      } else if (e.shiftKey && key === "d") {
        e.preventDefault();
        void openDailyNote();
      } else if (key === ",") {
        e.preventDefault();
        useShortcutsDialog.getState().set(true);
      } else if (key === "p" || key === "o") {
        e.preventDefault();
        s.setSwitcher(true);
      } else if (key === "s") {
        e.preventDefault();
        const active = s.active;
        if (active) void s.save(active, { force: true });
      } else if (key === "e") {
        e.preventDefault();
        s.setMode(s.mode === "read" ? "edit" : "read");
      } else if (key === "w") {
        e.preventDefault();
        // Close the active tab
        const { activeTabId, pinnedTabIds } = s;
        if (activeTabId && !pinnedTabIds.has(activeTabId)) {
          void s.closeTab(activeTabId);
        }
      } else if (key === "\\") {
        e.preventDefault();
        if (e.altKey) {
          s.toggleRightPanel();
        } else {
          s.toggleExplorer();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const onUnload = () => void flushAll();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}

/** Task reminders: every minute, show the ones whose time has come. */
function useTaskReminders() {
  useEffect(() => {
    const check = () => {
      api.tasksDueReminders()
        .then((due) => {
          for (const t of due) {
            useApp.getState().toast("info", `🔔 Recordatorio: ${t.name}`);
            void api.tasksMarkReminderShown(t.id);
          }
          if (due.length) void useTasks.getState().load();
        })
        .catch(() => undefined);
    };
    const first = setTimeout(check, 3000);
    const every = setInterval(check, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
}

/**
 * A second window is opened *at* one file (`?note=…`): open it, so the window
 * has the same tabs, editor and canvases as any other, just started there.
 */
function useWindowNoteParam() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rel = new URLSearchParams(window.location.search).get("note");
    if (!rel) return;
    const s = useApp.getState();
    if (/\.canvas$/i.test(rel)) s.openTab({ kind: "canvas", path: rel });
    else void s.openNote(rel);
  }, []);
}

/** Quiet time after the last file event before the window reacts, and the longest it waits. */
const WATCH_QUIET_MS = 350;
const WATCH_MAX_MS = 1500;

/**
 * Creating a syllabus or a study space writes hundreds of files in a few seconds; each one
 * used to reload the whole tree at once, which froze the window. Events are gathered and the
 * window reacts ONCE per burst: one tree refresh, one reload per open file that changed.
 */
function useFileWatcherListener() {
  useEffect(() => {
    const changed = new Set<string>();
    let quiet: number | null = null;
    let first = 0;

    const flush = () => {
      quiet = null;
      first = 0;
      const rels = [...changed];
      changed.clear();
      const s = useApp.getState();
      // un autoguardado propio no cambia el árbol: sin esto cada guardado recontaba todas las notas de la vault
      if (shouldRefreshTree(rels, (rel) => !!s.notes[rel] && wasJustWritten(rel))) s.refreshTree();
      for (const rel of rels) {
        // Our own save comes back as a file event: re-reading it would rebuild the
        // editor with what it already shows.
        if (s.notes[rel] && !wasJustWritten(rel)) void s.reload(rel);
      }
      const canvas = useCanvas.getState();
      if (canvas.path && rels.includes(canvas.path)) void canvas.reload();
    };

    const off = api.onWatchEvent((ev) => {
      if (ev?.relPath) changed.add(ev.relPath);
      const now = Date.now();
      if (!first) first = now;
      if (quiet !== null) window.clearTimeout(quiet);
      quiet = window.setTimeout(flush, now - first >= WATCH_MAX_MS ? 0 : WATCH_QUIET_MS);
    });
    return () => {
      off();
      if (quiet !== null) window.clearTimeout(quiet);
    };
  }, []);
}

/** Cambios en la vault hechos fuera de la app (un agente, git…): lo que depende del contenido —temas, cobertura, plan— se vuelve a leer SOLO, sin reindexar ni cerrar pestañas. */
function useVaultContentListener(): void {
  useEffect(() => {
    return api.onVaultContentChanged(() => {
      // import dinámico: estos almacenes viven en módulos pesados que no deben entrar en el arranque
      void import("./store/studyVersion").then((m) => m.useStudyVersion.getState().bump());
      void import("./store/mentor").then((m) => m.useMentor.setState((st) => ({ planVersion: st.planVersion + 1 })));
      void import("./store/curriculum").then((m) => {
        if (m.useCurriculum.getState().loaded) void m.useCurriculum.getState().refresh();
      });
    });
  }, []);
}

export function App() {
  const init = useApp((s) => s.init);
  // The view to show is driven by the active tab's module id.
  const module = useApp((s) => s.module);
  const sideModule = useApp((s) => s.sideModule);
  const rightPanelOpen = useApp((s) => s.rightPanelOpen);

  const draggingTabId = useTabDrag((s) => s.draggingTabId);
  const [dropReady, setDropReady] = useState(false);
  useNavigationGuard();
  useShortcuts();
  useTaskReminders();
  useFileWatcherListener();
  useVaultContentListener();
  // Clicking a review notification opens the Repaso calendar.
  useEffect(() => api.onOpenReview(() => useReviewCalendar.getState().set(true)), []);
  // Screenshots: the global shortcut and the "saved" toast.
  useEffect(() => listenForCaptures(), []);
  useWindowNoteParam();
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div
        className="relative flex min-h-0 flex-1"
        // Arrastrar una pestaña fuera de la barra también divide: soltarla aquí
        // la manda al panel derecho.
        onDragOver={(e) => {
          if (!draggingTabId) return;
          e.preventDefault();
          setDropReady(true);
        }}
        onDragLeave={() => setDropReady(false)}
        onDrop={(e) => {
          const draggedId = e.dataTransfer.getData(TAB_MIME) || draggingTabId;
          setDropReady(false);
          useTabDrag.getState().drag(null);
          if (draggedId) useApp.getState().splitTab(draggedId, null, "right");
        }}
      >
        <IconRail />
        {/* Every visited functionality stays mounted: its sub-tab, its scroll and
            its forms survive a tab switch (see ModuleHost). */}
        <ModuleHost module={module} render={renderModule} />
        {/* El panel derecho de las funcionalidades que no son notas: la pestaña
            que se soltó a la derecha, con su propia cabecera. */}
        {sideModule && (
          <section
            aria-label="Panel derecho"
            className="flex min-w-0 flex-1 flex-col border-l border-line-strong bg-surface"
          >
            <header className="flex h-9 flex-none items-center gap-2 border-b border-line bg-panel px-3">
              <span className="truncate text-[12.5px] font-semibold text-text">
                {MODULE_LABELS.find((m) => m.id === sideModule)?.label ?? sideModule}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                title="Cerrar panel derecho"
                aria-label="Cerrar panel derecho"
                onClick={() => useApp.getState().setSideModule(null)}
                className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-text"
              >
                <X size={13} />
              </button>
            </header>
            <div className="flex min-h-0 flex-1">{renderModule(sideModule)}</div>
          </section>
        )}
        {/* Una sola columna derecha en toda la app: la tira de lanzadores o la
            cara que sus botones abran. */}
        {rightPanelOpen && <RightPanel module={module} />}
        {dropReady && draggingTabId && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 border-l-2 border-accent bg-accent-soft/20" aria-hidden="true" />
        )}
      </div>
      <StatusBar />
      <QuickSwitcher />
      <CommandPalette />
      <ShortcutsDialog />
      <ReviewCalendar />
      <VaultDialog />
      <SettingsDialog />
      <PomodoroTicker />
      <PomodoroAssessmentModal />
      <AiSettingsDialog />
      <DialogHost />
      <MenuHost />
      <Toasts />
      <SupportNotice />
      <MiniPlayer />
    </div>
  );
}
