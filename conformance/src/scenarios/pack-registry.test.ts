/**
 * Pack-registry read scenarios — `node-packs.md` §"Registry HTTP API".
 *
 * Vendor-neutral discovery-shape contracts for the read surface of a
 * OpenWOP-compliant pack registry. Hosts that DO NOT operate a registry are
 * spec-allowed to omit the entire `/v1/packs/*` namespace; this suite
 * detects that case via a probe on `GET /v1/packs/-/search` and
 * trivially-passes the rest of the scenarios when no registry is
 * present.
 *
 * Why discovery-shape only:
 *
 *   The publish path is gated on `packs:publish` scope (auth.md) and a
 *   binary tarball upload — both outside the black-box surface this suite
 *   asserts. Round-trip publish scenarios live in
 *   `pack-registry-publish.test.ts` as documented TODO scenarios until
 *   OpenWOP defines a test-mode registry namespace that lets conformance
 *   suites publish without touching the real catalog. Hosts should cover
 *   publish round-trips in host-specific route tests until that isolated
 *   surface exists.
 *
 *   What IS testable cross-implementation: error envelopes for the read
 *   endpoints (`pack_not_found`, `invalid_pack_name`, `invalid_version`,
 *   `signature_not_available`), the search-result shape, and the keychain
 *   shape when present.
 *
 * Scenario gating:
 *
 *   - **Registry presence probe** runs once; if the host returns 404 for
 *     the search endpoint with a non-openwop error envelope (or a static-html
 *     404), the scenarios short-circuit. Hosts ARE NOT required to ship a
 *     pack registry.
 *
 *   - **Read-endpoint error envelopes** assert the shape of error
 *     responses to known-bad inputs (nonexistent pack names, bad scopes).
 *     Hosts that ship a registry MUST return openwop error envelopes here.
 *
 *   - **Keychain shape** is gated on whether the host serves a keychain
 *     for the probed namespace (signing is OPTIONAL per the spec).
 *
 * @see node-packs.md §"Registry HTTP API"
 * @see registry-operations.md §"Signing keychain"
 * @see schemas/node-pack-manifest.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { recordRequirement } from '../lib/requirement-ledger.js';
import { requirementIdForScenario } from '../lib/requirement-registry.js';

/** RFC 0148 §A requirement id this file's floor row is recorded under. */
const REQUIREMENT_ID = requirementIdForScenario('pack-registry.test.ts');

/** A nonsense pack name in the `private.*` scope. Hosts MUST NOT have
 *  shipped a real pack at this name (the namespace is scoped to a
 *  randomized suffix). */
const NONEXISTENT_PACK = `private.conformance-probe.does-not-exist-${Date.now()}`;
const NONEXISTENT_VERSION = '0.0.0-conformance';

/** Reverse-DNS pack name pattern from `node-packs.md` §Naming. The `private`
 *  scope is part of the v1.0 pack-name pattern (spec-side companion to the runtime's
 *  pre-existing acceptance). */
const PACK_NAME_RE = /^(core|vendor|community|private)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;

/** Semantic Versioning 2.0.0. */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface RegistryProbeResult {
  /** True when the host advertises a pack registry (any /v1/packs/* read returns an OpenWOP-shaped response). */
  readonly registryPresent: boolean;
  /** Last status code observed on the probe. */
  readonly probeStatus: number;
}

/** Probe `GET /v1/packs/-/search?q=` once per process; cached. */
let cachedProbe: RegistryProbeResult | null = null;
async function probeRegistry(): Promise<RegistryProbeResult> {
  if (cachedProbe) return cachedProbe;
  // Empty query is the cheapest probe — server SHOULD reject empty-q
  // with `400 validation_error` if the registry is mounted, OR return
  // 200 with `{results: []}` if it tolerates empty queries. Either
  // shape proves the registry is mounted. A 404 with a non-JSON body
  // (or no `error` field) means the host doesn't run a registry.
  const res = await driver.get('/v1/packs/-/search?q=', { authenticated: false });
  const body = res.json as { error?: unknown; results?: unknown } | undefined;
  // Heuristic: if the response is JSON-shaped (has either `error` or
  // `results`), the registry is mounted. A wholly missing namespace
  // returns the host's catch-all 404 which usually has no body or a
  // host-specific shape.
  const looksLikeWop = res.status === 200 || (typeof body === 'object' && body !== null && ('error' in body || 'results' in body));
  cachedProbe = { registryPresent: looksLikeWop, probeStatus: res.status };
  if (!looksLikeWop) {
    // RFC 0148 §A: say WHY every leg below returns early. RFC 0025 makes the
    // `/v1/packs/*` read surface unconditional-when-shipped with no discovery
    // advert, so "no registry" is only observable by probing; the honest
    // disposition is `inapplicable` with the probe result — the host does not
    // hold `openwop-node-packs` (a runtime-derived profile), which is a fact
    // about the host, not a defect and not a vacuous pass.
    try {
      recordRequirement(
        REQUIREMENT_ID,
        'inapplicable',
        `host ships no pack registry (GET /v1/packs/-/search?q= → ${res.status}, non-OpenWOP body); RFC 0025 read surface is unadvertised-when-shipped, so absence is a probe result — openwop-node-packs is not held by this host`,
      );
    } catch {
      /* already recorded */
    }
  }
  return cachedProbe;
}

