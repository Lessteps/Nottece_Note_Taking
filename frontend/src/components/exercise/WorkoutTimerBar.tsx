import { FastForward, Pause, Play, Timer, X } from "lucide-react";
import { fmtClock } from "../../lib/practiceTimer";
import { useWorkoutTimer } from "../../store/workoutTimer";
import { cn } from "../ui";

export function WorkoutTimerBar() {
  const phase = useWorkoutTimer((s) => s.phase);
  const running = useWorkoutTimer((s) => s.running);
  const exerciseName = useWorkoutTimer((s) => s.exerciseName);
  const currentSet = useWorkoutTimer((s) => s.currentSet);
  const totalSets = useWorkoutTimer((s) => s.totalSets);
  const remainingSeconds = useWorkoutTimer((s) => s.remainingSeconds);
  const elapsedSeconds = useWorkoutTimer((s) => s.elapsedSeconds);
  const modalOpen = useWorkoutTimer((s) => s.modalOpen);

  const { pause, resume, skipRest, openTimer, reset } = useWorkoutTimer.getState();

  // No mostrar si el modal completo ya está abierto o si está en idle
  if (modalOpen || phase === "idle") return null;

  return (
    <aside
      aria-label="Temporizador de serie activo"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl border border-line bg-card/95 px-4 py-2.5 shadow-2xl backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => openTimer()}
        className="flex items-center gap-2.5 text-left group"
        title="Abrir temporizador completo"
      >
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl transition-colors",
            phase === "work" ? "bg-amber-500/20 text-amber-400 animate-pulse" : "bg-blue-500/20 text-blue-400",
          )}
        >
          <Timer size={17} />
        </span>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-text truncate max-w-[140px] group-hover:text-accent-text">
              {exerciseName}
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              S{currentSet}/{totalSets}
            </span>
          </div>
          <div className="font-mono text-[13px] font-bold text-text">
            {phase === "work" ? fmtClock(elapsedSeconds) : fmtClock(remainingSeconds)}
            <span className="ml-1 text-[10.5px] font-normal text-dim">
              ({phase === "work" ? "trabajo" : "descanso"})
            </span>
          </div>
        </div>
      </button>

      <div className="flex items-center gap-1 border-l border-line pl-2">
        <button
          type="button"
          onClick={running ? pause : resume}
          title={running ? "Pausar" : "Reanudar"}
          className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text transition-colors"
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {phase === "rest" && (
          <button
            type="button"
            onClick={skipRest}
            title="Saltar descanso"
            className="grid h-7 w-7 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text transition-colors"
          >
            <FastForward size={14} />
          </button>
        )}

        <button
          type="button"
          onClick={reset}
          title="Detener temporizador"
          className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:bg-hover hover:text-danger transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}

