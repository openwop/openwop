#!/usr/bin/env node
/**
 * check-lane-revocation-rules — the lane → revocation-rule map exists on three
 * surfaces, and nothing kept them in agreement.
 *
 *   1. `spec/v2/core/identity.md` §2.2 — the normative table. One row per lane;
 *      its last column names the `revocation` value(s) that lane may advertise.
 *   2. `spec/v2/facets/auth.schema.json` — the `revocation` enum, which is what
 *      actually validates a host's advertisement.
 *   3. `conformance/src/scenarios/v2-lane-issuer-advertised.test.ts` —
 *      `LANE_RULES`, the map the suite enforces against a live host.
 *
 * Surface 2 relates `revocation` to `lane` NOWHERE, so any of the members was
 * schema-valid on any of the lanes; surface 3 did not exist until suite 2.36.0.
 * The divergence that produced this gate: a production host advertising
 * `short-lived` — a rule the table states only for `mtls`, as an obligation on
 * the party that ISSUES the credential — on an `oidc` lane, passing every check
 * the corpus had (RFC 0210 §G, §Motivation 3).
 *
 * Fails when:
 *   - the table cannot be parsed, or names a lane the facet's `lane` enum does
 *     not have (or vice versa);
 *   - the facet's `revocation` enum is not exactly the union of the rules the
 *     table names;
 *   - the suite's `LANE_RULES` is not byte-equal, as a map, to the table.
 *
 * Exit 0 on success, 1 on any failure.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDENTITY = join(ROOT, 'spec', 'v2', 'core', 'identity.md');
const FACET = join(ROOT, 'spec', 'v2', 'facets', 'auth.schema.json');
const SCENARIO = join(ROOT, 'conformance', 'src', 'scenarios', 'v2-lane-issuer-advertised.test.ts');

const failures = [];
const fail = (m) => failures.push(m);

/** `identity.md` §2.2's table: lane → sorted rule list, or null for an em-dash cell. */
function tableRules() {
  const md = readFileSync(IDENTITY, 'utf8');
  // The §2.2 section only, so a later table cannot be read as this one.
  const sec = md.split(/^### 2\.2 /m)[1]?.split(/^### /m)[0];
  if (sec === undefined) { fail(`${IDENTITY}: no "### 2.2" section — the lane/revocation table could not be located`); return null; }
  const out = {};
  for (const line of sec.split('\n')) {
    if (!line.startsWith('| `')) continue;
    // Escaped pipes (`crl \| ocsp`) are cell CONTENT, not separators.
    const cells = line.replace(/\\\|/g, '\u0000').split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4) { fail(`${IDENTITY} §2.2: table row has ${cells.length} cells, expected 4: ${line.slice(0, 60)}`); continue; }
    const lane = cells[0].replace(/`/g, '').trim();
    const cell = cells[3].trim();
    if (cell === '—' || cell === '-' || cell === '') { out[lane] = null; continue; }
    // `crl \| ocsp \| short-lived` — the pipes are escaped inside a table cell.
    const rules = cell.split('\u0000').map((r) => r.replace(/`/g, '').trim()).filter(Boolean);
    if (rules.length === 0 || rules.some((r) => !/^[a-z][a-z0-9-]*$/.test(r))) { fail(`${IDENTITY} §2.2: lane \`${lane}\` has an unparseable revocation cell ${JSON.stringify(cell)}`); continue; }
    out[lane] = rules.slice().sort();
  }
  if (Object.keys(out).length === 0) { fail(`${IDENTITY} §2.2: parsed 0 lane rows — the table shape changed and this gate went silent`); return null; }
  return out;
}

/** The suite's enforced map, parsed out of the scenario's `LANE_RULES` literal. */
function suiteRules() {
  const src = readFileSync(SCENARIO, 'utf8');
  const block = /const LANE_RULES: Record<string, string\[\] \| null> = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) { fail(`${SCENARIO}: no \`LANE_RULES\` literal — the suite's enforced map could not be located`); return null; }
  const out = {};
  for (const m of block[1].matchAll(/^\s*'([a-z][a-z0-9-]*)':\s*(\[[^\]]*\]|null),/gm)) {
    out[m[1]] = m[2] === 'null' ? null : [...m[2].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1]).sort();
  }
  if (Object.keys(out).length === 0) { fail(`${SCENARIO}: \`LANE_RULES\` parsed to 0 entries`); return null; }
  return out;
}

