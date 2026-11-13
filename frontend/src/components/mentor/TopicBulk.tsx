// Mentor — «Temas por área»: regeneración en LOTE. Una barra de acciones (siempre visible) sobre la tabla, el diálogo de confirmación que dice
// qué se reemplaza y cuánto cuesta, y la cola que regenera los temas elegidos DE UNO EN UNO (un trabajo `study_topic_regenerate` cada vez; el
// turno de generación es compartido). Un fallo no aborta la cola; se puede parar entre temas y al final hay un resumen por tema.

import { BookOpen, ChevronDown, CircleHelp, ClipboardList, Dumbbell, FolderInput, Loader2, Map as MapIcon, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import type { AreaTopicRow } from "../../lib/planAreaTopics";
import { LABEL, OBJECT, SHORT, kindOfChecks, mapAlone, partsOf, regenBlockedReason, type BulkPlan, type RegenKind, type RegenPart, type SingleRegen } from "../../lib/topicSelection";
import { useApp } from "../../store/app";
import { useRegenEngine } from "../../store/regenEngine";
import { GhostButton, Modal, PrimaryButton } from "../common/forms";
import { cn } from "../ui";
import { RegenEngineChoice } from "./RegenEngineChoice";
import { RegenHandoffPanel } from "./RegenHandoffPanel";
import { runRegeneration } from "./TopicRegenerate";

export type ItemState = "pending" | "running" | "ok" | "error" | "cancelled";
export interface QueueItem {
  folder: string;
  title: string;
  state: ItemState;
  error?: string;
  /** última línea del registro del trabajo */
  note?: string;
}
export interface QueueState {
  what: RegenKind;
  items: QueueItem[];
  running: boolean;
  stopping: boolean;
  /** con el motor «agente externo»: la tarea creada para todo el lote (no hay cola que seguir) */
  handoffId?: string;
}

/** La cola: lanza `runRegeneration` tema a tema. Vive en el componente, pero el bucle no depende de que siga montado. */
export function useRegenQueue(onTopicDone?: () => void) {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (folder: string, p: Partial<QueueItem>): void => {
    if (alive.current) setQueue((q) => (q ? { ...q, items: q.items.map((i) => (i.folder === folder ? { ...i, ...p } : i)) } : q));
  };

  const start = async (what: RegenKind, rows: ReadonlyArray<Pick<AreaTopicRow, "folder" | "title">>, opts: { /** rehacer también el mapa sin la teoría (no usa IA: se hace aquí, antes) */ alsoMap?: boolean } = {}): Promise<void> => {
    stop.current = false;
    const engine = what === "map" ? "app" : useRegenEngine.getState().effective;
    if (opts.alsoMap && what !== "map") {
      for (const r of rows) {
        try {
          const result = await runRegeneration(r.folder, "map", undefined, { quiet: true, engine: "app" });
          if (result.error) throw new Error(result.error);
        } catch (e) {
          useApp.getState().toast("error", `No se pudo regenerar el mapa de «${r.title}»: ${(e as Error).message}. No se inició el resto del lote.`);
          return;
        }
      }
    }
    if (engine === "handoff") {
      // sin IA de la app: UNA tarea con todos los temas; la validación la pide la persona cuando el agente termina
      try {
        const h = await api.studyTopicRegenerateHandoff(rows.map((r) => r.folder), what as Exclude<RegenKind, "map">, true);
        useRegenEngine.getState().putHandoff(h);
        if (alive.current) setQueue({ what, items: [], running: false, stopping: false, handoffId: h.id });
        useApp.getState().toast("info", `Tarea creada con ${rows.length} ${rows.length === 1 ? "tema" : "temas"}. Pásasela a tu agente y, cuando termine, pulsa «Ya terminó — validar».`);
      } catch (e) {
        useApp.getState().toast("error", (e as Error).message);
      }
      return;
    }
    const items: QueueItem[] = rows.map((r) => ({ folder: r.folder, title: r.title, state: "pending" }));
    setQueue({ what, items, running: true, stopping: false });
    let ok = 0;
    let bad = 0;
    let left = 0;
    for (const r of rows) {
      if (stop.current) {
        left++;
        patch(r.folder, { state: "cancelled" });
        continue;
      }
      patch(r.folder, { state: "running", note: "Empezando…" });
      try {
        // una combinación (teoría + práctica…) se hace pieza a pieza, en orden; si una falla no se sigue con las siguientes de ese tema
        const steps = (what === "all" || what === "map" || !what.includes("+") ? [what] : partsOf(what)) as SingleRegen[];
        let st = await runRegeneration(r.folder, steps[0]!, (j) => patch(r.folder, { note: j.log[j.log.length - 1] ?? "Trabajando…" }), { quiet: true, engine });
        for (const next of steps.slice(1)) {
          if (st.error) break;
          st = await runRegeneration(r.folder, next, (j) => patch(r.folder, { note: j.log[j.log.length - 1] ?? "Trabajando…" }), { quiet: true, engine });
        }
        if (st.error) {
          bad++;
          patch(r.folder, { state: "error", error: st.error });
        } else {
          ok++;
          patch(r.folder, { state: "ok" });
        }
      } catch (e) {
        bad++;
        patch(r.folder, { state: "error", error: (e as Error).message });
      }
      onTopicDone?.();
    }
    if (alive.current) setQueue((q) => (q ? { ...q, running: false } : q));
    useApp.getState().toast(bad ? "error" : "info", `${LABEL[what]}: ${ok} bien${bad ? `, ${bad} con error` : ""}${left ? `, ${left} sin hacer` : ""}.`);
  };
  return {
    queue,
    start,
    stop: (): void => {
      stop.current = true;
      setQueue((q) => (q ? { ...q, stopping: true } : q));
    },
    dismiss: (): void => setQueue(null),
  };
}

/** Las casillas de la barra: lo marcado se regenera JUNTO (un solo prompt si el motor es un agente externo). */
const CHECKS: ReadonlyArray<{ part: RegenPart; text: string; hint: string }> = [
  { part: "theory", text: "Teoría", hint: "La nota. Con ella se rehace el mapa solo." },
  { part: "map", text: "Mapa", hint: "Sin IA: se construye de la nota que ya existe." },
  { part: "practice", text: "Práctica", hint: "El plan .practica: qué competencias se ejercitan." },
  { part: "exercises", text: "Ejercicios", hint: "Las preguntas, a partir de la práctica." },
];

export type SelectHelper = "all" | "missing" | "noExercises" | "outdated" | "clear";

/** Barra de acciones sobre la tabla: siempre visible; sin selección, con los botones desactivados y una pista. */
export function BulkToolbar({ count, busy, onAsk, onGenerateMissing, onHelper, groups, onMoveGroup }: {
  count: number;
  busy: boolean;
  /** `alsoMap`: se marcó el mapa junto a otras piezas pero sin la teoría */
  onAsk: (what: RegenKind, alsoMap: boolean) => void;
  onGenerateMissing: () => void;
  onHelper: (h: SelectHelper) => void;
  groups?: ReadonlyArray<{ id: string; title: string }>;
  onMoveGroup?: (groupId: string, newGroupTitle?: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [moveMenu, setMoveMenu] = useState(false);
  const [showRegenHelp, setShowRegenHelp] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<RegenPart>>(new Set());
  const kind = kindOfChecks(checked);
  const toggle = (p: RegenPart): void => setChecked((c) => { const n = new Set(c); if (!n.delete(p)) n.add(p); return n; });
  const off = count === 0 || busy;
  const why = busy ? "Hay una regeneración en curso." : count === 0 ? "Selecciona temas para regenerar" : "";
  const helpers: ReadonlyArray<{ key: SelectHelper; text: string }> = [
    { key: "all", text: "Seleccionar todos" },
    { key: "missing", text: "Solo los que faltan" },
    { key: "noExercises", text: "Solo sin ejercicios" },
    { key: "outdated", text: "Solo desactualizados" },
    { key: "clear", text: "Limpiar" },
  ];
  return (
    <div className={cn("@3xl:sticky @3xl:top-0 @3xl:z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2", count ? "border-accent" : "border-line")} role="toolbar" aria-label="Acciones sobre los temas seleccionados" data-testid="bulk-bar">
      <span className="text-[13.5px] font-semibold" aria-live="polite" data-testid="bulk-count">
        {count === 0 ? <span className="font-normal text-dim">Selecciona temas para regenerar</span> : `${count} ${count === 1 ? "tema seleccionado" : "temas seleccionados"}`}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Explicar regenerar práctica y ejercicios" aria-expanded={showRegenHelp} onClick={() => setShowRegenHelp((v) => !v)} className="grid h-7 w-7 flex-none place-items-center rounded-md text-dim hover:bg-hover hover:text-text" data-testid="bulk-regen-help"><CircleHelp size={16} aria-hidden /></button>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="Qué regenerar" data-testid="bulk-checks">
          {CHECKS.map((c) => (
            <label key={c.part} className="inline-flex cursor-pointer items-center gap-1.5 text-[13.5px]" title={c.hint}>
              <input
                type="checkbox"
                checked={checked.has(c.part) || (c.part === "map" && checked.has("theory"))}
                disabled={busy || (c.part === "map" && checked.has("theory"))}
                onChange={() => toggle(c.part)}
                data-testid={`bulk-check-${c.part}`}
                className="h-4 w-4 accent-[var(--nv-accent)]"
              />
              {c.text}
            </label>
          ))}
        </span>
        <GhostButton
          onClick={() => kind ? onAsk(kind, mapAlone(checked)) : onGenerateMissing()}
          disabled={off}
          title={why || (!kind ? "Genera lo que falta en los temas seleccionados" : "Respalda lo actual y lo reemplaza; lo marcado se hace junto")}
          data-testid="bulk-regen"
        >
          <RefreshCw size={14} aria-hidden /> {kind ? LABEL[kind] : "Generar lo que falta"}
        </GhostButton>
        <GhostButton onClick={onGenerateMissing} disabled={off} title={why || "Crea lo que falta de los temas elegidos (no toca lo que ya existe)"} data-testid="bulk-missing">
          <Sparkles size={14} aria-hidden /> Generar lo que falta
        </GhostButton>
        {onMoveGroup && groups && groups.length > 0 && (
          <span className="relative">
            <GhostButton
              onClick={() => setMoveMenu((m) => !m)}
              disabled={off}
              aria-expanded={moveMenu}
              title={why || "Mueve los temas seleccionados a otra asignatura"}
              data-testid="bulk-move-group-btn"
            >
              <FolderInput size={14} aria-hidden /> Mover a asignatura <ChevronDown size={14} aria-hidden />
            </GhostButton>
            {moveMenu && (
              <ul role="menu" className="absolute left-0 z-20 mt-1 min-w-56 rounded-lg border border-line bg-card p-1 shadow-lg" data-testid="bulk-move-group-list">
                {groups.filter((g) => g.id !== "" && g.id !== "__otros").map((g) => (
                  <li key={g.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded-md px-3 py-1.5 text-left text-[13.5px] hover:bg-hover"
                      onClick={() => {
                        setMoveMenu(false);
                        onMoveGroup(g.id);
                      }}
                    >
                      {g.title}
                    </button>
                  </li>
                ))}
                <li role="none" className="my-1 border-t border-line" />
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-[13.5px] font-medium text-accent hover:bg-hover"
                    onClick={() => {
                      setMoveMenu(false);
                      const name = window.prompt("Nombre de la nueva asignatura (ej: Python, FastAPI):");
                      if (name && name.trim()) {
                        onMoveGroup("__new", name.trim());
                      }
                    }}
                  >
                    <Plus size={13} aria-hidden /> + Crear nueva asignatura...
                  </button>
                </li>
              </ul>
            )}
          </span>
        )}
      </span>
      {showRegenHelp && <p role="note" className="basis-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-dim" data-testid="bulk-regen-explanation"><strong className="text-text">Práctica</strong> regenera el plan de competencias y la cantidad por dificultad. <strong className="text-text">Ejercicios</strong> crea los enunciados, pistas, soluciones y rúbricas según ese plan. Al regenerar, se reemplaza el contenido seleccionado y se conserva una copia de respaldo; «Generar lo que falta» solo crea piezas ausentes.</p>}
      <span className="relative ml-auto">
        <GhostButton onClick={() => setMenu((m) => !m)} aria-expanded={menu} data-testid="bulk-select-menu" title="Elegir temas de un golpe">
          Selección <ChevronDown size={14} aria-hidden />
        </GhostButton>
        {menu && (
          <ul role="menu" className="absolute right-0 z-20 mt-1 min-w-48 rounded-lg border border-line bg-card p-1 shadow-lg" data-testid="bulk-select-list">
            {helpers.map((h) => (
              <li key={h.key} role="none">
                <button type="button" role="menuitem" className="w-full rounded-md px-3 py-1.5 text-left text-[13.5px] hover:bg-hover" data-testid={`sel-${h.key}`} onClick={() => { setMenu(false); onHelper(h.key); }}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </span>
    </div>
  );
}

/** Los cuatro iconos de acciones rápidas de una fila (siempre visibles). */
const QUICK: ReadonlyArray<{ what: RegenPart; Icon: typeof BookOpen }> = [
  { what: "theory", Icon: BookOpen },
  { what: "map", Icon: MapIcon },
  { what: "practice", Icon: ClipboardList },
  { what: "exercises", Icon: Dumbbell },
];

export function RowQuickActions({ row, busy, onAsk }: { row: AreaTopicRow; busy: boolean; onAsk: (what: RegenKind, row: AreaTopicRow) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="row-quick">
      {QUICK.map(({ what, Icon }) => {
        const why = busy ? "Hay una regeneración en curso." : regenBlockedReason(row, what);
        return (
          <button
            key={what}
            type="button"
            disabled={!!why}
            onClick={() => onAsk(what, row)}
            title={why || `${LABEL[what]}: respalda lo actual y lo reemplaza`}
            aria-label={`${LABEL[what]} de ${row.title}`}
            data-testid={`quick-${what}`}
            className="inline-grid h-8 w-8 place-items-center rounded-md text-dim hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon size={16} aria-hidden />
          </button>
        );
      })}
    </span>
  );
}

/** Diálogo de confirmación del lote: qué se regenera, en cuántos temas, cuántas llamadas a la IA y dónde queda la copia. */
export function BulkConfirm({ plan, onCancel, onConfirm }: { plan: BulkPlan; onCancel: () => void; onConfirm: () => void }) {
  const { what, run, skipped, aiCalls } = plan;
  const shown = run.slice(0, 8);
  const effective = useRegenEngine((s) => s.effective);
  return (
    <Modal
      title={LABEL[what]}
      onClose={onCancel}
      width={560}
      footer={
        <>
          <span className="flex-1" />
          <GhostButton onClick={onCancel} data-testid="bulk-confirm-cancel">Cancelar</GhostButton>
          <PrimaryButton onClick={onConfirm} disabled={run.length === 0} data-testid="bulk-confirm-run">{what !== "map" && effective === "handoff" ? "Crear tarea para el agente" : LABEL[what]}{run.length > 1 ? ` (${run.length})` : ""}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-3 text-[14px]" data-testid="bulk-confirm">
        <p className="font-semibold" data-testid="bulk-confirm-lead">
          {run.length === 0 ? "Ninguno de los temas elegidos se puede regenerar." : `Se va a REEMPLAZAR ${what === "all" ? "todo lo generado (teoría y mapa, práctica y ejercicios)" : OBJECT[what]} de ${run.length} ${run.length === 1 ? "tema" : "temas"}, uno detrás de otro.`}
        </p>
        {run.length > 0 && (
          <>
            <ul className="list-disc space-y-0.5 pl-5" data-testid="bulk-confirm-topics">
              {shown.map((r) => <li key={r.folder}>{r.title}</li>)}
              {run.length > shown.length && <li className="text-dim">y {run.length - shown.length} más</li>}
            </ul>
            {what === "map" ? (
              <p data-testid="bulk-confirm-calls">No usa la IA: el mapa se construye de la teoría que ya existe.</p>
            ) : (
              <>
                <p data-testid="bulk-confirm-calls">{effective === "handoff" ? <>Generaciones aproximadas que hará tu agente: <strong>{aiCalls}</strong>. La app no llama a la IA.</> : <>Llamadas a la IA aproximadas: <strong>{aiCalls}</strong> (cada una puede tardar un minuto).</>}</p>
                <RegenEngineChoice aiCalls={aiCalls} />
              </>
            )}
            <p className="text-dim" data-testid="bulk-confirm-backup">
              Antes de tocar cada tema se respalda lo que existe en la carpeta <code>.trash/regenerar</code> de tu vault (los ejercicios se archivan, no se borran) y, si un tema falla, se restaura. Un fallo no detiene a los demás y puedes parar la cola entre temas.
            </p>
          </>
        )}
        {skipped.length > 0 && (
          <div data-testid="bulk-confirm-skipped">
            <p className="font-medium text-warn">Se omiten {skipped.length}:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-dim">
              {skipped.slice(0, 6).map((s) => <li key={s.row.folder}>{s.row.title}: {s.reason}</li>)}
              {skipped.length > 6 && <li>y {skipped.length - 6} más</li>}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Progreso de la cola y, al terminar, el resumen por tema. */
export function BulkProgress({ queue, onStop, onClose }: { queue: QueueState; onStop: () => void; onClose: () => void }) {
  const { items, running, stopping, what } = queue;
  const handoff = useRegenEngine((s) => (queue.handoffId ? s.handoffs[queue.handoffId] : undefined));
  if (queue.handoffId) {
    return handoff ? <RegenHandoffPanel handoff={handoff} onClose={onClose} /> : null;
  }
  const done = items.filter((i) => i.state === "ok" || i.state === "error" || i.state === "cancelled").length;
  const cur = items.find((i) => i.state === "running");
  const failed = items.filter((i) => i.state === "error");
  const cancelled = items.filter((i) => i.state === "cancelled").length;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-[13.5px]" role="status" data-testid="bulk-progress">
      {running ? (
        <div className="flex flex-wrap items-center gap-2">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          <span className="min-w-0 flex-1" data-testid="bulk-progress-line">
            {Math.min(done + 1, items.length)}/{items.length} · {cur?.title ?? "…"} · {SHORT[what]}… {cur?.note && <span className="text-dim">{cur.note}</span>}
          </span>
          <GhostButton onClick={onStop} disabled={stopping} data-testid="bulk-stop">{stopping ? "Parando tras este tema…" : "Detener la cola"}</GhostButton>
        </div>
      ) : (
        <div className="space-y-2" data-testid="bulk-summary">
          <p className="font-semibold">
            {LABEL[what]}: {items.filter((i) => i.state === "ok").length} bien{failed.length ? `, ${failed.length} con error` : ""}
            {cancelled ? `, ${cancelled} sin hacer (cola detenida)` : ""}.
          </p>
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li key={i.folder} data-testid="bulk-summary-item" data-state={i.state} className={i.state === "error" ? "text-warn" : i.state === "ok" ? "text-mint" : "text-dim"}>
                {i.state === "ok" ? "✓" : i.state === "error" ? "✗" : "–"} {i.title}{i.error ? `: ${i.error}` : i.state === "cancelled" ? " (sin hacer)" : ""}
              </li>
            ))}
          </ul>
          <GhostButton onClick={onClose} data-testid="bulk-summary-close">Cerrar</GhostButton>
        </div>
      )}
    </div>
  );
}
