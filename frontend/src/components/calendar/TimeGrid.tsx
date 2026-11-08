// Día and Semana: an hour grid. Drag on empty space to create, drag a
// block to move it, drag its bottom edge to change its length.

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtHm, layoutDay, toHm, visible, WEEKDAYS_ES } from "../../lib/calendar";
import { addDays, parseIso } from "../../lib/habits";
import { todayIso } from "../../lib/tasks";
import type { Occurrence } from "../../lib/types";
import { useCalendar, type ZoomInterval } from "../../store/calendar";
import { cn } from "../ui";
import { activate, canDrag, openOccurrenceContextMenu, openSlotContextMenu } from "./actions";

export const ZOOM_CONFIG: Record<ZoomInterval, {
  hourHeight: number;
  intervalMin: number;
  snapMin: number;
  label: string;
}> = {
  60: { hourHeight: 52, intervalMin: 60, snapMin: 15, label: "60 min" },
  45: { hourHeight: 72, intervalMin: 45, snapMin: 15, label: "45 min" },
  30: { hourHeight: 104, intervalMin: 30, snapMin: 15, label: "30 min" },
  15: { hourHeight: 168, intervalMin: 15, snapMin: 15, label: "15 min" },
  10: { hourHeight: 252, intervalMin: 10, snapMin: 5, label: "10 min" },
  5: { hourHeight: 480, intervalMin: 5, snapMin: 5, label: "5 min" },
};

