import { invoke } from '@tauri-apps/api/core';

/** Room kept clear at the right of the rightmost pane's header, under the floating toolbar. */
export const TOOLBAR_CLEARANCE = 160;

/* The backend's address. The desktop app reports it: the development server in
   a debug build, the bundled backend on a free port in a release. A plain
   browser (`npm run dev`) keeps the development server. */
let apiBase = 'http://127.0.0.1:8000';

export async function connectBackend(): Promise<void> {
  try {
    apiBase = await invoke<string>('backend_url');
  } catch {
    // Not inside the desktop app: keep the development address.
  }
}

/** Full URL of a backend endpoint: api('/documents'). */
export function api(path: string): string {
  return `${apiBase}${path}`;
}

export function backendAddress(): string {
  return apiBase;
}

/** True once the backend answers. */
export async function backendIsUp(): Promise<boolean> {
  try {
    const res = await fetch(api('/health'));
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /setup: whether the language model is ready, or what setting it up involves. */
export type SetupStatus = {
  state: 'ready' | 'starting' | 'missing' | 'working' | 'error';
  source: 'custom' | 'system' | 'bundled' | null;
  needs: ('runtime' | 'model')[];
  step: '' | 'download' | 'unpack' | 'start' | 'model';
  done: number;
  total: number;
  error: string;
  download_bytes: number;
  model: string;
  ollama_version: string;
  automatic: boolean;
  /** Where Ollama and the model go, and whether they can. */
  storage: StorageCheck;
  suggested_storage: string;
};

/** GET /setup/check: `problem` is empty when the folder can be used. */
export type StorageCheck = {
  folder: string;
  problem: string;
  free_bytes: number;
  needed_bytes: number;
};

/** Null while the backend cannot be reached. */
export async function checkStorage(folder: string): Promise<StorageCheck | null> {
  try {
    const res = await fetch(api(`/setup/check?folder=${encodeURIComponent(folder)}`));
    if (!res.ok) return null;
    return await res.json() as StorageCheck;
  } catch {
    return null;
  }
}

/** The message in a failed reply: FastAPI puts it in `detail`. */
export async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    if (body && typeof body.detail === 'string') return body.detail;
  } catch {
    // not JSON: show it as it is
  }
  return text;
}

/** Null while the backend cannot be reached. */
export async function fetchSetup(): Promise<SetupStatus | null> {
  try {
    const res = await fetch(api('/setup'));
    if (!res.ok) return null;
    return await res.json() as SetupStatus;
  } catch {
    return null;
  }
}

/** Starts the download in the backend, into `storage`; progress is read back
 *  with fetchSetup. Returns why it could not start, or '' when it did. */
export async function beginSetup(storage: string): Promise<string> {
  try {
    const res = await fetch(api('/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // An empty storage keeps the folder already chosen or suggested.
      body: JSON.stringify({ storage: storage || null }),
    });
    if (res.ok) return '';
    return await errorText(res);
  } catch {
    return `Could not reach the backend at ${backendAddress()}.`;
  }
}

/** One retrieved passage. Location fields are absent for documents indexed without structure. */
export type RetrievalItem = {
  source: string;
  page?: number;
  printed_page?: number;  // the number printed on the page, where the document has one
  recital?: number;
  article?: number | string;
  chapter?: string;
  section?: number | string;
  annex?: string;
  paragraph?: number;
  subparagraph?: number;  // text after a paragraph's list of points: 2 onwards
  point?: string;
  subpoint?: string;
  document?: string;
};

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

/** "second subparagraph", or "subparagraph 7" past the named ones. */
function subparagraphText(n: number): string {
  if (n < ORDINALS.length) return `${ORDINALS[n]} subparagraph`;
  return `subparagraph ${n}`;
}

/** Provenance for a citation card: "p. 97 · Article 66(2)(e)(iv)",
 *  "p. 118 · Article 101(1), second subparagraph". */
