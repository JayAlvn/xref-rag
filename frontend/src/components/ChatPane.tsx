import { useRef, useState, type CSSProperties } from 'react';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import { TOOLBAR_CLEARANCE, type Message } from '../lib/utils';
import { useFold } from '../lib/useFold';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';
import { QueryProgress } from './QueryProgress';

type ChatPaneProps = {
  messages: Message[];
  onSend: (prompt: string) => void;
  loading: boolean;
  mode: 'naive' | 'basic';
  setMode: (mode: 'naive' | 'basic') => void;
  activeDoc: string | null;
  sourceCount: number;
  setSourceCount: (n: number) => void;
  /** null when the backend hasn't reported yet. */
  modelLoaded: boolean | null;
  /** Restores a past answer into the finding and citation panes. */
  onSelectTurn: (message: Message) => void;
  /** Which turn the left-hand panes are currently showing. */
  activeTurnId: number | null;
  /** Rightmost pane: keep the header's chevron clear of the floating toolbar. */
  toolbarInset: boolean;
};

const SOURCE_CHOICES = [2, 3, 4, 6, 8, 10, 12];

/* Fits the scope-and-controls row, a three-line textarea, the model warning
   and the Send button. */
const COMPOSER_PX = 232;
const COMPOSER_HEIGHT = `${COMPOSER_PX}px`;

/* Height the conversation folds down to: its header row, chevron included. */
const CHAT_HEADER = 56;

/* The gap between the conversation and the prompt box (.panel-separator). */
const GUTTER = 6;

function riskColor(level: string): string {
  if (level === 'high') return '#ef4444';
  if (level === 'medium') return '#f59e0b';
  return '#22c55e';
}

/** Mirrors the backend's own banding: >=70 high, >=40 probable, else low. */
function confidenceColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

export function ChatPane({
  messages, onSend, loading, mode, setMode, activeDoc, sourceCount, setSourceCount,
  modelLoaded, onSelectTurn, activeTurnId, toolbarInset,
}: ChatPaneProps) {
  const [text, setText] = useState('');

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
    onSend(text);
    setText('');
  };

  /* One half of the mode switch. The two halves sit in one pill, so a narrow
     pane can never wrap them onto separate lines. */
  const modeButton = (value: 'naive' | 'basic') => {
    let background = 'transparent';
    let color = 'var(--text-muted)';
    if (mode === value) {
      background = 'var(--accent-color)';
      color = 'var(--accent-text)';
    }
    return (
      <button
        type="button"
        onClick={() => setMode(value)}
        aria-pressed={mode === value}
        className="rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4 transition-colors"
        style={{ backgroundColor: background, color }}
      >
        {value}
      </button>
    );
  };

  /* An answered turn: the answer plus its evidence signals. Clicking restores its panes. */
  const answeredTurn = (msg: Message) => {
    const t = msg.turn!;
    const isActive = msg.id === activeTurnId;

    // Naive mode generates nothing: its "answer" is the retrieved passages
    // pasted together, which Citations already shows, so keep the first line.
    let text = msg.content;
    if (t.mode === 'naive') text = msg.content.split('\n\n')[0];
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
        <span className="whitespace-pre-wrap break-words text-sm">{text}</span>

        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
              style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1">
            <span style={{ color: confidenceColor(t.confidence.score) }}>●</span>
            {t.confidence.score} confidence
          </span>

          {t.risk.level && t.risk.level !== 'unknown' && (
            <span style={{ color: riskColor(t.risk.level) }}>{t.risk.level} risk</span>
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
      className="animate-in fade-in slide-in-from-bottom-1 duration-200 inline-block max-w-[85%] break-words rounded-2xl px-3.5 py-2 text-sm"
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
          {/* Scope and query controls share one row above the box they apply
              to. Scope is the easiest thing to get wrong, so it comes first. */}
          <div className="mb-2 flex flex-col gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {/* The scope gets a line of its own; a long file name truncates. */}
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

            {/* Query settings. Each label stays with its control, so a narrow
                pane wraps between the two groups, never inside one. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <span>RAG mode</span>
                <div
                  className="flex rounded-full p-0.5"
                  style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}
                  role="group"
                  aria-label="RAG mode"
                >
                  {modeButton('basic')}
                  {modeButton('naive')}
                </div>
              </div>

              <label className="ml-auto flex items-center gap-1.5">
                <span>Sources</span>
                {/* appearance: none replaces the native widget (white on Linux); the arrow is drawn here. */}
                <span className="relative inline-flex items-center">
                  <select
                    value={sourceCount}
                    onChange={(e) => setSourceCount(Number(e.target.value))}
                    className="cursor-pointer rounded-full py-0.5 pl-2 pr-5 text-[11px] font-medium leading-4 outline-none"
                    style={{
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      backgroundColor: 'var(--card-bg)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                    }}
                    title="How many passages to retrieve and cite"
                  >
                    {SOURCE_CHOICES.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-1.5"
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <path
                      d="M2 3.5 L5 6.5 L8 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </label>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Paste your prompt…  (Enter to send, Shift+Enter for newline)"
            className="min-h-[4.5rem] w-full flex-1 resize-none rounded-xl p-3 text-sm outline-none"
            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
          />
          {/* Set the expectation before the wait, not after it. */}
          {modelLoaded === false && mode === 'basic' && (
            <p className="mt-2 text-[11px]" style={{ color: '#f59e0b' }}>
              Model not loaded — the first query spends ~10s reloading it.
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="ml-auto rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
