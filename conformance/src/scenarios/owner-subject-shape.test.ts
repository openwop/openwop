/**
 * owner-subject-shape — RFC 0165 §B.1–§B.2 verification (server-free).
 *
 * `schemas/subject.schema.json` is the OPTIONAL issuer-scoped identity record
 * carried as `owner.subject` on `RunSnapshot` and on the `run.started` owner
 * echo. This file proves the SCHEMA half of §B: the record compiles standalone,
 * both owner sub-objects reference it as a declared optional member (they are
 * `additionalProperties: false`, so an undeclared `subject` would be rejected —
 * the live `principalKind` divergence RFC 0165 §Alternatives 3 names), and the
 * opacity + key-class conditionals hold. Behaviour (echo, fork copy, legacy
 * synthesis) is `owner-subject-echo.test.ts`, gated on a host that emits it.
 *
 * SECURITY invariant `subject-record-opaque` (witness class: claims-check —
 * the schema pattern is what forbids an email-shaped or whitespace subjectId;
 * no probe can prove a host never mints PII, only that the wire refuses it).
 *
 * @see RFCS/0165-v2-preparation-wire-shapes.md §B
 * @see schemas/subject.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const read = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8')) as Record<string, unknown>;
const subject = read('subject.schema.json');
const snapshot = read('run-snapshot.schema.json') as { $schema: string; $id: string; properties: { owner: Record<string, unknown> } };
const payloads = read('run-event-payloads.schema.json') as { $schema: string; $id: string; $defs: { runStarted: { properties: { owner: Record<string, unknown> } } } };

function ajvWithSubject(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(subject);
  return ajv;
}

const VALID = { issuer: 'https://idp.example.com/entity', subjectId: 'idp-op-8f3a', tenant: 'acme', lane: 'saml', kind: 'user', keyClass: 'opaque-idp' };

describe('owner-subject-shape: subject.schema.json (RFC 0165 §B.1)', () => {
  const validate = ajvWithSubject().compile(subject);

  it('compiles and accepts a full SAML subject', () => {
    expect(validate(VALID), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts the legacy issuer form (RFC 0165 §B.3) and a workload subject', () => {
    expect(validate({ issuer: 'urn:openwop:legacy', subjectId: 'user_42', tenant: 'acme', lane: 'api-key', kind: 'user' }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ issuer: 'spiffe://trust.example', subjectId: 'spiffe://trust.example/ns/a/sa/b', tenant: 'acme', lane: 'workload', kind: 'workload' }), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an email-shaped or whitespace subjectId (invariant subject-record-opaque)', () => {
    expect(validate({ ...VALID, subjectId: 'alice@example.com' }), 'RFC 0165 §B.2: subjectId MUST NOT be an email address').toBe(false);
    expect(validate({ ...VALID, subjectId: 'Alice Example' }), 'RFC 0165 §B.2: subjectId MUST NOT contain whitespace (a display name)').toBe(false);
  });

  it('requires keyClass on the saml/scim lanes and forbids it elsewhere', () => {
    const { keyClass: _k, ...noKey } = VALID;
    expect(validate(noKey), 'RFC 0165 §B.2: keyClass MUST be present when lane is saml or scim').toBe(false);
    expect(validate({ ...VALID, lane: 'oidc' }), 'RFC 0165 §B.2: keyClass MUST be absent when the lane is not linkable').toBe(false);
    expect(validate({ ...noKey, lane: 'oidc' }), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an unknown member and a missing required member', () => {
    expect(validate({ ...VALID, email: 'x' })).toBe(false);
    const { tenant: _t, ...noTenant } = VALID;
    expect(validate(noTenant)).toBe(false);
  });

  it('accepts a nested actor chain (depth is a host obligation, RFC 0165 §B.5)', () => {
    const peer = { issuer: 'https://peer.example', subjectId: 'peer-1', tenant: 'acme', lane: 'workload', kind: 'workload' };
    const { keyClass: _k, ...anon } = { ...VALID, kind: 'anonymous', lane: 'api-key', actor: peer };
    expect(validate(anon), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('owner-subject-shape: both owner sub-objects declare `subject` (RFC 0165 §B.1)', () => {
  // The extracted sub-schema needs its parent's `$id` as the base for the relative `subject.schema.json` $ref.
  const ownerSnap = { $schema: snapshot.$schema, $id: snapshot.$id, ...snapshot.properties.owner };
  const ownerEcho = { $schema: payloads.$schema, $id: payloads.$id, ...payloads.$defs.runStarted.properties.owner };

  it('RunSnapshot.owner accepts a subject and still rejects an undeclared member', () => {
    const v = ajvWithSubject().compile(ownerSnap);
    expect(v({ tenant: 'acme', principal: 'idp-op-8f3a', principalKind: 'user', subject: VALID }), JSON.stringify(v.errors)).toBe(true);
    expect(v({ tenant: 'acme', role: 'admin' })).toBe(false);
  });

  it('run.started owner echo accepts the same subject AND principalKind (the echo matches the snapshot)', () => {
    const v = ajvWithSubject().compile(ownerEcho);
    expect(
      v({ tenant: 'acme', principal: 'idp-op-8f3a', principalKind: 'user', subject: VALID }),
      'RFC 0165 §B.1: run.started owner MUST declare subject and principalKind so a host can echo its snapshot owner verbatim',
    ).toBe(true);
    expect(v({ tenant: 'acme', subject: { ...VALID, subjectId: 'a@b' } })).toBe(false);
  });
});
