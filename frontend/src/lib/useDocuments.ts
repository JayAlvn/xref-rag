import { useEffect, useState } from 'react';
import type { Doc } from './utils';
import { fetchDocStats, fetchDocuments } from './utils';

const RETRY_MS = 3000;

export function useDocuments() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);

  // Loads documents indexed in earlier sessions, retrying until the backend is up.
  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;

    const load = async () => {
      const stored = await fetchDocuments();
      if (cancelled) return;
      if (stored === null) {
        retry = window.setTimeout(load, RETRY_MS);
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

  return { documents, setDocuments, activeDoc, setActiveDoc };
}
