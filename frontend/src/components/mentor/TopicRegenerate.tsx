// Mentor — panel desplegable de un tema en «Temas por área»: REGENERAR su teoría (con su canvas), su práctica (la matriz .practica) o sus ejercicios.
//
// Regenerar REEMPLAZA contenido que ya existe, así que cada botón abre un diálogo que lo dice sin rodeos: lo actual se respalda antes (en `.trash`)
// y, si la generación falla, se devuelve. Nada se hace hasta confirmar. El trabajo corre en segundo plano (`study_topic_regenerate`) y se sigue
// aunque el panel se pliegue: al terminar avisa con un mensaje y recarga el catálogo.

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/bridge";
import type { AreaTopicRow } from "../../lib/planAreaTopics";
import { estimateAiCalls, LABEL, OBJECT, regenBlockedReason, type RegenKind, type SingleRegen } from "../../lib/topicSelection";
import type { TopicRegenerateJob } from "../../lib/types";
import { useApp } from "../../store/app";
import { useMentor } from "../../store/mentor";
import { useRegenEngine } from "../../store/regenEngine";
import { GhostButton, Modal, PrimaryButton } from "../common/forms";
import { RegenEngineChoice } from "./RegenEngineChoice";
import { RegenHandoffPanel } from "./RegenHandoffPanel";

export type RegenWhat = RegenKind;

const POLL_MS = 1500;
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/** Lo que el diálogo de confirmación dice que va a pasar (nada de eufemismos: se reemplaza, con copia antes). */
export function confirmCopy(what: RegenWhat, row: Pick<AreaTopicRow, "title" | "exercises">): { lead: string; points: string[] } {
  if (what === "theory") {
    return {
      lead: `Se va a REEMPLAZAR la nota de teoría de «${row.title}» por una nueva escrita por la IA.`,
      points: [
        "Antes se hace una copia de seguridad de la nota actual y de su canvas en la carpeta .trash de tu vault.",
        "También se vuelve a generar su canvas explicativo; la versión anterior queda respaldada en la papelera.",
        "Si la generación falla, se restaura la nota anterior.",
      ],
    };
  }
  if (what === "map") {
    return {
      lead: `Se va a REGENERAR el canvas explicativo (mapa) de «${row.title}» a partir de su nota de teoría actual.`,
      points: [
        "No usa la IA: el mapa se construye de la nota que ya existe.",
        "Antes se hace una copia de seguridad de los canvas actuales en la carpeta .trash de tu vault.",
        "La versión anterior queda respaldada en la papelera, también si la habías editado a mano.",
      ],
    };
  }
  if (what === "all") {
    return {
      lead: `Se va a REEMPLAZAR todo lo generado de «${row.title}»: teoría y mapa, práctica (.practica) y ejercicios, en ese orden.`,
      points: [
        "Antes de cada paso se respalda lo actual en la carpeta .trash de tu vault (los ejercicios se archivan, no se borran).",
        "Si un paso falla, se restaura lo de ese paso y no se sigue con los siguientes.",
      ],
    };
  }
  if (what === "practice") {
    return {
      lead: `Se va a REEMPLAZAR la matriz de práctica (.practica) de «${row.title}»: la IA vuelve a elegir sus competencias.`,
      points: ["Antes se hace una copia de seguridad del archivo .practica actual en la carpeta .trash de tu vault.", "Si la IA no devuelve un plan válido, se restaura el anterior."],
    };
  }
  return {
    lead: `Se van a ARCHIVAR los ejercicios generados de «${row.title}»${row.exercises ? ` (${row.exercises})` : ""} y se generará un juego nuevo.`,
    points: [
      "Los ejercicios actuales se mueven a la carpeta .trash de tu vault (no se borran); el historial de intentos va por ruta y se queda con los archivos archivados.",
      "Se generan ejercicios nuevos para cada competencia y dificultad del tema.",
      "Si no se genera ninguno, se devuelven los anteriores.",
    ],
  };
}

/**
 * Lanza la regeneración y la sigue hasta el final. Vive FUERA de React: si el panel se pliega a mitad, el aviso final sale igual.
 * `onProgress` se llama con cada estado (la interfaz lo ignora si ya se desmontó).
 */
export async function runRegeneration(folder: string, what: SingleRegen, onProgress?: (job: TopicRegenerateJob) => void, opts: { /** sin avisos propios (lo hace quien lanza el lote) */ quiet?: boolean; /** con qué IA: la de la app (por defecto) o Claude */ engine?: "app" | "claude" } = {}): Promise<TopicRegenerateJob> {
  const toast = opts.quiet ? () => undefined : useApp.getState().toast;
  try {
    const { jobId } = await api.studyTopicRegenerate(folder, what, true, opts.engine ?? "app");
    for (;;) {
      const st = await api.studyTopicRegenerateStatus(jobId);
      onProgress?.(st);
      if (st.done) {
        useMentor.setState((s) => ({ planVersion: s.planVersion + 1 }));
        if (st.error) toast("error", `No se pudo regenerar ${OBJECT[what]}: ${st.error}`);
        else toast("info", `Se regeneró ${OBJECT[what]}.${st.backup ? ` Lo anterior está respaldado en ${st.backup}.` : ""}`);
        return st;
      }
      await sleep(POLL_MS);
    }
  } catch (e) {
    toast("error", (e as Error).message);
    throw e;
  }
}

