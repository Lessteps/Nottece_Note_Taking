import { BookOpen, Check, ChevronLeft, ChevronRight, Compass, Dumbbell, Flag, Lock, Map, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardRow } from "./PlanBoard";
import { openTopic, openTopicNote } from "./openTopic";
import { cn } from "../ui";

/** Un recorrido visual que utiliza los mismos temas y estados de la ruta del Mentor. */
export function InteractiveRoute({ area, rows, onInformative }: { area: string; rows: readonly BoardRow[]; onInformative: () => void }) {
  const current = rows.find((r) => !r.done && !r.unlockOn) ?? rows.find((r) => !r.done) ?? rows[rows.length - 1];
  const [selectedPath, setSelectedPath] = useState(current?.folder ?? "");
  const selected = useMemo(() => rows.find((r) => r.folder === selectedPath) ?? current, [rows, selectedPath, current]);
  const rail = useRef<HTMLDivElement>(null);
  const currentNode = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const box = rail.current, node = currentNode.current;
    if (box && node && typeof box.scrollTo === "function") box.scrollTo({ left: Math.max(0, node.offsetLeft - box.clientWidth / 3), behavior: "auto" });
  }, [area]);
  const completed = rows.filter((r) => r.done).length;
  const percentage = rows.length ? Math.round((completed / rows.length) * 100) : 0;
  const move = (direction: number) => {
    const box = rail.current;
    if (box && typeof box.scrollBy === "function") box.scrollBy({ left: direction * Math.max(240, box.clientWidth * 0.7), behavior: "smooth" });
  };
  return (
    <section className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 sm:px-6" data-testid="interactive-route">
      <header className="relative overflow-hidden rounded-3xl border border-accent/35 bg-accent-soft p-5 sm:p-7">
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 basis-72">
            <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-text"><Compass size={15} aria-hidden /> Sincronía · ruta interactiva</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-text sm:text-3xl">Tu ruta de {area}</h2>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-dim">Recorre los temas en orden. Selecciona una estación para abrir su teoría o su práctica y continuar donde lo dejaste.</p>
          </div>
          <button type="button" onClick={onInformative} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-accent/40 bg-card px-3 text-[13px] font-semibold text-accent-text hover:bg-hover"><Map size={16} aria-hidden /> Ruta informativa</button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px]"><strong className="text-text">{completed} de {rows.length} temas completados</strong><span className="h-2 min-w-[100px] max-w-[300px] flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent" style={{ width: `${percentage}%` }} /></span><span className="font-mono text-accent-text">{percentage}%</span></div>
      </header>
      {rows.length === 0 ? <div className="rounded-2xl border border-line bg-card p-6 text-dim">Esta área todavía no tiene temas en su ruta. Añádelos desde Planeación para comenzar.</div> : <>
        <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><h3 className="text-[17px] font-bold text-text">Tu recorrido</h3><p className="text-[13px] text-dim">{rows.length} estaciones · desplázate horizontalmente para explorar</p></div><button type="button" onClick={() => move(-1)} aria-label="Desplazar ruta a la izquierda" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-card text-text hover:bg-hover"><ChevronLeft size={19} /></button><button type="button" onClick={() => move(1)} aria-label="Desplazar ruta a la derecha" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-card text-text hover:bg-hover"><ChevronRight size={19} /></button></div>
        <div ref={rail} tabIndex={0} role="region" aria-label={`Recorrido de ${area}, desplazamiento horizontal`} className="overflow-x-auto rounded-2xl border border-line bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-testid="route-rail">
          <ol className="flex w-max min-w-full items-center px-5 py-8 sm:px-8" aria-label="Temas en orden">
            {rows.map((row, index) => {
              const active = row.folder === selected?.folder; const isCurrent = row.folder === current?.folder; const locked = !!row.unlockOn;
              const label = row.done ? "Completado" : locked ? "Bloqueado" : isCurrent ? "Continuar" : "Pendiente";
              return <li key={row.folder} className="relative flex w-[176px] flex-none flex-col items-center text-center" data-testid="route-node" data-state={row.done ? "done" : locked ? "locked" : isCurrent ? "current" : "pending"}>
                {index < rows.length - 1 && <span aria-hidden className="absolute left-1/2 top-[44px] h-1 w-full rounded-full bg-line-strong" />}
                <span className={cn("relative z-10 mb-2 min-h-5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide", isCurrent && !row.done ? "bg-accent-soft text-accent-text" : "text-faint")}>{label}</span>
                <button ref={isCurrent ? currentNode : undefined} type="button" aria-pressed={active} aria-current={isCurrent ? "step" : undefined} aria-label={`${index + 1} de ${rows.length}: ${row.title}. ${label}${row.pct ? `, ${row.pct}% de avance` : ""}`} onClick={() => setSelectedPath(row.folder)} className={cn("relative z-10 grid h-16 w-16 place-items-center rounded-full border-4 shadow-sm transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent", row.done ? "border-mint/50 bg-mint text-bg" : isCurrent && !locked ? "border-accent/45 bg-accent text-white" : "border-line-strong bg-panel text-faint", active && "ring-4 ring-accent/30")}>
                  {row.done ? <Check size={26} strokeWidth={3} aria-hidden /> : locked ? <Lock size={22} aria-hidden /> : <Star size={25} fill="currentColor" aria-hidden />}
                </button>
                <span className="mt-3 px-2 text-[12.5px] font-semibold leading-snug text-text">{row.title}</span><span className="mt-1 font-mono text-[10px] text-faint">{row.done ? "Completado" : `${Math.max(0, Math.min(100, row.pct ?? 0))}% de avance`}</span>
              </li>;
            })}
          </ol>
        </div>
        {selected && <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-card p-5" aria-live="polite" data-testid="route-selected">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-accent-soft text-accent-text"><Flag size={22} aria-hidden /></span>
          <div className="min-w-0 flex-1 basis-64"><p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">Estación {rows.findIndex((r) => r.folder === selected.folder) + 1} de {rows.length}</p><h3 className="mt-1 break-words text-[17px] font-bold text-text">{selected.title}</h3><p className="mt-1 text-[13px] text-dim">{selected.unlockOn ? `Disponible cuando se complete la ruta anterior (${selected.unlockOn}).` : selected.done ? "Tema completado. Puedes repasarlo cuando quieras." : `${Math.max(0, Math.min(100, selected.pct ?? 0))}% de avance en este tema.`}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!!selected.unlockOn} onClick={() => void openTopicNote(selected.folder)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[13px] font-semibold text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"><BookOpen size={16} aria-hidden /> Ver teoría</button><button type="button" disabled={!!selected.unlockOn} onClick={() => void openTopic(selected.folder)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"><Dumbbell size={16} aria-hidden /> Practicar</button></div>
        </section>}
      </>}
    </section>
  );
}
