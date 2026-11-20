// Mentor — Sistema de práctica por área (ver `lib/areaPracticeSystem.ts` y docs/VAULT_FORMAT.md, «Sistema de práctica por área»).
//
//  - mentor_area_practice({ id }) -> { areas, ppReady, today }: por área del plan, su sistema (habilidades, kata de hoy, seguimiento de la semana,
//    racha, proyecto de la semana, proyectos por semana y mensual) con el estado DERIVADO del ledger y de las marcas manuales. SOLO LEE.
//  - mentor_area_practice_on({ id, date }) -> { items }: la práctica por área que toca en una fecha (un kata por área), para el calendario y la agenda.
//  - mentor_area_kata_open({ id, areaId }) -> { rel, created }: el acceso directo al kata que toca del área. Si su archivo aún no existe lo crea (junto con
//    la estructura mínima del área; NUNCA sobrescribe) y devuelve la ruta para abrirlo. Solo se llama cuando la persona pulsa «Abrir kata».
//  - mentor_area_practice_setup({ id }) -> { created, view }: deja en `programming_practice/` la carpeta de CADA área del plan con su README, su
//    `<área>.practica.md`, sus habilidades y la estructura de katas y proyectos. Nunca sobrescribe y no crea katas (esos salen al abrirlos).
//  - mentor_area_kata_mark({ id, areaId, date, status }) -> { areas }: marca un kata como hecho / saltado (o quita la marca con `status: null`).
//    «Hecho» solo se acepta si el kata está VERIFICADO: hay un intento calificado (por la IA o por la corrección interna de NoteVault) con nota
//    suficiente, sin haber visto la solución. «Saltado» solo con el 70 % de los katas que tocaban hasta hoy hechos y verificados.
//    Escribe SOLO `.notevault/mentor/area-practice/<plan>.json` (datos de la app), nunca notas de la vault.

