/**
 * v2 — `OpenWOP-Client-Version` (suite 2.42.8; RFC 0219;
 * `spec/v2/core/versioning.md` §1.5 "Client precedence and minClientVersion").
 *
 * A client announces the protocol version it implements in
 * `OpenWOP-Client-Version: <major>.<minor>[.<patch>]`. A host that advertises
 * `minClientVersion` MAY refuse a client below it with `426
 * client_version_unsupported`, and MUST NOT refuse anything else on version
 * grounds. Every leg probes `GET /.well-known/openwop` under
 * `OpenWOP-Version: 2.0` (the discovery document is not exempt from refusal).
 *
 *   floor-comparison     (gated on minClientVersion) `<floor>`, `<floor>.0` and
 *                        `<floor>.99` are served: equal on major.minor is not
 *                        below, and the patch never decides.
 *   malformed-not-refused (gated on a host that refuses `0.0.1` with 426) the
 *                        malformed values `not-a-version`, `1`, `01.0` and
 *                        `1.0-rc.1` are treated as absent and served — never
 *                        426, never 400. A host that serves `0.0.1` does not
 *                        exercise the refusal, so a served malformed value
 *                        proves nothing there: `inapplicable`.
 *   absent-not-refused   a header-less request is never 426 (every host); on a
 *                        host that refuses `0.0.1` with 426, it is also served.
 *   no-floor-no-refusal  (hosts advertising NO minClientVersion) `0.0.1` is
 *                        served, not 426. None of today's certified hosts is in
 *                        this state, so it records `inapplicable` on each.
 *
 * Unwitnessed and recorded in RFC 0219's falsifiability table: a host choosing
 * a major or a representation from the header, and the header used as an
 * authentication or authorization input.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/versioning.md §1.5';
const PATH = '/.well-known/openwop';
const FLOOR = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
/** Below any floor a host can advertise except `0.0`, which nothing is below. */
const BELOW = '0.0.1';
const MALFORMED = ['not-a-version', '1', '01.0', '1.0-rc.1'] as const;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function probe(clientVersion: string | null): Promise<OpenWOPResponse | null> {
  const headers: Record<string, string> = { 'OpenWOP-Version': '2.0' };
  if (clientVersion !== null) headers['OpenWOP-Client-Version'] = clientVersion;
  try { return await driver.get(PATH, { authenticated: false, headers }); } catch { return null; }
}
const served = (r: OpenWOPResponse): boolean => r.status >= 200 && r.status < 300;

/** The advertised floor, or a skip reason. */
async function advertisedFloor(): Promise<{ floor: string } | { skip: [kind: 'blocked' | 'inapplicable', reason: string] }> {
  const doc = await discovery();
  if (!doc) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0'] };
  const floor = doc['minClientVersion'];
  if (floor === undefined) return { skip: ['inapplicable', 'the host does not advertise minClientVersion — the floor legs are gated on a host that sets it'] };
  // The floor's own grammar is v2-min-client-version's row; a floor this leg cannot read compares nothing.
  if (typeof floor !== 'string' || !FLOOR.test(floor)) return { skip: ['inapplicable', `minClientVersion ${JSON.stringify(floor)} is not <major>.<minor> — judged by v2-min-client-version, nothing to compare here`] };
  if (floor === '0.0') return { skip: ['inapplicable', 'minClientVersion is 0.0 — no well-formed client version is below it, so no refusal can be provoked'] };
  return { floor };
}

/** Gate for the legs that need a host which actually refuses a below-floor client. */
async function refusingHost(): Promise<{ floor: string } | { skip: [kind: 'blocked' | 'inapplicable', reason: string] }> {
  const f = await advertisedFloor();
  if ('skip' in f) return f;
  const control = await probe(BELOW);
  if (control === null) return { skip: ['blocked', `GET ${PATH} with OpenWOP-Client-Version: ${BELOW} unreachable (fetch failed)`] };
  if (served(control)) return { skip: ['inapplicable', `the host advertises minClientVersion ${f.floor} but served a client announcing ${BELOW} (${control.status}) — refusal is a MAY; a served header-less or malformed request distinguishes nothing on a host that refuses nobody`] };
  if (control.status !== 426) return { skip: ['blocked', `the control (${BELOW}, below minClientVersion ${f.floor}) answered ${control.status} — neither served nor 426; v2-min-client-version records that as a failure, and this leg has no refusal to compare against`] };
  return f;
}

