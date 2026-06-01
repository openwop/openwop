/**
 * Inline cards for the agent.* event family (RFC 0002 §B), rendered
 * under the assistant bubble:
 *
 *   - ToolCallCard      `agent.toolCalled` + matching `agent.toolReturned`
 *   - HandoffIndicator  `agent.handoff`
 *   - DecisionBadge     `agent.decided`
 *
 * Three cards, three shapes, all consistent with the ThoughtsDisclosure
 * visual idiom (muted by default, expand-on-click for detail). Zero
 * new deps; CSS-only animations gated on prefers-reduced-motion.
 */

import { useState } from 'react';
import type {
  AgentDecision,
  AgentHandoff,
  AgentToolCall,
} from './hooks/useChatSession.js';
import { ScaleIcon, WrenchIcon } from '../ui/icons/index.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function jsonPreview(value: unknown, max = 200): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── Tool call card ─────────────────────────────────────────────────

export function ToolCallCard({ call }: { call: AgentToolCall }): JSX.Element {
  const [open, setOpen] = useState(false);
  const inFlight = call.finishedAt == null;
  const durationMs = call.finishedAt
    ? Date.parse(call.finishedAt) - Date.parse(call.startedAt)
    : 0;
  const isError = !!call.error;
  const accent = isError ? 'var(--color-danger)' : 'var(--color-accent)';

  return (
    <div
      style={{
        marginTop: 6,
        padding: '6px 10px',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${accent}`,
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          minHeight: 0,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span className="muted" style={{ display: 'inline-flex' }} aria-hidden>
          <WrenchIcon size={12} />
        </span>
        <span style={{ fontWeight: 600 }}>{call.toolName}</span>
        {call.agentId && (
          // RFC 0040 cross-host causation — surface which agent issued the
          // call. Mono-font chip matches the HandoffIndicator idiom.
          <span
            className="muted"
            style={{ fontFamily: 'var(--mono)', fontSize: 10 }}
            title={`Called by ${call.agentId}`}
          >
            @{call.agentId}
          </span>
        )}
        <span
          className="muted"
          style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}
        >
          {inFlight ? 'running…' : isError ? 'failed' : formatDuration(durationMs)}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {call.inputs !== undefined && (
            <details>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>Inputs</summary>
              <pre
                style={{
                  margin: '4px 0 0',
                  padding: 6,
                  fontSize: 11,
                  background: 'var(--color-surface)',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {jsonPreview(call.inputs, 2000)}
              </pre>
            </details>
          )}
          {call.outcome !== undefined && !isError && (
            <details>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>Result</summary>
              <pre
                style={{
                  margin: '4px 0 0',
                  padding: 6,
                  fontSize: 11,
                  background: 'var(--color-surface)',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {jsonPreview(call.outcome, 2000)}
              </pre>
            </details>
          )}
          {isError && call.error && (
            <div
              style={{
                padding: 6,
                background: 'color-mix(in oklch, var(--color-danger) 8%, transparent)',
                border: '1px solid var(--color-danger)',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <strong>{call.error.code}:</strong> {call.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Handoff indicator ───────────────────────────────────────────────

export function HandoffIndicator({ handoff }: { handoff: AgentHandoff }): JSX.Element {
  return (
    <div
      style={{
        marginTop: 6,
        padding: '4px 10px',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        fontSize: 11,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text-muted)',
      }}
      title={handoff.reason}
    >
      <span style={{ fontFamily: 'var(--mono)' }}>{handoff.fromAgentId}</span>
      <span aria-hidden style={{ opacity: 0.6 }}>→</span>
      <span style={{ fontFamily: 'var(--mono)' }}>{handoff.toAgentId}</span>
      {handoff.reason && (
        <span className="muted" style={{ marginLeft: 4, fontSize: 10, fontStyle: 'italic' }}>
          {handoff.reason}
        </span>
      )}
    </div>
  );
}

// ── Decision badge ──────────────────────────────────────────────────

export function DecisionBadge({ decision }: { decision: AgentDecision }): JSX.Element {
  const [open, setOpen] = useState(false);
  const conf = decision.confidence;
  const confColor =
    conf == null ? 'var(--color-text-muted)' :
    conf >= 0.7 ? 'var(--color-success)' :
    conf >= 0.5 ? 'var(--color-warning)' :
                  'var(--color-danger)';
  const decisionLabel = typeof decision.decision === 'string'
    ? decision.decision
    : typeof decision.decision === 'object' && decision.decision && 'next' in (decision.decision as Record<string, unknown>)
      ? String((decision.decision as Record<string, unknown>).next)
      : 'decision';

  return (
    <div
      style={{
        marginTop: 6,
        padding: '6px 10px',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          minHeight: 0,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span className="muted" style={{ display: 'inline-flex' }} aria-hidden><ScaleIcon size={12} /></span>
        <span style={{ fontWeight: 600 }}>Decision: {decisionLabel}</span>
        {conf != null && (
          <span
            style={{
              marginLeft: 'auto',
              padding: '1px 6px',
              borderRadius: 10,
              background: 'var(--color-surface)',
              border: `1px solid ${confColor}`,
              color: confColor,
              fontSize: 10,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(conf * 100)}%
          </span>
        )}
      </button>
      {open && (
        <details open style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 11 }}>Raw decision</summary>
          <pre
            style={{
              margin: '4px 0 0',
              padding: 6,
              fontSize: 11,
              background: 'var(--color-surface)',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            {jsonPreview(decision.decision, 2000)}
          </pre>
        </details>
      )}
    </div>
  );
}
