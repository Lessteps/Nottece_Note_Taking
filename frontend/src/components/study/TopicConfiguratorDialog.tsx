import { AlertTriangle, CheckCircle2, ChevronRight, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/bridge";
import type { TopicData } from "../../lib/types";
import { useApp } from "../../store/app";
import { cn } from "../ui";
import {
  type AssistanceLevel,
  type DifficultyLevel,
  DIFFICULTY_LEVELS,
  isAssistanceAllowed,
  isDifficultyAllowed,
  isTheoreticalTopic,
  type QuantityOption,
  type SkillDefinition,
  skillsForSubject,
} from "../../lib/skills";

interface TopicConfiguratorDialogProps {
  topicData: TopicData;
  onClose: () => void;
  onStarted?: (firstPath: string) => void;
  /** Rendered inside a view file instead of as a modal dialog. */
  inline?: boolean;
  /** Pre-selected competency (the matrix row's own "Practicar"). */
  initialSkill?: string;
}

const QUANTITY_OPTIONS: Array<{ id: QuantityOption; label: string; desc: string }> = [
  { id: "3-5", label: "3–5", desc: "Corto (4 ej.)" },
  { id: "6-10", label: "6–10", desc: "Completo (8 ej.)" },
  { id: "11+", label: "11+", desc: "Saturación (12 ej.)" },
  { id: "all", label: "Todos", desc: "Sub-casos existentes" },
  { id: "ai", label: "IA", desc: "Lo que decidió la IA" },
];

export function TopicConfiguratorDialog({
  topicData,
  onClose,
  onStarted,
  inline = false,
  initialSkill,
}: TopicConfiguratorDialogProps) {
  const toast = useApp((s) => s.toast);
  const openNote = useApp((s) => s.openNote);
  const setMode = useApp((s) => s.setMode);

  const manifest = topicData.topic!;
  const subject = manifest.subject || "mathematics";
  const allSubjectSkills = skillsForSubject(subject);
  const isTheoretical = isTheoreticalTopic(manifest.skills);

  // Order skills according to theoretical vs practical nature
  const theoreticalOrder = ["prove", "explain", "true_false", "counterexample"];
  const practicalOrder = ["solve", "process", "drill", "implement", "debug", "refactor"];

  // Only the skills this topic declares: with the AI's plan those are the ones it
  // chose for THIS topic, and nothing else is offered to practise.
  const manifestSkillsSet = new Set((manifest.skills || []).map((s) => s.toLowerCase()));
  const plan = manifest.plan ?? null;
  const skillsToInclude: SkillDefinition[] = allSubjectSkills.filter((s) => manifestSkillsSet.has(s.id.toLowerCase()));
  /** Exercises the plan wants for a skill at a difficulty (null without a plan). */
  const plannedCount = (skill: string, level: DifficultyLevel): number | null =>
    plan ? (plan[skill]?.[level - 1] ?? 0) : null;

  const declaredSkills = skillsToInclude.sort((a, b) => {
    const aDeclared = manifestSkillsSet.has(a.id.toLowerCase()) ? 0 : 1;
    const bDeclared = manifestSkillsSet.has(b.id.toLowerCase()) ? 0 : 1;
    if (aDeclared !== bDeclared) return aDeclared - bDeclared;
    if (isTheoretical) {
      const aTheo = theoreticalOrder.includes(a.id) ? 0 : 1;
      const bTheo = theoreticalOrder.includes(b.id) ? 0 : 1;
      return aTheo - bTheo;
    }
    const aPract = practicalOrder.includes(a.id) ? 0 : 1;
    const bPract = practicalOrder.includes(b.id) ? 0 : 1;
    return aPract - bPract;
  });

  const [selectedSkill, setSelectedSkill] = useState<string>(
    initialSkill ?? declaredSkills[0]?.id ?? "solve",
  );

  // Check if beginner allowed for selected skill
  const skillDef = allSubjectSkills.find((s) => s.id === selectedSkill);
  const levelOk = (skill: string, level: DifficultyLevel): boolean =>
    isDifficultyAllowed(subject, skill, level) && (plannedCount(skill, level) ?? 1) > 0;
  const firstLevel = (skill: string): DifficultyLevel =>
    ([1, 2, 3] as const).find((l) => levelOk(skill, l)) ?? 2;

  const [difficulty, setDifficulty] = useState<DifficultyLevel>(firstLevel(selectedSkill));
  const [quantity, setQuantity] = useState<QuantityOption>(plan ? "ai" : "3-5");

  const helperOk = isAssistanceAllowed(subject, selectedSkill, "helper");
  const [assistance, setAssistance] = useState<AssistanceLevel>(
    helperOk ? "helper" : "no_help",
  );
  const [loading, setLoading] = useState(false);

  // "Activar registro de errores", one box per competency: while on, the mistakes of graded
  // attempts are kept (private, in .notevault) and the next sessions are built around them.
  const [learning, setLearning] = useState<Record<string, { enabled: boolean; entries: number }>>({});
  useEffect(() => {
    let live = true;
    api.studyLearningStatus(topicData.folder).then((s) => live && setLearning(s)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [topicData.folder]);
  const toggleLearning = async (skill: string, enabled: boolean) => {
    try {
      const r = await api.studyLearningSet(topicData.folder, skill, enabled);
      setLearning((l) => ({ ...l, [skill]: { enabled: r.enabled, entries: r.entries } }));
      toast("info", r.enabled ? `Registro de errores activado${r.entries ? ` (${r.entries} errores previos)` : ""}.` : "Registro de errores desactivado (se conserva lo guardado).");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  // If user switches to a skill where beginner is not allowed, bump difficulty
  const handleSkillChange = (skillId: string) => {
    setSelectedSkill(skillId);
    if (!levelOk(skillId, difficulty)) setDifficulty(firstLevel(skillId));
    if (!isAssistanceAllowed(subject, skillId, "helper") && assistance === "helper") {
      setAssistance("no_help");
    }
  };

  // Inline current progress for selected skill & difficulty
  const skillProg = topicData.progress?.skills[selectedSkill];
  const cellProg = skillProg?.cells[difficulty];
  const exercisesAvailable = cellProg?.exerciseCount;
  const hasNoExercises = exercisesAvailable !== undefined && exercisesAvailable === 0;

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await api.studyTopicSessionBuild(
        topicData.folder,
        selectedSkill,
        difficulty,
        quantity,
        assistance,
      );
      if (res.first_exercise) {
        await openNote(res.first_exercise);
        setMode("read");
        onStarted?.(res.first_exercise);
        onClose();
        toast("info", `Sesión iniciada: ${res.exercises.length} ejercicios listos.`);
      } else {
        toast("error", "No se encontraron ejercicios en la vault para esta competencia. Usa «Generar lo que falta» o el asistente para crearlos.");
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const modal = !inline;

  return (
    <div
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? "true" : undefined}
      aria-labelledby="topic-config-title"
      className={modal
        ? "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        : "flex w-full flex-col"}
    >
      <div className={cn(
        "flex w-full flex-col overflow-hidden border border-line-strong bg-card",
        modal ? "max-h-[90vh] max-w-[620px] rounded-2xl shadow-2xl" : "min-h-0 rounded-2xl",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-accent-text">
                Configurador de práctica
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  isTheoretical
                    ? "border border-accent/40 bg-accent-soft text-accent-text"
                    : "border border-mint/40 bg-mint-soft text-mint",
                )}
              >
                {isTheoretical ? "Enfoque teórico" : "Enfoque práctico"}
              </span>
            </div>
            <h2 id="topic-config-title" className="mt-1 text-[18px] font-bold text-text">
              {manifest.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* 1. Skill Selection */}
          <div>
            <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
              1. Competencia a entrenar (Skill)
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {declaredSkills.map((s) => {
                const isSelected = selectedSkill === s.id;
                const prog = topicData.progress?.skills[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSkillChange(s.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex flex-col rounded-xl border p-2.5 text-left transition",
                      isSelected
                        ? "border-accent bg-accent-soft text-text shadow-sm"
                        : "border-line bg-panel hover:border-dim hover:bg-hover",
                    )}
                  >
                    <span className="text-[13px] font-semibold">{s.label}</span>
                    <span className="mt-0.5 text-[10.5px] leading-snug text-faint line-clamp-2">{s.description}</span>
                    {prog && (
                      <span className="mt-1 text-[10px] font-mono text-dim">
                        {prog.status === "consolidated"
                          ? "✓ Consolidado"
                          : prog.status === "practicing"
                            ? "En práctica"
                            : "Sin empezar"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mistakes record of the chosen competency */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-panel p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={learning[selectedSkill]?.enabled ?? false}
              onChange={(e) => void toggleLearning(selectedSkill, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text">
                Activar registro de errores{skillDef ? ` · ${skillDef.label}` : ""}
                {(learning[selectedSkill]?.entries ?? 0) > 0 && (
                  <span className="ml-2 font-mono text-[10.5px] font-normal text-warn">{learning[selectedSkill]!.entries} registrados</span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                Guarda en privado cómo fallas en esta competencia de este tema. Las próximas sesiones se centran sobre todo en
                esos errores (con ejercicios nuevos parecidos) y siguen entrenando la competencia completa.
              </span>
            </span>
          </label>

          {/* 2. Difficulty */}
          <div>
            <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
              2. Dificultad
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTY_LEVELS.map((d) => {
                const allowed = levelOk(selectedSkill, d.level);
                const unplanned = allowed === false && isDifficultyAllowed(subject, selectedSkill, d.level);
                const isSelected = difficulty === d.level;
                return (
                  <button
                    key={d.level}
                    type="button"
                    disabled={!allowed}
                    onClick={() => allowed && setDifficulty(d.level)}
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl border py-2.5 px-3 text-center transition",
                      isSelected
                        ? "border-accent bg-accent-soft text-text font-semibold"
                        : "border-line bg-panel hover:bg-hover",
                      !allowed && "opacity-40 cursor-not-allowed hover:bg-panel hover:border-line",
                    )}
                  >
                    <span className="text-[13px]">{d.label}</span>
                    <span className="mt-0.5 text-[10px] text-warn">{"★".repeat(d.level)}</span>
                    {plan && allowed && (() => {
                      const count = skillProg?.cells[d.level]?.exerciseCount;
                      const planned = plannedCount(selectedSkill, d.level);
                      const missingOnDisk = count !== undefined && count === 0 && (planned ?? 0) > 0;
                      return (
                        <span className={cn("mt-0.5 font-mono text-[9.5px]", missingOnDisk ? "text-warn font-medium" : "text-faint")}>
                          {missingOnDisk ? `0/${planned} creados` : `${planned} ej. planeados`}
                        </span>
                      );
                    })()}
                    {!allowed && (
                      <span className={cn("mt-0.5 text-[9.5px]", unplanned ? "text-faint" : "text-danger")}>{unplanned ? "Fuera del plan" : "No disponible"}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Quantity */}
          <div>
            <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
              3. Cantidad de ejercicios
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {QUANTITY_OPTIONS.map((q) => {
                const isSelected = quantity === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setQuantity(q.id)}
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl border py-2 px-1 text-center transition",
                      isSelected
                        ? "border-accent bg-accent-soft text-text font-semibold"
                        : "border-line bg-panel hover:bg-hover",
                    )}
                  >
                    <span className="text-[12px] font-bold">{q.label}</span>
                    <span className="mt-0.5 text-[9.5px] text-faint truncate max-w-full">
                      {q.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            {quantity === "ai" && (
              <p className="mt-1.5 text-[11px] text-faint">
                {plan
                  ? `La IA planeó ${plannedCount(selectedSkill, difficulty) ?? 0} ejercicios para esta competencia y dificultad.`
                  : "Aún no hay plan: la IA lo decidirá leyendo la teoría al empezar."}
              </p>
            )}
          </div>

          {/* 4. Assistance */}
          <div>
            <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
              4. Nivel de Asistencia
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAssistance("no_help")}
                className={cn(
                  "flex flex-col rounded-xl border p-3 text-left transition",
                  assistance === "no_help"
                    ? "border-accent bg-accent-soft text-text font-semibold"
                    : "border-line bg-panel hover:bg-hover",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Zap size={14} className="text-warn" />
                  <span className="text-[13px]">Sin ayuda (No Help)</span>
                </div>
                <span className="mt-1 text-[11px] text-faint">
                  El evaluador solo lista qué malas prácticas existen, sin indicar la solución ni la
                  línea.
                </span>
              </button>

              <button
                type="button"
                disabled={!helperOk}
                onClick={() => helperOk && setAssistance("helper")}
                className={cn(
                  "flex flex-col rounded-xl border p-3 text-left transition",
                  assistance === "helper"
                    ? "border-accent bg-accent-soft text-text font-semibold"
                    : "border-line bg-panel hover:bg-hover",
                  !helperOk && "opacity-40 cursor-not-allowed",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles size={14} className="text-accent-text" />
                  <span className="text-[13px]">Asistente (Helper)</span>
                </div>
                <span className="mt-1 text-[11px] text-faint">
                  Pistas progresivas paso a paso (qué hacer, por qué y cómo). Nunca da la solución
                  completa.
                </span>
              </button>
            </div>
          </div>

          {/* Inline Progress Card for Selected Skill x Difficulty */}
          <div className="rounded-xl border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold text-text">
                Tu progreso en este tema ({skillDef?.label} · Nivel {difficulty}):
              </span>
              {cellProg && cellProg.passes > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-mint">
                  <CheckCircle2 size={12} /> {cellProg.passes} superado{cellProg.passes > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-4 text-[12px] text-dim">
              <span>Intentos: <strong className="text-text">{cellProg?.attempts ?? 0}</strong></span>
              <span>Aprobados: <strong className="text-text">{cellProg?.passes ?? 0}</strong></span>
              <span>
                Mejor nota:{" "}
                <strong className="text-text">
                  {cellProg?.bestScore !== null && cellProg?.bestScore !== undefined
                    ? `${cellProg.bestScore}/100`
                    : "—"}
                </strong>
              </span>
              <span className="ml-auto font-mono text-[11px] text-faint">
                Objetivo tema: Nivel {manifest.mastery.target_difficulty} (min {manifest.mastery.min_per_skill} ej.)
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-panel/50 px-6 py-4">
          <div className="text-[11.5px] text-faint">
            {hasNoExercises ? (
              <span className="flex items-center gap-1.5 font-medium text-warn">
                <AlertTriangle size={13} aria-hidden /> Sin ejercicios en la vault para esta competencia: créalos desde Mentor o con el asistente.
              </span>
            ) : (
              "Se priorizan ejercicios existentes; si faltan, la IA creará específicos del tema."
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3.5 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleStart()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {loading ? (
                "Preparando sesión…"
              ) : (
                <>
                  Iniciar sesión <ChevronRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
