/**
 * Provider-policy scenarios — `capabilities.md` §"`aiProviders.policies`".
 *
 * Vendor-neutral discovery-shape contracts for the four-mode provider-
 * policy taxonomy (`disabled` / `optional` / `required` / `restricted`)
 * that hosts MAY advertise on `/.well-known/openwop`.
 *
 * Why these scenarios are discovery-shape only:
 *
 *   The four modes describe HOST-SIDE enforcement decisions. A round-
 *   trip enforcement scenario (e.g., "configure a `disabled` policy for
 *   anthropic, then assert that an anthropic run is rejected with
 *   `provider_policy_denied`") requires a configured policy document
 *   AND a real provider call AND admin write access — far outside the
 *   black-box contract surface this suite asserts. Hosts MUST run their
 *   own integration tests for enforcement; the in-tree reference impl
 *   carries 31 such tests in `openwop-provider-policy-modes`.
 *
 *   What IS testable cross-implementation: the wire shape of the
 *   capability advertisement and the documented denial-error contract.
 *
 * Scenario gating:
 *
 *   - **Discovery shape contract** runs against every host. It verifies
 *     `aiProviders.policies` is well-formed when present and absent-
 *     friendly when omitted (hosts MAY skip the field entirely).
 *
 *   - **Mode-enum contract** runs against hosts that advertise
 *     `policies.modes`. Verifies every advertised mode is one of the
 *     four canonical values per the spec section.
 *
 * @see capabilities.md §"`aiProviders.policies`"
 * @see schemas/capabilities.schema.json — additive `policies` subtree
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const CANONICAL_MODES = ['disabled', 'optional', 'required', 'restricted'] as const;

interface PoliciesShape {
  modes?: unknown;
  scopes?: unknown;
  errorCode?: unknown;
}

interface AiProvidersShape {
  supported?: unknown;
  byok?: unknown;
  policies?: PoliciesShape;
}

async function fetchAiProviders(): Promise<AiProvidersShape | undefined> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  expect(res.status).toBe(200);
  const body = res.json as { aiProviders?: AiProvidersShape } | undefined;
  return body?.aiProviders;
}

describe('policies: /.well-known/openwop aiProviders.policies shape contract', () => {
  it('aiProviders.policies is well-formed when present (or absent — both spec-allowed)', async () => {
    const ap = await fetchAiProviders();
    if (ap === undefined) return softSkip('blocked', 'precondition not met — `ap === undefined` returned early (Optional v1 field — hosts MAY omit aiProviders entirely.) (seam, prior step, or fixture unavailable)'); // Optional v1 field — hosts MAY omit aiProviders entirely.

    const policies = ap.policies;
    if (policies === undefined) {
      // Spec-allowed: omitting `policies` means the host implements no
      // enforcement. Clients see only `optional` semantics. Nothing
      // further to assert.
      return softSkip('blocked', 'precondition not met — `policies === undefined` returned early (Spec-allowed: omitting `policies` means the host implements no enforcement. Clients see only `optional` semantics. Nothing further to assert.) (seam, pri…');
    }

    expect(typeof policies, req('openwop.it.policies.aiproviders-policies-is-well-formed-when-present-or-absent-both-spec-allowed', 
      'capabilities.md §"`aiProviders.policies`"',
      'aiProviders.policies MUST be an object when present',
    )).toBe('object');
    expect(policies, req('openwop.it.policies.aiproviders-policies-is-well-formed-when-present-or-absent-both-spec-allowed', 
      'capabilities.md §"`aiProviders.policies`"',
      'aiProviders.policies MUST NOT be null when present',
    )).not.toBeNull();
  });

  it('policies.modes — every advertised mode is one of the four canonical values', async () => {
    const ap = await fetchAiProviders();
    const modes = ap?.policies?.modes;
    if (modes === undefined) return softSkip('blocked', 'precondition not met — `modes === undefined` returned early (seam, prior step, or fixture unavailable)');

    expect(Array.isArray(modes), req('openwop.it.policies.policies-modes-every-advertised-mode-is-one-of-the-four-canonical-values', 
      'capabilities.md §"`aiProviders.policies`"',
      'policies.modes MUST be a string[] when present',
    )).toBe(true);

    const arr = modes as unknown[];
    for (const mode of arr) {
      expect(typeof mode, req('openwop.it.policies.policies-modes-every-advertised-mode-is-one-of-the-four-canonical-values', 
        'capabilities.md §"`aiProviders.policies`"',
        'policies.modes entries MUST be strings',
      )).toBe('string');
      expect(CANONICAL_MODES, req('openwop.it.policies.policies-modes-every-advertised-mode-is-one-of-the-four-canonical-values', 
        'capabilities.md §"`aiProviders.policies`"',
        `mode "${mode}" MUST be one of ${CANONICAL_MODES.join(', ')}`,
      )).toContain(mode);
    }
  });

  it('policies.modes — no duplicate entries (uniqueItems contract)', async () => {
    const ap = await fetchAiProviders();
    const modes = ap?.policies?.modes;
    if (!Array.isArray(modes)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!Array.isArray(modes)` returned early');

    const arr = modes as string[];
    const set = new Set(arr);
    expect(set.size, req('openwop.it.policies.policies-modes-no-duplicate-entries-uniqueitems-contract', 
      'capabilities.schema.json — policies.modes uniqueItems: true',
      'policies.modes MUST NOT contain duplicate entries',
    )).toBe(arr.length);
  });

  it('policies.scopes — string[] of non-empty entries when present', async () => {
    const ap = await fetchAiProviders();
    const scopes = ap?.policies?.scopes;
    if (scopes === undefined) return softSkip('blocked', 'precondition not met — `scopes === undefined` returned early (seam, prior step, or fixture unavailable)');

    expect(Array.isArray(scopes), req('openwop.it.policies.policies-scopes-string-of-non-empty-entries-when-present', 
      'capabilities.md §"`aiProviders.policies`"',
      'policies.scopes MUST be a string[] when present',
    )).toBe(true);

    const arr = scopes as unknown[];
    for (const scope of arr) {
      expect(typeof scope, req('openwop.it.policies.policies-scopes-string-of-non-empty-entries-when-present', 
        'capabilities.md §"`aiProviders.policies`"',
        'policies.scopes entries MUST be strings',
      )).toBe('string');
      expect((scope as string).length, req('openwop.it.policies.policies-scopes-string-of-non-empty-entries-when-present', 
        'capabilities.md §"`aiProviders.policies`"',
        'policies.scopes entries MUST be non-empty',
      )).toBeGreaterThan(0);
    }

    const set = new Set(arr as string[]);
    expect(set.size, req('openwop.it.policies.policies-scopes-string-of-non-empty-entries-when-present', 
      'capabilities.schema.json — policies.scopes uniqueItems: true',
      'policies.scopes MUST NOT contain duplicate entries',
    )).toBe(arr.length);
  });

  it('policies.errorCode — non-empty string when present (defaults to provider_policy_denied)', async () => {
    const ap = await fetchAiProviders();
    const errorCode = ap?.policies?.errorCode;
    if (errorCode === undefined) return softSkip('blocked', 'precondition not met — `errorCode === undefined` returned early (seam, prior step, or fixture unavailable)');

    expect(typeof errorCode, req('openwop.it.policies.policies-errorcode-non-empty-string-when-present-defaults-to-provider-policy-den', 
      'capabilities.md §"`aiProviders.policies`"',
      'policies.errorCode MUST be a string when present',
    )).toBe('string');
    expect((errorCode as string).length, req('openwop.it.policies.policies-errorcode-non-empty-string-when-present-defaults-to-provider-policy-den', 
      'capabilities.md §"`aiProviders.policies`"',
      'policies.errorCode MUST be non-empty when present',
    )).toBeGreaterThan(0);
  });
});
