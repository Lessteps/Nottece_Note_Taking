// Mentor — navegación: la ruta recordada (`mentor.view`), el modo global Planeación | Ejecución (`mentor.mode`) y los ítems que cada modo
// pone en la barra lateral. Módulo PURO (sin React): la barra y los paneles solo leen y escriben las mismas claves de `navState`.

import { BASES_KEY } from "../../lib/planAreaTopics";
import { api } from "../../lib/bridge";
import { reviewsOfTopics, type ReviewItemLike } from "../../lib/planReviews";
import { areaRouteTopics, basesClassifier, basesRouteTopics, orderedAreas } from "../../lib/planTopicsByArea";
import type { MentorBuildSummary, MentorPlan, MentorPlanRow } from "../../lib/types";
import { useEffect } from "react";
import { useNavState, usePersistedNav } from "../../store/navState";
import { sectionAlias } from "./PlanSections";
import { agendaAreaKey, agendaViewKey, MODE_KEY, pageTabKey, PLAN_TABS, planSectionKey, planTabKey, type PlanTab } from "./planShared";

/** Modo GLOBAL del Mentor: cambia los ítems de la barra y lo que enseña el panel del plan elegido. */
export type MentorMode = "planeacion" | "ejecucion";
export { MODE_KEY };
export const MODES: ReadonlyArray<{ id: MentorMode; label: string; hint: string }> = [
  { id: "planeacion", label: "Planeación", hint: "Armar y ajustar el plan: agenda, entregables y cambios" },
  { id: "ejecucion", label: "Ejecución", hint: "El día a día: qué toca hoy y cómo vas" },
];

/** Sin elegir, un plan mantenido y no archivado abre en Ejecución; uno propuesto (por decidir) o terminado, en Planeación. */
export function defaultModeOf(plan: Pick<MentorPlanRow, "status"> | undefined): MentorMode {
  return plan && plan.status !== "propuesto" && plan.status !== "terminado" ? "ejecucion" : "planeacion";
}
/** De qué estado sacar el modo por defecto: el del listado de planes (store) y, si aún no cargó, el del propio plan. */
export function modeSubject(row: Pick<MentorPlanRow, "status"> | undefined, plan: Pick<MentorPlan, "proposed" | "archived"> | null): Pick<MentorPlanRow, "status"> | undefined {
  return row ?? (plan ? { status: plan.proposed ? "propuesto" : plan.archived ? "terminado" : "activo" } : undefined);
}
export const asMode = (raw: unknown, fallback: MentorMode): MentorMode => (raw === "planeacion" || raw === "ejecucion" ? raw : fallback);

/** Clave del modo que antes se guardaba por plan (antes del modo global): se adopta una vez si aún no hay modo global. */
export const legacyModeKey = (planId: string): string => `mentor.planMode.${planId}`;
/** El modo guardado: el global y, si nunca se eligió, el antiguo del plan (si lo hay). */
export const storedModeOf = (values: Record<string, unknown>, planId: string | undefined): string => {
  const g = values[MODE_KEY];
  if (g === "planeacion" || g === "ejecucion") return g;
  const old = planId ? values[legacyModeKey(planId)] : undefined;
  return old === "planeacion" || old === "ejecucion" ? old : "";
};

/** El modo vigente (el guardado, o el de por defecto según el plan) y cómo cambiarlo. `planId` permite adoptar el modo antiguo de ese plan. */
export function useMentorMode(plan: Pick<MentorPlanRow, "status"> | undefined, planId?: string): [MentorMode, (m: MentorMode) => void] {
  const [raw, set] = usePersistedNav<string>(MODE_KEY, "");
  const legacy = useNavState((s) => storedModeOf(s.values, planId));
  const effective = raw === "planeacion" || raw === "ejecucion" ? raw : legacy;
  useEffect(() => {
    if (!raw && legacy) set(legacy);
  }, [raw, legacy, set]);
  return [asMode(effective, defaultModeOf(plan)), set];
}

// ── Ruta ────────────────────────────────────────────────────────────────

