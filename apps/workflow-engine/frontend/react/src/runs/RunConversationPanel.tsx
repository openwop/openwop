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
  events: readonly RunEventDoc[];
  activeInterrupt: OpenInterrupt | null;
  onResolved(): void;
}

export function RunConversationPanel({ events, activeInterrupt, onResolved }: Props) {
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
    <div className="conversation-card">
      <div className="conversation-card__head">
        <strong className="conversation-card__id">{conversationId}</strong>
        {agentId && <span className="muted" style={{ fontSize: 12 }}>agent <code>{agentId}</code></span>}
        {capabilities.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            caps: {capabilities.map((c) => <code key={c} style={{ marginRight: 4 }}>{c}</code>)}
          </span>
        )}
        {closed && <span className="badge" style={{ background: 'var(--color-success)', color: 'var(--color-on-scrim)', fontSize: 11 }}>closed</span>}
      </div>
      <ol className="conversation-turn-list">
        {turns.map((t) => (
          <li key={t.messageId} className={`conversation-turn conversation-turn--${t.role}`}>
            <span className="conversation-turn__role">
              {t.role}
              <span className="muted" style={{ fontSize: 11 }}> #{t.turnIndex}</span>
            </span>
            <span className="conversation-turn__content">
              {renderContent(t.content)}
            </span>
          </li>
        ))}
      </ol>
      {closed && outcome !== undefined && (
        <details style={{ marginBottom: 8 }}>
          <summary className="muted" style={{ fontSize: 12 }}>Final outcome</summary>
          <pre style={{ fontSize: 11, background: 'var(--paper-2)', padding: 8, borderRadius: 4, marginTop: 4 }}>
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
      <div className="alert conversation-close-banner">
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
        // Best-effort client-side outcomeSchema check — only the
        // top-level `type` discriminator (cheap, no Ajv dep). The host
        // is the authority and may reject with `400 INVALID_RESUME_VALUE`
        // for deeper schema constraints; this just catches the obvious
        // wrong-shape case (user typed an object when a string was
        // expected, etc.) without waiting for the round-trip.
        if (hasSchema) {
          const mismatch = topLevelTypeMismatch(payload, data?.outcomeSchema);
          if (mismatch) { setError(mismatch); return; }
        }
        void submit(payload);
      }}
      className="conversation-resume-form"
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
        style={{ width: '100%', fontFamily: hasSchema ? 'var(--mono)' : 'inherit', fontSize: 13 }}
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
    const payload = ev.payload;
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

/** Returns null if the value's JS top-level type matches `schema.type`
 *  (a single string or an array). Returns a human-readable message
 *  otherwise. Skips deeper validation (`properties`, `items`, etc.) —
 *  the host is the schema authority. JSON Schema 2020-12 §6.1.1 type
 *  names: "string" / "number" / "integer" / "boolean" / "object" /
 *  "array" / "null". */
function topLevelTypeMismatch(value: unknown, schema: Record<string, unknown> | undefined): string | null {
  if (!schema) return null;
  const t = schema.type;
  const allowed: string[] = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((s) => typeof s === 'string') : [];
  if (allowed.length === 0) return null;
  const actual = jsonTypeOf(value);
  if (allowed.includes(actual)) return null;
  if (actual === 'number' && allowed.includes('integer') && Number.isInteger(value)) return null;
  return `Resume value top-level type is "${actual}"; the outcomeSchema requires ${allowed.map((s) => `"${s}"`).join(' or ')}.`;
}

function jsonTypeOf(v: unknown): 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return t;
  if (t === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return 'object';
}
