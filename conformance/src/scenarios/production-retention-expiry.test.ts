/**
 * RFC 0009 §C: production-profile event-retention expiry.
 *
 * Verifies that hosts claiming the `openwop-production` profile satisfy
 * `spec/v1/production-profile.md` §"Event retention":
 *
 *   1. `capabilities.production.retention.supported: true` is advertised.
 *   2. `capabilities.production.retention.minWindowSeconds >= 604800`
 *      (7 days) — the minimum retention window for public hosts.
 *   3. `GET /v1/runs/{expiredRunId}` on an expired run returns `410 Gone`
 *      (preferred) or `404 Not Found` per spec, with the canonical
 *      error envelope `{error, message, details?}`.
 *
 * Forcing expiry is host-private — the RFC defers endpoint normation
 * (unresolved question #1). The scenario reads two env vars supplied
 * by the operator running the suite:
 *
 *   - `OPENWOP_TEST_EXPIRED_RUN_ID` — id of a pre-expired run the
 *     host has on file. Used by both the soft-skip and active paths.
 *   - `OPENWOP_TEST_FORCE_EXPIRE_URL` — optional host-private endpoint
 *     the suite POSTs to in order to evict a freshly-created run.
 *     Honored only when `capabilities.production.retention.testForceExpire: true`.
 *
 * When neither path is available, the scenario asserts only the
 * capability shape and soft-skips the envelope check.
 *
 * @see RFCS/0009-production-profile-conformance.md §C
 * @see spec/v1/production-profile.md §"Event retention"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface RetentionCaps {
  supported?: boolean;
  minWindowSeconds?: number;
  testForceExpire?: boolean;
}

interface ProductionCaps {
  supported?: boolean;
  retention?: RetentionCaps;
}

async function readProductionCaps(): Promise<ProductionCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<ProductionCaps>(disco.json, 'production');
}

function isProfileAdvertised(prod: ProductionCaps | undefined): boolean {
  return prod?.supported === true && prod?.retention?.supported === true;
}

const SEVEN_DAYS_SECONDS = 604800;

describe('production-retention-expiry: capability shape', () => {
  it('host claiming openwop-production with retention advertises required fields', async () => {
    const prod = await readProductionCaps();

    if (!behaviorGate('openwop-production', isProfileAdvertised(prod))) {
      return;
    }

    expect(prod?.retention?.supported, req('openwop.it.production-retention-expiry.host-claiming-openwop-production-with-retention-advertises-required-fields', 
      'production-profile.md §"Event retention"',
      'capabilities.production.retention.supported MUST be true for production-profile claimants',
    )).toBe(true);

    expect(prod?.retention?.minWindowSeconds, req('openwop.it.production-retention-expiry.host-claiming-openwop-production-with-retention-advertises-required-fields', 
      'production-profile.md §"Event retention"',
      'capabilities.production.retention.minWindowSeconds MUST be advertised when retention.supported is true',
    )).toBeDefined();

    expect(
      Number.isInteger(prod?.retention?.minWindowSeconds) &&
        (prod?.retention?.minWindowSeconds ?? 0) >= SEVEN_DAYS_SECONDS,
      req('openwop.it.production-retention-expiry.host-claiming-openwop-production-with-retention-advertises-required-fields', 
        'production-profile.md §"Event retention"',
        'minWindowSeconds MUST be an integer ≥ 604800 (7 days) for public production-profile claimants',
      ),
    ).toBe(true);
  });
});

describe('production-retention-expiry: 410/404 envelope on expired run', () => {
  it('GET /v1/runs/{expiredRunId} returns 410 or 404 with canonical envelope', async () => {
    const prod = await readProductionCaps();

    if (!behaviorGate('openwop-production', isProfileAdvertised(prod))) {
      return;
    }

    let expiredRunId = process.env.OPENWOP_TEST_EXPIRED_RUN_ID;

    // Active expiry path: when the host advertises a test force-expire
    // hook, create a fresh run and call the operator-supplied endpoint
    // to evict it. The endpoint shape is host-private (RFC 0009 Q#1).
    const forceExpireUrl = process.env.OPENWOP_TEST_FORCE_EXPIRE_URL;
    const forceExpireMethod = process.env.OPENWOP_TEST_FORCE_EXPIRE_METHOD ?? 'POST';

    if (
      prod?.retention?.testForceExpire === true &&
      forceExpireUrl !== undefined &&
      expiredRunId === undefined
    ) {
      // Create a throwaway run.
      const create = await driver.post('/v1/runs', {
        workflowId: 'conformance-noop',
      });
      if (create.status === 201) {
        const newRunId = (create.json as { runId: string }).runId;
        // Call the host-private force-expire endpoint. Operator wires
        // this to whatever route the host exposes.
        const url = forceExpireUrl.replace('{runId}', encodeURIComponent(newRunId));
        const forced = await fetch(url, { method: forceExpireMethod });
        if (forced.ok || forced.status === 204) {
          expiredRunId = newRunId;
        }
      }
    }

    if (expiredRunId === undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        '[production-retention-expiry] no expired runId available (set OPENWOP_TEST_EXPIRED_RUN_ID or advertise testForceExpire + provide OPENWOP_TEST_FORCE_EXPIRE_URL); skipping envelope assertion',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `expiredRunId === undefined` returned early ([production-retention-expiry] no expired runId available (set OPENWOP_TEST_EXPIRED_RUN_ID or advertise testForceExp…');
    }

    const res = await driver.get(`/v1/runs/${encodeURIComponent(expiredRunId)}`);

    expect(
      res.status === 410 || res.status === 404,
      req('openwop.it.production-retention-expiry.get-v1-runs-expiredrunid-returns-410-or-404-with-canonical-envelope', 
        'production-profile.md §"Event retention"',
        'expired run MUST return 410 Gone (preferred) or 404 Not Found',
      ),
    ).toBe(true);

    const body = res.json as {
      error?: string;
      message?: string;
      details?: { expiredAt?: string };
    };

    expect(typeof body.error, req('openwop.it.production-retention-expiry.get-v1-runs-expiredrunid-returns-410-or-404-with-canonical-envelope', 
      'production-profile.md §"Event retention"',
      'expired-run response MUST use the canonical error envelope ({error, message, details?})',
    )).toBe('string');
    expect((body.error ?? '').length).toBeGreaterThan(0);

    expect(typeof body.message).toBe('string');
    expect((body.message ?? '').length).toBeGreaterThan(0);

    // When the host returns 410, details.expiredAt is RECOMMENDED.
    // Soft-check: when present, MUST be a non-empty string.
    if (res.status === 410 && body.details?.expiredAt !== undefined) {
      expect(typeof body.details.expiredAt).toBe('string');
      expect(body.details.expiredAt.length).toBeGreaterThan(0);
    }
  });
});
