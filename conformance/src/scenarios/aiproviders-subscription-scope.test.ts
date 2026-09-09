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
 *   2. §B.7 in-byok (advertisement-gated): a `subscription` provider MUST appear
 *      in `aiProviders.byok` (it is a BYOK path). Gated on the live discovery doc
 *      advertising a `subscription` provider — a pure cross-field consistency check.
 *   3. §B.8 user-scope-only (bind-seam-gated): an attempt to bind a
 *      `subscription`-mode credential at `tenant`/`workspace` scope MUST be
 *      rejected with the canonical `credential_scope_forbidden` error — the
 *      `subscription-credential-user-scope-only` SECURITY invariant. Driven
 *      against the documented host-sample seam
 *      `POST /v1/host/sample/credentials/bind`, soft-skipping on 404.
 *
 * §B.8 is deliberately gated on the SEAM, not on live advertisement: the
 * user-scope-only guarantee is a property of the credential-binding path, so a
 * reference host that cannot lawfully advertise `subscription` (RFC 0121 §C / UQ1
 * — e.g. an ephemeral multi-instance deploy with no durable per-user login) can
 * still witness the safety rail. Hosts that wire neither the advertisement nor
 * the seam skip both gated tiers cleanly.
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
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
      req('openwop.it.aiproviders-subscription-scope.the-aiproviders-authmodes-enum-includes-subscription', 'capabilities.md §aiProviders.authModes', 'the authModes enum MUST include "subscription" (RFC 0121)'),
    ).toContain('subscription');
  });
});

describe('aiproviders-subscription-scope: §B.7 in-byok (advertisement-gated)', () => {
  it('every advertised subscription provider appears in aiProviders.byok', async () => {
    const ai = await readCapabilityFamily<AiProviders>('aiProviders');
    const authModes = ai?.authModes ?? {};
    const subProviders = Object.entries(authModes)
      .filter(([, modes]) => Array.isArray(modes) && modes.includes('subscription'))
      .map(([provider]) => provider);

    // §B.7 is a cross-field consistency check on the discovery doc — only
    // meaningful when a provider actually advertises `subscription`.
    if (!behaviorGate('openwop-subscription-auth', subProviders.length > 0)) return;

    const byok = new Set(ai?.byok ?? []);
    for (const provider of subProviders) {
      expect(
        byok.has(provider),
        req('openwop.it.aiproviders-subscription-scope.every-advertised-subscription-provider-appears-in-aiproviders-byok', 'RFC 0121 §B.7', `subscription provider '${provider}' MUST appear in aiProviders.byok`),
      ).toBe(true);
    }
  });
});

describe('aiproviders-subscription-scope: §B.8 user-scope-only (bind-seam-gated)', () => {
  it('a tenant-scope subscription binding is rejected with credential_scope_forbidden', async () => {
    // Gated on the host-sample bind SEAM, NOT on live advertisement. The
    // user-scope-only invariant (`subscription-credential-user-scope-only`) is a
    // property of the credential-binding path, so it is witnessable without a
    // (ToS-gated per RFC 0121 §C / UQ1) live `subscription` advertisement — a
    // reference host that cannot lawfully advertise the mode (e.g. an ephemeral
    // multi-instance deploy with no durable per-user login) can still prove the
    // safety rail here. Soft-skips on 404 when the seam is unwired.
    const res = await driver.post(SEAM, { provider: 'anthropic', mode: 'subscription', scope: 'tenant' });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    expect(
      res.status >= 400,
      req('openwop.it.aiproviders-subscription-scope.a-tenant-scope-subscription-binding-is-rejected-with-credential-scope-forbidden', 
        'RFC 0121 §B.8',
        `binding a subscription credential at tenant scope MUST be rejected (got HTTP ${res.status})`,
      ),
    ).toBe(true);
    expect(
      errCode(res.json),
      req('openwop.it.aiproviders-subscription-scope.a-tenant-scope-subscription-binding-is-rejected-with-credential-scope-forbidden', 
        'RFC 0121 §B.8',
        'a rejected tenant-scope subscription binding MUST carry the canonical `credential_scope_forbidden` error code',
      ),
    ).toBe('credential_scope_forbidden');
  });
});
