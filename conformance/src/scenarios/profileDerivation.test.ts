/**
 * Profile-derivation scenarios — verify that `deriveProfiles()`
 * produces the correct profile set for representative discovery
 * payloads.
 *
 * Server-free. Runs against fixture payloads, not a live host. The
 * derivation MUST be deterministic and pure (per spec/v1/profiles.md
 * §"Derivation"); these scenarios are the proof of that property.
 *
 * A separate runtime check would derive the profile set from the live
 * `/.well-known/openwop` response; that's covered piecemeal by
 * `discovery.test.ts` and the per-profile runtime suites
 * (`stream-modes*.test.ts`, `pack-registry*.test.ts`, etc.).
 */

import { describe, it, expect } from 'vitest';
import {
  deriveProfiles,
  hasProfile,
  isCore,
  isInterrupts,
  isSecrets,
  isProviderPolicy,
  isFixtures,
  type DiscoveryPayload,
  type ProfileName,
} from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

/**
 * Minimum payload that satisfies `openwop-core`. Other fixtures extend this.
 */
const CORE_PAYLOAD: DiscoveryPayload = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['prd.create'],
  schemaVersions: { 'prd.create': 1 },
  limits: {
    clarificationRounds: 3,
    schemaRounds: 2,
    envelopesPerTurn: 5,
  },
};

describe('profiles: openwop-core predicate per spec/v1/profiles.md §`openwop-core`', () => {
  it('accepts the minimum-conforming payload', () => {
    expect(isCore(CORE_PAYLOAD), req('openwop.it.profileDerivation.accepts-the-minimum-conforming-payload', 'spec/v1/profiles.md', 'accepts the minimum-conforming payload')).toBe(true);
  });

  it('rejects payload without protocolVersion', () => {
    const { protocolVersion: _omit, ...rest } = CORE_PAYLOAD;
    expect(isCore(rest as DiscoveryPayload), req('openwop.it.profileDerivation.rejects-payload-without-protocolversion', 'spec/v1/profiles.md', 'rejects payload without protocolVersion')).toBe(false);
  });

  it('rejects v2.x protocolVersion', () => {
    expect(isCore({ ...CORE_PAYLOAD, protocolVersion: '2.0.0' }), req('openwop.it.profileDerivation.rejects-v2-x-protocolversion', 'spec/v1/profiles.md', 'rejects v2.x protocolVersion')).toBe(false);
  });

  it('rejects negative limits (RFC 2119 MUST: non-negative integers)', () => {
    expect(
      isCore({
        ...CORE_PAYLOAD,
        limits: { ...CORE_PAYLOAD.limits!, clarificationRounds: -1 },
      }), req('openwop.it.profileDerivation.rejects-negative-limits-rfc-2119-must-non-negative-integers', 'RFC 2119', 'rejects negative limits (RFC 2119 MUST: non-negative integers)'),
    ).toBe(false);
  });

  it('rejects fractional limits', () => {
    expect(
      isCore({
        ...CORE_PAYLOAD,
        limits: { ...CORE_PAYLOAD.limits!, schemaRounds: 1.5 },
      }), req('openwop.it.profileDerivation.rejects-fractional-limits', 'spec/v1/profiles.md', 'rejects fractional limits'),
    ).toBe(false);
  });

  it('accepts empty supportedEnvelopes array (engine-only host)', () => {
    expect(isCore({ ...CORE_PAYLOAD, supportedEnvelopes: [] }), req('openwop.it.profileDerivation.accepts-empty-supportedenvelopes-array-engine-only-host', 'spec/v1/profiles.md', 'accepts empty supportedEnvelopes array (engine-only host)')).toBe(true);
  });

  it('rejects non-array supportedEnvelopes', () => {
    expect(
      isCore({ ...CORE_PAYLOAD, supportedEnvelopes: 'prd.create' as unknown as string[] }), req('openwop.it.profileDerivation.rejects-non-array-supportedenvelopes', 'spec/v1/profiles.md', 'rejects non-array supportedEnvelopes'),
    ).toBe(false);
  });
});

