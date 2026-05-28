/**
 * Inbound → run bridge for the demo messaging relay-gateway (Phase 2b).
 *
 * Maps an inbound chat message to a workflow run and, when the run completes,
 * enqueues the run's reply text as an outbound egress for the relay device to
 * deliver. Implemented over the host's own HTTP surface (self-fetch) so it
 * reuses the entire run pipeline — auth, idempotency, capability gating,
 * executor — rather than duplicating it.
 *
 * Inbound stays fast: the run is created synchronously (so the device gets a
 * runId back), and the poll-to-completion + outbound enqueue runs detached.
 * This matches the relay pattern — the device pulls the reply on a later
 * outbound poll. Detached replies are capped (OPENWOP_MESSAGING_MAX_INFLIGHT)
 * so an inbound burst can't spawn unbounded pollers.
 *
 * NON-normative: this lives entirely in the demo app's host-extension layer.
 *
 * Production-hardening (addressed):
 *  - Credential: the bridge bearer is `cfg.bearer`, wired from
 *    OPENWOP_MESSAGING_BRIDGE_TOKEN (falling back to the host bearer for the
 *    demo) so a real host can supply a scoped credential. The run's tenant
 *    comes from `device.tenantId`, bound at relay-registration time (NOT from
 *    the inbound message), so inbound content cannot redirect a run into
 *    another tenant.
 *  - Rate limit: the poll loop self-fetches over loopback;
 *    ipRateLimitMiddleware exempts genuine loopback-self traffic (socket addr,
 *    no XFF) so messaging-driven runs don't share one IP bucket.
 */

import { randomUUID } from 'node:crypto';
import { enqueueOutbound } from '../routes/messaging.js';
import type { ChatIngressEnvelope, MessagingBridge, MessagingRoutingRuleRecord, RelayChannel, RelayDeviceRecord } from './types.js';
import type { Storage } from '../storage/storage.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('messaging.bridge');

// Backpressure: cap concurrent detached reply pollers so an inbound burst
// can't spawn unbounded timers. Beyond the cap the run is still created
// (the device got its runId); only the auto-reply poll is skipped.
const MAX_INFLIGHT = Number(process.env.OPENWOP_MESSAGING_MAX_INFLIGHT) || 50;
// How many prior turns to thread into the next inbound run's messages[]. Caps
// per-run payload growth; older turns stay in storage for audit.
const HISTORY_LIMIT = Math.max(1, Number(process.env.OPENWOP_MESSAGING_HISTORY_LIMIT) || 20);
let inflight = 0;

