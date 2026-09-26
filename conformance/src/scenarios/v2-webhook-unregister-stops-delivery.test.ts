/**
 * RFC 0215 §B — `webhook-unregister-stops-delivery` (suite 2.40.0, target major 2; gated on `webhooks`).
 *
 * `spec/v2/core/webhooks.md` §Durability: after `unregisterWebhook` answers
 * `204`, a host MUST NOT start any further attempt for that subscription,
 * including attempts already scheduled for retry. An attempt the host had begun
 * sending before the `204` MAY complete.
 *
 * Absence is not evidence on its own (architect review, 2026-09-25). "No retry
 * arrived after the 204" proves nothing about a host whose next retry falls
 * outside the window, and `webhooks.retryPolicy` carries no interval, so the
 * suite cannot compute when that is. The leg therefore runs a CONTROL:
 *
 *   - two subscriptions on one receiver, both filtering `run.completed`, both
 *     answered `500` on every attempt, so both have a retry scheduled;
 *   - the TARGET is unregistered the moment its first attempt has been
 *     answered; the CONTROL is left alone;
 *   - the control's retries are what the target's would have been — same
 *     event, same moment, same policy.
 *
 * Verdicts:
 *   - pass — the control was retried after `204 + GRACE_MS` and the target
 *     was not: a retry that would have come did not.
 *   - fail — an attempt for the target arrived after `204 + GRACE_MS`.
 *   - partial-witness — neither had an attempt after `204 + GRACE_MS` within
 *     the window: the schedule finished inside the grace, or runs past the
 *     window. Nothing was contradicted and nothing was shown.
 *   - inapplicable — `retryPolicy.maxAttempts: 1`: there is no retry to stop.
 *
 * GRACE_MS is an instrument setting, not a spec number: webhooks.md states the
 * in-flight allowance as "an attempt the host had begun sending", and the
 * receiver keys on ARRIVAL, so the grace only has to cover transit of a request
 * already on the wire (RFC 0215 Unresolved question 3).
 *
 * @see spec/v2/core/webhooks.md §Durability
 * @see RFCS/0215-webhook-delivery-isolation.md §B
 * @see SECURITY/invariants.yaml `webhook-unregister-stops-delivery`
 */

