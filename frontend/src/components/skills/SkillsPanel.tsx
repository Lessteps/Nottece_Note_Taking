// «Skills»: las instrucciones con las que la app (o Antigravity) genera las notas, los mapas y los archivos de práctica. Se ven, se editan a mano, se
// recupera cualquiera de las 3 versiones anteriores y se pide un cambio en lenguaje normal: con la IA de la app (queda como BORRADOR que se revisa y se
// guarda) o como un prompt listo para pegar en Antigravity. Guardar cambia la versión de la skill y la app marca sola las piezas hechas con otra.

import { Check, ClipboardCopy, History, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText } from "../../lib/clipboard";
import type { SkillInfo } from "../../lib/types";
import { useApp } from "../../store/app";
import { useSkillsPanel } from "../../store/skillsPanel";
import { GhostButton, PrimaryButton } from "../common/forms";
import { cn } from "../ui";

type Group = { subject: string; skills: SkillInfo[] };
const SHORT: Record<SkillInfo["kind"], string> = { theory: "Notas", canvas: "Mapa", practica: "Práctica", ejercicios: "Ejercicios" };
const niceDate = (id: string): string => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(id);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : id;
};

export function SkillsPanel() {
  const setOpen = useSkillsPanel((s) => s.setOpen);
  const toast = useApp((s) => s.toast);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<SkillInfo["kind"]>("theory");
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "ai" | "prompt" | "restore">("");
  const [error, setError] = useState("");
  const [maxPast, setMaxPast] = useState(3);
  const [customSkills, setCustomSkills] = useState<Array<{ name: string; file: string }>>([]);
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  useEffect(() => { if (subject) void api.skillsCustomList(subject).then((items) => setCustomSkills(Array.isArray(items) ? items : [])).catch(() => setCustomSkills([])); }, [subject]);
  const createCustom = async () => {
    try { const result = await api.skillsCustomCreate({ subject, name: newName, text: newText }); setCustomSkills(await api.skillsCustomList(subject)); setNewName(""); setNewText(""); toast("info", `Skill creada en ${result.file}`); }
    catch (e) { toast("error", (e as Error).message); }
  };

  const info = useMemo(() => groups.find((g) => g.subject === subject)?.skills.find((s) => s.kind === kind), [groups, subject, kind]);
  const dirty = draft !== saved;

  const reload = async (): Promise<Group[]> => {
    const r = await api.skillsList();
    setGroups(r.subjects);
    setMaxPast(r.maxPast);
    return r.subjects;
  };
  const load = async (s: string, k: SkillInfo["kind"]): Promise<void> => {
    try {
      const r = await api.skillsGet({ subject: s, kind: k });
      setSaved(r.text);
      setDraft(r.text);
      setNote("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    let alive = true;
    reload()
      .then((g) => {
        if (alive && g[0]) setSubject((cur) => cur || g[0]!.subject);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (subject) void load(subject, kind);
  }, [subject, kind]);

  const pick = (k: SkillInfo["kind"]): void => {
    if (dirty && !window.confirm("Tienes cambios sin guardar en esta skill. ¿Descartarlos?")) return;
    setKind(k);
  };

  const save = async (): Promise<void> => {
    setBusy("save");
    try {
      await api.skillsSave({ subject, kind, text: draft });
      await reload();
      setSaved(draft);
      setNote("");
      toast("info", "Skill guardada. La versión anterior queda en el historial; la app marcará sola las piezas hechas con otra versión.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const view = async (id: string): Promise<void> => {
    try {
      const r = await api.skillsGet({ subject, kind, versionId: id });
      setDraft(r.text);
      setNote(`Estás viendo la versión del ${niceDate(id)} como borrador: guárdala para volver a usarla.`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const restore = async (id: string): Promise<void> => {
    if (!window.confirm("Se usará esa versión como la actual (la de ahora pasa al historial). ¿Seguir?")) return;
    setBusy("restore");
    try {
      await api.skillsRestore({ subject, kind, versionId: id });
      await reload();
      await load(subject, kind);
      toast("info", "Versión restaurada.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const ask = async (mode: "app" | "prompt"): Promise<void> => {
    setBusy(mode === "app" ? "ai" : "prompt");
    try {
      const r = await api.skillsAiEdit({ subject, kind, instruction, mode });
      if (mode === "prompt") {
        const ok = await copyText(r.prompt);
        toast(ok ? "info" : "error", ok ? "Prompt copiado: pégalo en Antigravity y pega aquí su respuesta (en el editor) para guardarla." : "No se pudo copiar el prompt.");
      } else if (r.proposal) {
        setDraft(r.proposal);
        setNote("Propuesta de la IA como borrador: revísala y pulsa «Guardar» si te sirve (no se ha guardado nada).");
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const skills = groups.find((g) => g.subject === subject)?.skills ?? [];
  return (
    <aside className="flex h-full w-[460px] flex-none flex-col border-l border-line bg-panel" aria-label="Skills" data-testid="skills-panel">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-faint">Skills</span>
        {groups.length > 1 && (
          <select aria-label="Materia" value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded border border-line bg-card px-1.5 py-0.5 text-[12px]">
            {groups.map((g) => <option key={g.subject} value={g.subject}>{g.subject}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <button type="button" aria-label="Cerrar Skills" title="Cerrar" onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-text"><X size={14} /></button>
      </div>

      <div className="flex-none border-b border-line p-2">
        <p className="px-1 pb-1.5 text-[12px] text-dim">Instrucciones con las que se generan las piezas de cada tema.</p>
        <div role="tablist" aria-label="Qué skill" className="flex gap-1">
          {skills.map((s) => (
            <button
              key={s.kind}
              type="button"
              role="tab"
              aria-selected={kind === s.kind}
              data-testid={`skill-tab-${s.kind}`}
              onClick={() => pick(s.kind)}
              className={cn("flex-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors", kind === s.kind ? "bg-accent text-white" : "bg-card text-dim hover:bg-hover hover:text-text")}
            >
              <span className="block">{SHORT[s.kind]}</span>
              <span className={cn("block font-mono text-[10.5px]", kind === s.kind ? "text-white/80" : "text-faint")}>v {s.version ?? "—"}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="m-3 rounded-lg border border-dashed border-line p-3 text-[13px] text-warn" role="alert" data-testid="skills-error">{error}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {info && (
            <p className="px-1 text-[12px] text-dim" data-testid="skill-meta">
              {info.label} · <code>{info.file}</code> · {info.words} palabras{dirty ? " · sin guardar" : ""}
            </p>
          )}
          {note && <p className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12.5px] text-accent-text" role="status" data-testid="skill-note">{note}</p>}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Texto de la skill"
            data-testid="skill-editor"
            className="min-h-[260px] flex-1 resize-y rounded-lg border border-line bg-card p-2 font-mono text-[12px] leading-relaxed outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2"><GhostButton onClick={() => void copyText(`Revisa las skills de generación de ${subject}, incluidos teoría, mapas, práctica y ejercicios. Examina las instrucciones existentes en ${subject}/_skills y su uso real en NoteVault. Detecta vacíos y conflictos, explica qué función cumpliría cada skill propuesta y discute con el usuario cuáles conviene añadir antes de escribirlas. No reemplaces archivos sin revisar su contenido.`).then((ok) => toast(ok ? "info" : "error", ok ? "Prompt de revisión copiado." : "No se pudo copiar."))}>Verificar creación de skills</GhostButton></div>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => void save()} disabled={!dirty || !draft.trim() || busy !== ""} data-testid="skill-save"><Check size={14} aria-hidden /> Guardar</PrimaryButton>
            <GhostButton onClick={() => { setDraft(saved); setNote(""); }} disabled={!dirty || busy !== ""} data-testid="skill-discard">Descartar cambios</GhostButton>
          </div>

          <details className="rounded-lg border border-line bg-card"><summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Añadir skill personalizada ({customSkills.length})</summary><div className="space-y-2 p-3"><p className="text-xs text-dim">Se guarda en .notevault/skills/{subject} y se añade a las instrucciones de generación de esta materia.</p>{customSkills.map((skill) => <p className="break-all text-xs text-dim" key={skill.file}>{skill.file}</p>)}<input aria-label="Nombre de la nueva skill" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded border border-line bg-panel p-2 text-sm" placeholder="nombre_de_skill" /><textarea aria-label="Instrucciones de la nueva skill" value={newText} onChange={(e) => setNewText(e.target.value)} className="w-full rounded border border-line bg-panel p-2 text-sm" rows={4} placeholder="Función e instrucciones" /><GhostButton disabled={!newName.trim() || !newText.trim()} onClick={() => void createCustom()}>Añadir y guardar skill</GhostButton></div></details>
          <details className="rounded-lg border border-line bg-card" data-testid="skill-versions">
            <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium"><History size={13} aria-hidden /> Versiones anteriores ({info?.past.length ?? 0} de {maxPast})</summary>
            {info && info.past.length === 0 ? (
              <p className="px-2.5 pb-2 text-[12.5px] text-dim">Aún no hay versiones anteriores: aparecen al guardar un cambio.</p>
            ) : (
              <ul className="space-y-1 px-2 pb-2">
                {info?.past.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-md bg-panel px-2 py-1 text-[12.5px]" data-testid="skill-past">
                    <span className="min-w-0 flex-1 truncate">{niceDate(p.id)} · <span className="font-mono text-faint">v {p.version}</span> · {p.words} palabras</span>
                    <button type="button" className="rounded px-1.5 py-0.5 text-accent-text hover:bg-hover" onClick={() => void view(p.id)} data-testid="skill-past-view">Ver</button>
                    <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-accent-text hover:bg-hover disabled:opacity-40" disabled={busy !== ""} onClick={() => void restore(p.id)} data-testid="skill-past-restore"><RotateCcw size={12} aria-hidden /> Restaurar</button>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="rounded-lg border border-line bg-card p-2.5" data-testid="skill-ask">
            <label htmlFor="skill-instruction" className="mb-1 block text-[12.5px] font-medium">Pedir un cambio</label>
            <textarea
              id="skill-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ej.: que cada módulo de la explicación tenga como máximo 100 palabras"
              rows={3}
              data-testid="skill-instruction"
              className="w-full resize-y rounded-lg border border-line bg-panel p-2 text-[13px] outline-none focus:border-accent"
            />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <GhostButton onClick={() => void ask("app")} disabled={busy !== "" || instruction.trim().length < 5} title="La IA de la app (API o modelo local) propone el texto nuevo como borrador" data-testid="skill-ask-app"><Sparkles size={14} aria-hidden /> Proponer con la IA</GhostButton>
              <GhostButton onClick={() => void ask("prompt")} disabled={busy !== "" || instruction.trim().length < 5} title="Copia un prompt con la skill y tu petición para pegarlo en Antigravity" data-testid="skill-ask-prompt"><ClipboardCopy size={14} aria-hidden /> Copiar prompt para Antigravity</GhostButton>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
