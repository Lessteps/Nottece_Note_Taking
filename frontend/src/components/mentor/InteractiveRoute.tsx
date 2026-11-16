import { BookOpen, Check, X, Dumbbell, Flag, Lock, Star, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardRow } from "./PlanBoard";
import { openTopic, openTopicNote } from "./openTopic";
import { cn } from "../ui";
import { useModuleVisible } from "../ModuleHost";

/** Un recorrido visual que utiliza los mismos temas y estados de la ruta del Mentor. */
export function InteractiveRoute({ area, rows, onInformative, routes }: { area: string; rows: readonly BoardRow[]; onInformative: () => void; routes?: { area: string; rows: readonly BoardRow[]; startDay?: number; nodeDays?: (number | undefined)[] }[] }) {
  const current = rows.find((r) => !r.done && !r.unlockOn) ?? rows.find((r) => !r.done) ?? rows[rows.length - 1];
  const [selectedPath, setSelectedPath] = useState(current?.folder ?? "");
  const selected = useMemo(() => (routes?.flatMap((p) => p.rows) ?? rows).find((r) => r.folder === selectedPath) ?? current, [rows, routes, selectedPath, current]);
  const rail = useRef<HTMLDivElement>(null);
  const currentNode = useRef<HTMLButtonElement>(null);
  const spaceHeld = useRef(false);
  const dragging = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const visible = useModuleVisible();
  useEffect(() => {
    window.nv?.setInteractiveRouteActive?.(visible);
    if (!visible) return;
    const unsubscribe = window.nv?.onInteractiveRouteZoom?.((action) => {
      setZoom((z) => action === "in" ? Math.min(2.5, +(z + .25).toFixed(2)) : Math.max(.25, +(z - .25).toFixed(2)));
    });
    return () => { unsubscribe?.(); window.nv?.setInteractiveRouteActive?.(false); };
  }, [visible]);
  useEffect(() => {
    const box = rail.current, node = currentNode.current;
    if (box && node && typeof box.scrollTo === "function") box.scrollTo({ left: Math.max(0, node.offsetLeft - box.clientWidth / 3), behavior: "auto" });
  }, [area]);
  const completed = rows.filter((r) => r.done).length;
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === "Space" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) { spaceHeld.current = true; event.preventDefault(); } };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") { spaceHeld.current = false; setIsPanning(false); dragging.current = null; } };
    const blur = () => { spaceHeld.current = false; setIsPanning(false); dragging.current = null; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  useEffect(() => {
    const onZoomKey = (event: KeyboardEvent) => {
      if (!visible || !event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
        event.preventDefault();
        setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)));
      } else if (event.key === "-" || event.key === "−" || event.code === "NumpadSubtract") {
        event.preventDefault();
        setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
      }
    };
    window.addEventListener("keydown", onZoomKey);
    return () => window.removeEventListener("keydown", onZoomKey);
  }, [visible]);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setZoom((z) => Math.min(2.5, Math.max(0.25, +(z + delta).toFixed(2))));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const isButton = (event.target as HTMLElement).closest("button");
    if (isButton && !spaceHeld.current) return;
    if (event.button !== 0 && event.button !== 1) return;
    const box = rail.current;
    if (!box) return;
    dragging.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
    setIsPanning(true);
    try {
      box.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  };
  const pan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current && rail.current) {
      rail.current.scrollLeft = dragging.current.left - (event.clientX - dragging.current.x);
      rail.current.scrollTop = dragging.current.top - (event.clientY - dragging.current.y);
    }
  };
  const endPan = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && rail.current) {
      try {
        if (rail.current.hasPointerCapture?.(event.pointerId)) {
          rail.current.releasePointerCapture?.(event.pointerId);
        }
      } catch {
        // ignore
      }
    }
    dragging.current = null;
    setIsPanning(false);
  };
  const paths = routes ?? [{ area, rows }];
  const allRows = paths.flatMap((path) => path.rows);
  const laneHeight = 300;
  const nodeWidth = 180;
  // La geometría muestra cuándo comienza cada camino según la agenda; no crea dependencias.
  const offsets: number[] = [];
  const branches: { fromX: number; fromY: number; toX: number; toY: number }[] = [];
  paths.forEach((path, index) => {
    if (index < 2 || path.startDay === undefined) { offsets.push(0); return; }
    let parent = -1, nodeIndex = -1, bestDay = -1;
    for (let lane = index - 1; lane < index; lane++) {
      paths[lane]?.nodeDays?.forEach((day, node) => {
        if (day !== undefined && day <= path.startDay! && day >= bestDay) { parent = lane; nodeIndex = node; bestDay = day; }
      });
    }
    if (parent < 0) { offsets.push(0); return; }
    const fromX = 48 + (offsets[parent] ?? 0) + nodeIndex * nodeWidth + nodeWidth / 2;
    const toX = fromX + nodeWidth;
    offsets.push(toX - 48 - nodeWidth / 2);
    branches.push({ fromX, fromY: 40 + parent * laneHeight + 102, toX, toY: 40 + index * laneHeight + 102 });
  });
  const canvasWidth = Math.max(700, ...paths.map((path, i) => (offsets[i] ?? 0) + path.rows.length * nodeWidth + 160));
  const canvasHeight = Math.max(400, paths.length * laneHeight + 80);

  return (
    <section className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-panel" data-testid="interactive-route">
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-card px-3 py-2"><div className="min-w-[130px] flex-1"><h2 className="font-bold text-text">Sincronía · {area}</h2><p className="text-xs text-dim">{completed} de {rows.length} temas completados · Arrastra para moverte</p></div><button type="button" onClick={onInformative} className="rounded-lg border border-line px-3 py-2 text-sm text-text">Ruta informativa</button><button type="button" onClick={() => setZoom(z => Math.max(.25, +(z - .25).toFixed(2)))} aria-label="Alejar" className="p-2"><ZoomOut size={18}/></button><button type="button" onClick={() => setZoom(1)} aria-label="Restablecer zoom" className="p-2"><Maximize2 size={18}/></button><button type="button" onClick={() => setZoom(z => Math.min(2.5, +(z + .25).toFixed(2)))} aria-label="Acercar" className="p-2"><ZoomIn size={18}/></button></header>
      {allRows.length === 0 ? <p className="p-28 text-dim">Esta área todavía no tiene temas en su ruta.</p> : <>
        <div ref={rail} tabIndex={0} role="region" aria-label={`Lienzo del recorrido de ${area}. Arrastra para desplazarte`} onPointerDown={startPan} onPointerMove={pan} onPointerUp={endPan} onPointerCancel={endPan} className={cn("relative min-h-0 flex-1 overflow-auto bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", isPanning ? "cursor-grabbing select-none" : "cursor-grab")} data-testid="route-rail">
          <div style={{ width: (canvasWidth + 128) * zoom, height: canvasHeight * zoom }}><div className="relative" style={{ width: canvasWidth + 128, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: "top left" }}><svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={canvasWidth + 128} height={canvasHeight}>{branches.map((branch, index) => <path key={index} d={`M ${branch.fromX} ${branch.fromY} C ${branch.fromX + 100} ${branch.fromY}, ${branch.toX - 100} ${branch.toY}, ${branch.toX} ${branch.toY}`} fill="none" stroke="var(--nv-accent)" strokeWidth="6" strokeOpacity=".7" />)}</svg>{paths.map((path, sectionIndex) => { const trackCurrent = path.rows.find((item) => !item.done && !item.unlockOn) ?? path.rows.find((item) => !item.done); return <section key={`${path.area}-${sectionIndex}`} className="absolute w-max text-left" style={{ left: 48 + (offsets[sectionIndex] ?? 0), top: 40 + sectionIndex * laneHeight }} aria-label={`Ruta de ${path.area}`}><h4 className="mb-3 inline-flex rounded-full border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-bold text-accent-text"><span className="mr-2 font-mono text-xs opacity-70">{String(sectionIndex + 1).padStart(2, "0")}</span>{path.area} · {path.rows.filter((row) => row.done).length}/{path.rows.length}</h4><ol className="flex w-max items-center py-4" aria-label={`Temas de ${path.area} en orden`}>
            {path.rows.map((row, index) => { const active = row.folder === selected?.folder; const isCurrent = row.folder === trackCurrent?.folder; const locked = !!row.unlockOn; const label = row.found === false ? "No creado todavía" : row.done ? "Completado" : locked ? "Bloqueado" : isCurrent ? "Continuar" : "Pendiente"; return <li key={row.folder} className="relative flex h-[156px] w-[180px] flex-none flex-col items-center text-center" data-testid="route-node" data-state={row.done ? "done" : locked ? "locked" : isCurrent ? "current" : "pending"}>
              {index < path.rows.length - 1 && <span aria-hidden className={cn("absolute left-1/2 top-[54px] h-1 w-full rounded-full", row.done ? "bg-accent" : "bg-line-strong")} />}<span className={cn("relative z-10 mb-2 min-h-5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide", row.found === false ? "text-danger" : isCurrent && !row.done ? "bg-accent-soft text-accent-text" : "text-faint")}>{row.title.match(/^2\.1\.3(?:\s|$)/) && row.found !== false ? "Aviso · " : ""}{label}</span>
              <button ref={row.folder === current?.folder ? currentNode : undefined} type="button" aria-pressed={active} aria-current={isCurrent ? "step" : undefined} aria-label={`${index + 1} de ${path.rows.length}: ${row.title}. ${label}${row.pct ? `, ${row.pct}% de avance` : ""}`} onClick={() => setSelectedPath(row.folder)} className={cn("relative z-10 grid h-16 w-16 place-items-center rounded-full border-4 shadow-sm transition-transform hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent", row.found === false ? "border-danger/60 bg-panel text-danger" : row.done ? "border-mint/50 bg-mint text-bg" : isCurrent && !locked ? "border-accent/45 bg-accent text-white" : "border-line-strong bg-panel text-faint", active && "ring-4 ring-accent/30")}>{row.found === false ? <X size={26} aria-hidden /> : row.done ? <Check size={26} strokeWidth={3} aria-hidden /> : locked ? <Lock size={22} aria-hidden /> : <Star size={25} fill="currentColor" aria-hidden />}</button><span className="mt-3 px-2 text-[12.5px] font-semibold leading-snug text-text">{row.title}{row.revisionAddedAt && <span className="ml-1 rounded bg-mint/10 px-1 text-[10px] text-mint">Nuevo</span>}</span><span className="mt-1 font-mono text-[10px] text-faint">{row.done ? "Completado" : `${Math.max(0, Math.min(100, row.pct ?? 0))}% de avance`}</span></li>; })}
          </ol></section>; })}</div></div>
        </div>
        {selected && <section className="relative z-20 flex max-h-[35%] shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-t border-line bg-card px-3 py-2" aria-live="polite" data-testid="route-selected">
          <span className="hidden h-10 w-10 flex-none sm:grid place-items-center rounded-2xl bg-accent-soft text-accent-text"><Flag size={22} aria-hidden /></span>
          <div className="min-w-0 flex-1 basis-40"><p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">Estación {allRows.findIndex((r) => r.folder === selected.folder) + 1} de {allRows.length}</p><h3 className="mt-1 break-words text-[17px] font-bold text-text">{selected.title}</h3><p className="mt-1 text-[13px] text-dim">{selected.unlockOn ? `Disponible cuando se complete la ruta anterior (${selected.unlockOn}).` : selected.done ? "Tema completado. Puedes repasarlo cuando quieras." : `${Math.max(0, Math.min(100, selected.pct ?? 0))}% de avance en este tema.`}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!!selected.unlockOn || selected.found === false} onClick={() => void openTopicNote(selected.folder)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[13px] font-semibold text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"><BookOpen size={16} aria-hidden /> Ver teoría</button><button type="button" disabled={!!selected.unlockOn || selected.found === false} onClick={() => void openTopic(selected.folder)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"><Dumbbell size={16} aria-hidden /> Practicar</button></div>
        </section>}
      </>}
    </section>
  );
}
