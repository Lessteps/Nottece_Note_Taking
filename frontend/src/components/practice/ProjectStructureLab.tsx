// Interactive project structure and virtual environment lab.
// Notion-style visual builder: multi-step workspace, full-width responsive layout, dedicated per-step hints and real-time validation.

import { useState, useEffect, useMemo } from "react";
import {
  Folder,
  FileText,
  FolderTree,
  Terminal,
  Plus,
  Trash2,
  Check,
  Play,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Circle,
  Package,
  Lightbulb,
  Info,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Layers,
  ArrowRight,
  Code2,
  ListChecks,
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

  // Extraer nombre del proyecto
  let projectName = "my_project";
  const nameMatch = stmt.match(/named\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i) ||
    stmt.match(/llamado\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i) ||
    stmt.match(/proyecto\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i);
  if (nameMatch && nameMatch[1]) {
    projectName = nameMatch[1];
  }

  // Extraer tokens en backticks
  const codeMatches = Array.from(stmt.matchAll(/`([^`]+)`/g)).map((m) => m[1].trim());

  const reqPaths: string[] = [];
  const reqCmds: string[] = [];

  const isCmd = (s: string) => {
    if (s === ".venv" || s === ".venv/" || s.endsWith("/")) return false;
    return (
      s.startsWith("python ") ||
      s.startsWith("pip ") ||
      s.startsWith("source ") ||
      s.startsWith("npm ") ||
      s.startsWith("node ") ||
      s.startsWith("pytest") ||
      s.startsWith("git ")
    );
  };

  const isPath = (s: string) => {
    if (isCmd(s)) return false;
    return (
      s.endsWith("/") ||
      s.includes("/") ||
      s.includes(".py") ||
      s.includes(".js") ||
      s.includes(".ts") ||
      s.includes(".json") ||
      s.includes(".toml") ||
      s.includes(".txt") ||
      s.includes(".md") ||
      s === ".venv" ||
      s === ".gitignore"
    );
  };

  for (const token of codeMatches) {
    if (isCmd(token)) {
      if (!reqCmds.includes(token)) reqCmds.push(token);
    } else if (isPath(token)) {
      const cleanPath = token === ".venv" ? ".venv/" : token;
      if (!reqPaths.includes(cleanPath)) reqPaths.push(cleanPath);
    }
  }

  // Si el texto menciona ejecutar el archivo principal y no se capturó como comando:
  const lower = stmt.toLowerCase();
  if ((lower.includes("run") || lower.includes("ejecut")) && (lower.includes("main.py") || lower.includes("entry")) && !reqCmds.some((c) => c.includes("main.py"))) {
    reqCmds.push("python main.py");
  }

  const defaultPythonPaths = [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py", "requirements.txt", "README.md", ".gitignore"];
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
  if (path.includes(".venv")) return { label: "entorno virtual", color: "text-accent-text bg-accent-soft" };
  if (path === "main.py" || path.endsWith("/main.py") || path.includes("index.") || path.includes("app.py")) return { label: "entrypoint", color: "text-mint bg-mint/15" };
  if (path.includes("test")) return { label: "pruebas unitarias", color: "text-warn bg-warn/15" };
  if (path.includes("util") || path.includes("helper") || path.includes("lib")) return { label: "módulo auxiliar", color: "text-accent-text bg-panel" };
  if (path.endsWith("/") || !path.includes(".")) return { label: "directorio", color: "text-dim bg-panel" };
  return { label: "archivo", color: "text-dim bg-panel" };
}

function classifyCmdTag(cmd: string): string {
  if (cmd.includes("venv")) return "Crea el entorno virtual con binarios aislados";
  if (cmd.includes("activate")) return "Activa la sesión del entorno en la terminal actual";
  if (cmd.includes("pip install") || cmd.includes("npm install")) return "Instala paquetes y dependencias del proyecto";
  if (cmd.includes("pytest") || cmd.includes("npm test") || cmd.includes("unittest")) return "Ejecuta la suite de pruebas unitarias";
  if (cmd.includes("main.py") || cmd.includes("start") || cmd.includes("index")) return "Ejecuta el script principal desde la raíz";
  return "Comando de ejecución en terminal";
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

  const [activeTab, setActiveTab] = useState<"files" | "commands" | "notes">("files");
  const [viewMode, setViewMode] = useState<"step" | "all">("step");
  const [showHint1, setShowHint1] = useState(false);
  const [showHint2, setShowHint2] = useState(false);
  const [showHint3, setShowHint3] = useState(false);

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

  // Requirement status checks
  const hasVenv = paths.some((p) => p.includes(".venv"));
  const hasModules = paths.some((p) => p.includes("/") && !p.startsWith(".venv"));
  const hasTests = paths.some((p) => p.includes("test"));
  const hasEntry = paths.some((p) => p === "main.py" || p.includes("index.") || p.includes("app.py"));
  const structureDone = reqs.requiredPaths.length > 0
    ? reqs.requiredPaths.every((req) => paths.some((p) => p === req || p.endsWith(req))) || (hasVenv && (hasModules || hasTests))
    : paths.length >= 3;

  const hasVenvCmd = commands.some((c) => c.includes("venv"));
  const hasRunCmd = commands.some((c) => c.includes("main.py") || c.includes("start") || c.includes("pytest"));
  const commandsDone = reqs.requiredCommands.length > 0
    ? reqs.requiredCommands.every((req) => commands.some((c) => c === req || c.includes(req))) || (hasVenvCmd && hasRunCmd)
    : commands.length >= 2;

  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  const notesDone = wordCount >= 15;

  const completedSteps = Number(structureDone) + Number(commandsDone) + Number(notesDone);
  const progressPct = Math.round((completedSteps / 3) * 100);

  // Sub-checklist for Step 1
  const structureChecklist = [
    {
      title: "Entorno virtual (.venv/)",
      desc: "Directorio aislado terminado en /",
      done: hasVenv,
    },
    {
      title: "Punto de entrada (main.py)",
      desc: "Ubicado en la raíz del proyecto",
      done: hasEntry,
    },
    {
      title: "Módulos de apoyo (utils/)",
      desc: "Lógica modular en subdirectorios",
      done: hasModules,
    },
    {
      title: "Pruebas unitarias (tests/)",
      desc: "Archivos de testing organizados",
      done: hasTests,
    },
  ];
  const structureChecksDone = structureChecklist.filter((c) => c.done).length;

  return (
    <div className="flex w-full flex-col gap-6">
      {/* ── Notion Header Principal (Distinguido del enunciado general) ── */}
      <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-card p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent-text border border-line">
            <Package size={24} aria-hidden />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[19px] font-bold tracking-tight text-text">
                Laboratorio de Estructura de Proyecto y Entorno Virtual
              </h2>
              <span className="rounded-md border border-line bg-panel px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent-text">
                {discipline.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[13.5px] text-dim leading-relaxed">
              <strong className="text-text font-medium">Contexto del ejercicio:</strong> Configurando el paquete{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">{reqs.projectName}</code>{" "}
              con aislamiento de dependencias locales y preparación de pruebas.
            </p>
          </div>
        </div>

        {/* Global Progress Badge */}
        <div className="flex flex-none items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2">
          <div className="text-right">
            <div className="text-[12.5px] font-semibold text-text">Progreso del laboratorio</div>
            <div className="font-mono text-[11px] text-dim">{completedSteps} de 3 pasos completados</div>
          </div>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border-2 font-mono text-[13px] font-bold",
              progressPct === 100 ? "border-mint text-mint bg-mint/10" : "border-accent text-accent-text bg-accent-soft",
            )}
          >
            {progressPct}%
          </div>
        </div>
      </div>

      {/* ── Subheader de Pestañas / Navegación Notion ── */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-line bg-card px-2 rounded-t-xl">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Secciones del laboratorio">
          {/* TAB 1 */}
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "files" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <FolderTree size={16} className={activeTab === "files" ? "text-accent-text" : "text-faint"} />
            <span>1. Estructura de Archivos</span>
            {structureDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Requisitos de archivos completados" />
            ) : (
              <span className="rounded bg-panel border border-line px-1.5 py-0.2 text-[10.5px] font-mono text-faint">
                {paths.length}
              </span>
            )}
          </button>

          {/* TAB 2 */}
          <button
            type="button"
            onClick={() => setActiveTab("commands")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "commands" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <Terminal size={16} className={activeTab === "commands" ? "text-accent-text" : "text-faint"} />
            <span>2. Comandos en Orden Secuencial</span>
            {commandsDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Comandos requeridos presentes" />
            ) : (
              <span className="rounded bg-panel border border-line px-1.5 py-0.2 text-[10.5px] font-mono text-faint">
                {commands.length}
              </span>
            )}
          </button>

          {/* TAB 3 */}
          <button
            type="button"
            onClick={() => setActiveTab("notes")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "notes" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <FileText size={16} className={activeTab === "notes" ? "text-accent-text" : "text-faint"} />
            <span>3. Justificación Técnica</span>
            {notesDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Justificación redactada" />
            ) : (
              <span className="rounded bg-warn-soft border border-warn/40 px-1.5 py-0.2 text-[10.5px] text-warn">
                {wordCount} pal.
              </span>
            )}
          </button>
        </nav>

        {/* View mode switcher */}
        <div className="flex items-center gap-1.5 pr-2 py-1.5 text-[12px]">
          <span className="text-dim">Modo:</span>
          <button
            type="button"
            onClick={() => setViewMode("step")}
            className={cn(
              "rounded-lg px-2.5 py-1 font-medium transition-colors border",
              viewMode === "step" ? "border-accent bg-accent-soft text-accent-text" : "border-line text-dim hover:bg-hover hover:text-text",
            )}
          >
            Paso por paso
          </button>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className={cn(
              "rounded-lg px-2.5 py-1 font-medium transition-colors border",
              viewMode === "all" ? "border-accent bg-accent-soft text-accent-text" : "border-line text-dim hover:bg-hover hover:text-text",
            )}
          >
            Todo expandido
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 1: ESTRUCTURA DE ARCHIVOS                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "files") && (
        <section className="flex w-full flex-col gap-5 animate-fadeIn">
          {/* Banner de Requisitos del Paso 1 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <FolderTree size={18} aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-bold text-text">
                    Requisitos del ejercicio: Estructura de Archivos
                  </h3>
                  <span className="rounded bg-panel border border-line px-2 py-0.5 font-mono text-[11px] text-dim">
                    Regla: directorios terminan en /
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Colocar los archivos congruentes de acuerdo a la estructura de archivos que pide tener el problema: una carpeta aislada para el entorno virtual (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">.venv/</code>), el archivo ejecutable raíz (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">main.py</code>), una carpeta de utilidades (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">utils/helpers.py</code>) y una carpeta de pruebas con su test (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">tests/test_helpers.py</code>).
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint1(!showHint1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint1 ? "Ocultar pista" : "Pista para Paso 1"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint1 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">¿Qué tienes que hacer exactamente en este paso?</p>
                <p className="text-dim leading-relaxed">
                  1. Asegúrate de que las rutas de directorios lleven una barra diagonal final (como <code className="font-mono font-bold text-text bg-card px-1 py-0.2 rounded border border-line">.venv/</code> y <code className="font-mono font-bold text-text bg-card px-1 py-0.2 rounded border border-line">utils/</code>).<br />
                  2. Haz clic en las sugerencias rápidas abajo para agregarlas a tu árbol, o escribe cualquier ruta anidada (ej. <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">tests/test_helpers.py</code>) en el campo inferior.<br />
                  3. La vista previa del árbol a la derecha generará la jerarquía automáticamente.
                </p>
              </div>
            </div>
          )}

          {/* Workspace Horizontal Dividido en 2 Columnas Anchas */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
            {/* LADO IZQUIERDO (6 cols): Constructor de la Estructura */}
            <div className="lg:col-span-6 flex flex-col rounded-xl border border-line bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <Folder size={17} className="text-accent-text" />
                  <h4 className="text-[13.5px] font-semibold text-text">
                    Constructor de Estructura de Archivos
                  </h4>
                </div>
                <span className="font-mono text-[11px] text-dim bg-panel px-2.5 py-0.5 rounded border border-line">
                  {paths.length} elementos configurados
                </span>
              </div>

              {/* Sugerencias frecuentes */}
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-dim">
                  Sugerencias frecuentes (haz clic para añadir o retirar):
                </label>
                <div className="flex flex-wrap gap-2">
                  {reqs.suggestedPaths.map((p) => {
                    const isSelected = paths.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (isSelected) {
                            const idx = paths.indexOf(p);
                            if (idx >= 0) removePath(idx);
                          } else {
                            addPath(p);
                          }
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11.5px] border transition-colors",
                          isSelected
                            ? "border-mint/60 bg-mint/15 text-mint font-semibold shadow-xs"
                            : "border-line bg-panel text-dim hover:border-accent hover:text-text",
                        )}
                      >
                        {isSelected ? <Check size={13} className="text-mint" /> : <Plus size={13} />}
                        <span>{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Input personalizado */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-[12px] font-medium text-dim">Añadir ruta personalizada:</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
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
                      placeholder="ej. config/settings.py o src/core/"
                      className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled || !customPath.trim()}
                    onClick={() => addPath(customPath)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface hover:bg-hover px-3 py-1.5 font-medium text-[12px] text-text transition disabled:opacity-40"
                  >
                    <Plus size={14} /> Añadir elemento
                  </button>
                </div>
              </div>

              {/* Lista de Elementos Configurados */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[12px] text-dim font-medium">
                  <span>Elementos en la solución actual:</span>
                  {paths.length > 0 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setPaths([]);
                        sync([], commands, notes);
                      }}
                      className="text-faint hover:text-danger text-[11.5px] transition"
                    >
                      Limpiar todo
                    </button>
                  )}
                </div>

                {paths.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line p-4 text-center font-mono text-[12px] text-faint">
                    No has añadido ningún archivo o carpeta todavía.
                  </p>
                ) : (
                  <div className="divide-y divide-line rounded-lg border border-line overflow-hidden bg-panel">
                    {paths.map((p, idx) => {
                      const tag = classifyPathTag(p);
                      return (
                        <div key={`${p}-${idx}`} className="flex items-center justify-between px-3 py-2 text-[12.5px] hover:bg-surface transition">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {p.endsWith("/") ? (
                              <Folder size={15} className="text-accent-text flex-none" />
                            ) : (
                              <FileText size={15} className="text-dim flex-none" />
                            )}
                            <span className="font-mono text-text truncate">{p}</span>
                            <span className={cn("rounded px-1.5 py-0.2 text-[10.5px] font-sans font-medium", tag.color)}>
                              {tag.label}
                            </span>
                          </div>
                          {!disabled && (
                            <button
                              type="button"
                              onClick={() => removePath(idx)}
                              title="Eliminar ruta"
                              className="rounded p-1 text-faint hover:bg-card hover:text-danger transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* LADO DERECHO (6 cols): Vista Previa Amplia del Árbol & Validación */}
            <div className="lg:col-span-6 flex flex-col gap-5">
              {/* Árbol en Vivo */}
              <div className="rounded-xl border border-line overflow-hidden bg-card shadow-xs">
                <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FolderTree size={16} className="text-dim" />
                    <h4 className="text-[13px] font-semibold text-text">
                      Visualización del Árbol del Proyecto Generado
                    </h4>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border",
                      structureDone ? "border-mint/60 bg-mint/15 text-mint" : "border-line bg-panel text-dim",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", structureDone ? "bg-mint" : "bg-faint")} />
                    {structureDone ? "Árbol Válido" : "En construcción"}
                  </span>
                </div>

                <div className="min-h-[260px] bg-[#18181B] text-[#E4E4E7] font-mono text-[12.5px] p-4 overflow-x-auto">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3 text-[11.5px] text-zinc-400">
                    <span className="font-semibold text-zinc-100">{reqs.projectName}/</span>
                    <span className="text-[11px]">UTF-8 · {paths.length} elementos</span>
                  </div>
                  <pre className="leading-relaxed whitespace-pre font-mono">
                    {buildAsciiTree(paths)}
                  </pre>
                </div>
              </div>

              {/* Validación de Requisitos del Paso 1 */}
              <div className="rounded-xl border border-line bg-card p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-text flex items-center gap-2">
                    <ListChecks size={16} className="text-accent-text" />
                    Validación de Requisitos del Paso 1
                  </h4>
                  <span className="font-mono text-[11px] font-semibold text-mint bg-mint/15 px-2 py-0.5 rounded border border-mint/40">
                    {structureChecksDone} / {structureChecklist.length} Cumplidos
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px]">
                  {structureChecklist.map((c) => (
                    <div
                      key={c.title}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                        c.done ? "border-mint/40 bg-mint/10" : "border-line bg-surface opacity-75",
                      )}
                    >
                      {c.done ? (
                        <CheckCircle2 size={16} className="text-mint flex-none mt-0.5" />
                      ) : (
                        <Circle size={16} className="text-faint flex-none mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-text">{c.title}</div>
                        <div className="text-[11px] text-dim">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Botón de continuación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("commands")}
                className="inline-flex items-center gap-2 rounded-xl bg-accent text-white px-5 py-2.5 text-[13.5px] font-semibold hover:opacity-95 transition shadow-sm"
              >
                <span>Continuar a Comandos de Terminal</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 2: COMANDOS EN ORDEN SECUENCIAL                             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "commands") && (
        <section className={cn("flex w-full flex-col gap-5 animate-fadeIn", viewMode === "all" && "pt-6 border-t border-line")}>
          {/* Banner de Requisitos del Paso 2 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <Terminal size={18} aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-bold text-text">
                    Requisitos del ejercicio: Secuencia de Comandos Terminal
                  </h3>
                  <span className="rounded bg-panel border border-line px-2 py-0.5 font-mono text-[11px] text-dim">
                    Ejecución secuencial exacta
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Escribir los comandos de terminal en estricto orden secuencial de ejecución: primero crear el entorno virtual (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">{reqs.requiredCommands[0] ?? "python -m venv .venv"}</code>), activarlo en la sesión (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">source .venv/bin/activate</code>), instalar dependencias y ejecutar el punto de entrada principal (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">python main.py</code>).
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint2(!showHint2)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint2 ? "Ocultar pista" : "Pista para Paso 2"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint2 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">¿Qué tienes que hacer exactamente en este paso?</p>
                <p className="text-dim leading-relaxed">
                  1. Todo entorno virtual debe ser creado antes de poder ser activado o antes de instalar dependencias.<br />
                  2. Haz clic en los comandos rápidos a la izquierda para agregarlos a la cola de comandos.<br />
                  3. Utiliza los botones <strong className="text-text">↑</strong> y <strong className="text-text">↓</strong> en cada fila de comando para ordenarlos cronológicamente como se ejecutarían en una sesión real de terminal.
                </p>
              </div>
            </div>
          )}

          {/* Espacio Horizontal de 2 Columnas para Comandos */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
            {/* Comandos disponibles y entrada personalizada (6 cols) */}
            <div className="lg:col-span-6 rounded-xl border border-line bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <Terminal size={17} className="text-accent-text" />
                  <h4 className="text-[13.5px] font-semibold text-text">Comandos Terminal Disponibles</h4>
                </div>
                <span className="text-[11.5px] text-dim">Haz clic para insertar en la secuencia</span>
              </div>

              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-dim">Comandos rápidos:</label>
                <div className="flex flex-wrap gap-2">
                  {reqs.suggestedCommands.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={disabled}
                      onClick={() => addCommand(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel hover:border-accent hover:text-text px-3 py-1.5 font-mono text-[12px] text-dim transition shadow-xs"
                    >
                      <Play size={11} className="text-accent-text flex-none" />
                      <span>{c}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="block text-[12px] font-medium text-dim">Escribir comando personalizado:</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
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
                      placeholder="ej. pytest -v o poetry run..."
                      className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled || !customCmd.trim()}
                    onClick={() => addCommand(customCmd)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface hover:bg-hover px-3 py-1.5 font-medium text-[12px] text-text transition disabled:opacity-40"
                  >
                    <Plus size={14} /> Insertar
                  </button>
                </div>
              </div>
            </div>

            {/* Cola de Ejecución Ordenada Reordenable (6 cols) */}
            <div className="lg:col-span-6 rounded-xl border border-line bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <Play size={17} className="text-accent-text" />
                  <h4 className="text-[13.5px] font-semibold text-text">Secuencia Ordenada de Ejecución</h4>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                    commandsDone ? "border-mint/60 bg-mint/15 text-mint" : "border-line bg-panel text-dim",
                  )}
                >
                  {commands.length} comandos en cola
                </span>
              </div>

              {commands.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-6 text-center font-mono text-[12.5px] text-faint">
                  No hay comandos añadidos. Haz clic en los comandos rápidos para armar la secuencia.
                </p>
              ) : (
                <div className="space-y-2">
                  {commands.map((cmd, idx) => (
                    <div
                      key={`${cmd}-${idx}`}
                      className="flex items-center justify-between rounded-lg border border-line bg-surface p-3 text-[12.5px] hover:border-accent/40 transition group shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-card border border-line font-mono text-[11px] font-bold text-dim">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-mono text-[12.5px] font-semibold text-text truncate">
                            <span className="text-accent-text">$</span>
                            <span>{cmd}</span>
                          </div>
                          <span className="text-[11px] text-dim block mt-0.5 truncate">
                            {classifyCmdTag(cmd)}
                          </span>
                        </div>
                      </div>

                      {!disabled && (
                        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveCommandUp(idx)}
                            title="Subir de posición"
                            className="rounded p-1 hover:bg-card text-dim hover:text-text disabled:opacity-20"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === commands.length - 1}
                            onClick={() => moveCommandDown(idx)}
                            title="Bajar de posición"
                            className="rounded p-1 hover:bg-card text-dim hover:text-text disabled:opacity-20"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCommand(idx)}
                            title="Eliminar comando"
                            className="rounded p-1 hover:bg-card text-dim hover:text-danger ml-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Botones de navegación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("files")}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface hover:bg-hover px-4 py-2.5 text-[13px] font-medium text-dim transition"
              >
                <ChevronLeft size={16} />
                <span>Volver a Estructura</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("notes")}
                className="inline-flex items-center gap-2 rounded-xl bg-accent text-white px-5 py-2.5 text-[13.5px] font-semibold hover:opacity-95 transition shadow-sm"
              >
                <span>Continuar a Justificación Técnica</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 3: JUSTIFICACIÓN TÉCNICA                                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "notes") && (
        <section className={cn("flex w-full flex-col gap-4 animate-fadeIn", viewMode === "all" && "pt-6 border-t border-line")}>
          {/* Banner de Requisitos del Paso 3 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <FileText size={18} aria-hidden />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-text">
                  3. Justificación Técnica de la Arquitectura
                </h3>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Explica razonadamente por qué cada archivo está en ese lugar y cómo se gestionan los imports relativos sin colisiones de dependencias.
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint3(!showHint3)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint3 ? "Ocultar pista" : "Pista para Paso 3"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint3 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">Puntos clave a justificar en tu explicación:</p>
                <p className="text-dim leading-relaxed">
                  1. <strong className="text-text">Aislamiento del entorno:</strong> Explica por qué <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">.venv/</code> reside localmente y no debe subirse al control de versiones (Git).<br />
                  2. <strong className="text-text">Modularidad e imports:</strong> Explica por qué la lógica auxiliar se aísla en subcarpetas (como <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">utils/helpers.py</code>) y cómo se importa limpiamente desde <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">main.py</code>.<br />
                  3. <strong className="text-text">Separación de pruebas:</strong> Justifica por qué la carpeta <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">tests/</code> reside en la raíz fuera del código fuente distribuible.
                </p>
              </div>
            </div>
          )}

          {/* Editor de Justificación Ancho Completo */}
          <div className="w-full rounded-xl border border-line bg-card p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-[12px] text-dim">
              <span className="font-medium">Tu explicación técnica:</span>
              <span className="font-mono text-[11px]">{wordCount} palabras redactadas</span>
            </div>
            <textarea
              rows={5}
              disabled={disabled}
              value={notes}
              onChange={(e) => {
                const next = e.target.value;
                setNotes(next);
                sync(paths, commands, next);
              }}
              placeholder="Explica aquí las razones arquitectónicas de esta estructura (ej. por qué .venv/ va en la raíz pero no se sube a Git, cómo se organizan los módulos auxiliares y cómo se importan)..."
              className="w-full rounded-lg border border-line bg-panel p-3.5 text-[13.5px] leading-relaxed text-text placeholder:text-faint focus:border-accent outline-none font-body resize-y"
            />
          </div>

          {/* Botón de navegación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex justify-start pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("commands")}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface hover:bg-hover px-4 py-2.5 text-[13px] font-medium text-dim transition"
              >
                <ChevronLeft size={16} />
                <span>Volver a Comandos</span>
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
