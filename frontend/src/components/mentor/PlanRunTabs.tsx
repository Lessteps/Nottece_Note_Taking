// Mentor — Ejecución: las PESTAÑAS de la vista de ejecución y el contenido de cada una (un área, las Bases). La vista de ejecución es una barra
// de pestañas (General · una por área · Bases · Proyectos) y cada pestaña enseña SOLO lo suyo: la de un área, lo que toca hoy en esa área, su sesión
// (Pomodoro y registro de horas) y su ruta; la de Bases, los fundamentos que se intercalan en todas las áreas (no son de ninguna ruta en concreto).

import { memo, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { MentorPlan } from "../../lib/types";
import type { DayAreaEntry } from "../../lib/planTopicsByArea";
import type { AreaSets } from "../../lib/planAreaLists";
import type { ReviewRow } from "../../lib/planReviews";
import { cn } from "../ui";
import { GhostButton } from "../common/forms";
import { AreaSession, useTimeLog } from "./AreaSession";
import { SubjectStatsCard } from "./SubjectStatsCard";
import { minutesOn } from "../../lib/timeLog";
import { AreaWork, startAreaBlock, type UpcomingWeekView, type WeekDayView } from "./AreaWork";
import type { BoardPractice, BoardRow } from "./PlanBoard";
import { useApp } from "../../store/app";
import { SectionCard } from "./planKit";
import { AreaSections } from "./PlanRunPractice";
import { ProjectFolder } from "./ProjectFolder";
import { dailyBreakdown } from "../../lib/planAreaPractice";
import { hm } from "./parts";
import type { DayProject } from "../../lib/planCurriculum";

/** Lo de hoy de un área (o de las Bases): sus filas ya calculadas. */
export interface TodayCard {
  entry: DayAreaEntry;
  rows: BoardRow[];
  colour: string;
  doneN: number;
}

/** El tipo de trabajo con que se preselecciona el bloque de un área si nada asignado lo decide: temas por hacer hoy → Teoría; sin ellos, su proyecto diario → Proyecto; si no, Práctica. */
export const areaDefaultWork = (o: { pendingTopics: boolean; project: boolean }): "theory" | "practice" | "project" => (o.pendingTopics ? "theory" : o.project ? "project" : "practice");

/** La pestaña de un área: su trabajo (hoy, semana, pendientes, repasos) a la izquierda y su sesión (Pomodoro y horas) a la derecha. */
export const RunArea = memo(function RunArea({ plan, area, card, routeRows, weekDays, upcoming, sets, reviews, date, practice, dailyProject, weeklyProjectTitle, onGoProjects, weekNumber }: {
  plan: MentorPlan;
  area: { subplanId: string; areaId?: string; area: string };
  card: TodayCard | undefined;
  /** toda la ruta del área, sin Bases */
  routeRows: BoardRow[];
  weekDays: WeekDayView[];
  /** las semanas siguientes (proyección) */
  upcoming?: UpcomingWeekView[];
  sets: AreaSets;
  reviews: ReviewRow[];
  date: string;
  practice?: BoardPractice;
  dailyProject?: DayProject | null;
  weeklyProjectTitle?: string;
  onGoProjects: () => void;
  weekNumber?: number;
}) {
  const colour = card?.colour ?? "var(--nv-accent)";
  const areaKey = area.areaId ?? area.subplanId;
  const { entries: timeEntries } = useTimeLog(plan.id);
  const objective = plan.subplans.find((s) => s.id === area.subplanId)?.objective;
  const sub = plan.subplans.find((s) => s.id === area.subplanId);
  const planned = card ? card.entry.theoryMinutes + card.entry.practiceMinutes : 0;
  const current = card?.rows.find((r) => !r.done)?.title;
  const toast = useApp.getState().toast;
  const dailySections = useMemo(
    () => (dailyProject ? dailyBreakdown(area.areaId ? [area.areaId] : [], card?.rows.length ? card.rows.map((r) => r.title) : dailyProject.topics.map((t: { title: string }) => t.title)) : []),
    [dailyProject, area.areaId, card?.rows]
  );
  return (
    <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_24rem]" data-testid="run-area-tab" data-area={areaKey}>
      <div className="min-w-0 space-y-4">
        <AreaWork
          plan={plan}
          subplanId={area.subplanId}
          planId={plan.id}
          areaName={area.area}
          areaId={area.areaId}
          {...(objective ? { subtitle: objective } : {})}
          loggedMinutes={minutesOn(timeEntries, date, areaKey)}
          rows={routeRows}
          todayRows={card?.rows ?? []}
          weekDays={weekDays}
          {...(upcoming ? { upcoming } : {})}
          sets={sets}
          today={date}
          colour={colour}
          practice={practice}
          reviews={reviews}
          plannedMinutes={planned}
          weekNumber={weekNumber}
          onStartBlock={() => { if (!startAreaBlock(plan.id, areaKey)) toast("info", "Ya hay un Pomodoro en marcha: termínalo o detenlo primero."); }}
        />
        {card?.entry.project && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px]" data-testid="run-area-project">
            Hoy esta área lleva proyecto.
            <GhostButton onClick={onGoProjects}>Ver los proyectos <ArrowRight size={14} aria-hidden /></GhostButton>
          </p>
        )}
        {/* El proyecto diario de ESTA área, en su pestaña (no en «Proyectos»): una pieza pequeña con lo que toca hoy en el área */}
        {dailyProject && (
          <SectionCard labelledBy={`daily-${areaKey}-title`} testid="area-daily-project" className="space-y-2 border border-line bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-accent/20 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-accent-text">Proyecto diario · {area.area}</span>
              {dailyProject.minutes ? <span className="text-[12.5px] text-dim">· {hm(dailyProject.minutes)}</span> : null}
            </div>
            <h3 id={`daily-${areaKey}-title`} className="text-[16.5px] font-bold text-text">{dailyProject.title}</h3>
            <p className="text-[14px] text-dim">{dailyProject.description}</p>
            {dailyProject.weeklyPart && <p className="text-[13px] font-medium text-accent-text">{dailyProject.weeklyPart}</p>}
            <AreaSections sections={dailySections} testid="area-daily-sections" />
            <ProjectFolder
              planId={plan.id}
              areaKeys={[areaKey]}
              testid="daily-project-folder"
              pomodoro={{ folder: `project:daily:${areaKey}`, title: `Proyecto diario: ${dailyProject.title}`, areaKey }}
              project={{ kind: "daily", title: dailyProject.title, description: dailyProject.description, minutes: dailyProject.minutes, weeklyPart: dailyProject.weeklyPart, date: dailyProject.date, topics: dailyProject.topics.map((t: { title: string }) => t.title), sections: dailySections }}
            />
          </SectionCard>
        )}
      </div>
      <div className="space-y-4">
        <AreaSession
          planId={plan.id}
          areaKey={areaKey}
          areaName={area.area}
          date={date}
          plannedMinutes={planned}
          colour={colour}
          {...(current ? { currentTopic: current } : {})}
          defaultWork={areaDefaultWork({ pendingTopics: (card?.rows ?? []).some((r) => !r.done), project: !!dailyProject })}
          todayTopics={(card?.rows ?? []).filter((r) => !r.done).map((r) => ({ folder: r.folder, title: r.title, kind: "topic" as const }))}
          suggestions={[
            ...(dailyProject ? [{ folder: `project:daily:${areaKey}`, title: `Proyecto diario: ${dailyProject.title}`, kind: "project" as const }] : []),
            ...(weeklyProjectTitle ? [{ folder: `project:weekly:${areaKey}`, title: `Proyecto semanal: ${weeklyProjectTitle}`, kind: "project" as const }] : []),
          ]}
        />
        {sub && <SubjectStatsCard plan={plan} sub={sub} />}
      </div>
    </div>
  );
});

