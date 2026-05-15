import { useState } from 'react';
import { resolveByRun } from '../client/interruptsClient.js';

interface Props {
  runId: string;
  nodeId: string;
  token: string;
  data: unknown;
  onResolved: () => void;
}

const APPROVAL_ACTIONS = ['approve', 'reject', 'request-changes', 'defer', 'escalate'] as const;
type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export function ApprovalCard({ runId, nodeId, data, onResolved }: Props) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompt = ((data as { prompt?: string })?.prompt) ?? 'Please approve to continue.';
  const allowedActions = ((data as { actions?: readonly string[] })?.actions ?? APPROVAL_ACTIONS) as readonly ApprovalAction[];

  async function send(action: ApprovalAction) {
    setSubmitting(true);
    setError(null);
    try {
      await resolveByRun(runId, nodeId, { action, comment: comment || undefined });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Approval required</h2>
      <p>{prompt}</p>
      <div className="form-row">
        <label>Comment (optional)</label>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Visible in the audit trail" />
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="button-row">
        {allowedActions.map((action) => (
          <button
            key={action}
            disabled={submitting}
            className={action === 'approve' ? '' : 'secondary'}
            onClick={() => send(action)}
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}
