/**
 * Workflow-run chat bubble — slim one-liner version.
 *
 * The full progress UI (step list, progress bar, per-node outputs,
 * active-interrupt approval card) now lives in the right-side
 * `WorkflowProgressPanel`. The bubble carries just enough to anchor
 * the run in the chat thread:
 *   ── workflow name + status pill
 *   ── "View progress →" link that opens the panel + focuses this run
 *   ── footer (slug, runId, builder link, elapsed)
 *
 * Rendered when a `workflow_run` ChatMessage is dispatched via the
 * `@mention` direct-dispatch path (`useChatSession.runWorkflowMention`).
 */

import { Link } from 'react-router-dom';
import { STATUS_COLORS, STATUS_LABELS } from './workflowProgress/StepList.js';
import { formatElapsed } from './workflowProgress/formatters.js';
import type { ChatMessage } from './hooks/useChatSession.js';

interface Props {
  message: ChatMessage;
  /** Open the progress panel + focus this bubble's run. When omitted
   *  (e.g., tests / passive renders) the bubble shows the link as
   *  inert text. */
  onOpenProgress?: (messageId: string) => void;
  /** True when this bubble's run is the one currently focused in the
   *  panel — flips the link copy so the user sees "Hide progress"
   *  instead of "View progress" in that state. */
  isFocusedInPanel?: boolean;
}

export function WorkflowRunBubble({ message, onOpenProgress, isFocusedInPanel }: Props): JSX.Element | null {
  const run = message.workflowRun;
  if (!run) return null;

  const completed = run.completedNodeIds.length;
  const total = run.totalNodes;
  const progressHint = total > 0
    ? `${completed}/${total}`
    : `${completed} step${completed === 1 ? '' : 's'}`;
  const isSuspended = !!message.activeInterrupt;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
      <div style={{
        maxWidth: 'var(--max-bubble-width, 75ch)',
        width: '100%',
        padding: '10px 14px',
        borderRadius: 'var(--radius-bubble, 16px)',
        background: 'var(--color-msg-assistant-bg, var(--color-surface-2))',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        fontSize: 14,
        lineHeight: 1.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{run.workflowName}</span>
          <span style={{
            padding: '1px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--color-surface)',
            color: STATUS_COLORS[run.status],
            border: `1px solid ${STATUS_COLORS[run.status]}`,
          }}>
            {STATUS_LABELS[run.status]}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>{progressHint}</span>
          {isSuspended && (
            <span style={{
              fontSize: 10,
              padding: '1px 8px',
              borderRadius: 10,
              background: 'var(--clay-wash, #f3e0d4)',
              color: 'var(--clay)',
              border: '1px solid var(--clay-rule, #d9b9a3)',
              whiteSpace: 'nowrap',
            }}>
              Awaiting your input
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            {onOpenProgress ? (
              <button
                type="button"
                onClick={() => onOpenProgress(message.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-accent, var(--clay))',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--clay-rule, #d9b9a3)',
                }}
                aria-pressed={isFocusedInPanel}
                title={isFocusedInPanel ? 'Already showing in the side panel' : 'Open the progress panel'}
              >
                {isFocusedInPanel ? 'Showing in panel →' : 'View progress →'}
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>View progress →</span>
            )}
          </span>
        </div>

        <div className="muted" style={{ marginTop: 4, fontSize: 11, opacity: 0.75, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
          <code>@{run.slug}</code>
          {run.runId && (
            <>
              <span>·</span>
              <Link to={`/runs/${run.runId}`} title="Open run detail">
                run {run.runId.slice(0, 12)}
              </Link>
            </>
          )}
          {run.workflowId && run.workflowId.startsWith('wf_') && (
            <>
              <span>·</span>
              <Link to={`/builder/${run.workflowId}`} title="Open this workflow in the builder">
                open in builder →
              </Link>
            </>
          )}
          <span>·</span>
          <span>{formatElapsed(run.startedAt)}</span>
        </div>
      </div>
    </div>
  );
}
