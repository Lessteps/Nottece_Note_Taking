// Mentor — «Más práctica»: enseña QUÉ PRÁCTICA VIENE (los katas del área ya planeados y los ejercicios de los temas de la ruta que aún no
// tienen intentos) y deja ADELANTAR uno a un día (hoy por defecto). Ya no pide qué practicar ni inventa títulos: ofrece adelantar las
// notas de ejercicio ya programadas en la ruta.
// Botón + diálogo; guarda con `mentor_plan_extra_practice_add`. Pieza reutilizable por props: quien la monte recoge el plan nuevo en `onChanged`.

import { ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { dateLabel } from "../../lib/planSchedule";
import type { MentorExerciseCandidate, MentorKataAhead, MentorPlan } from "../../lib/types";
import { useApp } from "../../store/app";
import { Chip, Field, GhostButton, input, Modal } from "../common/forms";
import { cn } from "../ui";

export interface AddExtraPracticeProps {
  planId: string;
  /** día al que se adelanta (AAAA-MM-DD); en el panel se puede cambiar */
  date: string;
  /** abre el panel en los ejercicios de esta área (id de subplan); sin él, de todas las áreas */
  area?: string;
  /** si true (modo Ejecución), fija la fecha a la sesión actual (date), oculta selector de fecha y restringe a esta misma área */
  lockSession?: boolean;
  /** compatibilidad hacia atrás: si la vista pasa temas ya no se usa como selector manual */
  topics?: ReadonlyArray<{ folder: string; title: string }>;
  minDate?: string;
  maxDate?: string;
  onChanged: (plan: MentorPlan) => void;
  label?: string;
  className?: string;
}

const COLD_RETRY_MS = 700;

const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fileNameOf = (rel: string): string => rel.split("/").pop() ?? rel;

interface Data {
  exercises: MentorExerciseCandidate[];
  katas: MentorKataAhead[];
}

async function openFile(rel: string): Promise<void> {
  try {
    await useApp.getState().openNote(rel);
  } catch (e) {
    useApp.getState().toast("error", (e as Error).message);
  }
}

function KataRow({ k, day, busy, onAdd, onOpen, dayText }: { k: MentorKataAhead; day: string; busy: boolean; onAdd: () => void; onOpen: () => void; dayText: string }) {
  const here = k.addedDates.includes(day);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2" data-testid="extra-practice-candidate" data-kind="kata" data-date={k.date}>
      <span className="min-w-0 flex-1 basis-44">
        <span className="block text-[14px] font-medium text-text">{k.title}</span>
        <span className="block text-[13px] text-dim">Kata {k.day} · {k.skill} · {k.minutes} min · Planeado el {dateLabel(k.date)}{here ? ` · Ya adelantado a ${dateLabel(day)}` : ""}</span>
      </span>
      <GhostButton aria-label={`Abrir ${k.title}`} onClick={onOpen}>Abrir</GhostButton>
      <GhostButton aria-label={`Adelantar ${k.title}`} disabled={busy || here} onClick={onAdd}>
        <ArrowUpRight size={14} aria-hidden /> {dayText}
      </GhostButton>
    </li>
  );
}

function ExerciseRow({ ex, day, busy, onAdd, dayText }: { ex: MentorExerciseCandidate; day: string; busy: boolean; onAdd: () => void; dayText: string }) {
  const here = ex.addedDates.includes(day);
  const hint = here ? `Ya adelantado a ${dateLabel(day)}` : ex.date ? `Planeado el ${dateLabel(ex.date)}` : "";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2" data-testid="extra-practice-candidate" data-rel={ex.rel} data-blocked={here ? "true" : "false"}>
      <span className="min-w-0 flex-1 basis-44">
        <span className="block text-[14px] font-medium text-text">{ex.title}</span>
        <span className="block text-[13px] text-dim">
          <span>{ex.topic}</span>
          <span className="font-mono text-[12px] text-faint"> · {fileNameOf(ex.rel)}</span>
          {ex.difficulty !== undefined ? ` · Dificultad ${ex.difficulty}` : ""}
          {hint ? ` · ${hint}` : ""}
        </span>
      </span>
      <Chip large colour={here ? "var(--nv-accent)" : "var(--nv-faint)"}>{here ? "Adelantado" : "Pendiente"}</Chip>
      <GhostButton aria-label={`Abrir ${ex.title}`} onClick={() => void openFile(ex.rel)}>Abrir</GhostButton>
      <GhostButton aria-label={`Adelantar ${ex.title}`} disabled={busy || here} onClick={onAdd} title={here ? `Ya añadido el ${dateLabel(day)}` : undefined}>
        <ArrowUpRight size={14} aria-hidden /> {dayText}
      </GhostButton>
    </li>
  );
}

