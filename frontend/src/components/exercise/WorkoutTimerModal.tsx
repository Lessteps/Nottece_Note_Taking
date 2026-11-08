import { useState } from "react";
import { Check, FastForward, Pause, Play, RotateCcw, Timer, Volume2, VolumeX, X, Plus, Minus } from "lucide-react";
import { fmtClock } from "../../lib/practiceTimer";
import { useWorkoutTimer } from "../../store/workoutTimer";
import { cn } from "../ui";

export function WorkoutTimerModal() {
  const open = useWorkoutTimer((s) => s.modalOpen);
  const exerciseName = useWorkoutTimer((s) => s.exerciseName);
  const totalSets = useWorkoutTimer((s) => s.totalSets);
  const currentSet = useWorkoutTimer((s) => s.currentSet);
  const targetReps = useWorkoutTimer((s) => s.targetReps);
  const restSeconds = useWorkoutTimer((s) => s.restSeconds);
  const phase = useWorkoutTimer((s) => s.phase);
  const running = useWorkoutTimer((s) => s.running);
  const remainingSeconds = useWorkoutTimer((s) => s.remainingSeconds);
  const elapsedSeconds = useWorkoutTimer((s) => s.elapsedSeconds);
  const completedSets = useWorkoutTimer((s) => s.completedSets);
  const sound = useWorkoutTimer((s) => s.sound);

  const {
    closeModal,
    startSet,
    finishSet,
    skipRest,
    pause,
    resume,
    addSeconds,
    reset,
    toggleSound,
    setTotalSets,
  } = useWorkoutTimer.getState();

  const [weight, setWeight] = useState("0");
  const [reps, setReps] = useState("10");

  if (!open) return null;

  const isCompleted = completedSets.length >= totalSets && phase === "idle";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-card shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-surface/50">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
              <Timer size={18} />
            </span>
            <div>
              <h2 className="text-[14.5px] font-bold text-text truncate max-w-[320px]">
                {exerciseName}
              </h2>
              <p className="text-[11.5px] text-faint">
                Objetivo: {targetReps} · Descanso: {restSeconds}s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleSound}
              title={sound ? "Silenciar avisos" : "Activar sonido"}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                sound ? "text-amber-400 hover:bg-hover" : "text-faint hover:text-text hover:bg-hover",
              )}
            >
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button
              type="button"
              onClick={closeModal}
              title="Cerrar"
              className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text transition-colors"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Phase Badge & Set Counter */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wider",
                  phase === "work" && "bg-amber-500/20 text-amber-400 animate-pulse",
                  phase === "rest" && "bg-blue-500/20 text-blue-400",
                  phase === "idle" && (isCompleted ? "bg-emerald-500/20 text-emerald-400" : "bg-card border border-line text-faint"),
                )}
              >
                {phase === "work" ? "En serie (Trabajo)" : phase === "rest" ? "Descanso" : isCompleted ? "¡Completado!" : "Listo"}
              </span>
              <span className="font-mono text-[13px] font-medium text-text">
                Serie {Math.min(currentSet, totalSets)} de {totalSets}
              </span>
            </div>

            {phase === "idle" && !isCompleted && (
              <div className="flex items-center gap-1.5 text-[12px] text-faint">
                <span>Total series:</span>
                <button
                  type="button"
                  onClick={() => setTotalSets(totalSets - 1)}
                  disabled={totalSets <= 1}
                  className="rounded p-1 hover:bg-hover disabled:opacity-30"
                >
                  <Minus size={12} />
                </button>
                <span className="font-mono font-bold text-text">{totalSets}</span>
                <button
                  type="button"
                  onClick={() => setTotalSets(totalSets + 1)}
                  disabled={totalSets >= 15}
                  className="rounded p-1 hover:bg-hover disabled:opacity-30"
                >
                  <Plus size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Clock Display */}
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl border py-8 transition-colors",
              phase === "work" && "border-amber-500/40 bg-amber-500/5",
              phase === "rest" && "border-blue-500/40 bg-blue-500/5",
              phase === "idle" && "border-line bg-surface/30",
            )}
          >
            <div className="font-mono text-[56px] font-bold tracking-tight text-text">
              {phase === "work"
                ? fmtClock(elapsedSeconds)
                : phase === "rest"
                  ? fmtClock(remainingSeconds)
                  : fmtClock(restSeconds)}
            </div>
            <div className="text-[12px] text-faint mt-1">
              {phase === "work"
                ? "Tiempo de ejecución de la serie"
                : phase === "rest"
                  ? "Recuperación para la siguiente serie"
                  : isCompleted
                    ? "¡Ejercicio terminado!"
                    : "Presiona comenzar serie para iniciar"}
            </div>
          </div>

          {/* Controls */}
          {phase === "work" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-faint uppercase tracking-wider">
                    Peso (kg)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[14px] text-text outline-none focus:border-amber-400"
                    placeholder="0"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-medium text-faint uppercase tracking-wider">
                    Repeticiones
                  </label>
                  <input
                    type="number"
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[14px] text-text outline-none focus:border-amber-400"
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={running ? pause : resume}
                  className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-dim hover:bg-hover hover:text-text transition-colors"
                >
                  {running ? <Pause size={15} /> : <Play size={15} />}
                  <span>{running ? "Pausar" : "Reanudar"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void finishSet(Number(reps) || 0, Number(weight) || 0)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-[13.5px] font-semibold text-black hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
                >
                  <Check size={16} />
                  <span>Completar serie {currentSet}</span>
                </button>
              </div>
            </div>
          )}

          {phase === "rest" && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => addSeconds(-15)}
                  className="rounded-lg border border-line px-3 py-1.5 font-mono text-[12px] text-dim hover:bg-hover hover:text-text transition-colors"
                >
                  -15s
                </button>
                <button
                  type="button"
                  onClick={running ? pause : resume}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-4 py-1.5 text-[12.5px] font-medium text-dim hover:bg-hover hover:text-text transition-colors"
                >
                  {running ? <Pause size={14} /> : <Play size={14} />}
                  <span>{running ? "Pausar" : "Reanudar"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addSeconds(15)}
                  className="rounded-lg border border-line px-3 py-1.5 font-mono text-[12px] text-dim hover:bg-hover hover:text-text transition-colors"
                >
                  +15s
                </button>
              </div>

              <button
                type="button"
                onClick={skipRest}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-500 transition-colors"
              >
                <FastForward size={15} />
                <span>Saltar descanso / Iniciar serie {currentSet}</span>
              </button>
            </div>
          )}

          {phase === "idle" && (
            <div>
              {isCompleted ? (
                <div className="space-y-3 text-center">
                  <div className="text-[14px] font-medium text-emerald-400">
                    ¡Has completado todas las {totalSets} series!
                  </div>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={reset}
                      className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text"
                    >
                      <RotateCcw size={14} /> Reiniciar ejercicio
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-xl bg-accent px-5 py-2 text-[12.5px] font-semibold text-white hover:bg-accent/90"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={startSet}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[14px] font-bold text-black hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
                  >
                    <Play size={17} className="fill-current" />
                    <span>Comenzar serie {currentSet}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Completed Sets History */}
          {completedSets.length > 0 && (
            <div className="border-t border-line pt-4">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">
                Series registradas ({completedSets.length})
              </div>
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {completedSets.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-line/60 bg-surface/40 px-3 py-1.5 text-[12px]"
                  >
                    <span className="font-semibold text-text">Serie {s.setNumber}</span>
                    <span className="font-mono text-dim">
                      {s.weight > 0 ? `${s.weight} kg` : "Peso corporal"} × {s.reps} reps
                    </span>
                    <span className="font-mono text-[11px] text-faint">
                      {fmtClock(s.durationSec)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

