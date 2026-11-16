// @vitest-environment jsdom
//
// Area A (Interfaces V3), verified by rendering: the top bar is a single
// Obsidian-style tab strip. The redundant search box is gone, every open
// module/note/canvas is a tab, and a pinned tab has no ×.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MenuHost } from "./ui";
import { IconRail, isBrowserTab, StatusBar, TopBar } from "./Shell";
import { useVaultDialog } from "./VaultDialog";
import { useApp } from "../store/app";

// Electron host: the bar draws the window controls and asks the shell for them.
const invoke = vi.fn(async (_method: string, _args?: unknown[]): Promise<unknown> => ({ maximized: false, ok: true }));
(window as unknown as { nv: unknown }).nv = { invoke };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <>
        <TopBar />
        <MenuHost />
      </>,
    );
  });
}

function tabs(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function tab(label: string): HTMLElement {
  const el = tabs().find((t) => t.textContent?.includes(label));
  if (!el) throw new Error(`no tab “${label}” — got ${tabs().map((t) => t.textContent).join(" | ")}`);
  return el;
}

const closeButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.title === "Cerrar pestaña");

// Sin esto el árbol de React sigue vivo al terminar y su planificador dispara tras cerrar jsdom («window is not defined»).
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    vault: "C:/vault-a",
    module: "notas",
    explorerTab: "files",
    explorerOpen: true,
    info: { api_version: 1, vault_name: "vault-a", vault_path: "C:/vault-a", theme: "dark" },
    openTabs: [
      { kind: "module", id: "calendario", tabId: "module:calendario" },
      { kind: "note", path: "Matemáticas/1.1/nota.md", tabId: "note:Matemáticas/1.1/nota.md" },
      { kind: "canvas", path: "Matemáticas/mapa.canvas", tabId: "canvas:Matemáticas/mapa.canvas" },
    ],
    activeTabId: "note:Matemáticas/1.1/nota.md",
    active: "Matemáticas/1.1/nota.md",
    tabs: ["Matemáticas/1.1/nota.md", "Matemáticas/mapa.canvas"],
    pinnedTabIds: new Set<string>(),
    notes: {},
  });
  mount();
});

