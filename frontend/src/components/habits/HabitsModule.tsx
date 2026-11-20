import { BarChart3, CalendarDays, CalendarRange, LayoutGrid, ListChecks, Settings2, Sun } from "lucide-react";
import { useEffect } from "react";
import { pct } from "../../lib/habits";
import { useHabits, type HabitsView } from "../../store/habits";
import { ModuleSidebar } from "../ModuleSidebar";
import { HabitDaily } from "./HabitDaily";
import { HabitMonth, HabitWeek } from "./HabitGrid";
import { HabitManage } from "./HabitManage";
import { HabitOverview } from "./HabitOverview";
import { HabitYear } from "./HabitYear";
import { Empty } from "./parts";

function SideStats() {
  const stats = useHabits((s) => s.stats);
  const log = useHabits((s) => s.log);
  const activeCount = log?.active?.length ?? 0;
  const doneCount = log ? log.active.filter((id) => log.completed[id]).length : 0;
  const todayPct = activeCount > 0 ? doneCount / activeCount : (stats?.day ?? 0);

  return (
    <div className="mx-2.5 my-2 p-3 rounded-md bg-dark-surface border border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] font-mono font-semibold text-dark-on-surface-variant uppercase tracking-wider">
          Estadísticas
        </span>
        <BarChart3 size={13} className="text-dark-on-surface-variant" />
      </div>
      <div className="space-y-2 text-[12px]">
        <div>
          <div className="flex items-center justify-between text-dark-on-surface-variant mb-1">
            <span>Hoy</span>
            <span className="font-code text-[11px] text-dark-on-surface">
              {pct(todayPct)} {activeCount > 0 ? `(${doneCount}/${activeCount})` : ""}
            </span>
          </div>
          <div className="w-full h-1.5 bg-dark-surface-variant rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${Math.round(todayPct * 100)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <span className="text-dark-on-surface-variant">Semana</span>
          <span className="font-code text-[11px] text-dark-on-surface">{pct(stats?.week ?? 0)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-dark-on-surface-variant">Mes</span>
          <span className="font-code text-[11px] text-dark-on-surface">{pct(stats?.month ?? 0)}</span>
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle/60 pt-2 mt-1">
          <span className="text-dark-on-surface-variant font-medium">Racha actual</span>
          <span className="font-code text-[11px] font-semibold text-accent">
            {stats?.streak ?? 0} {stats?.streak === 1 ? "día" : "días"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HabitsModule() {
  const view = useHabits((s) => s.view);
  const setView = useHabits((s) => s.setView);
  const load = useHabits((s) => s.load);
  const loaded = useHabits((s) => s.loaded);
  const habits = useHabits((s) => s.habits);
  const log = useHabits((s) => s.log);
  const add = useHabits((s) => s.add);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingToday = log ? log.active.filter((id) => !log.completed[id]).length : 0;

  return (
    <div className="flex min-w-0 flex-1">
      <ModuleSidebar
        title="Hábitos"
        active={view}
        onSelect={(id) => setView(id as HabitsView)}
        items={[
          { id: "general", label: "Vista general", hint: "Rachas y porcentajes", icon: <LayoutGrid /> },
          { id: "diaria", label: "Diaria", hint: "Checklist y diario", icon: <Sun />, badge: pendingToday },
          { id: "semanal", label: "Semanal", icon: <CalendarRange /> },
          { id: "mensual", label: "Mensual", icon: <CalendarDays /> },
          { id: "anual", label: "Anual", icon: <ListChecks /> },
          { id: "gestionar", label: "Gestionar hábitos", hint: `${habits.length} hábitos`, icon: <Settings2 /> },
        ]}
      >
        <SideStats />
      </ModuleSidebar>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {!loaded ? (
          <div className="grid flex-1 place-items-center text-[13px] text-faint">Cargando hábitos…</div>
        ) : !habits.length && view !== "gestionar" ? (
          <Empty onAdd={() => {
            setView("gestionar");
            void add();
          }} />
        ) : view === "general" ? <HabitOverview />
          : view === "diaria" ? <HabitDaily />
            : view === "semanal" ? <HabitWeek />
              : view === "mensual" ? <HabitMonth />
                : view === "anual" ? <HabitYear />
                  : <HabitManage />}
      </main>
    </div>
  );
}
