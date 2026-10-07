import React, { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { THEMES, ThemeColors } from './lib/themes';
import { useMachineStats } from './lib/useMachineStats';
import { useGlass } from './lib/useGlass';
import { useDocuments } from './lib/useDocuments';
import { useConversation } from './lib/useConversation';
import { usePaneLayout, LEFT_MIN, CHAT_MIN } from './lib/usePaneLayout';
import { Toolbar } from './components/Toolbar';
import { CitationPane } from './components/CitationPane';
import { ChatPane } from './components/ChatPane';
import { ContextPane } from './components/ContextPane';
import './App.css';

function themeStyle(theme: ThemeColors, glass: boolean): React.CSSProperties {
  // The native backdrop is already tinted, so the surface only washes over it.
  let surface = 'var(--app-bg)';
  if (glass) surface = `color-mix(in srgb, ${theme.bg} 35%, transparent)`;

  return {
    backgroundColor: surface,
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
  } as React.CSSProperties;
}

// A hidden pane's separator closes to zero width.
function separatorStyle(paneVisible: boolean): React.CSSProperties | undefined {
  if (paneVisible) return undefined;
  return { width: 0 };
}

// While a pane folds, its content is held at the pinned width.
function pinnedWidth(pin: number | null): React.CSSProperties {
  if (pin === null) return { width: '100%' };
  return { width: pin };
}

function App() {
  const [theme, setTheme] = useState<ThemeColors>(THEMES[0].colors);
  const glass = useGlass();
  const { documents, setDocuments, activeDoc, setActiveDoc } = useDocuments();
  const conversation = useConversation(documents, activeDoc, setActiveDoc);
  const machine = useMachineStats(conversation.loading);
  const panes = usePaneLayout();

  let groupClass = 'h-full w-full';
  if (panes.folding) groupClass += ' panels-folding';

  let contextWrapStyle = pinnedWidth(panes.contextPin);
  if (glass) contextWrapStyle = { ...contextWrapStyle, borderColor: 'transparent' };

  // The rightmost visible pane leaves room for the floating toolbar.
  const chatUnderToolbar = !panes.contextVisible && panes.chatVisible;
  const citationsUnderToolbar = !panes.contextVisible && !panes.chatVisible;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden p-1.5 transition-colors duration-200"
      style={themeStyle(theme, glass)}
    >
      <Toolbar
        chatVisible={panes.chatVisible}
        contextVisible={panes.contextVisible}
        onToggleChat={panes.toggleChat}
        onToggleContext={panes.toggleContext}
        theme={theme}
        onSelectTheme={setTheme}
      />

      <Group orientation="horizontal" className={groupClass} groupRef={panes.groupRef}>
        <Panel
          id="left"
          defaultSize="56%"
          minSize={`${LEFT_MIN}%`}
          className="overflow-hidden rounded-lg border"
        >
          <CitationPane
            citations={conversation.citations}
            retrieval={conversation.retrieval}
            graph={conversation.graph}
            lookup={conversation.lookup}
            loading={conversation.loading}
            toolbarInset={citationsUnderToolbar}
          />
        </Panel>

        <Separator
          className="panel-separator"
          style={separatorStyle(panes.chatVisible)}
          disabled={!panes.chatVisible}
        />

        <Panel
          id="chat"
          defaultSize="22%"
          minSize={`${CHAT_MIN}%`}
          collapsible
          collapsedSize={0}
          onResize={(size) => panes.onChatResize(size.asPercentage)}
          className="min-w-0"
          elementRef={panes.chatPanelRef}
          style={{ overflow: 'hidden' }}
        >
          <div className="h-full" style={pinnedWidth(panes.chatPin)} inert={!panes.chatVisible}>
            <ChatPane
              messages={conversation.messages}
              onSend={conversation.sendPrompt}
              onCommand={conversation.runCommand}
              onCancel={conversation.cancelQuery}
              loading={conversation.loading}
              activeDoc={activeDoc}
              modelLoaded={machine?.model?.loaded ?? null}
              onSelectTurn={conversation.restoreTurn}
              activeTurnId={conversation.activeTurnId}
              toolbarInset={chatUnderToolbar}
            />
          </div>
        </Panel>

        <Separator
          className="panel-separator"
          style={separatorStyle(panes.contextVisible)}
          disabled={!panes.contextVisible}
        />

        <Panel
          id="files"
          defaultSize="22%"
          minSize="240px"
          collapsible
          collapsedSize={0}
          elementRef={panes.contextPanelRef}
          onResize={(size) => panes.onContextResize(size.asPercentage)}
          className="min-w-0"
          style={{ overflow: 'hidden' }}
        >
          <div
            className="h-full overflow-hidden rounded-lg border"
            style={contextWrapStyle}
            inert={!panes.contextVisible}
          >
            <ContextPane
              documents={documents}
              setDocuments={setDocuments}
              activeDoc={activeDoc}
              setActiveDoc={setActiveDoc}
              usage={conversation.usage}
              tokensBurned={conversation.tokensBurned}
              lastMs={conversation.lastMs}
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