export const PLAN_PREFIX = "plan:";
export const BUILD_PREFIX = "build:";
/** Paneles que ya no están en la barra lateral pero siguen existiendo: se llega a ellos desde botones de otras vistas y se vuelve con «Volver a mi plan». */
export const AUX_VIEWS = ["hoy", "cierre", "metas", "proyectos", "notas"] as const;
export type AuxView = (typeof AUX_VIEWS)[number];
export const OVERVIEW_VIEW = "plan";
export const CREATE_VIEW = "nuevo";
/** «Áreas»: el índice de solo lectura del avance por espacio/área/tema; ruta fija, independiente del modo y del plan. */
export const AREAS_VIEW = "areas";

export type MentorRoute =
  | { kind: "plan"; planId: string }
  | { kind: "build"; buildId: string }
  | { kind: "aux"; view: AuxView }
  /** «Todos los planes» (resumen, borrador pendiente y creación); `creating` abre el formulario de plan nuevo */
  | { kind: "overview"; creating: boolean }
  /** «Áreas» (índice de avance de solo lectura) */
  | { kind: "areas" };

interface RouteInput {
  stored: string;
  plans: ReadonlyArray<Pick<MentorPlanRow, "id" | "status">>;
  plansLoaded: boolean;
  builds: ReadonlyArray<Pick<MentorBuildSummary, "id">>;
  buildsLoaded: boolean;
}

/**
 * La ruta a pintar. Los valores antiguos («hoy», «cierre», «metas», «proyectos», «notas») siguen siendo rutas válidas pero ocultas; «plan» es el
 * resumen de todos los planes; vacío (nunca elegido) o un plan/construcción que ya no existe, se resuelve al plan en curso (o el primero).
 */
export function resolveRoute({ stored, plans, plansLoaded, builds, buildsLoaded }: RouteInput): MentorRoute {
  const fallback = (): MentorRoute => {
    const p = plansLoaded ? plans.find((x) => x.status === "activo") ?? plans[0] : undefined;
    return p ? { kind: "plan", planId: p.id } : { kind: "overview", creating: false };
  };
  if (stored.startsWith(PLAN_PREFIX)) {
    const id = stored.slice(PLAN_PREFIX.length);
    return !plansLoaded || plans.some((p) => p.id === id) ? { kind: "plan", planId: id } : fallback();
  }
  if (stored.startsWith(BUILD_PREFIX)) {
    const id = stored.slice(BUILD_PREFIX.length);
    return !buildsLoaded || builds.some((b) => b.id === id) ? { kind: "build", buildId: id } : fallback();
  }
  if ((AUX_VIEWS as readonly string[]).includes(stored)) return { kind: "aux", view: stored as AuxView };
  if (stored === AREAS_VIEW) return { kind: "areas" };
  if (stored === OVERVIEW_VIEW) return { kind: "overview", creating: false };
  if (stored === CREATE_VIEW) return { kind: "overview", creating: true };
  return fallback();
}

// ── Ítems de la barra ───────────────────────────────────────────────────

export interface NavLink {
  id: string;
  label: string;
  /** una línea de apoyo bajo el nombre (p. ej. «1 pendiente de decidir») */
  hint?: string;
  /** el contador de la insignia (p. ej. entregables por decidir) */
  badge?: number;
  subs?: ReadonlyArray<NavLink>;
  /** rótulo de sección que se pinta encima del ítem («Planificación», «Más») */
  section?: string;
  /** el área del ítem (la barra le pone un punto de su color; nunca un emoji) */
  areaId?: string;
}

export const PLAN_NAV_PREFIX = "pl:";
export const RUN_NAV_PREFIX = "ej:";
/** Las sub-vistas de «Mi plan», en el orden de `planSectionsOf` (PlanSections.tsx). */
export const PLAN_SECTION_LINKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "temas", label: "Temas por área" },
  { id: "registros", label: "Registros" },
  { id: "preparar", label: "Preparar" },
];

