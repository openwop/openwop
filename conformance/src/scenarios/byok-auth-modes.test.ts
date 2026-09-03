/**
 * BYOK auth-mode advertisement (RFC 0067, `Draft`).
 *
 * Verifies `capabilities.aiProviders.authModes` — the optional per-provider
 * advertisement of HOW a host expects a provider's credential to be supplied
 * (`apiKey` / `oauth-pkce` / `oauth-device` / `none` / `subscription`).
 *
 * Two assertion groups:
 *   1. Schema shape (always-on, server-free) — the `aiProviders.authModes`
 *      sub-schema validates conforming maps and rejects malformed ones
 *      (empty arrays, unknown modes).
 *   2. Cross-field consistency (gated on the live discovery doc advertising
 *      `aiProviders.authModes`) — the §B auth-mode contract: every key is in
 *      `supported`; every `apiKey` provider is in `byok`; every `["none"]`
 *      provider is absent from `byok`; `oauth-*` providers SHOULD have a
 *      matching `capabilities.oauth.providers[].id`.
 *
 * Hosts that omit `authModes` skip the cross-field group cleanly — the
 * field's presence in the discovery doc is the gate.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md §"aiProviders.authModes — BYOK auth-mode contract"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0067-provider-catalog-conventions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface AuthModeCapabilities {
  aiProviders?: {
    supported?: string[];
    byok?: string[];
    authModes?: Record<string, string[]>;
  };
  oauth?: { providers?: Array<{ id: string }> };
}

/** Compile a tiny schema that validates just the `authModes` sub-shape. */
function authModesValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile({
    type: 'object',
    additionalProperties: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', enum: ['apiKey', 'oauth-pkce', 'oauth-device', 'none', 'subscription'] },
    },
  });
}

describe('byok-auth-modes: schema shape (RFC 0067, server-free)', () => {
  it('the capabilities schema declares aiProviders.authModes with the five-mode enum', () => {
    const caps = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
      .aiProviders;
    const authModes = aiProviders?.properties?.authModes as
      | { additionalProperties?: { items?: { enum?: string[] } } }
      | undefined;
    expect(
      authModes,
      req('openwop.it.byok-auth-modes.the-capabilities-schema-declares-aiproviders-authmodes-with-the-five-mode-enum', 'capabilities.md §aiProviders.authModes', 'the schema MUST declare aiProviders.authModes'),
    ).toBeDefined();
    expect(authModes?.additionalProperties?.items?.enum, req('openwop.it.byok-auth-modes.the-capabilities-schema-declares-aiproviders-authmodes-with-the-five-mode-enum', 'RFC 0067', 'the capabilities schema declares aiProviders.authModes with the five-mode enum')).toEqual([
      'apiKey',
      'oauth-pkce',
      'oauth-device',
      'none',
      'subscription',
    ]);
  });

  it('a conforming authModes map validates; malformed maps are rejected', () => {
    const validate = authModesValidator();
    expect(
      validate({ anthropic: ['apiKey'], vertex: ['oauth-pkce'], ollama: ['none'] }),
      req('openwop.it.byok-auth-modes.a-conforming-authmodes-map-validates-malformed-maps-are-rejected', 'RFC 0067 §A', 'a conforming authModes map MUST validate'),
    ).toBe(true);
    // Negative: empty array fails minItems.
    expect(validate({ anthropic: [] }), req('openwop.it.byok-auth-modes.a-conforming-authmodes-map-validates-malformed-maps-are-rejected', 'RFC 0067', 'a conforming authModes map validates; malformed maps are rejected')).toBe(false);
    // Negative: unknown mode (`device` — canonical is `oauth-device`) fails the enum.
    expect(validate({ anthropic: ['device'] })).toBe(false);
  });
});

describe('byok-auth-modes: cross-field consistency (gated on advertisement)', () => {
  it('a host advertising authModes MUST satisfy the §B contract', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (discovery unavailable — skip cleanly) (seam, prior step, or fixture unavailable)'); // discovery unavailable — skip cleanly
    const caps = res.json as AuthModeCapabilities;
    const authModes = caps.aiProviders?.authModes;
    if (!authModes) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!authModes` returned early (host does not advertise authModes — gated skip)'); // host does not advertise authModes — gated skip

    const supported = new Set(caps.aiProviders?.supported ?? []);
    const byok = new Set(caps.aiProviders?.byok ?? []);
    const oauthIds = new Set((caps.oauth?.providers ?? []).map((p) => p.id));

    for (const [provider, modes] of Object.entries(authModes)) {
      // §B.1 — every key is in `supported`.
      expect(
        supported.has(provider),
        req('openwop.it.byok-auth-modes.a-host-advertising-authmodes-must-satisfy-the-b-contract', 'RFC 0067 §B.1', `authModes key '${provider}' MUST appear in aiProviders.supported`),
      ).toBe(true);

      // §B.2 — an `apiKey` provider is in `byok`.
      if (modes.includes('apiKey')) {
        expect(
          byok.has(provider),
          req('openwop.it.byok-auth-modes.a-host-advertising-authmodes-must-satisfy-the-b-contract', 'RFC 0067 §B.2', `provider '${provider}' with apiKey MUST appear in aiProviders.byok`),
        ).toBe(true);
      }

      // RFC 0121 §B.7 — a `subscription` provider is a BYOK path and MUST be in `byok`.
      if (modes.includes('subscription')) {
        expect(
          byok.has(provider),
          req('openwop.it.byok-auth-modes.a-host-advertising-authmodes-must-satisfy-the-b-contract', 'RFC 0121 §B.7', `provider '${provider}' with subscription MUST appear in aiProviders.byok`),
        ).toBe(true);
      }

      // §B.3 — a provider whose modes are exactly ["none"] is absent from `byok`.
      if (modes.length === 1 && modes[0] === 'none') {
        expect(
          byok.has(provider),
          req('openwop.it.byok-auth-modes.a-host-advertising-authmodes-must-satisfy-the-b-contract', 'RFC 0067 §B.3', `provider '${provider}' with modes ["none"] MUST NOT appear in aiProviders.byok`),
        ).toBe(false);
      }

      // §B.4 — oauth providers SHOULD have a matching capabilities.oauth.providers[].id.
      // SHOULD, so report-only: only asserted when the oauth block is advertised at all.
      if ((modes.includes('oauth-pkce') || modes.includes('oauth-device')) && oauthIds.size > 0) {
        expect(
          oauthIds.has(provider),
          req('openwop.it.byok-auth-modes.a-host-advertising-authmodes-must-satisfy-the-b-contract', 'RFC 0067 §B.4', `oauth provider '${provider}' SHOULD have a matching capabilities.oauth.providers[].id`),
        ).toBe(true);
      }
    }
  });
});
