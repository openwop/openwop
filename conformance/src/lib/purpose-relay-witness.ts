/**
 * Purpose labels on the onward hop, judged from what the suite's A2A peer received
 * (`spec/v2/core/security-defaults.md` §Onward hops; fixture `conformance-purpose-relay`).
 *
 * The scenario labels an inbound A2A message, tags its text with a nonce, and reads
 * the peer's `SendMessage` calls. These functions find the onward message for a nonce
 * and judge it, so a self-test double can show each defect failing its leg.
 */

/** One `SendMessage` the peer received: its JSON-RPC body. */
export interface PeerSend { readonly body: unknown }

type Msg = { parts?: unknown; metadata?: { openwop?: { permittedPurposes?: unknown } } };

function messageOf(body: unknown): Msg | undefined {
  return (body as { params?: { message?: Msg } } | undefined)?.params?.message;
}

/** The text parts of a message body, joined. A2A 1.0 `{ text }` and 0.3 `{ kind: 'text', text }` both count. */
export function textOf(body: unknown): string {
  const parts = messageOf(body)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text : '')).join('');
}

/** The onward sends carrying `nonce` in their text: the relay of one inbound message. */
export function relaysOf(sends: readonly PeerSend[], nonce: string): PeerSend[] {
  return sends.filter((s) => textOf(s.body).includes(nonce));
}

/** The label an onward message carries, as sent. */
export function labelOf(body: unknown): unknown {
  return messageOf(body)?.metadata?.openwop?.permittedPurposes;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** A received label MUST be re-emitted on the onward message, narrowing and never widening. */
export function judgeReemit(received: readonly string[], onward: unknown): Verdict {
  if (!Array.isArray(onward)) return { ok: false, reason: `the onward message carries no metadata.openwop.permittedPurposes (got ${JSON.stringify(onward)})` };
  const widened = onward.map(String).filter((p) => !received.includes(p));
  if (widened.length > 0) return { ok: false, reason: `the onward label widens the received one ${JSON.stringify(received)}: it adds ${JSON.stringify(widened)}` };
  return { ok: true };
}

/**
 * `[]` means no onward use. `controlRelays` is what an unlabelled control message
 * produced: with none, a missing relay under `[]` proves nothing (`blocked`).
 */
export function judgeEmpty(controlRelays: number, emptyRelays: number): Verdict | 'blocked' {
  if (controlRelays === 0) return 'blocked';
  if (emptyRelays > 0) return { ok: false, reason: `the peer received ${emptyRelays} message(s) relaying the []-labelled data` };
  return { ok: true };
}
