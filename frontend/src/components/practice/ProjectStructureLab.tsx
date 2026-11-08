// Interactive project structure and virtual environment lab.
// Notion-style visual builder: suggestion chips, reorderable commands, live tree preview and real-time requirement checklist.

import { useState, useEffect, useMemo } from "react";
import {
  Folder,
  FileText,
  FolderTree,
  Terminal,
  Plus,
  Trash2,
  FolderPlus,
  Check,
  Play,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Circle,
  ListChecks,
  Code2,
  Package,
  Lightbulb,
} from "lucide-react";
import { cn } from "../ui";

export interface LabRequirements {
  projectName: string;
  requiredPaths: string[];
  requiredCommands: string[];
  suggestedPaths: string[];
  suggestedCommands: string[];
}

/**
 * Parsea el enunciado del ejercicio para extraer automáticamente:
 * - El nombre del proyecto (ej. `my_project`)
 * - Los archivos y carpetas requeridos
 * - Los comandos de terminal requeridos
 * - Sugerencias contextuales de 1 solo clic
 */
export function parseLabRequirements(stmt: string, discipline = "python"): LabRequirements {
  if (!stmt) {
    return {
      projectName: "my_project",
      requiredPaths: [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"],
      requiredCommands: ["python -m venv .venv", "python main.py"],
      suggestedPaths: [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py", "requirements.txt", "README.md"],
      suggestedCommands: ["python -m venv .venv", "source .venv/bin/activate", "pip install -r requirements.txt", "python main.py", "pytest"],
    };
  }

  // Nombre del proyecto
  const projMatch = stmt.match(/(?:named|llamado|proyecto)\s*[`"']([\w-]+)[`"']/i);
  const projectName = projMatch ? projMatch[1]! : "my_project";

  // Tokens entre comillas invertidas
  const backticks = [...stmt.matchAll(/`([^`\n\r]+)`/g)].map((m) => m[1]!.trim());

  const pathExts = [".py", ".toml", ".json", ".txt", ".md", ".env", ".cfg", ".ini", "/"];
  const isPath = (s: string) => s === ".venv" || s.startsWith(".venv/") || pathExts.some((ext) => s.endsWith(ext) || s.includes("/"));
  const isCmd = (s: string) => !s.endsWith("/") && s !== ".venv" && /^(python|pip|source|npm|pytest|git|docker|node|\.venv[\\/].*activate)\b/i.test(s);

  const reqPaths: string[] = [];
  const reqCmds: string[] = [];

  for (const token of backticks) {
    if (token === projectName || token === "/" || token === ".") continue;
    if (isCmd(token)) {
      if (!reqCmds.includes(token)) reqCmds.push(token);
    } else if (isPath(token)) {
      if (!reqPaths.includes(token)) reqPaths.push(token);
    }
  }

  // Si el texto menciona ejecutar el archivo principal y no se capturó como comando:
  const lower = stmt.toLowerCase();
  if ((lower.includes("run") || lower.includes("ejecut")) && (lower.includes("main.py") || lower.includes("entry")) && !reqCmds.some((c) => c.includes("main.py"))) {
    reqCmds.push("python main.py");
  }

  const defaultPythonPaths = [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py", "requirements.txt", "README.md", "pyproject.toml"];
  const defaultPythonCmds = ["python -m venv .venv", "source .venv/bin/activate", "pip install -r requirements.txt", "python main.py", "pytest"];

  const defaultNodePaths = ["node_modules/", "src/index.js", "package.json", "README.md", ".gitignore"];
  const defaultNodeCmds = ["npm init -y", "npm install", "npm start", "npm test"];

  const basePaths = discipline === "javascript" || discipline === "typescript" ? defaultNodePaths : defaultPythonPaths;
  const baseCmds = discipline === "javascript" || discipline === "typescript" ? defaultNodeCmds : defaultPythonCmds;

  const suggestedPaths = Array.from(new Set([...reqPaths, ...basePaths]));
  const suggestedCommands = Array.from(new Set([...reqCmds, ...baseCmds]));

  return {
    projectName,
    requiredPaths: reqPaths.length > 0 ? reqPaths : [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"],
    requiredCommands: reqCmds.length > 0 ? reqCmds : ["python -m venv .venv", "python main.py"],
    suggestedPaths,
    suggestedCommands,
  };
}

export function buildAsciiTree(paths: string[]): string {
  if (!paths || paths.length === 0) return "(vacío)";
  const clean = paths
    .map((p) => p.trim())
    .filter(Boolean)
    .sort();

  const lines: string[] = ["proyecto/"];
  for (let i = 0; i < clean.length; i++) {
    const isLast = i === clean.length - 1;
    const branch = isLast ? "└── " : "├── ";
    lines.push(branch + clean[i]);
  }
  return lines.join("\n");
}

function classifyPathTag(path: string): { label: string; color: string } {
  if (path.includes(".venv")) return { label: "entorno", color: "text-accent-text bg-accent-soft" };
  if (path === "main.py" || path.endsWith("/main.py") || path.includes("index.") || path.includes("app.py")) return { label: "entrypoint", color: "text-mint bg-mint/15" };
  if (path.includes("test")) return { label: "pruebas", color: "text-warn bg-warn/15" };
  if (path.includes("util") || path.includes("helper") || path.includes("lib")) return { label: "módulo", color: "text-info bg-info-soft" };
  if (path.endsWith("/") || !path.includes(".")) return { label: "carpeta", color: "text-dim bg-panel" };
  return { label: "archivo", color: "text-dim bg-panel" };
}

export function ProjectStructureLab({
  statement = "",
  discipline = "python",
  value,
  disabled,
  onChange,
}: {
  statement?: string;
  discipline?: string;
  value: string;
  disabled: boolean;
  onChange: (nextAnswer: string) => void;
}) {
  const reqs = useMemo(() => parseLabRequirements(statement, discipline), [statement, discipline]);

  const [paths, setPaths] = useState<string[]>([]);
  const [commands, setCommands] = useState<string[]>([]);
  const [customPath, setCustomPath] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [notes, setNotes] = useState("");

  // Parse existing answer on mount
  useEffect(() => {
    if (!value.trim()) return;
    const lines = value.split("\n").map((l) => l.trim());
    const treeLines: string[] = [];
    const cmdLines: string[] = [];
    let section: "tree" | "cmds" | "notes" = "tree";

    for (const l of lines) {
      if (/^###\s*Estructura/i.test(l)) {
        section = "tree";
        continue;
      }
      if (/^###\s*Comandos/i.test(l)) {
        section = "cmds";
        continue;
      }
      if (/^###\s*Notas|Justificaci|Explicaci/i.test(l)) {
        section = "notes";
        continue;
      }

      if (section === "tree") {
        if (l && !l.startsWith("```") && !l.startsWith("#")) {
          const p = l.replace(/^[-*•]\s+/, "").replace(/^[├└│─\s]+/, "").trim();
          if (p && p !== "proyecto/" && !treeLines.includes(p)) treeLines.push(p);
        }
      } else if (section === "cmds") {
        const c = l.replace(/^\d+[\.\)]\s+/, "").replace(/^[-*•\$]\s+/, "").trim();
        if (c && !c.startsWith("```") && !cmdLines.includes(c)) cmdLines.push(c);
      } else if (section === "notes") {
        if (l && !l.startsWith("#")) {
          setNotes((prev) => (prev ? `${prev}\n${l}` : l));
        }
      }
    }

    if (treeLines.length > 0) setPaths(treeLines);
    if (cmdLines.length > 0) setCommands(cmdLines);
  }, []);

  const sync = (nextPaths: string[], nextCmds: string[], nextNotes: string) => {
    const out: string[] = [];
    if (nextPaths.length > 0) {
      out.push("### Estructura de archivos y carpetas");
      out.push(nextPaths.join("\n"));
      out.push("");
    }
    if (nextCmds.length > 0) {
      out.push("### Secuencia de comandos en orden");
      out.push(nextCmds.map((c, i) => `${i + 1}. ${c}`).join("\n"));
      out.push("");
    }
    if (nextNotes.trim()) {
      out.push("### Justificación");
      out.push(nextNotes.trim());
    }
    onChange(out.join("\n"));
  };

  const addPath = (item: string) => {
    const clean = item.trim();
    if (!clean || paths.includes(clean)) return;
    const next = [...paths, clean];
    setPaths(next);
    sync(next, commands, notes);
    setCustomPath("");
  };

  const removePath = (index: number) => {
    const next = paths.filter((_, i) => i !== index);
    setPaths(next);
    sync(next, commands, notes);
  };

  const addCommand = (cmd: string) => {
    const clean = cmd.trim();
    if (!clean) return;
    const next = [...commands, clean];
    setCommands(next);
    sync(paths, next, notes);
    setCustomCmd("");
  };

  const removeCommand = (index: number) => {
    const next = commands.filter((_, i) => i !== index);
    setCommands(next);
    sync(paths, next, notes);
  };

  const moveCommandUp = (index: number) => {
    if (index <= 0) return;
    const next = [...commands];
    const temp = next[index - 1]!;
    next[index - 1] = next[index]!;
    next[index] = temp;
    setCommands(next);
    sync(paths, next, notes);
  };

  const moveCommandDown = (index: number) => {
    if (index >= commands.length - 1) return;
    const next = [...commands];
    const temp = next[index + 1]!;
    next[index + 1] = next[index]!;
    next[index] = temp;
    setCommands(next);
    sync(paths, next, notes);
  };

  // Real-time requirement verification
  const checklist = useMemo(() => {
    const checks: Array<{ title: string; desc: string; done: boolean }> = [];

    // 1. Árbol de carpetas
    const hasVenv = paths.some((p) => p.includes(".venv"));
    const hasModules = paths.some((p) => p.includes("/") && !p.startsWith(".venv"));
    const hasTests = paths.some((p) => p.includes("test"));
    const structureDone = reqs.requiredPaths.every((req) => paths.some((p) => p === req || p.endsWith(req))) ||
      (hasVenv && (hasModules || hasTests));

    checks.push({
      title: "Estructura de directorios",
      desc: reqs.requiredPaths.length > 0 ? `Incluye ${reqs.requiredPaths.join(", ")}` : "Directorios y módulos organizados",
      done: structureDone,
    });

    // 2. Punto de entrada
    const entryReq = reqs.requiredPaths.find((p) => p.includes("main.py") || p.includes("index.") || p.includes("app.py")) || "main.py";
    const entryDone = paths.some((p) => p === entryReq || p.endsWith(`/${entryReq}`) || p === "main.py");
    checks.push({
      title: "Entrada principal",
      desc: `${entryReq} colocado en la raíz del proyecto`,
      done: entryDone,
    });

    // 3. Secuencia de comandos en orden
    const hasVenvCmd = commands.some((c) => c.includes("venv"));
    const hasRunCmd = commands.some((c) => c.includes("main.py") || c.includes("start") || c.includes("pytest"));
    const commandsDone = reqs.requiredCommands.every((req) => commands.some((c) => c === req || c.includes(req))) ||
      (hasVenvCmd && hasRunCmd);

    checks.push({
      title: "Comandos secuenciales",
      desc: reqs.requiredCommands.length > 0 ? reqs.requiredCommands.join(" → ") : "Comando de entorno seguido de ejecución",
      done: commandsDone,
    });

    return checks;
  }, [paths, commands, reqs]);

  const completedChecks = checklist.filter((c) => c.done).length;

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-line bg-card p-5 shadow-sm">
      {/* Notion Page Header Block */}
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent-soft text-accent-text">
            <Package size={20} aria-hidden />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-text">
              Laboratorio de Estructura de Proyecto y Entorno
            </h2>
            <p className="text-[12px] text-dim">
              Configura el árbol de directorios de <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">{reqs.projectName}</code> y los comandos terminales en orden de ejecución.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent-text">
            {discipline.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Notion Callout Box (Consolidated Context & Instructions) */}
      <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-surface p-3.5 shadow-xs">
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-warn/15 text-warn">
          <Lightbulb size={16} aria-hidden />
        </div>
        <div className="flex-1 space-y-2 text-[13px] text-text">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-text">Requisitos del ejercicio:</p>
            <span className="font-mono text-[11px] text-faint">Haz clic en los botones de abajo para añadir cada elemento</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-[12px]">
            <div className="space-y-1 rounded-md border border-line/60 bg-card p-2.5">
              <span className="flex items-center gap-1.5 font-medium text-text text-[11.5px]">
                <FolderTree size={14} className="text-accent-text" />
                1. Árbol de archivos y carpetas
              </span>
              <ul className="list-disc list-inside space-y-0.5 font-mono text-[11.5px] text-dim">
                {reqs.requiredPaths.map((p) => (
                  <li key={p} className="truncate">
                    <code className="rounded bg-surface px-1 py-0.2 text-[11px] text-text">{p}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1 rounded-md border border-line/60 bg-card p-2.5">
              <span className="flex items-center gap-1.5 font-medium text-text text-[11.5px]">
                <Terminal size={14} className="text-accent-text" />
                2. Comandos en orden secuencial
              </span>
              <ul className="list-decimal list-inside space-y-0.5 font-mono text-[11.5px] text-dim">
                {reqs.requiredCommands.map((c) => (
                  <li key={c} className="truncate">
                    <code className="rounded bg-surface px-1 py-0.2 text-[11px] text-text">{c}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Workspace Grid */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* LEFT COLUMN: Structure & Workspace Builder (7 cols) */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          {/* SECTION 1: ARCHIVOS Y CARPETAS */}
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
            <div className="flex items-center justify-between border-b border-line bg-card px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <FolderPlus size={16} className="text-dim" />
                <h3 className="text-[13px] font-semibold text-text">1. Estructura de Archivos</h3>
              </div>
              <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-dim">
                {paths.length} {paths.length === 1 ? "elemento" : "elementos"} asignados
              </span>
            </div>

            <div className="space-y-3.5 p-3.5">
              {/* Suggestion Chips */}
              <div>
                <label className="mb-1.5 block text-[11.5px] font-medium text-dim">
                  Sugerencias frecuentes (haz clic para añadir al árbol):
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {reqs.suggestedPaths.map((item) => {
                    const exists = paths.includes(item);
                    const isFolder = item.endsWith("/");
                    return (
                      <button
                        key={item}
                        type="button"
                        disabled={disabled || exists}
                        onClick={() => addPath(item)}
                        className={cn(
                          "group inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors",
                          exists
                            ? "border-mint/40 bg-mint/10 text-mint cursor-default"
                            : "border-line bg-card text-text hover:border-accent hover:bg-hover",
                          disabled && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {isFolder ? <Folder size={13} className="text-dim" /> : <FileText size={13} className="text-dim" />}
                        <span>{item}</span>
                        {exists ? (
                          <Check size={12} className="text-mint" />
                        ) : (
                          <Plus size={12} className="text-faint opacity-60 group-hover:opacity-100" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Input Row */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={disabled}
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPath(customPath);
                    }
                  }}
                  placeholder="Escribe ruta personalizada (ej. config/settings.py o src/)..."
                  className="flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={disabled || !customPath.trim()}
                  onClick={() => addPath(customPath)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50 transition"
                >
                  <Plus size={13} /> Añadir
                </button>
              </div>

              {/* List of current files added */}
              <div className="divide-y divide-line rounded border border-line bg-card font-mono text-[12px]">
                {paths.length === 0 ? (
                  <div className="p-3 text-center text-[11.5px] italic text-faint">
                    No has añadido ningún archivo al árbol todavía. Usa los botones de arriba.
                  </div>
                ) : (
                  paths.map((p, idx) => {
                    const tag = classifyPathTag(p);
                    const isFolder = p.endsWith("/");
                    return (
                      <div key={idx} className="group flex items-center justify-between p-2 hover:bg-hover transition">
                        <div className="flex items-center gap-2 min-w-0">
                          {isFolder ? <Folder size={14} className="text-accent-text flex-none" /> : <FileText size={14} className="text-dim flex-none" />}
                          <span className="font-medium text-text truncate">{p}</span>
                          <span className={cn("rounded border border-line px-1.5 py-0.2 font-sans text-[10px]", tag.color)}>
                            {tag.label}
                          </span>
                        </div>
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => removePath(idx)}
                            className="text-faint hover:text-danger opacity-60 group-hover:opacity-100 transition p-0.5"
                            title="Eliminar elemento"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* SECTION 2: SECUENCIA DE COMANDOS */}
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
            <div className="flex items-center justify-between border-b border-line bg-card px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-dim" />
                <h3 className="text-[13px] font-semibold text-text">2. Secuencia de Comandos Terminal</h3>
              </div>
              <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-dim">
                {commands.length} {commands.length === 1 ? "comando" : "comandos"} en cola
              </span>
            </div>

            <div className="space-y-3.5 p-3.5">
              {/* Command presets */}
              <div>
                <label className="mb-1.5 block text-[11.5px] font-medium text-dim">
                  Comandos disponibles (haz clic para insertar en la secuencia):
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {reqs.suggestedCommands.map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      disabled={disabled}
                      onClick={() => addCommand(cmd)}
                      className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-1 font-mono text-[12px] text-text hover:border-accent hover:bg-hover transition disabled:opacity-50"
                    >
                      <Play size={10} className="text-accent-text" />
                      <span>{cmd}</span>
                      <Plus size={11} className="text-faint opacity-60 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Command Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={disabled}
                  value={customCmd}
                  onChange={(e) => setCustomCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCommand(customCmd);
                    }
                  }}
                  placeholder="Escribe comando personalizado (ej. python -m unittest)..."
                  className="flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={disabled || !customCmd.trim()}
                  onClick={() => addCommand(customCmd)}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-3 py-1.5 text-[12px] font-semibold text-dim hover:text-text disabled:opacity-50 transition"
                >
                  <Plus size={13} /> Añadir
                </button>
              </div>

              {/* Reorderable sequence list */}
              <div className="space-y-1.5">
                <div className="text-[11.5px] font-medium text-dim">
                  Secuencia ordenada (usa las flechas para ordenar):
                </div>

                {commands.length === 0 ? (
                  <div className="rounded border border-line bg-card p-3 text-center text-[11.5px] italic text-faint">
                    No has añadido comandos a la secuencia. Pulsa los comandos de arriba para agregarlos.
                  </div>
                ) : (
                  commands.map((cmd, idx) => (
                    <div
                      key={idx}
                      className="group flex items-center justify-between rounded border border-line bg-card p-2 hover:bg-hover transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line bg-panel font-mono text-[10.5px] font-semibold text-dim">
                          {idx + 1}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-accent-text">$</span>
                        <span className="font-mono text-[12px] font-medium text-text truncate">{cmd}</span>
                      </div>
                      {!disabled && (
                        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveCommandUp(idx)}
                            className="rounded p-1 text-dim hover:bg-panel hover:text-text disabled:opacity-30"
                            title="Mover arriba"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === commands.length - 1}
                            onClick={() => moveCommandDown(idx)}
                            className="rounded p-1 text-dim hover:bg-panel hover:text-text disabled:opacity-30"
                            title="Mover abajo"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCommand(idx)}
                            className="rounded p-1 text-dim hover:bg-panel hover:text-danger"
                            title="Eliminar comando"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* SECTION 3: JUSTIFICACIÓN */}
          <div className="rounded-lg border border-line bg-surface p-3.5 shadow-xs space-y-1.5">
            <label className="block text-[12px] font-semibold text-text">
              3. Justificación técnica de la arquitectura
            </label>
            <textarea
              rows={3}
              disabled={disabled}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                sync(paths, commands, e.target.value);
              }}
              placeholder="Explica brevemente por qué organizaste los módulos de esta forma (ej. .venv aísla dependencias, utils/ separa lógica auxiliar, tests/ mantiene la raíz limpia)..."
              className="w-full resize-y rounded-md border border-line bg-panel p-2.5 font-sans text-[12.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none leading-relaxed"
            />
          </div>
        </div>

        {/* RIGHT COLUMN: Live Tree & Checklist Preview (5 cols) */}
        <div className="flex flex-col gap-5 lg:col-span-5 sticky top-4">
          {/* Live Visual Tree */}
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
            <div className="flex items-center justify-between border-b border-line bg-card px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <FolderTree size={16} className="text-dim" />
                <h3 className="text-[12.5px] font-semibold text-text">Vista Previa del Árbol</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", paths.length > 0 ? "bg-mint" : "bg-warn")} />
                <span className={cn("font-mono text-[11px] font-medium", paths.length > 0 ? "text-mint" : "text-warn")}>
                  {paths.length > 0 ? "Sintaxis válida" : "Árbol vacío"}
                </span>
              </div>
            </div>

            {/* Terminal Body */}
            <div className="min-h-[220px] max-h-[340px] overflow-x-auto bg-[#1E1E1E] p-4 font-mono text-[12px] leading-relaxed text-[#D4D4D4] rounded-b">
              <div className="mb-2.5 flex items-center justify-between border-b border-[#333333] pb-1.5 text-[11px] text-[#858585]">
                <span>{reqs.projectName}/</span>
                <span>UTF-8</span>
              </div>

              {paths.length === 0 ? (
                <div className="py-6 text-center italic text-[#858585]">
                  Pulsa las sugerencias de la izquierda para añadir archivos al árbol.
                </div>
              ) : (
                <div className="space-y-1">
                  {paths.map((p, i) => {
                    const isLast = i === paths.length - 1;
                    const isVenv = p.includes(".venv");
                    const isMain = p === "main.py" || p.endsWith("/main.py");
                    const isTest = p.includes("test");
                    const isFolder = p.endsWith("/");

                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-[#858585]">{isLast ? "└──" : "├──"}</span>
                        {isVenv ? (
                          <>
                            <Folder size={13} className="text-[#75BEFF]" />
                            <span className="text-[#75BEFF]">{p}</span>
                            <span className="text-[10px] text-[#858585]">(virtualenv)</span>
                          </>
                        ) : isMain ? (
                          <>
                            <Play size={12} className="text-[#61AFEF]" />
                            <span className="font-semibold text-white">{p}</span>
                          </>
                        ) : isTest ? (
                          <>
                            <CheckCircle2 size={13} className="text-[#98C379]" />
                            <span className="text-[#ABB2BF]">{p}</span>
                          </>
                        ) : isFolder ? (
                          <>
                            <Folder size={13} className="text-[#E5C07B]" />
                            <span className="text-[#E5C07B]">{p}</span>
                          </>
                        ) : (
                          <>
                            <Code2 size={13} className="text-[#E06C75]" />
                            <span className="text-[#ABB2BF]">{p}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Real-time Requirement Checklist */}
          <div className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
                <ListChecks size={15} className="text-dim" />
                Verificación de requisitos
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold",
                  completedChecks === checklist.length ? "bg-mint/15 text-mint" : "bg-warn/15 text-warn",
                )}
              >
                {completedChecks} / {checklist.length} Completados
              </span>
            </div>

            <div className="space-y-2 text-[12px]">
              {checklist.map((item, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border p-2 transition-colors",
                    item.done ? "border-mint/30 bg-mint/5" : "border-line bg-card/60",
                  )}
                >
                  {item.done ? (
                    <CheckCircle2 size={15} className="mt-0.5 flex-none text-mint" />
                  ) : (
                    <Circle size={15} className="mt-0.5 flex-none text-faint" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-medium", item.done ? "text-text" : "text-dim")}>{item.title}</p>
                    <p className="truncate text-[11px] text-faint">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