describe('v2 OpenWOP-Client-Version (RFC 0219 — versioning.md §1.5)', () => {
  it('a client at the floor is not below it: equal on major.minor, the patch never decides', async () => {
    const f = await advertisedFloor();
    if ('skip' in f) return softSkip(...f.skip);
    for (const v of [f.floor, `${f.floor}.0`, `${f.floor}.99`]) {
      const res = await probe(v);
      if (res === null) return softSkip('blocked', `GET ${PATH} with OpenWOP-Client-Version: ${v} unreachable (fetch failed)`);
      expect(res.status, req('openwop.requirement.0219.floor-comparison', DOC, `a client announcing ${v} is not below minClientVersion ${f.floor} (major and minor compared as integers; the patch never decides) and MUST be served, not refused (got ${res.status})`)).not.toBe(426);
      expect(served(res), req('openwop.requirement.0219.floor-comparison', DOC, `a well-formed OpenWOP-Client-Version at the floor MUST NOT make the request fail — ${v} got ${res.status}`)).toBe(true);
    }
  });

  it('a malformed OpenWOP-Client-Version is treated as absent: never 426, never 400', async () => {
    const f = await refusingHost();
    if ('skip' in f) return softSkip(...f.skip);
    for (const v of MALFORMED) {
      const res = await probe(v);
      if (res === null) return softSkip('blocked', `GET ${PATH} with OpenWOP-Client-Version: ${v} unreachable (fetch failed)`);
      expect(res.status, req('openwop.requirement.0219.malformed-not-refused', DOC, `a value outside the grammar (${JSON.stringify(v)}) MUST be treated as absent, so it MUST NOT be refused 426 client_version_unsupported (floor ${f.floor})`)).not.toBe(426);
      expect(res.status, req('openwop.requirement.0219.malformed-not-refused', DOC, `a value outside the grammar (${JSON.stringify(v)}) MUST NOT produce a 400`)).not.toBe(400);
      expect(served(res), req('openwop.requirement.0219.malformed-not-refused', DOC, `a malformed value is treated as absent and a header-less request is served — ${JSON.stringify(v)} got ${res.status}`)).toBe(true);
    }
  });

  it('a request without OpenWOP-Client-Version is served where a below-floor one is refused', async () => {
    // A 426 to a header-less request is a violation on ANY host, floor or not — probe it before the gate,
    // because a host that refuses it also refuses the header-less discovery read the gate depends on.
    const res = await probe(null);
    if (res === null) return softSkip('blocked', `GET ${PATH} without OpenWOP-Client-Version unreachable (fetch failed)`);
    expect(res.status, req('openwop.requirement.0219.absent-not-refused', DOC, 'a host MUST NOT answer 426 client_version_unsupported to a request that carries no OpenWOP-Client-Version')).not.toBe(426);
    const f = await refusingHost();
    // partial-witness-ok: the header-less request was not refused 426 (asserted above, binding on every host);
    // that it is SERVED distinguishes something only on a host that refuses a below-floor client.
    if ('skip' in f) return softSkip(...f.skip);
    expect(served(res), req('openwop.requirement.0219.absent-not-refused', DOC, `a host MUST NOT refuse a request because it omits OpenWOP-Client-Version (got ${res.status})`)).toBe(true);
  });

  it('a host that advertises no minClientVersion refuses no client on version grounds', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    if (doc['minClientVersion'] !== undefined) return softSkip('inapplicable', `the host advertises minClientVersion ${JSON.stringify(doc['minClientVersion'])} — this leg is for a host with no floor`);
    const res = await probe(BELOW);
    if (res === null) return softSkip('blocked', `GET ${PATH} with OpenWOP-Client-Version: ${BELOW} unreachable (fetch failed)`);
    expect(res.status, req('openwop.requirement.0219.no-floor-no-refusal', DOC, `a host that advertises no minClientVersion MUST NOT answer 426 client_version_unsupported (a client announcing ${BELOW})`)).not.toBe(426);
    expect(served(res), req('openwop.requirement.0219.no-floor-no-refusal', DOC, `a well-formed OpenWOP-Client-Version MUST NOT make the request fail on a host with no floor (got ${res.status})`)).toBe(true);
  });
});