export function AddExtraPractice({ planId, date, area, lockSession, minDate, maxDate, onChanged, label = "Añadir más práctica al aprendizaje diario", className }: AddExtraPracticeProps) {
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(date);
  const [allAreas, setAllAreas] = useState(!area && !lockSession);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => setDay(date), [date]);

  const scope = lockSession ? area : (allAreas ? undefined : area);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError("");
    try {
      for (let i = 0; i < 40; i++) {
        const [r, ka] = await Promise.all([
          api.mentorPlanExerciseCandidates({ id: planId, ...(scope ? { area: scope } : {}) }),
          api.mentorAreaKatasAhead(planId, scope).catch(() => ({ katas: [] as MentorKataAhead[] })),
        ]);
        if (seq.current !== mine) return;
        if (!r.loading) return void setData({ exercises: r.exercises, katas: ka?.katas ?? [] });
        await new Promise((ok) => setTimeout(ok, COLD_RETRY_MS));
        if (seq.current !== mine) return;
      }
      setError("El índice de la vault tarda demasiado en estar listo. Inténtalo de nuevo en un momento.");
    } catch (e) {
      if (seq.current === mine) setError((e as Error).message);
    }
  }, [planId, scope]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const add = async (ex: MentorExerciseCandidate): Promise<void> => {
    setBusy(true);
    try {
      const plan = await api.mentorPlanExtraPracticeAdd({
        id: planId,
        title: ex.title,
        kind: "exercise",
        date: day,
        area: ex.subplanId,
        folder: ex.folder,
        rel: ex.rel,
      });
      onChanged(plan);
      toast("info", `«${ex.title}» adelantado al ${day}.`);
      await load();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addKata = async (k: MentorKataAhead): Promise<void> => {
    setBusy(true);
    try {
      const plan = await api.mentorPlanExtraPracticeAdd({ id: planId, title: k.title, kind: "kata", date: day, area: k.subplanId, kataDate: k.date, minutes: k.minutes });
      onChanged(plan);
      toast("info", `«${k.title}» adelantado al ${day}.`);
      await load();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openKata = async (k: MentorKataAhead): Promise<void> => {
    try {
      const r = await api.mentorAreaKataOpen(planId, k.areaId, k.date);
      await useApp.getState().openNote(r.rel);
      if (r.projectWarning) toast("error", r.projectWarning);
      else if (r.projectRepo) toast("info", `Repositorio mensual: ${r.projectRepo}`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const close = (): void => {
    setOpen(false);
    setData(null);
  };

  // área → carpeta de tema → ejercicios
  const groups = useMemo(() => {
    const byArea = new Map<string, { name: string; topics: Map<string, { topic: string; rows: MentorExerciseCandidate[] }> }>();
    for (const ex of data?.exercises ?? []) {
      const g = byArea.get(ex.subplanId) ?? { name: ex.area, topics: new Map() };
      const t = g.topics.get(ex.folder) ?? { topic: ex.topic, rows: [] };
      t.rows.push(ex);
      g.topics.set(ex.folder, t);
      byArea.set(ex.subplanId, g);
    }
    return [...byArea.entries()];
  }, [data]);

  const katas = data?.katas ?? [];
  const dayText = day === localToday() ? "Adelantar a hoy" : `Adelantar al ${dateLabel(day)}`;

  return (
    <>
      <GhostButton large="md" className={cn(className)} onClick={() => { setDay(date); setAllAreas(!area); setOpen(true); }} aria-expanded={open} data-testid="add-extra-practice">
        <ArrowUpRight size={15} aria-hidden /> {label}
      </GhostButton>
      {open && (
        <Modal title={lockSession ? "Añadir más práctica al aprendizaje diario" : "Más práctica planificada"} onClose={close} width={760}>
          <p className="text-[14px] text-dim">
            {lockSession
              ? "Selecciona katas y ejercicios de esta área para añadirlos a tu sesión de práctica diaria."
              : "Estos son los katas y ejercicios ya planificados que aún no te tocan. Puedes adelantarlos al día que elijas."}
          </p>
          {!lockSession && (
            <div className="grid items-end gap-3 sm:grid-cols-[auto_1fr]">
              <Field label="Día">
                <input type="date" className={input} value={day} min={minDate} max={maxDate} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Día" />
              </Field>
              {area && (
                <div className="flex flex-wrap items-center gap-2">
                  <GhostButton large="md" aria-pressed={!allAreas} onClick={() => setAllAreas(false)} className={cn(!allAreas && "border-accent bg-accent-soft font-semibold text-accent-text")}>Esta área</GhostButton>
                  <GhostButton large="md" aria-pressed={allAreas} onClick={() => setAllAreas(true)} className={cn(allAreas && "border-accent bg-accent-soft font-semibold text-accent-text")}>Todas las áreas</GhostButton>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          {!data && !error && <p className="text-[14px] text-dim" role="status">Buscando los ejercicios planificados…</p>}
          {data && groups.length === 0 && katas.length === 0 && <p className="text-[14px] text-dim" data-testid="next-practice-empty">No hay más práctica planificada por ahora.</p>}
          {data && katas.length > 0 && (
            <section aria-label="Katas planeados" className="space-y-1.5" data-testid="next-practice-katas">
              <h4 className="text-[13px] font-semibold uppercase tracking-wider text-faint">Katas planeados</h4>
              <ul className="space-y-1.5">{katas.map((k) => <KataRow key={`${k.subplanId}:${k.date}`} k={k} day={day} busy={busy} dayText={dayText} onAdd={() => void addKata(k)} onOpen={() => void openKata(k)} />)}</ul>
            </section>
          )}
          {data &&
            groups.map(([subId, g]) => (
              <section key={subId} aria-label={g.name} className="space-y-3" data-testid="next-practice-area" data-area={subId}>
                <h4 className="text-[13px] font-semibold uppercase tracking-wider text-faint">{g.name}</h4>
                {[...g.topics.entries()].map(([folder, t]) => (
                  <div key={folder} className="space-y-1.5" data-testid="next-practice-topic" data-folder={folder}>
                    <p className="text-[13.5px] font-semibold text-text">{t.topic}</p>
                    <ul className="space-y-1.5">{t.rows.map((ex) => <ExerciseRow key={ex.rel} ex={ex} day={day} busy={busy} dayText={dayText} onAdd={() => void add(ex)} />)}</ul>
                  </div>
                ))}
              </section>
            ))}
        </Modal>
      )}
    </>
  );
}
