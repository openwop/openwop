/**
 * Server-free pin of the RFC 0163 §C schema conditional in
 * `schemas/capabilities.schema.json`:
 *
 *   auth.subjectLinking: true  ⇒  auth.subjectLinkKey required            (RFC 0163)
 *   auth.subjectLinkKey        ∈  { opaque-idp, configured-immutable }   (RFC 0163)
 *   profiles ⊇ {saml, scim}    ⇒  subjectLinking const true + key required (RFC 0164)
 *
 * This checks the SCHEMA ARTIFACT, not any host, which is why it lives under
 * `src/lib/` (no scenario ledger row — see `saml-idp.test.ts` for the G8
 * reasoning). The host-facing assertion is the advertisement leg of
 * `scenarios/auth-subject-link-key-class.test.ts`, gated on the flag.
 *
 * @see RFCS/0163-subject-linking-hardening.md §C
 * @see spec/v1/auth-profiles.md §"Subject linking (SAML ⟷ SCIM)"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from './paths.js';

function compileCapabilities() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) {
    const s = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8')) as { $id?: string };
    ajv.addSchema(s, file);
    ajv.addSchema(s, `./${file}`);
  }
  // Validate the `auth` block in isolation: the conditional lives on that
  // object, and a full discovery document would drag in every root-level
  // required family (supportedEnvelopes, schemaVersions, limits, …) that has
  // nothing to do with what this file pins.
  return ajv.compile({ $ref: 'capabilities.schema.json#/properties/auth' });
}

const PROFILES = ['openwop-auth-saml', 'openwop-auth-scim'];
function doc(auth: Record<string, unknown>) {
  return auth;
}

describe('capabilities.schema.json: auth.subjectLinkKey conditional (RFC 0163 §C)', () => {
  const validate = compileCapabilities();

  it('subjectLinking:true WITHOUT subjectLinkKey fails validation (§A.1 co-requirement is in the schema, not only prose)', () => {
    const ok = validate(doc({ profiles: PROFILES, subjectLinking: true }));
    expect(ok, JSON.stringify(validate.errors)).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain('subjectLinkKey');
  });

  it('subjectLinking:true with a class member validates', () => {
    for (const k of ['opaque-idp', 'configured-immutable']) {
      const ok = validate(doc({ profiles: PROFILES, subjectLinking: true, subjectLinkKey: k }));
      expect(ok, `${k}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('a mutable/PII key is INEXPRESSIBLE: "email" fails the enum', () => {
    const ok = validate(doc({ profiles: PROFILES, subjectLinking: true, subjectLinkKey: 'email' }));
    expect(ok).toBe(false);
  });

  it('the retired Draft-era attribute names are not members (the enum names classes)', () => {
    for (const k of ['oid', 'immutable-id']) {
      expect(validate(doc({ profiles: PROFILES, subjectLinking: true, subjectLinkKey: k })), k).toBe(false);
    }
  });

  it('one profile alone does not require the flag or a key (SAML-only / SCIM-only hosts are unaffected)', () => {
    expect(validate(doc({ profiles: ['openwop-auth-saml'] }))).toBe(true);
    expect(validate(doc({ profiles: ['openwop-auth-scim'], subjectLinking: false }))).toBe(true);
  });
});

describe('capabilities.schema.json: the profile pair implies the contract (RFC 0164 §B)', () => {
  const validate = compileCapabilities();

  it('BOTH profiles with subjectLinking absent fails validation (the vulnerable pre-0164 shape)', () => {
    const ok = validate(doc({ profiles: PROFILES }));
    expect(ok, JSON.stringify(validate.errors)).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain('subjectLinking');
  });

  it('BOTH profiles with subjectLinking:false fails validation (the flag is derived, not a choice)', () => {
    expect(validate(doc({ profiles: PROFILES, subjectLinking: false, subjectLinkKey: 'opaque-idp' }))).toBe(false);
  });

  it('BOTH profiles with subjectLinking:true but no subjectLinkKey fails validation', () => {
    expect(validate(doc({ profiles: PROFILES, subjectLinking: true }))).toBe(false);
  });

  it('BOTH profiles with subjectLinking:true + a class member validates (the derived advertisement)', () => {
    expect(validate(doc({ profiles: PROFILES, subjectLinking: true, subjectLinkKey: 'opaque-idp' }))).toBe(true);
  });

  it('profile order does not matter', () => {
    expect(validate(doc({ profiles: ['openwop-auth-scim', 'openwop-auth-api-key-rotation', 'openwop-auth-saml'], subjectLinking: true, subjectLinkKey: 'configured-immutable' }))).toBe(true);
    expect(validate(doc({ profiles: ['openwop-auth-scim', 'openwop-auth-api-key-rotation', 'openwop-auth-saml'] }))).toBe(false);
  });
});