export const PAGE_GENERAL = "general";
export const PAGE_BASES = "bases";
export const PAGE_ADD_AREA = "add-area";
export const pageAreaId = (subplanId: string): string => `area/${subplanId}`;
/** Las páginas «de Más» que siguen siendo pestañas/sub-vistas de siempre. */
export const MORE_PAGES = ["entregables", "registros", "preparar", "cambios", "practica"] as const;

/**
 * Los ítems del modo Planeación, como un espacio de trabajo: «Vista general», UNA página por área del plan y «Bases» (si el plan las tiene); y,
 * en un grupo secundario «Más», los paneles de apoyo (Entregables, Registros, Preparar plan, Preguntas y ajustes y, si el plan la tiene, la Práctica).
 * La pista de cada área es su avance («3/12»), el mismo de la Ejecución.
 */
export function planeacionLinks(plan: Pick<MentorPlan, "programmingPractice" | "subplans">, pendingDeliverables = 0, opts: { hints?: ReadonlyMap<string, RunHint> } = {}): NavLink[] {
  const hint = (tab: string): { hint?: string } => {
    const h = opts.hints?.get(tab);
    return h?.total ? { hint: `${h.done}/${h.total}` } : {};
  };
  const more = (id: string, label: string, extra: Partial<NavLink> = {}): NavLink => ({ id: `${PLAN_NAV_PREFIX}${id}`, label, ...extra });
  const out: NavLink[] = [
    { id: `${PLAN_NAV_PREFIX}${PAGE_GENERAL}`, label: "Vista general", section: "Planificación" },
    ...orderedAreas(plan).map((a): NavLink => ({ id: `${PLAN_NAV_PREFIX}${pageAreaId(a.subplanId)}`, label: a.area, areaId: a.areaId ?? a.subplanId, ...hint(runAreaTab(a.subplanId)) })),
    { id: `${PLAN_NAV_PREFIX}${PAGE_ADD_AREA}`, label: "Agregar una nueva área" },
    ...(hasBasesRoute(plan) ? [{ id: `${PLAN_NAV_PREFIX}${PAGE_BASES}`, label: "Bases", ...hint("bases") } as NavLink] : []),
  ];
  const pend = pendingDeliverables ? { badge: pendingDeliverables, hint: `${pendingDeliverables} ${pendingDeliverables === 1 ? "pendiente" : "pendientes"} de decidir` } : {};
  out.push(
    more("entregables", "Entregables", { ...pend, section: "Más" }),
    more("registros", "Registros"),
    more("preparar", "Preparar plan"),
    ...(plan.programmingPractice ? [more("practica", "Práctica")] : []),
    more("cambios", "Preguntas y ajustes"),
  );
  return out;
}

/** Las vistas de la Ejecución: «Hoy», una por área, «Bases» (si el plan las tiene), «Proyectos» y «Registros». */
export const RUN_TAB_GENERAL = "general";
export const RUN_TAB_RECORDS = "registros";
export const runAreaTab = (subplanId: string): string => `area:${subplanId}`;
export const runAreaInteractiveTab = (subplanId: string): string => `area:${subplanId}:interactiva`;
export const runAreaInformativeTab = (subplanId: string): string => `area:${subplanId}:informativa`;
export function hasBasesRoute(plan: Pick<MentorPlan, "subplans">): boolean {
  return plan.subplans.some((s) => {
    const g = (s.groups ?? []).find((x) => x.kind === "bases");
    return !!g && s.topics.some((t) => t.group === g.id && t.route !== "skipped");
  });
}
export interface RunLink extends NavLink {
  /** id de la vista en `PlanRun` (la clave persistida `mentor.runTab.<plan>`) */
  tab: string;
  areaId?: string;
}
/** Lo que enseña la pista de un ítem de la Ejecución: temas hechos de su ruta y repasos que tocan hoy o están vencidos. */
export interface RunHint {
  done: number;
  total: number;
  due: number;
}
/** «3/12 · 2 ⟳» (sin temas no hay avance; sin repasos no hay «⟳»); vacío si no hay nada que decir. */
export function runHintText(h: RunHint | undefined): string {
  if (!h) return "";
  return [h.total ? `${h.done}/${h.total}` : "", h.due ? `${h.due} ⟳` : ""].filter(Boolean).join(" · ");
}
/**
 * El avance (temas hechos / de la ruta) y los repasos de hoy de cada área y de las Bases, por id de vista de la Ejecución. Puro: solo recorre la ruta
 * del plan (`areaRouteTopics` / `basesRouteTopics`, la misma regla que la Agenda) y los repasos ya cargados.
 */
