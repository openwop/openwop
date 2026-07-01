/**
 * Subscription-reuse provider auth mode (RFC 0121, `Active`).
 *
 * Verifies the `subscription` value of `capabilities.aiProviders.authModes` —
 * a credential supplied by reusing the caller's existing personal, non-metered
 * consumer subscription (e.g. Claude Pro/Max, ChatGPT Plus) rather than a
 * metered API key.
 *
 * Two assertion tiers (mirroring RFC 0108's shape/honesty split):
 *   1. Schema shape (always-on, server-free) — the `aiProviders.authModes`
 *      closed enum includes `"subscription"`.
 *   2. Advertisement-gated:
 *      - §B.7 (cross-field, gated on the live discovery doc advertising a
 *        `subscription` provider): a `subscription` provider MUST appear in
 *        `aiProviders.byok` (it is a BYOK path).
 *      - §B.8 (behavioral, `OPENWOP_REQUIRE_BEHAVIOR=true`): an attempt to bind
 *        a `subscription`-mode credential at `tenant`/`workspace` scope MUST be
 *        rejected with the canonical `credential_scope_forbidden` error — the
 *        `subscription-credential-user-scope-only` SECURITY invariant. Driven
 *        against the documented host-sample seam
 *        `POST /v1/host/sample/credentials/bind` (soft-skips on 404 so a host
 *        that has not wired the seam is not penalized).
 *
 * Hosts that omit `subscription` from every provider's `authModes` skip the
 * gated tiers cleanly — advertisement is the gate.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md §"aiProviders.authModes — BYOK auth-mode contract"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0121-subscription-provider-auth.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

/** Server-free assertion-message helper. */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

/** Read the canonical error code from a response body (tolerant of
 *  `{error}` / `{code}` / `{error:{code}}` shapes). */
function errCode(json: unknown): string | undefined {
  const j = json as { error?: unknown; code?: unknown };
  if (typeof j?.code === 'string') return j.code;
  if (typeof j?.error === 'string') return j.error;
  const e = j?.error as { code?: unknown } | undefined;
  if (e && typeof e.code === 'string') return e.code;
  return undefined;
}

interface AiProviders {
  supported?: string[];
  byok?: string[];
  authModes?: Record<string, string[]>;
}

const SEAM = '/v1/host/sample/credentials/bind';

describe('aiproviders-subscription-scope: schema shape (RFC 0121, server-free)', () => {
  it('the aiProviders.authModes enum includes "subscription"', () => {
    const caps = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
      .aiProviders;
    const authModes = aiProviders?.properties?.authModes as
      | { additionalProperties?: { items?: { enum?: string[] } } }
      | undefined;
    expect(
      authModes?.additionalProperties?.items?.enum,
      why('capabilities.md §aiProviders.authModes', 'the authModes enum MUST include "subscription" (RFC 0121)'),
    ).toContain('subscription');
  });
});

describe('aiproviders-subscription-scope: advertisement-gated (RFC 0121 §B.7/§B.8)', () => {
  it('a subscription provider is in byok (§B.7) and rejects tenant-scope binding (§B.8)', async () => {
    const ai = await readCapabilityFamily<AiProviders>('aiProviders');
    const authModes = ai?.authModes ?? {};
    const subProviders = Object.entries(authModes)
      .filter(([, modes]) => Array.isArray(modes) && modes.includes('subscription'))
      .map(([provider]) => provider);

    if (!behaviorGate('openwop-subscription-auth', subProviders.length > 0)) return;

    // §B.7 — every subscription provider is a BYOK path and MUST appear in byok.
    const byok = new Set(ai?.byok ?? []);
    for (const provider of subProviders) {
      expect(
        byok.has(provider),
        driver.describe('RFC 0121 §B.7', `subscription provider '${provider}' MUST appear in aiProviders.byok`),
      ).toBe(true);
    }

    // §B.8 — a tenant-scope binding of a subscription credential MUST be
    // rejected with `credential_scope_forbidden` (user-scope-only invariant).
    const provider = subProviders[0]!;
    const res = await driver.post(SEAM, { provider, mode: 'subscription', scope: 'tenant' });
    if (res.status === 404) return; // seam unwired — soft-skip the behavioral leg

    expect(
      res.status >= 400,
      driver.describe(
        'RFC 0121 §B.8',
        `binding a subscription credential at tenant scope MUST be rejected (got HTTP ${res.status})`,
      ),
    ).toBe(true);
    expect(
      errCode(res.json),
      driver.describe(
        'RFC 0121 §B.8',
        'a rejected tenant-scope subscription binding MUST carry the canonical `credential_scope_forbidden` error code',
      ),
    ).toBe('credential_scope_forbidden');
  });
});
