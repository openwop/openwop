import { useState } from 'react';
import { resolveByRun } from '../client/interruptsClient.js';

interface Props {
  runId: string;
  nodeId: string;
  token: string;
  data: unknown;
  onResolved: () => void;
}

export function CancellationBanner({ runId, nodeId, data, onResolved }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = ((data as { reason?: string })?.reason) ?? 'A cancellation has been requested.';

  async function ack(confirm: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await resolveByRun(runId, nodeId, { acknowledged: true, confirm });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Cancellation requested</h2>
      <div className="alert warning">{reason}</div>
      {error && <div className="alert error">{error}</div>}
      <div className="button-row">
        <button onClick={() => ack(true)} disabled={submitting}>Confirm cancel</button>
        <button className="secondary" onClick={() => ack(false)} disabled={submitting}>Decline cancel</button>
      </div>
    </div>
  );
}
