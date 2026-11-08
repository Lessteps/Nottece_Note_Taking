// Una fila de ejercicio en la sesión: casilla, peso, reps y notas.
//
// Vive en su propio fichero porque lo usan Vista general y Diaria, y porque
// `ExerciseRow.test.tsx` lo prueba sin levantar el módulo entero.

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Play, Timer, X, Check } from "lucide-react";
import type { Exercise } from "../../lib/types";
import { inputBase } from "../common/forms";
import { cn } from "../ui";
import { ORANGE, useFail } from "./parts";
import { api } from "../../lib/bridge";
import { todayIso } from "../../lib/tasks";
import { fmtClock } from "../../lib/practiceTimer";
import { parseRestSecs } from "../../lib/parseRest";
import { parseRestSeconds, useRestTimer } from "../../store/restTimer";
import { useWorkoutTimer } from "../../store/workoutTimer";
import { useHabits } from "../../store/habits";
import { exerciseFramesUrls, parseExerciseSteps } from "../../lib/exerciseLibrary";

/** Un pitido corto al terminar el descanso. Sin audio, la línea avisa igual. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => void ctx.close().catch(() => {});
    window.setTimeout(() => void ctx.close().catch(() => {}), 1000);
  } catch {
    /* sin audio */
  }
}

/** Aviso global para que solo cuente un descanso a la vez. */
const REST_START_EVENT = "nv-rest-start";

