// Mes: six weeks; a day cell lists its blocks, a click on the date opens Día.

import { fmtHm, toMin, visible } from "../../lib/calendar";
import { addDays, parseIso } from "../../lib/habits";
import { todayIso, WEEKDAYS } from "../../lib/tasks";
import { useCalendar, viewRange } from "../../store/calendar";
import { cn } from "../ui";
import { activate, openOccurrenceContextMenu, openSlotContextMenu } from "./actions";

const MAX = 4;

export function MonthView() {
  const day = useCalendar((s) => s.day);
  const data = useCalendar((s) => s.days);
  const filters = useCalendar((s) => s.filters);
  const setDay = useCalendar((s) => s.setDay);
  const setView = useCalendar((s) => s.setView);
  const openCreate = useCalendar((s) => s.openCreate);
  const selectedOccId = useCalendar((s) => s.selectedOccId);
  const settings = useCalendar((s) => s.settings);
  const [first] = viewRange("mes", day);
  const month = parseIso(day).getMonth();
  const today = todayIso();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-none grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5 text-center font-mono text-[10.5px] uppercase text-faint">{w}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {cells.map((d) => {
          const occs = visible(data[d] ?? [], filters);
          const date = parseIso(d);
          return (
            <div
              key={d}
              data-day={d}
              onDoubleClick={(e) => e.target === e.currentTarget && openCreate(d, 9 * 60, 10 * 60)}
              onContextMenu={(e) => {
                if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("[data-occ]")) return;
                openSlotContextMenu(d, null, e, settings?.default_duration_min ?? 60);
              }}
              className={cn("min-h-0 overflow-hidden border-b border-l border-line p-1", date.getMonth() !== month && "bg-panel/60")}
            >
              <button
                type="button"
                onClick={() => {
                  setDay(d);
                  setView("dia");
                }}
                className={cn(
                  "mx-auto mb-0.5 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px]",
                  d === today ? "bg-accent text-white" : date.getMonth() === month ? "text-text hover:bg-hover" : "text-faint hover:bg-hover",
                )}
              >
                {date.getDate() === 1 ? `${date.getDate()} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][date.getMonth()]}` : date.getDate()}
              </button>
              {occs.slice(0, MAX).map((o) => {
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
                      "flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] leading-[18px] transition-all hover:bg-hover",
                      o.done && "opacity-50 line-through",
                      isSelected && "ring-2 ring-accent ring-offset-1 font-semibold bg-accent-soft text-accent-text shadow-sm",
                    )}
                  >
                  {o.start ? (
                    <>
                      <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: o.colour }} />
                      <span className="text-faint">{fmtHm(toMin(o.start)!)}</span>
                      <span className="truncate text-text">{o.title}</span>
                    </>
                  ) : (
                    <span className="w-full truncate rounded px-1 text-white" style={{ background: o.colour }}>{o.title}</span>
                  )}
                </button>
              );
            })}
              {occs.length > MAX && (
                <button type="button" onClick={() => { setDay(d); setView("dia"); }}
                  className="px-1 text-[11px] text-dim hover:text-text">
                  {occs.length - MAX} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
