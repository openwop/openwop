/**
 * Trigger dead-letter read — the §B rules (RFC 0232) — behavioral.
 *
 * Gated on `triggerBridge.deadLetter` together with
 * `triggerBridge.ingestion.inboundSigning` (the suite causes a dead letter
 * unaided by posting a bad signature to a `required` subscription). A host that
 * advertises neither records `inapplicable`.
 *
 * The record's content rules (§C) are leg 4a of `trigger-bridge-delivery`,
 * which is in the `openwop-trigger-bridge` floor. These are the read's own
 * rules, each its own requirement:
 *
 *   1. PAGING — `limit` is clamped, and a page that stops short carries
 *      `nextCursor`.
 *   2. CURSOR — a cursor minted for one subscription is refused on another,
 *      `400 validation_error`.
 *   3. TENANT — another tenant's credential reading this subscription's id gets
 *      `404 not_found`, exactly as for an id the host never minted. Needs
 *      `OPENWOP_TEST_TENANT_B_API_KEY`; without it the row is `blocked`.
 *
 * Spec references:
 *   - spec/v1/trigger-bridge.md §C (Run-less transitions are recorded)
 *   - spec/v2/core/webhooks.md §Inbound triggers
 *   - RFCS/0232-trigger-dead-letter-read.md §B
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';
import { inboundSigningAdvertised, registerSignedWebhook, signedIngest, type SignedWebhookSubscription } from '../lib/triggerBridge.js';
import { deadLetterFacet, readDeadLetters, type DeadLetterFacet } from '../lib/trigger-dead-letter-witness.js';

const R_PAGING = 'openwop.requirement.0232.trigger-dead-letters.paging';
const R_CURSOR = 'openwop.requirement.0232.trigger-dead-letters.cursor-bound';
const R_TENANT = 'openwop.requirement.0232.trigger-dead-letters.tenant-bound';

const BAD_SIGNATURE = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** The facet, or null with the reason the row is `inapplicable`. */
async function gate(): Promise<{ facet: DeadLetterFacet } | { reason: string }> {
  const disco = await driver.get('/.well-known/openwop');
  const facet = disco.status === 200 ? deadLetterFacet(disco.json) : null;
  if (facet === null) return { reason: 'the host does not advertise triggerBridge.deadLetter' };
  if (!(await inboundSigningAdvertised())) return { reason: 'triggerBridge.deadLetter is advertised without inboundSigning, so the suite cannot cause a dead letter unaided' };
  return { facet };
}

/** A `required` subscription with `n` refused posts dead-lettered on it. */
async function withRefused(id: string, n: number): Promise<SignedWebhookSubscription> {
  const sub = await registerSignedWebhook('required');
  if ('reason' in sub) throw new Error(req(id, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
  for (let i = 0; i < n; i++) {
    const bad = await signedIngest(sub, JSON.stringify({ conformance: 'dead-letter-read', i }), { signature: BAD_SIGNATURE });
    expect(bad.status, req(id, 'trigger-bridge.md §F.6', `a bad signature under required verification MUST answer 401 (got ${bad.status})`)).toBe(401);
  }
  return sub;
}

function deliveriesOf(json: unknown): unknown[] {
  const d = (json as { deliveries?: unknown } | undefined)?.deliveries;
  return Array.isArray(d) ? d : [];
}

describe('trigger-dead-letter-read (RFC 0232 §B)', () => {
  it('clamps limit and continues a short page with nextCursor', async () => {
    const g = await gate();
    if ('reason' in g) return softSkip('inapplicable', g.reason);
    const sub = await withRefused(R_PAGING, 2);
    const first = await readDeadLetters(sub.subscriptionId, { limit: 1 });
    expect(first.status, req(R_PAGING, 'trigger-bridge.md §C', `a host advertising triggerBridge.deadLetter MUST serve the read (got ${first.status})`)).toBe(200);
    expect(deliveriesOf(first.json).length, req(R_PAGING, 'trigger-bridge.md §C', 'a page MUST NOT exceed limit')).toBe(1);
    const cursor = (first.json as { nextCursor?: unknown } | undefined)?.nextCursor;
    expect(typeof cursor === 'string' && cursor.length > 0, req(R_PAGING, 'trigger-bridge.md §C', 'with two dead letters and limit 1, the page MUST carry nextCursor')).toBe(true);
    const second = await readDeadLetters(sub.subscriptionId, { limit: 1, cursor: cursor as string });
    expect(second.status, req(R_PAGING, 'trigger-bridge.md §C', `the page's own cursor MUST be accepted (got ${second.status})`)).toBe(200);
    expect(deliveriesOf(second.json).length, req(R_PAGING, 'trigger-bridge.md §C', 'the next page MUST carry the second dead letter')).toBe(1);
    const big = await readDeadLetters(sub.subscriptionId, { limit: g.facet.maxPageSize + 1 });
    expect(big.status, req(R_PAGING, 'trigger-bridge.md §C', `a limit above maxPageSize MUST be clamped, not refused (got ${big.status})`)).toBe(200);
  });

  it('refuses a cursor minted for another subscription', async () => {
    const g = await gate();
    if ('reason' in g) return softSkip('inapplicable', g.reason);
    const a = await withRefused(R_CURSOR, 2);
    const page = await readDeadLetters(a.subscriptionId, { limit: 1 });
    const cursor = (page.json as { nextCursor?: unknown } | undefined)?.nextCursor;
    expect(typeof cursor === 'string' && cursor.length > 0, req(R_CURSOR, 'trigger-bridge.md §C', `with two dead letters and limit 1, the page MUST carry nextCursor (read answered ${page.status})`)).toBe(true);
    const b = await withRefused(R_CURSOR, 1);
    const cross = await readDeadLetters(b.subscriptionId, { cursor: cursor as string });
    expect(cross.status, req(R_CURSOR, 'trigger-bridge.md §C', `a cursor minted for another subscription MUST be refused 400 (got ${cross.status})`)).toBe(400);
    expect(readErrorCode(cross.json), req(R_CURSOR, 'trigger-bridge.md §C', 'the refusal MUST carry validation_error')).toBe('validation_error');
  });

  it("answers another tenant's read of a subscription 404, as for an id never minted", async () => {
    const g = await gate();
    if ('reason' in g) return softSkip('inapplicable', g.reason);
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-tenant read cannot run');
    if (other.trim() === loadEnv().apiKey) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the second credential must resolve to a DIFFERENT tenant, or the leg measures nothing');
    const sub = await withRefused(R_TENANT, 1);
    const path = (id: string): string => `/v1/trigger-subscriptions/${encodeURIComponent(id)}/dead-letters`;
    const foreign = await driver.get(path(sub.subscriptionId), { headers: { Authorization: `Bearer ${other}` } });
    expect(foreign.status, req(R_TENANT, 'trigger-bridge.md §C', `another tenant's read MUST answer 404 (got ${foreign.status})`)).toBe(404);
    expect(JSON.stringify(foreign.json ?? null).includes('verification_failed'), req(R_TENANT, 'trigger-bridge.md §C', 'a foreign read MUST NOT disclose a record')).toBe(false);
    const unknown = await driver.get(path(`${sub.subscriptionId}-never-minted`));
    expect(unknown.status, req(R_TENANT, 'trigger-bridge.md §C', `an id the host never minted MUST answer 404 (got ${unknown.status})`)).toBe(404);
    expect(readErrorCode(foreign.json), req(R_TENANT, 'trigger-bridge.md §C', 'a foreign id MUST be answered exactly as an unknown one')).toBe(readErrorCode(unknown.json));
  });
});
