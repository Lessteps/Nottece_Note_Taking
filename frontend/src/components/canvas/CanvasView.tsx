// The canvas editor: an infinite board of cards joined by arrows. Same
// .canvas files as the classic app (and Obsidian).

import {
  ArrowLeftRight, Diamond, FileText, Grid3x3, Image as ImageIcon, LayoutDashboard, Link2, Magnet, Maximize,
  Minus, MousePointer2, PenLine, Plus, Redo2, SquareDashed, StickyNote, Trash2, Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/bridge";
import {
  anchorExtras, borderHit, bounds, cloneNodes, colorOf, contains, drawingNode, edgePath, edgeT, GRID, gridBackgroundOffset, intersects,
  nearestSide, newId, portPoint, PRESET_COLORS, pruneEdges, resizeHandleAt, resizeRect, RESIZE_CURSOR, resolveEdgeAnchors, SHAPES, snappedDelta, snapRect,
  snapTo, type BorderHit, type CEdge, type CNode, type CanvasDoc, type Rect, type ResizeHandle, type Side,
} from "../../lib/canvas";
import { readClipboard } from "../../lib/clipboard";
import { inViewport, visibleCanvas, visibleWorldRect } from "../../lib/canvasViewport";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { askText, cn, openMenu } from "../ui";
import { CanvasNodeView, forgetFileInfo } from "./CanvasNode";
import { PathPicker } from "./PathPicker";
import { FormatBar } from "../notes/FormatBar";
import { DRAG_MIME } from "../notes/FileTree";

type View = { x: number; y: number; zoom: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; sx: number; sy: number; /** the card being dragged: it is the one that lands on the grid */ anchor: string; start: Map<string, [number, number]>; moved: boolean }
  | { kind: "resize"; id: string; sx: number; sy: number; w: number; h: number; x: number; y: number; handle: string }
  | { kind: "connect"; from: string; side: Side; /** position along that side, 0..1 */ t: number; /** where the pointer went down */ ox: number; oy: number; x: number; y: number }
  | { kind: "box"; x0: number; y0: number; x: number; y: number; add: boolean }
  | { kind: "draw"; points: Array<[number, number]> };

/** How close (in screen pixels) the pointer has to be to a card's outline to grab it. */
const BORDER_PX = 8;
/** Within this many screen pixels of a corner, the outline resizes both ways. */
const CORNER_PX = 14;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

export function CanvasView() {
  const path = useCanvas((s) => s.path)!;
  const title = useCanvas((s) => s.title);
  const doc = useCanvas((s) => s.doc);
  const dirty = useCanvas((s) => s.dirty);
  const conflict = useCanvas((s) => s.conflict);
  const canUndo = useCanvas((s) => s.past.length > 0);
  const canRedo = useCanvas((s) => s.future.length > 0);
  const { commit, snapshot, undo, redo } = useCanvas.getState();

  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** True while the selection is the result of a selection box (drawings then show their box; after a click on the stroke they do not). */
  const [marquee, setMarquee] = useState(false);
  /** The strokes a drawing had when a resize started: each move scales those, so no error builds up. */
  const strokeBase = useRef(new WeakMap<object, unknown>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [drawMode, setDrawMode] = useState(false);
  const [pen, setPen] = useState({ color: "5", width: 3 });
  const [snap, setSnap] = useState(() => localStorage.getItem("nv.canvas.snap") !== "0");
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem("nv.canvas.grid") !== "0");
  const [picker, setPicker] = useState<null | "note" | "image" | "canvas">(null);
  const clip = useRef<CanvasDoc | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  /** The outline the pointer is over and what dragging it would do: move it (a group) or stretch it (which handle). */
  const [hoverBorder, setHoverBorder] = useState<{ id: string; handle: ResizeHandle; move: boolean } | null>(null);
  /** Space held: dragging moves the view instead of selecting. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  spaceRef.current = spaceHeld;
  /**
   * The card whose outline is under a world point. The NEAREST outline wins: a card sitting a few pixels inside its group must not
   * steal the group's own border (the groups of a map are covered by their cards, so the border is the only place to grab them).
   * When two outlines are about equally near (a card flush against its group), the smaller one wins.
   */
  const hitBorder = (wx: number, wy: number, exclude?: string): (BorderHit & { id: string }) | null => {
    const tol = BORDER_PX / viewRef.current.zoom;
    let best: (BorderHit & { id: string; area: number }) | null = null;
    for (const n of docRef.current.nodes) {
      if (n.id === exclude || n.type === "nv-drawing") continue;
      const hit = borderHit(n, wx, wy, tol);
      if (!hit) continue;
      const area = n.width * n.height;
      const same = 2 / viewRef.current.zoom; // "about equally near": two screen pixels
      if (!best || hit.distance < best.distance - same || (Math.abs(hit.distance - best.distance) <= same && area < best.area)) {
        best = { ...hit, id: n.id, area };
      }
    }
    return best;
  };
  // Host size for viewport culling — updated on resize
  const [hostSize, setHostSize] = useState({ w: 1200, h: 800 });

  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);

  // ── coordinates ──────────────────────────────────────────────────────
  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(cx - r.left - v.x) / v.zoom, (cy - r.top - v.y) / v.zoom];
  }, []);

  const center = useCallback((): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }, [toWorld]);

  const fit = useCallback((nodes = docRef.current.nodes) => {
    const el = host.current;
    if (!el) return;
    const b = bounds(nodes);
    const { width, height } = el.getBoundingClientRect();
    if (!b) {
      setView({ x: width / 2, y: height / 2, zoom: 1 });
      return;
    }
    const zoom = Math.min(1.2, Math.max(MIN_ZOOM, Math.min((width - 120) / b.width, (height - 160) / b.height)));
    setView({ zoom, x: width / 2 - (b.x + b.width / 2) * zoom, y: height / 2 - (b.y + b.height / 2) * zoom });
  }, []);

  // New file → fresh selection, caches and a view that shows everything.
  useEffect(() => {
    setSel(new Set());
    setSelEdge(null);
    setEditing(null);
    forgetFileInfo();
    requestAnimationFrame(() => fit());
    host.current?.focus();
  }, [path, fit]);

  // Track host size for viewport culling
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHostSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0) setHostSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Wheel: moves up and down; Shift + wheel moves sideways; Ctrl/pinch: zoom around the pointer. Non-passive to stop
  // the page from scrolling.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A card being edited scrolls its own text; Ctrl + wheel still zooms the board.
      if ((e.target as Element).closest("textarea") || (!(e.ctrlKey || e.metaKey) && (e.target as Element).closest("[data-card-editor]"))) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
      else if (e.shiftKey) {
        // Chromium leaves the movement in deltaY when Shift is held; a touchpad may already send deltaX.
        const dx = e.deltaX || e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx }));
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ── document edits ───────────────────────────────────────────────────
  const addNode = useCallback((n: Omit<CNode, "id"> & { id?: string }, edit = false) => {
    const node = { ...n, id: n.id ?? newId(), x: snapTo(n.x, snap), y: snapTo(n.y, snap) } as CNode;
    const d = docRef.current;
    // Groups sit behind everything else.
    commit({ ...d, nodes: node.type === "group" ? [node, ...d.nodes] : [...d.nodes, node] });
    setSel(new Set([node.id]));
    setSelEdge(null);
    if (edit) setEditing(node.id);
    return node;
  }, [commit, snap]);

  const patchNodes = useCallback((ids: Set<string>, patch: Partial<CNode>) => {
    const d = docRef.current;
    commit({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, ...patch } : n)) });
  }, [commit]);

  const patchEdge = useCallback((id: string, patch: Partial<CEdge>) => {
    const d = docRef.current;
    commit({ ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }, [commit]);

  /** Asks for the text of an arrow (empty removes it). */
  const editEdgeLabel = useCallback(async (edge: CEdge) => {
    const label = await askText("Etiqueta de la flecha", edge.label ?? "", "Guardar");
    if (label !== null) patchEdge(edge.id, { label });
  }, [patchEdge]);

  const toggleGrid = useCallback(() => setShowGrid((v) => {
    localStorage.setItem("nv.canvas.grid", v ? "0" : "1");
    return !v;
  }), []);

  const deleteSelection = useCallback(() => {
    const d = docRef.current;
    if (selEdge) {
      commit({ ...d, edges: d.edges.filter((e) => e.id !== selEdge) });
      setSelEdge(null);
      return;
    }
    if (!sel.size) return;
    commit(pruneEdges({ ...d, nodes: d.nodes.filter((n) => !sel.has(n.id)) }));
    setSel(new Set());
  }, [commit, sel, selEdge]);

  const pasteDoc = useCallback((src: CanvasDoc, ids: Set<string>, dx: number, dy: number) => {
    const d = docRef.current;
    const copy = cloneNodes(src, ids, dx, dy);
    if (!copy.nodes.length) return;
    const groups = copy.nodes.filter((n) => n.type === "group");
    const rest = copy.nodes.filter((n) => n.type !== "group");
    commit({ nodes: [...groups, ...d.nodes, ...rest], edges: [...d.edges, ...copy.edges] });
    setSel(new Set(copy.nodes.map((n) => n.id)));
  }, [commit]);

  const groupSelection = useCallback(() => {
    const nodes = docRef.current.nodes.filter((n) => sel.has(n.id));
    const b = bounds(nodes);
    if (!b) {
      const [x, y] = center();
      addNode({ type: "group", x: x - 200, y: y - 150, width: 400, height: 300, label: "Grupo" });
      return;
    }
    addNode({ type: "group", x: b.x - 30, y: b.y - 30, width: b.width + 60, height: b.height + 60, label: "Grupo" });
  }, [sel, addNode, center]);

  const addText = useCallback((x?: number, y?: number) => {
    const [cx, cy] = x === undefined ? center() : [x, y!];
    addNode({ type: "text", x: cx - 125, y: cy - 40, width: 250, height: 80, text: "" }, true);
  }, [addNode, center]);

  const addShape = useCallback((kind: string) => {
    const s = SHAPES.find((x) => x.id === kind)!;
    const [x, y] = center();
    addNode({ type: "nv-shape", x: x - s.w / 2, y: y - s.h / 2, width: s.w, height: s.h, text: s.name, nv: { shape: kind } }, true);
  }, [addNode, center]);

  const addLink = useCallback(async () => {
    const url = await askText("Dirección web (https://…)", "https://", "Añadir");
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) {
      useApp.getState().toast("error", "Solo enlaces http o https.");
      return;
    }
    const [x, y] = center();
    addNode({ type: "link", x: x - 150, y: y - 50, width: 300, height: 100, url: url.trim() });
  }, [addNode, center]);

  const addFile = useCallback((file: string, kind: "note" | "image" | "canvas") => {
    const [x, y] = center();
    const [w, h] = kind === "image" ? [320, 240] : kind === "canvas" ? [260, 140] : [360, 300];
    addNode({ type: "file", x: x - w / 2, y: y - h / 2, width: w, height: h, file });
  }, [addNode, center]);

  const openFile = useCallback((file: string) => {
    const s = useApp.getState();
    if (/\.canvas$/i.test(file)) s.openTab({ kind: "canvas", path: file }, { preview: true });
    else if (/\.(md|py|js|ts|txt)$/i.test(file) || !file.includes(".")) void s.openNote(file);
    else void api.revealInOs(file).catch((e: Error) => s.toast("error", e.message));
  }, []);

  const onEditDone = useCallback((id: string, text: string | null) => {
    setEditing(null);
    host.current?.focus();
    if (text === null) return;
    const n = docRef.current.nodes.find((x) => x.id === id);
    if (!n) return;
    const key = n.type === "group" ? "label" : "text";
    if ((n[key] ?? "") !== text) patchNodes(new Set([id]), { [key]: text });
  }, [patchNodes]);

  // ── pointer interactions ─────────────────────────────────────────────
  /**
   * The card element under a target, EXCEPT a group's empty interior: that is the board. Grabbing the inside of a group used to
   * move the whole group (a big group is mostly interior), so now the interior pans, box-selects and creates cards like the
   * rest of the board, and a group is moved by its label (or resized by its outline).
   */
  const cardElOf = (target: Element): Element | null => {
    const el = target.closest("[data-node-id]");
    if (!el) return null;
    const n = byId.get(el.getAttribute("data-node-id")!);
    if (n?.type === "group" && !target.closest("[data-group-label],[data-port],[data-resize]")) return null;
    return el;
  };

  /** Starts moving `id` and everything selected with it; moving a group carries the cards inside it. */
  const beginMove = (e: React.PointerEvent, id: string, wx: number, wy: number) => {
    setSelEdge(null);
    let next = sel;
    if (e.shiftKey) {
      next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else if (!sel.has(id)) next = new Set([id]);
    setSel(next);
    const start = new Map<string, [number, number]>();
    for (const n of doc.nodes) {
      if (next.has(n.id)) start.set(n.id, [n.x, n.y]);
    }
    for (const g of doc.nodes.filter((n) => next.has(n.id) && n.type === "group")) {
      for (const n of doc.nodes) if (n.id !== g.id && contains(g, n)) start.set(n.id, [n.x, n.y]);
    }
    startDrag(e, { kind: "move", sx: wx, sy: wy, anchor: id, start, moved: false });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // The view moves with the middle button, Alt + drag, or Space + drag. A plain drag on the board selects (see below).
    if (e.button === 1 || (e.button === 0 && (e.altKey || spaceRef.current))) {
      startDrag(e, { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if (e.button !== 0) return;
    setMarquee(false);
    const t = e.target as Element;
    if (t.closest("[data-canvas-ui]")) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (drawMode) {
      startDrag(e, { kind: "draw", points: [[wx, wy]] });
      return;
    }
    const edgeEl = t.closest("[data-edge-id]");
    if (edgeEl) {
      setSelEdge(edgeEl.getAttribute("data-edge-id"));
      setSel(new Set());
      return;
    }
    // The WHOLE outline of a card is a resize handle, wherever along it the pointer is: a drag from a side stretches that side,
    // from near a corner both. The outline of a GROUP is how you grab it: it moves the group (with what it holds); its handles
    // resize it. The round ports connect, and Ctrl + drag from any outline connects from exactly that point. A card being edited
    // keeps its text.
    if (!t.closest("[data-port],[data-resize]")) {
      const hit = hitBorder(wx, wy);
      const target = hit ? byId.get(hit.id) : undefined;
      if (hit && target && editing !== hit.id) {
        setHoverBorder(null);
        if (e.ctrlKey || e.metaKey) {
          startDrag(e, { kind: "connect", from: hit.id, side: hit.side, t: hit.t, ox: wx, oy: wy, x: wx, y: wy });
          return;
        }
        // The whole outline stretches the card, a group included: a group is moved from inside it once selected (below).
        const handle = resizeHandleAt(target, hit, CORNER_PX / viewRef.current.zoom);
        if (!sel.has(hit.id)) {
          setSel(new Set([hit.id]));
          setSelEdge(null);
        }
        snapshot();
        startDrag(e, { kind: "resize", id: hit.id, sx: wx, sy: wy, w: target.width, h: target.height, x: target.x, y: target.y, handle });
        return;
      }
    }
    const nodeEl = cardElOf(t);
    if (!nodeEl) {
      // The inside of a group that is already selected moves it (with what it holds): press its outline to select it, then drag inside.
      const held = doc.nodes
        .filter((n) => n.type === "group" && sel.has(n.id) && wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
      if (held && !e.shiftKey) {
        beginMove(e, held.id, wx, wy);
        return;
      }
      // The default tool selects: a drag on the board (or inside a group) draws a selection box; Shift adds to the selection.
      setSelEdge(null);
      if (!e.shiftKey) setSel(new Set());
      startDrag(e, { kind: "box", x0: wx, y0: wy, x: wx, y: wy, add: e.shiftKey });
      return;
    }
    const id = nodeEl.getAttribute("data-node-id")!;
    if (editing === id) return;
    const port = t.closest("[data-port]");
    if (port) {
      startDrag(e, { kind: "connect", from: id, side: port.getAttribute("data-port") as Side, t: 0.5, ox: wx, oy: wy, x: wx, y: wy });
      return;
    }
    if (t.closest("[data-resize]")) {
      const n = byId.get(id)!;
      const handle = (t as Element).getAttribute("data-resize") ?? "se";
      snapshot();
      startDrag(e, { kind: "resize", id, sx: wx, sy: wy, w: n.width, h: n.height, x: n.x, y: n.y, handle });
      return;
    }
    beginMove(e, id, wx, wy);
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    host.current?.setPointerCapture(e.pointerId);
    setDrag(d);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    // The button (or the pen tip) is already up but its "up" never reached us: end the gesture instead of drawing on.
    if (d && e.buttons === 0 && e.pointerType !== "touch") {
      onPointerUp(e);
      return;
    }
    if (!d) {
      if (e.buttons === 0 && !drawMode) {
        const [hx, hy] = toWorld(e.clientX, e.clientY);
        const onUi = (e.target as Element).closest("[data-canvas-ui],[data-port],[data-resize],[data-edge-id]");
        const hit = onUi || spaceRef.current ? null : hitBorder(hx, hy);
        const node = hit ? byId.get(hit.id) : undefined;
        const handle = hit && node ? resizeHandleAt(node, hit, CORNER_PX / viewRef.current.zoom) : null;
        const move = false;
        setHoverBorder((prev) => {
          if (!hit || !handle) return prev ? null : prev;
          return prev && prev.id === hit.id && prev.handle === handle && prev.move === move ? prev : { id: hit.id, handle, move };
        });
      }
      return;
    }
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (d.kind === "move") {
      const dx = wx - d.sx;
      const dy = wy - d.sy;
      if (!d.moved) {
        if (Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
        snapshot();
        d.moved = true;
      }
      const cur = docRef.current;
      // The dragged card lands on the grid and the others keep their place relative to it.
      const anchor = d.start.get(d.anchor) ?? [...d.start.values()][0] ?? [0, 0];
      const [mx, my] = snappedDelta(anchor, dx, dy, snap);
      commit({
        ...cur,
        nodes: cur.nodes.map((n) => {
          const s = d.start.get(n.id);
          return s ? { ...n, x: s[0] + mx, y: s[1] + my } : n;
        }),
      }, false);
    } else if (d.kind === "resize") {
      const cur = docRef.current;
      // The edges being dragged snap to the grid; the opposite ones do not move.
      const r = resizeRect({ x: d.x, y: d.y, width: d.w, height: d.h }, d.handle, wx - d.sx, wy - d.sy, snap);
      commit({
        ...cur,
        nodes: cur.nodes.map((n) => {
          if (n.id !== d.id) return n;
          if (n.type !== "nv-drawing") return { ...n, x: r.x, y: r.y, width: r.width, height: r.height };
          // A drawing scales its strokes with its box (their thickness stays).
          if (!strokeBase.current.has(d)) strokeBase.current.set(d, structuredClone(n.nv?.strokes ?? []));
          const base = strokeBase.current.get(d) as NonNullable<NonNullable<CNode["nv"]>["strokes"]>;
          const fx = r.width / d.w, fy = r.height / d.h;
          const strokes = base.map((s) => ({ ...s, points: s.points.map(([px, py]) => [Math.round(px * fx * 10) / 10, Math.round(py * fy * 10) / 10] as [number, number]) }));
          return { ...n, x: r.x, y: r.y, width: r.width, height: r.height, nv: { ...n.nv, strokes } };
        }),
      }, false);
    } else if (d.kind === "connect" || d.kind === "box") {
      setDrag({ ...d, x: wx, y: wy });
    } else if (d.kind === "draw") {
      const last = d.points[d.points.length - 1]!;
      if (Math.hypot(wx - last[0], wy - last[1]) * viewRef.current.zoom >= 2) {
        setDrag({ kind: "draw", points: [...d.points, [wx, wy]] });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    // Cleared at once: the same gesture can end through several events (up, cancel, lost capture) and must only count once.
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.kind === "connect") {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]");
      const toId = target?.getAttribute("data-node-id");
      const cur = docRef.current;
      const from = byId.get(d.from)!;
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      // A click on an outline (no drag) just selects the card, as a click on its body would.
      if (Math.hypot(wx - d.ox, wy - d.oy) * viewRef.current.zoom < 3) {
        setSelEdge(null);
        setSel(new Set([d.from]));
        return;
      }
      const [sx, sy] = portPoint(from, d.side, d.t);
      // Dropped on an outline: end exactly there. Dropped on a card's body: the side that faces where the line started.
      const end = hitBorder(wx, wy, d.from);
      if (end || (toId && toId !== d.from)) {
        const to = byId.get(end ? end.id : toId!)!;
        const nv = anchorExtras(d.t, end ? end.t : 0.5);
        const edge: CEdge = { id: newId(), fromNode: d.from, fromSide: d.side, toNode: to.id, toSide: end ? end.side : nearestSide(to, sx, sy), toEnd: "arrow", ...(nv ? { nv } : {}) };
        commit({ ...cur, edges: [...cur.edges, edge] });
        setSelEdge(edge.id);
        setSel(new Set());
      } else if (!toId && Math.hypot(wx - sx, wy - sy) > 40) {
        // Dropped on empty board: a new card there, already connected.
        const node: CNode = { id: newId(), type: "text", x: snapTo(wx - 125, snap), y: snapTo(wy - 40, snap), width: 250, height: 80, text: "" };
        const nv = anchorExtras(d.t, 0.5);
        const edge: CEdge = { id: newId(), fromNode: d.from, fromSide: d.side, toNode: node.id, toSide: nearestSide(node, sx, sy), toEnd: "arrow", ...(nv ? { nv } : {}) };
        commit({ nodes: [...cur.nodes, node], edges: [...cur.edges, edge] });
        setSel(new Set([node.id]));
        setEditing(node.id);
      }
    } else if (d.kind === "box") {
      const r: Rect = { x: Math.min(d.x0, d.x), y: Math.min(d.y0, d.y), width: Math.abs(d.x - d.x0), height: Math.abs(d.y - d.y0) };
      // A click on the board (no real box) selects nothing new; a box takes the cards it touches and the groups it fully holds.
      const real = r.width * viewRef.current.zoom >= 3 || r.height * viewRef.current.zoom >= 3;
      const hit = real ? docRef.current.nodes.filter((n) => (n.type === "group" ? contains(r, n) : intersects(r, n))).map((n) => n.id) : [];
      setSel(new Set([...(d.add ? sel : []), ...hit]));
      setMarquee(hit.length > 0);
    } else if (d.kind === "draw") {
      const node = drawingNode(d.points, pen.color, pen.width);
      if (node) {
        const cur = docRef.current;
        commit({ ...cur, nodes: [...cur.nodes, node] });
      }
    }
  };

  /**
   * A pen or a tablet may cancel the gesture (the system takes it for a scroll, or the pen leaves the sensing range) instead of
   * sending "up". A stroke already drawn is kept; anything else is simply dropped.
   */
  const onPointerCancel = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.kind === "draw") onPointerUp(e);
    else {
      dragRef.current = null;
      setDrag(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // The press that starts a drag captures the pointer on the board, so the browser reports the board as the target of the
    // double click even when it landed on a group's label. Resolve the element under the pointer instead.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = e.target === host.current && under && host.current?.contains(under) ? under : (e.target as Element);
    if (drawMode || target.closest("[data-canvas-ui]")) return;
    const edgeEl = target.closest("[data-edge-id]");
    if (edgeEl) {
      const found = docRef.current.edges.find((x) => x.id === edgeEl.getAttribute("data-edge-id"));
      if (found) {
        setSelEdge(found.id);
        setSel(new Set());
        void editEdgeLabel(found);
      }
      return;
    }
    const nodeEl = cardElOf(target);
    if (!nodeEl) {
      const [x, y] = toWorld(e.clientX, e.clientY);
      addText(x, y);
      return;
    }
    const n = byId.get(nodeEl.getAttribute("data-node-id")!);
    if (!n) return;
    if (n.type === "text" || n.type === "nv-shape" || n.type === "group") setEditing(n.id);
    else if (n.type === "file" && n.file) openFile(n.file);
    else if (n.type === "link" && n.url) void api.openExternal(n.url).catch(() => undefined);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const [x, y] = toWorld(e.clientX, e.clientY);
    const nodeEl = cardElOf(e.target as Element);
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id")!;
      if (!sel.has(id)) setSel(new Set([id]));
      const ids = sel.has(id) ? sel : new Set([id]);
      openMenu(e, [
        { label: "Duplicar", onSelect: () => pasteDoc(docRef.current, ids, 30, 30) },
        { label: "Alinear a la cuadrícula", onSelect: () => alignToGrid(ids) },
        { label: "Agrupar", onSelect: groupSelection },
        { label: "Grosor: Fino (1px)", onSelect: () => setThickness(ids, 1) },
        { label: "Grosor: Normal (2px)", onSelect: () => setThickness(ids, 2) },
        { label: "Grosor: Grueso (4px)", onSelect: () => setThickness(ids, 4) },
        { label: "Traer al frente", onSelect: () => reorder(ids, true) },
        { label: "Enviar atrás", onSelect: () => reorder(ids, false) },
        { label: "Eliminar", danger: true, icon: <Trash2 />, onSelect: () => {
          const d = docRef.current;
          commit(pruneEdges({ ...d, nodes: d.nodes.filter((n) => !ids.has(n.id)) }));
          setSel(new Set());
        } },
      ]);
      return;
    }
    openMenu(e, [
      { label: "Tarjeta de texto", icon: <StickyNote />, onSelect: () => addText(x, y) },
      { label: "Nota de la vault…", icon: <FileText />, onSelect: () => setPicker("note") },
      { label: "Imagen de la vault…", icon: <ImageIcon />, onSelect: () => setPicker("image") },
      { label: "Nuevo grupo vacío", icon: <SquareDashed />, onSelect: () => {
        addNode({ type: "group", x: x - 200, y: y - 150, width: 400, height: 300, label: "Grupo" });
      }},
      { label: "Pegar", onSelect: () => void paste() },
      { label: "Alinear todo a la cuadrícula", onSelect: () => alignToGrid(new Set(docRef.current.nodes.map((n) => n.id))) },
    ]);
  };

  /** Puts the four edges of the given cards on the grid (cards that were placed before, or by a generator, are often off it). */
  const alignToGrid = (ids: Set<string>) => {
    const d = docRef.current;
    commit({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) && n.type !== "nv-drawing" ? { ...n, ...snapRect(n) } : n)) });
  };

  const setThickness = (ids: Set<string>, borderWidth: number) => {
    const d = docRef.current;
    commit({
      ...d,
      nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, nv: { ...n.nv, borderWidth } } : n)),
    });
  };

  const reorder = (ids: Set<string>, front: boolean) => {
    const d = docRef.current;
    const picked = d.nodes.filter((n) => ids.has(n.id));
    const rest = d.nodes.filter((n) => !ids.has(n.id));
    commit({ ...d, nodes: front ? [...rest, ...picked] : [...picked, ...rest] });
  };

  const paste = async () => {
    if (clip.current) {
      pasteDoc(clip.current, new Set(clip.current.nodes.map((n) => n.id)), 40, 40);
      return;
    }
    const text = await readClipboard().catch(() => "");
    if (text.trim()) {
      const [x, y] = center();
      addNode({ type: "text", x: x - 150, y: y - 60, width: 300, height: 120, text });
    }
  };

  // ── keyboard ─────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || (e.target as Element).closest("input, textarea")) return;
    if (e.key === " ") {
      // Held, it turns a drag into moving the view; it must not click a focused button or scroll the page.
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) setSpaceHeld(true);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      f();
    };
    if (e.key === "Delete" || e.key === "Backspace") run(deleteSelection);
    else if (mod && k === "z" && !e.shiftKey) run(undo);
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) run(redo);
    else if (mod && k === "a") run(() => setSel(new Set(doc.nodes.map((n) => n.id))));
    else if (mod && k === "d") run(() => pasteDoc(doc, sel, 30, 30));
    else if (mod && k === "c") run(() => {
      clip.current = { nodes: doc.nodes.filter((n) => sel.has(n.id)), edges: doc.edges };
    });
    else if (mod && k === "v") run(() => void paste());
    else if (mod && k === "g") run(groupSelection);
    else if (mod && k === "0") run(() => fit());
    else if (mod && (k === "=" || k === "+")) run(() => zoomAt(1.2));
    else if (mod && k === "-") run(() => zoomAt(1 / 1.2));
    else if (mod) return;
    else if (e.key === "Escape") run(() => {
      setSel(new Set());
      setSelEdge(null);
      setDrawMode(false);
    });
    else if (e.key === "Enter" && sel.size === 1) run(() => setEditing([...sel][0]!));
    else if (k === "z") run(() => addText());
    else if (k === "x") run(() => setPicker("note"));
    else if (k === "c") run(() => setPicker("image"));
    else if (k === "v") run(() => { setDrawMode(false); host.current?.focus(); }); // the selector: cancels pen mode and any other tool
    else if (k === "g") run(toggleGrid);
    else if (k === "b") run(groupSelection);
    else if (k === "r") run(() => { setDrawMode((v) => !v); host.current?.focus(); }); // free drawing
    else if (k === "f") run(openShapes); // the shapes menu, the same one the toolbar button opens
    else if (k === "a") run(() => setPicker("canvas"));
    else if (k === "s") run(() => void addLink());
    else if (e.key.startsWith("Arrow") && sel.size) {
      run(() => {
        const step = e.shiftKey ? 50 : snap ? GRID : 5;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const d = docRef.current;
        commit({ ...d, nodes: d.nodes.map((n) => (sel.has(n.id) ? { ...n, x: snapTo(n.x + dx, snap && !e.shiftKey), y: snapTo(n.y + dy, snap && !e.shiftKey) } : n)) });
      });
    }
  };

  const shapesBtn = useRef<HTMLButtonElement>(null);
  /** Opens the shapes menu above the toolbar button (from the keyboard there is no click to place it). */
  const openShapes = () => {
    const r = shapesBtn.current?.getBoundingClientRect();
    const at = { clientX: r ? r.left : 200, clientY: r ? r.top : 200, preventDefault: () => undefined };
    openMenu(at, SHAPES.map((s) => ({ label: s.name, onSelect: () => addShape(s.id) })));
  };

  // ── render ───────────────────────────────────────────────────────────
  const edge = selEdge ? doc.edges.find((x) => x.id === selEdge) : undefined;
  const single = sel.size === 1 ? byId.get([...sel][0]!) : undefined;
  const gridSize = GRID * view.zoom;

  // Viewport culling: only the cards near the view are mounted (see
  // lib/canvasViewport.ts), so a large map does not parse every card on open.
  const viewport = visibleWorldRect(view, { w: hostSize.w, h: hostSize.h });
  const visible = useMemo(
    () => visibleCanvas(doc, viewport, sel),
    // `viewport` is a fresh object per render: compare its numbers instead.
    [doc, viewport.x, viewport.y, viewport.width, viewport.height, sel],
  );
  // Edge anchors resolved with guaranteed minimum separation margin along shared sides
  const resolvedAnchors = useMemo(
    () => resolveEdgeAnchors(doc.nodes, doc.edges),
    [doc.nodes, doc.edges],
  );
  // A group that contains another is its parent: it is drawn first, so the inner one stays on top and can be reached.
  const groups = useMemo(() => {
    const all = doc.nodes.filter((n) => n.type === "group");
    const depth = (g: CNode) => all.filter((o) => o.id !== g.id && contains(o, g)).length;
    return all.filter((g) => inViewport(g, viewport)).map((g) => ({ g, d: depth(g) })).sort((a, b) => a.d - b.d).map((x) => x.g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.nodes, viewport.x, viewport.y, viewport.width, viewport.height]);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-surface">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-line px-4">
        <LayoutDashboard size={15} className="text-warn" />
        <span className="truncate text-[13px] font-semibold text-text">{title}</span>
        <span className="truncate font-mono text-[10.5px] text-faint">{path}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">{doc.nodes.length} tarjetas · {Math.round(view.zoom * 100)}%</span>
        <span className={cn("text-[11px]", dirty ? "text-warn" : "text-mint")}>{dirty ? "Guardando…" : "Guardado"}</span>
        <button type="button" onClick={() => void useCanvas.getState().close()}
          className="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-hover hover:text-text">Cerrar</button>
      </div>
      {conflict && (
        <div className="pointer-events-auto absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2 text-[12.5px] text-text shadow-lg">
          El canvas cambió en disco (otra app lo editó).
          <button type="button" className="font-semibold text-accent-text" onClick={() => void useCanvas.getState().open(path)}>Recargar</button>
          <button type="button" className="font-semibold text-warn" onClick={() => void useCanvas.getState().save(true)}>Sobrescribir</button>
        </div>
      )}
      <div
        ref={host}
        tabIndex={0}
        role="application"
        aria-label="Canvas"
        className={cn("nv-canvas relative min-h-0 flex-1 touch-none overflow-hidden outline-none",
          drawMode ? "cursor-crosshair"
            : drag?.kind === "pan" ? "cursor-grabbing"
              : spaceHeld ? "cursor-grab"
                : drag?.kind === "resize" ? RESIZE_CURSOR[drag.handle as ResizeHandle] ?? "cursor-default"
                  : drag?.kind === "move" ? "cursor-move"
                    : hoverBorder && !drag ? (hoverBorder.move ? "cursor-move" : RESIZE_CURSOR[hoverBorder.handle])
                      : "cursor-default")}
        style={{
          backgroundImage: showGrid ? "radial-gradient(circle, var(--nv-line-strong) 1px, transparent 1.2px)" : "none",
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${gridBackgroundOffset(view.x, gridSize)}px ${gridBackgroundOffset(view.y, gridSize)}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={() => setHoverBorder(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (e.key === " ") setSpaceHeld(false); }}
        onBlur={() => setSpaceHeld(false)}
        data-dropzone
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const file = e.dataTransfer.getData(DRAG_MIME);
          if (!file) return;
          e.preventDefault();
          const [x, y] = toWorld(e.clientX, e.clientY);
          const image = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file);
          const [w, h] = image ? [320, 240] : /\.canvas$/i.test(file) ? [260, 140] : [360, 300];
          if (file === path) return;
          addNode({ type: "file", x: x - w / 2, y: y - h / 2, width: w, height: h, file });
        }}
      >
        <div className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {groups.map((n) => (
            <CanvasNodeView key={n.id} node={n} selected={sel.has(n.id)} boxed={marquee} editing={editing === n.id} onEditDone={onEditDone} />
          ))}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {visible.edges.map((e) => {
              const a = byId.get(e.fromNode);
              const b = byId.get(e.toNode);
              const anchors = resolvedAnchors.get(e.id);
              return a && b ? (
                <EdgeView
                  key={e.id}
                  edge={e}
                  a={a}
                  b={b}
                  selected={selEdge === e.id}
                  fromT={anchors?.fromT}
                  toT={anchors?.toT}
                />
              ) : null;
            })}
            {drag?.kind === "connect" && byId.get(drag.from) && (
              <line x1={portOf(byId.get(drag.from)!, drag.side, drag.t)[0]} y1={portOf(byId.get(drag.from)!, drag.side, drag.t)[1]}
                x2={drag.x} y2={drag.y} stroke="var(--nv-accent)" strokeWidth={2 / view.zoom} strokeDasharray="6 4" />
            )}
            {drag?.kind === "draw" && (
              <polyline points={drag.points.map((p) => p.join(",")).join(" ")} fill="none"
                stroke={colorOf(pen.color)} strokeWidth={pen.width} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {drag?.kind === "box" && (
              <rect x={Math.min(drag.x0, drag.x)} y={Math.min(drag.y0, drag.y)} width={Math.abs(drag.x - drag.x0)}
                height={Math.abs(drag.y - drag.y0)} fill="var(--nv-accent-soft)" stroke="var(--nv-accent)" strokeWidth={1 / view.zoom} />
            )}
          </svg>
          {visible.nodes.filter((n) => n.type !== "group").map((n) => (
            <CanvasNodeView key={n.id} node={n} selected={sel.has(n.id)} boxed={marquee} editing={editing === n.id} onEditDone={onEditDone} />
          ))}
        </div>

        {doc.nodes.length === 0 && !drawMode && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[13px] text-faint">
            <div>
              <p className="text-[15px] text-dim">Canvas vacío</p>
              <p className="mt-1">Doble clic para crear una tarjeta · Z texto · X nota · N dibujar · V seleccionar · G cuadrícula · Espacio + arrastrar mueve la vista</p>
            </div>
          </div>
        )}

        {editing && doc.nodes.find((n) => n.id === editing)?.type === "text" && (
          <div data-canvas-ui className="absolute left-1/2 top-3 z-30 max-w-[calc(100%-24px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong shadow-lg">
            <FormatBar floating />
          </div>
        )}

        {(sel.size > 0 || edge) && !(editing && single?.type === "text") && (
          <SelectionBar
            node={single}
            edge={edge}
            count={sel.size}
            onColor={(c) => (edge ? patchEdge(edge.id, { color: c }) : patchNodes(sel, { color: c }))}
            onDelete={deleteSelection}
            onEdit={single && ["text", "nv-shape", "group"].includes(single.type) ? () => setEditing(single.id) : undefined}
            onEdge={(p) => edge && patchEdge(edge.id, p)}
            onEdgeLabel={() => {
              if (edge) void editEdgeLabel(edge);
            }}
          />
        )}

        <Toolbar>
          <Tool title="Seleccionar (V) · Espacio + arrastrar mueve la vista" kbd="V" active={!drawMode} onClick={() => { setDrawMode(false); host.current?.focus(); }}><MousePointer2 size={16} /></Tool>
          <Tool title="Tarjeta de texto (Z)" kbd="Z" onClick={() => addText()}><StickyNote size={16} /></Tool>
          <Tool title="Nota de la vault (X)" kbd="X" onClick={() => setPicker("note")}><FileText size={16} /></Tool>
          <Tool title="Imagen de la vault (C)" kbd="C" onClick={() => setPicker("image")}><ImageIcon size={16} /></Tool>
          <Tool title="Canvas embebido (A)" onClick={() => setPicker("canvas")}><LayoutDashboard size={16} /></Tool>
          <Tool title="Enlace web (S)" kbd="S" onClick={() => void addLink()}><Link2 size={16} /></Tool>
          <Tool title="Forma de diagrama (F)" kbd="F" btnRef={shapesBtn} onClick={(e) => openMenu(e, SHAPES.map((s) => ({ label: s.name, onSelect: () => addShape(s.id) })))}>
            <Diamond size={16} />
          </Tool>
          <Tool title="Grupo (B / Ctrl+G)" kbd="B" onClick={groupSelection}><SquareDashed size={16} /></Tool>
          <Tool title="Dibujo libre (R)" kbd="R" active={drawMode} onClick={() => { setDrawMode((v) => !v); host.current?.focus(); }}><PenLine size={16} /></Tool>
          {drawMode && (
            <div className="flex items-center gap-1 px-1">
              {Object.keys(PRESET_COLORS).map((c) => (
                <button key={c} type="button" title="Color del lápiz" onClick={() => setPen((p) => ({ ...p, color: c }))}
                  className={cn("h-4 w-4 rounded-full", pen.color === c && "ring-2 ring-text ring-offset-1 ring-offset-card")}
                  style={{ background: PRESET_COLORS[c] }} />
              ))}
              <select value={pen.width} onChange={(e) => setPen((p) => ({ ...p, width: Number(e.target.value) }))}
                title="Grosor" className="ml-1 rounded border border-line bg-surface px-1 text-[11px] text-text">
                {[2, 3, 5, 8, 12].map((w) => <option key={w} value={w}>{w}px</option>)}
              </select>
            </div>
          )}
          <Sep />
          <Tool title="Cuadrícula (G)" kbd="G" active={showGrid} onClick={toggleGrid}><Grid3x3 size={16} /></Tool>
          <Tool title="Ajustar a la cuadrícula" active={snap} onClick={() => setSnap((v) => {
            localStorage.setItem("nv.canvas.snap", v ? "0" : "1");
            return !v;
          })}><Magnet size={16} /></Tool>
          <Tool title="Alejar (Ctrl+−)" onClick={() => zoomAt(1 / 1.2)}><Minus size={16} /></Tool>
          <Tool title="Acercar (Ctrl++)" onClick={() => zoomAt(1.2)}><Plus size={16} /></Tool>
          <Tool title="Ver todo (Ctrl+0)" onClick={() => fit()}><Maximize size={16} /></Tool>
          <Tool title="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 size={16} /></Tool>
          <Tool title="Rehacer (Ctrl+Y)" disabled={!canRedo} onClick={redo}><Redo2 size={16} /></Tool>
        </Toolbar>
      </div>

      {picker && (
        <PathPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            setPicker(null);
            if (picker === "canvas" && p === path) {
              useApp.getState().toast("info", "Un canvas no puede contenerse a sí mismo.");
              return;
            }
            addFile(p, picker);
            host.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function portOf(n: Rect, side: Side, t = 0.5): [number, number] {
  return portPoint(n, side, t);
}

const INWARD: Record<Side, [number, number]> = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };

function arrowHead(n: Rect, side: Side, size: number, t = 0.5): string {
  const [x, y] = portOf(n, side, t);
  const [dx, dy] = INWARD[side];
  // The tip touches the card; the base sits `size` outside it.
  const bx = x - dx * size;
  const by = y - dy * size;
  const px = -dy * size * 0.55;
  const py = dx * size * 0.55;
  return `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

function nodeSummary(n: CNode): string {
  if (n.type === "file" && n.file) return n.file.split("/").pop() ?? n.file;
  if (n.type === "text" && n.text) {
    const firstLine = n.text.trim().split("\n")[0] ?? "";
    return firstLine.slice(0, 30) || "Nota";
  }
  if (n.type === "link" && n.url) return n.url;
  if (n.type === "group" && n.label) return n.label;
  return n.type ?? "Nota";
}

function EdgeView({
  edge,
  a,
  b,
  selected,
  fromT: resolvedFromT,
  toT: resolvedToT,
}: {
  edge: CEdge;
  a: CNode;
  b: CNode;
  selected: boolean;
  fromT?: number;
  toT?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const fromT = resolvedFromT ?? edgeT(edge, "from");
  const toT = resolvedToT ?? edgeT(edge, "to");
  const { d, mid } = edgePath(a, edge.fromSide, b, edge.toSide, fromT, toT);
  const active = selected || hovered;
  const col = active ? "var(--nv-accent)" : colorOf(edge.color, "var(--nv-dim)");
  const dash = edge.nv?.style === "dashed" ? "8 6" : edge.nv?.style === "dotted" ? "2 5" : undefined;
  return (
    <g
      className="group cursor-pointer"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <path
        data-edge-id={edge.id}
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="pointer-events-auto cursor-pointer"
      >
        <title>{`${nodeSummary(a)} → ${nodeSummary(b)}`}</title>
      </path>
      <path d={d} fill="none" stroke={col} strokeWidth={active ? 3 : 2} strokeDasharray={dash} className="transition-colors" />
      {(edge.toEnd ?? "arrow") === "arrow" && (
        <polygon points={arrowHead(b, edge.toSide, 12, toT)} fill={col} className="transition-colors" />
      )}
      {edge.fromEnd === "arrow" && (
        <polygon points={arrowHead(a, edge.fromSide, 12, fromT)} fill={col} className="transition-colors" />
      )}
      {edge.label && (
        <foreignObject x={mid[0] - 90} y={mid[1] - 14} width={180} height={28} className="overflow-visible">
          <div data-edge-id={edge.id} title="Doble clic para editar" className="pointer-events-auto mx-auto w-fit max-w-[180px] cursor-pointer truncate rounded-md border border-line bg-card px-2 py-0.5 text-center text-[12px] text-text">
            {edge.label}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div data-canvas-ui className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line-strong bg-card p-1 shadow-xl">
      {children}
    </div>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}

function Tool({ title, kbd, onClick, children, active, disabled, btnRef }: {
  title: string; kbd?: string; onClick: (e: React.MouseEvent) => void; children: ReactNode; active?: boolean; disabled?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={btnRef} type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={cn("relative grid h-8 place-items-center rounded-lg px-1.5 transition-colors disabled:opacity-35 min-w-[2rem]",
        active ? "bg-accent-soft text-accent-text" : "text-dim hover:bg-hover hover:text-text")}>
      {children}
      {kbd && <span className="absolute bottom-0.5 right-0.5 font-mono text-[8px] opacity-50 leading-none">{kbd}</span>}
    </button>
  );
}

function SelectionBar({ node, edge, count, onColor, onDelete, onEdit, onEdge, onEdgeLabel }: {
  node?: CNode; edge?: CEdge; count: number;
  onColor: (c: string) => void; onDelete: () => void; onEdit?: () => void;
  onEdge: (p: Partial<CEdge>) => void; onEdgeLabel: () => void;
}) {
  const current = edge ? edge.color ?? "" : node?.color ?? "";
  return (
    <div data-canvas-ui className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-line-strong bg-card px-2 py-1 shadow-lg">
      <span className="px-1 text-[11.5px] text-faint">{edge ? "Flecha" : count > 1 ? `${count} tarjetas` : "Tarjeta"}</span>
      <button type="button" title="Sin color" onClick={() => onColor("")}
        className={cn("h-4 w-4 rounded-full border border-line-strong bg-surface", !current && "ring-2 ring-text ring-offset-1 ring-offset-card")} />
      {Object.entries(PRESET_COLORS).map(([k, c]) => (
        <button key={k} type="button" title="Color" onClick={() => onColor(k)}
          className={cn("h-4 w-4 rounded-full", current === k && "ring-2 ring-text ring-offset-1 ring-offset-card")} style={{ background: c }} />
      ))}
      <Sep />
      {edge && (
        <>
          <button type="button" title="Flecha en ambos extremos"
            onClick={() => onEdge({ fromEnd: edge.fromEnd === "arrow" ? "none" : "arrow" })}
            className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-text"><ArrowLeftRight size={14} /></button>
          <select value={edge.nv?.style ?? "solid"} title="Estilo de línea"
            onChange={(e) => onEdge({ nv: { ...edge.nv, style: e.target.value as "solid" } })}
            className="rounded border border-line bg-surface px-1 py-0.5 text-[11.5px] text-text">
            <option value="solid">Continua</option>
            <option value="dashed">Discontinua</option>
            <option value="dotted">Punteada</option>
          </select>
          <button type="button" onClick={onEdgeLabel} className="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-hover hover:text-text">Etiqueta</button>
        </>
      )}
      {onEdit && <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-hover hover:text-text">Editar</button>}
      <button type="button" title="Eliminar (Supr)" onClick={onDelete}
        className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-danger-soft hover:text-danger"><Trash2 size={14} /></button>
    </div>
  );
}
