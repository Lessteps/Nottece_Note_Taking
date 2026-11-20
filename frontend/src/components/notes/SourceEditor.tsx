// CodeMirror 6: the markdown source editor.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { api } from "../../lib/bridge";
import { useApp } from "../../store/app";
import { insertLink, insertTable, toggleTask, wrap } from "../../lib/editorCommands";
import { livePreview } from "../../lib/livePreview";
import { liveImages } from "../../lib/liveImages";
import { hierarchicalNumbers } from "../../lib/listNumbering";
import { livePreviewBlocks } from "../../lib/livePreviewBlocks";

// Markdown shortcuts (the Qt editor's Ctrl+B / Ctrl+I / Ctrl+L / Ctrl+Shift+T).
const mdKeymap = keymap.of([
  { key: "Mod-b", run: (v) => wrap(v, "**") },
  { key: "Mod-i", run: (v) => wrap(v, "*") },
  { key: "Mod-l", run: toggleTask },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Shift-x", run: (v) => wrap(v, "~~") },
  { key: "Mod-Shift-t", run: (v) => insertTable(v) },
]);

const theme = EditorView.theme({
  // Editing reads like the reading view: same 15px / 1.7 metrics and the same
  // 820px column as `.nv-prose`, so switching Lectura ↔ Editar does not reflow.
  "&": {
    height: "100%",
    color: "var(--nv-text)",
    backgroundColor: "transparent",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.7",
    // Same gutters as the reading view (px-10, pt-8): the page is centred.
    padding: "32px 40px 96px",
  },
  ".cm-content": {
    width: "100%",
    maxWidth: "820px",
    margin: "0 auto",
    flexGrow: "0",
    padding: "0",
    caretColor: "var(--nv-accent)",
  },
  ".cm-code .cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--nv-accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--nv-accent-soft) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--nv-active-line, color-mix(in srgb, var(--nv-hover) 55%, transparent))" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--nv-faint)",
    border: "none",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    paddingLeft: "12px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--nv-dim)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 4px", minWidth: "36px" },
  ".cm-panels": { backgroundColor: "var(--nv-card)", color: "var(--nv-text)" },
  ".cm-searchMatch": { backgroundColor: "var(--nv-warn-soft)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--nv-accent-soft)" },
  ".cm-selectionMatch": { backgroundColor: "var(--nv-accent-soft)" },
  // Lo que pinta la vista indexada (lib/mdPreview): un código en línea se ve
  // como código y un enlace como enlace, sin sus marcas.
  ".cm-nv-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--nv-elevated)",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  ".cm-nv-link": {
    color: "var(--nv-accent-text)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in srgb, var(--nv-accent-text) 40%, transparent)",
  },
  ".cm-nv-bullet": { color: "var(--nv-accent-text)", fontWeight: "700" },
  ".cm-nv-number": { color: "var(--nv-accent-text)", fontWeight: "600", fontVariantNumeric: "tabular-nums" },
  // Bloques dibujados (lib/livePreviewBlocks): frontmatter, tablas, fórmulas y
  // reglas se ven como en la lectura; el Markdown crudo aparece donde está el cursor.
  ".cm-nv-image img": { display: "block", maxWidth: "100%", height: "auto", margin: "8px 0", borderRadius: "4px" },
  ".cm-nv-block": { margin: "10px 0", cursor: "default" },
  ".cm-nv-fm, .cm-nv-math-block, .cm-nv-rule": { cursor: "text" },
  ".cm-nv-table.nv-prose": { maxWidth: "none", margin: "10px 0", overflowX: "auto" },
  ".cm-nv-table th:focus, .cm-nv-table td:focus": {
    outline: "2px solid var(--nv-accent)",
    outlineOffset: "-2px",
    background: "var(--nv-accent-soft)",
  },
  ".cm-nv-math-block": { textAlign: "center", overflowX: "auto" },
  ".cm-nv-math": { display: "inline-block", verticalAlign: "baseline" },
  ".cm-nv-rule hr": { border: "0", borderTop: "1px solid var(--nv-line-strong)", margin: "14px 0" },
});