const table = tableRules();
const suite = suiteRules();
const facet = JSON.parse(readFileSync(FACET, 'utf8'));
const laneProp = facet.properties?.lanes?.items?.properties ?? {};
const facetLanes = laneProp.lane?.enum ?? [];
const facetRules = laneProp.revocation?.enum ?? [];

if (table) {
  // 1. lane sets agree
  const tLanes = Object.keys(table).sort();
  const fLanes = [...facetLanes].sort();
  if (JSON.stringify(tLanes) !== JSON.stringify(fLanes)) fail(`lane sets disagree — identity.md §2.2 has [${tLanes.join(', ')}]; auth.schema.json \`lane\` enum has [${fLanes.join(', ')}]`);

  // 2. the facet's revocation enum is exactly the union of the table's rules
  const union = [...new Set(Object.values(table).flatMap((r) => r ?? []))].sort();
  const fRules = [...facetRules].sort();
  if (JSON.stringify(union) !== JSON.stringify(fRules)) {
    const only = (a, b) => a.filter((x) => !b.includes(x));
    fail(`the \`revocation\` enum is not the union of §2.2's rules — in the schema only: [${only(fRules, union).join(', ') || 'none'}]; in the table only: [${only(union, fRules).join(', ') || 'none'}]. A member the table names for no lane is a value no host may legally advertise anywhere; a rule the table names that the schema lacks is unadvertisable.`);
  }

  // 4. `revocation` is optional on EXACTLY the lanes whose row reads "—".
  // identity.md §2.2 also says a host MUST NOT advertise a value its lane's row
  // does not list; a schema that required `revocation` on a "—" lane made that
  // lane unsatisfiable against both at once (the `anonymous` lane, until
  // 2026-09-24). Read statically: a top-level `required` naming it binds every
  // lane; otherwise an `allOf` member `{ if: lane ∈ X, else: required
  // [revocation] }` makes it optional on exactly X.
  const items = facet.properties?.lanes?.items ?? {};
  let optional = [];
  if (!(items.required ?? []).includes('revocation')) {
    const member = (items.allOf ?? []).find((m) => (m?.else?.required ?? []).includes('revocation') && m?.if?.properties?.lane);
    if (!member) fail('auth.schema.json: `revocation` is required on no lane at all — the lanes §2.2 gives a rule would stop being bound to advertise one');
    else {
      const l = member.if.properties.lane;
      optional = (l.const !== undefined ? [l.const] : l.enum ?? []).slice().sort();
    }
  }
  const dash = Object.entries(table).filter(([, r]) => r === null).map(([l]) => l).sort();
  if (JSON.stringify(optional) !== JSON.stringify(dash)) fail(`\`revocation\` is optional on [${optional.join(', ') || 'no lane'}] in auth.schema.json but §2.2's "—" rows are [${dash.join(', ') || 'none'}] — a "—" lane that must advertise a value cannot also advertise none, and a rule-bearing lane that may omit it states no latency`);

  // 3. the suite enforces the table, exactly
  if (suite) {
    for (const lane of new Set([...Object.keys(table), ...Object.keys(suite)])) {
      const t = lane in table ? table[lane] : undefined;
      const s = lane in suite ? suite[lane] : undefined;
      if (t === undefined) { fail(`conformance LANE_RULES has lane \`${lane}\`, which §2.2 does not`); continue; }
      if (s === undefined) { fail(`conformance LANE_RULES is missing lane \`${lane}\`, which §2.2 states — the suite would leave it unmeasured`); continue; }
      if (JSON.stringify(t) !== JSON.stringify(s)) fail(`lane \`${lane}\`: §2.2 says ${t === null ? 'no rule (—)' : `[${t.join(', ')}]`}; conformance LANE_RULES says ${s === null ? 'no rule (null)' : `[${s.join(', ')}]`}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`=== check-lane-revocation-rules FAILED — ${failures.length} problem(s) ===`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
const constrained = Object.values(table).filter((r) => r !== null).length;
console.log(`=== check-lane-revocation-rules OK — ${Object.keys(table).length} lane(s) in identity.md §2.2 (${constrained} with a stated rule), ${facetRules.length} revocation member(s), suite map in agreement ===`);
