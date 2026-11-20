// Vista General: the four headline rates, the year streak grid and a table
// with each habit's rates.

import { pct } from "../../lib/habits";
import { useHabits } from "../../store/habits";
import { HabitHeatmap } from "./HabitHeatmap";
import { Bar, Header, habitColour } from "./parts";

export function StatCards() {
  const stats = useHabits((s) => s.stats);
  const cards: Array<[string, number]> = [
    ["Hoy", stats?.day ?? 0],
    ["Esta semana", stats?.week ?? 0],
    ["Este mes", stats?.month ?? 0],
    ["Este año", stats?.year ?? 0],
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(([label, v]) => (
        <div key={label} className="rounded-xl border border-line bg-card p-4">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{label}</div>
          <div className="mt-1 mb-2 text-[26px] font-semibold text-text">{pct(v)}</div>
          <Bar value={v} />
        </div>
      ))}
    </div>
  );
}

function HabitTable() {
  const habits = useHabits((s) => s.habits);
  const stats = useHabits((s) => s.stats);
  const cols = ["day", "week", "month", "year"] as const;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="grid grid-cols-[minmax(180px,1fr)_repeat(4,110px)] border-b border-line px-4 py-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
        <span>Hábito</span><span>Hoy</span><span>Semana</span><span>Mes</span><span>Año</span>
      </div>
      {habits.map((h) => {
        const r = stats?.habits[h.id];
        return (
          <div key={h.id} className="grid grid-cols-[minmax(180px,1fr)_repeat(4,110px)] items-center border-b border-line px-4 py-2 last:border-b-0">
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-text">
              <span className="w-5 text-center">{h.icon}</span>
              <span className="truncate">{h.name}</span>
            </span>
            {cols.map((c) => (
              <span key={c} className="flex flex-col gap-1 pr-4">
                <span className="font-mono text-[11px] text-dim">{pct(r?.[c])}</span>
                <Bar value={r?.[c] ?? null} colour={habitColour(h)} />
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function HabitOverview() {
  const setView = useHabits((s) => s.setView);
  const setDay = useHabits((s) => s.setDay);

  const handleSelectDay = (d: string) => {
    void setDay(d);
    setView("diaria");
  };

  return (
    <>
      <Header title="Vista general" />
      <div className="flex-1 space-y-4 overflow-y-auto p-6 w-full">
        <StatCards />
        <HabitHeatmap onSelectDay={handleSelectDay} />
        <HabitTable />
      </div>
    </>
  );
}
