import React, { memo, useState } from 'react';
import {
  TOOLBAR_CLEARANCE, locationLabel, lookupLabel, nodeIdOf, stripPua,
  type Lookup, type Neighbour, type RefGraphData, type RetrievalItem,
} from '../lib/utils';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';
import { ReferenceTree } from './ReferenceTree';

type CitationPaneProps = {
  citations: string[];
  retrieval: RetrievalItem[];
  /** Cross-references behind the reference list; the graph itself is backend-only. */
  graph: RefGraphData;
  /** How the passages were found; null before the first answer. */
  lookup: Lookup | null;
  /** Source numbers the answer cites, as in "[3]". */
  cited: number[];
  loading: boolean;
  /** Rightmost pane: keep the header clear of the floating toolbar. */
  toolbarInset: boolean;
};

const HIDE_SUPPORTING_KEY = 'xref.hideSupportingSources';

function readHideSupporting(): boolean {
  try {
    return window.localStorage.getItem(HIDE_SUPPORTING_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHideSupporting(hide: boolean) {
  try {
    window.localStorage.setItem(HIDE_SUPPORTING_KEY, String(hide));
  } catch {
    // Not remembered between sessions; the toggle still works.
  }
}

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

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

// The cards beneath the top one, each narrower and lower, fading with depth.
// On hover they fan out a little further.
const STACK_LAYERS = [
  { inset: 10, offset: 8, opacity: 0.85, fan: 'group-hover:translate-y-[3px]' },
  { inset: 20, offset: 16, opacity: 0.6, fan: 'group-hover:translate-y-[6px]' },
];

// Hidden supporting sources, drawn as a stack: the first one's heading on top,
// the edges of the others below it. Opens the stack when clicked.
function SupportingStack({ index, item, count, onOpen }: {
  index: number;
  item?: RetrievalItem;
  count: number;
  onOpen: () => void;
}) {
  const where = locationLabel(item);
  const layers = STACK_LAYERS.slice(0, Math.min(count - 1, STACK_LAYERS.length));

  let bottomSpace = 0;
  if (layers.length > 0) bottomSpace = layers[layers.length - 1].offset;

  let summary = 'Show this source';
  if (count > 1) summary = `Show all ${count} sources`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full text-left animate-in fade-in slide-in-from-top-2 duration-300"
      style={{ paddingBottom: bottomSpace }}
      title="Show supporting sources"
    >
      {/* Deepest first, so each card is drawn over the one beneath it. Each is
          the top card's size, moved down by its offset. */}
      {layers.slice().reverse().map(layer => (
        <div
          key={layer.offset}
          aria-hidden="true"
          className={`absolute rounded-xl border transition-transform duration-300 ease-out ${layer.fan}`}
          style={{
            left: layer.inset,
            right: layer.inset,
            top: layer.offset,
            bottom: bottomSpace - layer.offset,
            opacity: layer.opacity,
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--card-bg)',
          }}
        />
      ))}

      <div
        className="relative p-3 rounded-xl border transition-transform duration-300 ease-out group-hover:-translate-y-px"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--card-bg)',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)',
        }}
      >
        <p className="text-[12px] font-semibold uppercase tracking-wider min-w-0 truncate"
          style={{ color: 'var(--accent-color)' }}>
          Source {index + 1}
          {where && (
            <span
              className="ml-2 text-[13px] font-bold normal-case tracking-normal"
              style={{ color: 'var(--text-main)' }}
            >
              {where}
            </span>
          )}
        </p>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {summary}
        </p>
      </div>
    </button>
  );
}

// One passage. Its number stays the one the answer cites, wherever it is shown.
function SourceCard({ index, passage, item, graph, position }: {
  index: number;
  passage: string;
  /** Absent for documents indexed before structural metadata existed. */
  item?: RetrievalItem;
  graph: RefGraphData;
  position: number;
}) {
  const where = locationLabel(item);
  const cites = citesOf(graph, item);

  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 p-3 rounded-xl border"
      style={{
        animationDelay: `${position * 80}ms`,
        animationFillMode: 'both',
        borderColor: 'var(--border-color)',
        backgroundColor: 'var(--card-bg)',
      }}
    >
      <div className="mb-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider min-w-0 truncate"
          style={{ color: 'var(--accent-color)' }}>
          Source {index + 1}
          {where && (
            <span
              className="ml-2 text-[13px] font-bold normal-case tracking-normal"
              style={{ color: 'var(--text-main)' }}
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
}

function CitationPaneView({
  citations, retrieval, graph, lookup, cited, loading, toolbarInset,
}: CitationPaneProps) {
  const [hideSupporting, setHideSupporting] = useState(readHideSupporting);

  const toggleSupporting = () => {
    saveHideSupporting(!hideSupporting);
    setHideSupporting(!hideSupporting);
  };

  // While a new question runs, the previous provenance stays but recedes.
  let staleOpacity = 1;
  if (loading) staleOpacity = 0.4;

  let headerStyle: React.CSSProperties | undefined;
  if (toolbarInset) headerStyle = { paddingRight: TOOLBAR_CLEARANCE };

  // The passages the answer cites come first; the rest keep their order below.
  const used: number[] = [];
  for (const number of cited) {
    if (number >= 1 && number <= citations.length) used.push(number - 1);
  }
  const supporting: number[] = [];
  for (let index = 0; index < citations.length; index++) {
    if (!used.includes(index)) supporting.push(index);
  }
  const grouped = used.length > 0 && supporting.length > 0;

  let toggleLabel = 'Hide supporting sources';
  let chevron = <ChevronUpIcon />;
  if (hideSupporting) {
    toggleLabel = 'Show supporting sources';
    chevron = <ChevronDownIcon />;
  }

  const card = (index: number, position: number) => (
    <SourceCard
      key={index}
      index={index}
      passage={citations[index]}
      item={retrieval[index]}
      graph={graph}
      position={position}
    />
  );

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

      {/* Reaches into the pane's right padding, so the scrollbar sits beside the cards rather than over them. */}
      <div className="flex-1 overflow-auto min-h-0 -mr-4 pr-4">
        {citations.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Ask a question to see the passages used.
          </p>
        )}

        {citations.length > 0 && !grouped && (
          <div className="space-y-2">
            {citations.map((_, index) => card(index, index))}
          </div>
        )}

        {grouped && (
          <div className="space-y-2">
            <GroupLabel>Used in answer</GroupLabel>
            {used.map((index, position) => card(index, position))}

            <div className="flex items-center gap-1">
              <GroupLabel>Supporting sources ({supporting.length})</GroupLabel>
              <button
                type="button"
                onClick={toggleSupporting}
                className="rounded p-1 transition-all"
                style={{ color: 'var(--text-muted)' }}
                title={toggleLabel}
                aria-label={toggleLabel}
                aria-expanded={!hideSupporting}
              >
                {chevron}
              </button>
            </div>
            {!hideSupporting && supporting.map((index, position) => card(index, used.length + position))}
            {hideSupporting && (
              <SupportingStack
                index={supporting[0]}
                item={retrieval[supporting[0]]}
                count={supporting.length}
                onOpen={toggleSupporting}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-renders only when its citations change, not on every machine-stats poll.
export const CitationPane = memo(CitationPaneView);
