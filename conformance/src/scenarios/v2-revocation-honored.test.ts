/**
 * v2 — `revocation-honored` (suite 2.0.0; RFC 0170 §B.3;
 * `spec/v2/core/identity.md` §2.2 "Trust roots and revocation").
 *
 * Witness class: seam-gated (`openwop-conformance-seams-v2`, advertised as
 * `conformance.seamsProfile`). Revocation exists for every lane; for the two
 * `next-request` lanes (`api-key`, `session`) a revoked credential MUST be
 * refused on the very next request with `401 credential_revoked`. The
 * per-lane revoke seam RFC 0170 names ("the §20 seam family grows one leg per
 * lane") is not yet in `spec/v1/host-sample-test-seams.md`; this scenario
 * drives `POST /conformance/seams/sample/auth/credential/{mint,revoke}` (the
 * v1-shaped address `/v1/host/sample/auth/credential/…` through `seamPath()`)
 * with `{ lane }` / `{ lane, credential }` and records `blocked` when the host
 * does not mount it. Windowed lanes (`exp-and-recheck`, `short-lived`, `rebind`)
 * have no wire-observable "next request" and record `inapplicable`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §2.2';
const MINT = seamPath('/v1/host/sample/auth/credential/mint');
const REVOKE = seamPath('/v1/host/sample/auth/credential/revoke');

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

describe('v2 revocation-honored (RFC 0170 §B.3 — seam-gated)', () => {
  it('a revoked next-request credential is refused on the next request with credential_revoked', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'seams profile not advertised (conformance.seamsProfile !== openwop-conformance-seams-v2) — revocation is seam-gated and cannot be observed from the canonical API');
    const auth = await familyAdvertised('auth');
    const lanes = Array.isArray(auth?.['lanes']) ? (auth['lanes'] as Array<Record<string, unknown>>) : [];
    const nextRequest = lanes.filter((l) => l['revocation'] === 'next-request').map((l) => String(l['lane']));
    if (nextRequest.length === 0) return softSkip('inapplicable', 'no advertised lane uses revocation: next-request (api-key / session) — windowed lanes have no wire-observable next request');

    for (const lane of nextRequest) {
      const minted = await http(() => driver.post(MINT, { lane }));
      if (minted === null) return softSkip('blocked', `${MINT} unreachable (fetch failed)`);
      if (minted.status === 404 || minted.status === 403) return seamAbsent(`${MINT} not mounted (${minted.status}) — the per-lane revoke seam RFC 0170 §B.3 names is not specified in host-sample-test-seams.md and this host does not serve it`);
      const credential = (minted.json as { credential?: unknown } | undefined)?.credential;
      expect(typeof credential, req('openwop.requirement.0170.revocation-honored', DOC, `the mint seam MUST answer { credential } for lane ${lane}`)).toBe('string');

      // Positive control — the minted credential authenticates before revocation.
      const before = await http(() => driver.get('/runs/openwop-conformance-tenant/revocationprobe0123456789', { authenticated: false, headers: { Authorization: `Bearer ${String(credential)}` } }));
      expect(before !== null && before.status !== 401, req('openwop.requirement.0170.revocation-honored', DOC, `a freshly minted ${lane} credential MUST authenticate before revocation (got ${before?.status ?? 'no response'})`)).toBe(true);

      const revoked = await http(() => driver.post(REVOKE, { lane, credential }));
      expect(revoked !== null && revoked.status < 400, req('openwop.requirement.0170.revocation-honored', DOC, `the revoke seam MUST accept the credential it minted for lane ${lane} (got ${revoked?.status ?? 'no response'})`)).toBe(true);

      const after = await http(() => driver.get('/runs/openwop-conformance-tenant/revocationprobe0123456789', { authenticated: false, headers: { Authorization: `Bearer ${String(credential)}` } }));
      expect(after?.status, req('openwop.requirement.0170.revocation-honored', DOC, `lane ${lane} MUST refuse a revoked credential on the next request with 401`)).toBe(401);
      expect(readErrorCode(after?.json), req('openwop.requirement.0170.revocation-honored', DOC, `the refusal code MUST be credential_revoked (lane ${lane})`)).toBe('credential_revoked');
    }
  });
});
