/* Radial layout for the cross-reference graph (RefGraph.tsx). Retrieved passages sit at the
   centre and each further step on a wider ring. Boxes are dealt into evenly spaced slots,
   then pairs are swapped while that shortens or uncrosses the arrows. The only motion is
   each box gliding to its slot. */

export const NODE_H = 28;

const CHAR_W = 6.3;        // rough width of one 11px character
const LABEL_MAX = 26;      // longer labels are cut; the detail card shows them whole

const MIN_RADIUS = 150;    // the first ring round the centre is at least this tall (half-height)
const RING_GAP = 140;      // least distance between one ring and the next, where arrows run
const SEED_RADIUS = 50;    // several retrieved passages sit round a small ring at least this tall
const ALONG_GAP = 56;      // clear space between neighbours along the top and bottom of a ring...
const ACROSS_GAP = 34;     // ...and between neighbours stacked down its sides
const MAX_PER_LANE = 16;   // a ring holding more boxes than this staggers them,...
const LANE_GAP = 56;       // ...every other one this much further out
const SWAP_PASSES = 12;    // rounds of swapping boxes on a ring to tidy the arrows
const CROSSING_COST = 200; // a crossing counts as this many pixels of extra arrow
const GAP_X = 14;          // minimum clear space between two boxes
const GAP_Y = 10;
const EASE = 0.14;         // share of the remaining way a box glides each tick
const SETTLED = 0.5;       // a box this close to its slot has arrived
const ALPHA_DECAY = 0.03;
export const ALPHA_MIN = 0.01;
const DEFAULT_ASPECT = 1.8; // width to height of the rings when the pane's is not known

export type LayoutItem = { id: string; depth: number; w: number };
export type LayoutEdge = { from: string; to: string };

type Point = { x: number; y: number };

export type LayoutNode = {
  id: string;
  depth: number;
  w: number;
  h: number;
  x: number;        // centre of the box
  y: number;
  pinned: boolean;  // held by the pointer, or placed by hand: it does not glide
};

export type Layout = {
  nodes: LayoutNode[];
  targets: Point[];  // the slot each node glides to, index-parallel with nodes
  index: Map<string, number>;
  alpha: number;     // motion left: the component animates while this is at least ALPHA_MIN
};

type Link = { source: number; target: number };

/* One depth's ring: its members, its height (half the ellipse's height), and
   whether every other box sits on an outer lane. */
type Ring = { members: number[]; radius: number; stagger: boolean };

export function shortLabel(label: string): string {
  if (label.length <= LABEL_MAX) return label;
  return label.slice(0, LABEL_MAX - 1) + '…';
}

