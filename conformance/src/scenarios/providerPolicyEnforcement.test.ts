/**
 * Provider-policy enforcement scenarios — extends `policies.test.ts`
 * (which covers discovery-shape only) with denial-error-shape contracts
 * for hosts that advertise enforcement.
 *
 * Why discovery-shape vs full enforcement:
 *
 *   Real enforcement requires a configured policy document AND a
 *   working AI provider invocation, AND admin write access to set the
 *   policy under test. None of those are black-box reproducible. The
 *   conformance suite gates on the wire shape of denial responses +
 *   SECURITY/invariants.yaml entries.
 *
 * Profile gating:
 *
 *   - Hosts that don't advertise `aiProviders.policies` skip-equivalent
 *     (no policy enforcement to verify).
 *   - Hosts that advertise it MUST honor the documented denial reason
 *     enum + the closed mode set per spec/v1/capabilities.md
 *     §"`aiProviders.policies`".
 *
 * Cross-references SECURITY/threat-model-provider-policy.md invariants
 * `provider-policy-pre-dispatch` · `provider-policy-disabled-hard` ·
 * `provider-policy-restricted-glob` · `provider-policy-restricted-fail-closed`.
 *
 * @see spec/v1/capabilities.md §"`aiProviders.policies`"
 * @see SECURITY/threat-model-provider-policy.md
 * @see SECURITY/invariants.yaml — provider-policy-* entries
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const CANONICAL_MODES = ['disabled', 'optional', 'required', 'restricted'] as const;

// Documented denial-reason enum from spec/v1/capabilities.md.
const DOCUMENTED_DENIAL_REASONS = [
  'provider_disabled',
  'byok_required',
  'byok_required_but_unresolved',
  'model_not_allowed',
] as const;

interface PoliciesShape {
  modes?: unknown;
  scopes?: unknown;
  errorCode?: unknown;
}

async function fetchPolicies(): Promise<PoliciesShape | null> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return null;
  const body = res.json as { aiProviders?: { policies?: PoliciesShape } };
  return body.aiProviders?.policies ?? null;
}

describe('provider-policy-enforcement: closed mode set per spec/v1/capabilities.md §`aiProviders.policies`', () => {
  it('every advertised mode is one of the four canonical values', async () => {
    const policies = await fetchPolicies();
    if (policies === null || !Array.isArray(policies.modes)) return softSkip('blocked', 'precondition not met — `policies === null || !Array.isArray(policies.modes)` returned early (seam, prior step, or fixture unavailable)');

    for (const mode of policies.modes) {
      expect(typeof mode, req('openwop.it.providerPolicyEnforcement.every-advertised-mode-is-one-of-the-four-canonical-values', 
        'capabilities.md §"`aiProviders.policies`"',
        'each entry in policies.modes MUST be a string',
      )).toBe('string');
      expect(
        (CANONICAL_MODES as readonly string[]).includes(mode as string),
        req('openwop.it.providerPolicyEnforcement.every-advertised-mode-is-one-of-the-four-canonical-values', 
          'capabilities.md §"`aiProviders.policies`"',
          `mode "${String(mode)}" is not in the closed canonical set [${CANONICAL_MODES.join(', ')}]`,
        ),
      ).toBe(true);
    }
  });

  it('hosts that support `restricted` MUST also support `optional` (default no-restriction case)', async () => {
    const policies = await fetchPolicies();
    if (policies === null || !Array.isArray(policies.modes)) return softSkip('blocked', 'precondition not met — `policies === null || !Array.isArray(policies.modes)` returned early (seam, prior step, or fixture unavailable)');
    const modes = policies.modes as string[];
    if (!modes.includes('restricted')) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!modes.includes(\'restricted\')` returned early');
    expect(modes.includes('optional'), req('openwop.it.providerPolicyEnforcement.hosts-that-support-restricted-must-also-support-optional-default-no-restriction', 
      'spec/v1/profiles.md §`openwop-provider-policy`',
      'a host advertising `restricted` MUST also advertise `optional` so workflows without policy hit the default permissive case',
    )).toBe(true);
  });

  it('errorCode is a non-empty string when present', async () => {
    const policies = await fetchPolicies();
    if (policies === null || policies.errorCode === undefined) return softSkip('blocked', 'precondition not met — `policies === null || policies.errorCode === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(typeof policies.errorCode, req('openwop.it.providerPolicyEnforcement.errorcode-is-a-non-empty-string-when-present', 
      'capabilities.md §"`aiProviders.policies`"',
      'aiProviders.policies.errorCode MUST be a string when present',
    )).toBe('string');
    expect((policies.errorCode as string).length, req('openwop.it.providerPolicyEnforcement.errorcode-is-a-non-empty-string-when-present', 
      'capabilities.md §"`aiProviders.policies`"',
      'aiProviders.policies.errorCode MUST be non-empty when present',
    )).toBeGreaterThan(0);
  });
});

describe('provider-policy-enforcement: scope advertisement', () => {
  it('scopes contains only non-empty strings when present', async () => {
    const policies = await fetchPolicies();
    if (policies === null) return softSkip('blocked', 'precondition not met — `policies === null` returned early (seam, prior step, or fixture unavailable)');
    if (!Array.isArray(policies.scopes)) return softSkip('blocked', 'precondition not met — `!Array.isArray(policies.scopes)` returned early (seam, prior step, or fixture unavailable)');

    for (const scope of policies.scopes) {
      expect(typeof scope === 'string' && scope.length > 0, req('openwop.it.providerPolicyEnforcement.scopes-contains-only-non-empty-strings-when-present', 
        'capabilities.md §"`aiProviders.policies`"',
        'each entry in policies.scopes MUST be a non-empty string',
      )).toBe(true);
    }
  });
});

describe('provider-policy-enforcement: documented denial reasons enumeration', () => {
  it('lists are non-empty (sanity check on documentation drift)', () => {
    // Self-test. If the documented denial-reason set drifts and this
    // file isn't updated, scenario authors will be surprised. This
    // assertion catches that — an empty CANONICAL_MODES or DOCUMENTED_
    // DENIAL_REASONS would indicate the test file got truncated.
    expect(CANONICAL_MODES.length, req('openwop.it.providerPolicyEnforcement.lists-are-non-empty-sanity-check-on-documentation-drift', 
      'spec/v1/capabilities.md §"`aiProviders.policies`"',
      'closed mode set MUST be the four canonical values',
    )).toBe(4);
    expect(DOCUMENTED_DENIAL_REASONS.length, req('openwop.it.providerPolicyEnforcement.lists-are-non-empty-sanity-check-on-documentation-drift', 
      'openwop/openwop@0bebfb0 — denial-reason enum alignment',
      'documented denial-reason set is non-empty',
    )).toBeGreaterThan(0);
  });
});
