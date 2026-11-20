import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Flame, Layers, Sparkles, TrendingUp } from "lucide-react";
import { addDays, weekStart } from "../../lib/habits";
import { MONTHS, todayIso } from "../../lib/tasks";
import { useHabits } from "../../store/habits";
import { cn } from "../ui";

// GitHub-style contribution palette: Vibrant, clearly illuminated green levels (never dull/black on dark background)
const GREEN_LEVELS = [
  "#161b22", // Level 0: Empty / Inactive (0 habits completed)
  "#1f883d", // Level 1: At least 1 habit completed / low percentage (vibrant emerald green, clearly visible, never black)
  "#2ea043", // Level 2: Medium progress (34% to 66%)
  "#3fb950", // Level 3: High progress (67% to 99%)
  "#39d353", // Level 4: Full bright green (100% completed)
];

export interface HabitHeatmapProps {
  activeDay?: string;
  onSelectDay?: (day: string) => void;
  className?: string;
  initialMode?: "general" | "individual";
  initialHabitId?: string;
}

export function HabitHeatmap({
  activeDay,
  onSelectDay,
  className,
  initialMode = "general",
  initialHabitId,
}: HabitHeatmapProps) {
  const habits = useHabits((s) => s.habits);
  const rows = useHabits((s) => s.rows);
  const loadRange = useHabits((s) => s.loadRange);
  const storeSetDay = useHabits((s) => s.setDay);

  const [mode, setMode] = useState<"general" | "individual">(initialMode);
  const [selectedHabitId, setSelectedHabitId] = useState<string>(
    () => initialHabitId || habits[0]?.id || "",
  );

  // Sync selectedHabitId if habits change or initialHabitId arrives
  useEffect(() => {
    if (!selectedHabitId && habits.length > 0) {
      setSelectedHabitId(habits[0]!.id);
    }
  }, [habits, selectedHabitId]);

  const today = todayIso();
  const currentWeekMon = weekStart(today);
  const firstWeekMon = useMemo(() => addDays(currentWeekMon, -52 * 7), [currentWeekMon]);

  useEffect(() => {
    void loadRange(firstWeekMon, today);
  }, [firstWeekMon, today, loadRange]);

  // Build 53 columns (weeks), each with 7 days (Monday=0 to Sunday=6)
  const weeks = useMemo(() => {
    const list: string[][] = [];
    for (let w = 0; w < 53; w++) {
      const weekDays: string[] = [];
      for (let d = 0; d < 7; d++) {
        weekDays.push(addDays(firstWeekMon, w * 7 + d));
      }
      list.push(weekDays);
    }
    return list;
  }, [firstWeekMon]);

  // Compute month labels aligned with column indices
  const monthLabels = useMemo(() => {
    const labels: Array<{ col: number; text: string }> = [];
    let lastMonth = -1;
    weeks.forEach((week, colIdx) => {
      const firstDayOfWeek = week[0]!;
      const m = Number(firstDayOfWeek.slice(5, 7)) - 1;
      // When month changes and not too close to the previous label
      if (m !== lastMonth && (labels.length === 0 || colIdx - labels[labels.length - 1]!.col >= 3)) {
        labels.push({ col: colIdx, text: MONTHS[m]!.slice(0, 3) });
        lastMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  // Tooltip state
  const [hoveredCell, setHoveredCell] = useState<{
    date: string;
    text: string;
    subText?: string;
    x: number;
    y: number;
  } | null>(null);

  // Stats calculation
  const stats = useMemo(() => {
    let daysWithTarget = 0;
    let daysActive = 0;
    let streak = 0;
    let maxStreak = 0;
    let curRunningStreak = 0;

    const allDays: string[] = [];
    for (let d = firstWeekMon; d <= today; d = addDays(d, 1)) {
      allDays.push(d);
    }

    allDays.forEach((d) => {
      const r = rows[d];
      let fulfilled = false;
      let wasScheduled = false;

      if (mode === "general") {
        const actCount = r?.active?.length ?? 0;
        const doneCount = r?.done?.length ?? 0;
        if (actCount > 0) {
          wasScheduled = true;
          // "la general por obvias razones solo si se cumplen la mayoria de habitos"
          if (doneCount > actCount / 2) {
            fulfilled = true;
          }
        }
      } else {
        const hId = selectedHabitId;
        const actCount = r?.active?.length ?? 0;
        if (actCount > 0 && r?.active?.includes(hId)) {
          wasScheduled = true;
        }
        // "la de habito individual se pone verde con un solo cumplimiento"
        if (r?.done?.includes(hId)) {
          fulfilled = true;
        }
      }

      if (wasScheduled || fulfilled) {
        daysActive++;
      }

      if (fulfilled) {
        daysWithTarget++;
        curRunningStreak++;
        if (curRunningStreak > maxStreak) maxStreak = curRunningStreak;
      } else {
        curRunningStreak = 0;
      }
    });

    streak = curRunningStreak;

    const rate = daysActive > 0 ? Math.round((daysWithTarget / daysActive) * 100) : 0;
    return { daysWithTarget, daysActive, streak, maxStreak, rate };
  }, [firstWeekMon, today, rows, mode, selectedHabitId]);

  const selectedHabit = habits.find((h) => h.id === selectedHabitId);

  // Auto-scroll to end (most recent weeks) on mount
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  const handleCellClick = (d: string) => {
    if (d > today) return;
    if (onSelectDay) {
      onSelectDay(d);
    } else {
      void storeSetDay(d);
    }
  };

  const dayNames = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div
      className={cn(
        "rounded-lg border border-border-subtle bg-dark-surface-variant/40 p-4 transition-all w-full",
        className,
      )}
    >
      {/* Header controls & stats */}
      <div className="flex flex-col gap-3 pb-3 border-b border-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-headline text-body-md font-semibold text-white">
            <TrendingUp size={17} className="text-accent" />
            <span>Matriz de Actividad y Hábitos</span>
          </div>

          {/* Mode segmented switch */}
          <div className="flex items-center rounded-md border border-border-subtle bg-dark-surface p-0.5 text-label-sm font-label">
            <button
              type="button"
              onClick={() => setMode("general")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium cursor-pointer",
                mode === "general"
                  ? "bg-accent text-white shadow-xs"
                  : "text-dark-on-surface-variant hover:text-dark-on-surface",
              )}
            >
              <Layers size={13} />
              <span>General (Todos)</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("individual")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium cursor-pointer",
                mode === "individual"
                  ? "bg-accent text-white shadow-xs"
                  : "text-dark-on-surface-variant hover:text-dark-on-surface",
              )}
            >
              <CheckCircle2 size={13} />
              <span>Hábito individual</span>
            </button>
          </div>

          {/* Habit selector when individual mode is active */}
          {mode === "individual" && (
            <div className="relative inline-flex items-center">
              <select
                value={selectedHabitId}
                onChange={(e) => setSelectedHabitId(e.target.value)}
                className="appearance-none rounded-md border border-border-strong bg-dark-surface pl-2.5 pr-7 py-1 text-label-sm font-medium text-dark-on-surface outline-none focus:border-accent cursor-pointer transition-colors"
                aria-label="Seleccionar hábito individual"
              >
                {habits.map((h) => (
                  <option key={h.id} value={h.id} className="bg-dark-surface text-dark-on-surface">
                    {h.icon ? `${h.icon} ` : ""}{h.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="pointer-events-none absolute right-2 text-dark-on-surface-variant"
              />
            </div>
          )}
        </div>

        {/* Quick metrics banner */}
        <div className="flex items-center gap-3 text-label-sm font-code text-dark-on-surface-variant">
          <div className="flex items-center gap-1 bg-dark-surface px-2 py-0.5 rounded border border-border-subtle">
            <Flame size={13} className="text-warning" />
            <span className="text-dark-on-surface font-semibold">{stats.streak}</span>
            <span>racha actual</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 bg-dark-surface px-2 py-0.5 rounded border border-border-subtle">
            <Sparkles size={13} className="text-success" />
            <span className="text-dark-on-surface font-semibold">{stats.daysWithTarget}</span>
            <span>días cumplidos</span>
          </div>
          <div className="flex items-center gap-1 bg-dark-surface px-2 py-0.5 rounded border border-border-subtle">
            <span className="text-dark-on-surface font-semibold">{stats.rate}%</span>
            <span>consistencia</span>
          </div>
        </div>
      </div>

      {/* Dynamic Heatmap Grid container */}
      <div className="pt-3">
        <div
          ref={scrollRef}
          className="w-full overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border-subtle"
        >
          <div className="min-w-[760px] flex flex-col gap-1 select-none">
            {/* Month labels row */}
            <div className="flex text-[11px] font-code text-dark-on-surface-variant/80 pl-6 h-4 relative">
              {monthLabels.map((lbl) => (
                <span
                  key={`${lbl.col}-${lbl.text}`}
                  className="absolute"
                  style={{ left: `${24 + lbl.col * 14}px` }}
                >
                  {lbl.text}
                </span>
              ))}
            </div>

            {/* Grid rows (Days of the week x Weeks) */}
            <div className="flex gap-1.5 items-start">
              {/* Day of week labels (L, M, X, J, V, S, D) */}
              <div className="flex flex-col gap-[3px] text-[10px] font-code text-dark-on-surface-variant/70 pr-1 select-none">
                {dayNames.map((name, i) => (
                  <span
                    key={name + i}
                    className="h-[11px] leading-[11px] text-center w-4"
                    title={["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i]}
                  >
                    {i % 2 === 0 ? name : ""}
                  </span>
                ))}
              </div>

              {/* Heatmap columns */}
              <div className="flex gap-[3px] flex-1">
                {weeks.map((week) => (
                  <div key={week[0]} className="flex flex-col gap-[3px]">
                    {week.map((d) => {
                      const r = rows[d];
                      const isFuture = d > today;
                      const isCurrentActiveDay = d === activeDay;

                      let cellLevel = 0;
                      let tooltipTitle = d;
                      let tooltipSub = "";

                      if (isFuture) {
                        tooltipTitle = `${d} · Futuro`;
                      } else if (mode === "general") {
                        const actCount = r?.active?.length ?? 0;
                        const doneCount = r?.done?.length ?? 0;

                        if (doneCount === 0) {
                          cellLevel = 0;
                          tooltipTitle = `${d} · 0/${actCount} hábitos`;
                          tooltipSub = actCount === 0 ? "Sin hábitos programados" : "Sin hábitos completados";
                        } else {
                          const pct = actCount > 0 ? doneCount / actCount : 1;
                          if (pct >= 1) {
                            cellLevel = 4;
                            tooltipSub = "¡Completado al 100%! ✓";
                          } else if (pct >= 0.67) {
                            cellLevel = 3;
                            tooltipSub = "Gran avance (>66%) ✓";
                          } else if (pct >= 0.34) {
                            cellLevel = 2;
                            tooltipSub = "Buen progreso en marcha";
                          } else {
                            // Con al menos 1 tarea se ilumina de forma visible (Nivel 1, nunca negro)
                            cellLevel = 1;
                            tooltipSub = "Iniciado (al menos 1 hábito cumplido)";
                          }

                          tooltipTitle = `${d} · ${doneCount}/${actCount} hábitos (${Math.round(pct * 100)}%)`;
                        }
                      } else {
                        // Individual habit mode
                        const hId = selectedHabitId;
                        const isDone = Boolean(r?.done?.includes(hId));
                        const isScheduled = Boolean(r?.active?.includes(hId));
                        const habitName = selectedHabit?.name || "Hábito";

                        if (isDone) {
                          // Con 1 cumplimiento se ilumina al verde más brillante
                          cellLevel = 4;
                          tooltipTitle = `${d} · ${selectedHabit?.icon ? `${selectedHabit.icon} ` : ""}${habitName}`;
                          tooltipSub = "Cumplido ✓";
                        } else {
                          cellLevel = 0;
                          tooltipTitle = `${d} · ${selectedHabit?.icon ? `${selectedHabit.icon} ` : ""}${habitName}`;
                          tooltipSub = isScheduled ? "No completado" : "No programado";
                        }
                      }

                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={isFuture}
                          onClick={() => handleCellClick(d)}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredCell({
                              date: d,
                              text: tooltipTitle,
                              subText: tooltipSub,
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                            });
                          }}
                          onMouseLeave={() => setHoveredCell(null)}
                          className={cn(
                            "h-[11px] w-[11px] rounded-[2px] transition-transform duration-75 cursor-pointer relative",
                            isFuture ? "opacity-20 cursor-default" : "hover:scale-125 hover:z-10",
                            isCurrentActiveDay && "ring-1.5 ring-accent ring-offset-1 ring-offset-dark-surface z-5",
                          )}
                          style={{
                            backgroundColor: isFuture ? "#12141a" : GREEN_LEVELS[cellLevel],
                            boxShadow:
                              !isFuture && cellLevel >= 3
                                ? "0 0 5px rgba(57, 211, 83, 0.45)"
                                : undefined,
                            border:
                              cellLevel === 0 && !isFuture
                                ? "1px solid rgba(255, 255, 255, 0.05)"
                                : undefined,
                          }}
                          aria-label={tooltipTitle}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Floating Tooltip */}
        {hoveredCell && (
          <div
            className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-full mb-1.5 px-2.5 py-1.5 rounded bg-dark-surface/95 border border-border-strong text-dark-on-surface shadow-lg text-[11.5px] font-medium backdrop-blur-xs flex flex-col gap-0.5 whitespace-nowrap animate-in fade-in zoom-in-95 duration-100"
            style={{ left: `${hoveredCell.x}px`, top: `${hoveredCell.y - 8}px` }}
          >
            <div className="font-semibold text-white">{hoveredCell.text}</div>
            {hoveredCell.subText && (
              <div className="text-dark-on-surface-variant text-[10.5px]">
                {hoveredCell.subText}
              </div>
            )}
            <div className="text-[10px] text-accent font-code pt-0.5">
              Haz clic para ver este día
            </div>
          </div>
        )}

        {/* Footer legend & rule guidance */}
        <div className="mt-2.5 pt-2 border-t border-border-subtle/50 flex flex-wrap items-center justify-between text-[11px] text-dark-on-surface-variant font-code gap-2">
          <div className="flex items-center gap-1.5">
            {mode === "general" ? (
              <span>
                Progreso: <span className="text-success font-medium">Iluminación proporcional</span> (verde visible desde 1 hábito cumplido).
              </span>
            ) : (
              <span>
                Hábito individual: <span className="text-success font-medium">Verde brillante</span> con <strong className="text-white">1 solo cumplimiento</strong> de {selectedHabit?.name || "el hábito"}.
              </span>
            )}
          </div>

          {/* GitHub-style Less / More Legend */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span>Menos</span>
            {GREEN_LEVELS.map((color, idx) => (
              <span
                key={color + idx}
                className="h-[10px] w-[10px] rounded-[2px]"
                style={{
                  backgroundColor: color,
                  border: idx === 0 ? "1px solid rgba(255, 255, 255, 0.08)" : undefined,
                }}
                title={`Nivel ${idx}`}
              />
            ))}
            <span>Más</span>
          </div>
        </div>
      </div>
    </div>
  );
}

