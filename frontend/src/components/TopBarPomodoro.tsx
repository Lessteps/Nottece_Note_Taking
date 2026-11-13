// Widget flotante / desplegable de Pomodoro global para la barra superior (TopBar).
// Permite consultar el reloj, pausar, reanudar o detener el pomodoro desde cualquier lugar de NoteVault sin estar en Mentor.

import { useEffect, useState } from "react";
import { Pause, Pin, PinOff, Play, Square, Timer, X } from "lucide-react";
import { usePomodoro } from "../store/pomodoro";
import { clock, remainingMs } from "../lib/pomodoro";
import { logFocus, topicsNote } from "./mentor/AreaSession";
import { useApp } from "../store/app";
import { PomodoroSetup } from "./PomodoroSetup";

export function TopBarPomodoro() {
  const p = usePomodoro((s) => s.p);
  const pinned = usePomodoro((s) => s.pinned);
  const setPinned = usePomodoro((s) => s.setPinned);
  const { pause, resume, next } = usePomodoro.getState();
  const toast = useApp((s) => s.toast);

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isRunning = p.phase !== "idle" && p.running;
  const isPaused = p.phase !== "idle" && !p.running;
  const showDropdown = open || pinned;

  // Actualizar timer en vivo solo mientras el temporizador esté activo y corriendo
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [isRunning]);

  const left = remainingMs(p, now);

  const handleStop = async () => {
    const wasBreak = usePomodoro.getState().p.phase === "break";
    const note = topicsNote(usePomodoro.getState().p.assignedTopics);
    const r = next(true);
    if (wasBreak) return; // saltar el descanso no guarda nada
    if (r.minutes >= 1) {
      try {
        await logFocus(r.planId, r.areaKey, r.minutes, note, "pomodoro", { work: r.work, topics: r.topics });
        toast("info", `${r.minutes} min guardados en ${r.areaKey}.`);
      } catch (e) {
        toast("error", `No se pudo guardar el bloque: ${(e as Error).message}`);
      }
    } else {
      toast("info", "Sesión detenida: menos de 1 minuto.");
    }
  };

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Pomodoro de estudio"
        aria-label="Pomodoro global"
        className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 font-mono text-[11.5px] transition-colors ${
          isRunning
            ? "border-accent bg-accent/20 text-accent-text font-bold"
            : isPaused
            ? "border-warn/60 bg-warn-soft text-warn font-semibold"
            : "border-line text-dim hover:bg-hover hover:text-text"
        }`}
      >
        <Timer size={13} className={isRunning ? "animate-pulse text-accent" : ""} />
        <span>{p.phase !== "idle" ? clock(left) : "Pomodoro"}</span>
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-9 z-50 max-h-[80vh] w-[21rem] space-y-3 overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-xl">
          <header className="flex items-center justify-between border-b border-line pb-1.5">
            <span className="font-mono text-[12px] font-bold text-text uppercase flex items-center gap-1.5">
              <Timer size={14} className="text-accent" />
              {p.phase === "idle" ? "Pomodoro listo" : p.phase === "focus" ? (p.mode === "stopwatch" ? "Cronómetro" : "Foco en curso") : "Descanso"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPinned(!pinned)}
                title={pinned ? "Desanclar" : "Fijar abierto"}
                className={`grid h-6 w-6 place-items-center rounded hover:bg-hover ${pinned ? "text-accent" : "text-faint"}`}
              >
                {pinned ? <Pin size={12} /> : <PinOff size={12} />}
              </button>
              {!pinned && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar"
                  className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-text"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </header>

          {p.phase === "idle" ? (
            <PomodoroSetup />
          ) : (
            <>
          <div className="text-center py-1">
            <p className="font-mono text-[32px] font-bold tracking-tight text-text leading-none tabular-nums">
              {clock(left)}
            </p>
            {p.areaKey && (
              <p className="mt-1 text-[11.5px] text-dim truncate">
                Área: <strong className="text-text capitalize">{p.areaKey}</strong>
              </p>
            )}
            {p.assignedTopics.length > 0 && (
              <p className="text-[11px] text-faint truncate">
                {p.assignedTopics[0]?.title} {p.assignedTopics.length > 1 ? `(+${p.assignedTopics.length - 1} más)` : ""}
              </p>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 pt-1 border-t border-line/60">
            {isRunning && (
              <button
                type="button"
                onClick={() => pause()}
                className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-text hover:bg-hover"
              >
                <Pause size={12} /> Pausar
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                onClick={() => resume()}
                className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90"
              >
                <Play size={12} /> Reanudar
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleStop()}
              className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-warn hover:bg-hover hover:text-danger"
              data-testid="topbar-pomodoro-stop"
            >
              <Square size={12} /> {p.phase === "break" ? "Saltar descanso" : "Guardar"}
            </button>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
