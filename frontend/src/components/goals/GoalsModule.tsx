import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Plus, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/bridge";
import { useApp } from "../../store/app";
import { useGoals } from "../../store/goals";
import { GhostButton, PrimaryButton } from "../common/forms";
import { cn, openMenu } from "../ui";
import { AreaDialog, ChecklistDialog, GoalDialog } from "./GoalDialogs";
import { GoalsBoard } from "./GoalsBoard";
import { GoalView } from "./GoalView";
import { TodayList } from "./TodayList";

const FILTERS: Array<[string, string]> = [["todas", "Todas"], ["activas", "Activas"], ["pausa", "En pausa"], ["completadas", "Completadas"], ["vencidas", "Vencidas"], ["archivadas", "Archivadas"]];

function NavItem({ active, onClick, icon, label, count, colour, onContextMenu, collapsed }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; colour?: string;
  onContextMenu?: (e: React.MouseEvent) => void; collapsed?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} onContextMenu={onContextMenu} title={collapsed ? label : undefined}
      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]", active ? "bg-accent-soft text-text" : "text-dim hover:bg-hover", collapsed && "justify-center")}>
      <span className="w-4 text-center shrink-0" style={{ color: colour }}>{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && count ? <span className="font-mono text-[10.5px] text-faint">{count}</span> : null}
    </button>
  );
}

const Section = ({ children }: { children: string }) => (
  <div className="mb-1 mt-3 px-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">{children}</div>
);

export function GoalsModule() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("nv.sidebar.goals.collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("nv.sidebar.goals.collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const view = useGoals((s) => s.view);
  const setView = useGoals((s) => s.setView);
  const area = useGoals((s) => s.area);
  const setArea = useGoals((s) => s.setArea);
  const filter = useGoals((s) => s.filter);
  const setFilter = useGoals((s) => s.setFilter);
  const sidebar = useGoals((s) => s.sidebar);
  const areas = useGoals((s) => s.areas);
  const loaded = useGoals((s) => s.loaded);
  const loadAll = useGoals((s) => s.loadAll);
  const openId = useGoals((s) => s.openId);
  const setEditing = useGoals((s) => s.setEditing);
  const setAreaEditing = useGoals((s) => s.setAreaEditing);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    void loadAll();
    if (useGoals.getState().openId) void useGoals.getState().reload();
  }, [loadAll]);

  const board = view === "tablero" && !openId;
  return (
    <div className="flex min-w-0 flex-1">
      <aside className={cn(
        "flex flex-none flex-col border-r border-line bg-panel transition-all duration-200",
        collapsed ? "w-16" : "w-[240px]"
      )}>
          <div className="flex h-10 flex-none items-center border-b border-line px-3">
            {!collapsed && (
              <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint truncate">
                Metas
              </span>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
              aria-expanded={!collapsed}
              title={collapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text cursor-pointer",
                collapsed ? "mx-auto" : "ml-auto"
              )}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>
          {!collapsed && (
            <div className="flex gap-1.5 p-3">
              <PrimaryButton onClick={() => setEditing("")} className="flex-1 justify-center"><Plus size={14} /> Nueva meta</PrimaryButton>
              <GhostButton onClick={() => setAreaEditing("")}>+ Área</GhostButton>
            </div>
          )}
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!collapsed && <Section>Vistas</Section>}
            <NavItem collapsed={collapsed} active={board} onClick={() => { setView("tablero"); void loadAll(); }} icon={<LayoutGrid size={14} />} label="Tablero" />
            <NavItem collapsed={collapsed} active={view === "hoy" && !openId} onClick={() => setView("hoy")} icon={<Sun size={14} />} label="Hoy" count={sidebar?.today} />
            <NavItem collapsed={collapsed} active={false} onClick={() => useApp.getState().setModule("calendario")} icon={<CalendarDays size={14} />} label="Calendario" />
            {!collapsed && (
              <>
                <Section>Áreas</Section>
                <NavItem active={area === "*"} onClick={() => setArea("*")} icon="◎" label="Todas" count={sidebar?.all} />
                {areas.map((a) => (
                  <NavItem key={a.id} active={area === a.id} onClick={() => setArea(a.id)} icon={a.icon || "●"} colour={a.colour} label={a.name}
                    count={sidebar?.areas[a.id]}
                    onContextMenu={(e) => openMenu(e, [
                      { label: "Editar área…", onSelect: () => setAreaEditing(a.id) },
                      { label: "Archivar", danger: true, onSelect: () => void api.areasArchive(a.id).then(loadAll).catch((err) => toast("error", (err as Error).message)) },
                    ])} />
                ))}
                <NavItem active={area === ""} onClick={() => setArea("")} icon="○" label="Sin área" count={sidebar?.no_area} />
                {loaded && !areas.length && (
                  <GhostButton className="mt-1 w-full justify-center" onClick={() => void api.areasCreateSuggested().then(loadAll).catch((e) => toast("error", (e as Error).message))}>
                    Crear áreas sugeridas
                  </GhostButton>
                )}
                <Section>Estado</Section>
                {FILTERS.map(([k, l]) => (
                  <NavItem key={k} active={filter === k} onClick={() => setFilter(k)} icon="" label={l} count={sidebar?.filters[k]} />
                ))}
              </>
            )}
          </nav>
        </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {!loaded ? <div className="grid flex-1 place-items-center text-[13px] text-faint">Cargando metas…</div>
          : openId ? <GoalView />
            : view === "hoy" ? <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4"><TodayList /></div>
              : <GoalsBoard />}
      </main>
      <GoalDialog />
      <ChecklistDialog />
      <AreaDialog />
    </div>
  );
}
