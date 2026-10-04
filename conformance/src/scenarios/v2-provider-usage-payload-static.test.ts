/**
 * v2 — the `provider.usage` payload, statically (`spec/v2/core/events.md`
 * §providerUsage; `schemas/v2/run-event-payloads.schema.json#/$defs/providerUsage`;
 * RFC 0026; invariant `provider-usage-no-credential-leak`). The v1 twin is the
 * schema half of `provider-usage`; its emit-seam legs (and the v1
 * `provider_usage_credential_leak` code, which `spec/v2/errors.json` does not
 * carry) are not ported.
 *
 *   type       `provider.usage` is a registered v2 event type;
 *   positive   a payload with the four required fields, and one with every
 *              optional field, validates;
 *   required   a payload missing provider, model, inputTokens or outputTokens
 *              is rejected;
 *   counts     a fractional or negative token count is rejected;
 *   cost       a negative `costEstimateUsd` is rejected; `currency` is an
 *              ISO 4217 code ("`providerUsage.currency` is the ISO 4217
 *              currency of `costEstimateUsd`");
 *   no-leak    the payload is closed, so a credential ref, a hashed credential
 *              id or prompt/response text is rejected ("The payload MUST NOT
 *              carry credential refs, hashed credential identifiers, or prompt
 *              or response text").
 *
 * Host-free: every leg runs with no OPENWOP_BASE_URL.
 *
 * @see spec/v2/core/events.md §providerUsage
 */

import { describe, it, expect } from 'vitest';
import { v2RefValidator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'events.md §providerUsage';
const ID_TYPE = 'openwop.requirement.provider-usage.event-type-registered';
const ID_POSITIVE = 'openwop.requirement.provider-usage.payload-well-formed-accepted';
const ID_REQUIRED = 'openwop.requirement.provider-usage.payload-required-fields';
const ID_COUNTS = 'openwop.requirement.provider-usage.payload-token-counts';
const ID_COST = 'openwop.requirement.provider-usage.payload-cost-and-currency';
const ID_NO_LEAK = 'openwop.requirement.provider-usage.payload-no-credential-or-content';

const MINIMAL = { provider: 'anthropic', model: 'claude-x', inputTokens: 120, outputTokens: 30 } as const;
const FULL = { ...MINIMAL, totalTokens: 150, costEstimateUsd: 0.0021, currency: 'EUR', cacheHit: false, cacheReadTokens: 0, cacheWriteTokens: 64 } as const;

function without(field: string): Record<string, unknown> {
  const c: Record<string, unknown> = { ...MINIMAL };
  delete c[field];
  return c;
}

describe('v2 provider.usage payload (events.md §providerUsage)', () => {
  const validate = v2RefValidator('run-event-payloads.schema.json#/$defs/providerUsage');

  it('provider.usage is a registered v2 run-event type', () => {
    const r = v2RefValidator('run-event.schema.json#/properties/type')('provider.usage');
    expect(r.ok, req(ID_TYPE, DOC, `provider.usage MUST be accepted by the v2 run-event type union (${r.errors})`)).toBe(true);
  });

  it('accepts a minimal and a full payload', () => {
    for (const p of [MINIMAL, FULL]) {
      const r = validate(p);
      expect(r.ok, req(ID_POSITIVE, DOC, `a well-formed provider.usage payload MUST validate (${r.errors})`)).toBe(true);
    }
  });

  it.each(['provider', 'model', 'inputTokens', 'outputTokens'])('rejects a payload without %s', (field) => {
    expect(validate(without(field)).ok, req(ID_REQUIRED, DOC, `a provider.usage payload without ${field} MUST be rejected`)).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a fractional inputTokens', { ...MINIMAL, inputTokens: 1.5 }],
    ['a negative outputTokens', { ...MINIMAL, outputTokens: -1 }],
    ['a string inputTokens', { ...MINIMAL, inputTokens: '120' }],
  ])('rejects %s', (what, p) => {
    expect(validate(p).ok, req(ID_COUNTS, DOC, `a provider.usage payload with ${what} MUST be rejected`)).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a negative costEstimateUsd', { ...MINIMAL, costEstimateUsd: -0.01 }],
    ['a lower-case currency', { ...MINIMAL, costEstimateUsd: 0.01, currency: 'usd' }],
    ['a currency symbol', { ...MINIMAL, costEstimateUsd: 0.01, currency: '$' }],
  ])('rejects %s', (what, p) => {
    expect(validate(p).ok, req(ID_COST, DOC, `a provider.usage payload with ${what} MUST be rejected`)).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a credential ref', { ...MINIMAL, credentialRef: 'secret:tenant:byok-anthropic:v1' }],
    ['a hashed credential id', { ...MINIMAL, credentialHash: 'sha256:9f2c' }],
    ['prompt text', { ...MINIMAL, prompt: 'summarize the attached notes' }],
    ['response text', { ...MINIMAL, response: 'Here is a summary' }],
  ])('rejects a payload carrying %s', (what, p) => {
    expect(validate(p).ok, req(ID_NO_LEAK, DOC, `the provider.usage payload MUST NOT carry ${what}`)).toBe(false);
  });
});
