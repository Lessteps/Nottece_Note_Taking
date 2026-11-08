/**
 * Fuente de calendario para el Mentor:
 * Integra las sesiones de estudio y temas del plan activo en el módulo global de Calendario.
 */

import * as path from "node:path";
import { Occurrence } from "../scheduleManager.js";
import { todayIso } from "../dates.js";
import { PlanStore } from "./plan.js";
import { buildSchedule, progressPlan } from "../../lib/planSchedule.js";
import { dayByArea } from "../../lib/planTopicsByArea.js";
import { placeBlocks } from "../../lib/areaTimes.js";
import { AreaTimesStore } from "./areaTimesStore.js";

const AREA_COLOURS: Record<string, string> = {
  backend: "#38bdf8",
  frontend: "#34d399",
  databases: "#a78bfa",
  logic: "#2dd4bf",
  tooling: "#fb7185",
  automation: "#fbbf24",
  desktop: "#818cf8",
  mobile: "#f472b6",
  bases: "#7c5af0",
};

export class MentorCalendarSource {
  prefix = "mentor:";
  prefixes = ["mentor:"] as const;
  vaultRoot: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = path.resolve(vaultRoot);
  }

  occurrences(first: Date, last: Date): Record<string, Occurrence[]> {
    const out: Record<string, Occurrence[]> = {};
    const st = new PlanStore(this.vaultRoot);
    const plans = st.list();
    const activePlan = plans.find((p) => !p.archived && !p.proposed);
    if (!activePlan) return out;

    const firstIso = first.toISOString().slice(0, 10);
    const lastIso = last.toISOString().slice(0, 10);
    const currentToday = todayIso();
    const asOf =
      currentToday >= firstIso && currentToday <= lastIso
        ? currentToday
        : firstIso >= activePlan.start && firstIso <= activePlan.end
          ? firstIso
          : activePlan.start;

    const times = new AreaTimesStore(this.vaultRoot).load(activePlan.id);
    const planProg = progressPlan(activePlan as any, { today: asOf });
    const sch = buildSchedule(planProg);
    for (const [dateStr, day] of sch.byDate.entries()) {
      if (dateStr < firstIso || dateStr > lastIso) continue;
      if (!day.study) continue;

      const allEntries = dayByArea(planProg, day, []);
      // El usuario solicitó explícitamente generar ÚNICAMENTE Backend en el calendario
      // (eliminar frontend, bases de datos, etc. para evitar superposiciones con la rutina de ejercicios)
      const entries = allEntries.filter(
        (e) => e.areaId === "backend" || e.subplanId.includes("backend")
      );
      if (!entries.length) continue;

      out[dateStr] = out[dateStr] || [];

      // Calcular tiempo suficiente para cubrir todos los temas del día de cada área
      const dayBlocksIn = entries.map((e) => {
        const totalSessionMinutes = (e.theoryMinutes || 0) + (e.practiceMinutes || 0);
        const dayTopics = day.topics.filter(
          (t) => (t.subplanId === e.subplanId || (e.areaId && t.areaId === e.areaId)) && t.group !== "bases"
        );
        const topicMinutes = dayTopics.reduce(
          (sum, t) => sum + (t.minutes || 30),
          0
        );
        const neededMinutes = Math.max(
          totalSessionMinutes,
          topicMinutes,
          30
        );
        const roundedDur = Math.ceil(neededMinutes / 5) * 5;
        return {
          key: e.subplanId,
          areaId: e.areaId,
          minutes: roundedDur,
        };
      });

      // la hora fijada por el estudiante manda (ej. Backend a las 06:30); el resto se apila secuencialmente
      const placed = placeBlocks(dayBlocksIn, times);

      for (const e of entries) {
        const slot = placed.find((p) => p.key === e.subplanId);
        if (!slot) continue;

        const areaColor = AREA_COLOURS[e.areaId ?? e.subplanId] ?? "#6366f1";

        // Los sub-eventos deben coincidir exactamente con el plan de sesión de Mentor para Full Stack Junior
        const blockItems = (e.blocks ?? []).flatMap((bl) =>
          bl.items.map((it) => ({
            folder: it.folder,
            title: it.title,
            group: it.group ?? "",
            groupTitle: it.groupTitle ?? "",
            done: Boolean((it as any).done),
            minutes: it.minutes,
          }))
        );

        const dayTopics = day.topics.filter(
          (t) => (t.subplanId === e.subplanId || (e.areaId && t.areaId === e.areaId)) && t.group !== "bases"
        );

        const subEvents = blockItems.length > 0 ? blockItems : dayTopics.map((t) => ({
          folder: t.folder,
          title: t.title,
          group: t.group ?? "",
          groupTitle: t.groupTitle ?? "",
          done: t.done,
          minutes: t.minutes,
        }));

        const isDone = subEvents.length > 0 && subEvents.every((t) => t.done);
        const title = `⚡ Bloque Integrado: ${e.area}`;

        const idSuffix = (e.subplanId === "backend" || e.areaId === "backend" || e.subplanId.includes("backend"))
          ? (e.subplanId.endsWith(":backend") || e.subplanId === "backend" ? e.subplanId : `${e.subplanId}:backend`)
          : e.subplanId;

        const occId = `mentor:block:${activePlan.id}:${dateStr}:${idSuffix}`;

        const occ = new Occurrence(
          occId,
          title,
          "integrated_block",
          new Date(dateStr + "T00:00:00"),
          slot.start,
          slot.durationMin,
          areaColor,
          [
            {
              type: "integrated_block",
              planId: activePlan.id,
              date: dateStr,
              subplanId: e.subplanId,
              area: e.area,
              areaId: e.areaId,
              topicCount: subEvents.length,
              topics: subEvents,
            },
            {
              type: "mentor_day",
              id: activePlan.id,
              date: dateStr,
              subplanId: e.subplanId,
            },
          ],
          isDone,
          "mentor",
          false
        );
        out[dateStr].push(occ);
      }
    }

    return out;
  }
}