function Artifact({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={ok ? "text-mint" : "text-warn"}>{children}</span>;
}

export function RegeneratePanel({ row }: { row: AreaTopicRow }) {
  const [asking, setAsking] = useState<RegenWhat | null>(null);
  const [busy, setBusy] = useState<RegenWhat | null>(null);
  const [job, setJob] = useState<TopicRegenerateJob | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const handoffs = useRegenEngine((s) => s.handoffs);
  const putHandoff = useRegenEngine((s) => s.putHandoff);
  const effective = useRegenEngine((s) => s.effective);
  const mine = Object.values(handoffs).filter((h) => h.topics.some((t) => t.folder === row.folder));

  const reason = (what: RegenWhat): string => (busy ? "Hay una regeneración en curso de este tema." : regenBlockedReason(row, what));

  const start = async (): Promise<void> => {
    const what = asking;
    setAsking(null);
    if (!what) return;
    // el mapa no usa IA: no hay motor que elegir
    const engine = what === "map" ? "app" : useRegenEngine.getState().effective;
    setBusy(what);
    setJob(null);
    try {
      if (engine === "handoff") {
        // sin IA de la app: se respalda y se escribe la tarea para el agente (Antigravity / Claude Code)
        const h = await api.studyTopicRegenerateHandoff(row.folder, what as Exclude<RegenWhat, "map">, true);
        putHandoff(h);
        useApp.getState().toast("info", "Tarea creada. Pásasela a tu agente y, cuando termine, pulsa «Ya terminó — validar».");
        return;
      }
      await runRegeneration(row.folder, what as SingleRegen, (j) => alive.current && setJob(j), { engine });
    } catch (e) {
      if (engine === "handoff") useApp.getState().toast("error", (e as Error).message);
      /* ya avisado con un mensaje */
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const action = (what: RegenWhat, status: ReactNode): ReactNode => {
    const why = reason(what);
    return (
      <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-card p-3" data-testid={`regen-${what}`}>
        <p className="text-[13.5px]">{status}</p>
        <GhostButton onClick={() => setAsking(what)} disabled={!!why} title={why || `${LABEL[what]}: respalda lo actual y lo reemplaza`} data-testid={`regen-${what}-button`}>
          {busy === what ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} {LABEL[what]}
        </GhostButton>
        {why && <p className="text-[12.5px] text-faint" data-testid={`regen-${what}-hint`}>{why}</p>}
      </li>
    );
  };

  return (
    <div className="space-y-3 px-3 py-3" data-testid="regen-panel">
      <p className="text-[13.5px] text-dim">
        Regenerar <strong>reemplaza</strong> lo que ya existe: antes se respalda en <code>.trash</code> y, si falla, se restaura. No se hace nada sin confirmar.
      </p>
      {mine.map((h) => <RegenHandoffPanel key={h.id} handoff={h} />)}
      <ul className="grid gap-3 @xl:grid-cols-4">
        {action("theory", <><strong>Teoría:</strong> <Artifact ok={row.theory}>{row.theory ? "con nota" : "sin nota"}</Artifact></>)}
        {action("map", <><strong>Mapa (canvas):</strong> <Artifact ok={row.canvas}>{row.canvas ? "con mapa" : "sin mapa"}</Artifact></>)}
        {action("practice", <><strong>Práctica (.practica):</strong> <Artifact ok={row.manifest}>{row.manifest ? "existe" : "no existe"}</Artifact></>)}
        {action("exercises", <><strong>Ejercicios:</strong> <Artifact ok={row.exercises > 0}>{row.exercises > 0 ? `${row.exercises}${row.planExercises ? ` de ${row.planExercises}` : ""}` : "sin ejercicios"}</Artifact></>)}
      </ul>

      {busy && (
        <p role="status" className="text-[13.5px] text-dim" data-testid="regen-progress">
          <Loader2 size={13} className="mr-1 inline animate-spin" aria-hidden />
          {job ? `${job.log[job.log.length - 1] ?? "Trabajando…"} (${job.finished}/${job.total})` : "Empezando…"}
        </p>
      )}

      {asking && (
        <Modal
          title={LABEL[asking]}
          onClose={() => setAsking(null)}
          footer={
            <>
              <span className="flex-1" />
              <GhostButton onClick={() => setAsking(null)} data-testid="regen-cancel">Cancelar</GhostButton>
              <PrimaryButton onClick={() => void start()} data-testid="regen-confirm">{asking !== "map" && effective === "handoff" ? "Crear tarea para el agente" : LABEL[asking]}</PrimaryButton>
            </>
          }
        >
          <div data-testid="regen-dialog" className="space-y-2 text-[14px]">
            <p className="font-semibold">{confirmCopy(asking, row).lead}</p>
            <ul className="list-disc space-y-1 pl-5 text-dim">
              {confirmCopy(asking, row).points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            {asking !== "map" && <RegenEngineChoice aiCalls={estimateAiCalls(row, asking)} />}
          </div>
        </Modal>
      )}
    </div>
  );
}
