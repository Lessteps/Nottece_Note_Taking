// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InteractiveRoute } from "./InteractiveRoute";
import type { BoardRow } from "./PlanBoard";
import { openTopic, openTopicNote } from "./openTopic";
vi.mock("./openTopic", () => ({ openTopic: vi.fn(), openTopicNote: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ""; });
const row = (folder: string, over: Partial<BoardRow> = {}): BoardRow => ({ folder, title: folder, week: 1, state: "sin_tratar", done: false, exercises: 0, ...over });
it("presenta el progreso real, permite elegir estaciones y abre teoría y práctica", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); const back = vi.fn();
  const rows = [row("Uno", { done: true }), row("Dos", { pct: 25 }), row("Tres", { unlockOn: "2026-12-01" })];
  await act(async () => { root.render(<InteractiveRoute area="Backend" rows={rows} onInformative={back} />); });
  expect(host.textContent).toContain("1 de 3 temas completados");
  expect([...host.querySelectorAll('[data-testid="route-node"]')].map((n) => n.getAttribute("data-state"))).toEqual(["done", "current", "locked"]);
  expect(host.querySelector('[data-testid="route-selected"]')!.textContent).toContain("Dos");
  const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
  await act(async () => { button("Ver teoría").click(); button("Practicar").click(); });
  expect(openTopicNote).toHaveBeenCalledWith("Dos"); expect(openTopic).toHaveBeenCalledWith("Dos");
  await act(async () => { (host.querySelectorAll('[data-testid="route-node"] button')[2] as HTMLButtonElement).click(); });
  expect(button("Practicar").disabled).toBe(true);
  await act(async () => { button("Ruta informativa").click(); }); expect(back).toHaveBeenCalledOnce();
  act(() => root.unmount()); host.remove();
});
it("explica cómo comenzar cuando no hay temas", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => { root.render(<InteractiveRoute area="Backend" rows={[]} onInformative={() => {}} />); });
  expect(host.textContent).toContain("todavía no tiene temas");
  act(() => root.unmount()); host.remove();
});

it("desplaza el lienzo arrastrando con el puntero sin requerir la barra espaciadora", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  const rows = [row("Uno", { done: true }), row("Dos")];
  await act(async () => { root.render(<InteractiveRoute area="Backend" rows={rows} onInformative={() => {}} />); });
  const rail = host.querySelector('[data-testid="route-rail"]') as HTMLDivElement;
  expect(rail).toBeTruthy();
  expect(rail.className).toContain("cursor-grab");

  // Pointer down sin presionar espacio
  await act(async () => {
    rail.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 100, button: 0 }));
  });
  expect(rail.className).toContain("cursor-grabbing");

  // Pointer move
  await act(async () => {
    rail.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 150, clientY: 80 }));
  });
  expect(rail.scrollLeft).toBe(50);
  expect(rail.scrollTop).toBe(20);

  // Pointer up
  await act(async () => {
    rail.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  expect(rail.className).toContain("cursor-grab");

  act(() => root.unmount()); host.remove();
});
