// Mentor — Plan, sub-vista «Temas por área»: una sub-barra con TODAS las áreas del plan (se actualiza sola con el plan) y, dentro de cada área,
// otra sub-barra con sus grupos (Bases, Lenguaje, Conocimientos…) y la tabla de sus temas en el orden de la ruta, con lo que existe de cada uno
// y el botón «Generar todo». Sustituye a las tarjetas: la información es la misma que la del catálogo, pero ordenada por área.
//
// Regenerar es visible a tres niveles: una casilla por tema + una barra de acciones sobre la tabla (teoría, mapa, práctica, ejercicios, «lo que falta»)
// que trabaja con los temas elegidos (cola de uno en uno, `TopicBulk`); cuatro iconos de acción rápida al final de cada fila; y el panel
// desplegable de cada tema (`TopicRegenerate`) con el estado de cada pieza. Siempre reemplaza con copia de seguridad y confirmación.
// Un filtro por estado (falta nota / mapa / práctica / ejercicios / completo) ayuda a elegir.
//
// Los datos salen del plan (áreas, grupos, semanas) y de `mentor_plan_topic_catalog` (lo que existe en la vault); la lógica está en
// `lib/planAreaTopics.ts`. Solo lectura salvo «Generar», que pasa siempre por el diálogo de confirmación de «Ejecutar plan».

import { Check, ChevronDown, ChevronLeft, ChevronRight, Edit3, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { exercisesGap, isOutdated, matchesStatus, planBulk, regenBlockedReason, STATUS_FILTERS, type BulkPlan, type RegenKind, type StatusFilter } from "../../lib/topicSelection";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useNavState } from "../../store/navState";
import { TOPIC_HIGHLIGHT_KEY } from "./mentorNav";
import { type AreaTopicRow, areaTabsOf, areaTopicRows, basesTopicRows, BASES_KEY, groupTabsOf, pendingGenerate, rowsOfGroup, type AreaTab, type GroupTab } from "../../lib/planAreaTopics";
import { ROUTE_LABEL } from "../../lib/planRoute";
import { buildSchedule, progressPlan, type PlanSchedule } from "../../lib/planSchedule";
import { timeTagOf, topicTimes } from "../../lib/planTopicTime";
import { todayIso } from "../../lib/tasks";
import type { MentorPlan } from "../../lib/types";
import { Chip, Field, GhostButton, input, Modal, PrimaryButton } from "../common/forms";
import { cn } from "../ui";
import { TimeChip, TopicMenu } from "./PlanBoard";
import { LoadState, ProgressBar } from "./parts";
import { SectionHeading } from "./planKit";
import { usePlanTopicCatalog } from "./PlanTopicCatalog";
import { ExecuteDialog } from "./PlanExecution";
import { ExternalTasks } from "./ExternalTasks";
import { BulkConfirm, BulkProgress, BulkToolbar, RowQuickActions, useRegenQueue, type SelectHelper } from "./TopicBulk";
import { areaScope, GenerateButton, GenerateTopicButton, topicScope } from "./TopicGenerate";
import { TopicInsight } from "./TopicInsight";
import { RegeneratePanel } from "./TopicRegenerate";
import { AddToPlanDialog } from "./AddToPlanDialog";
import { MethodologyCheckButton } from "./MethodologyCheck";
import { PlanReviewScreen } from "./PlanReviewScreen";
import type { PlanReview } from "../../lib/types";

