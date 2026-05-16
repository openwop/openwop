/**
 * Built-in card registrations: the 4 OpenWOP interrupt kinds.
 *
 * Adopters who want to override one of these can call `registerCard()`
 * with the same cardType — the second registration wins (with a
 * console.warn).
 */

import { useState } from 'react';
import { resolveByRun } from '../../client/interruptsClient.js';
import { registerCard } from './CardRegistry.js';
import type { CardProps } from './types.js';

interface InterruptPayload {
  data?: {
    prompt?: string;
    question?: string;
    actions?: readonly string[];
    current?: unknown;
    reason?: string;
  };
}

// ── interrupt.approval ─────────────────────────────────────────────────

function ApprovalCard({ payload, onAction, isLoading }: CardProps): JSX.Element {
  const data = (payload as InterruptPayload).data ?? {};
  const [comment, setComment] = useState('');
  const prompt = data.prompt ?? 'Please approve to continue.';
  const actions = (data.actions ?? ['approve', 'reject', 'request-changes', 'defer', 'escalate']);

  return (
    <div className="card" style={{ background: 'var(--color-surface-2)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>Approval required</h3>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>{prompt}</p>
      <div className="form-row">
        <label>Comment (optional)</label>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Visible in audit trail"
        />
      </div>
      <div className="button-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {actions.map((action) => (
          <button
            key={action}
            className={action === 'approve' ? '' : 'secondary'}
            disabled={isLoading}
            onClick={() => onAction('resolve', { action, comment: comment || undefined })}
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── interrupt.clarification ────────────────────────────────────────────

function ClarificationCard({ payload, onAction, isLoading }: CardProps): JSX.Element {
  const data = (payload as InterruptPayload).data ?? {};
  const [answer, setAnswer] = useState('');
  return (
    <div className="card" style={{ background: 'var(--color-surface-2)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>Clarification needed</h3>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>{data.question ?? 'Please clarify.'}</p>
      <div className="form-row">
        <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </div>
      <div className="button-row">
        <button disabled={isLoading || !answer.trim()} onClick={() => onAction('resolve', { answer })}>
          Submit
        </button>
      </div>
    </div>
  );
}

// ── interrupt.refinement ───────────────────────────────────────────────

function RefinementCard({ payload, onAction, isLoading }: CardProps): JSX.Element {
  const seed = (payload as InterruptPayload).data?.current ?? '';
  const [draft, setDraft] = useState(typeof seed === 'string' ? seed : JSON.stringify(seed, null, 2));
  return (
    <div className="card" style={{ background: 'var(--color-surface-2)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>Refinement requested</h3>
      <div className="form-row">
        <textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
      </div>
      <div className="button-row">
        <button
          disabled={isLoading}
          onClick={() => {
            let parsed: unknown = draft;
            try { parsed = JSON.parse(draft); } catch { /* tolerate non-JSON */ }
            onAction('resolve', { refinement: parsed });
          }}
        >
          Submit refinement
        </button>
      </div>
    </div>
  );
}

// ── interrupt.cancellation ─────────────────────────────────────────────

function CancellationCard({ payload, onAction, isLoading }: CardProps): JSX.Element {
  const reason = (payload as InterruptPayload).data?.reason ?? 'A cancellation has been requested.';
  return (
    <div className="card" style={{ background: 'var(--color-surface-2)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>Cancellation requested</h3>
      <div className="alert warning" style={{ marginBottom: 8 }}>{reason}</div>
      <div className="button-row">
        <button disabled={isLoading} onClick={() => onAction('resolve', { acknowledged: true, confirm: true })}>
          Confirm cancel
        </button>
        <button className="secondary" disabled={isLoading} onClick={() => onAction('resolve', { acknowledged: true, confirm: false })}>
          Decline
        </button>
      </div>
    </div>
  );
}

// ── canonical resolver: bubbles up the action to the openwop interrupt API ──

async function resolveInterrupt(actionPayload: unknown, ctx: { runId: string; nodeId?: string }): Promise<boolean> {
  if (!ctx.nodeId) return false;
  await resolveByRun(ctx.runId, ctx.nodeId, actionPayload);
  return true;
}

// ── default registrations ──────────────────────────────────────────────

let registered = false;

export function registerDefaultCards(): void {
  if (registered) return;
  registerCard({
    cardType: 'interrupt.approval',
    label: 'Approval',
    Component: ApprovalCard,
    actionHandlers: { resolve: resolveInterrupt },
  });
  registerCard({
    cardType: 'interrupt.clarification',
    label: 'Clarification',
    Component: ClarificationCard,
    actionHandlers: { resolve: resolveInterrupt },
  });
  registerCard({
    cardType: 'interrupt.refinement',
    label: 'Refinement',
    Component: RefinementCard,
    actionHandlers: { resolve: resolveInterrupt },
  });
  registerCard({
    cardType: 'interrupt.cancellation',
    label: 'Cancellation',
    Component: CancellationCard,
    actionHandlers: { resolve: resolveInterrupt },
  });
  registered = true;
}
