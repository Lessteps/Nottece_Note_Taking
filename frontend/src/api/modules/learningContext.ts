import type { AppState } from "../appState.js";
import { PlanStore } from "../../core/mentor/plan.js";
import { learningPlanContext } from "../../core/mentor/learningPlanContext.js";
import { topicSnaps } from "./topicSnapshots.js";
export function topicLearningContexts(app: AppState, folders: readonly string[]): string[] {
  try {
    const plans = new PlanStore(app.root).list();
    if (!plans.some((p) => !p.archived && !p.proposed && p.subplans.some((sub) => sub.topics.some((t) => folders.includes(t.folder))))) return folders.map(() => "");
    let snapshots;
    try { snapshots = new Map(topicSnaps(app).map((s) => [s.folder, s])); } catch { snapshots = undefined; }
    return folders.map((folder) => learningPlanContext(app.root, folder, snapshots, plans));
  } catch { return folders.map(() => ""); }
}
export function topicLearningContext(app: AppState, folder: string): string {
  return topicLearningContexts(app, [folder])[0] ?? "";
}
