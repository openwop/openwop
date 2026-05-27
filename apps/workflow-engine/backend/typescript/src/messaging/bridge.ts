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

import { enqueueOutbound } from '../routes/messaging.js';
import type { MessagingBridge } from './types.js';
import type { Storage } from '../storage/storage.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('messaging.bridge');

// Backpressure: cap concurrent detached reply pollers so an inbound burst
// can't spawn unbounded timers. Beyond the cap the run is still created
// (the device got its runId); only the auto-reply poll is skipped.
const MAX_INFLIGHT = Number(process.env.OPENWOP_MESSAGING_MAX_INFLIGHT) || 50;
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
    async onInbound({ device, envelope }) {
      const createRes = await fetchImpl(`${cfg.baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workflowId: cfg.defaultWorkflowId,
          tenantId: device.tenantId,
          // Send both shapes so either a `text` workflow (uppercase/echo) or a
          // `messages` chat workflow can consume the inbound turn.
          inputs: { text: envelope.text, messages: [{ role: 'user', content: envelope.text }] },
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
      })
        .catch((err) => log.error('inbound bridge reply failed', { runId, error: String(err?.message ?? err) }))
        .finally(() => { inflight--; });

      return { runId };
    },
  };
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
  channel: 'whatsapp' | 'signal' | 'imessage';
  conversationId: string;
  replyToMessageId: string;
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
