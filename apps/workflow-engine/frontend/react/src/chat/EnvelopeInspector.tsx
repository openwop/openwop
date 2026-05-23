/**
 * EnvelopeInspector — per-bubble "Show envelope events" toggle.
 *
 * Surfaces the wire-shape `agent.*` events that produced this assistant
 * turn, plus links to the exceptional envelope-reliability events the
 * EnvelopeEventsTimeline already renders separately. Hidden by default;
 * a small "Show envelope" link reveals the panel.
 *
 * The intent is to make the envelope wire-shape inspectable from the
 * normal bubble without making the user hunt for a separate timeline
 * page or open DevTools. Maps to RFC 0002 §B (the canonical agent.*
 * event family) + RFCs 0030–0033 (reliability + capability events).
 *
 * Not a debug-only feature — it teaches developers what OpenWOP
 * actually streams, which is the whole point of the demo.
 */

import { useState } from 'react';
import type { ChatMessage } from './types.js';
import { hasEnvelopeEvents } from './EnvelopeEventsTimeline.js';

interface Props {
  message: ChatMessage;
}

/** Anything envelope-y worth surfacing? Used to gate the toggle's
 *  visibility — if the bubble has nothing the inspector would render,
 *  hide the toggle entirely so we don't clutter trivial turns. */
function hasInspectableEnvelope(m: ChatMessage): boolean {
  if (m.role !== 'assistant') return false;
  if (m.thoughts) return true;
  if (m.reasoning) return true;
  if (m.agentEvents) {
    if (m.agentEvents.toolCalls.length > 0) return true;
    if (m.agentEvents.handoffs.length > 0) return true;
    if (m.agentEvents.decisions.length > 0) return true;
  }
  if (hasEnvelopeEvents(m.envelopeEvents)) return true;
  // Even a plain text turn has the `agent.message` envelope. Show the
  // toggle so users can see provider/model/token metadata in envelope
  // framing — that's the wire-shape they care about.
  if (m.meta?.provider || m.meta?.inputTokens != null) return true;
  return false;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return iso;
  }
}

export function EnvelopeInspector({ message }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!hasInspectableEnvelope(message)) return null;

  const rows: Array<{ kind: string; at?: string; detail: string }> = [];

  // Synthetic agent.message row — every assistant turn emits one. The
  // backend's envelopeProjection assembles it from streaming deltas;
  // here we project from final meta so the user sees the wire-shape
  // anchor even when no exceptional events fired.
  if (message.meta) {
    const detail: string[] = [];
    if (message.meta.provider && message.meta.model) {
      detail.push(`${message.meta.provider}/${message.meta.model}`);
    }
    if (message.meta.inputTokens != null) detail.push(`in ${message.meta.inputTokens}`);
    if (message.meta.outputTokens != null) detail.push(`out ${message.meta.outputTokens}`);
    rows.push({ kind: 'agent.message', detail: detail.join(' · ') || '(no metadata)' });
  }

  if (message.thoughts) {
    rows.push({
      kind: 'agent.reasoned',
      at: message.thoughts.startedAt,
      detail: `${message.thoughts.content.length} chars from ${message.thoughts.agentId ?? 'agent'}`,
    });
  }
  if (message.reasoning) {
    rows.push({
      kind: 'envelope.reasoning',
      detail: `${message.reasoning.length} chars (RFC 0030 §A carry-reasoning)`,
    });
  }

  if (message.agentEvents) {
    for (const tc of message.agentEvents.toolCalls) {
      rows.push({
        kind: 'agent.toolCalled',
        at: tc.startedAt,
        detail: `${tc.toolName} (callId=${tc.callId.slice(0, 8)}…)`,
      });
      if (tc.finishedAt) {
        rows.push({
          kind: 'agent.toolReturned',
          at: tc.finishedAt,
          detail: tc.error ? `error: ${tc.error.code}` : 'ok',
        });
      }
    }
    for (const h of message.agentEvents.handoffs) {
      rows.push({
        kind: 'agent.handoff',
        at: h.at,
        detail: `${h.fromAgentId} → ${h.toAgentId}${h.reason ? ` (${h.reason})` : ''}`,
      });
    }
    for (const d of message.agentEvents.decisions) {
      rows.push({
        kind: 'agent.decided',
        at: d.at,
        detail: d.confidence != null ? `confidence ${d.confidence.toFixed(2)}` : '(no confidence)',
      });
    }
  }

  if (message.envelopeEvents) {
    const e = message.envelopeEvents;
    for (const r of e.retries) {
      rows.push({ kind: 'envelope.retry', at: r.at, detail: `attempt ${r.attempt}: ${r.reason}` });
    }
    for (const rx of e.retriesExhausted) {
      rows.push({
        kind: 'envelope.retryExhausted',
        at: rx.at,
        detail: `${rx.totalAttempts} attempts: ${rx.finalReason}${rx.finalError ? ` (${rx.finalError})` : ''}`,
      });
    }
    for (const rf of e.refusals) {
      rows.push({
        kind: 'envelope.refusal',
        at: rf.at,
        detail: rf.safetyCategory ? `${rf.safetyCategory}: ${rf.refusalText ?? '(no text)'}` : rf.refusalText ?? '(no text)',
      });
    }
    for (const t of e.truncations) {
      rows.push({
        kind: 'envelope.truncation',
        at: t.at,
        detail: `${t.stopReason}${t.outputTokenCount != null ? ` @ ${t.outputTokenCount} tok` : ''}`,
      });
    }
    for (const nl of e.nlCoercions) {
      rows.push({
        kind: 'envelope.nlCoercion',
        at: nl.at,
        detail: `${nl.originalEnvelopeType} → prose-coerced${nl.fallbackCalls != null ? ` (${nl.fallbackCalls} fallback call${nl.fallbackCalls === 1 ? '' : 's'})` : ''}`,
      });
    }
    for (const rec of e.recoveries) {
      rows.push({
        kind: 'envelope.recovery',
        at: rec.at,
        detail: `${rec.path}${rec.byteOffset != null ? ` @ byte ${rec.byteOffset}` : ''}`,
      });
    }
    for (const s of e.capabilitySubstitutions) {
      rows.push({
        kind: 'envelope.capabilitySubstitution',
        at: s.at,
        detail: `${s.originalProvider}/${s.originalModel} → ${s.fallbackProvider}/${s.fallbackModel} (missing: ${s.missingCapabilities.join(', ')})`,
      });
    }
    for (const ci of e.capabilitiesInsufficient) {
      rows.push({
        kind: 'envelope.capabilityInsufficient',
        at: ci.at,
        detail: `${ci.provider}/${ci.model} missing: ${ci.missingCapabilities.join(', ')}`,
      });
    }
  }

  return (
    <div className="envelope-inspector">
      <button
        type="button"
        className="envelope-inspector-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="envelope-inspector-toggle-icon" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {open ? 'Hide envelope' : 'Show envelope'}
        <span className="envelope-inspector-toggle-count">{rows.length}</span>
      </button>
      {open && (
        <div className="envelope-inspector-panel" role="region" aria-label="Envelope events">
          <div className="envelope-inspector-help">
            Wire-shape <code>agent.*</code> + <code>envelope.*</code> events
            this turn emitted. Per RFC 0002 §B + RFCs 0030–0033.
          </div>
          <ol className="envelope-inspector-rows">
            {rows.map((r, i) => (
              <li key={`${r.kind}-${i}`} className="envelope-inspector-row">
                <span className="envelope-inspector-kind">{r.kind}</span>
                <span className="envelope-inspector-detail">{r.detail}</span>
                <span className="envelope-inspector-at">{formatTime(r.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
