/**
 * RFC 0215 §A — `webhook-delivery-isolation` (suite 2.40.0, target major 2; gated on `webhooks`).
 *
 * `spec/v2/core/webhooks.md` §Durability: a host MUST NOT make the start of an
 * attempt to one subscription wait for an attempt to a DIFFERENT subscription to
 * finish, and MUST sustain that while at least 8 subscriptions have attempts
 * outstanding that their receivers have not answered (§A.1 + §A.2, one
 * observation at the floor, so one requirement id).
 *
 * The shape (architect review, 2026-09-25): contention first, then the healthy
 * delivery falls due — so the dispatch order the host chooses cannot decide the
 * row. The RFC's first draft registered 9 subscriptions on one event and read a
 * healthy attempt that beat the held ones as `partial-witness`; this file
 * removes that case instead of recording it.
 *
 *   - 8 HELD subscriptions filter `run.started`. Their receiver accepts each
 *     attempt and never answers, until the leg ends.
 *   - 1 HEALTHY subscription filters `run.completed`, and answers 204.
 *   - One `conformance-delay` run of `DELAY_MS`. `run.started` makes the held
 *     attempts due at t0; `run.completed` makes the healthy one due at
 *     t0 + DELAY_MS, by which time 8 attempts are outstanding.
 *
 * Verdicts, each on a positive observation:
 *   - pass — the healthy attempt ARRIVED while all 8 held attempts were open.
 *   - fail — the healthy attempt arrived only once fewer than 8 were open (the
 *     host released one to make room), or never within the window, AND the held
 *     attempts had stayed open until the run was terminal: the contention the
 *     floor names existed when the healthy delivery fell due, and it waited.
 *   - partial-witness — the host's own delivery timeout closed held attempts
 *     before the run was terminal. Contention was not sustained when the
 *     healthy delivery fell due, so this run of the leg cannot judge §A. The
 *     timeout is the host's to choose; a host with a timeout shorter than
 *     DELAY_MS is simply not measured by this instrument.
 *   - blocked — fewer than 8 held attempts ever arrived AND the healthy one
 *     never did either: nothing reached the suite, which says nothing about
 *     isolation (`noDeliveryCause`).
 *
 * A bounded pool of k < 9 opens k held attempts, queues the rest and the
 * healthy one, and releases a slot only at its timeout — so it FAILS: its held
 * attempts were open when the run completed, and the healthy attempt waited for
 * one to close. That is the openwop-app WHD-1 defect (RFC 0215 §Motivation 1).
 *
 * @see spec/v2/core/webhooks.md §Durability
 * @see RFCS/0215-webhook-delivery-isolation.md §A
 * @see SECURITY/invariants.yaml `webhook-delivery-isolation`
 */