export function locationLabel(item?: RetrievalItem): string {
  if (!item) return '';

  const parts: string[] = [];
  // The number a reader sees on the page, not the PDF's own count.
  if (item.printed_page !== undefined) {
    parts.push(`p. ${item.printed_page}`);
  } else if (item.page !== undefined) {
    parts.push(`p. ${item.page}`);
  }
  if (item.recital !== undefined) parts.push(`recital ${item.recital}`);

  // Subdivisions read as one reference, the way a lawyer would write it.
  if (item.article !== undefined) {
    let reference = `Article ${item.article}`;
    if (item.paragraph !== undefined) reference += `(${item.paragraph})`;
    if (item.point !== undefined) reference += `(${item.point})`;
    if (item.subpoint !== undefined) reference += `(${item.subpoint})`;
    if (item.subparagraph !== undefined) reference += `, ${subparagraphText(item.subparagraph)}`;
    parts.push(reference);
  }

  if (item.annex) parts.push(`Annex ${item.annex}`);
  if (item.chapter) parts.push(`Ch. ${item.chapter}`);
  return parts.join(' · ');
}

// The units a graph node can be, most specific first (backend/graph/build.py).
const NODE_KINDS = ['recital', 'article', 'clause', 'rule', 'section',
  'annex', 'schedule', 'appendix', 'exhibit', 'chapter', 'part', 'title'] as const;

/** The graph node a passage belongs to: "EU-AI.pdf::article:66". Null without a label. */
export function nodeIdOf(item?: RetrievalItem): string | null {
  if (!item || !item.document) return null;

  const where = item as Record<string, unknown>;
  for (const kind of NODE_KINDS) {
    const value = where[kind];
    if (value !== undefined && value !== null) return `${item.document}::${kind}:${value}`;
  }
  return null;
}

/** How the passages were found: an exact lookup on a named provision, or the
 *  closest matches by similarity. `asked` is the subdivision the question named. */
export type Lookup = {
  exact: boolean;
  found: boolean;
  asked: { paragraph?: number; subparagraph?: number; point?: string; subpoint?: string };
};

/** "Exact match · Article 66, point d", or what went wrong with it. */
export function lookupLabel(lookup: Lookup | null): string {
  if (lookup === null) return '';

  const named: string[] = [];
  if (lookup.asked.paragraph !== undefined) named.push(`paragraph ${lookup.asked.paragraph}`);
  if (lookup.asked.subparagraph !== undefined) named.push(subparagraphText(lookup.asked.subparagraph));
  if (lookup.asked.point !== undefined) named.push(`point ${lookup.asked.point}`);
  if (lookup.asked.subpoint !== undefined) named.push(`point (${lookup.asked.subpoint})`);

  if (!lookup.exact) return 'Closest passages by keyword and meaning';
  if (named.length === 0) return 'Exact match on the provision named';
  if (lookup.found) return `Exact match · ${named.join(' · ')}`;
  return `${named.join(' · ')} not found in that provision`;
}

export type Usage = {
  prompt_tokens: number; completion_tokens: number;
  total_tokens: number; context_window: number;
};

/** retrieved: fetched for the question; internal: a cited provision in the document;
 *  external: another document; missing: a self-reference no passage resolves to. */
export type GraphNodeKind = 'retrieved' | 'internal' | 'external' | 'missing';

/** What a node's kind means, for the detail card. */
export function kindText(kind: GraphNodeKind): string {
  if (kind === 'retrieved') return 'Retrieved for this question.';
  if (kind === 'internal') return 'A provision in this document, cited by one above it.';
  if (kind === 'external') {
    return 'Another document, cited by name. It is not in your corpus, so its text cannot be shown.';
  }
  return 'Cited as part of this document, but no passage carries that label: a parsing gap, or a reference to something that does not exist.';
}

/** A box in the graph (backend/graph/neighbourhood.py). `depth` is its distance in arrows from a retrieved passage. */
export type GraphNode = {
  id: string;
  node: string;
  document: string;
  label: string;
  kind: GraphNodeKind;
  depth: number;
  preview?: string;
};

