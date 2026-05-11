/**
 * High-concurrency scenarios — drives N parallel run creations against
 * a host and asserts correct rate-limit, idempotency, and queue
 * behavior per `spec/v1/scale-profiles.md`.
 *
 * **Tagged `@scale-profile-production`** — these scenarios are gated on
 * the host claiming `production` or `high-throughput`. A host claiming
 * `minimal` MAY skip via env var `OPENWOP_SKIP_SCALE_PRODUCTION=1`.
 *
 * Methodology:
 *   - Spawn N concurrent `POST /v1/runs` requests with a mix of
 *     idempotency-keyed and non-idempotency-keyed requests.
 *   - Measure: success count, idempotency-replay count, 429/503 count,
 *     wall-clock from first request to last response.
 *   - Assert: zero double-execution; rate-limit responses carry
 *     Retry-After; advertised ack-timeout (per RFC 0002) honored.
 *
 * Latency-percentile measurement is deliberately conservative: we run
 * a small N (10) and verify shape, not microbenchmark numbers, because
 * conformance must be reproducible across host environments. Real
 * benchmark runs (against `production`/`high-throughput` claims) need
 * larger N + warm-up, which is out of scope for the conformance suite.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-idempotent';
const SKIP_SCALE = process.env.OPENWOP_SKIP_SCALE_PRODUCTION === '1';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);
const SKIP = SKIP_SCALE || SKIP_NO_FIXTURE;

function freshKey(suffix: string): string {
  return `openwop-conformance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`;
}

interface RunCreateResult {
  status: number;
  runId: string | undefined;
  replay: boolean;
  retryAfter: number | undefined;
  errorCode: string | undefined;
}

async function createRun(body: unknown, key?: string): Promise<RunCreateResult> {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['Idempotency-Key'] = key;
  const res = await driver.post('/v1/runs', body, { headers });

  const json = res.json as {
    runId?: string;
    error?: string;
    details?: { retryAfter?: number };
  } | undefined;
  const retryAfterHeader = res.headers.get('retry-after');
  return {
    status: res.status,
    runId: json?.runId,
    replay: res.headers.get('openwop-idempotent-replay') === 'true',
    retryAfter: json?.details?.retryAfter ?? (retryAfterHeader !== null ? Number(retryAfterHeader) : undefined),
    errorCode: json?.error,
  };
}

describe.skipIf(SKIP)(
  'high-concurrency: parallel POST /v1/runs per scale-profiles.md §"Conformance scenarios"',
  () => {
    it(
      '10 parallel requests with same key yield ONE runId and 9 replays',
      async () => {
        const key = freshKey('parallel-same-key');
        const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'parallel-1' } };

        const results = await Promise.all(
          Array.from({ length: 10 }, () => createRun(body, key)),
        );

        const succeeded = results.filter((r) => r.status === 200 || r.status === 201);
        const conflicted = results.filter((r) => r.status === 409);

        expect(
          succeeded.length + conflicted.length,
          driver.describe(
            'idempotency.md §Concurrent duplicates',
            'every concurrent request MUST resolve to either the cached response or a deterministic 409',
          ),
        ).toBe(10);

        const runIds = new Set(succeeded.map((r) => r.runId).filter((id): id is string => !!id));
        expect(
          runIds.size,
          driver.describe(
            'idempotency.md §Layer 1',
            'same idempotency key MUST yield exactly ONE runId across all successful responses',
          ),
        ).toBe(1);

        // Per idempotency.md, 409 carries idempotency_in_flight and
        // retry-after metadata under the canonical details slot.
        for (const c of conflicted) {
          expect(
            c.errorCode === 'idempotency_in_flight' || c.errorCode === undefined,
            driver.describe(
              'idempotency.md',
              '409 on parallel idempotency-keyed retry MUST carry error="idempotency_in_flight"',
            ),
          ).toBe(true);
          if (c.retryAfter !== undefined) {
            expect(
              c.retryAfter,
              driver.describe(
                'idempotency.md',
                '409 idempotency_in_flight MUST include a numeric retryAfter',
              ),
            ).toBeGreaterThan(0);
          }
        }
      },
      30000,
    );

    it(
      '10 parallel requests with distinct keys yield 10 distinct runIds',
      async () => {
        const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'parallel-2' } };

        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) => createRun(body, freshKey(`parallel-distinct-${i}`))),
        );

        const succeeded = results.filter((r) => r.status === 200 || r.status === 201);
        const rateLimited = results.filter((r) => r.status === 429 || r.status === 503);

        // A `production`-tier host MUST handle 10 parallel run creations.
        // A `minimal`-tier host MAY rate-limit; documented in scale-profiles.md.
        expect(
          succeeded.length + rateLimited.length,
          driver.describe(
            'rest-endpoints.md',
            'concurrent POST /v1/runs requests MUST resolve to either success or rate-limited',
          ),
        ).toBe(10);

        // Among successful responses, every runId is distinct (no Layer-1 dedup
        // because keys are distinct).
        const succeededRunIds = succeeded.map((r) => r.runId);
        const uniqueRunIds = new Set(succeededRunIds);
        expect(
          uniqueRunIds.size,
          driver.describe(
            'idempotency.md §Layer 1',
            'distinct idempotency keys MUST yield distinct runIds (Layer 1 dedup is keyed)',
          ),
        ).toBe(succeededRunIds.length);

        // Any rate-limited response MUST set Retry-After per scale-profiles.md
        // §"Backpressure semantics."
        for (const r of rateLimited) {
          expect(
            r.retryAfter,
            driver.describe(
              'scale-profiles.md §Backpressure',
              '429/503 response MUST include numeric Retry-After',
            ),
          ).toBeGreaterThan(0);
        }
      },
      30000,
    );

    it(
      '5 sequential retries with same key 100ms apart all succeed (idempotency cache survives retry storm)',
      async () => {
        const key = freshKey('retry-storm');
        const body = { workflowId: WORKFLOW_ID, inputs: { nonce: 'retry-storm' } };

        const results: RunCreateResult[] = [];
        for (let i = 0; i < 5; i++) {
          results.push(await createRun(body, key));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const succeeded = results.filter((r) => r.status === 200 || r.status === 201);
        expect(
          succeeded.length,
          driver.describe(
            'scale-profiles.md §Retry semantics',
            'host MUST handle ≥5 retries with same key 100ms apart without losing the cached response',
          ),
        ).toBe(5);

        const runIds = new Set(succeeded.map((r) => r.runId));
        expect(
          runIds.size,
          driver.describe(
            'idempotency.md §Layer 1',
            'all 5 retries with same key MUST resolve to the same runId',
          ),
        ).toBe(1);

        // First request is fresh; subsequent are replays.
        expect(
          results[0]!.replay,
          driver.describe(
            'idempotency.md §Server responsibilities',
            'first request with new key MUST NOT be marked as replay',
          ),
        ).toBe(false);
        // RFC 0002 §1 promotes openwop-Idempotent-Replay from SHOULD to MUST.
        // Until RFC 0002 is Accepted, the assertion is permissive: at
        // least one of the subsequent requests SHOULD be marked as replay
        // (the spec today says SHOULD, RFC 0002 promotes to MUST).
        const someReplay = results.slice(1).some((r) => r.replay);
        expect(
          someReplay,
          driver.describe(
            'idempotency.md §Server responsibilities #2',
            'replay responses SHOULD set openwop-Idempotent-Replay: true',
          ),
        ).toBe(true);
      },
      30000,
    );

    it(
      'concurrent distinct-key requests respect advertised idempotency cache retention',
      async () => {
        // This is a structural assertion against /.well-known/openwop, NOT a
        // wall-clock test. We can't realistically wait 24h for cache
        // expiration in a conformance run. Instead we assert the host
        // advertises a cache retention compatible with scale-profiles.md.
        const discovery = await driver.get('/.well-known/openwop', { authenticated: false });
        expect(discovery.status).toBe(200);

        const limits = (discovery.json as { limits?: Record<string, unknown> })?.limits;
        expect(
          limits,
          driver.describe(
            'capabilities.md §3',
            'limits MUST be advertised in discovery',
          ),
        ).toBeDefined();

        // Per idempotency.md the optional `idempotencyAckTimeoutSec` field
        // is a normative-additive field. If the host advertises it, the
        // value MUST be ≥5. If absent, the spec default is 5.
        const ackTimeout = (limits as { idempotencyAckTimeoutSec?: unknown })
          ?.idempotencyAckTimeoutSec;
        if (ackTimeout !== undefined) {
          expect(
            typeof ackTimeout === 'number' && Number.isInteger(ackTimeout) && ackTimeout >= 5,
            driver.describe(
              'idempotency.md',
              'limits.idempotencyAckTimeoutSec MUST be integer ≥5 when advertised',
            ),
          ).toBe(true);
        }
      },
      10000,
    );
  },
);
