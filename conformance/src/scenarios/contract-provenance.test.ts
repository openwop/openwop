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
 * THE CONSUMER HALF (RFC 0146 G3). A provenance nobody reads is a field, not a mechanism, so
 * this suite reads it: leg C compares a host's advertised revision against the suite's OWN
 * `schemas/CORPUS-STAMP.json` and REPORTS the drift. It is the second half of G3 — the first
 * being a host that advertises.
 *
 * IT REPORTS AND NEVER FAILS, and that is requirement 3, not timidity. v1.x revisions are
 * additive, so a host on an older corpus is CONFORMANT; a leg that reddened it would convert
 * an advisory disclosure into an upgrade mandate inside a version line where being behind is
 * legal. The same call the RFC 0144 G1 arm-witness leg makes for dotted-at-root.
 *
 * THE STAMP ONLY EXISTS IN THE PUBLISHED LAYOUT. It is written at prepack into the vendored
 * `schemas/`, never into the repo tree — so a repo-layout run has nothing to compare against
 * and the leg is INAPPLICABLE there. That asymmetry already bit once: when the stamp landed,
 * "written only into the tarball" and "visible to the gate" turned out to be different claims,
 * and only forcing the published layout revealed it. Verified the same way here.
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

  // `RFCS/` is NOT shipped in the published tarball, so this leg is repo-layout only. Reading
  // it unconditionally made the scenario ENOENT for every adopter running from the package —
  // passing locally and reddening for a reason that has nothing to do with the host under
  // test, which is worse than a no-op. Third instance of this asymmetry in this corpus; the
  // first two were the CORPUS-STAMP gate and the link-checker's filesystem walk.
  const rfcText = ((): string | null => {
    try {
      return readFileSync(
        join(SCHEMAS_DIR, '..', 'RFCS', '0146-contract-provenance-advertisement.md'),
        'utf8',
      );
    } catch {
      return null;
    }
  })();

  it.skipIf(rfcText === null)('A4 — the RFC states the advisory rule, which is what stops this becoming an upgrade mandate', () => {
    const rfc = rfcText ?? '';
    expect(
      /MUST NOT reject a request, refuse interop, or fail a run solely because/.test(rfc),
      why('RFC 0146 req 3', 'a consumer MUST NOT reject on a mismatch — v1.x revisions are additive, so a host on an older revision is CONFORMANT and the field detects drift rather than creating an error'),
    ).toBe(true);
  });
});

/** The suite's OWN provenance, from the vendored stamp — present only in the published layout. */
function suiteStamp(): { suiteVersion?: string; corpusCommit?: string } | null {
  try {
    return JSON.parse(readFileSync(join(SCHEMAS_DIR, 'CORPUS-STAMP.json'), 'utf8')) as {
      suiteVersion?: string;
      corpusCommit?: string;
    };
  } catch {
    // Repo layout: no stamp is written into the tree, so there is nothing to compare against.
    return null;
  }
}

describe('contract-provenance: the suite READS the advert — the consumer half (RFC 0146 G3)', () => {
  it('compares the advertised revision against the suite\'s own, and reports drift', async () => {
    const mine = suiteStamp();
    if (mine === null) return; // repo layout — inapplicable, see the docblock

    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200 || res.json === null || res.json === undefined) return;
    const adv = (res.json as Record<string, unknown>)['contractProvenance'] as
      | { suiteVersion?: string; corpusCommit?: string }
      | undefined;
    if (adv === undefined) return; // silent host — absent means UNSPECIFIED (req 1), not stale

    const same = adv.corpusCommit !== undefined && adv.corpusCommit === mine.corpusCommit;
    console.log(
      `  [contract-provenance] host: suite=${adv.suiteVersion ?? '?'} commit=${(adv.corpusCommit ?? '?').slice(0, 12)} | ` +
        `this suite: suite=${mine.suiteVersion ?? '?'} commit=${(mine.corpusCommit ?? '?').slice(0, 12)} | ` +
        `${same ? 'SAME corpus revision' : 'DIFFERENT corpus revision — the host implements a revision this suite was not cut from'}`,
    );

    // NO ASSERTION ON EQUALITY, deliberately. Requirement 3: a consumer MUST NOT reject or
    // fail solely because a host's provenance differs from its own — additive means older is
    // CONFORMANT. What IS asserted is that a host making the claim makes a well-formed one,
    // because an unparseable provenance is useless to every consumer, not just this one.
    expect(
      typeof adv.corpusCommit === 'string' || typeof adv.suiteVersion === 'string',
      driver.describe(
        'RFC 0146 req 1 + req 4',
        'an advertised contractProvenance carries at least one of suiteVersion / corpusCommit — an object conveying neither is indistinguishable from silence while looking like an answer',
      ),
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
