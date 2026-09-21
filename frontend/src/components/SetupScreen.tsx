import { useState } from 'react';
import { THEMES } from '../lib/themes';
import type { SetupStatus } from '../lib/utils';
// Compiled into the app, so the notices travel with every copy of it.
import ollamaLicense from '../../src-tauri/licenses/OLLAMA-LICENSE.txt?raw';
import llamaNotice from '../../src-tauri/licenses/LLAMA-NOTICE.txt?raw';

type SetupScreenProps = {
  status: SetupStatus;
  onStart: () => void;
};

const colors = THEMES[0].colors;

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/* What the setup is doing right now, for the progress line. */
function stepText(status: SetupStatus): string {
  if (status.step === 'download') return `Downloading Ollama ${status.ollama_version}`;
  if (status.step === 'unpack') return 'Unpacking Ollama…';
  if (status.step === 'start') return 'Starting Ollama…';
  if (status.step === 'model') return 'Downloading the Llama 3.2 model';
  return 'Preparing…';
}

/* Shown instead of the panes until a language model can answer: offers the
   one-time download, reports its progress, and carries the notices of the
   software it installs. */
export function SetupScreen({ status, onStart }: SetupScreenProps) {
  const [showLicense, setShowLicense] = useState(false);

  let intro = '';
  let action = '';
  if (status.state === 'missing' || status.state === 'error') {
    if (status.needs.includes('runtime')) {
      intro = 'xref-rag answers questions with Llama 3.2, which runs on this computer through '
        + `Ollama. Setting both up is a one-time download of about ${gigabytes(status.download_bytes)}. `
        + 'After that everything works offline: your documents and questions never leave this computer.';
      action = 'Download and set up';
    } else {
      intro = `Ollama is running, but the Llama 3.2 model is not installed in it. It is a one-time download of about ${gigabytes(status.download_bytes)}.`;
      action = 'Download the model';
    }
  }
  if (status.needs.includes('runtime') && !status.automatic) {
    intro = 'Automatic setup is not available on this computer. Install Ollama from ollama.com, '
      + 'run "ollama pull llama3.2", then restart xref-rag.';
    action = '';
  }
  if (status.state === 'starting') intro = 'Starting the language model…';

  let buttonText = action;
  if (status.state === 'error') buttonText = 'Try again';

  let percent: number | null = null;
  if (status.state === 'working' && status.total > 0) {
    percent = Math.min(100, Math.round((status.done / status.total) * 100));
  }

  return (
    <div
      className="flex h-screen items-center justify-center overflow-auto p-8"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border p-8"
        style={{ backgroundColor: colors.panelBg, borderColor: colors.border }}
      >
        <h1 className="mb-4 text-[18px] font-semibold">Set up the language model</h1>

        {intro !== '' && (
          <p className="mb-5 text-[14px] leading-relaxed" style={{ color: colors.textMuted }}>
            {intro}
          </p>
        )}

        {status.state === 'working' && (
          <div className="mb-5">
            <div className="mb-2 flex items-baseline justify-between text-[13px]">
              <span>{stepText(status)}</span>
              {status.total > 0 && (
                <span className="tabular-nums" style={{ color: colors.textMuted }}>
                  {gigabytes(status.done)} of {gigabytes(status.total)}
                </span>
              )}
            </div>
            {percent !== null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
                <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: colors.accent }} />
              </div>
            )}
          </div>
        )}

        {status.state === 'error' && (
          <p className="mb-5 text-[13px]" style={{ color: '#f87171' }}>{status.error}</p>
        )}

        {buttonText !== '' && status.state !== 'working' && (
          <button
            type="button"
            onClick={onStart}
            className="rounded-full px-5 py-2 text-sm font-medium"
            style={{ backgroundColor: colors.accent, color: colors.accentText }}
          >
            {buttonText}
          </button>
        )}

        <div className="mt-8 border-t pt-4 text-[12px] leading-relaxed" style={{ borderColor: colors.border, color: colors.textMuted }}>
          <p>
            Ollama is used under the MIT License, Copyright (c) Ollama.{' '}
            <button
              type="button"
              onClick={() => setShowLicense(!showLicense)}
              className="underline"
              aria-expanded={showLicense}
            >
              {showLicense && 'Hide the notice'}
              {!showLicense && 'Show the notice'}
            </button>
          </p>
          {showLicense && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[11px]"
                 style={{ backgroundColor: colors.cardBg }}>
              {ollamaLicense}
            </pre>
          )}
          <p className="mt-3">Built with Llama. {llamaNotice}</p>
        </div>
      </div>
    </div>
  );
}