import { afterEach, describe, it, expect } from 'vitest';
import type { ServerResponse } from 'node:http';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { blockedDespiteAssertions, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { RETRY_WAIT_FLOOR_MS } from '../lib/webhook-retry-window.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs webhook deliveries to nine suite-owned subscriptions on the scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL, eight of which the suite holds open';

const ID = 'openwop.requirement.0215.no-head-of-line';
const DOC = 'webhooks.md §Durability (RFC 0215 §A.1, §A.2)';
const FIXTURE = 'conformance-delay';
/** §A.2's floor. Changing it is a spec change, not a tuning knob. */
const FLOOR = 8;
/**
 * How long after `run.started` the healthy delivery falls due. Short, so a host
 * whose delivery timeout is a few seconds still holds its 8 attempts open when
 * it does; long enough that the held attempts are dispatched first on any host
 * that dispatches at all.
 */
const DELAY_MS = 2_000;
/** How long the leg waits for the healthy attempt once the run is terminal. */
const WINDOW_MS = RETRY_WAIT_FLOOR_MS;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Held { readonly webhookId: string; readonly res: ServerResponse; readonly openedAt: number; closedAt: number | null }

let receiver: ScopedReceiver | null = null;
const registered: string[] = [];
let release: (() => void) | null = null;
afterEach(async () => {
  release?.();
  release = null;
  // RFC 0215 §B is what makes this cleanup work on a conforming host; on any
  // host it stops this file's subscriptions outliving the exercise.
  for (const id of registered.splice(0)) await driver.delete(`/webhooks/${encodeURIComponent(id)}`).catch(() => undefined);
  if (receiver) { const rx = receiver; receiver = null; await rx.close(); }
});

async function waitTerminal(runId: string, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : '';
    if (TERMINAL.has(status)) return Date.now();
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return pred();
}

describe('RFC 0215 §A — one subscription\'s receiver does not hold another\'s delivery (gated on webhooks)', () => {
  it(`a healthy subscription's attempt starts while ${FLOOR} other subscriptions' attempts are unanswered`, async () => {
    let doc: Record<string, unknown> | null = null;
    try { doc = await v2Discovery(); } catch { /* recorded below */ }
    if (doc === null) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!(Array.isArray(doc['fixtures']) && (doc['fixtures'] as unknown[]).includes(FIXTURE))) {
      return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run whose completion falls due after its start`);
    }

    const held = new Map<string, Held>();
    let healthyId: string | null = null;
    let healthyAt: number | null = null;
    let openAtHealthy = -1;
    const openCount = (): number => [...held.values()].filter((h) => h.closedAt === null).length;

    const rx = await startScopedReceiver((hit, res) => {
      const webhookId = String(hit.headers['openwop-webhook-id'] ?? hit.headers['x-openwop-webhook-id'] ?? '');
      if (webhookId !== '' && webhookId === healthyId) {
        if (healthyAt === null) { healthyAt = Date.now(); openAtHealthy = openCount(); }
        res.writeHead(204); res.end();
        return;
      }
      if (webhookId === '' || held.has(webhookId) || !registered.includes(webhookId)) {
        // A retry of a held attempt, or a stranger: answered, not counted as a new held attempt.
        res.writeHead(204); res.end();
        return;
      }
      const h: Held = { webhookId, res, openedAt: Date.now(), closedAt: null };
      held.set(webhookId, h);
      // The HOST closing the socket before we answer is the host abandoning the attempt.
      res.on('close', () => { if (h.closedAt === null) h.closedAt = Date.now(); });
    });
    receiver = rx;
    release = () => {
      for (const h of held.values()) {
        if (h.closedAt !== null) continue;
        h.closedAt = Date.now();
        try { h.res.writeHead(204); h.res.end(); } catch { /* host already gone */ }
      }
    };

    const register = async (events: string[]): Promise<string | null> => {
      const reg = await driver.post('/webhooks', { url: rx.url, events });
      if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected' && !rx.tunnelled) return null;
      expect(reg.status, req(ID, 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
      const id = (reg.json as { webhookId?: unknown } | null)?.webhookId;
      expect(typeof id, req(ID, 'webhooks.md §Surfaces', 'the 201 body MUST carry `webhookId`')).toBe('string');
      registered.push(id as string);
      return id as string;
    };
    for (let i = 0; i < FLOOR; i += 1) {
      if ((await register(['run.started'])) === null) {
        return blockedDespiteAssertions('host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel in front of the suite receiver');
      }
    }
    healthyId = await register(['run.completed']);
    if (healthyId === null) return blockedDespiteAssertions('host SSRF guard rejected the loopback receiver');

    const create = await driver.post('/runs', { workflowId: FIXTURE, inputs: { delayMs: DELAY_MS } });
    expect(create.status, req(ID, 'runs.md §Create', `POST /runs MUST answer 201 for ${FIXTURE}`)).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    const terminalAt = await waitTerminal(runId, DELAY_MS + 30_000);
    if (terminalAt === null) return blockedDespiteAssertions(`${FIXTURE} run ${runId} did not reach a terminal status — the healthy delivery never fell due`);
    const openAtTerminal = openCount();
    const everOpened = held.size;
    await waitFor(() => healthyAt !== null, WINDOW_MS);
    const earliestClose = Math.min(...[...held.values()].map((h) => h.closedAt ?? Infinity));
    const detail = `${everOpened} held attempt(s) arrived; ${openAtTerminal} were still open when the run was seen terminal; `
      + (healthyAt === null ? `the healthy attempt did not arrive within ${WINDOW_MS}ms of that` : `the healthy attempt arrived ${healthyAt - terminalAt}ms after it, with ${openAtHealthy} held open`);

    if (healthyAt === null && everOpened === 0) {
      if (absenceIsUnmeasured(rx)) return blockedDespiteAssertions(noDeliveryCause(rx, 'webhook attempt'));
      return blockedDespiteAssertions(`no attempt for any of the ${FLOOR + 1} subscriptions arrived — ${noDeliveryCause(rx, 'webhook attempt')}`);
    }
    if (healthyAt !== null && openAtHealthy >= FLOOR) {
      expect(openAtHealthy, req(ID, DOC, `an attempt to one subscription MUST NOT wait for attempts to other subscriptions — ${detail}`)).toBeGreaterThanOrEqual(FLOOR);
    } else if (openAtTerminal >= FLOOR) {
      // The healthy attempt waited (or never came), and the contention §A.2
      // names was present when it fell due.
      expect.fail(req(ID, DOC, `with ${FLOOR} subscriptions' attempts unanswered, a further subscription's attempt MUST still start; it waited for the host to release one — ${detail}`));
    } else if (everOpened >= FLOOR || earliestClose < terminalAt) {
      // Contention was not sustained to the due time. Either the host's own
      // delivery timeout released the held attempts early (its choice), or it
      // never opened FLOOR of them at once. The second is the defect, the first
      // is not, and they differ in WHEN the first held attempt closed.
      expect(everOpened, req(ID, DOC, 'the held subscriptions\' attempts MUST have been dispatched')).toBeGreaterThan(0);
      return softSkip('skipped', `partial-witness: the host closed held attempts ${Number.isFinite(earliestClose) ? `${terminalAt - earliestClose}ms ` : ''}before the run was terminal (its delivery timeout is shorter than this leg's ${DELAY_MS}ms delay), so ${FLOOR} attempts were not outstanding when the healthy delivery fell due — ${detail}`);
    } else {
      expect.fail(req(ID, DOC, `the host never had ${FLOOR} subscriptions' attempts outstanding at once, and the healthy attempt waited — a bounded dispatcher below the floor — ${detail}`));
    }
  }, DELAY_MS + 30_000 + RETRY_WAIT_FLOOR_MS + 30_000);
});