/** Una sub-barra de pestañas (botones con `aria-pressed`) con scroll horizontal, soporte de rueda de ratón y flechas de navegación si desborda. */
function TabBar<T extends { key: string; label: string; hint?: string; hintLabel?: string }>({
  label,
  tabs,
  active,
  onSelect,
  level,
  testid,
}: {
  label: string;
  tabs: ReadonlyArray<T>;
  active: string;
  onSelect: (key: string) => void;
  level: 1 | 2;
  testid: string;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = listRef.current;
    if (!el) return;
    if (typeof ResizeObserver !== "undefined") {
      const obs = new ResizeObserver(() => checkScroll());
      obs.observe(el);
      return () => obs.disconnect();
    }
  }, [checkScroll, tabs]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !active) return;
    const btn = el.querySelector<HTMLElement>(`[data-testid="${testid}-${active || "all"}"]`);
    if (btn) {
      const containerRect = el.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.left < containerRect.left) {
        el.scrollLeft -= containerRect.left - btnRect.left + 24;
      } else if (btnRect.right > containerRect.right) {
        el.scrollLeft += btnRect.right - containerRect.right + 24;
      }
    }
    checkScroll();
  }, [active, testid, checkScroll]);

  const scrollByDelta = (delta: number) => {
    const el = listRef.current;
    if (!el) return;
    // el paso sigue al ancho visible: en una ventana estrecha avanza un «tramo» útil, no 200 px fijos
    const step = Math.max(160, Math.round(el.clientWidth * 0.6));
    el.scrollBy({ left: Math.sign(delta) * step, behavior: "smooth" });
  };

  return (
    <nav aria-label={label} data-testid={testid} className="group/tabbar relative min-w-0 max-w-full flex-1">
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Desplazar pestañas hacia la izquierda"
          onClick={() => scrollByDelta(-200)}
          className="absolute left-0 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/95 text-text shadow-md backdrop-blur hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
      )}
      <ul
        ref={listRef}
        onScroll={checkScroll}
        onWheel={(e) => {
          const el = listRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          el.scrollLeft += e.deltaY;
          checkScroll();
        }}
        className={cn(
          "flex gap-1 overflow-x-auto py-1 scroll-smooth [scrollbar-width:thin] [scrollbar-color:var(--nv-line-strong)_transparent]",
          level === 1 ? "border-b border-line" : "",
        )}
      >
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key} className="flex-none">
              <button
                type="button"
                aria-pressed={on}
                aria-current={on ? "page" : undefined}
                onClick={() => onSelect(t.key)}
                data-testid={`${testid}-${t.key || "all"}`}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 font-medium transition-colors",
                  level === 1 ? "min-h-10 text-[14.5px]" : "min-h-9 text-[13.5px]",
                  on ? "border-accent bg-accent-soft text-accent-text" : "border-transparent text-dim hover:bg-hover hover:text-text",
                )}
              >
                {t.label}
                {t.hint && (
                  <span className="rounded-md bg-hover px-1.5 text-[12px] text-dim">
                    <span aria-hidden>{t.hint}</span>
                    <span className="sr-only"> ({t.hintLabel ?? t.hint})</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {canScrollRight && (
        <button
          type="button"
          aria-label="Desplazar pestañas hacia la derecha"
          onClick={() => scrollByDelta(200)}
          className="absolute right-0 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/95 text-text shadow-md backdrop-blur hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
    </nav>
  );
}

const areaTabsView = (tabs: AreaTab[]) => tabs.map((t) => ({ key: t.key, label: t.area, ...(t.missing > 0 ? { hint: String(t.missing), hintLabel: `${t.missing} por generar` } : {}) }));
const groupTabsView = (tabs: GroupTab[], reviews: PlanReview[] = []) =>
  tabs.map((t) => {
    const hasReview = reviews.some((r) => r.groupId === t.id);
    return {
      key: t.id,
      label: t.title,
      hint: hasReview ? "Por revisar" : String(t.total),
      hintLabel: hasReview ? "Por revisar" : `${t.total} ${t.total === 1 ? "tema" : "temas"}${t.missing ? `, ${t.missing} por generar` : ""}`,
    };
  });

/** Anillo de avance de un tema (el mismo lenguaje visual que el resumen del área): el número va dentro y el color solo acompaña. */
function Ring({ pct, done }: { pct: number; done: boolean }) {
  const v = done ? 100 : Math.max(0, Math.min(100, Math.round(pct)));
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid h-9 w-9 place-items-center" data-testid="topic-ring" data-pct={v} role="img" aria-label={`Avance ${v} %`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className="stroke-hover" />
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} style={{ stroke: v >= 100 ? "var(--nv-mint)" : "var(--nv-accent)" }} />
      </svg>
      <span className="text-[10px] font-semibold tabular-nums" aria-hidden>{v}%</span>
    </span>
  );
}

/** Piezas hechas con una versión anterior de su skill → qué regenerar y cómo se llama. */
const OUTDATED_KINDS = [
  { key: "theory", what: "theory", label: "Nota", full: "la nota de teoría" },
  { key: "canvas", what: "map", label: "Mapa", full: "el mapa" },
  { key: "practica", what: "practice", label: ".practica", full: "el manifiesto .practica" },
  { key: "exercises", what: "exercises", label: "Ejercicios", full: "los ejercicios" },
] as const;

/** Botones verdes junto al tema: la skill cambió después de generar esa pieza. Pulsar pide confirmar y regenera (con copia de seguridad). */
function OutdatedButtons({ row, busy, onAsk }: { row: AreaTopicRow; busy: boolean; onAsk: (what: RegenKind, row: AreaTopicRow) => void }) {
  const list = OUTDATED_KINDS.filter((k) => row.outdated?.[k.key]);
  const ex = exercisesGap(row);
  if (list.length === 0 && !ex) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-testid="outdated-buttons">
      {ex && !row.outdated?.exercises && (() => {
        const why = busy ? "Hay una regeneración en curso." : regenBlockedReason(row, ex.what);
        return (
          <button
            type="button"
            disabled={!!why}
            onClick={() => onAsk(ex.what, row)}
            title={why || ex.title}
            aria-label={`Generar los ejercicios de ${row.title}: ${ex.title}`}
            data-testid="outdated-exercises-gap"
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-mint bg-mint/15 px-2 text-[12.5px] font-medium text-mint hover:bg-mint/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} aria-hidden /> Ejercicios{ex.missing > 0 && row.exercises > 0 ? ` (+${ex.missing})` : ""}
          </button>
        );
      })()}
      {list.map((k) => {
        const why = busy ? "Hay una regeneración en curso." : regenBlockedReason(row, k.what);
        return (
          <button
            key={k.key}
            type="button"
            disabled={!!why}
            onClick={() => onAsk(k.what, row)}
            title={why || `La skill cambió después de generar ${k.full}: regenerarla con la versión nueva (respalda lo actual)`}
            aria-label={`Regenerar ${k.full} de ${row.title}: la skill cambió`}
            data-testid={`outdated-${k.key}`}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-mint bg-mint/15 px-2 text-[12.5px] font-medium text-mint hover:bg-mint/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={12} aria-hidden /> {k.label}
          </button>
        );
      })}
    </span>
  );
}

function Mark({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1"><Check size={14} aria-hidden className="text-mint" /> {yes}</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-warn"><X size={14} aria-hidden /> {no}</span>
  );
}

