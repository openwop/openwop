/**
 * Connection-pack provider resolution — `connection-packs.md` §Manifest
 * clauses 6 + 8 (RFC 0095 §B.6/§B.8) — behavioral.
 *
 * Capability-gated on `capabilities.connections.packsSupported: true`
 * (soft-skips when unadvertised; hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`). Drives the host through the
 * `POST /v1/host/sample/connection-packs/{install,resolve}` test seams
 * (`host-sample-test-seams.md`); hosts that haven't wired the seams
 * soft-skip (404).
 *
 *   1. INSTALL + RESOLVE (§B.6) — installing the `connection-pack-github`
 *      fixture makes `provider: "github"` resolve with `source: "pack"`.
 *   2. UNRESOLVED (§B.6) — a provider with no installed pack and no
 *      built-in fails with `connection_provider_unresolved`.
 *   3. PRERELEASE CONFLICT (§B.6, SemVer §11) — an installed prerelease
 *      (`1.0.0-alpha.1`) does NOT outrank a built-in `1.0.0` (prerelease <
 *      release); the host MUST surface `connection_provider_conflict`
 *      rather than silently choosing.
 *   4. REJECTION ISOLATION (§B.8) — a rejected manifest (credential
 *      material) means NOT INSTALLED, nothing more: a subsequent valid
 *      install on the same host MUST still succeed (one bad pack never
 *      takes down the install path).
 *
 * @see spec/v1/connection-packs.md
 * @see spec/v1/host-sample-test-seams.md
 * @see RFCS/0095-connection-packs-portable-provider-definitions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE_PATH = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-github.json');

type Manifest = Record<string, unknown> & {
  provider: Record<string, unknown> & { id: string };
};

interface InstallResult {
  installed?: boolean;
  errors?: Array<{ code?: string; path?: string }>;
}

interface ResolveResult {
  resolved?: boolean;
  source?: 'pack' | 'builtin';
  version?: string;
  code?: string;
}

function fixture(): Manifest {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Manifest;
}

async function gate(): Promise<boolean> {
  const connections = await readCapabilityFamily<{ packsSupported?: boolean }>('connections');
  return behaviorGate('connections.packsSupported', connections?.packsSupported === true);
}

describe('connection-provider-resolution (RFC 0095 §B.6/§B.8)', () => {
  it('an installed pack resolves its provider id; an unknown provider is unresolved', async () => {
    if (!(await gate())) return;

    const install = await driver.post('/v1/host/sample/connection-packs/install', { manifest: fixture() });
    if (install.status === 404 || install.status === 403) return; // seam unwired — soft-skip
    const installed = install.json as InstallResult | undefined;
    expect(
      installed?.installed,
      driver.describe('connection-packs.md §Manifest clause 1', 'a well-formed connection pack MUST install'),
    ).toBe(true);

    const hit = await driver.post('/v1/host/sample/connection-packs/resolve', { provider: 'github' });
    const resolved = hit.json as ResolveResult | undefined;
    expect(
      resolved?.resolved,
      driver.describe('connection-packs.md §Manifest clause 6', 'provider "github" MUST resolve against the installed pack whose provider.id matches'),
    ).toBe(true);
    expect(
      resolved?.source,
      driver.describe('connection-packs.md §Manifest clause 6', 'the installed pack is the resolution source'),
    ).toBe('pack');

    const miss = await driver.post('/v1/host/sample/connection-packs/resolve', {
      provider: 'conformance-nonexistent-provider-xyz',
    });
    const unresolved = miss.json as ResolveResult | undefined;
    expect(
      unresolved?.resolved,
      driver.describe('connection-packs.md §Manifest clause 6', 'a provider with no installed pack and no built-in MUST NOT resolve'),
    ).toBe(false);
    expect(
      unresolved?.code,
      driver.describe('connection-packs.md §Manifest clause 6', 'the refusal code MUST be connection_provider_unresolved'),
    ).toBe('connection_provider_unresolved');
  });

  it('an installed prerelease does not outrank a built-in release — conflict surfaces (SemVer §11)', async () => {
    if (!(await gate())) return;

    const prerelease = { ...fixture(), version: '1.0.0-alpha.1' };
    prerelease.provider = { ...prerelease.provider, id: 'conformance-prerelease-probe' };
    const install = await driver.post('/v1/host/sample/connection-packs/install', { manifest: prerelease });
    if (install.status === 404 || install.status === 403) return; // seam unwired — soft-skip
    expect(
      (install.json as InstallResult | undefined)?.installed,
      driver.describe('connection-packs.md §Manifest clause 1', 'a prerelease-versioned pack is shape-valid and MUST install'),
    ).toBe(true);

    const res = await driver.post('/v1/host/sample/connection-packs/resolve', {
      provider: 'conformance-prerelease-probe',
      simulateBuiltinVersion: '1.0.0',
    });
    if (res.status === 404 || res.status === 403) return; // simulate knob unwired — soft-skip
    const body = res.json as ResolveResult | undefined;
    expect(
      body?.code,
      driver.describe(
        'connection-packs.md §Manifest clause 6',
        'SemVer §11: 1.0.0-alpha.1 < 1.0.0 — the installed pack is NOT greater-or-equal, so the host MUST surface connection_provider_conflict rather than silently choosing',
      ),
    ).toBe('connection_provider_conflict');
  });

  it('rejection isolation: one rejected pack never takes down the install path (§B.8)', async () => {
    if (!(await gate())) return;

    const leaky = fixture();
    leaky.provider = { ...leaky.provider, id: 'conformance-isolation-probe' };
    (leaky.provider.auth as Record<string, unknown>).clientSecret = 'ghs_conformance_canary';
    const bad = await driver.post('/v1/host/sample/connection-packs/install', { manifest: leaky });
    if (bad.status === 404 || bad.status === 403) return; // seam unwired — soft-skip
    expect(
      (bad.json as InstallResult | undefined)?.installed,
      driver.describe('connection-packs.md §Manifest clause 2', 'the credential-carrying manifest MUST NOT install'),
    ).toBe(false);

    const good = { ...fixture() };
    good.provider = { ...good.provider, id: 'conformance-isolation-survivor' };
    const after = await driver.post('/v1/host/sample/connection-packs/install', { manifest: good });
    expect(
      (after.json as InstallResult | undefined)?.installed,
      driver.describe(
        'connection-packs.md §Manifest clause 8',
        'a rejected pack means NOT INSTALLED — nothing more; a subsequent valid install MUST succeed',
      ),
    ).toBe(true);
  });
});
