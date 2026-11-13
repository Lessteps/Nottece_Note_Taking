// Mentor — el espacio de UN plan: carga sus datos una sola vez y los reparte entre la barra lateral (los ítems del modo en curso) y el panel.
// La barra NO guarda estado propio: escribe las mismas claves de `navState` que ya leían `PlanView`, la Agenda y `PlanRun`
// (`mentor.planTab.<id>`, `mentor.planSection.<id>`, `mentor.agendaView.<id>`, `mentor.agendaArea.<id>`, `mentor.runTab.<id>`), así que los enlaces profundos siguen valiendo.

import { useMemo, useState } from "react";
import { clampToPlan } from "../../lib/planSchedule";
import { dayBases, deliverablesDefined } from "../../lib/planTopicsByArea";
import { useMentor } from "../../store/mentor";
import { usePersistedNav } from "../../store/navState";
import { liveDoneOf, scheduleOf } from "./agendaKit";
import { useReviewItems } from "./AreaWork";
import { MentorSidebar } from "./MentorSidebar";
import {
  activePlaneacionId, ejecucionLinks, modeSubject, PAGE_ADD_AREA, PLAN_NAV_PREFIX, RUN_NAV_PREFIX, RUN_TAB_GENERAL, runHints, runTabKey, runAreaInteractiveTab, runAreaInformativeTab, selectEjecucion, selectPlaneacion, useMentorMode,
} from "./mentorNav";
import { ejecucionItems, planeacionItems } from "./mentorNavItems";
import { DEFAULT_SECTION } from "./PlanSections";
import { PlanView } from "./PlanView";
import { agendaAreaKey, planSectionKey, planTabKey, usePlanData } from "./planShared";
import { AddToPlanDialog } from "./AddToPlanDialog";

export function PlanWorkspace({ planId }: { planId: string }) {
  const [addAreaOpen, setAddAreaOpen] = useState(false);
  const source = usePlanData(planId);
  const plan = source.data?.plan ?? null;
  const [mode, setMode] = useMentorMode(modeSubject(useMentor((s) => s.plans.find((p) => p.id === planId)), plan), planId);
  const tab = usePersistedNav<string>(planTabKey(planId), "plan")[0];
  const section = usePersistedNav<string>(planSectionKey(planId), DEFAULT_SECTION)[0];
  const agendaArea = usePersistedNav<string>(agendaAreaKey(planId), "")[0];
  const runTab = usePersistedNav<string>(runTabKey(planId), RUN_TAB_GENERAL)[0];

  // los entregables quedan «por definir» hasta que se ejecuta el plan: la decisión pendiente solo se enseña cuando ya hay entregables definidos
  const pending = plan && deliverablesDefined(plan) ? (plan.openQuestions ?? []).filter((q) => q.id === "deliverables").length : 0;
  // Pistas de la Ejecución (avance y repasos de hoy) y «Bases» si hoy hay fundamentos: solo en ese modo, con los datos ya cargados del plan
  // (`data.derived`), el reparto en caché por objeto de plan (el mismo que usa `PlanRun`) y los repasos (una sola lectura compartida con `PlanRun`).
  const running = mode === "ejecucion";
  const reviews = useReviewItems(running);
  const derived = source.data?.derived;
  const today = source.data?.today;
  const runOpts = useMemo(() => {
    if (!plan) return undefined;
    const state = new Map<string, string>();
    for (const s of derived?.subplans ?? []) for (const t of s.topics) state.set(t.folder, t.state);
    const hints = runHints(plan, (t) => state.get(t.folder) === "completo" || !!t.completedAt, running ? reviews.data?.items ?? [] : []);
    let basesToday = false;
    if (today && running) {
      const live = new Map<string, { state: string }>();
      for (const sp of derived?.subplans ?? []) for (const t of sp.topics) live.set(t.folder, t);
      const day = scheduleOf(plan, today, liveDoneOf(plan, live)).schedule.byDate.get(clampToPlan(today, plan));
      basesToday = !!day && dayBases(plan, day).length > 0;
    }
    return { hints, basesToday };
  }, [plan, running, derived, today, reviews.data]);
  const items = useMemo(() => (!plan ? [] : mode === "planeacion" ? planeacionItems(plan, pending, runOpts?.hints) : ejecucionItems(plan, runOpts)), [plan, mode, pending, runOpts]);
  const active = !plan
    ? ""
    : mode === "planeacion"
      ? activePlaneacionId(tab, section, agendaArea, plan.subplans.map((x) => x.id), !!plan.programmingPractice)
      : `${RUN_NAV_PREFIX}${(ejecucionLinks(plan, runOpts).some((l) => l.tab === runTab) || plan.subplans.some((s) => runTab === runAreaInteractiveTab(s.id) || runTab === runAreaInformativeTab(s.id))) ? runTab : RUN_TAB_GENERAL}`;
  const onSelect = (id: string): void => {
    if (id === `${PLAN_NAV_PREFIX}${PAGE_ADD_AREA}`) {
      setAddAreaOpen(true);
      return;
    }
    if (id.startsWith(PLAN_NAV_PREFIX)) selectPlaneacion(planId, id);
    else selectEjecucion(planId, id);
  };

  return (
    <>
      <MentorSidebar items={items} active={active} onSelect={onSelect} mode={mode} onMode={setMode} currentPlanId={planId} />
      <main className="@container flex min-w-0 flex-1 flex-col bg-surface" aria-label={`Mentor: ${mode === "planeacion" ? "Planeación" : "Ejecución"}`}>
        <PlanView planId={planId} source={source} />
      </main>
      {plan && (
        <AddToPlanDialog
          plan={plan}
          open={addAreaOpen}
          initialMode="area"
          lockMode
          onClose={() => setAddAreaOpen(false)}
          onAdded={(updatedPlan) => {
            source.setData((d) => (d ? { ...d, plan: updatedPlan } : d));
            useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
            void source.reload();
          }}
        />
      )}
    </>
  );
}
