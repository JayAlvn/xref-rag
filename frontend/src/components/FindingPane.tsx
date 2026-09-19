import type { CSSProperties } from 'react';
import { ChevronUpIcon, ChevronDownIcon } from './Icons';
import { RefGraph } from './RefGraph';
import { TOOLBAR_CLEARANCE, type Risk, type Confidence, type RefGraphData } from '../lib/utils';

type FindingPaneProps = {
  loading: boolean;
  mode: 'naive' | 'basic';
  risk: Risk;
  confidence: Confidence;
  graph: RefGraphData;
  accent: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Height to hold the pane at while it folds, so its content is clipped
   *  instead of squeezed; null when it is not folding. */
  pinHeight: number | null;
  /** Rightmost pane: keep the header's controls clear of the floating toolbar. */
  toolbarInset: boolean;
};

/* Colour by score, not by label -- red only when risk is genuinely high. */
function riskColor(score: number): string {
  if (score >= 65) return '#ef4444';
  if (score >= 35) return '#f59e0b';
  return '#22c55e';
}

/* Colour by score, not by label -- red only when confidence is genuinely low. */
function confidenceColor(score: number): string {
  if (score >= 65) return '#22c55e';
  if (score >= 35) return '#f59e0b';
  return '#ef4444';
}

type MeterProps = { label: string; score: number; level: string; color: string };

/* One measurement as a thin bar: the number and its band above, the fill below. */
function Meter({ label, score, level, color }: MeterProps) {
  const pct = Math.max(0, Math.min(100, score));

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          <span className="text-[13px] font-semibold" style={{ color }}>{score}</span>
          <span className="ml-1 uppercase tracking-wider">{level}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${score}, ${level}`}
        className="h-1.5 w-full overflow-hidden rounded-full"
        // Track is the border tone: on a light theme a card-coloured track
        // would vanish into the pane.
        style={{ backgroundColor: 'var(--border-color)' }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* Measurements and the cross-reference graph for the answer on show; its prose is in the chat. */
export function FindingPane({
  loading, mode, risk, confidence, graph, accent, collapsed, onToggleCollapse, pinHeight, toolbarInset,
}: FindingPaneProps) {
  // Confidence comes from retrieval, so every answered question has one. It is
  // empty only before the first question and after a failed one.
  const hasResult = confidence.level !== '';
  // Risk comes from the LLM, so naive answers carry none.
  const hasRisk = risk.level !== '';

  let collapseLabel = 'Collapse analysis';
  let chevron = <ChevronUpIcon />;
  if (collapsed) {
    collapseLabel = 'Expand analysis';
    chevron = <ChevronDownIcon />;
  }

  // While a new question runs, the previous numbers stay but recede.
  let staleOpacity = 1;
  if (loading) staleOpacity = 0.4;

  const rootStyle: CSSProperties = { backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' };
  if (pinHeight !== null) rootStyle.height = pinHeight;

  // The body stays mounted through a fold, so it slides out of view with the
  // pane instead of vanishing the moment the chevron is pressed.
  const showBody = !collapsed || pinHeight !== null;

  // Clear of the toolbar when this is the rightmost pane.
  let headerStyle: CSSProperties | undefined;
  if (toolbarInset) headerStyle = { paddingRight: TOOLBAR_CLEARANCE };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={rootStyle}>
      <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3" style={headerStyle}>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Analysis
        </h3>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: 'var(--card-bg)', color: accent, border: '1px solid var(--border-color)' }}
          >
            {mode}
          </span>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 transition-all"
            style={{ color: 'var(--text-muted)' }}
            title={collapseLabel}
            aria-label={collapseLabel}
            aria-expanded={!collapsed}
          >
            {chevron}
          </button>
        </div>
      </div>

      {showBody && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5" inert={collapsed}>
          {hasResult && (
            <div
              className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 transition-opacity"
              style={{ opacity: staleOpacity }}
            >
              {hasRisk && (
                <Meter label="Risk" score={risk.score} level={risk.level} color={riskColor(risk.score)} />
              )}
              {!hasRisk && (
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Risk
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Not scored in naive mode
                  </p>
                </div>
              )}

              <Meter
                label="Confidence"
                score={confidence.score}
                level={confidence.level}
                color={confidenceColor(confidence.score)}
              />

              {hasRisk && risk.factors.length > 0 && (
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {risk.factors.map((factor, i) => (
                    <span
                      key={i}
                      className="rounded-full border px-2 py-0.5"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                    >
                      {factor.name}{' '}
                      <span className="font-semibold tabular-nums" style={{ color: riskColor(risk.score) }}>
                        {factor.weight}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No frame of its own: the canvas runs to the pane's edges, and the
              pane's rounded border clips it. */}
          <div className="relative -mx-5 -mb-5 min-h-[120px] flex-1 overflow-hidden">
            {hasResult && <RefGraph graph={graph} />}

            {!hasResult && !loading && (
              <div
                className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                Ask a question to see its measurements, and how the passages it retrieves cite one another.
              </div>
            )}

            {loading && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, var(--panel-bg) 55%, transparent)' }}
              >
                <span
                  className="animate-pulse rounded-full border px-3 py-1 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-muted)' }}
                >
                  Searching…
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
