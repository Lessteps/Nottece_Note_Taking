// Ctrl+Shift+P: every command of the app by name — formatting, tables,
// checklists, templates, the daily note, views and modules.

import { ChevronRight, CornerDownLeft, Search, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import { api } from "../../lib/bridge";
import * as ed from "../../lib/editorCommands";
import type { TableOp } from "../../lib/mdTable";
import { useApp } from "../../store/app";
import { MODULES } from "../Shell";
import { askText, cn, Kbd } from "../ui";
import { newCanvasIn, newNoteIn } from "./FileTree";
import { useConceptMap } from "../canvas/ConceptMapDialog";
import { useStudyFolders } from "../study/StudyFoldersDialog";
import { useProperties } from "./PropertiesDialog";
import { useSettingsDialog } from "../settings/SettingsDialog";
import { activeEditor, insertAtCursor } from "./SourceEditor";

interface Item {
  id: string;
  label: string;
  group?: string;
  keys?: string;
  /** Runs the command; returning a Page opens a second step. */
  run: () => void | Page | Promise<void | Page>;
}
interface Page {
  placeholder: string;
  items: Item[] | (() => Promise<Item[]>);
}

/** The shortcuts, for the palette hints and the shortcuts dialog. */
export const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+P", "Abrir nota rápida"],
  ["Ctrl+Shift+P", "Paleta de comandos"],
  ["Ctrl+S", "Guardar"],
  ["Ctrl+W", "Cerrar pestaña"],
  ["Ctrl+E", "Lectura / edición"],
  ["Ctrl+\\", "Mostrar / ocultar explorador"],
  ["F2", "Renombrar el archivo abierto"],
  ["Ctrl+Z / Ctrl+Y", "Dibujo LaTeX: deshacer / rehacer (P lápiz, S seleccionar, T texto, E borrador, H mover, Supr borrar)"],
  ["Ctrl+Shift+D", "Nota diaria"],
  ["Ctrl+B", "Negrita"],
  ["Ctrl+I", "Cursiva"],
  ["Ctrl+L", "Casilla / marcar casilla"],
  ["Ctrl+Shift+T", "Insertar tabla"],
  ["Ctrl+F", "Buscar en la nota"],
  ["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"],
  ["Tab / Shift+Tab", "Sangrar / quitar sangría"],
];

export const useShortcutsDialog = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({
  open: false, set: (open) => set({ open }),
}));

