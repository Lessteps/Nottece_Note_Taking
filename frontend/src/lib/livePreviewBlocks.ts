// Live Preview for whole blocks: the frontmatter, tables, display math and rules
// of a note are drawn as they read (the same HTML the reading view produces), and
// the raw Markdown only shows up where the cursor is. Tables are the exception:
// they stay drawn and are edited cell by cell.
//
// Block widgets must come from a StateField (a ViewPlugin cannot provide them),
// which is why this lives beside — not inside — the inline `livePreview` plugin.

import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { scanBlocks } from "./blockScan";
import { escapeHtml, renderMarkdown } from "./markdown";
import { cleanCell, parseTable, serializeTable, type TableModel } from "./tableMd";
import { renderTex } from "./tex";

/** True when the selection is inside the block (a cursor at its very start is not). */
function selectionInside(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.to > from && r.from <= to);
}

/** Click on a drawn block: put the cursor inside it, so its raw Markdown appears. */
function revealOnClick(dom: HTMLElement, view: EditorView, offset: number): void {
  dom.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const pos = view.posAtDOM(dom);
    view.dispatch({ selection: { anchor: pos + offset } });
    view.focus();
  });
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

function fmValue(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean).join(", ");
  }
  return v.replace(/^["']|["']$/g, "");
}

function frontmatterHtml(raw: string): string {
  const rows: string[] = [];
  for (const line of raw.split("\n").slice(1, -1)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = fmValue(m[2]!);
    if (!value) continue;
    let body: string;
    if (key.toLowerCase() === "status") {
      body = `<span class="rounded border border-mint/40 bg-mint-soft px-2 py-px font-mono text-[11px] font-semibold text-mint">${escapeHtml(value)}</span>`;
    } else if (key.toLowerCase() === "tags") {
      const tags = value.split(/[,\s]+/).filter(Boolean).map((t) => `#${t.replace(/^#/, "")}`).join("  ");
      body = `<span class="font-mono text-[11.5px] text-accent-text">${escapeHtml(tags)}</span>`;
    } else {
      body = `<span class="text-text">${escapeHtml(value)}</span>`;
    }
    rows.push(
      `<div class="flex min-w-0 items-baseline gap-3"><dt class="flex-none font-mono text-[11.5px] text-faint">${escapeHtml(key)}:</dt><dd class="min-w-0 truncate text-[12.5px]">${body}</dd></div>`,
    );
  }
  return (
    `<section class="rounded-xl border border-line bg-card px-5 py-4">` +
    `<div class="mb-3 flex items-center gap-2"><span class="font-mono text-[12px] font-semibold text-text">frontmatter :: metadata</span>` +
    `<span class="ml-auto font-mono text-[10.5px] text-faint">YAML Block</span></div>` +
    `<dl class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-8 gap-y-2">${rows.join("")}</dl></section>`
  );
}

class FrontmatterWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }
  eq(o: FrontmatterWidget): boolean {
    return o.raw === this.raw;
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-nv-block cm-nv-fm";
    el.innerHTML = frontmatterHtml(this.raw);
    revealOnClick(el, view, 4);
    return el;
  }
}

// ── Display math and rules ──────────────────────────────────────────────────

class MathBlockWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }
  eq(o: MathBlockWidget): boolean {
    return o.raw === this.raw;
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-nv-block cm-nv-math-block";
    const tex = this.raw.trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
    el.innerHTML = renderTex(tex, true);
    revealOnClick(el, view, 2);
    return el;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-nv-block cm-nv-rule";
    el.innerHTML = "<hr>";
    revealOnClick(el, view, 1);
    return el;
  }
}

// ── Tables ──────────────────────────────────────────────────────────────────

interface TableState {
  /** The table's source text as the document holds it right now. */
  current: string;
  model: TableModel;
  /** Set when rows were added: the drawn DOM is stale and must be rebuilt. */
  stale: boolean;
  timer: number;
}

type TableDom = HTMLElement & { __nv?: TableState };

const inlineHtml = (raw: string): string =>
  renderMarkdown(raw).replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/, "$1");

function rawOf(model: TableModel, r: number, c: number): string {
  return (r === 0 ? model.header[c] : model.rows[r - 1]?.[c]) ?? "";
}

function setRaw(model: TableModel, r: number, c: number, text: string): void {
  if (r === 0) model.header[c] = text;
  else if (model.rows[r - 1]) model.rows[r - 1]![c] = text;
}

class TableWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }
  eq(o: TableWidget): boolean {
    return o.raw === this.raw;
  }
  ignoreEvent(): boolean {
    return true;
  }

  /** The drawn table already shows this text (it was typed into it): keep the DOM and the caret. */
  updateDOM(dom: HTMLElement): boolean {
    const st = (dom as TableDom).__nv;
    return Boolean(st && !st.stale && st.current === this.raw);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div") as TableDom;
    wrap.className = "cm-nv-block cm-nv-table nv-prose";
    wrap.innerHTML = renderMarkdown(this.raw);
    const model = parseTable(this.raw.split("\n"));
    if (!model) return wrap;
    const st: TableState = { current: this.raw, model, stale: false, timer: 0 };
    wrap.__nv = st;
    const cols = model.header.length;

    const cells = Array.from(wrap.querySelectorAll<HTMLElement>("th, td"));
    if (cells.length !== cols * (model.rows.length + 1)) return wrap;
    cells.forEach((cell, k) => {
      cell.contentEditable = "true";
      cell.dataset.r = String(Math.floor(k / cols));
      cell.dataset.c = String(k % cols);
    });

    const cellOf = (t: EventTarget | null): HTMLElement | null =>
      (t as HTMLElement | null)?.closest?.<HTMLElement>("th[data-r], td[data-r]") ?? null;
    const coords = (cell: HTMLElement) => [Number(cell.dataset.r), Number(cell.dataset.c)] as const;

    const commit = (): void => {
      window.clearTimeout(st.timer);
      const next = serializeTable(st.model);
      if (next === st.current) return;
      const from = view.posAtDOM(wrap);
      const to = from + st.current.length;
      if (view.state.sliceDoc(from, to) !== st.current) return;
      st.current = next;
      view.dispatch({ changes: { from, to, insert: next } });
    };

    const write = (cell: HTMLElement): void => {
      const [r, c] = coords(cell);
      setRaw(st.model, r, c, cleanCell(cell.textContent ?? ""));
    };

    const focusCell = (root: ParentNode, r: number, c: number): void => {
      const target = root.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
      target?.focus();
    };

    const move = (cell: HTMLElement, delta: number): void => {
      const [r, c] = coords(cell);
      const k = r * cols + c + delta;
      const total = (st.model.rows.length + 1) * cols;
      if (k < 0) return;
      if (k < total) {
        focusCell(wrap, Math.floor(k / cols), k % cols);
        return;
      }
      write(cell);
      st.model.rows.push(Array.from({ length: cols }, () => ""));
      st.stale = true;
      commit();
      const newRow = st.model.rows.length;
      // Wait for CodeMirror to finish redrawing: focusing earlier makes it take the
      // selection back into the document and swallow what is typed next.
      const settle = (tries: number): void => {
        const fresh = Array.from(view.dom.querySelectorAll<TableDom>(".cm-nv-table")).find(
          (el) => el.__nv?.current === st.current && el !== wrap,
        );
        if (fresh) {
          focusCell(fresh, newRow, 0);
          return;
        }
        if (tries > 0) window.setTimeout(() => settle(tries - 1), 30);
      };
      window.setTimeout(() => settle(10), 30);
    };

    wrap.addEventListener("focusin", (e) => {
      const cell = cellOf(e.target);
      if (!cell) return;
      const [r, c] = coords(cell);
      cell.textContent = rawOf(st.model, r, c);
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    wrap.addEventListener("input", (e) => {
      const cell = cellOf(e.target);
      if (!cell) return;
      write(cell);
      window.clearTimeout(st.timer);
      st.timer = window.setTimeout(commit, 350);
    });
    wrap.addEventListener("focusout", (e) => {
      const cell = cellOf(e.target);
      if (!cell) return;
      write(cell);
      commit();
      const [r, c] = coords(cell);
      if (cell.isConnected) cell.innerHTML = inlineHtml(rawOf(st.model, r, c));
    });
    wrap.addEventListener("keydown", (e) => {
      const cell = cellOf(e.target);
      if (!cell) return;
      if (e.key === "Tab") {
        e.preventDefault();
        move(cell, e.shiftKey ? -1 : 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        move(cell, cols);
      } else if (e.key === "Escape") {
        cell.blur();
        view.focus();
      }
    });
    return wrap;
  }
}

// ── The field ───────────────────────────────────────────────────────────────

const blockCache = new WeakMap<EditorState["doc"], ReturnType<typeof scanBlocks>>();
function buildBlocks(state: EditorState): DecorationSet {
  const doc = state.doc;
  let blocks = blockCache.get(doc);
  if (!blocks) { blocks = scanBlocks(doc.toString().split("\n")); blockCache.set(doc, blocks); }
  const out: Array<Range<Decoration>> = [];
  for (const b of blocks) {
    const from = doc.line(b.from + 1).from;
    const to = doc.line(b.to + 1).to;
    const raw = doc.sliceString(from, to);
    let widget: WidgetType | null = null;
    if (b.kind === "table") {
      if (parseTable(raw.split("\n"))) widget = new TableWidget(raw);
    } else if (!selectionInside(state, from, to)) {
      widget = b.kind === "frontmatter" ? new FrontmatterWidget(raw) : b.kind === "math" ? new MathBlockWidget(raw) : new RuleWidget();
    }
    if (widget) out.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  return Decoration.set(out, true);
}

const blocksField = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(value, tr) {
    if (!tr.docChanged) return tr.selection ? buildBlocks(tr.state) : value;
    // Ordinary typing outside rendered blocks cannot change their structure.
    // Map existing decorations instead of rescanning the entire document per key.
    let structural = false;
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const oldDoc = tr.startState.doc, newDoc = tr.state.doc;
      const oldStart = oldDoc.lineAt(fromA), oldEnd = oldDoc.lineAt(toA);
      const newStart = newDoc.lineAt(fromB), newEnd = newDoc.lineAt(toB);
      if (!oldStart.text.trim() || !newStart.text.trim() || oldStart.number !== oldEnd.number || newStart.number !== newEnd.number || /[|$`~*_\-]/.test(oldStart.text + newStart.text)) structural = true;
      value.between(oldStart.from, oldEnd.to, () => { structural = true; });
    });
    return structural ? buildBlocks(tr.state) : value.map(tr.changes);
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
  ],
});

export const livePreviewBlocks = [blocksField];
