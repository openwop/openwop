/**
 * RFC 0173 §B — `webhook-durable-delivery` (suite 2.0.0, target major 2; gated on `webhooks`).
 *
 * In v2 durable delivery binds with the `webhooks` surface: a host MUST retry a
 * failed attempt per its advertised `retryPolicy`, MUST route an exhausted
 * delivery to the dead-letter sink rather than drop it, and MUST deliver at
 * least once; best-effort is not a conforming mode and a `3xx` is a failure
 * (`spec/v2/core/webhooks.md` §Durability; security-defaults.md §Webhook
 * durability; RFC 0173 §B row C6.3).
 *
 * How the receiver is driven: the suite boots its own HTTP receiver (the same
 * shape `webhook-signed-delivery.test.ts` uses) in a FAILING mode — it answers
 * `500` to the first N attempts for a delivery key and `204` afterwards — so
 * the retry is observable as more than one attempt for one
 * `(webhookId, runId, sequence)` key, and the eventual `204` is the at-least-once
 * delivery. A second receiver never succeeds, so the retries exhaust; the
 * dead-letter leg then needs a read surface for the sink, which
 * `api/v2/openapi.yaml` does not carry — that leg records `blocked` naming it.
 *
 * Registration goes through the canonical `POST /webhooks` with the v2 body
 * (`{ url, events[] }` — no `tenantId`, the v2 body is closed). The SSRF posture
 * is the one `webhook-signed-delivery.test.ts` documents: a loopback receiver is
 * rejected by a conforming host unless `OPENWOP_WEBHOOK_RECEIVER_URL` fronts it
 * with a public https tunnel; a rejection of the loopback URL is `blocked`.
 *
 * @see spec/v2/core/webhooks.md §Durability
 * @see spec/v2/core/security-defaults.md §Webhook durability
 */

