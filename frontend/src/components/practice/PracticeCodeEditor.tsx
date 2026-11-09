import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  FileCode,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/bridge";
import { copyText } from "../../lib/clipboard";
import type { CodeRun } from "../../lib/types";
import { cn } from "../ui";

interface PracticeCodeEditorProps {
  value: string;
  onChange: (code: string) => void;
  language: string;
  disabled?: boolean;
  starterCode?: string;
  placeholder?: string;
  mode?: string;
}

const LINE_HEIGHT = 22;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

export function PracticeCodeEditor({
  value,
  onChange,
  language,
  disabled = false,
  starterCode = "",
  placeholder = "Escribe tu código aquí...",
  mode = "code",
}: PracticeCodeEditorProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [runOutcome, setRunOutcome] = useState<CodeRun | null>(null);
  const [showConsole, setShowConsole] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedStarter, setCopiedStarter] = useState(false);
  const [stdin, setStdin] = useState("");
  const [showStdin, setShowStdin] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleCopyCode = async () => {
    if (!value) return;
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoadStarter = () => {
    if (!starterCode) return;
    onChange(starterCode);
    setCopiedStarter(true);
    setTimeout(() => setCopiedStarter(false), 2000);
  };

  const handleClear = () => {
    if (disabled) return;
    onChange("");
    setRunOutcome(null);
  };

  const runCode = useCallback(async () => {
    if (isRunning) return;
    const codeToRun = value.trim();
    if (!codeToRun) {
      setRunOutcome({
        ok: false,
        stdout: "",
        stderr: "El editor está vacío. Escribe o carga código antes de ejecutar.",
        exit_code: 1,
        ms: 0,
        timed_out: false,
        truncated: false,
        runtime: language,
      });
      setShowConsole(true);
      return;
    }

    setIsRunning(true);
    setShowConsole(true);
    try {
      const res = await api.codeRun(language || "python", codeToRun, stdin);
      setRunOutcome(res);
    } catch (e: any) {
      setRunOutcome({
        ok: false,
        stdout: "",
        stderr: e?.message || String(e),
        exit_code: 1,
        ms: 0,
        timed_out: false,
        truncated: false,
        runtime: language,
      });
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, value, language, stdin]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter: Execute code
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runCode();
      return;
    }

    if (disabled) return;

    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    // Tab key: indent / unindent
    if (e.key === "Tab") {
      e.preventDefault();
      const tabStr = "    ";

      if (start === end) {
        // Single cursor position
        if (e.shiftKey) {
          // Unindent current line
          const lineStart = value.lastIndexOf("\n", start - 1) + 1;
          const currentLine = value.slice(lineStart, start);
          const spaces = currentLine.match(/^ {1,4}/);
          if (spaces) {
            const removeCount = spaces[0].length;
            const nextVal = value.slice(0, lineStart) + value.slice(lineStart + removeCount);
            onChange(nextVal);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = Math.max(lineStart, start - removeCount);
            });
          }
        } else {
          // Indent 4 spaces
          const nextVal = value.slice(0, start) + tabStr + value.slice(end);
          onChange(nextVal);
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 4;
          });
        }
      } else {
        // Multiline selection indent/unindent
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = value.indexOf("\n", end);
        const selEnd = lineEnd === -1 ? value.length : lineEnd;
        const selectedText = value.slice(lineStart, selEnd);
        const linesArr = selectedText.split("\n");

        if (e.shiftKey) {
          const unindented = linesArr.map((l) => l.replace(/^ {1,4}/, "")).join("\n");
          const nextVal = value.slice(0, lineStart) + unindented + value.slice(selEnd);
          onChange(nextVal);
        } else {
          const indented = linesArr.map((l) => tabStr + l).join("\n");
          const nextVal = value.slice(0, lineStart) + indented + value.slice(selEnd);
          onChange(nextVal);
        }
      }
      return;
    }

    // Auto-indent on Enter
    if (e.key === "Enter") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      const match = currentLine.match(/^(\s+)/);
      let indent = match ? match[1] : "";

      // Add extra indent if line ends with ':' (Python) or '{' (JS/TS/C)
      const trimmedBefore = currentLine.trimEnd();
      if (trimmedBefore.endsWith(":") || trimmedBefore.endsWith("{")) {
        indent += "    ";
      }

      const nextVal = value.slice(0, start) + "\n" + indent + value.slice(end);
      onChange(nextVal);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1 + indent.length;
      });
      return;
    }
  };

  const hasStarter = Boolean(starterCode && starterCode.trim() !== value.trim());

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line-strong bg-[#141416] text-[#e0e0e0] shadow-md transition-all focus-within:border-accent">
      {/* Editor Header / Action Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#252528] bg-[#1a1a1e] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-[#303036] bg-[#222226] px-2 py-0.5 text-[11px] font-mono font-medium text-accent-text">
            <FileCode size={12} />
            <span>{language ? language.charAt(0).toUpperCase() + language.slice(1) : "Python"}</span>
          </div>
          {mode && (
            <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-faint sm:inline">
              Modo: {mode}
            </span>
          )}
          {hasStarter && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleLoadStarter}
              title="Cargar el código inicial o función dada en el enunciado"
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
                copiedStarter
                  ? "border-mint/50 bg-mint-soft text-mint"
                  : "border-accent/40 bg-accent-soft/40 text-accent-text hover:bg-accent-soft hover:border-accent disabled:opacity-50",
              )}
            >
              {copiedStarter ? <Check size={11} /> : <Download size={11} />}
              <span>{copiedStarter ? "¡Código cargado!" : "Cargar código del enunciado"}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyCode}
            title="Copiar código al portapapeles"
            className="flex items-center gap-1 rounded-md border border-[#303036] bg-[#222226] px-2 py-1 text-[11px] text-dim hover:bg-hover hover:text-text"
          >
            {copied ? <Check size={12} className="text-mint" /> : <Copy size={12} />}
            <span className="hidden sm:inline">{copied ? "Copiado" : "Copiar"}</span>
          </button>

          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Limpiar editor"
              className="flex items-center gap-1 rounded-md border border-[#303036] bg-[#222226] px-2 py-1 text-[11px] text-dim hover:bg-danger-soft hover:text-danger hover:border-danger/40"
            >
              <Trash2 size={12} />
              <span className="hidden sm:inline">Limpiar</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowStdin(!showStdin)}
            title="Entrada estándar (stdin) para el programa"
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition",
              showStdin || stdin
                ? "border-accent/50 bg-accent-soft/40 text-accent-text"
                : "border-[#303036] bg-[#222226] text-dim hover:bg-hover hover:text-text",
            )}
          >
            <span>stdin</span>
          </button>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => void runCode()}
            title="Ejecutar código en entorno aislado (Ctrl+Enter)"
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[11.5px] font-semibold text-white shadow transition hover:bg-accent-strong disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Ejecutando…</span>
              </>
            ) : (
              <>
                <Play size={12} className="fill-current" />
                <span>Ejecutar <kbd className="hidden font-mono text-[9.5px] opacity-75 md:inline">(Ctrl+↵)</kbd></span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowConsole(!showConsole)}
            title={showConsole ? "Ocultar consola" : "Mostrar consola"}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
              runOutcome
                ? runOutcome.ok
                  ? "border-mint/50 bg-mint-soft/30 text-mint"
                  : "border-danger/50 bg-danger-soft/30 text-danger"
                : "border-[#303036] bg-[#222226] text-dim hover:bg-hover hover:text-text",
            )}
          >
            <Terminal size={12} />
            {runOutcome && (
              <span className="hidden sm:inline">
                {runOutcome.ok ? "Exit 0" : `Exit ${runOutcome.exit_code ?? 1}`}
              </span>
            )}
            {showConsole ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Optional stdin drawer */}
      {showStdin && (
        <div className="border-b border-[#252528] bg-[#1a1a1e] px-4 py-2">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-faint">
            Entrada estándar (stdin)
          </label>
          <input
            type="text"
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder="Valores que leerá input() o sys.stdin..."
            className="w-full rounded-md border border-[#303036] bg-[#121214] px-2.5 py-1 font-mono text-[12px] text-text outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Code Textarea & Gutter Area */}
      <div className="relative flex min-h-[260px] max-h-[500px] overflow-hidden bg-[#121214]">
        {/* Line Numbers Gutter */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-11 flex-none select-none overflow-hidden border-r border-[#252528] bg-[#17171a] text-right font-mono text-[11.5px] text-[#55555c]"
          style={{ paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, lineHeight: `${LINE_HEIGHT}px` }}
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i + 1} style={{ height: LINE_HEIGHT }} className="pr-2">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text Area */}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            aria-label="Editor de código"
            value={value}
            readOnly={disabled}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            className="h-full w-full resize-y bg-transparent px-3 font-mono text-[13px] leading-[22px] text-[#e8e8ed] outline-none placeholder:text-[#55555c]"
            style={{
              paddingTop: PAD_TOP,
              paddingBottom: PAD_BOTTOM,
              whiteSpace: "pre",
              tabSize: 4,
              minHeight: "260px",
            }}
          />
        </div>
      </div>

      {/* Integrated Live Console Drawer */}
      {showConsole && (
        <div className="border-t border-[#252528] bg-[#0c0d10] font-mono text-[12px]">
          <div className="flex items-center justify-between border-b border-[#1c1d22] bg-[#131418] px-3.5 py-1.5 text-[11px] text-dim">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-accent-text" />
              <span className="font-semibold text-text">Consola de salida</span>
              {runOutcome && (
                <span
                  className={cn(
                    "flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] font-medium",
                    runOutcome.ok
                      ? "bg-mint-soft text-mint"
                      : "bg-danger-soft text-danger",
                  )}
                >
                  {runOutcome.ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                  {runOutcome.ok ? "Exit 0" : `Exit ${runOutcome.exit_code ?? 1}`}
                </span>
              )}
              {runOutcome && runOutcome.ms > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-faint">
                  <Clock size={10} /> {runOutcome.ms}ms
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {runOutcome && (
                <button
                  type="button"
                  onClick={() => setRunOutcome(null)}
                  title="Limpiar consola"
                  className="text-[10.5px] text-faint hover:text-text"
                >
                  Limpiar salida
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowConsole(false)}
                title="Ocultar consola"
                className="text-faint hover:text-text"
              >
                <ChevronDown size={12} />
              </button>
            </div>
          </div>

          <div className="max-h-[180px] overflow-y-auto p-3.5 font-mono text-[12px] leading-relaxed">
            {isRunning ? (
              <div className="flex items-center gap-2 text-accent-text">
                <Loader2 size={13} className="animate-spin" />
                <span>Ejecutando código en sandbox…</span>
              </div>
            ) : runOutcome ? (
              <div className="space-y-2">
                {runOutcome.stdout ? (
                  <pre className="whitespace-pre-wrap text-[#d4d4d8] selection:bg-accent/30">
                    {runOutcome.stdout}
                  </pre>
                ) : null}

                {runOutcome.stderr ? (
                  <pre className="whitespace-pre-wrap text-danger selection:bg-danger/30">
                    {runOutcome.stderr}
                  </pre>
                ) : null}

                {!runOutcome.stdout && !runOutcome.stderr && (
                  <span className="italic text-faint">
                    (El código se ejecutó sin imprimir ninguna salida en stdout ni stderr)
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between text-faint">
                <span>Presiona «Ejecutar código» o Ctrl+Enter para probar la ejecución de tu solución.</span>
                <span className="text-[11px] opacity-60">Atajo: Ctrl+Enter</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
