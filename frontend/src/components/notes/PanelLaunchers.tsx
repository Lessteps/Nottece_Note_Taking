// La tira de lanzadores del borde derecho de Notas: aparece cuando el panel no
// esta mostrando nada y sus botones son las caras que puede tener.
//
// El globo no es el modulo del navegador: muestra y oculta la lista de paginas
// *dentro* del panel, sin moverte de donde estas.
//
// Los botones se pueden reordenar arrastrándolos con el ratón; el orden se recuerda
// (ver lib/launcherOrder).

import { Bug, CalendarClock, ClipboardList, Crop, Globe, GraduationCap, Headphones, ListTree, Mic, Map as MapIcon, PenTool, ScrollText, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toggleFace } from "../../lib/panelFaces";
import { startScreenCapture } from "../../lib/screenCapture";
import { applyLauncherOrder, loadLauncherOrder, moveLauncher, saveLauncherOrder } from "../../lib/launcherOrder";
import { subjectUsesLatex, useActiveSubject } from "../../lib/useActiveSubject";
import { useReviewPanel } from "../study/ReviewPanel";
import { useSourcesPanel } from "../english/SourcesPanel";
import { useRecordingsPanel } from "../english/RecordingsPanel";
import { useCodePanel } from "../../store/codePanel";
import { useSkillsPanel } from "../../store/skillsPanel";
import { useRegenTasksPanel } from "../../store/regenTasksPanel";
import { useApp } from "../../store/app";
import { useAssistant } from "../../store/assistant";
import { useWebPages } from "../../store/webPages";
import { cn } from "../ui";

