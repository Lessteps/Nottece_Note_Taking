// Mentor — «Ejecutar plan»: informe de ejecución (qué falta crear, agrupado, con coste y orden por semanas), ejecución en segundo plano con cola
// persistida, pausa / reanudación / cancelación y registro de los archivos creados.
//
//  - mentor_execution_report({ id, scope? }) -> { loading } | { report, execution, aiConfigured }: SOLO LEE. Calcula el informe con la cobertura
//    determinista (checklist de diseño por tema) y la última revisión de la IA (`coverageReview`, temas nuevos propuestos).
//  - mentor_execution_start({ id, scope, confirm: true }) -> { execution }: crea la cola y empieza. Exige `confirm: true` (la persona pulsó el
//    botón del diálogo) e IA configurada. Nunca se llama solo.
//  - mentor_execution_status({ id }) -> { execution, active }: el estado guardado (una ejecución que quedó «en curso» tras cerrar la app se
//    devuelve en pausa).
//  - mentor_execution_pause / _resume / _cancel({ id }) -> { execution }: pausar y cancelar ABORTAN de verdad las tareas en vuelo.
//
//  - mentor_handoff_scheme({ id, perCell?, maxFiles?, ladder?, ai? }) -> { scheme }: ESQUEMATIZA lo que falta (teoría, mapas y ejercicios) en paquetes de
//    trabajo pequeños y ordenados para pasárselos a otra IA (Antigravity) poco a poco. Con `ai` la IA solo ordena y nombra los paquetes; el reparto
//    y las listas exactas son deterministas. Lo guarda en `.notevault/mentor/handoff/<plan>.json` (conserva qué paquetes ya se escribieron).
//  - mentor_handoff_get({ id }) -> { scheme }: el esquema guardado (sin recalcular).
//  - mentor_handoff_write({ id, packageId }) -> { path, prompt, scheme }: escribe el documento de UN paquete en `<materia>/_handoff/<plan>/NN-<id>.md`.
//    Solo escribe ese archivo; no toca notas ni ejercicios.
//
// Nada de aquí sobrescribe: ver `mentorExecuteDeps.ts` (fotografía y restauración de la carpeta del tema) y docs/VAULT_FORMAT.md.

import * as fs from "node:fs";
import * as path from "node:path";
import { topicLearningContexts } from "./learningContext.js";
import { AIConfig, sendChat } from "../../core/aiClient.js";
import { ApiError } from "../../core/errors.js";
import { areaFiles, areaKataDates, practiceAreasOf } from "../../lib/areaPracticeSystem.js";
import { PLAN_ID_RE, PlanStore, type Plan } from "../../core/mentor/plan.js";
import { ExecutionRunner, ExecutionStore, newExecution, reconcileExecution, recoverInterrupted, type ExecDeps } from "../../core/mentor/planExecutor.js";
import { ppAreaDir } from "../../core/mentor/practiceState.js";
import { aiUnavailableReason } from "../../core/mentor/planner.js";
import { areaKeyOf } from "../../lib/planCoverage.js";
import { buildExecutionReport, DEFAULT_SCOPE, progressOf, type ExecutionReport, type ExecutionScope, type ExecutionState } from "../../lib/planExecution.js";
import { buildHandoffMarkdown } from "../../lib/planHandoff.js";
import { weekRangesOf } from "../../lib/planTime.js";
import {
  applyAiScheme, buildScheme, DEFAULT_HANDOFF, packageMarkdown, promptFor, schemeMessages, topicsFromTasks, totalsOf,
  type HandoffOptions, type HandoffPackage,
} from "../../lib/handoffPlan.js";
import * as store from "../../core/store.js";
import { AppConfig } from "../appConfig.js";
import { clearVaultScanCache } from "../vaultScan.js";
import type { AppState } from "../appState.js";
import { designsOf } from "./mentorDesign.js";
import { makeExecDeps, type ExecDepsOptions } from "./mentorExecuteDeps.js";
import { studyIndexCold } from "./study.js";

