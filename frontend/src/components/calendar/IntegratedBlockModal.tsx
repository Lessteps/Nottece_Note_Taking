// Modal interactivo que se despliega al dar clic a un Bloque Integrado en el Calendario.
// Desglosa las asignaturas y sub-eventos del área (sincronizados con Mentor), permitiendo
// ver los temas de hoy, los siguientes de la ruta para adelantar, o el temario completo,
// y ofrece accesos directos rápidos a Ver tema (.md), Ver práctica y Canvas explicativo.

import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Code2,
  ExternalLink,
  Layers,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/bridge";
import { buildSchedule, progressPlan } from "../../lib/planSchedule";
import { dayByArea } from "../../lib/planTopicsByArea";
import type { MentorPlan, MentorPlannedTopic, MentorSubplan } from "../../lib/types";
import { useApp } from "../../store/app";
import { useCalendar } from "../../store/calendar";
import { openTopic, openTopicCanvas, openTopicNote } from "../mentor/openTopic";
import { cn } from "../ui";

const SUBJECT_METADATA: Record<string, { label: string; icon: string }> = {
  bases: { label: "Fundamentos de programación (Bases)", icon: "🏛️" },
  "lang-python": { label: "Lenguaje: Python", icon: "🐍" },
  "backend-fundamentals": { label: "Backend fundamentals", icon: "⚙️" },
  "architecture-and-frameworks": { label: "Architecture and frameworks", icon: "🏗️" },
  "security-and-reliability": { label: "Security and reliability", icon: "🔒" },
  "processes-and-connected-systems": { label: "Processes and connected systems", icon: "🔄" },
  "quality-and-operations": { label: "Quality and operations", icon: "🧪" },
  "lang-javascript": { label: "Lenguaje: JavaScript", icon: "📜" },
  "lang-typescript": { label: "Lenguaje: TypeScript", icon: "🔷" },
  html: { label: "HTML y Semántica Web", icon: "🌐" },
  css: { label: "CSS, Estilos y Maquetación", icon: "🎨" },
  core: { label: "Conocimientos Principales", icon: "💡" },
  databases: { label: "Bases de Datos", icon: "🗄️" },
  logic: { label: "Lógica y Algoritmos", icon: "🧩" },
};

interface DayTopicItem {
  folder: string;
  title: string;
  group?: string;
  groupTitle?: string;
  done?: boolean;
  minutes?: number;
  completedAt?: string;
  isToday?: boolean;
}

