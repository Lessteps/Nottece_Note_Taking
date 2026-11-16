// Prácticas por área: utiliza la misma cadena y los mismos estados que Mentor, sin duplicar progreso.
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { areaKataDates, kataForDay } from "../../lib/areaPracticeSystem";
import { api } from "../../lib/bridge";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { chainSignalsOf, planChain, type ChainMonth, type ChainWeek } from "../../lib/planChain";
import { planMonths } from "../../lib/planSchedule";
import { addMonthsToDate } from "../../lib/planTime";
import { productStage } from "../../lib/planProduct";
import type { MentorPlan } from "../../lib/types";
import type { AgendaModel } from "./agendaKit";
import type { Loaded } from "./planShared";
import type { AreaPracticeState } from "./PracticeCard";
import { AreaPracticeBlock } from "./AreaPracticeBlock";
import { DailyPracticeMap } from "./DailyPracticeMap";
import { ProgressBar } from "./parts";
import { usePersistedNav } from "../../store/navState";

export function DailyAreaPractice({ plan, data, m, practice, onProjects }: { plan: MentorPlan; data: Loaded; m: AgendaModel; practice: AreaPracticeState; onProjects: () => void }) {
  const [selected, setSelected] = useState("");
  const [view, setView] = usePersistedNav<string>(`mentor.dailyPracticeView.${plan.id}`, "informativa");
  const [showKatas, setShowKatas] = useState(false);
  const [kataPage, setKataPage] = useState(0);
  const toast = useApp((state) => state.toast);
  const areas = useMemo(() => practice.data?.areas ?? [], [practice.data?.areas]);
  const area = areas.find((a) => a.areaId === selected) ?? areas[0];
  const chain = useMemo(() => planChain(plan, m.schedule, chainSignalsOf(data.practice, data.dailyProjectDone)), [plan, m.schedule, data.practice, data.dailyProjectDone]);

  // Los meses reales del plan y la ruta de práctica: incluye los de la cadena y los que se añadan después a la ruta.
  const practiceMonths = useMemo(() => {
    const base = chain.months ?? [];
    const planKeys = plan.start && plan.end ? planMonths(plan) : [];
    const kataDates = areas.flatMap((a) => areaKataDates(plan, a.areaId));
    const schedDates = m.schedule?.days?.map((d) => d.date) ?? [];
    const allDates = [...kataDates, ...schedDates].filter(Boolean);
    const allMonthKeys = new Set<string>([...planKeys, ...allDates.map((d) => d.slice(0, 7))]);
    for (const bm of base) {
      if (bm.month) allMonthKeys.add(bm.month);
      else if (bm.start) allMonthKeys.add(bm.start.slice(0, 7));
    }
    const sortedKeys = [...allMonthKeys].filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
    if (base.length >= sortedKeys.length && base.length > 0) return base;

    const result: ChainMonth[] = [];
    const usedIds = new Set<string>();
    base.forEach((bm, i) => {
      result.push({ ...bm, n: i + 1, of: Math.max(base.length, sortedKeys.length) });
      usedIds.add(bm.id);
    });

    for (let i = base.length; i < sortedKeys.length; i++) {
      const key = sortedKeys[i]!;
      const id = `m-${key}`;
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      const stage = productStage(i);
      const monthDays = m.schedule?.days?.filter((d) => d.date.startsWith(key)) ?? [];
      const weekNumbers = [...new Set(monthDays.map((d) => d.week))].sort((a, b) => a - b);
      let weeks: ChainWeek[] = weekNumbers.map((wNum, idx) => {
        const days = monthDays.filter((d) => d.week === wNum);
        const start = days[0]?.date ?? `${key}-01`;
        const end = days[days.length - 1]?.date ?? `${key}-07`;
        return {
          id: `w:${wNum}`,
          week: wNum,
          n: idx + 1,
          of: weekNumbers.length,
          start,
          end,
          dueDate: end,
          title: `Proyecto semanal ${wNum}`,
          description: `Consolida las prácticas de la semana ${wNum}`,
          slice: `Semana ${wNum}`,
          status: "pendiente" as const,
          pct: 0,
          done: 0,
          total: 0,
          pieces: [],
          areaIds: areas.map((a) => a.areaId),
          locked: false,
        };
      });
      if (!weeks.length) {
        const monthKatas = kataDates.filter((d) => d.startsWith(key)).sort();
        if (monthKatas.length) {
          const start = monthKatas[0]!;
          const end = monthKatas[monthKatas.length - 1]!;
          weeks = [{
            id: `w:${i * 4 + 1}`,
            week: i * 4 + 1,
            n: 1,
            of: 1,
            start,
            end,
            dueDate: end,
            title: `Retos del mes ${i + 1}`,
            description: `Consolida los retos de práctica del mes ${i + 1}`,
            slice: `Semana ${i * 4 + 1}`,
            status: "pendiente" as const,
            pct: 0,
            done: 0,
            total: 0,
            pieces: [],
            areaIds: areas.map((a) => a.areaId),
            locked: false,
          }];
        }
      }
      result.push({
        id,
        n: i + 1,
        of: sortedKeys.length,
        start: monthDays[0]?.date ?? `${key}-01`,
        end: monthDays[monthDays.length - 1]?.date ?? `${key}-28`,
        dueDate: monthDays[monthDays.length - 1]?.date ?? `${key}-28`,
        month: key,
        title: `Mes ${i + 1} · ${stage.title}`,
        goal: stage.summary,
        criteria: stage.criteria,
        areaIds: areas.map((a) => a.areaId),
        source: "template",
        status: "pendiente",
        pct: 0,
        done: 0,
        total: 0,
        weeksDone: 0,
        weeks,
        topics: [],
        locked: false,
      });
    }
    return result;
  }, [chain.months, plan, m.schedule, areas]);

  const dates = area ? areaKataDates(plan, area.areaId) : [];
  const openKata = async (date: string, areaId = area?.areaId) => {
    if (!areaId) return;
    try {
      const result = await api.mentorAreaKataOpen(plan.id, areaId, date);
      await useApp.getState().openNote(result.rel);
    } catch (error) { toast("error", (error as Error).message || "No se pudo abrir el reto."); }
  };

  const handleAddMonth = async () => {
    if (!plan.end) return;
    try {
      const nextEnd = addMonthsToDate(plan.end, 1);
      await api.mentorPlanChange({
        id: plan.id,
        label: "Añadir un mes más de práctica a la ruta",
        ops: [{ op: "extend_to", date: nextEnd }],
      });
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      toast("info", "Se ha añadido un nuevo mes de práctica a la ruta.");
    } catch (err) {
      toast("error", (err as Error).message || "No se pudo añadir el mes.");
    }
  };

  if (view === "interactiva" && areas.length > 0) {
    return (
      <DailyPracticeMap
        plan={plan}
        areas={areas}
        months={practiceMonths}
        selectedAreaId={area?.areaId ?? ""}
        onArea={(id) => { setSelected(id); setKataPage(0); }}
        onOpen={(id, date) => void openKata(date, id)}
        onProjects={onProjects}
        onInformative={() => setView("informativa")}
        onAddMonth={plan.end ? handleAddMonth : undefined}
      />
    );
  }

  return <section className="mx-auto w-full max-w-6xl space-y-5 p-5" data-testid="daily-area-practice">
    <header><p className="text-sm font-semibold text-accent-text">MENTOR · PRÁCTICA POR ÁREA</p><h1 className="mt-1 text-2xl font-bold">Prácticas diarias</h1><p className="mt-2 text-dim">Consulta las prácticas diarias por área y su relación prevista con los proyectos mensuales.</p></header>
    {practice.loading && <p role="status">Cargando prácticas…</p>}
    {practice.error && <p role="alert" className="text-danger">{practice.error} <button type="button" onClick={practice.reload} className="underline">Reintentar</button></p>}
    {!practice.loading && !practice.error && !areas.length && <p>No hay prácticas por área disponibles para este plan.</p>}
    {!!areas.length && <><div className="flex flex-wrap gap-2" role="group" aria-label="Vista de prácticas diarias"><button type="button" aria-pressed={view !== "interactiva"} onClick={() => setView("informativa")} className="rounded-lg border border-line px-3 py-2 text-sm aria-pressed:border-accent aria-pressed:bg-accent-soft">Vista informativa</button><button type="button" aria-pressed={view === "interactiva"} onClick={() => setView("interactiva")} className="rounded-lg border border-line px-3 py-2 text-sm aria-pressed:border-accent aria-pressed:bg-accent-soft">Vista interactiva</button></div>
      <nav className="flex flex-wrap gap-2" aria-label="Áreas de práctica">{areas.map((a) => <button key={a.areaId} type="button" aria-pressed={area?.areaId === a.areaId} onClick={() => { setSelected(a.areaId); setKataPage(0); }} className="rounded-xl border border-line px-4 py-2 text-sm aria-pressed:border-accent aria-pressed:bg-accent-soft">{a.label}</button>)}</nav>
      {area && <><AreaPracticeBlock planId={plan.id} area={area} mark={practice.mark} showDates={false} />
      <section className="rounded-2xl border border-line bg-card p-4" aria-label={`Proyectos de ${area.label}`} data-testid="daily-informative-projects">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="font-semibold">Proyectos y aportaciones de {area.label}</h2>
            <p className="text-sm text-dim">Consulta los proyectos y las piezas de esta área.</p>
          </div>
          <button type="button" onClick={onProjects} className="rounded-lg border border-line px-3 py-2 text-sm">Abrir proyectos</button>
          {plan.end && (
            <button type="button" onClick={() => void handleAddMonth()} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-dim hover:text-text hover:bg-hover">
              <Plus size={14} aria-hidden /> Añadir mes de práctica
            </button>
          )}
        </div>
        {practiceMonths.map((month) => {
          const explicitPieces = month.weeks.flatMap((week) => week.pieces).filter((piece) => piece.areaIds.includes(area.areaId));
          return (
            <details key={month.id} className="mt-3 rounded-xl border border-line p-3">
              <summary className="cursor-pointer font-medium">{month.title} · {month.pct}%</summary>
              <p className="mt-2 text-sm text-dim">{month.goal}</p>
              <div className="mt-2"><ProgressBar pct={month.pct} label={`Avance de ${month.title}`} /></div>
              <ul className="mt-3 space-y-2">
                {explicitPieces.length > 0 ? (
                  explicitPieces.map((piece) => (
                    <li key={piece.id} className="rounded-lg border border-line p-2 text-sm">
                      <span className="font-medium">{piece.title}</span>
                      <span className="ml-2 text-dim">{data.dailyProjectDone?.[piece.date]?.includes(area.areaId) ? "Completada" : "Pendiente"}</span>
                    </li>
                  ))
                ) : (
                  month.weeks.map((week) => (
                    <li key={week.id} className="rounded-lg border border-line p-2 text-sm">
                      <span className="font-medium">{week.title}</span>
                      <span className="ml-2 text-dim">Prácticas de {area.label} integradas en el hito semanal</span>
                    </li>
                  ))
                )}
              </ul>
            </details>
          );
        })}
        {!practiceMonths.length && <p className="mt-3 text-sm text-dim">No hay proyectos mensuales disponibles en este plan.</p>}
      </section>
      <section className="rounded-2xl border border-line bg-card p-4"><button type="button" aria-expanded={showKatas} onClick={() => setShowKatas((v) => !v)} className="font-semibold text-accent-text">{showKatas ? "Ocultar" : "Ver"} todos los retos previstos · {dates.length}</button>
      {showKatas && <><p className="mt-2 text-sm text-dim">Los retos siguen el orden del plan. Abrir uno puede crear su archivo si aún no existe.</p><ol className="mt-3 space-y-2">{dates.slice(kataPage * 20, (kataPage + 1) * 20).map((date, index) => { const n = kataPage * 20 + index + 1; const kata = kataForDay(area.areaId, n, area.level); return <li key={date} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2"><span>{kata?.title ?? `Reto ${n}`} <span className="text-sm text-dim">· Reto {n}{area.kata.consumed.includes(date) ? " · adelantado" : ""}</span></span><button type="button" onClick={() => void openKata(date)} className="text-sm text-accent-text">Abrir</button></li>; })}</ol><div className="mt-3 flex gap-3"><button type="button" disabled={!kataPage} onClick={() => setKataPage((p) => p - 1)} className="disabled:opacity-40">Anterior</button><span className="text-sm text-dim">Página {kataPage + 1} de {Math.max(1, Math.ceil(dates.length / 20))}</span><button type="button" disabled={(kataPage + 1) * 20 >= dates.length} onClick={() => setKataPage((p) => p + 1)} className="disabled:opacity-40">Siguiente</button></div></>}
      </section>
      {!area.folderReady && <p className="text-sm text-dim">La carpeta de esta área todavía no está creada. Puedes abrir un reto para prepararlo.</p>}
      </>}
    </>}
  </section>;
}
