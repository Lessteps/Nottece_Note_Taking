import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { api } from "./bridge";

/** Image embeds on their own line are previewed outside the active line. */
class ImageWidget extends WidgetType {
  constructor(readonly notePath: string, readonly name: string, readonly width?: number, readonly height?: number) { super(); }
  eq(other: ImageWidget) { return this.notePath === other.notePath && this.name === other.name && this.width === other.width && this.height === other.height; }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-nv-image";
    wrapper.textContent = "Cargando imagen…";
    void api.readAttachment(this.notePath, this.name).then(({ data_url }) => {
      const image = document.createElement("img");
      image.src = data_url; image.alt = this.name; image.style.maxWidth = "100%";
      if (this.width) image.width = this.width;
      if (this.height) { image.height = this.height; image.style.height = `${this.height}px`; }
      wrapper.replaceChildren(image);
    }).catch(() => { wrapper.textContent = `Imagen no encontrada: ${this.name}`; });
    return wrapper;
  }
  ignoreEvent() { return false; }
}
export function liveImages(notePath: string) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = this.build(update.view); }
    build(view: EditorView) {
      const ranges = [];
      const seen = new Set<number>();
      for (const visible of view.visibleRanges) {
        let line = view.state.doc.lineAt(visible.from);
        while (line.from <= visible.to) {
          if (seen.has(line.number)) { if (line.number >= view.state.doc.lines) break; line = view.state.doc.line(line.number + 1); continue; }
          seen.add(line.number);
          const selected = view.state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
          const wiki = /^\s*!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|bmp|svg))(?:\|(\d+)(?:x(\d+))?)?\]\]\s*$/i.exec(line.text);
          const plain = /^\s*!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)\s*$/.exec(line.text);
          const raw = wiki?.[1] ?? plain?.[1] ?? plain?.[2];
          let inCode = false;
          for (let node = syntaxTree(view.state).resolveInner(line.from, 1); node; node = node.parent!) {
            if (/CodeBlock|FencedCode/.test(node.name)) { inCode = true; break; }
            if (!node.parent) break;
          }
          if (!selected && raw && !inCode && !/^(?:https?:|data:)/i.test(raw)) {
            let name = raw; try { name = decodeURI(raw); } catch { /* literal path */ }
            ranges.push(Decoration.replace({ widget: new ImageWidget(notePath, name, wiki?.[2] ? Number(wiki[2]) : undefined, wiki?.[3] ? Number(wiki[3]) : undefined) }).range(line.from, line.to));
          }
          if (line.number >= view.state.doc.lines) break;
          line = view.state.doc.line(line.number + 1);
        }
      }
      return Decoration.set(ranges, true);
    }
  }, { decorations: (value) => value.decorations });
}
