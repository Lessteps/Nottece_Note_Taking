import { describe, expect, it } from "vitest";
import {
  cloneNodes, drawingNode, edgePath, nearestSide, pruneEdges, resolveEdgeAnchors, shapePath, SHAPES, type CanvasDoc, type CEdge, type CNode,
} from "./canvas";

const doc: CanvasDoc = {
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "A" },
    { id: "b", type: "text", x: 300, y: 0, width: 100, height: 50, text: "B" },
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }],
};

describe("canvas geometry", () => {
  it("draws edges from port to port", () => {
    const { d, mid } = edgePath(doc.nodes[0]!, "right", doc.nodes[1]!, "left");
    expect(d.startsWith("M100,25 ")).toBe(true);
    expect(d.endsWith(" 300,25")).toBe(true);
    expect(mid).toEqual([200, 25]);
  });

  it("finds the side facing a point", () => {
    const n = doc.nodes[0]!;
    expect(nearestSide(n, 500, 25)).toBe("right");
    expect(nearestSide(n, 50, -300)).toBe("top");
  });

  it("clones nodes with their inner edges and prunes dangling ones", () => {
    const copy = cloneNodes(doc, new Set(["a", "b"]), 10, 20);
    expect(copy.nodes.map((n) => [n.x, n.y])).toEqual([[10, 20], [310, 20]]);
    expect(copy.edges).toHaveLength(1);
    expect(copy.edges[0]!.fromNode).toBe(copy.nodes[0]!.id);
    expect(pruneEdges({ nodes: [doc.nodes[0]!], edges: doc.edges }).edges).toEqual([]);
  });

  it("turns freehand points into a local drawing", () => {
    const n = drawingNode([[100, 100], [150, 120]], "2", 3)!;
    expect(n.type).toBe("nv-drawing");
    const pts = n.nv!.strokes![0]!.points;
    expect(pts[0]).toEqual([100 - n.x, 100 - n.y]);
    expect(drawingNode([[1, 1]], "1", 3)).toBeNull();
  });

  it("has a path for every shape", () => {
    for (const s of SHAPES) expect(shapePath(s.id, s.w, s.h)).toMatch(/^M/);
  });

  describe("resolveEdgeAnchors - connection separation margin", () => {
    it("leaves a single edge at default t = 0.5", () => {
      const anchors = resolveEdgeAnchors(doc.nodes, doc.edges);
      expect(anchors.get("e")).toEqual({ fromT: 0.5, toT: 0.5 });
    });

    it("separates multiple edges on the same side with obligatory minimum margin", () => {
      const target: CNode = { id: "target", type: "text", x: 300, y: 100, width: 200, height: 120, text: "Target" };
      const topNode: CNode = { id: "top", type: "text", x: 0, y: 0, width: 100, height: 60, text: "Top" };
      const bottomNode: CNode = { id: "bottom", type: "text", x: 0, y: 200, width: 100, height: 60, text: "Bottom" };

      const e1: CEdge = { id: "e1", fromNode: "top", toNode: "target", fromSide: "right", toSide: "left" };
      const e2: CEdge = { id: "e2", fromNode: "bottom", toNode: "target", fromSide: "right", toSide: "left" };

      const nodes = [target, topNode, bottomNode];
      const edges = [e1, e2];
      const anchors = resolveEdgeAnchors(nodes, edges);

      const a1 = anchors.get("e1")!;
      const a2 = anchors.get("e2")!;

      // Top card connection attaches higher than bottom card connection (prevents crossing)
      expect(a1.toT).toBeLessThan(a2.toT);

      // Distance in pixels along target's left side (height = 120)
      const pixelDistance = (a2.toT - a1.toT) * target.height;
      expect(pixelDistance).toBeGreaterThanOrEqual(24);
    });

    it("separates three edges on the same side and avoids overlapping arrowheads", () => {
      const target: CNode = { id: "hub", type: "text", x: 400, y: 200, width: 250, height: 150, text: "Hub" };
      const n1: CNode = { id: "n1", type: "text", x: 0, y: 50, width: 100, height: 50, text: "N1" };
      const n2: CNode = { id: "n2", type: "text", x: 0, y: 200, width: 100, height: 50, text: "N2" };
      const n3: CNode = { id: "n3", type: "text", x: 0, y: 350, width: 100, height: 50, text: "N3" };

      const e1: CEdge = { id: "e1", fromNode: "n1", toNode: "hub", fromSide: "right", toSide: "left" };
      const e2: CEdge = { id: "e2", fromNode: "n2", toNode: "hub", fromSide: "right", toSide: "left" };
      const e3: CEdge = { id: "e3", fromNode: "n3", toNode: "hub", fromSide: "right", toSide: "left" };

      const anchors = resolveEdgeAnchors([target, n1, n2, n3], [e1, e2, e3]);
      const t1 = anchors.get("e1")!.toT;
      const t2 = anchors.get("e2")!.toT;
      const t3 = anchors.get("e3")!.toT;

      expect(t1).toBeLessThan(t2);
      expect(t2).toBeLessThan(t3);

      expect((t2 - t1) * target.height).toBeGreaterThanOrEqual(24);
      expect((t3 - t2) * target.height).toBeGreaterThanOrEqual(24);
    });

    it("nudges colliding custom anchors apart by minimum separation", () => {
      const target: CNode = { id: "hub", type: "text", x: 400, y: 200, width: 200, height: 100, text: "Hub" };
      const n1: CNode = { id: "n1", type: "text", x: 0, y: 50, width: 100, height: 50, text: "N1" };
      const n2: CNode = { id: "n2", type: "text", x: 0, y: 200, width: 100, height: 50, text: "N2" };

      // Both edges configured with virtually the same custom anchor
      const e1: CEdge = { id: "e1", fromNode: "n1", toNode: "hub", fromSide: "right", toSide: "left", nv: { toT: 0.3 } };
      const e2: CEdge = { id: "e2", fromNode: "n2", toNode: "hub", fromSide: "right", toSide: "left", nv: { toT: 0.31 } };

      const anchors = resolveEdgeAnchors([target, n1, n2], [e1, e2]);
      const t1 = anchors.get("e1")!.toT;
      const t2 = anchors.get("e2")!.toT;

      const pixelDistance = Math.abs(t2 - t1) * target.height;
      expect(pixelDistance).toBeGreaterThanOrEqual(24);
    });
  });
});