describe('profiles: openwop-interrupts predicate per spec/v1/profiles.md §`openwop-interrupts`', () => {
  it('passes when clarification.request is in supportedEnvelopes', () => {
    expect(
      isInterrupts({
        ...CORE_PAYLOAD,
        supportedEnvelopes: ['prd.create', 'clarification.request'],
      }), req('openwop.it.profileDerivation.passes-when-clarification-request-is-in-supportedenvelopes', 'spec/v1/profiles.md', 'passes when clarification.request is in supportedEnvelopes'),
    ).toBe(true);
  });

  it('fails when clarification.request is absent (fire-and-forget host)', () => {
    expect(isInterrupts(CORE_PAYLOAD), req('openwop.it.profileDerivation.fails-when-clarification-request-is-absent-fire-and-forget-host', 'spec/v1/profiles.md', 'fails when clarification.request is absent (fire-and-forget host)')).toBe(false);
  });

  it('implies openwop-core', () => {
    const broken = {
      ...CORE_PAYLOAD,
      protocolVersion: '2.0.0',
      supportedEnvelopes: ['clarification.request'],
    };
    expect(isInterrupts(broken), req('openwop.it.profileDerivation.implies-openwop-core', 'spec/v1/profiles.md', 'implies openwop-core')).toBe(false);
  });
});

describe('profiles: openwop-secrets predicate per spec/v1/profiles.md §`openwop-secrets`', () => {
  it('passes when secrets.supported=true and scopes includes user', () => {
    expect(
      isSecrets({
        ...CORE_PAYLOAD,
        secrets: { supported: true, scopes: ['user'] },
      }), req('openwop.it.profileDerivation.passes-when-secrets-supported-true-and-scopes-includes-user', 'spec/v1/profiles.md', 'passes when secrets.supported=true and scopes includes user'),
    ).toBe(true);
  });

  it('passes with multiple scopes', () => {
    expect(
      isSecrets({
        ...CORE_PAYLOAD,
        secrets: { supported: true, scopes: ['user', 'tenant'] },
      }), req('openwop.it.profileDerivation.passes-with-multiple-scopes', 'spec/v1/profiles.md', 'passes with multiple scopes'),
    ).toBe(true);
  });

  it('fails when scopes omits user', () => {
    expect(
      isSecrets({
        ...CORE_PAYLOAD,
        secrets: { supported: true, scopes: ['tenant'] },
      }), req('openwop.it.profileDerivation.fails-when-scopes-omits-user', 'spec/v1/profiles.md', 'fails when scopes omits user'),
    ).toBe(false);
  });

  it('fails when secrets.supported=false', () => {
    expect(
      isSecrets({
        ...CORE_PAYLOAD,
        secrets: { supported: false, scopes: ['user'] },
      }), req('openwop.it.profileDerivation.fails-when-secrets-supported-false', 'spec/v1/profiles.md', 'fails when secrets.supported=false'),
    ).toBe(false);
  });

  it('fails when secrets field is absent', () => {
    expect(isSecrets(CORE_PAYLOAD), req('openwop.it.profileDerivation.fails-when-secrets-field-is-absent', 'spec/v1/profiles.md', 'fails when secrets field is absent')).toBe(false);
  });
});

describe('profiles: openwop-provider-policy predicate per spec/v1/profiles.md §`openwop-provider-policy`', () => {
  it('passes when policies.modes contains optional', () => {
    expect(
      isProviderPolicy({
        ...CORE_PAYLOAD,
        aiProviders: {
          supported: ['anthropic'],
          policies: { modes: ['optional', 'required'] },
        },
      }), req('openwop.it.profileDerivation.passes-when-policies-modes-contains-optional', 'spec/v1/profiles.md', 'passes when policies.modes contains optional'),
    ).toBe(true);
  });

  it('fails when policies.modes is empty (per spec: empty {} not a valid third state)', () => {
    expect(
      isProviderPolicy({
        ...CORE_PAYLOAD,
        aiProviders: {
          supported: ['anthropic'],
          policies: { modes: [] },
        },
      }), req('openwop.it.profileDerivation.fails-when-policies-modes-is-empty-per-spec-empty-not-a-valid-third-state', 'spec/v1/profiles.md', 'fails when policies.modes is empty (per spec: empty {} not a valid third state)'),
    ).toBe(false);
  });

  it('fails when policies.modes omits optional (cannot satisfy default-no-restriction case)', () => {
    expect(
      isProviderPolicy({
        ...CORE_PAYLOAD,
        aiProviders: {
          supported: ['anthropic'],
          policies: { modes: ['required'] },
        },
      }), req('openwop.it.profileDerivation.fails-when-policies-modes-omits-optional-cannot-satisfy-default-no-restriction-c', 'spec/v1/profiles.md', 'fails when policies.modes omits optional (cannot satisfy default-no-restriction case)'),
    ).toBe(false);
  });

  it('fails when policies field is absent', () => {
    expect(
      isProviderPolicy({
        ...CORE_PAYLOAD,
        aiProviders: { supported: ['anthropic'] },
      }), req('openwop.it.profileDerivation.fails-when-policies-field-is-absent', 'spec/v1/profiles.md', 'fails when policies field is absent'),
    ).toBe(false);
  });
});

