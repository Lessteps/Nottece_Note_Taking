// @vitest-environment jsdom
//
// La red de la Fase 0: una nota que rompe su vista no puede dejar la ventana en
// blanco (React desmonta la raíz entera cuando un render lanza). Se muestra el
// aviso con la nota y el error, y al cambiar de nota se vuelve a intentar.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, isModuleLoadError } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("boom de prueba");
}

let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  return host;
}

/** React 19 renders the fallback in a retry pass: it needs the async act. */
const draw = async (node: React.ReactElement) => {
  await act(async () => {
    root!.render(node);
  });
};

describe("ErrorBoundary", () => {
  it("identifica errores de carga de módulos para ofrecer una recarga", () => {
    expect(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module: http://localhost:5173/module.tsx"))).toBe(true);
    expect(isModuleLoadError(new Error("Loading chunk 42 failed"))).toBe(true);
    expect(isModuleLoadError(new TypeError("Cannot read properties of null"))).toBe(false);
  });

  it("muestra qué nota falló y por qué, en vez de dejar la ventana vacía", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = mount();
    await draw(
      <ErrorBoundary path="Matemáticas/1.1 Números.md" what="La vista de la nota">
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.textContent).toContain("La vista de la nota no se pudo pintar");
    expect(host.textContent).toContain("Matemáticas/1.1 Números.md");
    expect(host.textContent).toContain("boom de prueba");
    // Y el resto de la ventana sigue en pie: solo se cayó esta superficie.
    expect(host.querySelector("div")).not.toBeNull();
    spy.mockRestore();
  });

  it("al cambiar de nota vuelve a intentarlo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = mount();
    await draw(
      <ErrorBoundary key="a" path="a.md" what="La vista de la nota">
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.textContent).toContain("no se pudo pintar");

    await draw(
      <ErrorBoundary key="b" path="b.md" what="La vista de la nota">
        <p>nota buena</p>
      </ErrorBoundary>,
    );
    expect(host.textContent).toContain("nota buena");
    expect(host.textContent).not.toContain("no se pudo pintar");
    spy.mockRestore();
  });
});