/** An arrow: `from` cites `to`. `index` numbers the references of one provision
 *  in reading order; `locator` is where in it the reference sits ("point e"). */
export type GraphEdge = {
  from: string;
  to: string;
  type: string;
  index?: number;
  locator?: string;
};

export type RefGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const EMPTY_GRAPH: RefGraphData = { nodes: [], edges: [] };

/** Everything the panes need to redisplay one answer without re-querying. */
export type Turn = {
  finding: string;
  /** Where in the document the answer comes from, citing passages as [n]. */
  detail: string;
  kind: 'answer' | 'lookup';  // a lookup (find:) retrieves without generating
  citations: string[];
  retrieval: RetrievalItem[];
  graph: RefGraphData;
  lookup: Lookup | null;
  usage: Usage;
  timings: { retrieval_ms: number; generation_ms: number } | null;
  ms: number;
};

export type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  turn?: Turn;  // only on answered turns, which makes the bubble clickable
};

/** GET /document/{name}/stats. The backend omits units a document doesn't have. */
export type DocStats = {
  chunks: number;
  pages?: number;
  articles?: number;
  recitals?: number;
  chapters?: number;
};

/** A loaded document. `indexing` is set while the backend is still processing it. */
export type Doc = {
  id: string;
  name: string;
  chunks: number;
  stats?: DocStats;
  indexing?: { estimateMs: number };
};

/** "144 pages · 113 articles" */
export function structuralSummary(stats: DocStats): string {
  const parts: string[] = [];

  if (stats.pages) parts.push(`${stats.pages} pages`);
  if (stats.chapters) parts.push(`${stats.chapters} chapters`);
  if (stats.articles) parts.push(`${stats.articles} articles`);
  if (stats.recitals) parts.push(`${stats.recitals} recitals`);

  return parts.join(' · ');
}

/** Null when the document is unknown or the call fails. */
export async function fetchDocStats(name: string): Promise<DocStats | null> {
  try {
    const res = await fetch(
      api(`/document/${encodeURIComponent(name)}/stats`),
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || typeof data.chunks !== 'number') return null;

    return data as DocStats;
  } catch {
    return null;
  }
}

/** Documents already in the index (GET /documents). Null when the backend can't be reached;
 *  an empty list when it answers without them. */
export async function fetchDocuments(): Promise<Doc[] | null> {
  let res: Response;
  try {
    res = await fetch(api('/documents'));
  } catch {
    return null;
  }
  if (!res.ok) return [];

  const data: { name: string; chunks: number }[] = await res.json();
  return data.map(d => ({ id: d.name, name: d.name, chunks: d.chunks }));
}

/** A provision's own text, in order (GET /document/{name}/provision).
 *  Null when the backend can't be reached or has no such endpoint yet. */
export async function fetchProvision(document: string, node: string): Promise<string[] | null> {
  const [kind, value] = node.split(':');
  if (!kind || value === undefined) return null;

  const path = api(`/document/${encodeURIComponent(document)}/provision`);
  const query = `?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`;

  try {
    const res = await fetch(path + query);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data as string[];
  } catch {
    return null;
  }
}

/** One reference of a provision, numbered in the order it appears in the text. */
export type Neighbour = {
  node: string;
  label: string;
  type: string;
  index: number;
  locator: string;
};

export type Neighbours = {
  node: string;
  label: string;
  cites: Neighbour[];
  cited_by: Neighbour[];
};

/** What a provision cites and what cites it (GET /document/{name}/neighbours). */
export async function fetchNeighbours(document: string, node: string): Promise<Neighbours | null> {
  const path = api(`/document/${encodeURIComponent(document)}/neighbours`);

  try {
    const res = await fetch(`${path}?node=${encodeURIComponent(node)}`);
    if (!res.ok) return null;
    return await res.json() as Neighbours;
  } catch {
    return null;
  }
}

/** Drop Private Use Area characters: PDF bullet glyphs (Symbol, Wingdings) that render as boxes. */
export function stripPua(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, '');
}
