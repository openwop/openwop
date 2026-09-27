/**
 * v2 — `min-client-version` (suite 2.0.0; RFC 0172 §A.5, row C5.8;
 * `spec/v2/core/versioning.md` §1.5 "Client precedence and minClientVersion").
 *
 * Witness class: witnessable — gated on a host that sets `minClientVersion`.
 * `minClientVersion` is a MUST: a host MAY refuse a client below it with
 * `426 client_version_unsupported`. A host that does not advertise it records
 * `inapplicable`. A request announcing `OpenWOP-Client-Version: 0.0.1` (below
 * any advertised floor) is sent; when the host refuses, the refusal MUST be the
 * registered code at its registered status in the closed envelope; a host that
 * exercises the MAY by serving the request records `inapplicable` with that
 * reason. `OpenWOP-Client-Version` is declared in `api/v2/openapi.yaml` /
 * `headers.md` and specified in versioning.md §1.5 (RFC 0219), so a non-`2xx`,
 * non-`426` answer to a well-formed below-floor value is a refusal in an
 * unregistered form: a failure, not `blocked` (RFC 0219, Unresolved question 4,
 * decided 2026-09-27). The header's other legs (at-floor, absent, malformed, no
 * floor) are `v2-client-version-header`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/versioning.md §1.5';
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

describe('v2 min-client-version (RFC 0172 §A.5 — gated on minClientVersion)', () => {
  it('a client below minClientVersion is refused with 426 client_version_unsupported', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const floor = doc['minClientVersion'];
    if (floor === undefined) return softSkip('inapplicable', 'the host does not advertise minClientVersion — the 426 refusal is gated on a host that sets it');
    expect(typeof floor === 'string' && VERSION.test(floor), req('openwop.requirement.0172.min-client-version', DOC, 'minClientVersion MUST use the <major>.<minor> grammar (axis 15, as axis 1)')).toBe(true);
    const res = await http(() => driver.get('/.well-known/openwop', { authenticated: false, headers: { 'OpenWOP-Client-Version': '0.0.1' } }));
    if (res === null) return softSkip('blocked', 'GET /.well-known/openwop with OpenWOP-Client-Version unreachable (fetch failed)');
    // RFC 0219 Q4 (2026-09-27): the header is declared, so a host that answers a
    // well-formed below-floor value with anything but 2xx (the MAY: served) or
    // 426 client_version_unsupported refuses a declared header in an
    // unregistered form. That is a failure. Before RFC 0219 it recorded `blocked`.
    expect(res.status === 426 || (res.status >= 200 && res.status < 300), req('openwop.requirement.0172.min-client-version', DOC, `a client announcing 0.0.1 below minClientVersion ${String(floor)} MUST be served or refused with 426 client_version_unsupported — the host answered ${res.status}`)).toBe(true);
    // partial-witness-ok: the minClientVersion grammar MUST was asserted above; refusing a
    // below-floor client is a MAY and this host served it, so the 426 shape binds nothing.
    if (res.status !== 426) return softSkip('inapplicable', `the host advertises minClientVersion ${String(floor)} but served a client announcing 0.0.1 (${res.status}) — refusal is a MAY; nothing further is observable`);
    expect(readErrorCode(res.json), req('openwop.requirement.0172.min-client-version', DOC, 'a 426 refusal MUST carry client_version_unsupported')).toBe('client_version_unsupported');
    const r = v2Validator('error-envelope')(res.json);
    expect(r.ok, req('openwop.requirement.0172.min-client-version', 'spec/v2/core/errors.md §The envelope', `the refusal MUST be the closed error envelope (${r.errors})`)).toBe(true);
    // RFC 0219 Q5: details.minClientVersion is OPTIONAL; when a host sends it, it names the floor
    // (errors.json registers its grammar, which the envelope validator above already checked).
    const details = (res.json as { details?: { minClientVersion?: unknown } } | null)?.details;
    if (details && details.minClientVersion !== undefined) {
      expect(details.minClientVersion, req('openwop.requirement.0172.min-client-version', DOC, `a refusal's details.minClientVersion MUST name the advertised floor ${String(floor)}`)).toBe(floor);
    }
  });
});