export interface SelfHttpBridgeConfig {
  /** Durable store for the outbound queue the reply is enqueued onto. */
  storage: Storage;
  /** The host's own base URL, e.g. http://127.0.0.1:8080 */
  baseUrl: string;
  /** Operator bearer used to create runs (the demo stub accepts any non-empty token). */
  bearer: string;
  /** Workflow a conversation is bound to when no per-connector binding exists. */
  defaultWorkflowId: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export function createSelfHttpBridge(cfg: SelfHttpBridgeConfig): MessagingBridge {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const pollIntervalMs = cfg.pollIntervalMs ?? 150;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const headers = { authorization: `Bearer ${cfg.bearer}`, 'content-type': 'application/json' };

  return {
    async onInbound({ device, envelope, sessionKey }) {
      // Consult the operator-configured routing rules first; fall back to the
      // single default workflow when no rule matches (preserves prior behavior).
      const rules = await cfg.storage.listMessagingRoutingRules(device.tenantId);
      const rule = selectRoutingRule(rules, device, envelope);

      // Thread prior turns into messages[] so messaging gets chat-style
      // continuity. Each inbound run sees the recent conversation; the
      // assistant reply is persisted detached on run completion.
      // Phase E: if the inbound peer is linked to a cross-channel identity,
      // merge that identity's other-channel turns in too so a single person
      // sees one shared thread (e.g. signal:+1 + discord:user → one history).
      const prior = await loadHistoryFor({
        storage: cfg.storage, tenantId: device.tenantId, channel: device.channel,
        peerId: envelope.peerId, sessionKey, limit: HISTORY_LIMIT,
      });
      const messages = [
        ...prior.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: envelope.text },
      ];
      // Persist the inbound user turn before creating the run (so a crash
      // mid-run leaves the user message in the thread, not lost).
      await cfg.storage.appendMessagingTurn({
        turnId: `t_${randomUUID()}`,
        sessionKey,
        tenantId: device.tenantId,
        role: 'user',
        content: envelope.text,
        at: envelope.timestamp,
      });

      // Phase D: if the matched rule binds the conversation to an agent (RFC
      // 0070 dispatch) instead of a workflow, dispatch synchronously and
      // enqueue the agent's reply text directly — no run pipeline involved.
      if (rule?.agentId) {
        await dispatchToAgent({
          storage: cfg.storage, fetchImpl, baseUrl: cfg.baseUrl, headers,
          agentId: rule.agentId, device, envelope, sessionKey, messages,
        });
        return;
      }

      const workflowId = rule?.workflowId ?? cfg.defaultWorkflowId;
      const createRes = await fetchImpl(`${cfg.baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workflowId,
          tenantId: device.tenantId,
          // Send both shapes so either a `text` workflow (uppercase/echo) or a
          // `messages` chat workflow can consume the inbound turn.
          inputs: { text: envelope.text, messages },
        }),
      });
      if (!createRes.ok) {
        log.warn('inbound bridge failed to create run', { status: createRes.status, channel: device.channel });
        return;
      }
      const created = (await createRes.json()) as { runId?: string };
      const runId = created.runId;
      if (!runId) return;

      if (inflight >= MAX_INFLIGHT) {
        log.warn('bridge at max in-flight replies; run created but auto-reply poll skipped', { runId, inflight, max: MAX_INFLIGHT });
        return { runId };
      }
      // Detached: poll to terminal, extract reply, enqueue outbound.
      inflight++;
      void completeAndReply({
        storage: cfg.storage, fetchImpl, headers, baseUrl: cfg.baseUrl, pollIntervalMs, timeoutMs,
        runId, relayId: device.relayId, channel: device.channel,
        conversationId: envelope.conversationId, replyToMessageId: envelope.platformMessageId,
        sessionKey, tenantId: device.tenantId,
      })
        .catch((err) => log.error('inbound bridge reply failed', { runId, error: String(err?.message ?? err) }))
        .finally(() => { inflight--; });

      return { runId };
    },
  };
}

/**
 * Pick the routing rule for an inbound envelope from the operator-configured
 * rules, or undefined when none match (the bridge falls back to its default
 * workflow). Returns the full rule so the bridge can inspect both `workflowId`
 * and `agentId` — exactly one of which is set per rule.
 *
 * Match semantics (per `MessagingRoutingRuleRecord`):
 *   - `rule.channel` unset OR equal to `device.channel`.
 *   - `rule.pattern` is `*` (any) OR is a substring of `conversationId` OR `peerId`.
 *   - Tie-break: higher `priority` wins; equal priority → earlier `createdAt`.
 * Pure function — exported for direct unit testing without the run pipeline.
 */
export function selectRoutingRule(
  rules: ReadonlyArray<MessagingRoutingRuleRecord>,
  device: Pick<RelayDeviceRecord, 'channel'>,
  envelope: Pick<ChatIngressEnvelope, 'conversationId' | 'peerId'>,
): MessagingRoutingRuleRecord | undefined {
  const matched = rules.filter((r) => {
    if (r.channel !== undefined && r.channel !== device.channel) return false;
    if (r.pattern === '*') return true;
    return envelope.conversationId.includes(r.pattern) || envelope.peerId.includes(r.pattern);
  });
  if (matched.length === 0) return undefined;
  matched.sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt));
  return matched[0];
}

/** Convenience: extract the bound workflowId from a matched rule (legacy callers). */
export function selectWorkflowByRules(
  rules: ReadonlyArray<MessagingRoutingRuleRecord>,
  device: Pick<RelayDeviceRecord, 'channel'>,
  envelope: Pick<ChatIngressEnvelope, 'conversationId' | 'peerId'>,
): string | undefined {
  return selectRoutingRule(rules, device, envelope)?.workflowId;
}

interface HistoryArgs {
  storage: Storage;
  tenantId: string;
  channel: RelayChannel;
  peerId: string;
  sessionKey: string;
  limit: number;
}

/**
 * Phase E: collect the recent conversation history for the inbound, optionally
 * merging cross-channel turns when the peer is linked to a messaging identity.
 *
 *   - Resolve identity by scanning `listMessagingIdentities(tenantId)` for one
 *     whose `peers[]` contains `(channel, peerId)`. Unlinked → only this
 *     session's history (the prior behavior).
 *   - If linked: list sessions for the tenant, pick the ones whose
 *     `(channel, peerId)` matches any linked peer, then `listMessagingTurns`
 *     on each — merged ascending by `at`, capped at `limit` (most recent).
 *
 * Cross-tenant scoping is preserved (we only ever read sessions for
 * `tenantId`); the identity scan is tenant-bounded too, matching the
 * existing CTI-1 invariant on the identities surface.
 */
export async function loadHistoryFor(a: HistoryArgs): Promise<ReadonlyArray<{ role: 'user' | 'assistant'; content: string; at: string }>> {
  const identities = await a.storage.listMessagingIdentities(a.tenantId);
  const identity = identities.find((id) => id.peers.some((p) => p.channel === a.channel && p.peerId === a.peerId));

  // Single-session path: unlinked peer → just this session's turns.
  if (!identity) {
    const turns = await a.storage.listMessagingTurns(a.sessionKey, a.limit, a.tenantId);
    return turns.map((t) => ({ role: t.role, content: t.content, at: t.at }));
  }

  // Linked-identity path: gather session keys across linked peers, then merge.
  const sessions = await a.storage.listMessagingSessions(a.tenantId);
  const linkedKeySet = new Set<string>([a.sessionKey]);
  for (const peer of identity.peers) {
    for (const s of sessions) {
      if (s.channel === peer.channel && s.peerId === peer.peerId) linkedKeySet.add(s.sessionKey);
    }
  }
  const merged: Array<{ role: 'user' | 'assistant'; content: string; at: string }> = [];
  for (const sk of linkedKeySet) {
    const turns = await a.storage.listMessagingTurns(sk, a.limit, a.tenantId);
    for (const t of turns) merged.push({ role: t.role, content: t.content, at: t.at });
  }
  merged.sort((x, y) => x.at.localeCompare(y.at));
  // Cap to the most-recent `limit`, keep chronological order.
  return merged.length > a.limit ? merged.slice(merged.length - a.limit) : merged;
}

interface ReplyArgs {
  storage: Storage;
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  baseUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
  runId: string;
  relayId: string;
  channel: RelayChannel;
  conversationId: string;
  replyToMessageId: string;
  sessionKey: string;
  tenantId: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function completeAndReply(a: ReplyArgs): Promise<void> {
  const deadline = Date.now() + a.timeoutMs;
  let status = 'pending';
  while (Date.now() < deadline) {
    await delay(a.pollIntervalMs);
    const snap = await a.fetchImpl(`${a.baseUrl}/v1/runs/${encodeURIComponent(a.runId)}`, { headers: a.headers });
    if (!snap.ok) continue;
    const body = (await snap.json()) as { status?: string };
    if (body.status && TERMINAL.has(body.status)) { status = body.status; break; }
  }

  let text: string | null = null;
  if (status === 'completed') {
    const evRes = await a.fetchImpl(`${a.baseUrl}/v1/runs/${encodeURIComponent(a.runId)}/events/poll?fromSeq=0&limit=1000`, { headers: a.headers });
    if (evRes.ok) {
      const evBody = (await evRes.json()) as { events?: Array<{ type?: string; payload?: unknown }> };
      text = extractReplyText(evBody.events ?? []);
    }
  }
  const reply = text ?? (status === 'completed' ? '(no text output)' : `Run ${status}.`);

  await enqueueOutbound(a.storage, a.relayId, {
    channel: a.channel,
    conversationId: a.conversationId,
    text: reply,
    replyToMessageId: a.replyToMessageId,
  });

  // Persist the assistant turn so the NEXT inbound on this session can thread
  // it into messages[]. Skip when there's nothing useful to remember (the
  // synthetic "(no text output)" or non-completed fallback strings).
  if (status === 'completed' && text && text.length > 0) {
    await a.storage.appendMessagingTurn({
      turnId: `t_${randomUUID()}`,
      sessionKey: a.sessionKey,
      tenantId: a.tenantId,
      role: 'assistant',
      content: text,
      runId: a.runId,
      at: new Date().toISOString(),
    });
  }
}

interface AgentDispatchArgs {
  storage: Storage;
  fetchImpl: typeof fetch;
  baseUrl: string;
  headers: Record<string, string>;
  agentId: string;
  device: { relayId: string; tenantId: string; channel: RelayChannel };
  envelope: ChatIngressEnvelope;
  sessionKey: string;
  messages: Array<{ role: string; content: string }>;
}

/**
 * Phase D: dispatch the inbound to a manifest agent (RFC 0070) instead of a
 * workflow run. The agent route returns the result synchronously; we extract
 * the reply text, enqueue an outbound reply, and persist the assistant turn
 * keyed to the originating session so the next inbound threads it back in.
 *
 * Bound with an AbortController so a slow agent can't stall the inbound HTTP
 * handler past the host's request budget (override via
 * OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS; default 30s). On timeout the
 * bridge enqueues a "(timed out)" reply and persists no assistant turn — the
 * relay stays observable and the next inbound proceeds.
 */
async function dispatchToAgent(a: AgentDispatchArgs): Promise<void> {
  const timeoutMs = Number(process.env.OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS) || 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await a.fetchImpl(`${a.baseUrl}/v1/host/sample/agents/${encodeURIComponent(a.agentId)}/dispatch`, {
      method: 'POST',
      headers: a.headers,
      body: JSON.stringify({
        task: { text: a.envelope.text, messages: a.messages, conversationId: a.envelope.conversationId, channel: a.device.channel },
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError' || controller.signal.aborted;
    log.warn(aborted ? 'agent dispatch timed out' : 'agent dispatch errored', { agentId: a.agentId, timeoutMs, error: String(err?.message ?? err) });
    await enqueueOutbound(a.storage, a.device.relayId, {
      channel: a.device.channel,
      conversationId: a.envelope.conversationId,
      text: aborted ? `(agent ${a.agentId} timed out after ${Math.round(timeoutMs / 1000)}s)` : `(agent ${a.agentId} error)`,
      replyToMessageId: a.envelope.platformMessageId,
    });
    return;
  }
  clearTimeout(timer);
  if (!res.ok) {
    log.warn('agent dispatch failed', { agentId: a.agentId, status: res.status });
    return;
  }
  const body = (await res.json()) as { status?: string; result?: { text?: string } | string; text?: string };
  // Accept a few plausible reply shapes: { result: { text } } | { result: 'string' } | { text }.
  const text =
    (typeof body.result === 'object' && body.result && typeof body.result.text === 'string' ? body.result.text : null)
    ?? (typeof body.result === 'string' ? body.result : null)
    ?? (typeof body.text === 'string' ? body.text : null);
  const reply = text && text.length > 0 ? text : `Agent ${a.agentId} produced no text output.`;
  await enqueueOutbound(a.storage, a.device.relayId, {
    channel: a.device.channel,
    conversationId: a.envelope.conversationId,
    text: reply,
    replyToMessageId: a.envelope.platformMessageId,
  });
  if (text && text.length > 0) {
    await a.storage.appendMessagingTurn({
      turnId: `t_${randomUUID()}`,
      sessionKey: a.sessionKey,
      tenantId: a.device.tenantId,
      role: 'assistant',
      content: text,
      at: new Date().toISOString(),
    });
  }
}

/** Walk events newest-first; return the first node/run output that carries text. */
export function extractReplyText(events: Array<{ type?: string; payload?: unknown }>): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const t = textFromPayload(events[i]?.payload);
    if (t) return t;
  }
  return null;
}

function textFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  for (const c of [p.output, p.result, p.text, p.content, p.message]) {
    const t = coerceText(c);
    if (t) return t;
  }
  if (p.outputs && typeof p.outputs === 'object') {
    for (const v of Object.values(p.outputs as Record<string, unknown>)) {
      const t = coerceText(v);
      if (t) return t;
    }
  }
  if (Array.isArray(p.messages)) {
    for (let i = p.messages.length - 1; i >= 0; i--) {
      const m = p.messages[i] as { role?: string; content?: unknown } | undefined;
      if (m && m.role === 'assistant') {
        const t = coerceText(m.content);
        if (t) return t;
      }
    }
  }
  return null;
}

function coerceText(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v;
  if (v && typeof v === 'object') {
    const t = (v as { text?: unknown }).text;
    if (typeof t === 'string' && t.trim().length > 0) return t;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
