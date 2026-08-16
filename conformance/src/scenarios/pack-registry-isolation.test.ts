/**
 * Pack-registry test-mode isolation — RFC 0025 §C point 1.
 *
 * Status: BEHAVIORAL (soft-skip). A pack PUT'd to `/v1/packs-test/*` MUST
 * NOT appear in `/v1/packs/*` listings. This anchors the test-mode
 * mirror's load-bearing safety invariant: the conformance suite is
 * trusted to drive publish-error-catalog traffic against the test
 * namespace precisely because the test catalog is guaranteed distinct
 * from the production catalog.
 *
 * Soft-skips when the host doesn't advertise
 * `capabilities.packs.testMode.supported: true` (or advertises
 * `isolated: false` — in which case the host is honestly disclaiming
 * the invariant and the conformance suite's other publish-error tests
 * are not applicable either).
 *
 * @see RFCS/0025-test-mode-registry-namespace.md §C "Isolation guarantees"
 * @see schemas/capabilities.schema.json §packs.testMode
 * @see pack-registry-publish.test.ts (the 25 sibling scenarios this invariant unblocks)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

interface TestModeAdvertisement {
  readonly supported: boolean;
  readonly isolated: boolean;
}

async function getTestModeAdvertisement(): Promise<TestModeAdvertisement | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const packs = top && typeof top === 'object' ? (top['packs'] as Record<string, unknown> | undefined) : undefined;
  const testMode = packs && typeof packs === 'object' ? (packs['testMode'] as Record<string, unknown> | undefined) : undefined;
  if (!testMode || typeof testMode !== 'object') return null;
  return {
    supported: testMode['supported'] === true,
    isolated: testMode['isolated'] === true,
  };
}

function freshPackName(): string {
  return `core.openwop.test-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('pack-registry-isolation: test catalog MUST NOT bleed into production (RFC 0025 §C.1)', () => {
  it('a pack PUT to /v1/packs-test/{name} MUST NOT appear in GET /v1/packs/{name}', async () => {
    const adv = await getTestModeAdvertisement();
    if (!adv || !adv.supported) return softSkip('inapplicable', 'host doesn\'t advertise the seam');
    if (!adv.isolated) return softSkip('blocked', 'host explicitly disclaims the invariant — no contract to assert (!adv.isolated)');

    const name = freshPackName();
    const version = '1.0.0';

    // PUT to the test namespace. The body is intentionally minimal — the
    // isolation invariant is independent of whether validation accepts
    // or rejects the publish. Either outcome is fine; what's tested is
    // that NEITHER outcome causes the pack to surface in the production
    // catalog.
    const putRes = await driver.put(
      `/v1/packs-test/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`,
      Buffer.from([0x1f, 0x8b, 0]),
      { headers: { 'Content-Type': 'application/octet-stream' } },
    );

    // If the seam returns 404, the test-mode endpoint isn't actually
    // wired up despite the advertisement — pack-registry-publish.test.ts
    // catches that drift in 24 other scenarios; soft-skip here.
    if (putRes.status === 404) return softSkip('blocked', 'precondition not met — `putRes.status === 404` returned early (seam, prior step, or fixture unavailable)');

    // Probe the production namespace. The invariant: a pack written
    // via /v1/packs-test/* MUST NOT be retrievable via /v1/packs/*.
    const prodRes = await driver.get(`/v1/packs/${encodeURIComponent(name)}`);

    // 404 is the canonical "not found" — exactly what isolation requires.
    // 200 with a payload that does NOT name our pack would mean the host
    // returned a listing of unrelated packs (some hosts serve search-shaped
    // results on /v1/packs/{nonexistent}); we check the negative explicitly.
    if (prodRes.status === 200) {
      const body = prodRes.json as Record<string, unknown> | undefined;
      const stringified = body ? JSON.stringify(body) : '';
      expect(
        stringified.includes(name),
        driver.describe(
          'RFCS/0025-test-mode-registry-namespace.md §C point 1',
          `pack name '${name}' was written via /v1/packs-test/${name}@${version} but appeared in /v1/packs/${name} response body — test-catalog isolation MUST hold`,
        ),
      ).toBe(false);
      return;
    }

    // Acceptable: 4xx range (404 pack_not_found is the spec-canonical
    // shape; 410/422 also fine — any "not present in production catalog"
    // signal satisfies the invariant).
    expect(
      prodRes.status >= 400 && prodRes.status < 500,
      driver.describe(
        'RFCS/0025-test-mode-registry-namespace.md §C point 1',
        `expected production-namespace GET to return 4xx for a test-namespace-only pack '${name}', got ${prodRes.status}`,
      ),
    ).toBe(true);
  });
});
