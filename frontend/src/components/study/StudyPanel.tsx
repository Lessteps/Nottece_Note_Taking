// Estudio: the study area of the open note — today's queue, the ledger of
// skills and the error log of its subject.

import { Play, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/bridge";
import { renderMarkdown } from "../../lib/markdown";
import type { StudySnapshot, TopicData } from "../../lib/types";
import { useApp } from "../../store/app";
import { cn, IconButton } from "../ui";
import { SrsCalendarView } from "./SrsCalendarView";
import { TopicConfiguratorDialog } from "./TopicConfiguratorDialog";
import { TopicDashboardView } from "./TopicDashboardView";
import { TopicGeneralView } from "./TopicGeneralView";

const KIND: Record<string, [string, string]> = {
  remediation: ["Corregir error", "text-danger bg-danger-soft"],
  integration: ["Integración", "text-info bg-info-soft"],
  review: ["Repaso de skill", "text-accent-text bg-accent-soft"],
  srs_exercise: ["Repaso", "text-accent-text bg-accent-soft"],
  srs_proof: ["Demostración", "text-accent-text bg-accent-soft"],
  srs_card: ["Tarjeta", "text-warn bg-warn-soft"],
  next_skill: ["Siguiente skill", "text-mint bg-mint-soft"],
  continue: ["Práctica", "text-mint bg-mint-soft"],
};
const STATUS_DOT: Record<string, string> = { consolidated: "bg-mint", practicing: "bg-warn", not_started: "border border-faint" };
const GRADES: Array<[string, number, string]> = [["Otra vez", 1, "text-danger"], ["Difícil", 3, "text-warn"], ["Bien", 4, "text-mint"], ["Fácil", 5, "text-accent-text"]];

import { useStudyVersion } from "../../store/studyVersion";
export { useStudyVersion };

const inline = (t: string) => ({ __html: renderMarkdown(t) });

export function StudyPanel({ path, areaKey }: { path: string; areaKey: string }) {
  const openNote = useApp((s) => s.openNote);
  const toast = useApp((s) => s.toast);
  const [snap, setSnap] = useState<StudySnapshot | null>(null);
  const [topicData, setTopicData] = useState<TopicData | null>(null);
  const [tab, setTab] = useState<"today" | "repaso" | "topic" | "dashboard" | "ledger" | "errors">("today");
  const [showConfigurator, setShowConfigurator] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sData, tData] = await Promise.all([
        api.studySnapshot(path),
        api.studyTopicGet(path).catch(() => null),
      ]);
      setSnap(sData);
      setTopicData(tData);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, toast]);

  // The same area keeps its snapshot while moving between its notes (a
  // snapshot scans the vault).
  const version = useStudyVersion((s) => s.v);
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, version]);

  const practice = (rel: string) => {
    void openNote(rel);
    useApp.getState().setMode("read");
  };

  const handleConvertToTopic = async () => {
    if (!topicData?.folder) return;
    try {
      await api.studyTopicConvert(topicData.folder);
      toast("info", "Tema creado correctamente (_tema.md).");
      useStudyVersion.getState().bump();
      void refresh();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  if (!snap) return <div className="p-4 text-[12px] text-faint">{loading ? "Leyendo el área de estudio…" : ""}</div>;
  const first = snap.queue.items.find((i) => i.exercise)?.exercise;
  const c = snap.queue.counts;

  const srsScheduled = snap.ledgers.reduce(
    (n, l) => n + l.skills.filter((s) => s.status === "consolidated" && s.due).length,
    0,
  );

  const tabs: Array<["today" | "repaso" | "topic" | "dashboard" | "ledger" | "errors", string]> = [
    ["today", `Hoy${c.total ? `  ${c.total}` : ""}`],
    ["repaso", `Repaso${srsScheduled ? `  ${srsScheduled}` : ""}`],
  ];
  if (topicData?.is_topic) {
    tabs.push([
      "topic",
      `Tema${topicData.progress ? ` ${topicData.progress.completenessPct}%` : ""}`,
    ]);
  }
  tabs.push(["dashboard", "Temas"]);
  tabs.push(["ledger", "Ledger"]);
  tabs.push(["errors", `Errores${snap.errors.length ? `  ${snap.errors.length}` : ""}`]);

  return (
    <div className="nv-study-panel flex min-h-0 flex-1 flex-col">
      <div className="flex-none border-b border-line px-4 py-3">
        <div className="flex items-center">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">Estudio</span>
          <IconButton title="Actualizar" onClick={() => void refresh()} className="ml-auto">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </IconButton>
        </div>
        <div className="truncate text-[15px] font-bold text-text" title={snap.area.folder}>{snap.area.title}</div>
        <div className="text-[11px] text-faint">
          {snap.area.title !== snap.area.subject_title ? snap.area.subject_title : "Materia completa"} · {snap.exercises} ejercicio{snap.exercises === 1 ? "" : "s"}
        </div>

        {topicData?.is_topic && (
          <button
            type="button"
            onClick={() => setShowConfigurator(true)}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-[12.5px] font-semibold text-white hover:bg-accent-strong"
          >
            <Sparkles size={13} /> Practicar este tema
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            first
              ? practice(first.path)
              : toast("info", "No hay ejercicios en cola. Abre un tema y usa «Practicar este tema» para generar práctica con IA.")
          }
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition",
            topicData?.is_topic
              ? "mt-1.5 border border-line text-text hover:bg-hover"
              : "mt-2 bg-accent text-white hover:bg-accent-strong"
          )}>
          <Play size={12} /> {topicData?.is_topic ? "Práctica del día (Hoy)" : "Practicar ahora"}
        </button>

        {!topicData?.is_topic && topicData?.can_convert && (
          <div className="mt-2 rounded-lg border border-accent/30 bg-accent-soft p-2.5 text-[11px]">
            <div className="font-semibold text-text">Carpeta con ejercicios de práctica</div>
            <div className="mt-0.5 text-faint">Convierte esta carpeta en tema para configurar sesiones y medir dominio.</div>
            <button
              type="button"
              onClick={() => void handleConvertToTopic()}
              className="mt-1.5 rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-white hover:bg-accent-strong"
            >
              Convertir en tema
            </button>
          </div>
        )}

        {snap.area.subject === "english" && (
          <button type="button" onClick={() => useApp.getState().setModule("player")}
            className="mt-1.5 w-full rounded-lg border border-line py-1.5 text-[12px] text-text hover:border-dim">
            🎬 Abrir reproductor
          </button>
        )}
        <div className="mt-2 flex gap-1" role="tablist" aria-label="Estudio">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("rounded-md px-2 py-1 text-[11.5px]", tab === id ? "bg-accent-soft text-text" : "text-dim hover:bg-hover")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "today" && <Today snap={snap} onPractice={practice} />}
        {tab === "repaso" && <SrsCalendarView snap={snap} />}
        {tab === "topic" && topicData && (
          <TopicGeneralView
            topicData={topicData}
            snap={snap}
            onOpenConfigurator={() => setShowConfigurator(true)}
            onPractice={practice}
          />
        )}
        {tab === "dashboard" && <TopicDashboardView />}
        {tab === "ledger" && <Ledger snap={snap} onPractice={practice} />}
        {tab === "errors" && <Errors snap={snap} onOpen={practice} onChanged={refresh} />}
      </div>

      {showConfigurator && topicData?.is_topic && (
        <TopicConfiguratorDialog
          topicData={topicData}
          onClose={() => setShowConfigurator(false)}
          onStarted={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Today({ snap, onPractice }: { snap: StudySnapshot; onPractice: (p: string) => void }) {
  const c = snap.queue.counts;
  const [graded, setGraded] = useState<Set<string>>(new Set());
  useEffect(() => setGraded(new Set()), [snap]);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-faint">{c.srs_exercises} repasos · {c.recommendations} recomendaciones · {c.cards} tarjetas</div>
      {snap.queue.items.length === 0 && (
        <div className="rounded-lg border border-line bg-card px-3 py-4 text-center text-[12px] text-dim">
          Todo al día: no hay repasos ni ejercicios recomendados para hoy.
        </div>
      )}
      {snap.queue.items.map((it, i) => {
        if (it.card && graded.has(it.card.srs_id)) return null;
        const [label, cls] = KIND[it.kind] ?? ["Tarea", "text-dim bg-hover"];
        return (
          <div key={i} className="rounded-lg border border-line bg-card px-3 py-2.5 hover:border-accent/60">
            <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", cls)}>{label}</span>
            {it.exercise ? (
              <>
                <div className="mt-1.5 text-[13px] font-semibold text-text">{it.exercise.title}</div>
                <div className="text-[11px] text-dim">
                  {it.exercise.discipline}{it.exercise.skill && ` · ${it.exercise.skill}`} · {it.exercise.mode} · {"★".repeat(it.exercise.difficulty)}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">{it.reason}</div>
                <div className="mt-1.5 flex justify-end">
                  <button type="button" onClick={() => onPractice(it.exercise!.path)}
                    className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-accent-strong">
                    Practicar ahora
                  </button>
                </div>
              </>
            ) : it.card ? (
              <CardReview card={it.card} onOpen={() => onPractice(it.card!.source)} onGraded={(q) => {
                api.studyCardGrade(it.card!.srs_id, q)
                  .then(() => setGraded((s) => new Set(s).add(it.card!.srs_id)))
                  .catch((e: Error) => useApp.getState().toast("error", e.message));
              }} />
            ) : null}
          </div>
        );
      })}
      {snap.queue.gaps.length > 0 && (
        <>
          <h4 className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">Faltan ejercicios para</h4>
          {snap.queue.gaps.map((g, i) => <div key={i} className="text-[11px] text-dim">○ {g}</div>)}
        </>
      )}
    </div>
  );
}

function CardReview({ card, onGraded, onOpen }: {
  card: NonNullable<StudySnapshot["queue"]["items"][number]["card"]>; onGraded: (q: number) => void; onOpen: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-start gap-2 text-[11px] text-faint">
        <span className="min-w-0 flex-1 truncate">{card.source.split("/").pop()?.replace(/\.md$/, "")}{card.kind && ` · ${card.kind}`}</span>
        <button type="button" onClick={onOpen} className="flex-none text-accent-text hover:underline">Ver nota</button>
      </div>
      <div className="nv-prose nv-inline text-[13px]" dangerouslySetInnerHTML={inline(card.missing ? "_(la tarjeta ya no existe en la nota)_" : card.question)} />
      {shown ? (
        <>
          <div className="nv-prose nv-inline text-[12.5px] text-dim" dangerouslySetInnerHTML={inline(card.answer)} />
          <div className="flex flex-wrap gap-1">
            {GRADES.map(([label, q, cls]) => (
              <button key={q} type="button" onClick={() => onGraded(q)}
                className={cn("rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:bg-hover", cls)}>{label}</button>
            ))}
          </div>
        </>
      ) : (
        <button type="button" disabled={card.missing} onClick={() => setShown(true)}
          className="w-fit rounded-md border border-line px-2 py-0.5 text-[11.5px] text-dim hover:bg-hover disabled:opacity-50">
          Mostrar respuesta
        </button>
      )}
    </div>
  );
}

function Ledger({ snap, onPractice }: { snap: StudySnapshot; onPractice: (p: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {snap.ledgers.length === 0 && <div className="text-[12px] text-dim">No hay ejercicios de práctica en esta área todavía.</div>}
      {snap.ledgers.map((l) => {
        const n = (s: string) => l.skills.filter((r) => r.status === s).length;
        return (
          <div key={l.title} className="rounded-lg border border-line bg-card px-2 py-2.5">
            <div className="px-1.5 text-[13px] font-semibold text-text">{l.title}</div>
            <div className="px-1.5 text-[11px] text-dim">{n("consolidated")} consolidadas · {n("practicing")} en práctica · {n("not_started")} sin empezar</div>
            <div className="mb-1 mt-1.5 flex flex-wrap gap-[3px] px-1.5">
              {l.skills.map((r) => <span key={r.code} title={`${r.code} ${r.title} — ${r.label}`} className={cn("h-2.5 w-2.5 rounded-sm", STATUS_DOT[r.status])} />)}
            </div>
            {l.skills.map((r) => (
              <button
                key={r.code}
                type="button"
                disabled={!r.practice}
                onClick={() => onPractice(r.practice)}
                title={[r.title, r.label, `${r.attempted}/${r.exercises} ejercicios intentados`,
                  r.best !== null ? `Mejor puntuación: ${r.best}` : "",
                  r.status === "consolidated" ? `Próximo repaso: ${r.due}` : "",
                  r.practice ? `Clic: practicar «${r.practice_title}»` : "Sin ejercicios en el vault"].filter(Boolean).join("\n")}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left enabled:hover:bg-hover"
              >
                <span className={cn("h-2 w-2 flex-none rounded-full", STATUS_DOT[r.status])} />
                <span className="w-4 flex-none font-mono text-[10px] text-faint">{r.code}</span>
                <span className={cn("min-w-0 flex-1 truncate text-[12px]", r.status === "not_started" ? "text-dim" : "text-text")}>{r.title}</span>
                <span className="flex gap-0.5">
                  {["beginner", "intermediate", "advanced"].map((b) => (
                    <span key={b} className={cn("h-1.5 w-1.5 rounded-full border", r.bands.includes(b) ? "border-mint bg-mint" : "border-faint")} />
                  ))}
                </span>
                <span className={cn("w-11 flex-none text-right text-[10.5px]", r.status === "consolidated" ? (r.is_due ? "font-semibold text-warn" : "text-mint") : "text-dim")}>
                  {r.status === "consolidated" ? (r.is_due ? "Repasar" : r.due.slice(8, 10) + "/" + r.due.slice(5, 7)) : r.best ?? ""}
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {snap.concepts.length > 0 && (
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">Conceptos</h4>
          {snap.concepts.map((c) => (
            <div key={c.title} className="mb-1.5">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-text">{c.title}</span>
                <span className="text-[10.5px] text-dim">{c.done}/{c.total} superados{c.best !== null && ` · mejor ${c.best}`}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-line">
                <div className="h-1 rounded-full bg-mint" style={{ width: `${c.total ? (100 * c.done) / c.total : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10.5px] leading-relaxed text-faint">
        <span className="text-mint">●</span> consolidada · <span className="text-warn">●</span> en práctica · ○ sin empezar. Puntos: niveles superados (principiante, intermedio, avanzado).
      </p>
    </div>
  );
}

function Errors({ snap, onOpen, onChanged }: { snap: StudySnapshot; onOpen: (p: string) => void; onChanged: () => void }) {
  const [digest, setDigest] = useState<string | null>(null);
  const repeated = snap.errors.filter((e) => e.repeat_count >= 2).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center text-[11px] text-faint">
        {snap.errors.length} sin resolver · {repeated} repetidos
        <button type="button" onClick={() => (digest === null
          ? api.studyErrorDigest().then((d) => setDigest(d.text)).catch(() => undefined) : setDigest(null))}
          className="ml-auto text-accent-text hover:underline">{digest === null ? "Ver ERROR_LOG.md" : "Ocultar"}</button>
      </div>
      {digest !== null && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-2 font-mono text-[10.5px] text-dim">{digest}</pre>}
      {snap.errors.length === 0 && (
        <div className="rounded-lg border border-line bg-card px-3 py-4 text-center text-[12px] text-dim">No hay errores sin resolver en esta materia.</div>
      )}
      {snap.errors.map((e) => (
        <div key={e.id} className="rounded-lg border border-line bg-card px-3 py-2.5">
          <div className="flex gap-1.5">
            <span className={cn("rounded px-1.5 text-[10.5px] font-semibold", e.repeat_count >= 2 ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>×{e.repeat_count}</span>
            <span className="rounded bg-hover px-1.5 text-[10.5px] text-dim">{e.category}</span>
          </div>
          {e.skill && <div className="mt-1 text-[10.5px] text-faint">{e.skill}</div>}
          {e.anchor && <div className="text-[12px] font-semibold text-text">«{e.anchor}»</div>}
          {e.description && <div className="nv-prose nv-inline text-[12px]" dangerouslySetInnerHTML={inline(e.description)} />}
          {e.fix && <div className="nv-prose nv-inline text-[11.5px] text-dim" dangerouslySetInnerHTML={inline(`**Fix:** ${e.fix}`)} />}
          <div className="mt-0.5 text-[10.5px] text-faint">Visto {e.seen}{e.note && ` · ${e.note}`}</div>
          <div className="mt-1.5 flex justify-end gap-1.5">
            {e.source && <button type="button" onClick={() => onOpen(e.source)} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-dim hover:bg-hover">Abrir ejercicio</button>}
            <button type="button" onClick={() => void api.studyErrorResolve(e.id).then(onChanged).catch((err: Error) => useApp.getState().toast("error", err.message))}
              className="rounded-md border border-line px-2 py-0.5 text-[11px] text-dim hover:bg-hover">Marcar resuelto</button>
          </div>
        </div>
      ))}
    </div>
  );
}