describe('profiles: openwop-fixtures predicate per spec/v1/profiles.md §`openwop-fixtures` (RFC 0003)', () => {
  it('rejects payloads missing `fixtures`', () => {
    expect(isFixtures(CORE_PAYLOAD), req('openwop.it.profileDerivation.rejects-payloads-missing-fixtures', 'spec/v1/profiles.md', 'rejects payloads missing `fixtures`')).toBe(false);
  });

  it('rejects empty `fixtures` array', () => {
    expect(isFixtures({ ...CORE_PAYLOAD, fixtures: [] }), req('openwop.it.profileDerivation.rejects-empty-fixtures-array', 'spec/v1/profiles.md', 'rejects empty `fixtures` array')).toBe(false);
  });

  it('accepts non-empty string array', () => {
    expect(
      isFixtures({ ...CORE_PAYLOAD, fixtures: ['conformance-noop'] }), req('openwop.it.profileDerivation.accepts-non-empty-string-array', 'spec/v1/profiles.md', 'accepts non-empty string array'),
    ).toBe(true);
  });

  it('accepts vendor-prefixed fixture ids', () => {
    expect(
      isFixtures({
        ...CORE_PAYLOAD,
        fixtures: ['conformance-noop', 'openwop.smoke.byok'],
      }), req('openwop.it.profileDerivation.accepts-vendor-prefixed-fixture-ids', 'spec/v1/profiles.md', 'accepts vendor-prefixed fixture ids'),
    ).toBe(true);
  });

  it('rejects array with empty-string entries', () => {
    expect(isFixtures({ ...CORE_PAYLOAD, fixtures: ['', 'conformance-noop'] }), req('openwop.it.profileDerivation.rejects-array-with-empty-string-entries', 'spec/v1/profiles.md', 'rejects array with empty-string entries')).toBe(false);
  });

  it('rejects non-array `fixtures`', () => {
    expect(isFixtures({ ...CORE_PAYLOAD, fixtures: 'conformance-noop' }), req('openwop.it.profileDerivation.rejects-non-array-fixtures', 'spec/v1/profiles.md', 'rejects non-array `fixtures`')).toBe(false);
    expect(
      isFixtures({ ...CORE_PAYLOAD, fixtures: { 'conformance-noop': true } }),
    ).toBe(false);
  });

  it('rejects array with non-string entries', () => {
    expect(
      isFixtures({ ...CORE_PAYLOAD, fixtures: ['conformance-noop', 42] as unknown[] }), req('openwop.it.profileDerivation.rejects-array-with-non-string-entries', 'spec/v1/profiles.md', 'rejects array with non-string entries'),
    ).toBe(false);
  });

  it('rejects when openwop-core fails (predicate is layered)', () => {
    expect(isFixtures({ fixtures: ['conformance-noop'] }), req('openwop.it.profileDerivation.rejects-when-openwop-core-fails-predicate-is-layered', 'spec/v1/profiles.md', 'rejects when openwop-core fails (predicate is layered)')).toBe(false);
  });
});

