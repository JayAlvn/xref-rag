import React, { useState, useRef } from 'react';
import { FileIcon, XIcon, UploadIcon } from './Icons';
import { MachinePane } from './MachinePane';
import { BorderProgress } from './BorderProgress';
import type { MachineStats } from '../lib/useMachineStats';
import type { Doc, Usage } from '../lib/utils';
import { fetchDocStats, structuralSummary } from '../lib/utils';

/* Pace of the indexing line: ms per KB, learned from past uploads on this machine. */
const DEFAULT_MS_PER_KB = 20;
const PACE_KEY = 'ips.indexing.msPerKB';

function readPace(): number {
  try {
    const stored = Number(localStorage.getItem(PACE_KEY));
    if (stored > 0) return stored;
  } catch {
    // Storage unavailable: fall back to the default pace.
  }
  return DEFAULT_MS_PER_KB;
}

function savePace(msPerKB: number): void {
  try {
    localStorage.setItem(PACE_KEY, String(msPerKB));
  } catch {
    // Storage unavailable: the next upload uses the default pace again.
  }
}

/* The document card's corner radius (rounded-xl) less its 1px border: the
   progress line runs along the inside of that border. */
const CARD_RADIUS = 11;

/* Types the backend reads (loader.py). Checked here too: a dropped file skips the picker's filter. */
const SUPPORTED_TYPES = ['.pdf', '.docx', '.txt'];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot).toLowerCase();
}

/* Why the backend refused an upload. FastAPI puts the reason in `detail`;
   anything else gets a plain message with the status code. */
async function rejectionMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === 'string' && body.detail !== '') return body.detail;
  } catch {
    // Not JSON: fall back to the plain message below.
  }
  return `The backend could not index this file (error ${res.status}).`;
}

type ContextPaneProps = {
  documents: Doc[];
  setDocuments: React.Dispatch<React.SetStateAction<Doc[]>>;
  activeDoc: string | null;
  setActiveDoc: (name: string | null) => void;
  usage: Usage;
  tokensBurned: number;
  lastMs: number | null;
  machine: MachineStats | null;
  glass: boolean;  // sits on the native frosted effect instead of a solid panel
};