export function runHints(plan: Pick<MentorPlan, "subplans">, isDone: (t: { folder: string; completedAt?: string }) => boolean, reviews: ReadonlyArray<ReviewItemLike>): Map<string, RunHint> {
  const out = new Map<string, RunHint>();
  const hint = (topics: ReadonlyArray<{ folder: string; title: string; completedAt?: string }>): RunHint => ({
    done: topics.filter(isDone).length,
    total: topics.length,
    due: reviews.length ? reviewsOfTopics(topics, reviews).filter((r) => r.inDays <= 0).length : 0,
  });
  for (const a of orderedAreas(plan)) out.set(runAreaTab(a.subplanId), hint(areaRouteTopics(plan, a.subplanId)));
  out.set("bases", hint(basesRouteTopics(plan)));
  return out;
}

export interface RunLinkOptions {
  hints?: ReadonlyMap<string, RunHint>;
  /** hoy hay fundamentos (aplicados) en el reparto aunque la ruta no tenga un grupo de Bases */
  basesToday?: boolean;
}
export function ejecucionLinks(plan: Pick<MentorPlan, "subplans">, opts: RunLinkOptions = {}): RunLink[] {
  const link = (tab: string, label: string, extra: Partial<RunLink> = {}): RunLink => {
    const hint = runHintText(opts.hints?.get(tab));
    return { id: `${RUN_NAV_PREFIX}${tab}`, tab, label, ...(hint ? { hint } : {}), ...extra };
  };
  return [
    link(RUN_TAB_GENERAL, "Hoy"),
    ...orderedAreas(plan).map((a) => link(runAreaTab(a.subplanId), a.area, a.areaId ? { areaId: a.areaId } : {})),
    ...(hasBasesRoute(plan) || opts.basesToday ? [link("bases", "Bases")] : []),
    link("proyectos", "Proyectos"),
    link(RUN_TAB_RECORDS, "Registros"),
  ];
}

// ── Claves persistidas por plan ─────────────────────────────────────────

/** La vista elegida de la Ejecución, por plan (antes era estado local de `PlanRun`). */
export const runTabKey = (planId: string): string => `mentor.runTab.${planId}`;

/** La pestaña del plan a enseñar: la guardada si existe (la antigua «semana» es la Agenda; «Práctica» solo si el plan la tiene); si no, «Mi plan». */
export function normalizeTab(stored: string, hasPractice: boolean): PlanTab {
  const t = stored === "semana" ? "agenda" : stored;
  return (PLAN_TABS as readonly string[]).includes(t) && (t !== "practica" || hasPractice) ? (t as PlanTab) : "plan";
}

/** A qué página de Planeación lleva el estado guardado del plan (pestaña, sub-vista de «Mi plan» y área elegida). */
export type PlanPage =
  | { kind: "general" }
  | { kind: "area"; subplanId: string }
  | { kind: "bases" }
  /** una sub-vista de «Mi plan» que sigue siendo página propia (Registros, Preparar plan) */
  | { kind: "section"; id: "registros" | "preparar" }
  | { kind: "tab"; tab: "entregables" | "cambios" | "practica" };

/**
 * Las claves antiguas (`mentor.planTab`, `mentor.planSection`, `mentor.agendaArea`) siguen mandando y se leen así: la Agenda (y cualquier
 * enlace a una fecha) es la página del área elegida —o la Vista general si no hay—, y «Mi plan»: Resumen y Temas por área, la Vista general.
 */