export function PanelLaunchers({ module, planning = false }: { module: string; planning?: boolean }) {
  const active = useApp((s) => s.active);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const muscleOpen = useApp((s) => s.muscleOpen);
  const assistantOpen = useAssistant((s) => s.open);
  const pages = useWebPages((s) => s.pages.length);
  const pagesOpen = useWebPages((s) => s.open);
  const reviewOpen = useReviewPanel((s) => s.open);
  const inkOpen = useApp((s) => s.inkDraft !== null);
  const sourcesOpen = useSourcesPanel((s) => s.open);
  const recordingsOpen = useRecordingsPanel((s) => s.open);
  const codeOpen = useCodePanel((s) => s.open);
  const skillsOpen = useSkillsPanel((s) => s.open);
  const tasksOpen = useRegenTasksPanel((s) => s.open);
  const [saved, setSaved] = useState<string[]>(loadLauncherOrder);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const subject = useActiveSubject();
  const latexTool = subjectUsesLatex(subject);
  // Moving to an English area closes a drawing pad that was left open in a maths one.
  useEffect(() => {
    if (!latexTool && inkOpen) useApp.getState().setInkDraft(null);
  }, [latexTool, inkOpen]);
  // The English tools (library of sources) belong to English spaces only.
  const englishTools = subject.toLowerCase() === "english";
  useEffect(() => {
    if (!englishTools && sourcesOpen) useSourcesPanel.getState().setOpen(false);
    if (!englishTools && recordingsOpen) useRecordingsPanel.getState().setOpen(false);
  }, [englishTools, sourcesOpen, recordingsOpen]);
  // The debugger belongs to programming spaces.
  const programmingTools = subject.toLowerCase() === "programming";
  useEffect(() => {
    if (!programmingTools && codeOpen) useCodePanel.getState().setOpen(false);
  }, [programmingTools, codeOpen]);

  const cell = (on: boolean, enabled = true) =>
    cn(
      "relative grid h-8 w-8 place-items-center rounded-lg transition-colors",
      !enabled ? "cursor-not-allowed text-faint/50" : on ? "bg-hover text-text" : "text-dim hover:bg-hover hover:text-text",
    );

  // Every button of the strip, in its default order. `show` says whether it belongs
  // to this area; the user's drag-and-drop order is applied on top of it.
  const items: Array<{ id: string; show: boolean; node: ReactNode }> = [
    { id: "regen-tasks", show: module === "mentor" && planning, node: (
      <button type="button" title="Historial de tareas de regeneración" aria-label="Tareas de regeneración" aria-pressed={tasksOpen} onClick={() => toggleFace("regenTasks")} className={cell(tasksOpen)} data-testid="launcher-regen-tasks"><ClipboardList size={16} /></button>
    ) },
    {
      // The muscle map is Ejercicio's: outside it, it draws nothing.
      id: "muscle", show: module === "ejercicio",
      node: (
        <button type="button" title={muscleOpen ? "Ocultar el esquema muscular" : "Esquema muscular del día"} aria-label="Esquema muscular"
          aria-pressed={muscleOpen} onClick={() => toggleFace("muscle")} className={cell(muscleOpen)}>
          <MapIcon size={16} />
        </button>
      ),
    },
    {
      id: "assistant", show: true,
      node: (
        <button type="button" title={assistantOpen ? "Cerrar el Asistente IA" : "Abrir Asistente IA"} aria-label="Asistente IA"
          aria-pressed={assistantOpen} onClick={() => toggleFace("assistant")} className={cell(assistantOpen)}>
          <Sparkles size={16} />
        </button>
      ),
    },
    {
      // Not a face of the panel: opens the Mentor tab (today's plan, goals, projects, notes and chat).
      id: "mentor", show: true,
      node: (
        <button type="button" title="Mentor: plan de hoy, metas y conversación" aria-label="Mentor"
          onClick={() => useApp.getState().setModule("mentor")} className={cell(false)}>
          <GraduationCap size={16} />
        </button>
      ),
    },
    {
      // Las instrucciones con las que se generan las notas, los mapas y la práctica: se ven, se editan, tienen historial y se pueden pedir cambios.
      id: "skills", show: true,
      node: (
        <button type="button" title={skillsOpen ? "Cerrar las skills" : "Skills: instrucciones de generación (notas, mapa, práctica)"} aria-label="Skills"
          aria-pressed={skillsOpen} onClick={() => toggleFace("skills")} className={cell(skillsOpen)} data-testid="launcher-skills">
          <ScrollText size={16} />
        </button>
      ),
    },
    {
      id: "pages", show: true,
      node: (
        <button type="button" title={pagesOpen ? "Ocultar las páginas del navegador" : "Mostrar las páginas del navegador"} aria-label="Páginas del navegador"
          aria-pressed={pagesOpen} onClick={() => toggleFace("pages")} className={cell(pagesOpen)}>
          <Globe size={16} />
          {pages > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[9.5px] font-bold text-white">
              {pages}
            </span>
          )}
        </button>
      ),
    },
    {
      // Screenshot (also Ctrl+Alt+S): rectangle, stroke, window or full screen, saved in the attachments folder.
      id: "capture", show: true,
      node: (
        <button type="button" title="Captura de pantalla (Ctrl+Alt+S): rectángulo, trazo, ventana o pantalla completa" aria-label="Captura de pantalla"
          onClick={() => void startScreenCapture()} className={cell(false)}>
          <Crop size={16} />
        </button>
      ),
    },
    {
      // Not "a panel": the note's outline, which needs a note.
      id: "outline", show: true,
      node: (
        <button type="button" title={active ? "Esquema de la nota" : "Esquema de la nota (abre una nota primero)"} aria-label="Esquema de la nota"
          aria-pressed={inspectorOpen} disabled={!active} onClick={() => toggleFace("inspector")} className={cell(inspectorOpen, !!active)}>
          <ListTree size={16} />
        </button>
      ),
    },
    {
      // English tools: the library of podcasts, films and TED talks.
      id: "sources", show: module === "notas" && englishTools,
      node: (
        <button type="button" title={sourcesOpen ? "Cerrar el reproductor" : "Reproductor: tus podcasts, películas y TED con su transcripción"} aria-label="Reproductor"
          aria-pressed={sourcesOpen} onClick={() => toggleFace("sources")} className={cell(sourcesOpen)}>
          <Headphones size={16} />
        </button>
      ),
    },
    {
      id: "recordings", show: module === "notas" && englishTools,
      node: (
        <button type="button" title={recordingsOpen ? "Cerrar las grabaciones" : "Grabaciones de tu voz: grabar y escuchar a distintas velocidades"} aria-label="Grabaciones"
          aria-pressed={recordingsOpen} onClick={() => toggleFace("recordings")} className={cell(recordingsOpen)}>
          <Mic size={16} />
        </button>
      ),
    },
    {
      // Programming tools: run the code of an exercise and step through it.
      id: "code", show: module === "notas" && programmingTools,
      node: (
        <button type="button" title={codeOpen ? "Cerrar el depurador" : "Depurar: ejecuta tu código y recórrelo línea a línea"} aria-label="Depurar"
          aria-pressed={codeOpen} onClick={() => toggleFace("code")} className={cell(codeOpen)}>
          <Bug size={16} />
        </button>
      ),
    },
    {
      // Repaso (spaced repetition): only inside Notas, where the study areas live.
      id: "review", show: module === "notas",
      node: (
        <button type="button" title="Repaso espaciado" aria-label="Repaso" aria-pressed={reviewOpen}
          onClick={() => toggleFace("review")} className={cell(reviewOpen)}>
          <CalendarClock size={16} />
        </button>
      ),
    },
    {
      // A drawing pad in a split view; pressing it again closes it.
      id: "ink", show: module === "notas" && latexTool,
      node: (
        <button type="button" title={inkOpen ? "Cerrar el dibujo LaTeX" : "Dibujar LaTeX (lienzo infinito en vista dividida)"} aria-label="Dibujar LaTeX"
          aria-pressed={inkOpen} onClick={() => toggleFace("ink")} className={cell(inkOpen)}>
          <PenTool size={16} />
        </button>
      ),
    },
  ];
  const ordered = applyLauncherOrder(items.filter((i) => i.show).map((i) => i.id), saved);

  const drop = (target: string) => {
    if (!dragging) return;
    const next = moveLauncher(ordered, dragging, target);
    // Buttons hidden in this area keep the place they had, for the areas that show them.
    const merged = [...next, ...saved.filter((id) => !next.includes(id))];
    setSaved(merged);
    saveLauncherOrder(merged);
    setDragging(null);
    setOver(null);
  };

  return (
    <aside
      aria-label="Acceso panel lateral"
      className="flex w-10 flex-none flex-col items-center gap-2 border-l border-line bg-panel py-3"
    >
      {ordered.map((id) => (
        <div
          key={id}
          draggable
          onDragStart={(e) => {
            setDragging(id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
          }}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            if (over !== id) setOver(id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          className={cn(
            "rounded-lg",
            dragging === id && "opacity-40",
            over === id && dragging !== id && "outline outline-1 outline-accent",
          )}
        >
          {items.find((i) => i.id === id)!.node}
        </div>
      ))}
    </aside>
  );
}
