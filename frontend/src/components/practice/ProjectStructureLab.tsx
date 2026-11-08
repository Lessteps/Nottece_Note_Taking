// Interactive project structure and virtual environment lab.
// Lets the student assemble folder/file trees, organize terminal commands, and preview the hierarchy.

import { useState, useEffect, useMemo } from "react";
import { FolderTree, Terminal, Plus, Trash2, FolderPlus, FilePlus, Check, Play } from "lucide-react";
import { cn } from "../ui";

const QUICK_CHIPS = [
  { label: "pyproject.toml", path: "pyproject.toml", isFolder: false },
  { label: ".venv/", path: ".venv/", isFolder: true },
  { label: ".gitignore", path: ".gitignore", isFolder: false },
  { label: "requirements.txt", path: "requirements.txt", isFolder: false },
  { label: "src/app/", path: "src/app/", isFolder: true },
  { label: "src/app/__init__.py", path: "src/app/__init__.py", isFolder: false },
  { label: "src/app/main.py", path: "src/app/main.py", isFolder: false },
  { label: "tests/", path: "tests/", isFolder: true },
  { label: "tests/test_main.py", path: "tests/test_main.py", isFolder: false },
  { label: "README.md", path: "README.md", isFolder: false },
  { label: "package.json", path: "package.json", isFolder: false },
  { label: "tsconfig.json", path: "tsconfig.json", isFolder: false },
];

const QUICK_COMMANDS = [
  "python -m venv .venv",
  "source .venv/bin/activate",
  ".venv\\Scripts\\activate",
  "pip install -r requirements.txt",
  "pip install -e .",
  "python -m src.app.main",
  "pytest",
  "npm init -y",
  "npm install",
];

export function buildAsciiTree(paths: string[]): string {
  if (!paths || paths.length === 0) return "(vacío)";
  const clean = paths
    .map((p) => p.trim())
    .filter(Boolean)
    .sort();

  // Root representation
  const lines: string[] = ["proyecto/"];
  for (let i = 0; i < clean.length; i++) {
    const isLast = i === clean.length - 1;
    const branch = isLast ? "└── " : "├── ";
    lines.push(branch + clean[i]);
  }
  return lines.join("\n");
}

export function ProjectStructureLab({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (nextAnswer: string) => void;
}) {
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
      if (/^###\s*Notas|Explicaci/i.test(l)) {
        section = "notes";
        continue;
      }

      if (section === "tree") {
        if (l && !l.startsWith("```") && !l.startsWith("#")) {
          // Remove bullet or prefix
          const p = l.replace(/^[-*•]\s+/, "").trim();
          if (p && !treeLines.includes(p)) treeLines.push(p);
        }
      } else if (section === "cmds") {
        const c = l.replace(/^\d+[\.\)]\s+/, "").replace(/^[-*•]\s+/, "").trim();
        if (c && !c.startsWith("```") && !cmdLines.includes(c)) cmdLines.push(c);
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
    if (!item.trim() || paths.includes(item.trim())) return;
    const next = [...paths, item.trim()];
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
    if (!cmd.trim()) return;
    const next = [...commands, cmd.trim()];
    setCommands(next);
    sync(paths, next, notes);
    setCustomCmd("");
  };

  const removeCommand = (index: number) => {
    const next = commands.filter((_, i) => i !== index);
    setCommands(next);
    sync(paths, next, notes);
  };

  const treePreview = useMemo(() => buildAsciiTree(paths), [paths]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-text">
          <FolderTree size={14} /> Laboratorio de Estructura de Proyecto y Entorno
        </span>
        <span className="text-[11.5px] text-faint">
          {paths.length} elementos · {commands.length} comandos
        </span>
      </div>

      {/* Part 1: Quick chips */}
      <div className="flex flex-col gap-2">
        <label className="text-[12px] font-medium text-dim">Elementos comunes de estructura (clic para añadir):</label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chip) => {
            const exists = paths.includes(chip.path);
            return (
              <button
                key={chip.path}
                type="button"
                disabled={disabled || exists}
                onClick={() => addPath(chip.path)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-mono transition-colors",
                  exists
                    ? "border-mint/40 bg-mint/10 text-mint cursor-default"
                    : "border-line bg-surface text-dim hover:border-accent hover:text-text",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                {chip.isFolder ? <FolderPlus size={11} /> : <FilePlus size={11} />}
                {chip.label}
                {exists && <Check size={11} className="ml-0.5 text-mint" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add custom path */}
      <div className="flex gap-2">
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
          placeholder="Añadir ruta personalizada (ej. config/settings.py o docs/)..."
          className="flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={disabled || !customPath.trim()}
          onClick={() => addPath(customPath)}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          <Plus size={13} /> Añadir elemento
        </button>
      </div>

      {/* Tree list & ASCII Visualizer */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel/70 p-3">
          <span className="font-mono text-[11px] font-semibold uppercase text-faint">Archivos y carpetas asignados</span>
          <div className="flex max-h-48 min-h-[90px] flex-col gap-1 overflow-y-auto">
            {paths.length === 0 ? (
              <span className="p-2 text-[12px] italic text-faint">Ningún archivo añadido aún. Usa los botones de arriba.</span>
            ) : (
              paths.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between rounded border border-line/60 bg-surface px-2.5 py-1 text-[12px] font-mono text-text">
                  <span className="truncate">{p}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removePath(idx)}
                      className="text-faint hover:text-danger"
                      title="Eliminar elemento"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel/70 p-3">
          <span className="font-mono text-[11px] font-semibold uppercase text-faint">Vista previa en árbol</span>
          <pre className="max-h-48 min-h-[90px] overflow-auto rounded border border-line/40 bg-card p-2.5 font-mono text-[11.5px] leading-snug text-mint">
            {treePreview}
          </pre>
        </div>
      </div>

      {/* Part 2: Commands */}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-text">
          <Terminal size={14} /> Secuencia de Comandos (en orden de ejecución)
        </span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              disabled={disabled}
              onClick={() => addCommand(cmd)}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-dim hover:border-accent hover:text-text disabled:opacity-50"
            >
              <Play size={10} /> {cmd}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
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
            placeholder="Comando de terminal personalizado..."
            className="flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={disabled || !customCmd.trim()}
            onClick={() => addCommand(customCmd)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-dim hover:text-text disabled:opacity-50"
          >
            <Plus size={13} /> Añadir comando
          </button>
        </div>

        {commands.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-line/70 bg-panel/70 p-2.5">
            {commands.map((cmd, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded bg-surface px-2 py-1 font-mono text-[12px] text-text">
                <span className="w-5 text-right font-bold text-accent-text">{idx + 1}.</span>
                <span className="flex-1 truncate">{cmd}</span>
                {!disabled && (
                  <button type="button" onClick={() => removeCommand(idx)} className="text-faint hover:text-danger">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Part 3: Explanation / Justification */}
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <label className="text-[11.5px] text-faint">
          Explicación / Justificación de la estructura (por qué cada archivo está en ese lugar y cómo resuelve las importaciones):
        </label>
        <textarea
          rows={2}
          disabled={disabled}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            sync(paths, commands, e.target.value);
          }}
          placeholder="Ej: Los paquetes llevan __init__.py para permitir imports relativos desde src/app; los tests se mantienen fuera de src..."
          className="rounded-md border border-line bg-panel p-2 text-[12.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}
