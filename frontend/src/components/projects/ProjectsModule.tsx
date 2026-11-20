import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjects } from "../../store/projects";
import { PrimaryButton } from "../common/forms";
import { cn } from "../ui";
import { CreateIssueDialog, ProjectDialog } from "./ProjectDialogs";
import { ProjectsBoard } from "./ProjectsBoard";
import { ProjectView } from "./ProjectView";

export function ProjectsModule() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("nv.sidebar.projects.collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("nv.sidebar.projects.collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const cards = useProjects((s) => s.cards);
  const meta = useProjects((s) => s.meta);
  const openId = useProjects((s) => s.openId);
  const open = useProjects((s) => s.open);
  const loadAll = useProjects((s) => s.loadAll);
  const loaded = useProjects((s) => s.loaded);
  const setEditing = useProjects((s) => s.setEditing);

  useEffect(() => {
    void loadAll();
    if (useProjects.getState().openId) void useProjects.getState().reload();
  }, [loadAll]);

  return (
    <div className="flex min-w-0 flex-1">
      <aside className={cn(
        "flex flex-none flex-col border-r border-line bg-panel transition-all duration-200",
        collapsed ? "w-16" : "w-[240px]"
      )}>
          <div className="flex h-10 flex-none items-center border-b border-line px-3">
            {!collapsed && (
              <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint truncate">
                Proyectos
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
            <div className="p-3">
              <PrimaryButton onClick={() => setEditing("")} className="w-full justify-center"><Plus size={14} /> Nuevo proyecto</PrimaryButton>
            </div>
          )}
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!collapsed && <div className="mb-1 px-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">Proyectos</div>}
            <button type="button" onClick={() => void open(null)} title={collapsed ? "Tablero" : undefined}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]", !openId ? "bg-accent-soft text-text" : "text-dim hover:bg-hover", collapsed && "justify-center")}>
              <LayoutGrid size={15} className={!openId ? "text-accent-text" : ""} />
              {!collapsed && <span>Tablero</span>}
              {!collapsed && <span className="ml-auto font-mono text-[10.5px] text-faint">{cards.length || ""}</span>}
            </button>
            {!collapsed && (meta?.statuses ?? []).map((st) => {
              const group = cards.filter((p) => p.status === st);
              if (!group.length) return null;
              return (
                <div key={st} className="mt-3">
                  <div className="mb-1 px-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">{st}</div>
                  {group.map((p) => (
                    <button key={p.id} type="button" onClick={() => void open(p.id)} title={`${p.key} · ${p.name} — ${p.status}${p.summary.overdue ? " · con vencidas" : ""}`}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]", openId === p.id ? "bg-accent-soft text-text" : "text-dim hover:bg-hover")}>
                      {p.icon ? <span className="w-4 text-center">{p.icon}</span> : <span className="mx-1 h-2 w-2 rounded-full" style={{ background: p.colour }} />}
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.summary.total > 0 && <span className={cn("font-mono text-[10.5px]", p.summary.overdue ? "text-danger" : "text-faint")}>{p.summary.done}/{p.summary.total}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
            {!collapsed && loaded && !cards.length && <p className="px-2 pt-2 text-[11.5px] text-faint">Sin proyectos todavía</p>}
          </nav>
        </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {!loaded ? <div className="grid flex-1 place-items-center text-[13px] text-faint">Cargando proyectos…</div>
          : openId ? <ProjectView /> : <ProjectsBoard />}
      </main>
      <ProjectDialog />
      <CreateIssueDialog />
    </div>
  );
}
