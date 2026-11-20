// Which cards of a canvas are worth rendering.
//
// A canvas is one absolutely-positioned board: every card parses its markdown
// (and each file/note card asks the core for the note's text or image) when it
// mounts. On a big map that mount cost is the freeze, so only the cards inside
// the visible rect — plus an overscan margin, so cards do not pop in at the very
// edge while panning — are rendered, together with the edges that touch them.

import { intersects, type CEdge, type CNode, type CanvasDoc, type Rect } from "./canvas";

/** World pixels kept rendered just outside the viewport. */
export const CANVAS_OVERSCAN = 600;

/** The host element's world-space rect, grown by the overscan margin. */
export function visibleWorldRect(
  view: { x: number; y: number; zoom: number },
  host: { w: number; h: number },
  overscan: number = CANVAS_OVERSCAN,
): Rect {
  return {
    x: -view.x / view.zoom - overscan,
    y: -view.y / view.zoom - overscan,
    width: host.w / view.zoom + 2 * overscan,
    height: host.h / view.zoom + 2 * overscan,
  };
}

/** True when the card overlaps the (already grown) visible rect. */
export function inViewport(node: Rect, rect: Rect): boolean {
  return intersects(rect, node);
}

export interface VisibleCanvas {
  /** Cards to render (always including the selected ones). */
  nodes: CNode[];
  ids: Set<string>;
  /** Edges whose source or target is rendered. */
  edges: CEdge[];
}

export function visibleCanvas(
  doc: CanvasDoc,
  rect: Rect,
  selected: ReadonlySet<string> = new Set(),
): VisibleCanvas {
  const nodes = doc.nodes.filter((n) => selected.has(n.id) || inViewport(n, rect));
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges = doc.edges.filter((e) => {
    if (ids.has(e.fromNode) || ids.has(e.toNode)) return true;
    const a = byId.get(e.fromNode);
    const b = byId.get(e.toNode);
    if (!a || !b) return false;
    const minX = Math.min(a.x, b.x) - 100;
    const minY = Math.min(a.y, b.y) - 100;
    const maxX = Math.max(a.x + a.width, b.x + b.width) + 100;
    const maxY = Math.max(a.y + a.height, b.y + b.height) + 100;
    return intersects(rect, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  });
  return { nodes, ids, edges };
}
