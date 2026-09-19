import { useProgressPhase } from '../lib/useProgressPhase';

/* Long enough for the finishing fill and fade in App.css (0.45s) to play out
   before the bar resets. */
const FINISH_MS = 500;

/* Progress above the composer: trickles toward 90% and completes when the answer arrives. */
export function QueryProgress({ loading }: { loading: boolean }) {
  const phase = useProgressPhase(loading, FINISH_MS);

  return (
    <div
      role="progressbar"
      aria-label="Generating answer"
      aria-hidden={phase === 'idle'}
      className={`query-progress query-progress--${phase}`}
    >
      <div className="query-progress-bar" />
    </div>
  );
}
