#!/usr/bin/env node
/**
 * check-v2-normative-home — every v2 core family must have a normative home that
 * survives v1 end-of-support.
 *
 * ## The gap this measures
 *
 * `spec/v2/declaration.json` gives each family a `section` pointer, and for core
 * families that is `core/capabilities.md#<key>`. For most of them the section it
 * points at is a STUB. `§ toolHooks` reads, in full:
 *
 *     Witness `witnessable-gated`; owner RFC 0064.
 *
 * That is v2's deliberate shape, not neglect: `core/*.md` prose is capped at
 * 25,000 words (`check-core-budget.mjs`) and the tree currently sits at 24,998 —
 * two words of headroom. The kernel is a DECLARATION surface by construction, so
 * a family's behaviour is written somewhere else and the declaration names the
 * owning RFC.
 *
 * The consequence nothing measured: for 35 of 72 core families the "somewhere
 * else" is a document under `spec/v1/`. v1 is not retired — a host advertises
 * both majors through the overlap — but `evidence/v1-end-of-support.json` carries
 * a date. **On that date those families lose the only place their behaviour is
 * written out, and no gate would notice.** The capability keeps advertising, the
 * conformance floor keeps passing, and the prose a host implements against stops
 * being operative.
 *
 * ## What `normativeText` is, and why it is hand-declared
 *
 * `section` names the DECLARATION site. `normativeText` names where a reader
 * finds the BEHAVIOUR. They are different questions and only the first was
 * recorded.
 *
 * It is not derived, because derivation gets it wrong. The obvious heuristic —
 * the spec document an owning RFC references most — puts `toolHooks` in
 * `spec/v1/mcp-integration.md` (3 references) when its `perToolAuthorization`
 * rule is written in `spec/v1/host-capabilities.md`. Frequency is not authority.
 * The declaration is hand-reviewed source ("generated FROM nothing, checked
 * AGAINST everything"); this field follows that rule and this gate checks it.
 *
 * ## Three states, counted separately
 *
 *   RESOLVED     `normativeText` names a path outside `spec/v1/` that exists.
 *                Survives EOS.
 *   V1-DEPENDENT `normativeText` names a path under `spec/v1/`. Real, honest,
 *                and orphaned on the EOS date. Ratcheted: MUST NOT grow.
 *   UNDECLARED   no `normativeText`. Not "fine" — unmeasured. Ratcheted.
 *
 * A declared path that does not exist is a hard failure at any count: a pointer
 * to a missing file is worse than no pointer, because it reads as resolved.
 *
 * Both ratchets must reach zero before `endOfSupportNotBefore`. The gate prints
 * the days remaining so the number is a deadline rather than a statistic.
 *
 * Exit 0 when every pointer resolves and neither ratchet has grown; 1 otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECL = join(ROOT, 'spec/v2/declaration.json');
const EOS = join(ROOT, 'evidence/v1-end-of-support.json');
const BASELINE = join(ROOT, 'docs/normative-home-baseline.json');

/** Today, injectable so the deadline arithmetic is testable. */
const NOW = process.env['OPENWOP_NORMATIVE_HOME_TODAY'] ?? new Date().toISOString().slice(0, 10);

const decl = JSON.parse(readFileSync(DECL, 'utf8'));
const families = [];
(function walk(x) {
  if (x && typeof x === 'object') {
    if (x.key && x.anchor && x.kind === 'family') families.push(x);
    for (const v of Object.values(x)) walk(v);
  }
})(decl);

const core = families.filter((f) => f.anchor === 'core');
process.stdout.write('=== check-v2-normative-home — does every core family survive v1 EOS? ===\n');

const resolved = [];
const v1dep = [];
const undeclared = [];
const missing = [];

for (const f of core) {
  const homes = f.normativeText;
  if (!Array.isArray(homes) || homes.length === 0) {
    undeclared.push(f.key);
    continue;
  }
  for (const h of homes) {
    if (!existsSync(join(ROOT, h))) missing.push(`${f.key} -> ${h}`);
  }
  if (homes.some((h) => h.startsWith('spec/v1/'))) v1dep.push(f.key);
  else resolved.push(f.key);
}

process.stdout.write(
  `  ${core.length} core families: ${resolved.length} resolved, ${v1dep.length} v1-dependent, ${undeclared.length} undeclared.\n`,
);

// A pointer to a file that does not exist reads as resolved. Never tolerated.
if (missing.length > 0) {
  process.stdout.write(`\n  FAIL — ${missing.length} normativeText path(s) do not exist:\n`);
  for (const m of missing) process.stdout.write(`    ${m}\n`);
  process.stdout.write('  A pointer to a missing file is worse than no pointer: it reads as resolved.\n');
  process.exit(1);
}

let eosDate = null;
try {
  eosDate = JSON.parse(readFileSync(EOS, 'utf8')).endOfSupportNotBefore ?? null;
} catch { /* clock absent — the ratchets still hold, the deadline is just unknown */ }

if (eosDate) {
  const days = Math.round((Date.parse(eosDate) - Date.parse(NOW)) / 86_400_000);
  const open = v1dep.length + undeclared.length;
  process.stdout.write(`  v1 end-of-support not before ${eosDate} — ${days} day(s) from ${NOW}.\n`);
  if (open > 0) {
    process.stdout.write(
      `  ${open} core famil(ies) have no normative home that survives that date.\n` +
        '  Not a failure today: v1 is not retired and a host advertises both majors\n' +
        '  through the overlap. It becomes one on the date, silently, unless this\n' +
        '  number reaches zero first.\n',
    );
  }
}

let base = { v1Dependent: v1dep.length, undeclared: undeclared.length };
if (existsSync(BASELINE)) base = JSON.parse(readFileSync(BASELINE, 'utf8'));

const grew = [];
if (v1dep.length > base.v1Dependent) grew.push(`v1-dependent ${base.v1Dependent} -> ${v1dep.length}`);
if (undeclared.length > base.undeclared) grew.push(`undeclared ${base.undeclared} -> ${undeclared.length}`);

if (grew.length > 0) {
  process.stdout.write(`\n  FAIL — a ratchet grew: ${grew.join('; ')}.\n`);
  process.stdout.write(
    '  A new core family whose behaviour is written only in spec/v1/, or with no\n' +
      '  declared home at all, adds to a debt that comes due on the EOS date.\n' +
      '  Declare `normativeText` pointing outside spec/v1/, or lower nothing.\n',
  );
  process.exit(1);
}

if (v1dep.length < base.v1Dependent || undeclared.length < base.undeclared) {
  process.stdout.write(
    `\n  Improved: v1-dependent ${base.v1Dependent} -> ${v1dep.length}, undeclared ${base.undeclared} -> ${undeclared.length}.\n` +
      `  Lower the baseline in ${BASELINE.replace(ROOT + '/', '')} so the gain is held.\n`,
  );
  process.exit(1);
}

process.stdout.write('\n=== check-v2-normative-home OK — pointers resolve; ratchets at baseline ===\n');
process.exit(0);
