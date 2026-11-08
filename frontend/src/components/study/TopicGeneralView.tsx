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
import { useState } from "react";
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
  const mastered = skillsList.filter((s) => s.mastered).length;
  const practicing = skillsList.filter((s) => s.status === "practicing").length;
  const pending = Math.max(0, skillsList.length - mastered - practicing);

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
                { value: mastered, colour: "var(--nv-mint)", name: `Dominadas: ${mastered}` },
                { value: practicing, colour: "var(--nv-accent)", name: `En práctica: ${practicing}` },
                { value: pending, colour: "var(--nv-line-strong)", name: `Sin empezar: ${pending}` },
              ]}
            />
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
                Estado global
              </div>
              <h2 className="mt-0.5 text-[17px] font-bold leading-tight text-text">Dominio del Tema</h2>
              <p className="mt-1.5 max-w-[300px] text-[11.5px] leading-snug text-faint">
                {manifest.plan
                  ? `Completa las casillas de las ${skillsList.length} competencias que la IA eligió para este tema.`
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
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-text">Matriz de competencias</h3>
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
        <p className="mt-1 text-[11px] text-faint">
          Evolución pedagógica en {skillsList.length} dimensiones de aprendizaje.
        </p>

        <div className="mt-2.5 overflow-hidden rounded-2xl border border-line-strong bg-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel/60 font-mono text-[9.5px] uppercase tracking-wider text-faint">
                <th className="py-2.5 pl-4 pr-3 font-semibold">Habilidad pedagógica</th>
                <th className="px-2 py-2.5 text-center font-semibold text-warn">★ Fácil</th>
                <th className="px-2 py-2.5 text-center font-semibold text-warn">★★ Med</th>
                <th className="px-2 py-2.5 text-center font-semibold text-warn">★★★ Dif</th>
                <th className="py-2.5 pl-2 pr-4 text-right font-semibold">Estado &amp; acción</th>
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
                  <tr key={sp.skill} className="border-b border-line/60 last:border-none hover:bg-hover/40">
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-md border border-line bg-panel text-accent-text">
                          <Icon size={13} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-text">{sp.label}</div>
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
                          onClick={() => onOpenConfigurator(sp.skill)}
                          className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-accent-strong"
                        >
                          Practicar
                          <Play size={9} />
                        </button>
                      </div>
                    </td>
                  </tr>
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
