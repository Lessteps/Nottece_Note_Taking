// @vitest-environment jsdom

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModuleSidebar } from "./ModuleSidebar";
import { Calendar } from "lucide-react";

describe("ModuleSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders with collapse button and toggles width", async () => {
    await act(async () => {
      root.render(
        <ModuleSidebar
          title="Calendario"
          active="dia"
          onSelect={() => {}}
          items={[
            { id: "dia", label: "Día", icon: <Calendar size={14} /> }
          ]}
        >
          <div id="sidebar-child">Contenido Extra</div>
        </ModuleSidebar>
      );
    });

    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("w-[260px]");
    expect(container.querySelector("#sidebar-child")).not.toBeNull();

    const collapseBtn = container.querySelector('button[title="Ocultar barra lateral"]') as HTMLButtonElement;
    expect(collapseBtn).not.toBeNull();

    await act(async () => {
      collapseBtn.click();
    });

    expect(aside.className).toContain("w-16");
    expect(container.querySelector("#sidebar-child")).toBeNull();
    expect(localStorage.getItem("nv.sidebar.calendario.collapsed")).toBe("true");

    const expandBtn = container.querySelector('button[title="Mostrar barra lateral"]') as HTMLButtonElement;
    expect(expandBtn).not.toBeNull();

    await act(async () => {
      expandBtn.click();
    });

    expect(aside.className).toContain("w-[260px]");
    expect(container.querySelector("#sidebar-child")).not.toBeNull();
  });
});
