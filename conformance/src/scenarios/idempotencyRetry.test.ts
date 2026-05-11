/**
 * Idempotency-retry scenarios per spec/v1/idempotency.md.
 *
 * Builds on `idempotency.test.ts` (which covers basic Layer-1 cache and
 * 409-on-body-conflict) by exercising the deterministic-dispatch
 * additions documented in idempotency.md:
 *
 *   1. openwop-Idempotent-Replay header is present on every keyed response
 *      (idempotency.md §Server responsibilities).
 *   2. Retry-budget floor — hosts handle ≥5 retries 100ms apart with
 *      the cached response (scale-profiles.md §"Retry semantics").
 *   3. Same-key replay returns same runId across the budget.
 *   4. (Optional) hosts that advertise `limits.idempotencyAckTimeoutSec`
 *      MUST set it to integer ≥ 5 per idempotency.md.
 *
 * Profile gating: `openwop-core` (and `openwop-stream-poll` to read snapshots).
 * Every conforming host runs these.
 *
 * @see spec/v1/idempotency.md
 * @see spec/v1/scale-profiles.md §"Retry semantics"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-idempotent';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

function freshKey(suffix: string): string {
  return `openwop-conformance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`;
}

describe.skipIf(SKIP_NO_FIXTURE)('idempotency-retry: openwop-Idempotent-Replay header per idempotency.md', () => {
  it('first request with new key returns false (or absent SHOULD per current spec); replay returns true', async () => {
    const key = freshKey('replay-header');
    const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'replay-test' } };

    const first = await driver.post('/v1/runs', body, { headers: { 'Idempotency-Key': key } });
    expect(first.status, driver.describe(
      'rest-endpoints.md',
      'first POST /v1/runs returns 201',
    )).toBe(201);

    const firstReplay = first.headers.get('openwop-idempotent-replay');
    // Per idempotency.md: header SHOULD be present even on the first call,
    // set to "false". Pre-RFC spec only requires it on the replay.
    // Permissive assertion: if present, MUST be "false" or "true".
    if (firstReplay !== null) {
      expect(['false', 'true'].includes(firstReplay), driver.describe(
        'idempotency.md §Server responsibilities',
        'openwop-Idempotent-Replay value MUST be "true" or "false"',
      )).toBe(true);
    }

    const replay = await driver.post('/v1/runs', body, { headers: { 'Idempotency-Key': key } });
    expect(
      [200, 201].includes(replay.status),
      driver.describe('idempotency.md §Layer 1', 'replay returns 200 or 201'),
    ).toBe(true);

    const replayHeader = replay.headers.get('openwop-idempotent-replay');
    // Per idempotency.md §Server responsibilities #2: SHOULD be set.
    // RFC 0002 §1 promotes to MUST. Today's strictness: present on replay.
    expect(replayHeader, driver.describe(
      'idempotency.md §Server responsibilities #2',
      'openwop-Idempotent-Replay SHOULD be set on idempotent replay responses',
    )).not.toBeNull();
    if (replayHeader !== null) {
      expect(replayHeader, driver.describe(
        'idempotency.md §Server responsibilities #2',
        'openwop-Idempotent-Replay on replay MUST be "true"',
      )).toBe('true');
    }
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('idempotency-retry: 5-retry budget per scale-profiles.md §"Retry semantics"', () => {
  it('5 retries 100ms apart with same key all return the same runId', async () => {
    const key = freshKey('retry-budget');
    const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'retry-budget' } };

    const responses = [];
    for (let i = 0; i < 5; i++) {
      const res = await driver.post('/v1/runs', body, { headers: { 'Idempotency-Key': key } });
      responses.push(res);
      if (i < 4) await new Promise((r) => setTimeout(r, 100));
    }

    for (const res of responses) {
      expect(
        [200, 201].includes(res.status),
        driver.describe(
          'scale-profiles.md §Retry semantics',
          'host MUST handle ≥5 retries 100ms apart without losing the cached response',
        ),
      ).toBe(true);
    }

    const runIds = new Set(responses.map((r) => (r.json as { runId?: string })?.runId));
    expect(runIds.size, driver.describe(
      'idempotency.md §Layer 1',
      '5 retries with same key MUST collapse to exactly one runId',
    )).toBe(1);
  });
});

describe('idempotency-retry: limits.idempotencyAckTimeoutSec contract per idempotency.md', () => {
  it('host advertising idempotencyAckTimeoutSec sets integer ≥ 5', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    expect(res.status).toBe(200);

    const limits = (res.json as { limits?: Record<string, unknown> })?.limits;
    if (!limits) return; // limits required per capabilities.md §3 — covered elsewhere
    const ack = limits.idempotencyAckTimeoutSec;
    if (ack === undefined) {
      // Per idempotency.md, the field is optional; absence implies the
      // 5-second floor. Nothing to assert.
      return;
    }
    expect(typeof ack === 'number' && Number.isInteger(ack), driver.describe(
      'idempotency.md',
      'limits.idempotencyAckTimeoutSec MUST be an integer when advertised',
    )).toBe(true);
    expect(ack as number, driver.describe(
      'idempotency.md',
      'limits.idempotencyAckTimeoutSec MUST be ≥ 5',
    )).toBeGreaterThanOrEqual(5);
  });
});
