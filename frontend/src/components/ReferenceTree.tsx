import { useState } from 'react';
import { fetchNeighbours, fetchProvision, stripPua, type Neighbour } from '../lib/utils';

type ReferenceTreeProps = {
  document: string;
  references: Neighbour[];
  /** Nodes from the root down to here, so a provision cannot contain itself. */
  path: string[];
};

const MAX_ROWS = 12;

type PassageKind = 'heading' | 'paragraph' | 'point' | 'subpoint';

// "Article 12 Record-keeping": the provision's own title, read before its text.
const HEADING = /^(article|annex|section|chapter|part|title|recital|rule|clause|schedule)\s+[\dIVXLC]/i;
const HEADING_MAX_LENGTH = 160;
const LIST_MARKER = /^\(([a-z]{1,5})\)/;
const ROMAN = /^[ivx]+$/;

const PASSAGE_CLASS: Record<PassageKind, string> = {
  heading: 'text-[16px] font-semibold',
  paragraph: '',
  point: 'pl-5',
  subpoint: 'pl-10',
};

/* A lone (i), (v) or (x) is a point when it follows (h), (u) or (w), and a
   sub-point otherwise; longer roman markers are always sub-points. */
function isSubpoint(letters: string, lastPoint: string): boolean {
  if (!ROMAN.test(letters)) return false;
  if (letters.length > 1) return true;
  const previous = String.fromCharCode(letters.charCodeAt(0) - 1);
  return lastPoint !== previous;
}

/* How deep each passage sits in its provision, from the marker it opens with. */
function passageKinds(passages: string[]): PassageKind[] {
  const kinds: PassageKind[] = [];
  let lastPoint = '';

  passages.forEach((passage, index) => {
    const text = passage.trim();
    if (index === 0 && text.length <= HEADING_MAX_LENGTH && HEADING.test(text)) {
      kinds.push('heading');
      return;
    }

    const marker = LIST_MARKER.exec(text);
    if (marker === null) {
      kinds.push('paragraph');
      return;
    }

    const letters = marker[1];
    if (isSubpoint(letters, lastPoint)) {
      kinds.push('subpoint');
      return;
    }

    lastPoint = letters;
    kinds.push('point');
  });

  return kinds;
}

/* Why a row cannot be opened, or "" when it can. */
function closedNote(reference: Neighbour, path: string[]): string {
  if (reference.type === 'external') return 'other document';
  if (reference.type === 'missing') return 'not found';
  if (path.includes(reference.node)) return 'already above';
  return '';
}

function Row({ document, reference, path }: { document: string; reference: Neighbour; path: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string[] | null>(null);
  const [cites, setCites] = useState<Neighbour[]>([]);
  const [loading, setLoading] = useState(false);

  const note = closedNote(reference, path);

  const toggle = async () => {
    if (note !== '') return;
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    if (text !== null || loading) return;

    // Fetched once; collapsing keeps what was read.
    setLoading(true);
    const [passages, neighbours] = await Promise.all([
      fetchProvision(document, reference.node),
      fetchNeighbours(document, reference.node),
    ]);
    setText(passages ?? []);
    setCites(neighbours?.cites ?? []);
    setLoading(false);
  };

  let marker = '▸';
  if (open) marker = '▾';
  if (note !== '') marker = '·';

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        disabled={note !== ''}
        className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-[13px] disabled:cursor-default"
        style={{ color: 'var(--text-main)' }}
        title={reference.locator}
      >
        <span className="w-3 shrink-0 text-center" style={{ color: 'var(--text-muted)' }}>{marker}</span>
        <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{reference.index}.</span>
        <span className="min-w-0">{reference.label}</span>
        {reference.locator !== '' && (
          <span className="shrink-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>· {reference.locator}</span>
        )}
        {note !== '' && (
          <span className="shrink-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>({note})</span>
        )}
      </button>

      {open && (
        <div className="ml-4 border-l pl-3" style={{ borderColor: 'var(--border-color)' }}>
          {loading && (
            <p className="py-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>Reading…</p>
          )}

          {text !== null && text.length === 0 && !loading && (
            <p className="py-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              No text stored for this provision.
            </p>
          )}

          {text !== null && text.length > 0 && (
            <div
              className="space-y-1 py-1 text-[14px] leading-relaxed"
              style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}
            >
              {passageKinds(text).map((kind, n) => (
                <p key={n} className={PASSAGE_CLASS[kind]}>{stripPua(text[n])}</p>
              ))}
            </div>
          )}

          {cites.length > 0 && (
            <ReferenceTree document={document} references={cites} path={[...path, reference.node]} />
          )}
        </div>
      )}
    </li>
  );
}

/* A provision's references as a plain, indented list. Rows open in place, so a
   chain of citations stays on screen and can be read from top to bottom. */
export function ReferenceTree({ document, references, path }: ReferenceTreeProps) {
  const [all, setAll] = useState(false);

  if (references.length === 0) return null;

  let shown = references;
  if (!all) shown = references.slice(0, MAX_ROWS);
  const hidden = references.length - shown.length;

  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map(reference => (
        <Row key={`${reference.index}-${reference.node}`} document={document} reference={reference} path={path} />
      ))}

      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setAll(true)}
            className="px-1 py-0.5 text-[12px] underline"
            style={{ color: 'var(--text-muted)' }}
          >
            show {hidden} more
          </button>
        </li>
      )}
    </ul>
  );
}
