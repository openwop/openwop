/**
 * Data-residency — regional admission control (RFC 0129) —
 * `capabilities.md` §dataResidency + `rest-endpoints.md` §`residency_unavailable`.
 *
 * The conformance-testable core of RFC 0129 §3: a host advertising
 * `capabilities.dataResidency` performs ADMISSION CONTROL on an OPTIONAL
 * `residency.region` attached to a `POST /v1/runs` request — it accepts iff
 * the region is in the advertised `regions[]`, else rejects
 * `residency_unavailable` and creates NO run. It MUST NOT silently
 * accept-and-ignore. The physical-confinement guarantee (§4) is a declared
 * operator SHOULD and is deliberately NOT tested (unobservable over the wire).
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probes:
 *      - `capabilities.dataResidency` family shape: `supported` (const true) +
 *        `regions` (non-empty string array) REQUIRED, `additionalProperties:false`;
 *      - `residency.schema.json` shape: `region` REQUIRED, closed;
 *      - `residency_unavailable` is registered in the rest-endpoints error prose.
 *
 *   B. Capability-gated behavioral legs (driving the NORMATIVE `POST /v1/runs`
 *      endpoint — no host-sample seam), gated on `capabilities.dataResidency`
 *      being advertised (soft-skip when absent, hard-fail under
 *      `OPENWOP_REQUIRE_BEHAVIOR=true`):
 *      1. advertised-region accept — `POST /v1/runs` with a `residency.region`
 *         from the advertised `regions[]` is accepted (2xx, a run is created);
 *      2. unadvertised-region reject — `POST /v1/runs` with a region NOT in
 *         `regions[]` is rejected with `{ error: { code: "residency_unavailable" } }`
 *         at HTTP one-of 400/404/422, and NO run is created (fail-closed;
 *         advertise-only-what-you-honor — a hollow advert that accepts an
 *         unadvertised region fails here).
 *
 * @see RFCS/0129-data-residency-region-advertisement-and-honor-or-reject.md §3
 * @see spec/v1/capabilities.md §dataResidency
 * @see spec/v1/rest-endpoints.md §"Common error codes" (`residency_unavailable`)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe('data-residency: schema + error registration (always-on, server-free)', () => {
  it('capabilities.dataResidency requires `supported` (const true) + `regions`, closed', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'));
    const fam = caps.properties?.dataResidency;
    expect(fam, 'capabilities.schema.json MUST define the dataResidency family (RFC 0129 §1)').toBeDefined();
    expect(fam.additionalProperties, 'dataResidency MUST close its shape').toBe(false);
    expect(fam.required?.sort()).toEqual(['regions', 'supported']);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const vf = ajv.compile(fam);
    expect(vf({ supported: true, regions: ['eu', 'us'] }), 'the canonical advert MUST validate').toBe(true);
    expect(vf({ supported: true }), 'an advert without `regions` MUST fail').toBe(false);
    expect(vf({ regions: ['eu'] }), 'an advert without `supported` MUST fail').toBe(false);
    expect(vf({ supported: false, regions: ['eu'] }), 'dataResidency.supported is const true — false MUST fail').toBe(false);
  });

  it('residency.schema.json requires `region` and closes its shape', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'residency.schema.json'), 'utf8')));
    expect(validate({ region: 'eu' }), 'RFC 0129 §2 — a `{region}` residency constraint MUST validate').toBe(true);
    expect(validate({}), 'RFC 0129 §2 — `region` is REQUIRED').toBe(false);
    expect(validate({ region: 'eu', extra: 1 }), 'residency MUST be closed (additionalProperties:false)').toBe(false);
  });

  it.skipIf(V1_DIR === null)('residency_unavailable is registered in the rest-endpoints error prose', () => {
    const rest = readFileSync(join(V1_DIR as string, 'rest-endpoints.md'), 'utf8');
    expect(
      rest.includes('`residency_unavailable`'),
      'rest-endpoints.md §"Common error codes" MUST register `residency_unavailable` (RFC 0129 §3)',
    ).toBe(true);
  });
});

describe.skipIf(HTTP_SKIP)('data-residency: admission control (capability-gated, normative POST /v1/runs)', () => {
  it('accepts an advertised region and rejects an unadvertised one with residency_unavailable (no run created)', async () => {
    const fam = await readCapabilityFamily<{ supported?: boolean; regions?: string[] }>('dataResidency');
    const regions = fam?.regions ?? [];
    if (!behaviorGate('dataResidency', fam?.supported === true && regions.length > 0)) return;

    // ---- Leg 1: advertised-region accept -----------------------------------
    const advertised = regions[0];
    const ok = await driver.post('/v1/runs', {
      workflowId: 'conformance-residency-probe',
      inputs: {},
      residency: { region: advertised },
    });
    // A host may legitimately reject the probe workflow for reasons unrelated to
    // residency (e.g. unknown workflowId) — but it MUST NOT reject an ADVERTISED
    // region with residency_unavailable. That specific pairing is the violation.
    const okBody = ok.json as { error?: { code?: string } } | undefined;
    expect(
      okBody?.error?.code !== 'residency_unavailable',
      driver.describe(
        'capabilities.md §dataResidency / RFC 0129 §3',
        `an ADVERTISED region ("${advertised}") MUST NOT be rejected with residency_unavailable (accept iff advertised) — got ${ok.status} ${JSON.stringify(okBody?.error)}`,
      ),
    ).toBe(true);

    // ---- Leg 2: unadvertised-region reject (fail-closed) -------------------
    // Synthesize a region guaranteed not to be advertised.
    let bogus = 'zz-nowhere';
    while (regions.includes(bogus)) bogus += 'x';
    const rej = await driver.post('/v1/runs', {
      workflowId: 'conformance-residency-probe',
      inputs: {},
      residency: { region: bogus },
    });
    const rejBody = rej.json as { error?: { code?: string }; runId?: string } | undefined;

    expect(
      rej.status === 400 || rej.status === 404 || rej.status === 422,
      driver.describe(
        'rest-endpoints.md §residency_unavailable',
        `an unadvertised region MUST be rejected at HTTP one-of 400/404/422 (envelope-not-status, #815) — got ${rej.status}`,
      ),
    ).toBe(true);
    expect(
      rejBody?.error?.code === 'residency_unavailable',
      driver.describe(
        'RFC 0129 §3',
        `an unadvertised region MUST be rejected with error code "residency_unavailable" (MUST NOT silently accept-and-ignore) — got ${JSON.stringify(rejBody?.error)}`,
      ),
    ).toBe(true);
    expect(
      rejBody?.runId === undefined,
      driver.describe('RFC 0129 §3', 'a rejected residency request MUST create NO run (no runId in the response)'),
    ).toBe(true);
  });
});
