import { CalendarDays, CalendarRange, ChevronDown, List, Plus, Settings2, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect } from "react";
import { KIND_FILTERS, MONTHS_ES } from "../../lib/calendar";
import { addDays, parseIso, weekStart } from "../../lib/habits";
import { todayIso } from "../../lib/tasks";
import { useCalendar, type CalView } from "../../store/calendar";
import { ModuleSidebar } from "../ModuleSidebar";
import { openMenu } from "../ui";
import { AgendaView } from "./AgendaView";
import { EventEditor } from "./EventEditor";
import { IntegratedBlockModal } from "./IntegratedBlockModal";
import { MiniMonth } from "./MiniMonth";
import { MonthView } from "./MonthView";
import { RoutinesDialog } from "./RoutinesDialog";
import { TimeGrid, weekDays, ZOOM_CONFIG } from "./TimeGrid";

function title(view: CalView, day: string): string {
  const d = parseIso(day);
  if (view === "dia") return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
  if (view === "semana") {
    const a = parseIso(weekStart(day));
    const b = parseIso(addDays(weekStart(day), 6));
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (a.getMonth() === b.getMonth()) return `${cap(MONTHS_ES[a.getMonth()]!)} de ${a.getFullYear()}`;
    if (a.getFullYear() === b.getFullYear())
      return `${cap(MONTHS_ES[a.getMonth()]!.slice(0, 3))} – ${MONTHS_ES[b.getMonth()]!.slice(0, 3)} de ${b.getFullYear()}`;
    return `${cap(MONTHS_ES[a.getMonth()]!.slice(0, 3))} de ${a.getFullYear()} – ${MONTHS_ES[b.getMonth()]!.slice(0, 3)} de ${b.getFullYear()}`;
  }
  if (view === "mes") return `${MONTHS_ES[d.getMonth()]!.charAt(0).toUpperCase()}${MONTHS_ES[d.getMonth()]!.slice(1)} de ${d.getFullYear()}`;
  return "Agenda";
}

