// Mentor — la tarea para un agente externo ya está escrita: la frase para pegar (Copiar), «Abrir carpeta», cuántos archivos esperados ya hay y
// «Ya terminó — validar». Si algo falla, el motivo exacto de cada tema y «Restaurar copia» (con confirmación). Sirve para un tema y para un lote.

import { CheckCircle2, ClipboardCopy, FolderOpen, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText } from "../../lib/clipboard";
import type { RegenHandoff } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useRegenEngine } from "../../store/regenEngine";
import { GhostButton, PrimaryButton } from "../common/forms";
import { useModuleVisible } from "../ModuleHost";

const POLL_MS = 4000;
const WHAT: Record<RegenHandoff["what"], string> = { theory: "la teoría", practice: "la práctica", exercises: "los ejercicios", all: "todo", "theory+practice": "la teoría y la práctica", "theory+exercises": "la teoría y los ejercicios", "practice+exercises": "la práctica y los ejercicios" };

export function RegenHandoffPanel({ handoff, onClose, allowHidePending = true }: { handoff: RegenHandoff; onClose?: () => void; allowHidePending?: boolean }) {
  const toast = useApp((s) => s.toast);
  const put = useRegenEngine((s) => s.putHandoff);
  const drop = useRegenEngine((s) => s.dropHandoff);
  const [busy, setBusy] = useState<"" | "validate" | "restore">("");
  const [asking, setAsking] = useState(false);
  const moduleVisible = useModuleVisible();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // «el agente ya escribió»: se mira cada pocos segundos cuántos archivos esperados existen (la validación sigue siendo un clic)
  const open = handoff.status === "waiting" || handoff.status === "failed";
  useEffect(() => {
    if (!open || !moduleVisible) return;
    let active = true;
    let pending = false;
    const poll = () => {
      if (!active || pending || document.visibilityState === "hidden") return;
      pending = true;
      api.studyTopicRegenerateHandoffStatus(handoff.id)
        .then((h) => { if (active && alive.current) put(h); })
        .catch(() => undefined)
        .finally(() => { pending = false; });
    };
    const onVisibility = () => { if (document.visibilityState !== "hidden") poll(); };
    const t = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisibility); };
  }, [open, handoff.id, put, moduleVisible]);

  const run = async (restore: boolean): Promise<void> => {
    setBusy(restore ? "restore" : "validate");
    setAsking(false);
    try {
      const h = await api.studyTopicRegenerateValidate(handoff.id, restore);
      if (alive.current) put(h);
      useMentor.setState((s) => ({ planVersion: s.planVersion + 1 }));
      if (restore) toast("info", "Se devolvió la copia de seguridad de los temas con error.");
      else if (h.status === "validated") toast("info", `Se validó y aplicó ${WHAT[h.what]} de ${h.topics.length === 1 ? `«${h.topics[0]!.title}»` : `${h.topics.length} temas`}. Lo anterior está respaldado en .trash/regenerar.`);
      else toast("error", "Hay temas que no pasaron la validación: mira el detalle.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      if (alive.current) setBusy("");
    }
  };

  const copy = async (): Promise<void> => {
    await copyText(handoff.prompt);
    toast("info", "Instrucción copiada: pégala en Antigravity o en Claude Code.");
  };
  const failing = handoff.topics.filter((t) => t.state === "error");
  const copyErrors = async (): Promise<void> => {
    const details = failing.map((t) => `${t.title}\n${t.problems.length ? t.problems.map((p) => `- ${p}`).join("\n") : "- No pasó la validación."}`).join("\n\n");
    const report = [`Tarea: ${handoff.id}`, `Estado: ${handoff.status}`, details, handoff.log.length ? `Registro:\n${handoff.log.join("\n")}` : ""].filter(Boolean).join("\n\n");
    try {
      if (await copyText(report)) toast("info", "Errores de generación copiados.");
      else toast("error", "No se pudieron copiar los errores.");
    } catch (e) { toast("error", (e as Error).message || "No se pudieron copiar los errores."); }
  };
  const { found, expected } = handoff.ready;

  return (
    <section className="space-y-2.5 rounded-xl border border-accent bg-card p-3 text-[13.5px]" data-testid="handoff-regen-panel" data-status={handoff.status}>
      <p className="font-semibold">
        {handoff.status === "validated" ? "Listo: el resultado del agente se validó y se aplicó." : handoff.status === "restored" ? "Se devolvió lo anterior." : `Tarea para el agente: ${handoff.missingOnly ? "completar" : "regenerar"} ${WHAT[handoff.what]} de ${handoff.topics.length === 1 ? `«${handoff.topics[0]!.title}»` : `${handoff.topics.length} temas`}.`}
      </p>

      {open && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-dim">
            <li>Abre Antigravity o Claude Code en tu vault y pega esta instrucción.</li>
            <li>Cuando el agente diga que terminó, pulsa «Ya terminó — validar».</li>
          </ol>
          <div className="flex flex-wrap items-stretch gap-2">
            <code className="min-w-0 flex-1 basis-64 break-all rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12.5px]" data-testid="handoff-regen-prompt">{handoff.prompt}</code>
            <GhostButton onClick={() => void copy()} data-testid="handoff-regen-copy"><ClipboardCopy size={14} aria-hidden /> Copiar</GhostButton>
            <GhostButton onClick={() => void api.revealPath(handoff.task).catch((e: Error) => toast("error", e.message))} data-testid="handoff-regen-open"><FolderOpen size={14} aria-hidden /> Abrir carpeta</GhostButton>
          </div>
          <p className="text-dim">
            La tarea está en <code>{handoff.task}</code>. Antes de nada la app respaldó lo actual en <code>.trash/regenerar</code>.
          </p>
          <p role="status" className="text-dim" data-testid="handoff-regen-ready">
            {expected > 0 ? `El agente lleva ${found} de ${expected} archivo${expected === 1 ? "" : "s"} esperado${expected === 1 ? "" : "s"}.` : "Esperando al agente…"}
          </p>
        </>
      )}

      {handoff.topics.some((t) => t.state !== "pending") && (
        <ul className="space-y-1" data-testid="handoff-regen-topics">
          {handoff.topics.map((t) => (
            <li key={t.folder} data-testid="handoff-regen-topic" data-state={t.state} className={t.state === "error" ? "text-warn" : t.state === "ok" ? "text-mint" : "text-dim"}>
              <span className="inline-flex items-center gap-1">
                {t.state === "ok" ? <CheckCircle2 size={13} aria-hidden /> : t.state === "error" ? <XCircle size={13} aria-hidden /> : null}
                <strong>{t.title}</strong>: {t.state === "ok" ? "validado" : t.state === "restored" ? "se devolvió la copia" : t.state === "error" ? "no pasó la validación" : "pendiente"}
              </span>
              {t.problems.length > 0 && (
                <ul className="mt-0.5 list-disc space-y-0.5 pl-6 text-[13px]">
                  {t.problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
                  {t.problems.length > 6 && <li>y {t.problems.length - 6} más</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(failing.length > 0 || handoff.status === "failed") && <GhostButton onClick={() => void copyErrors()} data-testid="handoff-regen-copy-errors"><ClipboardCopy size={14} aria-hidden /> Copiar errores</GhostButton>}
        {open && (
          <PrimaryButton onClick={() => void run(false)} disabled={!!busy} data-testid="handoff-regen-validate">
            {busy === "validate" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Ya terminó — validar
          </PrimaryButton>
        )}
        {failing.length > 0 && !asking && (
          <GhostButton danger onClick={() => setAsking(true)} disabled={!!busy} data-testid="handoff-regen-restore"><RotateCcw size={14} aria-hidden /> Restaurar copia</GhostButton>
        )}
        {asking && (
          <span className="flex flex-wrap items-center gap-2" data-testid="handoff-regen-restore-ask">
            <span className="font-medium">¿Devolver la copia de seguridad de {failing.length === 1 ? "«" + failing[0]!.title + "»" : `${failing.length} temas`}? Se pierde lo que escribió el agente.</span>
            <GhostButton danger onClick={() => void run(true)} data-testid="handoff-regen-restore-confirm">Sí, restaurar</GhostButton>
            <GhostButton onClick={() => setAsking(false)} data-testid="handoff-regen-restore-cancel">No</GhostButton>
          </span>
        )}
        {(!open || allowHidePending) && <GhostButton onClick={() => { drop(handoff.id); onClose?.(); }} disabled={!!busy} data-testid="handoff-regen-close">{open ? "Ocultar" : "Cerrar"}</GhostButton>}
      </div>
    </section>
  );
}
