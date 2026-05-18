/**
 * Tiny live-clock hook for the Thoughts disclosure's "Thinking… 3.2s"
 * counter. Returns the milliseconds elapsed since `startIso`, updated
 * on a ~10 Hz rAF tick while `active`. Stops ticking (and stops
 * scheduling renders) when `active` is `false`.
 */

import { useEffect, useState } from 'react';

export function useElapsedMs(startIso: string, active: boolean): number {
  const [elapsed, setElapsed] = useState(() => Date.now() - Date.parse(startIso));

  useEffect(() => {
    if (!active) return;
    const start = Date.parse(startIso);
    let frame = 0;
    let lastTick = 0;
    const tick = (t: number) => {
      // ~10 Hz throttle — the human eye doesn't need millisecond
      // accuracy for an elapsed counter, and skipping renders is
      // friendlier to streaming-heavy chat bubbles.
      if (t - lastTick > 100) {
        lastTick = t;
        setElapsed(Date.now() - start);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startIso, active]);

  return elapsed;
}
