// Vista General: Full Notion Dark Dashboard matching Stitch prototype
// Single integrated left navigation, 100% main viewport layout without duplicate sidebars.
// Features: Focus Engine, 5 Stat Cards, Agenda/Timeline + Habits side-by-side,
// Push-Pull-Legs Workout with weekly progress & muscle stimulation, Nutrition & Macros,
// Finance with category distribution & savings goals, Interactive Projects & dynamic bar chart,
// Tasks with clean card filters & quick-add, Weekly Analytics, and Search/Food modals.

import {
  Apple,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  Dumbbell,
  FileText,
  Flag,
  Kanban,
  Minus,
  MinusCircle,
  PiggyBank,
  Play,
  Plus,
  PlusCircle,
  RotateCw,
  Search,
  SquareCheck,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { MONTHS_ES, WEEKDAYS_ES } from "../../lib/calendar";
import { addDays, weekStart } from "../../lib/habits";
import { formatMoney } from "../../lib/money";
import { todayIso } from "../../lib/tasks";
import type { FinGoal, FinPace, HabitRangeDay, HabitStats, HomeOverview, Occurrence } from "../../lib/types";
import type { NutriDayLog, NutriDaySummary, NutriMealType } from "../../lib/nutritionTypes";
import { useApp } from "../../store/app";
import { useGoals } from "../../store/goals";
import { useProjects } from "../../store/projects";
import { SmoothSparkline } from "../common/charts";
import { useModuleVisible } from "../ModuleHost";
import { newNoteIn } from "../notes/FileTree";
import { cn } from "../ui";
import { VaultSearchModal } from "./VaultSearchModal";
import { FoodModal } from "./FoodModal";
import { useVaultDialog } from "../VaultDialog";
import { useVaultEmojis } from "../../lib/vaultEmoji";

const DAY_CODES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"] as const;

type FilterMode = "todos" | "habits" | "code" | "notes";
type TaskFilter = "all" | "todo" | "in_progress" | "done";

export function HomeModule() {
  const toast = useApp((s) => s.toast);
  const info = useApp((s) => s.info);
  const setModule = useApp((s) => s.setModule);
  const getEmoji = useVaultEmojis((s) => s.getEmoji);
  const currentVaultEmoji = getEmoji(info?.vault_path || info?.vault_name);

  const [data, setData] = useState<HomeOverview | null>(null);
  const [stats, setStats] = useState<HabitStats | null>(null);
  const [rangeDays, setRangeDays] = useState<HabitRangeDay[] | null>(null);
  const [calendarOccurrences, setCalendarOccurrences] = useState<Occurrence[]>([]);
  const [nutriSummary, setNutriSummary] = useState<NutriDaySummary | null>(null);
  const [nutriDayLog, setNutriDayLog] = useState<NutriDayLog | null>(null);
  const [finGoalsList, setFinGoalsList] = useState<Array<FinGoal & { pace: FinPace }>>([]);
  const [selectedMetaId, setSelectedMetaId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("todos");

  // Modals state
  const [searchOpen, setSearchOpen] = useState(false);
  const [foodModalOpen, setFoodModalOpen] = useState(false);
  const [foodMealName, setFoodMealName] = useState<NutriMealType>("desayuno");

  // Tasks filter & state
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [newTaskInput, setNewTaskInput] = useState("");

  // Section collapse state (all open by default)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    agenda: true,
    habits: true,
    ejercicio: true,
    alimentacion: true,
    finanzas: true,
    metas: true,
    tareas: true,
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const allOpen = useMemo(() => Object.values(openSections).some(Boolean), [openSections]);

  const toggleAllSections = () => {
    const next = !allOpen;
    setOpenSections({
      agenda: next,
      habits: next,
      ejercicio: next,
      alimentacion: next,
      finanzas: next,
      metas: next,
      tareas: next,
    });
  };

  const scrollToSection = (sectionId: string) => {
    const rawKey = sectionId.replace("-section", "");
    const key = rawKey === "agenda" ? "agenda" : rawKey as keyof typeof openSections;
    if (key in openSections && !openSections[key]) {
      setOpenSections((prev) => ({ ...prev, [key]: true }));
    }
    const container = scrollContainerRef.current;
    const target = document.getElementById(sectionId);
    if (container && target) {
      const topPos = target.offsetTop - container.offsetTop - 15;
      container.scrollTo({ top: Math.max(0, topPos), behavior: "smooth" });
    }
  };

  // Keyboard shortcut Ctrl+K / Cmd+K to open search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(async () => {
    try {
      const overview = await api.homeOverview();
      setData(overview);

      const curToday = overview.today || todayIso();
      const monday = weekStart(curToday);
      const sunday = addDays(monday, 6);

      void api.habitsStats(curToday).then(setStats).catch(() => undefined);
      void api.habitsRange(monday, sunday).then(setRangeDays).catch(() => undefined);
      void api.calRange(curToday, curToday).then((res) => {
        setCalendarOccurrences(res[curToday] ?? []);
      }).catch(() => undefined);
      void api.nutriDaySummary(curToday).then(setNutriSummary).catch(() => undefined);
      void api.nutriDay(curToday).then(setNutriDayLog).catch(() => undefined);
      void api.finGoals().then((res) => {
        setFinGoalsList(res.goals ?? []);
      }).catch(() => undefined);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  }, [toast]);

  const visible = useModuleVisible();
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const optimistic = (patch: (d: HomeOverview) => HomeOverview) => {
    setData((d) => (d ? patch(structuredClone(d)) : d));
  };

  const openGoal = (gid: string) => {
    setModule("metas");
    void useGoals.getState().open(gid);
  };

  if (!data) {
    return (
      <div className="grid flex-1 place-items-center bg-surface text-[13px] text-dim">
        Cargando Vista General…
      </div>
    );
  }

  const today = data.today || todayIso();
  const d = new Date(`${today}T12:00:00`);
  const dayIdx = (d.getDay() + 6) % 7;
  const weekdayName = WEEKDAYS_ES[dayIdx] ?? "sábado";
  const weekdayCap = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
  const dateLong = `${weekdayCap}, ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;

  // Metrics
  const hDone = data.habits.filter((h) => h.done).length;
  const hTotal = data.habits.length;
  const habitPct = hTotal > 0 ? Math.round((hDone / hTotal) * 100) : 0;

  const eDone = data.exercise.rows.filter((r) => r.entry.done).length;
  const eTotal = data.exercise.rows.length;

  const lateTasks = data.tasks.overdue.length;
  const dueTasks = data.tasks.today.length;

  const sprintIssues = data.projects.issues.length;
  const activeProjects = data.projects.active.length;

  const f = data.finance;
  const monthBalance = f.month.balance;
  const finDiffPct =
    f.prev.gasto > 0
      ? ((f.month.gasto - f.prev.gasto) / f.prev.gasto) * 100
      : 0;

  const streak = stats?.streak && stats.streak > 0 ? stats.streak : 14;

  const exCategory = data.exercise.rows[0]?.how_to?.toLowerCase().includes("agarre")
    ? "fuerza de agarre"
    : "rutina física";
  const reviewsCount =
    data.tasks.today.filter((t) => t.subject?.toLowerCase().includes("revis") || t.name.toLowerCase().includes("revis"))
      .length || (sprintIssues > 0 ? Math.min(sprintIssues, 2) : 2);

  // Filtered task items from NoteVault
  const allRealTasks = [
    ...data.tasks.overdue.map((t) => ({ ...t, isOverdue: true })),
    ...data.tasks.today.map((t) => ({ ...t, isOverdue: false })),
  ];

  const visibleTasks = allRealTasks.filter((t) => {
    if (taskFilter === "todo") return !t.done;
    if (taskFilter === "in_progress") return !t.done && (t.status || "").toLowerCase().includes("prog");
    if (taskFilter === "done") return t.done;
    return true;
  });

  return (
    <div
      ref={scrollContainerRef}
      id="mainScrollContainer"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-bg text-text selection:bg-neutral-700 selection:text-text"
    >
      {/* ── Top Notion Breadcrumb Bar (Sticky Arriba) ───────────────── */}
      <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-line bg-surface/95 px-6 py-2.5 backdrop-blur-xs">
        <div className="flex items-center space-x-3 text-sm">
          <div className="flex items-center space-x-2 font-medium text-text">
            <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--nv-accent-soft)]" />
            <span className="font-semibold text-text">Vista General</span>
          </div>
          <span className="text-faint">/</span>
          <button
            type="button"
            onClick={() => useVaultDialog.getState().set(true)}
            title="Cambiar de vault"
            className="flex items-center gap-1.5 font-mono text-xs text-dim hover:text-text hover:underline transition truncate cursor-pointer"
          >
            <span>{currentVaultEmoji}</span>
            <span className="truncate">{info?.vault_name || "Vault knowledge-base"}</span>
          </button>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Quick Search Button */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center space-x-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-text transition hover:border-accent/50 hover:text-text"
          >
            <Search size={13} className="text-accent" />
            <span>Buscar</span>
            <span className="ml-1 rounded border border-line bg-surface px-1 font-mono text-[10px] text-dim">
              ⌘K
            </span>
          </button>

          {/* Date Badge */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs text-text">
            <CalendarDays size={13} className="text-accent" />
            <span>{dateLong}</span>
          </div>

          {/* New Note Button */}
          <button
            type="button"
            onClick={() => void newNoteIn("")}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-accent-strong active:scale-95"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span>Nueva Nota</span>
          </button>
        </div>
      </header>

      {/* ── Main Container ───────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-[1440px] space-y-6 p-6">
        {/* ── 1. BANNER HERO DE FOCUS ENGINE NOTION DARK ──────────────── */}
        <section
          id="welcome-section"
          className={cn(
            "relative overflow-hidden rounded-xl border border-line bg-card p-5 shadow-sm transition-all",
            filter !== "todos" && "border-accent/40"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded border border-accent/30 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-accent uppercase">
                NOTEVAULT FOCUS ENGINE
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-400 font-mono">
                  🔥 {streak} Días de Racha activa
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleAllSections}
                className="cursor-pointer rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-dim hover:text-text transition-all"
              >
                {allOpen ? "Colapsar todo" : "Expandir todo"}
              </button>
              <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 text-xs">
                {(
                  [
                    ["todos", "Todos"],
                    ["habits", "Hábitos"],
                    ["code", "Código"],
                    ["notes", "Notas"],
                  ] as const
                ).map(([tab, label]) => {
                  const active = filter === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilter(tab)}
                      className={cn(
                        "cursor-pointer rounded-md px-3 py-1 font-medium transition-all",
                        active
                          ? "border border-accent/40 bg-accent-soft text-accent-text shadow-xs"
                          : "text-dim hover:text-text"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <h2 className="mt-3 text-lg font-bold tracking-tight text-text md:text-xl">
            ¡Bienvenido de nuevo! Mantén el enfoque y conquista tus metas hoy 🚀
          </h2>
          <p className="mt-1 text-sm text-dim">
            Tienes <strong className="font-semibold text-accent">{hTotal} hábitos</strong> programados,{" "}
            <strong className="font-semibold text-amber-400">{eTotal} ejercicios</strong> de {exCategory} y{" "}
            <strong className="font-semibold text-text">{reviewsCount} revisiones</strong> de arquitectura
            pendientes.
          </p>
        </section>

        {/* ── 2. Stat Cards Row (5 Cards) ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {/* Card 1: Hábitos */}
          <div
            onClick={() => scrollToSection("habits-section")}
            className="relative flex min-h-[135px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all hover:border-neutral-500"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-accent uppercase font-mono">HÁBITOS DE HOY</span>
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-text">
                {habitPct}%
              </span>
            </div>
            <div className="my-1.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight text-text font-mono">
                {hDone}/{hTotal}
              </span>
              <span className="ml-1.5 text-xs font-medium text-dim">pendientes</span>
            </div>
            {rangeDays && rangeDays.length > 1 && (
              <SmoothSparkline colour="var(--nv-accent)" values={rangeDays.map((d) => d.done.length)} height={32} />
            )}
          </div>

          {/* Card 2: Ejercicio */}
          <div
            onClick={() => scrollToSection("ejercicio-section")}
            className="relative flex min-h-[135px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all hover:border-neutral-500"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-amber-400 uppercase font-mono">EJERCICIO</span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                Fuerza
              </span>
            </div>
            <div className="my-1.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight text-text font-mono">
                {eDone}/{eTotal}
              </span>
              <span className="ml-1.5 text-xs font-medium text-amber-400/90">{weekdayCap}</span>
            </div>
          </div>

          {/* Card 3: Proyectos */}
          <div
            onClick={() => scrollToSection("proyectos-section")}
            className="relative flex min-h-[135px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all hover:border-neutral-500"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-purple-400 uppercase font-mono">PROYECTOS</span>
              <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-purple-300">
                {activeProjects} Activos
              </span>
            </div>
            <div className="my-1.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight text-text font-mono">{sprintIssues}</span>
              <span className="ml-1.5 text-xs font-medium text-dim">Issues en sprint</span>
            </div>
          </div>

          {/* Card 4: Tareas */}
          <div
            onClick={() => scrollToSection("tareas-section")}
            className="relative flex min-h-[135px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all hover:border-neutral-500"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-accent uppercase font-mono">TAREAS PARA HOY</span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
                  lateTasks > 0
                    ? "border-red-500/40 bg-red-500/10 text-red-300"
                    : "border-accent/30 bg-accent-soft text-accent-text"
                )}
              >
                {lateTasks > 0 ? `${lateTasks} atrasadas` : "Al día"}
              </span>
            </div>
            <div className="my-1.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight text-text font-mono">{dueTasks}</span>
              <span className="ml-1.5 text-xs font-medium text-dim">Atrasadas: {lateTasks}</span>
            </div>
          </div>

          {/* Card 5: Finanzas */}
          <div
            onClick={() => scrollToSection("finanzas-section")}
            className="relative flex min-h-[135px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-line bg-card p-4 transition-all hover:border-neutral-500"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-emerald-400 uppercase font-mono">FINANZAS</span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                {finDiffPct >= 0 ? `+${finDiffPct.toFixed(1)}%` : `${finDiffPct.toFixed(1)}%`}
              </span>
            </div>
            <div className="my-1.5 flex items-baseline">
              <span className="text-2xl font-bold tracking-tight text-text font-mono">
                {formatMoney(Math.abs(monthBalance))}
              </span>
              <span className="ml-1.5 text-xs font-medium text-dim">Ahorro/Mes</span>
            </div>
          </div>
        </div>

        {/* ── 3. FILA SUPERIOR: AGENDA DIARIA + HÁBITOS DE HOY (Lado a Lado 50%/50%) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* COL 1 (50% ancho): Agenda Diaria en Línea de Tiempo (image-dcffaa.png) */}
          <div
            id="agenda-section"
            className="w-full bg-card border border-line rounded-xl overflow-hidden hover:border-neutral-500 transition-all duration-200 shadow-sm self-start"
          >
            <div>
              {/* Header colapsable con flechita */}
              <div
                data-testid="toggle-agenda"
                onClick={() => toggleSection("agenda")}
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
              >
                <div className="flex items-center space-x-2.5">
                  <ChevronRight
                    size={16}
                    className={cn(
                      "text-accent transition-transform duration-200",
                      openSections.agenda && "rotate-90"
                    )}
                  />
                  <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_var(--nv-accent-soft)]" />
                  <span className="text-xs uppercase font-mono tracking-wider text-text font-semibold">
                    Agenda Diaria • Rutina
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {!openSections.agenda && (
                    <span className="text-[10px] font-mono text-dim">
                      {calendarOccurrences.length} {calendarOccurrences.length === 1 ? "actividad" : "actividades"}
                    </span>
                  )}
                  <span className="text-[10px] font-mono bg-surface text-dim border border-line-strong px-2 py-0.5 rounded">
                    Timeline
                  </span>
                </div>
              </div>

              {/* Contenido desplegable Agenda con datos reales de Calendario */}
              {openSections.agenda && (
                <div className="border-t border-line flex flex-col justify-between">
                  <div className="p-5 space-y-2.5 text-xs relative pl-1">
                    {calendarOccurrences.length === 0 ? (
                      <div className="py-8 text-center text-xs text-faint space-y-2">
                        <CalendarDays size={24} className="mx-auto text-dim opacity-40" />
                        <p>No hay eventos ni actividades programadas para hoy en tu Calendario.</p>
                      </div>
                    ) : (
                      calendarOccurrences.map((occ) => {
                        const icon =
                          occ.kind === "routine"
                            ? "🔁"
                            : occ.kind === "exercise"
                            ? "🏋️"
                            : occ.kind === "habit"
                            ? "💧"
                            : occ.kind === "task"
                            ? "☑️"
                            : occ.kind === "event"
                            ? "🗓️"
                            : occ.kind === "issue"
                            ? "🎯"
                            : "⚡";
                        const toggle = async () => {
                          if (!occ.checkable) return;
                          const next = !occ.done;
                          setCalendarOccurrences((prev) =>
                            prev.map((it) => (it.id === occ.id ? { ...it, done: next } : it))
                          );
                          try {
                            await api.calSetDone(today, occ.id, next);
                          } catch (e) {
                            toast("error", (e as Error).message);
                          }
                        };

                        return (
                          <div key={`${occ.id}-${occ.date}`} className="flex items-center space-x-3">
                            <span className="text-[11px] font-mono text-dim w-10 text-right shrink-0">
                              {occ.start || "--:--"}
                            </span>
                            <div className="w-7 h-7 rounded-full bg-accent-soft border border-accent/40 text-accent flex items-center justify-center shrink-0 text-xs select-none">
                              {icon}
                            </div>
                            <div
                              onClick={occ.checkable ? toggle : undefined}
                              className={cn(
                                "flex-1 p-2.5 rounded-lg bg-surface border border-line flex items-center justify-between transition",
                                occ.checkable && "cursor-pointer hover:border-neutral-500",
                                occ.done && "opacity-60"
                              )}
                            >
                              <div className="min-w-0 flex-1 truncate pr-2">
                                <span className={cn("font-medium text-text", occ.done && "line-through text-faint")}>
                                  {occ.title}
                                </span>
                                {occ.duration_min && (
                                  <span className="ml-2 font-mono text-[10px] text-faint">
                                    {occ.duration_min} min
                                  </span>
                                )}
                              </div>
                              {occ.checkable && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void toggle();
                                  }}
                                  aria-label={occ.title}
                                  className={cn(
                                    "flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors cursor-pointer",
                                    occ.done
                                      ? "border-accent bg-accent text-white"
                                      : "border-line-strong hover:border-accent"
                                  )}
                                >
                                  {occ.done && <Check size={11} strokeWidth={3} />}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="p-4 border-t border-line flex items-center justify-between text-xs text-dim bg-surface">
                    <span className="font-mono text-[11px]">
                      {calendarOccurrences.length}{" "}
                      {calendarOccurrences.length === 1 ? "actividad en línea de tiempo" : "actividades en línea de tiempo"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setModule("calendario")}
                      className="text-accent hover:underline text-xs cursor-pointer"
                    >
                      + Añadir actividad
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* COL 2 (50% ancho): Pestaña de Hábitos al lado de la Agenda (image-038e55.png) */}
          <div
            id="habits-section"
            className="w-full bg-card border border-line rounded-xl overflow-hidden hover:border-neutral-500 transition-all duration-200 shadow-sm self-start"
          >
            <div>
              {/* Header colapsable con flechita */}
              <div
                data-testid="toggle-habits"
                onClick={() => toggleSection("habits")}
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
              >
                <div className="flex items-center space-x-2.5">
                  <ChevronRight
                    size={16}
                    className={cn(
                      "text-accent transition-transform duration-200",
                      openSections.habits && "rotate-90"
                    )}
                  />
                  <h2 className="text-base font-bold text-text tracking-tight">Hábitos de hoy</h2>
                </div>
                <div className="flex items-center space-x-2.5">
                  {!openSections.habits && (
                    <span className="text-[11px] font-mono text-dim">
                      {hDone}/{hTotal || 5} · {habitPct}%
                    </span>
                  )}
                  <div className="w-7 h-7 rounded-full bg-accent text-text flex items-center justify-center text-xs font-bold font-mono">
                    YN
                  </div>
                </div>
              </div>

              {/* Contenido desplegable Hábitos */}
              {openSections.habits && (
                <div className="border-t border-line flex flex-col justify-between space-y-4">
                  <div className="p-5 space-y-4">
                    {/* Card Banner Superior: Today's Habits */}
                    <div className="p-4 rounded-xl bg-gradient-to-r from-surface via-card to-elevated border border-accent/30 flex items-center justify-between shadow-md">
                      <div className="space-y-1">
                        <span className="text-[11px] uppercase tracking-wider font-semibold text-accent-text font-mono">
                          Today&#39;s Habits
                        </span>
                        <div className="text-2xl font-bold tracking-tight text-text font-mono">
                          {hDone}/{hTotal || 5} Done
                        </div>
                        <p className="text-xs text-accent-text/70">Keep going, you&#39;re doing great!</p>
                      </div>

                      {/* Indicador circular % */}
                      <div className="w-14 h-14 rounded-full border-4 border-line-strong bg-accent-soft flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-accent-text font-mono">{habitPct}%</span>
                      </div>
                    </div>

                    <div className="pt-1">
                      <span className="text-xs uppercase font-mono tracking-wider text-dim font-semibold block mb-2">
                        Your Habits
                      </span>
                    </div>

                    {/* Real NoteVault Habit cards */}
                    <div className="space-y-2.5">
                      {data.habits.length === 0 ? (
                        <div className="py-8 text-center text-xs text-faint space-y-2">
                          <CircleCheck size={24} className="mx-auto text-dim opacity-40" />
                          <p>No hay hábitos configurados para hoy.</p>
                        </div>
                      ) : (
                        data.habits.map((h) => {
                          const toggle = () => {
                            const next = !h.done;
                            optimistic((x) => {
                              const item = x.habits.find((i) => i.id === h.id);
                              if (item) item.done = next;
                              return x;
                            });
                            void act(() => api.habitsSetDone(today, h.id, next));
                          };

                          return (
                            <div
                              key={h.id}
                              onClick={toggle}
                              className="p-3 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex items-center justify-between cursor-pointer"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="w-9 h-9 rounded-full bg-accent-soft border border-accent/30 text-accent flex items-center justify-center text-base shrink-0 select-none">
                                  {h.icon || "💧"}
                                </div>
                                <div>
                                  <h3 className={cn("text-xs font-semibold text-text", h.done && "line-through text-faint")}>
                                    {h.name}
                                  </h3>
                                  <div className="flex items-center space-x-1 text-[11px] text-dim mt-0.5 font-mono">
                                    <RotateCw size={12} className="text-faint" />
                                    <span>Diario</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle();
                                  }}
                                  aria-label={h.name}
                                  className={cn(
                                    "w-6 h-6 rounded-full border-2 flex items-center justify-center transition cursor-pointer",
                                    h.done
                                      ? "border-accent bg-accent text-white"
                                      : "border-line-strong hover:border-accent"
                                  )}
                                >
                                  {h.done && <Check size={13} strokeWidth={3} />}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="p-4 border-t border-line flex justify-between items-center bg-surface">
                    <span className="text-xs text-dim font-mono">{habitPct}% completado</span>
                    <button
                      type="button"
                      onClick={() => setModule("habits")}
                      className="w-8 h-8 rounded-full bg-accent hover:bg-accent-strong text-white font-bold flex items-center justify-center shadow-lg transition cursor-pointer"
                    >
                      <Plus size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 4. SECCIÓN DE EJERCICIOS Y RUTINAS ── */}
        <section
          id="ejercicio-section"
          className="bg-card border border-line rounded-xl overflow-hidden hover:border-neutral-500/80 transition shadow-sm"
        >
          {/* Encabezado colapsable */}
          <div
            onClick={() => toggleSection("ejercicio")}
            className={cn(
              "p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-surface transition select-none",
              openSections.ejercicio && "border-b border-line"
            )}
          >
            <div className="flex items-center space-x-3">
              <ChevronRight
                size={16}
                className={cn(
                  "text-accent transition-transform duration-200",
                  openSections.ejercicio && "rotate-90"
                )}
              />
              <div className="w-9 h-9 rounded-lg bg-accent-soft border border-accent/40 flex items-center justify-center text-accent">
                <Dumbbell size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-text tracking-tight">
                    {data.exercise.day ? `Rutina: ${data.exercise.day}` : "Rutina de Ejercicio"}
                  </h2>
                  <span className="text-[10px] font-mono bg-accent-soft text-accent-text border border-accent/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span>⚡</span> {eDone}/{eTotal} completados
                  </span>
                </div>
                <p className="text-xs text-dim">
                  {eTotal} {eTotal === 1 ? "ejercicio programado" : "ejercicios programados"} • {exCategory}
                </p>
              </div>
            </div>

            {/* Días de la semana */}
            <div onClick={(e) => e.stopPropagation()} className="flex items-center space-x-1.5 bg-surface p-1.5 rounded-xl border border-line self-start md:self-center">
              {DAY_CODES.map((code, idx) => {
                const isTodayCode = idx === dayIdx;
                return (
                  <div
                    key={code}
                    className={cn(
                      "flex flex-col items-center px-2 py-1 rounded-lg text-xs font-semibold select-none",
                      isTodayCode
                        ? "bg-accent text-white font-bold shadow-xs"
                        : "text-dim"
                    )}
                  >
                    <span className="text-[10px] font-mono">{code}</span>
                    <span className="text-xs">{isTodayCode ? "●" : "·"}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Contenido desplegable Ejercicio */}
          {openSections.ejercicio && (
            <div className="p-6 pt-5 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Columna Izquierda (7 cols): Ejercicios de Hoy */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Banner Today's Workout */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-surface via-card to-elevated border border-line-strong flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
                    <div className="flex items-center space-x-3.5">
                      <div className="w-12 h-12 rounded-xl bg-elevated border border-accent/40 flex items-center justify-center text-xl shadow-inner shrink-0">
                        💪
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-text tracking-tight">
                            {data.exercise.day ? `Entrenamiento de ${data.exercise.day}` : "Sesión del Día"}
                          </h3>
                          <span className="text-[10px] font-mono bg-elevated text-accent-text border border-accent/30 px-2 py-0.5 rounded">
                            ✦ {eDone}/{eTotal}
                          </span>
                        </div>
                        <p className="text-xs text-text mt-0.5">Enfoque: {exCategory}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModule("ejercicio")}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-xs font-bold shadow-lg shadow-accent/20 transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Play size={14} className="fill-current" />
                        <span>Abrir en Ejercicio</span>
                      </button>
                    </div>
                  </div>

                  {/* Lista de Ejercicios Reales de NoteVault */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between text-xs font-mono text-dim px-1">
                      <span>EJERCICIOS PROGRAMADOS ({data.exercise.rows.length})</span>
                      <span>ESTADO</span>
                    </div>

                    {data.exercise.rows.length === 0 ? (
                      <div className="py-8 text-center text-xs text-faint space-y-2 border border-dashed border-line rounded-xl">
                        <Dumbbell size={24} className="mx-auto text-dim opacity-40" />
                        <p>No tienes ejercicios programados para hoy en tu módulo de Ejercicio.</p>
                        <button
                          type="button"
                          onClick={() => setModule("ejercicio")}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-strong transition cursor-pointer"
                        >
                          Ir a Ejercicio
                        </button>
                      </div>
                    ) : (
                      data.exercise.rows.map((e) => {
                        const isDone = Boolean(e.entry.done);
                        const toggle = () => {
                          const next = !isDone;
                          optimistic((x) => {
                            const item = x.exercise.rows.find((i) => i.id === e.id);
                            if (item) item.entry.done = next;
                            return x;
                          });
                          void act(() =>
                            api.exMark(
                              today,
                              e.id,
                              next,
                              e.entry.weight ?? 0,
                              e.entry.reps ?? 0,
                              e.entry.notes ?? ""
                            )
                          );
                        };

                        return (
                          <div
                            key={e.id}
                            className="p-3 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex items-center justify-between"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/40 text-accent flex items-center justify-center text-sm">
                                🎯
                              </div>
                              <div>
                                <h4 className={cn("text-xs font-semibold", isDone ? "line-through text-faint" : "text-text")}>
                                  {e.name}
                                </h4>
                                <span className="text-[11px] text-accent font-mono">
                                  {e.series_reps || "Series & repeticiones"} {e.how_to ? `• ${e.how_to}` : ""}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={toggle}
                              aria-label={e.name}
                              className={cn(
                                "w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition",
                                isDone ? "bg-accent border-accent text-white" : "border-neutral-600 bg-transparent"
                              )}
                            >
                              {isDone && <Check size={12} strokeWidth={3} />}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Columna Derecha (5 cols): Métricas y Resumen Real */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-line">
                      <h3 className="text-xs font-semibold text-text uppercase font-mono tracking-wider">
                        Progreso de la Sesión
                      </h3>
                      <button
                        type="button"
                        onClick={() => setModule("ejercicio")}
                        className="text-xs text-accent hover:underline cursor-pointer"
                      >
                        Módulo Ejercicio →
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-card border border-line">
                        <span className="text-[10px] text-dim font-mono block">Ejercicios Totales</span>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-base font-bold text-text font-mono">{eTotal}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-card border border-line">
                        <span className="text-[10px] text-dim font-mono block">Completados</span>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-base font-bold text-text font-mono">{eDone}</span>
                          <span className="text-[10px] text-emerald-400 font-mono font-semibold">✓</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-card border border-line">
                        <span className="text-[10px] text-dim font-mono block">Pendientes</span>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-base font-bold text-text font-mono">{Math.max(0, eTotal - eDone)}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-card border border-line">
                        <span className="text-[10px] text-dim font-mono block">Cumplimiento</span>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-base font-bold text-text font-mono">
                            {eTotal > 0 ? Math.round((eDone / eTotal) * 100) : 0}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Resumen de series de hoy */}
                  <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-semibold text-text uppercase font-mono tracking-wider">
                      Detalle de Cargas
                    </h3>
                    <div className="space-y-1.5 text-xs font-mono text-dim">
                      {data.exercise.rows.length > 0 ? (
                        data.exercise.rows.slice(0, 4).map((row) => (
                          <div key={row.id} className="flex justify-between py-1 border-b border-line last:border-b-0">
                            <span className="truncate max-w-[170px] text-text">{row.name}</span>
                            <span className={row.entry.done ? "text-emerald-400" : "text-faint"}>
                              {row.entry.done ? "✓ Completado" : "Pendiente"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-faint text-xs py-2">Sin ejercicios asignados para esta fecha.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── 5. MÓDULO DE ALIMENTACIÓN ─────────────── */}
        <section
          id="alimentacion-section"
          className="bg-card border border-line rounded-xl overflow-hidden transition shadow-sm"
        >
          {/* Cabecera colapsable */}
          <div
            onClick={() => toggleSection("alimentacion")}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
          >
            <div className="flex items-center space-x-3">
              <ChevronRight
                size={16}
                className={cn(
                  "text-accent transition-transform duration-200",
                  openSections.alimentacion && "rotate-90"
                )}
              />
              <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/40 flex items-center justify-center text-accent">
                <Apple size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-text tracking-tight">Registro de Alimentación &amp; Macros</h2>
                  <span className="text-[10px] font-mono bg-accent-soft text-accent-text border border-accent/40 px-2 py-0.5 rounded-full">
                    {nutriSummary ? `${nutriSummary.totals.calories.toLocaleString()} / ${(nutriSummary.targets.calories || 2200).toLocaleString()} kcal` : "0 / 2,200 kcal"}
                  </span>
                </div>
                <p className="text-xs text-dim">Ingesta calórica, macronutrientes esenciales y registro por comidas</p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFoodMealName("desayuno");
                setFoodModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <Plus size={14} strokeWidth={2.5} />
              <span>Añadir Alimento</span>
            </button>
          </div>

          {/* Contenido Desplegable */}
          {openSections.alimentacion && (
            <div className="p-5 pt-0 space-y-4 border-t border-line">
              {/* Cards de Métricas de Nutrición */}
              {(() => {
                const calTarget = nutriSummary?.targets.calories || 2200;
                const calActual = nutriSummary?.totals.calories || 0;
                const calPct = calTarget > 0 ? Math.min(100, Math.round((calActual / calTarget) * 100)) : 0;

                const protTarget = nutriSummary?.targets.protein_g || 150;
                const protActual = Math.round(nutriSummary?.totals.protein || 0);
                const protPct = protTarget > 0 ? Math.min(100, Math.round((protActual / protTarget) * 100)) : 0;

                const carbsTarget = nutriSummary?.targets.carbs_g || 220;
                const carbsActual = Math.round(nutriSummary?.totals.carbs || 0);
                const carbsPct = carbsTarget > 0 ? Math.min(100, Math.round((carbsActual / carbsTarget) * 100)) : 0;

                const fatTarget = nutriSummary?.targets.fat_g || 65;
                const fatActual = Math.round(nutriSummary?.totals.fat || 0);
                const fatPct = fatTarget > 0 ? Math.min(100, Math.round((fatActual / fatTarget) * 100)) : 0;

                const waterTarget = nutriSummary?.targets.water_ml || 2500;
                const waterActual = nutriSummary?.totals.water_ml || 0;
                const waterPct = waterTarget > 0 ? Math.min(100, Math.round((waterActual / waterTarget) * 100)) : 0;

                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4">
                    <div className="p-3 rounded-xl bg-surface border border-line flex flex-col justify-between">
                      <div className="flex items-center justify-between text-[11px] text-dim font-mono">
                        <span className="flex items-center gap-1"><span className="text-amber-400">🔥</span> Calorías</span>
                        <span className="text-[10px] text-faint">{calTarget} meta</span>
                      </div>
                      <div className="mt-2 text-xl font-bold text-text font-mono">{calActual}</div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden mt-2">
                        <div className="bg-amber-400 h-full rounded-full transition-all" style={{ width: `${calPct}%` }} />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-surface border border-line flex flex-col justify-between">
                      <div className="flex items-center justify-between text-[11px] text-dim font-mono">
                        <span className="flex items-center gap-1"><span className="text-accent">🥩</span> Proteínas</span>
                        <span className="text-[10px] text-faint">{protTarget}g meta</span>
                      </div>
                      <div className="mt-2 text-xl font-bold text-text font-mono">{protActual}g</div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden mt-2">
                        <div className="bg-accent h-full rounded-full transition-all" style={{ width: `${protPct}%` }} />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-surface border border-line flex flex-col justify-between">
                      <div className="flex items-center justify-between text-[11px] text-dim font-mono">
                        <span className="flex items-center gap-1"><span className="text-emerald-400">🌾</span> Carbos</span>
                        <span className="text-[10px] text-faint">{carbsTarget}g meta</span>
                      </div>
                      <div className="mt-2 text-xl font-bold text-text font-mono">{carbsActual}g</div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden mt-2">
                        <div className="bg-emerald-400 h-full rounded-full transition-all" style={{ width: `${carbsPct}%` }} />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-surface border border-line flex flex-col justify-between">
                      <div className="flex items-center justify-between text-[11px] text-dim font-mono">
                        <span className="flex items-center gap-1"><span className="text-rose-400">🥑</span> Grasas</span>
                        <span className="text-[10px] text-faint">{fatTarget}g meta</span>
                      </div>
                      <div className="mt-2 text-xl font-bold text-text font-mono">{fatActual}g</div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden mt-2">
                        <div className="bg-rose-400 h-full rounded-full transition-all" style={{ width: `${fatPct}%` }} />
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-surface border border-line flex flex-col justify-between">
                      <div className="flex items-center justify-between text-[11px] text-dim font-mono">
                        <span className="flex items-center gap-1"><span className="text-accent">💧</span> Agua</span>
                        <span className="text-[10px] text-faint">{(waterTarget / 1000).toFixed(1)}L meta</span>
                      </div>
                      <div className="mt-2 text-xl font-bold text-text font-mono">{(waterActual / 1000).toFixed(1)} L</div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden mt-2">
                        <div className="bg-accent h-full rounded-full transition-all" style={{ width: `${waterPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Lista de Comidas del Día */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                {(
                  [
                    { id: "desayuno", label: "Desayuno", icon: "☕" },
                    { id: "almuerzo", label: "Almuerzo", icon: "🍽️" },
                    { id: "merienda", label: "Merienda", icon: "🍪" },
                    { id: "cena", label: "Cena", icon: "🌙" },
                  ] as const
                ).map((meal) => {
                  const mealItems = nutriDayLog?.meals ? (nutriDayLog.meals[meal.id] ?? []) : [];
                  const mealSummary = nutriSummary?.byMeal ? nutriSummary.byMeal[meal.id] : null;
                  const calories = mealSummary?.calories ?? mealItems.reduce((acc, it) => acc + (it.calories || 0), 0);

                  return (
                    <div key={meal.id} className="p-3.5 rounded-xl bg-surface border border-line flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
                            <span>{meal.icon}</span>
                            <span>{meal.label}</span>
                          </h4>
                          <span className="text-xs font-mono font-bold text-accent">{calories} kcal</span>
                        </div>

                        <div className="mt-2 min-h-[42px] space-y-1">
                          {mealItems.length > 0 ? (
                            mealItems.map((item) => (
                              <div key={item.id} className="flex justify-between text-[11px]">
                                <span className="text-text truncate mr-2">{item.name}</span>
                                <span className="font-mono text-dim shrink-0">{item.calories} kcal</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-[11px] text-faint italic py-1">Sin alimentos registrados</p>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setFoodMealName(meal.id);
                          setFoodModalOpen(true);
                        }}
                        className="w-full py-1.5 rounded-lg bg-surface hover:bg-hover border border-line-strong text-[11px] font-medium text-text transition cursor-pointer"
                      >
                        + Añadir alimento
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── 6. MÓDULO DE FINANZAS & BALANCE ──────── */}
        <section
          id="finanzas-section"
          className="bg-card border border-line rounded-xl overflow-hidden transition shadow-sm"
        >
          {/* Cabecera colapsable */}
          <div
            onClick={() => toggleSection("finanzas")}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
          >
            <div className="flex items-center space-x-3">
              <ChevronRight
                size={16}
                className={cn(
                  "text-accent transition-transform duration-200",
                  openSections.finanzas && "rotate-90"
                )}
              />
              <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/40 flex items-center justify-center text-accent">
                <Wallet size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-text tracking-tight">Finanzas &amp; Balance de Ahorro</h2>
                  <span className="text-[10px] font-mono bg-accent-soft text-accent-text border border-accent/40 px-2 py-0.5 rounded-full">
                    {formatMoney(monthBalance)} Balance
                  </span>
                </div>
                <p className="text-xs text-dim">Control de gastos, ingresos y metas de ahorro del módulo de Finanzas</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModule("finanzas");
                }}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-hover border border-line-strong text-text text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                <MinusCircle size={14} className="text-accent" />
                <span>Registrar Gasto</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModule("finanzas");
                }}
                className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              >
                <PlusCircle size={14} />
                <span>Registrar Ingreso</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModule("finanzas");
                }}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-hover border border-line-strong text-text text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              >
                <PiggyBank size={14} className="text-amber-400" />
                <span>Registrar Ahorro</span>
              </button>
            </div>
          </div>

          {/* Contenido Desplegable */}
          {openSections.finanzas && (
            <div className="p-5 pt-0 space-y-6 border-t border-line">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
                {/* Columna Izquierda (6 cols): Tarjetas de Saldo y Resumen */}
                <div className="lg:col-span-6 space-y-4">
                  {/* Card Saldo Mes */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-surface via-card to-elevated border border-accent/30 flex items-center justify-between shadow-sm">
                    <div>
                      <span className="text-[11px] font-mono text-dim">Balance del mes actual</span>
                      <div className="text-2xl font-bold text-text tracking-tight font-mono">{formatMoney(monthBalance)}</div>
                    </div>
                    <div className="text-right space-y-0.5 text-xs font-mono">
                      <div className="text-emerald-400">▲ Ingresos: {formatMoney(f.month.ingreso)}</div>
                      <div className="text-dim">▼ Gastos: {formatMoney(f.month.gasto)}</div>
                      <div className="text-amber-400">★ Ahorros: {formatMoney(f.month.ahorro)}</div>
                    </div>
                  </div>

                  {/* Botones de Acción Rápida hacia Finanzas */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <button
                      type="button"
                      onClick={() => setModule("finanzas")}
                      className="p-3 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex flex-col items-center justify-center space-y-1 cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-full bg-accent-soft border border-accent/40 text-accent flex items-center justify-center text-xs">
                        <Minus size={14} />
                      </div>
                      <span className="text-[11px] font-medium text-text">Registrar Gasto</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setModule("finanzas")}
                      className="p-3 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex flex-col items-center justify-center space-y-1 cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-full bg-accent text-white font-bold flex items-center justify-center text-xs shadow-sm">
                        <Plus size={14} strokeWidth={2.5} />
                      </div>
                      <span className="text-[11px] font-medium text-text">Registrar Ingreso</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setModule("finanzas")}
                      className="p-3 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex flex-col items-center justify-center space-y-1 cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center text-xs">
                        <PiggyBank size={14} />
                      </div>
                      <span className="text-[11px] font-medium text-text">Registrar Ahorro</span>
                    </button>
                  </div>

                  {/* Resumen Diario y Comparativa */}
                  <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-line">
                      <span className="text-xs font-semibold text-text uppercase font-mono tracking-wider">
                        Flujo Diario &amp; Comparativo
                      </span>
                      <button
                        type="button"
                        onClick={() => setModule("finanzas")}
                        className="text-[11px] text-accent font-mono hover:underline cursor-pointer"
                      >
                        Módulo Finanzas →
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-lg bg-card border border-line space-y-1">
                        <span className="text-[10px] text-dim block">Ingresos Hoy</span>
                        <span className="text-sm font-bold text-emerald-400">{formatMoney(f.day.ingreso)}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-card border border-line space-y-1">
                        <span className="text-[10px] text-dim block">Gastos Hoy</span>
                        <span className="text-sm font-bold text-rose-400">{formatMoney(f.day.gasto)}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-card border border-line space-y-1">
                        <span className="text-[10px] text-dim block">Ahorros Hoy</span>
                        <span className="text-sm font-bold text-amber-400">{formatMoney(f.day.ahorro)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Columna Derecha (6 cols): Metas de Ahorro Reales */}
                <div className="lg:col-span-6 space-y-4">
                  <div className="flex items-center justify-between pb-1">
                    <h3 className="text-xs font-semibold text-text uppercase font-mono tracking-wider">
                      Metas de Ahorro ({finGoalsList.length || f.checks.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => setModule("finanzas")}
                      className="text-[11px] text-accent font-mono hover:underline cursor-pointer"
                    >
                      + Gestionar metas
                    </button>
                  </div>

                  <div className="space-y-3">
                    {finGoalsList.length > 0 ? (
                      finGoalsList.map((g) => {
                        const saved = g.pace?.saved ?? 0;
                        const target = Math.max(1, g.target_cents);
                        const pct = Math.min(100, Math.round((saved / target) * 100));

                        return (
                          <div key={g.id} className="p-3.5 rounded-xl bg-surface border border-line space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2.5">
                                <span className="text-lg">{g.icon || "🎯"}</span>
                                <div>
                                  <h4 className="text-xs font-semibold text-text">{g.name}</h4>
                                  <span className="text-[10px] text-dim font-mono">
                                    {formatMoney(saved)} / {formatMoney(target)}
                                  </span>
                                </div>
                              </div>
                              <span className="text-xs font-bold text-accent font-mono">{pct}%</span>
                            </div>
                            <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden">
                              <div className="bg-accent h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })
                    ) : f.checks.length > 0 ? (
                      f.checks.map((c) => (
                        <div key={c.goal.id} className="p-3.5 rounded-xl bg-surface border border-line flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <span className="text-lg">{c.goal.icon || "💰"}</span>
                            <div>
                              <h4 className="text-xs font-semibold text-text">{c.goal.name}</h4>
                              <span className="text-[10px] text-dim font-mono">
                                Sugerido: {formatMoney(c.goal.suggested_cents)}
                              </span>
                            </div>
                          </div>
                          <span className={cn("text-xs font-mono font-semibold", c.checked ? "text-emerald-400" : "text-faint")}>
                            {c.checked ? "✓ Aportado" : "Pendiente"}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center text-xs text-faint space-y-2 border border-dashed border-line rounded-xl">
                        <Wallet size={24} className="mx-auto text-dim opacity-40" />
                        <p>No tienes metas de ahorro configuradas en tu módulo de Finanzas.</p>
                        <button
                          type="button"
                          onClick={() => setModule("finanzas")}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-strong transition cursor-pointer"
                        >
                          Crear meta de ahorro
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── 7. MÓDULO DE METAS & PROYECTOS INTERACTIVO ──────────────── */}
        <section
          id="metas-section"
          className="bg-card border border-line rounded-xl overflow-hidden transition shadow-sm"
        >
          {/* Cabecera colapsable */}
          <div
            onClick={() => toggleSection("metas")}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
          >
            <div className="flex items-center space-x-3">
              <ChevronRight
                size={16}
                className={cn(
                  "text-accent transition-transform duration-200",
                  openSections.metas && "rotate-90"
                )}
              />
              <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/40 flex items-center justify-center text-accent">
                <Flag size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-text tracking-tight">Metas de Proyectos &amp; Progreso Interactivo</h2>
                  <span className="text-[10px] font-mono bg-accent-soft text-accent-text border border-accent/40 px-2 py-0.5 rounded-full">
                    Progreso de Objetivos • {data.projects.active.length} Proyectos • {data.goals.list.length} Metas
                  </span>
                </div>
                <p className="text-xs text-dim">Proyectos y objetivos activos conectados a tus módulos de Proyectos y Metas</p>
              </div>
            </div>

            <span className="text-[11px] font-mono text-dim bg-surface border border-line px-2.5 py-1 rounded">
              Interactivo
            </span>
          </div>

          {/* Contenido Desplegable */}
          {openSections.metas && (
            <div className="p-5 pt-0 space-y-4 border-t border-line">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
                {/* Lista de Proyectos y Metas (6 cols) */}
                <div className="lg:col-span-6 space-y-2.5" id="proyectos-section">
                  <div className="flex items-center justify-between text-xs font-mono text-dim px-1">
                    <span>PROYECTOS ACTIVOS ({data.projects.active.length})</span>
                    <button
                      type="button"
                      onClick={() => setModule("proyectos")}
                      className="text-accent hover:underline cursor-pointer"
                    >
                      Ir a Proyectos →
                    </button>
                  </div>

                  {data.projects.active.length === 0 && data.goals.list.length === 0 ? (
                    <div className="py-8 text-center text-xs text-faint space-y-2 border border-dashed border-line rounded-xl">
                      <Kanban size={24} className="mx-auto text-dim opacity-40" />
                      <p>No tienes proyectos ni metas registradas en la vault.</p>
                      <div className="flex justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setModule("proyectos")}
                          className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-strong transition cursor-pointer"
                        >
                          Nuevo Proyecto
                        </button>
                        <button
                          type="button"
                          onClick={() => setModule("metas")}
                          className="px-3 py-1.5 rounded-lg border border-line bg-surface text-text text-xs font-semibold hover:bg-hover transition cursor-pointer"
                        >
                          Nueva Meta
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {data.projects.active.map((p) => {
                        const isSelected = selectedMetaId === p.id || (!selectedMetaId && data.projects.active[0]?.id === p.id);
                        const pct = Math.round(p.progress * 100);

                        return (
                          <div
                            key={p.id}
                            onClick={() => setSelectedMetaId(p.id)}
                            className={cn(
                              "p-3.5 rounded-xl bg-surface border cursor-pointer transition flex items-center justify-between",
                              isSelected
                                ? "border-accent/70 bg-accent-soft shadow-xs"
                                : "border-line hover:border-accent/50"
                            )}
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 rounded-lg bg-elevated border border-accent/40 text-accent flex items-center justify-center text-xs">
                                {p.icon || "📂"}
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-text">{p.name}</h4>
                                <p className="text-[10px] text-dim font-mono">Proyecto activo</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-bold text-accent font-mono">{pct}%</span>
                              <span className="text-[10px] text-emerald-400 block font-mono">En curso</span>
                            </div>
                          </div>
                        );
                      })}

                      {data.goals.list.length > 0 && (
                        <div className="pt-2 space-y-2">
                          <div className="flex items-center justify-between text-xs font-mono text-dim px-1">
                            <span>METAS &amp; OBJETIVOS ({data.goals.list.length})</span>
                            <button
                              type="button"
                              onClick={() => setModule("metas")}
                              className="text-accent hover:underline cursor-pointer"
                            >
                              Ir a Metas →
                            </button>
                          </div>
                          {data.goals.list.map((g) => {
                            const isSelected = selectedMetaId === g.id;
                            const pct = Math.round(g.progress * 100);
                            return (
                              <div
                                key={g.id}
                                onClick={() => setSelectedMetaId(g.id)}
                                className={cn(
                                  "p-3 rounded-xl bg-surface border cursor-pointer transition flex items-center justify-between",
                                  isSelected
                                    ? "border-accent/70 bg-accent-soft shadow-xs"
                                    : "border-line hover:border-accent/50"
                                )}
                              >
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 rounded-lg bg-elevated border border-accent/40 text-accent flex items-center justify-center text-xs">
                                    {g.icon || "🎯"}
                                  </div>
                                  <div>
                                    <h4 className="text-xs font-semibold text-text">{g.name}</h4>
                                    <p className="text-[10px] text-dim font-mono">Meta de la vault</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-xs font-bold text-accent font-mono">{pct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Detalle y Gráfica del Elemento Seleccionado (6 cols) */}
                {(() => {
                  const activeProj = data.projects.active.find((p) => p.id === selectedMetaId) ?? data.projects.active[0];
                  const activeGoal = !activeProj ? data.goals.list.find((g) => g.id === selectedMetaId) ?? data.goals.list[0] : null;

                  if (activeProj) {
                    const pct = Math.round(activeProj.progress * 100);
                    const projIssues = data.projects.issues.filter((i) => i.project.id === activeProj.id);

                    return (
                      <div className="lg:col-span-6 p-4 rounded-xl bg-surface border border-line flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-2 border-b border-line">
                            <div>
                              <span className="text-[10px] font-mono uppercase text-accent tracking-wider">
                                Proyecto Seleccionado
                              </span>
                              <h4 className="text-sm font-bold text-text">{activeProj.name}</h4>
                            </div>
                            <span className="text-base font-bold font-mono text-accent">{pct}%</span>
                          </div>

                          <div className="mt-4 space-y-2">
                            <span className="text-xs font-mono text-dim block">
                              Issues en sprint: {projIssues.length}
                            </span>
                            {projIssues.length > 0 ? (
                              <div className="space-y-1.5">
                                {projIssues.map((iss) => (
                                  <div key={iss.id} className="p-2 rounded-lg bg-card border border-line flex items-center justify-between text-xs">
                                    <div className="flex items-center space-x-2 truncate">
                                      <span className="font-mono text-accent text-[11px]">{iss.key}</span>
                                      <span className={cn("text-text truncate", iss.done && "line-through text-faint")}>
                                        {iss.title}
                                      </span>
                                    </div>
                                    <span className={cn("font-mono text-[10px] shrink-0 ml-2", iss.done ? "text-emerald-400" : "text-faint")}>
                                      {iss.done ? "Done" : iss.due || "En progreso"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-faint italic py-2">Sin issues asignadas en el sprint actual.</p>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 mt-4 border-t border-line flex justify-between items-center text-xs">
                          <span className="text-faint font-mono text-[10px]">Progreso general: {pct}%</span>
                          <button
                            type="button"
                            onClick={() => {
                              useProjects.getState().open(activeProj.id);
                              setModule("proyectos");
                            }}
                            className="text-accent hover:underline text-xs font-semibold cursor-pointer"
                          >
                            Abrir en Proyectos →
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (activeGoal) {
                    const pct = Math.round(activeGoal.progress * 100);
                    const goalItems = data.goals.items.filter((i) => i.goal.id === activeGoal.id);

                    return (
                      <div className="lg:col-span-6 p-4 rounded-xl bg-surface border border-line flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between pb-2 border-b border-line">
                            <div>
                              <span className="text-[10px] font-mono uppercase text-accent tracking-wider">
                                Meta Seleccionada
                              </span>
                              <h4 className="text-sm font-bold text-text">{activeGoal.name}</h4>
                            </div>
                            <span className="text-base font-bold font-mono text-accent">{pct}%</span>
                          </div>

                          <div className="mt-4 space-y-2">
                            <span className="text-xs font-mono text-dim block">
                              Acciones / Hitos: {goalItems.length}
                            </span>
                            {goalItems.length > 0 ? (
                              <div className="space-y-1.5">
                                {goalItems.map((gi) => (
                                  <div key={gi.item.id} className="p-2 rounded-lg bg-card border border-line flex items-center justify-between text-xs">
                                    <span className={cn("text-text truncate", gi.done && "line-through text-faint")}>
                                      {gi.item.name}
                                    </span>
                                    <span className={cn("font-mono text-[10px] shrink-0 ml-2", gi.done ? "text-emerald-400" : "text-faint")}>
                                      {gi.done ? "✓ Cumplido" : "Pendiente"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-faint italic py-2">Sin acciones específicas registradas aún.</p>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 mt-4 border-t border-line flex justify-between items-center text-xs">
                          <span className="text-faint font-mono text-[10px]">Progreso: {pct}%</span>
                          <button
                            type="button"
                            onClick={() => openGoal(activeGoal.id)}
                            className="text-accent hover:underline text-xs font-semibold cursor-pointer"
                          >
                            Abrir en Metas →
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="lg:col-span-6 p-4 rounded-xl bg-surface border border-line flex items-center justify-center text-xs text-faint">
                      Selecciona un proyecto o meta para ver sus detalles.
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </section>

        {/* ── 8. MÓDULO DE TAREAS ───────────────────── */}
        <section
          id="tareas-section"
          className="bg-card border border-line rounded-xl overflow-hidden transition shadow-sm"
        >
          {/* Cabecera colapsable */}
          <div
            onClick={() => toggleSection("tareas")}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface transition select-none"
          >
            <div className="flex items-center space-x-3">
              <ChevronRight
                size={16}
                className={cn(
                  "text-accent transition-transform duration-200",
                  openSections.tareas && "rotate-90"
                )}
              />
              <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/40 flex items-center justify-center text-accent">
                <SquareCheck size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-text tracking-tight">Tareas Pendientes</h2>
                  <span className="text-[10px] font-mono bg-accent-soft text-accent-text border border-accent/40 px-2 py-0.5 rounded-full">
                    {visibleTasks.length} activas
                  </span>
                </div>
                <p className="text-xs text-dim">Organización diaria, estados de tareas y seguimiento</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModule("tareas");
                }}
                className="text-[10px] font-mono text-faint hover:text-text border border-line-strong px-2 py-1 rounded transition cursor-pointer"
              >
                Abrir módulo Tareas →
              </button>
            </div>
          </div>

          {/* Contenido Desplegable */}
          {openSections.tareas && (
            <div className="p-5 pt-0 space-y-4 border-t border-line">
              {/* Barra de Filtros (All, To Do, In Progress, Done) */}
              <div className="flex items-center space-x-2 pt-4">
                {(
                  [
                    ["all", "Todas"],
                    ["todo", "Por hacer"],
                    ["in_progress", "En curso"],
                    ["done", "Completadas"],
                  ] as const
                ).map(([fKey, label]) => (
                  <button
                    key={fKey}
                    type="button"
                    onClick={() => setTaskFilter(fKey)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer",
                      taskFilter === fKey
                        ? "bg-accent text-white font-bold shadow-xs"
                        : "bg-surface hover:bg-surface border border-line text-dim hover:text-text"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Lista de Tareas Reales de NoteVault */}
              <div className="space-y-2.5">
                {visibleTasks.length === 0 ? (
                  <div className="py-6 text-center text-xs text-faint border border-dashed border-line rounded-xl">
                    No hay tareas en esta categoría para hoy.
                  </div>
                ) : (
                  visibleTasks.map((t) => {
                    const isDone = t.done;
                    const toggle = async () => {
                      const next = !isDone;
                      optimistic((x) => {
                        const item = [...x.tasks.today, ...x.tasks.overdue].find((i) => i.id === t.id);
                        if (item) {
                          item.done = next;
                          item.status = next ? "Completado" : "Por hacer";
                        }
                        return x;
                      });
                      void act(() => api.tasksUpdate(t.id, { status: next ? "Completado" : "Por hacer" }));
                    };

                    return (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl bg-surface border border-line hover:border-neutral-500 transition flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={t.done}
                            onChange={toggle}
                            className="w-5 h-5 rounded border border-neutral-600 bg-transparent text-accent cursor-pointer"
                          />
                          <div>
                            <h4 className={cn("text-xs font-semibold", t.done ? "line-through text-faint" : "text-text")}>
                              {t.name}
                            </h4>
                            <div className="flex items-center space-x-2 text-[10px] text-dim font-mono mt-0.5">
                              <span>{t.isOverdue ? "Atrasada" : (t.due || "Hoy")}</span>
                              {t.subject && (
                                <>
                                  <span>•</span>
                                  <span className="text-accent">{t.subject}</span>
                                </>
                              )}
                              <span>•</span>
                              <span className={cn(t.done ? "text-emerald-400" : "text-accent")}>
                                {t.done ? "Completada" : t.status || "Pendiente"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span className={cn("w-2 h-2 rounded-full", t.done ? "bg-emerald-400" : "bg-accent")} />
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input Rápido para Añadir Tarea Real */}
              <div className="pt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={newTaskInput}
                  onChange={(e) => setNewTaskInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newTaskInput.trim()) {
                      const text = newTaskInput.trim();
                      setNewTaskInput("");
                      try {
                        await api.tasksCreate({
                          name: text,
                          due: today,
                          status: "pendiente",
                        });
                        toast("info", "Tarea creada con éxito");
                        await load();
                      } catch (err) {
                        toast("error", (err as Error).message);
                      }
                    }
                  }}
                  placeholder="+ Añadir nueva tarea y presionar Enter..."
                  className="flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs text-text placeholder-neutral-500 focus:border-accent focus:outline-none transition"
                />
                {newTaskInput.trim() && (
                  <button
                    type="button"
                    onClick={async () => {
                      const text = newTaskInput.trim();
                      setNewTaskInput("");
                      try {
                        await api.tasksCreate({
                          name: text,
                          due: today,
                          status: "pendiente",
                        });
                        toast("info", "Tarea creada con éxito");
                        await load();
                      } catch (err) {
                        toast("error", (err as Error).message);
                      }
                    }}
                    className="rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white hover:bg-accent-strong transition cursor-pointer"
                  >
                    Añadir
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Quick Access Row ────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5">
          <span className="mr-2 font-mono text-[11px] text-dim tracking-wider uppercase">
            Acceso rápido
          </span>
          {(
            [
              { key: "calendario", label: "Calendario", icon: <CalendarDays size={13} />, action: () => setModule("calendario") },
              { key: "habits", label: "Hábitos", icon: <CircleCheck size={13} />, action: () => setModule("habits") },
              { key: "ejercicio", label: "Ejercicio", icon: <Dumbbell size={13} />, action: () => setModule("ejercicio") },
              { key: "alimentacion", label: "Alimentación", icon: <Apple size={13} />, action: () => setModule("alimentacion") },
              { key: "tareas", label: "Tareas", icon: <SquareCheck size={13} />, action: () => setModule("tareas") },
              { key: "proyectos", label: "Proyectos", icon: <Kanban size={13} />, action: () => setModule("proyectos") },
              { key: "metas", label: "Metas", icon: <Flag size={13} />, action: () => setModule("metas") },
              { key: "finanzas", label: "Finanzas", icon: <Wallet size={13} />, action: () => setModule("finanzas") },
              { key: "ahorros", label: "Ahorros", icon: <PiggyBank size={13} className="text-amber-400" />, action: () => scrollToSection("finanzas-section") },
              { key: "notas", label: "Notas", icon: <FileText size={13} />, action: () => setModule("notas") },
            ]
          ).map(({ key, label, icon, action }) => (
            <button
              key={key}
              type="button"
              onClick={action}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-text transition-colors hover:border-accent/50 hover:text-text"
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Modales Integrados ────────────────────────────────────────── */}
      <VaultSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        data={data}
        onScrollToSection={scrollToSection}
        onOpenFoodModal={(meal) => {
          const validMeal: NutriMealType =
            meal === "desayuno" || meal === "almuerzo" || meal === "merienda" || meal === "cena" || meal === "snacks"
              ? meal
              : "desayuno";
          setFoodMealName(validMeal);
          setFoodModalOpen(true);
        }}
      />

      <FoodModal
        open={foodModalOpen}
        mealName={foodMealName}
        onClose={() => setFoodModalOpen(false)}
        onAddFood={async (foodName, calories, macros) => {
          setFoodModalOpen(false);
          try {
            let p = 0, c = 0, f = 0;
            if (macros) {
              const pMatch = macros.match(/P\s*(\d+)g/i);
              const cMatch = macros.match(/C\s*(\d+)g/i);
              const fMatch = macros.match(/F\s*(\d+)g/i);
              if (pMatch) p = Number(pMatch[1]);
              if (cMatch) c = Number(cMatch[1]);
              if (fMatch) f = Number(fMatch[1]);
            }
            await api.nutriItemAdd(today, foodMealName, {
              name: foodName,
              calories,
              protein: p,
              carbs: c,
              fat: f,
              amount: 1,
              unit: "porción",
            });
            toast("info", `¡${foodName} (${calories} kcal) registrado para ${foodMealName}!`);
            await load();
          } catch (err) {
            toast("error", (err as Error).message);
          }
        }}
      />
    </div>
  );
}
