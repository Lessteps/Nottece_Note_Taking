// The right column has ONE face at a time (assistant, browser pages, note outline,
// review, muscle map) and the drawing pad, which sits in the editor area. Opening any
// of them closes the rest, so nothing is left open behind another; opening the one
// that is already open closes it. The launcher strip stays visible whatever happens.

import { useApp } from "../store/app";
import { useAssistant } from "../store/assistant";
import { useWebPages } from "../store/webPages";
import { useReviewPanel } from "../components/study/ReviewPanel";
import { openInkPad } from "../components/practice/inkBridge";
import { useSourcesPanel } from "../components/english/SourcesPanel";
import { useRecordingsPanel } from "../components/english/RecordingsPanel";
import { useCodePanel } from "../store/codePanel";
import { useSkillsPanel } from "../store/skillsPanel";
import { useRegenTasksPanel } from "../store/regenTasksPanel";

export type Face = "assistant" | "pages" | "review" | "inspector" | "muscle" | "ink" | "sources" | "recordings" | "code" | "skills" | "regenTasks";

export function isFaceOpen(face: Face): boolean {
  switch (face) {
    case "assistant": return useAssistant.getState().open;
    case "pages": return useWebPages.getState().open;
    case "review": return useReviewPanel.getState().open;
    case "inspector": return useApp.getState().inspectorOpen;
    case "muscle": return useApp.getState().muscleOpen;
    case "ink": return useApp.getState().inkDraft !== null;
    case "sources": return useSourcesPanel.getState().open;
    case "recordings": return useRecordingsPanel.getState().open;
    case "code": return useCodePanel.getState().open;
    case "skills": return useSkillsPanel.getState().open;
    case "regenTasks": return useRegenTasksPanel.getState().open;
  }
}

export function closeFace(face: Face): void {
  switch (face) {
    case "assistant": useAssistant.getState().setOpen(false); break;
    case "pages": useWebPages.getState().setOpen(false); break;
    case "review": useReviewPanel.getState().setOpen(false); break;
    case "inspector": if (useApp.getState().inspectorOpen) useApp.getState().toggleInspector(); break;
    case "muscle": useApp.getState().setMuscleOpen(false); break;
    case "ink": useApp.getState().setInkDraft(null); break;
    case "sources": useSourcesPanel.getState().setOpen(false); break;
    case "recordings": useRecordingsPanel.getState().setOpen(false); break;
    case "code": useCodePanel.getState().setOpen(false); break;
    case "skills": useSkillsPanel.getState().setOpen(false); break;
    case "regenTasks": useRegenTasksPanel.getState().setOpen(false); break;
  }
}

const ALL: Face[] = ["assistant", "pages", "review", "inspector", "muscle", "ink", "sources", "recordings", "code", "skills", "regenTasks"];

/** Opens `face` (closing every other one), or closes it when it is already open. */
export function toggleFace(face: Face): void {
  if (isFaceOpen(face)) {
    closeFace(face);
    return;
  }
  for (const other of ALL) if (other !== face && isFaceOpen(other)) closeFace(other);
  switch (face) {
    case "assistant": useAssistant.getState().setOpen(true); break;
    case "pages": useWebPages.getState().setOpen(true); break;
    case "review": useReviewPanel.getState().setOpen(true); break;
    case "inspector": useApp.getState().toggleInspector(); break;
    case "muscle": useApp.getState().setMuscleOpen(true); break;
    case "ink": openInkPad(); break;
    case "sources": useSourcesPanel.getState().setOpen(true); break;
    case "recordings": useRecordingsPanel.getState().setOpen(true); break;
    case "code": useCodePanel.getState().setOpen(true); break;
    case "skills": useSkillsPanel.getState().setOpen(true); break;
    case "regenTasks": useRegenTasksPanel.getState().setOpen(true); break;
  }
}