describe("TopBar", () => {
  it("is one tab strip: every open target is a tab and the search box is gone", () => {
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();

    expect(tabs().map((t) => t.textContent)).toEqual(["Calendario", "nota", "mapa"]);
    expect(tab("nota").getAttribute("aria-selected")).toBe("true");
    expect(tab("Calendario").getAttribute("aria-selected")).toBe("false");
  });

  it("activates a tab on click", () => {
    act(() => tab("Calendario").click());
    expect(useApp.getState().activeTabId).toBe("module:calendario");
    expect(tab("Calendario").getAttribute("aria-selected")).toBe("true");
  });

  it("closes a tab with its ×", () => {
    const btn = closeButton(tab("mapa"))!;
    expect(btn).toBeDefined();
    act(() => btn.click());
    expect(useApp.getState().openTabs.map((t) => t.tabId)).toEqual([
      "module:calendario",
      "note:Matemáticas/1.1/nota.md",
    ]);
    expect(tabs().map((t) => t.textContent)).toEqual(["Calendario", "nota"]);
  });

  it("shows a pin instead of the × on a pinned tab, and pins from the context menu", () => {
    const el = tab("nota");
    act(() => {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const pin = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Fijar"));
    expect(pin).toBeDefined();
    act(() => pin!.click());

    expect([...useApp.getState().pinnedTabIds]).toEqual(["note:Matemáticas/1.1/nota.md"]);
    expect(tab("nota").querySelector("svg.lucide-pin")).not.toBeNull();
    expect(closeButton(tab("nota"))).toBeUndefined();
    expect(closeButton(tab("mapa"))).toBeDefined();
  });

  it("is one bar: workspace icons, tabs, sync state and window controls", () => {
    const headers = [...container.querySelectorAll("header")];
    expect(headers).toHaveLength(1);
    // The bar is the window's title bar, so its background drags the window.
    expect(headers[0]!.className).toContain("nv-titlebar");

    const text = headers[0]!.textContent ?? "";
    expect(text).toContain("Guardado");
    expect(text).toContain("Calendario"); // the tabs live in this same row
    // No brand block: the bar carries the tabs, not the app name or the vault.
    expect(text).not.toContain("NoteVault");
    expect(text).not.toContain("vault-a");

    // The bar keeps the tab strip and the window's own controls; the three view
    // shortcuts are gone (the explorer panel carries its own tabs).
    expect(container.querySelector('button[aria-label="Panel lateral"]')).not.toBeNull();
    for (const label of ["Archivos", "Buscar", "Marcadores"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`), `sobra “${label}”`).toBeNull();
    }
    for (const label of ["Minimizar", "Maximizar", "Cerrar"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`), `missing “${label}”`).not.toBeNull();
    }
    // Nothing stacked above the bar.
    expect(container.querySelector("header + header")).toBeNull();
  });

  it("hides the window controls when the host brings its own chrome", () => {
    const nv = (window as unknown as { nv?: unknown }).nv;
    delete (window as unknown as { nv?: unknown }).nv;
    try {
      const other = document.createElement("div");
      document.body.appendChild(other);
      act(() => {
        createRoot(other).render(<TopBar />);
      });
      expect(other.querySelector('button[aria-label="Minimizar"]')).toBeNull();
      expect(other.querySelector('button[aria-label="Cerrar"]')).toBeNull();
      // The rest of the bar is still there.
      expect(other.querySelector('[role="tablist"]')).not.toBeNull();
    } finally {
      (window as unknown as { nv?: unknown }).nv = nv;
    }
  });

  it("the strip owns the bar: only the panel toggle and the window controls are fixed", () => {
    // The tabs are what takes the space, so the strip must not sit next to three
    // view buttons anymore.
    const strip = container.querySelector('[role="tablist"]');
    expect(strip).not.toBeNull();
    const buttons = [...container.querySelectorAll("header button[aria-label]")].map((b) => b.getAttribute("aria-label"));
    expect(buttons).toContain("Panel lateral");
    expect(buttons).not.toContain("Archivos");
    expect(buttons).not.toContain("Buscar");
    expect(buttons).not.toContain("Marcadores");

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Panel lateral"]')!.click());
    expect(useApp.getState().explorerOpen).toBe(false);

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    // Closing asks the shell; the jsdom bridge records the call.
    expect(useApp.getState().openTabs.length).toBe(3);
  });
});

describe("the tab strip", () => {
  it("never lists the browser: neither its pages nor its surface", () => {
    useApp.setState({
      openTabs: [
        ...useApp.getState().openTabs,
        { kind: "web", tabId: "web" },
        { kind: "module", id: "web", tabId: "module:web" },
      ],
    });
    mount();

    const labels = tabs().map((t) => t.textContent ?? "");
    expect(labels.some((l) => l.includes("Navegador"))).toBe(false);
    // The tabs that do belong here are untouched.
    expect(labels.some((l) => l.includes("Calendario"))).toBe(true);
  });

  it("knows what belongs to the rail instead of the bar", () => {
    expect(isBrowserTab({ kind: "web" })).toBe(true);
    expect(isBrowserTab({ kind: "module", id: "web" })).toBe(true);
    expect(isBrowserTab({ kind: "module", id: "ejercicio" })).toBe(false);
    expect(isBrowserTab({ kind: "note" })).toBe(false);
    expect(isBrowserTab({ kind: "canvas" })).toBe(false);
  });

  it("hides its scrollbar and keeps every tab it holds", () => {
    mount();
    const strip = container.querySelector('[role="tablist"][aria-label="Pestañas abiertas"]')!;
    // The class is what removes the horizontal scrollbar (see styles.css).
    expect(strip.className).toContain("nv-tabstrip");
    expect(strip.className).toContain("overflow-x-auto");
  });
});

describe("StatusBar", () => {
  it("keeps the vault switcher, now that the top bar has no brand block", () => {
    const other = document.createElement("div");
    document.body.appendChild(other);
    act(() => {
      createRoot(other).render(<StatusBar />);
    });

    const vault = other.querySelector<HTMLButtonElement>('button[title="Cambiar de vault"]');
    expect(vault).not.toBeNull();
    expect(vault!.textContent).toContain("vault-a");

    useVaultDialog.setState({ open: false });
    act(() => vault!.click());
    expect(useVaultDialog.getState().open).toBe(true);
  });
});

describe("IconRail", () => {
  it("renders collapsed initially and expands to Notion sidebar on toggle", () => {
    useApp.setState({ explorerOpen: false });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(<IconRail />);
    });

    // The redundant >> button inside the collapsed rail has been removed
    const expandBtn = el.querySelector<HTMLButtonElement>('button[aria-label="Desplegar barra lateral"]');
    expect(expandBtn).toBeNull();
    expect(el.textContent).not.toContain("Módulos del Sistema");

    // Toggling explorerOpen (via top-left PanelLeft button or shortcut) expands it
    act(() => {
      useApp.getState().toggleExplorer();
    });

    act(() => {
      root.render(<IconRail />);
    });

    expect(el.textContent).toContain("Módulos del Sistema");

    // Collapsing via top bar toggle
    act(() => {
      useApp.getState().toggleExplorer();
    });

    act(() => {
      root.render(<IconRail />);
    });

    expect(el.textContent).not.toContain("Módulos del Sistema");
    act(() => {
      root.unmount();
    });
    document.body.removeChild(el);
  });
});