/** Run an editor command, switching the note to edit mode first if needed. */
function withEditor(fn: (v: EditorView) => boolean | void) {
  return () => {
    const s = useApp.getState();
    if (activeEditor.view) {
      if (fn(activeEditor.view) === false) s.toast("info", "El cursor no está en una tabla.");
      return;
    }
    if (!s.active) {
      s.toast("info", "Abre una nota primero.");
      return;
    }
    s.setModule("notas");
    s.setMode("edit");
    let tries = 0;
    const retry = () => {
      if (activeEditor.view) fn(activeEditor.view);
      else if (++tries < 20) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  };
}

export async function openDailyNote() {
  const s = useApp.getState();
  try {
    const { path } = await api.dailyNote();
    s.refreshTree();
    s.setModule("notas");
    await s.openNote(path);
  } catch (e) {
    s.toast("error", (e as Error).message);
  }
}

function templatePage(onPick: (name: string) => Promise<void>): Page {
  return {
    placeholder: "Elige una plantilla…",
    items: async () => {
      const { templates, folder } = await api.templatesList();
      if (!templates.length) {
        useApp.getState().toast("info", `No hay plantillas. Crea notas .md en «${folder}».`);
      }
      return templates.map((t) => ({ id: t.name, label: t.title, run: () => onPick(t.name) }));
    },
  };
}

const TABLE_SIZES: Array<[number, number]> = [[2, 2], [2, 3], [3, 3], [3, 4], [4, 4], [5, 3], [5, 5]];

function commands(): Item[] {
  const s = useApp.getState();
  const toastErr = (e: unknown) => useApp.getState().toast("error", (e as Error).message);
  const table = (op: TableOp) => withEditor((v) => ed.tableOp(v, op));
  const folder = s.active?.includes("/") ? s.active.slice(0, s.active.lastIndexOf("/")) : "";
  const title = s.active ? (s.notes[s.active]?.title ?? "") : "";
  const list: Item[] = [
    // Notes
    { id: "new-note", group: "Notas", label: "Nueva nota", run: () => newNoteIn(folder) },
    { id: "new-canvas", group: "Notas", label: "Nuevo canvas", run: () => newCanvasIn(folder) },
    { id: "concept-map", group: "Notas", label: "Generar mapa conceptual…", run: () => useConceptMap.getState().set(true) },
    { id: "study-folders", group: "Notas", label: "Espacios de estudio (crear carpetas)…", run: () => {
      s.setModule("notas");
      useStudyFolders.getState().set(true);
    } },
    {
      id: "new-from-template", group: "Notas", label: "Nueva nota desde plantilla…",
      run: () => templatePage(async (name) => {
        const t = await askText("Título de la nota", "", "Crear");
        if (!t) return;
        try {
          const { path } = await api.noteFromTemplate(name, t, folder);
          s.refreshTree();
          s.setModule("notas");
          await s.openNote(path);
          s.setMode("edit");
        } catch (e) {
          toastErr(e);
        }
      }),
    },
    {
      id: "insert-template", group: "Notas", label: "Insertar plantilla…",
      run: () => templatePage(async (name) => {
        try {
          const { text } = await api.templateText(name, title);
          withEditor(() => void insertAtCursor(text))();
        } catch (e) {
          toastErr(e);
        }
      }),
    },
    { id: "daily", group: "Notas", label: "Nota diaria de hoy", keys: "Ctrl+Shift+D", run: openDailyNote },
    { id: "switcher", group: "Notas", label: "Abrir nota rápida", keys: "Ctrl+P", run: () => s.setSwitcher(true) },
    ...(s.active ? [
      { id: "save", group: "Notas", label: "Guardar", keys: "Ctrl+S", run: () => void s.save(s.active!, { force: true }) },
      { id: "close", group: "Notas", label: "Cerrar pestaña", keys: "Ctrl+W", run: () => void s.closeNoteTab(s.active!) },
      { id: "bookmark", group: "Notas", label: "Añadir / quitar marcador", run: () => void s.toggleBookmark(s.active!) },
      { id: "properties", group: "Notas", label: "Propiedades de la nota…", run: () => useProperties.getState().show(s.active) },
      { id: "reveal", group: "Notas", label: "Mostrar en el explorador del sistema", run: () => void api.revealInOs(s.active!).catch(toastErr) },
    ] : []),
    // View
    { id: "mode-read", group: "Vista", label: "Modo lectura", run: () => s.setMode("read") },
    { id: "mode-edit", group: "Vista", label: "Modo edición", run: () => s.setMode("edit") },
    { id: "mode-split", group: "Vista", label: "Modo dividido (editor + vista previa)", run: () => s.setMode("split") },
    { id: "explorer", group: "Vista", label: "Mostrar / ocultar explorador / panel izquierdo", keys: "Ctrl+\\", run: s.toggleExplorer },
    { id: "right-panel", group: "Vista", label: "Mostrar / ocultar panel derecho", keys: "Ctrl+Alt+\\", run: s.toggleRightPanel },
    {
      id: "split-open", group: "Vista", label: "Abrir otra nota a la derecha…",
      run: () => ({
        placeholder: "Nota para el panel derecho…",
        items: async () => (await api.noteIndex()).map((n) => ({ id: n.path, label: n.title, run: () => void s.openSide(n.path) })),
      }),
    },
    ...(s.side ? [{ id: "split-close", group: "Vista", label: "Cerrar el panel derecho", run: () => void s.openSide(null) }] : []),
    { id: "inspector", group: "Vista", label: "Mostrar / ocultar panel derecho", run: s.toggleInspector },
    { id: "tags", group: "Vista", label: "Ver etiquetas", run: () => { s.setModule("notas"); s.setExplorerTab("tags"); } },
    { id: "graph", group: "Vista", label: "Ver grafo de conocimiento", run: () => { s.setModule("notas"); s.setExplorerTab("graph"); } },
    { id: "theme", group: "Vista", label: "Cambiar tema claro / oscuro", run: s.toggleTheme },
    { id: "settings", group: "Vista", label: "Configuración", run: () => useSettingsDialog.getState().set(true) },
    { id: "shortcuts", group: "Vista", label: "Atajos de teclado", run: () => useShortcutsDialog.getState().set(true) },
    ...MODULES.map((m) => ({ id: `go-${m.id}`, group: "Ir a", label: m.label, run: () => s.setModule(m.id) })),
    { id: "go-player", group: "Ir a", label: "Reproductor de inglés", run: () => s.setModule("player") },
    { id: "go-web", group: "Ir a", label: "WEB (navegador con restricciones)", run: () => s.setModule("web") },
    // Formatting
    { id: "bold", group: "Formato", label: "Negrita", keys: "Ctrl+B", run: withEditor((v) => ed.wrap(v, "**")) },
    { id: "italic", group: "Formato", label: "Cursiva", keys: "Ctrl+I", run: withEditor((v) => ed.wrap(v, "*")) },
    { id: "strike", group: "Formato", label: "Tachado", run: withEditor((v) => ed.wrap(v, "~~")) },
    { id: "highlight", group: "Formato", label: "Resaltado", run: withEditor((v) => ed.wrap(v, "==")) },
    { id: "code", group: "Formato", label: "Código en línea", run: withEditor((v) => ed.wrap(v, "`", "`", "código")) },
    { id: "codeblock", group: "Formato", label: "Bloque de código", run: withEditor(ed.insertCodeBlock) },
    { id: "math", group: "Formato", label: "Fórmula (LaTeX)", run: withEditor((v) => ed.wrap(v, "$", "$", "x^2")) },
    ...[1, 2, 3, 4].map((n) => ({ id: `h${n}`, group: "Formato", label: `Título ${n}`, run: withEditor((v) => ed.heading(v, n)) })),
    { id: "h0", group: "Formato", label: "Quitar título", run: withEditor((v) => ed.heading(v, 0)) },
    { id: "quote", group: "Formato", label: "Cita", run: withEditor((v) => ed.togglePrefix(v, "> ")) },
    { id: "rule", group: "Formato", label: "Línea horizontal", run: withEditor(ed.insertRule) },
    { id: "link", group: "Formato", label: "Enlace", run: withEditor(ed.insertLink) },
    { id: "wikilink", group: "Formato", label: "Enlace a nota [[…]]", run: withEditor(ed.insertWikilink) },
    // Lists
    { id: "bullets", group: "Listas", label: "Lista con viñetas", run: withEditor((v) => ed.togglePrefix(v, "- ")) },
    { id: "numbers", group: "Listas", label: "Lista numerada", run: withEditor(ed.numberedList) },
    { id: "task", group: "Listas", label: "Casilla / marcar casilla", keys: "Ctrl+L", run: withEditor(ed.toggleTask) },
    { id: "subtask", group: "Listas", label: "Sub-casilla", run: withEditor(ed.subTask) },
    { id: "indent", group: "Listas", label: "Sangrar", keys: "Tab", run: withEditor((v) => ed.indentLines(v, 1)) },
    { id: "outdent", group: "Listas", label: "Quitar sangría", keys: "Shift+Tab", run: withEditor((v) => ed.indentLines(v, -1)) },
    // Tables
    {
      id: "table", group: "Tabla", label: "Insertar tabla…", keys: "Ctrl+Shift+T",
      run: () => ({
        placeholder: "Tamaño (filas × columnas)…",
        items: TABLE_SIZES.map(([r, c]) => ({
          id: `${r}x${c}`, label: `${r} filas × ${c} columnas`, run: withEditor((v) => ed.insertTable(v, r, c)),
        })),
      }),
    },
    { id: "row-below", group: "Tabla", label: "Añadir fila debajo", run: table("row-below") },
    { id: "row-above", group: "Tabla", label: "Añadir fila encima", run: table("row-above") },
    { id: "row-delete", group: "Tabla", label: "Eliminar fila", run: table("row-delete") },
    { id: "col-right", group: "Tabla", label: "Añadir columna a la derecha", run: table("col-right") },
    { id: "col-left", group: "Tabla", label: "Añadir columna a la izquierda", run: table("col-left") },
    { id: "col-delete", group: "Tabla", label: "Eliminar columna", run: table("col-delete") },
    { id: "align-left", group: "Tabla", label: "Alinear columna a la izquierda", run: table("align-left") },
    { id: "align-center", group: "Tabla", label: "Centrar columna", run: table("align-center") },
    { id: "align-right", group: "Tabla", label: "Alinear columna a la derecha", run: table("align-right") },
    { id: "table-format", group: "Tabla", label: "Ordenar tabla", run: table("format") },
    { id: "tables-format", group: "Tabla", label: "Ordenar todas las tablas de la nota", run: withEditor((v) => void ed.formatAllTables(v)) },
  ];
  return list;
}

/** Word-prefix/subsequence match; lower = better, Infinity = no match. */
function score(label: string, q: string): number {
  const t = label.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (t.startsWith(q)) return 0;
  const i = t.indexOf(q);
  if (i >= 0) return 1 + i / 100;
  let pos = 0;
  let gaps = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, pos);
    if (j < 0) return Infinity;
    gaps += j - pos;
    pos = j + 1;
  }
  return 5 + gaps;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPalette);
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPage(null);
    setQ("");
    setSel(0);
    setItems(commands());
  }, [open]);

  useEffect(() => {
    if (!page) return;
    setQ("");
    setSel(0);
    if (typeof page.items === "function") {
      setItems([]);
      page.items().then(setItems).catch((e: Error) => useApp.getState().toast("error", e.message));
    } else setItems(page.items);
  }, [page]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!query) return items.slice(0, 200);
    return items
      .map((it) => ({ it, s: Math.min(score(it.label, query), score(`${it.group ?? ""} ${it.label}`, query) + 3) }))
      .filter((x) => x.s < Infinity)
      .sort((a, b) => a.s - b.s)
      .slice(0, 200)
      .map((x) => x.it);
  }, [items, q]);

  if (!open) return null;

  const choose = async (it: Item | undefined) => {
    if (!it) return;
    const next = await it.run();
    if (next) setPage(next);
    else setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/45 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Paleta de comandos"
        className="h-fit w-[620px] max-w-[90vw] overflow-hidden rounded-xl border border-line-strong bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          {page ? <ChevronRight size={15} className="text-accent-text" /> : <Terminal size={15} className="text-faint" />}
          <input
            autoFocus
            key={page ? "page" : "root"}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(v + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(v - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void choose(results[sel]);
              } else if (e.key === "Backspace" && !q && page) {
                setPage(null);
                setItems(commands());
              }
            }}
            placeholder={page?.placeholder ?? "Escribe un comando…"}
            className="h-12 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
          <Search size={14} className="text-faint" />
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => void choose(it)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left",
                  sel === i ? "bg-accent-soft" : "",
                )}
              >
                {it.group && (
                  <span className="w-16 flex-none font-mono text-[10px] uppercase tracking-wider text-faint">{it.group}</span>
                )}
                <span className="truncate text-[13px] text-text">{it.label}</span>
                {it.keys && <span className="ml-auto flex-none"><Kbd>{it.keys}</Kbd></span>}
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-4 text-[12.5px] text-faint">Nada coincide.</li>}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 font-mono text-[10.5px] text-faint">
          <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> moverse</span>
          <span className="flex items-center gap-1"><Kbd><CornerDownLeft size={10} /></Kbd> ejecutar</span>
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useShortcutsDialog((s) => s.open);
  const set = useShortcutsDialog((s) => s.set);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4" onMouseDown={() => set(false)}>
      <div
        role="dialog"
        aria-label="Atajos de teclado"
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-line-strong bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && set(false)}
      >
        <div className="border-b border-line px-5 py-3 text-[14px] font-semibold text-text">Atajos de teclado</div>
        <ul className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {SHORTCUTS.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between py-1.5 text-[13px] text-dim">
              <span>{label}</span>
              <Kbd>{k}</Kbd>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <button type="button" autoFocus onClick={() => set(false)}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-strong">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