type Drag =
  | { type: "create"; day: string; from: number; to: number }
  | { type: "move"; occ: Occurrence; day: string; start: number; duration: number; grab: number; x0: number; y0: number; moved: boolean }
  | { type: "resize"; occ: Occurrence; start: number; duration: number };

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function TimeGrid({ days }: { days: string[] }) {
  const data = useCalendar((s) => s.days);
  const filters = useCalendar((s) => s.filters);
  const settings = useCalendar((s) => s.settings);
  const setDay = useCalendar((s) => s.setDay);
  const setView = useCalendar((s) => s.setView);
  const openCreate = useCalendar((s) => s.openCreate);
  const editor = useCalendar((s) => s.editor);
  const move = useCalendar((s) => s.move);
  const selectedOccId = useCalendar((s) => s.selectedOccId);
  const zoom = useCalendar((s) => s.zoom);

  const zoomCfg = ZOOM_CONFIG[zoom] ?? ZOOM_CONFIG[60];
  const HOUR = zoomCfg.hourHeight;
  const SNAP = zoomCfg.snapMin;
  const snap = (min: number) => Math.round(min / SNAP) * SNAP;

  const subTicks = useMemo(() => {
    if (zoomCfg.intervalMin >= 60) return [];
    const ticks: number[] = [];
    for (let m = zoomCfg.intervalMin; m < 24 * 60; m += zoomCfg.intervalMin) {
      if (m % 60 !== 0) {
        ticks.push(m);
      }
    }
    return ticks;
  }, [zoomCfg.intervalMin]);

  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const today = todayIso();

  useEffect(() => {
    if (!selectedOccId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-occ="${selectedOccId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedOccId, days, data]);
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const prevHourRef = useRef(HOUR);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const prevH = prevHourRef.current;
    if (prevH !== HOUR) {
      const currentCenterHour = (el.scrollTop + el.clientHeight / 2) / prevH;
      el.scrollTop = currentCenterHour * HOUR - el.clientHeight / 2;
      prevHourRef.current = HOUR;
    }
  }, [HOUR]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, ((settings?.day_start_hour ?? 5) - 0.5) * HOUR);
  }, [settings?.day_start_hour, days.length, HOUR]);

  // Pointer position -> (day, minute) in the grid.
  const locate = (clientX: number, clientY: number): [string, number] => {
    const box = cols.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - box.left) / box.width) * days.length)));
    const min = ((clientY - box.top) / HOUR) * 60;
    return [days[i]!, Math.max(0, Math.min(24 * 60, min))];
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const [day, min] = locate(e.clientX, e.clientY);
      if (d.type === "create") setDrag({ ...d, to: Math.max(d.from + SNAP, snap(min)) });
      else if (d.type === "resize") setDrag({ ...d, duration: Math.max(SNAP, snap(min) - d.start) });
      else {
        const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4;
        const start = Math.max(0, Math.min(24 * 60 - d.duration, snap(min - d.grab)));
        // A routine moves within its day: other days come from the rule.
        setDrag({ ...d, moved, start, day: d.occ.kind === "routine" ? d.occ.date : day });
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.type === "create") openCreate(d.day, d.from, d.to);
      else if (d.type === "resize") void move(d.occ, d.occ.date, toHm(d.start), d.duration);
      else if (d.moved) void move(d.occ, d.day, toHm(d.start), d.duration);
      else activate(d.occ, e);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const perDay = useMemo(
    () => days.map((d) => visible(data[d] ?? [], filters)),
    [days, data, filters],
  );
  const draft = editor?.mode === "create" && editor.item.start ? editor.item : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers and all-day blocks */}
      <div className="flex flex-none border-b border-line pr-[10px]">
        <div className="w-14 flex-none" />
        {days.map((d, i) => {
          const date = parseIso(d);
          const allDay = perDay[i]!.filter((o) => !o.start);
          return (
            <div key={d} className="min-w-0 flex-1 border-l border-line px-1 pb-1.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDay(d);
                  setView("dia");
                }}
                className="flex w-full flex-col items-center"
              >
                <span className={cn("font-mono text-[10.5px] uppercase", d === today ? "text-accent-text" : "text-faint")}>
                  {WEEKDAYS_ES[(date.getDay() + 6) % 7]!.slice(0, 3)}
                </span>
                <span
                  className={cn(
                    "mt-0.5 grid h-8 w-8 place-items-center rounded-full text-[17px]",
                    d === today ? "bg-accent text-white" : "text-text hover:bg-hover",
                  )}
                >
                  {date.getDate()}
                </span>
              </button>
              <div
                className="mt-1 space-y-0.5"
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("[data-occ]")) return;
                  openSlotContextMenu(d, null, e, settings?.default_duration_min ?? 60);
                }}
              >
                {allDay.map((o) => {
                  const isSelected = o.id === selectedOccId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      data-occ={o.id}
                      onClick={(e) => activate(o, e)}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        openOccurrenceContextMenu(o, e);
                      }}
                      className={cn(
                        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11.5px] text-white transition-all",
                        o.done && "line-through opacity-60",
                        isSelected && "ring-2 ring-accent ring-offset-1 ring-offset-surface font-semibold shadow-md",
                      )}
                      style={{ background: o.colour }}
                    >
                      {o.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {/* Hour grid */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: HOUR * 24 }}>
          <div className="relative w-14 flex-none">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-faint" style={{ top: (h + 1) * HOUR }}>
                {h + 1}:00
              </span>
            ))}
            {subTicks.map((m) => {
              const isQuarter = m % 15 === 0;
              return (
                <span
                  key={`sub-${m}`}
                  className={cn(
                    "absolute right-2 -translate-y-1/2 font-mono",
                    isQuarter ? "text-[9.5px] text-faint" : "text-[8.5px] text-faint/50",
                  )}
                  style={{ top: (m / 60) * HOUR }}
                >
                  {fmtHm(m)}
                </span>
              );
            })}
          </div>
          <div ref={cols} className="relative flex flex-1">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR }} />
            ))}
            {subTicks.map((m) => {
              const isQuarter = m % 15 === 0;
              return (
                <div
                  key={`subline-${m}`}
                  className={cn(
                    "pointer-events-none absolute inset-x-0 border-t",
                    isQuarter ? "border-line/45 border-dashed" : "border-line/25 border-dotted",
                  )}
                  style={{ top: (m / 60) * HOUR }}
                />
              );
            })}
            {days.map((d, i) => {
              const placed = layoutDay(perDay[i]!);
              return (
                <div
                  key={d}
                  data-day={d}
                  className="relative min-w-0 flex-1 border-l border-line"
                  onPointerDown={(e) => {
                    if (e.button !== 0 || e.target !== e.currentTarget) return;
                    const [day, min] = locate(e.clientX, e.clientY);
                    const from = Math.min(24 * 60 - SNAP, Math.floor(min / SNAP) * SNAP);
                    setDrag({ type: "create", day, from, to: from + (settings?.default_duration_min ?? 60) });
                  }}
                  onContextMenu={(e) => {
                    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("[data-occ]")) return;
                    const [day, min] = locate(e.clientX, e.clientY);
                    const snapped = snap(min);
                    openSlotContextMenu(day, snapped, e, settings?.default_duration_min ?? 60);
                  }}
                >
                  {placed.map((p) => {
                    const dragging = drag && drag.type !== "create" && drag.occ.id === p.occ.id && drag.occ.date === p.occ.date;
                    if (dragging && drag.type === "move" && drag.moved && drag.day !== d) return null;
                    const start = dragging ? drag.start : p.start;
                    const end = dragging ? drag.start + drag.duration : p.end;
                    const h = Math.max(18, ((end - start) / 60) * HOUR - 2);
                    const isSelected = p.occ.id === selectedOccId;
                    return (
                      <div
                        key={p.occ.id}
                        data-occ={p.occ.id}
                        title={`${p.occ.title} · ${fmtHm(start)} – ${fmtHm(end)}`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          if (!canDrag(p.occ)) {
                            activate(p.occ, e);
                            return;
                          }
                          const [, min] = locate(e.clientX, e.clientY);
                          setDrag({
                            type: "move", occ: p.occ, day: d, start: p.start, duration: p.end - p.start,
                            grab: min - p.start, x0: e.clientX, y0: e.clientY, moved: false,
                          });
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          openOccurrenceContextMenu(p.occ, e);
                        }}
                        className={cn(
                          "absolute cursor-pointer overflow-hidden rounded-md px-1.5 py-0.5 text-[11.5px] leading-tight text-white shadow-sm transition-all",
                          p.occ.done && "opacity-55",
                          dragging && "z-10 ring-2 ring-white/60",
                          isSelected && "z-30 ring-4 ring-accent ring-offset-2 ring-offset-surface shadow-2xl scale-[1.03] animate-pulse",
                        )}
                        style={{
                          top: (start / 60) * HOUR + 1,
                          height: h,
                          left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                          width: `calc(${100 / p.cols}% - 4px)`,
                          background: p.occ.colour,
                        }}
                      >
                        {h < 26 ? (
                          <div className="flex items-center justify-between gap-1 overflow-hidden leading-tight">
                            <span className={cn("truncate font-medium", p.occ.done && "line-through")}>{p.occ.title}</span>
                            <span className="shrink-0 font-mono text-[9.5px] opacity-80">{fmtHm(start)}</span>
                          </div>
                        ) : (
                          <>
                            <div className={cn("truncate font-medium", p.occ.done && "line-through")}>{p.occ.title}</div>
                            <div className="truncate font-mono text-[10px] opacity-85">{fmtHm(start)} – {fmtHm(end)}</div>
                            {p.occ.kind === "integrated_block" && Boolean((p.occ.links?.[0] as Record<string, any> | undefined)?.topicCount) && (
                              <div className="truncate font-mono text-[9px] opacity-90 text-white/95">
                                ⚡ {(p.occ.links[0] as Record<string, any>).topicCount} sub-eventos
                              </div>
                            )}
                          </>
                        )}
                        {canDrag(p.occ) && (
                          <div
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setDrag({ type: "resize", occ: p.occ, start: p.start, duration: p.end - p.start });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {drag?.type === "move" && drag.moved && drag.day === d && drag.occ.date !== d && (
                    <div
                      className="absolute inset-x-0.5 z-10 rounded-md px-1.5 py-0.5 text-[11.5px] text-white ring-2 ring-white/60"
                      style={{ top: (drag.start / 60) * HOUR, height: (drag.duration / 60) * HOUR - 2, background: drag.occ.colour }}
                    >
                      {drag.occ.title}
                    </div>
                  )}
                  {drag?.type === "create" && drag.day === d && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-10 rounded-md bg-accent/80 px-1.5 py-0.5 text-[11.5px] text-white"
                      style={{ top: (drag.from / 60) * HOUR, height: ((drag.to - drag.from) / 60) * HOUR - 2 }}
                    >
                      {fmtHm(drag.from)} – {fmtHm(drag.to)}
                    </div>
                  )}
                  {!drag && draft && draft.date === d && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-10 rounded-md px-1.5 py-0.5 text-[11.5px] text-white opacity-85"
                      style={{
                        top: ((Number(draft.start!.slice(0, 2)) * 60 + Number(draft.start!.slice(3))) / 60) * HOUR,
                        height: ((draft.duration ?? 30) / 60) * HOUR - 2,
                        background: draft.colour ?? "var(--nv-accent)",
                      }}
                    >
                      {draft.title || "(Sin título)"}
                    </div>
                  )}
                  {d === today && (
                    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMin / 60) * HOUR }}>
                      <div className="relative h-0.5 bg-danger">
                        <span className="absolute -left-1.5 -top-[5px] h-3 w-3 rounded-full bg-danger" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function weekDays(day: string): string[] {
  const d = parseIso(day);
  const first = addDays(day, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}
