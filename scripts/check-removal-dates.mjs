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
// RFC 0197 §A.2 test seams — the register, the release identity and the root the
// `sources[].file` paths resolve against are overridable, so the coherence twin
// can drive a `v2-minor` fixture row in both directions without writing into the
// real register. Unset, they are the corpus's own files.
const REGISTER_PATH = process.env['OPENWOP_DEPRECATIONS_FILE'] ?? join(ROOT, 'spec', 'v1', 'deprecations.json');
const RELEASE_PATH = process.env['OPENWOP_V2_RELEASE_FILE'] ?? join(ROOT, 'spec', 'v2', 'release.json');
const SOURCE_ROOT = process.env['OPENWOP_REMOVAL_SOURCE_ROOT'] ?? ROOT;
const reg = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
const servedMajor = existsSync(join(ROOT, 'spec', 'v2')) ? 2 : 1;
// RFC 0197 §A.2 — the MINOR axis. Until this landed the script compared MAJORS
// only ("removeIn major ≤ the served major ⇒ due"), so a row scheduled for
// `2.40` was due the instant it was written and no deprecation window could
// exist INSIDE the major. That is the mechanism the RFC's §Motivation says was
// missing. A `v2-minor` row is due when the RELEASED v2 version has reached its
// `removeIn`, read from spec/v2/release.json — the one release identity the v2
// artifacts derive from (RFC 0172 §D.1). Every other row keeps the major rule
// unchanged, which is why all 47 rows in the register today are unaffected.
const v2Release = (() => { try { return JSON.parse(readFileSync(RELEASE_PATH, 'utf8')).version ?? null; } catch { return null; } })();
const minorOf = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v ?? '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const cmpMinor = (a, b) => { const x = minorOf(a), y = minorOf(b); if (!x || !y) return NaN; return x[0] !== y[0] ? Math.sign(x[0] - y[0]) : Math.sign(x[1] - y[1]); };
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
const minorRows = []; let minorDue = 0;
for (const e of reg.entries) {
  if (!/^\d+\.\d+$/.test(e.removeIn ?? '')) { failures.push(`${e.id}: no removeIn version`); continue; }
  const triggers = triggersOf(e);
  if (triggers.includes('v2.0-cut')) cutRows++;
  if (triggers.includes('v1-end-of-support')) eosRows++;
  // ── RFC 0197 §A.2 / §A.3: the minor-granular lane ────────────────────────
  if (triggers.includes('v2-minor')) {
    if (v2Release === null) { failures.push(`${e.id}: carries removalTrigger v2-minor but spec/v2/release.json could not be read at ${RELEASE_PATH} — a minor-granular removal has no clock without it`); continue; }
    const isDue = cmpMinor(v2Release, e.removeIn) >= 0;
    const persistence = e.retirement?.persistence ?? 'advertised';
    minorRows.push(`${e.id} removeIn ${e.removeIn} (${persistence}) — ${isDue ? `DUE at v2 release ${v2Release}` : `not due at v2 release ${v2Release}`}`);
    if (!isDue) continue;
    minorDue++;
    for (const s of (e.sources ?? []).filter((s) => /^(schemas|api|spec)\/v2\//.test(s.file))) {
      const p = join(SOURCE_ROOT, s.file);
      const text = existsSync(p) ? readFileSync(p, 'utf8') : null;
      const present = text !== null && text.includes(s.token);
      if (persistence === 'advertised') {
        // The schema DROPS the member at removeIn (a family, a facet, an
        // advertised enum value). Still present ⇒ the removal did not happen.
        if (present) failures.push(`${e.id}: the v2 release ${v2Release} has reached removeIn ${e.removeIn} (trigger v2-minor, advertised class) and ${s.file} still carries \`${s.token}\` — remove it, or reschedule removeIn to 3.0`);
      } else {
        // Persisted class (§A.3): the READER schema keeps the member, annotated
        // `x-openwop-retired-in`; only emission narrows. Losing it is the defect
        // this lane exists to prevent — a replayed log stops validating.
        if (text === null) failures.push(`${e.id}: persisted-class retirement cites ${s.file}, which does not exist — a reader schema that lost the member breaks replay, fork and poll (RFC 0197 §A.3)`);
        else if (!present) failures.push(`${e.id}: persisted-class retirement — ${s.file} no longer carries \`${s.token}\`. A retirement narrows EMISSION only; the reader MUST keep accepting the shape for the life of the major (RFC 0197 §A.3)`);
        else if (!text.includes(`"x-openwop-retired-in": "${e.removeIn}"`)) failures.push(`${e.id}: persisted-class retirement — ${s.file} carries \`${s.token}\` but no \`"x-openwop-retired-in": "${e.removeIn}"\` annotation; an unannotated member is indistinguishable from one a host may still emit`);
      }
    }
    continue;
  }
  if (Number(e.removeIn.split('.')[0]) > servedMajor) continue;
  due++;
  for (const s of e.sources ?? []) {
    const p = join(SOURCE_ROOT, s.file); if (!existsSync(p)) continue;
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
// The minor lane prints its own state for the same reason the clock does: zero
// v2-minor rows and a minor comparison that never ran print the same nothing.
console.log(`check-removal-dates v2 minor lane (RFC 0197 §A.2): v2 release ${v2Release ?? 'UNREADABLE'}; ${minorRows.length} row(s) with trigger v2-minor, ${minorDue} due`);
for (const l of minorRows) console.log(`  ${l}`);
console.log(`=== check-removal-dates OK —${reg.entries.length} rows all carry removeIn; served major ${servedMajor}; ${due} row(s) due, none present in the v2 tree; ${present1} v1-tree source(s) remain through the overlap; triggers: ${cutRows} row(s) v2.0-cut, ${eosRows} row(s) v1-end-of-support, ${minorRows.length} row(s) v2-minor (removalTrigger governs the v2-tree assertion) ===`);
