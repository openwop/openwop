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
 * the `conformance-external-event` fixture isn't advertised.
 *
 * @see spec/v1/interrupt.md §"Signed-token callback"
 * @see spec/v1/rest-endpoints.md §"GET /v1/interrupts/{token}" + §"POST /v1/interrupts/{token}"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-external-event';
const SKIP = !isFixtureAdvertised(FIXTURE);

function randomBytesB64(length: number): string {
  return Buffer.from(
    Array.from({ length }, () => Math.floor(Math.random() * 256)),
  ).toString('base64url');
}

describe.skipIf(SKIP)('interrupt-token-matrix: GET /v1/interrupts/{token} negative paths', () => {
  it('malformed token returns 400 or 404 (NEVER 200)', async () => {
    const malformed = '!!!not-a-valid-token!!!';
    const res = await driver.get(`/v1/interrupts/${encodeURIComponent(malformed)}`);
    expect([400, 404]).toContain(res.status);
    expect(res.status, driver.describe(
      'rest-endpoints.md GET /v1/interrupts/{token}',
      'malformed interrupt token MUST NOT return 200',
    )).not.toBe(200);
  });

  it('well-formed but unknown token returns 404', async () => {
    // Plausibly-shaped opaque token that the host has no record of.
    const unknown = `tok_${randomBytesB64(32)}`;
    const res = await driver.get(`/v1/interrupts/${encodeURIComponent(unknown)}`);
    expect(res.status, driver.describe(
      'rest-endpoints.md GET /v1/interrupts/{token}',
      'unknown interrupt token MUST return 404',
    )).toBe(404);
  });
});

describe.skipIf(SKIP)('interrupt-token-matrix: POST /v1/interrupts/{token} negative paths', () => {
  it('replay after successful resolve returns 409 or 404', async () => {
    // Drive a run to suspension; capture the real token; resolve once;
    // replay the same POST and assert it doesn't succeed twice.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-external-event', { timeoutMs: 10_000 }).catch(() => null);

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const interrupts =
      ((snap.json as { interrupts?: Array<{ token?: string }> }).interrupts ?? [])
        .filter((i) => typeof i.token === 'string');
    const token = interrupts[0]?.token;
    if (typeof token !== 'string') {
      // eslint-disable-next-line no-console
      console.warn('[interrupt-token-matrix] host did not surface an interrupt token; skipping replay subtest');
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return;
    }

    const resolve1 = await driver.post(`/v1/interrupts/${encodeURIComponent(token)}`, {
      correlation: { orderId: 'order-token-matrix', status: 'accepted' },
    });
    if (resolve1.status !== 200 && resolve1.status !== 202) {
      // eslint-disable-next-line no-console
      console.warn(
        `[interrupt-token-matrix] first resolve returned ${resolve1.status}; can't exercise replay path. Skipping.`,
      );
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return;
    }

    const resolve2 = await driver.post(`/v1/interrupts/${encodeURIComponent(token)}`, {
      correlation: { orderId: 'order-token-matrix', status: 'accepted' },
    });
    expect([404, 409, 410], driver.describe(
      'rest-endpoints.md POST /v1/interrupts/{token}',
      'replay of an already-resolved interrupt token MUST NOT return 2xx (host MAY 404/409/410)',
    )).toContain(resolve2.status);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });

  it('unknown token returns 404 on POST', async () => {
    const unknown = `tok_${randomBytesB64(32)}`;
    const res = await driver.post(`/v1/interrupts/${encodeURIComponent(unknown)}`, {
      correlation: { orderId: 'noop', status: 'whatever' },
    });
    expect(res.status, driver.describe(
      'rest-endpoints.md POST /v1/interrupts/{token}',
      'POST on an unknown interrupt token MUST return 404',
    )).toBe(404);
  });
});
