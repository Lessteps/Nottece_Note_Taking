// Diaria: Notion-style structured daily habit tracker, interactive consistency heatmap, and reflection journal.

import {
  ArrowDownUp,
  BookOpen,
  Calendar,
  CalendarCheck,
  CheckCheck,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Filter,
  Flame,
  LayoutGrid,
  Lightbulb,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "../../lib/habits";
import { shortDate, todayIso } from "../../lib/tasks";
import { clearPending, markPending, useApp } from "../../store/app";
import { useCalendar } from "../../store/calendar";
import { useHabits } from "../../store/habits";
import type { Habit } from "../../lib/types";
import { cn, IconButton } from "../ui";
import { GymExercisesList } from "./GymExercisesList";
import { HabitEditModal } from "./HabitEditModal";
import { HabitHeatmap } from "./HabitHeatmap";
import { HabitCheck } from "./parts";

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type ViewTab = "list" | "timeline" | "category";
type FilterOption = "all" | "pending" | "completed";
type SortOption = "time" | "name" | "status";

export function HabitDaily() {
  const day = useHabits((s) => s.day);
  const setDay = useHabits((s) => s.setDay);
  const log = useHabits((s) => s.log);
  const habits = useHabits((s) => s.habits);
  const setDone = useHabits((s) => s.setDone);
  const setSubtask = useHabits((s) => s.setSubtask);
  const update = useHabits((s) => s.update);
  const add = useHabits((s) => s.add);
  const setDayText = useHabits((s) => s.setDayText);

  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [gymExpanded, setGymExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("list");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [sortBy, setSortBy] = useState<SortOption>("time");
  const [energyLevel, setEnergyLevel] = useState<string>("Normal");
  const [saveStatus, setSaveStatus] = useState<string>("Autoguardado");

  // Local state for notes and journal text with debounced auto-save
  const [notes, setNotes] = useState("");
  const [journal, setJournal] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const date = log?.date;

  useEffect(() => {
    setNotes(log?.notes ?? "");
    setJournal(log?.journal ?? "");
  }, [date]);

  const pendingText = useRef<[string, string, string] | null>(null);
  const flushText = async () => {
    window.clearTimeout(timer.current);
    const p = pendingText.current;
    pendingText.current = null;
    clearPending("habit-day");
    if (p) {
      await setDayText(p[0], p[1], p[2]);
      setSaveStatus("Guardado ✓");
      setTimeout(() => setSaveStatus("Autoguardado"), 2000);
    }
  };

  const handleSaveText = (n: string, j: string) => {
    if (!date) return;
    setSaveStatus("Guardando...");
    pendingText.current = [date, n, j];
    markPending("habit-day", flushText);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushText(), 700);
  };

  useEffect(() => () => void flushText(), [date]);

  const weekday = WEEKDAY_NAMES[new Date(`${day}T12:00:00`).getDay()] ?? "hoy";
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  const active = useMemo(
    () => habits.filter((h) => log?.active.includes(h.id)),
    [habits, log?.active],
  );
  const rest = useMemo(
    () => habits.filter((h) => !log?.active.includes(h.id)),
    [habits, log?.active],
  );
  const doneCount = active.filter((h) => log?.completed[h.id]).length;
  const progressPct = active.length > 0 ? Math.round((doneCount / active.length) * 100) : 0;
  const allCompleted = active.length > 0 && doneCount === active.length;

  // Filter & sort habits
  const displayedHabits = useMemo(() => {
    let list = [...active];
    if (filter === "pending") {
      list = list.filter((h) => !log?.completed[h.id]);
    } else if (filter === "completed") {
      list = list.filter((h) => Boolean(log?.completed[h.id]));
    }

    if (sortBy === "time") {
      list.sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });
    } else if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "status") {
      list.sort((a, b) => {
        const aDone = Boolean(log?.completed[a.id]);
        const bDone = Boolean(log?.completed[b.id]);
        if (aDone === bDone) return 0;
        return aDone ? 1 : -1;
      });
    }
    return list;
  }, [active, filter, sortBy, log?.completed]);

  // Group by category/area for category view
  const categorizedHabits = useMemo(() => {
    const groups: Record<string, Habit[]> = {};
    displayedHabits.forEach((h) => {
      const area = h.area || "General";
      if (!groups[area]) groups[area] = [];
      groups[area]!.push(h);
    });
    return groups;
  }, [displayedHabits]);

  const handleToggleAll = async () => {
    const targetState = !allCompleted;
    for (const h of active) {
      if (Boolean(log?.completed[h.id]) !== targetState) {
        await setDone(day, h.id, targetState);
      }
    }
  };

  const handleAddNewHabit = async () => {
    const newHabit = await add({ name: "Nuevo hábito" });
    if (newHabit) {
      setEditingHabitId(newHabit.id);
    }
  };

  const insertSnippet = (snippet: string) => {
    setNotes((prev) => {
      const updated = prev ? `${prev}\n${snippet}` : snippet;
      handleSaveText(updated, journal);
      return updated;
    });
  };

  const editingHabit = habits.find((h) => h.id === editingHabitId);
  const notesWordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-dark-surface text-dark-on-surface overflow-hidden">
      {/* NOTION TOPBAR: Breadcrumb + Date Navigator */}
      <header className="h-14 px-6 md:px-8 border-b border-border-subtle flex items-center justify-between flex-shrink-0 sticky top-0 bg-dark-surface/95 backdrop-blur-sm z-20 w-full">
        <div className="flex items-center gap-2 text-body-sm">
          <span className="text-dark-on-surface-variant hover:text-dark-on-surface cursor-pointer font-medium">
            Hábitos
          </span>
          <span className="text-dark-on-surface-variant/40">/</span>
          <span className="font-semibold text-white flex items-center gap-1.5">
            <CheckCircle2 size={16} className="text-accent" />
            Registro Diario
          </span>
        </div>

        {/* Date picker controls */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-dark-surface-variant border border-border-subtle rounded-md p-0.5">
            <button
              type="button"
              aria-label="Día anterior"
              onClick={() => void setDay(addDays(day, -1))}
              className="p-1 text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface rounded transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="px-2.5 py-0.5 text-body-sm font-medium flex items-center gap-2 text-dark-on-surface">
              <Calendar size={15} className="text-dark-on-surface-variant" />
              <span className="font-headline font-semibold text-white">
                {capitalizedWeekday} {shortDate(day)}
              </span>
            </div>
            <button
              type="button"
              aria-label="Día siguiente"
              onClick={() => void setDay(addDays(day, 1))}
              className="p-1 text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface rounded transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void setDay(todayIso())}
            className="px-2.5 py-1 text-label-md font-label border border-border-subtle hover:border-border-strong rounded bg-dark-surface-variant text-dark-on-surface hover:text-white transition-colors cursor-pointer"
          >
            Hoy
          </button>

          <button
            type="button"
            title="Ver este día en el calendario"
            onClick={() => {
              useCalendar.getState().setDay(day);
              useApp.getState().setModule("calendario");
            }}
            className="flex items-center gap-1.5 px-3 py-1 text-label-md font-label border border-border-subtle hover:border-border-strong rounded bg-dark-surface-variant text-dark-on-surface hover:text-white transition-colors cursor-pointer"
          >
            <CalendarCheck size={14} className="text-dark-on-surface-variant" />
            <span>Ver en calendario</span>
          </button>

          <div className="w-px h-5 bg-border-subtle hidden sm:block" />

          <button
            type="button"
            aria-label="Opciones de página"
            title="Opciones"
            className="p-1.5 text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface-variant rounded transition-colors cursor-pointer"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </header>

      {/* NOTION MAIN BODY (Full width, responsive) */}
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 w-full space-y-6">
        {/* Page Title & Notion Database Header */}
        <section className="flex flex-col gap-3 border-b border-border-subtle pb-5 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-dark-surface-variant border border-border-subtle flex items-center justify-center text-accent shadow-xs flex-shrink-0">
              <CheckSquare size={22} className="text-accent" />
            </div>
            <div>
              <h1 className="font-headline text-headline-lg font-bold text-white tracking-tight">
                Diaria
              </h1>
              <p className="text-body-sm text-dark-on-surface-variant mt-0.5">
                Seguimiento estructurado de hábitos y notas de reflexión para hoy.
              </p>
            </div>
          </div>

          {/* Notion Database Properties Bar */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-dark-surface-variant/40 border border-border-subtle rounded-md p-3.5 w-full">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-dark-on-surface-variant flex-shrink-0" />
              <span className="text-label-sm text-dark-on-surface-variant">Fecha:</span>
              <span className="text-body-sm font-medium text-dark-on-surface font-code truncate">
                {shortDate(day)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Flame size={15} className="text-warning flex-shrink-0" />
              <span className="text-label-sm text-dark-on-surface-variant">Progreso:</span>
              <span className="text-body-sm font-medium text-dark-on-surface font-code">
                {doneCount} / {active.length} ({progressPct}%)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Zap size={15} className="text-accent flex-shrink-0" />
              <span className="text-label-sm text-dark-on-surface-variant">Estado:</span>
              <span
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border",
                  allCompleted
                    ? "bg-success/15 border-success/30 text-success"
                    : doneCount > 0
                      ? "bg-accent-subtle border-accent/30 text-accent font-semibold"
                      : "bg-dark-surface border-border-subtle text-dark-on-surface-variant",
                )}
              >
                {allCompleted ? "Completado ✓" : doneCount > 0 ? "En progreso" : "Pendiente"}
              </span>
            </div>

            <div className="flex items-center justify-start sm:justify-end gap-2">
              <button
                type="button"
                onClick={handleToggleAll}
                disabled={active.length === 0}
                className="text-label-sm font-label text-accent hover:text-accent/80 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <CheckCheck size={16} />
                <span>{allCompleted ? "Desmarcar todos" : "Marcar todos"}</span>
              </button>
            </div>
          </div>

          {/* Database Views Bar */}
          <div className="flex flex-wrap items-center justify-between pt-2 gap-3">
            {/* View tabs */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("list")}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-sm font-label text-label-md transition-colors cursor-pointer",
                  activeTab === "list"
                    ? "border-b-2 border-accent text-white bg-accent-subtle/40 font-semibold"
                    : "border-b-2 border-transparent text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface-variant",
                )}
              >
                <CheckSquare size={15} className={activeTab === "list" ? "text-accent" : ""} />
                <span>Lista de Hábitos</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-code bg-dark-surface text-dark-on-surface-variant">
                  {active.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("timeline")}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-sm font-label text-label-md transition-colors cursor-pointer",
                  activeTab === "timeline"
                    ? "border-b-2 border-accent text-white bg-accent-subtle/40 font-semibold"
                    : "border-b-2 border-transparent text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface-variant",
                )}
              >
                <Zap size={15} className={activeTab === "timeline" ? "text-accent" : ""} />
                <span>Línea de tiempo</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("category")}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-sm font-label text-label-md transition-colors cursor-pointer",
                  activeTab === "category"
                    ? "border-b-2 border-accent text-white bg-accent-subtle/40 font-semibold"
                    : "border-b-2 border-transparent text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface-variant",
                )}
              >
                <LayoutGrid size={15} className={activeTab === "category" ? "text-accent" : ""} />
                <span>Por categoría</span>
              </button>
            </div>

            {/* Filter, Sort & New Habit */}
            <div className="flex items-center gap-2">
              {/* Filter */}
              <div className="relative inline-flex items-center">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as FilterOption)}
                  className="appearance-none bg-dark-surface-variant border border-border-subtle rounded text-label-sm font-label text-dark-on-surface pl-7 pr-6 py-1 hover:border-border-strong cursor-pointer outline-none focus:border-accent"
                  aria-label="Filtrar hábitos"
                >
                  <option value="all">Todos ({active.length})</option>
                  <option value="pending">Pendientes ({active.length - doneCount})</option>
                  <option value="completed">Completados ({doneCount})</option>
                </select>
                <Filter size={13} className="pointer-events-none absolute left-2 text-dark-on-surface-variant" />
                <ChevronDown size={12} className="pointer-events-none absolute right-2 text-dark-on-surface-variant" />
              </div>

              {/* Sort */}
              <div className="relative inline-flex items-center">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="appearance-none bg-dark-surface-variant border border-border-subtle rounded text-label-sm font-label text-dark-on-surface pl-7 pr-6 py-1 hover:border-border-strong cursor-pointer outline-none focus:border-accent"
                  aria-label="Ordenar hábitos"
                >
                  <option value="time">Por hora</option>
                  <option value="name">Por nombre</option>
                  <option value="status">Por estado</option>
                </select>
                <ArrowDownUp size={13} className="pointer-events-none absolute left-2 text-dark-on-surface-variant" />
                <ChevronDown size={12} className="pointer-events-none absolute right-2 text-dark-on-surface-variant" />
              </div>

              <button
                type="button"
                onClick={handleAddNewHabit}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent hover:bg-accent/90 text-white font-label text-label-md transition-colors shadow-xs cursor-pointer"
              >
                <Plus size={15} />
                <span>Nuevo hábito</span>
              </button>
            </div>
          </div>
        </section>

        {/* FULL-WIDTH INTERACTIVE HEATMAP MATRIX (General vs Individual Habit) */}
        <section className="w-full">
          <HabitHeatmap activeDay={day} onSelectDay={(d) => void setDay(d)} />
        </section>

        {/* TWO-COLUMN ADAPTIVE NOTION LAYOUT (Habits Table on left, Journal & Notes on right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">
          {/* LEFT COLUMN: HABITS DATABASE LIST (7 cols) */}
          <section className="lg:col-span-7 flex flex-col gap-3 w-full">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="font-headline text-headline-md text-white font-semibold">
                  Hábitos de hoy
                </span>
                <span className="text-label-sm font-code text-dark-on-surface-variant bg-dark-surface-variant px-2 py-0.5 rounded border border-border-subtle">
                  {doneCount}/{active.length}
                </span>
              </div>
              <span className="text-label-sm text-dark-on-surface-variant font-code">
                {activeTab === "timeline" ? "Orden cronológico" : "Programados por hora"}
              </span>
            </div>

            {/* HABITS LIST ITEMS */}
            <div className="space-y-2 w-full">
              {activeTab === "category" ? (
                // Grouped by Category / Area
                Object.entries(categorizedHabits).map(([cat, catHabits]) => (
                  <div key={cat} className="space-y-1.5">
                    <div className="px-2 pt-2 pb-1 text-label-sm font-semibold uppercase tracking-wider text-dark-on-surface-variant/80 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      <span>{cat}</span>
                      <span className="font-code text-[10.5px] opacity-60">({catHabits.length})</span>
                    </div>
                    {catHabits.map((h) => renderHabitItem(h))}
                  </div>
                ))
              ) : (
                // Regular or Timeline list
                displayedHabits.map((h) => renderHabitItem(h))
              )}

              {displayedHabits.length === 0 && (
                <div className="p-8 text-center rounded-lg border border-border-subtle bg-dark-surface-variant/20 text-dark-on-surface-variant text-body-sm">
                  {filter !== "all"
                    ? `No hay hábitos que coincidan con el filtro "${filter}".`
                    : "Hoy no toca ningún hábito."}
                </div>
              )}

              {/* Add New Habit Row button */}
              <button
                type="button"
                onClick={handleAddNewHabit}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-md border border-dashed border-border-subtle hover:border-border-strong text-dark-on-surface-variant hover:text-dark-on-surface hover:bg-dark-surface-variant/40 transition-colors text-body-sm font-label cursor-pointer"
              >
                <Plus size={16} />
                <span>Añadir nuevo hábito a la lista...</span>
              </button>
            </div>

            {/* HABITS NOT DUE TODAY (REST HABITS) */}
            {rest.length > 0 && (
              <div className="mt-4 rounded-md border border-border-subtle/50 bg-dark-surface-variant/20 p-3.5">
                <div className="mb-2 text-label-sm font-label text-dark-on-surface-variant flex items-center gap-2">
                  <span>No tocan hoy ({rest.length}):</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rest.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      title={`Editar hábito: ${h.name}`}
                      onClick={() => setEditingHabitId(h.id)}
                      className="group inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-dark-surface px-2.5 py-1 text-dark-on-surface-variant transition-colors hover:border-border-strong hover:text-white cursor-pointer text-body-sm"
                    >
                      <span className="text-[13px]">{h.icon || "•"}</span>
                      <span className="truncate max-w-[160px]">{h.name}</span>
                      <Pencil size={11} className="opacity-40 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* RIGHT COLUMN: NOTION JOURNAL & DAILY SCRATCHPAD (5 cols) */}
          <section className="lg:col-span-5 flex flex-col gap-5 w-full">
            {/* Block 1: Notas del día (Quick captures) */}
            <div className="rounded-lg border border-border-subtle bg-dark-surface-variant/50 p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-border-subtle/70 pb-3">
                <div className="flex items-center gap-2">
                  <NotebookPen size={18} className="text-accent" />
                  <h2 className="font-headline text-headline-md text-white font-semibold">
                    Notas del día
                  </h2>
                </div>
                <span className="text-[11px] font-code text-dark-on-surface-variant">
                  {saveStatus}
                </span>
              </div>

              <textarea
                rows={4}
                value={notes}
                maxLength={1000}
                onChange={(e) => {
                  setNotes(e.target.value);
                  handleSaveText(e.target.value, journal);
                }}
                placeholder="Anota recordatorios clave, prioridades o enlaces de hoy..."
                className="w-full bg-dark-surface border border-border-subtle rounded-md p-3 text-body-sm text-dark-on-surface placeholder-dark-on-surface-variant/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none transition-colors"
              />

              <div className="flex items-center justify-between text-label-sm text-dark-on-surface-variant pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => insertSnippet("**Importante:** ")}
                    className="hover:text-white p-1 rounded hover:bg-dark-surface transition-colors cursor-pointer"
                    title="Insertar negrita"
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    onClick={() => insertSnippet("- [ ] ")}
                    className="hover:text-white p-1 rounded hover:bg-dark-surface transition-colors cursor-pointer"
                    title="Insertar lista"
                  >
                    • Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => insertSnippet("[Enlace](https://)")}
                    className="hover:text-white p-1 rounded hover:bg-dark-surface transition-colors cursor-pointer"
                    title="Insertar enlace"
                  >
                    🔗 Link
                  </button>
                </div>
                <span className="font-code text-[11px]">{notesWordCount} palabras</span>
              </div>
            </div>

            {/* Block 2: Diario de reflexión personal */}
            <div className="rounded-lg border border-border-subtle bg-dark-surface-variant/50 p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-border-subtle/70 pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen size={18} className="text-accent" />
                  <h2 className="font-headline text-headline-md text-white font-semibold">
                    Diario de reflexión
                  </h2>
                </div>
                <span className="text-label-sm font-label text-dark-on-surface-variant">
                  {capitalizedWeekday}, {shortDate(day)}
                </span>
              </div>

              <p className="text-body-sm text-dark-on-surface-variant italic">
                &ldquo;¿Cómo fue el día? ¿Qué obstáculos surgieron y cómo respondiste?&rdquo;
              </p>

              <textarea
                rows={7}
                value={journal}
                onChange={(e) => {
                  setJournal(e.target.value);
                  handleSaveText(notes, e.target.value);
                }}
                placeholder="Escribe tu reflexión del día aquí... Reflexiona sobre tu concentración, energía y decisiones conscientes."
                className="w-full bg-dark-surface border border-border-subtle rounded-md p-3 text-body-sm text-dark-on-surface placeholder-dark-on-surface-variant/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none transition-colors"
              />

              <div className="flex flex-wrap items-center justify-between pt-2 border-t border-border-subtle/50 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-label-sm text-dark-on-surface-variant font-label">
                    Nivel de energía:
                  </span>
                  <div className="flex items-center gap-1">
                    {["Normal", "Alto", "Bajo", "Enfocado"].map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          setEnergyLevel(lvl);
                          handleSaveText(notes, journal);
                        }}
                        className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-code transition-colors cursor-pointer border",
                          energyLevel === lvl
                            ? "bg-accent-subtle border-accent/40 text-accent font-semibold"
                            : "bg-dark-surface border-border-subtle text-dark-on-surface-variant hover:text-dark-on-surface hover:border-border-strong",
                        )}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void flushText()}
                  className="px-3 py-1 text-label-md font-label bg-dark-surface hover:bg-dark-surface/80 border border-border-subtle hover:border-border-strong text-dark-on-surface hover:text-white rounded transition-colors cursor-pointer"
                >
                  Archivar entrada
                </button>
              </div>
            </div>

            {/* Block 3: Resumen de enfoque y reglas */}
            <div className="rounded-lg border border-border-subtle bg-dark-surface p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-dark-on-surface">
                <Lightbulb size={16} className="text-accent" />
                <span className="text-label-md font-semibold font-headline text-white">
                  Regla de consistencia
                </span>
              </div>
              <p className="text-body-sm text-dark-on-surface-variant leading-relaxed">
                No rompas la cadena dos días consecutivos. Si un hábito de alta demanda (como
                programación o gimnasio) se dificulta por tiempo, reduce la escala pero cumple con la
                versión mínima.
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Habit Edit Modal */}
      {editingHabit && (
        <HabitEditModal habit={editingHabit} onClose={() => setEditingHabitId(null)} />
      )}
    </div>
  );

  // Helper to render individual habit item with full Notion fidelity
  function renderHabitItem(h: Habit) {
    const isDone = Boolean(log?.completed[h.id]);
    const hasSubtasks = h.subtasks && h.subtasks.length > 0;
    const completedSubtasks = hasSubtasks
      ? h.subtasks.filter((s) => Boolean(log?.subtasks[h.id]?.[s.id])).length
      : 0;

    return (
      <div
        key={h.id}
        className={cn(
          "group rounded-md border transition-all duration-120",
          isDone
            ? "border-border-subtle/60 bg-dark-surface-variant/25 opacity-85"
            : "border-border-subtle bg-dark-surface-variant/40 hover:bg-dark-surface-variant/70 hover:border-border-strong",
          h.subtasks.length > 0 && "bg-dark-surface-variant/50",
        )}
      >
        <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Custom Checkbox */}
            <HabitCheck
              habit={h}
              active
              done={isDone}
              label={h.name}
              onToggle={(v) => void setDone(day, h.id, v)}
            />

            {/* Habit Icon box */}
            <div className="w-6 h-6 rounded flex items-center justify-center bg-dark-surface text-dark-on-surface-variant border border-border-subtle flex-shrink-0 text-[13px]">
              {h.icon || "•"}
            </div>

            {/* Habit Name and Category / Subtask Badge */}
            <div className="flex items-center gap-2 truncate">
              <span
                className={cn(
                  "text-body-md font-medium truncate transition-colors",
                  isDone ? "text-dark-on-surface-variant line-through" : "text-white",
                )}
              >
                {h.name}
              </span>

              {h.area && (
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[11px] font-label font-medium bg-dark-surface text-dark-on-surface-variant border border-border-subtle">
                  {h.area}
                </span>
              )}

              {h.id === "gym" && (
                <button
                  type="button"
                  onClick={() => setGymExpanded((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer transition-colors",
                    gymExpanded
                      ? "bg-warning/20 text-warning border-warning/40"
                      : "bg-warning/10 text-warning border-warning/25 hover:bg-warning/20",
                  )}
                  title="Desplegar ejercicios del día"
                >
                  <Dumbbell size={12} />
                  <span>Ejercicios rutina</span>
                  <ChevronDown
                    size={12}
                    className={cn("transition-transform duration-200", gymExpanded && "rotate-180")}
                  />
                </button>
              )}
            </div>
          </div>

          {/* Right side: Time, Subtask count, Calendar button & Edit button */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {hasSubtasks && (
              <span className="text-label-sm font-code text-dark-on-surface-variant bg-dark-surface px-1.5 py-0.5 rounded border border-border-subtle hidden sm:inline-block">
                {completedSubtasks}/{h.subtasks.length}
              </span>
            )}

            {h.time && (
              <span className="text-code-sm font-code text-dark-on-surface-variant">
                {h.time}
              </span>
            )}

            {/* Calendar icon button */}
            <IconButton
              title={`Ver ${h.name} en el calendario`}
              aria-label={`Ver ${h.name} en el calendario`}
              active={Boolean(h.in_calendar)}
              onClick={(e) => {
                e.stopPropagation();
                if (!h.in_calendar) {
                  void update(h.id, { in_calendar: true });
                }
                useCalendar.getState().setDay(day);
                useCalendar.getState().setSelectedOccId(`habit:${h.id}`);
                useApp.getState().setModule("calendario");
              }}
              className={cn(
                "transition-all cursor-pointer p-1 rounded",
                h.in_calendar
                  ? "opacity-100 bg-accent-subtle text-accent border border-accent/30"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-dark-on-surface-variant hover:text-white hover:bg-dark-surface",
              )}
            >
              {h.in_calendar ? <CalendarCheck size={14} /> : <Calendar size={14} />}
            </IconButton>

            {/* Edit button */}
            <IconButton
              title={`Editar hábito: ${h.name}`}
              onClick={() => setEditingHabitId(h.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 text-dark-on-surface-variant hover:text-white hover:bg-dark-surface p-1 rounded cursor-pointer"
            >
              <Pencil size={13} />
            </IconButton>
          </div>
        </div>

        {/* Gym Exercises expander */}
        {h.id === "gym" && gymExpanded && (
          <div className="px-3.5 pb-3 pt-1 border-t border-border-subtle/50">
            <GymExercisesList
              day={day}
              habit={h}
              onUpdate={(schedules) => void update(h.id, { exercise_schedules: schedules })}
            />
          </div>
        )}

        {/* Nested Sub-tasks checklist */}
        {hasSubtasks && (
          <div className="mt-1 pb-3 pl-12 pr-4 border-t border-border-subtle/40 pt-2.5 space-y-2">
            <div className="border-l-2 border-border-subtle pl-3 space-y-1.5">
              {h.subtasks.map((s) => {
                const subDone = Boolean(log?.subtasks[h.id]?.[s.id]);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2.5 text-body-sm text-dark-on-surface hover:text-white cursor-pointer select-none group/sub"
                  >
                    <input
                      type="checkbox"
                      checked={subDone}
                      onChange={(e) => void setSubtask(day, h.id, s.id, e.target.checked)}
                      className="w-3.5 h-3.5 rounded-sm bg-dark-surface border-border-strong text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[var(--nv-accent)]"
                    />
                    <span
                      className={cn(
                        "transition-colors",
                        subDone ? "text-dark-on-surface-variant line-through" : "text-dark-on-surface",
                      )}
                    >
                      {s.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
}
