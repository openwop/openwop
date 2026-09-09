/**
 * v2-coherence-not-in-bundle — RFC 0168 §D.1; `spec/v2/core/conformance.md`
 * §"Two products, two ledgers".
 *
 * Suite 2.0.0. Corpus-coherence checks run in the spec repo's CI and MUST NOT
 * appear in a host bundle; the bundle schema forbids their ids. Unaided and
 * fixture-based — no host is consulted:
 *
 *   1. disjoint by construction: every id in `evidence/corpus-ledger.json`
 *      belongs to a scenario in `src/coherence/` and to none in
 *      `src/scenarios/` (a derived `openwop.it.<stem>.…` id resolves to its
 *      file; an explicit `req()` id is located by its literal in the sources),
 *      so a bundle produced from the scenarios directory cannot carry one.
 *   2. the bundle schema rejects a v3 fixture whose `results.requirements[]`
 *      carries an id under `openwop.it.spec-corpus-validity.` and accepts the
 *      same fixture under an `openwop.requirement.` id.
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §D.1
 * @see spec/v2/core/conformance.md §"Two products, two ledgers"
 * @see schemas/v2/certification-bundle.schema.json
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { SCHEMAS_DIR, SCENARIOS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { scenarioFileOfId } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { v2Validator } from '../lib/v2.js';
import { signBundleV3, witnessDigest, type BundleV3, type BundleV3Requirement } from '../lib/certification-bundle-v3.js';

const SECTION = 'conformance.md §"Two products, two ledgers" (RFC 0168 §D.1)';
const LEDGER = join(SCHEMAS_DIR, '..', 'evidence', 'corpus-ledger.json');
const COHERENCE_DIR = SCENARIOS_DIR === null ? null : join(SCENARIOS_DIR, '..', 'coherence');

function sources(dir: string): Map<string, string> {
  return new Map(readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

function bundleWith(rows: BundleV3Requirement[]): BundleV3 {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3',
    generatedAt: new Date().toISOString(),
    suite: { name: '@openwop/openwop-conformance', version: '2.0.0', targetMajor: 2, specArtifactsVersion: '2.0.0' },
    host: { name: 'fixture-host', version: '0.0.0', build: { kind: 'commit', id: 'fixture' } },
    discovery: { url: 'https://host.invalid/.well-known/openwop', sha256: 'a'.repeat(64), protocolVersions: ['2.0'], preferredVersion: '2.0' },
    claimedProfiles: [{ id: 'openwop-core-v2', evidenceTier: 'self', witnessCount: rows.length, certified: true }],
    results: { totals: { executedPass: rows.length, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 }, requirements: rows },
    witnessSha256: witnessDigest(rows),
    assertionCount: rows.reduce((n, r) => n + (r.assertions ?? 0), 0),
  };
  return { ...unsigned, signature: signBundleV3(unsigned, pem, 'fixture-host-key') };
}

describe('v2-coherence-not-in-bundle (RFC 0168 §D.1)', () => {
  it('every corpus-ledger id has a scenario in src/coherence and none in src/scenarios — the two id sets are disjoint by construction', () => {
    // rc.57: `inapplicable`, not `blocked`. The subject of this scenario is the
    // CORPUS — it reads evidence/corpus-ledger.json and the two source
    // directories and asserts nothing about a host. RFC 0148 §A defines
    // `blocked` over ADVERTISED behaviour a missing dependency prevented
    // exercising; there is none here, and `blocked` denied certification
    // bundle-wide (RFC 0168 §E.1) to every host running the published tarball,
    // which ships neither the ledger nor src/coherence. Same reasoning as
    // lib/spec-coherence.ts for the v1 corpus scenarios; the reference host
    // carried this row as one of its "16 blocked" since rc.16.
    if (!existsSync(LEDGER)) return softSkip('inapplicable', 'inapplicable to any host: evidence/corpus-ledger.json is absent from this layout — the subject of this scenario is the corpus, which the published tarball does not ship; it runs in a spec checkout (scripts/check-spec-coherence.mjs) and needs no host');
    if (SCENARIOS_DIR === null || COHERENCE_DIR === null || !existsSync(COHERENCE_DIR)) return softSkip('inapplicable', 'inapplicable to any host: src/scenarios or src/coherence is absent from this layout — the subject of this scenario is the corpus, which the published tarball does not ship; it runs in a spec checkout and needs no host');
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as { requirements: Record<string, unknown> };
    const ids = Object.keys(ledger.requirements);
    expect(ids.length, req('openwop.requirement.0168.coherence-not-in-bundle.disjoint-by-construction', SECTION, 'the corpus ledger MUST carry at least one requirement id')).toBeGreaterThan(0);
    const coherence = sources(COHERENCE_DIR);
    const scenarios = sources(SCENARIOS_DIR);
    const coherenceText = [...coherence.values()].join('\n');
    const scenariosText = [...scenarios.values()].join('\n');
    for (const id of ids) {
      // `openwop.profile.*` / `openwop.family.*` are capability-GATE rows minted
      // at run time by gateFamily(), not by a `req()` literal and not derived
      // from a file. The same gate id is recorded by a corpus run and a host run
      // alike, so it is shared by construction and carries no corpus content —
      // the disjointness rule does not reach it.
      if (id.startsWith('openwop.profile.') || id.startsWith('openwop.family.')) continue;
      const file = scenarioFileOfId(id);
      if (file !== null) {
        expect(coherence.has(file), req('openwop.requirement.0168.coherence-not-in-bundle.disjoint-by-construction', SECTION, `${id} MUST belong to a src/coherence scenario (${file})`)).toBe(true);
        expect(scenarios.has(file), req('openwop.requirement.0168.coherence-not-in-bundle.disjoint-by-construction', SECTION, `${id} MUST NOT belong to a src/scenarios file (${file}) — it would enter a host bundle`)).toBe(false);
      } else {
        const literal = `'${id}'`;
        expect(coherenceText.includes(literal), req('openwop.requirement.0168.coherence-not-in-bundle.disjoint-by-construction', SECTION, `${id} MUST be cited by req() in a src/coherence scenario`)).toBe(true);
        expect(scenariosText.includes(literal), req('openwop.requirement.0168.coherence-not-in-bundle.disjoint-by-construction', SECTION, `${id} MUST NOT be cited by req() in a src/scenarios file — it would enter a host bundle`)).toBe(false);
      }
    }
  });

  it('the bundle schema rejects a v3 bundle carrying a corpus-coherence id and accepts one under openwop.requirement.', () => {
    const validate = v2Validator('certification-bundle');
    const corpusRow: BundleV3Requirement = { id: 'openwop.it.spec-corpus-validity.every-fixture-validates', scenario: 'spec-corpus-validity.test.ts', result: 'executed-pass', assertions: 1 };
    const hostRow: BundleV3Requirement = { id: 'openwop.requirement.0168.coherence-not-in-bundle.fixture', scenario: 'v2-coherence-not-in-bundle.test.ts', result: 'executed-pass', assertions: 1 };
    const control = validate(bundleWith([hostRow]));
    expect(control.ok, req('openwop.requirement.0168.coherence-not-in-bundle.schema-forbids-coherence-ids', SECTION, `a v3 bundle whose rows are openwop.requirement. ids MUST validate (${control.errors})`)).toBe(true);
    const tainted = validate(bundleWith([hostRow, corpusRow]));
    expect(tainted.ok, req('openwop.requirement.0168.coherence-not-in-bundle.schema-forbids-coherence-ids', SECTION, 'a v3 bundle carrying an openwop.it.spec-corpus-validity. id MUST be rejected by the bundle schema')).toBe(false);
  });
});
