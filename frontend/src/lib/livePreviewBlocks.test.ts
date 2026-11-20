// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { livePreview } from "./livePreview";
import { livePreviewBlocks } from "./livePreviewBlocks";

const DOC = [
  "---", "title: Prueba", "tags: [a, b]", "---", "",
  "Texto con $x^2$ en línea.", "",
  "| a | b |", "| - | - |", "| 1 | 2 |", "",
  "$$", "y = 1", "$$", "",
  "---", "",
  "Fin",
].join("\n");

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, anchor = doc.length): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: [livePreview, ...livePreviewBlocks] }),
    parent,
  });
  return view;
}

describe("block live preview", () => {
  it("draws frontmatter, a table, display math, a rule and inline math", () => {
    const v = mount(DOC);
    expect(v.dom.querySelector(".cm-nv-fm")?.textContent).toContain("Prueba");
    expect(v.dom.querySelectorAll(".cm-nv-table th").length).toBe(2);
    expect(v.dom.querySelectorAll(".cm-nv-table td").length).toBe(2);
    expect(v.dom.querySelector(".cm-nv-math-block .katex")).not.toBeNull();
    expect(v.dom.querySelector(".cm-nv-rule hr")).not.toBeNull();
    expect(v.dom.querySelector(".cm-line .cm-nv-math .katex")).not.toBeNull();
  });

  it("shows the raw math only while the cursor is inside it", () => {
    const at = DOC.indexOf("y = 1") + 1;
    const v = mount(DOC, at);
    expect(v.dom.querySelector(".cm-nv-math-block")).toBeNull();
    expect(v.dom.textContent).toContain("y = 1");
  });

  it("never turns a table back into raw pipes, even with the cursor in it", () => {
    const at = DOC.indexOf("| 1 | 2 |") + 3;
    const v = mount(DOC, at);
    expect(v.dom.querySelector(".cm-nv-table table")).not.toBeNull();
  });

  it("conserva los bloques al escribir y actualiza las reglas cuando cambia la estructura", () => {
    const v = mount("Texto normal\n\n---\n\nFinal", 3);
    v.dispatch({ changes: { from: 3, insert: "x" } });
    expect(v.dom.querySelector(".cm-nv-rule hr")).not.toBeNull();
    const start = v.state.doc.toString().indexOf("---");
    v.dispatch({ changes: { from: start, to: start + 3, insert: "tres" } });
    expect(v.dom.querySelector(".cm-nv-rule hr")).toBeNull();
  });

  it("writes an edited cell back as a tidy table", () => {
    const v = mount(DOC);
    const cell = v.dom.querySelector<HTMLElement>('.cm-nv-table td[data-r="1"][data-c="0"]')!;
    cell.focus();
    cell.textContent = "99";
    cell.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(v.state.doc.toString()).toContain("| 99  | 2   |");
  });
});