export interface MentorExecuteHooks extends ExecDepsOptions {
  /**
   * reanudar sola, al abrir la app, la ejecución que quedó «en curso» en disco. POR DEFECTO NO: generar notas sin que la persona lo pida
   * escribiría en su vault sin permiso. Una ejecución a medias se enseña como «en pausa» (banner «¿reanudar?» en la Ejecución) y solo se
   * reanuda con el botón. Solo existe para pruebas / uso explícito.
   */
  autoResume?: boolean;
  autoResumeDelayMs?: number;
  /** reemplaza las dependencias reales (tests con IA simulada) */
  depsFor?: (planId: string) => ExecDeps;
  retryDelayMs?: number;
  now?: () => string;
}

const AUTO_RESUMED = new WeakSet<AppState>();
const RUNNERS = new WeakMap<AppState, Map<string, ExecutionRunner>>();
const runnersOf = (app: AppState): Map<string, ExecutionRunner> => {
  let m = RUNNERS.get(app);
  if (!m) RUNNERS.set(app, (m = new Map()));
  return m;
};

const sanitizeScope = (raw: unknown): ExecutionScope => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const mode = o.mode === "weeks" || o.mode === "area" || o.mode === "topic" ? o.mode : "all";
  const week = (v: unknown): number | undefined => (Number.isFinite(Number(v)) && Number(v) >= 1 ? Math.min(1000, Math.round(Number(v))) : undefined);
  return {
    mode,
    ...(mode === "weeks" ? { fromWeek: week(o.fromWeek) ?? 1, toWeek: week(o.toWeek) ?? 4 } : {}),
    ...(mode === "area" ? { areaKey: String(o.areaKey ?? "").slice(0, 60) } : {}),
    ...(mode === "topic" ? { folder: String(o.folder ?? "").slice(0, 400) } : {}),
    includeRecommended: o.includeRecommended === true,
    includeNewTopics: o.includeNewTopics === true,
    includeAreaPractice: o.includeAreaPractice !== false,
    includeKatasAi: o.includeKatasAi === true,
  };
};