export function CalendarModule() {
  const view = useCalendar((s) => s.view);
  const day = useCalendar((s) => s.day);
  const setView = useCalendar((s) => s.setView);
  const setDay = useCalendar((s) => s.setDay);
  const step = useCalendar((s) => s.step);
  const load = useCalendar((s) => s.load);
  const filters = useCalendar((s) => s.filters);
  const setFilter = useCalendar((s) => s.setFilter);
  const openCreate = useCalendar((s) => s.openCreate);
  const setRoutinesOpen = useCalendar((s) => s.setRoutinesOpen);
  const editorOpen = useCalendar((s) => s.editor !== null);
  const zoom = useCalendar((s) => s.zoom);
  const setZoom = useCalendar((s) => s.setZoom);
  const zoomIn = useCalendar((s) => s.zoomIn);
  const zoomOut = useCalendar((s) => s.zoomOut);

  useEffect(() => {
    void load();
  }, [load]);

  // Google Calendar keys: T today, J/N next, K/P previous, D/W/M/A views, C create.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], .cm-editor")) return;
      const k = e.key.toLowerCase();
      if (k === "t") setDay(todayIso());
      else if (k === "j" || k === "n") step(1);
      else if (k === "k" || k === "p") step(-1);
      else if (k === "d") setView("dia");
      else if (k === "w") setView("semana");
      else if (k === "m") setView("mes");
      else if (k === "a") setView("agenda");
      else if (k === "c") create("event");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const create = (kind: "event" | "task") => {
    const start = Math.min(23 * 60, (new Date().getHours() + 1) * 60);
    const target = view === "semana" && !weekDays(day).includes(todayIso()) ? weekDays(day)[0]! : view === "dia" ? day : todayIso();
    openCreate(target, start, start + 60, kind);
  };

  const navBtn = "grid h-8 w-8 place-items-center rounded-full text-[18px] text-dim hover:bg-hover hover:text-text";

  return (
    <div className="flex min-w-0 flex-1">
      <ModuleSidebar
        title="Calendario"
        active={view}
        onSelect={(id) => setView(id as CalView)}
        items={[
          { id: "dia", label: "Día", icon: <Sun /> },
          { id: "semana", label: "Semana", icon: <CalendarRange /> },
          { id: "mes", label: "Mes", icon: <CalendarDays /> },
          { id: "agenda", label: "Agenda", icon: <List /> },
        ]}
        footer={
          <div className="border-t border-line p-2">
            <button type="button" onClick={() => setRoutinesOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-dim hover:bg-hover hover:text-text">
              <Settings2 size={14} /> Configurar rutinas
            </button>
          </div>
        }
      >
        <div className="space-y-4 pb-4 pt-3">
          <MiniMonth value={day} onPick={setDay} />
          <div className="px-4">
            <div className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">Filtrar por tipo</div>
            {KIND_FILTERS.map(([kind, label, colour]) => (
              <label key={kind} className="flex items-center gap-2 py-0.5 text-[12.5px] text-dim">
                <input type="checkbox" checked={filters[kind] !== false} onChange={(e) => setFilter(kind, e.target.checked)}
                  style={{ accentColor: colour }} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </ModuleSidebar>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex h-14 flex-none items-center gap-2 border-b border-line px-4">
          <button type="button"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => undefined }, [
                { label: "Evento", onSelect: () => create("event") },
                { label: "Tarea", onSelect: () => create("task") },
              ]);
            }}
            className="mr-2 flex items-center gap-2 rounded-2xl bg-card px-4 py-2 text-[13px] font-semibold text-text shadow-md hover:bg-hover">
            <Plus size={18} /> Crear <ChevronDown size={13} className="text-faint" />
          </button>
          <button type="button" onClick={() => setDay(todayIso())}
            className="rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-medium text-text hover:bg-hover">
            Hoy
          </button>
          <button type="button" aria-label="Anterior" onClick={() => step(-1)} className={navBtn}>‹</button>
          <button type="button" aria-label="Siguiente" onClick={() => step(1)} className={navBtn}>›</button>
          <h1 className="ml-2 text-[19px] text-text">{title(view, day)}</h1>

          {(view === "semana" || view === "dia") && (
            <div className="ml-auto flex items-center gap-1 rounded-xl border border-line bg-card/60 p-1">
              <button
                type="button"
                title="Alejar (menos resolución)"
                disabled={zoom === 60}
                onClick={zoomOut}
                className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ZoomOut size={15} />
              </button>
              <button
                type="button"
                title="Cambiar intervalo de tiempo"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  openMenu(
                    { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => undefined },
                    [
                      { label: "60 min (Normal)", onSelect: () => setZoom(60) },
                      { label: "45 min", onSelect: () => setZoom(45) },
                      { label: "30 min", onSelect: () => setZoom(30) },
                      { label: "15 min", onSelect: () => setZoom(15) },
                      { label: "10 min", onSelect: () => setZoom(10) },
                      { label: "5 min (Detalle máx.)", onSelect: () => setZoom(5) },
                    ],
                  );
                }}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11.5px] text-text hover:bg-hover transition-colors"
              >
                <span>{ZOOM_CONFIG[zoom]?.label ?? `${zoom} min`}</span>
                <ChevronDown size={12} className="text-faint" />
              </button>
              <button
                type="button"
                title="Acercar (mayor resolución)"
                disabled={zoom === 5}
                onClick={zoomIn}
                className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ZoomIn size={15} />
              </button>
            </div>
          )}
        </div>
        {view === "dia" ? <TimeGrid days={[day]} />
          : view === "semana" ? <TimeGrid days={weekDays(day)} />
            : view === "mes" ? <MonthView />
              : <AgendaView />}
      </main>
      <EventEditor />
      <IntegratedBlockModal />
      <RoutinesDialog />
    </div>
  );
}
