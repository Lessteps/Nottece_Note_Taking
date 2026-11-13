// @vitest-environment jsdom
//
// CAMBIO 2: switching functionality must not destroy the view — its internal
// sub-tab and its state have to be there when the user comes back.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ModuleHost } from "./ModuleHost";
import { flushNavState, useNavState, usePersistedNav } from "../store/navState";
import type { ModuleId } from "../store/app";

/** A stand-in module with an internal sub-tab, like Ejercicio has. */
function Stub({ id, initial = "inicio" }: { id: string; initial?: string }) {
  const [sub, setSub] = useState(initial);
  return (
    <div data-module={id}>
      <span data-sub>{sub}</span>
      <button type="button" onClick={() => setSub("lunes")}>
        ir a lunes
      </button>
    </div>
  );
}

function Harness({ module }: { module: ModuleId }) {
  return (
    <ModuleHost
      module={module}
      render={(id) => (id === "ejercicio" ? <Stub id="ejercicio" /> : <Stub id={String(id)} initial="otra" />)}
    />
  );
}

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

const subOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-module="${id}"] [data-sub]`)?.textContent;

describe("ModuleHost", () => {
  it("contiene un fallo de render y permite reintentar sin desmontar el resto de la app", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    function Broken() { if (broken) throw new Error("fallo de prueba"); return <div>Recuperado</div>; }
    const { container, root } = mount(<ModuleHost module="mentor" render={() => <Broken />} />);
    expect(container.textContent).toContain("El Mentor no se pudo pintar");
    broken = false;
    act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Reintentar")!.click(); });
    expect(container.textContent).toContain("Recuperado");
    act(() => root.unmount());
    container.remove();
    log.mockRestore();
  });

  it("keeps the previous functionality mounted and hidden", () => {
    const { container, root } = mount(<Harness module="ejercicio" />);
    expect(subOf(container, "ejercicio")).toBe("inicio");

    act(() => {
      root.render(<Harness module="tareas" />);
    });

    // Both are alive; only the active one is visible.
    expect(subOf(container, "ejercicio")).toBe("inicio");
    expect(subOf(container, "tareas")).toBe("otra");
    const shells = [...container.querySelectorAll("div[aria-hidden]")];
    const hidden = shells.filter((s) => s.getAttribute("aria-hidden") === "true");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.className).toContain("hidden");
    expect(hidden[0]!.hasAttribute("inert")).toBe(true);
  });

  it("brings the internal state back untouched", () => {
    const { container, root } = mount(<Harness module="ejercicio" />);
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-module=ejercicio] button")!.click();
    });
    expect(subOf(container, "ejercicio")).toBe("lunes");

    act(() => {
      root.render(<Harness module="finanzas" />);
    });
    act(() => {
      root.render(<Harness module="ejercicio" />);
    });

    expect(subOf(container, "ejercicio")).toBe("lunes");
  });

  it("mounts a functionality the first time it is activated", () => {
    const { container } = mount(<Harness module="ejercicio" />);
    expect(container.querySelector('[data-module="tareas"]')).toBeNull();
  });
});

describe("usePersistedNav", () => {
  function Nav() {
    const [value, setValue] = usePersistedNav("ejercicio.view", "overview");
    return (
      <button type="button" onClick={() => setValue("lunes")}>
        {value}
      </button>
    );
  }

  it("remembers the value for the next mount, and for the next session", () => {
    localStorage.clear();
    useNavState.setState({ values: {} });
    const first = mount(<Nav />);
    act(() => {
      first.container.querySelector("button")!.click();
    });
    expect(first.container.textContent).toBe("lunes");

    // A fresh mount reads it back from the store…
    const second = mount(<Nav />);
    expect(second.container.textContent).toBe("lunes");
    // …and it is on disk for the next start.
    flushNavState(); // the write is coalesced; it is flushed on a short timer and when the window closes
    expect(localStorage.getItem("nv.navState")).toContain("lunes");
  });

  it("falls back to the initial value", () => {
    localStorage.clear();
    useNavState.setState({ values: {} });
    const { container } = mount(<Nav />);
    expect(container.textContent).toBe("overview");
  });
});
