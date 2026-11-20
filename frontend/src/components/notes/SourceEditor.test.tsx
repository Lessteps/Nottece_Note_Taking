// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SourceEditor } from "./SourceEditor";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocked = vi.hoisted(() => ({ upload: vi.fn(async () => ({ markdown: "![[attachments/foto.png]]", path: "attachments/foto.png" })), toast: vi.fn() }));
vi.mock("../../lib/bridge", () => ({ api: { importNoteImage: mocked.upload, readAttachment: vi.fn() } }));
vi.mock("../../store/app", () => ({ useApp: { getState: () => ({ toast: mocked.toast }) } }));
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });
it("inserta en la nota una imagen pegada desde el portapapeles", async () => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  vi.stubGlobal("FileReader", class { result = "data:image/png;base64,iVBORw=="; onload: (() => void) | null = null; onerror: (() => void) | null = null; readAsDataURL() { queueMicrotask(() => this.onload?.()); } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const onChange = vi.fn();
  await act(async () => root.render(<SourceEditor notePath="nota.md" value="Inicio" eol={"\n"} code={false} onChange={onChange} />));
  const editor = host.querySelector(".cm-content")!;
  const file = new File([new Uint8Array([137, 80, 78, 71])], "foto.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [file] } });
  await act(async () => { editor.dispatchEvent(event); await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(event.defaultPrevented).toBe(true);
  expect(mocked.upload).toHaveBeenCalledWith("nota.md", "foto.png", expect.any(String));
  expect(onChange.mock.lastCall?.[0]).toContain("![[attachments/foto.png]]");
  act(() => root.unmount()); vi.unstubAllGlobals();
});
