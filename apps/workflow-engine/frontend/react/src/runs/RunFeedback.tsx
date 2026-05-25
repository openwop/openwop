/**
 * RunFeedback — RFC 0056 quality-signal affordance (thumbs up/down + flag)
 * for a run. Strictly gated: renders nothing unless the host advertises
 * `capabilities.feedback.supported`, so it's fully inert against the
 * current reference host (which doesn't implement RFC 0056 yet). When a
 * host wires the surface, this lights up with zero further app changes.
 * See plans/app-ux-enhancements.md §C1.
 */
import { useEffect, useState } from 'react';
import {
  getFeedbackCapability,
  recordAnnotation,
  type AnnotationSignal,
  type FeedbackCapability,
} from '../client/feedbackClient.js';

export function RunFeedback({ runId }: { runId: string }) {
  const [cap, setCap] = useState<FeedbackCapability | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getFeedbackCapability().then((c) => { if (!cancelled) setCap(c); });
    return () => { cancelled = true; };
  }, []);

  // Inert until a host advertises host.feedback (RFC 0056, Draft).
  if (!cap) return null;

  async function send(signal: AnnotationSignal, label: string) {
    setPending(true);
    setError(null);
    try {
      await recordAnnotation(runId, { target: { runId }, signal });
      setSent(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Feedback</h2>
      {sent ? (
        <p className="muted" style={{ margin: 0 }}>Recorded: {sent}. Thanks.</p>
      ) : (
        <div className="button-row" role="group" aria-label="Rate this run">
          <button type="button" className="secondary" disabled={pending} onClick={() => send({ kind: 'rating', rating: 5 }, '👍 good')} aria-label="Good">👍 Good</button>
          <button type="button" className="secondary" disabled={pending} onClick={() => send({ kind: 'rating', rating: 1 }, '👎 bad')} aria-label="Bad">👎 Bad</button>
          <button type="button" className="secondary" disabled={pending} onClick={() => send({ kind: 'flag' }, '🚩 flagged')} aria-label="Flag for review">🚩 Flag for review</button>
        </div>
      )}
      {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
