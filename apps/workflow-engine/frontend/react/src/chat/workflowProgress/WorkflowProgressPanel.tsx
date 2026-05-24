/**
 * Right-side workflow-progress panel. Slide-out drawer mirroring
 * `SessionHistoryDrawer` on the left, with the chat's per-workflow_run
 * progress UI moved out of the chat bubble.
 *
 * Hosts:
 *   - Run switcher when the session has more than one `workflow_run`
 *     message. Selecting a row focuses that run.
 *   - Header: workflow name + status pill + "Step N of M — currentNode"
 *     + progress bar.
 *   - StepList (per-node check/pending/running/suspended icons with
 *     expandable outputs).
 *   - Active-interrupt CardHost — wired through the same `CardHost`
 *     /`registerDefaultCards` registry the chat-turn path uses, so
 *     `approval` / `clarification` / `refinement` / `cancellation`
 *     interrupts and any vendor-registered kinds render without
 *     per-card edits here.
 *   - Outputs / error / footer (runId + builder link + elapsed).
 */

import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CardHost } from '../registry/CardHost.js';
import { StepList, STATUS_COLORS, STATUS_LABELS } from './StepList.js';
import { formatElapsed } from './formatters.js';
import type { ChatMessage } from '../hooks/useChatSession.js';

interface Props {
  /** Every `workflow_run` message in the current session. Most-recent
   *  first ordering is the caller's responsibility. */
  workflowRunMessages: readonly ChatMessage[];
  /** Currently-focused workflow_run message id. When the session has
   *  >1 workflow_run messages the panel renders a run-switcher header. */
  focusedMessageId: string | null;
  tenantId: string;
  /** Switch the focused run via the run-switcher. */
  onFocus: (messageId: string) => void;
  /** Close the panel (chevron or Esc). */
  onClose: () => void;
  /** Resolve the focused run's active interrupt. */
  onResolveInterrupt: (messageId: string, value: unknown) => Promise<void>;
  /** Cancel an in-flight workflow_run. */
  onCancel: (messageId: string) => Promise<void>;
  /** True when the viewport is narrow — render as full-screen overlay. */
  isMobile: boolean;
}

export function WorkflowProgressPanel({
  workflowRunMessages,
  focusedMessageId,
  tenantId,
  onFocus,
  onClose,
  onResolveInterrupt,
  onCancel,
  isMobile,
}: Props): JSX.Element {
  // Esc closes the panel — but ONLY when focus is inside it. A
  // global `window.keydown` would fight `ChatInput`'s own Esc handling
  // (cancel in-flight turn) and close the panel as a side-effect of
  // the user trying to abort their message. Binding via an onKeyDown
  // on the aside (with tabIndex=-1 + initial autofocus on the close
  // button so keyboard users land here on open) keeps the keypress
  // properly scoped.
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Focus the close button on mount so keyboard users immediately
    // own the keypress + the panel root is the active scope.
    closeBtnRef.current?.focus();
  }, []);

  const focused = useMemo(
    () => workflowRunMessages.find((m) => m.id === focusedMessageId) ?? workflowRunMessages[0] ?? null,
    [workflowRunMessages, focusedMessageId],
  );

  const headingId = 'workflow-progress-panel-heading';

  return (
    <aside
      className="workflow-progress-panel"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={{
        width: isMobile ? '100%' : 360,
        height: '100%',
        borderLeft: isMobile ? 'none' : '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        position: isMobile ? 'absolute' : 'relative',
        inset: isMobile ? 0 : 'auto',
        zIndex: isMobile ? 20 : 'auto',
        outline: 'none',
      }}
      aria-labelledby={headingId}
    >
      <header
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong id={headingId} style={{ flex: 1, fontSize: 13 }}>Workflow progress</strong>
        <button
          ref={closeBtnRef}
          type="button"
          className="secondary"
          onClick={onClose}
          aria-label="Close workflow progress"
          style={{ padding: '2px 8px', fontSize: 11, minHeight: 0, height: 22 }}
        >
          ×
        </button>
      </header>

      {workflowRunMessages.length === 0 ? (
        <div className="muted" style={{ padding: 16, fontSize: 12 }}>
          No workflow runs in this chat yet. Type <code>@</code> to dispatch one.
        </div>
      ) : (
        <>
          {workflowRunMessages.length > 1 && (
            <RunSwitcher
              messages={workflowRunMessages}
              focusedMessageId={focused?.id ?? null}
              onFocus={onFocus}
            />
          )}
          {focused && <FocusedRunView
            message={focused}
            tenantId={tenantId}
            onResolveInterrupt={onResolveInterrupt}
            onCancel={onCancel}
          />}
        </>
      )}
    </aside>
  );
}

