/**
 * Workflow-run chat bubble.
 *
 * Rendered when a `workflow_run` ChatMessage is dispatched via the
 * `@mention` direct-dispatch path (`useChatSession.runWorkflowMention`).
 *
 * Layout:
 *   ── header ──   workflow name + status pill
 *   ── progress ── "Step N of M — currentNodeName" + progress bar
 *   ── outputs ──  JSON view (only when status==='completed')
 *   ── error ──    code + message (only when status==='failed')
 *   ── footer ──   slug + elapsed time
 *
 * Interrupt cards render BELOW the bubble via MessageFeed's existing
 * `activeInterrupt` → CardHost path; no special handling here.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatMessage, WorkflowRunState } from './hooks/useChatSession.js';

interface Props {
  message: ChatMessage;
  /** Caller cancels the in-flight run (no-op if status !== 'running').
   *  Optional so tests / passive renders can omit. */
  onCancel?: () => void | Promise<void>;
}

const STATUS_LABELS: Record<WorkflowRunState['status'], string> = {
  pending: 'Starting…',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<WorkflowRunState['status'], string> = {
  pending: 'var(--color-text-muted)',
  running: 'var(--color-accent)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
  cancelled: 'var(--color-warning)',
};

function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '';
  const secs = Math.floor(elapsedMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function WorkflowRunBubble({ message, onCancel }: Props): JSX.Element | null {
  const run = message.workflowRun;
  if (!run) return null;
  const canCancel = run.status === 'running' && !!run.runId && !!onCancel;

  const completed = run.completedNodeIds.length;
  const total = run.totalNodes;
  // For sample workflows we don't know total ahead of time; fall back to
  // showing just "completed" without "of M".
  const stepLabel = total > 0
    ? `Step ${Math.min(completed + 1, total)} of ${total}`
    : `${completed} step${completed === 1 ? '' : 's'} completed`;
  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  const isTerminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const showRunning = run.status === 'running' || run.status === 'pending';

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-start',
      marginBottom: 12,
    }}>
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
        {/* Header: name + status pill (+ optional Cancel) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {run.workflowName}
          </span>
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
          {canCancel && (
            <button
              type="button"
              className="secondary"
              style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 10px', minHeight: 0 }}
              onClick={() => { void onCancel?.(); }}
              title="Cancel this run"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Progress */}
        {showRunning && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span className="muted">
                {stepLabel}
                {run.currentNodeName && <> — <strong style={{ fontWeight: 600 }}>{run.currentNodeName}</strong></>}
              </span>
              {total > 0 && <span className="muted">{progressPct}%</span>}
            </div>
            <div style={{
              height: 4,
              background: 'var(--color-surface)',
              borderRadius: 2,
              overflow: 'hidden',
              marginBottom: 6,
            }}>
              <div style={{
                width: total > 0 ? `${progressPct}%` : '30%',
                height: '100%',
                background: STATUS_COLORS[run.status],
                transition: 'width 200ms ease',
                animation: total === 0 ? 'openwop-pulse 1.2s ease-in-out infinite' : 'none',
              }} />
            </div>
          </>
        )}

        {/* Final progress summary (terminal states) */}
        {isTerminal && total > 0 && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            {completed} of {total} step{total === 1 ? '' : 's'} completed
          </div>
        )}

        {/* Per-node step list — shows EVERY node's state so the user
            can see exactly where the workflow is, including stuck
            steps. The activeInterrupt card (below this bubble) renders
            the resolution UI for whichever node is suspended; the
            "Awaiting your input" badge on the suspended row points
            the user's eye at it. */}
        {Object.keys(run.nodeNames).length > 0 && (
          <StepList run={run} message={message} />
        )}

        {/* Outputs (completed) */}
        {run.status === 'completed' && run.outputs && Object.keys(run.outputs).length > 0 && (
          <pre style={{
            marginTop: 6,
            padding: 8,
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius)',
            fontSize: 11,
            maxHeight: 200,
            overflow: 'auto',
            border: '1px solid var(--color-border)',
          }}>
            {JSON.stringify(run.outputs, null, 2)}
          </pre>
        )}

        {/* Error */}
        {run.status === 'failed' && run.error && (
          <div style={{
            marginTop: 6,
            padding: 8,
            background: 'rgba(248, 113, 113, 0.08)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius)',
            fontSize: 12,
          }}>
            <strong>{run.error.code}:</strong> {run.error.message}
          </div>
        )}

        {/* Footer: slug + run id + elapsed + bridges to the run detail
            page and (when this was a builder-saved workflow) to the
            visual canvas the user dispatched. Closes the loop between
            "I ran this in chat" and "I can see what it looks like". */}
        <div className="muted" style={{ marginTop: 6, fontSize: 11, opacity: 0.75, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
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

/** Per-node step list with click-to-expand outputs. Each completed
 *  node whose run captured an `outputs` payload becomes inspectable
 *  inline so the user can read what each upstream step produced before
 *  making an HITL approval decision. */
function StepList({ run, message }: { run: WorkflowRunState; message: ChatMessage }): JSX.Element {
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const completedSet = new Set(run.completedNodeIds);
  const failedSet = new Set(run.failedNodeIds);
  return (
    <ul style={{
      listStyle: 'none',
      margin: '8px 0 4px',
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      fontSize: 12,
    }}>
      {Object.entries(run.nodeNames).map(([nodeId, friendlyName], idx) => {
        const isCompleted = completedSet.has(nodeId);
        const isFailed = failedSet.has(nodeId);
        const isSuspended = message.activeInterrupt?.nodeId === nodeId;
        const isCurrent = !isCompleted && !isFailed && !isSuspended &&
          run.currentNodeName === friendlyName;
        const isPending = !isCompleted && !isFailed && !isSuspended && !isCurrent;
        const outputs = run.nodeOutputs?.[nodeId];
        const hasOutputs = outputs !== undefined && outputs !== null
          && (typeof outputs !== 'object' || Object.keys(outputs).length > 0);
        const isExpanded = expandedNodeId === nodeId;

        const stateChip = isCompleted ? { label: '✓', color: STATUS_COLORS.completed }
          : isFailed ? { label: '✕', color: STATUS_COLORS.failed }
          : isSuspended ? { label: '⏸', color: STATUS_COLORS.running }
          : isCurrent ? { label: '●', color: STATUS_COLORS.running }
          : { label: '○', color: 'var(--ink-3, #8a857a)' };

        return (
          <li key={nodeId}>
            <div
              role={hasOutputs ? 'button' : undefined}
              tabIndex={hasOutputs ? 0 : -1}
              onClick={hasOutputs ? () => setExpandedNodeId(isExpanded ? null : nodeId) : undefined}
              onKeyDown={hasOutputs ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedNodeId(isExpanded ? null : nodeId);
                }
              } : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '2px 0',
                opacity: isPending ? 0.55 : 1,
                fontWeight: isCurrent || isSuspended ? 600 : 400,
                cursor: hasOutputs ? 'pointer' : 'default',
              }}
            >
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                fontSize: 11,
                color: stateChip.color,
              }} aria-hidden>
                {stateChip.label}
              </span>
              <span style={{
                width: 22,
                color: 'var(--ink-3, #8a857a)',
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
              }}>
                {String(idx + 1).padStart(2, ' ')}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {friendlyName}
              </span>
              {hasOutputs && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--clay)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--clay-rule, #d9b9a3)',
                }} aria-hidden>
                  {isExpanded ? '▾ hide' : '▸ view output'}
                </span>
              )}
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
                  Awaiting your input ↓
                </span>
              )}
              {isCurrent && (
                <span style={{ fontSize: 10, color: STATUS_COLORS.running }} aria-hidden>
                  Running…
                </span>
              )}
            </div>
            {isExpanded && hasOutputs && (
              <pre style={{
                margin: '4px 0 6px 26px',
                padding: '8px 10px',
                background: 'var(--paper-2, var(--color-surface, #ece8de))',
                border: '1px solid var(--rule, var(--color-border))',
                borderRadius: 4,
                fontSize: 11,
                fontFamily: 'var(--mono, monospace)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflow: 'auto',
              }}>
                {formatOutputs(outputs)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Friendly render of a node output. If outputs has a single string-
 *  valued field (the common "text" / "completion" case), show that
 *  string raw. Otherwise pretty-print the whole object as JSON. */
function formatOutputs(outputs: unknown): string {
  if (typeof outputs !== 'object' || outputs === null) {
    return String(outputs);
  }
  const rec = outputs as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length === 1) {
    const only = rec[keys[0]!];
    if (typeof only === 'string') return only;
  }
  try {
    return JSON.stringify(rec, null, 2);
  } catch {
    return String(rec);
  }
}
