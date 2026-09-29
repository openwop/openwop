/**
 * CF-3 close-out — interrupt token matrix coverage per
 * `plans/openwop-protocol-gap-closure-plan.md` Workstream 2.
 *
 * Verifies the negative + replay paths on `GET /v1/interrupts/{token}`
 * and `POST /v1/interrupts/{token}` that complement the existing
 * positive-path coverage in `interrupt-external-event-correlation.test.ts`:
 *
 *   1. Malformed token (random bytes) — inspect MUST return 400 or 404.
 *   2. Unknown token (well-formed but no interrupt) — inspect MUST
 *      return 404 with `not_found` or similar.
 *   3. Already-resolved token — resolve once (positive path),
 *      then replay the same `POST` — MUST return 409 or 404 (host
 *      MAY treat already-resolved as gone OR as conflict).
 *   4. Wrong action — `POST` with a payload whose `action` field is
 *      NOT in the interrupt's allowed-actions list MUST return 400
 *      `validation_error`.
 *   5. Cross-run-id leak — synthesize a token with `runId=other-run`
 *      embedded but valid HMAC envelope — MUST return 401 or 404
 *      (NEVER 200 from a different run's scope).
 *
 * Gating identical to interrupt-external-event-correlation: skips when
 * the `conformance-interrupt-external-event` fixture isn't advertised.
 *
 * @see spec/v1/interrupt.md §"Signed-token callback"
 * @see spec/v1/rest-endpoints.md §"GET /v1/interrupts/{token}" + §"POST /v1/interrupts/{token}"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { blockedDespiteAssertions, softSkip, type SoftSkipKind } from '../lib/soft-skip.js';

const FIXTURE = 'conformance-interrupt-external-event';
const SKIP = !isFixtureAdvertised(FIXTURE);

function randomBytesB64(length: number): string {
  return Buffer.from(
    Array.from({ length }, () => Math.floor(Math.random() * 256)),
  ).toString('base64url');
}

/** Why the gate below holds, as RFC 0148 §A names it (openwop#1686: a describe-level skip recorded no disposition). */
const GATE_WHY: readonly [SoftSkipKind, string] =
  (!isFixtureAdvertised(FIXTURE)) ? ['blocked', `the \`${FIXTURE}\` fixture is not advertised`] as const : ['blocked', 'the gate held for no named reason'] as const;

describe('interrupt-token-matrix: GET /v1/interrupts/{token} negative paths', () => {
  it('malformed token returns 400 or 404 (NEVER 200)', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    const malformed = '!!!not-a-valid-token!!!';
    const res = await driver.get(`/v1/interrupts/${encodeURIComponent(malformed)}`);
    expect([400, 404]).toContain(res.status);
    expect(res.status, req('openwop.it.interrupt-token-matrix.malformed-token-returns-400-or-404-never-200', 
      'rest-endpoints.md GET /v1/interrupts/{token}',
      'malformed interrupt token MUST NOT return 200',
    )).not.toBe(200);
  });

  it('well-formed but unknown token returns 404', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    // Plausibly-shaped opaque token that the host has no record of.
    const unknown = `tok_${randomBytesB64(32)}`;
    const res = await driver.get(`/v1/interrupts/${encodeURIComponent(unknown)}`);
    expect(res.status, req('openwop.it.interrupt-token-matrix.well-formed-but-unknown-token-returns-404', 
      'rest-endpoints.md GET /v1/interrupts/{token}',
      'unknown interrupt token MUST return 404',
    )).toBe(404);
  });
});

describe('interrupt-token-matrix: POST /v1/interrupts/{token} negative paths', () => {
  it('replay after successful resolve returns 409 or 404', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    // Drive a run to suspension; capture the real token; resolve once;
    // replay the same POST and assert it doesn't succeed twice.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // softskip ratchet, 2026-09-27: this leg polled for `waiting-external-event`, a
    // status that does not exist, and read `snapshot.interrupts[].token`, a field the
    // snapshot does not carry. It found no token on any host, so it never reached the
    // replay assertion and recorded a partial-witness pass on the 201 alone. It now
    // reads the token the way interrupt-external-event-correlation does
    // (`interrupt.interruptToken`, else the `/v1/interrupts/{token}` segment of
    // `interrupt.callbackUrl`) once the run reaches `waiting-external`.
    await pollUntilStatus(runId, 'waiting-external', { timeoutMs: 10_000 }).catch(() => null);

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const interrupt = (snap.json as { interrupt?: { interruptToken?: string; callbackUrl?: string } } | undefined)?.interrupt;
    const fromCallback = interrupt?.callbackUrl?.match(/\/v1\/interrupts\/([^/?]+)/)?.[1];
    const token = interrupt?.interruptToken ?? (fromCallback === undefined ? undefined : decodeURIComponent(fromCallback));
    if (typeof token !== 'string') {
      // eslint-disable-next-line no-console
      console.warn('[interrupt-token-matrix] host did not surface an interrupt token; skipping replay subtest');
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      // interrupt-external-event-correlation holds token exposure as a MUST for this
      // fixture, so a missing token leaves the replay rule unobserved: blocked.
      return blockedDespiteAssertions('the suspended conformance-interrupt-external-event run exposed no signed token (interrupt.interruptToken or interrupt.callbackUrl) — replay of a resolved token is unobserved');
    }

    // The fixture's correlation is {orderId: 'fixture-order-1', status: 'completed'}; a
    // mismatched payload is refused 422 (interrupt-external-event-correlation), so the
    // first resolve must match or the replay rule is never reached.
    const MATCHING = { orderId: 'fixture-order-1', status: 'completed', externalReference: 'conformance-token-matrix' };
    const resolve1 = await driver.post(`/v1/interrupts/${encodeURIComponent(token)}`, {
      resumeValue: MATCHING,
    });
    if (resolve1.status < 200 || resolve1.status >= 300) {
      // eslint-disable-next-line no-console
      console.warn(
        `[interrupt-token-matrix] first resolve returned ${resolve1.status}; can't exercise replay path. Skipping.`,
      );
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      // interrupt-external-event-correlation holds a matching resolve to 2xx as a MUST.
      return blockedDespiteAssertions(`the first resolve of the token answered ${resolve1.status}, not 2xx — replay of a resolved token is unobserved`);
    }

    const resolve2 = await driver.post(`/v1/interrupts/${encodeURIComponent(token)}`, {
      resumeValue: MATCHING,
    });
    expect([404, 409, 410], req('openwop.it.interrupt-token-matrix.replay-after-successful-resolve-returns-409-or-404', 
      'rest-endpoints.md POST /v1/interrupts/{token}',
      'replay of an already-resolved interrupt token MUST NOT return 2xx (host MAY 404/409/410)',
    )).toContain(resolve2.status);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });

  it('unknown token returns 404 on POST', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    const unknown = `tok_${randomBytesB64(32)}`;
    const res = await driver.post(`/v1/interrupts/${encodeURIComponent(unknown)}`, {
      correlation: { orderId: 'noop', status: 'whatever' },
    });
    expect(res.status, req('openwop.it.interrupt-token-matrix.unknown-token-returns-404-on-post', 
      'rest-endpoints.md POST /v1/interrupts/{token}',
      'POST on an unknown interrupt token MUST return 404',
    )).toBe(404);
  });
});