export function IntegratedBlockModal() {
  const occ = useCalendar((s) => s.integratedBlockOcc);
  const close = useCalendar((s) => s.closeIntegratedBlock);
  const setModule = useApp((s) => s.setModule);

  const [plan, setPlan] = useState<MentorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubplanId, setActiveSubplanId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [viewScope, setViewScope] = useState<"day" | "all">("day");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!occ) return;
    let cancel = false;
    setLoading(true);

    (async () => {
      try {
        const link = occ.links?.find((l) => l.type === "integrated_block" || l.type === "mentor_day");
        const planId = link?.planId || link?.id;

        let active: MentorPlan | null = null;
        if (planId) {
          const res = await api.mentorPlanGet(planId);
          if (res && "plan" in res && res.plan) active = res.plan;
        }

        if (!active) {
          const list = await api.mentorPlanList();
          const found = list.find((p) => p.status === "activo") || list[0];
          if (found) {
            const res = await api.mentorPlanGet(found.id);
            if (res && "plan" in res && res.plan) active = res.plan;
          }
        }

        if (cancel) return;
        setPlan(active);

        const subIdFromLink = link?.subplanId || "";
        const initial = active?.subplans?.find((s) =>
          subIdFromLink
            ? s.id === subIdFromLink || s.areaId === subIdFromLink
            : s.areaId === "backend" || s.id.includes("backend")
        ) || active?.subplans?.[0];

        if (initial) {
          setActiveSubplanId(initial.id);
        }
      } catch (err) {
        console.error("Error cargando plan para bloque integrado:", err);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [occ]);

  // Cerrar con Escape
  useEffect(() => {
    if (!occ) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [occ, close]);

  const activeSubplan = useMemo<MentorSubplan | null>(() => {
    if (!plan?.subplans?.length) return null;
    return plan.subplans.find((s) => s.id === activeSubplanId) || plan.subplans[0] || null;
  }, [plan, activeSubplanId]);

  // Temas del día según la lógica del plan del Mentor
  const dayTopics = useMemo<DayTopicItem[]>(() => {
    if (!occ) return [];

    // 1. Si los sub-eventos vienen directamente en el enlace de la ocurrencia
    const blockLink = occ.links?.find((l) => l.type === "integrated_block");
    if (blockLink && Array.isArray(blockLink.topics) && blockLink.topics.length > 0) {
      if (!blockLink.subplanId || blockLink.subplanId === activeSubplanId || !activeSubplanId) {
        return (blockLink.topics as DayTopicItem[]).map((t) => ({ ...t, isToday: true }));
      }
    }

    // 2. Si no están en links o cambiamos de subplan, calcular con progressPlan y buildSchedule
    if (plan && activeSubplan) {
      try {
        const prog = progressPlan(plan as never, { today: occ.date });
        const sch = buildSchedule(prog as never);
        const daySchedule = sch.byDate.get(occ.date);
        if (daySchedule) {
          const entries = dayByArea(prog as never, daySchedule, []);
          const areaEntry = entries.find(
            (e) => e.subplanId === activeSubplan.id || (activeSubplan.areaId && e.areaId === activeSubplan.areaId)
          );
          if (areaEntry?.blocks?.length) {
            const blockItems = areaEntry.blocks.flatMap((bl) =>
              bl.items.map((it) => ({
                folder: it.folder,
                title: it.title,
                group: it.group,
                groupTitle: it.groupTitle,
                done: Boolean((it as any).done),
                minutes: it.minutes,
                isToday: true,
              }))
            );
            if (blockItems.length > 0) return blockItems;
          }

          if (daySchedule.topics) {
            const list = daySchedule.topics.filter(
              (t) =>
                (t.subplanId === activeSubplan.id || (activeSubplan.areaId && t.areaId === activeSubplan.areaId)) &&
                t.group !== "bases"
            );
            if (list.length > 0) {
              return list.map((t) => ({
                folder: t.folder,
                title: t.title,
                group: t.group,
                groupTitle: t.groupTitle,
                done: t.done,
                minutes: t.minutes,
                isToday: true,
              }));
            }
          }
        }
      } catch (e) {
        console.error("Error calculando horario del día:", e);
      }
    }

    return [];
  }, [occ, plan, activeSubplanId, activeSubplan]);

  // Agrupación de temas por asignatura con soporte para los temas de hoy y los siguientes de su ruta
  const groupsWithTopics = useMemo(() => {
    if (!activeSubplan) return [];
    const q = search.trim().toLowerCase();

    // En Mentor, las asignaturas del área son sus grupos principales.
    // Los fundamentos (bases) se muestran si están en los temas de hoy o si el grupo no es kind: "bases"
    const own = (activeSubplan.groups ?? []).filter((g) => {
      if (g.kind === "bases") {
        return dayTopics.some((t) => t.group === g.id);
      }
      return true;
    });
    const rawGroups =
      own.length > 0
        ? own
        : activeSubplan.groups?.length
          ? activeSubplan.groups
          : [{ id: "general", title: "Asignatura general" }];

    const todayFolderSet = new Set(dayTopics.map((t) => t.folder));
    const allTopics = (activeSubplan.topics || []) as MentorPlannedTopic[];

    const result = rawGroups.map((g) => {
      const meta = SUBJECT_METADATA[g.id] || { label: g.title || g.id, icon: "📚" };
      const groupAllTopics = allTopics.filter((t) => (t.group || "core") === g.id);
      const doneCount = groupAllTopics.filter((t) => Boolean(t.completedAt)).length;
      const totalCount = groupAllTopics.length;
      const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
      const pendingCount = totalCount - doneCount;

      let displayTopics: DayTopicItem[] = [];

      if (viewScope === "day") {
        // 1. Temas programados para hoy en esta asignatura
        const todayItems: DayTopicItem[] = dayTopics
          .filter(
            (t) =>
              (t.group || "core") === g.id ||
              groupAllTopics.some((gt) => gt.folder === t.folder)
          )
          .map((t) => ({ ...t, isToday: true }));

        const taken = new Set(todayItems.map((t) => t.folder));

        // 2. Rellenar con los siguientes de su ruta (hasta 4 temas por asignatura, igual que en Mentor AreaWork)
        const nextItems: DayTopicItem[] = groupAllTopics
          .filter((t) => !t.completedAt && !taken.has(t.folder))
          .slice(0, Math.max(0, 4 - todayItems.length))
          .map((t) => ({
            folder: t.folder,
            title: t.title,
            group: t.group,
            groupTitle: g.title || meta.label,
            done: false,
            minutes: t.estMinutes,
            isToday: false,
          }));

        displayTopics = [...todayItems, ...nextItems];
      } else {
        // Vista completa de todo el temario de la asignatura
        displayTopics = groupAllTopics.map((t) => ({
          folder: t.folder,
          title: t.title,
          group: t.group,
          groupTitle: g.title || meta.label,
          done: Boolean(t.completedAt),
          completedAt: t.completedAt,
          minutes: t.estMinutes,
          isToday: todayFolderSet.has(t.folder),
        }));
      }

      if (q) {
        displayTopics = displayTopics.filter(
          (t) => t.title.toLowerCase().includes(q) || t.folder.toLowerCase().includes(q)
        );
      }

      const todayInGroupCount = displayTopics.filter((t) => t.isToday).length;

      return {
        id: g.id,
        title: meta.label || g.title,
        icon: meta.icon,
        topics: displayTopics,
        todayCount: todayInGroupCount,
        total: totalCount,
        completed: doneCount,
        pct,
        pendingCount,
      };
    });

    if (q) {
      return result.filter((g) => g.topics.length > 0);
    }

    return result.filter((g) => g.total > 0);
  }, [activeSubplan, dayTopics, search, viewScope]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  if (!occ) return null;

  const totalDayTopics = dayTopics.length;
  const totalAllTopics = activeSubplan?.topics?.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={close}
      data-testid="integrated-block-modal"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-card text-text shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Bloque Integrado"
      >
        {/* Cabecera */}
        <div className="flex flex-none items-center justify-between border-b border-line px-6 py-4 bg-surface/50">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent font-bold">
              <Layers size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-semibold text-text">
                  Bloque Integrado: {activeSubplan?.area || occ.title.replace(/^⚡\s*(Bloque Integrado:\s*)?/, "")}
                </h2>
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                  Conectado con Mentor
                </span>
              </div>
              <div className="flex items-center gap-3 text-[12px] text-dim">
                <span className="inline-flex items-center gap-1">
                  <Calendar size={13} /> {occ.date}
                </span>
                {occ.start && (
                  <span className="inline-flex items-center gap-1">
                    <Clock size={13} /> {occ.start} ({occ.duration_min ?? 60}m)
                  </span>
                )}
                <span>
                  · {totalDayTopics} {totalDayTopics === 1 ? "tema programado para hoy" : "temas programados para hoy"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                close();
                setModule("mentor");
              }}
              title="Abrir en módulo Mentor"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-dim hover:bg-hover hover:text-text transition-colors"
            >
              <ExternalLink size={13} /> Abrir en Mentor
            </button>
            <button
              type="button"
              onClick={close}
              className="grid h-8 w-8 place-items-center rounded-lg text-dim hover:bg-hover hover:text-text transition-colors"
              aria-label="Cerrar modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Pestañas de Eventos Compuestos si hay más de un subplan */}
        {plan && plan.subplans && plan.subplans.length > 1 && (
          <div className="flex flex-none items-center gap-1 border-b border-line px-6 py-2 bg-surface/30 overflow-x-auto">
            <span className="mr-2 text-[11px] font-mono uppercase tracking-wider text-faint">
              Área:
            </span>
            {plan.subplans.map((sub) => {
              const isActive = sub.id === activeSubplan?.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setActiveSubplanId(sub.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12.5px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-white shadow-xs"
                      : "text-dim hover:bg-hover hover:text-text"
                  )}
                >
                  <span>{sub.area}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Barra de control: Selección de temas de hoy vs temario completo y buscador */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-2.5 bg-card">
          {/* Selector de alcance: Día vs Todo el plan */}
          <div className="flex items-center rounded-lg bg-surface p-0.5 border border-line">
            <button
              type="button"
              onClick={() => setViewScope("day")}
              className={cn(
                "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                viewScope === "day"
                  ? "bg-card text-accent font-semibold shadow-xs"
                  : "text-dim hover:text-text"
              )}
            >
              📅 Temas de este día y ruta ({totalDayTopics} hoy)
            </button>
            <button
              type="button"
              onClick={() => setViewScope("all")}
              className={cn(
                "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                viewScope === "all"
                  ? "bg-card text-accent font-semibold shadow-xs"
                  : "text-dim hover:text-text"
              )}
            >
              📚 Temario completo ({totalAllTopics})
            </button>
          </div>

          {/* Buscador */}
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tema o asignatura..."
              className="w-full rounded-lg border border-line bg-surface py-1 pl-8 pr-3 text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-hidden"
            />
          </div>
        </div>

        {/* Contenido: Asignaturas y sub-eventos internos */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-dim text-[13px]">
              Cargando asignaturas y temas del bloque...
            </div>
          ) : groupsWithTopics.length === 0 ? (
            <div className="py-12 text-center text-dim text-[13px] space-y-2">
              <p>No se encontraron temas con el filtro actual.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setViewScope("day");
                }}
                className="text-accent underline hover:opacity-85 text-[12.5px]"
              >
                Restablecer vista
              </button>
            </div>
          ) : (
            groupsWithTopics.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.id]);
              return (
                <div
                  key={group.id}
                  className="rounded-xl border border-line bg-surface/40 overflow-hidden shadow-2xs"
                  data-testid={`subject-group-${group.id}`}
                >
                  {/* Encabezado de Asignatura */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-hover/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-[16px]">{group.icon}</span>
                      <span className="font-semibold text-[14px] text-text truncate">{group.title}</span>
                      <span className="text-[12px] font-medium text-dim">
                        {group.completed}/{group.total} ({group.pct}%)
                      </span>
                      {viewScope === "day" && group.todayCount > 0 && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-mono font-medium text-accent">
                          {group.todayCount} hoy
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-faint flex-none">
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>

                  {/* Mensaje informativo si hoy no toca nada de esta asignatura */}
                  {!isCollapsed && viewScope === "day" && group.todayCount === 0 && (
                    <div className="px-4 py-2 text-[12.5px] text-dim bg-surface/30 border-t border-line/40">
                      Hoy no toca nada de esta asignatura ({group.pendingCount}{" "}
                      {group.pendingCount === 1 ? "tema pendiente" : "temas pendientes"}): estos son los siguientes de su ruta.
                    </div>
                  )}

                  {/* Lista de temas de la asignatura */}
                  {!isCollapsed && (
                    <div className="border-t border-line/60 divide-y divide-line/40 bg-card/60">
                      {group.topics.map((topic) => {
                        const isDone = Boolean(topic.done || topic.completedAt);
                        return (
                          <div
                            key={topic.folder}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/40 transition-colors"
                            data-testid={`topic-row-${topic.folder}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {isDone ? (
                                <CheckCircle2 size={16} className="text-emerald-500 flex-none" />
                              ) : (
                                <Circle size={16} className="text-faint flex-none" />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-medium text-text truncate">
                                    {topic.title}
                                  </span>
                                  {viewScope === "day" && (
                                    topic.isToday ? (
                                      <span className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-accent-text border border-accent/40 flex-none">
                                        HOY
                                      </span>
                                    ) : (
                                      <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-faint border border-line flex-none">
                                        SIGUIENTE
                                      </span>
                                    )
                                  )}
                                  {typeof topic.minutes === "number" && topic.minutes > 0 && (
                                    <span className="font-mono text-[10.5px] text-faint flex-none">
                                      · {topic.minutes} min
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-faint truncate">
                                  {topic.folder}
                                </div>
                              </div>
                            </div>

                            {/* Botones de acción rápida */}
                            <div className="flex items-center gap-1.5 flex-none">
                              <button
                                type="button"
                                onClick={() => void openTopicNote(topic.folder)}
                                title="Ver tema: Abrir apunte teórico (.md)"
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-dim hover:border-accent hover:text-accent hover:bg-hover transition-colors"
                              >
                                <BookOpen size={12} /> Ver tema
                              </button>

                              <button
                                type="button"
                                onClick={() => void openTopic(topic.folder)}
                                title="Ver práctica: Abrir archivo de ejercicios o práctica"
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-dim hover:border-accent hover:text-accent hover:bg-hover transition-colors"
                              >
                                <Code2 size={12} /> Ver práctica
                              </button>

                              <button
                                type="button"
                                onClick={() => void openTopicCanvas(topic.folder)}
                                title="Canvas explicativo: Abrir mapa conceptual (.canvas)"
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-dim hover:border-accent hover:text-accent hover:bg-hover transition-colors"
                              >
                                <Workflow size={12} /> Canvas explicativo
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pie del modal */}
        <div className="flex flex-none items-center justify-between border-t border-line px-6 py-3 bg-surface/50 text-[12px] text-dim">
          <span>
            ⚡ Bloque de Backend · Asignaturas y temas sincronizados con la planificación del Mentor.
          </span>
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-line bg-card px-4 py-1.5 text-[12px] font-medium text-text hover:bg-hover transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