export function mentorExecuteApi(app: AppState, hooks: MentorExecuteHooks = {}) {
  const now = hooks.now ?? ((): string => new Date().toISOString());
  const execStore = (): ExecutionStore => new ExecutionStore(app.root);
  const aiOn = (): boolean => aiUnavailableReason(AIConfig.fromDict(AppConfig.get_ai_config())) === null;
  const planOf = (opts: unknown): Plan => {
    const id = String(((opts && typeof opts === "object" ? opts : {}) as Record<string, any>).id ?? "");
    if (!PLAN_ID_RE.test(id)) throw new ApiError("Plan inválido.");
    const plan = new PlanStore(app.root).load(id);
    if (!plan) throw new ApiError("Ese plan ya no existe.");
    return plan;
  };

  /** El informe de ejecución del plan para un alcance. Solo lee. */
  function reportOf(plan: Plan, scope: ExecutionScope): ExecutionReport {
    const topics = plan.subplans.flatMap((s) =>
      s.topics.map((t) => ({ folder: t.folder, title: t.title, areaKey: areaKeyOf(s), area: s.area, week: t.targetWeek, skipped: t.route === "skipped", completed: !!t.completedAt })),
    );
    const designs = designsOf(app, topics.map((t) => ({ folder: t.folder, title: t.title })));
    const ppDir = ppAreaDir(app.root);
    const space = topics[0]?.folder.split("/")[0] ?? "Programación";
    const ranges = weekRangesOf(plan.start, plan.end);
    const weeksOf = (dates: string[]): number[] => dates.map((d) => Math.max(1, ranges.findIndex((r) => d >= r.start && d <= r.end) + 1));
    const kataWeeks = weeksOf(areaKataDates(plan, "backend"));
    const kataWeeksByArea = Object.fromEntries(practiceAreasOf(plan).map((a) => [a.areaId, weeksOf(areaKataDates(plan, a.areaId))]));
    return buildExecutionReport(
      {
        planId: plan.id,
        topics,
        areas: plan.subplans.map((s) => ({ key: areaKeyOf(s), area: s.area, ...(s.areaId ? { areaId: s.areaId } : {}) })),
        designs,
        review: plan.coverageReview ?? null,
        ppReady: !!ppDir,
        areaFiles: (areaId, katas, fromDay) =>
          areaFiles(areaId, { katasPerArea: katas, fromDay }).map((f) => ({ rel: f.rel, exists: fs.existsSync(path.join(ppDir ?? path.join(app.root, space, "programming_practice"), ...f.rel.split("/"))) })),
        kataWeeks,
        kataWeeksByArea,
        aiConfigured: aiOn(),
        now: now(),
      },
      scope,
    );
  }

  /**
   * Una ejecución que en disco figura «en curso» quedó a medias porque la app se cerró (o el PC se apagó) con la cola trabajando. Con `autoResume`
   * (apagado por defecto) se reanudaría sola; sin él, `current()` la devuelve «en pausa» y la persona decide (Reanudar / Descartar).
   * Una que la persona pausó, o que se paró sola por un límite de uso, figura «en pausa» y NO se toca.
   */
  function scheduleAutoResume(): void {
    if (AUTO_RESUMED.has(app)) return;
    AUTO_RESUMED.add(app);
    const timer = setTimeout(() => {
      try {
        const dir = path.join(app.root, ".notevault", "mentor", "executions");
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".json")) continue;
          const planId = f.slice(0, -5);
          if (!PLAN_ID_RE.test(planId) || runnersOf(app).has(planId)) continue;
          const s = execStore().load(planId);
          if (!s || s.status !== "running" || !aiOn()) continue;
          const recovered = recoverInterrupted(s);
          execStore().save(recovered);
          void runnerFor(recovered).resume();
        }
      } catch {
        /* sin ejecuciones guardadas */
      }
    }, hooks.autoResumeDelayMs ?? 4000);
    (timer as { unref?: () => void }).unref?.();
  }
  if (hooks.autoResume === true) scheduleAutoResume();

  const view = (s: ExecutionState | null) => (s ? { state: s, progress: progressOf(s) } : null);

  /** El estado guardado; una ejecución que quedó «en curso» sin proceso detrás (la app se cerró) se devuelve en pausa. */
  function current(planId: string): ExecutionState | null {
    const runner = runnersOf(app).get(planId);
    if (runner) return runner.state;
    const s = execStore().load(planId);
    if (!s) return null;
    const rec = recoverInterrupted(s);
    if (rec !== s) execStore().save(rec);
    return rec;
  }

  function runnerFor(state: ExecutionState): ExecutionRunner {
    const reg = runnersOf(app);
    const old = reg.get(state.planId);
    if (old) return old;
    const deps = hooks.depsFor?.(state.planId) ?? makeExecDeps(app, state.planId, hooks);
    const r = new ExecutionRunner(state, execStore(), deps, {
      retryDelayMs: hooks.retryDelayMs ?? 2000,
      ...(hooks.now ? { now: hooks.now } : {}),
      // al terminar la ejecución (con algo hecho) el plan queda con sus entregables y su práctica DEFINIDOS: deja de mostrarlos «por definir»
      onChange: (st) => {
        if (st.status !== "done" || !st.tasks.some((t) => t.status === "done")) return;
        const ps = new PlanStore(app.root);
        const p = ps.load(st.planId);
        if (p && !p.deliverablesDefinedAt) ps.save({ ...p, deliverablesDefinedAt: now() });
      },
    });
    reg.set(state.planId, r);
    return r;
  }

  // ── Esquema de traspaso (plan para otra IA) ────────────────────────────
  interface HandoffScheme {
    version: 1;
    planId: string;
    createdAt: string;
    source: "rules" | "ai";
    note?: string;
    options: HandoffOptions & { ladder: boolean };
    packages: HandoffPackage[];
  }
  const MASTER_DOC = "C:\\PROGRAMMING\\PROJECTS\\NoteVault\\docs\\ANTIGRAVITY_PLAN_CONTENT_GENERATION.md";
  const TOOLS_DIR = "C:\\PROGRAMMING\\PROJECTS\\NoteVault\\frontend";
  const handoffFile = (planId: string): string => path.join(app.root, ".notevault", "mentor", "handoff", `${planId}.json`);
  const loadHandoff = (planId: string): HandoffScheme | null => {
    const raw = store.loadJson<HandoffScheme>(handoffFile(planId), null);
    return raw && raw.version === 1 && Array.isArray(raw.packages) ? raw : null;
  };
  const handoffView = (sc: HandoffScheme | null) => (sc ? { ...sc, totals: totalsOf(sc.packages), pending: totalsOf(sc.packages.filter((p) => !p.written)) } : null);
  const clampInt = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };

  /** Guarda la ejecución terminada en el historial antes de empezar otra (el registro de lo creado no se pierde). */
  function archive(s: ExecutionState): void {
    store.writeJson(path.join(app.root, ".notevault", "mentor", "executions", "history", s.planId, `${s.id}.json`), s);
  }

  return {
    mentor_execution_report(opts: unknown) {
      const plan = planOf(opts);
      if (studyIndexCold(app)) return { loading: true as const };
      const scope = sanitizeScope((opts as Record<string, unknown>)?.scope ?? DEFAULT_SCOPE);
      return { loading: false as const, report: reportOf(plan, scope), execution: view(current(plan.id)), aiConfigured: aiOn() };
    },

    /**
     * «Plan para otra IA»: escribe en `.notevault/mentor/handoff/<planId>.md` un documento (en inglés) con lo que falta crear, para dárselo a otra IA.
     * No usa la IA de la app y no toca notas; solo sobrescribe SU propio documento (se regenera cada vez). Devuelve la ruta y el texto.
     */
    mentor_execution_handoff(opts: unknown) {
      const plan = planOf(opts);
      if (studyIndexCold(app)) return { loading: true as const };
      const scope = sanitizeScope((opts as Record<string, unknown>)?.scope ?? DEFAULT_SCOPE);
      const report = reportOf(plan, scope);
      const space = report.tasks.find((t) => t.folder)?.folder?.split("/")[0] ?? "Programación";
      const has = (rel: string): boolean => fs.existsSync(path.join(app.root, ...rel.split("/")));
      const contracts = [
        `${space}/00 Temario.md`,
        `${space}/_skills/temario_skill.md`,
        `${space}/_skills/resumen_teorico_skill.md`,
        `${space}/_skills/mapa_skill.md`,
        `${space}/_skills/practica_skill.md`,
        "PROJECTS/NoteVault/docs/ANTIGRAVITY_PROMPT_PROGRAMMING_KB.md",
        "PROJECTS/NoteVault/docs/ANTIGRAVITY_PLAN_CONTENT_GENERATION.md",
      ].filter(has);
      const toolsDir = has("PROJECTS/NoteVault/frontend/tools/programming_kb/status.mjs") ? path.join(app.root, "PROJECTS", "NoteVault", "frontend") : undefined;
      const contextFolders = [...new Set(report.tasks.map((t) => t.folder).filter((f): f is string => !!f))];
      const contexts = topicLearningContexts(app, contextFolders).filter(Boolean);
      const markdown = buildHandoffMarkdown(report, { planName: plan.name ?? plan.id, start: plan.start, end: plan.end, contracts, ...(toolsDir ? { toolsDir } : {}) }) + (contexts.length ? `\n\n## Learning plan and recorded progress by topic\n${contexts.join("\n")}` : "");
      const file = path.join(app.root, ".notevault", "mentor", "handoff", `${plan.id}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, markdown, "utf-8");
      const ai = report.tasks.filter((t) => ["topic_new", "theory", "canvas", "manifest", "practice"].includes(t.kind));
      return { loading: false as const, path: file, rel: path.relative(app.root, file).split(path.sep).join("/"), markdown, items: ai.length, files: ai.reduce((n, t) => n + t.files, 0) };
    },

    mentor_execution_status(opts: unknown) {
      const plan = planOf(opts);
      const s = current(plan.id);
      return { execution: view(s), active: !!runnersOf(app).get(plan.id)?.active };
    },

    async mentor_execution_start(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      if (o.confirm !== true) throw new ApiError("Falta la confirmación: «Ejecutar plan» solo se hace cuando la persona la da en el diálogo.");
      const plan = planOf(o);
      if (!aiOn()) throw new ApiError("La IA no está configurada: sin IA no se puede ejecutar el plan (el análisis sí funciona).");
      if (studyIndexCold(app)) return { loading: true as const };
      const prev = current(plan.id);
      if (prev && (prev.status === "running" || prev.status === "paused")) throw new ApiError(prev.status === "running" ? "Ya hay una ejecución en curso." : "Hay una ejecución en pausa: reanúdala o cancélala antes de empezar otra.");
      const scope = sanitizeScope(o.scope);
      const report = reportOf(plan, scope);
      if (!report.tasks.length) throw new ApiError("No hay nada que crear con ese alcance.");
      if (prev) archive(prev);
      runnersOf(app).delete(plan.id);
      const state = newExecution(plan.id, scope, report.tasks, now());
      execStore().save(state);
      const runner = runnerFor(state);
      void runner.start();
      return { loading: false as const, execution: view(runner.state) };
    },

    /**
     * «Verificar»: relee la vault desde disco y marca como hechas las tareas de la ejecución guardada que ya están cubiertas (las creó otra IA, la
     * persona o una ejecución anterior). No usa IA, no crea nada y no se puede hacer mientras la cola corre.
     */
    mentor_execution_verify(opts: unknown) {
      const plan = planOf(opts);
      const runner = runnersOf(app).get(plan.id);
      if (runner?.active || runner?.state.status === "running") throw new ApiError("La ejecución está en curso: páusala antes de verificar.");
      const s = current(plan.id);
      if (!s) throw new ApiError("No hay una ejecución que verificar.");
      clearVaultScanCache(); // los archivos pudieron crearse fuera de la app: se vuelve a leer la vault
      const fresh = reportOf(plan, s.scope);
      const r = reconcileExecution(s, fresh.tasks, now());
      execStore().save(r.state);
      runnersOf(app).delete(plan.id); // el estado guardado manda: el siguiente «Reanudar» crea un runner con él
      return { execution: view(r.state), verified: r.verified, trimmed: r.trimmed, remaining: r.remaining };
    },

    async mentor_handoff_scheme(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = planOf(o);
      if (studyIndexCold(app)) return { loading: true as const };
      const options = { perCell: clampInt(o.perCell, 1, 5, DEFAULT_HANDOFF.perCell), maxFiles: clampInt(o.maxFiles, 30, 600, DEFAULT_HANDOFF.maxFiles), maxTheory: DEFAULT_HANDOFF.maxTheory, ladder: o.ladder === true };
      // solo contenido que hay que escribir (teoría y ejercicios): sin carpetas de práctica, katas ni temas propuestos por la revisión
      const report = reportOf(plan, { mode: "all", includeRecommended: options.ladder, includeNewTopics: false, includeAreaPractice: false, includeKatasAi: false });
      const byTopic = topicsFromTasks(report.tasks, options.perCell);
      let packages = buildScheme(byTopic, report.areas.map((a) => ({ key: a.key, area: a.area })), options);
      let source: HandoffScheme["source"] = "rules";
      let note = packages.length ? "" : "No falta nada por crear con estas opciones.";
      if (o.ai === true && packages.length > 1 && aiOn()) {
        try {
          const cfg = AIConfig.fromDict(AppConfig.get_ai_config());
          const reply = await (hooks.send ?? ((c, m, x) => sendChat(c, m, x)))(cfg, schemeMessages(packages) as never, { timeoutMs: 90_000 });
          const applied = applyAiScheme(packages, reply);
          if (applied) {
            packages = applied;
            source = "ai";
          } else note = "La IA no devolvió un orden válido: se usa el orden por reglas.";
        } catch (e) {
          note = `La IA no pudo ordenar los paquetes (${(e as Error).message.slice(0, 120)}): se usa el orden por reglas.`;
        }
      } else if (o.ai === true && !aiOn()) note = "La IA no está configurada: se usa el orden por reglas.";
      // lo ya escrito se conserva mientras el paquete siga siendo el mismo (mismo id y mismos temas)
      const prev = loadHandoff(plan.id);
      const same = (a: HandoffPackage, b: HandoffPackage): boolean => a.id === b.id && a.topics.map((t) => t.folder).join("|") === b.topics.map((t) => t.folder).join("|");
      packages = packages.map((p) => {
        const old = prev?.packages.find((x) => same(x, p));
        return old?.written ? { ...p, written: old.written } : p;
      });
      const scheme: HandoffScheme = { version: 1, planId: plan.id, createdAt: now(), source, ...(note ? { note } : {}), options, packages };
      store.writeJson(handoffFile(plan.id), scheme);
      return { loading: false as const, scheme: handoffView(scheme) };
    },

    mentor_handoff_get(opts: unknown) {
      const plan = planOf(opts);
      return { scheme: handoffView(loadHandoff(plan.id)) };
    },

    mentor_handoff_write(opts: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, any>;
      const plan = planOf(o);
      const sc = loadHandoff(plan.id);
      const pkg = sc?.packages.find((p) => p.id === String(o.packageId ?? ""));
      if (!sc || !pkg) throw new ApiError("Ese paquete ya no está en el esquema: vuelve a esquematizar.");
      const space = pkg.topics[0]?.folder.split("/")[0] ?? "Programación";
      const num = String(pkg.order).padStart(2, "0");
      const relPath = `${space}/_handoff/${plan.id}/${num}-${pkg.id}.md`;
      const abs = path.join(app.root, ...relPath.split("/"));
      const contexts = topicLearningContexts(app, pkg.topics.map((t) => t.folder)).filter(Boolean);
      const md = packageMarkdown(pkg, { vaultRoot: app.root, space, planName: plan.name ?? plan.id, masterDoc: MASTER_DOC, toolsDir: TOOLS_DIR, total: sc.packages.length }) + (contexts.length ? `\n\n## Learning plan and recorded progress by topic\n${contexts.join("\n")}` : "");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, md, "utf-8");
      const written = { at: now(), path: abs };
      const next: HandoffScheme = { ...sc, packages: sc.packages.map((p) => (p.id === pkg.id ? { ...p, written } : p)) };
      store.writeJson(handoffFile(plan.id), next);
      return { path: abs, rel: relPath, prompt: promptFor(abs), scheme: handoffView(next) };
    },

    mentor_execution_pause(opts: unknown) {
      const plan = planOf(opts);
      const r = runnersOf(app).get(plan.id);
      if (!r || r.state.status !== "running") throw new ApiError("No hay una ejecución en curso.");
      r.pause();
      return { execution: view(r.state) };
    },

    mentor_execution_resume(opts: unknown) {
      const plan = planOf(opts);
      const s = current(plan.id);
      if (!s || (s.status !== "paused" && s.status !== "failed")) throw new ApiError("No hay una ejecución en pausa.");
      if (!aiOn()) throw new ApiError("La IA no está configurada.");
      const r = runnerFor(s);
      void r.resume();
      return { execution: view(r.state) };
    },

    mentor_execution_cancel(opts: unknown) {
      const plan = planOf(opts);
      const s = current(plan.id);
      if (!s || s.status === "done" || s.status === "cancelled") throw new ApiError("No hay una ejecución que cancelar.");
      const r = runnerFor(s);
      r.cancel();
      return { execution: view(r.state) };
    },
  };
}
