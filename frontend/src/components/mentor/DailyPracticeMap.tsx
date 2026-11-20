import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Boxes, Check, ChevronDown, ChevronUp, Lock, Maximize2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { areaKataDates, kataForDay } from "../../lib/areaPracticeSystem";
import type { AreaPracticeView } from "../../lib/areaPracticeView";
import type { ChainMonth } from "../../lib/planChain";
import type { MentorPlan } from "../../lib/types";
import { cn } from "../ui";
import { useModuleVisible } from "../ModuleHost";
import { ProgressBar } from "./parts";

/** Mapa interactivo de prácticas diarias vinculadas a los proyectos semanales y mensuales del plan. */
export function DailyPracticeMap({
  plan,
  areas,
  months,
  selectedAreaId,
  onArea,
  onOpen,
  onProjects,
  onInformative,
  onAddMonth,
}: {
  plan: MentorPlan;
  areas: AreaPracticeView[];
  months: ChainMonth[];
  selectedAreaId: string;
  onArea: (areaId: string) => void;
  onOpen: (areaId: string, date: string) => void;
  onProjects: () => void;
  onInformative?: () => void;
  onAddMonth?: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoom, setZoom] = useState(0.85);
  const [monthFilter, setMonthFilter] = useState(months[0]?.id ?? "");
  const [weekFilter, setWeekFilter] = useState(months[0]?.weeks[0]?.id ?? "");
  const [panning, setPanning] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const latestMousePos = useRef<{ clientX: number; clientY: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const visible = useModuleVisible();

  const isMonthUnlocked = (index: number) => months.slice(0, index).every((month) => month.status === "hecho");
  const selectedMonth = months.find((month, index) => month.id === monthFilter && isMonthUnlocked(index)) ?? months[0];
  const selectedWeek = selectedMonth?.weeks.find((week) => week.id === weekFilter) ?? selectedMonth?.weeks[0];
  useEffect(() => {
    if (selectedMonth && selectedMonth.id !== monthFilter) setMonthFilter(selectedMonth.id);
    if (selectedWeek && selectedWeek.id !== weekFilter) setWeekFilter(selectedWeek.id);
  }, [selectedMonth, selectedWeek, monthFilter, weekFilter]);

  // Pre-computar fechas de cada área una sola vez para máximo rendimiento
  const datesByArea = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of areas) {
      map.set(a.areaId, areaKataDates(plan, a.areaId));
    }
    return map;
  }, [plan, areas]);

  const lanes = useMemo(() => {
    if (!selectedMonth || !selectedWeek) return [];

    return areas.map((area) => {
      const completed = new Set(area.kata.completedIndices ?? []);
      const allDates = datesByArea.get(area.areaId) ?? [];
      const items: Array<{
        date: string;
        index: number;
        kata: ReturnType<typeof kataForDay>;
        month: ChainMonth;
        week: ChainMonth["weeks"][number];
        piece: ChainMonth["weeks"][number]["pieces"][number];
        done: boolean;
      }> = [];

      // Fechas de esta área en la semana seleccionada
      const matching: Array<{ date: string; index: number }> = [];
      for (let i = 0; i < allDates.length; i++) {
        const d = allDates[i]!;
        const inWeek =
          selectedWeek.pieces.some((p) => p.date === d) ||
          (Boolean(selectedWeek.start && selectedWeek.end) && d >= selectedWeek.start && d <= selectedWeek.end);
        if (inWeek) {
          matching.push({ date: d, index: i + 1 });
        }
      }

      // Fallback a nivel de mes si la semana no acotaba fechas explícitas
      if (matching.length === 0 && selectedMonth) {
        for (let i = 0; i < allDates.length; i++) {
          const d = allDates[i]!;
          const inMonth =
            (selectedMonth.month && d.startsWith(selectedMonth.month)) ||
            (Boolean(selectedMonth.start && selectedMonth.end) && d >= selectedMonth.start && d <= selectedMonth.end);
          if (inMonth) {
            matching.push({ date: d, index: i + 1 });
          }
        }
      }

      for (let k = 0; k < matching.length; k++) {
        const { date, index } = matching[k]!;
        const kata = kataForDay(area.areaId, index, area.level);
        if (!kata) continue;

        // Toda práctica diaria tiene proyecto vinculado:
        // 1) Pieza explícita para este área y fecha
        // 2) Pieza de esa fecha
        // 3) Pieza de este área en la semana
        // 4) Aportación sintetizada al hito del proyecto semanal y mensual
        const explicitPiece =
          selectedWeek.pieces.find((p) => p.date === date && p.areaIds.includes(area.areaId)) ??
          selectedWeek.pieces.find((p) => p.date === date) ??
          selectedWeek.pieces.find((p) => p.areaIds.includes(area.areaId));

        const piece: ChainMonth["weeks"][number]["pieces"][number] = explicitPiece ?? {
          id: `piece:${selectedWeek.id}:${area.areaId}:${date}`,
          date,
          n: k + 1,
          of: Math.max(1, matching.length),
          title: `Aportación de ${area.label}: ${kata.title}`,
          description: `Práctica diaria de ${area.label} (${kata.skillName || kata.title}) que consolida el hito semanal «${selectedWeek.title}».`,
          slice: `Hito semanal: ${selectedWeek.title}`,
          areaIds: [area.areaId],
          done: completed.has(index),
          status: completed.has(index) ? ("hecho" as const) : ("pendiente" as const),
          current: !completed.has(index),
        };

        items.push({
          date,
          index,
          kata,
          month: selectedMonth,
          week: selectedWeek,
          piece,
          done: completed.has(index),
        });
      }

      return { area, items };
    });
  }, [areas, datesByArea, selectedMonth, selectedWeek]);

  const lane = lanes.find((item) => item.area.areaId === selectedAreaId) ?? lanes[0];
  const item =
    lane?.items.find((x) => x.index === selectedIndex) ??
    lane?.items.find((x) => !x.done) ??
    lane?.items[0];

  // Un mes a la vez; el proyecto semanal elegido despliega sus áreas y retos vinculados
  const graph = useMemo(() => {
    type Point = { x: number; y: number };
    const nodes: { area: AreaPracticeView; item: (typeof lanes)[number]["items"][number]; x: number; y: number; color: string }[] = [];
    const areaNodes: { area: AreaPracticeView; x: number; y: number; color: string }[] = [];
    const edges: { key: string; from: Point; to: Point; color?: string }[] = [];
    const colors = ["#9b87f5", "#60a5fa", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#fb923c"];
    const center = { x: 1000, y: 950 };
    const weeks = selectedMonth?.weeks ?? [];
    const weeksRadius = Math.max(380, weeks.length * 80);
    const weekly = weeks.map((week, index) => {
      const a = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(weeks.length, 1);
      const point = { x: center.x + weeksRadius * Math.cos(a), y: center.y + weeksRadius * Math.sin(a) };
      edges.push({ key: `month:${week.id}`, from: center, to: point });
      return { week, ...point };
    });
    const hub = weekly.find((week) => week.week.id === selectedWeek?.id);
    const groups = lanes.filter((lane) => lane.items.length > 0);
    if (hub && groups.length > 0) {
      // Radio hacia los nodos de área
      const areaRadius = Math.max(240, groups.length * 50);
      groups.forEach((group, index) => {
        const color = colors[areas.findIndex((area) => area.areaId === group.area.areaId) % colors.length] ?? "#9b87f5";
        const a = -Math.PI / 2 + (index * 2 * Math.PI) / groups.length;
        const areaPoint = { x: hub.x + areaRadius * Math.cos(a), y: hub.y + areaRadius * Math.sin(a) };
        areaNodes.push({ area: group.area, ...areaPoint, color });
        edges.push({ key: `${hub.week.id}:${group.area.areaId}`, from: hub, to: areaPoint, color });
        const practices = group.items;
        // Radio para los retos del área
        const radius = Math.max(120, practices.length * 20);
        practices.forEach((practiceItem, i) => {
          // Desfase en a para que los nodos no caigan sobre la línea de unión del hub
          const angle = a + ((i + 0.5) * 2 * Math.PI) / practices.length;
          const point = { x: areaPoint.x + radius * Math.cos(angle), y: areaPoint.y + radius * Math.sin(angle) };
          nodes.push({ area: group.area, item: practiceItem, ...point, color });
          edges.push({ key: `${group.area.areaId}:${practiceItem.index}`, from: areaPoint, to: point, color });
        });
      });
    }

    const unlinked = lanes.flatMap((lane) => lane.items.filter((item) => !item.week).map((item) => ({ area: lane.area, item })));
    unlinked.forEach((practice, index) =>
      nodes.push({ ...practice, x: 100 + (index % 5) * 160, y: 1650 + Math.floor(index / 5) * 80, color: "#8992a5" })
    );

    return {
      nodes,
      areaNodes,
      weekly,
      center,
      edges,
      width: 2000,
      height: unlinked.length > 0 ? Math.max(1900, 1700 + Math.ceil(unlinked.length / 5) * 80) : 1900,
      hasUnlinked: unlinked.length > 0,
    };
  }, [lanes, areas, selectedMonth, selectedWeek]);
  const { width, height } = graph;

  useEffect(() => {
    window.nv?.setInteractiveRouteActive?.(visible);
    if (!visible) return;
    const unsubscribe = window.nv?.onInteractiveRouteZoom?.((action) => {
      setZoom((z) => (action === "in" ? Math.min(2.5, +(z + 0.25).toFixed(2)) : Math.max(0.25, +(z - 0.25).toFixed(2))));
    });
    return () => {
      unsubscribe?.();
      window.nv?.setInteractiveRouteActive?.(false);
    };
  }, [visible]);

  useEffect(() => {
    const box = rail.current;
    const hub = graph.weekly.find((w) => w.week.id === selectedWeek?.id);
    const target = hub ?? graph.center;
    if (box && target && typeof box.scrollTo === "function") {
      box.scrollTo({
        left: Math.max(0, target.x * zoom - box.clientWidth / 2),
        top: Math.max(0, target.y * zoom - box.clientHeight / 2),
        behavior: "auto"
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth?.id, selectedWeek?.id]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const editable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (event.code === "Space" && !editable) {
        held.current = true;
        event.preventDefault();
      }
      if (visible && event.ctrlKey && !event.altKey && !event.metaKey && !editable) {
        if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
          event.preventDefault();
          setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)));
        } else if (event.key === "-" || event.key === "−" || event.code === "NumpadSubtract") {
          event.preventDefault();
          setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        held.current = false;
        drag.current = null;
        setPanning(false);
      }
    };
    const blur = () => {
      held.current = false;
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [visible]);

  // Soporte de zoom con rueda y trackpad pinch
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setZoom((z) => Math.min(2.5, Math.max(0.25, +(z + delta).toFixed(2))));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    const isButton = (event.target as HTMLElement).closest("button");
    if (isButton && !held.current) return;
    if (event.button !== 0 && event.button !== 1) return;
    const box = rail.current;
    if (!box) return;
    drag.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
    latestMousePos.current = { clientX: event.clientX, clientY: event.clientY };
    setPanning(true);
    box.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !rail.current) return;
    latestMousePos.current = { clientX: event.clientX, clientY: event.clientY };
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (!drag.current || !rail.current || !latestMousePos.current) return;
      const dx = latestMousePos.current.clientX - drag.current.x;
      const dy = latestMousePos.current.clientY - drag.current.y;
      rail.current.scrollLeft = drag.current.left - dx;
      rail.current.scrollTop = drag.current.top - dy;
    });
  };

  const stop = () => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    drag.current = null;
    latestMousePos.current = null;
    setPanning(false);
  };

  return (
    <section className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-panel" data-testid="daily-practice-map">
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-card px-4 py-2.5">
        <div className="min-w-40 flex-1">
          <h2 className="font-bold text-text">Mapa de prácticas diarias</h2>
          <p className="text-xs text-dim">Centro: proyecto mensual · elige un proyecto semanal para ver sus áreas · Arrastra para explorar</p>
        </div>
        <nav className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface/60 p-1" aria-label="Elegir mes del proyecto">
          {months.map((month, index) => {
            const unlocked = isMonthUnlocked(index);
            const isSelected = selectedMonth?.id === month.id;
            return (
              <button
                key={month.id}
                type="button"
                disabled={!unlocked}
                aria-pressed={isSelected}
                title={unlocked ? (month.title || `Mes ${month.n ?? index + 1}`) : `Completa el mes ${index} para desbloquearlo`}
                onClick={() => {
                  setMonthFilter(month.id);
                  setWeekFilter(month.weeks[0]?.id ?? "");
                  setSelectedIndex(0);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  isSelected
                    ? "bg-accent text-white shadow-sm font-semibold"
                    : "text-dim hover:text-text hover:bg-hover",
                  !unlocked && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-dim"
                )}
              >
                <span>Mes {month.n ?? index + 1}</span>
                {!unlocked && <Lock size={11} aria-hidden className="shrink-0 opacity-70" />}
              </button>
            );
          })}
          {onAddMonth && (
            <button
              type="button"
              onClick={onAddMonth}
              title="Añadir otro mes de práctica a la ruta"
              aria-label="Añadir mes de práctica"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-hover hover:text-text transition-colors"
            >
              <Plus size={12} aria-hidden />
              <span>Añadir mes</span>
            </button>
          )}
        </nav>
        {onInformative && (
          <button type="button" onClick={onInformative} className="rounded-lg border border-line px-3 py-1.5 text-sm text-text hover:bg-hover">
            Vista informativa
          </button>
        )}
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
          aria-label="Alejar mapa"
          className="rounded-lg p-2 text-text hover:bg-hover"
        >
          <ZoomOut size={18} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(0.75)}
          aria-label="Restablecer zoom del mapa"
          className="rounded-lg p-2 text-text hover:bg-hover"
        >
          <Maximize2 size={18} />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
          aria-label="Acercar mapa"
          className="rounded-lg p-2 text-text hover:bg-hover"
        >
          <ZoomIn size={18} />
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-card px-4 py-2" aria-label="Áreas de prácticas">
        {lanes.map(({ area, items }) => (
          <button
            key={area.areaId}
            type="button"
            data-testid="daily-map-area"
            data-area={area.areaId}
            aria-pressed={lane?.area.areaId === area.areaId}
            onClick={() => {
              setSelectedIndex(items[0]?.index ?? 0);
              onArea(area.areaId);
            }}
            className="rounded-full border border-line px-3 py-1 text-xs text-dim aria-pressed:border-accent aria-pressed:text-accent-text"
          >
            {area.label} · {items.filter((item) => item.done).length}/{items.length}
          </button>
        ))}
      </div>
      <div
        ref={rail}
        role="region"
        tabIndex={0}
        aria-label="Mapa de prácticas diarias por área"
        data-testid="daily-practice-rail"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        className={cn(
          "relative min-h-0 flex-1 overflow-auto bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          panning ? "cursor-grabbing select-none" : "cursor-grab",
        )}
      >
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="relative" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              width={width}
              height={height}
            >
              {graph.edges.map((edge) => (
                <line
                  key={edge.key}
                  data-testid="daily-map-edge"
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={edge.color ?? "var(--nv-accent)"}
                  strokeWidth={1.5}
                  strokeOpacity={0.55}
                />
              ))}
            </svg>
            {selectedMonth && (
              <button
                type="button"
                data-testid="daily-map-project"
                onClick={onProjects}
                className="absolute z-10 flex w-44 -translate-x-1/2 flex-col items-center text-center"
                style={{ left: graph.center.x, top: graph.center.y - 30 }}
                aria-label={`Abrir proyecto mensual ${selectedMonth.title}`}
              >
                <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-mint/50 bg-mint text-bg shadow-lg">
                  <Boxes size={24} aria-hidden />
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase text-mint">Proyecto mensual</span>
                <span className="line-clamp-2 text-xs font-semibold text-text">{selectedMonth.title}</span>
              </button>
            )}
            {graph.weekly.map(({ week, x, y }, index) => (
              <button
                key={week.id}
                type="button"
                data-testid="daily-map-week"
                aria-pressed={selectedWeek?.id === week.id}
                aria-label={`Ver prácticas del proyecto semanal ${week.title}`}
                onClick={() => {
                  setWeekFilter(week.id);
                  setSelectedIndex(0);
                }}
                className="absolute z-10 flex w-40 -translate-x-1/2 flex-col items-center text-center"
                style={{ left: x, top: y - 24 }}
              >
                <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-accent bg-card text-accent-text aria-pressed:bg-accent">
                  <Boxes size={18} aria-hidden />
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase text-accent-text">Proyecto semanal {index + 1}</span>
                <span className="line-clamp-2 text-xs font-medium text-text">{week.title}</span>
              </button>
            ))}
            {graph.areaNodes.map(({ area, x, y, color }) => (
              <button
                key={area.areaId}
                type="button"
                data-testid="daily-map-area-node"
                onClick={() => {
                  setSelectedIndex(0);
                  onArea(area.areaId);
                }}
                className="absolute z-10 flex w-36 -translate-x-1/2 flex-col items-center text-center cursor-pointer group"
                style={{ left: x, top: y - 18 }}
              >
                <span
                  className="grid h-9 w-9 place-items-center rounded-full border-2 bg-card shadow-sm transition-transform duration-150 group-hover:scale-115"
                  style={{ borderColor: color, boxShadow: `0 0 0 5px ${color}22` }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                </span>
                <span className="mt-1.5 text-xs font-bold tracking-wide" style={{ color }}>{area.label}</span>
              </button>
            ))}
            {graph.hasUnlinked && <p className="absolute left-[80px] top-[1620px] text-xs font-semibold text-faint">Prácticas sin proyecto vinculado</p>}
            {graph.nodes.map(({ area, item: practice, x, y, color }) => {
              const active = area.areaId === lane?.area.areaId && practice.index === item?.index;
              return (
                <button
                  key={`${area.areaId}:${practice.index}`}
                  type="button"
                  data-testid="daily-map-node"
                  aria-pressed={active}
                  aria-label={`${area.label}: práctica ${practice.index}, ${practice.kata!.title}, ${practice.done ? "completada" : "pendiente"}`}
                  onClick={() => {
                    setSelectedIndex(practice.index);
                    onArea(area.areaId);
                  }}
                  className="absolute z-10 flex w-36 -translate-x-1/2 flex-col items-center text-center cursor-pointer group"
                  style={{ left: x, top: y - 10 }}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full border-2 transition-transform duration-150 group-hover:scale-125",
                      active && "ring-4 ring-accent/35 scale-110"
                    )}
                    style={{ borderColor: color, backgroundColor: practice.done || active ? color : "var(--nv-card)" }}
                  >
                    {practice.done && <Check size={11} aria-hidden />}
                  </span>
                  <span className="mt-1.5 line-clamp-2 max-w-[130px] text-[11px] font-medium leading-tight text-text/85 group-hover:text-text transition-colors">
                    {practice.kata!.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <section
        className={cn(
          "relative z-20 flex shrink-0 flex-col border-t border-line bg-card/95 backdrop-blur px-4 py-2 transition-all shadow-md",
          detailCollapsed ? "py-1.5" : "gap-2 py-2.5"
        )}
        aria-live="polite"
        data-testid="daily-map-detail"
      >
        {lane && item?.kata ? (
          <>
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-text uppercase">
                  {lane.area.label} · {item.done ? "Completada" : "Pendiente"}
                </span>
                <h3 className="truncate text-sm font-semibold text-text">{item.kata.title}</h3>
                <span className="hidden md:inline truncate text-xs text-dim">· {item.kata.skillName}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpen(lane.area.areaId, item.date)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong"
                >
                  <BookOpen size={13} aria-hidden /> Abrir práctica
                </button>
                <button
                  type="button"
                  data-testid="daily-map-detail-toggle"
                  onClick={() => setDetailCollapsed((c) => !c)}
                  aria-label={detailCollapsed ? "Expandir detalles del proyecto" : "Minimizar panel"}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-dim hover:text-text hover:bg-hover"
                >
                  {detailCollapsed ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                  <span className="hidden sm:inline">{detailCollapsed ? "Proyecto" : "Minimizar"}</span>
                </button>
              </div>
            </div>

            {!detailCollapsed && (
              item.month && item.piece ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface/70 px-3 py-2 text-xs"
                  data-testid="daily-map-linked-project"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-mint truncate max-w-xs">{item.month.title}</span>
                    <span className="text-dim">·</span>
                    <span className="font-medium text-text truncate max-w-xs">{item.week?.title}</span>
                    <span className="text-dim">·</span>
                    <span className="text-dim truncate">
                      <strong className="text-text font-medium">Aportación:</strong> {item.piece.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-28 shrink-0">
                      <ProgressBar pct={item.month.pct} label="Avance" />
                    </div>
                    <button type="button" onClick={onProjects} className="font-semibold text-accent-text hover:underline text-xs">
                      Ver proyecto →
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-dim" data-testid="daily-map-unlinked">
                  Esta práctica todavía no tiene una aportación de proyecto mensual vinculada en el plan.
                </p>
              )
            )}
          </>
        ) : (
          <p className="text-sm text-dim">No hay prácticas en esta selección para el área elegida; elige otra área o cambia los filtros.</p>
        )}
      </section>
    </section>
  );
}