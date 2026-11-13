// The topic's "Resumen" tab: the state of the topic and its competency matrix.
//
// Element by element it follows `docs/STUDY_AS_FILES/topic_view_ref.webp`:
// a global-state hero (dominion ring, per-skill goal, final exam, the warning
// strip and the two big actions), the skill × difficulty matrix with one row per
// skill — its Spanish description, the three difficulty cells and its own
// "Practicar" action — and the spaced-repetition card for the topic.

import {
  AlertTriangle,
  Award,
  Ban,
  CheckCircle2,
  Clock,
  ListChecks,
  MessageSquare,
  Play,
  Route,
  Scale,
  SearchX,
  Sigma,
  Target,
  Zap,
} from "lucide-react";
import { Fragment, useState } from "react";
import type { StudySnapshot, TopicData } from "../../lib/types";
import { Donut } from "../common/charts";
import { cn } from "../ui";
import { ExamRunnerModal } from "./ExamRunnerModal";
import { SrsIntervalsDialog } from "./SrsIntervalsDialog";

interface TopicGeneralViewProps {
  topicData: TopicData;
  snap: StudySnapshot;
  /** Opened with the skill of the row the user clicked, when there is one. */
  onOpenConfigurator: (skill?: string) => void;
  onPractice: (path: string) => void;
}

/** One glyph per competency, so a row is recognisable at a glance. */
const SKILL_ICONS: Record<string, typeof Sigma> = {
  solve: ListChecks,
  process: Route,
  prove: Sigma,
  counterexample: Ban,
  true_false: Scale,
  find_error: SearchX,
  explain: MessageSquare,
  drill: Zap,
};

