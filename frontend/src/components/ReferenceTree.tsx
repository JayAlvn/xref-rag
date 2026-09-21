import { useState } from 'react';
import { fetchNeighbours, fetchProvision, stripPua, type Neighbour } from '../lib/utils';

type ReferenceTreeProps = {
  document: string;
  references: Neighbour[];
  /** Nodes from the root down to here, so a provision cannot contain itself. */
  path: string[];
};

const MAX_ROWS = 12;

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
              {text.map((passage, n) => (
                <p key={n}>{stripPua(passage)}</p>
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
