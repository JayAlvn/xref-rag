import { memo } from 'react';
import { locationLabel, stripPua, type RetrievalItem } from '../lib/utils';

type CitationPaneProps = {
  citations: string[];
  retrieval: RetrievalItem[];
};

function CitationPaneView({ citations, retrieval }: CitationPaneProps) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden p-5"
      style={{ backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' }}
    >
      <h3
        className="text-[11px] font-semibold tracking-widest uppercase mb-3 shrink-0"
        style={{ color: 'var(--text-muted)' }}
      >
        Retrieved Citations
      </h3>

      <div className="flex-1 overflow-auto min-h-0">
        {citations.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Ask a question to see the passages used.
          </p>
        )}

        {citations.length > 0 && (
          <div className="space-y-2">
            {citations.map((passage, idx) => {
              // Index-parallel with citations; absent for documents indexed
              // before structural metadata existed.
              const item = retrieval[idx];
              const where = locationLabel(item);
              let pct: number | null = null;
              if (item) pct = Math.round(item.score * 100);

              return (
                <div
                  key={idx}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300 p-3 rounded-xl border"
                  style={{
                    animationDelay: `${idx * 80}ms`,
                    animationFillMode: 'both',
                    borderColor: 'var(--border-color)',
                    backgroundColor: 'var(--card-bg)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider min-w-0 truncate"
                      style={{ color: 'var(--accent-color)' }}>
                      Source {idx + 1}
                      {where && (
                        <span
                          className="ml-2 font-medium normal-case tracking-normal"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {where}
                        </span>
                      )}
                    </p>
                    {pct !== null && (
                      <span
                        className="text-[11px] font-semibold tabular-nums shrink-0"
                        style={{ color: 'var(--text-muted)' }}
                        title="Retrieval relevance"
                      >
                        {pct}%
                      </span>
                    )}
                  </div>

                  {pct !== null && (
                    <div
                      className="h-1 w-full rounded-full overflow-hidden mb-2"
                      // Track is the border tone, not the panel: on a light theme a
                      // white track on a near-white card leaves a 0% bar invisible.
                      style={{ backgroundColor: 'var(--border-color)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: 'var(--accent-color)' }}
                      />
                    </div>
                  )}

                  <p
                    className="text-[13px] leading-relaxed break-words"
                    style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}
                  >
                    {stripPua(passage)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-renders only when its citations change, not on every machine-stats poll.
export const CitationPane = memo(CitationPaneView);
