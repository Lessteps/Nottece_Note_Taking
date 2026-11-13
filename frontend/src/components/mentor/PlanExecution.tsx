// Mentor — Plan: «EJECUTAR PLAN». Tres piezas:
//  · el panel de «Mi plan» (`ExecutionPanel`): «Analizar el plan» (cobertura determinista contra el checklist de diseño de temas + revisión de la
//    IA) deja un INFORME de ejecución: exactamente qué falta crear, agrupado por área y tema, con estimación de coste (llamadas de IA, archivos,
//    tiempo) y en el orden de la agenda (las primeras semanas primero);
//  · el diálogo de confirmación (`ExecuteDialog`), que también usa «Mantener y ejecutar» del banner del plan propuesto: alcance, qué se crea,
//    coste, y que NO se borra ni se sobrescribe nada;
//  · el progreso de la ejecución en segundo plano (pausar, reanudar, cancelar y el registro de los archivos creados).
// Nada se ejecuta solo: lo que crea o modifica notas ocurre únicamente cuando la persona confirma en el diálogo.

import { AreasCheckButton } from "./AreasCheck";
import { MethodologyCheckButton } from "./MethodologyCheck";
import { ClipboardCopy, FolderPlus, ListChecks, Pause, Play, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { DEFAULT_CRITERIA, sanitizeCriteria } from "../../lib/planCoverage";
import {
  KIND_LABEL,
  RUN_STATUS_LABEL,
  SECONDS_PER_AI_CALL,
  TASK_STATUS_LABEL,
  type ExecTask,
  type ExecutionReport,
  type ExecutionScope,
  type ExecutionState,
  type RunStatus,
  type TaskState,
} from "../../lib/planExecution";
import type { MentorExecutionView, MentorPlan, RegenHandoff } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useRegenEngine } from "../../store/regenEngine";
import { RegenHandoffPanel } from "./RegenHandoffPanel";
import { Chip, GhostButton, Modal, PrimaryButton } from "../common/forms";
import { cn, confirmAction } from "../ui";
import { openTopic } from "./openTopic";
import { useModuleVisible } from "../ModuleHost";
import type { CoverageState } from "./PlanCoverage";
import { ProgressBar, ThinkingStatus, useAiStatus } from "./parts";

import { coldRetryDelay } from "./planShared";

const MENTOR_NOTE = "calculado con tu vault; la IA solo ve títulos y resultados, nunca tus notas";
const COLD_RETRY_MAX = 40;
const POLL_MS = 1500;
const LIST_FOLD = 6;

export const EXECUTION_ID = "plan-execution";

const RUN_COLOUR: Record<RunStatus, string> = { running: "var(--nv-accent)", paused: "var(--nv-warn)", done: "var(--nv-mint)", cancelled: "var(--nv-faint)", failed: "var(--nv-danger)" };
const TASK_GLYPH: Record<TaskState["status"], string> = { pending: "○", running: "◐", done: "●", failed: "✕", skipped: "⤼", cancelled: "⤼" };
const TASK_COLOUR: Record<TaskState["status"], string> = { pending: "var(--nv-faint)", running: "var(--nv-accent)", done: "var(--nv-mint)", failed: "var(--nv-danger)", skipped: "var(--nv-warn)", cancelled: "var(--nv-faint)" };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const minutesText = (m: number): string => (m < 1 ? "menos de 1 min" : m < 90 ? `≈ ${m} min` : `≈ ${Math.round((m / 60) * 10) / 10} h`.replace(".", ","));

// ── Informe: carga y alcance ────────────────────────────────────────────

export const DEFAULT_UI_SCOPE: ExecutionScope = { mode: "all", fromWeek: 1, toWeek: 4, includeRecommended: false, includeNewTopics: false, includeAreaPractice: true, includeKatasAi: false };

async function fetchReport(planId: string, scope: ExecutionScope) {
  for (let i = 0; i < COLD_RETRY_MAX; i++) {
    const r = await api.mentorExecutionReport(planId, scope);
    if (!r.loading) return r;
    await new Promise((ok) => setTimeout(ok, coldRetryDelay(i)));
  }
  throw new Error("El índice de la vault tarda demasiado en estar listo.");
}

/** El alcance con solo lo que se envía (las semanas solo en el modo «semanas», el área solo en el modo «área»). */
const scopeToSend = (s: ExecutionScope): ExecutionScope => ({
  mode: s.mode,
  ...(s.mode === "weeks" ? { fromWeek: s.fromWeek ?? 1, toWeek: s.toWeek ?? 4 } : {}),
  ...(s.mode === "area" && s.areaKey ? { areaKey: s.areaKey } : {}),
  ...(s.mode === "topic" && s.folder ? { folder: s.folder } : {}),
  includeRecommended: s.includeRecommended,
  includeNewTopics: s.includeNewTopics,
  includeAreaPractice: s.includeAreaPractice,
  includeKatasAi: s.includeKatasAi,
});

