import { describe, it, expect, vi } from 'vitest';
import { metadataPresent, v2ProfileIds, v2ProfileDerivable, v2RegistryAvailable, v2RegistryPath } from './v2-profiles.js';
import { profileDerivable } from './profiles.js';

// RFC 0169 §C.1 — the shape a real v2 host advertises.
const V2_DECLARATION = {
  protocolVersions: ['2.0'],
  preferredVersion: '2.0',
  interrupt: { supported: true },
  replay: { modes: ['replay'] },
  webhooks: { supported: true },
  idempotency: { supported: true },
  eventLog: { eventLogSchemaVersion: 3 },
};

// The v1 shape `isCore` was written for.
const V1_DISCOVERY = {
  protocolVersion: '1.11',
  supportedEnvelopes: ['clarification.request'],
  schemaVersions: {},
  limits: { clarificationRounds: 2, schemaRounds: 2, envelopesPerTurn: 2 },
};

describe('v2 profile derivation (RFC 0169 §C.1)', () => {
  it('resolves the registry in this layout', () => {
    // Every other row here is vacuous if the corpus file cannot be found, so
    // assert the anchor before asserting anything derived from it.
    expect(v2RegistryPath()).not.toBeNull();
    expect(v2RegistryAvailable()).toBe(true);
  });

  it('derives openwop-discovery-core from a v2 declaration', () => {
    expect(v2ProfileIds(V2_DECLARATION)).toContain('openwop-discovery-core');
    expect(v2ProfileDerivable(V2_DECLARATION, 'openwop-discovery-core')).toBe(true);
  });

  it('derives openwop-core-standard only when every listed family is present', () => {
    // The predicate is families: [interrupt, replay, webhooks, idempotency, eventLog].
    expect(v2ProfileIds(V2_DECLARATION)).toContain('openwop-core-standard');
    const { webhooks: _dropped, ...missingOneFamily } = V2_DECLARATION;
    expect(v2ProfileIds(missingOneFamily)).not.toContain('openwop-core-standard');
    // …and a family that is present but not a RECORD does not count. A host
    // advertising `webhooks: true` has answered a different question.
    expect(v2ProfileIds({ ...V2_DECLARATION, webhooks: true })).not.toContain('openwop-core-standard');
  });

  // 2.46.2: the seams predicate is `conformance.seamsProfile`, not the bare
  // `conformance` key. openwop-app publishes `conformance.certificationBundleUrl`
  // with no seam mounted, and the bare key derived (and certified) the profile.
  it('derives openwop-conformance-seams-v2 from conformance.seamsProfile, not from the conformance block', () => {
    const SEAMS = 'openwop-conformance-seams-v2';
    expect(v2ProfileIds(V2_DECLARATION)).not.toContain(SEAMS);
    expect(v2ProfileIds({ ...V2_DECLARATION, conformance: { certificationBundleUrl: 'https://host.example/bundle' } })).not.toContain(SEAMS);
    expect(v2ProfileIds({ ...V2_DECLARATION, conformance: { mockAgent: true } })).not.toContain(SEAMS);
    expect(v2ProfileIds({ ...V2_DECLARATION, conformance: { seamsProfile: SEAMS } })).toContain(SEAMS);
    expect(v2ProfileIds({ ...V2_DECLARATION, conformance: { seamsProfile: SEAMS, certificationBundleUrl: 'https://host.example/bundle' } })).toContain(SEAMS);
  });

  it('metadataPresent reads a key or one member of it', () => {
    expect(metadataPresent({ preferredVersion: '2.0' }, 'preferredVersion')).toBe(true);
    expect(metadataPresent({}, 'preferredVersion')).toBe(false);
    expect(metadataPresent({ conformance: { seamsProfile: 'x' } }, 'conformance.seamsProfile')).toBe(true);
    expect(metadataPresent({ conformance: {} }, 'conformance.seamsProfile')).toBe(false);
    expect(metadataPresent({ conformance: 'seamsProfile' }, 'conformance.seamsProfile')).toBe(false);
    expect(metadataPresent({ conformance: ['seamsProfile'] }, 'conformance.seamsProfile')).toBe(false);
  });

  it('does not derive a v2 profile from a v1 discovery payload', () => {
    expect(v2ProfileIds(V1_DISCOVERY)).toEqual([]);
  });

  // The defect this module exists to close. `profileDerivable` used to have no
  // major at all and always answered from the v1 catalog, so a v2 host's own
  // declaration derived NOTHING and its bundle was refused as though the host
  // had not advertised the profile it advertised.
  it('profileDerivable dispatches on the target major', () => {
    expect(profileDerivable(V2_DECLARATION, 'openwop-discovery-core', 2)).toBe(true);
    expect(profileDerivable(V2_DECLARATION, 'openwop-discovery-core', 1)).toBe(false);
    expect(profileDerivable(V1_DISCOVERY, 'openwop-discovery-core', 1)).toBe(true);
    expect(profileDerivable(V1_DISCOVERY, 'openwop-discovery-core', 2)).toBe(false);
  });

  it('defaults to major 1, so every v1-era call site is unchanged', () => {
    expect(profileDerivable(V1_DISCOVERY, 'openwop-discovery-core')).toBe(true);
    expect(profileDerivable(V2_DECLARATION, 'openwop-discovery-core')).toBe(false);
  });
});

describe('v2 profile derivation — an unreadable registry is not an empty one', () => {
  // `null` vs `[]` is the whole reason `v2ProfileIds` has a nullable return.
  // `[]` would make every profile underivable and let the v3 verifier refuse a
  // host because OUR corpus file is missing — a fact about the suite's layout
  // spent as a verdict about the host, which `conformance.md` §"Whose fact is
  // the reason?" forbids. The verifier reads the null and records the gap.
  it('reports null, not [], when the layout has no v2 corpus', async () => {
    vi.resetModules();
    vi.doMock('./paths.js', () => ({ SPEC_V2_DIR: null }));
    const mod = await import('./v2-profiles.js');
    expect(mod.v2RegistryPath()).toBeNull();
    expect(mod.v2RegistryAvailable()).toBe(false);
    expect(mod.v2ProfileIds(V2_DECLARATION)).toBeNull();
    // The boolean helper still says false — callers that must tell the two
    // apart ask `v2RegistryAvailable` first, which is exactly what the v3
    // verifier does before it spends a rejection.
    expect(mod.v2ProfileDerivable(V2_DECLARATION, 'openwop-discovery-core')).toBe(false);
    vi.doUnmock('./paths.js');
    vi.resetModules();
  });
});
