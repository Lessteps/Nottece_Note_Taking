// Exercise notes (type: exercise) open here in reading mode: statement,
// answer, hints, timer, AI grading and the attempt history.

import {
  BookOpen, Bug, ClipboardPaste, Eye, FileOutput, Lightbulb, Pause, Pencil, PenTool, Play, RotateCcw, Send, SlidersHorizontal, Sparkles, Timer, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText, readClipboard } from "../../lib/clipboard";
import { answerAsCode, firstFencedCode, openCodePanel } from "../../lib/codeBridge";
import { display, initialTimer, tick, type TimerState } from "../../lib/practiceTimer";
import { DEFAULT_CODE, useCodePanel } from "../../store/codePanel";
import type { PracticeExercise, PracticeGraded, PracticeWaiting } from "../../lib/types";
import { useApp, type OpenNote } from "../../store/app";
import { cn, confirmAction } from "../ui";
import { useStudyVersion } from "../study/StudyPanel";
import { AudioClip } from "./AudioClip";
import { DrillPanel } from "./DrillPanel";
import { ConceptQuizPanel } from "./ConceptQuizPanel";
import { ProjectStructureLab } from "./ProjectStructureLab";
import { PracticeCodeEditor } from "./PracticeCodeEditor";
import { openInkPad, registerAnswerTarget } from "./inkBridge";
import { beep, md, ResultCard } from "./common";

const SUBJECTS: Record<string, string> = { mathematics: "Matemáticas", programming: "Programación", english: "Inglés", general: "General" };
const PLACEHOLDERS: Record<string, string> = {
  prove: "Escribe la demostración paso a paso, justificando cada paso.",
  process: "Escribe el desarrollo paso a paso aplicando la técnica o método adecuado, justificando cada transformación.",
  counterexample: "Da el objeto concreto y comprueba que cumple las hipótesis y falla la conclusión.",
  true_false: "Escribe «Verdadero» o «Falso» y justifícalo con una prueba o un contraejemplo.",
  find_error: "Señala dónde está el error, por qué está mal y cómo se corrige.",
  explain: "Explícalo con tus palabras, como si se lo enseñaras a alguien, con un ejemplo.",
  debug: "Para cada bug: línea, por qué falla y el arreglo. Empieza por tu hipótesis.",
  refactor: "Escribe el código refactorizado y, debajo, qué mejoraste y por qué.",
  design: "Escribe tu diseño (tablas, tipos, restricciones o SQL) y justifica las decisiones.",
  commands: "Escribe la secuencia de comandos, uno por línea, con un comentario de por qué.",
  project_structure: "Escribe la estructura de carpetas/archivos y los comandos de entorno en orden.",
  pg_quiz: "Escribe tu opción (A–D) y la justificación para cada pregunta.",
  implement: "Escribe tu código. Pruébalo con «Depurar código» (panel de la derecha); al entregarlo, el profesor lo lee y razona sobre él.",
  writing: "Write your text here.",
  rewrite: "Rewrite each sentence correctly, one per line.",
  translate: "Write your translation here.",
  cloze: "Escribe las palabras que faltan, en orden, una por línea.",
};


