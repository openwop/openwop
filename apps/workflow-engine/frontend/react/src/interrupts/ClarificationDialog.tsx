import { useState } from 'react';
import { resolveByRun } from '../client/interruptsClient.js';

interface Props {
  runId: string;
  nodeId: string;
  token: string;
  data: unknown;
  onResolved: () => void;
}

export function ClarificationDialog({ runId, nodeId, data, onResolved }: Props) {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = ((data as { question?: string })?.question) ?? 'Please clarify.';

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await resolveByRun(runId, nodeId, { answer });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Clarification needed</h2>
      <p>{question}</p>
      <div className="form-row">
        <label>Your answer</label>
        <textarea
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="button-row">
        <button onClick={submit} disabled={submitting || !answer.trim()}>
          {submitting ? 'Submitting…' : 'Submit answer'}
        </button>
      </div>
    </div>
  );
}
