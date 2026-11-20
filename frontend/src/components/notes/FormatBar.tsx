// La barra de formato: vive justo debajo de Lectura / Editar / Dividido y aplica
// Markdown sobre la selección del editor. Los comandos son los mismos que usan
// los atajos y la paleta (`lib/editorCommands`), así que la barra no inventa
// sintaxis: escribe la que el archivo ya usa.

import {
  Bold, Code, Eraser, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, ListTodo, Minus,
  Quote, Strikethrough, Table2,
} from "lucide-react";
import {
  heading, indentLines, insertCodeBlock, insertLink, insertRule, insertTable,
  numberedList, togglePrefix, toggleTask, wrap,
} from "../../lib/editorCommands";
import { activeEditor } from "./SourceEditor";
import { cn } from "../ui";

const BUTTON = "grid h-7 w-7 flex-none place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-text disabled:opacity-40";

/** Runs a command on the editor on screen, if there is one. */
function run(fn: (view: NonNullable<typeof activeEditor.view>) => boolean) {
  const view = activeEditor.view;
  if (!view) return;
  fn(view);
  // The heading menu is a real <select> and takes the focus: hand it back to the text.
  view.focus();
}

function Btn({ label, onClick, children, wide }: {
  label: string; onClick: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault() /* keep the selection */}
      onClick={onClick}
      className={cn(BUTTON, wide && "w-auto px-2")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px flex-none bg-line" aria-hidden="true" />;
}

export function FormatBar({ floating }: { floating?: boolean }) {
  return (
    <div
      role="toolbar"
      aria-label="Formato"
      data-format-bar
      className={cn("flex h-9 flex-none items-center gap-0.5 overflow-x-auto bg-surface", floating ? "px-2" : "border-b border-line px-3")}
    >
      <Btn label="Negrita (Ctrl+B)" onClick={() => run((v) => wrap(v, "**"))}><Bold size={14} /></Btn>
      <Btn label="Cursiva (Ctrl+I)" onClick={() => run((v) => wrap(v, "*"))}><Italic size={14} /></Btn>
      <Btn label="Tachado" onClick={() => run((v) => wrap(v, "~~"))}><Strikethrough size={14} /></Btn>
      <Btn label="Código en línea" onClick={() => run((v) => wrap(v, "`"))}><Code size={14} /></Btn>
      <Sep />
      <select
        aria-label="Título"
        title="Título"
        defaultValue=""
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          run((v) => heading(v, Number(e.target.value)));
          e.target.value = "";
        }}
        className="h-7 flex-none rounded-md border border-line bg-card px-1.5 text-[12px] text-dim hover:border-accent hover:text-text"
      >
        <option value="" disabled>Título…</option>
        <option value="0">Texto normal</option>
        <option value="1">Título 1</option>
        <option value="2">Título 2</option>
        <option value="3">Título 3</option>
        <option value="4">Título 4</option>
        <option value="5">Título 5</option>
      </select>
      <Sep />
      <Btn label="Lista con viñetas" onClick={() => run((v) => togglePrefix(v, "- "))}><List size={14} /></Btn>
      <Btn label="Lista numerada" onClick={() => run(numberedList)}><ListOrdered size={14} /></Btn>
      <Btn label="Lista de tareas (Ctrl+L)" onClick={() => run(toggleTask)}><ListTodo size={14} /></Btn>
      <Btn label="Cita" onClick={() => run((v) => togglePrefix(v, "> "))}><Quote size={14} /></Btn>
      <Sep />
      <Btn label="Insertar imagen" onClick={() => window.dispatchEvent(new Event("nv-insert-note-image"))}><ImagePlus size={14} /></Btn>
      <Btn label="Enlace" onClick={() => run(insertLink)}><LinkIcon size={14} /></Btn>
      <Btn label="Bloque de código" onClick={() => run(insertCodeBlock)}><Code size={14} /></Btn>
      <Btn label="Tabla (Ctrl+Shift+T)" onClick={() => run((v) => insertTable(v))}><Table2 size={14} /></Btn>
      <Btn label="Línea horizontal" onClick={() => run(insertRule)}><Minus size={14} /></Btn>
      <Sep />
      <Btn label="Aumentar sangría" onClick={() => run((v) => indentLines(v, 1))} wide><span className="text-[12px]">››</span></Btn>
      <Btn label="Reducir sangría" onClick={() => run((v) => indentLines(v, -1))} wide><span className="text-[12px]">‹‹</span></Btn>
      <Btn label="Quitar formato de la línea" onClick={() => run((v) => heading(v, 0))}><Eraser size={14} /></Btn>
    </div>
  );
}
