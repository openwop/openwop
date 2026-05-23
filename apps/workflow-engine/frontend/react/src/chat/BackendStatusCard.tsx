/**
 * Unified cold-start / error card for the AI chat surface.
 *
 * Replaces the previous two-card flow (loading → error) that flashed
 * "Spinning up your demo server…" → "The demo is resting" as separate
 * screens. The user perceived that as a confusing arc ("you said you
 * were starting, then you gave up").
 *
 * Now: ONE card that adapts its copy over time and on error. Three
 * phases drive the same chrome:
 *
 *   Phase 1 — Loading, predict warm (recent success in localStorage):
 *     "Loading…" with subtle dots. Should resolve in <1s.
 *
 *   Phase 1 — Loading, predict cold (no recent success):
 *     "Waking up your demo server…" with cold-start framing in the
 *     body. Users expect 10-30s.
 *
 *   Phase 2 — Loading, elapsed ≥ 25s:
 *     "Still waking up…" — copy softens; explicit acknowledgment that
 *     this is taking longer than typical but not yet a failure.
 *
 *   Phase 3 — Error OR elapsed ≥ 40s:
 *     "The demo is resting" + refresh-instruction copy. Same chrome,
 *     same card position — copy + dot animation change only.
 *
 * The shared chrome means the user sees ONE evolving card instead of
 * the previous two-card flash. The phase boundaries are tunable in
 * the constants below.
 */

import { useEffect, useState } from 'react';
import { predictWarm } from '../devtools/lastSuccess.js';

interface Props {
  /** Truthy when the BE call has resolved with an error. The card
   *  jumps to Phase 3 ("resting") regardless of elapsed time. */
  error?: string | null;
  /** Where the back-end URL came from, surfaced inside the Technical
   *  Detail dropdown for debugging. */
  backendUrl?: string | undefined;
}

const SOFT_TIMEOUT_MS = 25 * 1000;
const HARD_TIMEOUT_MS = 40 * 1000;

type Phase = 'loading-warm' | 'loading-cold' | 'still-waking' | 'resting';

export function BackendStatusCard({ error, backendUrl }: Props): JSX.Element {
  // Initial guess: predict cold/warm from the last-success cache. The
  // elapsed timer + error prop will override as new evidence arrives.
  const initialPhase: Phase = predictWarm() ? 'loading-warm' : 'loading-cold';
  const [phase, setPhase] = useState<Phase>(error ? 'resting' : initialPhase);

  useEffect(() => {
    if (error) {
      setPhase('resting');
      return;
    }
    // Loading: bump phase forward as time passes. The two timers are
    // independent so the card can step warm → still-waking → resting
    // without remounting (chrome stays; copy + dots adapt).
    const softTimer = setTimeout(() => setPhase('still-waking'), SOFT_TIMEOUT_MS);
    const hardTimer = setTimeout(() => setPhase('resting'), HARD_TIMEOUT_MS);
    return () => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
    };
  }, [error]);

  const headline =
    phase === 'loading-warm' ? 'Loading'
    : phase === 'loading-cold' ? 'Waking up your demo server'
    : phase === 'still-waking' ? 'Still waking up'
    : 'The demo is resting';

  const body =
    phase === 'loading-warm'
      ? 'Reading your provider config from the host.'
      : phase === 'loading-cold'
        ? 'The Cloud Run server spins down between visits to keep the sample cheap to host. First load takes 10–30 seconds.'
        : phase === 'still-waking'
          ? 'Cold start is taking longer than usual. Hang tight — usually under a minute.'
          : 'The Cloud Run server spins down between visits to keep the sample cheap to host. Please refresh your browser.';

  const showDots = phase !== 'resting';

  return (
    <div className="backend-resting-wrap">
      <div className="backend-resting-card">
        <h2 className="backend-resting-title">
          {headline}
          {showDots && (
            <span className="backend-spinup-ellipsis" aria-hidden="true">
              <span>.</span><span>.</span><span>.</span>
            </span>
          )}
        </h2>
        <p className="backend-resting-body">{body}</p>
        {(error || phase === 'resting') && (
          <details className="backend-resting-detail">
            <summary>Technical detail</summary>
            <p>
              {error && (
                <>
                  <code>{error}</code>
                  <br />
                </>
              )}
              Backend URL:{' '}
              <code>{backendUrl ?? 'http://localhost:8080'}</code>
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