/** One exercise row: tick, weight, reps, notes (saved on change / blur). */
export function ExerciseRow({ day, ex, entry, onChanged, onVideo }: {
  day: string; ex: Exercise; entry: { done?: boolean; weight?: number; reps?: number; notes?: string };
  onChanged: () => void; onVideo?: (ex: Exercise) => void;
}) {
  const fail = useFail();
  const [done, setDone] = useState(Boolean(entry.done));
  const [weight, setWeight] = useState(entry.weight ? String(entry.weight) : "");
  const [reps, setReps] = useState(entry.reps ? String(entry.reps) : "");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const gymHabit = useHabits((s) => s.habits.find((h) => h.id === "gym"));
  const sched = gymHabit?.exercise_schedules?.[ex.id];
  const [editingTime, setEditingTime] = useState(false);
  const [schedTime, setSchedTime] = useState(sched?.time ?? "");
  const [schedDur, setSchedDur] = useState(sched?.duration_min ? String(sched.duration_min) : "20");

  useEffect(() => {
    setSchedTime(sched?.time ?? "");
    setSchedDur(sched?.duration_min ? String(sched.duration_min) : "20");
  }, [sched?.time, sched?.duration_min]);

  // Lo que se ve de cada guardado: en reposo no se pinta nada para no meter
  // ruido en la fila que más se mira.
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [lastSession, setLastSession] = useState<{ weight: number; reps: number; date: string } | null>(null);
  const frames = useMemo(() => exerciseFramesUrls(ex), [ex.source, ex.name]);
  const steps = useMemo(() => parseExerciseSteps(ex.how_to), [ex.how_to]);
  // The latest values, read by every save: a blur and a click can fire two
  // saves before React re-renders, and the second must not send stale fields.
  const latest = useRef({ done, weight, reps, notes });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const future = day > todayIso();
  useEffect(() => {
    const v = { done: Boolean(entry.done), weight: entry.weight ? String(entry.weight) : "", reps: entry.reps ? String(entry.reps) : "", notes: entry.notes ?? "" };
    latest.current = v;
    setDone(v.done);
    setWeight(v.weight);
    setReps(v.reps);
    setNotes(v.notes);
    setStatus("idle");
    setError("");
    // Cargar la sesión previa completada para sobrecarga progresiva.
    let alive = true;
    void api.exHistory(ex.id)
      .then((rows) => {
        if (!alive || !Array.isArray(rows) || !rows.length) return;
        const past = rows
          .filter((r) => r.date < day && (r.weight > 0 || r.reps > 0))
          .sort((a, b) => a.date.localeCompare(b.date));
        if (past.length > 0) {
          const l = past[past.length - 1]!;
          setLastSession({ weight: l.weight, reps: l.reps, date: l.date });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Only when another day or exercise is shown: after that the row owns its
    // values, so a reload after a save never wipes what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, ex.id]);
  const change = (patch: Partial<typeof latest.current>) => {
    latest.current = { ...latest.current, ...patch };
    setStatus("idle");
    setError("");
  };
  /** Vacío = peso corporal; si trae algo, solo dígitos con punto o coma, ≥ 0. */
  const validNumber = (raw: string): boolean => {
    const t = raw.trim().replace(",", ".");
    if (t === "") return true;
    return /^\d+(\.\d+)?$/.test(t);
  };
  const save = (patch: Partial<typeof latest.current> = {}) => {
    change(patch);
    const v = latest.current;
    // Letras o negativos no viajan al backend: avisan en la fila y el dato
    // escrito se queda para corregirlo, no se pisa con un 0.
    if (!validNumber(String(v.weight ?? "")) || !validNumber(String(v.reps ?? ""))) {
      setError("Solo números ≥ 0 en peso y reps.");
      return Promise.resolve();
    }
    setStatus("saving");
    // One write at a time, in order.
    queue.current = queue.current.then(async () => {
      const w = latest.current;
      try {
        await api.exMark(day, ex.id, w.done, w.weight || 0, w.reps || 0, w.notes);
        setStatus("saved");
        onChanged();
      } catch (e) {
        setStatus("error");
        fail(e);
      }
    });
    return queue.current;
  };
  const small = cn(inputBase, "w-16 py-1 text-right text-[12px]");
  const hasVideo = Boolean(onVideo) && (ex.has_video || Boolean(ex.video_path));
  // Temporizador de descanso: local a la fila, sin backend. Si otra fila
  // empieza el suyo, este se pausa para que solo cuente uno a la vez.
  const [timerOpen, setTimerOpen] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [announced, setAnnounced] = useState(false);
  const [manual, setManual] = useState("");
  const timerId = useRef(`${ex.id}-${day}`);
  useEffect(() => {
    timerId.current = `${ex.id}-${day}`;
  }, [ex.id, day]);
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== timerId.current) setRunning(false);
    };
    window.addEventListener(REST_START_EVENT, onOther);
    return () => window.removeEventListener(REST_START_EVENT, onOther);
  }, []);
  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      if (!announced) {
        setAnnounced(true);
        beep();
      }
      return;
    }
    const id = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running, remaining, announced]);
  const openTimer = () => {
    const secs = parseRestSecs(ex.rest);
    setAnnounced(false);
    setRunning(false);
    if (secs !== null) {
      setRemaining(secs);
      setManual("");
    } else {
      setManual("");
    }
    setTimerOpen(true);
    const globalSecs = parseRestSeconds(ex.rest || "90");
    useRestTimer.getState().start(ex.name, globalSecs, async () => {
      setDone(true);
      await save({ done: true });
    });
  };
  const startManual = () => {
    const secs = Math.round(Number(String(manual).replace(",", ".")));
    if (Number.isFinite(secs) && secs > 0) {
      setRemaining(secs);
      setAnnounced(false);
      setRunning(true);
      window.dispatchEvent(new CustomEvent(REST_START_EVENT, { detail: timerId.current }));
    }
  };
  return (
    <div className="rounded-2xl border border-line bg-card px-3.5 py-3 space-y-3">
      <div className="flex items-center gap-3">
        <input type="checkbox" aria-label={`Hecho: ${ex.name}`} checked={done} disabled={future} style={{ accentColor: ORANGE }}
          onChange={(e) => {
            const isChecked = e.target.checked;
            setDone(isChecked);
            void save({ done: isChecked });
            if (isChecked && ex.rest) {
              const secs = parseRestSeconds(ex.rest);
              useRestTimer.getState().start(ex.name, secs);
            }
          }} />
        {/* El nombre es el control del video: si tiene, se pulsa aquí. */}
        {hasVideo ? (
          <button
            type="button"
            onClick={() => onVideo?.(ex)}
            title={`Ver video: ${ex.name}`}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate text-left text-[13px] hover:underline",
              done ? "text-faint line-through" : "text-text hover:text-accent-text"
            )}
          >
            <span>{ex.name}</span>
            <span className="flex-none text-[11px] text-amber-400">▶</span>
          </button>
        ) : (
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", done ? "text-faint line-through" : "text-text")}>{ex.name}</span>
        )}
        {ex.series_reps && <span className="text-[11.5px] text-dim">{ex.series_reps}</span>}
        <button
          type="button"
          onClick={() => useWorkoutTimer.getState().openTimer(ex, day)}
          title={`Abrir temporizador de series para ${ex.name}`}
          className="flex-none inline-flex items-center gap-1 rounded-lg border border-line bg-card/60 px-2 py-0.5 text-[11px] font-medium text-dim hover:text-amber-400 hover:border-amber-500/40 hover:bg-amber-500/10 transition-colors"
        >
          <Timer size={11} className="text-amber-400" /> Series
        </button>

        {editingTime ? (
          <div className="flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded-lg border border-line">
            <input
              type="time"
              value={schedTime}
              onChange={(e) => setSchedTime(e.target.value)}
              className="rounded bg-card px-1 py-0.5 text-[11px] font-mono text-text outline-none focus:border-amber-400"
            />
            <input
              type="number"
              min={5}
              max={120}
              step={5}
              value={schedDur}
              onChange={(e) => setSchedDur(e.target.value)}
              className="w-10 rounded bg-card px-1 py-0.5 text-[11px] font-mono text-text outline-none focus:border-amber-400"
              title="Duración en minutos"
            />
            <span className="text-[10px] text-faint">m</span>
            <button
              type="button"
              onClick={() => {
                const currentSchedules = { ...(gymHabit?.exercise_schedules ?? {}) };
                if (schedTime) {
                  currentSchedules[ex.id] = {
                    time: schedTime,
                    duration_min: Number(schedDur) || 20,
                    in_calendar: true,
                  };
                } else {
                  delete currentSchedules[ex.id];
                }
                void useHabits.getState().update("gym", { exercise_schedules: currentSchedules });
                setEditingTime(false);
              }}
              title="Guardar horario"
              className="rounded p-0.5 text-mint hover:bg-hover"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={() => setEditingTime(false)}
              title="Cancelar"
              className="rounded p-0.5 text-faint hover:bg-hover hover:text-text"
            >
              <X size={12} />
            </button>
          </div>
        ) : sched?.time ? (
          <button
            type="button"
            onClick={() => setEditingTime(true)}
            title={`Horario en calendario: ${sched.time} (${sched.duration_min ?? 20} min). Clic para editar.`}
            className="flex-none inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <Clock size={10} /> {sched.time}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditingTime(true)}
            title="Asignar horario para el calendario"
            className="flex-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-faint hover:text-text hover:bg-hover transition-all"
          >
            <Clock size={10} /> Horario
          </button>
        )}

        {ex.rest && (
          <button
            type="button"
            data-rest-timer
            title={`Iniciar descanso de ${ex.rest} (se completará automáticamente al terminar)`}
            onClick={openTimer}
            className={cn(
              "flex-none inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors",
              done
                ? "border-line text-faint hover:text-dim"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50",
            )}
          >
            <Play size={10} className="fill-current" /> Iniciar ({ex.rest})
          </button>
        )}
        {lastSession && (
          <button
            type="button"
            data-last-session
            onClick={() => {
              if (future) return;
              const w = lastSession.weight ? String(lastSession.weight) : "";
              const r = lastSession.reps ? String(lastSession.reps) : "";
              setWeight(w);
              setReps(r);
              void save({ weight: w, reps: r });
            }}
            title={`Última sesión (${lastSession.date}): ${lastSession.weight ? `${lastSession.weight} kg` : "peso corporal"} × ${lastSession.reps} reps. Clic para copiar.`}
            className="flex-none rounded-md px-1.5 py-0.5 font-mono text-[11px] text-faint transition-colors hover:bg-hover hover:text-dim"
          >
            prev: <b className="font-normal text-dim">{lastSession.weight ? `${lastSession.weight}kg` : "—"}</b> × {lastSession.reps}
          </button>
        )}
        <input className={small} placeholder="kg" aria-label={`Peso: ${ex.name}`} value={weight} disabled={future}
          onChange={(e) => { setWeight(e.target.value); change({ weight: e.target.value }); }} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <input className={small} placeholder="reps" aria-label={`Reps: ${ex.name}`} value={reps} disabled={future}
          onChange={(e) => { setReps(e.target.value); change({ reps: e.target.value }); }} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        {/* Lo que se ve del guardado: nada en reposo, «···» mientras escribe,
            «✓» al confirmar y «Reintentar» si falla. Sin esto la fila guardaba
            en silencio y un fallo solo salía en un toast global. */}
        {status !== "idle" && (
          <span data-row-status title={status === "saved" ? "Guardado ✓" : status === "saving" ? "Guardando…" : "Error al guardar"}
            className={cn("w-6 flex-none text-center text-[11px]", status === "error" ? "text-danger" : status === "saved" ? "text-mint" : "text-faint")}>
            {status === "saving" ? "···" : status === "saved" ? "✓" : "!"}
          </span>
        )}
        {status === "error" && (
          <button type="button" data-row-retry onClick={() => void save()}
            className="flex-none rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-text">
            Reintentar
          </button>
        )}
        {/* Sin caja de notas a propósito. El dato existe en el modelo, el
            backend lo guarda y esta fila lo envía, pero **nadie ha pedido poder
            escribirlo** y el input ocupaba 176 px en la fila que más se usa.
            Antes vivía detrás de `compact`, que nadie activaba, así que
            nunca se vio. Ponerlo son tres líneas si algún día hace falta. */}
      </div>
      {/* Las 3 imágenes de ejecución de la biblioteca */}
      {frames.length > 0 && (
        <div className="pl-7 pt-1">
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1" data-exercise-frames>
            {frames.map((src, i) => (
              <div
                key={i}
                className="relative flex-none overflow-hidden rounded-xl border border-line shadow-sm"
                style={{ background: "#141414" }}
              >
                <img
                  src={src}
                  alt={`${ex.name} fase ${i + 1}`}
                  loading="lazy"
                  className="h-24 w-24 sm:h-28 sm:w-28 object-contain"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-faint">
                  {i === 0 ? "1. Inicio" : i === 1 ? "2. Ejecución" : "3. Final"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instrucciones acomodadas paso por paso */}
      {steps.length > 0 ? (
        <div className="pl-7 pt-0.5" data-exercise-steps>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
            Cómo hacerlo
          </div>
          <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-dim">
            {steps.map((step, idx) => (
              <li key={idx} className="pl-1">
                {step}
              </li>
            ))}
          </ol>
        </div>
      ) : ex.how_to ? (
        <p className="pl-7 text-[12px] leading-relaxed text-faint">{ex.how_to}</p>
      ) : null}
      {error && <p data-row-error className="mt-1 pl-7 text-[11.5px] text-danger">{error}</p>}
      {timerOpen && (
        <div data-rest-countdown className="mt-1.5 flex flex-wrap items-center gap-2 pl-7">
          {parseRestSecs(ex.rest) !== null || remaining > 0 ? (
            <>
              <span data-rest-remaining className="font-mono text-[13px] text-text">
                {remaining <= 0 && announced ? "¡A por la siguiente!" : fmtClock(remaining)}
              </span>
              <button
                type="button"
                data-rest-start
                onClick={() => {
                  if (remaining <= 0) return;
                  const next = !running;
                  setRunning(next);
                  if (next) window.dispatchEvent(new CustomEvent(REST_START_EVENT, { detail: timerId.current }));
                }}
                className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-text"
              >
                {running ? "Pausar" : "Iniciar"}
              </button>
              <button
                type="button"
                data-rest-add
                onClick={() => setRemaining((r) => r + 15)}
                className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-text"
              >
                +15s
              </button>
            </>
          ) : (
            <>
              <input
                data-rest-manual
                className={cn(inputBase, "w-20 py-0.5 text-right text-[12px]")}
                placeholder="seg"
                aria-label="Segundos de descanso"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startManual()}
              />
              <button
                type="button"
                data-rest-manual-start
                onClick={startManual}
                className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-text"
              >
                Empezar
              </button>
            </>
          )}
          <button
            type="button"
            data-rest-close
            onClick={() => {
              setTimerOpen(false);
              setRunning(false);
            }}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-faint hover:bg-hover hover:text-text"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
