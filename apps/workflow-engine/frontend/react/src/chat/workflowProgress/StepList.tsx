/**
 * Per-node step list with click-to-expand outputs. Each completed node
 * whose run captured an `outputs` payload becomes inspectable inline
 * so the user can read what each upstream step produced before making
 * an HITL approval decision.
 *
 * Extracted from `WorkflowRunBubble` so both the slim chat bubble and
 * the right-side `WorkflowProgressPanel` can render the same list shape
 * — only the panel actually mounts it; the bubble keeps a one-liner.
 */

import { useState } from 'react';
import type { ChatMessage, WorkflowRunState } from '../hooks/useChatSession.js';

export const STATUS_COLORS: Record<WorkflowRunState['status'], string> = {
  pending: 'var(--color-text-muted)',
  running: 'var(--color-accent)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
  cancelled: 'var(--color-warning)',
};

export const STATUS_LABELS: Record<WorkflowRunState['status'], string> = {
  pending: 'Starting…',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface Props {
  run: WorkflowRunState;
  message: ChatMessage;
}

export function StepList({ run, message }: Props): JSX.Element {
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

        // A11y wiring for the disclosure pattern. Screen readers
        // announce the row as a button + report its expanded state +
        // point at the panel that materializes when expanded. The
        // panel id ties row → `<pre>` so AT navigation works.
        const panelId = `step-output-${nodeId}`;
        return (
          <li key={nodeId}>
            <div
              role={hasOutputs ? 'button' : undefined}
              tabIndex={hasOutputs ? 0 : -1}
              aria-expanded={hasOutputs ? isExpanded : undefined}
              aria-controls={hasOutputs ? panelId : undefined}
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
              <pre id={panelId} style={{
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
export function formatOutputs(outputs: unknown): string {
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
