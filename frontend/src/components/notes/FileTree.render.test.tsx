// @vitest-environment jsdom
//
// Explorer lag: hovering / dragging over rows must not re-render the other rows.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => ({ n: 0 }));

vi.mock("lucide-react", async (orig) => {
  const mod = await orig<typeof import("lucide-react")>();
  const counted = (Icon: React.ComponentType<Record<string, unknown>>) =>
    function Counted(props: Record<string, unknown>) {
      renders.n++;
      return createElement(Icon, props);
    };
  return { ...mod, FileText: counted(mod.FileText as never), Folder: counted(mod.Folder as never) };
});

import { api } from "../../lib/bridge";
import { useApp } from "../../store/app";
import { DRAG_MIME, FileTree } from "./FileTree";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = (path: string, type: "folder" | "note"): any => ({
  path, name: path.split("/").pop(), type, kind: type === "folder" ? undefined : "note", has_children: type === "folder",
});

const flush = () => act(async () => { await Promise.resolve(); });

describe("FileTree rows", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.clear();
    const rootEntries = [
      ...Array.from({ length: 12 }, (_, i) => entry(`F${i}`, "folder")),
      ...Array.from({ length: 12 }, (_, i) => entry(`n${i}.md`, "note")),
    ];
    vi.spyOn(api, "listDir").mockImplementation(async (p?: string) => (!p ? rootEntries : []));
    vi.spyOn(api, "studyViewEnsure").mockResolvedValue({ ok: false, kind: "none", path: "", created: [], tagged: [], errors: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(FileTree, { filter: "" })); });
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("renders every row", () => {
    expect(host.querySelectorAll('[role="treeitem"]').length).toBe(24);
  });

  it("hovering rows does not re-render anything", () => {
    const rows = Array.from(host.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    renders.n = 0;
    act(() => {
      for (const r of rows) {
        r.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        r.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      }
    });
    expect(renders.n).toBe(0);
  });

  it("dragging over a folder re-renders only that row", () => {
    const rows = Array.from(host.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    const over = (el: Element) => {
      const ev = new Event("dragover", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: { types: [DRAG_MIME] } });
      el.dispatchEvent(ev);
    };
    renders.n = 0;
    act(() => over(rows[3]!));
    expect(rows[3]!.className).toContain("outline-accent");
    expect(renders.n).toBe(1);
    renders.n = 0;
    act(() => over(rows[3]!)); // same target again: nothing to do
    expect(renders.n).toBe(0);
    act(() => over(rows[5]!));
    expect(renders.n).toBe(2); // old and new target
    expect(rows[3]!.className).not.toContain("outline-accent");
  });

  it("clicking a plain folder expands it (listDir called for it)", async () => {
    const rows = Array.from(host.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    await act(async () => { rows[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(api.listDir).toHaveBeenCalledWith("F0");
    expect(host.querySelector('[role="treeitem"][aria-expanded="true"]')).not.toBeNull();
  });

  it("selecting a note re-renders only the rows whose active state changes", async () => {
    const before = renders.n;
    await act(async () => { useApp.setState({ active: "n2.md" }); });
    // the tree itself re-renders, but memoized rows only repaint the changed one
    expect(renders.n - before).toBeLessThanOrEqual(1);
    expect(host.querySelectorAll(".bg-accent-soft").length).toBe(1);
  });

  it("automatically reveals and expands ancestor directories when an active note is set", async () => {
    vi.spyOn(api, "listDir").mockImplementation(async (p?: string) => {
      if (p === "F0") return [entry("F0/SubFolder", "folder")];
      if (p === "F0/SubFolder") return [entry("F0/SubFolder/kata.md", "note")];
      return [];
    });

    await act(async () => {
      useApp.setState({ active: "F0/SubFolder/kata.md" });
    });
    await flush();

    expect(api.listDir).toHaveBeenCalledWith("F0");
    expect(api.listDir).toHaveBeenCalledWith("F0/SubFolder");
    const activeRow = host.querySelector('[role="treeitem"].bg-accent-soft');
    expect(activeRow).not.toBeNull();
    expect(activeRow?.textContent).toContain("kata.md");
  });
});
