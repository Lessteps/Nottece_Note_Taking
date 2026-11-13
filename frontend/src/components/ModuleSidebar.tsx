// The left column every module uses: a title and a list of views.

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./ui";
import { useApp } from "../store/app";

export interface SidebarItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  badge?: string | number;
  badgeTone?: "accent" | "danger";
  /** sub-vistas anidadas bajo este ítem (p. ej. una por plan del Mentor): crecen o decrecen con los datos */
  subItems?: SidebarItem[];
  /** Las sub-vistas aparecen al desplegar este ítem. */
  expandable?: boolean;
  /** rótulo de sección que se pinta justo encima de este ítem (p. ej. «PLANIFICACIÓN», «MÁS») */
  sectionLabel?: string;
}

export function ModuleSidebar({
  title, items, active, onSelect, children, footer,
  collapsible, collapsed, onToggleCollapsed,
}: {
  title: string;
  items: SidebarItem[];
  active: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
  footer?: ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  // El botón «Panel lateral» de la barra de título (Ctrl+\) pliega la columna de CUALQUIER módulo, no solo el explorador de Notas:
  // así, en una ventana estrecha, el contenido recupera el ancho.
  const open = useApp((s) => s.explorerOpen);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isCollapsed = collapsible === true && collapsed === true;
  if (!open) return null;
  return (
    <aside className={isCollapsed
      ? "flex w-16 flex-none flex-col border-r border-line bg-panel"
      : "flex w-[260px] flex-none flex-col border-r border-line bg-panel"}>
      <div className="flex h-10 flex-none items-center border-b border-line px-4">
        {!isCollapsed && (
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">{title}</span>
        )}
        {collapsible === true && (
          <button
            type="button"
            onClick={() => onToggleCollapsed?.()}
            aria-label={isCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text",
              isCollapsed ? "mx-auto" : "ml-auto",
            )}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>
      <nav aria-label={title} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
        {items.map((it) => (
          <div key={it.id} className="flex flex-col gap-0.5">
            {!isCollapsed && it.sectionLabel && <p className="mt-2 px-2.5 pb-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint first:mt-0" data-testid={`nav-section-${it.id}`}>{it.sectionLabel}</p>}
            <SidebarButton it={it} active={active === it.id} onSelect={(id) => { onSelect(id); if (it.expandable) setExpanded((s) => ({ ...s, [id]: !(s[id] ?? !!it.subItems?.some((sub) => sub.id === active)) })); }} collapsed={isCollapsed} expanded={it.expandable ? (expanded[it.id] ?? !!it.subItems?.some((sub) => sub.id === active)) : undefined} />
            {!isCollapsed && it.subItems && it.subItems.length > 0 && (!it.expandable || (expanded[it.id] ?? !!it.subItems?.some((sub) => sub.id === active))) && (
              <div className="ml-4 flex flex-col gap-0.5 border-l border-line pl-1.5" role="group" aria-label={`${it.label}: sub-vistas`}>
                {it.subItems.map((sub) => (
                  <SidebarButton key={sub.id} it={sub} active={active === sub.id} onSelect={onSelect} sub />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </aside>
  );
}

function SidebarButton({ it, active, onSelect, sub, collapsed, expanded }: { it: SidebarItem; active: boolean; onSelect: (id: string) => void; sub?: boolean; collapsed?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(it.id)}
      data-testid={`nav-${it.id}`}
      aria-current={active ? "page" : undefined}
      aria-expanded={expanded}
      title={collapsed ? it.label : sub ? it.hint : undefined}
      aria-label={collapsed ? it.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg text-left transition-colors",
        collapsed && "justify-center",
        sub ? "px-2 py-1.5" : "px-2.5 py-2",
        active ? "bg-accent-soft text-text" : "text-dim hover:bg-hover hover:text-text",
      )}
    >
      <span className={cn("flex-none [&>svg]:h-4 [&>svg]:w-4", sub && "[&>svg]:h-3.5 [&>svg]:w-3.5", active && "text-accent-text")}>{it.icon}</span>
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate", sub ? "text-[12.5px]" : "text-[13px]")}>{it.label}</span>
          {it.hint && <span className="block truncate text-[11px] text-faint">{it.hint}</span>}
        </span>
      )}
      {!collapsed && expanded !== undefined && (expanded ? <ChevronLeft size={14} className="-rotate-90" aria-hidden /> : <ChevronRight size={14} aria-hidden />)}
      {!collapsed && it.badge !== undefined && it.badge !== "" && it.badge !== 0 && (
        <span className={cn("rounded-md px-1.5 font-mono text-[10.5px]", it.badgeTone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-text")}>{it.badge}</span>
      )}
    </button>
  );
}