describe('pack-registry: read-endpoint shape contracts', () => {
  it('GET /v1/packs/-/search returns an OpenWOP-shaped response (or registry is absent)', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return; // Host doesn't ship a registry.

    const res = await driver.get('/v1/packs/-/search?q=', { authenticated: false });
    // Spec doesn't pin empty-q behavior — both 400 (validation) and 200
    // (empty results) are acceptable. We only assert the response is
    // JSON-shaped.
    expect([200, 400]).toContain(res.status);
    const body = res.json as Record<string, unknown> | undefined;
    expect(body, driver.describe(
      'node-packs.md §"GET /v1/packs/-/search"',
      'response MUST be JSON',
    )).toBeDefined();

    if (res.status === 200) {
      expect(Array.isArray(body?.results), driver.describe(
        'node-packs.md §"GET /v1/packs/-/search"',
        'search response MUST carry a `results` array',
      )).toBe(true);
    } else {
      expect(typeof body?.error, driver.describe(
        'rest-endpoints.md §"Error envelope"',
        '400 response MUST carry a string `error` field',
      )).toBe('string');
    }
  });

  it('GET /v1/packs/{nonexistent} returns 404 pack_not_found with openwop error envelope', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    const res = await driver.get(`/v1/packs/${encodeURIComponent(NONEXISTENT_PACK)}`, {
      authenticated: false,
    });
    expect(res.status, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}"',
      'unknown pack name MUST return 404',
    )).toBe(404);

    const body = res.json as { error?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'rest-endpoints.md §"Error envelope"',
      '404 response MUST carry a string `error` field',
    )).toBe('string');
    // Reference impl emits `pack_not_found`; spec doesn't pin the exact
    // string — but the prefix `pack_` is the documented family.
    expect((body?.error as string).length, driver.describe(
      'rest-endpoints.md §"Error envelope"',
      '`error` field MUST be non-empty',
    )).toBeGreaterThan(0);
  });

  it('GET /v1/packs/{name}/-/{version}.json returns 404 for nonexistent version', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    const res = await driver.get(
      `/v1/packs/${encodeURIComponent(NONEXISTENT_PACK)}/-/${NONEXISTENT_VERSION}.json`,
      { authenticated: false },
    );
    expect(res.status, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}/-/{version}.json"',
      'unknown (name, version) MUST return 404',
    )).toBe(404);

    const body = res.json as { error?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'rest-endpoints.md §"Error envelope"',
      '404 response MUST carry a string `error` field',
    )).toBe('string');
  });

  it('GET /v1/packs/{name}/-/{version}.sig returns 404 signature_not_available for nonexistent version', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    const res = await driver.get(
      `/v1/packs/${encodeURIComponent(NONEXISTENT_PACK)}/-/${NONEXISTENT_VERSION}.sig`,
      { authenticated: false },
    );
    // Spec: 404 signature_not_available is the canonical code; the four
    // cases (missing / yanked / unsigned / storage-unwired) are
    // intentionally indistinguishable. A 302 redirect to a storage-
    // backed signed URL is also spec-allowed for VALID signatures —
    // for a NONEXISTENT pack, only 404 is correct.
    expect(res.status, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}/-/{version}.sig"',
      'nonexistent (name, version) MUST return 404 signature_not_available',
    )).toBe(404);

    const body = res.json as { error?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}/-/{version}.sig"',
      '404 response MUST carry a string `error` field — `signature_not_available` is the canonical code',
    )).toBe('string');
    expect((body?.error as string).length).toBeGreaterThan(0);
  });

  it('GET /v1/packs/{bad-name}/-/{version}.json returns 400 invalid_pack_name', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    // Single-segment name violates the reverse-DNS pattern.
    const res = await driver.get('/v1/packs/not-reverse-dns/-/1.0.json', {
      authenticated: false,
    });
    expect(res.status, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}/-/{version}.json"',
      'malformed pack name MUST return 400 invalid_pack_name',
    )).toBe(400);

    const body = res.json as { error?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'rest-endpoints.md §"Error envelope"',
      '400 response MUST carry a string `error` field',
    )).toBe('string');
  });

  it('GET /v1/packs/{name}/-/{bad-version}.json returns 400 invalid_version', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    // `not-a-version` violates semver.
    const res = await driver.get(
      `/v1/packs/${encodeURIComponent(NONEXISTENT_PACK)}/-/not-a-version.json`,
      { authenticated: false },
    );
    expect(res.status, driver.describe(
      'node-packs.md §"GET /v1/packs/{name}/-/{version}.json"',
      'non-semver version MUST return 400 invalid_version',
    )).toBe(400);

    const body = res.json as { error?: unknown } | undefined;
    expect(typeof body?.error).toBe('string');
  });
});

