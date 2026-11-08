// Gestionar hábitos: the list (reorder, add, remove) and the editor.

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Habit } from "../../lib/types";
import { useHabits } from "../../store/habits";
import { cn, confirmAction, IconButton } from "../ui";
import { HabitFormFields } from "./HabitEditModal";
import { Header } from "./parts";

function Editor({ habit }: { habit: Habit }) {
  const remove = useHabits((s) => s.remove);
  const edit = useHabits((s) => s.edit);

  return (
    <aside className="flex w-[380px] flex-none flex-col border-l border-line bg-panel">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-line px-4">
        <span className="text-[18px]">{habit.icon}</span>
        <span className="truncate text-[13.5px] font-semibold text-text">{habit.name}</span>
        <IconButton title="Cerrar" onClick={() => edit(null)} className="ml-auto"><X size={15} /></IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <HabitFormFields habit={habit} />
      </div>
      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={async () => {
            if (await confirmAction("Eliminar hábito", `«${habit.name}» deja de aparecer. Los registros de días pasados se conservan.`, "Eliminar", true)) {
              void remove(habit.id);
            }
          }}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-danger hover:bg-danger-soft"
        >
          <Trash2 size={14} /> Eliminar hábito
        </button>
      </div>
    </aside>
  );
}

export function HabitManage() {
  const habits = useHabits((s) => s.habits);
  const editingId = useHabits((s) => s.editingId);
  const edit = useHabits((s) => s.edit);
  const add = useHabits((s) => s.add);
  const move = useHabits((s) => s.move);
  const editing = habits.find((h) => h.id === editingId);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title="Gestionar hábitos">
          <button
            type="button"
            onClick={() => void add()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-strong"
          >
            <Plus size={14} /> Nuevo hábito
          </button>
        </Header>
        <ul className="flex-1 space-y-1.5 overflow-y-auto p-6">
          {habits.map((h, i) => (
            <li
              key={h.id}
              className={cn(
                "group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5",
                h.id === editingId ? "border-accent" : "border-line",
              )}
            >
              <span className="h-6 w-1.5 rounded-full" style={{ background: h.colour || "var(--nv-line-strong)" }} />
              <button type="button" onClick={() => edit(h.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="w-6 text-center text-[16px]">{h.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-text">{h.name}</span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {h.schedule}{h.subtasks.length ? ` · ${h.subtasks.length} subtareas` : ""}{h.area ? ` · ${h.area}` : ""}
                  </span>
                </span>
              </button>
              <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <IconButton title="Editar" aria-label={`Editar ${h.name}`} onClick={() => edit(h.id)}><Pencil size={14} /></IconButton>
                <IconButton title="Subir" disabled={i === 0} onClick={() => void move(h.id, -1)}><ArrowUp size={14} /></IconButton>
                <IconButton title="Bajar" disabled={i === habits.length - 1} onClick={() => void move(h.id, 1)}><ArrowDown size={14} /></IconButton>
              </span>
            </li>
          ))}
          {!habits.length && <li className="text-[13px] text-faint">No hay hábitos. Crea uno con «Nuevo hábito».</li>}
        </ul>
      </div>
      {editing && <Editor key={editing.id} habit={editing} />}
    </div>
  );
}
