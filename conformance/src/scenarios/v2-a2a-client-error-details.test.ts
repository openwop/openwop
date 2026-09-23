/**
 * RFC 0211 §F — the host as an A2A 1.0 client reads a peer's error in either shape.
 * Target major 2; gated on the v2 `a2a` record and the seams profile.
 *
 * A2A v1.0.1 §9.5 puts a JSON-RPC error's details in `error.data` as an ARRAY of
 * `Any` objects; the suite's fake peer and the reference host shipped a bare
 * `{ reason, domain }` object through 2.36.x. A host's A2A client MUST accept the
 * array and SHOULD accept the object for the rest of 2.x
 * (`spec/v2/core/interop.md` §"The operation mappings", A2A error details).
 *
 * The suite drives the host's client at its own 1.0-only fake peer through the
 * §22 invoke seam with `requestVersion: '99.0'`, so the peer answers
 * `VersionNotSupportedError` (-32009) — once with `data` as `Any[]`, once as the
 * legacy object — and the host MUST project both to `interop_version_unsupported`.
 *
 * Weak by construction, and said so: a host that reads only one shape still
 * identifies the error by its JSON-RPC code, so this leg witnesses that the client
 * tolerates both shapes (does not throw, does not mis-project to `internal_error`),
 * not that it reads `reason` out of the array. `interop_version_unsupported` has
 * `details: null` in `spec/v2/errors.json`, so no projected `supportedVersions` is
 * asserted.
 *
 * Callback-shaped (the host calls the suite's peer): unwitnessable when the host is
 * in a separate network namespace — `../lib/host-callback.ts`.
 *
 * @see RFCS/0211-a2a-error-details-are-errorinfo.md §F
 * @see spec/v2/interop-map.json a2a.errors VersionNotSupportedError (clientProjection)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { A2AFakePeer } from '../lib/a2a-fake-peer.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A client calls a suite-owned 1.0 peer that refuses the requested version with -32009";

const ID = 'openwop.requirement.0211.a2a-client-reads-either-shape';
const DOC = 'spec/v2/core/interop.md §"The operation mappings", A2A error details (RFC 0211 §F)';

describe('RFC 0211 §F — v2-a2a-client-error-details (host as A2A 1.0 client; gated on a2a + seams)', () => {
  it('a peer\'s version error projects to interop_version_unsupported whether error.data is an array or a legacy object', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const facet = await familyAdvertised('a2a');
    if (!facet) return softSkip('inapplicable', 'a2a is not advertised at major 2 — the host has no A2A client to hold');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the client exchange is driven through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const peer = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await peer.start();
    const seen: string[] = [];
    try {
      for (const legacy of [false, true]) {
        peer.reset();
        peer.setLegacyErrorData(legacy);
        const res = await driver.post(`${SEAMS_PREFIX}/sample/a2a/invoke`, { peerUrl: peer.hostFacingEndpoint(), authenticated: true, requestVersion: '99.0' });
        if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises a2a but ${SEAMS_PREFIX}/sample/a2a/invoke answered ${res.status} (host-sample-test-seams.md §22)`);
        const reached = peer.invocations().some((i) => i.method !== 'GET');
        if (!reached) return softSkip('blocked', `the host never called the suite peer (${legacy ? 'legacy' : 'Any[]'} pass) — the host cannot reach it, so no error was projected`);
        const code = readErrorCode(res.json);
        seen.push(`${legacy ? 'legacy object' : 'Any[]'}: HTTP ${res.status} ${String(code)}`);
        expect(code, req(ID, DOC, `a peer's -32009 MUST project to interop_version_unsupported whichever shape error.data takes (${seen.join('; ')})`)).toBe('interop_version_unsupported');
      }
    } finally {
      await peer.stop();
    }
  });
});