export function boxWidth(label: string): number {
  return Math.max(64, Math.round(shortLabel(label).length * CHAR_W) + 24);
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/* A ring per depth, innermost first, sized so its boxes fit with room between them:
   width for side-by-side boxes along the top, height for stacked ones down the sides. */
function ringsFor(items: LayoutItem[], aspect: number): Ring[] {
  const byDepth = new Map<number, number[]>();
  items.forEach((item, i) => {
    const list = byDepth.get(item.depth);
    if (list) {
      list.push(i);
    } else {
      byDepth.set(item.depth, [i]);
    }
  });

  const rings: Ring[] = [];
  let outermost = 0;
  [...byDepth.keys()].sort((a, b) => a - b).forEach((depth, r) => {
    const members = byDepth.get(depth) ?? [];
    const widest = Math.max(...members.map(i => items[i].w));
    const stagger = members.length > MAX_PER_LANE;
    const slotAngle = (2 * Math.PI) / members.length;

    let alongAngle = slotAngle;
    if (stagger) alongAngle = slotAngle * 2;
    let radius = Math.max(
      (widest + ALONG_GAP) / (aspect * alongAngle),
      (NODE_H + ACROSS_GAP) / slotAngle,
    );

    if (r === 0) {
      if (members.length === 1) {
        radius = 0;
      } else {
        radius = Math.max(radius, SEED_RADIUS);
      }
    } else {
      radius = Math.max(radius, MIN_RADIUS, outermost + RING_GAP);
    }

    rings.push({ members, radius, stagger });
    outermost = radius;
    if (stagger) outermost += LANE_GAP;
  });
  return rings;
}

/* Where slot k of a ring is: evenly round it, starting at the top. */
function slotPoint(ring: Ring, slot: number, aspect: number): Point {
  const angle = -Math.PI / 2 + (slot / ring.members.length) * 2 * Math.PI;
  let radius = ring.radius;
  if (ring.stagger && slot % 2 === 1) radius += LANE_GAP;
  return { x: Math.cos(angle) * radius * aspect, y: Math.sin(angle) * radius };
}

/* Each node's slot: dealt in order, then improved by swapping pairs on the same ring. */
function arrange(items: LayoutItem[], links: Link[], aspect: number): Point[] {
  const rings = ringsFor(items, aspect);
  const targets: Point[] = items.map(() => ({ x: 0, y: 0 }));
  for (const ring of rings) {
    ring.members.forEach((i, k) => {
      targets[i] = slotPoint(ring, k, aspect);
    });
  }

  const linksOf: number[][] = items.map(() => []);
  links.forEach((link, e) => {
    linksOf[link.source].push(e);
    linksOf[link.target].push(e);
  });

  // Arrows to the centre box are as long from any slot, so only their crossings count.
  const atCentre: boolean[] = items.map(() => false);
  if (rings[0].radius === 0) atCentre[rings[0].members[0]] = true;

  const crosses = (e: number, f: number): boolean => {
    const p = links[e];
    const q = links[f];
    if (p.source === q.source || p.source === q.target) return false;
    if (p.target === q.source || p.target === q.target) return false;
    return segmentsCross(targets[p.source], targets[p.target], targets[q.source], targets[q.target]);
  };

  // What the arrows of boxes a and b cost where they are now: their length,
  // plus CROSSING_COST for every arrow they cross.
  const costAround = (a: number, b: number): number => {
    const touching = new Set([...linksOf[a], ...linksOf[b]]);
    let total = 0;
    for (const e of touching) {
      const link = links[e];
      if (!atCentre[link.source] && !atCentre[link.target]) {
        const from = targets[link.source];
        const to = targets[link.target];
        total += Math.hypot(to.x - from.x, to.y - from.y);
      }
      for (let f = 0; f < links.length; f++) {
        if (f !== e && crosses(e, f)) total += CROSSING_COST;
      }
    }
    return total;
  };

  const swap = (a: number, b: number) => {
    const held = targets[a];
    targets[a] = targets[b];
    targets[b] = held;
  };

  for (let pass = 0; pass < SWAP_PASSES; pass++) {
    let improved = false;
    for (const ring of rings) {
      const members = ring.members;
      for (let p = 0; p < members.length; p++) {
        for (let q = p + 1; q < members.length; q++) {
          const a = members[p];
          const b = members[q];
          const before = costAround(a, b);
          swap(a, b);
          const after = costAround(a, b);
          if (after < before - 0.01) {
            improved = true;
          } else {
            swap(a, b);
          }
        }
      }
    }
    if (!improved) break;
  }
  return targets;
}

/* Do segments a-b and c-d cross? Each pair of ends must lie on opposite
   sides of the other segment. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (r.y - p.y) * (q.x - p.x) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/* Known nodes start where they were (hand-placed ones stay pinned); new ones start on
   whatever cites them and glide outwards. */
export function createLayout(
  items: LayoutItem[],
  edges: LayoutEdge[],
  previous: Map<string, { x: number; y: number }>,
  handPlaced: Set<string> = new Set(),
  aspect: number = DEFAULT_ASPECT,
): Layout {
  const index = new Map<string, number>();
  items.forEach((item, i) => index.set(item.id, i));

  const links: Link[] = [];
  for (const edge of edges) {
    const source = index.get(edge.from);
    const target = index.get(edge.to);
    if (source === undefined || target === undefined || source === target) continue;
    links.push({ source, target });
  }

  const nodes: LayoutNode[] = items.map(item => ({
    id: item.id, depth: item.depth, w: item.w, h: NODE_H, x: 0, y: 0, pinned: false,
  }));

  if (items.length === 0) {
    return { nodes, targets: [], index, alpha: 0 };
  }

  const targets = arrange(items, links, aspect);

  const citers: number[][] = items.map(() => []);
  for (const link of links) {
    citers[link.target].push(link.source);
  }

  const order = items.map((_, i) => i).sort((a, b) => items[a].depth - items[b].depth);
  const placed: boolean[] = items.map(() => false);
  for (const i of order) {
    const node = nodes[i];
    const before = previous.get(node.id);
    if (before) {
      node.x = before.x;
      node.y = before.y;
      if (handPlaced.has(node.id)) node.pinned = true;
    } else {
      const from = citers[i].filter(c => placed[c]);
      if (from.length > 0) {
        node.x = mean(from.map(c => nodes[c].x));
        node.y = mean(from.map(c => nodes[c].y));
      }
    }
    placed[i] = true;
  }

  return { nodes, targets, index, alpha: 1 };
}

/* Boxes are rectangles, so overlap is cleared on whichever axis needs the
   smaller move. A pinned box stays put and the other one gives way. */
function separate(nodes: LayoutNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.pinned && b.pinned) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const overlapX = (a.w + b.w) / 2 + GAP_X - Math.abs(dx);
      const overlapY = (a.h + b.h) / 2 + GAP_Y - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;

      let shareA = 0.5;
      let shareB = 0.5;
      if (a.pinned) {
        shareA = 0;
        shareB = 1;
      }
      if (b.pinned) {
        shareA = 1;
        shareB = 0;
      }

      if (overlapX < overlapY) {
        let sign = 1;
        if (dx < 0) sign = -1;
        if (dx === 0 && i % 2 === 1) sign = -1;
        a.x -= sign * overlapX * shareA;
        b.x += sign * overlapX * shareB;
      } else {
        let sign = 1;
        if (dy < 0) sign = -1;
        if (dy === 0 && i % 2 === 1) sign = -1;
        a.y -= sign * overlapY * shareA;
        b.y += sign * overlapY * shareB;
      }
    }
  }
}

