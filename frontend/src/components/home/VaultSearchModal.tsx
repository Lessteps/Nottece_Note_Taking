import {
  Apple,
  CheckCircle2,
  FileText,
  Flag,
  Folder,
  Search,
  SquareCheck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import type { IndexEntry, HomeOverview } from "../../lib/types";
import { useApp } from "../../store/app";
import { cn } from "../ui";

export type SearchCategory =
  | "all"
  | "notes"
  | "tasks"
  | "habits"
  | "food"
  | "finance"
  | "goals";

export interface SearchItem {
  id: string;
  category: "notes" | "tasks" | "habits" | "food" | "finance" | "goals";
  categoryLabel: string;
  title: string;
  subtitle: string;
  icon: typeof FileText;
  iconColor?: string;
  path?: string;
  sectionId?: string;
  extraAction?: () => void;
}

const COMMON_FOODS = [
  { name: "Pechuga de Pollo 150g", cals: "248 kcal", macros: "P 46g · C 0g · F 5g" },
  { name: "Huevos Revueltos (3 enteros)", cals: "215 kcal", macros: "P 18g · C 1g · F 15g" },
  { name: "Avena con Plátano y Chía", cals: "320 kcal", macros: "P 10g · C 58g · F 6g" },
  { name: "Arroz Integral con Atún", cals: "380 kcal", macros: "P 32g · C 45g · F 7g" },
  { name: "Salmón a la Plancha 180g", cals: "360 kcal", macros: "P 36g · C 0g · F 22g" },
  { name: "Yogur Griego 0% con Frutos Rojos", cals: "160 kcal", macros: "P 18g · C 15g · F 0g" },
  { name: "Batido de Proteína Whey + Creatina", cals: "150 kcal", macros: "P 26g · C 3g · F 2g" },
  { name: "Aguacate entero mediano", cals: "240 kcal", macros: "P 3g · C 12g · F 22g" },
  { name: "Manzana verde / roja", cals: "95 kcal", macros: "P 0g · C 25g · F 0g" },
  { name: "Almendras crudas (30g)", cals: "175 kcal", macros: "P 6g · C 6g · F 15g" },
];

export interface VaultSearchModalProps {
  open: boolean;
  onClose: () => void;
  data: HomeOverview | null;
  onScrollToSection: (sectionId: string) => void;
  onOpenFoodModal?: (mealName: string) => void;
}

export function VaultSearchModal({
  open,
  onClose,
  data,
  onScrollToSection,
  onOpenFoodModal,
}: VaultSearchModalProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notesIndex, setNotesIndex] = useState<IndexEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    api.noteIndex().then(setNotesIndex).catch(() => setNotesIndex([]));
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  // Aggregate searchable items
  const allItems: SearchItem[] = useMemo(() => {
    const list: SearchItem[] = [];

    // 1. Notes
    for (const n of notesIndex) {
      list.push({
        id: `note-${n.path}`,
        category: "notes",
        categoryLabel: "Nota",
        title: n.title || n.path.split("/").pop() || n.path,
        subtitle: n.path,
        icon: FileText,
        iconColor: "text-accent",
        path: n.path,
      });
    }

    if (data) {
      // 2. Tasks
      for (const t of data.tasks.today) {
        list.push({
          id: `task-${t.id}`,
          category: "tasks",
          categoryLabel: "Tarea",
          title: t.name,
          subtitle: `Hoy · ${t.subject || "General"} · Prioridad ${t.priority || 1}`,
          icon: SquareCheck,
          iconColor: "text-blue-400",
          sectionId: "tareas-section",
        });
      }
      for (const t of data.tasks.overdue) {
        list.push({
          id: `task-ov-${t.id}`,
          category: "tasks",
          categoryLabel: "Tarea Atrasada",
          title: t.name,
          subtitle: `Atrasada: ${t.due || "Pendiente"} · ${t.subject || ""}`,
          icon: SquareCheck,
          iconColor: "text-red-400",
          sectionId: "tareas-section",
        });
      }

      // 3. Habits
      for (const h of data.habits) {
        list.push({
          id: `habit-${h.id}`,
          category: "habits",
          categoryLabel: "Hábito",
          title: `${h.icon ? `${h.icon} ` : ""}${h.name}`,
          subtitle: h.done ? "Completado hoy ✓" : "Pendiente para hoy",
          icon: CheckCircle2,
          iconColor: h.done ? "text-emerald-400" : "text-accent",
          sectionId: "habits-section",
        });
      }

      // 4. Projects & Goals
      for (const p of data.projects.active) {
        list.push({
          id: `proj-${p.id}`,
          category: "goals",
          categoryLabel: "Proyecto",
          title: `${p.icon ? `${p.icon} ` : ""}${p.name}`,
          subtitle: `Progreso: ${Math.round((p.progress || 0) * 100)}%`,
          icon: Folder,
          iconColor: "text-accent",
          sectionId: "proyectos-section",
        });
      }
      for (const g of data.goals.list) {
        list.push({
          id: `goal-${g.id}`,
          category: "goals",
          categoryLabel: "Objetivo OKR",
          title: `${g.icon ? `${g.icon} ` : ""}${g.name}`,
          subtitle: `Meta activa · ${Math.round(g.progress * 100)}% completado`,
          icon: Flag,
          iconColor: "text-amber-400",
          sectionId: "metas-section",
        });
      }

      // 5. Finance
      list.push(
        {
          id: "fin-balance",
          category: "finance",
          categoryLabel: "Finanzas",
          title: "Balance Total & Ahorro Mensual",
          subtitle: `Balance: $${data.finance.month.balance.toLocaleString()} · Ahorro: $${data.finance.month.ahorro.toLocaleString()}`,
          icon: Wallet,
          iconColor: "text-emerald-400",
          sectionId: "finanzas-section",
        },
        {
          id: "fin-japon",
          category: "finance",
          categoryLabel: "Meta de Ahorro",
          title: "Viaje a Japón 2027",
          subtitle: "Meta $3,500 / $5,000 acumulado (70%)",
          icon: Wallet,
          iconColor: "text-accent",
          sectionId: "finanzas-section",
        },
        {
          id: "fin-emergencia",
          category: "finance",
          categoryLabel: "Meta de Ahorro",
          title: "Fondo de Emergencia",
          subtitle: "Meta $6,000 / $6,000 acumulado (100% completado)",
          icon: Wallet,
          iconColor: "text-emerald-400",
          sectionId: "finanzas-section",
        }
      );
    }

    // 6. Food Catalog
    for (const f of COMMON_FOODS) {
      list.push({
        id: `food-${f.name}`,
        category: "food",
        categoryLabel: "Alimento",
        title: f.name,
        subtitle: `${f.cals} · ${f.macros}`,
        icon: Apple,
        iconColor: "text-rose-400",
        sectionId: "alimentacion-section",
        extraAction: () => {
          onScrollToSection("alimentacion-section");
          onOpenFoodModal?.("Desayuno");
        },
      });
    }

    return list;
  }, [notesIndex, data, onScrollToSection, onOpenFoodModal]);

  // Filter items
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q)
      );
    });
  }, [allItems, query, category]);

  const selectItem = (item: SearchItem) => {
    onClose();
    if (item.extraAction) {
      item.extraAction();
      return;
    }
    if (item.path) {
      void useApp.getState().openNote(item.path);
      return;
    }
    if (item.sectionId) {
      onScrollToSection(item.sectionId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filtered.length - 1) : prev - 1
      );
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      selectItem(filtered[selectedIndex]!);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[10vh] backdrop-blur-xs animate-in fade-in duration-150"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-[#2e2e34] bg-[#1a1a1e] shadow-2xl transition-all"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 bg-panel">
          <Search size={18} className="text-accent shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Buscar notas, tareas, hábitos, alimentos, proyectos o finanzas..."
            className="w-full bg-transparent text-sm text-text placeholder-faint focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="text-faint hover:text-text transition"
            >
              <X size={15} />
            </button>
          )}
          <span className="rounded border border-line-strong bg-card px-1.5 py-0.5 font-mono text-[10px] text-faint">
            ESC
          </span>
        </div>

        {/* Filter Categories Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 bg-surface text-xs">
          {(
            [
              ["all", "Todos"],
              ["notes", "Notas"],
              ["tasks", "Tareas"],
              ["habits", "Hábitos"],
              ["food", "Alimentación"],
              ["finance", "Finanzas"],
              ["goals", "Proyectos & Metas"],
            ] as const
          ).map(([cat, label]) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategory(cat);
                  setSelectedIndex(0);
                }}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 font-medium transition",
                  active
                    ? "border border-accent/40 bg-accent-soft text-text shadow-xs"
                    : "text-dim hover:bg-hover hover:text-text"
                )}
              >
                {label}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-faint">
              No se encontraron elementos para «{query}». Prueba otra búsqueda o categoría.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => selectItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition text-left",
                    isSelected
                      ? "border border-accent/40 bg-accent-soft text-text"
                      : "text-dim hover:bg-hover hover:text-text"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 flex-none items-center justify-center rounded-md border border-line-strong bg-card",
                      item.iconColor
                    )}
                  >
                    <Icon size={15} />
                  </div>

                  <div className="min-w-0 flex-1 truncate">
                    <div className="truncate text-[13px] font-medium text-text">
                      {item.title}
                    </div>
                    <div className="truncate font-mono text-[11px] text-faint">
                      {item.subtitle}
                    </div>
                  </div>

                  <span className="flex-none rounded border border-accent/30 bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent-text">
                    {item.categoryLabel}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-line bg-panel px-4 py-2 font-mono text-[11px] text-faint">
          <div className="flex items-center gap-3">
            <span>↑↓ Navegar</span>
            <span>↵ Abrir o ir a sección</span>
          </div>
          <span className="text-accent-text">Vault Antigravity Search</span>
        </div>
      </div>
    </div>
  );
}

