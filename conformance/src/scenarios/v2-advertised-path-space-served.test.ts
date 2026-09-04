/**
 * RFC 0172 §A.1 / `spec/v2/core/versioning.md` §5 — a host that advertises
 * major 2 serves the major-2 PATH SPACE, not just the major-2 discovery
 * document (suite 2.0.0, target major 2; unaided).
 *
 * `v2-version-header-honored` checks that `OpenWOP-Version` is honored or
 * refused rather than ignored. It probes `/.well-known/openwop`, because that
 * is the one resource whose representation the header selects. **It therefore
 * cannot see a host that negotiates correctly on the well-known resource and
 * has mounted almost none of the rest of the v2 surface.**
 *
 * That is not hypothetical. A tier-1 host advertising
 * `protocolVersions: ["1.1","2.0"]` was found serving **two of fifteen**
 * top-level segments of the v2 path space: its unversioned mount was a
 * deliberate allowlist (`['/runs','/interrupts']`, chosen over a blanket
 * `/v1`-strip because the host serves a large non-`/v1` surface a blanket
 * rewrite would shadow) and the list was simply incomplete. Every probe used to
 * call the dual stack live — `protocolVersions`, `preferredVersion`, the
 * response header, the two differing representations — hits `/.well-known`, so
 * every one of them passed. `POST /webhooks` under major 2 returned `404` while
 * `POST /v1/webhooks` returned `201`. The host found this itself by applying
 * the artifact rule to a scenario it had first classified as a harness defect.
 *
 * The discriminator is a PAIR, not a single probe, because "this host does not
 * implement webhooks at all" and "this host implements webhooks but did not
 * mount them under major 2" are different facts that a lone `404` cannot
 * separate:
 *
 *   /v1<path> exists  AND  <path> is 404 under major 2  ⇒  the advertisement
 *   overstates: the surface exists and major 2 does not reach it.
 *
 *   both 404  ⇒  the host does not serve that surface in either major. Not this
 *   scenario's business, and recorded as neither pass nor failure.
 *
 * Only parameterless GETs from `spec/v2/path-manifest.json` are probed: they
 * need no fixture, mutate nothing, and a route that is not mounted answers 404
 * regardless of auth, so the check is unaided and safe against a live host.
 *
 * @see spec/v2/core/versioning.md §5
 * @see RFCS/0172-v2-versioning-and-release.md §A.1
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../lib/env.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';

const ID = 'openwop.requirement.0172.advertised-path-space-served';
const DOC = 'spec/v2/core/versioning.md §5';

/** The well-known resource is the one the HEADER selects; it has no /v1 twin to pair against. */
const NOT_PAIRABLE = new Set(['/.well-known/openwop']);

interface Probe { readonly status: number | null }

async function get(path: string, major2: boolean): Promise<Probe> {
  const { baseUrl, apiKey } = loadEnv();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (major2) headers['OpenWOP-Version'] = '2.0';
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { headers });
    return { status: res.status };
  } catch {
    return { status: null };
  }
}

function parameterlessGets(): string[] {
  try {
    const manifest = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, '..', 'spec', 'v2', 'path-manifest.json'), 'utf8'),
    ) as { operations?: ReadonlyArray<{ method: string; path: string }> };
    return (manifest.operations ?? [])
      .filter((o) => o.method === 'GET' && !o.path.includes('{') && !NOT_PAIRABLE.has(o.path))
      .map((o) => o.path)
      .sort();
  } catch {
    return [];
  }
}

describe('v2-advertised-path-space-served (RFC 0172 §A.1)', () => {
  it('a host advertising major 2 reaches the surfaces it already serves under /v1', async () => {
    const { baseUrl } = loadEnv();
    const bare = await (async () => {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/.well-known/openwop`, { headers: { Accept: 'application/json' } });
        return res.status === 200 ? ((await res.json()) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    })();
    if (!bare) return softSkip('blocked', 'the discovery document is unreadable, so the advertised majors are unknown');

    const versions = Array.isArray(bare['protocolVersions']) ? (bare['protocolVersions'] as unknown[]).map(String) : [];
    if (!new Set(versions.map((v) => v.split('.')[0])).has('2')) {
      return softSkip('inapplicable', `the host advertises [${versions.join(', ') || 'no protocolVersions'}] — it does not claim major 2, so there is no path space to hold it to`);
    }

    const paths = parameterlessGets();
    if (paths.length === 0) return softSkip('blocked', 'spec/v2/path-manifest.json is unreadable from this layout');

    const overstated: string[] = [];
    const served: string[] = [];
    let pairable = 0;
    for (const path of paths) {
      const v1 = await get(`/v1${path}`, false);
      if (v1.status === null) return softSkip('blocked', `the host became unreachable while probing /v1${path}`);
      // The host does not serve this surface in EITHER major. Legitimate, and a
      // different question from the one asked here.
      if (v1.status === 404) continue;
      pairable += 1;

      const v2 = await get(path, true);
      if (v2.status === null) return softSkip('blocked', `the host became unreachable while probing ${path}`);
      // Any status but 404 means the route is MOUNTED — 401/403/422 all answer
      // "this path exists". Only 404 says major 2 cannot reach it.
      if (v2.status === 404) overstated.push(`${path} (/v1 → ${v1.status}, major 2 → 404)`);
      else served.push(path);
    }

    if (pairable === 0) {
      return softSkip('inapplicable', 'no parameterless GET in the v2 manifest is served under /v1 either, so there is no pair to compare and the advertisement cannot be checked this way');
    }

    expect(
      overstated,
      req(ID, DOC, `a host advertising major 2 MUST reach, under major 2, the surfaces it already serves under /v1 — advertising the major is a claim about the PATH SPACE and not only about the well-known resource, whose representation the header selects and which therefore passes even when almost nothing else is mounted (${overstated.length} of ${pairable} pairable surface(s) unreachable: ${overstated.slice(0, 6).join('; ')})`),
    ).toEqual([]);

    expect(
      served.length,
      req(ID, DOC, 'at least one non-well-known surface MUST be reachable under major 2, or the advertisement rests entirely on the one resource the header selects'),
    ).toBeGreaterThan(0);
  });
});
