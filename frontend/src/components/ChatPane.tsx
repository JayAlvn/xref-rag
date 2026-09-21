import { useRef, useState, type CSSProperties } from 'react';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import { TOOLBAR_CLEARANCE, type Message } from '../lib/utils';
import { useFold } from '../lib/useFold';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';
import { QueryProgress } from './QueryProgress';

type ChatPaneProps = {
  messages: Message[];
  onSend: (prompt: string) => void;
  /** A typed command: its name, its argument, and the line as typed. */
  onCommand: (name: string, argument: string, typed: string) => void;
  /** Abandons the running query. */
  onCancel: () => void;
  loading: boolean;
  activeDoc: string | null;
  /** null when the backend hasn't reported yet. */
  modelLoaded: boolean | null;
  /** Restores a past answer into the finding and citation panes. */
  onSelectTurn: (message: Message) => void;
  /** Which turn the left-hand panes are currently showing. */
  activeTurnId: number | null;
  /** Rightmost pane: keep the header's chevron clear of the floating toolbar. */
  toolbarInset: boolean;
};

/* Typed at the start of the prompt. Everything here is local or retrieval
   only, so none of it waits on the model. */
const COMMANDS = [
  { name: 'find', argument: 'initial capital', hint: 'passages by keyword and meaning' },
  { name: 'doc', argument: 'celex', hint: 'ask about one document, or "all"' },
  { name: 'clear', argument: '', hint: 'empty this conversation' },
  { name: 'help', argument: '', hint: 'list these commands' },
];

const BARE = ['clear', 'help'];   // take no argument, so they need no colon

/* Shorthand expanded with Tab where a word ends: "para 2 a 85" becomes
   "paragraph 2 article 85". Only Tab expands, so "a" in a sentence stays "a". */
const ABBREVIATIONS: Record<string, string> = {
  a: 'article',
  para: 'paragraph',
  p: 'point',
  sec: 'section',
  cha: 'chapter',
};

/* The shorthand the line ends on, or null. */
function abbreviationAt(text: string): { word: string; full: string } | null {
  const match = /(?:^|\s)([A-Za-z]+)$/.exec(text);
  if (!match) return null;

  const full = ABBREVIATIONS[match[1].toLowerCase()];
  if (full === undefined) return null;
  return { word: match[1], full };
}

/* The command a line invokes, or null for an ordinary question. */
function commandIn(text: string): { name: string; argument: string } | null {
  const line = text.trim();
  const colon = line.indexOf(':');

  if (colon > 0) {
    const name = line.slice(0, colon).trim().toLowerCase();
    if (COMMANDS.some(c => c.name === name && !BARE.includes(name))) {
      return { name, argument: line.slice(colon + 1).trim() };
    }
  }

  const bare = line.toLowerCase();
  if (BARE.includes(bare)) return { name: bare, argument: '' };

  return null;
}

/* Fits the scope-and-controls row, a three-line textarea, the model warning
   and the Send button. */
const COMPOSER_PX = 232;
const COMPOSER_HEIGHT = `${COMPOSER_PX}px`;

/* Height the conversation folds down to: its header row, chevron included. */
const CHAT_HEADER = 56;

/* The gap between the conversation and the prompt box (.panel-separator). */
const GUTTER = 6;

