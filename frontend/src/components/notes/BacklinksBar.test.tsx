// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/bridge";
import { BacklinksBar } from "./EditorArea";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("solo busca menciones al abrir el panel y actualiza al cambiar de nota", async () => {
  vi.useFakeTimers();
  const search = vi.spyOn(api, "mentions").mockResolvedValue({ linked: [], unlinked: [] });
  const el = document.createElement("div"); document.body.appendChild(el); const root = createRoot(el);
  const note = (path: string) => ({ kind: "note", path } as never);
  await act(async () => { root.render(<BacklinksBar note={note("a.md")} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(search).not.toHaveBeenCalled();
  await act(async () => { el.querySelector("button")!.click(); await vi.advanceTimersByTimeAsync(200); });
  expect(search).toHaveBeenCalledWith("a.md");
  await act(async () => { root.render(<BacklinksBar note={note("b.md")} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(search).toHaveBeenCalledWith("b.md");
  act(() => root.unmount()); el.remove();
});
