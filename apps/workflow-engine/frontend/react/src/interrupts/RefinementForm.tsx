import { useState } from 'react';
import { resolveByRun } from '../client/interruptsClient.js';

interface Props {
  runId: string;
  nodeId: string;
  token: string;
  data: unknown;
  onResolved: () => void;
}

export function RefinementForm({ runId, nodeId, data, onResolved }: Props) {
  const seed = ((data as { current?: unknown })?.current) ?? '';
  const [draft, setDraft] = useState(typeof seed === 'string' ? seed : JSON.stringify(seed, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      let parsed: unknown = draft;
      try {
        parsed = JSON.parse(draft);
      } catch {
        // Tolerate non-JSON refinements — submit as raw string.
      }
      await resolveByRun(runId, nodeId, { refinement: parsed });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Refinement requested</h2>
      <p className="muted">Edit the draft and resubmit.</p>
      <div className="form-row">
        <textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="button-row">
        <button onClick={submit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit refinement'}
        </button>
      </div>
    </div>
  );
}
