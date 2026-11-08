// What a click on a calendar block does: open the editor for events,
// routines and tasks; a small menu (tick / open the module) for the rest.
// Integrated blocks open their composite events & subject topic navigator.
// Right-click provides context menus to add, hide, or delete events.

import {
  Check,
  CheckSquare,
  ExternalLink,
  EyeOff,
  Layers,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "../../lib/bridge";
import type { Occurrence } from "../../lib/types";
import { useApp, type ModuleId } from "../../store/app";
import { useCalendar } from "../../store/calendar";
import { openMenu, type MenuItem } from "../ui";

const MODULE_OF: Record<string, [ModuleId, string]> = {
  metas: ["metas", "Metas"],
  proyectos: ["proyectos", "Proyectos"],
  finanzas: ["finanzas", "Finanzas"],
  habit: ["habits", "Hábitos"],
  exercise: ["ejercicio", "Ejercicio"],
  project: ["proyectos", "Proyectos"],
  mentor: ["mentor", "Mentor"],
  mentor_study: ["mentor", "Mentor"],
  integrated_block: ["mentor", "Mentor"],
};

export function isIntegratedBlock(occ: Occurrence): boolean {
  if (occ.kind === "integrated_block") return true;
  if (occ.id.startsWith("mentor:block:") || occ.id.startsWith("integrated:")) return true;
  if (occ.links?.some((l) => l.type === "integrated_block" || l.type === "mentor_day")) return true;
  const title = (occ.title || "").toLowerCase();
  if (title.includes("bloque integrado")) return true;
  if (
    (occ.source === "mentor" || occ.kind === "mentor_study") &&
    (title.includes("backend") || title.includes("frontend") || title.includes("estudio") || title.includes("desarrollo"))
  )
    return true;
  return false;
}

export function getHabitIdFromOcc(occ: Occurrence): string | null {
  const link = occ.links?.find((l) => l.type === "habit" || l.type === "habits");
  if (link && link.id) return String(link.id);
  if (occ.id.startsWith("habit:")) {
    const raw = occ.id.slice("habit:".length);
    return raw.split("_")[0] || null;
  }
  return null;
}

export function getExerciseIdFromOcc(occ: Occurrence): string | null {
  if (occ.id.startsWith("ex_")) {
    const parts = occ.id.slice(3).split("_");
    if (parts.length >= 2) {
      return `${parts[0]}_${parts[1]}`;
    }
  }
  return null;
}

export async function removeOccurrenceOrHideHabit(occ: Occurrence): Promise<void> {
  const cal = useCalendar.getState();
  const app = useApp.getState();

  // 1. Hábito: Desactivar casilla 'Mostrar en calendario' sin borrar el hábito
  const habitId = getHabitIdFromOcc(occ);
  if (habitId) {
    try {
      await api.habitsUpdate(habitId, { in_calendar: false });
      await cal.load();
      app.toast("info", `Hábito «${occ.title}» quitado del calendario (se mantiene en tus hábitos)`);
    } catch (e) {
      app.toast("error", `Error al ocultar hábito: ${(e as Error).message}`);
    }
    return;
  }

  // 2. Ejercicio de rutina de gimnasio
  const exerciseId = getExerciseIdFromOcc(occ);
  if (exerciseId || occ.source === "exercise" || occ.kind === "exercise") {
    try {
      const habits = await api.habitsList();
      const gym = habits.find((h) => h.id === "gym");
      if (gym && exerciseId) {
        const schedules = { ...(gym.exercise_schedules || {}) };
        if (schedules[exerciseId]) {
          schedules[exerciseId] = { ...schedules[exerciseId], in_calendar: false };
          await api.habitsUpdate("gym", { exercise_schedules: schedules });
          await cal.load();
          app.toast("info", `Ejercicio quitado del calendario`);
          return;
        }
      }
    } catch {
      // fallback
    }
  }

  // 3. Evento normal
  if (occ.kind === "event") {
    try {
      await api.calDelete({ kind: "event", id: occ.id, date: occ.date }, "all");
      await cal.load();
      app.toast("info", `Evento «${occ.title}» eliminado`);
    } catch (e) {
      app.toast("error", `Error al eliminar evento: ${(e as Error).message}`);
    }
    return;
  }

  // 4. Rutina
  if (occ.kind === "routine") {
    try {
      await api.calDelete({ kind: "routine", id: occ.id, date: occ.date }, "all");
      await cal.load();
      app.toast("info", `Rutina «${occ.title}» eliminada`);
    } catch (e) {
      app.toast("error", `Error al eliminar rutina: ${(e as Error).message}`);
    }
    return;
  }

  // 5. Tarea
  if (occ.kind === "task") {
    try {
      await api.tasksDelete(occ.id);
      await cal.load();
      app.toast("info", `Tarea «${occ.title}» eliminada`);
    } catch (e) {
      app.toast("error", `Error al eliminar tarea: ${(e as Error).message}`);
    }
    return;
  }

  // 6. Metas / Goal item
  if (occ.source === "metas" || occ.kind === "goal_item") {
    const goalLink = occ.links?.find((l) => l.type === "goal");
    if (goalLink && goalLink.id) {
      try {
        if (goalLink.item) {
          await api.goalItemUpdate(String(goalLink.id), String(goalLink.item), { in_calendar: false });
        } else {
          await api.goalsUpdate(String(goalLink.id), { in_overview: false });
        }
        await cal.load();
        app.toast("info", `Meta quitada del calendario`);
        return;
      } catch (e) {
        app.toast("error", `Error al ocultar meta: ${(e as Error).message}`);
      }
    }
  }
}

export function activate(occ: Occurrence, e: { clientX: number; clientY: number; preventDefault: () => void }) {
  const cal = useCalendar.getState();

  if (isIntegratedBlock(occ)) {
    cal.openIntegratedBlock(occ);
    return;
  }

  if (occ.kind === "event" || occ.kind === "routine" || occ.kind === "task") {
    void cal.openEdit(occ);
    return;
  }

  const items: MenuItem[] = [];
  if (occ.checkable) {
    items.push(
      occ.done
        ? { label: "Desmarcar", icon: <Undo2 />, onSelect: () => void cal.setDone(occ, false) }
        : { label: "Marcar como hecho", icon: <Check />, onSelect: () => void cal.setDone(occ, true) }
    );
  }

  const habitId = getHabitIdFromOcc(occ);
  if (habitId) {
    items.push({
      label: "Quitar del calendario",
      description: "Desactiva la casilla de mostrar en calendario",
      icon: <EyeOff />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
  }

  const exerciseId = getExerciseIdFromOcc(occ);
  if (exerciseId) {
    items.push({
      label: "Quitar del calendario",
      description: "Oculta el ejercicio del calendario",
      icon: <EyeOff />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
  }

  const target = MODULE_OF[occ.source] ?? MODULE_OF[occ.kind];
  if (target) {
    items.push({
      label: occ.id.startsWith("habit:") ? "Editar hábito…" : `Abrir en ${target[1]}`,
      icon: occ.id.startsWith("habit:") ? <Pencil /> : <ExternalLink />,
      onSelect: () => useApp.getState().setModule(target[0]),
    });
  }
  if (items.length) openMenu(e, items);
}

export function openOccurrenceContextMenu(
  occ: Occurrence,
  e: { clientX: number; clientY: number; preventDefault: () => void }
) {
  const cal = useCalendar.getState();
  const app = useApp.getState();
  const items: MenuItem[] = [];

  // Marcar / desmarcar si es checkable
  if (occ.checkable) {
    items.push(
      occ.done
        ? { label: "Desmarcar", icon: <Undo2 />, onSelect: () => void cal.setDone(occ, false) }
        : { label: "Marcar como hecho", icon: <Check />, onSelect: () => void cal.setDone(occ, true) }
    );
  }

  // 1. Bloque integrado
  if (isIntegratedBlock(occ)) {
    items.push({
      label: "Ver asignaturas y temas…",
      icon: <Layers />,
      onSelect: () => cal.openIntegratedBlock(occ),
    });
    items.push({
      label: "Ir a Mentor",
      icon: <ExternalLink />,
      onSelect: () => app.setModule("mentor"),
    });
    openMenu(e, items);
    return;
  }

  // 2. Hábito
  const habitId = getHabitIdFromOcc(occ);
  if (habitId) {
    items.push({
      label: "Quitar del calendario",
      description: "Desactiva 'Mostrar en calendario' sin borrar el hábito",
      icon: <EyeOff />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    items.push({
      label: "Ir a Hábitos",
      icon: <ExternalLink />,
      onSelect: () => app.setModule("habits"),
    });
    openMenu(e, items);
    return;
  }

  // 3. Ejercicio
  const exerciseId = getExerciseIdFromOcc(occ);
  if (exerciseId || occ.source === "exercise" || occ.kind === "exercise") {
    items.push({
      label: "Quitar del calendario",
      description: "Oculta este ejercicio del calendario",
      icon: <EyeOff />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    items.push({
      label: "Ir a Ejercicio",
      icon: <ExternalLink />,
      onSelect: () => app.setModule("ejercicio"),
    });
    openMenu(e, items);
    return;
  }

  // 4. Evento
  if (occ.kind === "event") {
    items.push({
      label: "Editar evento…",
      icon: <Pencil />,
      onSelect: () => void cal.openEdit(occ),
    });
    items.push({
      label: "Borrar evento",
      icon: <Trash2 />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    openMenu(e, items);
    return;
  }

  // 5. Rutina
  if (occ.kind === "routine") {
    items.push({
      label: "Editar rutina…",
      icon: <Pencil />,
      onSelect: () => void cal.openEdit(occ),
    });
    items.push({
      label: "Eliminar esta repetición",
      icon: <Trash2 />,
      onSelect: async () => {
        try {
          await api.calDelete({ kind: "routine", id: occ.id, date: occ.date }, "one");
          await cal.load();
          app.toast("info", "Repetición eliminada");
        } catch (err) {
          app.toast("error", (err as Error).message);
        }
      },
    });
    items.push({
      label: "Eliminar toda la rutina",
      icon: <Trash2 />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    openMenu(e, items);
    return;
  }

  // 6. Tarea
  if (occ.kind === "task") {
    items.push({
      label: "Editar tarea…",
      icon: <Pencil />,
      onSelect: () => void cal.openEdit(occ),
    });
    items.push({
      label: "Borrar tarea",
      icon: <Trash2 />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    openMenu(e, items);
    return;
  }

  // 7. Meta / Goal item
  if (occ.source === "metas" || occ.kind === "goal_item") {
    items.push({
      label: "Quitar del calendario",
      icon: <EyeOff />,
      onSelect: () => void removeOccurrenceOrHideHabit(occ),
    });
    items.push({
      label: "Ir a Metas",
      icon: <ExternalLink />,
      onSelect: () => app.setModule("metas"),
    });
    openMenu(e, items);
    return;
  }

  // Fallback
  const target = MODULE_OF[occ.source] ?? MODULE_OF[occ.kind];
  if (target) {
    items.push({
      label: `Abrir en ${target[1]}`,
      icon: <ExternalLink />,
      onSelect: () => app.setModule(target[0]),
    });
  }
  if (items.length) openMenu(e, items);
}

export function openSlotContextMenu(
  day: string,
  minute: number | null,
  e: { clientX: number; clientY: number; preventDefault: () => void },
  defaultDuration = 60
) {
  const cal = useCalendar.getState();
  const startMin = minute !== null ? Math.max(0, Math.min(24 * 60 - 15, minute)) : null;
  const endMin = startMin !== null ? Math.min(24 * 60, startMin + defaultDuration) : null;

  const items: MenuItem[] = [
    {
      label: "Añadir evento",
      icon: <Plus />,
      onSelect: () => cal.openCreate(day, startMin, endMin, "event"),
    },
    {
      label: "Añadir tarea",
      icon: <CheckSquare />,
      onSelect: () =>
        cal.openCreate(day, startMin, startMin !== null ? Math.min(24 * 60, startMin + 30) : null, "task"),
    },
    {
      label: "Configurar rutinas…",
      icon: <Repeat />,
      onSelect: () => cal.setRoutinesOpen(true),
    },
  ];

  openMenu(e, items);
}

export function canDrag(occ: Occurrence): boolean {
  return Boolean(occ.start) && (occ.kind === "event" || occ.kind === "routine" || (occ.kind === "task" && occ.editable));
}
