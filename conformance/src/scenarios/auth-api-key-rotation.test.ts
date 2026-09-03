/**
 * RFC 0010 §B: openwop-auth-api-key-rotation profile.
 *
 * Verifies that hosts claiming the rotation profile satisfy
 * `spec/v1/auth-profiles.md` §`openwop-auth-api-key-rotation`:
 *
 *   1. `capabilities.auth.profiles[]` includes `openwop-auth-api-key-rotation`
 *      and `capabilities.auth.rotation.supported === true`.
 *   2. When `minGraceSeconds` is advertised, it's an integer ≥ 0;
 *      production-profile hosts SHOULD advertise ≥ 86400 (24h) per spec.
 *   3. When the operator supplies a secondary key via
 *      `OPENWOP_TEST_SECONDARY_API_KEY`, both keys MUST authenticate the
 *      same operation. The rotation invariant: both map to the same
 *      principal/tenant within the grace window.
 *   4. An invalid bearer (a synthetic canary, not a real key) returns
 *      401 `invalid_token`; the response body MUST NOT echo the canary
 *      in any field (`auth.md` §3 credential-redaction MUST).
 *
 * The two-key overlap soft-skips when `OPENWOP_TEST_SECONDARY_API_KEY`
 * is unset. The capability-shape and canary-redaction assertions run
 * unconditionally when the profile is advertised.
 *
 * @see RFCS/0010-auth-profile-conformance.md §B
 * @see spec/v1/auth-profiles.md §`openwop-auth-api-key-rotation`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface RotationCaps {
  supported?: boolean;
  minGraceSeconds?: number;
}

interface AuthCaps {
  profiles?: string[];
  rotation?: RotationCaps;
}

const PROFILE = 'openwop-auth-api-key-rotation';
const FIXTURE = 'conformance-noop';
const CANARY = 'hk_openwop_canary_d1d2d3d4_NOT_A_REAL_KEY';

async function readAuthCaps(): Promise<AuthCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily((disco.json as { capabilities?: { auth?: AuthCaps } }), 'auth');
}

function isProfileAdvertised(auth: AuthCaps | undefined): boolean {
  return (
    Array.isArray(auth?.profiles) &&
    auth.profiles.includes(PROFILE) &&
    auth.rotation?.supported === true
  );
}

describe('auth-api-key-rotation: capability shape', () => {
  it('host claiming rotation profile advertises required fields', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    expect(auth?.profiles?.includes(PROFILE), req('openwop.it.auth-api-key-rotation.host-claiming-rotation-profile-advertises-required-fields', 
      'auth-profiles.md §`openwop-auth-api-key-rotation`',
      'capabilities.auth.profiles MUST include openwop-auth-api-key-rotation when the profile is claimed',
    )).toBe(true);

    expect(auth?.rotation?.supported, req('openwop.it.auth-api-key-rotation.host-claiming-rotation-profile-advertises-required-fields', 
      'auth-profiles.md §`openwop-auth-api-key-rotation`',
      'capabilities.auth.rotation.supported MUST be true when the profile is claimed',
    )).toBe(true);

    if (auth?.rotation?.minGraceSeconds !== undefined) {
      expect(
        Number.isInteger(auth.rotation.minGraceSeconds) &&
          auth.rotation.minGraceSeconds >= 0,
        req('openwop.it.auth-api-key-rotation.host-claiming-rotation-profile-advertises-required-fields', 
          'capabilities.schema.json auth.rotation.minGraceSeconds',
          'minGraceSeconds MUST be a non-negative integer when advertised',
        ),
      ).toBe(true);

      if (auth.rotation.minGraceSeconds < 86400) {
        // eslint-disable-next-line no-console
        console.warn(
          `[auth-api-key-rotation] minGraceSeconds=${auth.rotation.minGraceSeconds} is below the 24h floor auth-profiles.md SHOULDs for production-profile hosts`,
        );
      }
    }
  });
});

describe('auth-api-key-rotation: two-key overlap', () => {
  it('primary + secondary keys both authenticate the same operation', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    const secondaryKey = process.env.OPENWOP_TEST_SECONDARY_API_KEY;
    if (!secondaryKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-api-key-rotation] OPENWOP_TEST_SECONDARY_API_KEY not supplied; skipping two-key overlap assertion',
      );
      return softSkip('blocked', 'precondition not met — `!secondaryKey` returned early ([auth-api-key-rotation] OPENWOP_TEST_SECONDARY_API_KEY not supplied; skipping two-key overlap assertion) (seam, prior step, or fixture unavailable)');
    }

    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[auth-api-key-rotation] ${FIXTURE} not advertised; skipping overlap assertion`,
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early ([auth-api-key-rotation] … not advertised; skipping overlap assertion)');
    }

    // Primary key — uses driver's default Authorization header (env-loaded).
    const primary = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(primary.status, req('openwop.it.auth-api-key-rotation.primary-secondary-keys-both-authenticate-the-same-operation', 
      'auth-profiles.md §`openwop-auth-api-key-rotation`',
      'primary key MUST authenticate POST /v1/runs during rotation grace',
    )).toBe(201);
    const primaryRunId = (primary.json as { runId: string }).runId;

    // Secondary key — supplied via env, sent verbatim.
    const secondary = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${secondaryKey}` },
      },
    );
    expect(secondary.status, req('openwop.it.auth-api-key-rotation.primary-secondary-keys-both-authenticate-the-same-operation', 
      'auth-profiles.md §`openwop-auth-api-key-rotation`',
      'secondary key MUST authenticate POST /v1/runs during rotation grace',
    )).toBe(201);
    const secondaryRunId = (secondary.json as { runId: string }).runId;

    // Both runs MUST be distinct (different keys are still independent
    // authentications, not idempotent retries) but MUST have been
    // accepted, proving overlap is honored.
    expect(primaryRunId).not.toBe(secondaryRunId);
  });
});

describe('auth-api-key-rotation: canary redaction', () => {
  it('invalid bearer returns 401 without echoing the canary credential', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${CANARY}` },
      },
    );

    expect(res.status, req('openwop.it.auth-api-key-rotation.invalid-bearer-returns-401-without-echoing-the-canary-credential', 
      'auth.md §3',
      'invalid bearer MUST return 401, not 200 or 403',
    )).toBe(401);

    // The response body MUST NOT echo the canary in any field. We
    // check the serialized JSON to catch echoes even in nested fields.
    const serialized = JSON.stringify(res.json ?? {});
    expect(serialized.includes(CANARY), req('openwop.it.auth-api-key-rotation.invalid-bearer-returns-401-without-echoing-the-canary-credential', 
      'auth.md §"No credential echo" + threat-model-auth-profiles.md A1',
      'rotation-profile hosts MUST NOT echo the rejected credential in error responses',
    )).toBe(false);
  });
});
