import { useCallback, useRef, useState } from 'react';

/* How long a pane takes to fold open or shut. .panels-folding in App.css uses
   the same duration. */
export const FOLD_MS = 300;

/* Fold animation for one panel group. While `folding`, the group carries .panels-folding;
   `hold` pins a pane's content at its open size and `release` lets it go. */
export function useFold() {
  const [folding, setFolding] = useState(false);
  const foldingRef = useRef(false);
  const pending = useRef<(() => void) | null>(null);

  const fold = useCallback((change: () => void, hold: () => void, release: () => void) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }

    // A fold still running in this group is settled first, so two never overlap.
    if (pending.current) pending.current();

    foldingRef.current = true;
    hold();
    setFolding(true);
    change();

    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      pending.current = null;
      foldingRef.current = false;
      setFolding(false);
      release();
    };
    timer = window.setTimeout(finish, FOLD_MS);
    pending.current = finish;
  }, []);

  return { folding, foldingRef, fold };
}