export function TopicGeneralView({ topicData, snap, onOpenConfigurator, onPractice }: TopicGeneralViewProps) {
  const [showExamModal, setShowExamModal] = useState(false);
  const [showIntervals, setShowIntervals] = useState(false);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<Record<string, boolean>>({});
  const manifest = topicData.topic;
  const progress = topicData.progress;

  if (!manifest || !progress) {
    return (
      <div className="p-4 text-[12px] text-faint">
        No se encontró información de progreso para este tema.
      </div>
    );
  }

  // Pending spaced reviews of this topic, straight from the daily queue.
  const normFolder = topicData.folder.replace(/\\/g, "/");
  const topicSrsItems = snap.queue.items.filter((item) =>
    item.exercise ? item.exercise.path.replace(/\\/g, "/").includes(normFolder) : false,
  );

  const skillsList = manifest.skills
    .map((s) => progress.skills[s])
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const notStarted = skillsList.filter((s) => s.status === "not_started");
  const isEnglishTopic = manifest.skills.some((s) => /^(gr|wr|rd|ls|sp|vc)_/.test(s));

  const examRequired = manifest.mastery.exam === "required";
  const target = manifest.mastery.target_difficulty;
  const minPerSkill = manifest.mastery.min_per_skill;
  const pct = Math.round(progress.completenessPct);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Estado global ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line-strong bg-card p-5">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
          <div className="flex min-w-[300px] flex-1 items-center gap-5">
            <Donut
              size={116}
              thickness={12}
              label={`${pct}%`}
              parts={[
                { value: pct, colour: "var(--nv-accent)", name: `Avance: ${pct}%` },
                { value: 100 - pct, colour: "var(--nv-line-strong)", name: `Pendiente: ${100 - pct}%` },
              ]}
            />
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
                Estado global
              </div>
              <h2 className="mt-0.5 text-[17px] font-bold leading-tight text-text">Dominio del Tema</h2>
              <p className="mt-1.5 max-w-[300px] text-[11.5px] leading-snug text-faint">
                {manifest.plan
                  ? `Avance según los ejercicios distintos aprobados en las ${skillsList.length} competencias del plan. El examen se registra aparte.`
                  : `Completá las ${skillsList.length} habilidades en dificultad ${target === 3 ? "media y alta" : "media"} para desbloquear la certificación.`}
              </p>
            </div>
          </div>

          <div className="flex min-w-[280px] flex-1 flex-col gap-3 lg:flex-row">
            <div className="flex-1 rounded-xl border border-line bg-panel p-3">
              <div className="flex items-center gap-2 text-[11.5px] font-semibold text-text">
                <Target size={13} className="text-accent-text" /> Meta por Skill
              </div>
              {manifest.plan ? (
                <>
                  <div className="mt-1.5 text-[15px] font-bold text-text">Plan de la IA</div>
                  <div className="text-[12px] tracking-[0.2em] text-warn">
                    {Object.values(manifest.plan).reduce((n, c) => n + c[0] + c[1] + c[2], 0)} ejercicios
                  </div>
                  <div className="mt-1 text-[10.5px] text-faint">Los que marca cada casilla de la matriz</div>
                </>
              ) : (
                <>
                  <div className="mt-1.5 text-[15px] font-bold text-text">Dificultad {target}</div>
                  <div className="text-[12px] tracking-[0.2em] text-warn">{"★".repeat(target)}</div>
                  <div className="mt-1 text-[10.5px] text-faint">Mínimo {minPerSkill} ejercicios c/u</div>
                </>
              )}
            </div>
            <div className="flex-1 rounded-xl border border-line bg-panel p-3">
              <div className="flex items-center gap-2 text-[11.5px] font-semibold text-text">
                <Award size={13} className="text-warn" /> Examen Final
              </div>
              <div className={cn("mt-1.5 text-[15px] font-bold", progress.examPassed ? "text-mint" : "text-warn")}>
                {progress.examPassed ? "Aprobado" : "Bloqueado"}
              </div>
              <div className="mt-1 text-[10.5px] text-faint">
                {progress.examPassed
                  ? `Puntaje ${progress.examScore ?? "—"}/100`
                  : `Requiere 50% de dominio (${pct}%)`}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 lg:w-[230px]">
            <button
              type="button"
              onClick={() => onOpenConfigurator()}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong"
            >
              <Play size={14} /> Iniciar Práctica Global
            </button>
            {examRequired && (
              <button
                type="button"
                onClick={() => setShowExamModal(true)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors",
                  progress.examPassed
                    ? "border-mint/40 bg-mint-soft text-mint hover:bg-mint/20"
                    : "border-line-strong bg-panel text-text hover:border-accent",
                )}
              >
                <Award size={14} /> {progress.examPassed ? "Repetir examen" : "Tomar examen"}
              </button>
            )}
          </div>
        </div>

        {notStarted.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft/50 px-3.5 py-2.5">
            <AlertTriangle size={15} className="flex-none text-warn" />
            <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-dim">
              <b className="text-warn">{notStarted.length} competencias sin iniciar:</b> {isEnglishTopic || manifest.subject === "programming" ? "Empieza por la competencia más fácil de la matriz." : "Comienza practicando problemas básicos o cálculo mental."}
            </p>
            <div className="text-right">
              <div className="font-mono text-[14px] font-bold text-text">
                {skillsList.length - notStarted.length}/{skillsList.length}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-faint">iniciadas</div>
            </div>
          </div>
        )}
      </section>

      {/* ── Matriz de competencias ────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-accent-text"><ListChecks size={16} /></span>
            <h3 className="text-[18px] font-semibold tracking-tight text-text">Matriz de Competencias</h3>
            <span className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[9.5px] text-faint">
              SKILL × DIFICULTAD
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] text-faint">Sin iniciar:</span>
            {notStarted.slice(0, 3).map((s) => (
              <span key={s.skill} className="rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] text-dim">
                {s.label.split(" ")[0]}
              </span>
            ))}
            {notStarted.length > 3 && (
              <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] text-dim">
                +{notStarted.length - 3} más
              </span>
            )}
            {notStarted.length === 0 && (
              <span className="rounded-full border border-mint/40 bg-mint-soft px-2 py-0.5 text-[10px] text-mint">
                todas en marcha
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-faint">
          Evolución pedagógica en {skillsList.length} dimensiones de aprendizaje práctico.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card shadow-sm">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel/60 font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="py-3 pl-6 pr-3 font-semibold text-text">Habilidad Pedagógica</th>
                <th className="px-2 py-3 text-center font-semibold text-warn">★ Fácil</th>
                <th className="px-2 py-3 text-center font-semibold">•• Med</th>
                <th className="px-2 py-3 text-center font-semibold">••• Dif</th>
                <th className="py-3 pl-2 pr-6 text-right font-semibold">Estado &amp; acción</th>
              </tr>
            </thead>
            <tbody>
              {skillsList.map((sp) => {
                const Icon = SKILL_ICONS[sp.skill] ?? Sigma;
                const statusLabel = sp.mastered
                  ? "Dominada"
                  : sp.consolidated
                    ? "Consolidada"
                    : sp.status === "practicing"
                      ? "En práctica"
                      : "Pendiente";
                return (
                  <Fragment key={sp.skill}><tr className={cn("group border-b border-line/60 last:border-none transition-colors hover:bg-hover/50", expandedSkill === sp.skill && "bg-panel/40")}>
                    <td className="py-4 pl-6 pr-3">
                      <div className="flex items-start gap-2.5">
                        <span className={cn("mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-md border text-accent-text transition-colors", expandedSkill === sp.skill ? "border-accent/30 bg-accent/10" : "border-line bg-panel group-hover:border-accent/30")}>
                          <Icon size={13} />
                        </span>
                        <div className="min-w-0">
                          <button type="button" aria-expanded={expandedSkill === sp.skill} onClick={() => setExpandedSkill(expandedSkill === sp.skill ? null : sp.skill)} className="text-left text-[12.5px] font-semibold text-text hover:text-accent-text">{expandedSkill === sp.skill ? "▾" : "▸"} {sp.label}</button>
                          {/* Obligatoria: una fila sin descripción es un bug. */}
                          <div className="mt-0.5 max-w-[300px] text-[10.5px] leading-snug text-faint">
                            {sp.description}
                          </div>
                        </div>
                      </div>
                    </td>
                    {([1, 2, 3] as const).map((d) => {
                      const cell = sp.cells[d];
                      const required = cell.required ?? minPerSkill;
                      // With the AI's plan a cell it did not plan is simply not part of this topic.
                      if (manifest.plan && required === 0) {
                        return (
                          <td key={d} className="px-2 py-2.5">
                            <div className="mx-auto flex h-7 w-[76px] items-center justify-center font-mono text-[11px] text-faint/50" title="El plan de la IA no incluye este nivel">—</div>
                          </td>
                        );
                      }
                      const missingOnDisk = manifest.plan && required > 0 && cell.exerciseCount !== undefined && cell.exerciseCount === 0;
                      return (
                        <td key={d} className="px-2 py-2.5">
                          <div
                            className={cn(
                              "mx-auto flex h-7 w-[76px] items-center justify-center rounded-md border font-mono text-[11px]",
                              cell.passes > 0
                                ? "border-mint/40 bg-mint-soft text-mint"
                                : missingOnDisk
                                  ? "border-warn/40 bg-warn/10 text-warn"
                                  : cell.attempts > 0
                                    ? "border-line bg-panel text-dim"
                                    : "border-line bg-panel text-faint",
                            )}
                            title={
                              missingOnDisk
                                ? `Sin ejercicios generados en la vault (0 disponibles para ${required} planeados)`
                                : `${cell.passes} aprobados de ${cell.attempts} intentos.${cell.exerciseCount !== undefined ? ` ${cell.exerciseCount} disponibles.` : ""} Mejor: ${cell.bestScore ?? "—"}`
                            }
                          >
                            {cell.passes} / {required}
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-2.5 pl-2 pr-4">
                      <div className="flex items-center justify-end gap-2.5">
                        <span
                          className={cn(
                            "text-[10.5px]",
                            sp.mastered ? "text-mint" : sp.status === "practicing" ? "text-warn" : "text-faint",
                          )}
                        >
                          {statusLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandedSkill(expandedSkill === sp.skill ? null : sp.skill)}
                          className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-accent-strong"
                        >
                          Practicar
                          <Play size={9} />
                        </button>
                      </div>
                    </td>
                  </tr>{expandedSkill === sp.skill && <tr><td colSpan={5} className="border-l-4 border-accent bg-panel/40 px-6 py-5"><div className="space-y-5">{([1, 2, 3] as const).map((difficulty) => {
                    const exercises = (topicData.exercises ?? []).filter((e) => (e.mode_id === sp.skill || e.skill_id === sp.skill) && e.difficulty === difficulty);
                    return <div key={difficulty} className="space-y-2"><div className="flex items-center gap-2 border-b border-line/70 pb-2"><span className="font-mono text-[10px] uppercase tracking-wider text-faint">{["", "Fácil", "Media", "Difícil"][difficulty]}</span><span className="rounded-full border border-line bg-card px-2 py-0.5 font-mono text-[10px] text-dim">{exercises.length} ejercicios</span></div>{exercises.length ? <div className="flex flex-col gap-2.5">{exercises.map((e) => {
                      const history = e.history ?? [];
                      const selected = selectedExercise === e.path;
                      const date = (s?: string) => s ? new Date(s).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "Sin registro";
                      return <article key={e.path} className="rounded-lg border border-line bg-card p-4 transition-all hover:border-accent/40 hover:shadow-sm">
                        <div className="flex flex-wrap items-center gap-3"><button type="button" aria-expanded={selected} onClick={() => setSelectedExercise(selected ? null : e.path)} className="min-w-0 flex-1 text-left text-sm font-semibold text-text hover:text-accent-text">{selected ? "▾" : "▸"} {e.title}</button><span className={cn("rounded-full px-2 py-1 text-xs", e.completed ? "bg-mint-soft text-mint" : "bg-hover text-dim")}>{e.completed ? "Aprobado" : history.length ? "En práctica" : "Sin iniciar"}</span><label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-dim hover:bg-hover"><input aria-label={`Activar Helper para ${e.title}`} className="accent-accent" type="checkbox" checked={!!helpers[e.path]} onChange={(event) => setHelpers({ ...helpers, [e.path]: event.target.checked })} /> Helper</label><button type="button" onClick={() => { sessionStorage.setItem(`nv.practice.helper:${e.path}`, helpers[e.path] ? "1" : "0"); onPractice(e.path); }} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong"><span>Practicar</span><Play size={12} /></button></div>
                        {selected && <div className="mt-3 space-y-3 border-t border-line pt-3"><div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-dim"><span>Intentos: {history.length}</span><span>Primer intento registrado: {date(history[0]?.at)}</span><span>Último intento: {date(history.at(-1)?.at)}</span><span>Primera aprobación: {date(history.find((a) => a.verdict !== "ungraded" && !a.solution_seen && (a.score ?? 0) >= 75)?.at)}</span></div>{history.length ? [...history].reverse().map((a, i) => <details key={i} className="rounded-lg border border-line bg-panel p-2.5 text-xs"><summary className="cursor-pointer font-semibold text-text">Intento {history.length - i} · {date(a.at)} · {a.verdict === "ungraded" ? "Sin calificar" : `${a.score ?? 0}/100`}</summary>{a.feedback && <p className="mt-2 text-dim">{a.feedback}</p>}{a.answer && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-text">{a.answer}</pre>}{(a.errors ?? []).map((error, n) => <div key={n} className="mt-2 rounded border border-danger/30 p-2 text-dim"><strong className="text-danger">{error.category || "Error"}</strong> {error.description}{error.evidence && <p>Evidencia: {error.evidence}</p>}{error.fix && <p>Corrección: {error.fix}</p>}</div>)}</details>) : <p className="text-xs text-faint">Todavía no hay intentos registrados.</p>}<p className="text-xs text-faint">Las fechas corresponden a entregas registradas; no se guardaba la hora de inicio.</p></div>}
                      </article>;
                    })}</div> : <p className="text-xs text-faint">Sin ejercicios generados.</p>}</div>;
                  })}<button type="button" onClick={() => onOpenConfigurator(sp.skill)} className="rounded border border-line px-2 py-1 text-xs text-accent-text">Configurar ayuda y práctica</button></div></td></tr>}</Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Repasos pendientes (SRS) ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-line-strong bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "grid h-8 w-8 flex-none place-items-center rounded-lg border",
              topicSrsItems.length ? "border-warn/40 bg-warn-soft text-warn" : "border-mint/40 bg-mint-soft text-mint",
            )}
          >
            <CheckCircle2 size={15} />
          </span>
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text">
            Repasos pendientes (SRS) de este tema
          </h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold",
              topicSrsItems.length ? "bg-warn-soft text-warn" : "bg-mint-soft text-mint",
            )}
          >
            {topicSrsItems.length}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowIntervals(true)}
              className="rounded-lg border border-line bg-panel px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-accent hover:text-text"
            >
              Configurar intervalos
            </button>
            <span className="rounded-lg border border-line bg-panel px-2.5 py-1 text-[11px] text-faint">
              {topicSrsItems.length === 0 ? "Sin repasos activos" : `${topicSrsItems.length} repasos activos`}
            </span>
          </div>
        </div>

        {topicSrsItems.length === 0 ? (
          <p className="mt-2 text-[11.5px] text-faint">
            Todos los repasos espaciados de este tema están al día. El algoritmo te avisará cuando toque afianzar
            retención.
          </p>
        ) : (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {topicSrsItems.map((item, idx) => {
              const ex = item.exercise;
              if (!ex) return null;
              return (
                <div
                  key={`${ex.path}-${idx}`}
                  className="flex items-center justify-between rounded-xl border border-line bg-panel p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-text">{ex.title}</div>
                    <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
                      <Clock size={11} />
                      <span>{ex.mode}</span>
                      <span>·</span>
                      <span className="text-warn">{"★".repeat(ex.difficulty)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPractice(ex.path)}
                    className="ml-2 flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-text hover:bg-hover"
                  >
                    <Play size={10} /> Repasar
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1 text-[10.5px] text-faint">
        <span>Sistema de Aprendizaje Adaptativo · Dominio Cuantitativo</span>
        <span>
          Atajo de teclado: <b className="text-dim">Espacio</b> para practicar
        </span>
      </div>

      {showExamModal && (
        <ExamRunnerModal
          topicFolder={topicData.folder}
          manifest={manifest}
          onClose={() => setShowExamModal(false)}
          onExamFinished={() => {
            setShowExamModal(false);
          }}
        />
      )}
      {showIntervals && <SrsIntervalsDialog snap={snap} onClose={() => setShowIntervals(false)} />}
    </div>
  );
}
