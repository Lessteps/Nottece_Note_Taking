// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { afterEach, expect, it, vi } from "vitest";
import { liveImages } from "./liveImages";
vi.mock("./bridge", () => ({ api: { readAttachment: vi.fn(async () => ({ data_url: "data:image/png;base64,AA==" })) } }));
let view: EditorView | undefined;
afterEach(() => { view?.destroy(); view = undefined; document.body.innerHTML = ""; });
it("muestra imágenes locales al salir de la línea y no interpreta bloques de código", async () => {
  const doc = "![[attachments/foto.png|120]]\n\n```md\n![[codigo.png]]\n```\n\nFinal";
  const host = document.createElement("div"); document.body.append(host);
  view = new EditorView({ parent: host, state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown(), liveImages("nota.md")] }) });
  await Promise.resolve(); await Promise.resolve();
  const img = host.querySelector(".cm-nv-image img") as HTMLImageElement;
  expect(img?.width).toBe(120); expect(img?.alt).toBe("attachments/foto.png");
  expect(host.querySelectorAll(".cm-nv-image")).toHaveLength(1);
  view.dispatch({ selection: { anchor: 3 } });
  expect(host.querySelector(".cm-nv-image")).toBeNull();
});
