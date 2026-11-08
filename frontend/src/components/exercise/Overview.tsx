// Vista general premium: héroe con la fecha, tira compacta de stats y la
// sesión como protagonista.
//
// La pantalla se lee de arriba abajo en el orden en que se usa: primero el
// héroe (qué día tengo abierto y qué me queda), luego los anillos y la racha
// en una sola tarjeta, y debajo la sesión del día —con sus casillas, kg y
// reps— junto al enfoque muscular (qué ejercicio trabaja cada músculo).
//
// Las flechas de fecha viven en el héroe: antes eran la única razón de
// existir de la pantalla «Diaria», que era una copia de la sesión con
// `date = hoy`. Ahora es una sola pantalla y se navega.
//
// Sin cambios de comportamiento: los números los siguen pintando `PeriodRings`
// y `StreakLine`, las filas son `ExerciseRow` y el cuerpo es `MuscleFocusCard`.
// Esto es solo composición y relieve.

import { useEffect, useMemo, useState } from "react";
import { Map as MapIcon, Dumbbell, Timer } from "lucide-react";
import { api } from "../../lib/bridge";
import { addDays } from "../../lib/habits";
import { NavButtons } from "../habits/parts";
import { shortDate, todayIso } from "../../lib/tasks";
import { weekdayKeyOf } from "../../lib/exercise";
import { Header } from "../habits/parts";
import { GhostButton } from "../common/forms";
import { useExercise } from "../../store/exercise";
import { useWorkoutTimer } from "../../store/workoutTimer";
import type { Exercise, ExerciseDay } from "../../lib/types";
import { ExerciseRow } from "./ExerciseRow";
import { MuscleMap } from "./MuscleMap";
import { ORANGE, StreakLine, useFail } from "./parts";

export function Overview({
  date,
  onDate,
  onGoProgram,
  onVideo,
}: {
  /** El día abierto. Vive en ExerciseModule para que las flechas sobrevivan a un
   *  cambio de pantalla y para que «Ir a hoy» pueda volver a él. */
  date: string;
  onDate: (iso: string) => void;
  onGoProgram: () => void;
  onVideo?: (ex: Exercise) => void;
}) {
  const fail = useFail();
  // `stats` no se lee aquí: lo leen `PeriodRings` y `StreakLine` por su cuenta.
  const days = useExercise((s) => s.days);
  const list = useExercise((s) => s.list);
  const refreshStats = useExercise((s) => s.refreshStats);

  const [day, setDay] = useState<ExerciseDay | null>(null);
  const [map, setMap] = useState(false);

  const key = weekdayKeyOf(date);
  const meta = days.find((d) => d.key === key);
  const isToday = date === todayIso();

  const load = () => api.exDays(date, date).then((d) => setDay(d[0] ?? null)).catch(fail);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const byId = useMemo(() => new Map(list.map((e) => [e.id, e])), [list]);
  const total = day?.exercises.length ?? 0;
  const done = day ? day.exercises.filter((e) => day.log[e.id]?.done).length : 0;
  const pending = Math.max(0, total - done);

  const reload = () => {
    void load();
    void refreshStats();
  };

  return (
    <>
      <Header title="Vista general">
        <span className="text-[11.5px] text-faint">Ejercicio</span>
        <GhostButton onClick={() => useWorkoutTimer.getState().openTimer(day?.exercises?.[0], date)}>
          <Timer size={13} className="text-amber-400" /> Temporizador
        </GhostButton>
        <GhostButton data-go-program-view onClick={onGoProgram}>
          <Dumbbell size={13} /> Tu programa
        </GhostButton>
      </Header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        {/* El héroe: qué día tengo abierto, cómo me muevo y qué me queda. La
            fecha va grande; las flechas, integradas en ella y no como botones
            sueltos; lo pendiente, como píldora naranja —o nada, si no hay. */}
        <section
          data-overview-hero
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4"
          style={{
            backgroundImage: `linear-gradient(115deg, color-mix(in srgb, ${ORANGE} 16%, transparent), transparent 55%)`,
          }}
        >
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
              {isToday ? "Hoy" : meta ? `${meta.glyph} ${meta.name}` : "Sesión"}
              {meta?.subtitle && <span className="font-normal normal-case tracking-normal text-faint"> · {meta.subtitle}</span>}
            </div>
            <div className="text-[26px] font-bold leading-tight text-text">
              {shortDate(date)}
            </div>
          </div>
          {pending > 0 ? (
            <span
              data-pending-pill
              className="rounded-full px-3 py-1 text-[12.5px] font-semibold"
              style={{ background: `color-mix(in srgb, ${ORANGE} 22%, transparent)`, color: ORANGE }}
            >
              {pending === 1 ? "te queda 1" : `te quedan ${pending}`}
            </span>
          ) : total > 0 ? (
            <span className="rounded-full border border-line px-3 py-1 text-[12.5px] font-semibold text-mint">
              Día completado ✓
            </span>
          ) : null}
          <span className="flex-1" />
          <NavButtons
            label={`${shortDate(date)}${isToday ? " · hoy" : ""}`}
            onPrev={() => onDate(addDays(date, -1))}
            onNext={() => onDate(addDays(date, 1))}
            onToday={() => onDate(todayIso())}
          />
        </section>

        {/* La racha, sola en su tarjeta: los cuatro anillos se mudaron al
            sidebar, donde se ven desde cualquier pantalla del módulo y no
            solo desde esta. */}
        <StreakLine />

        {/* La sesión del día abierto. */}
        <section className="rounded-2xl border border-line bg-card" data-session-date={date}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3">
            <span className="text-[15px] font-semibold text-text">
              {meta ? `${meta.glyph} ${meta.name}` : "Hoy"}
            </span>
            {meta?.subtitle && <span className="text-[12px] text-faint">· {meta.subtitle}</span>}
            <span className="flex-1" />
            {total > 0 && (
              <button type="button" onClick={() => setMap(true)} title="Mapa muscular del día"
                className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-dim hover:bg-hover hover:text-text">
                <MapIcon size={13} /> Mapa
              </button>
            )}
          </div>
          {/* El avance del día como barra fina, no como píldora «1/2»: se ve
              de un vistazo cuánto queda, con los números como valores. */}
          {total > 0 && (
            <div className="flex items-center gap-2 border-b border-line px-4 pb-3">
              <div
                data-session-progress
                role="progressbar"
                aria-label="Progreso del día"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--nv-elevated)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${total ? Math.round((100 * done) / total) : 0}%`, background: ORANGE }}
                />
              </div>
              <span className="font-mono text-[12px] text-dim">{done}/{total}</span>
            </div>
          )}
          <div className="space-y-2 p-3">
            {!day || !day.exercises.length ? (
              <p className="py-8 text-center text-[13px] text-faint">
                {total === 0 && !day
                  ? "Cargando…"
                  : isToday
                    ? "Día de descanso: hoy no hay ejercicios programados."
                    : "Ese día no hay ejercicios programados."}
              </p>
            ) : (
              day.exercises.map((ex) => {
                const full = byId.get(ex.id);
                return full ? (
                  <ExerciseRow key={ex.id} day={date} ex={full} entry={day.log[ex.id] ?? {}}
                    onVideo={onVideo} onChanged={reload} />
                ) : (
                  <div key={ex.id} className="rounded-2xl border border-line px-3 py-2 text-[13px] text-dim">
                    {ex.name}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {map && (
        <MuscleMap
          date={date}
          day={day}
          onVideo={onVideo}
          onChanged={reload}
          onClose={() => setMap(false)}
        />
      )}
    </>
  );
}