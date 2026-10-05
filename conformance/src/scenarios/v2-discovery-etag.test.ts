/**
 * v2 — the discovery document's conditional GET (`spec/v2/core/capabilities.md`
 * §1; `headers.md` §Request headers). The v1 twin is the presence-gated leg in
 * `discovery.test.ts`, which runs at major 1 only, so until 2.45.17 nothing
 * witnessed this MUST at major 2.
 *
 * At v2 both halves are MUSTs: a host MUST emit a standard `ETag` on the
 * discovery document and MUST honour `If-None-Match` with `304`. The 304
 * carries no body and carries `OpenWOP-Version` like every response
 * (versioning.md §1.4).
 *
 *   etag-emitted       the 200 carries a non-empty `ETag`;
 *   etag-revalidates   a matching `If-None-Match` receives `304`, no body,
 *                      `OpenWOP-Version` present; a non-matching one receives
 *                      `200` with the document (control: a host that answers
 *                      304 to any conditional request fails).
 *
 * The revalidation runs once per client spelling: `OpenWOP-Version: 2.0` and
 * `2` (versioning.md §1: a host MUST accept both), and `2` with a wildcard `Accept`
 * (curl, a default fetch). A host that honours only the suite's own spelling
 * would pass a single-spelling leg while failing every other client.
 *
 * Measured against the PUBLIC origin a host is cut on, because the rule binds
 * what clients reach. A CDN in front of a correct origin can still fail it:
 * on openwop-app (2026-10-04) a `no-store` discovery response is hit-for-pass
 * at the edge, so the first conditional request to reach an edge node that has
 * not yet seen the object gets `200` and later ones get `304`. That failure is
 * intermittent and real; it does not depend on the spelling.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`. No other skip — the rule is
 * unconditional at v2.
 *
 * @see spec/v2/core/capabilities.md §1
 * @see spec/v2/core/headers.md §Request headers
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §1';
const ID_EMITTED = 'openwop.requirement.capabilities.discovery-etag-emitted';
const ID_REVALIDATES = 'openwop.requirement.capabilities.discovery-etag-revalidates';
const V2 = { 'OpenWOP-Version': '2.0' };
/** The client spellings a host MUST treat alike (versioning.md §1). */
const SPELLINGS: ReadonlyArray<Readonly<Record<string, string>>> = [
  { 'OpenWOP-Version': '2.0' },
  { 'OpenWOP-Version': '2' },
  { 'OpenWOP-Version': '2', Accept: '*/*' },
];
const label = (h: Readonly<Record<string, string>>): string => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join(', ');

async function get(headers: Readonly<Record<string, string>> = V2): Promise<OpenWOPResponse | null> {
  try { return await driver.get('/.well-known/openwop', { authenticated: false, headers: { ...headers } }); } catch { return null; }
}

describe('v2 discovery ETag (capabilities.md §1)', () => {
  it('the discovery document carries an ETag', async () => {
    const first = await get();
    if (first === null || first.status !== 200) return softSkip('blocked', `v2 discovery unreachable (${first?.status ?? 'no response'})`);
    const etag = first.headers.get('etag');
    expect(etag !== null && etag.trim().length > 0, req(ID_EMITTED, DOC, `a host MUST emit a standard ETag on the discovery document (got ${etag === null ? 'none' : JSON.stringify(etag)})`)).toBe(true);
  });

  it('a matching If-None-Match receives 304 with no body and the version header; a non-matching one receives 200', async () => {
    const first = await get();
    if (first === null || first.status !== 200) return softSkip('blocked', `v2 discovery unreachable (${first?.status ?? 'no response'})`);
    const etag = first.headers.get('etag');
    if (etag === null || etag.trim().length === 0) return softSkip('inapplicable', 'no ETag to revalidate — the emitted-ETag leg records that MUST');

    for (const spelling of SPELLINGS) {
      const own = await get(spelling);
      if (own === null || own.status !== 200) return softSkip('blocked', `v2 discovery unreachable under ${label(spelling)} (${own?.status ?? 'no response'})`);
      const tag = own.headers.get('etag') ?? etag;
      const hit = await get({ ...spelling, 'If-None-Match': tag });
      if (hit === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
      expect(hit.status, req(ID_REVALIDATES, DOC, `under ${label(spelling)}, a matching If-None-Match MUST receive 304 (got ${hit.status}; ETag sent ${tag}, answered ${String(hit.headers.get('etag'))})`)).toBe(304);
      expect(hit.text.length, req(ID_REVALIDATES, 'spec/v2/core/headers.md §Request headers', `under ${label(spelling)}, the 304 MUST carry no body (got ${hit.text.length} byte(s))`)).toBe(0);
      expect(hit.headers.get('openwop-version'), req(ID_REVALIDATES, 'spec/v2/core/versioning.md §1.4', `under ${label(spelling)}, the 304 carries OpenWOP-Version like every response`)).not.toBeNull();
    }

    const miss = await get({ ...V2, 'If-None-Match': '"openwop-conformance-no-such-tag"' });
    if (miss === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
    expect(miss.status, req(ID_REVALIDATES, DOC, `a non-matching If-None-Match MUST receive 200 with the document (got ${miss.status})`)).toBe(200);
  });
});
