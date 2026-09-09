#!/usr/bin/env node
/**
 * check-waiver-authority — RFC 0174 §B.2: a waiver is checked for AUTHORITY at
 * merge, not only for presence (check-waiver-ledger.mjs does presence).
 * For every RFC whose text carries the literal `comment window waived`:
 *   (a) Compatibility `safety-fix` ⇒ the text names an embargo / coordinated
 *       disclosure or cites COMPATIBILITY.md §3's window explicitly as waived;
 *   (b) a high-risk RFC (RFC 0147 §A.6 surfaces: identity, authorization,
 *       isolation, idempotency, replay, external effects, certification —
 *       detected by the RFC naming §A.6 or those words in its Affects/Title)
 *       ⇒ the text names `RFC 0147 §A.6` as overridden (or inherits it from a
 *       parent that does: `Part of: RFC NNNN` where NNNN names it);
 *   (c) an RFC amending the decision rule (RFC 0001 §5 / GOVERNANCE
 *       §"Amendments" in Affects) ⇒ the text records the approval-count waiver.
 * A rule takes effect on the RFC that introduces it: (b) FAILS from RFC 0174 on;
 * earlier high-risk waivers with no named override are reported as historic
 * (they are the RFC 0156 retrospective cohort), never silently passed.
 * Exit 0 on success, 1 on any failure.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, 'RFCS');
const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
const texts = new Map(files.map((f) => [f.slice(0, 4), readFileSync(join(dir, f), 'utf8')]));
const failures = []; const historic = []; let checked = 0;
const HIGH = /identity|authorization|isolation|idempotency|replay|external effects?|certification/i;
for (const [rfc, t] of texts) {
  if (!/comment window waived/i.test(t)) continue;
  checked++;
  const header = t.split('\n## ')[0];
  const compat = (header.match(/\*\*Compatibility\*\*\s*\|\s*`([a-z-]+)`/) ?? [])[1];
  const parent = (header.match(/Part of:\s*RFC (\d{4})/) ?? [])[1];
  const namesA6 = /RFC 0147 §A\.6/.test(t) || (parent && /RFC 0147 §A\.6/.test(texts.get(parent) ?? ''));
  if (compat === 'safety-fix' && !/embargo|coordinated disclosure|90-day/i.test(t)) failures.push(`RFC ${rfc}: safety-fix with a waived window names no embargo or §3 90-day rationale`);
  const affectsTitle = (header.match(/\*\*Title\*\*[^\n]*/) ?? [''])[0] + (header.match(/\*\*Affects\*\*[^\n]*/) ?? [''])[0];
  if (HIGH.test(affectsTitle) && !namesA6) { if (Number(rfc) >= 174) failures.push(`RFC ${rfc}: high-risk surface (RFC 0147 §A.6) with a waived window and no named §A.6 override`); else historic.push(rfc); }
  if (/RFCS\/0001-rfc-process\.md|GOVERNANCE\.md §"Amendments"|decision rule/i.test(affectsTitle) && Number(rfc) >= 174 && !/approval[- ]count (is )?waived|two-approval requirement[^.]*waived/i.test(t)) failures.push(`RFC ${rfc}: amends the decision rule and records no approval-count waiver (RFC 0174 §B.2 c)`);
}
if (failures.length > 0) { console.error(`=== check-waiver-authority FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
console.log(`=== check-waiver-authority OK — ${checked} waived RFC(s) checked for authority, not only presence; ${historic.length} pre-RFC-0174 high-risk waiver(s) with no named §A.6 override are historic and sit in the RFC 0156 retrospective queue: ${historic.join(', ') || 'none'} ===`);
