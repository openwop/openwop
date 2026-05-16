/**
 * Apply animation — debounced chunk rendering for streamed token deltas.
 *
 * Problem: a fast LLM emits 30-100 token deltas per second. Each delta
 * arriving triggers a React state update + render of the chat feed.
 * On long messages the feed slows to a crawl due to render thrash.
 *
 * Solution: buffer deltas in a ref and flush via requestAnimationFrame
 * (or a setTimeout fallback for tests / SSR). The visible bubble updates
 * at frame rate (~60 Hz) regardless of how fast deltas arrive — but the
 * accumulated string is always correct + the final flush always lands.
 *
 * Borrowed from MyndHyve's `useApplyAnimation` pattern. Adopters who
 * want token-by-token (no debounce) just pass `frameBudgetMs: 0`.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface ApplyAnimationOptions {
  /** Minimum ms between visible updates. Default: animation frame (~16ms). */
  frameBudgetMs?: number;
  /** Called on each flush with the newly-accumulated tail (the delta since the
   *  previous flush). Use to update React state in batches. */
  onFlush: (accumulatedTail: string) => void;
}

export interface ApplyAnimationHandle {
  /** Push a delta into the buffer. Schedules a flush if one isn't pending. */
  push: (delta: string) => void;
  /** Force-flush whatever's buffered (call on stream end). */
  flush: () => void;
  /** Reset internal state. Call between turns. */
  reset: () => void;
}

export function useApplyAnimation(opts: ApplyAnimationOptions): ApplyAnimationHandle {
  const bufferRef = useRef('');
  const lastFlushAtRef = useRef(0);
  const pendingRafRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFlushRef = useRef(opts.onFlush);
  const budgetRef = useRef(opts.frameBudgetMs ?? 16);

  useEffect(() => {
    onFlushRef.current = opts.onFlush;
    budgetRef.current = opts.frameBudgetMs ?? 16;
  }, [opts.onFlush, opts.frameBudgetMs]);

  useEffect(() => () => {
    // Cancel any pending flush on unmount.
    if (pendingRafRef.current != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(pendingRafRef.current);
    }
    if (pendingTimerRef.current != null) {
      clearTimeout(pendingTimerRef.current);
    }
  }, []);

  const doFlush = useCallback(() => {
    pendingRafRef.current = null;
    pendingTimerRef.current = null;
    const tail = bufferRef.current;
    if (tail.length === 0) return;
    bufferRef.current = '';
    lastFlushAtRef.current = Date.now();
    onFlushRef.current(tail);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pendingRafRef.current != null || pendingTimerRef.current != null) return;

    const elapsed = Date.now() - lastFlushAtRef.current;
    const wait = Math.max(0, budgetRef.current - elapsed);

    if (wait <= 0 && typeof requestAnimationFrame !== 'undefined') {
      pendingRafRef.current = requestAnimationFrame(doFlush);
    } else {
      pendingTimerRef.current = setTimeout(doFlush, wait);
    }
  }, [doFlush]);

  const push = useCallback((delta: string) => {
    if (!delta) return;
    bufferRef.current += delta;
    scheduleFlush();
  }, [scheduleFlush]);

  const flush = useCallback(() => {
    if (pendingRafRef.current != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = null;
    }
    if (pendingTimerRef.current != null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    doFlush();
  }, [doFlush]);

  const reset = useCallback(() => {
    bufferRef.current = '';
    lastFlushAtRef.current = 0;
    if (pendingRafRef.current != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = null;
    }
    if (pendingTimerRef.current != null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  return { push, flush, reset };
}
