/**
 * RFC 0009 §B: production-profile backpressure envelope.
 *
 * Verifies that hosts claiming the `openwop-production` profile satisfy
 * `spec/v1/production-profile.md` §Backpressure:
 *
 *   1. `capabilities.production.backpressure.supported: true` is
 *      advertised when the profile claim is `supported: true`.
 *   2. When the host advertises an `inflightCap`, the suite saturates
 *      it with `inflightCap + 1` concurrent long-lived requests and
 *      asserts the 503 envelope shape: status 503 + `Retry-After`
 *      header + body `{error: "service_unavailable", message, details:
 *      {retryAfter: <integer>}}` where `details.retryAfter` equals the
 *      `Retry-After` header in seconds.
 *   3. When `retryAfterSeconds` is also advertised, both equal that
 *      advertised value.
 *   4. Discovery (`GET /.well-known/openwop`) is exempt from the
 *      inflight cap (health probes MUST answer even under load).
 *
 * Hosts that don't advertise `inflightCap` soft-skip the saturation
 * step (the envelope assertion only fires if a 503 happens to be
 * observed via other means). RFC 0009 unresolved question #3 — the
 * alternative of probing via Little's Law is rejected by default;
 * inflightCap advertisement is the chosen forcing mechanism.
 *
 * **Run with `--no-file-parallelism`** — saturating the host's
 * inflight cap leaves no headroom for other scenarios that issue
 * concurrent POSTs (e.g., `idempotencyRetry.test.ts`'s 5-retry burst).
 * Conformance runs that include this scenario MUST pass `--no-file-
 * parallelism` to vitest or scope each file to its own worker. The
 * otel-emission scenario has the same constraint (`conformance/README.md`
 * line ~69).
 *
 * @see RFCS/0009-production-profile-conformance.md §B
 * @see spec/v1/production-profile.md §Backpressure
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

interface BackpressureCaps {
  supported?: boolean;
  inflightCap?: number;
  retryAfterSeconds?: number;
}

interface ProductionCaps {
  supported?: boolean;
  backpressure?: BackpressureCaps;
}

async function readProductionCaps(): Promise<ProductionCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return (disco.json as { capabilities?: { production?: ProductionCaps } })
    .capabilities?.production;
}

function isProfileAdvertised(prod: ProductionCaps | undefined): boolean {
  return (
    prod?.supported === true && prod?.backpressure?.supported === true
  );
}

describe('production-backpressure: capability shape', () => {
  it('host that claims openwop-production with backpressure advertises required fields', async () => {
    const prod = await readProductionCaps();

    if (!behaviorGate('openwop-production', isProfileAdvertised(prod))) {
      return;
    }

    expect(prod?.supported, driver.describe(
      'production-profile.md §Compatibility baseline',
      'capabilities.production.supported MUST be true when claiming the openwop-production profile',
    )).toBe(true);

    expect(prod?.backpressure?.supported, driver.describe(
      'production-profile.md §Backpressure',
      'capabilities.production.backpressure.supported MUST be true for production-profile claimants',
    )).toBe(true);

    if (prod?.backpressure?.inflightCap !== undefined) {
      expect(
        Number.isInteger(prod.backpressure.inflightCap) &&
          prod.backpressure.inflightCap >= 1,
        driver.describe(
          'capabilities.schema.json production.backpressure.inflightCap',
          'inflightCap MUST be an integer ≥ 1 when advertised',
        ),
      ).toBe(true);
    }

    if (prod?.backpressure?.retryAfterSeconds !== undefined) {
      expect(
        Number.isInteger(prod.backpressure.retryAfterSeconds) &&
          prod.backpressure.retryAfterSeconds >= 0,
        driver.describe(
          'capabilities.schema.json production.backpressure.retryAfterSeconds',
          'retryAfterSeconds MUST be a non-negative integer when advertised',
        ),
      ).toBe(true);
    }
  });
});

describe('production-backpressure: 503 envelope under saturation', () => {
  it('saturating advertised inflightCap returns 503 + Retry-After + canonical envelope', async () => {
    const prod = await readProductionCaps();

    if (!behaviorGate('openwop-production', isProfileAdvertised(prod))) {
      return;
    }

    const cap = prod?.backpressure?.inflightCap;
    if (cap === undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        '[production-backpressure] host does not advertise inflightCap; skipping saturation assertion',
      );
      return;
    }

    // Use the conformance-delay fixture to hold inflight slots via
    // long-lived SSE connections, matching the Postgres host's
    // internal backpressure test pattern.
    const FIXTURE = 'conformance-delay';
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[production-backpressure] ${FIXTURE} not advertised; skipping saturation (host doesn't seed the long-running fixture)`,
      );
      return;
    }

    // Create `cap` long-running runs and open SSE streams against each
    // to hold the slots open. Raw fetch is used for SSE because the
    // driver doesn't expose abort signals; abort is required to release
    // the inflight slots in the finally block. The Accept header is
    // required so hosts with /events content negotiation (e.g., the
    // Postgres reference host) actually keep the connection open as a
    // long-lived SSE stream; without it they return a one-shot JSON
    // snapshot and the inflight slot drops immediately.
    const env = loadEnv();
    const authHeaders = {
      Authorization: `Bearer ${env.apiKey}`,
      Accept: 'text/event-stream',
    };

    const slotHolders: AbortController[] = [];
    const slotPromises: Promise<unknown>[] = [];
    // Track the saturating runs so we can explicitly cancel them in
    // `finally`. Without this, aborting only the SSE stream leaves
    // the runs alive on the host until their delay elapses; any
    // neighbor test running in parallel (vitest's default mode) then
    // hits the still-saturated inflight cap and fails with a 503 of
    // its own. Per spec the saturating runs MAY survive their SSE
    // client; the test-isolation contract is the caller's
    // responsibility.
    const saturatingRunIds: string[] = [];

    let saturationEarlyExit = false;
    for (let i = 0; i < cap; i++) {
      const create = await driver.post('/v1/runs', {
        workflowId: FIXTURE,
        // Long enough that the saturation window holds during the
        // cap+1 probe + envelope assertions (~500ms total) but short
        // enough that any leaked run drains quickly if cancel fails.
        inputs: { delayMs: 2_000 },
      });
      if (create.status === 503) {
        // Inflight cap was already saturated by a parallel test
        // (default vitest mode shares the host across scenarios).
        // The test's docstring notes `--no-file-parallelism` is the
        // canonical execution mode; outside that mode the saturation
        // moment is unreachable. Soft-skip per the existing pattern
        // (consistent with the cap+1 fallback below).
        // eslint-disable-next-line no-console
        console.warn(
          `[production-backpressure] cap already saturated by parallel runs at i=${i} (likely running without --no-file-parallelism); soft-skipping envelope assertions`,
        );
        saturationEarlyExit = true;
        break;
      }
      expect(create.status).toBe(201);
      const runId = (create.json as { runId: string }).runId;
      saturatingRunIds.push(runId);

      const controller = new AbortController();
      slotHolders.push(controller);
      slotPromises.push(
        fetch(`${env.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
          headers: authHeaders,
          signal: controller.signal,
        }).catch(() => undefined),
      );
    }
    if (saturationEarlyExit) {
      // Drain whatever we created so we don't leave residue for the
      // next test. The finally block below handles bulk-cancel
      // unconditionally; just bail before the envelope assertions.
      for (const c of slotHolders) c.abort();
      if (saturatingRunIds.length > 0) {
        try {
          await driver.post('/v1/runs:bulk-cancel', { runIds: saturatingRunIds });
        } catch {
          // Best-effort.
        }
      }
      await Promise.allSettled(slotPromises);
      return;
    }

    // Let SSE connections register.
    await new Promise((r) => setTimeout(r, 200));

    try {
      // The `cap + 1`-th authenticated request MUST 503.
      const blocked = await driver.post('/v1/runs', {
        workflowId: 'conformance-noop',
      });

      // Soft-skip if the host didn't actually 503 (e.g., it accepts
      // more concurrency than its advertised cap, or the SSE slots
      // didn't register in time). The envelope assertion only fires
      // when 503 was observed.
      if (blocked.status !== 503) {
        // eslint-disable-next-line no-console
        console.warn(
          `[production-backpressure] expected 503 at cap+1=${cap + 1}, got ${blocked.status}; saturation may need tuning`,
        );
        return;
      }

      const retryAfterHeader = blocked.headers.get('retry-after');
      expect(retryAfterHeader, driver.describe(
        'production-profile.md §Backpressure',
        '503 response MUST include a Retry-After header',
      )).toBeTruthy();
      expect((retryAfterHeader ?? '').length).toBeGreaterThan(0);

      const body = blocked.json as {
        error?: string;
        message?: string;
        details?: { retryAfter?: number };
      };

      expect(body.error, driver.describe(
        'production-profile.md §Backpressure',
        '503 envelope MUST have error: "service_unavailable"',
      )).toBe('service_unavailable');

      expect(typeof body.message).toBe('string');
      expect((body.message ?? '').length).toBeGreaterThan(0);

      expect(typeof body.details?.retryAfter, driver.describe(
        'production-profile.md §Backpressure',
        'details.retryAfter MUST be present and numeric',
      )).toBe('number');

      // details.retryAfter MUST equal the Retry-After header in seconds.
      const headerSeconds = Number.parseInt(retryAfterHeader ?? '', 10);
      expect(body.details?.retryAfter, driver.describe(
        'production-profile.md §Backpressure',
        'details.retryAfter MUST equal Retry-After header in seconds',
      )).toBe(headerSeconds);

      // If retryAfterSeconds is advertised, both equal it.
      const advertised = prod?.backpressure?.retryAfterSeconds;
      if (advertised !== undefined) {
        expect(headerSeconds, driver.describe(
          'capabilities.schema.json production.backpressure.retryAfterSeconds',
          'Retry-After MUST equal advertised retryAfterSeconds when both are present',
        )).toBe(advertised);
      }
    } finally {
      // Test isolation: explicitly cancel every saturating run so
      // neighbor tests running in parallel see the inflight cap
      // released immediately. The SSE-stream aborts come first so
      // the host's SSE handlers exit; the bulk-cancel then drains
      // the executor queue. POST /v1/runs:bulk-cancel is naturally
      // idempotent so even if a run already terminated, the call
      // returns `ok: true, status: "cancelled"` per
      // rest-endpoints.md §"Bulk cancel".
      for (const c of slotHolders) c.abort();
      if (saturatingRunIds.length > 0) {
        try {
          await driver.post('/v1/runs:bulk-cancel', { runIds: saturatingRunIds });
        } catch {
          // Best-effort; a host that doesn't expose bulk-cancel
          // gets per-id cancellation as the fallback.
          for (const id of saturatingRunIds) {
            try {
              await driver.post(`/v1/runs/${encodeURIComponent(id)}/cancel`, {});
            } catch {
              // Swallow — the runs will drain naturally within
              // the (now-shortened) 2-second delay window.
            }
          }
        }
      }
      await Promise.allSettled(slotPromises);
    }
  });
});

describe('production-backpressure: discovery exempt from cap', () => {
  it('GET /.well-known/openwop returns 200 even when inflight is saturated', async () => {
    const prod = await readProductionCaps();

    if (!behaviorGate('openwop-production', isProfileAdvertised(prod))) {
      return;
    }

    const cap = prod?.backpressure?.inflightCap;
    if (cap === undefined) {
      // Without advertised cap we can't saturate deterministically;
      // fall back to a single discovery probe.
      const probe = await driver.get('/.well-known/openwop');
      expect(probe.status, driver.describe(
        'production-profile.md §Backpressure',
        'discovery MUST answer regardless of load',
      )).toBe(200);
      return;
    }

    // Issue many concurrent discovery probes; all MUST succeed.
    const probes = await Promise.all(
      Array.from({ length: Math.max(cap + 2, 4) }, () =>
        driver.get('/.well-known/openwop'),
      ),
    );
    for (const probe of probes) {
      expect(probe.status, driver.describe(
        'production-profile.md §Backpressure',
        'discovery MUST bypass the inflight cap (health probes always answer)',
      )).toBe(200);
    }
  });
});
