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
import { softSkip } from '../lib/soft-skip.js';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

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
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!ENABLED` returned early');
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
    if (!ENABLED) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!ENABLED` returned early');

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
      if (!ENABLED) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!ENABLED` returned early');

      const res = await get(`/v1/packs/${name}/-/${version}.json`);
      expect(res.status).toBe(200);

      const manifest = res.json as { name?: string; version?: string };
      expect(manifest.name).toBe(name);
      expect(manifest.version).toBe(version);
    });
  }
});

describe('registry-public: tarball + signature + Ed25519 verify roundtrip', () => {
  // core.openwop.examples@1.0.0 is the canonical reference pack for this
  // check: published since the registry MVP, signed with the
  // `openwop-registry-root` key over the whole tarball (method='ed25519').
  // The same recipe applies to any pack at the registry; this scenario
  // exercises the worst-case full roundtrip so clients have a wire-level
  // contract for verifying packs before installing them.
  //
  // What gets asserted, in order:
  //   1. Version manifest, tarball, signature, and public key all 200.
  //   2. SRI integrity in the manifest matches a fresh sha256 of the
  //      tarball bytes — protects against tarball tampering between
  //      publish + retrieval.
  //   3. Detached Ed25519 signature verifies against the public key over
  //      the bytes the publisher signed (per signing.method).
  const PACK_NAME = 'core.openwop.examples';
  const PACK_VERSION = '1.0.0';

  async function getBinary(path: string): Promise<{ status: number; bytes: Buffer }> {
    const res = await fetch(`${REGISTRY_BASE}${path}`);
    const ab = await res.arrayBuffer();
    return { status: res.status, bytes: Buffer.from(ab) };
  }

  async function getText(path: string): Promise<{ status: number; body: string }> {
    const res = await fetch(`${REGISTRY_BASE}${path}`);
    const body = await res.text();
    return { status: res.status, body };
  }

  it(`tarball + sig + public key all retrievable, SRI matches, Ed25519 verifies for ${PACK_NAME}@${PACK_VERSION}`, async () => {
    if (!ENABLED) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!ENABLED` returned early');

    // 1. Manifest (JSON).
    const manifestRes = await get(`/v1/packs/${PACK_NAME}/-/${PACK_VERSION}.json`);
    expect(manifestRes.status).toBe(200);
    const manifest = manifestRes.json as {
      signing?: { method?: string; keyId?: string; publicKeyUrl?: string };
      integrity?: string;
    };
    expect(typeof manifest.signing?.method).toBe('string');
    expect(typeof manifest.signing?.keyId).toBe('string');
    expect(typeof manifest.integrity).toBe('string');

    // 2. Tarball.
    const tarball = await getBinary(`/v1/packs/${PACK_NAME}/-/${PACK_VERSION}.tgz`);
    expect(tarball.status, 'tarball MUST be retrievable').toBe(200);
    expect(tarball.bytes.byteLength, 'tarball MUST be non-empty').toBeGreaterThan(0);

    // 3. Detached signature (64-byte raw Ed25519).
    const sig = await getBinary(`/v1/packs/${PACK_NAME}/-/${PACK_VERSION}.sig`);
    expect(sig.status, 'signature MUST be retrievable').toBe(200);
    expect(sig.bytes.byteLength, 'Ed25519 detached signature MUST be 64 bytes').toBe(64);

    // 4. Public key — fetch from the publisher-declared URL when present,
    //    else fall back to the canonical `/keys/<keyId>.pub` shape.
    const keyUrl = manifest.signing!.publicKeyUrl ?? `/keys/${manifest.signing!.keyId}.pub`;
    const keyRes = await getText(keyUrl);
    expect(keyRes.status, `public key MUST be retrievable at ${keyUrl}`).toBe(200);
    const publicKey = createPublicKey(keyRes.body);

    // 5. SRI integrity check: `sha256-<base64>=` MUST match a fresh
    //    sha256 of the tarball bytes per registry-operations.md.
    expect(manifest.integrity).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    const expectedSri = `sha256-${createHash('sha256').update(tarball.bytes).digest('base64')}`;
    expect(expectedSri, 'SRI integrity in manifest MUST match a fresh sha256 of the tarball').toBe(
      manifest.integrity,
    );

    // 6. Ed25519 verification. Two canonical signing conventions per
    //    `node-packs.md` §"Signing recipe": `method=ed25519` signs the
    //    whole tarball; `method=manual` signs the pack.json bytes inside
    //    the tarball. core.openwop.examples uses `ed25519`.
    const method = manifest.signing!.method;
    expect(['ed25519', 'manual']).toContain(method);

    // For `ed25519` the signed bytes are the tarball; for `manual` the
    // signed bytes are pack.json extracted from the tarball. This
    // scenario picks `core.openwop.examples` specifically because it's
    // `method=ed25519` — the simpler path. Extending to `manual` would
    // require the tarball extractor from registry/scripts/verify-
    // signatures.mjs which is intentionally out of scope here.
    if (method !== 'ed25519') return softSkip('blocked', 'precondition not met — `method !== \'ed25519\'` returned early (seam, prior step, or fixture unavailable)');

    const verified = cryptoVerify(null, tarball.bytes, publicKey, sig.bytes);
    expect(verified, `Ed25519 signature over ${PACK_NAME}@${PACK_VERSION}.tgz MUST verify against ${manifest.signing!.keyId}`)
      .toBe(true);
  });
});
