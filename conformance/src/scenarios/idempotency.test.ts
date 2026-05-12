/**
 * Idempotency scenarios — exercises the `Idempotency-Key` header
 * contract on `POST /v1/runs` per `idempotency.md` and
 * `rest-endpoints.md`.
 *
 * Uses the `conformance-idempotent` fixture. Server MUST have seeded
 * it. The fixture's `nonce` input has no side effect — it exists so
 * the conformance suite can vary the body without affecting behavior.
 *
 * @see spec/v1/idempotency.md §Layer 1
 * @see spec/v1/rest-endpoints.md
 * @see spec/v1/production-profile.md §"Retry and idempotency" (RFC 0009
 *      — this scenario satisfies the basic-idempotency predicate when
 *      the host advertises capabilities.production.supported: true)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-idempotent';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

function freshKey(suffix: string): string {
  return `openwop-conformance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`;
}

describe.skipIf(SKIP_NO_FIXTURE)('idempotency: same key + same body replays per idempotency.md §Layer 1', () => {
  it('returns same runId twice and sets openwop-Idempotent-Replay on the replay', async () => {
    const key = freshKey('replay');
    const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'abc-123' } };

    const first = await driver.post('/v1/runs', body, {
      headers: { 'Idempotency-Key': key },
    });
    expect(first.status, driver.describe(
      'rest-endpoints.md',
      'first POST /v1/runs MUST return 201',
    )).toBe(201);
    const firstRunId = (first.json as { runId: string }).runId;

    const replay = await driver.post('/v1/runs', body, {
      headers: { 'Idempotency-Key': key },
    });
    expect(
      [200, 201].includes(replay.status),
      driver.describe(
        'idempotency.md §Layer 1',
        'replay request with same key + same body MUST return success status (200/201)',
      ),
    ).toBe(true);

    const replayRunId = (replay.json as { runId: string }).runId;
    expect(replayRunId, driver.describe(
      'idempotency.md §Layer 1',
      'replay MUST return the SAME runId (no new run created)',
    )).toBe(firstRunId);

    const replayHeader = replay.headers.get('openwop-idempotent-replay');
    expect(replayHeader, driver.describe(
      'rest-endpoints.md POST /v1/runs response headers',
      'openwop-Idempotent-Replay header MUST be set on cache-served responses',
    )).toBeTruthy();
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('idempotency: same key + different body conflicts per idempotency.md §Layer 1', () => {
  it('returns 409 when the body changes under the same key', async () => {
    const key = freshKey('conflict');

    const first = await driver.post(
      '/v1/runs',
      { workflowId: WORKFLOW_ID, inputs: { nonce: 'first' } },
      { headers: { 'Idempotency-Key': key } },
    );
    expect(first.status).toBe(201);

    const conflict = await driver.post(
      '/v1/runs',
      { workflowId: WORKFLOW_ID, inputs: { nonce: 'DIFFERENT' } },
      { headers: { 'Idempotency-Key': key } },
    );

    expect(conflict.status, driver.describe(
      'idempotency.md §Layer 1',
      'same Idempotency-Key with a different body MUST return 409',
    )).toBe(409);
  });
});
