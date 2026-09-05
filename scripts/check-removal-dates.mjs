#!/usr/bin/env node
/**
 * RFC 0178 §A.2 / charter §F "Deprecation" — every alias in deprecations.json
 * has a removal version; no removal has passed with the surface still present.
 *
 * A row is DUE when its removeIn major ≤ the highest protocol major the tree
 * serves (spec/v2/ exists ⇒ 2). A due row's sources must not exist in the tree
 * of that major: a `schemas/v2/...` or `api/v2/...` or `spec/v2/...` source
 * whose token is still present fails. v1 sources are the v1 tree and are
 * removed only at v1 end-of-support (removalTrigger), so they are reported, not
 * failed, while the overlap runs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(ROOT, 'spec', 'v1', 'deprecations.json'), 'utf8'));
const servedMajor = existsSync(join(ROOT, 'spec', 'v2')) ? 2 : 1;
// The v1 end-of-support clock (overview.md §v1 end-of-support) is GENERATED into
// evidence/v1-end-of-support.json by generate-v1-eos-clock.mjs; nothing else MAY
// set it. A `v1-end-of-support` row is DUE on or after `endOfSupportNotBefore`,
// and a due row's v1-tree sources FAIL. Both the file and "today" are
// overridable so the coherence test can drive this script in both directions —
// a gate that is green because the clock is unset prints the same nothing as
// one that is green because the date is far away, so the state is printed here.
const CLOCK_PATH = process.env['OPENWOP_EOS_CLOCK_FILE'] ?? join(ROOT, 'evidence', 'v1-end-of-support.json');
const TODAY = (process.env['OPENWOP_TODAY'] ?? new Date().toISOString()).slice(0, 10);
let clock = null;
try { clock = JSON.parse(readFileSync(CLOCK_PATH, 'utf8')); } catch { clock = null; }
const eosDate = typeof clock?.endOfSupportNotBefore === 'string' ? clock.endOfSupportNotBefore : null;
const eosDue = eosDate !== null && TODAY >= eosDate;
const clockState = clock === null ? `no clock file at ${CLOCK_PATH.replace(ROOT + '/', '')} (v1-end-of-support rows cannot be due)` : `v1 end-of-support ${eosDate ?? 'not anchored'} — ${clock.state ?? ''}; today ${TODAY}; ${eosDue ? 'DUE' : 'not due'}`;
// `removalTrigger` is a SET (RFC 0176 §C.2 gives one row two independent removal
// events); a bare string is the one-trigger form. Until 2026-09-04 this script
// printed "(removalTrigger governs)" and never read the field — the claim was
// decorative. Now it governs: a v2-tree source is a failure only for a row that
// carries `v2.0-cut`, because that is the event that removes it from v2; a row
// with `v1-end-of-support` alone keeps its v1-tree sources through the overlap
// by design, and its v2 absence is asserted by the scenarios, not by this file.
const triggersOf = (e) => (Array.isArray(e.removalTrigger) ? e.removalTrigger : e.removalTrigger ? [e.removalTrigger] : []);
const failures = []; let due = 0, present1 = 0, cutRows = 0, eosRows = 0;
for (const e of reg.entries) {
  if (!/^\d+\.\d+$/.test(e.removeIn ?? '')) { failures.push(`${e.id}: no removeIn version`); continue; }
  const triggers = triggersOf(e);
  if (triggers.includes('v2.0-cut')) cutRows++;
  if (triggers.includes('v1-end-of-support')) eosRows++;
  if (Number(e.removeIn.split('.')[0]) > servedMajor) continue;
  due++;
  for (const s of e.sources ?? []) {
    const p = join(ROOT, s.file); if (!existsSync(p)) continue;
    const present = readFileSync(p, 'utf8').includes(s.token);
    if (!present) continue;
    const inV2Tree = /^(schemas|api|spec)\/v2\//.test(s.file);
    if (inV2Tree && (triggers.length === 0 || triggers.includes('v2.0-cut'))) {
      failures.push(`${e.id}: removal ${e.removeIn} has passed${triggers.length ? ' (trigger v2.0-cut)' : ''} and ${s.file} still carries \`${s.token}\``);
    } else if (!inV2Tree && eosDue && triggers.includes('v1-end-of-support')) {
      failures.push(`${e.id}: v1 end-of-support ${eosDate} has passed (today ${TODAY}) and ${s.file} still carries \`${s.token}\` — the v1 representation MUST drop it (overview.md §v1 end-of-support)`);
    } else if (!inV2Tree) {
      present1++;
    }
  }
}
if (failures.length) { console.error('=== check-removal-dates FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`check-removal-dates clock: ${clockState}`);
console.log(`=== check-removal-dates OK —${reg.entries.length} rows all carry removeIn; served major ${servedMajor}; ${due} row(s) due, none present in the v2 tree; ${present1} v1-tree source(s) remain through the overlap; triggers: ${cutRows} row(s) v2.0-cut, ${eosRows} row(s) v1-end-of-support (removalTrigger governs the v2-tree assertion) ===`);