export function ChatPane({
  messages, onSend, onCommand, onCancel, loading, activeDoc,
  modelLoaded, onSelectTurn, activeTurnId, toolbarInset,
}: ChatPaneProps) {
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Suggestions while the first word is still being typed: "d" offers doc.
  // They disappear as soon as the line carries a colon or a space.
  const typed = text.trimStart();
  let suggestions: typeof COMMANDS = [];
  if (typed !== '' && !typed.includes(':') && !typed.includes(' ')) {
    suggestions = COMMANDS.filter(c => c.name.startsWith(typed.toLowerCase()));
  }
  const picked = suggestions[Math.min(highlight, suggestions.length - 1)];

  let shorthand: { word: string; full: string } | null = null;
  if (suggestions.length === 0 && highlight >= 0) shorthand = abbreviationAt(text);

  const expand = (found: { word: string; full: string }) => {
    setText(`${text.slice(0, text.length - found.word.length)}${found.full} `);
  };

  const complete = (name: string) => {
    if (BARE.includes(name)) {
      setText(name);
    } else {
      setText(`${name}: `);
    }
    setHighlight(0);
  };

  const transcriptPanel = useRef<PanelImperativeHandle | null>(null);
  const composerPanel = useRef<PanelImperativeHandle | null>(null);
  const transcriptEl = useRef<HTMLDivElement | null>(null);
  const groupEl = useRef<HTMLDivElement | null>(null);
  const transcriptFold = useFold();
  const [collapsed, setCollapsed] = useState(false);
  const [pinHeight, setPinHeight] = useState<number | null>(null);

  /* Folds the conversation to its header; reopening restores the default split. Messages
     keep their open height, so they slide rather than re-flow. */
  const toggleTranscript = () => {
    const transcript = transcriptPanel.current;
    const composer = composerPanel.current;
    const transcriptBox = transcriptEl.current;
    const group = groupEl.current;
    if (!transcript || !composer || !transcriptBox || !group) return;

    const opening = transcript.isCollapsed();
    let openHeight = transcriptBox.getBoundingClientRect().height;
    if (opening) openHeight = group.getBoundingClientRect().height - COMPOSER_PX - GUTTER;

    transcriptFold.fold(
      () => {
        if (opening) {
          // The library won't shrink the last panel while those above are collapsed,
          // so reopen the conversation first, then set the split.
          transcript.expand();
          composer.resize(COMPOSER_HEIGHT);
        } else {
          transcript.collapse();
        }
      },
      () => setPinHeight(openHeight),
      () => setPinHeight(null),
    );
    setCollapsed(!opening);
  };

  const submit = () => {
    if (!text.trim() || loading) return;

    const command = commandIn(text);
    if (command) {
      onCommand(command.name, command.argument, text.trim());
    } else {
      onSend(text);
    }
    setText('');
    setHighlight(0);
  };

  /* An answered turn: the answer plus its evidence signals. Clicking restores its panes. */
  const answeredTurn = (msg: Message) => {
    const t = msg.turn!;
    const isActive = msg.id === activeTurnId;

    const text = msg.content;
    return (
      <button
        type="button"
        onClick={() => onSelectTurn(msg)}
        aria-pressed={isActive}
        title="Show this answer and its citations"
        className="animate-in fade-in slide-in-from-bottom-1 duration-200 block w-full max-w-[85%] cursor-pointer rounded-2xl px-3.5 py-2.5 text-left transition-colors"
        style={{
          backgroundColor: 'var(--card-bg)',
          border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
          color: 'var(--text-main)',
        }}
      >
        <span className="whitespace-pre-wrap break-words text-[15px]">{text}</span>

        {t.detail !== '' && (
          <span className="mt-2 block whitespace-pre-wrap break-words text-[13px]"
                style={{ color: 'var(--text-muted)' }}>
            {t.detail}
          </span>
        )}

        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
              style={{ color: 'var(--text-muted)' }}>
          {t.lookup !== null && t.lookup.exact && (
            <span title="Found by its label, not by similarity">exact</span>
          )}

          <span>{t.retrieval.length} src</span>
          <span>{(t.ms / 1000).toFixed(1)}s</span>
        </span>
      </button>
    );
  };

  /* Errors and user prompts carry no turn, so they stay plain bubbles. */
  const plainBubble = (msg: Message) => (
    <span
      className="animate-in fade-in slide-in-from-bottom-1 duration-200 inline-block max-w-[85%] break-words rounded-2xl px-3.5 py-2 text-[15px]"
      style={
        msg.role === 'user'
          ? { backgroundColor: 'var(--accent-color)', color: 'var(--accent-text)' }
          : { backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }
      }
    >
      {msg.content}
    </span>
  );

  const bubbleFor = (msg: Message) => {
    if (msg.turn) return answeredTurn(msg);
    return plainBubble(msg);
  };

  let groupClass = 'h-full w-full';
  if (transcriptFold.folding) groupClass += ' panels-folding';

  const transcriptStyle: CSSProperties = { backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' };
  if (pinHeight !== null) transcriptStyle.height = pinHeight;

  // The messages stay mounted through a fold, so they slide out of view with
  // the pane instead of vanishing the moment the chevron is pressed.
  const showMessages = !collapsed || pinHeight !== null;

  // Clear of the toolbar when this is the rightmost pane.
  let headerStyle: CSSProperties | undefined;
  if (toolbarInset) headerStyle = { paddingRight: TOOLBAR_CLEARANCE };

  let foldLabel = 'Collapse chat';
  let chevron = <ChevronUpIcon />;
  if (collapsed) {
    foldLabel = 'Expand chat';
    chevron = <ChevronDownIcon />;
  }

  return (
    <Group orientation="vertical" className={groupClass} elementRef={groupEl}>
      <Panel
        id="transcript"
        minSize="120px"
        collapsible
        // Folds to its header, so the chevron stays reachable.
        collapsedSize={`${CHAT_HEADER}px`}
        panelRef={transcriptPanel}
        elementRef={transcriptEl}
        // Dragging the divider up past minSize folds it too, so read the state
        // back rather than trusting the button.
        onResize={() => {
          const panel = transcriptPanel.current;
          if (panel) setCollapsed(panel.isCollapsed());
        }}
        className="overflow-hidden rounded-lg border"
        // The library scrolls a panel's content by default; held at its open
        // height mid-fold, this one has to be clipped instead.
        style={{ overflow: 'hidden' }}
      >
        <div className="flex h-full flex-col" style={transcriptStyle}>
          <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3" style={headerStyle}>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Chat
            </h3>
            <button
              onClick={toggleTranscript}
              className="rounded p-1 transition-all"
              style={{ color: 'var(--text-muted)' }}
              title={foldLabel}
              aria-label={foldLabel}
              aria-expanded={!collapsed}
            >
              {chevron}
            </button>
          </div>

          {showMessages && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 pb-4" inert={collapsed}>
              {messages.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Ask something to begin.
                </div>
              )}
              {messages.map((msg) => {
                let side = 'justify-start';
                if (msg.role === 'user') side = 'justify-end';
                return (
                  <div key={msg.id} className={`flex ${side}`}>
                    {bubbleFor(msg)}
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <span className="inline-block rounded-2xl px-3.5 py-2 text-sm" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    Generating…
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Separator className="panel-separator panel-separator-vertical" />

      {/* Prompt box. Its default height is also its minimum. */}
      <Panel
        id="composer"
        defaultSize={COMPOSER_HEIGHT}
        minSize={COMPOSER_HEIGHT}
        panelRef={composerPanel}
        className="overflow-hidden rounded-lg border"
      >
        <div
          className="relative flex h-full flex-col overflow-y-auto p-4"
          style={{ backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' }}
        >
          <QueryProgress loading={loading} />
          {/* Scope sits above the box it applies to: it is the easiest thing to get wrong. */}
          <div className="mb-2 flex flex-col gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {/* A long file name truncates. */}
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">Asking about</span>
              <span
                className="min-w-0 truncate rounded-full px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  color: activeDoc ? 'var(--accent-color)' : 'var(--text-muted)',
                }}
                title={activeDoc ?? 'Every indexed document'}
              >
                {activeDoc ?? 'all documents'}
              </span>
            </div>
          </div>

          {suggestions.length > 0 && highlight >= 0 && (
            <ul
              className="mb-1 overflow-hidden rounded-xl border text-[13px]"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
            >
              {suggestions.map((command, i) => {
                let background = 'transparent';
                if (command === picked) background = 'var(--panel-bg)';
                let example = command.name;
                if (!BARE.includes(command.name)) example = `${command.name}: ${command.argument}`;
                return (
                  <li key={command.name}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        complete(command.name);
                      }}
                      onMouseEnter={() => setHighlight(i)}
                      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left"
                      style={{ backgroundColor: background }}
                    >
                      <span style={{ color: 'var(--text-main)' }}>{example}</span>
                      <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>
                        {command.hint}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {shorthand !== null && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (shorthand !== null) expand(shorthand);
              }}
              className="mb-1 flex items-baseline gap-2 rounded-xl border px-3 py-1.5 text-left text-[13px]"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
            >
              <span style={{ color: 'var(--text-main)' }}>{shorthand.word} → {shorthand.full}</span>
              <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>Tab</span>
            </button>
          )}

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (suggestions.length > 0 && picked) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((highlight + 1) % suggestions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((highlight + suggestions.length - 1) % suggestions.length);
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  complete(picked.name);
                  return;
                }
              }
              if (e.key === 'Tab' && shorthand !== null) {
                e.preventDefault();
                expand(shorthand);
                return;
              }
              if (e.key === 'Escape') setHighlight(-1);
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a question. Tab expands a, para, p, sec, cha; commands: find:, doc:, help"
            className="min-h-[4.5rem] w-full flex-1 resize-none rounded-xl p-3 text-[15px] outline-none"
            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
          />
          {/* Set the expectation before the wait, not after it. */}
          {modelLoaded === false && (
            <p className="mt-2 text-[11px]" style={{ color: '#f59e0b' }}>
              Model not loaded — the first query spends ~10s reloading it.
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            {loading && (
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto rounded-full border px-4 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                title="Stop waiting for this answer"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-color)', color: 'var(--accent-text)' }}
            >
              {loading ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </Panel>
    </Group>
  );
}
