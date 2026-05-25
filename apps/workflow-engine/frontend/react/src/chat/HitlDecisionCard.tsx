/**
 * HITL Decision Card — persistent record of a human-in-the-loop
 * resolution that stays in the chat thread.
 *
 * Replaces the interactive ApprovalCard / ClarificationDialog /
 * RefinementForm / CancellationBanner once an interrupt resolves.
 * The card is non-interactive — it's audit history, not a re-do
 * affordance. Survives page reload because it derives from the
 * workflow_run message's `interruptHistory` field (a render-time
 * index of SSE events; the BE event log remains source of truth).
 *
 * Architecture decision: derive, don't persist (Option B in the
 * architect review). The decision card mirrors what the event log
 * already carries — `node.completed` at the interrupt's nodeId, with
 * `payload.outputs.output` as the resumeValue. We just present it.
 */

import { isRecord } from './lib/typeGuards.js';
import type { InterruptHistoryEntry } from './types.js';

interface Props {
  entry: InterruptHistoryEntry;
}

const KIND_VERB: Record<string, string> = {
  approval: 'Approved',
  clarification: 'Clarified',
  refinement: 'Refined',
  cancellation: 'Confirmed cancellation',
  'external-event': 'Received',
};

const KIND_ICON: Record<string, string> = {
  approval: '✓',
  clarification: '✓',
  refinement: '✓',
  cancellation: '⊘',
  'external-event': '✓',
};

const KIND_COLOR: Record<string, string> = {
  approval: 'var(--color-success)',
  clarification: 'var(--color-accent)',
  refinement: 'var(--color-accent)',
  cancellation: 'var(--color-text-muted)',
  'external-event': 'var(--color-accent)',
};

export function HitlDecisionCard({ entry }: Props): JSX.Element {
  const verb = KIND_VERB[entry.kind] ?? 'Resolved';
  const icon = KIND_ICON[entry.kind] ?? '✓';
  const color = KIND_COLOR[entry.kind] ?? 'var(--color-success)';

  // Surface the user's choice when the resumeValue has the canonical
  // approval shape (`{action, content, selectedKey?, comment?}`).
  // Falls back to a JSON preview for unknown shapes — defensive per
  // the type-guard pattern from the architect review.
  const { decisionLabel, comment, rejected } = parseResumeValue(entry.resumeValue);

  // Approval card sends `action: 'reject'` for the reject button;
  // we surface that distinctly so the user sees they rejected, not
  // "Approved" (which would be misleading).
  const effectiveVerb = rejected ? 'Rejected' : verb;
  const effectiveIcon = rejected ? '✗' : icon;
  const effectiveColor = rejected ? 'var(--color-danger)' : color;

  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 14px',
        borderRadius: 10,
        background: `color-mix(in oklch, ${effectiveColor} 8%, transparent)`,
        border: `1px solid color-mix(in oklch, ${effectiveColor} 30%, var(--color-border))`,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span aria-hidden="true" style={{ color: effectiveColor, fontWeight: 700 }}>
          {effectiveIcon}
        </span>
        <strong style={{ color: effectiveColor }}>{effectiveVerb}</strong>
        {decisionLabel && (
          <span style={{ color: 'var(--color-text)' }}>{decisionLabel}</span>
        )}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          node <code>{entry.nodeId}</code>
          {entry.resolvedAt && (
            <> · {formatRelative(entry.resolvedAt)}</>
          )}
        </span>
      </div>
      {comment && (
        <div
          className="muted"
          style={{
            marginTop: 6,
            paddingLeft: 22,
            fontSize: 12,
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          “{comment}”
        </div>
      )}
    </div>
  );
}

/**
 * Pull a human-readable label + the audit comment out of an arbitrary
 * resumeValue. Handles the canonical approval shape from
 * `chat/registry/defaultCards.tsx`'s ApprovalCard:
 *   `{ action: 'approve' | 'reject', selectedKey?: string, comment?: string }`
 * Plus clarification ({content, comment?}) and refinement ({content}).
 * Unknown shapes degrade to no label (the verb alone is informative).
 */
function parseResumeValue(value: unknown): {
  decisionLabel: string | null;
  comment: string | null;
  rejected: boolean;
} {
  if (!isRecord(value)) {
    return { decisionLabel: null, comment: null, rejected: false };
  }
  const rejected = value.action === 'reject';
  const selectedKey = typeof value.selectedKey === 'string' ? value.selectedKey : null;
  const content = typeof value.content === 'string' ? value.content : null;
  const comment = typeof value.comment === 'string' && value.comment.length > 0 ? value.comment : null;

  // Approval: prefer the user's pick (e.g., "Clarity critic") over the
  // raw `content`, which is the nested-key value the FE walked the
  // resumeSchema to find. Clarification / refinement: surface the
  // typed `content` as the label.
  const decisionLabel = selectedKey ?? content ?? null;

  return { decisionLabel, comment, rejected };
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (Number.isNaN(then)) return iso;
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(diffMs / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
