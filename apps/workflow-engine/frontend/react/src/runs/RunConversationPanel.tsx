/**
 * Per-run multi-turn conversation view.
 *
 * Consumes `conversation.opened` / `conversation.exchanged` /
 * `conversation.closed` events (RFC 0005, `schemas/conversation-event.schema.json`)
 * and renders one card per active `conversationId` with the turn history in
 * order: `initialTurn` (turnIndex 0) → exchanged (turnIndex 1+) → finalTurn.
 *
 * When the run's active interrupt is `kind: 'conversation.exchange'`, the
 * panel surfaces an inline resume form (text input when `outcomeSchema` is
 * absent or a single-string scalar; raw JSON otherwise so the user can
 * compose to the contract). `kind: 'conversation.close'` exposes a
 * confirm-close button. Resolution routes through the existing token-scoped
 * interrupt endpoint (`POST /v1/interrupts/{token}`) — RFC 0005 §B.
 *
 * Render contract — the panel returns `null` when no `conversation.*`
 * events have arrived (graceful when the host doesn't advertise
 * `capabilities.conversationPrimitive: true`, which today is every
 * reference host; the panel is forward-compatible). The conversation
 * primitive is shipped on the wire but no reference host advertises
 * it yet; this panel is ready when one does.
 */

import { useMemo, useState } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { resolveByToken, type OpenInterrupt } from '../client/interruptsClient.js';

interface ConversationTurn {
  messageId: string;
  from: string;
  to?: string;
  role: 'user' | 'agent' | 'system';
  turnIndex: number;
  content: unknown;
  ts: number;
}

interface ConversationView {
  conversationId: string;
  agentId?: string;
  capabilities: readonly string[];
  schema?: Record<string, unknown>;
  turns: ConversationTurn[];
  closed: boolean;
  outcome?: unknown;
}

interface Props {
  runId: string;
  events: readonly RunEventDoc[];
  activeInterrupt: OpenInterrupt | null;
  onResolved(): void;
}

export function RunConversationPanel({ runId: _runId, events, activeInterrupt, onResolved }: Props) {
  const conversations = useMemo(() => groupConversations(events), [events]);
  // Suppress the panel entirely when the host hasn't surfaced any
  // conversation events. Keeps RunDetailPage uncluttered for the common
  // case (reference hosts don't advertise the primitive today).
  if (conversations.length === 0) return null;
  return (
    <section className="card" aria-label="Multi-turn conversations">
      <h2>Conversations</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Multi-turn dialog driven by <code>core.conversationGate</code> (RFC 0005).
      </p>
      {conversations.map((c) => (
        <ConversationCard
          key={c.conversationId}
          conversation={c}
          activeInterrupt={activeInterrupt}
          onResolved={onResolved}
        />
      ))}
    </section>
  );
}