import * as path from "node:path";
import * as fs from "node:fs";
import { parseExercise } from "../../core/practice/exerciseNote.js";
import { bindDailyProject } from "../../core/mentor/dailyProjectRepo.js";
import { ensureKataWorkspace } from "../../core/practice/kataWorkspace.js";
import { planChain } from "../../lib/planChain.js";
import { buildSchedule, progressPlan } from "../../lib/planSchedule.js";
import { ApiError } from "../../core/errors.js";
import { createAreaPracticeFolders } from "../../core/mentor/areaPracticeFolders.js";
import { AreaPracticeStore, deriveAreaPractice, existingAreaFiles } from "../../core/mentor/areaPracticeState.js";
import { PLAN_ID_RE, PlanStore, type Plan } from "../../core/mentor/plan.js";
import { ppAreaDir } from "../../core/mentor/practiceState.js";
import { loadAllAttempts } from "../../core/practice/ledger.js";
import { kataDatesOf, verifiedKataFilesOf } from "../../lib/areaPracticeDerive.js";
import { areaFolderOf, areaKataDates, areaPracticeFor, isPracticeAreaId, kataForDay, practiceAreasOf } from "../../lib/areaPracticeSystem.js";
import type { AppState } from "../appState.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mentorAreaPracticeApi(app: AppState, hooks: { today: () => string }) {
  const planOf = (opts: unknown): Plan => {
    const id = String(((opts && typeof opts === "object" ? opts : {}) as Record<string, any>).id ?? "");
    if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
    const plan = new PlanStore(app.root).load(id);
    if (!plan) throw new ApiError("Ese plan ya no existe.");
    return plan;
  };
  const viewOf = (plan: Plan) => {
    const ppDir = ppAreaDir(app.root);
    const areaIds = practiceAreasOf(plan).map((a) => a.areaId);
    return {
      today: hooks.today(),
      ppReady: !!ppDir,
      /** ruta de `programming_practice` en la vault (para abrir un kata: `<ppBase>/<área>/katas/<archivo>`) */
      ppBase: ppDir ? app.rel(ppDir).replace(/\\/g, "/") : "",
      areas: deriveAreaPractice({
        plan,
        today: hooks.today(),
        attempts: loadAllAttempts(app.root),
        marks: new AreaPracticeStore(app.root).load(plan.id),
        existing: existingAreaFiles(ppDir, areaIds),
      }),
    };
  };
  return {
    mentor_area_practice(opts: unknown) {
      return viewOf(planOf(opts));
    },

    mentor_area_practice_on(opts: unknown) {
      const plan = planOf(opts);
      const date = String((opts as Record<string, unknown>)?.date ?? "");
      if (!DATE_RE.test(date)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
      const consumed = new Map(viewOf(plan).areas.map((a) => [a.areaId, new Set(a.kata.consumed)] as const));
      return { items: areaPracticeFor(plan, date, undefined, consumed).map((d) => ({ areaId: d.areaId, label: d.label, day: d.day, rel: d.rel, title: d.kata.title, skill: d.kata.skillName, level: d.kata.level, minutes: d.kata.minutes })) };
    },

    /**
     * «Más práctica»: los katas YA PLANEADOS del área (o de todas) que aún no tocan, en orden y con su fecha, hasta `limit` por área (5).
     * Marca en `addedDates` los días a los que ya se adelantaron. Solo lee.
     */
    mentor_area_katas_ahead(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = planOf(o);
      const only = String(o.area ?? "").trim();
      const limit = Math.max(1, Math.min(20, Math.round(Number(o.limit)) || 5));
      const today = hooks.today();
      const katas: Array<Record<string, unknown>> = [];
      for (const a of viewOf(plan).areas) {
        const sub = plan.subplans.find((s) => s.areaId === a.areaId);
        const consumed = new Set(a.kata.consumed);
        if (!sub || (only && sub.id !== only)) continue;
        const dates = areaKataDates(plan, a.areaId);
        let n = 0;
        dates.forEach((d, i) => {
          if (d <= today || n >= limit || consumed.has(d)) return;
          const k = kataForDay(a.areaId, i + 1, a.level);
          if (!k) return;
          n++;
          const added = (plan.extraPractice ?? []).filter((x) => x.kataDate === d && x.area === sub.id).map((x) => x.date);
          katas.push({ areaId: a.areaId, subplanId: sub.id, area: a.label, day: i + 1, date: d, title: k.title, skill: k.skillName, level: k.level, minutes: k.minutes, addedDates: added });
        });
      }
      return { katas };
    },

    mentor_area_practice_setup(opts: unknown) {
      const plan = planOf(opts);
      const ppDir = ppAreaDir(app.root);
      if (!ppDir) throw new ApiError("No se encontró la carpeta programming_practice en tu vault.");
      const areas = practiceAreasOf(plan).map((a) => a.areaId);
      const r = createAreaPracticeFolders({ ppDir, areas });
      return { created: r.created, folders: r.folders, view: viewOf(plan) };
    },

    mentor_area_kata_open(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = planOf(o);
      const areaId = String(o.areaId ?? "");
      if (!isPracticeAreaId(areaId) || !practiceAreasOf(plan).some((a) => a.areaId === areaId)) throw new ApiError("Esa área no está en el plan.");
      const ppDir = ppAreaDir(app.root);
      if (!ppDir) throw new ApiError("No se encontró la carpeta programming_practice en tu vault.");
      const area = viewOf(plan).areas.find((a) => a.areaId === areaId);
      if (!area) throw new ApiError("Esa área no está en el plan.");
      // un kata concreto (`date`: de los atrasados) o, sin fecha, el de hoy / el siguiente
      const wanted = o.date === undefined || o.date === "" ? "" : String(o.date);
      if (wanted && !DATE_RE.test(wanted)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
      const target = wanted
        ? area.kata.due.find((d) => d.date === wanted) ?? (area.kata.next?.date === wanted ? { day: area.kata.next.kata.day, date: wanted, rel: area.kata.next.rel } : undefined)
        : area.kata.next
          ? { day: area.kata.next.kata.day, date: area.kata.next.date, rel: area.kata.next.rel }
          : undefined;
      // un kata PLANEADO más adelante (el estudiante lo adelantó): el kata nº N del área es el día N de sus fechas
      const later = (() => {
        if (target || !wanted) return undefined;
        const day = areaKataDates(plan, areaId).indexOf(wanted) + 1;
        const k = day > 0 ? kataForDay(areaId, day, area.level) : null;
        return k ? { day, date: wanted, rel: `${areaFolderOf(areaId)}/katas/${k.file}` } : undefined;
      })();
      const found = target ?? later;
      if (!found) throw new ApiError("Ese día no tiene kata en esta área.");
      const r = createAreaPracticeFolders({ ppDir, areas: [areaId], katasPerArea: 1, fromDay: found.day, levels: { [areaId]: area.level } });
      const base = app.rel(ppDir).split(path.sep).join("/");
      const rel = `${base}/${found.rel}`;
      if (r.failed.length && !r.created.length && !r.skipped.length) throw new ApiError(`No se pudo crear el kata: ${r.failed[0]!.reason}`);
      const chain = planChain(plan as never, buildSchedule(progressPlan(plan as never, { today: hooks.today() })));
      const contains = (m: (typeof chain.months)[number]) => m.weeks.some((w) => found.date >= w.start && found.date <= w.end);
      const month = chain.months.find(contains) ?? planChain(plan as never, buildSchedule(plan as never)).months.find(contains);
      let projectRepo: string | null = null;
      let projectWarning = "";
      try {
        const fullPath = path.join(app.root, rel);
        if (fs.existsSync(fullPath)) {
          const parsed = parseExercise(fs.readFileSync(fullPath, "utf8"), rel);
          try { ensureKataWorkspace(app.root, rel, parsed); } catch { /* ok */ }
          if (month) {
            const noteId = parsed.note_id;
            projectRepo = bindDailyProject(app.root, ppDir, { planId: plan.id, monthId: month.id, monthTitle: month.title, area: areaFolderOf(areaId), day: found.day, noteId, notePath: rel });
          }
        }
      } catch (e) { projectWarning = `No se pudo preparar el repositorio del proyecto: ${(e as Error).message}`; }
      if (!month) projectWarning = "Esta práctica no tiene un proyecto mensual asociado en la planificación.";
      return { rel, created: r.created.includes(found.rel), date: found.date, projectRepo, projectWarning };
    },

    mentor_area_kata_mark(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = planOf(o);
      const areaId = String(o.areaId ?? "");
      const date = String(o.date ?? "");
      if (!isPracticeAreaId(areaId) || !practiceAreasOf(plan).some((a) => a.areaId === areaId)) throw new ApiError("Esa área no está en el plan.");
      if (!DATE_RE.test(date)) throw new ApiError("Fecha inválida (AAAA-MM-DD).");
      if (date > hooks.today() && !areaKataDates(plan, areaId).includes(date)) throw new ApiError("Ese reto no está en el plan.");
      const status = o.status === "done" || o.status === "skipped" ? o.status : o.status === null || o.status === undefined ? null : undefined;
      if (status === undefined) throw new ApiError("Estado inválido.");
      if (status === "done") {
        const attempts = loadAllAttempts(app.root);
        const area = { id: areaId, folder: areaFolderOf(areaId) };
        const verifiedOnDate = kataDatesOf(attempts, area).has(date);
        const index = areaKataDates(plan, areaId).indexOf(date) + 1;
        const filePrefix = `${String(index).padStart(3, "0")} `;
        const verifiedByFile = index > 0 && [...verifiedKataFilesOf(attempts, area)].some((file) => file.split("/").pop()?.startsWith(filePrefix));
        if (!verifiedOnDate && !verifiedByFile) {
          throw new ApiError("Este kata aún no está verificado: hace falta un intento calificado (nota de 75 o más, sin ver la solución). Resuélvelo en su archivo y pide la revisión; cuando la corrección lo dé por bueno, queda hecho.");
        }
        // La evidencia por archivo ya determina el avance: no dupliques el mismo intento
        // guardando una segunda marca en la fecha prevista.
        if (verifiedByFile && !verifiedOnDate) return viewOf(plan);
      } else if (status === "skipped") {
        const rule = viewOf(plan).areas.find((a) => a.areaId === areaId)?.kata.skip;
        if (rule && !rule.allowed) {
          throw new ApiError(`No se puede saltar este kata: hace falta haber hecho al menos el ${rule.neededPct} % de los katas que tocaban hasta hoy y llevas el ${rule.pct} %.`);
        }
      }
      new AreaPracticeStore(app.root).mark(plan.id, areaId, date, status);
      return viewOf(plan);
    },
  };
}
