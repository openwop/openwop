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

interface ApprovalOption {
  key: string;
  label: string;
  content: string;
}

interface InterruptPayload {
  data?: {
    prompt?: string;
    question?: string;
    actions?: readonly string[];
    current?: unknown;
    reason?: string;
    /** When set, the approval node has bundled its upstream input ports
     *  as discrete options the approver should pick between. Rendered
     *  as expandable cards with a per-option "Pick" button. The chosen
     *  option's `content` becomes the resume value so downstream nodes
     *  receive the selected text directly.
     *
     *  **Producer↔consumer coupling** — the BE `approvalGateNode`
     *  (`apps/workflow-engine/backend/typescript/src/bootstrap/nodes.ts`)
     *  bundles this array when 2+ string-valued input ports land on the
     *  approval node. This consumer (`ApprovalCard` below) renders it
     *  as a per-option picker. Both sides MUST move together when the
     *  shape changes — there's no spec/v1 schema for this field yet
     *  (sample-app contract; spec promotion is a follow-up). */
    options?: readonly ApprovalOption[];
  };
}

// ── interrupt.approval ─────────────────────────────────────────────────

function ApprovalCard({ payload, onAction, isLoading }: CardProps): JSX.Element {
  const data = (payload as InterruptPayload).data ?? {};
  const [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const prompt = data.prompt ?? 'Please approve to continue.';
  const actions = (data.actions ?? ['approve', 'reject', 'request-changes', 'defer', 'escalate']);
  const options = data.options ?? [];
  // Picker only makes sense when there are ≥2 alternatives to choose
  // between. A single string input on the approval node falls through
  // to the plain approve/reject path — the approver has nothing to
  // *pick* among, just to approve or reject the run continuing.
  const hasOptions = options.length >= 2;

  return (
    <div className="card" style={{ background: 'var(--color-surface-2)' }}>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>Approval required</h3>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 13 }}>{prompt}</p>

      {hasOptions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0 12px' }}>
          {options.map((opt) => {
            const isOpen = expanded[opt.key] ?? false;
            return (
              <div
                key={opt.key}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  background: 'var(--paper-2, var(--color-surface, transparent))',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{opt.label}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setExpanded((s) => ({ ...s, [opt.key]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'hide' : 'view'}
                    </button>
                    <button
                      type="button"
                      style={{ fontSize: 11, padding: '2px 10px' }}
                      disabled={isLoading}
                      // Resume payload shape is wedged between two
                      // constraints:
                      //   1. BE `validateResumeValue` (routes/interrupts.ts
                      //      §approval) REQUIRES `resumeValue.action`
                      //      to be one of `data.actions` (`approve` /
                      //      `reject`). A bare string is rejected with
                      //      400 and the workflow stays suspended.
                      //   2. Downstream consumers read the approval
                      //      node's output as `{output: <resumeValue>}`
                      //      via the standard edge path. We want the
                      //      *picked content* to be what the next
                      //      uppercase / chat / final-format node sees
                      //      on its input port.
                      // Solution: send `{action: 'approve', content,
                      // selectedKey, ...}`. `action` satisfies #1;
                      // `content` is the nested key the executor's
                      // findFirstStringValue() walks last (`['prompt',
                      // 'text', 'message', 'content', 'completion']`),
                      // so downstream nodes pull the picked text out
                      // automatically. `selectedKey` rides along for
                      // audit / debugging.
                      onClick={() => onAction('resolve', {
                        action: 'approve',
                        content: opt.content,
                        selectedKey: opt.key,
                        ...(comment ? { comment } : {}),
                      })}
                    >
                      Pick this
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <pre style={{
                    margin: '8px 0 0',
                    padding: '6px 8px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 240,
                    overflow: 'auto',
                  }}>{opt.content}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="form-row">
        <label>Comment (optional)</label>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Visible in audit trail"
        />
      </div>
      <div className="button-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {actions
          // When the picker is active, hide the bottom "approve"
          // button — its semantics are contradictory (downstream
          // would forward the literal string "approve" instead of
          // any critic's content). Force the user to either Pick
          // one or Reject. Other actions (`reject`, `request-changes`,
          // etc.) still render.
          .filter((action) => !(hasOptions && action === 'approve'))
          .map((action) => (
            <button
              key={action}
              className={action === 'approve' && !hasOptions ? '' : 'secondary'}
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
