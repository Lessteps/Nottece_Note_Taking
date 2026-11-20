// Area B (Interfaces V3): the canvas only mounts the cards near the view, so a
// large map does not parse every card at once.

import { describe, expect, it } from "vitest";
import type { CEdge, CNode, CanvasDoc } from "./canvas";
import { CANVAS_OVERSCAN, inViewport, visibleCanvas, visibleWorldRect } from "./canvasViewport";

const node = (id: string, x: number, y: number): CNode =>
  ({ id, type: "text", x, y, width: 200, height: 100, text: id });

const edge = (id: string, fromNode: string, toNode: string): CEdge =>
  ({ id, fromNode, toNode, fromSide: "right", toSide: "left" });

/** A 20 × 20 grid of 400 cards, 200 px apart. */
const bigDoc: CanvasDoc = (() => {
  const nodes: CNode[] = [];
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 20; col++) nodes.push(node(`n${row}-${col}`, col * 200, row * 200));
  }
  return { nodes, edges: [edge("e-far", "n0-0", "n19-19"), edge("e-near", "n0-0", "n0-1"), edge("e-far2", "n19-18", "n19-19")] };
})();

describe("canvas viewport culling", () => {
  it("covers the host plus the overscan margin, in world pixels", () => {
    const rect = visibleWorldRect({ x: -100, y: -50, zoom: 2 }, { w: 800, h: 600 });
    expect(rect.x).toBe(50 - CANVAS_OVERSCAN);
    expect(rect.y).toBe(25 - CANVAS_OVERSCAN);
    expect(rect.width).toBe(400 + 2 * CANVAS_OVERSCAN);
    expect(rect.height).toBe(300 + 2 * CANVAS_OVERSCAN);
  });

  it("zooming out shows more cards, zooming in shows fewer", () => {
    const view = { x: 0, y: 0 };
    const host = { w: 800, h: 600 };
    const wide = visibleCanvas(bigDoc, visibleWorldRect({ ...view, zoom: 0.2 }, host));
    const close = visibleCanvas(bigDoc, visibleWorldRect({ ...view, zoom: 1 }, host));

    expect(wide.nodes.length).toBeGreaterThan(close.nodes.length);
    // A 800×600 host with overscan cannot hold the whole 4000 × 4000 map.
    expect(close.nodes.length).toBeLessThan(bigDoc.nodes.length);
  });

  it("keeps the selected card rendered even when it is off screen", () => {
    const rect = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { w: 800, h: 600 });
    expect(inViewport(bigDoc.nodes.find((n) => n.id === "n19-19")!, rect)).toBe(false);

    const culled = visibleCanvas(bigDoc, rect);
    expect(culled.ids.has("n19-19")).toBe(false);

    const withSelection = visibleCanvas(bigDoc, rect, new Set(["n19-19"]));
    expect(withSelection.ids.has("n19-19")).toBe(true);
  });

  it("keeps an edge when either of its cards is rendered", () => {
    const rect = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, { w: 800, h: 600 });
    const { edges } = visibleCanvas(bigDoc, rect);
    // e-far survives through its visible source; e-far2 has both ends off screen.
    expect(edges.map((e) => e.id)).toEqual(["e-far", "e-near"]);

    // The far edge comes back with the far card selected.
    const { edges: withFar } = visibleCanvas(bigDoc, rect, new Set(["n19-19"]));
    expect(withFar.map((e) => e.id)).toEqual(["e-far", "e-near", "e-far2"]);
  });

  it("keeps an edge when zoomed in close to the line, even if both cards are off screen", () => {
    // n0-0 is at (0, 0), n19-19 is at (3800, 3800).
    // Viewport is zoomed in at the center (world rect x: 1800, y: 1800, w: 200, h: 200).
    const midRect = { x: 1800, y: 1800, width: 200, height: 200 };
    const { nodes, edges } = visibleCanvas(bigDoc, midRect);

    // Neither node is inside midRect
    expect(nodes.some((n) => n.id === "n0-0" || n.id === "n19-19")).toBe(false);
    // But e-far connects n0-0 and n19-19 and spans right across the middle
    expect(edges.some((e) => e.id === "e-far")).toBe(true);
    // And e-near (between n0-0 and n0-1 at 200, 0) is far away and should be culled
    expect(edges.some((e) => e.id === "e-near")).toBe(false);
  });
});