describe('profiles: deriveProfiles produces the full set', () => {
  it('returns openwop-core + stream-* + node-packs for the minimum payload', () => {
    // The minimum payload satisfies the structural profiles automatically:
    // openwop-core (predicate trivially), openwop-stream-sse + openwop-stream-poll
    // (no supportedTransports set => permitted), openwop-node-packs (discovery-
    // only predicate is openwop-core).
    const result = deriveProfiles(CORE_PAYLOAD);
    expect(result, req('openwop.it.profileDerivation.returns-openwop-core-stream-node-packs-for-the-minimum-payload', 'spec/v1/profiles.md', 'returns openwop-core + stream-* + node-packs for the minimum payload')).toContain('openwop-core');
    expect(result).toContain('openwop-stream-sse');
    expect(result).toContain('openwop-stream-poll');
    expect(result).toContain('openwop-node-packs');
    expect(result).not.toContain('openwop-interrupts');
    expect(result).not.toContain('openwop-secrets');
    expect(result).not.toContain('openwop-provider-policy');
  });

  it('returns the full set for a richly-advertised host', () => {
    const rich: DiscoveryPayload = {
      ...CORE_PAYLOAD,
      supportedEnvelopes: ['prd.create', 'clarification.request'],
      supportedTransports: ['rest', 'mcp'],
      secrets: { supported: true, scopes: ['user', 'tenant'] },
      aiProviders: {
        supported: ['anthropic', 'openai'],
        policies: { modes: ['optional', 'required', 'restricted'] },
      },
      fixtures: ['conformance-noop'],
    };
    const result = deriveProfiles(rich);
    const expected: ProfileName[] = [
      'openwop-discovery-core', // RFC 0155 §A canonical name
      'openwop-core', // deprecated alias — always beside the canonical name, never alone
      'openwop-interrupts',
      'openwop-stream-sse',
      'openwop-stream-poll',
      'openwop-secrets',
      'openwop-provider-policy',
      'openwop-node-packs',
      'openwop-fixtures',
    ];
    expect(result, req('openwop.it.profileDerivation.returns-the-full-set-for-a-richly-advertised-host', 'spec/v1/profiles.md', 'returns the full set for a richly-advertised host')).toEqual(expected);
  });

  it('returns stable order matching PROFILE_NAMES', () => {
    const rich: DiscoveryPayload = {
      ...CORE_PAYLOAD,
      supportedEnvelopes: ['clarification.request'],
      secrets: { supported: true, scopes: ['user'] },
    };
    const first = deriveProfiles(rich);
    const second = deriveProfiles(rich);
    expect(first, req('openwop.it.profileDerivation.returns-stable-order-matching-profile-names', 'spec/v1/profiles.md', 'returns stable order matching PROFILE_NAMES')).toEqual(second);
    // Specifically: openwop-interrupts before openwop-secrets even though openwop-secrets
    // was added to the payload "second."
    expect(first.indexOf('openwop-interrupts')).toBeLessThan(first.indexOf('openwop-secrets'));
  });

  it('returns empty for a non-conforming payload', () => {
    const broken: DiscoveryPayload = { protocolVersion: '0.9.0' };
    expect(deriveProfiles(broken), req('openwop.it.profileDerivation.returns-empty-for-a-non-conforming-payload', 'spec/v1/profiles.md', 'returns empty for a non-conforming payload')).toEqual([]);
  });

  it('is deterministic across calls (same input → same output)', () => {
    const calls = Array.from({ length: 10 }, () => deriveProfiles(CORE_PAYLOAD));
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i], req('openwop.it.profileDerivation.is-deterministic-across-calls-same-input-same-output', 'spec/v1/profiles.md', 'is deterministic across calls (same input → same output)')).toEqual(calls[0]);
    }
  });
});

describe('profiles: hasProfile is consistent with deriveProfiles', () => {
  it('membership matches the derived set for every profile', () => {
    const rich: DiscoveryPayload = {
      ...CORE_PAYLOAD,
      supportedEnvelopes: ['clarification.request'],
      secrets: { supported: true, scopes: ['user'] },
    };
    const derived = new Set(deriveProfiles(rich));
    for (const p of [
      'openwop-core',
      'openwop-interrupts',
      'openwop-stream-sse',
      'openwop-stream-poll',
      'openwop-secrets',
      'openwop-provider-policy',
      'openwop-node-packs',
      'openwop-fixtures',
    ] as const) {
      expect(hasProfile(rich, p), req('openwop.it.profileDerivation.membership-matches-the-derived-set-for-every-profile', 'spec/v1/profiles.md', 'membership matches the derived set for every profile')).toBe(derived.has(p));
    }
  });
});
