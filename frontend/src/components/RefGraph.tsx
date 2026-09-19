import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { stripPua, type GraphNode, type RefGraphData } from '../lib/utils';
import {
  ALPHA_MIN, NODE_H, bounds, boxWidth, createLayout, makeRoom, reheat, settle, shortLabel, step,
  type Layout, type LayoutNode,
} from '../lib/graphLayout';
import { routeEdges, type EdgeRoute } from '../lib/edgeRouting';
import { XIcon } from './Icons';

type RefGraphProps = {
  graph: RefGraphData;
};

type View = { x: number; y: number; k: number };
type Size = { w: number; h: number };

/* What the pointer is doing between press and release. */
type Drag =
  | {
    kind: 'node'; id: string; pointerId: number;
    startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean;
  }
  | {
    kind: 'pan'; pointerId: number;
    startX: number; startY: number; viewX: number; viewY: number; moved: boolean;
  };

const AMBER = '#f59e0b';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const MAX_FIT_ZOOM = 1.2;  // a small graph is framed, not blown up
const ZOOM_STEP = 1.3;
const FIT_PAD = 24;
const TOP_BAR = 44;        // kept clear for the legend and the controls
const CAMERA_EASE = 0.18;  // share of the remaining distance the camera covers per frame
const DRAG_SLOP = 4;       // pixels a press may wander and still count as a click

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* The view that shows the whole graph, centred under the control bar. */
function fitView(layout: Layout | null, size: Size): View | null {
  if (!layout || layout.nodes.length === 0 || size.w === 0 || size.h === 0) return null;
  const box = bounds(layout);
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const fit = Math.min(
    (size.w - FIT_PAD * 2) / width,
    (size.h - TOP_BAR - FIT_PAD * 2) / height,
    MAX_FIT_ZOOM,
  );
  const k = clamp(fit, MIN_ZOOM, MAX_ZOOM);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return { k, x: size.w / 2 - cx * k, y: TOP_BAR + (size.h - TOP_BAR) / 2 - cy * k };
}

type Look = { fill: string; stroke: string; text: string; dash: string; rx: number };

/* Shape carries the meaning: bubbles are text you can read here, rectangles
   are references the corpus cannot show. */
function lookFor(kind: GraphNode['kind']): Look {
  if (kind === 'retrieved') {
    return { fill: 'var(--accent-color)', stroke: 'var(--accent-color)', text: 'var(--accent-text)', dash: '', rx: NODE_H / 2 };
  }
  if (kind === 'internal') {
    return { fill: 'var(--card-bg)', stroke: 'var(--border-color)', text: 'var(--text-main)', dash: '', rx: NODE_H / 2 };
  }
  if (kind === 'external') {
    return { fill: 'var(--panel-bg)', stroke: 'var(--text-muted)', text: 'var(--text-main)', dash: '', rx: 3 };
  }
  return { fill: 'var(--panel-bg)', stroke: AMBER, text: AMBER, dash: '4 3', rx: 3 };
}

function kindText(kind: GraphNode['kind']): string {
  if (kind === 'retrieved') return 'Retrieved for this question.';
  if (kind === 'internal') return 'A provision in this document, cited by one above it.';
  if (kind === 'external') {
    return 'Another document, cited by name. It is not in your corpus, so its text cannot be shown.';
  }
  return 'Cited as part of this document, but no passage carries that label: a parsing gap, or a reference to something that does not exist.';
}

function Swatch({ kind, label }: { kind: GraphNode['kind']; label: string }) {
  const look = lookFor(kind);
  let rx = 1;
  if (look.rx > 3) rx = 4.5;

  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="10" aria-hidden="true">
        <rect
          x="0.5" y="0.5" width="17" height="9" rx={rx}
          style={{ fill: look.fill, stroke: look.stroke, strokeDasharray: look.dash }}
        />
      </svg>
      {label}
    </span>
  );
}

function ControlButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-6 min-w-6 rounded-md border px-1.5 text-[11px] font-medium leading-none"
      style={{
        borderColor: 'var(--border-color)',
        color: 'var(--text-main)',
        backgroundColor: 'color-mix(in srgb, var(--panel-bg) 85%, transparent)',
      }}
    >
      {children}
    </button>
  );
}

/* The neighbours of the selected box, as chips that take you to them. */
function NodeChips({ title, nodes, onPick }: { title: string; nodes: GraphNode[]; onPick: (id: string) => void }) {
  if (nodes.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {title}
      </span>
      {nodes.map(node => {
        const look = lookFor(node.kind);
        let color = 'var(--text-main)';
        let borderStyle = 'solid';
        if (node.kind === 'missing') {
          color = AMBER;
          borderStyle = 'dashed';
        }
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onPick(node.id)}
            className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{ borderColor: look.stroke, borderStyle, color }}
            title={`Show ${node.label} in the graph`}
          >
            {node.label}
          </button>
        );
      })}
    </div>
  );
}

function RefGraphView({ graph }: RefGraphProps) {
  const [showDeeper, setShowDeeper] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [arranged, setArranged] = useState(false);  // something was placed by hand
  const [, setFrame] = useState(0);

  // The layout and camera change every animation frame, so they live in refs;
  // `setFrame` is what asks React to draw the new positions.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const goalRef = useRef<View | null>(null);   // where the camera is gliding to
  const autoFitRef = useRef(true);             // keep framing the graph until the user takes the camera
  const dragRef = useRef<Drag | null>(null);
  const rafRef = useRef<number | null>(null);
  const placedRef = useRef<Set<string>>(new Set());  // boxes put in place by hand
  const graphRef = useRef<RefGraphData | null>(null);
  const routeCacheRef = useRef<{ key: string; edges: RefGraphData['edges']; routes: Map<string, EdgeRoute> } | null>(null);

  // Depth 2 can triple the number of boxes, so it is opt-in.
  let maxDepth = 1;
  if (showDeeper) maxDepth = 2;

  const visible = useMemo(() => graph.nodes.filter(n => n.depth <= maxDepth), [graph, maxDepth]);
  const edges = useMemo(() => {
    const ids = new Set(visible.map(n => n.id));
    return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  }, [graph, visible]);

  const redraw = useCallback(() => {
    setFrame(f => f + 1);
  }, []);

  /* One loop drives both the boxes gliding to their places and the camera.
     It stops itself once both have arrived, so an idle graph costs nothing. */
  const kick = useCallback(() => {
    if (rafRef.current !== null) return;

    const frame = () => {
      let busy = false;

      const layout = layoutRef.current;
      if (layout && layout.alpha >= ALPHA_MIN) {
        step(layout);
        busy = true;
      }

      if (autoFitRef.current) {
        goalRef.current = fitView(layout, sizeRef.current);
      }

      const goal = goalRef.current;
      if (goal) {
        const view = viewRef.current;
        const next = {
          x: view.x + (goal.x - view.x) * CAMERA_EASE,
          y: view.y + (goal.y - view.y) * CAMERA_EASE,
          k: view.k + (goal.k - view.k) * CAMERA_EASE,
        };
        const arrived = Math.abs(goal.x - next.x) < 0.5
          && Math.abs(goal.y - next.y) < 0.5
          && Math.abs(goal.k - next.k) < 0.001;
        if (arrived) {
          viewRef.current = goal;
          if (!autoFitRef.current) goalRef.current = null;
        } else {
          viewRef.current = next;
          busy = true;
        }
      }

      setFrame(f => f + 1);
      if (busy) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    sizeRef.current = { w: Math.round(rect.width), h: Math.round(rect.height) };
  }, []);

  /* Zoom about a point on screen, so what is under the cursor stays there. */
  const zoomBy = useCallback((factor: number, px: number, py: number, animate: boolean) => {
    let base = viewRef.current;
    if (animate && goalRef.current) base = goalRef.current;

    const k = clamp(base.k * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio = k / base.k;
    const next = { k, x: px - (px - base.x) * ratio, y: py - (py - base.y) * ratio };

    autoFitRef.current = false;
    if (animate) {
      goalRef.current = next;
      kick();
    } else {
      goalRef.current = null;
      viewRef.current = next;
      redraw();
    }
  }, [kick, redraw]);

  // Stop the loop when the pane goes away.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Follow the pane's size; while auto-framing, re-frame the graph to it.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      measure();
      if (autoFitRef.current) kick();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [measure, kick]);

  // A new question, or the depth toggle: rebuild the layout. Boxes already on
  // screen glide to their new places, and new ones grow out of whatever cites them.
  useEffect(() => {
    if (sizeRef.current.w === 0) measure();

    const previous = new Map<string, { x: number; y: number }>();
    const old = layoutRef.current;
    if (old) {
      for (const node of old.nodes) {
        previous.set(node.id, { x: node.x, y: node.y });
      }
    }

    // A different question starts from a clean slate; the depth toggle keeps
    // whatever was placed by hand.
    if (graphRef.current !== graph) {
      graphRef.current = graph;
      placedRef.current = new Set();
      setArranged(false);
    }

    // The rings are stretched to the pane's shape, so a wide pane is filled.
    const size = sizeRef.current;
    let aspect = 1.8;
    if (size.w > 0 && size.h > TOP_BAR) aspect = clamp(size.w / (size.h - TOP_BAR), 1, 2.4);

    const layout = createLayout(
      visible.map(n => ({ id: n.id, depth: n.depth, w: boxWidth(n.label) })),
      edges,
      previous,
      placedRef.current,
      aspect,
    );
    layoutRef.current = layout;
    autoFitRef.current = true;

    if (prefersReducedMotion()) {
      settle(layout, 600);
      const fitted = fitView(layout, sizeRef.current);
      if (fitted) viewRef.current = fitted;
      redraw();
      return;
    }

    // The first time, open already framed rather than sweeping in from a corner.
    if (previous.size === 0) {
      const fitted = fitView(layout, sizeRef.current);
      if (fitted) viewRef.current = fitted;
    }
    kick();
  }, [graph, visible, edges, measure, kick, redraw]);

  // React's own wheel handler is passive and cannot stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      const rect = svg.getBoundingClientRect();
      zoomBy(Math.exp(-delta * 0.0015), e.clientX - rect.left, e.clientY - rect.top, false);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const layoutNode = (id: string): LayoutNode | null => {
    const layout = layoutRef.current;
    if (!layout) return null;
    const index = layout.index.get(id);
    if (index === undefined) return null;
    return layout.nodes[index];
  };

  const toGraph = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    const view = viewRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  const toggle = (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
    } else {
      setSelectedId(id);
    }
  };

  /* Select a box and glide the camera to it -- used by the Cites and Cited by
     chips, so the graph can be walked from the card. */
  const focusNode = (id: string) => {
    const node = layoutNode(id);
    if (!node) return;
    const size = sizeRef.current;
    let k = viewRef.current.k;
    if (k < 0.9) k = 0.9;
    goalRef.current = { k, x: size.w / 2 - node.x * k, y: TOP_BAR + (size.h - TOP_BAR) * 0.3 - node.y * k };
    autoFitRef.current = false;
    setSelectedId(id);
    kick();
  };

  const fitNow = () => {
    autoFitRef.current = true;
    kick();
  };

  /* Undo the hand-made arrangement: every box is let go and glides back to
     its place in the layout. */
  const tidy = () => {
    placedRef.current = new Set();
    setArranged(false);
    const layout = layoutRef.current;
    if (!layout) return;
    for (const node of layout.nodes) node.pinned = false;
    reheat(layout, 0.6);
    autoFitRef.current = true;

    if (prefersReducedMotion()) {
      settle(layout, 600);
      const fitted = fitView(layout, sizeRef.current);
      if (fitted) viewRef.current = fitted;
      redraw();
      return;
    }
    kick();
  };

  const onNodePointerDown = (e: ReactPointerEvent<SVGGElement>, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = layoutNode(id);
    const svg = svgRef.current;
    if (!node || !svg) return;
    const at = toGraph(e.clientX, e.clientY);
    svg.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: 'node', id, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      offsetX: at.x - node.x, offsetY: at.y - node.y, moved: false,
    };
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    const view = viewRef.current;
    dragRef.current = {
      kind: 'pan', pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y, moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      drag.moved = true;
      if (drag.kind === 'pan') setPanning(true);
    }

    // Moving anything by hand takes the camera out of auto-framing.
    autoFitRef.current = false;
    goalRef.current = null;

    if (drag.kind === 'node') {
      const layout = layoutRef.current;
      const node = layoutNode(drag.id);
      if (!layout || !node) return;
      const at = toGraph(e.clientX, e.clientY);
      // Held by the pointer, the box follows it exactly. Anything it runs into
      // steps aside, and nothing else stirs: the layout is not woken.
      node.pinned = true;
      node.x = at.x - drag.offsetX;
      node.y = at.y - drag.offsetY;
      makeRoom(layout);
      redraw();
      return;
    }

    viewRef.current = { k: viewRef.current.k, x: drag.viewX + dx, y: drag.viewY + dy };
    redraw();
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setPanning(false);

    const svg = svgRef.current;
    if (svg && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);

    if (drag.kind === 'node') {
      // Dropped: it stays pinned where it was put, until Tidy or a new question.
      if (drag.moved) {
        placedRef.current.add(drag.id);
        setArranged(true);
      }
      if (!drag.moved && !cancelled) toggle(drag.id);
      return;
    }

    // A click on empty canvas closes the card.
    if (!drag.moved && !cancelled) setSelectedId(null);
  };

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(id);
    }
  };

  const onNodeFocus = (e: FocusEvent<SVGGElement>, id: string) => {
    // Show the ring for keyboard focus only, not after every click. An engine
    // that doesn't know :focus-visible throws, and then every focus gets it.
    let keyboard = true;
    try {
      keyboard = e.currentTarget.matches(':focus-visible');
    } catch {
      keyboard = true;
    }
    if (keyboard) setFocusedId(id);
  };

  const onWrapKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setSelectedId(null);
  };

  const layout = layoutRef.current;
  const view = viewRef.current;

  // Hovering previews a box's neighbourhood; selecting keeps it lit.
  const visibleIds = new Set(visible.map(n => n.id));
  let focusId: string | null = null;
  if (hoverId !== null && visibleIds.has(hoverId)) {
    focusId = hoverId;
  } else if (selectedId !== null && visibleIds.has(selectedId)) {
    focusId = selectedId;
  }

  const lit = new Set<string>();
  if (focusId !== null) {
    lit.add(focusId);
    for (const edge of edges) {
      if (edge.from === focusId) lit.add(edge.to);
      if (edge.to === focusId) lit.add(edge.from);
    }
  }

  let selected: GraphNode | null = null;
  for (const node of visible) {
    if (node.id === selectedId) selected = node;
  }

  const cites: GraphNode[] = [];
  const citedBy: GraphNode[] = [];
  if (selected) {
    const byId = new Map<string, GraphNode>();
    for (const node of visible) byId.set(node.id, node);
    for (const edge of edges) {
      if (edge.from === selected.id) {
        const target = byId.get(edge.to);
        if (target) cites.push(target);
      }
      if (edge.to === selected.id) {
        const source = byId.get(edge.from);
        if (source) citedBy.push(source);
      }
    }
  }

  // Arrow routing is the heaviest work here, so it reruns only when a box has
  // moved or the arrows changed, not on camera-only frames (pan, zoom, resize).
  let routes = new Map<string, EdgeRoute>();
  if (layout) {
    const key = layout.nodes.map(n => `${n.x.toFixed(1)},${n.y.toFixed(1)},${n.w}`).join(';');
    const cached = routeCacheRef.current;
    if (cached && cached.key === key && cached.edges === edges) {
      routes = cached.routes;
    } else {
      routes = routeEdges(layout.nodes, layout.index, edges);
      routeCacheRef.current = { key, edges, routes };
    }
  }

  const hidden = graph.nodes.length - visible.length;
  const hasDeeper = graph.nodes.some(n => n.depth > 1);
  let depthLabel = `Next step +${hidden}`;
  let depthTitle = 'Also show what the cited provisions cite';
  if (showDeeper) {
    depthLabel = 'Direct only';
    depthTitle = 'Show direct citations only';
  }

  let canvasClass = 'refgraph-canvas block';
  if (panning) canvasClass += ' is-panning';

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" onKeyDown={onWrapKey}>
      <svg
        ref={svgRef}
        className={canvasClass}
        width="100%"
        height="100%"
        role="group"
        aria-label={`Cross-references: ${visible.length} provisions, ${edges.length} citations`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => endDrag(e, false)}
        onPointerCancel={e => endDrag(e, true)}
      >
        <defs>
          {/* The dot grid moves with the camera, so panning reads as moving
              across a surface rather than shuffling boxes. */}
          <pattern
            id="refgraph-dots" width={22} height={22} patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}
          >
            <circle cx={1} cy={1} r={1} style={{ fill: 'var(--border-color)' }} />
          </pattern>
          <marker id="refgraph-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: 'var(--text-muted)' }} />
          </marker>
          <marker id="refgraph-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: 'var(--accent-color)' }} />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#refgraph-dots)" />

        {layout && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {edges.map(edge => {
              const key = `${edge.from}->${edge.to}`;
              const to = layoutNode(edge.to);
              const route = routes.get(key);
              if (!to || !route) return null;
              const touches = focusId !== null && (edge.from === focusId || edge.to === focusId);

              let stroke = 'var(--text-muted)';
              let opacity = 0.55;
              let marker = 'url(#refgraph-arrow)';
              let className = 'refgraph-edge';
              let dash: string | undefined;
              if (edge.type === 'missing') dash = '4 3';

              // With a box in focus its arrows light up and run; the rest recede.
              if (focusId !== null) {
                if (touches) {
                  stroke = 'var(--accent-color)';
                  opacity = 1;
                  marker = 'url(#refgraph-arrow-lit)';
                  className += ' refgraph-flow';
                  dash = undefined;
                } else {
                  opacity = 0.1;
                }
              }

              return (
                <g key={key} className="refgraph-edge-in" style={{ animationDelay: `${to.depth * 110 + 160}ms` }}>
                  <path
                    d={route.d}
                    fill="none"
                    className={className}
                    markerEnd={marker}
                    vectorEffect="non-scaling-stroke"
                    style={{ stroke, opacity, strokeWidth: 1.3, strokeDasharray: dash }}
                  />
                </g>
              );
            })}

            {visible.map(node => {
              const box = layoutNode(node.id);
              if (!box) return null;

              const look = lookFor(node.kind);

              let opacity = 1;
              if (focusId !== null && !lit.has(node.id)) opacity = 0.25;

              let stroke = look.stroke;
              let strokeWidth = 1;
              if (node.id === selectedId || node.id === focusedId) {
                stroke = 'var(--text-main)';
                strokeWidth = 2;
              }

              let weight = 500;
              if (node.kind === 'retrieved') weight = 600;

              return (
                <g
                  key={node.id}
                  transform={`translate(${box.x} ${box.y})`}
                  className="refgraph-node"
                  style={{ opacity }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label}. ${kindText(node.kind)}`}
                  aria-pressed={node.id === selectedId}
                  onPointerDown={e => onNodePointerDown(e, node.id)}
                  onPointerEnter={() => setHoverId(node.id)}
                  onPointerLeave={() => setHoverId(null)}
                  onKeyDown={e => onNodeKey(e, node.id)}
                  onFocus={e => onNodeFocus(e, node.id)}
                  onBlur={() => setFocusedId(null)}
                >
                  <title>{node.label}</title>
                  {/* Position lives on the outer group, so this inner one only
                      scales -- that is what lets it pop in from its own centre. */}
                  <g className="refgraph-pop" style={{ animationDelay: `${node.depth * 110}ms` }}>
                    <rect
                      x={-box.w / 2} y={-NODE_H / 2} width={box.w} height={NODE_H} rx={look.rx}
                      style={{ fill: look.fill, stroke, strokeWidth, strokeDasharray: look.dash }}
                    />
                    <text
                      x={0}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                      style={{ fill: look.text, fontWeight: weight, pointerEvents: 'none' }}
                    >
                      {shortLabel(node.label)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* The legend lets the pointer through, so a drag can start anywhere. */}
      <div
        className="pointer-events-none absolute left-3 top-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 pr-44 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        <Swatch kind="retrieved" label="Retrieved" />
        <Swatch kind="internal" label="Cited" />
        <Swatch kind="external" label="Other document" />
        <Swatch kind="missing" label="Not found" />
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1">
        {arranged && (
          <ControlButton title="Let the layout arrange every box again" onClick={tidy}>
            Tidy
          </ControlButton>
        )}
        {hasDeeper && (
          <ControlButton title={depthTitle} onClick={() => setShowDeeper(!showDeeper)}>
            {depthLabel}
          </ControlButton>
        )}
        <ControlButton
          title="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP, sizeRef.current.w / 2, sizeRef.current.h / 2, true)}
        >
          −
        </ControlButton>
        <ControlButton
          title="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP, sizeRef.current.w / 2, sizeRef.current.h / 2, true)}
        >
          +
        </ControlButton>
        <ControlButton title="Fit the whole graph in view" onClick={fitNow}>
          Fit
        </ControlButton>
      </div>

      {visible.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          These passages carry no structural labels (articles, sections, annexes), so there is nothing to link.
        </div>
      )}

      {visible.length > 0 && edges.length === 0 && (
        <p
          className="pointer-events-none absolute inset-x-6 bottom-10 text-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          No citations to draw. Either these passages cite nothing, or the document was indexed
          before the graph existed and needs re-uploading.
        </p>
      )}

      {selected && (
        <div
          className="absolute inset-x-3 bottom-3 max-h-[46%] overflow-auto rounded-xl border p-3 shadow-lg"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-[13px] font-semibold" style={{ color: 'var(--text-main)' }}>
                {selected.label}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {kindText(selected.kind)} <span className="opacity-70">· {selected.document}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="shrink-0 rounded p-0.5"
              style={{ color: 'var(--text-muted)' }}
              title="Close"
              aria-label="Close details"
            >
              <XIcon />
            </button>
          </div>

          {selected.preview && (
            <p
              className="mt-2 break-words text-[13px] leading-relaxed"
              style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}
            >
              {stripPua(selected.preview)}
            </p>
          )}

          <NodeChips title="Cites" nodes={cites} onPick={focusNode} />
          <NodeChips title="Cited by" nodes={citedBy} onPick={focusNode} />
        </div>
      )}

      {!selected && visible.length > 0 && (
        <p className="pointer-events-none absolute bottom-2 left-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Drag to pan · scroll to zoom · drag a box to place it · click one to read it
        </p>
      )}
    </div>
  );
}

// Re-renders only when its graph changes, not on every machine-stats poll.
export const RefGraph = memo(RefGraphView);
