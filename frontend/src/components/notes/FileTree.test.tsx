// @vitest-environment jsdom
//
// Area A of FIX_VIEWS: clicking a folder must expand its children *and* open its
// view file — the early return used to leave the folder closed forever.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/bridge";
import { useApp } from "../../store/app";
import { openFolderView } from "./FileTree";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const folder = (path: string): any => ({ path, name: path.split("/").pop(), kind: "folder", children: [] });

describe("openFolderView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(useApp.getState(), "refreshTree").mockImplementation(() => undefined);
    vi.spyOn(useApp.getState(), "setMode").mockImplementation(() => undefined);
    vi.spyOn(useApp.getState(), "toast").mockImplementation(() => undefined);
    vi.spyOn(useApp.getState(), "openNote").mockResolvedValue(undefined);
  });

  it("expands the folder and opens its view", async () => {
    vi.spyOn(api, "studyViewEnsure").mockResolvedValue({
      ok: true,
      kind: "practica",
      path: "Matemáticas/1 Aritmética/1.1 X/1.1 X.practica.md",
      created: [],
      tagged: [],
      errors: [],
    });
    const toggle = vi.fn();

    await openFolderView(folder("Matemáticas/1 Aritmética/1.1 X"), toggle, false);

    expect(useApp.getState().refreshTree).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith("Matemáticas/1 Aritmética/1.1 X");
    expect(useApp.getState().openNote).toHaveBeenCalledWith("Matemáticas/1 Aritmética/1.1 X/1.1 X.practica.md");
  });

  it("does not collapse a folder that is already open", async () => {
    vi.spyOn(api, "studyViewEnsure").mockResolvedValue({
      ok: true,
      kind: "resumen",
      path: "Matemáticas/1 Aritmética/1 Aritmética.resumen.md",
      created: [],
      tagged: [],
      errors: [],
    });
    const toggle = vi.fn();

    await openFolderView(folder("Matemáticas/1 Aritmética"), toggle, true);

    expect(toggle).not.toHaveBeenCalled();
    expect(useApp.getState().openNote).toHaveBeenCalledWith("Matemáticas/1 Aritmética/1 Aritmética.resumen.md");
  });

  it("keeps the plain toggle for a folder without a view", async () => {
    vi.spyOn(api, "studyViewEnsure").mockResolvedValue({
      ok: false,
      kind: "none",
      path: "",
      created: [],
      tagged: [],
      errors: [],
    });
    const toggle = vi.fn();

    await openFolderView(folder("Inglés"), toggle, false);

    expect(toggle).toHaveBeenCalledWith("Inglés");
    expect(useApp.getState().openNote).not.toHaveBeenCalled();
  });
});
