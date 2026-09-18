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

const refused = [];
const unnamed = [];
const noObligation = [];
const facetsUncovered = [];

/** RFC 0189 §A — the legal home classes. */
const homeClass = (h) => {
  if (h === 'spec/v2/core/capabilities.md') return 'declaration-site';
  if (h.startsWith('spec/v2/core/')) return 'core';
  if (h.startsWith('spec/v2/ext/')) return 'ext';
  if (h.startsWith('schemas/v2/') || h.startsWith('spec/v2/facets/')) return 'schema';
  if (h.startsWith('spec/v1/')) return 'v1';
  if (h.startsWith('RFCS/')) return 'rfc';
  return 'refused';
};
const KEYWORD = /\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/;
const namesKey = (text, key) => new RegExp(`(^|[^A-Za-z0-9])\`?${key}\`?([^A-Za-z0-9]|$)`).test(text);

for (const f of core) {
  const homes = f.normativeText;
  if (!Array.isArray(homes) || homes.length === 0) {
    undeclared.push(f.key);
    continue;
  }
  let bad = false;
  let prose = '';
  for (const h of homes) {
    const cls = homeClass(h);
    // §A — a declaration site cannot be its own behaviour home. Every core
    // family's `section` is ALREADY `core/capabilities.md#<key>`, and every one
    // of those bodies is a one-line stub, so allowing it would resolve all 72
    // for free and make the gate `section` spelled twice.
    if (cls === 'declaration-site') { refused.push(`${f.key} -> ${h} (the declaration site: capabilities.md § ${f.key} is a stub, not behaviour)`); bad = true; continue; }
    if (cls === 'rfc') { refused.push(`${f.key} -> ${h} (an RFC is history, not operative text; owningRfc already records it)`); bad = true; continue; }
    if (cls === 'refused') { refused.push(`${f.key} -> ${h} (not a normative home: only spec/v2/core, spec/v2/ext, a v2 schema as a CO-pointer, or spec/v1 as a declared dependency)`); bad = true; continue; }
    if (!existsSync(join(ROOT, h))) { missing.push(`${f.key} -> ${h}`); bad = true; continue; }
    if (cls !== 'schema') prose += readFileSync(join(ROOT, h), 'utf8') + '\n';
  }
  if (bad) continue;
  // §A — a schema may co-point, never stand alone: RFC 0174 §E.2a parks
  // rationale in schema descriptions precisely because the budget does not
  // count them, and a schema-only home turns that escape into "no prose".
  if (prose === '') { refused.push(`${f.key} -> schema-only (a schema MAY co-point; it MUST NOT be the sole home — RFC 0174 §E.2a)`); continue; }
  // §B(b) — the target names the family.
  if (!namesKey(prose, f.key)) { unnamed.push(`${f.key} (no target names it)`); continue; }
  // §B(c) — an obligation ABOUT the family: a 2119 keyword in a paragraph that
  // also names it. Document scope would pass on almost any v2 core doc.
  const paras = prose.split(/\n\s*\n/);
  if (!paras.some((q) => namesKey(q, f.key) && KEYWORD.test(q))) { noObligation.push(`${f.key} (named, but no MUST/SHOULD/MAY in a paragraph that names it)`); continue; }
  // §B(d) — facet completeness, counted rather than failed (see the ratchet).
  for (const facet of f.facets ?? []) if (!namesKey(prose, facet)) facetsUncovered.push(`${f.key}.${facet}`);
  if (homes.some((h) => h.startsWith('spec/v1/'))) v1dep.push(f.key);
  else resolved.push(f.key);
}

process.stdout.write(
  `  ${core.length} core families: ${resolved.length} resolved, ${v1dep.length} v1-dependent, ${undeclared.length} undeclared.\n`,
);

// RFC 0189 §B — a declared home that is not a home, or does not carry an
// obligation about its family, reads as resolved and is not. Hard fail: unlike
// the counters below, these are authoring errors, not debt.
const predicateFailures = [...refused, ...unnamed, ...noObligation];
if (predicateFailures.length > 0) {
  process.stdout.write(`\n  FAIL — ${predicateFailures.length} normativeText declaration(s) do not carry their family's behaviour:\n`);
  for (const m of predicateFailures) process.stdout.write(`    ${m}\n`);
  process.stdout.write('  A declared home must NAME the family and carry an RFC 2119 obligation about it\n  in the same paragraph. `existsSync` alone let README.md resolve all 72.\n');
  process.exit(1);
}

// A pointer to a file that does not exist reads as resolved. Never tolerated.
if (missing.length > 0) {
  process.stdout.write(`\n  FAIL — ${missing.length} normativeText path(s) do not exist:\n`);
  for (const m of missing) process.stdout.write(`    ${m}\n`);
  process.stdout.write('  A pointer to a missing file is worse than no pointer: it reads as resolved.\n');
  process.exit(1);
}

