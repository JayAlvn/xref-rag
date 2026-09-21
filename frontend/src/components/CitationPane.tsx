import React, { memo } from 'react';
import {
  TOOLBAR_CLEARANCE, locationLabel, lookupLabel, nodeIdOf, stripPua,
  type Lookup, type Neighbour, type RefGraphData, type RetrievalItem,
} from '../lib/utils';
import { ReferenceTree } from './ReferenceTree';

type CitationPaneProps = {
  citations: string[];
  retrieval: RetrievalItem[];
  /** Cross-references behind the reference list; the graph itself is backend-only. */
  graph: RefGraphData;
  /** How the passages were found; null before the first answer. */
  lookup: Lookup | null;
  loading: boolean;
  /** Rightmost pane: keep the header clear of the floating toolbar. */
  toolbarInset: boolean;
};

/* What one passage's provision cites, in reading order, one row per target.
   Depth 1 arrives with the answer; deeper levels are fetched when a row opens. */
function citesOf(graph: RefGraphData, item?: RetrievalItem): Neighbour[] {
  const from = nodeIdOf(item);
  if (from === null) return [];

  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const mine = graph.edges.filter(e => e.from === from);
  mine.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const seen = new Set<string>();
  const references: Neighbour[] = [];
  for (const edge of mine) {
    if (seen.has(edge.to)) continue;
    seen.add(edge.to);

    const target = byId.get(edge.to);
    if (!target) continue;
    references.push({
      node: target.node,
      label: target.label,
      type: target.kind,
      index: references.length + 1,
      locator: edge.locator ?? '',
    });
  }

  return references;
}

function CitationPaneView({
  citations, retrieval, graph, lookup, loading, toolbarInset,
}: CitationPaneProps) {
  // While a new question runs, the previous provenance stays but recedes.
  let staleOpacity = 1;
  if (loading) staleOpacity = 0.4;

  let headerStyle: React.CSSProperties | undefined;
  if (toolbarInset) headerStyle = { paddingRight: TOOLBAR_CLEARANCE };

  return (
    <div
      className="flex h-full flex-col overflow-hidden p-5"
      style={{ backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' }}
    >
      <div className="mb-3 shrink-0" style={headerStyle}>
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-[12px] font-semibold tracking-widest uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            Retrieved Citations
          </h3>
        </div>

        {lookup !== null && (
          <p className="mt-1 text-[12px] transition-opacity" style={{ color: 'var(--text-muted)', opacity: staleOpacity }}>
            {lookupLabel(lookup)}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {citations.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
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
              const cites = citesOf(graph, item);

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
                  <div className="mb-2">
                    <p className="text-[12px] font-semibold uppercase tracking-wider min-w-0 truncate"
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
                  </div>

                  <p
                    className="text-[14px] leading-relaxed break-words"
                    style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}
                  >
                    {stripPua(passage)}
                  </p>

                  {cites.length > 0 && item?.document && (
                    <div className="mt-2">
                      <span
                        className="text-[12px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Cites
                      </span>
                      <ReferenceTree
                        document={item.document}
                        references={cites}
                        path={[nodeIdOf(item)?.split('::')[1] ?? '']}
                      />
                    </div>
                  )}
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