const mdHighlight = HighlightStyle.define([
  // Same heading scale as `.nv-prose` (2.15em / 1.5em / 1.2em).
  { tag: t.heading1, fontSize: "2.15em", fontWeight: "700", color: "var(--nv-text)" },
  { tag: t.heading2, fontSize: "1.5em", fontWeight: "700", color: "var(--nv-text)" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "700", color: "var(--nv-text)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--nv-faint)" },
  { tag: [t.link, t.url], color: "var(--nv-accent-text)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", color: "var(--nv-accent-text)", fontSize: "0.9em" },
  { tag: t.quote, color: "var(--nv-dim)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: "var(--nv-faint)" },
  { tag: t.list, color: "var(--nv-accent-text)" },
  { tag: t.meta, color: "var(--nv-faint)" },
]);

/** The editor on screen, for tools that act on the selection or cursor
 * (the assistant inserting an answer, study actions on the selected text). */
export const activeEditor: { view: EditorView | null } = { view: null };

export function editorSelection(): string {
  const v = activeEditor.view;
  if (v) {
    const { from, to } = v.state.selection.main;
    if (to > from) return v.state.sliceDoc(from, to);
  }
  return window.getSelection()?.toString() ?? "";
}

/** Insert text at the cursor of the editor; false when no editor is open. */
export function insertAtCursor(text: string): boolean {
  const v = activeEditor.view;
  if (!v) return false;
  const { from, to } = v.state.selection.main;
  v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  v.focus();
  return true;
}

export function SourceEditor({
  notePath = "", value, eol, code, numbered, onChange, onCursor, revealLine, onRevealed,
}: {
  notePath?: string;
  value: string;
  eol: "\n" | "\r\n";
  code: boolean;
  /** Draw nested numbered lists as 1. / 1.1 / 1.1.1 (the canvas cards). */
  numbered?: boolean;
  onChange: (raw: string) => void;
  onCursor?: (line: number, col: number) => void;
  revealLine?: number;
  onRevealed?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const insertImages = async (files: File[]) => {
    const target = view.current;
    if (!target || !notePath) return;
    for (const file of files) {
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error("La imagen supera los 15 MB.");
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
          reader.readAsDataURL(file);
        });
        const result = await api.importNoteImage(notePath, file.name || `Imagen pegada ${Date.now()}`, base64);
        if (view.current !== target) { useApp.getState().toast("info", `Imagen guardada en ${result.path}; abre la nota para insertarla.`); continue; }
        target.dispatch(target.state.replaceSelection(result.markdown));
        target.focus();
      } catch (error) { useApp.getState().toast("error", (error as Error).message || "No se pudo insertar la imagen."); }
    }
  };
  const view = useRef<EditorView | null>(null);
  // Latest callbacks without rebuilding the editor on every render.
  const cb = useRef({ onChange, onCursor });
  cb.current = { onChange, onCursor };
  // Lo ultimo que este editor entrego, para distinguir el eco de nuestro propio
  // guardado de un cambio real en disco.
  const lastSent = useRef(value);

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        // Keep the file's own line endings on the way out.
        EditorState.lineSeparator.of(eol),
        // A note is read, not debugged: no gutter, and the Markdown markers are
        // hidden (see livePreview). Code files keep both.
        ...(code ? [lineNumbers(), highlightActiveLineGutter()] : [livePreview, ...(notePath ? [liveImages(notePath)] : []), ...livePreviewBlocks]),
        ...(numbered && !code ? [hierarchicalNumbers] : []),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        ...(code ? [] : [mdKeymap]),
        keymap.of([...(code ? [] : markdownKeymap), ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        // The YAML block on top is YAML, not markdown (else "key: v\n---"
        // reads as a setext heading).
        ...(code ? [] : [yamlFrontmatter({ content: markdown() }), syntaxHighlighting(mdHighlight)]),
        theme,
        EditorView.editorAttributes.of({ class: code ? "cm-code" : "" }),
        EditorView.contentAttributes.of({ spellcheck: code ? "false" : "true", lang: "es" }),
        // With two editors (split view) the tools act on the focused one.
        EditorView.domEventHandlers({
          focus: (_e, view) => { activeEditor.view = view; },
          paste: (event) => { const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/")); if (!files.length || code || !notePath) return false; event.preventDefault(); void insertImages(files); return true; },
          drop: (event, editor) => { const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/")); if (!files.length || code || !notePath) return false; event.preventDefault(); const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY }); if (pos !== null) editor.dispatch({ selection: { anchor: pos } }); void insertImages(files); return true; },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.sliceDoc();
            lastSent.current = text;
            cb.current.onChange(text);
          }
          if (u.docChanged || u.selectionSet) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            cb.current.onCursor?.(line.number, head - line.from + 1);
          }
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    activeEditor.view = v;
    v.focus();
    return () => {
      if (activeEditor.view === v) activeEditor.view = null;
      v.destroy();
      view.current = null;
    };
    // The editor is rebuilt only when the file identity changes; value
    // updates from outside are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eol, code, numbered]);

  // Outside changes (reload from disk, a task ticked in the preview). The echo of
  // our own save is ignored: replacing the document with what it already says
  // re-parses the whole note and throws the cursor away, and that is the freeze
  // felt right after typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (value === lastSent.current) return;
    const cur = v.state.sliceDoc();
    if (cur === value) return;
    lastSent.current = value;
    const anchor = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      selection: { anchor },
    });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v || revealLine === undefined) return;
    const n = Math.min(Math.max(1, revealLine), v.state.doc.lines);
    const line = v.state.doc.line(n);
    v.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    v.focus();
    onRevealed?.();
  }, [revealLine, onRevealed]);

  useEffect(() => {
    const open = () => { if (activeEditor.view === view.current && !code && notePath) picker.current?.click(); };
    window.addEventListener("nv-insert-note-image", open);
    return () => window.removeEventListener("nv-insert-note-image", open);
  }, [code, notePath]);
  return <div className="h-full min-h-0 select-text"><div ref={host} className="h-full min-h-0" /><input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label="Seleccionar imágenes" onChange={(event) => { void insertImages(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /></div>;
}
