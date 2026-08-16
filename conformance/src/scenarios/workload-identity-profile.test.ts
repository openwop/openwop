/**
 * RFC 0154 §A/§B — workload identity and delegation, shape only.
 *
 * **What this proves:** the schema admits the identity and delegation shapes §A
 * and §B describe, and — more importantly — **rejects credential material**. It
 * verifies no host. RFC 0147 §A.5 forbids `Accepted` on shape-only evidence for
 * a behavioral requirement, and §A's actual requirements are behavioral:
 * cryptographically verify the presented identity, bind it to the request,
 * resolve it to a principal before authorization, and fail closed when
 * unresolvable. A schema cannot demonstrate any of those.
 *
 * What a schema *can* do is make the dangerous shape unrepresentable, and that
 * is what this checks. The governing rule is negative: **raw certificates,
 * tokens, proofs, and credentials MUST NOT enter these objects.** `subject` is
 * an opaque identifier; `proofRef` and `thumbprintRef` are digest *references*.
 * A verified identity is a fact about a completed verification, not a container
 * for the material that proved it — and these objects are projected into events,
 * spans, and audit records, which is precisely where credential material must
 * never reach.
 *
 * The second rule the schema encodes is **identity is not authorization**
 * (RFC 0147 R12). Knowing which workload called says nothing about what it may
 * do. That one cannot be schema-enforced at all, which is why `audience` is
 * required on a delegation: an identity minted for somewhere else is the
 * confused-deputy path, and the audience check is what closes it.
 *
 * Server-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

/**
 * Schemas ship inside the package; RFC prose does not. The two need different
 * treatment, and collapsing them onto one `ROOT` derived from `V1_DIR` is what
 * broke this file in the published layout — `V1_DIR` is null there, and the
 * `as string` cast carried the null straight into `join()`.
 */
const RFCS_DIR = V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'RFCS');