function ConversationCard({
  conversation,
  activeInterrupt,
  onResolved,
}: {
  conversation: ConversationView;
  activeInterrupt: OpenInterrupt | null;
  onResolved(): void;
}) {
  const { conversationId, agentId, capabilities, turns, closed, outcome } = conversation;
  // The active interrupt belongs to this conversation only when its
  // payload carries a matching `conversationId`. Open interrupts of
  // other kinds (approval / clarification / etc.) don't apply here.
  const interruptForThis = matchInterrupt(activeInterrupt, conversationId);
  return (
    <div className="conversation-card" style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{conversationId}</strong>
        {agentId && <span className="muted" style={{ fontSize: 12 }}>agent <code>{agentId}</code></span>}
        {capabilities.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            caps: {capabilities.map((c) => <code key={c} style={{ marginRight: 4 }}>{c}</code>)}
          </span>
        )}
        {closed && <span className="badge" style={{ background: '#10b981', color: '#fff', fontSize: 11 }}>closed</span>}
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
        {turns.map((t) => (
          <li key={t.messageId} style={{
            display: 'flex',
            gap: 8,
            padding: '6px 8px',
            background: t.role === 'user' ? '#f3f4f6' : t.role === 'agent' ? '#eef2ff' : '#fef3c7',
            borderRadius: 6,
            marginBottom: 4,
          }}>
            <span style={{ fontWeight: 600, minWidth: 60, fontSize: 12 }}>
              {t.role}
              <span className="muted" style={{ fontSize: 11 }}> #{t.turnIndex}</span>
            </span>
            <span style={{ flex: 1, fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {renderContent(t.content)}
            </span>
          </li>
        ))}
      </ol>
      {closed && outcome !== undefined && (
        <details style={{ marginBottom: 8 }}>
          <summary className="muted" style={{ fontSize: 12 }}>Final outcome</summary>
          <pre style={{ fontSize: 11, background: '#f9fafb', padding: 8, borderRadius: 4, marginTop: 4 }}>
            {JSON.stringify(outcome, null, 2)}
          </pre>
        </details>
      )}
      {interruptForThis && !closed && (
        <ResumeForm interrupt={interruptForThis} onResolved={onResolved} />
      )}
    </div>
  );
}

function ResumeForm({
  interrupt,
  onResolved,
}: {
  interrupt: OpenInterrupt;
  onResolved(): void;
}) {
  const kind = interrupt.kind;
  // `conversation.exchange` resume shape is constrained by the
  // optional `outcomeSchema` on the suspend's data; absent the
  // schema the host treats the resume as opaque, so we offer a
  // simple text input that round-trips as a string. When the
  // schema IS present, fall back to a JSON textarea so the user
  // can compose to the contract.
  const data = interrupt.data as
    | { conversationId?: string; prompt?: string; outcomeSchema?: Record<string, unknown> }
    | undefined;
  const prompt = data?.prompt;
  const hasSchema = Boolean(data?.outcomeSchema);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(payload: unknown): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await resolveByToken(interrupt.token, payload);
      setText('');
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (kind === 'conversation.close') {
    return (
      <div className="alert" style={{ background: '#f9fafb', border: '1px solid #e5e7eb', padding: 10, borderRadius: 6 }}>
        <strong style={{ fontSize: 13 }}>Confirm close</strong>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          The agent is asking to close this conversation. Confirm to emit <code>conversation.closed</code>.
        </p>
        {error && <div className="alert error" style={{ fontSize: 12, marginBottom: 6 }}>{error}</div>}
        <div className="button-row">
          <button type="button" onClick={() => void submit(undefined)} disabled={submitting}>
            {submitting ? 'Closing…' : 'Confirm close'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload = hasSchema
          ? safeParseJson(text)
          : text;
        if (hasSchema && payload === SAFE_PARSE_INVALID) {
          setError('Resume value is not valid JSON (the suspend declared an outcomeSchema, so the value MUST be a JSON document).');
          return;
        }
        void submit(payload);
      }}
      style={{ marginTop: 8 }}
    >
      {prompt && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          <strong>Agent:</strong> {prompt}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hasSchema ? 'JSON matching outcomeSchema…' : 'Your reply…'}
        rows={3}
        style={{ width: '100%', fontFamily: hasSchema ? 'monospace' : 'inherit', fontSize: 13 }}
        disabled={submitting}
      />
      {error && <div className="alert error" style={{ fontSize: 12, marginTop: 4 }}>{error}</div>}
      <div className="button-row" style={{ marginTop: 6 }}>
        <button type="submit" disabled={submitting || text.trim().length === 0}>
          {submitting ? 'Sending…' : 'Send turn'}
        </button>
      </div>
    </form>
  );
}

/** Group ordered RunEvents into per-conversation views, preserving turn
 *  order. `conversation.opened` seeds the view + initialTurn (index 0);
 *  `conversation.exchanged` appends; `conversation.closed` finalizes. */
function groupConversations(events: readonly RunEventDoc[]): ConversationView[] {
  const map = new Map<string, ConversationView>();
  for (const ev of events) {
    const payload = (ev as { payload?: unknown }).payload;
    if (!payload || typeof payload !== 'object') continue;
    const p = payload as Record<string, unknown>;
    const cid = typeof p.conversationId === 'string' ? p.conversationId : null;
    if (!cid) continue;
    if (ev.type === 'conversation.opened') {
      const view: ConversationView = {
        conversationId: cid,
        agentId: typeof p.agentId === 'string' ? p.agentId : undefined,
        capabilities: Array.isArray(p.capabilities) ? (p.capabilities as string[]) : [],
        schema: typeof p.schema === 'object' && p.schema ? (p.schema as Record<string, unknown>) : undefined,
        turns: [],
        closed: false,
      };
      const initial = coerceTurn(p.initialTurn);
      if (initial) view.turns.push(initial);
      map.set(cid, view);
    } else if (ev.type === 'conversation.exchanged') {
      const view = map.get(cid);
      if (!view) continue;
      const t = coerceTurn(p.turn);
      if (t) view.turns.push(t);
    } else if (ev.type === 'conversation.closed') {
      const view = map.get(cid);
      if (!view) continue;
      const t = coerceTurn(p.finalTurn);
      if (t) view.turns.push(t);
      view.closed = true;
      view.outcome = p.outcome;
    }
  }
  return [...map.values()];
}

function coerceTurn(raw: unknown): ConversationTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.messageId !== 'string' ||
    typeof r.from !== 'string' ||
    typeof r.role !== 'string' ||
    typeof r.turnIndex !== 'number' ||
    typeof r.ts !== 'number'
  ) {
    return null;
  }
  const role = r.role === 'user' || r.role === 'agent' || r.role === 'system' ? r.role : 'system';
  return {
    messageId: r.messageId,
    from: r.from,
    to: typeof r.to === 'string' ? r.to : undefined,
    role,
    turnIndex: r.turnIndex,
    content: r.content,
    ts: r.ts,
  };
}

function matchInterrupt(active: OpenInterrupt | null, conversationId: string): OpenInterrupt | null {
  if (!active) return null;
  if (active.kind !== 'conversation.exchange' && active.kind !== 'conversation.close') return null;
  const data = active.data as { conversationId?: unknown } | undefined;
  if (data && typeof data.conversationId === 'string' && data.conversationId === conversationId) {
    return active;
  }
  return null;
}

function renderContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  try {
    return JSON.stringify(c, null, 2);
  } catch {
    return String(c);
  }
}

const SAFE_PARSE_INVALID = Symbol('invalid-json');
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return SAFE_PARSE_INVALID;
  }
}
