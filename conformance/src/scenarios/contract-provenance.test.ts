/**
 * `contractProvenance` — which corpus revision a host implements against (RFC 0146).
 *
 * THE FAILURE THIS EXISTS FOR, and it is not hypothetical. A reference host's hand-copied
 * `capabilities.schema.json` carried 81 properties where the corpus had 88, so it validated
 * its own discovery document against a contract that predated the very declaration it was
 * checking. Green, and wrong. Nothing on the wire distinguished it from a current host.
 *
 * WHY VALIDATION CANNOT SEE THIS — the point that decides the whole design. v1.x changes are
 * additive (`COMPATIBILITY.md` §2.1), so a document written against an older contract still
 * validates against the newer schema. Validation is precisely the instrument that is blind
 * here, which is why the stale host was green. Only a claim on the wire can surface it.
 *
 * ADVISORY BY CONSTRUCTION. A host on an older corpus revision is CONFORMANT — additive means
 * older is legal. So requirement 3 forbids rejecting on a mismatch, and these legs assert the
 * SHAPE of the claim, never that a host is current. A leg that failed a host for being behind
 * would convert an optional disclosure into a de-facto upgrade mandate inside a version line
 * where being behind is permitted.
 *
 * NOT BUILT (RFC 0146 G2): a leg asserting the advertised revision matches what the host
 * ACTUALLY validates with (requirement 2). Nothing observable from outside distinguishes a
 * host implementing corpus X from one merely claiming X — the same self-report limit as
 * RFC 0145 requirement 3. Asserting it would be theatre.
 *
 * @see schemas/capabilities.schema.json §contractProvenance
 * @see RFCS/0146-contract-provenance-advertisement.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function provenanceSubschema(): Record<string, unknown> {
  const caps = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
  ) as { properties: Record<string, Record<string, unknown>>; required?: string[] };
  return caps.properties.contractProvenance;
}

function compiled(): ReturnType<Ajv2020['compile']> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(provenanceSubschema());
}

describe('contract-provenance (RFC 0146, always-on)', () => {
  it('A1 — declared at the document ROOT, and OPTIONAL', () => {
    const caps = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'),
    ) as { properties: Record<string, unknown>; required?: string[] };

    expect(
      caps.properties['contractProvenance'],
      why('capabilities.schema.json', 'declared as a root property — families live at the document root per capabilities.md §"Document-root layout", never under the deprecated wrapper'),
    ).toBeDefined();
    expect(
      (caps.required ?? []).includes('contractProvenance'),
      why('RFC 0146 req 1', 'OPTIONAL — absent means UNSPECIFIED provenance, not "current" and not "stale"; a host must not be non-conformant for staying silent'),
    ).toBe(false);
  });

  it('A2 — a full 40-hex commit validates; a short SHA or a vendor build string does NOT', () => {
    const validate = compiled();

    expect(
      validate({ suiteVersion: '1.72.0', corpusCommit: '93d4692eb1e28244b860da6ddcb6521b57a712b3' }),
      why('RFC 0146 req 4', `a real stamp validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    // This is what keeps the field from decaying into a free-text version box. A short SHA is
    // ambiguous across a growing history; a vendor build id belongs in `implementation`, which
    // already exists for exactly that.
    expect(
      validate({ corpusCommit: '93d4692' }),
      why('RFC 0146 req 4', 'a SHORT sha is REJECTED — abbreviated commits are ambiguous and this field is an identity, not a hint'),
    ).toBe(false);
    expect(
      validate({ corpusCommit: 'build-4711' }),
      why('RFC 0146 req 4', 'a vendor build identifier is REJECTED — `implementation` is the field for that'),
    ).toBe(false);
  });

  it('A3 — both members optional, and unknown members rejected', () => {
    const validate = compiled();

    expect(validate({}), why('RFC 0146 req 1', 'an empty object validates — a host may know neither')).toBe(true);
    expect(
      validate({ suiteVersion: '1.72.0' }),
      why('RFC 0146 req 1', 'a host that knows only its suite version advertises only that'),
    ).toBe(true);
    expect(
      validate({ suiteVersion: '1.72.0', schemaDigest: 'abc' }),
      why('RFC 0146 §Proposal', 'the object is closed — a digest is a DIFFERENT artifact answering a different question (tamper vs identity) and is deliberately not part of this shape'),
    ).toBe(false);
  });

  it('A4 — the RFC states the advisory rule, which is what stops this becoming an upgrade mandate', () => {
    const rfc = readFileSync(
      join(SCHEMAS_DIR, '..', 'RFCS', '0146-contract-provenance-advertisement.md'),
      'utf8',
    );
    expect(
      /MUST NOT reject a request, refuse interop, or fail a run solely because/.test(rfc),
      why('RFC 0146 req 3', 'a consumer MUST NOT reject on a mismatch — v1.x revisions are additive, so a host on an older revision is CONFORMANT and the field detects drift rather than creating an error'),
    ).toBe(true);
  });
});

describe('contract-provenance: a host advertising it makes a well-formed claim (RFC 0146)', () => {
  it('the advertised provenance validates against the declared shape', async () => {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200 || res.json === null || res.json === undefined) return;

    const doc = res.json as Record<string, unknown>;
    const adv = doc['contractProvenance'];
    // INAPPLICABLE, not gated. The field is OPTIONAL (req 1) and strict mode must not coerce a
    // host into advertising — the same call RFC 0142 makes for `store` and RFC 0145 for
    // `registrationSource`. Silence is an honest answer here.
    if (adv === undefined) return;

    expect(
      compiled()(adv),
      driver.describe(
        'capabilities.schema.json §contractProvenance',
        `an advertised contractProvenance MUST match the declared shape — a full 40-hex corpusCommit and a published suiteVersion, nothing else: ${JSON.stringify(compiled().errors)}`,
      ),
    ).toBe(true);
  });
});
