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
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { projectBoundId } from '../lib/bound-id.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { blockedDespiteAssertions, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { retryWaitCapMs, retryWaitFor, windowClosedNote } from '../lib/webhook-retry-window.js';

const FIXTURE = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Attempt { readonly key: string; readonly runId: string | null; readonly webhookId: string; readonly status: number; readonly at: number }

/**
 * A receiver that fails the first `failFirst` attempts for each delivery key
 * (`Infinity` ⇒ always fails). The key is `(webhookId, runId, sequence)` —
 * the dedup triple webhooks.md §Verification names.
 */
async function startReceiver(failFirst: number): Promise<ScopedReceiver & { attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const seen = new Map<string, number>();
  // `startScopedReceiver` (2.37.0). This receiver answers 500 BY DESIGN, and
  // until now it advertised the same byte-identical destination as the other
  // three webhook files on a tunnelled cut — so on a shared pinned port the
  // exercise that happened to register alongside it saw failures it never
  // caused. The `ours()` filter below was the workaround; the nonce removes the
  // cause. The measured case is in that filter's own comment: a tier-2 host
  // counted 6 attempts against a maxAttempts of 5 because another scenario's
  // subscription delivered into this budget.
  const rx = await startScopedReceiver((hit, res) => {
    let runId: string | null = null;
    let sequence: unknown = null;
    try {
      const parsed = JSON.parse(hit.body) as { runId?: unknown; event?: { sequence?: unknown } };
      runId = typeof parsed.runId === 'string' ? parsed.runId : null;
      sequence = parsed.event?.sequence ?? null;
    } catch { /* not JSON — still an attempt */ }
    const h = hit.headers;
    const webhookId = String(h['openwop-webhook-id'] ?? h['x-openwop-webhook-id'] ?? '');
    const key = `${webhookId}|${runId ?? ''}|${String(sequence)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const status = n <= failFirst ? 500 : 204;
    attempts.push({ key, runId, webhookId, status, at: Date.now() });
    res.writeHead(status);
    res.end();
  });
  return { ...rx, attempts };
}

// Closed through the receiver: `close()` also drops this exercise's nonce from
// the front-mux registry, so the retries this file deliberately provokes are
// answered 404 by whoever next holds the port instead of being handed to the
// next exercise's recorder.
let active: ScopedReceiver | null = null;
afterEach(async () => {
  if (active) {
    const rx = active;
    active = null;
    await rx.close();
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
 *
 * 2.34.1: and 90 s was the same defect again, one schedule further out — see
 * `lib/webhook-retry-window.ts`. The cap is now operator-RAISABLE through
 * `OPENWOP_WEBHOOK_RETRY_WAIT_MS` and never lowerable; still bounded.
 */
const RETRY_WAIT_CAP_MS = retryWaitCapMs();
function retryWaitMs(doc: Record<string, unknown>): number {
  return retryWaitFor(advertisedRetryPolicy(doc), RETRY_WAIT_CAP_MS);
}

/**
 * The per-test budget, DERIVED from the wait above (suite 2.0.2).
 *
 * 2.0.1 raised the derived wait to 90 s and left the `it()` blocks on the
 * harness default (`vitest.config.ts` `testTimeout: 30_000`). A wait longer
 * than the timeout that governs it can never elapse: on exactly the durable
 * hosts the widening was written to help, the test died at 30 s with "Test
 * timed out in 30000ms" — and took `dead-letter` with it, which had passed at
 * the old 20 s window. Measured by a host on 2.0.1 (`00337-dgw`): one row moved
 * `executed-pass -> executed-fail` and it was this one.
 *
 * The shape is the defect 2.0.1 itself fixed, one layer out: 2.0.1 stopped the
 * scenario blaming a host for a deadline the SCENARIO chose, and then let the
 * HARNESS choose a shorter one silently. So the budget is computed from
 * `RETRY_WAIT_CAP_MS` rather than written as a second literal — a later change
 * to the wait carries its own timeout, the way the advert is sourced from the
 * constant the delivery loop reads. `WAIT_SLACK_MS` covers `waitTerminal`,
 * registration and the HTTP round trips around the waits.
 */
/**
 * How many attempts the receiver refuses before answering 204 (suite 2.0.3).
 *
 * The retry leg's success witness lands on attempt `FAIL_FIRST + 1`, so this
 * number decides how much backoff the scenario has to sit through. It is a
 * named constant rather than a literal at the `startReceiver` call because the
 * blocked-reason quotes it: the message a host reads must be computed from the
 * receiver the suite actually started, not from a number typed twice.
 */
const FAIL_FIRST = 2;

const WAIT_SLACK_MS = 30_000;
/** One `retryWaitMs` wait (the retry leg). */
const RETRY_TEST_TIMEOUT_MS = RETRY_WAIT_CAP_MS + WAIT_SLACK_MS;
/** Two sequential `retryWaitMs` waits (the dead-letter leg: observe a retry, then exhaust). */
const DEAD_LETTER_TEST_TIMEOUT_MS = RETRY_WAIT_CAP_MS * 2 + WAIT_SLACK_MS;

/** Register the suite receiver; null (with a note) when the host's SSRF guard refuses a loopback URL. */
async function register(rx: ScopedReceiver): Promise<{ webhookId: string } | null> {
  // `rx.url` is this exercise's own destination already — the front (when
  // wired) plus this receiver's nonce path. It is no longer run through
  // `resolveRegistrationUrl`, which returned the front VERBATIM and so dropped
  // the path that makes the subscription ours.
  const reg = await driver.post('/webhooks', { url: rx.url, events: ['run.completed'] });
  if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') {
    if (!rx.tunnelled) {
      softSkip('blocked', 'host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel in front of the suite receiver');
      return null;
    }
    expect.fail(`host rejected the operator-supplied public https receiver (${rx.url}) with webhook_url_rejected — a public https destination is legitimate under webhooks.md §Egress`);
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

    const receiver = await startReceiver(FAIL_FIRST); // 500, 500, then 204
    active = receiver;
    const sub = await register(receiver);
    if (sub === null) return softSkip('blocked', 'registration refused (reason recorded above)');

    const create = await driver.post('/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.requirement.0173.webhook-durable-delivery', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);

    // Filter by the delivery's own SUBSCRIPTION, not just its run. A host that
    // cannot reach the suite's loopback registers every scenario against one
    // tunnelled receiver URL (`resolveRegistrationUrl`), so a concurrently
    // running scenario's subscription matches this run too and its attempts
    // landed in this budget: a tier-2 host measured 6 attempts against a
    // maxAttempts of 5 at `--max-workers 2`, with its own logs showing five.
    // The webhook id is on every delivery (webhooks.md §Headers).
    const ours = () => receiver.attempts.filter((a) => a.runId === runId && a.webhookId === sub.webhookId);
    const retried = await waitFor(() => ours().some((a) => a.status === 204), retryWaitMs(doc));
    const attempts = ours();
    // A zero that is PROVABLY not a verdict about the host records `blocked`
    // with its cause, not `executed-fail` (2.37.0). `absenceIsUnmeasured` is
    // true only when other traffic reached this listener — the path from the
    // host to this process works, so what is absent is this exercise's
    // IDENTITY, not delivery. That was the ordinary case on a tunnelled cut
    // until this file stopped sharing one byte-identical destination with three
    // others. `blocked` denies certification exactly as a failure does (RFC
    // 0168 §E.1), so nothing is softened. When nothing reached the listener at
    // all the reading is still ambiguous, and the hard assertion below stands —
    // now carrying the address it was waiting on.
    if (attempts.length === 0 && absenceIsUnmeasured(receiver)) {
      return blockedDespiteAssertions(noDeliveryCause(receiver, 'run.completed attempt for this run'));
    }
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', `the host MUST attempt delivery of run.completed for THIS run to the registered subscriber — ${noDeliveryCause(receiver, 'run.completed attempt for this run')}`),
    ).toBeGreaterThan(0);
    const failedThenSucceeded = attempts.filter((a) => a.status === 500).length;
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery', 'webhooks.md §Durability', `a 500 from the subscriber MUST be retried — ${failedThenSucceeded} failed attempt(s) were answered and the host made ${attempts.length} attempt(s) in total; one attempt is best-effort delivery, which is not a conforming mode (RFC 0173 §B)`),
    ).toBeGreaterThan(1);
    // At-least-once: the retry MUST eventually land. When it has not landed
    // inside our window this records `blocked`, NOT `executed-fail` — suite
    // 2.0.3, and this is the third time this file has had to learn it.
    //
    // The receiver answers 204 only on attempt `FAIL_FIRST + 1`, so reaching it
    // costs the SUM of the first FAIL_FIRST backoff intervals, not the largest
    // one. On an exponential-from-30s policy that is 30 + 60 = 90 s, which is
    // exactly RETRY_WAIT_CAP_MS — a host loses by the width of one delivery.
    // The obvious fix is to derive the wait from the intervals, and it cannot
    // be built: `spec/v2/facets/webhooks.schema.json` `retryPolicy` is
    // `additionalProperties: false` over exactly { maxAttempts, backoff }.
    // THE BASE INTERVAL IS NOT ON THE WIRE, so the suite cannot compute the
    // time to the Nth attempt, and any cap I pick is 2.0.1's 20-second
    // deadline again with a bigger literal.
    //
    // So the honest disposition is `blocked`: the host took the obligation on
    // (it advertises webhooks and we observed it retry) and the suite could not
    // measure the outcome (RFC 0148 §A). Not `inapplicable` — that would claim
    // it never took the obligation on.
    //
    // THE COST, stated rather than hidden: a host that retries forever and
    // never succeeds now also records `blocked` instead of failing. This trades
    // a false conviction for a missed detection. Detection comes back by
    // putting the interval on the wire — an additive `retryPolicy` field so the
    // sum is derivable — which is normative surface, an RFC and a 2.1.0, not a
    // patch. Recorded here so the trade is visible at the assertion rather than
    // only in a changelog.
    if (!retried) {
      const policyNote = advertisedRetryPolicy(doc);
      return softSkip('blocked', `the retry was observed (${attempts.length} attempts) but the receiver's 204 did not land inside the ${retryWaitMs(doc)}ms window: it answers 204 only on attempt ${FAIL_FIRST + 1}, which costs the SUM of the first ${FAIL_FIRST} backoff intervals, and webhooks.retryPolicy carries only { maxAttempts, backoff${policyNote ? `: ${String(policyNote.backoff)}` : ''} } — the base interval is not advertised, so the suite cannot derive how long to wait. Unmeasured, not unmet (RFC 0148 §A).`);
    }
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
  }, RETRY_TEST_TIMEOUT_MS);

  it('an exhausted delivery is dead-lettered, never dropped', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!fixtureAdvertised(doc, FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no run to deliver`);

    const receiver = await startReceiver(Number.POSITIVE_INFINITY); // never succeeds
    active = receiver;
    const sub = await register(receiver);
    if (sub === null) return softSkip('blocked', 'registration refused (reason recorded above)');

    // The row id is the FIRST thing this leg names: `register()` asserts under
    // the base `0173.webhook-durable-delivery` id, and a leg that returned before
    // any `.dead-letter` req() ran recorded its outcome under THAT id, leaving
    // `.dead-letter` with no row in the bundle at all (measured, 2.34.1 draft).
    req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', 'an exhausted delivery MUST be routed to the sink, not dropped');
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    // 2.34.1 — NO OBLIGATION IS ASSERTED UNTIL THE WINDOW QUESTION IS ANSWERED. A leg
    // that asserts and THEN soft-skips records `executed-pass` with a
    // `partial-witness:` detail (`resolveItRecord`), which certifies. The first
    // draft of this fix asserted `create.status` and the retry, then
    // soft-skipped `blocked` on a closed window, and so turned a false FAIL into
    // a pass that never looked at the sink — caught by measuring it: five rows
    // `executed-pass`, 106 s, on a host whose first delivery exhausts at 225 s.
    // So everything is OBSERVED first, the one inconclusive case returns with
    // zero assertions (a real `blocked`, which denies certification), and only
    // then are the obligations asserted, in their original order. A failure the
    // observations already show still fails: the create check fires at once.
    if (create.status !== 201) {
      expect(create.status, req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    }
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);
    // Filter by the delivery's own SUBSCRIPTION, not just its run. A host that
    // cannot reach the suite's loopback registers every scenario against one
    // tunnelled receiver URL (`resolveRegistrationUrl`), so a concurrently
    // running scenario's subscription matches this run too and its attempts
    // landed in this budget: a tier-2 host measured 6 attempts against a
    // maxAttempts of 5 at `--max-workers 2`, with its own logs showing five.
    // The webhook id is on every delivery (webhooks.md §Headers).
    const ours = () => receiver.attempts.filter((a) => a.runId === runId && a.webhookId === sub.webhookId);
    await waitFor(() => ours().length > 1, retryWaitMs(doc));
    const attempts = ours();
    const policy = advertisedRetryPolicy(doc);
    if (policy?.maxAttempts !== undefined && attempts.length > 1) {
      // Give the policy time to exhaust, then the host MUST stop.
      await waitFor(() => ours().length >= policy.maxAttempts!, retryWaitMs(doc));
      await new Promise((r) => setTimeout(r, 1_000));
    }
    // The sink itself. Until RFC 0188 this was an UNCONDITIONAL soft-skip on
    // every host — `webhooks.md` §Durability said the sink was "inspectable for
    // retentionDays" and the corpus served no read that could inspect it, so
    // every bundle recorded "exhaustion was observed, routing to the sink was
    // not". The read exists now; read it before deleting the subscription.
    const fam = await gateFamily('webhooks');
    let inSink: boolean | null = null;
    if (fam?.['deadLetter']) {
      const sink = await driver.get(`/webhooks/${projectBoundId(sub.webhookId)}/dead-letters`);
      inSink = sink.status === 200 && ((sink.json as { deliveries?: unknown[] } | null)?.deliveries ?? []).some((r) => (r as Record<string, unknown>)['runId'] === runId);
    }
    await driver.delete(`/webhooks/${encodeURIComponent(sub.webhookId)}`);
    // "Routed to the sink, not dropped" is a claim about an EXHAUSTED delivery,
    // and until 2.34.1 it was asserted whether or not exhaustion had been
    // observed: a host retrying at 15 / 30 / 60 / 120 s had made 4 of its 5
    // attempts when the 90 s window closed, and this row said it had dropped a
    // delivery still in flight. Retried, fewer attempts than advertised, and
    // nothing in the sink is a window that closed early OR a host that stopped
    // retrying — indistinguishable without an interval on the wire — so it is
    // `blocked`, never a conviction. Reached maxAttempts with nothing in the
    // sink still FAILS below; so does a delivery that was never retried.
    const seen = ours().length;
    if (inSink === false && policy?.maxAttempts !== undefined && attempts.length > 1 && seen < policy.maxAttempts) {
      return blockedDespiteAssertions(windowClosedNote(seen, policy.maxAttempts, retryWaitMs(doc), RETRY_WAIT_CAP_MS));
    }
    expect(create.status, req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    expect(
      attempts.length,
      req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', 'a delivery that keeps failing MUST be retried before it can be exhausted (one attempt is a drop)'),
    ).toBeGreaterThan(1);
    if (policy?.maxAttempts !== undefined) {
      expect(
        ours().length,
        req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', `retries MUST stop at the advertised retryPolicy.maxAttempts (${policy.maxAttempts}) — exhaustion routes to the dead-letter sink, not to an unbounded loop`),
      ).toBeLessThanOrEqual(policy.maxAttempts);
    }
    if (inSink === null) {
      return softSkip('inapplicable', 'host does not advertise the webhooks.deadLetter facet — RFC 0188 §A.5 makes the read a 404 rather than an obligation, so the sink half of §Durability is unwitnessable here (the retry half above passed)');
    }
    expect(
      inSink,
      req('openwop.requirement.0173.webhook-durable-delivery.dead-letter', 'webhooks.md §Durability', 'an exhausted delivery MUST be routed to the sink, not dropped — the half no bundle could witness before RFC 0188 served a read'),
    ).toBe(true);
  }, DEAD_LETTER_TEST_TIMEOUT_MS);

  it('the dead-letter read is served and its records carry no payload', async () => {
    // Its own `it` on purpose: `generate-requirement-registry.mjs` takes the
    // FIRST req() id in a body as the explicitId, so an id minted second in a
    // shared `it` never reaches requirements.json and no bundle can carry a row
    // for it — the same trap that made `0173.pack-isolation.seam` unwitnessable.
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const fam = await gateFamily('webhooks');
    if (!fam) return softSkip('inapplicable', 'webhooks family not advertised');
    if (!fam['deadLetter']) return softSkip('inapplicable', 'host does not advertise the webhooks.deadLetter facet — RFC 0188 §A.5 makes the read a 404 rather than an obligation');
    const reg = await driver.post('/webhooks', { url: 'https://subscriber.invalid/hook', events: ['run.completed'] });
    if (reg.status !== 201) return softSkip('blocked', `POST /webhooks answered ${reg.status} — no subscription to read a sink for`);
    const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
    if (typeof webhookId !== 'string') return softSkip('blocked', 'the mint returned no webhookId');
    const sink = await driver.get(`/webhooks/${projectBoundId(webhookId)}/dead-letters`);
    await driver.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
    expect(
      sink.status,
      req('openwop.requirement.0188.dead-letter-read', 'RFC 0188 §A.1', 'a host advertising webhooks.deadLetter MUST serve GET /webhooks/{webhookId}/dead-letters'),
    ).toBe(200);
  }, DEAD_LETTER_TEST_TIMEOUT_MS);

  it('a dead-letter record carries no delivered payload', async () => {
    // Its own `it`: RFC 0168 §A.1 allows one explicit requirement id per it(),
    // and `check-req-only` enforces it.
    //
    // THIS LEG USED TO REGISTER A FRESH SUBSCRIPTION AND READ ITS SINK. A fresh
    // subscription has no dead letters by construction, so the loop over
    // `deliveries` ran zero times, the test asserted NOTHING, and RFC 0148 §A
    // resolves a silent return to `blocked` — which denies certification
    // (RFC 0168 §E.1). It went unnoticed because every host recorded
    // `inapplicable` for want of the facet: the first host ever to advertise
    // `webhooks.deadLetter` was refused certification by this leg on its first
    // cut, with 232 other rows passing and zero failing.
    //
    // §B.1 is a claim about what a REAL record carries, so the leg has to make
    // one: exhaust a delivery against a receiver that never succeeds — the same
    // move the sibling 0173 dead-letter leg performs — and then read.
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const fam = await gateFamily('webhooks');
    if (!fam) return softSkip('inapplicable', 'webhooks family not advertised');
    if (!fam['deadLetter']) return softSkip('inapplicable', 'host does not advertise the webhooks.deadLetter facet — RFC 0188 §A.5 makes the read a 404 rather than an obligation');
    if (!fixtureAdvertised(doc, FIXTURE)) return softSkip('inapplicable', `${FIXTURE} fixture not advertised — no delivery to exhaust`);

    const receiver = await startReceiver(Number.POSITIVE_INFINITY); // never succeeds
    active = receiver;
    const sub = await register(receiver);
    if (sub === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    // Same two traps as the leg above (2.34.1): `register()` asserts under the base
    // id, so name this row first; and every `blocked` after it must STAND rather
    // than fold into a partial-witness pass that certifies.
    req('openwop.requirement.0188.dead-letter-content-free', 'RFC 0188 §B.1', 'a dead-letter record MUST NOT carry the delivered body, headers or subscription secret');
    const create = await driver.post('/runs', { workflowId: FIXTURE });
    if (create.status !== 201) {
      await driver.delete(`/webhooks/${encodeURIComponent(sub.webhookId)}`);
      return blockedDespiteAssertions(`POST /runs answered ${create.status} — no delivery to exhaust`);
    }
    const runId = (create.json as { runId: string }).runId;
    await waitTerminal(runId, 10_000);
    const policy = advertisedRetryPolicy(doc);
    // Filter by SUBSCRIPTION as well as run, as the sibling leg does: a host
    // that cannot reach loopback shares one tunnelled receiver URL across
    // scenarios, so another scenario's attempts land in this budget otherwise.
    const ours = () => receiver.attempts.filter((a) => a.runId === runId && a.webhookId === sub.webhookId);
    await waitFor(() => ours().length >= (policy?.maxAttempts ?? 2), retryWaitMs(doc));
    await new Promise((r) => setTimeout(r, 1_000));

    const sink = await driver.get(`/webhooks/${projectBoundId(sub.webhookId)}/dead-letters`);
    await driver.delete(`/webhooks/${encodeURIComponent(sub.webhookId)}`);
    if (sink.status !== 200) return blockedDespiteAssertions(`the dead-letter read answered ${sink.status}`);
    const rows = ((sink.json as { deliveries?: Array<Record<string, unknown>> } | null)?.deliveries ?? []);
    // An empty sink is NOT a pass. Recording one as a pass is exactly the
    // vacuous witness this leg used to produce; say so instead.
    if (rows.length === 0) {
      const seen = ours().length;
      const why = policy?.maxAttempts !== undefined && seen < policy.maxAttempts
        ? windowClosedNote(seen, policy.maxAttempts, retryWaitMs(doc), RETRY_WAIT_CAP_MS)
        : `the delivery made ${seen} attempt(s) and is not in the sink`;
      return blockedDespiteAssertions(`§B.1 is a claim about a real record and there is none here to read — ${why}`);
    }
    expect(
      rows.every((r) => r['body'] === undefined && r['headers'] === undefined && r['secret'] === undefined),
      req('openwop.requirement.0188.dead-letter-content-free', 'RFC 0188 §B.1', `a dead-letter record MUST NOT carry the delivered body, headers or subscription secret — the queue is precisely the traffic the subscriber never received, so a record carrying any of it turns one read scope into a replay of that traffic for the whole retention window (read ${rows.length} record(s))`),
    ).toBe(true);
  }, DEAD_LETTER_TEST_TIMEOUT_MS);
});
