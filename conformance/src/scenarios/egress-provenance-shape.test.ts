/**
 * Credential provenance + egress policy — descriptor + event + capability shapes (RFC 0079).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `credential-provenance.schema.json` compiles and round-trips a conforming
 *     `CredentialProvenance`, and rejects the malformed (`audiences: []` —
 *     `minItems:1`, a credential with no audience can't be bound to anything;
 *     a missing REQUIRED `credentialId`; an unknown property under
 *     `additionalProperties:false`).
 *   - the descriptor + the `egress.decided` payload are CONTENT-FREE OF THE
 *     SECRET: neither schema declares a secret-value property (the public test
 *     for the protocol-tier SECURITY invariant `egress-decision-no-secret-leak`).
 *   - the `egress.decided` payload $def validates a conforming content-free
 *     record and rejects an out-of-enum `decision` (`ok` is a `reason`, not a
 *     `decision` — the canonical allow value is `allowed`), and requires
 *     `decision` + `destination`.
 *   - `egress.decided` appears in the RunEventType enum.
 *   - `capabilities.httpClient.egressPolicy` is declared with `supported` /
 *     `decisions`.
 *
 * Behavioral assertions (the §C audience-binding MUST — a credential bound to
 * audience A on an egress to B → denied/downgraded, never allowed-with-credential;
 * fail-closed on unevaluable provenance) are gated on
 * `capabilities.httpClient.egressPolicy.supported` and land in
 * `egress-audience-binding.test.ts` + `egress-decision-content-free.test.ts`
 * (deferred per RFC 0079 §Conformance — reference host deferred). That binding is
 * tracked as the reference-impl-tier `egress-credential-audience-bound` invariant
 * until a host wires it (RFC 0035 precedent). This scenario asserts the wire
 * contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§"Credential provenance + egress policy")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0079-credential-provenance-and-egress-policy.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (egress-decision-no-secret-leak)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/** Property names that would betray a secret value leaking onto the wire. */
const SECRET_PROP_NAMES = ['secret', 'value', 'token', 'apiKey', 'authorization', 'password', 'credential'];

describe('egress-provenance-shape: CredentialProvenance (RFC 0079 §A, server-free)', () => {
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const provenance = loadSchema('credential-provenance.schema.json');
  const validate = ajv.compile(provenance);

  it('a conforming descriptor validates', () => {
    expect(
      validate({ credentialId: 'cred-stripe-1', issuer: 'host', audiences: ['api.stripe.com'], expiresAt: '2026-12-01T00:00:00Z', scopes: ['egress:stripe:charge'], redactionPolicy: 'always' }),
      why('host-capabilities.md §"Credential provenance + egress policy"', 'a conforming CredentialProvenance MUST validate'),
    ).toBe(true);
  });

  it('audiences: [] is rejected (minItems:1 — a credential needs ≥1 audience to bind)', () => {
    expect(validate({ credentialId: 'c', issuer: 'host', audiences: [] }), why('RFC 0079 §A', 'audiences MUST have ≥1 entry')).toBe(false);
  });

  it('a missing REQUIRED credentialId is rejected', () => {
    expect(validate({ issuer: 'host', audiences: ['a'] }), why('RFC 0079 §A', 'credentialId is REQUIRED')).toBe(false);
  });

  it('an unknown property is rejected (additionalProperties:false)', () => {
    expect(validate({ credentialId: 'c', issuer: 'host', audiences: ['a'], secretValue: 'sk-live-xxx' }), why('RFC 0079 §A', 'CredentialProvenance MUST be additionalProperties:false')).toBe(false);
  });

  it('declares no secret-value property (egress-decision-no-secret-leak)', () => {
    const props = Object.keys((provenance.properties ?? {}) as Record<string, unknown>);
    for (const p of props) {
      expect(
        SECRET_PROP_NAMES.includes(p.toLowerCase()),
        why('SECURITY invariant egress-decision-no-secret-leak', `CredentialProvenance MUST NOT declare a secret-bearing property (${p})`),
      ).toBe(false);
    }
  });
});

describe('egress-provenance-shape: egress.decided event (RFC 0079 §B, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const validate = ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: (payloads as { $defs: Record<string, unknown> }).$defs,
    $ref: '#/$defs/egressDecided',
  } as Record<string, unknown>);

  it('validates a content-free decision and enforces the decision enum + required fields', () => {
    expect(validate({ decision: 'allowed', destination: 'api.stripe.com', credentialId: 'cred-stripe-1', reason: 'ok' }), why('RFC 0079 §B', 'a conforming egress.decided MUST validate')).toBe(true);
    expect(validate({ decision: 'denied', destination: 'attacker.example', credentialId: 'cred-stripe-1', reason: 'out-of-audience' }), why('RFC 0079 §B', 'a denied decision MUST validate')).toBe(true);
    expect(validate({ decision: 'ok', destination: 'a' }), why('RFC 0079 §B', 'the canonical allow value is "allowed", not "ok"')).toBe(false);
    expect(validate({ destination: 'a' }), why('RFC 0079 §B', 'decision is REQUIRED')).toBe(false);
    expect(validate({ decision: 'allowed' }), why('RFC 0079 §B', 'destination is REQUIRED')).toBe(false);
  });

  it('the egressDecided $def declares no secret-value property', () => {
    const def = ((payloads.$defs as Record<string, { properties?: Record<string, unknown> }>).egressDecided.properties) ?? {};
    for (const p of Object.keys(def)) {
      expect(SECRET_PROP_NAMES.includes(p.toLowerCase()), why('egress-decision-no-secret-leak', `egress.decided MUST NOT declare a secret-bearing property (${p})`)).toBe(false);
    }
  });

  it('egress.decided is in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = ((runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum) ?? [];
    expect(enumVals.includes('egress.decided'), why('run-event.schema.json', 'egress.decided MUST be in the RunEventType enum')).toBe(true);
  });
});

describe('egress-provenance-shape: capability advertisement (RFC 0079 §D, server-free)', () => {
  it('capabilities.httpClient.egressPolicy is declared with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const httpClient = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).httpClient;
    const egressPolicy = httpClient?.properties?.egressPolicy;
    expect(egressPolicy, why('capabilities.md §httpClient', 'httpClient.egressPolicy MUST be declared')).toBeDefined();
    for (const flag of ['supported', 'decisions']) {
      expect(egressPolicy?.properties?.[flag], why('host-capabilities.md §"Credential provenance + egress policy"', `egressPolicy.${flag} MUST be declared`)).toBeDefined();
    }
  });
});
