import { useEffect, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText } from "../../lib/clipboard";
import { useApp } from "../../store/app";
import { GhostButton, Modal } from "../common/forms";
import type { MentorPlan } from "../../lib/types";
import type { ScopeTopic } from "../../lib/methodologyScope";

export function ScopePlanReview({ planId, subplanId, groupId, title, objective, topics, plan }: { planId: string; subplanId: string; groupId?: string; title: string; objective: string; topics: readonly ScopeTopic[]; plan: MentorPlan }) {
  const [review, setReview] = useState("");
  const [draft, setDraft] = useState("");
  const [planDraft, setPlanDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"creacion" | "verificacion">("creacion");
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    let alive = true;
    setReview(""); setDraft(""); setPlanDraft("");
    api.mentorScopeReview({ planId, subplanId, groupId }).then((r) => { if (alive) { setReview(r.methodology ?? ""); setDraft(r.methodology ?? ""); setPlanDraft(r.planReview ?? ""); } }).catch((e: Error) => { if (alive) toast("error", e.message); });
    return () => { alive = false; };
  }, [planId, subplanId, groupId, toast]);
  const save = async () => {
    setBusy(true);
    try { const r = await api.mentorScopeReview({ planId, subplanId, groupId, methodology: draft }); setReview(r.methodology ?? ""); toast("info", "Metodología guardada para esta materia."); }
    catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const savePlan = async () => {
    setBusy(true);
    try { await api.mentorScopeReview({ planId, subplanId, groupId, planReview: planDraft }); toast("info", "Plan revisado guardado para esta materia."); }
    catch (e) { toast("error", (e as Error).message); } finally { setBusy(false); }
  };
  const keyBytes = new TextEncoder().encode(`${subplanId}\0${groupId ?? ""}`);
  const key = btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const file = `.notevault/mentor/scope-reviews/${planId}/${key}.json`;
  const pre = plan?.preconditions;
  const branches = Object.entries(pre?.branches ?? {}).flatMap(([subject, items]) => items.map((item) => `${subject}: ${item}`));
  const area = (plan?.subplans ?? []).find((item) => item.id === subplanId);
  const context = `Plan: ${plan?.name ?? plan?.id ?? "Plan de estudio"}\nObjetivo general declarado: ${pre?.freeObjective || "No declarado"}\nObjetivo del área: ${objective || "No declarado"}\nMateria: ${title}\nStack y ramas incluidas: ${branches.join("; ") || "No especificado en el plan"}\nRamas excluidas: ${pre?.branchExcluded?.join(", ") || "No especificadas"}\nNivel declarado: ${Object.entries(pre?.levels ?? {}).map(([name, level]) => `${name}: ${level}`).join(", ") || "No declarado"}\nAlcance y preferencias: ${[pre?.notes, area?.notes, plan?.rationale].filter(Boolean).join(" ") || "No especificado"}\nPeriodo y dedicación: ${plan?.start ?? ""} a ${plan?.end ?? ""}; ${plan?.hoursPerWeek ?? "no especificadas"} horas por semana\nTemario actual:\n${topics.map((t, i) => `${i + 1}. ${t.title} (${t.folder})`).join("\n") || "Sin temas"}`;
  const otherAreas = (plan?.subplans ?? []).map((sub) => `- ${sub.area}: ${sub.objective}; asignaturas: ${(sub.groups ?? []).map((group) => group.title).join(", ") || "sin grupos"}`).join("\n");
  const relatedContext = `\n\n## Resto de la ruta y fuentes obligatorias\n${otherAreas}\nLee el plan completo en .notevault/mentor/plans/${planId}.json, incluidos los temas activos, grupos, objetivos, prerrequisitos y temas omitidos; inspecciona también los documentos disponibles en .notevault/mentor/scope-reviews/${planId}/ y relaciona cada propuesta con sus áreas y asignaturas. Si no tienes acceso a estos archivos, dilo y solicita su contenido: no supongas que un tema no existe. Distingue lo que ya está cubierto, los vacíos reales y el contenido que pertenece mejor a otra asignatura. Identifica los prerequisitos entre rutas y el punto apropiado para estudiar cada tema. No limites la revisión a los títulos actuales: propone los fundamentos necesarios para cumplir el objetivo, pero evita duplicados y temas fuera del alcance. Consulta fuentes técnicas primarias actuales cuando dispongas de búsqueda y cita las que uses.`;
  const createPrompt = `Crea un plan completo para este alcance. ${context}${relatedContext}\nPara cada tema explica brevemente qué es, por qué está en esa posición, prerrequisitos y justificación; incluye los temas adicionales necesarios claramente identificados como propuestas. No modifiques el plan existente. Guarda el resultado como planReview en ${file}, preservando las demás propiedades JSON y usando planUpdatedAt con la fecha actual. Usa el contexto disponible y no supongas frameworks ni nivel no declarados; pregunta solo si falta información imprescindible.`;
  const verifyPrompt = `Verifica la metodología y la justificación de este plan de estudio. ${context}${relatedContext}\n\nPlan actual:\n${planDraft || "No existe un plan revisado; indícalo."}\n\nMetodología existente:\n${review || "No especificada"}\nUsa conocimiento disponible, fuentes web fiables cuando tengas acceso y materiales del usuario. Evalúa cómo se enseña, practica, repasa y comprueba cada concepto; explica si la metodología es adecuada, sus limitaciones y mejoras. Distingue hechos comprobados de recomendaciones, cita las fuentes consultadas y pregunta cuando falte contexto. Guarda la evaluación en la propiedad methodology de ${file}, preservando los demás campos y actualizando updatedAt. No alteres los temas ni el orden.`;
  const topicDescription = (topic: ScopeTopic) => {
    const lines = planDraft.split("\n");
    const i = lines.findIndex((line) => line.includes(topic.title));
    return i < 0 ? "Sin justificación guardada todavía." : lines[i]!.replace(/^\s*\d+[.)]\s*/, "").replace(/\*\*/g, "");
  };
  return <><GhostButton large="md" onClick={() => setOpen(true)}>Verificar plan</GhostButton>{open && <Modal title={`Plan · ${title}`} onClose={() => setOpen(false)} width={1100}>
    <div className="space-y-4"><div><p className="text-xs uppercase tracking-wider text-accent-text">Plan de estudio / {title}</p><p className="mt-1 text-sm text-dim">Objetivo: {objective || "Sin objetivo definido"}</p></div>
    <div role="tablist" aria-label="Plan de estudio" className="flex flex-wrap gap-2 border-b border-line pb-2"><button type="button" role="tab" aria-selected={tab === "creacion"} onClick={() => setTab("creacion")} className={tab === "creacion" ? "rounded-lg bg-accent-soft px-3 py-2 text-accent-text" : "px-3 py-2 text-dim"}>Creación del plan</button><button type="button" role="tab" aria-selected={tab === "verificacion"} onClick={() => setTab("verificacion")} className={tab === "verificacion" ? "rounded-lg bg-accent-soft px-3 py-2 text-accent-text" : "px-3 py-2 text-dim"}>Verificación</button></div>
    {tab === "creacion" ? <section className="space-y-3" role="tabpanel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-text">Temario actual · {topics.length} temas</h3><GhostButton onClick={() => void copyText(createPrompt).then((ok) => toast(ok ? "info" : "error", ok ? "Prompt de creación copiado." : "No se pudo copiar."))}>Copiar prompt para crear plan</GhostButton></div><ol className="max-h-[45vh] space-y-2 overflow-auto">{topics.map((t, i) => <li key={t.folder} className="rounded-lg border border-line bg-panel p-3"><p className="font-semibold text-text">{i + 1}. {t.title}</p><p className="mt-1 break-words text-xs text-dim">{topicDescription(t)}</p></li>)}</ol><details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm text-dim">Ver o editar el resultado guardado</summary><p className="mt-2 text-xs text-faint">Este documento conserva la respuesta para volver a consultarla; copiar el prompt solo inicia la tarea.</p><label className="block text-sm text-dim">Plan y justificaciones<textarea className="mt-2 w-full rounded-lg border border-line bg-panel p-3 font-mono text-xs text-text" rows={7} value={planDraft} onChange={(e) => setPlanDraft(e.target.value)} /></label><GhostButton disabled={busy || !review || !planDraft.trim()} onClick={() => void savePlan()}>Guardar plan</GhostButton></details>{!review && <p className="text-xs text-warn">Guarda primero la verificación de metodología.</p>}</section> : <section className="space-y-3" role="tabpanel"><h3 className="font-semibold text-text">Justificación de plan</h3><p className="text-sm text-dim">Evalúa la metodología, sus evidencias y las mejoras propuestas. Un agente puede guardar el resultado en la bóveda.</p><GhostButton onClick={() => void copyText(verifyPrompt).then((ok) => toast(ok ? "info" : "error", ok ? "Prompt de verificación copiado." : "No se pudo copiar."))}>Copiar prompt de verificación</GhostButton><label className="block text-sm text-dim">Resultado de la verificación<textarea className="mt-2 w-full rounded-lg border border-line bg-panel p-3 font-mono text-xs text-text" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} /></label><GhostButton onClick={() => void save()} disabled={busy || !draft.trim()}>Guardar justificación</GhostButton></section>}</div>
  </Modal>}</>;
}