/** La pestaña de Bases: los fundamentos que se intercalan en todas las áreas. Los temas se juntan sin repetirse. */
export const RunBases = memo(function RunBases({ plan, routeRows, todayRows, weekDays, upcoming, sets, reviews, date }: {
  plan: MentorPlan;
  routeRows: BoardRow[];
  todayRows: BoardRow[];
  weekDays: WeekDayView[];
  upcoming?: UpcomingWeekView[];
  sets: AreaSets;
  reviews: ReviewRow[];
  date: string;
}) {
  const colour = "var(--nv-accent)";
  const current = todayRows.find((r) => !r.done)?.title;
  const toast = useApp.getState().toast;
  return (
    <div className={cn("grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_24rem]")} data-testid="run-bases">
      <div className="min-w-0 space-y-3">
        <p className="text-[14.5px] text-dim">Los fundamentos no son de Backend ni de Frontend: se intercalan en todas las áreas. Aquí están una sola vez.</p>
        <AreaWork
          planId={plan.id}
          areaName="Bases de programación"
          rows={routeRows}
          todayRows={todayRows}
          weekDays={weekDays}
          {...(upcoming ? { upcoming } : {})}
          sets={sets}
          today={date}
          colour={colour}
          reviews={reviews}
          plannedMinutes={0}
          onStartBlock={() => { if (!startAreaBlock(plan.id, "bases")) toast("info", "Ya hay un Pomodoro en marcha: termínalo o detenlo primero."); }}
        />
      </div>
      <AreaSession planId={plan.id} areaKey="bases" areaName="Bases" date={date} plannedMinutes={0} colour={colour} defaultWork="theory" {...(current ? { currentTopic: current } : {})} />
    </div>
  );
});
