// Contexto acotado del plan para generar teoría, práctica y ejercicios.
// El orden planificado no prueba dominio: solo se afirma completado cuando consta en el plan.
import { PlanStore, topicState, type Plan, type TopicLite } from "./plan.js";

export function learningContextOf(plan: Plan, folder: string, snapshots?: ReadonlyMap<string, TopicLite>): string {
  const sub = plan.subplans.find((s) => s.topics.some((t) => t.folder === folder && t.route !== "skipped"));
  const index = sub?.topics.findIndex((t) => t.folder === folder) ?? -1;
  if (!sub || index < 0) return "";
  const topic = sub.topics[index]!;
  const route = sub.topics.filter((t) => t.route !== "skipped");
  const pos = route.findIndex((t) => t.folder === folder);
  const prior = route.slice(0, pos).filter((t) => t.group === topic.group).slice(-5);
  const next = route.slice(pos + 1).filter((t) => t.group === topic.group).slice(0, 3);
  const completed = route.filter((t) => !!t.completedAt || (!!snapshots?.get(t.folder) && topicState(snapshots.get(t.folder)!) === "completo"));
  const current = snapshots?.get(folder);
  const lines = [
    "LEARNING PLAN CONTEXT (follow the content skill and its output contract first):",
    `Plan: ${plan.name || plan.id}. Area: ${sub.area}. Area goal: ${sub.objective || "not specified"}.`,
    ...(plan.preconditions?.freeObjective ? [`Learner's stated objective: ${plan.preconditions.freeObjective}`] : []),
    ...(plan.preconditions?.notes ? [`Learner's stated preferences: ${plan.preconditions.notes}`] : []),
    ...(plan.preconditions?.levels && Object.keys(plan.preconditions.levels).length ? [`Declared levels: ${Object.entries(plan.preconditions.levels).map(([name, level]) => `${name}: ${level}`).join("; ")}.`] : ["Learner level: not declared; do not invent it."]),
    ...(plan.preconditions?.branchExcluded?.length ? [`Excluded branches: ${plan.preconditions.branchExcluded.join("; ")}.`] : []),
    ...(plan.rationale ? [`Plan context: ${plan.rationale}`] : []),
    ...(sub.learningGuide ? [`Area learning guidance: ${sub.learningGuide}`] : sub.notes ? [`Area learning guidance: ${sub.notes}`] : []),
    `Current topic: ${topic.title}. Its active route position is ${pos + 1} of ${route.length}.`,
    `Immediately preceding planned topics in this group: ${prior.map((t) => t.title).join("; ") || "none"}.`,
    `Later planned topics in this group: ${next.map((t) => t.title).join("; ") || "none"}.`,
    `Progress from recorded plan and practice: ${completed.length} of ${route.length} topics completed${completed.length ? `; completed: ${completed.slice(-5).map((t) => t.title).join("; ")}` : ""}.`,
    ...(current ? [`Current topic: ${current.attemptCount} recorded attempts; ${current.progress.completenessPct}% measured completeness.`] : ["Current topic practice progress is unavailable; do not infer mastery."]),
    "Planned before does not mean mastered; unmarked topics have unknown mastery. Start at the learner's declared level or from zero when unknown. Explain prerequisites needed for this topic and do not assume later topics. Connect examples and exercises to the area goal. Preserve the skill format and requested output paths.",
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}
export function learningPlanContext(root: string, folder: string, snapshots?: ReadonlyMap<string, TopicLite>, plans?: readonly Plan[]): string {
  try {
    const matching = (plans ?? new PlanStore(root).list()).filter((p) => !p.archived && !p.proposed && p.subplans.some((s) => s.topics.some((t) => t.folder === folder && t.route !== "skipped")));
    // Multiple matching plans are ambiguous: report the ambiguity, never invent a preferred plan.
    if (matching.length > 1) return "\n\nThis topic belongs to several active plans; do not assume which plan or progress applies. Teach prerequisites explicitly.\n\n";
    return matching[0] ? learningContextOf(matching[0], folder, snapshots) : "";
  } catch { return ""; }
}
