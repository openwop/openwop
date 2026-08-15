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
 * production"* while doing exactly that. Staging is keyed on `nodeId`, which is
 * not a secret: node ids ship inside chain packs.
 *
 * (An earlier account of this — including the first version of this docblock —
 * said the staging route performed *no tenant resolution at all*. The reporter
 * retracted that within the hour: auth **runs and succeeds**, minting an
 * anonymous session. The corrected mechanism is what makes the weak prose
 * clause interesting, so it is recorded rather than quietly swapped.)
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
 * **Why this leg asserts the observable property, not the mechanism.** The prose clause
 * originally required an enabled seam to apply *"the same authentication and tenant
 * resolution as the canonical surface"* — which RFC 0132 makes trivially satisfiable, since
 * the canonical surface legitimately admits anonymous actors. The reporting host's auth
 * **ran and succeeded**, minting `tenantId: "anon:<sid>"`, so the seam applied exactly the
 * canonical treatment and the hole survived the rule. This leg reds it either way, because
 * a `200` to a credential-less caller is the thing that matters. **The prose and this leg
 * disagreed for twenty minutes and the leg was right** — the clause now requires a
 * non-anonymous principal.
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

/**
 * A `200` can arrive from two very different places, and the difference decides
 * what you should go fix.
 *
 * Every seam in `host-sample-test-seams.md` answers with a JSON body — the doc
 * specifies each one's response shape as an object (`{ released, event }`,
 * `{ ok: true, packId }`, `{ entries: … }`). **No seam answers with an HTML
 * document.** So a `200 text/html` is not a seam that talked to a stranger; it
 * is a static-hosting catch-all — an SPA rewrite in front of the API — matching
 * a path the backend never saw.
 *
 * This was found by probing `app.openwop.dev` (Firebase Hosting, `**` rewrite
 * to the SPA shell) instead of the backend's own origin. Every probe returned
 * `200 text/html` with the app's `index.html`, which under the previous message
 * read as *"an open control surface on a public origin"* — alarming, and wrong.
 * The same paths on `…-backend-….run.app` return `404 application/json`.
 *
 * **Both cases still fail.** Nothing here relaxes the assertion, because the
 * cheap way to silence a false alarm is to stop failing on `200`, and that would
 * delete the check. What changes is the diagnosis: an HTML catch-all means the
 * suite is pointed at the CDN rather than the API origin, which is its own
 * defect — a run against the wrong origin cannot witness anything about the
 * host, and every other leg in the suite is equally blind at that base URL.
 */
function classify200(contentType: string | null): 'seam' | 'catchall' {
  return (contentType ?? '').toLowerCase().includes('text/html') ? 'catchall' : 'seam';
}

describe('test-seam-unauthenticated: an enabled seam still authenticates', () => {
  it('no /v1/host/sample/* seam answers an unauthenticated request with 200', async () => {
    const env = loadEnv();
    const answered: string[] = [];
    let probed = 0;
    let seamAnswers = 0;
    let catchAllAnswers = 0;

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
      if (res.status === 200) {
        const contentType = res.headers.get('content-type');
        const kind = classify200(contentType);
        if (kind === 'seam') seamAnswers += 1;
        else catchAllAnswers += 1;
        answered.push(
          `${path} -> 200 (${contentType ?? 'no content-type'}) — ` +
            (kind === 'seam'
              ? 'SEAM ANSWERED A CREDENTIAL-LESS CALLER'
              : 'HTML body: a static-hosting catch-all, not the API origin'),
        );
      } else if (!ACCEPTABLE.has(res.status)) {
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

    // The diagnosis is chosen from what the answers actually were. An HTML
    // catch-all and an open seam are both failures and they are not the same
    // bug, so the message must not name the wrong one — a check that reports a
    // security finding for a misrouted base URL trains its reader to distrust it.
    const diagnosis =
      seamAnswers === 0 && catchAllAnswers > 0
        ? 'WRONG ORIGIN, not an open seam. Every 200 above carried an HTML body, and no seam in ' +
          'host-sample-test-seams.md answers with HTML — so these are a static-hosting rewrite ' +
          '(an SPA `**` catch-all) matching paths the backend never received. Point ' +
          'OPENWOP_BASE_URL at the API origin itself. This is still a failure: at this base URL ' +
          'no leg in the suite is witnessing the host, so a green run here would mean nothing.'
        : 'An ENABLED seam MUST require an authenticated, NON-ANONYMOUS principal. A host that ' +
          'mints an anonymous identity for credential-less callers MUST NOT treat it as ' +
          'satisfying that. The env-gate governs whether a seam EXISTS; it does not govern who ' +
          'may call it. A seam answering a credential-less request with 200 is an open control ' +
          'surface on a public origin — and staging keys such as `nodeId` are not secrets, they ' +
          'ship inside chain packs.';

    expect(
      answered,
      driver.describe('host-sample-test-seams.md §"Production safety (normative)"', `${diagnosis}\n  ${answered.join('\n  ')}`),
    ).toEqual([]);
  });
});