export function resolvePlanPage(tab: string, section: string, agendaArea: string, subplanIds: ReadonlyArray<string>, hasPractice: boolean): PlanPage {
  const t = normalizeTab(tab, hasPractice);
  if (t === "agenda") return agendaArea === BASES_KEY ? { kind: "bases" } : subplanIds.includes(agendaArea) ? { kind: "area", subplanId: agendaArea } : { kind: "general" };
  if (t === "plan") {
    const sec = sectionAlias(section.replace(/^sec-/, ""));
    return sec === "registros" || sec === "preparar" ? { kind: "section", id: sec } : { kind: "general" };
  }
  return { kind: "tab", tab: t };
}

/** El id de ítem de la barra de Planeación que corresponde a una página. */
export function pageNavId(p: PlanPage): string {
  switch (p.kind) {
    case "general":
      return `${PLAN_NAV_PREFIX}${PAGE_GENERAL}`;
    case "area":
      return `${PLAN_NAV_PREFIX}${pageAreaId(p.subplanId)}`;
    case "bases":
      return `${PLAN_NAV_PREFIX}${PAGE_BASES}`;
    case "section":
      return `${PLAN_NAV_PREFIX}${p.id}`;
    default:
      return `${PLAN_NAV_PREFIX}${p.tab}`;
  }
}
/** El id de ítem activo de Planeación a partir de lo guardado. */
export const activePlaneacionId = (tab: string, section: string, agendaArea: string, subplanIds: ReadonlyArray<string>, hasPractice: boolean): string =>
  pageNavId(resolvePlanPage(tab, section, agendaArea, subplanIds, hasPractice));

/** Aplica la elección de un ítem de Planeación: escribe las mismas claves que leen `PlanView` y la página del área (y los enlaces profundos). */
export function selectPlaneacion(planId: string, id: string): void {
  const nav = useNavState.getState();
  const rest = id.slice(PLAN_NAV_PREFIX.length);
  const setArea = (v: string): void => nav.set(agendaAreaKey(planId), v);
  if (rest === PAGE_GENERAL) {
    nav.set(planTabKey(planId), "plan");
    nav.set(planSectionKey(planId), "resumen");
    setArea("");
  } else if (rest === PAGE_BASES) {
    nav.set(planTabKey(planId), "agenda");
    setArea(BASES_KEY);
  } else if (rest.startsWith("area/")) {
    nav.set(planTabKey(planId), "agenda");
    setArea(rest.slice("area/".length));
  } else if (rest === "registros" || rest === "preparar") {
    nav.set(planTabKey(planId), "plan");
    nav.set(planSectionKey(planId), rest);
  } else if ((PLAN_TABS as readonly string[]).includes(rest)) nav.set(planTabKey(planId), rest);
}

/** La vista de la Ejecución donde vive un tema: la de Bases (fundamentos) o la de su área. */
export const runTabOfTopic = (t: { bases?: boolean; subplanId: string }): string => (t.bases ? "bases" : runAreaTab(t.subplanId));

/** Abre la Ejecución de un plan en una vista (enlace profundo interno: «Ver en Ejecución»). */
export function openRunView(planId: string, tab: string = RUN_TAB_GENERAL): void {
  const nav = useNavState.getState();
  nav.set(runTabKey(planId), tab);
  nav.set(MODE_KEY, "ejecucion");
  nav.set("mentor.view", `${PLAN_PREFIX}${planId}`);
}

export function selectEjecucion(planId: string, id: string): void {
  useNavState.getState().set(runTabKey(planId), id.slice(RUN_NAV_PREFIX.length));
}

export const TOPIC_HIGHLIGHT_KEY = "mentor.highlightTopic";