/** Texto del alcance elegido, para el diálogo y para quien lee con lector de pantalla. */
export function scopeText(s: ExecutionScope, areaName?: string): string {
  if (s.mode === "weeks") return `solo las semanas ${s.fromWeek ?? 1}–${s.toWeek ?? 4}`;
  if (s.mode === "area") return `solo el área ${areaName ?? s.areaKey ?? ""}`;
  if (s.mode === "topic") return `solo el tema ${areaName ?? s.folder?.split("/").pop() ?? ""}`;
  return "todo el plan";
}

// ── Formulario de alcance ───────────────────────────────────────────────

function ScopeForm({ scope, onChange, areas, maxWeek, proposals, idPrefix }: { scope: ExecutionScope; onChange: (s: ExecutionScope) => void; areas: Array<{ key: string; area: string }>; maxWeek: number; proposals: number; idPrefix: string }) {
  const set = (p: Partial<ExecutionScope>) => onChange({ ...scope, ...p });
  const Radio = ({ value, label }: { value: ExecutionScope["mode"]; label: string }) => (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-[14px]">
      <input type="radio" name={`${idPrefix}-mode`} checked={scope.mode === value} onChange={() => set({ mode: value, ...(value === "area" && !scope.areaKey ? { areaKey: areas[0]?.key } : {}) })} className="h-4 w-4" />
      {label}
    </label>
  );
  return (
    <fieldset className="min-w-0" data-testid="exec-scope">
      <legend className="text-[14px] font-semibold">Alcance</legend>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Radio value="all" label="Todo el plan" />
        <Radio value="weeks" label="Solo algunas semanas" />
        <Radio value="area" label="Solo un área" />
      </div>
      {scope.mode === "weeks" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
          <label htmlFor={`${idPrefix}-from`}>De la semana</label>
          <input id={`${idPrefix}-from`} type="number" min={1} max={maxWeek} value={scope.fromWeek ?? 1} onChange={(e) => set({ fromWeek: Math.max(1, Number(e.target.value) || 1) })} className="min-h-9 w-20 rounded-lg border border-line bg-surface px-2 text-[14px]" />
          <label htmlFor={`${idPrefix}-to`}>a la</label>
          <input id={`${idPrefix}-to`} type="number" min={1} max={maxWeek} value={scope.toWeek ?? 4} onChange={(e) => set({ toWeek: Math.max(1, Number(e.target.value) || 1) })} className="min-h-9 w-20 rounded-lg border border-line bg-surface px-2 text-[14px]" />
          <span className="text-dim">de {maxWeek}</span>
        </div>
      )}
      {scope.mode === "area" && (
        <div className="mt-2 text-[14px]">
          <label htmlFor={`${idPrefix}-area`} className="mr-2">Área</label>
          <select id={`${idPrefix}-area`} value={scope.areaKey ?? ""} onChange={(e) => set({ areaKey: e.target.value })} className="min-h-9 rounded-lg border border-line bg-surface px-2 text-[14px]" data-testid="exec-scope-area">
            {areas.map((a) => <option key={a.key} value={a.key}>{a.area}</option>)}
          </select>
        </div>
      )}
      <div className="mt-3 space-y-0.5">
        <label className="flex min-h-8 cursor-pointer items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={scope.includeAreaPractice} onChange={(e) => set({ includeAreaPractice: e.target.checked })} />
          <span>Crear la carpeta de práctica de cada área, con sus katas diarios</span>
        </label>
        <label className="flex min-h-8 cursor-pointer items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={scope.includeRecommended} onChange={(e) => set({ includeRecommended: e.target.checked })} />
          <span>Incluir también lo recomendado (ejercicios de todas las dificultades, no solo uno por skill)</span>
        </label>
        <label className="flex min-h-8 cursor-pointer items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={scope.includeKatasAi} disabled={!scope.includeAreaPractice} onChange={(e) => set({ includeKatasAi: e.target.checked })} />
          <span>Pedir a la IA los katas de cada área por bloques de 4 semanas (si falla, se usan las plantillas)</span>
        </label>
        <label className={cn("flex min-h-8 items-start gap-2 text-[14px]", proposals ? "cursor-pointer" : "opacity-60")}>
          <input type="checkbox" className="mt-1 h-4 w-4" checked={scope.includeNewTopics} disabled={!proposals} onChange={(e) => set({ includeNewTopics: e.target.checked })} />
          <span>Crear los temas nuevos que propuso la revisión del Mentor{proposals ? ` (${proposals})` : " (primero analiza el plan con IA)"}</span>
        </label>
      </div>
    </fieldset>
  );
}

// ── Resumen y lista del informe ─────────────────────────────────────────

