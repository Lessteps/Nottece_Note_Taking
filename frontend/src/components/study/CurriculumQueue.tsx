// Temas por crear — la interfaz SENCILLA: dos modos, el mismo resultado.
//  · AUTOMÁTICO: la app misma escribe los temas con su IA (clave de API, Claude Code o modelo local), uno tras otro, con barra de progreso, «Detener» y
//    «Añadir al plan» al terminar. Lo ya creado se salta al relanzar.
//  · MANUAL (Antigravity): la cola de abajo, en tres pasos lineales y sin elegir nada a mano:
//   1. «Solo lo esencial» (o «Todo lo que falta»): la app escribe las tareas por lotes y UN archivo maestro que las encadena.
//   2. «Copiar instrucción»: una sola frase para pegar en Antigravity; el agente hace las tareas una detrás de otra.
//   3. «Ya terminó — validar todo» y «Añadir al plan». «Empezar de nuevo» descarta lo pendiente.
// Es idempotente: pulsar otra vez no duplica tareas. La selección a mano sigue existiendo debajo, plegada.

import { Bot, CheckCircle2, ClipboardCopy, Loader2, RotateCcw, Rocket, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import type { CurriculumAutoJob } from "../../lib/types";
import { cn } from "../ui";
import { copyText } from "../../lib/clipboard";
import { useApp } from "../../store/app";
import { useCurriculum, type CurriculumHandoffState } from "../../store/curriculum";
import { GhostButton, PrimaryButton } from "../common/forms";
import { ProgressBar } from "../mentor/parts";
import { AddToPlan, refreshEverything, selectablePlans } from "./CurriculumHandoffPanel";
import { useMentor } from "../../store/mentor";
import { useModuleVisible } from "../ModuleHost";

export function CurriculumQueue({ areaId, areaTitle, missing, essentials, withExercises }: { areaId: string; areaTitle: string; missing: number; essentials: number; withExercises: boolean }) {
  const toast = useApp((s) => s.toast);
  const allPending = useCurriculum((s) => s.pending);
  const queue = useMemo(() => allPending.filter((h) => h.areaId === areaId), [allPending, areaId]);
  const [busy, setBusy] = useState<"" | "make" | "validate" | "discard">("");
  const [prompt, setPrompt] = useState("");
  const [done, setDone] = useState<CurriculumHandoffState[]>([]);
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<{ ready: boolean; reason: string; label: string } | null>(null);
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  const [job, setJob] = useState<CurriculumAutoJob | null>(null);
  const jobId = useRef("");
  const autoRun = useCurriculum((st) => st.autoRun);
  const touched = useRef(false);
  const isVisible = useModuleVisible();

  // ¿puede la app escribir los temas ella sola? Si sí, ese es el modo por omisión
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.studyCurriculumAutoEngine())
      .then((e) => {
        if (!live) return;
        setEngine(e);
        if (!touched.current) setMode(e.ready ? "auto" : "manual");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // un trabajo lanzado desde otro sitio (la selección a mano) o que seguía corriendo al volver a esta pantalla
  useEffect(() => {
    if (!autoRun || autoRun.areaId !== areaId || jobId.current === autoRun.jobId) return;
    jobId.current = autoRun.jobId;
    api.studyCurriculumAutoStatus(autoRun.jobId).then((j) => { setMode("auto"); touched.current = true; setJob(j); }).catch(() => undefined);
  }, [autoRun, areaId]);

  // el progreso del trabajo automático (cada segundo mientras corre)
  useEffect(() => {
    if (!job || job.done || !isVisible) return;
    let active = true;
    let pending = false;
    const poll = () => {
      if (pending) return;
      pending = true;
      api.studyCurriculumAutoStatus(jobId.current).then((j) => {
        if (!active) return;
        setJob(j);
        if (j.done) refreshEverything();
      }).catch(() => undefined).finally(() => { pending = false; });
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => { active = false; clearInterval(t); };
  }, [job?.id, job?.done, isVisible]);

  const startAuto = async (importance?: string): Promise<void> => {
    setBusy("make");
    try {
      const r = await api.studyCurriculumAutoStart({ areaId, ...(importance ? { importance } : {}), confirm: true });
      jobId.current = r.jobId;
      useCurriculum.getState().setAutoRun({ areaId, jobId: r.jobId });
      setJob(await api.studyCurriculumAutoStatus(r.jobId));
      toast("info", `Generando ${r.total} ${r.total === 1 ? "tema" : "temas"} con la IA de la app, uno tras otro.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const stopAuto = (): void => void api.studyCurriculumAutoCancel(jobId.current);

  // al volver a la pantalla con una cola ya hecha, se recupera la frase del maestro (no añade tareas)
  useEffect(() => {
    if (!queue.length || prompt) return;
    useCurriculum.getState().createBatches({ areaId, refreshOnly: true, withExercises }).then((q) => setPrompt(q.master.shortPrompt)).catch(() => undefined);
  }, [queue.length, prompt, areaId, withExercises]);

  // el avance REAL en disco (carpeta, nota, manifiesto): la app no siempre se entera sola de lo que escribe un agente externo, así que se mira cada 5 s (solo visible)
  const ids = queue.map((h) => h.id).join("|");
  useEffect(() => {
    if (!ids || mode !== "manual" || !isVisible) return;
    const poll = (): void => {
      for (const id of ids.split("|")) void useCurriculum.getState().status(id).catch(() => undefined);
    };
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [ids, mode, isVisible]);
  const written = queue.reduce((n, h) => n + h.ready.found, 0);
  const expected = queue.reduce((n, h) => n + h.ready.expected, 0);

  const topics = queue.reduce((n, h) => n + h.entries.length, 0);
  const validatedTopics = done.filter((h) => h.status === "validated");
  const total = queue.length + validatedTopics.length;
  const failed = queue.filter((h) => h.status === "failed");
  const folders = validatedTopics.flatMap((h) => h.entries.map((e) => e.folder));

  // Lo validado (o generado en automático) entra SOLO al plan activo, al final de la ruta de su área: nadie tiene que acordarse de «Añadir al plan». Es idempotente y se
  // puede deshacer desde el historial del plan. Si no hay un plan activo, queda el botón de abajo.
  const addedKey = useRef("");
  const autoFolders = job?.done ? job.created : folders;
  const autoKey = autoFolders.join("|");
  useEffect(() => {
    if (!autoKey || addedKey.current === autoKey) return;
    addedKey.current = autoKey;
    let live = true;
    void (async () => {
      try {
        const rows = selectablePlans(await api.mentorPlanList());
        const plan = rows.find((p) => p.status === "activo");
        if (!plan || !live) return;
        const res = await useCurriculum.getState().addToPlan(plan.id, autoKey.split("|"));
        if (!live) return;
        toast("info", `${res.message} (plan «${plan.name}»)`);
        useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      } catch {
        /* queda el botón «Añadir al plan» */
      }
    })();
    return () => {
      live = false;
    };
  }, [autoKey, toast]);

  const make = async (importance?: string): Promise<void> => {
    setBusy("make");
    try {
      const q = await useCurriculum.getState().createBatches({ areaId, ...(importance ? { importance } : {}), withExercises });
      setPrompt(q.master.shortPrompt);
      setDone([]);
      toast("info", `Cola lista: ${q.tasks.length} ${q.tasks.length === 1 ? "tarea" : "tareas"}. Copia la instrucción y pégala en Antigravity.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const copy = async (): Promise<void> => {
    const ok = await copyText(prompt);
    setCopied(ok);
    toast(ok ? "info" : "error", ok ? "Copiado: pégalo en Antigravity." : "No se pudo copiar.");
  };
  const validate = async (): Promise<void> => {
    setBusy("validate");
    try {
      const list = await useCurriculum.getState().validateAll(areaId);
      setDone((d) => [...d, ...list.filter((h) => h.status === "validated")]);
      const ok = list.filter((h) => h.status === "validated").length;
      toast(ok === list.length ? "info" : "error", ok === list.length ? `Todo validado (${ok} ${ok === 1 ? "tarea" : "tareas"}).` : `${ok} de ${list.length} validadas; el resto aún no está terminado o tiene problemas.`);
      refreshEverything();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const discard = async (): Promise<void> => {
    if (!window.confirm(`¿Descartar las ${queue.length} tareas pendientes de ${areaTitle}? No se borra ninguna carpeta de temas.`)) return;
    setBusy("discard");
    try {
      const n = await useCurriculum.getState().discard(areaId);
      setPrompt("");
      setDone([]);
      toast("info", `${n} ${n === 1 ? "tarea descartada" : "tareas descartadas"}.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const Switch = (
    <div role="group" aria-label="Cómo crear los temas" className="inline-flex rounded-lg border border-line bg-card p-0.5" data-testid="queue-mode">
      {([["auto", "Automático (IA de la app)"], ["manual", "Manual (Antigravity)"]] as const).map(([id, label]) => (
        <button key={id} type="button" aria-pressed={mode === id} onClick={() => { touched.current = true; setMode(id); }} data-testid={`queue-mode-${id}`} className={cn("min-h-8 rounded-md px-2.5 text-[13px] font-medium", mode === id ? "bg-accent text-white" : "text-dim hover:bg-hover hover:text-text")}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── Automático: progreso y resultado ──
  if (job && mode === "auto") {
    const pct = job.total ? (job.finished / job.total) * 100 : 0;
    return (
      <section className="space-y-3 rounded-2xl border border-accent bg-accent-soft/20 p-4" data-testid="curriculum-queue" data-state="auto" aria-label={`Generación automática de ${areaTitle}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[16px] font-bold text-text">{job.done ? "Generación terminada" : "Generando con la IA de la app…"} · {areaTitle}</h3>
          {Switch}
        </div>
        <ProgressBar pct={pct} label={`Temas generados de ${areaTitle}`} />
        <p className="text-[13.5px] text-dim" role="status" data-testid="auto-progress">
          {job.finished} de {job.total} · {job.created.length} creados{job.skipped ? ` · ${job.skipped} ya existían` : ""}{job.failed.length ? ` · ${job.failed.length} con fallo` : ""}
          {!job.done && job.current ? ` · ahora: ${job.current}` : ""}
        </p>
        {!job.done && <GhostButton large onClick={stopAuto} data-testid="auto-stop"><Square size={14} aria-hidden /> Detener (lo creado se queda)</GhostButton>}
        {job.done && job.error && <p role="alert" className="text-[13.5px] text-danger" data-testid="auto-error">{job.error}</p>}
        {job.done && job.cancelled && <p className="text-[13.5px] text-dim">Detenido. Vuelve a lanzar y sigue donde quedó: lo ya creado se salta.</p>}
        {job.failed.length > 0 && (
          <details className="rounded-lg border border-line bg-card p-2 text-[13px]" data-testid="auto-failed">
            <summary className="cursor-pointer font-medium text-warn">{job.failed.length} {job.failed.length === 1 ? "tema no salió" : "temas no salieron"}</summary>
            <ul className="mt-1 space-y-1">{job.failed.slice(0, 12).map((f) => <li key={f.title} className="break-words text-dim">«{f.title}»: {f.reason}</li>)}</ul>
          </details>
        )}
        {job.done && job.created.length > 0 && (
          <div className="space-y-1" data-testid="auto-add">
            <p className="text-[13.5px] font-semibold text-text">{job.created.length} temas creados (se añaden solos al plan activo)</p>
            <AddToPlan folders={job.created} />
          </div>
        )}
        {job.done && (
          <GhostButton onClick={() => { setJob(null); jobId.current = ""; }} data-testid="auto-again"><RotateCcw size={14} aria-hidden /> {job.failed.length || job.cancelled ? "Reintentar lo que falta" : "Volver"}</GhostButton>
        )}
      </section>
    );
  }

  if ((!queue.length && !validatedTopics.length) || mode === "auto") {
    if (missing === 0 && !queue.length) return null;
    return (
      <section className="rounded-2xl border border-accent bg-accent-soft/20 p-4" data-testid="curriculum-queue" data-state="empty" aria-label={`Crear los temas que faltan de ${areaTitle}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[16px] font-bold text-text">Crear los temas que faltan</h3>
          {Switch}
        </div>
        {mode === "auto" ? (
          <>
            <p className="mb-3 mt-1 text-[13.5px] text-dim">
              <Bot size={14} aria-hidden className="mr-1 inline" />La app escribe los temas ella sola con tu IA{engine?.label ? ` (${engine.label})` : ""}, uno tras otro, y al final los añades al plan. Una llamada a la IA por tema{essentials ? `: ≈ ${essentials} si eliges lo esencial` : ""}.
            </p>
            {engine && !engine.ready && <p role="alert" className="mb-2 text-[13px] text-warn" data-testid="auto-blocked">{engine.reason} Usa el modo Manual.</p>}
            <div className="flex flex-wrap gap-2">
              <PrimaryButton large onClick={() => void startAuto("esencial")} disabled={busy !== "" || essentials === 0 || !engine?.ready} data-testid="auto-essential">
                {busy === "make" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Bot size={15} aria-hidden />} Generar lo esencial ({essentials})
              </PrimaryButton>
              <GhostButton large="md" onClick={() => void startAuto()} disabled={busy !== "" || !engine?.ready} data-testid="auto-all">Generar todo lo que falta ({missing})</GhostButton>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 mt-1 text-[13.5px] text-dim">Un clic y la app deja todo listo, en orden: tú solo copias <strong>una</strong> frase y la pegas en Antigravity.</p>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton large onClick={() => void make("esencial")} disabled={busy !== "" || essentials === 0} data-testid="queue-essential">
                {busy === "make" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Rocket size={15} aria-hidden />} Solo lo esencial ({essentials})
              </PrimaryButton>
              <GhostButton large="md" onClick={() => void make()} disabled={busy !== ""} data-testid="queue-all">Todo lo que falta ({missing})</GhostButton>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-accent bg-accent-soft/20 p-4" data-testid="curriculum-queue" data-state="queue" aria-label={`Cola de ${areaTitle}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-bold text-text">Cola de {areaTitle}</h3>
        {Switch}
        <span className="text-[13.5px] text-dim" data-testid="queue-count">{validatedTopics.length} de {total} {total === 1 ? "tarea" : "tareas"} validadas · {topics} {topics === 1 ? "tema" : "temas"} por crear</span>
      </div>
      <ProgressBar pct={total ? (validatedTopics.length / total) * 100 : 0} label={`Tareas validadas de ${areaTitle}`} />

      {queue.length > 0 && (
        <ol className="space-y-2" aria-label="Pasos">
          <li className="flex flex-wrap items-center gap-2" data-testid="queue-step-copy">
            <span className="w-6 flex-none text-right font-bold text-accent-text">1</span>
            <PrimaryButton large onClick={() => void copy()} disabled={!prompt} data-testid="queue-copy">
              {copied ? <CheckCircle2 size={15} aria-hidden /> : <ClipboardCopy size={15} aria-hidden />} {copied ? "Copiado" : "Copiar instrucción para Antigravity"}
            </PrimaryButton>
            <span className="text-[13px] text-dim">Pégala una vez: el agente hace las {queue.length} tareas de una sentada. Si se detiene, pega la MISMA instrucción: sigue donde quedó.</span>
          </li>
          <li className="flex flex-wrap items-center gap-2" data-testid="queue-step-validate">
            <span className="w-6 flex-none text-right font-bold text-accent-text">2</span>
            <GhostButton large onClick={() => void validate()} disabled={busy !== ""} data-testid="queue-validate">
              {busy === "validate" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />} Ya terminó — validar todo
            </GhostButton>
            <span className="text-[13px] text-dim" data-testid="queue-written">
              {expected > 0 ? `Antigravity lleva ${written} de ${expected} temas escritos${written >= expected ? ": ya puedes validar." : "."}` : "Cuando Antigravity avise que acabó (puedes validar antes: lo que falte queda marcado)."}
            </span>
          </li>
        </ol>
      )}

      {failed.length > 0 && (
        <details className="rounded-lg border border-line bg-card p-2 text-[13px]" data-testid="queue-failed">
          <summary className="cursor-pointer font-medium text-warn">{failed.length} {failed.length === 1 ? "tarea" : "tareas"} con algo por terminar</summary>
          <ul className="mt-1 space-y-1">
            {failed.slice(0, 8).map((h) => {
              const bad = h.entries.find((e) => e.problems.length);
              return <li key={h.id} className="break-words text-dim">{h.entries.length} temas · {bad ? `«${bad.title}»: ${bad.problems[0]}` : "pendiente"}</li>;
            })}
          </ul>
        </details>
      )}

      {folders.length > 0 && (
        <div className="space-y-1" data-testid="queue-step-plan">
          <p className="text-[13.5px] font-semibold text-text"><span className="mr-2 font-bold text-accent-text">3</span>{folders.length} temas validados (se añaden solos al plan activo)</p>
          <AddToPlan folders={folders} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {queue.length > 0 && (
          <details className="min-w-0 flex-1 text-[13px] text-dim">
            <summary className="cursor-pointer">Ver las {queue.length} tareas</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-6">
              {queue.map((h) => <li key={h.id} className="break-all">{h.entries.length} temas · <code>{h.taskPath}</code></li>)}
            </ol>
          </details>
        )}
        {queue.length > 0 && (
          <GhostButton onClick={() => void discard()} disabled={busy !== ""} data-testid="queue-discard"><RotateCcw size={14} aria-hidden /> Empezar de nuevo</GhostButton>
        )}
      </div>
    </section>
  );
}
