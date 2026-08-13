/**
 * RFC 0148 §C — certification bundle v2.
 *
 * v1 recorded `{passed, failed, skipped}` as scenario-file lists. Those three
 * words cannot express the distinction this entire program turns on:
 *
 *   - a file counted as **passed** whether its assertions ran or its runner
 *     returned early — which is how a gated subtest that 404'd left a green file;
 *   - **skipped** flattened three different claims into one word: "the operator
 *     excluded this", "the requirement does not apply here", and "we could not
 *     check". The first two are certifiable. The third invalidates the claim,
 *     and v1 had no way to say it.
 *
 * v2 replaces the lists with per-requirement dispositions from §A and adds the
 * counts §A.4 requires. Two properties are load-bearing and are what these legs
 * defend:
 *
 *   - **`blocked` is a required total.** `blocked: 0` asserted is a different
 *     claim from `blocked` unstated, and an omitted total is indistinguishable
 *     from zero.
 *   - **`assertionCount` makes a vacuous pass visible.** `executed-pass` with
 *     `assertionCount: 0` is exactly the shape RFC 0148 exists to close, and a
 *     reader can now see it in the artifact rather than having to re-run.
 *
 * Server-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const HEX = 'a'.repeat(64);

/**
 * Resolve the schema through `SCHEMAS_DIR`, not through `V1_DIR/../..`.
 *
 * The earlier form derived the repo root from the PROSE directory, which is
 * `null` in the published tarball because prose is not bundled — and then cast
 * the null away with `as string`. The cast satisfied the compiler and the file
 * still passed in a repo checkout, so nothing anywhere reported a problem;
 * installed from npm it threw at import and took the whole suite file down.
 *
 * Schemas ARE vendored into the package, so `SCHEMAS_DIR` is non-null in both
 * layouts. Reading through it does not merely stop the crash — it makes these
 * legs RUN for consumers, where before they could only have skipped.
 */
function validator() {
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'certification-bundle-v2.schema.json'), 'utf8'),
  ) as object;
  return new Ajv2020({ strict: false, allErrors: true }).compile(schema);
}

const bundle = (over: Record<string, unknown> = {}) => ({
  bundleVersion: '2',
  suite: { package: '@openwop/openwop-conformance', version: '1.92.0' },
  host: { name: 'example-host', version: '1.0.0' },
  discovery: { sha256: HEX, document: { protocolVersion: '1.0' } },
  claimedProfiles: ['openwop-core-standard'],
  results: {
    totals: { executedPass: 41, executedFail: 0, skipped: 2, inapplicable: 7, blocked: 0 },
    requirements: [
      { requirementId: 'openwop.floor.runs-lifecycle', scenarioId: 'runs-lifecycle', disposition: 'executed-pass', assertionCount: 3, witnessSha256: HEX },
    ],
  },
  scenarioManifestSha256: HEX,
  targetConfigurationSha256: HEX,
  ...over,
});

describe('RFC 0148 §C — certification bundle v2', () => {
  const validate = validator();

  it('a well-formed v2 bundle validates', () => {
    expect(validate(bundle()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('all five totals are required, including blocked', () => {
    // `blocked: 0` asserted is a different claim from `blocked` unstated. An
    // omitted total is indistinguishable from zero, and the one total that
    // invalidates a certification is the one most worth omitting.
    for (const missing of ['executedPass', 'executedFail', 'skipped', 'inapplicable', 'blocked']) {
      const totals: Record<string, number> = { executedPass: 1, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 };
      delete totals[missing];
      expect(
        validate(bundle({ results: { totals, requirements: bundle().results.requirements } })),
        `RFC 0148 §C: \`${missing}\` MUST be present — an omitted total reads as zero without ` +
          'anyone having asserted it',
      ).toBe(false);
    }
  });

  it('the requirement list cannot be empty', () => {
    expect(
      validate(bundle({ results: { totals: bundle().results.totals, requirements: [] } })),
      'RFC 0148 §C: a bundle with no requirement rows records no execution. An empty evidence set ' +
        'reading as proof is the defect this section exists to close.',
    ).toBe(false);
  });

  it('a disposition outside the §A vocabulary is rejected', () => {
    expect(
      validate(bundle({
        results: {
          totals: bundle().results.totals,
          requirements: [{ requirementId: 'x', scenarioId: 'y', disposition: 'probably-fine' }],
        },
      })),
    ).toBe(false);
  });

  it('a vacuous pass is representable and therefore visible', () => {
    // Deliberately VALID. The schema does not forbid `executed-pass` with zero
    // assertions — forbidding it would only move the lie one field over, since
    // a generator could write `assertionCount: 1`. What v2 buys is that the
    // number is IN the artifact, so a reader or a downstream verifier can see a
    // pass that executed nothing without re-running the suite.
    const b = bundle({
      results: {
        totals: bundle().results.totals,
        requirements: [{ requirementId: 'x', scenarioId: 'y', disposition: 'executed-pass', assertionCount: 0 }],
      },
    });
    expect(validate(b), JSON.stringify(validate.errors)).toBe(true);
    const rows = (b.results as { requirements: { disposition: string; assertionCount?: number }[] }).requirements;
    expect(
      rows.some((r) => r.disposition === 'executed-pass' && r.assertionCount === 0),
      'the vacuous shape MUST remain inspectable in the artifact — v1 could not express it at all',
    ).toBe(true);
  });

  it('claimed profiles use canonical IDs, not deprecated aliases', () => {
    // RFC 0155 §E. A badge substantiated by a name that no longer means what it
    // did is the `openwop-core` ambiguity in bundle form.
    expect(validate(bundle({ claimedProfiles: ['openwop-core-standard'] }))).toBe(true);
    expect(validate(bundle({ claimedProfiles: ['Legacy Core'] }))).toBe(false);
    expect(validate(bundle({ claimedProfiles: [] }))).toBe(false);
  });

  it('provenance digests are required and hex-shaped', () => {
    // Without `scenarioManifestSha256` a bundle cannot be distinguished from one
    // produced against a different, smaller suite; without
    // `targetConfigurationSha256`, from one against a differently-configured host.
    for (const field of ['scenarioManifestSha256', 'targetConfigurationSha256']) {
      const b = bundle() as Record<string, unknown>;
      delete b[field];
      expect(validate(b), `RFC 0147 §A.4: ${field} MUST be present`).toBe(false);
    }
    expect(validate(bundle({ scenarioManifestSha256: 'not-a-digest' }))).toBe(false);
  });

  it('bundleVersion is pinned to 2', () => {
    expect(validate(bundle({ bundleVersion: '1' })), 'a v1 bundle MUST NOT validate as v2').toBe(false);
  });
});
