/**
 * Shared helpers for the RFC 0101 multi-party group-conversation behavioral
 * scenario. Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/multiPartyConversation.js`.
 *
 * RFC 0101 standardizes the multi-party *shape* (a `participants` roster on
 * `conversation.opened` + a REQUIRED-for-agent-turns `speakerId` + the
 * `multiPartyConversation` capability) but mints NO normative client wire-route
 * to *open* a conversation — opening, turn order, and round protocol are
 * non-normative host product policy (RFC 0101 §"Non-normative product policy").
 * A conformance driver therefore initiates a council and submits turns via the
 * conformance-only **multi-party conversation test seam**
 * (`POST /v1/host/sample/conversation/multi-party/{open,exchange}`,
 * `host-sample-test-seams.md` §"Open seams") — the same `/v1/host/sample/*`
 * convention every other capability-gated behavioral leg uses. The seam routes
 * through the SAME roster-membership + attribution enforcement the host applies
 * on its production conversation path; it is OPTIONAL and self-contained
 * (it does NOT require the host to implement the full RFC 0005 conversation
 * gate). Scenarios soft-skip on `404`/`405`.
 *
 * @see RFCS/0101-multi-party-group-conversation.md (§Spec / §Conformance)
 * @see spec/v1/host-sample-test-seams.md (multi-party conversation seam)
 * @see RFCS/0005-conversation.md §E (turn-validation rejection — validation_error)
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** A slim AgentRef the seam accepts in a participant roster (mirror of
 *  `agent-ref.schema.json`; only `agentId` is load-bearing for membership). */
export interface SeamAgentRef {
  agentId: string;
  name?: string;
}

/** A conversation turn as the seam accepts it (subset of
 *  `conversation-turn.schema.json` + the RFC 0101 `speakerId`). */
export interface SeamTurn {
  messageId: string;
  from: string;
  content: string;
  ts: number;
  role: 'user' | 'agent' | 'system';
  turnIndex: number;
  speakerId?: string;
  [k: string]: unknown;
}

export interface MultiPartyConversationCap {
  supported?: boolean;
  maxParticipants?: number;
  [k: string]: unknown;
}

/** Reads the root-first `multiPartyConversation` capability block from
 *  discovery (RFC 0073 root-first); null when unadvertised. */
export async function readMultiPartyCap(): Promise<MultiPartyConversationCap | null> {
  const mpc = await readCapabilityFamily<MultiPartyConversationCap>('multiPartyConversation');
  return mpc && typeof mpc === 'object' ? mpc : null;
}

export interface SeamResult {
  /** HTTP status. `0` when the seam is unwired (404/405 → soft-skip sentinel). */
  status: number;
  /** Decoded JSON body, when present. */
  body: Record<string, unknown> | undefined;
  /** True when the seam is absent (404/405) — caller soft-skips. */
  unwired: boolean;
}

function toResult(res: { status: number; json: unknown }): SeamResult {
  const unwired = res.status === 404 || res.status === 405;
  return {
    status: res.status,
    body: res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : undefined,
    unwired,
  };
}

/** Open a multi-party council via the conformance seam. Returns `unwired:true`
 *  on 404/405 so the scenario soft-skips. NOTE: a `validation_error` rejection
 *  (e.g. roster exceeds maxParticipants) is a REAL 400/422 result, NOT unwired —
 *  only 404/405 mean the seam is absent. */
export async function openMultiPartyConversation(body: {
  conversationId: string;
  participants: SeamAgentRef[];
  maxParticipants?: number;
}): Promise<SeamResult> {
  const res = await driver.post('/v1/host/sample/conversation/multi-party/open', body);
  return toResult(res);
}

/** Submit one turn to an open council via the conformance seam. */
export async function exchangeMultiPartyTurn(body: {
  conversationId: string;
  turn: SeamTurn;
}): Promise<SeamResult> {
  const res = await driver.post('/v1/host/sample/conversation/multi-party/exchange', body);
  return toResult(res);
}

/** The canonical `error.code` an RFC 0101 rejection carries (RFC 0005 §E).
 *  Tolerant of both `{ error: { code } }` and `{ error: '<code>' }` shapes. */
export function errorCodeOf(body: Record<string, unknown> | undefined): string | undefined {
  if (!body) return undefined;
  const err = body.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === 'string') return code;
  }
  const code = body.code;
  return typeof code === 'string' ? code : undefined;
}

/** A rejection is RFC-0101-conformant when the status is a client error
 *  (`400`/`422` — RFC 0005 §E pins the code, not the status) AND the body
 *  carries `error.code === 'validation_error'`. */
export function isValidationErrorRejection(r: SeamResult): boolean {
  const clientError = r.status === 400 || r.status === 422;
  return clientError && errorCodeOf(r.body) === 'validation_error';
}
