import { useRef, useState } from 'react';
import type { RetrievalItem, Message, Turn, Lookup, Usage, Doc, RefGraphData } from './utils';
import { EMPTY_GRAPH, apiFetch, errorText, lookupLabel } from './utils';

const EMPTY_USAGE: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, context_window: 4096 };

const HELP_TEXT = [
  'find: initial capital — passages by keyword and meaning',
  'doc: celex — ask about one document, or "doc: all"',
  'Tab after a, para, p, sec, cha — article, paragraph, point, section, chapter',
  'clear — empty this conversation',
].join('\n');

export function useConversation(
  documents: Doc[],
  activeDoc: string | null,
  setActiveDoc: (name: string | null) => void,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<number | null>(null);

  const [citations, setCitations] = useState<string[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalItem[]>([]);
  const [graph, setGraph] = useState<RefGraphData>(EMPTY_GRAPH);
  const [lookup, setLookup] = useState<Lookup | null>(null);

  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);
  const [tokensBurned, setTokensBurned] = useState(0);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const nextId = useRef(0);
  const queryAbort = useRef<AbortController | null>(null);

  const addMessage = (message: Omit<Message, 'id'>): number => {
    nextId.current += 1;
    const id = nextId.current;
    setMessages(prev => [...prev, { ...message, id }]);
    return id;
  };

  const say = (text: string) => {
    addMessage({ role: 'assistant', content: text });
  };

  const showEvidence = (turn: Turn) => {
    setCitations(turn.citations);
    setRetrieval(turn.retrieval);
    setGraph(turn.graph);
    setLookup(turn.lookup);
    setUsage(turn.usage);
  };

  const clearEvidence = () => {
    setCitations([]);
    setRetrieval([]);
    setGraph(EMPTY_GRAPH);
    setLookup(null);
  };

  // Shows the evidence of an earlier answer again, without asking the backend.
  const restoreTurn = (message: Message) => {
    if (!message.turn || loading) return;
    showEvidence(message.turn);
    setLastMs(message.turn.ms);
    setActiveTurnId(message.id);
  };

  const cancelQuery = () => {
    if (queryAbort.current) queryAbort.current.abort();
  };

  // A lookup goes to /retrieve and returns passages without a generated answer.
  const sendPrompt = async (prompt: string, lookupOnly = false, label?: string) => {
    const started = performance.now();

    let shown = prompt;
    if (label) shown = label;

    let endpoint = '/query';
    let kind: Turn['kind'] = 'answer';
    if (lookupOnly) {
      endpoint = '/retrieve';
      kind = 'lookup';
    }

    addMessage({ role: 'user', content: shown });
    setLoading(true);

    const controller = new AbortController();
    queryAbort.current = controller;
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: prompt, source: activeDoc }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(await errorText(res));
      }
      const data = await res.json();

      let finding = data.finding;
      if (lookupOnly) {
        const count = (data.sources ?? []).length;
        finding = `${lookupLabel(data.lookup ?? null)} — ${count} passages in Citations.`;
      }

      let detail = '';
      if (typeof data.detail === 'string') detail = data.detail;

      const turn: Turn = {
        finding,
        detail,
        kind,
        citations: data.sources ?? [],
        retrieval: data.retrieval ?? [],
        graph: data.graph ?? EMPTY_GRAPH,
        lookup: data.lookup ?? null,
        usage: data.usage ?? EMPTY_USAGE,
        timings: data.timings ?? null,
        ms: performance.now() - started,
      };

      showEvidence(turn);
      setTokensBurned(total => total + (turn.usage.total_tokens ?? 0));
      const id = addMessage({ role: 'assistant', content: turn.finding, turn });
      setActiveTurnId(id);
    } catch (err) {
      let message = 'Unknown error';
      if (err instanceof Error) message = err.message;
      // A TypeError means fetch got no reply at all.
      if (err instanceof TypeError) message = 'Could not reach the backend. Restart xref-rag if this persists.';

      let bubble = `Error: ${message}`;
      if (controller.signal.aborted) bubble = 'Stopped. The backend may still be finishing this query.';

      clearEvidence();
      setUsage(EMPTY_USAGE);
      say(bubble);
    } finally {
      queryAbort.current = null;
      setLastMs(performance.now() - started);
      setLoading(false);
    }
  };

  const chooseDocument = (argument: string) => {
    if (argument === '' || argument.toLowerCase() === 'all') {
      setActiveDoc(null);
      say('Asking about all documents.');
      return;
    }
    const match = documents.find(d => d.name.toLowerCase().includes(argument.toLowerCase()));
    if (match) {
      setActiveDoc(match.name);
      say(`Asking about ${match.name}.`);
    } else {
      say(`No loaded document matches "${argument}".`);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setActiveTurnId(null);
    clearEvidence();
  };

  const runCommand = (name: string, argument: string, typed: string) => {
    if (name === 'find') {
      if (argument === '') {
        say('find: needs something to look for, e.g. "find: initial capital".');
        return;
      }
      sendPrompt(argument, true, typed);
    } else if (name === 'doc') {
      chooseDocument(argument);
    } else if (name === 'clear') {
      clearConversation();
    } else if (name === 'help') {
      say(HELP_TEXT);
    }
  };

  return {
    messages,
    loading,
    activeTurnId,
    citations,
    retrieval,
    graph,
    lookup,
    usage,
    tokensBurned,
    lastMs,
    sendPrompt,
    runCommand,
    restoreTurn,
    cancelQuery,
  };
}