const TITLE_W_KEY = "nv.areaTable.titleW";
const TITLE_W_MIN = 220;
const TITLE_W_MAX = 900;
const clampTitleW = (n: number): number => Math.min(TITLE_W_MAX, Math.max(TITLE_W_MIN, Math.round(n)));

/** Ancho de la columna «Tema» (arrastrable, se recuerda en el navegador): el nombre del tema siempre se lee entero. */
function useTitleWidth(): [number, (n: number) => void, (e: React.PointerEvent<HTMLElement>) => void] {
  const [w, setW] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(TITLE_W_KEY));
      return v ? clampTitleW(v) : 384;
    } catch {
      return 384;
    }
  });
  const set = (n: number): void => {
    const v = clampTitleW(n);
    setW(v);
    try {
      localStorage.setItem(TITLE_W_KEY, String(v));
    } catch {
      /* sin almacenamiento: solo no se recuerda */
    }
  };
  const start = (e: React.PointerEvent<HTMLElement>): void => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = w;
    const move = (ev: PointerEvent): void => setW(clampTitleW(w0 + ev.clientX - x0));
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      set(w0 + ev.clientX - x0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return [w, set, start];
}

export function PlanAreaTopics({ plan, schedule, today, started, progress, only }: { plan: MentorPlan; /** fija la página en UN área (su subplan o «__bases»): sin barra de áreas, la de la página del área */ only?: string; /** avance (0–100) de cada tema, de la práctica: el mismo que enseña el resumen del área */ progress?: ReadonlyMap<string, number>; /** el reparto del plan (si no se da, se calcula) */ schedule?: PlanSchedule; today?: string; /** ¿ha empezado la ruta? (si no se da, cuando hay algún tema completado) */ started?: boolean }) {
  const uid = useId();
  const day = today ?? todayIso();
  const begun = started ?? plan.subplans.some((s) => s.topics.some((t) => t.completedAt));
  const activeSchedule = useMemo(() => schedule ?? (plan.start && plan.end ? buildSchedule(progressPlan(plan, { today: day })) : undefined), [schedule, plan, day]);
  const times = useMemo(() => topicTimes(activeSchedule?.days ?? []), [activeSchedule]);
  const { rows: catalog, error, warming, reload } = usePlanTopicCatalog(plan.id);
  const [areaKey, setAreaKey] = useState("");
  const [groupId, setGroupId] = useState("");
  // temas desplegados (su panel de «Regenerar»); se recuerdan al cambiar de área
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const [titleW, setTitleWidth, startTitleResize] = useTitleWidth();
  const toggleRow = (folder: string): void => setOpenRows((s) => { const n = new Set(s); if (!n.delete(folder)) n.add(folder); return n; });
  // selección para el lote, filtro por estado, modo puente de la IA y la cola
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [asking, setAsking] = useState<BulkPlan | null>(null);
  const [genChain, setGenChain] = useState<AreaTopicRow[]>([]);
  const { queue, start, stop, dismiss } = useRegenQueue();
  const queueBusy = !!queue?.running;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const targetHighlight = useNavState((s) => s.values[TOPIC_HIGHLIGHT_KEY] as string | undefined);
  const [reviews, setReviews] = useState<PlanReview[]>([]);
  const [selectedReview, setSelectedReview] = useState<PlanReview | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addTopicsOpen, setAddTopicsOpen] = useState(false);
  const [newTopicsText, setNewTopicsText] = useState("");
  const [addingTopics, setAddingTopics] = useState(false);

  useEffect(() => {
    if (plan.id) {
      api.mentorPlanReviewList({ planId: plan.id })
        .then((res) => setReviews(res.reviews || []))
        .catch(() => {});
    }
  }, [plan.id]);

  useEffect(() => {
    if (targetHighlight) {
      setHighlighted(targetHighlight);
      useNavState.getState().set(TOPIC_HIGHLIGHT_KEY, undefined);
    }
  }, [targetHighlight]);

  const cat = catalog ?? [];
  const baseTabs = useMemo(() => areaTabsOf(plan, cat), [plan, cat]);
  // Bases: los fundamentos no son de la ruta de ningún área; van juntos, sin repetirse, en su propia pestaña
  const basesRows = useMemo(() => basesTopicRows(plan, cat, activeSchedule), [plan, cat, activeSchedule]);
  const basesTab: AreaTab | undefined = basesRows.length
    ? { key: BASES_KEY, area: "Bases", subplanId: BASES_KEY, total: basesRows.length, done: basesRows.filter((r) => r.completed).length, missing: basesRows.filter(pendingGenerate).length }
    : undefined;
  const tabs = useMemo(() => (basesTab ? [...baseTabs, basesTab] : baseTabs), [baseTabs, basesTab]);
  // `only` puede ser la clave del área (`areaId`) o el id del subplan (la página del área pasa éste): si no coincidiera, la vista quedaría vacía
  const active = only ? tabs.find((t) => t.key === only || t.subplanId === only) : tabs.find((t) => t.key === areaKey) ?? tabs[0];
  const isBases = active?.key === BASES_KEY;
  const sub = active && !isBases ? plan.subplans.find((s) => s.id === active.subplanId) : undefined;
  const areaRows = useMemo(() => (isBases ? basesRows : sub ? areaTopicRows(sub, cat, false, activeSchedule) : []), [isBases, basesRows, sub, cat, activeSchedule]);
  const groups = useMemo(() => (sub ? groupTabsOf(sub, areaRows) : [{ id: "", title: "Todos", total: areaRows.length, missing: areaRows.filter(pendingGenerate).length }]), [sub, areaRows]);
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const shown = useMemo(() => (sub && group ? rowsOfGroup(sub, areaRows, group.id) : areaRows), [sub, areaRows, group]);
  // si el área o el grupo elegidos desaparecen del plan, se vuelve a la primera pestaña
  useEffect(() => {
    if (active && active.key !== areaKey) setAreaKey(active.key);
  }, [active, areaKey]);
  useEffect(() => {
    if (group && group.id !== groupId) setGroupId(group.id);
  }, [group, groupId]);

  // lo que se ve (tras el filtro por estado); la selección y las acciones en lote solo cuentan lo que se ve
  const outdatedCount = useMemo(() => areaRows.filter(isOutdated).length, [areaRows]);
  const visible = useMemo(() => shown.filter((r) => matchesStatus(r, statusFilter)), [shown, statusFilter]);
  const selectedRows = useMemo(() => visible.filter((r) => selected.has(r.folder)), [visible, selected]);
  const allOn = visible.length > 0 && selectedRows.length === visible.length;
  const statusCounts = useMemo(() => new Map(STATUS_FILTERS.map((f) => [f.key, shown.filter((r) => matchesStatus(r, f.key)).length])), [shown]);

  useEffect(() => {
    if (highlighted) {
      if (groupId && !shown.some((r) => r.folder === highlighted)) {
        setGroupId("");
      }
      if (statusFilter !== "all" && !visible.some((r) => r.folder === highlighted)) {
        setStatusFilter("all");
      }
    }
  }, [highlighted, shown, visible, groupId, statusFilter]);

  const pickArea = (k: string): void => {
    setAreaKey(k);
    setGroupId("");
    setSelected(new Set());
  };
  const pickGroup = (id: string): void => {
    setGroupId(id);
    setSelected(new Set());
  };
  const toggleSel = (folder: string): void => setSelected((s) => { const n = new Set(s); if (!n.delete(folder)) n.add(folder); return n; });
  const helper = (h: SelectHelper): void => {
    if (h === "clear") setSelected(new Set());
    else if (h === "all") setSelected(new Set(visible.map((r) => r.folder)));
    else if (h === "missing") setSelected(new Set(visible.filter(pendingGenerate).map((r) => r.folder)));
    else if (h === "outdated") setSelected(new Set(visible.filter(isOutdated).map((r) => r.folder)));
    else setSelected(new Set(visible.filter((r) => r.exercises === 0).map((r) => r.folder)));
  };
  const [alsoMap, setAlsoMap] = useState(false);
  const ask = (what: RegenKind, rows: ReadonlyArray<AreaTopicRow>, withMap = false): void => { setAlsoMap(withMap); setAsking(planBulk(rows, what, false)); };
  const confirmBulk = (): void => {
    const p = asking;
    setAsking(null);
    if (!p || p.run.length === 0) return;
    void start(p.what, p.run, { alsoMap });
  };
  // «Generar lo que falta» de la selección: el diálogo de «Ejecutar plan» (uno por tema) de los que están en ruta y les falta algo
  const generateMissing = (): void => {
    const todo = selectedRows.filter((r) => r.route !== "skipped" && r.incomplete);
    if (todo.length === 0) useApp.getState().toast("info", "A los temas elegidos no les falta nada que generar.");
    else setGenChain(todo);
  };

  // «Agregar nuevos temas» + «Verificar metodología» del alcance donde estás (la asignatura, o el área si no hay asignaturas); arriba y abajo de la tabla
  const realGroup = Boolean(group && group.id && group.id !== "bases" && group.id !== "core" && group.id !== "__otros");
  const scopeTopics = useMemo(() => shown.map((r) => ({ folder: r.folder, title: r.title, group: r.group })), [shown]);
  const addTopicsBar = (testid: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setAddTopicsOpen(true)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed border-accent/60 bg-accent-soft/20 px-3.5 py-1.5 text-[13.5px] font-medium text-accent-text transition-colors hover:border-accent hover:bg-accent-soft"
        data-testid={testid}
      >
        <Plus size={15} aria-hidden /> Agregar nuevos temas...
      </button>
      {active && (
        <MethodologyCheckButton
          scope={realGroup && group ? { kind: "group", label: group.title, areaName: active.area, groupId: group.id, groupTitle: group.title } : { kind: "area", label: active.area, areaName: active.area }}
          topics={scopeTopics}
          testid={`${testid}-methodology`}
          planId={plan.id}
        />
      )}
    </div>
  );

  const handleCreateGroup = async (): Promise<void> => {
    if (!sub) return;
    const title = window.prompt("Nombre de la nueva asignatura (ej: Python, Conocimientos de backend, HTML):");
    if (!title || !title.trim()) return;
    try {
      await api.mentorPlanGroupCreate({ planId: plan.id, subplanId: sub.id, title: title.trim() });
      useApp.getState().toast("info", `Asignatura «${title.trim()}» creada`);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo crear la asignatura");
    }
  };

  const handleRenameGroup = async (): Promise<void> => {
    if (!sub || !group || !group.id || group.id === "bases" || group.id === "core" || group.id === "__otros") return;
    const title = window.prompt(`Nuevo nombre para «${group.title}»:`, group.title);
    if (!title || !title.trim() || title.trim() === group.title) return;
    try {
      await api.mentorPlanGroupRename({ planId: plan.id, subplanId: sub.id, groupId: group.id, title: title.trim() });
      useApp.getState().toast("info", `Asignatura renombrada a «${title.trim()}»`);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo renombrar");
    }
  };

  const handleDeleteGroup = async (): Promise<void> => {
    if (!sub || !group || !group.id || group.id === "bases" || group.id === "core" || group.id === "__otros") return;
    if (!window.confirm(`¿Eliminar la asignatura «${group.title}»? Los temas que contenga se moverán a Conocimientos.`)) return;
    try {
      await api.mentorPlanGroupDelete({ planId: plan.id, subplanId: sub.id, groupId: group.id });
      setGroupId("");
      useApp.getState().toast("info", `Asignatura eliminada`);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo eliminar");
    }
  };

  const handleUpdateTopicWeek = async (folder: string, week: number): Promise<void> => {
    try {
      await api.mentorPlanTopicUpdate({ planId: plan.id, subplanId: sub?.id, folder, targetWeek: week });
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo actualizar la semana del tema");
    }
  };

  const handleUpdateTopicRoute = async (folder: string, route: "core" | "optional" | "skipped" | "completed"): Promise<void> => {
    try {
      if (route === "completed") {
        await api.mentorPlanTopicUpdate({ planId: plan.id, subplanId: sub?.id, folder, completed: true, route: "core" });
      } else {
        await api.mentorPlanTopicUpdate({ planId: plan.id, subplanId: sub?.id, folder, completed: false, route });
      }
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo actualizar el estado del tema");
    }
  };

  const handleAddTopicsToSubject = async (): Promise<void> => {
    if (!sub || !newTopicsText.trim()) return;
    const lines = newTopicsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    setAddingTopics(true);
    try {
      const topics = lines.map((title) => ({
        title,
        folder: `${sub.area}/${group?.id || "core"}/${title}`,
        estMinutes: 45,
      }));
      const res = await api.mentorPlanSubjectAddTopics({
        planId: plan.id,
        subplanId: sub.id,
        groupId: group?.id || "core",
        topics,
      });
      useApp.getState().toast("info", `Se agregaron ${res.added} temas a «${group?.title || "la asignatura"}»`);
      setNewTopicsText("");
      setAddTopicsOpen(false);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudieron agregar los temas");
    } finally {
      setAddingTopics(false);
    }
  };

  const handleMoveTopics = async (targetGroupId: string, newGroupTitle?: string): Promise<void> => {
    if (!sub || selectedRows.length === 0) return;
    try {
      const res = await api.mentorPlanTopicsMoveGroup({
        planId: plan.id,
        subplanId: sub.id,
        folders: selectedRows.map((r) => r.folder),
        groupId: targetGroupId === "__new" ? "" : targetGroupId,
        newGroupTitle,
      });
      setSelected(new Set());
      useApp.getState().toast("info", `Se movieron ${res.changed} temas a «${res.targetGroupTitle}»`);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudieron mover los temas");
    }
  };

  const handleSingleMove = async (folder: string, targetGroupId: string): Promise<void> => {
    if (!sub) return;
    try {
      const res = await api.mentorPlanTopicsMoveGroup({
        planId: plan.id,
        subplanId: sub.id,
        folders: [folder],
        groupId: targetGroupId,
      });
      useApp.getState().toast("info", `Tema movido a «${res.targetGroupTitle}»`);
      useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
      reload();
    } catch (err: any) {
      useApp.getState().toast("error", err?.message || "No se pudo mover el tema");
    }
  };

  return (
    <section aria-labelledby={`${uid}-h`} data-testid="plan-areas-view" className="space-y-3 min-w-0 max-w-full">
      <SectionHeading id={`${uid}-h`} hint="Cada área del plan con todos sus temas en el orden de la ruta y lo que existe de cada uno. Elige un área arriba y, dentro de ella, un grupo.">
        {only ? `Temas de ${tabs.find((t) => t.key === only || t.subplanId === only)?.area ?? "el área"}` : "Temas por área"}
      </SectionHeading>
      <ExternalTasks />
      <LoadState warming={warming} error={error} empty={!catalog} onRetry={reload} />

      {tabs.length === 0 && <p className="rounded-xl border border-dashed border-line p-4 text-center text-[14px] text-dim">Este plan todavía no tiene áreas.</p>}

      {catalog && active && group && (
        <>
          {!only && (
            <div className="flex min-w-0 max-w-full items-center justify-between gap-2">
              <TabBar label="Áreas del plan" tabs={areaTabsView(tabs)} active={active.key} onSelect={pickArea} level={1} testid="area-tabs" />
            </div>
          )}

          {reviews.find((r) => sub && r.subplanId === sub.id && (!r.groupId || r.groupId === group.id)) && (
            <div className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent-soft p-3 text-[13.5px] text-accent-text" data-testid="review-notice-bar">
              <div className="flex items-center gap-2">
                <Sparkles size={16} />
                <span>
                  <strong>Revisión pendiente:</strong> Esta materia o grupo tiene cambios pendientes de revisión.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReview(reviews.find((r) => sub && r.subplanId === sub.id)!)}
                className="rounded-lg bg-accent px-3 py-1 text-[12.5px] font-semibold text-white shadow hover:opacity-90"
                data-testid="open-review-btn"
              >
                Revisar
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="area-summary">
            <div className="min-w-0 flex-1 basis-72 text-[14.5px]">
              <strong>{active.area}</strong> · {active.total} {active.total === 1 ? "tema" : "temas"} · {active.done} completados ·{" "}
              {active.missing > 0 ? <span className="text-warn">{active.missing} por generar</span> : <span className="text-mint">nada por generar</span>}
              {outdatedCount > 0 && <span className="text-mint" data-testid="outdated-count"> · {outdatedCount} con skill nueva por regenerar</span>}
              <span className="mt-1.5 block max-w-md"><ProgressBar pct={active.total ? Math.round((active.done / active.total) * 100) : 0} label={`Avance de ${active.area}`} /></span>
            </div>
            {!isBases && <GenerateButton
              planId={plan.id}
              proposed={!!plan.proposed}
              scope={areaScope(active.key)}
              label={`Generar el área (${active.missing})`}
              ariaLabel={`Generar todo lo que falta del área ${active.area}`}
              disabled={active.missing === 0}
              title="Crea lo que falta de todos los temas de esta área (teoría, mapa, manifiesto y ejercicios)"
              testid="generate-area"
            />}
          </div>

          {sub && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2 border-b border-line pb-2" data-testid="groups-bar">
              {/* las pestañas van en su propia fila a todo el ancho: en una ventana estrecha los botones de al lado ya no las aplastan */}
              {groups.length > 0 && (
                <div className="w-full min-w-0 max-w-full" data-testid="group-tabs-row">
                  <TabBar label={`Asignaturas de ${active.area}`} tabs={groupTabsView(groups, reviews)} active={group.id} onSelect={pickGroup} level={2} testid="group-tabs" />
                </div>
              )}
              <div className="flex min-w-0 max-w-full flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  className="inline-flex min-h-9 flex-none items-center gap-1 whitespace-nowrap rounded-lg border border-dashed border-line px-2.5 text-[13px] text-dim hover:border-accent hover:bg-hover hover:text-text"
                  title="Añadir una nueva asignatura dentro de esta área"
                  data-testid="create-group-btn"
                >
                  <Plus size={14} aria-hidden /> Añadir una nueva asignatura
                </button>
              </div>
              {group.id && group.id !== "bases" && group.id !== "core" && group.id !== "__otros" && (
                <div className="flex flex-none items-center gap-1 text-[12px] text-dim">
                  <button
                    type="button"
                    onClick={handleRenameGroup}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-hover hover:text-text"
                    title={`Renombrar la asignatura «${group.title}»`}
                  >
                    <Edit3 size={13} aria-hidden /> Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteGroup}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-danger hover:bg-danger/10"
                    title={`Eliminar «${group.title}» (sus temas se moverán a Conocimientos)`}
                  >
                    <Trash2 size={13} aria-hidden /> Eliminar
                  </button>
                </div>
              )}
            </div>
          )}

          {shown.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por estado" data-testid="status-filters">
                <span className="text-[13px] text-dim">Estado:</span>
                {STATUS_FILTERS.map((f) => {
                  const on = statusFilter === f.key;
                  const count = statusCounts.get(f.key) ?? 0;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStatusFilter(f.key)}
                      data-testid={`status-filter-${f.key}`}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-[13px] transition-colors",
                        on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-dim hover:bg-hover hover:text-text",
                        !on && f.key === "outdated" && count > 0 && "border-mint/40 text-mint hover:bg-mint/10",
                      )}
                    >
                      {f.label} <span className={cn("rounded bg-hover px-1 text-[11.5px] tabular-nums", !on && f.key === "outdated" && count > 0 && "bg-mint/20 text-mint font-medium")}>{count}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-dim hover:bg-hover hover:text-text"
                  data-testid="expand-all"
                  onClick={() => setOpenRows(visible.every((r) => openRows.has(r.folder)) ? new Set() : new Set(visible.map((r) => r.folder)))}
                >
                  {visible.every((r) => openRows.has(r.folder)) ? "Contraer todo" : "Expandir todo"}
                </button>
              </div>
              <div className="flex items-center justify-between pt-1">
                {addTopicsBar("add-topics-btn")}
              </div>
              <BulkToolbar count={selectedRows.length} busy={queueBusy} onAsk={(w, m) => ask(w, selectedRows, m)} onGenerateMissing={generateMissing} onHelper={helper} groups={groups} onMoveGroup={handleMoveTopics} />
              {queue && <BulkProgress queue={queue} onStop={stop} onClose={dismiss} />}
            </>
          )}

          {shown.length === 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between pt-1">
                {addTopicsBar("add-topics-btn")}
              </div>
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-[14px] text-dim" data-testid="area-empty">Esta sección no tiene temas.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="space-y-2"><p className="rounded-xl border border-dashed border-line p-4 text-center text-[14px] text-dim" data-testid="area-filter-empty">Ningún tema cumple ese estado.</p></div>
          ) : (
            <>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[74rem] border-collapse text-left text-[14px]" data-testid="area-table">
                <caption className="sr-only">Temas de {active.area}{group.id ? `, grupo ${group.title}` : ""}</caption>
                <thead className="bg-card text-[12.5px] uppercase tracking-wide text-faint">
                  <tr>
                    <th scope="col" className="sticky left-0 z-[1] w-9 bg-card px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos los temas visibles"
                        checked={allOn}
                        ref={(el) => { if (el) el.indeterminate = selectedRows.length > 0 && !allOn; }}
                        onChange={() => setSelected(allOn ? new Set() : new Set(visible.map((r) => r.folder)))}
                        disabled={queueBusy}
                        data-testid="select-all"
                        className="h-4 w-4 accent-[var(--nv-accent)]"
                      />
                    </th>
                    {["Sem.", "Tema", "Avance", "Previsto", "Nota", "Mapa", ".practica", "Ejercicios", "Estado", "Regenerar", "Generar"].map((h) =>
                      h === "Tema" ? (
                        <th key={h} scope="col" className="relative px-3 py-2 font-semibold" style={{ width: titleW, minWidth: titleW, maxWidth: titleW }}>
                          {h}
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Arrastra para cambiar el ancho de la columna Tema"
                            title="Arrastra para cambiar el ancho"
                            tabIndex={0}
                            data-testid="topic-col-resize"
                            className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-accent/40"
                            onPointerDown={startTitleResize}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowRight") setTitleWidth(titleW + 24);
                              if (e.key === "ArrowLeft") setTitleWidth(titleW - 24);
                            }}
                          />
                        </th>
                      ) : (
                        <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <Fragment key={r.folder}>
                    <tr
                      ref={(el) => {
                        if (el && r.folder === highlighted) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                      }}
                      className={cn(
                        "border-t border-line align-top transition-colors duration-300",
                        r.route === "skipped" && "opacity-60",
                        r.folder === highlighted && "bg-amber-300/35 dark:bg-amber-400/25 border-l-4 border-l-amber-500 dark:border-l-amber-400 shadow-[inset_0_0_12px_rgba(245,158,11,0.25)]"
                      )}
                      data-testid="area-row"
                      data-folder={r.folder}
                      data-highlighted={r.folder === highlighted ? "true" : undefined}
                      data-selected={selected.has(r.folder) || undefined}
                      onMouseEnter={() => {
                        if (r.folder === highlighted) {
                          setHighlighted(null);
                        }
                      }}
                      onMouseOver={() => {
                        if (r.folder === highlighted) {
                          setHighlighted(null);
                        }
                      }}
                    >
                      <td className="sticky left-0 z-[1] bg-surface px-0 py-0">
                        <label className="flex h-full min-h-10 w-full cursor-pointer items-start justify-center px-3 py-2.5">
                        <input type="checkbox" aria-label={`Seleccionar ${r.title}`} checked={selected.has(r.folder)} onChange={() => toggleSel(r.folder)} disabled={queueBusy} data-testid="row-select" className="h-4 w-4 accent-[var(--nv-accent)]" />
                        </label>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-dim">
                        <select
                          aria-label={`Semana de ${r.title}`}
                          value={r.week}
                          onChange={(e) => void handleUpdateTopicWeek(r.folder, Number(e.target.value))}
                          data-testid={`select-week-${r.folder}`}
                          className="rounded border border-line bg-card px-1 py-0.5 text-xs text-dim hover:text-text cursor-pointer"
                        >
                          {Array.from({ length: 26 }, (_, i) => i + 1).map((w) => (
                            <option key={w} value={w}>{w}</option>
                          ))}
                        </select>
                      </td>
                      <th scope="row" className="min-w-0 px-3 py-2 font-normal" style={{ width: titleW, minWidth: titleW, maxWidth: titleW }}>
                        <span className="flex min-w-0 items-start gap-1">
                        <button
                          type="button"
                          className="mt-0.5 inline-grid h-6 w-6 flex-none place-items-center rounded-md text-dim hover:bg-hover hover:text-text"
                          aria-expanded={openRows.has(r.folder)}
                          aria-label={`${openRows.has(r.folder) ? "Contraer" : "Desplegar"} el detalle y las acciones de ${r.title}`}
                          onClick={() => toggleRow(r.folder)}
                          data-testid="row-expand"
                        >
                          {openRows.has(r.folder) ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                        </button>
                        <span className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <TopicMenu folder={r.folder} title={r.title} trigger={<span className="block whitespace-normal break-words text-left" title={r.folder} data-testid="area-open">{r.title}</span>} className="font-semibold text-accent-text underline-offset-2 hover:underline" />
                            {sub && groups.length > 1 && (
                              <select
                                value={r.group || "core"}
                                onChange={(e) => void handleSingleMove(r.folder, e.target.value)}
                                title="Cambiar sub-asignatura de este tema"
                                aria-label={`Sub-asignatura de ${r.title}`}
                                data-testid={`select-group-${r.folder}`}
                                className="rounded border border-line bg-card px-1 py-0.5 text-[11px] text-dim hover:border-accent hover:text-text cursor-pointer"
                              >
                                {groups.filter((g) => g.id !== "" && g.id !== "__otros").map((g) => (
                                  <option key={g.id} value={g.id}>{g.title}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          {!r.exists && <span className="block text-[12.5px] text-faint">Aún no existe en la vault</span>}
                          <OutdatedButtons row={r} busy={queueBusy} onAsk={(w, row) => ask(w, [row])} />
                        </span>
                        </span>
                      </th>
                      <td className="px-3 py-2"><Ring pct={progress?.get(r.folder) ?? 0} done={r.completed} /></td>
                      <td className="px-3 py-2">{(() => { const t = timeTagOf(times.get(r.folder), r.completed, day, begun); return t && t.status !== "done" ? <TimeChip time={t} /> : <span className="text-dim">—</span>; })()}</td>
                      <td className="px-3 py-2"><Mark ok={r.theory} yes="Nota" no="Sin nota" /></td>
                      <td className="px-3 py-2"><Mark ok={r.canvas} yes="Mapa" no="Sin mapa" /></td>
                      <td className="px-3 py-2"><Mark ok={r.manifest} yes="Sí" no="Sin .practica" /></td>
                      <td className="px-3 py-2">
                        {r.exercises > 0 ? (
                          <span className="inline-flex items-center gap-1"><Check size={14} aria-hidden className="text-mint" /> {r.exercises}{r.planExercises ? ` de ${r.planExercises}` : ""}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warn"><X size={14} aria-hidden /> Sin ejercicios</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[13.5px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              if (r.completed) return <Chip large colour="var(--nv-mint)"><Check size={12} aria-hidden /> Completado</Chip>;
                              const t = timeTagOf(times.get(r.folder), false, day, begun);
                              return t?.status === "pending" ? <Chip large colour="var(--nv-warn)">Pendiente</Chip> : <span className="text-dim">{t?.status === "current" ? "En su tiempo" : "Programado"}</span>;
                            })()}
                            {r.route !== "core" && <span className="text-dim text-xs">({ROUTE_LABEL[r.route]})</span>}
                          </div>
                          <select
                            aria-label={`Cambiar estado de ${r.title}`}
                            value={r.completed ? "completed" : r.route}
                            onChange={(e) => void handleUpdateTopicRoute(r.folder, e.target.value as any)}
                            data-testid={`select-route-${r.folder}`}
                            className="w-fit rounded border border-line bg-card px-1 py-0.5 text-[11px] text-dim hover:text-text cursor-pointer"
                          >
                            <option value="core">En ruta (Programado)</option>
                            <option value="completed">Completado</option>
                            <option value="optional">Opcional</option>
                            <option value="skipped">Omitido</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2"><RowQuickActions row={r} busy={queueBusy} onAsk={(w, row) => ask(w, [row])} /></td>
                      <td className="px-3 py-2">
                        <GenerateTopicButton planId={plan.id} proposed={!!plan.proposed} folder={r.folder} title={r.title} inPlan={r.route !== "skipped"} incomplete={pendingGenerate({ ...r, completed: false })} />
                      </td>
                    </tr>
                    {openRows.has(r.folder) && (
                      <tr className="border-t border-line bg-surface/40" data-testid="area-row-expanded" data-folder={r.folder}>
                        <td colSpan={12}>
                          <div className="space-y-2 px-3 py-2">
                            <TopicInsight folder={r.folder} title={r.title} planId={plan.id} />
                            <RegeneratePanel row={r} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </>
      )}

      {asking && <BulkConfirm plan={asking} onCancel={() => setAsking(null)} onConfirm={confirmBulk} />}
      {genChain.length > 0 && (
        <ExecuteDialog
          key={genChain[0]!.folder}
          planId={plan.id}
          proposed={!!plan.proposed}
          initialScope={topicScope(genChain[0]!.folder)}
          onClose={() => setGenChain((c) => c.slice(1))}
          onStarted={() => {
            useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
          }}
        />
      )}
      <AddToPlanDialog
        plan={plan}
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdded={() => {
          useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
          reload();
        }}
      />

      {selectedReview && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <PlanReviewScreen
            plan={plan}
            review={selectedReview}
            onClose={() => setSelectedReview(null)}
            onResolved={() => {
              setSelectedReview(null);
              useMentor.setState((st) => ({ planVersion: st.planVersion + 1 }));
              reload();
            }}
          />
        </div>
      )}

      {addTopicsOpen && (
        <Modal title={`Agregar nuevos temas a «${group?.title || "la asignatura"}»`} onClose={() => setAddTopicsOpen(false)} width={540}>
          <div className="space-y-4">
            <p className="text-[13.5px] text-dim">
              Escribe el nombre de los nuevos temas a estudiar (uno por línea). Se añadirán directamente a la asignatura <strong>{group?.title}</strong> dentro de <strong>{active?.area}</strong>:
            </p>

            <section aria-label={`Temas actuales de ${group?.title ?? "la asignatura"}`} data-testid="add-topics-current">
              <p className="mb-1 text-[13px] font-semibold text-text">
                Ya tiene {shown.length} {shown.length === 1 ? "tema" : "temas"} · {shown.filter((r) => r.completed).length} completados
              </p>
              <ol className="max-h-44 list-decimal space-y-0.5 overflow-y-auto rounded-lg border border-line bg-panel py-2 pl-8 pr-3 text-[13.5px] text-dim">
                {shown.map((r) => <li key={r.folder} className="break-words">{r.title}</li>)}
                {shown.length === 0 && <li className="list-none text-faint">Aún no tiene temas.</li>}
              </ol>
              <p className="mt-1 text-[12.5px] text-faint">Si es una materia de patrones (HTML, CSS, funciones…), añade <strong>un tema por elemento, propiedad o función</strong>, no uno que los junte todos. «Verificar metodología» te dice cuáles faltan.</p>
            </section>

            <Field label="Títulos de los temas (uno por línea)">
              <textarea
                value={newTopicsText}
                onChange={(e) => setNewTopicsText(e.target.value)}
                placeholder={"Ej:\nConceptos básicos\nInstalación y entorno\nPrimeros pasos y ejemplos"}
                rows={5}
                className={cn(input, "resize-y font-sans leading-relaxed")}
                data-testid="textarea-new-topics"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <GhostButton onClick={() => setAddTopicsOpen(false)}>Cancelar</GhostButton>
              <PrimaryButton
                onClick={handleAddTopicsToSubject}
                disabled={addingTopics || !newTopicsText.trim()}
                data-testid="btn-confirm-add-topics"
              >
                {addingTopics ? "Agregando…" : "Agregar temas"}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