describe('pack-registry: catalog response shape (when populated)', () => {
  it('GET /v1/packs/{name} catalog records validate against the documented shape', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    // Probe search for a real entry. If the catalog is empty, skip.
    const search = await driver.get('/v1/packs/-/search?q=', { authenticated: false });
    if (search.status !== 200) return;
    const results = (search.json as { results?: Array<{ name?: unknown }> } | undefined)?.results;
    if (!Array.isArray(results) || results.length === 0) return;

    // Walk up to 3 results and assert their catalog records are well-shaped.
    const sample = results.slice(0, 3);
    for (const entry of sample) {
      const name = entry.name;
      if (typeof name !== 'string') continue;
      expect(name, driver.describe(
        'node-packs.md §"Naming"',
        `search result name "${name}" MUST match reverse-DNS pattern`,
      )).toMatch(PACK_NAME_RE);

      const cat = await driver.get(`/v1/packs/${encodeURIComponent(name)}`, {
        authenticated: false,
      });
      expect(cat.status, driver.describe(
        'node-packs.md §"GET /v1/packs/{name}"',
        `catalog read for known pack "${name}" MUST return 200`,
      )).toBe(200);

      const body = cat.json as {
        name?: unknown;
        versions?: Record<string, unknown>;
        'dist-tags'?: { latest?: unknown };
      } | undefined;
      expect(body?.name, driver.describe(
        'node-packs.md §"GET /v1/packs/{name}"',
        'catalog response MUST echo the requested pack name',
      )).toBe(name);
      expect(typeof body?.versions, driver.describe(
        'node-packs.md §"GET /v1/packs/{name}"',
        'catalog response MUST carry a `versions` map',
      )).toBe('object');

      // Every version key MUST be valid semver per the spec.
      const versionKeys = Object.keys(body?.versions ?? {});
      for (const v of versionKeys) {
        expect(v, driver.describe(
          'node-packs.md §"Versioning"',
          `version key "${v}" MUST match SemVer 2.0.0`,
        )).toMatch(SEMVER_RE);
      }
    }
  });
});

describe('pack-registry: keychain shape (when present)', () => {
  it('GET /v1/packs/{name}/-/keychain returns well-formed key entries when present', async () => {
    const probe = await probeRegistry();
    if (!probe.registryPresent) return;

    // Probe for any real pack to fetch its keychain. Skip if no packs.
    const search = await driver.get('/v1/packs/-/search?q=', { authenticated: false });
    if (search.status !== 200) return;
    const results = (search.json as { results?: Array<{ name?: unknown }> } | undefined)?.results;
    if (!Array.isArray(results) || results.length === 0) return;

    const first = results[0]?.name;
    if (typeof first !== 'string') return;

    const res = await driver.get(`/v1/packs/${encodeURIComponent(first)}/-/keychain`, {
      authenticated: false,
    });
    // 200 with `{keys: []}` and 404 are both spec-allowed (keychain is
    // optional; not every namespace publishes one).
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) return;

    const body = res.json as { keys?: unknown; namespace?: unknown } | undefined;
    expect(Array.isArray(body?.keys), driver.describe(
      'registry-operations.md §"Signing keychain"',
      'keychain response MUST carry a `keys` array',
    )).toBe(true);

    const keys = body?.keys as Array<Record<string, unknown>>;
    for (const key of keys) {
      expect(typeof key.kid, driver.describe(
        'registry-operations.md §"Signing keychain"',
        'each key MUST have a string `kid`',
      )).toBe('string');
      expect(typeof key.algorithm, driver.describe(
        'registry-operations.md §"Signing keychain"',
        'each key MUST have a string `algorithm`',
      )).toBe('string');
      expect(typeof key.publicKey, driver.describe(
        'registry-operations.md §"Signing keychain"',
        'each key MUST have a string `publicKey`',
      )).toBe('string');
    }
  });
});