export function PracticeView({ note }: { note: OpenNote }) {
  const toast = useApp((s) => s.toast);
  const [ex, setEx] = useState<PracticeExercise | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState<string | null>(null);
  const [solutionSeen, setSolutionSeen] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [result, setResult] = useState<PracticeGraded | null>(null);
  const [pending, setPending] = useState<PracticeWaiting | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [timer, setTimer] = useState<TimerState>(initialTimer);
  const [running, setRunning] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(true);
  const [showTheory, setShowTheory] = useState(false);
  const [theoryText, setTheoryText] = useState<string | null>(null);
  const [theoryLoading, setTheoryLoading] = useState(false);
  const secondsOverride = useRef<number | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rel = note.path;
  const helperChoice = sessionStorage.getItem(`nv.practice.helper:${rel}`);

  const toggleTheory = async () => {
    if (showTheory) {
      setShowTheory(false);
      return;
    }
    setShowTheory(true);
    if (!theoryText) {
      setTheoryLoading(true);
      try {
        const topicFolder = rel.replace(/\/Ejercicios\/.*$/, "");
        const topicName = topicFolder.split("/").pop() || "";
        const theoryPath = `${topicFolder}/${topicName}.md`;
        const data = await api.readNote(theoryPath);
        setTheoryText(data?.raw || "No se encontró el archivo de teoría.");
      } catch {
        setTheoryText("No se pudo cargar la nota de teoría.");
      } finally {
        setTheoryLoading(false);
      }
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await api.practiceLoad(rel);
      setEx(data);
      setError("");
      setAnswer(data.pending?.answer ?? data.draft);
      setHints(data.pending?.hints_used ?? 0);
      setSolutionSeen(data.pending?.solution_seen ?? false);
      secondsOverride.current = data.pending ? data.pending.seconds : null;
      setResult(null);
      setSolution(null);
      setShowSolution(false);
      setTimer(initialTimer());
      setRunning(false);
      if (data.pending) {
        setPending({ graded: false, request: data.pending.id });
        setStatus({ text: `Tienes una corrección pendiente (${data.pending.id}). Aparecerá aquí sola cuando la IA escriba la respuesta; también puedes pegarla o descartar la solicitud.` });
      } else {
        setPending(null);
        setStatus(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    // The note's text is the source: reload when it changes.
  }, [rel]);

  useEffect(() => {
    void load();
  }, [load, note.modified]);

  // Clock.
  useEffect(() => {
    if (!running || !ex) return;
    const id = setInterval(() => {
      setTimer((s) => {
        const r = tick(ex.timer, s);
        if (r.alarm) {
          beep();
          setStatus({ text: "Se acabó el tiempo previsto. Puedes seguir: el tiempo extra también se registra." });
        }
        return r.state;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, ex]);

  const finish = (r: PracticeGraded) => {
    useStudyVersion.getState().bump();
    setResult(r);
    setPending(null);
    setRunning(false);
    secondsOverride.current = null;
    if (r.solution !== undefined) {
      setSolution(r.solution);
      setShowSolution(true);
    }
    setEx((cur) => (cur ? { ...cur, history: r.history, pending: null } : cur));
    setStatus(r.submissionError ? { text: `La entrega se calificó, pero no se pudo guardar su carpeta: ${r.submissionError}`, error: true } : { text: r.submissionPath ? `Corregido. Entrega guardada en ${r.submissionPath}.` : "Corregido y guardado en tu historial de práctica." });
  };

  const handle = (r: PracticeGraded | PracticeWaiting) => {
    if (r.graded) finish(r);
    else if (!r.waiting) setPending(r);
  };

  // A handoff request: wait for the agent's response file.
  useEffect(() => {
    const req = pending?.request;
    if (!req) return;
    const id = setInterval(() => {
      api.practiceReply(rel, req).then(handle).catch((e: Error) => {
        setStatus({ text: e.message, error: true });
        setPending(null);
      });
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.request, rel]);

  const seconds = () => secondsOverride.current ?? timer.workElapsed;

  const onAnswer = (text: string) => {
    setAnswer(text);
    if (text.trim() && !running && timer.workElapsed === 0) setRunning(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => void api.practiceSaveDraft(rel, text).catch(() => undefined), 800);
  };

  // The drawing pad (a split view) writes recognised maths into this answer.
  const answerRef = useRef({ answer, onAnswer });
  answerRef.current = { answer, onAnswer };
  useEffect(() => {
    registerAnswerTarget((latex, display) => {
      const { answer: current, onAnswer: write } = answerRef.current;
      const piece = display ? `$$${latex}$$` : `$${latex}$`;
      write(current.trim() ? `${current.trimEnd()}\n${piece}` : piece);
    });
    return () => registerAnswerTarget(null);
  }, []);

  // The debugger panel of the right column writes the code it was working on back into this answer.
  const codeSink = useCallback((code: string) => answerRef.current.onAnswer(code), []);
  useEffect(() => () => useCodePanel.getState().clearSink(codeSink), [codeSink]);

  const debugCode = () => {
    if (!ex) return;
    const fromStatement = ex.code.trim() ? ex.code : firstFencedCode(ex.statement);
    // Reading exercises start from the code they give you; writing ones from what you have already typed.
    const readsCode = ["debug", "find_error", "review", "trace", "analyze"].includes(ex.mode.id);
    const mine = answer.trim() ? answerAsCode(answer) : "";
    const seed = (readsCode ? fromStatement || mine : mine || fromStatement) || DEFAULT_CODE[ex.run_language] || "";
    openCodePanel({ code: seed, language: ex.run_language, label: ex.title, sink: codeSink });
  };

  const submit = async (via = "") => {
    if (!ex || busy) return;
    if (!answer.trim()) {
      setStatus({ text: "Escribe una respuesta antes de entregarla.", error: true });
      return;
    }
    setBusy(true);
    setStatus({
      text:
        via === "handoff"
          ? "Escribiendo la solicitud…"
          : via === "bridge" || via === "prompt"
            ? "Generando prompt de corrección…"
            : "Corrigiendo…",
    });
    try {
      const r = await api.practiceGrade(rel, answer, hints, seconds(), solutionSeen, via);
      if (r.graded) finish(r);
      else {
        setPending(r);
        if (r.bridge && r.prompt) {
          await copyText(r.prompt);
          setStatus({ text: "Prompt de corrección copiado al portapapeles. Pégalo en tu asistente, copia la respuesta y pulsa «Pegar corrección»." });
        } else {
          const invocation = `Corrige la solicitud de práctica de NoteVault que está en ${r.request_path}: sigue sus instrucciones y escribe solo el JSON de la corrección en ${r.response_file}.`;
          await copyText(invocation);
          setStatus({ text: "Solicitud escrita y una instrucción lista para pegar copiada al portapapeles. Pégala en tu IA de editor (Claude Code, Antigravity…); la corrección aparecerá aquí sola cuando escriba el archivo." });
        }
      }
    } catch (e) {
      setStatus({
        text: `${(e as Error).message} Si no tienes API key configurada, puedes pulsar «Entregar con Prompt IA (sin API key)» o usar el archivo de intercambio.`,
        error: true,
      });
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
      handle(await api.practiceReply(rel, pending.request, text));
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };

  const discard = async () => {
    if (!pending?.request) return;
    await api.practiceDiscard(rel, pending.request).catch(() => undefined);
    setPending(null);
    secondsOverride.current = null;
    setStatus({ text: "Solicitud descartada. Puedes volver a entregar tu respuesta." });
  };

  const hint = async () => {
    if (!ex || hints >= ex.hints.length) return;
    if (helperChoice === "0") { setStatus({ text: "El modo sin ayuda está activo para esta práctica.", error: true }); return; }
    if (helperChoice !== "1" && ex.assistance === "nohelp" && hints === 0
      && !(await confirmAction("Ejercicio sin ayuda", "Este ejercicio está pensado para hacerse sin pistas. ¿Ver la primera igualmente?", "Ver pista"))) return;
    setHints(hints + 1);
  };

  const seeSolution = async () => {
    if (!ex) return;
    if (showSolution) {
      setShowSolution(false);
      return;
    }
    if (!result) {
      if (!(await confirmAction("Ver solución", "Ver la solución antes de entregar cuenta como intento con ayuda: el ejercicio volverá pronto a tu repaso. ¿Continuar?", "Ver solución"))) return;
      setSolutionSeen(true);
      if (!answer.trim()) {
        try {
          finish(await api.practiceGiveUp(rel, seconds(), hints));
        } catch (e) {
          toast("error", (e as Error).message);
        }
        return;
      }
    }
    try {
      setSolution((await api.practiceSolution(rel)).solution);
      setShowSolution(true);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const retry = () => {
    setResult(null);
    setHints(0);
    setAnswer("");
    setSolutionSeen(false);
    setShowSolution(false);
    setTimer(initialTimer());
    setRunning(false);
    setStatus(null);
  };

  const statement = useMemo(() => {
    if (!ex) return "";
    let s = ex.statement.trim();
    if (ex.code.trim()) s += `\n\n\`\`\`${ex.code_lang}\n${ex.code.trimEnd()}\n\`\`\`\n`;
    return s;
  }, [ex]);

  const renderedStatement = useMemo(() => (statement ? md(statement) : null), [statement]);

  const hintsMd = useMemo(() => {
    if (!ex || hints <= 0) return "";
    return ex.hints.slice(0, hints).map((h, i) => `**Pista ${i + 1}.** ${h.trim()}`).join("\n\n");
  }, [ex, hints]);

  const renderedHints = useMemo(() => (hintsMd ? md(hintsMd) : null), [hintsMd]);

  const renderedSolution = useMemo(() => {
    if (solution === null) return null;
    return md(solution.trim() || "_(La nota no trae solución modelo.)_");
  }, [solution]);

  if (error) {
    return <div className="p-8 text-[13px] text-danger">No se pudo leer el ejercicio: {error}</div>;
  }
  if (!ex) return <div className="p-8 text-[13px] text-faint">Cargando ejercicio…</div>;

  const graded = !!result;
  const code = ex.mode.answer_kind === "code";
  const canRun = !!ex.run_language && !["explain", "decompose", "commands"].includes(ex.mode.id) && (ex.mode.id !== "design" || ex.run_language === "sql");
  const clock = display(ex.timer, timer);
  const best = ex.history.length ? Math.max(...ex.history.map((h) => h.score)) : null;
  const isProjectLab = ex.mode.id === "project_structure" || ex.mode.id === "commands";
  const isCodeExercise =
    code ||
    ["implement", "refactor", "debug", "test", "review", "port", "optimize", "cloze", "pp_kata"].includes(ex.mode.id) ||
    (ex.subject === "programming" && canRun);
  const isWideLayout = isProjectLab || isCodeExercise;
  const starterCode = ex.code.trim() ? ex.code : firstFencedCode(ex.statement);

  return (
    <div className="h-full overflow-y-auto nv-practice-view">
      <div className={cn("mx-auto flex min-w-0 flex-col gap-4 py-4 w-full", isWideLayout ? "max-w-7xl px-3 sm:px-6 lg:px-8" : "max-w-[860px] px-3 sm:px-6")}>
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-[22px] font-bold tracking-tight text-text">{ex.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
              <span>{SUBJECTS[ex.subject] ?? ex.subject}</span>·
              <span>{ex.discipline}{ex.skill && ` · ${ex.skill}`}</span>·
              <span className="font-semibold text-accent-text">{ex.mode.label}</span>·
              <span className="text-warn">{"★".repeat(ex.difficulty)}</span>
              {ex.level && <>· <span>Nivel {ex.level}</span></>}
              {ex.assistance === "nohelp" && <>· <span>Sin ayuda</span></>}
            </div>
            <div className="mt-1 text-[11.5px] text-faint">
              {ex.history.length
                ? `${ex.history.length} intento${ex.history.length === 1 ? "" : "s"} · mejor ${best}/100 · último ${ex.history[ex.history.length - 1]!.at.slice(0, 10)}`
                : "Primer intento de este ejercicio."}
            </div>
          </div>
          {ex.timer.kind !== "off" && (
            <div className="flex flex-none items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
              <Timer size={15} className="text-faint" />
              <div className="text-right">
                <div className={cn("font-mono text-[19px] font-semibold", clock.over ? "text-danger" : timer.phase === "break" ? "text-mint" : "text-text")}>
                  {clock.text}
                </div>
                <div className="text-[10.5px] text-faint">{clock.label}{!running && timer.workElapsed > 0 ? " · en pausa" : ""}</div>
              </div>
              <button type="button" title={running ? "Pausar" : "Iniciar"} onClick={() => setRunning(!running)}
                className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-text">
                {running ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button type="button" title="Reiniciar" onClick={() => {
                setTimer(initialTimer());
                setRunning(false);
              }} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-text">
                <RotateCcw size={13} />
              </button>
            </div>
          )}
          <button type="button" title="Editar la nota del ejercicio" onClick={() => useApp.getState().setMode("edit")}
            className="flex flex-none items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-dim hover:bg-hover hover:text-text">
            <Pencil size={13} /> Editar
          </button>
        </header>

        {showTheory && (
          <section className="rounded-xl border border-line bg-panel p-4 shadow-sm animate-fadeIn">
            <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-accent-text" />
                <span className="font-semibold text-[13px] text-text">Referencia Teórica del Tema</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTheory(false)}
                className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
            {theoryLoading ? (
              <p className="text-[12.5px] text-faint">Cargando teoría…</p>
            ) : (
              <div
                className="nv-prose max-h-[350px] overflow-y-auto pr-2 text-[13.5px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: md(theoryText?.replace(/^---[\s\S]*?---\s*/, "") || "") }}
              />
            )}
          </section>
        )}

        {renderedStatement && (
          <section>
            <h2 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Enunciado</h2>
            <div className="nv-prose rounded-xl border border-line bg-card px-5 py-4 text-[15px]" dangerouslySetInnerHTML={renderedStatement} />
          </section>
        )}

        {ex.audio_text && <AudioClip text={ex.audio_text} media={ex.media ?? null} revealed={graded} />}

        {ex.drill ? (
          <DrillPanel
            rel={rel}
            drill={ex.drill}
            difficulty={ex.difficulty}
            onStart={() => {
              setResult(null);
              setTimer(initialTimer());
              setRunning(true);
            }}
            seconds={() => timer.workElapsed}
            onFinish={finish}
          />
        ) : (() => {
          const isQuiz = ex.mode.id === "pg_quiz" || ex.mode.id === "pg_true_false";
          const isProjectLab = ex.mode.id === "project_structure" || ex.mode.id === "commands";
          const hasInteractiveView = isQuiz || isProjectLab || isCodeExercise;

          return (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
                  {isCodeExercise ? "Tu solución de código" : "Tu respuesta"}
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void toggleTheory()}
                    title="Consulta la nota de teoría del tema para repasar conceptos y comandos"
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                      showTheory ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-card text-dim hover:border-accent hover:text-text",
                    )}
                  >
                    <BookOpen size={12} /> {showTheory ? "Ocultar teoría" : "Ver teoría"}
                  </button>
                  {hasInteractiveView && (
                    <button
                      type="button"
                      onClick={() => setInteractiveMode(!interactiveMode)}
                      title={interactiveMode ? "Cambiar a editor de texto libre" : "Cambiar a vista especializada"}
                      className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-semibold text-dim transition-colors hover:border-accent hover:text-ink"
                    >
                      <SlidersHorizontal size={12} /> {interactiveMode ? "Ver texto directo" : isCodeExercise ? "Editor de código" : "Modo interactivo"}
                    </button>
                  )}
                  {canRun && !isCodeExercise && (
                    <button
                      type="button"
                      onClick={debugCode}
                      title="Abre el depurador en el panel derecho con el código de este ejercicio: ejecútalo y recórrelo línea a línea"
                      className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-semibold text-dim transition-colors hover:border-accent hover:text-ink"
                    >
                      <Bug size={12} /> Depurar código
                    </button>
                  )}
                  {(ex.subject === "mathematics" || ["prove", "solve", "process", "counterexample", "true_false", "find_error", "drill", "explain"].includes(ex.mode.id)) && !graded && (
                    <button
                      type="button"
                      onClick={() => void openInkPad()}
                      title="Abre un lienzo infinito en una vista dividida para escribir a mano"
                      className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-semibold text-dim transition-colors hover:border-accent hover:text-ink"
                    >
                      <PenTool size={12} /> Dibujar (LaTeX)
                    </button>
                  )}
                </div>
              </div>

              {hasInteractiveView && interactiveMode ? (
                isQuiz ? (
                  <ConceptQuizPanel
                    statement={ex.statement}
                    mode={ex.mode.id}
                    value={answer}
                    disabled={graded || !!pending}
                    onChange={onAnswer}
                  />
                ) : isProjectLab ? (
                  <ProjectStructureLab
                    statement={ex.statement}
                    discipline={ex.discipline}
                    value={answer}
                    disabled={graded || !!pending}
                    onChange={onAnswer}
                  />
                ) : (
                  <PracticeCodeEditor
                    value={answer}
                    onChange={onAnswer}
                    language={ex.run_language || ex.code_lang || "python"}
                    disabled={graded || !!pending}
                    starterCode={starterCode}
                    placeholder={PLACEHOLDERS[ex.mode.id] ?? "Escribe tu solución de código aquí..."}
                    mode={ex.mode.id}
                    onImportFile={async () => {
                      const file = await api.practicePickCodeFile();
                      if (!file?.text) return;
                      const block = file.text;
                      const next = answer.trim() ? `${answer.replace(/\s*$/, "")}\n\n${block}` : block;
                      onAnswer(next);
                    }}
                  />
                )
              ) : (
                <textarea
                  aria-label="Tu respuesta"
                  value={answer}
                  readOnly={graded || !!pending}
                  onChange={(e) => onAnswer(e.target.value)}
                  placeholder={PLACEHOLDERS[ex.mode.id] ?? "Escribe tu respuesta."}
                  spellCheck={!code}
                  className={cn(
                    "min-h-[220px] resize-y rounded-xl border border-line bg-panel p-4 text-[14px] leading-relaxed text-text outline-none placeholder:text-faint focus:border-accent",
                    code && "font-mono text-[13px]",
                  )}
                />
              )}
              {renderedHints && (
                <div className="nv-prose rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-[14px]"
                  dangerouslySetInnerHTML={renderedHints} />
              )}
              <div className="flex flex-wrap items-center gap-2">
              {!pending && !graded && (
                <button type="button" disabled={busy} onClick={() => void submit()}
                  title="Corrige automáticamente con el proveedor de IA configurado"
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
                  <Send size={14} /> Entregar para corrección
                </button>
              )}
              {!pending && !graded && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit("bridge")}
                  title="Copia el prompt completo con rúbrica, solución y contexto listo para pegar en ChatGPT, Claude o Gemini web (sin API key requerida)"
                  className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/40 px-3.5 py-2 text-[12.5px] font-semibold text-accent-text hover:bg-accent-soft hover:border-accent disabled:opacity-50"
                >
                  <Sparkles size={14} /> Entregar con Prompt IA (sin API key)
                </button>
              )}
              {!pending && !graded && (
                <button type="button" disabled={busy} onClick={() => void submit("handoff")} title="Deja la solicitud en un archivo para que la corrija otra IA (Claude Code, Antigravity…)"
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
              {ex.hints.length > 0 && !graded && helperChoice !== "0" && (
                <button type="button" disabled={hints >= ex.hints.length} onClick={() => void hint()}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] text-dim hover:bg-hover hover:text-text disabled:opacity-50">
                  <Lightbulb size={14} /> {hints >= ex.hints.length ? "No hay más pistas" : `Ver pista ${hints + 1} de ${ex.hints.length}`}
                </button>
              )}
              {ex.has_solution && (
                <button type="button" onClick={() => void seeSolution()}
                  className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-faint hover:bg-hover hover:text-text">
                  <Eye size={14} /> {showSolution ? "Ocultar solución" : graded ? "Ver solución modelo" : "Rendirme y ver la solución"}
                </button>
              )}
            </div>
          </section>
        );
      })()}

        {status && (
          <p role="status" className={cn("text-[12.5px] leading-relaxed", status.error ? "text-danger" : "text-dim")}>{status.text}</p>
        )}

        {result?.submissionPath && <button type="button" onClick={() => void api.revealPath(result.submissionPath!).catch((e: Error) => toast("error", e.message))} className="self-start rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-accent-text hover:bg-hover" data-testid="practice-open-submission">Abrir carpeta de entrega</button>}

        {result && <ResultCard result={result.result} quality={result.quality} rubric={ex.rubric} onRetry={retry} />}

        {showSolution && renderedSolution && (
          <section>
            <h2 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">Solución modelo</h2>
            <div className="nv-prose rounded-xl border border-line bg-card px-5 py-4 text-[15px]"
              dangerouslySetInnerHTML={renderedSolution} />
          </section>
        )}
      </div>
    </div>
  );
}
