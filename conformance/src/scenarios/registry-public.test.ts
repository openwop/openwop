/**
 * Public-registry availability scenario — `packs.openwop.dev`.
 *
 * Unlike `pack-registry.test.ts` (which probes the host-under-test for an
 * optional in-host registry), this scenario hits the *public, hosted*
 * registry at `packs.openwop.dev` directly. Its purpose is to provide a
 * single mechanical check that the public registry is up, serves the four
 * documented endpoint shapes, and returns valid manifests for the
 * spec-canonical packs currently published.
 *
 * Gating:
 *   This scenario is skipped by default — `@openwop/openwop-conformance`
 *   runs MUST NOT require outbound connectivity to `packs.openwop.dev`.
 *   Opt-in via `OPENWOP_TEST_PUBLIC_REGISTRY=true`.
 *
 * Why this lives in the conformance suite even though it's not a host
 * conformance scenario:
 *   - It provides a one-command public-registry healthcheck for the
 *     project's own operations.
 *   - It documents (via assertions) the contract `packs.openwop.dev`
 *     promises to serve.
 *   - It reuses the same vitest scaffolding as the rest of the suite.
 *
 * @see spec/v1/registry-operations.md
 * @see ROADMAP.md §"Hosted infrastructure"
 */

import { describe, it, expect } from 'vitest';

const REGISTRY_BASE = 'https://packs.openwop.dev';
const ENABLED = process.env.OPENWOP_TEST_PUBLIC_REGISTRY === 'true';

const PACK_NAME_RE = /^(core|vendor|community|private)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function get(path: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${REGISTRY_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  let json: unknown = undefined;
  try {
    json = await res.json();
  } catch {
    // body may not be JSON (e.g. tarball); caller handles.
  }
  return { status: res.status, json };
}

describe('registry-public: packs.openwop.dev discovery document', () => {
  it('GET /.well-known/openwop-registry returns a valid discovery payload', async () => {
    if (!ENABLED) {
      // eslint-disable-next-line no-console
      console.warn(
        '[registry-public] skipped — set OPENWOP_TEST_PUBLIC_REGISTRY=true to enable',
      );
      return;
    }

    const res = await get('/.well-known/openwop-registry');
    expect(res.status).toBe(200);

    const body = res.json as {
      registryVersion?: string;
      protocolVersion?: string;
      url?: string;
      supportedNamespaces?: string[];
      supportedSigningMethods?: string[];
      endpoints?: Record<string, string>;
    };

    expect(body.registryVersion).toBe('1.0.0');
    expect(body.protocolVersion).toBe('1.0');
    expect(typeof body.url).toBe('string');
    expect(Array.isArray(body.supportedNamespaces)).toBe(true);
    expect(body.supportedNamespaces).toEqual(
      expect.arrayContaining(['core', 'vendor', 'community']),
    );
    expect(Array.isArray(body.supportedSigningMethods)).toBe(true);
    expect(body.supportedSigningMethods).toEqual(expect.arrayContaining(['ed25519']));

    // The four canonical endpoint shapes from registry-operations.md
    // (filesystem-backed registries serve packMetadata at a file path; see endpointAliases note).
    expect(typeof body.endpoints?.registryIndex).toBe('string');
    expect(typeof body.endpoints?.packMetadata).toBe('string');
    expect(typeof body.endpoints?.versionManifest).toBe('string');
    expect(typeof body.endpoints?.versionTarball).toBe('string');
  });
});

describe('registry-public: packs.openwop.dev index', () => {
  it('GET /v1/index.json returns a non-empty pack list with valid name + version shapes', async () => {
    if (!ENABLED) return;

    const res = await get('/v1/index.json');
    expect(res.status).toBe(200);

    const body = res.json as {
      packs?: Array<{ name?: string; latestVersion?: string }>;
      generated?: string;
    };

    expect(Array.isArray(body.packs)).toBe(true);
    expect(body.packs?.length ?? 0).toBeGreaterThan(0);

    for (const p of body.packs ?? []) {
      expect(p.name, `pack name must match reverse-DNS pattern: ${p.name}`).toMatch(PACK_NAME_RE);
      expect(p.latestVersion, `pack version must be semver: ${p.latestVersion}`).toMatch(SEMVER_RE);
    }
  });
});

describe('registry-public: spec-canonical pack manifests resolve', () => {
  const KNOWN_PACKS = [
    { name: 'core.openwop.examples', version: '1.0.0' },
    { name: 'community.openwop-team.demo', version: '0.1.0' },
    { name: 'vendor.openwop.rust-hello', version: '1.0.0' },
  ];

  for (const { name, version } of KNOWN_PACKS) {
    it(`GET /v1/packs/${name}/-/${version}.json returns a valid manifest`, async () => {
      if (!ENABLED) return;

      const res = await get(`/v1/packs/${name}/-/${version}.json`);
      expect(res.status).toBe(200);

      const manifest = res.json as { name?: string; version?: string };
      expect(manifest.name).toBe(name);
      expect(manifest.version).toBe(version);
    });
  }
});
