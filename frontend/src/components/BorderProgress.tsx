import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useProgressPhase } from '../lib/useProgressPhase';

/* Long enough for the closing stroke and fade in App.css (0.6s) to play out. */
const FINISH_MS = 650;

/* The line never trickles faster than this, however small the file. */
const MIN_TRICKLE_MS = 4000;

type BorderProgressProps = {
  loading: boolean;
  /** Rough length of the wait. It sets the pace of the line, never its end. */
  estimateMs: number;
  /** Corner radius the line follows, in pixels. */
  radius: number;
};

/* The outline as one path, starting mid-left so the line leaves flush with a straight edge. */
function outline(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    `M 0 ${h / 2}`,
    `V ${radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    `H ${w - radius}`,
    `A ${radius} ${radius} 0 0 1 ${w} ${radius}`,
    `V ${h - radius}`,
    `A ${radius} ${radius} 0 0 1 ${w - radius} ${h}`,
    `H ${radius}`,
    `A ${radius} ${radius} 0 0 1 0 ${h - radius}`,
    'Z',
  ].join(' ');
}

/* A line round a document card while it is indexed. It trickles on an estimate and closes
   the loop when indexing finishes; pathLength makes the perimeter 100 units. */
export function BorderProgress({ loading, estimateMs, radius }: BorderProgressProps) {
  const phase = useProgressPhase(loading, FINISH_MS);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [path, setPath] = useState('');

  // The outline is drawn in pixels, so it follows the card's size: the card
  // grows when its stats line arrives, and with the pane.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const trace = () => {
      const box = svg.getBoundingClientRect();
      setPath(outline(box.width, box.height, radius));
    };
    trace();
    const observer = new ResizeObserver(trace);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [radius]);

  // Twice the estimate: the ease-out has covered most of the way by the time
  // the estimate runs out, and crawls after that.
  const style = { '--trickle-ms': `${Math.max(MIN_TRICKLE_MS, estimateMs * 2)}ms` } as CSSProperties;

  return (
    <svg
      ref={svgRef}
      className={`border-progress border-progress--${phase}`}
      style={style}
      aria-hidden="true"
    >
      <path className="border-progress-line" d={path} pathLength={100} />
    </svg>
  );
}
