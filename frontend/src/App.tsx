import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Group, Panel, Separator, type GroupImperativeHandle, type Layout } from 'react-resizable-panels';
import { THEMES, ThemeColors } from './lib/themes';
import type { RetrievalItem, Message, Turn, Lookup, Usage, Doc, RefGraphData } from './lib/utils';
import { EMPTY_GRAPH, api, errorText, fetchDocStats, fetchDocuments, lookupLabel } from './lib/utils';
import { useMachineStats } from './lib/useMachineStats';
import { MessageSquareIcon, PanelRightIcon } from './components/Icons';
import { CitationPane } from './components/CitationPane';
import { ChatPane } from './components/ChatPane';
import { ContextPane } from './components/ContextPane';
import { useFold } from './lib/useFold';
import './App.css';

const EMPTY_USAGE: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, context_window: 4096 };

/* Smallest shares of the window, in percent, for the citations column and the chat. */
const LEFT_MIN = 20;
const CHAT_MIN = 20;

/* A toolbar button that shows or hides a pane, lit while the pane is shown. */
function PaneToggle({ shown, label, onClick, children }: {
  shown: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  let style: React.CSSProperties = { color: 'var(--text-muted)' };
  let action = `Show ${label}`;
  if (shown) {
    style = { backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' };
    action = `Hide ${label}`;
  }
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded transition-all"
      style={style}
      title={action}
      aria-label={action}
      aria-pressed={shown}
    >
      {children}
    </button>
  );
}

function App() {
  const [theme, setTheme] = useState<ThemeColors>(THEMES[0].colors);
  const [citations, setCitations] = useState<string[]>([]);
  const [retrieval, setRetrieval] = useState<RetrievalItem[]>([]);
  const [graph, setGraph] = useState<RefGraphData>(EMPTY_GRAPH);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatVisible, setChatVisible] = useState(true);

  // The native frosted effect behind the window (src-tauri/src/lib.rs):
  // macOS and Windows only. Linux and browser tabs stay solid.
  const [backdrop, setBackdrop] = useState('none');
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    invoke<string>('backdrop').then(setBackdrop).catch(() => setBackdrop('none'));
  }, []);
  const glass = backdrop !== 'none';

  // Which answer the left-hand panes are showing. Follows the newest turn, but
  // clicking an older card in the transcript points it back at that one.
  const [activeTurnId, setActiveTurnId] = useState<number | null>(null);

  // Message identity has to survive list growth, so it can't be the array index.
  const nextId = useRef(0);

  // Lets a running query be abandoned. The backend finishes it regardless;
  // only the waiting stops.
  const queryAbort = useRef<AbortController | null>(null);

  const [lastMs, setLastMs] = useState<number | null>(null);

  // Polls fast while generating, slowly when idle.
  const machine = useMachineStats(loading);

  // The chat panel is collapsed rather than unmounted, so widths you drag survive the toggle.
  const chatOpenShare = useRef(22);  // % of the window the chat last had while open

  // The context pane folds away from the toolbar the same way.
  const filesPanelEl = useRef<HTMLDivElement | null>(null);
  const contextOpenShare = useRef(22);  // % of the window it last had while open
  const contextOpenWidth = useRef(0);   // ...and in pixels, to hold its content at mid-fold
  const [contextVisible, setContextVisible] = useState(true);
  const [contextPin, setContextPin] = useState<number | null>(null);

  const appRef = useRef<HTMLDivElement | null>(null);
  const mainGroup = useRef<GroupImperativeHandle | null>(null);

  // Folding panes are held at their open size, so content slides instead of re-wrapping.
  const chatPanelEl = useRef<HTMLDivElement | null>(null);
  const chatOpenWidth = useRef(0);
  const [chatPin, setChatPin] = useState<number | null>(null);
  const mainFold = useFold();

  // Lifted up from ContextPane so they survive the chat-toggle remount:
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);

  // Show documents indexed in earlier sessions. Retried while the backend is
  // unreachable, since it may start after the app.
  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;

    const load = async () => {
      const stored = await fetchDocuments();
      if (cancelled) return;
      if (stored === null) {
        retry = window.setTimeout(load, 3000);
        return;
      }

      setDocuments(prev => {
        const shown = new Set(prev.map(d => d.name));
        return [...prev, ...stored.filter(d => !shown.has(d.name))];
      });

      for (const doc of stored) {
        const stats = await fetchDocStats(doc.name);
        if (cancelled) return;
        if (!stats) continue;
        setDocuments(prev =>
          prev.map(d => {
            if (d.name !== doc.name) return d;
            return { ...d, stats };
          }),
        );
      }
    };

    load();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, []);

  // Real token usage from Ollama:
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);
  const [tokensBurned, setTokensBurned] = useState(0);

  // Remember each foldable pane's open size. Skipped mid-fold, when the size
  // is in motion and not one worth holding the content at.
  useEffect(() => {
    const chatEl = chatPanelEl.current;
    if (!chatEl) return;
    const observer = new ResizeObserver(() => {
      const width = chatEl.getBoundingClientRect().width;
      if (!mainFold.foldingRef.current && width > 0) chatOpenWidth.current = width;
    });
    observer.observe(chatEl);
    return () => observer.disconnect();
  }, []);

  // The chat trades width with the analysis column only; the library's own collapse
  // would squeeze the context pane out of reach.
  const toggleChat = () => {
    const group = mainGroup.current;
    if (!group) return;
    const layout = group.getLayout();
    if (layout.left === undefined) return;  // the group has not been laid out yet
    const left = layout.left;
    const chat = layout.chat ?? 0;
    const opening = chat < 0.5;

    let next: Layout = { ...layout, left: left + chat, chat: 0 };
    if (opening) {
      // Back to the width it last had, as long as the column keeps its minimum.
      const share = Math.max(CHAT_MIN, Math.min(chatOpenShare.current, left - LEFT_MIN));
      next = { ...layout, left: left - share, chat: share };
    } else {
      // Remember the width it leaves at -- from the layout, which is exact, not
      // from onResize, which measures every frame of the fold as it shrinks.
      chatOpenShare.current = chat;
    }

    mainFold.fold(
      () => group.setLayout(next),
      () => {
        if (chatOpenWidth.current > 0) setChatPin(chatOpenWidth.current);
      },
      () => setChatPin(null),
    );
    setChatVisible(opening);
  };

  // Showing or hiding the context pane trades width with its neighbour: the
  // chat while it is open, otherwise the analysis column.
  const toggleContext = () => {
    const group = mainGroup.current;
    if (!group) return;
    const layout = group.getLayout();
    if (layout.left === undefined) return;  // the group has not been laid out yet
    const left = layout.left;
    const chat = layout.chat ?? 0;
    const files = layout.files ?? 0;
    const opening = files < 0.5;

    let next: Layout = { ...layout, left: left + files, files: 0 };
    if (chat > 0) next = { ...layout, chat: chat + files, files: 0 };

    if (opening) {
      // Take what the chat can spare, then the rest from the column, never
      // pushing either below its minimum.
      let fromChat = 0;
      if (chat > 0) fromChat = Math.min(contextOpenShare.current, Math.max(chat - CHAT_MIN, 0));
      const fromLeft = Math.min(contextOpenShare.current - fromChat, Math.max(left - LEFT_MIN, 0));
      next = { ...layout, left: left - fromLeft, chat: chat - fromChat, files: fromChat + fromLeft };
    } else {
      // Remember what it had: the share from the layout, the pixels from the page.
      contextOpenShare.current = files;
      const panelEl = filesPanelEl.current;
      if (panelEl) contextOpenWidth.current = panelEl.getBoundingClientRect().width;
    }

    mainFold.fold(
      () => group.setLayout(next),
      () => {
        if (contextOpenWidth.current > 0) setContextPin(contextOpenWidth.current);
      },
      () => setContextPin(null),
    );
    setContextVisible(opening);
  };

  const say = (text: string) => {
    setMessages(prev => [...prev, { id: ++nextId.current, role: 'assistant', content: text }]);
  };

  /** Run a typed command. Everything here is local or retrieval-only: none of
   *  these spends a model call, which is why they come back instantly. */
  const runCommand = (name: string, argument: string, typed: string) => {
    if (name === 'find') {
      if (argument === '') {
        say('find: needs something to look for, e.g. "find: initial capital".');
        return;
      }
      sendPrompt(argument, true, typed);
      return;
    }

    if (name === 'doc') {
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
      return;
    }

    if (name === 'clear') {
      setMessages([]);
      setActiveTurnId(null);
      setCitations([]);
      setRetrieval([]);
      setGraph(EMPTY_GRAPH);
      setLookup(null);
      return;
    }

    if (name === 'help') {
      say([
        'find: initial capital — passages by keyword and meaning',
        'doc: celex — ask about one document, or "doc: all"',
        'Tab after a, para, p, sec, cha — article, paragraph, point, section, chapter',
        'clear — empty this conversation',
      ].join('\n'));
    }
  };

  /** Repoint the panes at an answer already in the transcript. No refetch --
   *  every turn keeps its own evidence, so this is pure local state. */
  const restoreTurn = (message: Message) => {
    if (!message.turn || loading) return;
    const t = message.turn;
    setCitations(t.citations);
    setRetrieval(t.retrieval);
    setGraph(t.graph);
    setLookup(t.lookup);
    setUsage(t.usage);
    setLastMs(t.ms);
    setActiveTurnId(message.id);
  };

  const cancelQuery = () => {
    const controller = queryAbort.current;
    if (controller) controller.abort();
  };

  /** A question goes to /query (retrieval-augmented generation). A lookup --
   *  find: -- goes to /retrieve and gets passages without an answer;
   *  `label` keeps what was typed in the transcript. */
  const sendPrompt = async (prompt: string, lookupOnly = false, label?: string) => {
    const started = performance.now();
    let shown = prompt;
    if (label) shown = label;
    let endpoint = api('/query');
    if (lookupOnly) endpoint = api('/retrieve');

    setMessages(prev => [...prev, { id: ++nextId.current, role: 'user', content: shown }]);
    setLoading(true);

    const controller = new AbortController();
    queryAbort.current = controller;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: prompt, source: activeDoc }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(await errorText(res));
      }
      const data = await res.json();

      // Assembled once, then used for both the live panes and the transcript
      // card, so the two can never drift apart.
      // A lookup has no generated answer; its card says what was found instead.
      let finding = data.finding;
      if (lookupOnly) {
        const count = (data.sources ?? []).length;
        finding = `${lookupLabel(data.lookup ?? null)} — ${count} passages in Citations.`;
      }

      let kind: Turn['kind'] = 'answer';
      if (lookupOnly) kind = 'lookup';

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

      setCitations(turn.citations);
      setRetrieval(turn.retrieval);
      setGraph(turn.graph);
      setLookup(turn.lookup);
      setUsage(turn.usage);
      setTokensBurned(t => t + (turn.usage.total_tokens ?? 0));

      const id = ++nextId.current;
      setMessages(prev => [...prev, { id, role: 'assistant', content: turn.finding, turn }]);
      setActiveTurnId(id);
    } catch (err) {
      let msg = 'Unknown error';
      if (err instanceof Error) msg = err.message;
      // fetch itself failed: no reply came back at all.
      if (err instanceof TypeError) msg = 'Could not reach the backend. Restart xref-rag if this persists.';

      let bubble = `Error: ${msg}`;
      if (controller.signal.aborted) bubble = 'Stopped. The backend may still be finishing this query.';
      setCitations([]);
      setRetrieval([]);
      setGraph(EMPTY_GRAPH);
      setLookup(null);
      setUsage(EMPTY_USAGE);
      // No turn attached: a failed query has no evidence to restore, which is
      // what keeps the error bubble unclickable.
      setMessages(prev => [...prev, { id: ++nextId.current, role: 'assistant', content: bubble }]);
    } finally {
      queryAbort.current = null;
      setLastMs(performance.now() - started);
      setLoading(false);
    }
  };

  // The class carries the fold's transition, and is only there for the length
  // of a fold, so dragging a separator stays immediate.
  let mainGroupClass = 'h-full w-full';
  if (mainFold.folding) mainGroupClass += ' panels-folding';
  // With the chat hidden its gutter closes and is disabled, so a zero-width seam can't be grabbed.
  let chatSeparatorStyle: React.CSSProperties | undefined;
  if (!chatVisible) chatSeparatorStyle = { width: 0 };

  let chatWrapStyle: React.CSSProperties = { width: '100%' };
  if (chatPin !== null) chatWrapStyle = { width: chatPin };

  let contextSeparatorStyle: React.CSSProperties | undefined;
  if (!contextVisible) contextSeparatorStyle = { width: 0 };

  let contextWrapStyle: React.CSSProperties = { width: '100%' };
  if (contextPin !== null) contextWrapStyle = { width: contextPin };
  // On the frosted effect the context pane is a borderless sidebar.
  if (glass) contextWrapStyle = { ...contextWrapStyle, borderColor: 'transparent' };

  // The toolbar floats over the top-right corner, so whichever pane is
  // rightmost keeps its header controls clear of it.
  const chatUnderToolbar = !contextVisible && chatVisible;
  const citationsUnderToolbar = !contextVisible && !chatVisible;

  // The native materials tint what they blur, so the surface only washes over them.
  let surfaceColor = 'var(--app-bg)';
  if (glass) surfaceColor = `color-mix(in srgb, ${theme.bg} 35%, transparent)`;

  return (
    <div
      ref={appRef}
      className="relative h-screen w-screen overflow-hidden p-1.5 transition-colors duration-200"
      style={{
        backgroundColor: surfaceColor,
        fontWeight: theme.fontWeight,
        '--app-bg': theme.bg,
        '--panel-bg': theme.panelBg,
        '--card-bg': theme.cardBg,
        '--surface-card': `color-mix(in srgb, ${theme.text} 6%, transparent)`,
        '--text-main': theme.text,
        '--text-muted': theme.textMuted,
        '--border-color': theme.border,
        '--accent-color': theme.accent,
        '--accent-text': theme.accentText,
      } as React.CSSProperties}
    >
      {/* Toolbar */}
      <div className="absolute top-1.5 right-4 z-50">
        <div
          className="flex items-center gap-1 p-1 rounded-lg border shadow-sm"
          // Solid, not blurred: a backdrop blur is re-rendered whenever the panes
          // beneath move, which WebKitGTK does slowly.
          style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
        >
          {/* Chat first, then the context pane: left to right, as they sit. */}
          <PaneToggle shown={chatVisible} label="chat" onClick={toggleChat}>
            <MessageSquareIcon />
          </PaneToggle>
          <PaneToggle shown={contextVisible} label="context and documents" onClick={toggleContext}>
            <PanelRightIcon />
          </PaneToggle>
          <div className="w-px h-4 self-center mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
          <div className="flex items-center gap-1.5 px-1">
            {THEMES.map((t) => (
              <button
                key={t.name}
                onClick={() => setTheme(t.colors)}
                className="w-3.5 h-3.5 rounded-full border transition-transform hover:scale-125 focus:outline-none"
                style={{
                  background: `linear-gradient(135deg, ${t.colors.bg} 50%, ${t.colors.panelBg} 50%)`,
                  borderColor: theme.bg === t.colors.bg ? 'var(--text-main)' : 'rgba(0,0,0,0.15)',
                }}
                title={t.name}
                aria-label={`${t.name} theme`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <Group orientation="horizontal" className={mainGroupClass} groupRef={mainGroup}>

        {/* Left: the retrieved passages, with what each one cites. */}
        <Panel
          id="left"
          defaultSize="56%"
          minSize={`${LEFT_MIN}%`}
          className="overflow-hidden rounded-lg border"
        >
          <CitationPane
            citations={citations}
            retrieval={retrieval}
            graph={graph}
            lookup={lookup}
            loading={loading}
            toolbarInset={citationsUnderToolbar}
          />
        </Panel>

        <Separator
          className="panel-separator"
          style={chatSeparatorStyle}
          disabled={!chatVisible}
        />
        <Panel
          id="chat"
          defaultSize="22%"
          minSize={`${CHAT_MIN}%`}
          collapsible
          collapsedSize={0}
          // Dragging past minSize also collapses it; sizes reported mid-fold are ignored.
          onResize={(size) => {
            if (!mainFold.foldingRef.current) setChatVisible(size.asPercentage > 0);
          }}
          // No border here: ChatPane is two bordered panes of its own, and at
          // collapsedSize 0 the panel's overflow clipping hides both.
          className="min-w-0"
          elementRef={chatPanelEl}
          style={{ overflow: 'hidden' }}
        >
          {/* Held at its open width while it folds; unreachable while folded away. */}
          <div className="h-full" style={chatWrapStyle} inert={!chatVisible}>
            <ChatPane
              messages={messages}
              onSend={sendPrompt}
              onCommand={runCommand}
              onCancel={cancelQuery}
              loading={loading}
              activeDoc={activeDoc}
              modelLoaded={machine?.model?.loaded ?? null}
              onSelectTurn={restoreTurn}
              activeTurnId={activeTurnId}
              toolbarInset={chatUnderToolbar}
            />
          </div>
        </Panel>

        {/* Drag it to resize the context pane. With the pane folded away its
            gap closes, and it is disabled so a zero-width seam can't be grabbed. */}
        <Separator
          className="panel-separator"
          style={contextSeparatorStyle}
          disabled={!contextVisible}
        />

        {/* Context pane: the pixel minimum fits its content; narrower, it folds away. */}
        <Panel
          id="files"
          defaultSize="22%"
          minSize="240px"
          collapsible
          collapsedSize={0}
          elementRef={filesPanelEl}
          // Measured every frame, so mid-fold it reports passing sizes: during
          // a fold the toggle's own state stands.
          onResize={(size) => {
            if (!mainFold.foldingRef.current) setContextVisible(size.asPercentage > 0);
          }}
          className="min-w-0"
          style={{ overflow: 'hidden' }}
        >
          <div className="h-full overflow-hidden rounded-lg border" style={contextWrapStyle} inert={!contextVisible}>
            <ContextPane
              documents={documents}
              setDocuments={setDocuments}
              activeDoc={activeDoc}
              setActiveDoc={setActiveDoc}
              usage={usage}
              tokensBurned={tokensBurned}
              lastMs={lastMs}
              machine={machine}
              glass={glass}
            />
          </div>
        </Panel>

      </Group>

    </div>
  );
}

export default App;
