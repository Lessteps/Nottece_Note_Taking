// La RUTA del Mentor en NoteVault: insignia por tema («En tu ruta · sem. 4» · «Opcional» · «Fuera de ruta»), interruptor «Solo mi ruta (Mentor)»,
// lista «Qué estudiar ahora» y banner de la nota abierta. Todo sale del mapa carpeta → ruta del plan (`store/mentorRoute.ts`), calculado una vez
// por plan: ninguna fila hace llamadas. NADA se borra ni se mueve en la vault: los temas fuera de ruta se atenúan (no se esconden salvo que se
// pida «Solo mi ruta») y se pueden abrir y practicar con normalidad. Accesible: texto + icono (nunca solo color), `role="switch"`, recuento `aria-live`.

import { CircleDashed, EyeOff, Route as RouteIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/bridge";
import { dateLabel } from "../../lib/planSchedule";
import { shortWeekLabel, weekRangesOf } from "../../lib/planTime";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { mentorLinkOf, type MentorTopicStatus, routeAvailable, useRoute, type RouteInfo, type RouteKind, type RouteSnapshot } from "../../store/mentorRoute";
import { cn } from "../ui";
import { openRunView, runTabOfTopic } from "../mentor/mentorNav";
import { openAgendaAt } from "../mentor/planShared";

export interface RouteView {
  kind: RouteKind;
  snap: RouteSnapshot | null;
  /** hay una ruta que mostrar (plan activo, o propuesto con la vista previa pedida) */
  available: boolean;
  /** la ruta mostrada es la de un plan PROPUESTO (vista previa) */
  preview: boolean;
  /** «Solo mi ruta» activo (solo si hay ruta que mostrar) */
  only: boolean;
}

/** Lee el mapa de la ruta (lo carga una sola vez por versión del plan). */
export function useRouteView(): RouteView {
  const planVersion = useMentor((s) => s.planVersion);
  const kind = useRoute((s) => s.kind);
  const snap = useRoute((s) => s.snap);
  const previewOn = useRoute((s) => s.previewOn);
  const only = useRoute((s) => s.only);
  useEffect(() => {
    void useRoute.getState().ensure(planVersion);
  }, [planVersion]);
  const available = routeAvailable({ kind, previewOn, snap });
  return { kind, snap, available, preview: available && kind === "proposed", only: only && available };
}

// ── Insignia ────────────────────────────────────────────────────────────

/** El texto completo de la insignia (también es su nombre accesible). */
export function routeLabel(info: RouteInfo, preview: boolean): string {
  const week = `sem. ${info.week}`;
  if (info.route === "skipped") return preview ? "Vista previa · fuera de ruta" : "Fuera de ruta";
  if (info.route === "optional") return preview ? `Vista previa · opcional · ${week}` : `Opcional · ${week}`;
  return preview ? `Vista previa · en la ruta · ${week}` : `En tu ruta · ${week}`;
}

/** Insignia de ruta de un tema: icono + texto (`compact`: versión corta para filas estrechas; el nombre accesible sigue siendo el completo). */
export function RouteBadge({ info, preview = false, compact = false, className }: { info: RouteInfo; preview?: boolean; compact?: boolean; className?: string }) {
  const full = routeLabel(info, preview);
  const short = info.route === "skipped" ? "Fuera" : info.route === "optional" ? `Opc. s${info.week}` : `Ruta s${info.week}`;
  const Icon = info.route === "skipped" ? EyeOff : info.route === "optional" ? CircleDashed : RouteIcon;
  const tone = info.route === "skipped" ? "border-line text-dim" : info.route === "optional" ? "border-info/50 bg-info-soft text-info" : "border-accent/50 bg-accent-soft text-accent-text";
  return (
    <span
      data-testid="route-badge"
      data-route={info.route}
      title={info.route === "skipped" && info.reason ? `${full}: ${info.reason}` : full}
      className={cn("inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight", preview && "border-dashed", tone, className)}
    >
      <Icon size={11} aria-hidden className="flex-none" />
      {compact ? (
        <>
          <span aria-hidden>{short}</span>
          <span className="sr-only">{full}</span>
        </>
      ) : (
        full
      )}
    </span>
  );
}

// ── Interruptor «Solo mi ruta (Mentor)» ─────────────────────────────────

/**
 * El interruptor, su recuento (`aria-live`) y el atajo «Mostrar todo». Sin plan activo está deshabilitado y lo explica («Mantén un plan para ver
 * tu ruta»); si hay un plan propuesto se puede previsualizar su ruta (con insignia distinta). `showSort`: el orden «por semana del plan».
 */
export function RouteToggle({ showSort = false, className }: { showSort?: boolean; className?: string }) {
  const view = useRouteView();
  const only = useRoute((s) => s.only);
  const sortByWeek = useRoute((s) => s.sortByWeek);
  const previewOn = useRoute((s) => s.previewOn);
  const loading = useRoute((s) => s.loading);
  const { kind, snap, available } = view;
  const on = only && available;
  const c = snap?.counts;
  const count = !available
    ? ""
    : on
      ? `${c!.live} ${c!.live === 1 ? "tema" : "temas"} en tu ruta${c!.skipped ? ` · ${c!.skipped} fuera de ruta ocultos` : ""}`
      : `${c!.live} en tu ruta${c!.skipped ? ` · ${c!.skipped} fuera de ruta` : ""} de ${c!.total}`;
  const why =
    kind === "proposed" && !available
      ? "Mantén un plan para ver tu ruta: ahora solo hay uno propuesto."
      : kind === "none"
        ? loading
          ? "Leyendo tu plan…"
          : "Mantén un plan para ver tu ruta."
        : "";
  return (
    <div className={cn("min-w-0 text-[12.5px]", className)} data-testid="route-toggle">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={!available}
          onClick={() => useRoute.getState().setOnly(!only)}
          className={cn("inline-flex min-h-8 items-center gap-2 rounded-md px-1 text-left text-text disabled:cursor-not-allowed disabled:text-dim")}
          data-testid="route-switch"
        >
          <span aria-hidden className={cn("relative inline-block h-5 w-9 flex-none rounded-full border transition-colors", on ? "border-accent bg-accent" : "border-line-strong bg-hover", !available && "opacity-60")}>
            <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
          </span>
          <span className="font-medium">Solo mi ruta (Mentor)</span>
        </button>
        {on && (
          <button type="button" onClick={() => useRoute.getState().setOnly(false)} className="inline-flex min-h-8 items-center px-1 text-accent-text underline-offset-2 hover:underline" data-testid="route-show-all">
            Mostrar todo
          </button>
        )}
        {showSort && available && (
          <label className="inline-flex min-h-8 items-center gap-1.5 text-dim">
            Orden
            <select
              value={sortByWeek ? "week" : "area"}
              onChange={(e) => useRoute.getState().setSortByWeek(e.target.value === "week")}
              className="min-h-8 rounded-md border border-line bg-panel px-1.5 text-[12.5px] text-text"
              data-testid="route-sort"
            >
              <option value="area">Por área</option>
              <option value="week">Por semana del plan</option>
            </select>
          </label>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-dim" data-testid="route-count">{count}</p>
      {why && <p className="text-dim" data-testid="route-why">{why}</p>}
      {kind === "proposed" && (
        <button
          type="button"
          aria-pressed={previewOn}
          onClick={() => useRoute.getState().setPreviewOn(!previewOn)}
          className={cn("mt-0.5 inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[12.5px]", previewOn ? "border-accent bg-accent-soft text-accent-text" : "border-dashed border-line text-text hover:bg-hover")}
          data-testid="route-preview"
        >
          {previewOn ? "Vista previa de la ruta propuesta: activada" : "Previsualizar la ruta del plan propuesto"}
        </button>
      )}
    </div>
  );
}

// ── Qué estudiar ahora ──────────────────────────────────────────────────

const STATUS_TEXT: Record<MentorTopicStatus, string> = { hecho: "hecho", pendiente: "pendiente", fuera: "fuera de ruta" };

/** Abre la Agenda del Mentor en una fecha (enlace profundo interno). */
export function openRouteAgenda(planId: string, date: string): void {
  openAgendaAt(planId, date, "dia");
  useApp.getState().setModule("mentor");
}

/** Abre la Ejecución del plan en la vista del tema (su área, o Bases) y va al Mentor. */
export function openRouteRun(planId: string, tab: string): void {
  openRunView(planId, tab);
  useApp.getState().setModule("mentor");
}

/** Los temas EXACTOS de la ruta para la semana actual (si ya no queda ninguno pendiente, los de la siguiente), en el orden del plan. */
export function nextInRoute(snap: RouteSnapshot, limit = 8, inScope: (folder: string) => boolean = () => true): { week: number; items: Array<{ folder: string; info: RouteInfo }>; total: number } {
  const pending = [...snap.byFolder.entries()].filter(([f, i]) => i.route !== "skipped" && !i.done && inScope(f));
  const weeks = [...new Set(pending.map(([, i]) => i.week))].sort((a, b) => a - b);
  const week = weeks.find((w) => w >= snap.currentWeek) ?? weeks[weeks.length - 1] ?? snap.currentWeek;
  const items = pending.filter(([, i]) => i.week === week).map(([folder, info]) => ({ folder, info }));
  return { week, items: items.slice(0, limit), total: items.length };
}

/**
 * «Qué estudiar ahora»: los temas exactos de la semana del plan (en lugar de todo el catálogo). `onOpen` abre el tema; `inScope` lo limita a una
 * materia o área. No se muestra sin ruta.
 */
export function RouteNow({ onOpen, inScope, className }: { onOpen: (folder: string) => void; inScope?: (folder: string) => boolean; className?: string }) {
  const view = useRouteView();
  const now = useMemo(() => (view.available && view.snap ? nextInRoute(view.snap, 8, inScope) : null), [view.available, view.snap, inScope]);
  if (!view.available || !view.snap || !now) return null;
  const snap = view.snap;
  const range = weekRangesOf(snap.plan.start, snap.plan.end)[now.week - 1];
  return (
    <section aria-label="Qué estudiar ahora, según tu ruta" className={cn("min-w-0 rounded-2xl border border-accent/40 bg-card p-4", className)} data-testid="route-now">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-text">
          <RouteIcon size={14} aria-hidden className="text-accent-text" /> Qué estudiar ahora
        </h2>
        <span className="text-[12px] text-dim">
          {view.preview ? "Vista previa del plan propuesto · " : ""}semana {now.week} de tu ruta{range ? ` (${shortWeekLabel(range.start, range.end)})` : ""}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => openRouteAgenda(snap.planId, range?.start ?? snap.plan.start)}
          className="inline-flex min-h-8 items-center text-[12.5px] text-accent-text underline-offset-2 hover:underline"
        >
          Ver en el plan
        </button>
      </div>
      {now.items.length === 0 ? (
        <p className="mt-2 text-[13px] text-dim">No queda nada pendiente en tu ruta{inScope ? " dentro de esta parte" : ""}: buen trabajo.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-1.5" aria-label="Temas de esta semana en tu ruta">
          {now.items.map(({ folder, info }) => (
            <li key={folder} className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel/60 px-2.5 py-1.5" data-testid="route-now-item">
              <button type="button" onClick={() => onOpen(folder)} className="min-h-8 min-w-0 flex-1 truncate text-left text-[13px] font-medium text-text hover:text-accent-text" title={folder}>
                {info.title}
              </button>
              <span className="flex-none text-[11.5px] text-dim">{info.area}</span>
              {info.route === "optional" && <RouteBadge info={info} compact preview={view.preview} />}
            </li>
          ))}
        </ul>
      )}
      {now.total > now.items.length && <p className="mt-1.5 text-[12px] text-dim">+{now.total - now.items.length} más esta semana en el plan.</p>}
    </section>
  );
}

// ── Banner de la nota abierta ───────────────────────────────────────────

/**
 * Banner compacto arriba de una nota que pertenece a un tema de tu ruta: «Mentor: este tema está en tu ruta · semana 4 · día 3 · área Backend»
 * con «Ver en el plan»; si está fuera de ruta, «Mentor: fuera de tu ruta (motivo)» con «Añadir a mi ruta» (deshacible).
 */
export function RouteBanner({ path }: { path: string }) {
  const view = useRouteView();
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const link = useMemo(() => (view.available && view.snap ? mentorLinkOf(view.snap, path) : null), [view.available, view.snap, path]);
  useEffect(() => setAdded(null), [path]);
  if (!view.available || !view.snap || !link) return null;
  const { info, folder } = link;
  const snap = view.snap;
  const pre = view.preview ? "Vista previa del plan propuesto · " : "";

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.mentorPlanRouteSet({ id: snap.planId, folders: [folder], route: "core", label: `Añadir a mi ruta: ${info.title}` });
      setAdded(folder);
      useMentor.setState((s) => ({ planVersion: s.planVersion + 1 }));
      toast("info", `«${info.title}» vuelve a tu ruta.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    try {
      await api.mentorPlanChangeUndo(snap.planId);
      setAdded(null);
      useMentor.setState((s) => ({ planVersion: s.planVersion + 1 }));
      toast("info", "Deshecho: el tema vuelve a estar fuera de ruta.");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const btn = "inline-flex min-h-8 items-center rounded-md px-2 text-[12.5px] font-medium text-accent-text underline-offset-2 hover:underline";

  return (
    <div
      role="note"
      aria-label="Ruta del Mentor"
      data-testid="route-banner"
      data-route={info.route}
      className={cn("grid flex-none min-w-0 grid-cols-1 gap-x-3 gap-y-1 border-b px-3 py-2 text-[12.5px] sm:grid-cols-[auto_minmax(14rem,1fr)_auto_auto] sm:items-center sm:px-5", info.route === "skipped" ? "border-line bg-panel text-dim" : "border-accent/30 bg-accent-soft text-text")}
    >
      <RouteBadge info={info} preview={view.preview} />
      {added === folder ? (
        <>
          <span className="min-w-0 break-words sm:col-start-2">Mentor: añadido a tu ruta (semana {info.week}).</span>
          <button type="button" onClick={() => void undo()} className={btn} data-testid="route-undo">Deshacer</button>
        </>
      ) : info.route === "skipped" ? (
        <>
          <span className="min-w-0 break-words sm:col-start-2" data-testid="route-banner-text">
            Mentor: fuera de tu ruta{info.reason ? ` (${info.reason})` : ""}. La nota sigue aquí y puedes practicarla igual.
          </span>
          <button type="button" onClick={() => void add()} disabled={busy} className={btn} data-testid="route-add">
            Añadir a mi ruta
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 break-words sm:col-start-2" data-testid="route-banner-text">
            {pre}Mentor: este tema {info.route === "optional" ? "es opcional en tu ruta" : "está en tu ruta"} · semana {info.week}
            {link.dayInWeek ? ` · día ${link.dayInWeek}` : ""}
            {link.date ? ` · previsto el ${dateLabel(link.date)}` : ""} · área {info.area} · <span data-testid="route-status">{STATUS_TEXT[link.status]}</span>
          </span>
          <button type="button" onClick={() => openRouteAgenda(snap.planId, link.date ?? info.weekStart)} className={btn} data-testid="route-agenda-link">
            Ver en Agenda
          </button>
          {!view.preview && (
            <button type="button" onClick={() => openRouteRun(snap.planId, runTabOfTopic(info))} className={btn} data-testid="route-run-link">
              Ver en Ejecución
            </button>
          )}
        </>
      )}
    </div>
  );
}
