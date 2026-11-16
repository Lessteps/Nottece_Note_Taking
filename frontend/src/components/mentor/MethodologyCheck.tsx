import { ClipboardCheck, ClipboardCopy, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/bridge";
import { copyText } from "../../lib/clipboard";
import { reviewPrompt, type MethodologyScope, type ScopeTopic } from "../../lib/methodologyScope";
import { useApp } from "../../store/app";
import { GhostButton, Modal } from "../common/forms";
import { cn } from "../ui";

export function MethodologyCheckButton({ scope, topics, label = "Verificar metodología", className, testid = "methodology-check" }: { scope: MethodologyScope; topics: readonly ScopeTopic[]; label?: string; className?: string; testid?: string; planId?: string }) {
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [answer, setAnswer] = useState("");
  const prompt = reviewPrompt(scope, topics);
  const copy = async (text: string) => { const ok = await copyText(text); toast(ok ? "info" : "error", ok ? "Texto copiado." : "No se pudo copiar el texto."); };
  const review = async () => {
    setReviewing(true); setAnswer("");
    try { const r = await api.mentorMethodologyReview({ prompt }); if (!r.aiConfigured) toast("info", "Configura una IA o copia el prompt para revisarlo con otra herramienta."); else setAnswer(r.text || "La IA no devolvió una respuesta."); }
    catch (e) { toast("error", (e as Error).message); } finally { setReviewing(false); }
  };
  return <><GhostButton large="md" className={cn(className)} onClick={() => setOpen(true)} aria-expanded={open} data-testid={testid}><ClipboardCheck size={15} aria-hidden /> {label}</GhostButton>
    {open && <Modal title={`Verificar metodología · ${scope.label}`} onClose={() => setOpen(false)} width={720}>
      <div className="space-y-4"><p className="text-sm text-dim" data-testid="methodology-intro">Evalúa cómo estudiar esta materia: teoría, práctica, retroalimentación, evaluación y repaso. La revisión usa los temas actuales como contexto.</p>
      <div className="flex flex-wrap gap-2"><GhostButton onClick={() => void copy(prompt)} data-testid="methodology-copy-prompt"><ClipboardCopy size={15} /> Copiar prompt de metodología</GhostButton><GhostButton onClick={() => void review()} disabled={reviewing} data-testid="methodology-ai-review">{reviewing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Revisar con IA</GhostButton></div>
      {answer && <section aria-label="Respuesta de la IA"><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-3 text-sm">{answer}</pre><GhostButton onClick={() => void copy(answer)}>Copiar resultado</GhostButton></section>}
      <p className="text-xs text-faint">Para guardar el resultado y revisar el contenido y orden de los temas, abre «Verificar plan».</p></div>
    </Modal>}</>;
}
