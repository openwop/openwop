/**
 * RFC 0210 §C and §G — the two corpus rows: `exp-only` is refused on the two lanes the
 * host issues for itself, and the three surfaces that carry the lane → rule map cannot
 * drift apart.
 *
 * Corpus-gate only (RFC 0168 §D.1); these rows never reach a host bundle.
 *
 * §C.8 is a schema restriction, so it is measured by validating documents — a positive
 * that MUST be accepted, and two negatives that MUST be refused. Each negative is also
 * validated against a copy of the facet with ONLY the `if`/`then` removed, and MUST pass
 * there: without that second run a negative could be failing for any other reason (a
 * missing REQUIRED field, a typo in a lane name) and the row would be measuring the
 * wrong clause.
 *
 * §G.14 is a gate, so asserting `exit 0` on a clean tree would pass just as happily with
 * the gate's body deleted. Each leg instead breaks ONE surface in a throwaway copy of
 * the corpus and asserts the refusal names it.
 *
 * @see spec/v2/facets/auth.schema.json
 * @see scripts/check-lane-revocation-rules.mjs
 * @see RFCS/0210-lane-revocation-rule-is-measured.md §C, §G
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ROOT = join(SCHEMAS_DIR, '..');
const FACET = join(ROOT, 'spec', 'v2', 'facets', 'auth.schema.json');
const GATE = join(ROOT, 'scripts', 'check-lane-revocation-rules.mjs');

interface LaneItems { readonly [k: string]: unknown }

/** The `auth.lanes[]` item subschema — the thing §C.8's `if`/`then` lives on. */
function laneItems(raw: string): LaneItems {
  const facet = JSON.parse(raw) as { properties: { lanes: { items: LaneItems } } };
  return facet.properties.lanes.items;
}

function validator(items: LaneItems): (doc: unknown) => boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(items) as unknown as (doc: unknown) => boolean;
}

const lane = (name: string, revocation: string): Record<string, unknown> => ({
  lane: name,
  issuers: name === 'api-key' ? ['urn:example:api-key'] : name === 'session' ? ['urn:example:session'] : ['https://idp.example'],
  revocation,
  revocationWindowSeconds: 3600,
  minimumAssurance: 'bearer',
});

/**
 * A throwaway copy of the corpus. These legs mutate tracked files to prove a gate
 * refuses them; doing that in place races every other coherence test in the same vitest
 * run (v2-spec-artifacts-digest compares the packed tree against the corpus).
 */
