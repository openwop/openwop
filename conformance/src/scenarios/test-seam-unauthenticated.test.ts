/**
 * `host-sample-test-seams.md` §"Production safety (normative)" — an ENABLED
 * seam still authenticates.
 *
 * The env-gate governs whether a seam **exists**. It is not a substitute for
 * **who may call it**, and the corpus used to say nothing about the second —
 * which read as an assurance it never made.
 *
 * Found the expensive way. A tier-1 host's production deployment had the seam
 * env-gate enabled, and a seam answered an **unauthenticated request from the
 * public internet** with real seam JSON:
 *
 *     GET /v1/host/openwop-app/test/mock-ai/last-dispatch-budget?nodeId=probe
 *     200  {"maxTokens":null}
 *
 * The registration path logged *"test seam ENABLED — NEVER enable in
 * production"* while doing exactly that, and the mock-AI staging endpoint
 * performed no tenant resolution at all — staging keyed on `nodeId`, which is
 * not a secret: node ids ship inside chain packs.
 *
 * **Why this matters beyond the seam.** A staged mock program makes a replay
 * diverge on purpose, so an unauthenticated caller could switch off the
 * byte-equivalence `replay.md` §C.2 requires — and any host advertising
 * `replay.sideEffectSuppression: "recorded-outcome"` would be claiming a
 * guarantee a stranger can revoke.
 *
 * **What this leg does not do.** It cannot enumerate a host's seams — those are
 * host-private under `/v1/host/sample/*`. It probes the canonical seam prefix
 * and asserts the *shape of the answer*: never a `200`. A host with no seams
 * enabled answers `404` and passes correctly, which is the honest outcome
 * rather than a skip.
 *
 * Requires a base URL; issues NO credentials by design.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';

/**
 * Canonical seam paths from `host-sample-test-seams.md`. A host that exposes
 * none of these answers 404 to all of them, which passes — the leg asserts the
 * SHAPE of the answer, not that a seam exists.
 */
const SEAM_PROBES: readonly string[] = [
  '/v1/host/sample/test/mock-ai/program',
  '/v1/host/sample/governance/approval-gate',
  '/v1/host/sample/packs/install-gate',
  '/v1/host/sample/subrun/attest',
];

/** 200 is the only unambiguous failure: the seam answered a stranger. */
const ACCEPTABLE = new Set([401, 403, 404, 405, 501]);

describe('test-seam-unauthenticated: an enabled seam still authenticates', () => {
  it('no /v1/host/sample/* seam answers an unauthenticated request with 200', async () => {
    const env = loadEnv();
    const answered: string[] = [];
    let probed = 0;

    for (const path of SEAM_PROBES) {
      // node:fetch directly with NO Authorization header — the driver's
      // auto-auth would defeat the whole point of this leg.
      let res: Response;
      try {
        res = await fetch(`${env.baseUrl}${path}`, { method: 'GET' });
      } catch {
        continue; // connection-level refusal is a stronger answer than 404
      }
      probed += 1;
      if (res.status === 200) answered.push(`${path} -> 200`);
      else if (!ACCEPTABLE.has(res.status)) {
        // Not a pass and not the known failure — record it rather than
        // silently tolerating a status nobody reasoned about.
        answered.push(`${path} -> ${res.status} (unexpected; expected one of ${[...ACCEPTABLE].join('/')})`);
      }
    }

    // Guard: a run that reached nothing proves nothing. This leg's whole value
    // is that it ISSUED requests, and a zero-probe pass is the vacuity RFC 0148
    // §C found in the floor verifier.
    expect(
      probed,
      'the probe MUST actually reach the host — zero requests issued means this leg passed by ' +
        'not looking, which is the failure mode it exists to prevent',
    ).toBeGreaterThan(0);

    expect(
      answered,
      driver.describe(
        'host-sample-test-seams.md §"Production safety (normative)"',
        'An ENABLED seam MUST apply the same authentication and tenant resolution as the canonical ' +
          'surface. The env-gate governs whether a seam EXISTS; it does not govern who may call it. ' +
          'A seam answering an unauthenticated request is an open control surface on a public ' +
          'origin — and staging keys such as `nodeId` are not secrets, they ship inside chain ' +
          'packs.\n  ' + answered.join('\n  '),
      ),
    ).toEqual([]);
  });
});
