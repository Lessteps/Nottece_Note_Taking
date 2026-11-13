// Proof ladder for theorem notes: L1 strategy · L2 order the steps · L3 fill
// the hidden steps · L4 justify · L5 blank proof · L6 variant.

import {
  ArrowDown, ArrowUp, BookOpen, Check, ClipboardPaste, Eye, FileOutput, GripVertical, Lock, Send, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText, readClipboard } from "../../lib/clipboard";
import { initialTimer, type TimerState } from "../../lib/practiceTimer";
import type { LadderData, LadderGraded, LadderInfo, LadderLevel, PracticeWaiting } from "../../lib/types";
import { useApp } from "../../store/app";
import { cn, confirmAction } from "../ui";
import { useStudyVersion } from "../study/StudyPanel";
import { md, ResultCard, TimerBox, useClock } from "./common";

import { isProofNote, useLadder } from "../../store/ladder";
export { isProofNote, useLadder };

const FIELD = "w-full resize-y rounded-lg border border-line bg-panel p-3 text-[14px] leading-relaxed text-text outline-none placeholder:text-faint focus:border-accent";

export function LadderView({ path, onExit }: { path: string; onExit: () => void }) {
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<LadderInfo | null>(null);
  const [error, setError] = useState("");
  const [lv, setLv] = useState<LadderLevel | null>(null);
  const [data, setData] = useState<LadderData>({ fields: [] });
  const [result, setResult] = useState<LadderGraded | null>(null);
  const [pending, setPending] = useState<PracticeWaiting | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState<TimerState>(initialTimer);
  const [running, setRunning] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useClock(lv?.timer, running, setTimer, () =>
    setStatus({ text: "Se acabó el tiempo previsto. Puedes seguir: el tiempo extra también se registra." }));

  const openLevel = useCallback(async (level: number, keepPending: PracticeWaiting | null = null) => {
    try {
      const l = await api.ladderLevel(path, level);
      setLv(l);
      const n = l.hidden ? l.hidden.length : l.steps && l.level === 4 ? l.steps.length : 1;
      const fields = Array.from({ length: n }, (_, i) => l.fields[i] ?? "");
      setData({ fields, order: l.order, hidden: l.hidden, variant: l.variant });
      setResult(null);
      setPending(keepPending);
      setSeen(false);
      setShowProof(false);
      setTimer(initialTimer());
      setRunning(false);
      setStatus(keepPending ? { text: "Tienes una corrección pendiente en el archivo de intercambio. Aparecerá aquí sola cuando la IA escriba la respuesta; también puedes pegarla o descartarla." } : null);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  }, [path, toast]);

  const reload = useCallback(async (level?: number) => {
    try {
      const i = await api.ladderLoad(path);
      setInfo(i);
      setError("");
      if (i.pending) await openLevel(i.pending.level, { graded: false, request: i.pending.id });
      else await openLevel(level ?? i.state.current);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path, openLevel]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handle = (r: LadderGraded | PracticeWaiting) => {
    if (!r.graded) {
      if (!r.waiting) setPending(r);
      return;
    }
    setResult(r);
    setPending(null);
    useStudyVersion.getState().bump();
    setRunning(false);
    if (r.proof !== undefined) {
      setProof(r.proof);
      setShowProof(true);
    }
    setStatus({ text: "Corregido y guardado en tu historial de práctica." });
    api.ladderLoad(path).then(setInfo).catch(() => undefined);
  };

  useEffect(() => {
    const req = pending?.request;
    if (!req) return;
    const id = setInterval(() => {
      api.ladderReply(path, req).then(handle).catch((e: Error) => {
        setStatus({ text: e.message, error: true });
        setPending(null);
      });
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.request, path]);

  const edit = (next: LadderData) => {
    setData(next);
    if (!running && timer.workElapsed === 0) setRunning(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const level = lv?.level;
    if (level) draftTimer.current = setTimeout(() => void api.ladderSaveDraft(path, level, next).catch(() => undefined), 800);
  };

  const submit = async (via = "") => {
    if (!lv || busy) return;
    setBusy(true);
    try {
      const r = await api.ladderGrade(path, lv.level, data, timer.workElapsed, seen, via);
      if (r.graded) handle(r);
      else {
        setPending(r);
        if (r.bridge && r.prompt) {
          await copyText(r.prompt);
          if (r.url) void api.openExternal(r.url).catch(() => undefined);
          setStatus({ text: `Prompt copiado${r.url ? ` y abierta la web de ${r.label}` : ""}. Pégalo allí, copia la respuesta (el bloque JSON) y pulsa «Pegar corrección».` });
        } else {
          await copyText(`Corrige la solicitud de práctica de NoteVault que está en ${r.request_path}: sigue sus instrucciones y escribe solo el JSON de la corrección en ${r.response_file}.`);
          setStatus({ text: "Solicitud escrita e instrucción copiada al portapapeles: pégala en tu IA de editor. La corrección aparecerá aquí sola." });
        }
      }
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    if (!pending?.request) return;
    const text = (await readClipboard().catch(() => "")).trim();
    if (!text) {
      setStatus({ text: "El portapapeles está vacío: copia primero la respuesta del asistente.", error: true });
      return;
    }
    try {
      handle(await api.ladderReply(path, pending.request, text));
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };

  const discard = async () => {
    if (!pending?.request) return;
    await api.ladderDiscard(path, pending.request).catch(() => undefined);
    setPending(null);
    setStatus({ text: "Solicitud descartada. Puedes volver a entregar tu respuesta." });
  };

  const revealProof = async () => {
    if (!lv) return;
    if (showProof) {
      setShowProof(false);
      return;
    }
    if (!result) {
      if (!(await confirmAction("Ver demostración", "Ver la demostración antes de entregar cuenta como intento con ayuda: el nivel volverá pronto a tu repaso. ¿Continuar?", "Ver demostración"))) return;
      setSeen(true);
      if (lv.level !== 2 && !data.fields.some((f) => f.trim())) {
        try {
          handle(await api.ladderGiveUp(path, lv.level, data, timer.workElapsed));
        } catch (e) {
          toast("error", (e as Error).message);
        }
        return;
      }
    }
    try {
      setProof((await api.ladderProof(path)).proof);
      setShowProof(true);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 p-8 text-[13px]">
        <span className="text-danger">{error}</span>
        <button type="button" onClick={onExit} className="text-accent-text">Volver a la nota</button>
      </div>
    );
  }
  if (!info || !lv) return <div className="p-8 text-[13px] text-faint">Cargando…</div>;

  const graded = !!result;
  const locked = graded || !!pending;
  const setField = (i: number, v: string) => edit({ ...data, fields: data.fields.map((f, k) => (k === i ? v : f)) });
  const marks = result && lv.level === 2 ? result.result.rubric : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-8 py-6">
        <header className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-accent-text">Escalera de demostración</div>
            <h1 className="text-[22px] font-bold tracking-tight text-text">{info.title}</h1>
            <div className="mt-1 text-[12px] text-dim">
              {info.technique && <>{info.technique} · </>}<span className="text-warn">{"★".repeat(info.difficulty)}</span>
              {" · "}{info.steps} pasos
            </div>
          </div>
          <TimerBox spec={lv.timer} state={timer} running={running} onToggle={() => setRunning(!running)}
            onReset={() => {
              setTimer(initialTimer());
              setRunning(false);
            }} />
          <button type="button" onClick={onExit}
            className="flex flex-none items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-dim hover:bg-hover hover:text-text">
            <BookOpen size={13} /> Ver nota
          </button>
        </header>

        <nav aria-label="Niveles" className="flex flex-wrap gap-1.5">
          {info.levels.map((l) => {
            const unlocked = l.number <= info.state.current;
            const passed = info.state.passed.includes(l.number);
            const best = info.state.best[String(l.number)];
            return (
              <button
                key={l.number}
                type="button"
                disabled={!unlocked || !!pending}
                onClick={() => void openLevel(l.number)}
                title={unlocked ? `${l.label}${best !== undefined ? ` · mejor ${best}` : ""}` : "Supera el nivel anterior para desbloquearlo"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
                  lv.level === l.number ? "border-accent bg-accent-soft text-text" : "border-line text-dim hover:bg-hover",
                  !unlocked && "opacity-45",
                )}
              >
                {!unlocked ? <Lock size={11} /> : passed ? <Check size={12} className="text-mint" /> : null}
                <span className="font-semibold">L{l.number}</span> {l.label}
                {info.state.current === l.number && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </nav>

        <section>
          <h2 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Teorema</h2>
          <div className="nv-prose nv-inline rounded-xl border border-line bg-card px-5 py-4 text-[15px]" dangerouslySetInnerHTML={md(info.statement)} />
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">Nivel {lv.level} · {lv.label}</h2>
            <p className="text-[13px] text-dim">{lv.task}</p>
          </div>

          {(lv.level === 1 || lv.level === 5) && (
            <textarea aria-label="Tu respuesta" readOnly={locked} value={data.fields[0] ?? ""}
              onChange={(e) => setField(0, e.target.value)} rows={lv.level === 1 ? 6 : 14}
              placeholder={lv.level === 1 ? "Técnica, sobre qué se aplica y la idea clave…" : "Escribe la demostración paso a paso, justificando cada paso."}
              className={FIELD} />
          )}

          {lv.level === 2 && lv.steps && data.order && (
            <OrderList steps={lv.steps} order={data.order} locked={locked} marks={marks}
              onChange={(order) => edit({ ...data, order })} />
          )}

          {lv.level === 3 && lv.steps && data.hidden && lv.steps.map((s, i) => {
            const slot = data.hidden!.indexOf(i);
            return (
              <div key={i} className={cn("flex gap-3 rounded-lg border bg-panel px-3 py-2.5", slot >= 0 ? "border-accent" : "border-line")}>
                <Badge n={i + 1} />
                <div className="min-w-0 flex-1">
                  {slot >= 0 ? (
                    <>
                      <div className="mb-1.5 text-[13px] font-semibold text-accent-text">Paso oculto: escríbelo tú.</div>
                      <textarea aria-label={`Paso ${i + 1}`} readOnly={locked} value={data.fields[slot] ?? ""}
                        onChange={(e) => setField(slot, e.target.value)} rows={3} className={FIELD} />
                    </>
                  ) : (
                    <>
                      <div className="nv-prose nv-inline text-[14px]" dangerouslySetInnerHTML={md(s.text)} />
                      {s.why && <div className="nv-prose nv-inline text-[12.5px] text-dim" dangerouslySetInnerHTML={md(`Por qué: ${s.why}`)} />}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {lv.level === 4 && lv.steps && lv.steps.map((s, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
              <Badge n={i + 1} />
              <div className="min-w-0 flex-1">
                <div className="nv-prose nv-inline mb-1.5 text-[14px]" dangerouslySetInnerHTML={md(s.text)} />
                <textarea aria-label={`Por qué ${i + 1}`} readOnly={locked} value={data.fields[i] ?? ""} placeholder="Por qué: …"
                  onChange={(e) => setField(i, e.target.value)} rows={2} className={FIELD} />
              </div>
            </div>
          ))}

          {lv.level === 6 && lv.variants && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {lv.variants.map((_, i) => (
                  <button key={i} type="button" disabled={locked} onClick={() => edit({ ...data, variant: i })}
                    className={cn("rounded-lg border px-2.5 py-1 text-[12px]", data.variant === i ? "border-accent bg-accent-soft text-text" : "border-line text-dim hover:bg-hover")}>
                    Variante {i + 1}
                  </button>
                ))}
              </div>
              <div className="nv-prose nv-inline rounded-lg border border-line bg-card px-4 py-3 text-[14.5px]"
                dangerouslySetInnerHTML={md(`**${lv.variants[data.variant ?? 0] ?? ""}**`)} />
              <textarea aria-label="Tu respuesta" readOnly={locked} value={data.fields[0] ?? ""} rows={14}
                onChange={(e) => setField(0, e.target.value)} placeholder="Escribe la demostración de la variante, paso a paso." className={FIELD} />
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!pending && !graded && (
              <button type="button" disabled={busy} onClick={() => void submit()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
                <Send size={14} /> {lv.level === 2 ? "Comprobar orden" : "Entregar para corrección"}
              </button>
            )}
            {!pending && !graded && lv.level !== 2 && (
              <button type="button" disabled={busy} onClick={() => void submit("handoff")}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text disabled:opacity-50">
                <FileOutput size={14} /> Archivo de intercambio
              </button>
            )}
            {pending && (
              <>
                <button type="button" onClick={() => void paste()}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong">
                  <ClipboardPaste size={14} /> Pegar corrección
                </button>
                <button type="button" onClick={() => void discard()}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text">
                  <X size={14} /> Descartar solicitud
                </button>
              </>
            )}
            <button type="button" onClick={() => void revealProof()}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-faint hover:bg-hover hover:text-text">
              <Eye size={14} /> {showProof ? "Ocultar demostración" : "Ver demostración modelo"}
            </button>
          </div>
        </section>

        {status && <p role="status" className={cn("text-[12.5px]", status.error ? "text-danger" : "text-dim")}>{status.text}</p>}

        {result && (
          <ResultCard
            result={result.result}
            quality={result.quality}
            rubric={result.rubric}
            onRetry={() => void openLevel(Math.min(lv.level, result.current))}
            banner={
              <div className={cn("rounded-lg px-3 py-2 text-[13px] font-semibold", result.passed ? "bg-mint-soft text-mint" : "bg-warn-soft text-warn")}>
                {result.message}
                {result.current !== lv.level && (
                  <button type="button" onClick={() => void openLevel(result.current)} className="ml-3 underline">
                    Ir a L{result.current}
                  </button>
                )}
              </div>
            }
          />
        )}

        {showProof && proof !== null && (
          <section>
            <h2 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Demostración modelo</h2>
            <div className="nv-prose nv-inline rounded-xl border border-line bg-card px-5 py-4 text-[15px]" dangerouslySetInnerHTML={md(proof)} />
          </section>
        )}
      </div>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-elevated font-mono text-[11px] text-dim">{n}</span>;
}

/** L2: drag the cards (or use the arrows) into the order of the proof. */
function OrderList({ steps, order, locked, marks, onChange }: {
  steps: Array<{ text: string }>; order: number[]; locked: boolean; marks: boolean[] | null;
  onChange: (order: number[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Pasos a ordenar">
      {order.map((step, pos) => (
        <li
          key={step}
          draggable={!locked}
          onDragStart={() => setDragging(pos)}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            if (dragging !== pos) {
              move(dragging, pos);
              setDragging(pos);
            }
          }}
          onDragEnd={() => setDragging(null)}
          data-dropzone
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-panel px-2.5 py-2",
            marks ? (marks[pos] ? "border-mint" : "border-danger") : dragging === pos ? "border-accent" : "border-line",
            !locked && "cursor-grab",
          )}
        >
          {!locked && <GripVertical size={14} className="flex-none text-faint" />}
          <Badge n={pos + 1} />
          <div className="nv-prose nv-inline min-w-0 flex-1 text-[14px]" dangerouslySetInnerHTML={md(steps[step]!.text)} />
          {marks && <span className={marks[pos] ? "text-mint" : "text-danger"}>{marks[pos] ? "✓" : "✗"}</span>}
          {!locked && (
            <span className="flex flex-none flex-col">
              <button type="button" aria-label={`Subir paso ${pos + 1}`} onClick={() => move(pos, pos - 1)} className="text-faint hover:text-text"><ArrowUp size={13} /></button>
              <button type="button" aria-label={`Bajar paso ${pos + 1}`} onClick={() => move(pos, pos + 1)} className="text-faint hover:text-text"><ArrowDown size={13} /></button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