function RunSwitcher({
  messages,
  focusedMessageId,
  onFocus,
}: {
  messages: readonly ChatMessage[];
  focusedMessageId: string | null;
  onFocus: (messageId: string) => void;
}): JSX.Element {
  return (
    <nav
      aria-label="Runs in this chat"
      style={{
        padding: '6px 4px',
        borderBottom: '1px solid var(--color-border)',
        maxHeight: 120,
        overflowY: 'auto',
      }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {messages.map((m) => {
          const run = m.workflowRun;
          if (!run) return null;
          const isActive = m.id === focusedMessageId;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onFocus(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 8px',
                  fontSize: 12,
                  background: isActive
                    ? 'color-mix(in oklch, var(--color-clay) 18%, transparent)'
                    : 'transparent',
                  border: 'none',
                  borderLeft: isActive
                    ? '2px solid var(--color-clay)'
                    : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  minHeight: 0,
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: STATUS_COLORS[run.status],
                  flexShrink: 0,
                }} aria-hidden />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.workflowName}
                </span>
                <span className="muted" style={{ fontSize: 10 }}>
                  {STATUS_LABELS[run.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FocusedRunView({
  message,
  tenantId,
  onResolveInterrupt,
  onCancel,
}: {
  message: ChatMessage;
  tenantId: string;
  onResolveInterrupt: (messageId: string, value: unknown) => Promise<void>;
  onCancel: (messageId: string) => Promise<void>;
}): JSX.Element | null {
  const run = message.workflowRun;
  if (!run) return null;

  const completed = run.completedNodeIds.length;
  const total = run.totalNodes;
  const stepLabel = total > 0
    ? `Step ${Math.min(completed + 1, total)} of ${total}`
    : `${completed} step${completed === 1 ? '' : 's'} completed`;
  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const isTerminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const showRunning = run.status === 'running' || run.status === 'pending';
  const canCancel = run.status === 'running' && !!run.runId;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              onClick={() => { void onCancel(message.id); }}
              title="Cancel this run"
            >
              Cancel
            </button>
          )}
        </div>

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
              background: 'var(--color-surface-2)',
              borderRadius: 2,
              overflow: 'hidden',
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

        {isTerminal && total > 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            {completed} of {total} step{total === 1 ? '' : 's'} completed
          </div>
        )}
      </div>

      {/* Active interrupt — rendered through the registry so any
          registered card type (approval / clarification / refinement /
          cancellation / vendor) works. */}
      {message.activeInterrupt && (
        <div>
          <CardHost
            cardType={`interrupt.${message.activeInterrupt.kind}`}
            payload={message.activeInterrupt}
            context={{
              runId: run.runId ?? '',
              nodeId: message.activeInterrupt.nodeId,
              tenantId,
            }}
            onAction={async (_actionId, payload) => {
              await onResolveInterrupt(message.id, payload);
            }}
          />
        </div>
      )}

      {/* Per-node step list */}
      {Object.keys(run.nodeNames).length > 0 && (
        <StepList run={run} message={message} />
      )}

      {/* Outputs (completed) */}
      {run.status === 'completed' && run.outputs && Object.keys(run.outputs).length > 0 && (
        <pre style={{
          padding: 8,
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          fontSize: 11,
          maxHeight: 200,
          overflow: 'auto',
          border: '1px solid var(--color-border)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}>
          {JSON.stringify(run.outputs, null, 2)}
        </pre>
      )}

      {/* Error */}
      {run.status === 'failed' && run.error && (
        <div style={{
          padding: 8,
          background: 'rgba(248, 113, 113, 0.08)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
        }}>
          <strong>{run.error.code}:</strong> {run.error.message}
        </div>
      )}

      {/* Footer */}
      <div className="muted" style={{ marginTop: 'auto', fontSize: 11, opacity: 0.75, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline', paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
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
  );
}

