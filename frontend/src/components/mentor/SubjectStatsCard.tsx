import { memo, useMemo } from "react";
import type { MentorPlan, MentorSubplan } from "../../lib/types";
import { usePersistedNav } from "../../store/navState";
import { ProgressBar } from "./parts";

export const SubjectStatsCard = memo(function SubjectStatsCard({
  plan,
  sub,
}: {
  plan: MentorPlan;
  sub: MentorSubplan;
}) {
  const [selectedSubject, setSelectedSubject] = usePersistedNav<string>(
    `mentor.runSubject.${plan.id}.${sub.id}`,
    "all"
  );

  // los fundamentos («Bases») no son una asignatura del área: tienen su propia pestaña
  const own = (sub.groups ?? []).filter((g) => g.kind !== "bases");
  const groups = useMemo(
    () => (own.length > 0 ? own : [{ id: "core", title: "Temas generales", kind: "knowledge" as const, order: 100 }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sub.groups]
  );

  // Calcular estadísticas por asignatura en una sola pasada memoizada
  const { statsByGroup, allStats } = useMemo(() => {
    const liveTopics = sub.topics.filter((t) => t.route !== "skipped");
    const groupMap = new Map<string, { total: number; done: number; totalMin: number; doneMin: number }>();
    for (const g of groups) {
      groupMap.set(g.id, { total: 0, done: 0, totalMin: 0, doneMin: 0 });
    }
    let allDone = 0;
    let allTotalMin = 0;
    let allDoneMin = 0;

    for (const t of liveTopics) {
      const gid = t.group ?? "core";
      const gm = groupMap.get(gid);
      const isDone = !!t.completedAt;
      const mins = t.estMinutes || 45;
      if (gm) {
        gm.total++;
        gm.totalMin += mins;
        if (isDone) {
          gm.done++;
          gm.doneMin += mins;
        }
      }
      allTotalMin += mins;
      if (isDone) {
        allDone++;
        allDoneMin += mins;
      }
    }

    const byGroup = groups.map((g) => {
      const gm = groupMap.get(g.id) ?? { total: 0, done: 0, totalMin: 0, doneMin: 0 };
      const pct = gm.total > 0 ? Math.round((gm.done / gm.total) * 100) : 0;
      return {
        group: g,
        total: gm.total,
        done: gm.done,
        pct,
        totalMin: gm.totalMin,
        doneMin: gm.doneMin,
      };
    });

    const all = {
      group: { id: "all", title: "Todas las asignaturas", kind: "knowledge" as const, order: 0 },
      total: liveTopics.length,
      done: allDone,
      pct: liveTopics.length > 0 ? Math.round((allDone / liveTopics.length) * 100) : 0,
      totalMin: allTotalMin,
      doneMin: allDoneMin,
    };

    return { statsByGroup: byGroup, allStats: all };
  }, [sub.topics, groups]);

  const activeStat = statsByGroup.find((s) => s.group.id === selectedSubject) ?? allStats;

  return (
    <div
      className="space-y-3 rounded-2xl border border-line bg-card p-4"
      data-testid="pomodoro-subject-stats"
      data-subject={activeStat.group.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-line pb-2">
        <h4 className="text-[14px] font-bold text-text">Progreso de la Asignatura</h4>
        <span className="text-[12px] font-semibold text-accent-text">
          {activeStat.pct}% completado
        </span>
      </div>

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1" data-testid="subject-stats-tabs">
          <button
            type="button"
            onClick={() => setSelectedSubject("all")}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              selectedSubject === "all"
                ? "bg-accent text-white"
                : "bg-surface text-dim hover:bg-hover hover:text-text"
            }`}
          >
            Todas
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedSubject(g.id)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                selectedSubject === g.id
                  ? "bg-accent text-white"
                  : "bg-surface text-dim hover:bg-hover hover:text-text"
              }`}
            >
              {g.title}
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="text-[13px] font-semibold text-text">{activeStat.group.title}</p>
        <div className="mt-1">
          <ProgressBar pct={activeStat.pct} label={`Avance de ${activeStat.group.title}`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[12px]">
        <div className="rounded-xl border border-line bg-surface p-2">
          <span className="block text-[11px] font-sans text-dim">Temas</span>
          <span className="text-[14px] font-bold text-text">
            {activeStat.done} / {activeStat.total}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-2">
          <span className="block text-[11px] font-sans text-dim">Tiempo estimado</span>
          <span className="text-[14px] font-bold text-text">
            {activeStat.doneMin} / {activeStat.totalMin}m
          </span>
        </div>
      </div>
    </div>
  );
});