function Totals({ report }: { report: ExecutionReport }) {
  const t = report.totals;
  const items: Array<[string, string, string?]> = [
    ["Tareas", String(t.tasks), `${t.required} obligatorias`],
    ["Archivos nuevos", `≈ ${t.files}`, "notas, canvas, ejercicios y katas"],
    ["Llamadas a la IA", `≈ ${t.aiCalls}`, `${SECONDS_PER_AI_CALL} s cada una, de media`],
    ["Tiempo", minutesText(t.minutes), "con 2 tareas a la vez"],
  ];
  return (
    <dl className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4" data-testid="exec-totals">
      {items.map(([k, v, hint]) => (
        <div key={k} className="min-w-0 rounded-lg border border-line px-3 py-2">
          <dt className="text-[12.5px] font-semibold uppercase tracking-wide text-faint">{k}</dt>
          <dd className="text-[17px] font-semibold">{v}</dd>
          {hint && <dd className="text-[13px] text-dim">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function TaskLine({ t }: { t: ExecTask }) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13.5px]">
      <span className="min-w-0 flex-1 basis-60 break-words">{t.label}</span>
      <span className="flex flex-wrap gap-1.5 text-dim">
        {t.week > 0 && t.week < 1000 && <span>sem. {t.week}</span>}
        <span>{t.aiCalls ? plural(t.aiCalls, "llamada IA", "llamadas IA") : "sin IA"}</span>
        {!t.required && <span>recomendada</span>}
      </span>
    </li>
  );
}

/** El informe agrupado por área y tema. */
export function ReportList({ report }: { report: ExecutionReport }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!report.tasks.length) {
    return <p className="rounded-lg border border-line px-3 py-2 text-[14px] text-mint" data-testid="exec-nothing">No falta nada que crear con este alcance: todos los temas tienen su diseño obligatorio completo.</p>;
  }
  return (
    <div className="space-y-2" data-testid="exec-report-list">
      {report.areas.map((a, i) => {
        const tasks = a.areaTasks.length + a.topics.reduce((n, t) => n + t.tasks.length, 0);
        const isOpen = open[a.key] ?? i === 0;
        return (
          <details key={a.key} open={isOpen} onToggle={(e) => { const expanded = e.currentTarget.open; setOpen((o) => ({ ...o, [a.key]: expanded })); }} className="rounded-xl border border-line bg-surface/40 px-3 py-2" data-testid="exec-area">
            <summary className="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-semibold">
              <span>{a.area}</span>
              <span className="text-[13.5px] font-normal text-dim">{plural(tasks, "tarea", "tareas")}{a.topics.some((t) => t.manual.length) ? ` · ${a.topics.filter((t) => t.manual.length).length} para revisar a mano` : ""}</span>
            </summary>
            <div className="mt-2 space-y-3">
              {a.areaTasks.length > 0 && (
                <div>
                  <h5 className="text-[13px] font-semibold uppercase tracking-wide text-faint">Práctica del área</h5>
                  <ul className="mt-1 space-y-1">{a.areaTasks.map((t) => <TaskLine key={t.id} t={t} />)}</ul>
                </div>
              )}
              {a.topics.filter((t) => t.tasks.length).map((t) => (
                <div key={t.folder} data-testid="exec-topic">
                  <h5 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium">
                    <button type="button" onClick={() => void openTopic(t.folder)} className="inline-flex min-h-8 items-center text-left text-accent-text underline-offset-2 hover:underline">{t.title}</button>
                    <Chip>diseño {t.score} %</Chip>
                  </h5>
                  <ul className="mt-0.5 space-y-1 pl-3">{t.tasks.map((x) => <TaskLine key={x.id} t={x} />)}</ul>
                </div>
              ))}
              {a.proposals.length > 0 && (
                <div>
                  <h5 className="text-[13px] font-semibold uppercase tracking-wide text-faint">Temas nuevos que propuso la revisión</h5>
                  <ul className="mt-1 space-y-0.5 text-[13.5px]">
                    {a.proposals.map((p) => (
                      <li key={p.title} className="break-words">
                        <span className="font-medium">{p.title}</span> {p.included ? <Chip colour="var(--nv-mint)">se crea</Chip> : <Chip>no incluido</Chip>}
                        {p.why && <span className="text-dim"> — {p.why}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        );
      })}
      {report.manual.length > 0 && (
        <details className="rounded-xl border border-line px-3 py-2" data-testid="exec-manual">
          <summary className="flex min-h-8 cursor-pointer items-center text-[14px] font-semibold">Para revisar a mano ({report.manual.length}): ya existe y no se reescribe</summary>
          <ul className="mt-2 space-y-1.5 text-[13.5px]">
            {report.manual.slice(0, 40).map((m) => (
              <li key={m.folder} className="break-words">
                <button type="button" onClick={() => void openTopic(m.folder)} className="inline-flex min-h-8 items-center text-left font-medium text-accent-text underline-offset-2 hover:underline">{m.title}</button>
                <span className="text-dim">: {m.gaps.slice(0, 3).join("; ").replace(/`/g, "")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Diálogo de confirmación («Ejecutar plan» y «Mantener y ejecutar») ───

function Counts({ report }: { report: ExecutionReport }) {
  const b = report.totals.byKind;
  const rows = (Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).filter((k) => b[k]).map((k) => `${KIND_LABEL[k]}: ${b[k]}`);
  return <ul className="list-disc space-y-0.5 pl-5 text-[14px]" data-testid="exec-counts">{rows.map((r) => <li key={r}>{r}</li>)}</ul>;
}

export interface ExecuteDialogProps {
  planId: string;
  /** el plan aún es una propuesta: confirmar también lo mantiene («Mantener y ejecutar») */
  proposed: boolean;
  initialScope?: ExecutionScope;
  queueNotice?: string;
  onClose: () => void;
  /** se llama cuando la ejecución empezó (y el plan se mantuvo, si era una propuesta) */
  onStarted: (execution: MentorExecutionView | null) => void;
}

export function ExecuteDialog({ planId, proposed, initialScope, queueNotice, onClose, onStarted }: ExecuteDialogProps) {
  const uid = useId();
  const toast = useApp((s) => s.toast);
  const [scope, setScope] = useState<ExecutionScope>(initialScope ?? DEFAULT_UI_SCOPE);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [aiOn, setAiOn] = useState(true);
  const [prev, setPrev] = useState<MentorExecutionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState<RegenHandoff | null>(null);
  const handoffs = useRegenEngine((s) => s.handoffs);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    setError("");
    fetchReport(planId, scopeToSend(scope))
      .then((r) => {
        if (n !== seq.current) return;
        setReport(r.report);
        setAiOn(r.aiConfigured);
        setPrev(r.execution);
        setLoading(false);
      })
      .catch((e) => {
        if (n !== seq.current) return;
        setError((e as Error).message);
        setLoading(false);
      });
  }, [planId, scope]);
  const running = prev?.state.status === "running" || prev?.state.status === "paused";
  const proposals = report?.areas.reduce((n, a) => n + a.proposals.length, 0) ?? 0;
  const areaName = report?.areas.find((a) => a.key === scope.areaKey)?.area;
  const confirm = async () => {
    if (!report || busy) return;
    setBusy(true);
    try {
      if (proposed) await api.mentorPlanKeep(planId);
      let r = await api.mentorExecutionStart(planId, scopeToSend(scope));
      for (let i = 0; r.loading && i < COLD_RETRY_MAX; i++) {
        await new Promise((ok) => setTimeout(ok, coldRetryDelay(i)));
        r = await api.mentorExecutionStart(planId, scopeToSend(scope));
      }
      useMentor.setState((s) => ({ planVersion: s.planVersion + 1 }));
      toast("info", proposed ? "Plan mantenido. La ejecución sigue en segundo plano." : "La ejecución sigue en segundo plano. Puedes pausarla o cancelarla.");
      onStarted(r.loading ? null : r.execution);
      onClose();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const externalAvailable = !proposed && scope.mode === "topic" && !!scope.folder && !!report?.tasks.length && report.tasks.every((t) => t.kind === "practice");
  const createExternal = async () => {
    if (!externalAvailable || !scope.folder || busy) return;
    setBusy(true);
    try {
      const h = await api.studyTopicRegenerateHandoff(scope.folder, "exercises", true, { missingOnly: true, includeRecommended: scope.includeRecommended });
      useRegenEngine.getState().putHandoff(h);
      setHandoff(h);
    } catch (e) { toast("error", (e as Error).message); }
    finally { setBusy(false); }
  };
  const label = proposed ? "Mantener y ejecutar" : initialScope?.mode === "topic" || initialScope?.mode === "area" ? "Generar" : "Ejecutar plan";
  const maxWeek = report?.maxWeek ?? 1;
  // los temas del plan no están en el diálogo: las áreas salen del informe (o de un informe sin tareas)
  const areas = report?.areas.map((a) => ({ key: a.key, area: a.area })) ?? [];
  return (
    <Modal
      title={label}
      onClose={onClose}
      width={760}
      footer={
        <>
          <GhostButton large onClick={onClose}>{handoff ? "Cerrar" : "Cancelar"}</GhostButton>
          {externalAvailable && !handoff && <GhostButton large disabled={busy || loading} onClick={() => void createExternal()} data-testid="exec-external">Crear prompt para agente</GhostButton>}
          <span className="flex-1" />
          <PrimaryButton large disabled={!!handoff || !report || !report.tasks.length || !aiOn || busy || running} onClick={() => void confirm()} data-testid="exec-confirm">
            <Sparkles size={16} aria-hidden /> {busy ? "Empezando…" : `${label} (${report?.totals.tasks ?? 0})`}
          </PrimaryButton>
        </>
      }
    >
      <div data-testid="exec-dialog" aria-labelledby={`${uid}-h`} className="space-y-3">
        {queueNotice && <p role="note" className="rounded-lg border border-warn/60 px-3 py-2 text-[14px]" data-testid="exec-queue-notice">{queueNotice}</p>}
        {handoff && <RegenHandoffPanel handoff={handoffs[handoff.id] ?? handoff} />}
        <h3 id={`${uid}-h`} className="sr-only">{label}: informe y confirmación</h3>
        <p className="text-[14px] text-dim">
          {proposed ? "Se mantiene el plan y el Mentor crea en segundo plano lo que falta en tu vault. " : "El Mentor crea en segundo plano lo que falta en tu vault. "}
          Esto es lo que se hará con el alcance elegido; no empieza hasta que lo confirmes.
        </p>
        {scope.mode === "topic" ? (
          <fieldset className="min-w-0" data-testid="exec-scope-topic">
            <legend className="text-[14px] font-semibold">Alcance</legend>
            <p className="mt-1 text-[14px]">Solo este tema: <strong>{(scope.folder ?? "").split("/").pop()}</strong>. Se crea lo que falte de él (teoría, mapa, manifiesto y ejercicios) y nada más.</p>
            <label className="mt-2 flex min-h-8 cursor-pointer items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={scope.includeRecommended} onChange={(e) => setScope({ ...scope, includeRecommended: e.target.checked })} />
              <span>Incluir los ejercicios de todas las dificultades (no solo uno por skill)</span>
            </label>
          </fieldset>
        ) : (
          <ScopeForm scope={scope} onChange={setScope} areas={areas.length ? areas : scope.areaKey ? [{ key: scope.areaKey, area: scope.areaKey }] : []} maxWeek={maxWeek} proposals={proposals} idPrefix={uid} />
        )}
        {loading && <p role="status" className="text-[14px] text-dim">Calculando lo que falta…</p>}
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        {report && !loading && (
          <>
            <Totals report={report} />
            <div>
              <h4 className="text-[14px] font-semibold">Qué se crea ({scopeText(scope, areaName)})</h4>
              {report.tasks.length ? <Counts report={report} /> : <p className="text-[14px] text-mint">Nada: todo lo obligatorio ya existe con este alcance.</p>}
            </div>
            <div className="rounded-lg border border-line bg-surface/50 px-3 py-2.5 text-[14px]" data-testid="exec-safety">
              <h4 className="font-semibold">Qué NO hace</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-dim">
                <li><strong className="font-medium text-text">No borra ni sobrescribe nada</strong> de lo que ya existe: si un archivo está, se omite (y si una generación lo toca, se restaura tal cual).</li>
                <li>No cambia tus temas ni tu plan, salvo marcar los entregables y la práctica como definidos al terminar.</li>
                <li>Cada resultado se valida con el checklist de diseño; lo que no cumpla se reintenta una vez y, si sigue mal, queda marcado como fallido.</li>
              </ul>
              <p className="mt-1.5 text-dim">Puedes pausar, reanudar y cancelar de verdad (se detiene la llamada a la IA). Todo lo creado queda en un registro con sus rutas.</p>
            </div>
            {report.manual.length > 0 && <p className="text-[13.5px] text-dim">{plural(report.manual.length, "tema ya existente tiene", "temas ya existentes tienen")} defectos que no se corrigen solos (se listan para revisarlos a mano).</p>}
          </>
        )}
        {!aiOn && <p className="rounded-lg border border-warn/60 px-3 py-2 text-[14px]" data-testid="exec-no-ai">La IA no está configurada: «{label}» está desactivado porque crear temas y ejercicios necesita IA. El análisis y el informe sí funcionan sin ella. {externalAvailable && "Puedes crear un prompt para un agente externo con el botón de abajo."}</p>}
        {running && <p className="rounded-lg border border-warn/60 px-3 py-2 text-[14px]">Ya hay una ejecución {prev?.state.status === "paused" ? "en pausa" : "en curso"} para este plan: reanúdala o cancélala antes de empezar otra.</p>}
        {report && report.tasks.length > 0 && !loading && (
          <details>
            <summary className="inline-flex min-h-8 cursor-pointer items-center text-[14px] text-accent-text">Ver el detalle por área y tema</summary>
            <div className="mt-2"><ReportList report={report} /></div>
          </details>
        )}
      </div>
    </Modal>
  );
}

// ── Progreso de la ejecución ────────────────────────────────────────────

function TaskRow({ t, openNote }: { t: TaskState; openNote: (rel: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="min-w-0 rounded-lg border border-line px-3 py-1.5 text-[13.5px]" data-testid="exec-task">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span aria-hidden style={{ color: TASK_COLOUR[t.status] }}>{TASK_GLYPH[t.status]}</span>
        <span className="min-w-0 flex-1 basis-56 break-words">{t.label}</span>
        <Chip colour={TASK_COLOUR[t.status]}>{TASK_STATUS_LABEL[t.status]}{t.attempts > 1 && t.status !== "done" ? ` · intento ${t.attempts}` : ""}</Chip>
        {t.created.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-8 items-center text-accent-text underline-offset-2 hover:underline">
            {open ? "Ocultar" : plural(t.created.length, "archivo creado", "archivos creados")}
          </button>
        )}
      </div>
      {t.error && <p className="mt-0.5 break-words text-danger">{t.error}</p>}
      {t.note && <p className="mt-0.5 break-words text-dim">{t.note}</p>}
      {t.warnings.length > 0 && <p className="mt-0.5 break-words text-warn">Aviso: {t.warnings[0]}{t.warnings.length > 1 ? ` (+${t.warnings.length - 1})` : ""}</p>}
      {open && (
        <ul className="mt-1 space-y-0.5" aria-label="Archivos creados por esta tarea">
          {t.created.map((f) => (
            <li key={f}>
              <button type="button" onClick={() => openNote(f)} className="inline-flex min-h-8 max-w-full items-center text-left font-mono text-[12.5px] text-accent-text underline-offset-2 hover:underline">
                <span className="break-all">{f}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** El progreso de una ejecución: barra, «12/58 · Backend · 4.3 REST API design», botones y el registro de lo creado. */
export function ExecutionProgressView({ exec, onPause, onResume, onCancel, busy }: { exec: MentorExecutionView; onPause: () => void; onResume: () => void; onCancel: () => void; busy: boolean }) {
  const { state, progress } = exec;
  const toast = useApp((s) => s.toast);
  const [all, setAll] = useState(false);
  const openNote = (rel: string): void => {
    void useApp.getState().openNote(rel).catch((e: Error) => toast("error", e.message));
  };
  const finished = state.tasks.filter((t) => t.status !== "pending" && t.status !== "running");
  const shown = all ? state.tasks : [...state.tasks.filter((t) => t.status === "running"), ...finished.slice(-LIST_FOLD)].slice(0, LIST_FOLD + 2);
  const created = state.tasks.flatMap((t) => t.created);
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface/40 p-3.5" data-testid="exec-progress" aria-live="off">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="text-[15px] font-semibold">Ejecución del plan</h4>
        <Chip large colour={RUN_COLOUR[state.status]}>{RUN_STATUS_LABEL[state.status]}</Chip>
        <span className="text-[13.5px] text-dim">empezó {state.createdAt.slice(0, 16).replace("T", " ")}</span>
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {state.status === "running" && <GhostButton onClick={onPause} disabled={busy} data-testid="exec-pause"><Pause size={15} aria-hidden /> Pausar</GhostButton>}
          {(state.status === "paused" || state.status === "failed") && <PrimaryButton onClick={onResume} disabled={busy} data-testid="exec-resume"><Play size={15} aria-hidden /> {state.status === "failed" ? "Reintentar lo que falló" : "Reanudar"}</PrimaryButton>}
          {(state.status === "running" || state.status === "paused") && <GhostButton danger onClick={onCancel} disabled={busy} data-testid="exec-cancel"><Square size={15} aria-hidden /> Cancelar</GhostButton>}
        </div>
      </div>
      <p className="mt-2 break-words text-[14px]" data-testid="exec-label" role="status" aria-live="polite">{progress.label}</p>
      <div className="mt-1.5"><ProgressBar pct={progress.pct} thick label="Avance de la ejecución" colour={RUN_COLOUR[state.status]} /></div>
      <p className="mt-1.5 text-[13.5px] text-dim">
        {progress.done} hechas · {progress.failed} con error · {progress.skipped} omitidas · {progress.pending + progress.running} pendientes · {plural(progress.created, "archivo creado", "archivos creados")}
      </p>
      {state.status === "paused" && <p className="mt-1 text-[13.5px] text-dim">En pausa: las tareas en curso se detuvieron y volverán a empezar al reanudar. Lo hecho no se repite.</p>}
      {state.status === "done" && <p className="mt-1 text-[13.5px] text-mint">Terminada. Revisa lo creado: {created.length ? "abre las rutas del registro." : "no hizo falta crear nada."}</p>}
      <ul className="mt-2 space-y-1" aria-label="Tareas de la ejecución">
        {shown.map((t) => <TaskRow key={t.id} t={t} openNote={openNote} />)}
      </ul>
      {state.tasks.length > shown.length || all ? (
        <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="mt-1 inline-flex min-h-8 items-center text-[13.5px] text-accent-text underline-offset-2 hover:underline">
          {all ? "Ver solo las últimas" : `Ver las ${state.tasks.length} tareas`}
        </button>
      ) : null}
      {state.log.length > 0 && (
        <details className="mt-1.5">
          <summary className="inline-flex min-h-8 cursor-pointer items-center text-[13.5px] text-accent-text">Registro de la ejecución</summary>
          <ol className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] text-dim">
            {state.log.slice(-60).map((l, i) => <li key={i} className="break-words">{l}</li>)}
          </ol>
        </details>
      )}
    </div>
  );
}

// ── Panel de «Mi plan» ──────────────────────────────────────────────────

export function useExecution(planId: string) {
  const visible = useModuleVisible();
  const [exec, setExec] = useState<MentorExecutionView | null>(null);
  const alive = useRef(true);
  const planVersion = useMentor((s) => s.planVersion);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      const r = await api.mentorExecutionStatus(planId);
      if (alive.current) setExec(r?.execution ?? null);
    } catch {
      /* sin estado: el panel solo muestra el análisis */
    }
  }, [planId]);
  useEffect(() => {
    if (visible) void reload();
  }, [reload, planVersion, visible]);
  // mientras corre, se consulta el estado cada poco (el trabajo sigue en segundo plano aunque la persona cambie de pestaña)
  const running = exec?.state.status === "running";
  useEffect(() => {
    if (!running || !visible) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [running, reload, visible]);
  return { exec, setExec, reload };
}

export function ExecutionPanel({ plan, cov, onPlan, announce, signal }: { plan: MentorPlan; cov: CoverageState; onPlan: (p: MentorPlan) => void; announce: (msg: string) => void; /** sube cuando algo pide abrir el diálogo desde fuera */ signal?: number }) {
  const uid = useId();
  const toast = useApp((s) => s.toast);
  const { exec, setExec, reload } = useExecution(plan.id);
  const [scope, setScope] = useState<ExecutionScope>(DEFAULT_UI_SCOPE);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [aiOn, setAiOn] = useState(cov.aiConfigured);
  const [busy, setBusy] = useState(false);
  const [ctl, setCtl] = useState(false);
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState(false);
  const key = `coverage:${plan.id}`;
  const status = useAiStatus(key, busy);
  const lastSignal = useRef(signal ?? 0);
  useEffect(() => {
    if ((signal ?? 0) !== lastSignal.current) {
      lastSignal.current = signal ?? 0;
      setDialog(true);
    }
  }, [signal]);
  useEffect(() => setAiOn(cov.aiConfigured), [cov.aiConfigured]);

  const load = useCallback(
    async (s: ExecutionScope) => {
      const r = await fetchReport(plan.id, scopeToSend(s));
      setReport(r.report);
      setAiOn(r.aiConfigured);
      if (r.execution) setExec(r.execution);
      return r.report;
    },
    [plan.id, setExec],
  );

  /** «Analizar el plan»: la revisión de la IA (si está configurada) sobre el checklist de diseño y después el informe de ejecución. */
  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      let msg = "";
      if (cov.aiConfigured) {
        const criteria = sanitizeCriteria(cov.review?.criteria ?? DEFAULT_CRITERIA);
        let r = await api.mentorPlanCoverageReview(plan.id, cov.review?.profile, criteria);
        for (let i = 0; r.loading && i < COLD_RETRY_MAX; i++) {
          await new Promise((ok) => setTimeout(ok, coldRetryDelay(i)));
          r = await api.mentorPlanCoverageReview(plan.id, cov.review?.profile, criteria);
        }
        if (!r.loading && r.source === "ai") {
          cov.setReview(r.review);
          onPlan(r.plan);
        } else if (!r.loading) msg = `${r.reason} `;
      } else msg = "La IA no está configurada: el análisis usa solo el checklist de diseño calculado. ";
      const rep = await load(scope);
      cov.reload();
      const text = `${msg}Informe listo: ${plural(rep.totals.tasks, "tarea", "tareas")} para crear, ≈ ${rep.totals.aiCalls} llamadas a la IA, ${minutesText(rep.totals.minutes)}.`;
      setNote(text);
      announce(text);
    } catch (e) {
      const m = `${(e as Error).message}`;
      setNote(m);
      announce(m);
    } finally {
      setBusy(false);
    }
  };

  // al cambiar el alcance se recalcula el informe (solo lee) si ya hay uno
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (report) void load(scope).catch((e) => setNote((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /** «Plan para otra IA»: deja un .md con lo que falta crear y lo copia al portapapeles. No usa la IA de la app ni escribe notas. */
  const handoff = async () => {
    if (busy || ctl) return;
    setBusy(true);
    try {
      let r = await api.mentorExecutionHandoff(plan.id, scopeToSend(scope));
      for (let i = 0; r.loading && i < COLD_RETRY_MAX; i++) {
        await new Promise((ok) => setTimeout(ok, coldRetryDelay(i)));
        r = await api.mentorExecutionHandoff(plan.id, scopeToSend(scope));
      }
      if (r.loading) throw new Error("El índice de la vault tarda demasiado en estar listo.");
      let copied = false;
      try {
        await navigator.clipboard.writeText(r.markdown);
        copied = true;
      } catch {
        /* sin portapapeles: queda el archivo */
      }
      const text = r.items
        ? `Plan para otra IA listo: ${plural(r.items, "elemento", "elementos")} (≈ ${r.files} archivos). Guardado en ${r.rel}${copied ? " y copiado al portapapeles" : ""}. Dáselo a Antigravity, Gemini o Codex.`
        : `No hay nada que generar con ese alcance. Se guardó igualmente en ${r.rel}.`;
      setNote(text);
      announce(text);
    } catch (e) {
      const m = `${(e as Error).message}`;
      setNote(m);
      announce(m);
    } finally {
      setBusy(false);
    }
  };

  const control = async (what: "pause" | "resume" | "cancel") => {
    if (ctl) return;
    if (what === "cancel" && !(await confirmAction("Cancelar la ejecución", "Lo ya creado se queda en tu vault y en el registro; el resto no se hace. Puedes volver a ejecutar el plan más tarde.", "Cancelar la ejecución", true))) return;
    setCtl(true);
    try {
      const r = what === "pause" ? await api.mentorExecutionPause(plan.id) : what === "resume" ? await api.mentorExecutionResume(plan.id) : await api.mentorExecutionCancel(plan.id);
      if (r.execution) setExec(r.execution);
      announce(what === "pause" ? "Ejecución en pausa." : what === "resume" ? "Ejecución reanudada." : "Ejecución cancelada.");
      await reload();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setCtl(false);
    }
  };

  const proposals = report?.areas.reduce((n, a) => n + a.proposals.length, 0) ?? 0;
  const areas = plan.subplans.map((s) => ({ key: s.areaId || s.id, area: s.area }));
  const maxWeek = report?.maxWeek ?? Math.max(1, ...plan.subplans.flatMap((s) => s.topics.map((t) => t.targetWeek)));
  const running = exec?.state.status === "running" || exec?.state.status === "paused";
  return (
    <section id={EXECUTION_ID} aria-labelledby={`${uid}-h`} className="min-w-0 scroll-mt-40 rounded-2xl border border-line bg-card p-4 @3xl:p-5" data-testid="plan-execution">
      <h3 id={`${uid}-h`} className="flex items-center gap-2 text-[16px] font-semibold text-text">
        <ListChecks size={17} aria-hidden className="text-accent-text" /> Ejecutar plan
      </h3>
      <p className="mt-0.5 text-[14px] text-dim">
        Analiza el plan contra el sistema de diseño de temas de tu vault (nota de teoría con su estructura, canvas, manifiesto de práctica y ejercicios por skill) y deja un informe con lo que falta crear. Después puedes ejecutarlo: el Mentor crea lo que falta en segundo plano, sin borrar ni sobrescribir nada.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PrimaryButton large onClick={() => void analyze()} disabled={busy} data-testid="exec-analyze">
          <Sparkles size={16} aria-hidden className="flex-none" /> Analizar el plan
        </PrimaryButton>
        <AreasCheckButton plan={plan} onPlan={onPlan} announce={announce} />
        <MethodologyCheckButton
          scope={{ kind: "all", label: "Todas las áreas" }}
          topics={plan.subplans.flatMap((s) => s.topics.map((t) => ({ folder: t.folder, title: t.title, group: t.group })))}
          testid="exec-methodology-check"
          planId={plan.id}
        />
        <GhostButton large onClick={() => setDialog(true)} disabled={!report || !report.tasks.length || running || !aiOn} data-testid="exec-open-dialog" title={!aiOn ? "La IA no está configurada" : undefined}>
          <FolderPlus size={16} aria-hidden className="flex-none" /> Ejecutar plan…
        </GhostButton>
        <GhostButton large onClick={() => void handoff()} disabled={busy} data-testid="exec-handoff" title="Genera un .md con lo que falta crear para dárselo a otra IA (no usa la IA de la app)">
          <ClipboardCopy size={16} aria-hidden className="flex-none" /> Plan para otra IA
        </GhostButton>
        {!aiOn && <span className="text-[13.5px] text-dim" data-testid="exec-disabled-why">«Ejecutar» está desactivado: la IA no está configurada. El análisis determinista sí funciona.</span>}
      </div>
      {busy && (
        <div className="mt-3">
          <ThinkingStatus label={status.label || "Analizando el plan…"} elapsed={status.elapsed} onCancel={() => void api.mentorAiCancel(key, "abort")} />
        </div>
      )}
      {note && !busy && <p role="status" className="mt-2 rounded-lg border border-line bg-surface px-3 py-2 text-[14px]" data-testid="exec-note">{note}</p>}

      {report && (
        <div className="mt-3 space-y-3" data-testid="exec-report">
          <p className="text-[13px] text-dim">Informe del {report.at.slice(0, 16).replace("T", " ")} · {MENTOR_NOTE}</p>
          <ScopeForm scope={scope} onChange={setScope} areas={areas} maxWeek={maxWeek} proposals={proposals} idPrefix={`${uid}-s`} />
          <Totals report={report} />
          <ReportList report={report} />
        </div>
      )}
      {exec && (
        <div className="mt-3">
          <ExecutionProgressView exec={exec} busy={ctl} onPause={() => void control("pause")} onResume={() => void control("resume")} onCancel={() => void control("cancel")} />
        </div>
      )}
      {dialog && (
        <ExecuteDialog
          planId={plan.id}
          proposed={false}
          initialScope={scope}
          onClose={() => setDialog(false)}
          onStarted={(e) => {
            if (e) setExec(e);
            void reload();
            announce("Ejecución en marcha en segundo plano.");
          }}
        />
      )}
    </section>
  );
}

export type { ExecutionState };
