/** Room kept clear at the right of the rightmost pane's header, under the floating toolbar. */
export const TOOLBAR_CLEARANCE = 160;

/** One retrieved passage. Location fields are absent for documents indexed without structure. */
export type RetrievalItem = {
  source: string;
  score: number;
  page?: number;
  recital?: number;
  article?: number;
  chapter?: string;
  document?: string;
};

/** Provenance for a citation card: "p. 37 · recital 148". */
export function locationLabel(item?: RetrievalItem): string {
  if (!item) return '';
  const parts: string[] = [];
  if (item.page !== undefined) parts.push(`p. ${item.page}`);
  if (item.recital !== undefined) parts.push(`recital ${item.recital}`);
  if (item.article !== undefined) parts.push(`Article ${item.article}`);
  if (item.chapter) parts.push(`Ch. ${item.chapter}`);
  return parts.join(' · ');
}

export type Risk = { level: string; score: number; factors: { name: string; weight: number }[] };
export type Confidence = { level: string; score: number };
export type Usage = {
  prompt_tokens: number; completion_tokens: number;
  total_tokens: number; context_window: number;
};

/** retrieved: fetched for the question; internal: a cited provision in the document;
 *  external: another document; missing: a self-reference no passage resolves to. */
export type GraphNodeKind = 'retrieved' | 'internal' | 'external' | 'missing';

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

/** An arrow: `from` cites `to`. */
export type GraphEdge = {
  from: string;
  to: string;
  type: string;
};

export type RefGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export const EMPTY_GRAPH: RefGraphData = { nodes: [], edges: [] };

/** Everything the panes need to redisplay one answer without re-querying. */
export type Turn = {
  finding: string;
  mode: 'naive' | 'basic';  // a naive answer is the passages themselves, so its chat card shows one line
  citations: string[];
  retrieval: RetrievalItem[];
  graph: RefGraphData;
  risk: Risk;
  confidence: Confidence;
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
      `http://localhost:8000/document/${encodeURIComponent(name)}/stats`,
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
    res = await fetch('http://localhost:8000/documents');
  } catch {
    return null;
  }
  if (!res.ok) return [];

  const data: { name: string; chunks: number }[] = await res.json();
  return data.map(d => ({ id: d.name, name: d.name, chunks: d.chunks }));
}

/** Drop Private Use Area characters: PDF bullet glyphs (Symbol, Wingdings) that render as boxes. */
export function stripPua(text: string): string {
  return text.replace(/[-]/g, '');
}