/* One tick: each unpinned box covers a share of the way to its slot. Overlaps are
   cleared once all have arrived. */
export function step(layout: Layout): void {
  const { nodes, targets } = layout;
  let furthest = 0;
  nodes.forEach((node, i) => {
    if (node.pinned) return;
    const dx = targets[i].x - node.x;
    const dy = targets[i].y - node.y;
    furthest = Math.max(furthest, Math.hypot(dx, dy));
    node.x += dx * EASE;
    node.y += dy * EASE;
  });

  layout.alpha *= 1 - ALPHA_DECAY;
  if (furthest < SETTLED) layout.alpha = 0;

  if (layout.alpha < ALPHA_MIN) {
    nodes.forEach((node, i) => {
      if (node.pinned) return;
      node.x = targets[i].x;
      node.y = targets[i].y;
    });
    for (let pass = 0; pass < 20; pass++) {
      separate(nodes);
    }
  }
}

/* Run to rest without animating -- for reduced motion, and for tests. */
export function settle(layout: Layout, maxTicks: number): number {
  let ticks = 0;
  while (layout.alpha >= ALPHA_MIN && ticks < maxTicks) {
    step(layout);
    ticks += 1;
  }
  return ticks;
}

/* Push overlapping boxes apart without moving pinned ones; used while dragging a box. */
export function makeRoom(layout: Layout): void {
  for (let pass = 0; pass < 3; pass++) {
    separate(layout.nodes);
  }
}

/* Set the boxes gliding again, e.g. to send a hand-made arrangement back to
   the slots. */
export function reheat(layout: Layout, alpha: number): void {
  if (layout.alpha < alpha) layout.alpha = alpha;
}

/* The box round the graph both as it is and as it will be once every box
   has arrived, so the camera frames the finished picture from the start. */
export function bounds(layout: Layout): { minX: number; minY: number; maxX: number; maxY: number } {
  if (layout.nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  layout.nodes.forEach((node, i) => {
    const places: Point[] = [{ x: node.x, y: node.y }];
    if (!node.pinned) places.push(layout.targets[i]);
    for (const at of places) {
      minX = Math.min(minX, at.x - node.w / 2);
      maxX = Math.max(maxX, at.x + node.w / 2);
      minY = Math.min(minY, at.y - node.h / 2);
      maxY = Math.max(maxY, at.y + node.h / 2);
    }
  });
  return { minX, minY, maxX, maxY };
}
