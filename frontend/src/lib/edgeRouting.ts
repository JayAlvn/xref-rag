/* Arrow paths for the cross-reference graph (RefGraph.tsx): straight where possible, bent
   round boxes in the way, and ends meeting a box from one side spread along its border. */

import type { LayoutNode } from './graphLayout';

type Point = { x: number; y: number };

export type RouteEdge = { from: string; to: string };

/** One arrow's path: a quadratic curve, straight when its control point sits
 *  on the line between its ends. */
export type EdgeRoute = { start: Point; control: Point; end: Point; d: string };

const PAD_TAIL = 2;        // gap between a box and an arrow's tail
const PAD_HEAD = 3;        // room for the arrowhead at the box it points to
const BOW = 24;            // how far two arrows citing each other bow apart
const DETOURS = [34, 60, 90, 124, 160];  // sideways bulges tried, each on both sides
const SAMPLES = 16;        // pieces a curve is cut into when checked against boxes
const CLEARANCE = 6;       // boxes count this much larger, so arrows do not graze them
const FAN_ANGLE = (20 * Math.PI) / 180;  // ends arriving closer together than this...
const FAN_GAP = 9;         // ...are spread this many pixels apart along the border

type Route = { key: string; from: LayoutNode; to: LayoutNode; start: Point; control: Point; end: Point };
type End = { route: Route; head: boolean; angle: number };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/* Where a line leaving a box's centre in direction (dx, dy) crosses its edge. */
function borderPoint(node: LayoutNode, dx: number, dy: number, pad: number): Point {
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const scale = Math.min((node.w / 2 + pad) / Math.abs(dx), (node.h / 2 + pad) / Math.abs(dy));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

/* Does the segment a-b pass through the box, grown by `clearance`?
   (Liang-Barsky: clip the segment against each side in turn.) */
function crossesBox(a: Point, b: Point, box: LayoutNode, clearance: number): boolean {
  const x0 = box.x - box.w / 2 - clearance;
  const x1 = box.x + box.w / 2 + clearance;
  const y0 = box.y - box.h / 2 - clearance;
  const y1 = box.y + box.h / 2 + clearance;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function curvePoint(p0: Point, c: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
  };
}

/** How many boxes, other than `own`, a curve passes through. */
export function boxesCrossed(
  start: Point, control: Point, end: Point,
  boxes: LayoutNode[], own: LayoutNode[], clearance: number,
): number {
  // The curve never leaves the triangle of its three points, so a box clear
  // of that triangle's bounds is clear of the curve and needs no closer look.
  const minX = Math.min(start.x, control.x, end.x) - clearance;
  const maxX = Math.max(start.x, control.x, end.x) + clearance;
  const minY = Math.min(start.y, control.y, end.y) - clearance;
  const maxY = Math.max(start.y, control.y, end.y) + clearance;

  let hits = 0;
  for (const box of boxes) {
    if (own.includes(box)) continue;
    if (box.x + box.w / 2 < minX || box.x - box.w / 2 > maxX) continue;
    if (box.y + box.h / 2 < minY || box.y - box.h / 2 > maxY) continue;

    let prev = start;
    for (let s = 1; s <= SAMPLES; s++) {
      const next = curvePoint(start, control, end, s / SAMPLES);
      if (crossesBox(prev, next, box, clearance)) {
        hits += 1;
        break;
      }
      prev = next;
    }
  }
  return hits;
}

/* A candidate path for a -> b, bulging `offset` pixels to the arrow's left. */
function candidate(a: LayoutNode, b: LayoutNode, key: string, offset: number): Route {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  // A quadratic curve bulges half as far as its control point is moved.
  const control = {
    x: (a.x + b.x) / 2 - (dy / length) * offset * 2,
    y: (a.y + b.y) / 2 + (dx / length) * offset * 2,
  };
  return {
    key,
    from: a,
    to: b,
    start: borderPoint(a, control.x - a.x, control.y - a.y, PAD_TAIL),
    control,
    end: borderPoint(b, control.x - b.x, control.y - b.y, PAD_HEAD),
  };
}

/* The straightest path that clears every other box, else the one crossing fewest.
   Two provisions citing each other bow apart, each to its own left. */
function routeOne(a: LayoutNode, b: LayoutNode, key: string, twoWay: boolean, boxes: LayoutNode[]): Route {
  let base = 0;
  if (twoWay) base = BOW;
  const offsets = [base];
  for (const detour of DETOURS) {
    offsets.push(base + detour);
    if (!twoWay) offsets.push(base - detour);
  }

  let best = candidate(a, b, key, offsets[0]);
  let bestHits = boxesCrossed(best.start, best.control, best.end, boxes, [a, b], CLEARANCE);
  for (let i = 1; i < offsets.length && bestHits > 0; i++) {
    const route = candidate(a, b, key, offsets[i]);
    const hits = boxesCrossed(route.start, route.control, route.end, boxes, [a, b], CLEARANCE);
    if (hits < bestHits) {
      best = route;
      bestHits = hits;
    }
  }
  return best;
}

/* Spread one run of ends FAN_GAP apart along the side they meet, in arrival order. */
function spread(node: LayoutNode, run: End[]): void {
  if (run.length < 2) return;
  run.forEach((end, i) => {
    let pad = PAD_TAIL;
    if (end.head) pad = PAD_HEAD;
    const base = borderPoint(node, Math.cos(end.angle), Math.sin(end.angle), pad);
    const halfW = node.w / 2 + pad;
    const halfH = node.h / 2 + pad;
    const shift = (i - (run.length - 1) / 2) * FAN_GAP;

    let point = base;
    const onTopOrBottom = Math.abs(Math.abs(base.y - node.y) - halfH) < 0.5;
    if (onTopOrBottom) {
      let sign = 1;
      if (base.y > node.y) sign = -1;
      point = { x: clamp(base.x + shift * sign, node.x - halfW + 6, node.x + halfW - 6), y: base.y };
    } else {
      let sign = 1;
      if (base.x < node.x) sign = -1;
      point = { x: base.x, y: clamp(base.y + shift * sign, node.y - halfH + 3, node.y + halfH - 3) };
    }

    if (end.head) {
      end.route.end = point;
    } else {
      end.route.start = point;
    }
  });
}

/* Ends meeting a box from nearly the same direction are grouped into runs and spread. */
function fanEnds(routes: Route[]): void {
  const ends = new Map<LayoutNode, End[]>();
  const add = (node: LayoutNode, end: End) => {
    const list = ends.get(node);
    if (list) {
      list.push(end);
    } else {
      ends.set(node, [end]);
    }
  };
  for (const route of routes) {
    const { from, to, control } = route;
    add(from, { route, head: false, angle: Math.atan2(control.y - from.y, control.x - from.x) });
    add(to, { route, head: true, angle: Math.atan2(control.y - to.y, control.x - to.x) });
  }

  for (const [node, list] of ends) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.angle - q.angle);
    let run: End[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      if (list[i].angle - list[i - 1].angle < FAN_ANGLE) {
        run.push(list[i]);
      } else {
        spread(node, run);
        run = [list[i]];
      }
    }
    spread(node, run);
  }
}

/** A path for every arrow whose two boxes are in the layout, keyed "from->to". */
export function routeEdges(
  nodes: LayoutNode[],
  index: Map<string, number>,
  edges: RouteEdge[],
): Map<string, EdgeRoute> {
  const keys = new Set(edges.map(e => `${e.from}->${e.to}`));
  const routes: Route[] = [];
  for (const edge of edges) {
    const fi = index.get(edge.from);
    const ti = index.get(edge.to);
    if (fi === undefined || ti === undefined) continue;
    const key = `${edge.from}->${edge.to}`;
    routes.push(routeOne(nodes[fi], nodes[ti], key, keys.has(`${edge.to}->${edge.from}`), nodes));
  }
  fanEnds(routes);

  const result = new Map<string, EdgeRoute>();
  for (const r of routes) {
    result.set(r.key, {
      start: r.start,
      control: r.control,
      end: r.end,
      d: `M ${r.start.x} ${r.start.y} Q ${r.control.x} ${r.control.y} ${r.end.x} ${r.end.y}`,
    });
  }
  return result;
}
