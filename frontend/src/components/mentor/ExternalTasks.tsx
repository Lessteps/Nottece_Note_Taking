// Mentor — «Tareas externas (N)»: las tareas para Antigravity / Claude Code guardadas en `.notevault/regenerar/*.json`, para REABRIRLAS tras reiniciar
// la app (copiar la instrucción otra vez, validar). Plegable y solo visible si hay alguna.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/bridge";
import type { RegenHandoff } from "../../lib/types";
import { useRegenEngine } from "../../store/regenEngine";
import { RegenHandoffPanel } from "./RegenHandoffPanel";

const WHAT: Record<RegenHandoff["what"], string> = { theory: "teoría", practice: "práctica", exercises: "ejercicios", all: "todo", "theory+practice": "teoría y práctica", "theory+exercises": "teoría y ejercicios", "practice+exercises": "práctica y ejercicios" };
const STATUS: Record<RegenHandoff["status"], string> = { waiting: "pendiente", failed: "pendiente (con errores)", validated: "validada", restored: "restaurada" };

export function ExternalTasks({ panel = false }: { panel?: boolean }) {
  const [saved, setSaved] = useState<RegenHandoff[]>([]);
  const [open, setOpen] = useState(panel);
  const live = useRegenEngine((s) => s.handoffs);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback((): void => {
    const fn = api.studyTopicRegenerateHandoffList;
    Promise.resolve(typeof fn === "function" ? fn() : [])
      .then((l) => Array.isArray(l) && setSaved(l))
      .catch(() => undefined);
  }, []);
  // al validar o crear una tarea, la lista se vuelve a leer
  const liveKey = Object.values(live).map((h) => `${h.id}:${h.status}`).join("|");
  useEffect(load, [load, liveKey]);

  // la copia en memoria (más reciente) manda sobre la guardada
  const tasks = saved.filter((h) => !hidden.has(h.id)).map((h) => live[h.id] ?? h);
  if (tasks.length === 0) return panel ? <p className="p-3 text-sm text-dim">No hay tareas de regeneración guardadas.</p> : null;
  const pending = tasks.filter((h) => h.status === "waiting" || h.status === "failed").length;
  return (
    <section className="rounded-xl border border-line bg-card" data-testid="external-tasks">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-1.5 px-3 text-left text-[13.5px] font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="external-tasks-toggle"
      >
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        Tareas externas ({tasks.length})
        {pending > 0 && <span className="font-normal text-dim"> · {pending} pendiente{pending === 1 ? "" : "s"} de Antigravity / Claude Code</span>}
      </button>
      {open && (
        <ul className="space-y-2 border-t border-line p-3" data-testid="external-tasks-list">
          {tasks.map((h) => (
            <li key={h.id} data-testid="external-task" data-status={h.status} className="space-y-1.5">
              <p className="text-[13px] text-dim">
                <strong className="text-text">{h.topics.length === 1 ? h.topics[0]!.title : `${h.topics.length} temas`}</strong> · {WHAT[h.what]} · <span data-testid="external-task-status">{STATUS[h.status]}</span> · {h.createdAt.slice(0, 16).replace("T", " ")}
              </p>
              <RegenHandoffPanel
                handoff={h}
                allowHidePending={!panel}
                onClose={() => setHidden((s) => new Set(s).add(h.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
