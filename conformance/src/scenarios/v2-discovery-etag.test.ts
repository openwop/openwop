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
 * RFC 0235 (`runs.md` §Caching and encoding): the match is RFC 9110 §13.1.2.
 * Three more legs, shared with `v2-run-snapshot-etag` through
 * `lib/if-none-match-witness.ts`:
 *
 *   rfc9110-match       `W/<tag>`, a list holding the tag and `*` receive 304;
 *                       a list of other tags and a weak other tag receive 200;
 *   304-carries-etag    every 304 carries the tag (and the 200's `Vary`);
 *   no-cache-ignored    a request `Cache-Control: no-cache` still gets its 304.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`. No other skip — the rule is
 * unconditional at v2.
 *
 * @see spec/v2/core/capabilities.md §1
 * @see spec/v2/core/runs.md §Caching and encoding
 * @see spec/v2/core/headers.md §Request headers
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { headersLeg, matchLeg, noCacheLeg, type Get } from '../lib/if-none-match-witness.js';

const DOC = 'spec/v2/core/capabilities.md §1';
const ID_EMITTED = 'openwop.requirement.capabilities.discovery-etag-emitted';
const ID_REVALIDATES = 'openwop.requirement.capabilities.discovery-etag-revalidates';
const V2 = { 'OpenWOP-Version': '2.0' };
const MATCH_DOC = 'spec/v2/core/runs.md §Caching and encoding';
const ID_MATCH = 'openwop.requirement.0235.if-none-match.rfc9110-match';
const ID_304_ETAG = 'openwop.requirement.0235.if-none-match.304-carries-etag';
const ID_NO_CACHE = 'openwop.requirement.0235.if-none-match.no-cache-ignored';
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

  const discoveryGet: Get = (headers) => get({ ...V2, ...headers });

  it('If-None-Match is evaluated as RFC 9110 defines it: a weak tag, a list holding the tag and `*` match; other tags do not', async () => {
    const out = await matchLeg(discoveryGet);
    if (out.kind === 'unreadable') return softSkip('blocked', `discovery: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_MATCH, MATCH_DOC, 'If-None-Match is `*` or a list of entity tags compared weakly (RFC 9110 §13.1.2)')).toBe('');
  });

  it('a 304 carries the ETag and the Vary of the 200', async () => {
    const out = await headersLeg(discoveryGet);
    if (out.kind === 'unreadable') return softSkip('blocked', `discovery: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_304_ETAG, MATCH_DOC, 'on a match the host MUST answer 304 carrying the ETag and the Vary the 200 would carry')).toBe('');
  });

  it('a request Cache-Control: no-cache does not suppress the evaluation', async () => {
    const out = await noCacheLeg(discoveryGet);
    if (out.kind === 'unreadable') return softSkip('blocked', `discovery: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_NO_CACHE, MATCH_DOC, 'a request Cache-Control: no-cache MUST NOT suppress the evaluation')).toBe('');
  });
});