function inScratchCorpus(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0210-'));
  try {
    for (const p of ['scripts', 'spec']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    const scen = join(dir, 'conformance', 'src', 'scenarios');
    mkdirSync(scen, { recursive: true });
    cpSync(join(ROOT, 'conformance', 'src', 'scenarios', 'v2-lane-issuer-advertised.test.ts'), join(scen, 'v2-lane-issuer-advertised.test.ts'));
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const runGate = (dir: string): { code: number; out: string } => {
  const r = spawnSync('node', [join(dir, 'scripts', 'check-lane-revocation-rules.mjs')], { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status ?? -1, out: `${String(r.stdout ?? '')}${String(r.stderr ?? '')}` };
};

describe('v2-lane-exp-only-schema (RFC 0210 §C, §G)', () => {
  it('exp-only validates on a JWT lane and is refused on api-key and session, and only the §C.8 clause refuses it', () => {
    if (V1_DIR === null || !existsSync(FACET)) return softSkip('inapplicable', 'not a spec checkout — spec/v2/facets/auth.schema.json is not in this layout');
    const raw = readFileSync(FACET, 'utf8');
    const strict = validator(laneItems(raw));

    for (const name of ['oauth2', 'oidc']) {
      expect(
        strict(lane(name, 'exp-only')),
        req('openwop.requirement.0210.exp-only-lane-restricted', 'spec/v2/facets/auth.schema.json', `an ${name} lane advertising exp-only with a window MUST validate — the restriction is on api-key and session, and a schema that refused the member outright would make §A unadvertisable`),
      ).toBe(true);
    }

    // The clause under test, removed and nothing else — the control that proves each
    // negative below fails for §C.8 and not for some unrelated defect in the fixture.
    const relaxedSrc = JSON.parse(raw) as { properties: { lanes: { items: Record<string, unknown> } } };
    delete relaxedSrc.properties.lanes.items['if'];
    delete relaxedSrc.properties.lanes.items['then'];
    const relaxed = validator(relaxedSrc.properties.lanes.items);

    for (const name of ['api-key', 'session']) {
      expect(
        strict(lane(name, 'exp-only')),
        req('openwop.requirement.0210.exp-only-lane-restricted', 'spec/v2/facets/auth.schema.json', `a ${name} lane advertising exp-only MUST be refused — the host issued that credential itself, so revocation is in its own hands and "I only honour exp" is not an available excuse (§C.8)`),
      ).toBe(false);
      expect(
        relaxed(lane(name, 'exp-only')),
        req('openwop.requirement.0210.exp-only-lane-restricted', 'spec/v2/facets/auth.schema.json', `the same ${name} document MUST validate once the §C.8 if/then is removed — otherwise the negative above proves nothing about §C.8`),
      ).toBe(true);
      // And the member the table DOES list for that lane still validates, strictly.
      expect(
        strict(lane(name, 'next-request')),
        req('openwop.requirement.0210.exp-only-lane-restricted', 'spec/v2/facets/auth.schema.json', `the restriction is scoped to the new member: ${name} with next-request MUST still validate`),
      ).toBe(true);
    }
  }, 60_000);

  it('the gate refuses an enum member with no §2.2 row, and a suite map the table does not license', () => {
    if (V1_DIR === null || !existsSync(GATE)) return softSkip('inapplicable', 'not a spec checkout — scripts/check-lane-revocation-rules.mjs is not published with the suite');
    const ID = 'openwop.requirement.0210.lane-rule-surfaces-agree';

    inScratchCorpus((dir) => {
      const clean = runGate(dir);
      expect(clean.code, req(ID, 'scripts/check-lane-revocation-rules.mjs', `the gate MUST pass on the committed tree before any sabotage is believed (exit ${clean.code}: ${clean.out.trim().slice(-300)})`)).toBe(0);
    });

    // S4 — a member reaches the facet enum that §2.2's table names for no lane. That is
    // a value no host may legally advertise anywhere, and it is exactly the shape a
    // vocabulary widening takes when the prose is forgotten.
    inScratchCorpus((dir) => {
      const p = join(dir, 'spec', 'v2', 'facets', 'auth.schema.json');
      const f = JSON.parse(readFileSync(p, 'utf8')) as { properties: { lanes: { items: { properties: { revocation: { enum: string[] } } } } } };
      f.properties.lanes.items.properties.revocation.enum.push('exp-and-hope');
      writeFileSync(p, `${JSON.stringify(f, null, 2)}\n`);
      const r = runGate(dir);
      expect(r.code, req(ID, 'scripts/check-lane-revocation-rules.mjs', 'an enum member with no §2.2 row MUST fail the gate')).toBe(1);
      expect(r.out.includes('exp-and-hope'), req(ID, 'scripts/check-lane-revocation-rules.mjs', `the refusal MUST name the member that diverged, or the gate reports a state rather than a cause (got: ${r.out.trim().slice(-300)})`)).toBe(true);
    });

    // S5 — the suite's enforced map is widened without the table. This is the direction
    // that matters most: the map is what actually fails a host, so a map wider than the
    // table silently re-opens the laundering hatch §D.9 was written to close.
    inScratchCorpus((dir) => {
      const p = join(dir, 'conformance', 'src', 'scenarios', 'v2-lane-issuer-advertised.test.ts');
      const src = readFileSync(p, 'utf8').replace("'oidc': ['exp-and-recheck', 'exp-only'],", "'oidc': ['exp-and-recheck', 'exp-only', 'short-lived'],");
      writeFileSync(p, src);
      const r = runGate(dir);
      expect(r.code, req(ID, 'scripts/check-lane-revocation-rules.mjs', 'a LANE_RULES entry §2.2 does not license MUST fail the gate')).toBe(1);
      expect(r.out.includes('oidc') && r.out.includes('short-lived'), req(ID, 'scripts/check-lane-revocation-rules.mjs', `the refusal MUST name the lane and the rule (got: ${r.out.trim().slice(-300)})`)).toBe(true);
    });
  }, 120_000);
});
