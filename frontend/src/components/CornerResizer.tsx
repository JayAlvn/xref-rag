import {
  useEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels';

type CornerResizerProps = {
  root: RefObject<HTMLDivElement | null>;
  mainGroup: RefObject<GroupImperativeHandle | null>;
  leftGroup: RefObject<GroupImperativeHandle | null>;
  leftPanel: RefObject<HTMLDivElement | null>;
  findingPanel: RefObject<HTMLDivElement | null>;
};

const GUTTER = 6;          // width of the gaps between panes (.panel-separator)
const SIZE = 16;           // the grip's own size
const KEY_STEP = 2;        // percent per arrow-key press
const MIN_COLUMN = 20;     // the left column keeps at least this share of the width
const MIN_NEIGHBOUR = 20;  // ...and never squeezes the chat below its minimum (App.tsx)
const MIN_ROW = 8;         // analysis and citations each keep at least this share

/* The layouts and pixel scale at the moment a drag starts. Every move is
   measured from here, not from the previous move, so rounding never adds up. */
type Snapshot = {
  main: Layout;
  left: Layout;
  pxPerPercentW: number;
  pxPerPercentH: number;
};

type Drag = Snapshot & { x: number; y: number };

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/* Move the left column's edge by dLeft percent and the analysis/citations
   gap by dFinding percent, starting from the given layouts. */
function applyMove(
  mainApi: GroupImperativeHandle,
  leftApi: GroupImperativeHandle,
  base: Snapshot,
  dLeft: number,
  dFinding: number,
): void {
  // The chat beside the column pays for its width; the context pane is left be.
  // With the chat hidden there is nothing to trade, so only the height moves.
  const leftStart = base.main.left ?? 0;
  const chatStart = base.main.chat ?? 0;
  let moved = 0;
  if (chatStart > 0) {
    moved = clamp(
      dLeft,
      Math.min(MIN_COLUMN, leftStart) - leftStart,
      Math.max(chatStart - MIN_NEIGHBOUR, 0),
    );
  }
  mainApi.setLayout({ ...base.main, left: leftStart + moved, chat: chatStart - moved });

  // A collapsed analysis pane may stay collapsed: its floor is wherever it is.
  const findingStart = base.left.finding ?? 0;
  const finding = clamp(
    findingStart + dFinding,
    Math.min(MIN_ROW, findingStart),
    Math.max(100 - MIN_ROW, findingStart),
  );
  // Built from the group's own layout: the library reads the values in panel
  // order, so the keys must stay in the order it gave them.
  leftApi.setLayout({ ...base.left, finding, citations: 100 - finding });
}

/* A grip where the analysis/citations gap meets the column edge: dragging it resizes both
   at once. It sits above the panes, so the panel library leaves its presses alone. */
export function CornerResizer({ root, mainGroup, leftGroup, leftPanel, findingPanel }: CornerResizerProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // Follow the corner: it moves whenever either pane changes size, whether
  // from this grip, a separator, a collapse, or the window.
  useEffect(() => {
    const rootEl = root.current;
    const leftEl = leftPanel.current;
    const findingEl = findingPanel.current;
    if (!rootEl || !leftEl || !findingEl) return;

    const place = () => {
      const r = rootEl.getBoundingClientRect();
      const l = leftEl.getBoundingClientRect();
      const f = findingEl.getBoundingClientRect();
      setPos({ x: l.right - r.left + GUTTER / 2, y: f.bottom - r.top + GUTTER / 2 });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(rootEl);
    observer.observe(leftEl);
    observer.observe(findingEl);
    return () => observer.disconnect();
  }, [root, leftPanel, findingPanel]);

  // Never leave the page stuck with the drag cursor.
  useEffect(() => {
    return () => document.body.classList.remove('is-resizing-diagonal');
  }, []);

  const snapshot = (): Snapshot | null => {
    const mainApi = mainGroup.current;
    const leftApi = leftGroup.current;
    const leftEl = leftPanel.current;
    const findingEl = findingPanel.current;
    if (!mainApi || !leftApi || !leftEl || !findingEl) return null;

    const main = mainApi.getLayout();
    const left = leftApi.getLayout();
    const leftShare = main.left ?? 0;
    const findingShare = left.finding ?? 0;
    if (leftShare <= 0 || findingShare <= 0) return null;

    return {
      main,
      left,
      pxPerPercentW: leftEl.getBoundingClientRect().width / leftShare,
      pxPerPercentH: findingEl.getBoundingClientRect().height / findingShare,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const base = snapshot();
    if (!base) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ...base, x: e.clientX, y: e.clientY };
    document.body.classList.add('is-resizing-diagonal');
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const mainApi = mainGroup.current;
    const leftApi = leftGroup.current;
    if (!drag || !mainApi || !leftApi) return;
    applyMove(
      mainApi,
      leftApi,
      drag,
      (e.clientX - drag.x) / drag.pxPerPercentW,
      (e.clientY - drag.y) / drag.pxPerPercentH,
    );
  };

  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove('is-resizing-diagonal');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Arrow keys do the same in steps: left/right for width, up/down for the gap.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let dLeft = 0;
    let dFinding = 0;
    if (e.key === 'ArrowLeft') dLeft = -KEY_STEP;
    if (e.key === 'ArrowRight') dLeft = KEY_STEP;
    if (e.key === 'ArrowUp') dFinding = -KEY_STEP;
    if (e.key === 'ArrowDown') dFinding = KEY_STEP;
    if (dLeft === 0 && dFinding === 0) return;

    const base = snapshot();
    const mainApi = mainGroup.current;
    const leftApi = leftGroup.current;
    if (!base || !mainApi || !leftApi) return;
    e.preventDefault();
    applyMove(mainApi, leftApi, base, dLeft, dFinding);
  };

  if (!pos) return null;

  // Draws nothing on purpose: the diagonal cursor is the only sign it is there.
  return (
    <button
      type="button"
      className="corner-resizer"
      style={{ left: pos.x - SIZE / 2, top: pos.y - SIZE / 2, width: SIZE, height: SIZE }}
      aria-label="Resize the analysis and citations panes"
      title="Drag to resize the analysis and citations panes together (arrow keys work too)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
