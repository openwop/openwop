/**
 * useRunAnnotations — §C3. Fetches RFC 0056 annotations for a set of runs,
 * gated on `capabilities.feedback`, and exposes review classification so the
 * runs index can surface a "flagged for review" queue. Returns an empty map
 * (feedbackOn=false) against a host that doesn't advertise feedback, so every
 * caller degrades to a no-op there.
 *
 * Shared by RunsIndexPage's flagged filter and its §C2 quality rollup, so the
 * per-run `GET /v1/runs/{id}/annotations` fan-out happens exactly once.
 */
import { useEffect, useState } from 'react';
import { getFeedbackCapability, listAnnotations, type Annotation } from '../client/feedbackClient.js';

export interface RunReview {
  flagged: boolean; // ≥1 flag signal
  lowRated: boolean; // ≥1 rating ≤ 2
  corrected: boolean; // ≥1 correction
}

/** Classify a run's annotations for the review queue. */
export function reviewOf(anns: readonly Annotation[]): RunReview {
  let flagged = false;
  let lowRated = false;
  let corrected = false;
  for (const a of anns) {
    if (a.signal.kind === 'flag') flagged = true;
    else if (a.signal.kind === 'rating' && typeof a.signal.rating === 'number' && a.signal.rating <= 2) lowRated = true;
    else if (a.signal.kind === 'correction') corrected = true;
  }
  return { flagged, lowRated, corrected };
}

/** True when a run carries any "this went wrong" signal worth triaging. */
export function needsReview(r: RunReview): boolean {
  return r.flagged || r.lowRated || r.corrected;
}

/** Human-readable reason(s) a run is in the review queue (for a tooltip). */
export function reviewReason(r: RunReview): string {
  const parts: string[] = [];
  if (r.flagged) parts.push('flagged');
  if (r.lowRated) parts.push('low-rated');
  if (r.corrected) parts.push('corrected');
  return parts.join(' · ');
}

interface RunAnnotations {
  byRun: Map<string, readonly Annotation[]>;
  feedbackOn: boolean;
}

/** Fetch annotations for `runIds`, capability-gated. The dedup key is the
 *  joined id list so the effect re-runs only when the set actually changes. */
export function useRunAnnotations(runIds: readonly string[]): RunAnnotations {
  const [byRun, setByRun] = useState<Map<string, readonly Annotation[]>>(new Map());
  const [feedbackOn, setFeedbackOn] = useState(false);
  const key = runIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    let cancelled = false;
    void (async () => {
      const cap = await getFeedbackCapability();
      if (cancelled) return;
      if (!cap || ids.length === 0) {
        setFeedbackOn(false);
        setByRun(new Map());
        return;
      }
      setFeedbackOn(true);
      const lists = await Promise.all(ids.map((id) => listAnnotations(id)));
      if (cancelled) return;
      const next = new Map<string, readonly Annotation[]>();
      ids.forEach((id, i) => next.set(id, lists[i] ?? []));
      setByRun(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { byRun, feedbackOn };
}
