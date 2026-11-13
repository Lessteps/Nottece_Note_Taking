// El panel derecho, uno solo para toda la app.
//
// La tira de lanzadores está SIEMPRE en el borde derecho; junto a ella (a su izquierda)
// se abre la cara que elijas: el asistente, las páginas del navegador, el esquema de la
// nota, el repaso o el esquema muscular. Solo hay una cara a la vez (ver lib/panelFaces).

import { useApp } from "../../store/app";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useAssistant } from "../../store/assistant";
import { useWebPages } from "../../store/webPages";
import { MuscleSchemaPanel } from "./MuscleSchemaPanel";
import { PanelLaunchers } from "./PanelLaunchers";
import { Inspector } from "./Inspector";
import { AssistantPanel } from "./AssistantPanel";
import { WebRail } from "../web/WebRail";
import { ReviewPanel, useReviewPanel } from "../study/ReviewPanel";
import { SourcesPanel, useSourcesPanel } from "../english/SourcesPanel";
import { RecordingsPanel, useRecordingsPanel } from "../english/RecordingsPanel";
import { CodePanel } from "../programming/CodePanel";
import { useCodePanel } from "../../store/codePanel";
import { useSkillsPanel } from "../../store/skillsPanel";
import { SkillsPanel } from "../skills/SkillsPanel";
import { useRegenTasksPanel } from "../../store/regenTasksPanel";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { resolveRoute, useMentorMode } from "../mentor/mentorNav";
import { ExternalTasks } from "../mentor/ExternalTasks";
import { X } from "lucide-react";

export function RightPanel({ module }: { module: string }) {
  const assistantOpen = useAssistant((s) => s.open);
  const pagesOpen = useWebPages((s) => s.open);
  const reviewOpen = useReviewPanel((s) => s.open);
  const sourcesOpen = useSourcesPanel((s) => s.open);
  const recordingsOpen = useRecordingsPanel((s) => s.open);
  const codeOpen = useCodePanel((s) => s.open);
  const skillsOpen = useSkillsPanel((s) => s.open);
  const muscleOpen = useApp((s) => s.muscleOpen);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const active = useApp((s) => s.active);
  const tasksOpen = useRegenTasksPanel((s) => s.open);
  const plans = useMentor((s) => s.plans);
  const plansLoaded = useMentor((s) => s.plansLoaded);
  const builds = useMentor((s) => s.builds);
  const view = useNavState((s) => String(s.values["mentor.view"] ?? ""));
  const route = resolveRoute({ stored: view, plans, plansLoaded, builds, buildsLoaded: false });
  const plan = route.kind === "plan" ? plans.find((p) => p.id === route.planId) : undefined;
  const [mode] = useMentorMode(plan, route.kind === "plan" ? route.planId : undefined);
  const planning = module === "mentor" && mode === "planeacion";

  const face = tasksOpen && planning
    ? <aside className="flex h-full w-[min(460px,80vw)] flex-none flex-col border-l border-line bg-panel" aria-label="Tareas de regeneración" data-testid="regen-tasks-panel"><header className="flex items-center justify-between border-b border-line p-3"><h2 className="font-semibold">Tareas de regeneración</h2><button type="button" aria-label="Cerrar tareas de regeneración" onClick={() => useRegenTasksPanel.getState().setOpen(false)}><X size={16} /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-3"><ExternalTasks panel /></div></aside>
    : skillsOpen
    ? <SkillsPanel />
    : assistantOpen
    ? <AssistantPanel />
    : pagesOpen
      ? <WebRail />
      : reviewOpen && module === "notas"
        ? <ReviewPanel />
        : sourcesOpen && module === "notas"
          ? <SourcesPanel />
        : recordingsOpen && module === "notas"
          ? <RecordingsPanel />
        : codeOpen && module === "notas"
          ? <CodePanel />
        : muscleOpen && module === "ejercicio"
          ? <MuscleSchemaPanel />
          : inspectorOpen && active
            ? <Inspector />
            : null;

  return (
    <div className="flex min-h-0 flex-none">
      {face && <ErrorBoundary key={`${module}:${tasksOpen}:${skillsOpen}:${assistantOpen}:${pagesOpen}:${reviewOpen}:${sourcesOpen}:${recordingsOpen}:${codeOpen}:${muscleOpen}:${inspectorOpen}`} what="El panel derecho">{face}</ErrorBoundary>}
      <PanelLaunchers module={module} planning={planning} />
    </div>
  );
}