function validator() {
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'workload-identity.schema.json'), 'utf8'),
  ) as object;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('RFC 0154 §A — workload identity shape', () => {
  const validate = validator();

  it('a verified identity validates', () => {
    expect(
      validate({ scheme: 'spiffe', subject: 'spiffe://example/dispatcher', issuer: 'spiffe://example', audience: 'openwop-host' }),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('the object is closed — credential material cannot be smuggled in', () => {
    // The governing rule, and the one a schema can actually enforce. These
    // objects reach events, spans, and audit records; an open object is an
    // invitation for a token to ride along into all three.
    for (const extra of [
      { certificate: '-----BEGIN CERTIFICATE-----' },
      { token: 'eyJhbGciOiJIUzI1NiJ9.x.y' },
      { privateKey: 'secret' },
      { proof: 'raw-proof-bytes' },
    ]) {
      expect(
        validate({ scheme: 'spiffe', subject: 'spiffe://example/x', ...extra }),
        `RFC 0154 §A: raw credentials MUST NOT enter the identity object — rejected \`${Object.keys(extra)[0]}\``,
      ).toBe(false);
    }
  });

  it('the scheme is a closed enum', () => {
    expect(
      validate({ scheme: 'trust-me', subject: 'x' }),
      'RFC 0154 §A: an unrecognized scheme is a verification path nobody implemented. Accepting ' +
        'the NAME without the verification is exactly the failure this profile prevents.',
    ).toBe(false);
  });

  it('subject is required and non-empty', () => {
    expect(validate({ scheme: 'spiffe' })).toBe(false);
    expect(validate({ scheme: 'spiffe', subject: '' })).toBe(false);
  });

  it('a key binding carries a digest reference, never a key', () => {
    expect(validate({ scheme: 'mtls-san', subject: 'x', keyBinding: { method: 'mtls', thumbprintRef: DIGEST } })).toBe(true);
    expect(
      validate({ scheme: 'mtls-san', subject: 'x', keyBinding: { method: 'mtls', thumbprintRef: 'MIIBIjANBgkqh' } }),
      'RFC 0154 §A: `thumbprintRef` is pattern-constrained to a sha256 digest so a raw key cannot ' +
        'be pasted here and still validate.',
    ).toBe(false);
    expect(validate({ scheme: 'mtls-san', subject: 'x', keyBinding: { method: 'telepathy' } })).toBe(false);
  });
});

describe('RFC 0154 §B — delegated actor chain', () => {
  const validate = validator();
  const base = { scheme: 'spiffe' as const, subject: 'spiffe://example/planner' };

  it('a verified delegation validates', () => {
    expect(
      validate({
        ...base,
        delegation: {
          chain: [{ subject: 'spiffe://example/dispatcher', issuer: 'spiffe://example' }],
          audience: 'openwop-host',
          expiresAt: '2026-08-13T16:00:00Z',
          proofRef: DIGEST,
        },
      }),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('audience is required on a delegation', () => {
    // The confused-deputy guard (RFC 0147 R12). An identity minted for somewhere
    // else, accepted here, is how a credential valid elsewhere becomes a
    // credential valid here.
    expect(
      validate({ ...base, delegation: { chain: [{ subject: 'x' }] } }),
      'RFC 0154 §B: a delegation without an audience cannot be checked against this host.',
    ).toBe(false);
  });

  it('an empty chain is rejected', () => {
    expect(
      validate({ ...base, delegation: { chain: [], audience: 'openwop-host' } }),
      'RFC 0154 §B: a delegation context with no chain claims a delegation nobody can inspect.',
    ).toBe(false);
  });

  it('proofRef is a digest reference, not the proof', () => {
    expect(
      validate({ ...base, delegation: { chain: [{ subject: 'x' }], audience: 'h', proofRef: 'eyJhbGciOiJIUzI1NiJ9.a.b' } }),
      'RFC 0154 §B: `proofRef` is a REFERENCE. A JWT pasted here would put the proof itself into ' +
        'every event and span this object reaches.',
    ).toBe(false);
  });

  it('a chain hop cannot carry extra fields', () => {
    expect(validate({ ...base, delegation: { chain: [{ subject: 'x', token: 'y' }], audience: 'h' } })).toBe(false);
  });

  it('a chain hop MAY carry its verified scopes, as a set of non-empty strings', () => {
    // RFC 0154 §B "Bounds": scope amplification is only observable if a hop can
    // state the scopes its proof carried. Provenance, not authorization.
    expect(validate({ ...base, delegation: { chain: [{ subject: 'x', scopes: ['runs:read'] }, { subject: 'y', scopes: ['runs:read'] }], audience: 'h' } })).toBe(true);
    expect(validate({ ...base, delegation: { chain: [{ subject: 'x', scopes: 'runs:read' }], audience: 'h' } })).toBe(false);
    expect(validate({ ...base, delegation: { chain: [{ subject: 'x', scopes: ['runs:read', 'runs:read'] }], audience: 'h' } })).toBe(false);
    expect(validate({ ...base, delegation: { chain: [{ subject: 'x', scopes: [''] }], audience: 'h' } })).toBe(false);
  });
});

describe.skipIf(RFCS_DIR === null)('RFC 0154 — what this does NOT establish', () => {
  it('the behavioral and external-audit items stay unticked and annotated', () => {
    // §A's real requirements are behavioral — verify, bind, resolve, fail closed
    // — and none is schema-checkable. §A.5 forbids `Accepted` on this evidence.
    const rfc = readFileSync(
      join(RFCS_DIR as string, '0154-workload-identity-delegation-telemetry-and-provenance.md'),
      'utf8',
    );
    for (const needle of [
      'Verification, fail-closed authorization, sender constraint, and negative chain tests pass.',
      'External auditor reviews the identity and provenance implementation.',
    ]) {
      expect(
        new RegExp(`- \\[ \\] ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(rfc),
        `RFC 0154: "${needle}" MUST remain unticked and annotated — a schema cannot demonstrate ` +
          'cryptographic verification, and no host implements this profile.',
      ).toBe(true);
    }
  });
});