export function ContextPane({
  documents,
  setDocuments,
  activeDoc,
  setActiveDoc,
  usage,
  tokensBurned,
  lastMs,
  machine,
  glass,
}: ContextPaneProps) {
  const [uploading, setUploading] = useState(false);
  // Lets an upload be abandoned. The backend keeps indexing; only the waiting stops.
  const uploadAbort = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (uploading) return;

    // Refuse what the backend can't read before a card appears for it.
    const extension = extensionOf(file.name);
    if (!SUPPORTED_TYPES.includes(extension)) {
      let kind = `${extension} files`;
      if (extension === '') kind = 'Files without an extension';
      setUploadError(`${file.name}: ${kind} aren't supported. Upload a PDF, DOCX or TXT file.`);
      return;
    }

    setUploading(true);
    setUploadError(null);

    const started = performance.now();
    const sizeKB = Math.max(1, file.size / 1024);
    const previous = documents.find(d => d.name === file.name);

    // The card appears at once with its progress line; re-uploading replaces the old card.
    setDocuments(prev => [
      ...prev.filter(d => d.name !== file.name),
      { id: file.name, name: file.name, chunks: 0, indexing: { estimateMs: sizeKB * readPace() } },
    ]);

    const formData = new FormData();
    formData.append('file', file);

    // Set when the backend answered but refused the file. A failure with no
    // answer at all means the backend could not be reached.
    let rejection: string | null = null;
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      const res = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) {
        rejection = await rejectionMessage(res);
        throw new Error(rejection);
      }
      const data = await res.json();

      // Learn this machine's pace: half from this upload, half from history.
      savePace((readPace() + (performance.now() - started) / sizeKB) / 2);

      // The same card, now indexed: its line closes the loop.
      setDocuments(prev =>
        prev.map(d => {
          if (d.name !== file.name) return d;
          return { id: data.filename, name: data.filename, chunks: data.chunks_indexed };
        }),
      );
      setActiveDoc(data.filename); // auto-scope queries to the doc you just added

      // Structural stats are read back from the index rather than returned by
      // /upload, so the same call also serves documents indexed earlier.
      const stats = await fetchDocStats(data.filename);
      if (stats) {
        setDocuments(prev =>
          prev.map(d => {
            if (d.name !== data.filename) return d;
            return { ...d, stats };
          }),
        );
      }
    } catch {
      // Nothing was indexed: take the card away, or put back the one it replaced.
      setDocuments(prev => {
        const rest = prev.filter(d => d.name !== file.name);
        if (previous) return [...rest, previous];
        return rest;
      });
      if (controller.signal.aborted) {
        setUploadError(`${file.name}: stopped. The backend may still finish indexing it.`);
      } else if (rejection !== null) {
        setUploadError(`${file.name}: ${rejection}`);
      } else {
        setUploadError('Upload failed — could not reach the backend on localhost:8000. Is it running?');
      }
    } finally {
      uploadAbort.current = null;
      setUploading(false);
    }
  };

  const cancelUpload = () => {
    const controller = uploadAbort.current;
    if (controller) controller.abort();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (e.target) e.target.value = '';
  };

  const removeDoc = async (name: string) => {
    try {
      await fetch(`http://localhost:8000/document/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch {
      /* still remove from UI even if the network call fails */
    }
    setDocuments(prev => prev.filter(d => d.name !== name));
    if (activeDoc === name) setActiveDoc(null);
  };

  const selectDoc = (name: string) => setActiveDoc(activeDoc === name ? null : name);

  // ---- Real token dashboard values ----
  const total = usage.total_tokens;
  const windowSize = usage.context_window || 4096;
  const pct = windowSize > 0 ? Math.min(100, Math.round((total / windowSize) * 100)) : 0;
  const promptPct = windowSize > 0 ? Math.min(100, (usage.prompt_tokens / windowSize) * 100) : 0;
  const completionPct = windowSize > 0 ? Math.min(100, (usage.completion_tokens / windowSize) * 100) : 0;
  const available = Math.max(0, windowSize - total);

  // One document at a time: while one is indexing, its card carries the
  // progress and the dropzone waits.
  let dropStyle: React.CSSProperties = { borderColor: 'var(--border-color)' };
  let dropText = 'Drop file or click to add';
  if (uploading) {
    dropStyle = { borderColor: 'var(--border-color)', opacity: 0.5, cursor: 'not-allowed' };
    dropText = 'Indexing… one document at a time';
  }

  let paneStyle = { backgroundColor: 'var(--panel-bg)', color: 'var(--text-main)' } as React.CSSProperties;
  if (glass) {
    paneStyle = { color: 'var(--text-main)', '--card-bg': 'var(--surface-card)' } as React.CSSProperties;
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-5"
      style={paneStyle}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Context Window — real Ollama token usage from the last query */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
            Context Window
          </h3>
        </div>

        <div className="h-1.5 w-full rounded-full overflow-hidden mb-2 flex" style={{ backgroundColor: 'var(--card-bg)' }}>
          <div className="h-full" style={{ width: `${promptPct}%`, backgroundColor: '#22c55e' }} />
          <div className="h-full" style={{ width: `${completionPct}%`, backgroundColor: '#3b82f6' }} />
        </div>
        <div className="flex justify-between text-[15px] mb-4">
          <span className="font-semibold tabular-nums">{total.toLocaleString()} / {windowSize.toLocaleString()} tokens</span>
          <span className="font-bold" style={{ color: pct > 80 ? '#ef4444' : '#16a34a' }}>{pct}%</span>
        </div>

        <div className="space-y-2 text-[15px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-[#22c55e]" />
              <span style={{ color: 'var(--text-muted)' }}>Prompt (context + question)</span>
            </div>
            <span className="font-semibold tabular-nums">{usage.prompt_tokens.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-[#3b82f6]" />
              <span style={{ color: 'var(--text-muted)' }}>Response (generated)</span>
            </div>
            <span className="font-semibold tabular-nums">{usage.completion_tokens.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--border-color)' }} />
              <span style={{ color: 'var(--text-muted)' }}>Available</span>
            </div>
            <span className="font-semibold tabular-nums">{available.toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 space-y-1.5 text-[15px]" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Session total burned</span>
            <span className="font-bold tabular-nums">{tokensBurned.toLocaleString()}</span>
          </div>
          {lastMs !== null && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Last query</span>
              <span className="font-bold tabular-nums">{(lastMs / 1000).toFixed(1)}s</span>
            </div>
          )}
        </div>
      </div>

      <hr style={{ borderColor: 'var(--border-color)' }} className="mb-5" />

      {machine && (
        <>
          <MachinePane machine={machine} />
          <hr style={{ borderColor: 'var(--border-color)' }} className="my-5" />
        </>
      )}

      {/* Loaded Documents */}
      <div>
        <h3 className="text-[12px] font-semibold tracking-widest uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
          Loaded Documents
        </h3>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-muted)' }}>
          Click a document to scope queries to it
        </p>
        <div className="space-y-2">
          {documents.map(doc => {
            const isActive = doc.name === activeDoc;
            const indexing = doc.indexing !== undefined;

            let borderColor = 'var(--border-color)';
            let boxShadow: string | undefined;
            let subtitle = `${doc.chunks} chunks indexed`;
            let subtitleColor = 'var(--text-muted)';
            if (isActive) {
              borderColor = 'var(--accent-color)';
              boxShadow = '0 0 0 1px var(--accent-color)';
              subtitle += ' · active';
              subtitleColor = 'var(--accent-color)';
            }

            // Still being read, chunked and embedded: not queryable yet, so it
            // can't be selected or removed until its line closes.
            let estimateMs = 0;
            let cursor = 'pointer';
            if (doc.indexing) {
              subtitle = 'Indexing: reading, chunking, embedding…';
              subtitleColor = 'var(--text-muted)';
              estimateMs = doc.indexing.estimateMs;
              cursor = 'progress';
            }

            return (
              <div
                key={doc.id}
                onClick={() => {
                  if (!indexing) selectDoc(doc.name);
                }}
                aria-busy={indexing}
                className="relative flex items-center justify-between p-3 border rounded-xl transition"
                style={{ borderColor, backgroundColor: 'var(--card-bg)', boxShadow, cursor }}
              >
                <BorderProgress loading={indexing} estimateMs={estimateMs} radius={CARD_RADIUS} />
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 border rounded-lg shrink-0" style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border-color)' }}>
                    <FileIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-tight truncate">{doc.name}</p>
                    <p className="text-[13px] mt-0.5" style={{ color: subtitleColor }}>
                      {subtitle}
                    </p>
                    {doc.stats && structuralSummary(doc.stats) && (
                      <p className="text-[13px] mt-0.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {structuralSummary(doc.stats)}
                      </p>
                    )}
                  </div>
                </div>
                {!indexing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeDoc(doc.name); }}
                    style={{ color: 'var(--text-muted)' }}
                    className="p-1 shrink-0"
                    aria-label={`Remove ${doc.name}`}
                  >
                    <XIcon />
                  </button>
                )}
                {indexing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelUpload(); }}
                    style={{ color: 'var(--text-muted)' }}
                    className="p-1 shrink-0"
                    title="Stop waiting for this upload"
                    aria-label={`Stop uploading ${doc.name}`}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
            );
          })}

          {/* Upload dropzone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Add a document"
            aria-disabled={uploading}
            className="mt-2 cursor-pointer rounded-xl border border-dashed py-6 px-4 text-center flex flex-col items-center gap-2 transition hover:opacity-70"
            style={dropStyle}
            onClick={() => {
              if (!uploading) fileInputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!uploading) fileInputRef.current?.click();
              }
            }}
          >
            <div style={{ color: 'var(--text-muted)' }}>
              <UploadIcon />
            </div>
            <p className="text-[15px]" style={{ color: 'var(--text-muted)' }}>
              {dropText}
            </p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept={SUPPORTED_TYPES.join(',')}
              className="hidden"
            />
          </div>

          {uploadError && (
            <p
              className="text-[13px] px-1 pt-1"
              style={{ color: '#ef4444' }}
              role="alert"
            >
              {uploadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}