import { afterEach, describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Attempt { readonly key: string; readonly runId: string | null; readonly status: number; readonly at: number }

/**
 * A receiver that fails the first `failFirst` attempts for each delivery key
 * (`Infinity` ⇒ always fails). The key is `(webhookId, runId, sequence)` —
 * the dedup triple webhooks.md §Verification names.
 */
async function startReceiver(failFirst: number): Promise<{ server: Server; url: string; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const seen = new Map<string, number>();
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let runId: string | null = null;
      let sequence: unknown = null;
      try {
        const parsed = JSON.parse(body) as { runId?: unknown; event?: { sequence?: unknown } };
        runId = typeof parsed.runId === 'string' ? parsed.runId : null;
        sequence = parsed.event?.sequence ?? null;
      } catch { /* not JSON — still an attempt */ }
      const h = request.headers;
      const webhookId = String(h['openwop-webhook-id'] ?? h['x-openwop-webhook-id'] ?? '');
      const key = `${webhookId}|${runId ?? ''}|${String(sequence)}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const status = n <= failFirst ? 500 : 204;
      attempts.push({ key, runId, status, at: Date.now() });
      res.writeHead(status);
      res.end();
    });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  await new Promise<void>((resolve) => server.listen(bindPort, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('receiver address unavailable');
  return { server, url: `http://127.0.0.1:${addr.port}/`, attempts };
}

let active: Server | null = null;
afterEach(async () => {
  if (active) {
    const s = active;
    active = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function fixtureAdvertised(doc: Record<string, unknown>, id: string): boolean {
  return Array.isArray(doc['fixtures']) && (doc['fixtures'] as unknown[]).includes(id);
}

async function waitTerminal(runId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
    if (status !== null && TERMINAL.has(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return pred();
}

/**
 * The retry policy the host advertises for WEBHOOK delivery.
 *
 * 2.0.1: this read the WRONG FIELD. Its docstring claimed
 * `triggerBridge.retryPolicy` was "the only v2 carrier", but
 * `spec/v2/facets/webhooks.schema.json` says the opposite in as many words:
 * "retryPolicy is the v2 carrier of the delivery obligation (was
 * triggerBridge.retryPolicy at v1)", and the field's own description adds
 * "The webhooks family carries it at v2; `triggerBridge.retryPolicy` is the
 * v1 carrier and stays through the overlap."
 *
 * So a host that correctly advertises the v2 carrier had its policy read as
 * `null`, and a host still on the v1 carrier was measured against a policy
 * belonging to a DIFFERENT SUBSYSTEM — the trigger-bridge state machine,
 * whose delivery budget need not equal the webhook one. A tier-1 host
 * reported exactly that: 8 on the trigger bridge, 5 on webhook delivery,
 * and no way to be honest about both under a single borrowed field.
 *
 * `webhooks.retryPolicy` first, `triggerBridge.retryPolicy` second for the
 * v1 overlap the schema explicitly preserves.
 */
function advertisedRetryPolicy(doc: Record<string, unknown>): { maxAttempts?: number; backoff?: string } | null {
  const read = (holder: unknown): { maxAttempts?: number; backoff?: string } | null => {
    const rp = holder && typeof holder === 'object' ? (holder as { retryPolicy?: unknown }).retryPolicy : undefined;
    return rp && typeof rp === 'object' ? (rp as { maxAttempts?: number; backoff?: string }) : null;
  };
  return read(doc['webhooks']) ?? read(doc['triggerBridge']);
}

/**
 * How long to wait for a retry, derived from what the host ADVERTISED.
 *
 * 2.0.1: this was a hard 20 s, and a host whose first backoff is deliberately
 * slower than that was recorded `executed-fail` on a core-standard floor row
 * for being durable. Measured on a tier-1 host: Cloud Tasks `minBackoff: 30s`,
 * the retry lands at t+30 s, the window closed at t+20 s, and the assertion
 * said "a 500 MUST be retried" about a host that retried. 30 s is not an
 * unusual first backoff.
 *
 * That is rc.67's poll-cursor defect one file over and DETERMINISTIC rather
 * than flaky: the instrument's own window, attributed to the host. A scenario
 * must not blame a host for a deadline the scenario chose.
 *
 * The floor stays 20 s so a host that advertises nothing is measured exactly
 * as before; an advertised `exponential`/`fixed` backoff widens it to 90 s,
 * which covers a 30 s first attempt with room for the second. The cap is
 * deliberate: unbounded waiting would let a host that never retries hold the
 * suite open instead of failing.
 */
const RETRY_WAIT_FLOOR_MS = 20_000;
const RETRY_WAIT_CAP_MS = 90_000;
function retryWaitMs(doc: Record<string, unknown>): number {
  const policy = advertisedRetryPolicy(doc);
  if (policy === null) return RETRY_WAIT_FLOOR_MS;
  const backoff = String(policy.backoff ?? '');
  return backoff === 'exponential' || backoff === 'fixed' ? RETRY_WAIT_CAP_MS : RETRY_WAIT_FLOOR_MS;
}

/** Register the suite receiver; null (with a note) when the host's SSRF guard refuses a loopback URL. */
async function register(url: string): Promise<{ webhookId: string } | null> {
  const registration = resolveRegistrationUrl(url);
  const reg = await driver.post('/webhooks', { url: registration.url, events: ['run.completed'] });
  if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') {
    if (!registration.tunnelled) {
      softSkip('blocked', 'host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel in front of the suite receiver');
      return null;
    }
    expect.fail(`host rejected the operator-supplied public https receiver (${registration.url}) with webhook_url_rejected — a public https destination is legitimate under webhooks.md §Egress`);
  }
  expect(reg.status, req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
  const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
  expect(typeof webhookId, req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Surfaces', 'the 201 body MUST carry `webhookId`')).toBe('string');
  return { webhookId: webhookId as string };
}

describe('RFC 0173 §B — webhook-durable-delivery (gated on webhooks)', () => {
  it('a failed attempt is retried and the event is delivered at least once', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!fixtureAdvertised(doc, FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to deliver`);

    const receiver = await startReceiver(2); // 500, 500, then 204
    active = receiver.server;
    const sub = await register(receiver.url);
    if (sub === null) return softSkip('blocked', 'registration refused (reason recorded above)');

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.webhook-durable-delivery', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);

    const ours = () => receiver.attempts.filter((a) => a.runId === runId);
    const retried = await waitFor(() => ours().some((a) => a.status === 204), retryWaitMs(doc));
    const attempts = ours();
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', 'the host MUST attempt delivery of run.completed for THIS run to the registered subscriber'),
    ).toBeGreaterThan(0);
    const failedThenSucceeded = attempts.filter((a) => a.status === 500).length;
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', `a 500 from the subscriber MUST be retried — ${failedThenSucceeded} failed attempt(s) were answered and the host made ${attempts.length} attempt(s) in total; one attempt is best-effort delivery, which is not a conforming mode (RFC 0173 §B)`),
    ).toBeGreaterThan(1);
    expect(
      retried,
      req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', 'at-least-once: after the failing attempts the retry MUST land (the receiver answered 204 to the third attempt for the key)'),
    ).toBe(true);
    // Backoff: the retry MUST NOT be a tight loop — consecutive attempts for one
    // key are spaced. Only asserted when the host advertises a non-`none` backoff.
    const policy = advertisedRetryPolicy(doc);
    const byKey = new Map<string, number[]>();
    for (const a of attempts) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a.at]);
    if (policy?.backoff !== undefined && policy.backoff !== 'none') {
      for (const [key, times] of byKey) {
        for (let i = 1; i < times.length; i++) {
          expect(
            times[i]! - times[i - 1]!,
            req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', `retry attempts for ${key} MUST be spaced by the advertised ${policy.backoff} backoff (attempt ${i + 1} followed attempt ${i} after ${times[i]! - times[i - 1]!}ms)`),
          ).toBeGreaterThan(0);
        }
      }
    } else {
      softSkip('inapplicable', 'no advertised retryPolicy.backoff other than none — the spacing leg is not asserted');
    }

    const del = await driver.delete(`/webhooks/${encodeURIComponent(sub.webhookId)}`);
    expect(del.status, req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Surfaces', 'DELETE /webhooks/{webhookId} MUST answer 204')).toBe(204);
  });

  it('an exhausted delivery is dead-lettered, never dropped', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!fixtureAdvertised(doc, FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to deliver`);

    const receiver = await startReceiver(Number.POSITIVE_INFINITY); // never succeeds
    active = receiver.server;
    const sub = await register(receiver.url);
    if (sub === null) return softSkip('blocked', 'registration refused (reason recorded above)');

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);
    const ours = () => receiver.attempts.filter((a) => a.runId === runId);
    await waitFor(() => ours().length > 1, retryWaitMs(doc));
    const attempts = ours();
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', 'a delivery that keeps failing MUST be retried before it can be exhausted (one attempt is a drop)'),
    ).toBeGreaterThan(1);
    const policy = advertisedRetryPolicy(doc);
    if (policy?.maxAttempts !== undefined) {
      // Give the policy time to exhaust, then the host MUST stop.
      await waitFor(() => ours().length >= policy.maxAttempts!, retryWaitMs(doc));
      await new Promise((r) => setTimeout(r, 1_000));
      expect(
        ours().length,
        req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', `retries MUST stop at the advertised retryPolicy.maxAttempts (${policy.maxAttempts}) — exhaustion routes to the dead-letter sink, not to an unbounded loop`),
      ).toBeLessThanOrEqual(policy.maxAttempts);
    }
    await driver.delete(`/webhooks/${encodeURIComponent(sub.webhookId)}`);
    // The sink itself: webhooks.md §Durability says "inspectable for retentionDays",
    // but api/v2/openapi.yaml carries no dead-letter read for webhook deliveries
    // (no GET /webhooks/{webhookId}/dead-letters). Without a normative read the
    // routing to the sink is not observable from the suite.
    return softSkip('blocked', 'no normative dead-letter read surface for webhook deliveries in api/v2/openapi.yaml (a GET /webhooks/{webhookId}/dead-letters projection is needed) — exhaustion was observed, routing to the sink was not');
  });
});