/** Abre la Planeación de un plan en la interfaz de temas del área donde vive la nota (o la página general). */
export async function openPlanTopic(planId?: string, folder?: string, areaKey?: string): Promise<void> {
  const nav = useNavState.getState();
  const id = planId || (nav.values["mentor.view"]?.toString().startsWith(PLAN_PREFIX) ? nav.values["mentor.view"].toString().slice(PLAN_PREFIX.length) : "");
  if (!id) return;
  if (folder) {
    nav.set(TOPIC_HIGHLIGHT_KEY, folder);
  }
  nav.set(MODE_KEY, "planeacion");
  nav.set("mentor.view", `${PLAN_PREFIX}${id}`);

  let resolvedSubplanId: string | null = null;
  let isBases = areaKey === "bases" || areaKey === BASES_KEY;

  try {
    const res = await api.mentorPlanGet(id);
    const plan = res && !res.loading ? res.plan : null;
    if (plan) {
      if (folder) {
        const isBase = basesClassifier(plan);
        for (const s of plan.subplans) {
          const t = s.topics.find((topic) => topic.folder === folder);
          if (t && isBase({ subplanId: s.id, group: t.group })) {
            isBases = true;
            break;
          }
        }
      }
      if (!isBases) {
        const sub =
          (folder ? plan.subplans.find((s) => s.topics.some((t) => t.folder === folder)) : undefined) ??
          (areaKey ? plan.subplans.find((s) => s.id === areaKey || s.areaId === areaKey || s.area.toLowerCase() === areaKey.toLowerCase()) : undefined);
        if (sub) {
          resolvedSubplanId = sub.id;
        }
      }
    }
  } catch {
    // fallback if bridge is unavailable
  }

  if (isBases) {
    selectPlaneacion(id, `${PLAN_NAV_PREFIX}${PAGE_BASES}`);
    nav.set(agendaAreaKey(id), BASES_KEY);
    nav.set(pageTabKey(id, BASES_KEY), "temas");
    nav.set(planTabKey(id), "agenda");
  } else if (resolvedSubplanId || areaKey) {
    const subId = resolvedSubplanId || areaKey!;
    selectPlaneacion(id, `${PLAN_NAV_PREFIX}${pageAreaId(subId)}`);
    nav.set(agendaAreaKey(id), subId);
    nav.set(pageTabKey(id, subId), "temas");
    nav.set(planTabKey(id), "agenda");
  } else {
    selectPlaneacion(id, `${PLAN_NAV_PREFIX}${PAGE_GENERAL}`);
    nav.set(agendaAreaKey(id), "");
    nav.set(pageTabKey(id, "all"), "area");
  }
}

/** Abre la vista general de la Planeación del plan. */
export function openPlanGeneral(planId?: string): void {
  const nav = useNavState.getState();
  const id = planId || (nav.values["mentor.view"]?.toString().startsWith(PLAN_PREFIX) ? nav.values["mentor.view"].toString().slice(PLAN_PREFIX.length) : "");
  if (!id) return;
  nav.set(MODE_KEY, "planeacion");
  nav.set("mentor.view", `${PLAN_PREFIX}${id}`);
  selectPlaneacion(id, `${PLAN_NAV_PREFIX}${PAGE_GENERAL}`);
  nav.set(planTabKey(id), "plan");
  nav.set(agendaAreaKey(id), "");
  nav.set(pageTabKey(id, "all"), "semana");
}

/** Abre el calendario / agenda de la Planeación del plan. */
export function openPlanAgenda(planId?: string, areaKey?: string): void {
  const nav = useNavState.getState();
  const id = planId || (nav.values["mentor.view"]?.toString().startsWith(PLAN_PREFIX) ? nav.values["mentor.view"].toString().slice(PLAN_PREFIX.length) : "");
  if (!id) return;
  nav.set(MODE_KEY, "planeacion");
  nav.set("mentor.view", `${PLAN_PREFIX}${id}`);
  selectPlaneacion(id, `${PLAN_NAV_PREFIX}${PAGE_GENERAL}`);
  nav.set(planTabKey(id), "agenda");
  nav.set(agendaAreaKey(id), "");
  nav.set(agendaViewKey(id), "calendario");
  nav.set(pageTabKey(id, "all"), "calendario");
  if (areaKey) {
    nav.set(pageTabKey(id, areaKey), "calendario");
  }
}
