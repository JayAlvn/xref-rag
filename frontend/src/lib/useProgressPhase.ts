import { useEffect, useState } from 'react';

export type ProgressPhase = 'idle' | 'running' | 'done';

/* Phases of a trickle progress line: `running` while loading, `done` for finishMs, then `idle`. */
export function useProgressPhase(loading: boolean, finishMs: number): ProgressPhase {
  const [phase, setPhase] = useState<ProgressPhase>('idle');

  useEffect(() => {
    if (loading) {
      setPhase('running');
      return;
    }
    setPhase(prev => {
      if (prev === 'running') return 'done';
      return prev;
    });
  }, [loading]);

  useEffect(() => {
    if (phase !== 'done') return;
    const id = setTimeout(() => setPhase('idle'), finishMs);
    return () => clearTimeout(id);
  }, [phase, finishMs]);

  return phase;
}