import { afterEach, describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { blockedDespiteAssertions, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { retryWaitCapMs, retryWaitFor } from '../lib/webhook-retry-window.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs and retries webhook deliveries to the suite-owned scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL';

const ID = 'openwop.requirement.0215.unregister-stops-delivery';
const DOC = 'webhooks.md §Durability (RFC 0215 §B)';
const FIXTURE = 'conformance-noop';
const GRACE_MS = 5_000;
/** Once the control has been retried past the grace, how long to keep listening for the target's matching retry. */
const SETTLE_MS = 5_000;
const CAP_MS = retryWaitCapMs();
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

let receiver: ScopedReceiver | null = null;
const registered: string[] = [];
afterEach(async () => {
  for (const id of registered.splice(0)) await driver.delete(`/webhooks/${encodeURIComponent(id)}`).catch(() => undefined);
  if (receiver) { const rx = receiver; receiver = null; await rx.close(); }
});

function advertisedRetryPolicy(doc: Record<string, unknown>): { maxAttempts?: number; backoff?: string } | null {
  const read = (holder: unknown): { maxAttempts?: number; backoff?: string } | null => {
    const rp = holder && typeof holder === 'object' ? (holder as { retryPolicy?: unknown }).retryPolicy : undefined;
    return rp && typeof rp === 'object' ? (rp as { maxAttempts?: number; backoff?: string }) : null;
  };
  return read(doc['webhooks']) ?? read(doc['triggerBridge']);
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

describe('RFC 0215 §B — unregistering stops the attempts (gated on webhooks)', () => {
  it('no attempt for an unregistered subscription starts after the 204, while its control keeps being retried', async () => {
    let doc: Record<string, unknown> | null = null;
    try { doc = await v2Discovery(); } catch { /* recorded below */ }
    if (doc === null) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!(Array.isArray(doc['fixtures']) && (doc['fixtures'] as unknown[]).includes(FIXTURE))) {
      return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to deliver`);
    }
    const policy = advertisedRetryPolicy(doc);
    if (policy?.maxAttempts === 1) return softSkip('inapplicable', 'webhooks.retryPolicy.maxAttempts is 1 — the host schedules no retry, so there is none for unregistering to stop');
    const windowMs = retryWaitFor(policy, CAP_MS);

    const arrivals = new Map<string, number[]>();
    let targetId: string | null = null;
    let unregisteredAt: number | null = null;
    let unregisterStatus = 0;
    let unregistering: Promise<void> | null = null;

    const rx = await startScopedReceiver((hit, res) => {
      const webhookId = String(hit.headers['openwop-webhook-id'] ?? hit.headers['x-openwop-webhook-id'] ?? '');
      const list = arrivals.get(webhookId) ?? [];
      list.push(Date.now());
      arrivals.set(webhookId, list);
      res.writeHead(500);
      res.end();
      // Unregister the target once its first attempt has been ANSWERED, so the
      // host has a retry scheduled and nothing of its own in flight.
      if (webhookId === targetId && unregistering === null) {
        unregistering = (async () => {
          const del = await driver.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
          unregisterStatus = del.status;
          if (del.status === 204) {
            unregisteredAt = Date.now();
            const i = registered.indexOf(webhookId);
            if (i >= 0) registered.splice(i, 1);
          }
        })();
      }
    });
    receiver = rx;

    const register = async (): Promise<string | null> => {
      const reg = await driver.post('/webhooks', { url: rx.url, events: ['run.completed'] });
      if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected' && !rx.tunnelled) return null;
      expect(reg.status, req(ID, 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
      const id = (reg.json as { webhookId?: unknown } | null)?.webhookId;
      expect(typeof id, req(ID, 'webhooks.md §Surfaces', 'the 201 body MUST carry `webhookId`')).toBe('string');
      registered.push(id as string);
      return id as string;
    };
    const controlId = await register();
    targetId = await register();
    if (controlId === null || targetId === null) {
      return blockedDespiteAssertions('host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel in front of the suite receiver');
    }
    const target = targetId;

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req(ID, 'runs.md §Create', `POST /runs MUST answer 201 for ${FIXTURE}`)).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    const deadline = Date.now() + 30_000;
    for (;;) {
      const r = await driver.get(`/runs/${encodeURIComponent(runId)}`);
      if (r.status === 200 && TERMINAL.has(String((r.json as { status?: unknown } | null)?.status ?? ''))) break;
      if (Date.now() > deadline) return blockedDespiteAssertions(`${FIXTURE} run ${runId} did not reach a terminal status — no run.completed to deliver`);
      await new Promise((r2) => setTimeout(r2, 250));
    }

    const firstTarget = await waitFor(() => (arrivals.get(target)?.length ?? 0) > 0, windowMs);
    if (!firstTarget) {
      if (absenceIsUnmeasured(rx)) return blockedDespiteAssertions(noDeliveryCause(rx, 'run.completed attempt'));
      return blockedDespiteAssertions(`the target subscription's first attempt never arrived, so there was nothing to unregister after — ${noDeliveryCause(rx, 'run.completed attempt')}`);
    }
    await waitFor(() => unregistering !== null, 5_000);
    if (unregistering !== null) await unregistering;
    expect(unregisterStatus, req(ID, 'webhooks.md §Surfaces', 'DELETE /webhooks/{webhookId} MUST answer 204 for the caller\'s own subscription')).toBe(204);
    const cutoff = (unregisteredAt as number | null ?? Date.now()) + GRACE_MS;

    const after = (id: string): number[] => (arrivals.get(id) ?? []).filter((t) => t > cutoff);
    await waitFor(() => after(controlId).length > 0 || after(target).length > 0, windowMs);
    if (after(controlId).length > 0) await new Promise((r) => setTimeout(r, SETTLE_MS));

    const targetLate = after(target);
    const controlLate = after(controlId);
    const detail = `target ${target}: ${arrivals.get(target)?.length ?? 0} attempt(s), ${targetLate.length} after the 204 + ${GRACE_MS}ms; control ${controlId}: ${arrivals.get(controlId)?.length ?? 0} attempt(s), ${controlLate.length} after that point`;
    expect(
      targetLate.length,
      req(ID, DOC, `after unregisterWebhook answers 204 the host MUST NOT start another attempt for that subscription, including retries already scheduled — ${detail}`),
    ).toBe(0);
    if (controlLate.length === 0) {
      return softSkip('skipped', `partial-witness: the control subscription was not retried after the 204 + ${GRACE_MS}ms within ${windowMs}ms either, so the target's silence shows nothing — the schedule finished inside the grace or runs past the window (raise OPENWOP_WEBHOOK_RETRY_WAIT_MS above the host's backoff sum) — ${detail}`);
    }
  }, CAP_MS * 2 + 90_000);
});
