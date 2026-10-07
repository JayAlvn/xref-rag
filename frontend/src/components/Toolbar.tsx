import React from 'react';
import { THEMES, ThemeColors } from '../lib/themes';
import { MessageSquareIcon, PanelRightIcon } from './Icons';

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

function ThemeButton({ name, colors, selected, onClick }: {
  name: string;
  colors: ThemeColors;
  selected: boolean;
  onClick: () => void;
}) {
  let borderColor = 'rgba(0,0,0,0.15)';
  if (selected) borderColor = 'var(--text-main)';
  return (
    <button
      onClick={onClick}
      className="w-3.5 h-3.5 rounded-full border transition-transform hover:scale-125 focus:outline-none"
      style={{
        background: `linear-gradient(135deg, ${colors.bg} 50%, ${colors.panelBg} 50%)`,
        borderColor,
      }}
      title={name}
      aria-label={`${name} theme`}
    />
  );
}

export function Toolbar({ chatVisible, contextVisible, onToggleChat, onToggleContext, theme, onSelectTheme }: {
  chatVisible: boolean;
  contextVisible: boolean;
  onToggleChat: () => void;
  onToggleContext: () => void;
  theme: ThemeColors;
  onSelectTheme: (colors: ThemeColors) => void;
}) {
  return (
    <div className="absolute top-1.5 right-4 z-50">
      {/* Solid, not blurred: WebKitGTK re-renders a backdrop blur slowly whenever the panes move. */}
      <div
        className="flex items-center gap-1 p-1 rounded-lg border shadow-sm"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
      >
        <PaneToggle shown={chatVisible} label="chat" onClick={onToggleChat}>
          <MessageSquareIcon />
        </PaneToggle>
        <PaneToggle shown={contextVisible} label="context and documents" onClick={onToggleContext}>
          <PanelRightIcon />
        </PaneToggle>
        <div className="w-px h-4 self-center mx-1" style={{ backgroundColor: 'var(--border-color)' }} />
        <div className="flex items-center gap-1.5 px-1">
          {THEMES.map((t) => (
            <ThemeButton
              key={t.name}
              name={t.name}
              colors={t.colors}
              selected={theme.bg === t.colors.bg}
              onClick={() => onSelectTheme(t.colors)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
