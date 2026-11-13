/**
 * v2-sabotage-ledger — RFC 0263 (corpus gate; never reaches a host bundle).
 *
 * A row whose assertions cannot fail passes every bundle gate. RFC 0263 makes
 * the ability to fail a recorded fact: `evidence/sabotage-ledger.json` holds a
 * red run per cited id, and `check-accepted-predicate.mjs` refuses an
 * `Accepted` flip (from RFC 0260) whose ids have none. It also closes the gap
 * that let rule 4 pass with nothing to check: a Falsifiability table that
 * names no ids (RFCs 0258 and 0259 as filed).
 *
 * Legs, one id each. They run `check-sabotage-ledger.mjs`, the same code rules
 * 5 and 6 run (scripts/lib/sabotage-ledger.mjs), on fixture directories:
 *   - §A every witnessable row names an id, or says `planned`; from RFC 0260 a
 *     `planned` row blocks Accepted; the live tree passes;
 *   - §C an Accepted RFC from 0260 needs an executed-fail ledger row per id;
 *   - §B the ledger's shape, including that a certified bundle is not a red run.
 *
 * Each sabotage changes ONE input from a base the gate accepts, and asserts the
 * reason. The base passing is asserted in the same leg.
 *
 * Sabotages run 2026-11-13 (each turned its leg red, then was reverted):
 *   - `idRuleFailures`: drop the `row.ids.length > 0` skip, and the base fails;
 *     drop the `planned` exemption, and the Active planned fixture fails;
 *   - `sabotageRuleFailures`: drop the requirement-id match, and a red row for
 *     a different id counts (accepting any `result` is not a sabotage this
 *     leg can see: §B's shape check refuses an executed-pass row first);
 *   - `ledgerShapeFailures`: skip the certified-digest check, and the transplanted row passes.
 *
 * @see RFCS/0263-sabotage-ledger.md
 * @see scripts/lib/sabotage-ledger.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const corpusAbsent = (): boolean => V1_DIR === null;
const ABSENT = 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo';
const SPEC = 'RFC 0263 · scripts/check-accepted-predicate.mjs rules 5 and 6';

const ID_NAMES = 'openwop.requirement.0263.falsifiability-names-ids';
const ID_RECORDED = 'openwop.requirement.0263.sabotage-recorded-before-accepted';
const ID_SHAPE = 'openwop.requirement.0263.ledger-shape';

const LEG = 'openwop.requirement.0999.leg';
const DIGEST = 'a'.repeat(64);

function rfc(status: string, rows: string[]): string {
  return [
    '# RFC fixture', '', '| Field | Value |', '| --- | --- |', `| **Status**        | \`${status}\` |`, '',
    '## Conformance', '', '### Falsifiability — one row per normative requirement', '',
    '| Requirement | Observable | Who can cause it | Verdict |', '| --- | --- | --- | --- |', ...rows, '',
    '## Alternatives considered', '', 'None.', '',
  ].join('\n');
}
const ROW_ID = `| §A the rule | the event — \`${LEG}\` | the suite | witnessable — gated |`;
const ROW_BARE = '| §A the rule | the event | the suite | witnessable — gated |';
const ROW_PLANNED = '| §B the other rule | the event | the suite | witnessable — gated (planned: no leg yet) |';
const ROW_CLAIMS = '| §C the stated rule | — | the host | claims-check — the host states it |';

interface LedgerRow { [k: string]: unknown }
const redRow = (over: LedgerRow = {}): LedgerRow => ({
  requirementId: LEG, scenario: 'v2-fixture.test.ts', sabotage: 'the host emitted the event twice, and the leg turned red',
  subject: { host: 'v2-reference', build: 'commit:0123456' }, suiteVersion: '2.47.0', result: 'executed-fail', date: '2026-11-13', ...over,
});

/** Run the gate on one fixture corpus; returns exit status and output. */
function run(files: Record<string, string>, rows: LedgerRow[] = [], bundles: Record<string, unknown> = {}): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'owp-0263-'));
  mkdirSync(join(dir, 'rfcs')); mkdirSync(join(dir, 'bundles'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'rfcs', name), text);
  for (const [name, doc] of Object.entries(bundles)) writeFileSync(join(dir, 'bundles', name), JSON.stringify(doc));
  writeFileSync(join(dir, 'ledger.json'), JSON.stringify({ rows }));
  const r = spawnSync('node', [join(root, 'scripts', 'check-sabotage-ledger.mjs'), '--rfcs', join(dir, 'rfcs'), '--ledger', join(dir, 'ledger.json'), '--bundles', join(dir, 'bundles')], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('RFC 0263 — a cited row must be shown able to fail', () => {
  it('§A every witnessable Falsifiability row names an id or says planned', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    const live = spawnSync('node', [join(root, 'scripts', 'check-sabotage-ledger.mjs')], { encoding: 'utf8' });
    expect(live.status, req(ID_NAMES, SPEC, `the live tree MUST pass: ${live.stderr}`)).toBe(0);
    expect(run({ '0261-a.md': rfc('Active', [ROW_ID, ROW_PLANNED, ROW_CLAIMS]) }).status, req(ID_NAMES, SPEC, 'a table naming an id, a planned row and a claims-check row MUST pass at Active')).toBe(0);
    const bare = run({ '0261-a.md': rfc('Active', [ROW_BARE]) });
    expect(bare.status, req(ID_NAMES, SPEC, 'a witnessable row with no id and no `planned` MUST fail')).toBe(1);
    expect(bare.out, req(ID_NAMES, SPEC, 'the refusal MUST name §A')).toContain('names no requirement id');
    expect(run({ '0257-a.md': rfc('Active', [ROW_BARE]) }).status, req(ID_NAMES, SPEC, 'an RFC before 0258 is not in scope')).toBe(0);
    expect(run({ '0261-a.md': rfc('Draft', [ROW_BARE]) }).status, req(ID_NAMES, SPEC, 'a Draft RFC is not in scope')).toBe(0);
    const planned = run({ '0261-a.md': rfc('Accepted', [ROW_ID, ROW_PLANNED]) }, [redRow()]);
    expect(planned.status, req(ID_NAMES, SPEC, 'from RFC 0260 a planned row MUST block Accepted')).toBe(1);
    expect(planned.out, req(ID_NAMES, SPEC, 'the refusal MUST name the planned row')).toContain('Accepted with a `planned` witnessable row');
    expect(run({ '0259-a.md': rfc('Accepted', [ROW_ID, ROW_PLANNED]) }).status, req(ID_NAMES, SPEC, 'before RFC 0260 a planned row does not block Accepted')).toBe(0);
  });

  it('§C an Accepted RFC from 0260 has a red ledger row for every id it cites', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    const accepted = { '0261-a.md': rfc('Accepted', [ROW_ID, ROW_CLAIMS]) };
    expect(run(accepted, [redRow()]).status, req(ID_RECORDED, SPEC, 'an executed-fail row for the cited id MUST satisfy §C')).toBe(0);
    expect(run(accepted, [redRow({ requirementId: `${LEG}.sub-leg` })]).status, req(ID_RECORDED, SPEC, 'a red row on a leg under the cited id MUST satisfy §C')).toBe(0);
    const none = run(accepted);
    expect(none.status, req(ID_RECORDED, SPEC, 'with no ledger row the flip MUST fail')).toBe(1);
    expect(none.out, req(ID_RECORDED, SPEC, 'the refusal MUST name the id')).toContain(`${LEG} has no executed-fail row`);
    expect(run(accepted, [redRow({ requirementId: 'openwop.requirement.0999.other' })]).status, req(ID_RECORDED, SPEC, 'a red row for a different id MUST NOT satisfy §C')).toBe(1);
    expect(run({ '0261-a.md': rfc('Active', [ROW_ID]) }).status, req(ID_RECORDED, SPEC, '§C binds the Accepted flip, not Active')).toBe(0);
    expect(run({ '0259-a.md': rfc('Accepted', [ROW_ID]) }).status, req(ID_RECORDED, SPEC, 'an RFC before 0260 is not retroactively invalidated')).toBe(0);
  });

  it('§B the ledger records red runs, in a closed shape, never on a certified bundle', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    const files = { '0261-a.md': rfc('Active', [ROW_ID]) };
    expect(run(files, [redRow(), redRow({ witnessSha256: DIGEST })]).status, req(ID_SHAPE, SPEC, 'well-formed rows, one with a red digest, MUST pass')).toBe(0);
    const passed = run(files, [redRow({ result: 'executed-pass' })]);
    expect(passed.status, req(ID_SHAPE, SPEC, 'a sabotage that passed MUST fail the shape')).toBe(1);
    expect(passed.out, req(ID_SHAPE, SPEC, 'the refusal MUST say why')).toContain('result must be executed-fail');
    expect(run(files, [redRow({ note: 'x' })]).status, req(ID_SHAPE, SPEC, 'an unknown member MUST fail')).toBe(1);
    expect(run(files, [redRow({ sabotage: 'broke it' })]).status, req(ID_SHAPE, SPEC, 'a sabotage that does not say what was broken MUST fail')).toBe(1);
    expect(run(files, [redRow({ subject: { host: 'h' } })]).status, req(ID_SHAPE, SPEC, 'a subject without a build MUST fail')).toBe(1);
    const certified = { 'host.json': { witnessSha256: DIGEST, claimedProfiles: [{ id: 'openwop-core-standard', certified: true }] } };
    const transplanted = run(files, [redRow({ witnessSha256: DIGEST })], certified);
    expect(transplanted.status, req(ID_SHAPE, SPEC, "a row naming a certified bundle's digest MUST fail — that bundle recorded the pass")).toBe(1);
    expect(transplanted.out, req(ID_SHAPE, SPEC, 'the refusal MUST name the certified bundle')).toContain('names a certified committed bundle');
  });
});
