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
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';

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
    expect(first.status, req('openwop.it.idempotency.returns-same-runid-twice-and-sets-openwop-idempotent-replay-on-the-replay', 
      'rest-endpoints.md',
      'first POST /v1/runs MUST return 201',
    )).toBe(201);
    const firstRunId = (first.json as { runId: string }).runId;

    const replay = await driver.post('/v1/runs', body, {
      headers: { 'Idempotency-Key': key },
    });
    expect(
      [200, 201].includes(replay.status),
      req('openwop.it.idempotency.returns-same-runid-twice-and-sets-openwop-idempotent-replay-on-the-replay', 
        'idempotency.md §Layer 1',
        'replay request with same key + same body MUST return success status (200/201)',
      ),
    ).toBe(true);

    const replayRunId = (replay.json as { runId: string }).runId;
    expect(replayRunId, req('openwop.it.idempotency.returns-same-runid-twice-and-sets-openwop-idempotent-replay-on-the-replay', 
      'idempotency.md §Layer 1',
      'replay MUST return the SAME runId (no new run created)',
    )).toBe(firstRunId);

    const replayHeader = replay.headers.get('openwop-idempotent-replay');
    expect(replayHeader, req('openwop.it.idempotency.returns-same-runid-twice-and-sets-openwop-idempotent-replay-on-the-replay', 
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

    expect(conflict.status, req('openwop.it.idempotency.returns-409-when-the-body-changes-under-the-same-key', 
      'idempotency.md §Layer 1',
      'same Idempotency-Key with a different body MUST return 409',
    )).toBe(409);

    // SP-03 (2026-08-18): the code, not just the status. `idempotency.md`
    // named NO mismatch error until v1.5, and implementations diverged exactly
    // as an unnamed error invites: `grpc-transport.md` mapped BOTH
    // `idempotency_key_conflict` and `idempotency_key_mismatch` in one row, the
    // published TypeScript SDK's `HTTP_ERROR_CODES` carried
    // `idempotency_key_mismatch`, the SQLite reference host emitted
    // `idempotency_key_conflict`, and a tier-1 host emitted
    // `idempotency_key_replay_mismatch` — a spelling in no corpus artifact at
    // all. This leg asserted the status alone, so every one of them passed.
    //
    // `idempotency_key_mismatch` is canonical (idempotency.md §"Record shape,
    // digest, and lease"): the only spelling already in more than one shipped
    // artifact. The two legacy spellings are TOLERATED here through the first
    // minor after 2026-11-10 so a converging host is not red on a rename it is
    // mid-flight on — the same deprecation shape S22 used for the error
    // envelope. Remove the tolerance then; the canonical assertion stays.
    const code = readErrorCode(conflict.json);
    const LEGACY = ['idempotency_key_conflict', 'idempotency_key_replay_mismatch'];
    expect(
      code === 'idempotency_key_mismatch' || LEGACY.includes(code ?? ''),
      req('openwop.it.idempotency.returns-409-when-the-body-changes-under-the-same-key', 
        'idempotency.md §"Record shape, digest, and lease"',
        `a different request digest under the same scoped key MUST fail with the canonical ` +
          `\`idempotency_key_mismatch\` (legacy \`${LEGACY.join('` / `')}\` tolerated through the ` +
          `first minor after 2026-11-10); got \`${code ?? '<none>'}\``,
      ),
    ).toBe(true);

    // …and MUST NOT hand back the first run's body. Answering a question the
    // caller did not ask is the read half of the same confusion.
    const conflictRunId = (conflict.json as { runId?: unknown } | undefined)?.runId;
    expect(
      conflictRunId,
      req('openwop.it.idempotency.returns-409-when-the-body-changes-under-the-same-key', 
        'idempotency.md §"Record shape, digest, and lease"',
        'a digest mismatch MUST NOT return the cached body (no runId on the 409)',
      ),
    ).toBeUndefined();
  });
});
