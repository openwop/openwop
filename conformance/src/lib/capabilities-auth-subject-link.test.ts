/**
 * Server-free pin of the RFC 0163 §C schema conditional in
 * `schemas/capabilities.schema.json`:
 *
 *   auth.subjectLinking: true  ⇒  auth.subjectLinkKey required
 *   auth.subjectLinkKey        ∈  { opaque-idp, configured-immutable }
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

  it('subjectLinking absent or false does not require a key (nothing de-conforms)', () => {
    expect(validate(doc({ profiles: PROFILES }))).toBe(true);
    expect(validate(doc({ profiles: PROFILES, subjectLinking: false }))).toBe(true);
  });
});