let base0 = { v1Dependent: v1dep.length, undeclared: undeclared.length, facetsUncovered: facetsUncovered.length };
if (existsSync(BASELINE)) base0 = JSON.parse(readFileSync(BASELINE, 'utf8'));

let eosDate = null;
try {
  eosDate = JSON.parse(readFileSync(EOS, 'utf8')).endOfSupportNotBefore ?? null;
} catch { /* clock absent — the ratchets still hold, the deadline is just unknown */ }

if (eosDate) {
  const days = Math.round((Date.parse(eosDate) - Date.parse(NOW)) / 86_400_000);
  const open = v1dep.length + undeclared.length;
  process.stdout.write(`  v1 end-of-support not before ${eosDate} — ${days} day(s) from ${NOW}.\n`);
  if (open > 0) {
    // RFC 0189 §D. The line this replaces said the count "becomes one on the
    // date, silently" — and the comparison did not exist, nor did any scheduled
    // job run this gate, so it could not have. A gate that describes a check it
    // does not perform is the defect this corpus keeps finding in others.
    process.stdout.write(
      `  ${undeclared.length} famil(ies) have NO declared home; ${v1dep.length} declare one that dies with v1.\n` +
        '  Not a failure on a PR: this gate runs the ratchets there, never the clock.\n' +
        '  The clock runs daily on main under --deadline, as a BURN-DOWN rather than\n' +
        '  a cliff: a schedule that only fails on the last day is a statistic.\n',
    );
  }
  // --deadline: opt-in, so a contributor's unrelated PR never reds on a calendar.
  if (process.argv.includes('--deadline') && open > 0) {
    const t0 = base0.t0 ?? null;
    const openAtT0 = base0.openAtT0 ?? open;
    if (Date.parse(NOW) >= Date.parse(eosDate)) {
      process.stdout.write(`\n  FAIL — v1 end-of-support (${eosDate}) has passed and ${open} famil(ies) still have no home that survives it.\n`);
      process.stdout.write('  The fallback RFC 0189 §D names: spec/v1/** is frozen-but-operative for the\n  families still listed in `v1Carried`, and this gate then fails only if one of\n  those targets is DELETED or its Status banner changes.\n');
      process.exit(1);
    }
    if (t0) {
      const span = Date.parse(eosDate) - Date.parse(t0);
      const left = Date.parse(eosDate) - Date.parse(NOW);
      const allowed = Math.ceil(openAtT0 * (left / span));
      process.stdout.write(`  burn-down: ${open} open, ${allowed} allowed at this point on the schedule (${openAtT0} at t0 ${t0}).\n`);
      if (open > allowed) {
        process.stdout.write(`\n  FAIL — behind the burn-down: ${open} open against ${allowed} allowed.\n  Detected the week it slips rather than on the day nothing can be done.\n`);
        process.exit(1);
      }
    }
  }
}

const base = base0;

// RFC 0189 §C. The old rule failed when `v1Dependent` ROSE — which is exactly
// what the first HONEST declaration does: moving a family from `undeclared` to
// `v1-dependent` gains information and leaves total debt unchanged, and the
// gate exited 1 on it. So the cheapest way to stay green was to declare
// nothing, on 70 of 72 rows. Now: `undeclared` may never rise, and the SUM may
// never rise; `v1Dependent` alone is unconstrained upward.
const grew = [];
const du = undeclared.length - base.undeclared;
const dv = v1dep.length - base.v1Dependent;
if (du > 0) grew.push(`undeclared ${base.undeclared} -> ${undeclared.length} (a core family with no declared home is new debt)`);
if (du + dv > 0) grew.push(`total open debt ${base.undeclared + base.v1Dependent} -> ${undeclared.length + v1dep.length}`);
if (facetsUncovered.length > (base.facetsUncovered ?? facetsUncovered.length)) grew.push(`facets with no normative text ${base.facetsUncovered} -> ${facetsUncovered.length} (${facetsUncovered.slice(0, 4).join(', ')})`);

if (grew.length > 0) {
  process.stdout.write(`\n  FAIL — a ratchet grew: ${grew.join('; ')}.\n`);
  process.stdout.write(
    '  A new core family whose behaviour is written only in spec/v1/, or with no\n' +
      '  declared home at all, adds to a debt that comes due on the EOS date.\n' +
      '  Declare `normativeText` pointing outside spec/v1/, or lower nothing.\n',
  );
  process.exit(1);
}

if (undeclared.length + v1dep.length < base.undeclared + base.v1Dependent || facetsUncovered.length < (base.facetsUncovered ?? facetsUncovered.length)) {
  process.stdout.write(
    `\n  Improved: v1-dependent ${base.v1Dependent} -> ${v1dep.length}, undeclared ${base.undeclared} -> ${undeclared.length}.\n` +
      `  Lower the baseline in ${BASELINE.replace(ROOT + '/', '')} so the gain is held.\n`,
  );
  process.exit(1);
}

process.stdout.write('\n=== check-v2-normative-home OK — pointers resolve; ratchets at baseline ===\n');
process.exit(0);
