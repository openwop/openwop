#!/usr/bin/env node
/**
 * Gate: a soft-skip that follows an assertion must say why it is not a silent pass.
 *
 * `softSkip()` does not throw. When an `it()` has already asserted something and
 * then calls `softSkip('inapplicable' | 'skipped')`, `resolveItRecord`
 * (conformance/src/lib/scenario-disposition.ts) records the leg `executed-pass`
 * with a `partial-witness:` detail, and certification counts it. At major 1 the
 * same happens to `softSkip('blocked')`, whose note only stands as `blocked` at
 * major 2. conformance.md reserves a partial witness for "a leg that observed its
 * requirement and skipped an optional extra". The suite cannot tell that case
 * from "asserted some setup and never observed the requirement". The unfailable-leg
 * audits found dozens of the second kind, each recording a pass for a
 * non-conforming host.
 *
 * So each such site must be one of:
 *   - `blockedDespiteAssertions(...)`, which stands as `blocked` at both majors; or
 *   - a soft-skip whose comment block directly above it contains
 *     `// partial-witness-ok: <why the requirement was already observed>`.
 *
 * `seamAbsent(...)` counts as a `blocked` skip.
 *
 * A RATCHET, not a clean slate. The first run found 197 such sites, too many to
 * review honestly in one pass, and an `ok` annotation nobody checked would be
 * worse than none. `conformance/softskip-after-assert.baseline.json` records the
 * unannotated count per file at the time the gate landed. A file may not exceed
 * its baseline, and a file absent from it may have none. When a fix lowers a
 * count, `--write` lowers the baseline. The baseline is unreviewed debt, not
 * approval.
 *
 *   node scripts/check-softskip-after-assert.mjs          fail when a file exceeds its baseline
 *   node scripts/check-softskip-after-assert.mjs --list   print every site, annotated or not
 *   node scripts/check-softskip-after-assert.mjs --write  lower the baseline to the current counts (--allow-raise to raise one)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCEN = join(ROOT, 'conformance', 'src', 'scenarios');
const majors = JSON.parse(readFileSync(join(ROOT, 'conformance', 'scenario-majors.json'), 'utf8')).majors ?? {};
const LIST = process.argv.includes('--list');
const WRITE = process.argv.includes('--write');
const BASELINE = join(ROOT, 'conformance', 'softskip-after-assert.baseline.json');
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {} : {};
const counts = {};

/** [start, end) offsets of each it(...) block's body. */
function itBlocks(text) {
  const out = [];
  const re = /\bit(?:\.\w+)?\(\s*['"`]/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index);
    if (open < 0) break;
    let depth = 0, i = open;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    out.push([open, i]);
    re.lastIndex = i;
  }
  return out;
}

const lineOf = (text, off) => text.slice(0, off).split('\n').length;
const problems = [];
let sites = 0, annotated = 0;
for (const f of readdirSync(SCEN).filter((n) => n.endsWith('.test.ts')).sort()) {
  const text = readFileSync(join(SCEN, f), 'utf8');
  const lines = text.split('\n');
  const major1 = (majors[f] ?? [1]).includes(1);
  for (const [s, e] of itBlocks(text)) {
    const body = text.slice(s, e);
    const firstExpect = body.search(/\bexpect(\.soft)?\(/);
    if (firstExpect < 0) continue;
    const re = /\b(softSkip\(\s*'(inapplicable|skipped|blocked)'|seamAbsent\()/g;
    let m;
    while ((m = re.exec(body))) {
      if (m.index < firstExpect) continue;
      const kind = m[2] ?? 'blocked';
      if (kind === 'blocked' && !major1) continue; // stands as blocked at major 2
      sites++;
      const line = lineOf(text, s + m.index);
      // The contiguous comment block directly above the skip, plus the skip's own
      // line — an explained annotation is usually longer than one line.
      let top = line - 1;
      while (top > 0 && /^\s*\/\//.test(lines[top - 1])) top--;
      const context = lines.slice(top, line).join('\n');
      const ok = /partial-witness-ok:\s*\S/.test(context);
      if (ok) annotated++;
      if (LIST) console.log(`${ok ? 'ok  ' : 'NEW '} ${f}:${line} ${kind}`);
      if (!ok) counts[f] = (counts[f] ?? 0) + 1;
      if (!ok) problems.push(`${f}:${line} — softSkip('${kind}') after an assertion${kind === 'blocked' ? ' in a file that runs at major 1' : ''} records executed-pass (partial-witness). Use blockedDespiteAssertions(...), move the skip before the first expect, or annotate '// partial-witness-ok: <why the requirement was already observed>'.`);
    }
  }
}
if (WRITE) {
  // The ratchet only turns one way: --write lowers counts. Raising one (a new
  // unannotated site) needs --allow-raise, so that step is deliberate and visible
  // in review. The first write, with no baseline file yet, is the only exception.
  const raised = existsSync(BASELINE) ? Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0)) : [];
  if (raised.length && !process.argv.includes('--allow-raise')) {
    console.error(`refusing to RAISE the baseline for ${raised.map(([f, n]) => `${f} (${baseline[f] ?? 0} → ${n})`).join(', ')} — fix the site, annotate it partial-witness-ok, or pass --allow-raise deliberately`);
    process.exit(1);
  }
  const files = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(BASELINE, `${JSON.stringify({ $comment: 'GENERATED by scripts/check-softskip-after-assert.mjs --write. Unreviewed debt, not approval: each count is soft-skips after an assertion that record executed-pass (partial-witness) without a partial-witness-ok annotation. It may only go down.', total: Object.values(files).reduce((a, b) => a + b, 0), files }, null, 2)}\n`);
  console.log(`wrote ${BASELINE.slice(ROOT.length + 1)}: ${Object.values(counts).reduce((a, b) => a + b, 0)} site(s) in ${Object.keys(counts).length} file(s)`);
  process.exit(0);
}
const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
const under = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n);
if (over.length) {
  console.error(`=== check-softskip-after-assert FAILED — ${over.length} file(s) gained a soft-skip after an assertion ===`);
  for (const [f, n] of over) {
    console.error(`  ${f}: ${n} unannotated site(s), baseline ${baseline[f] ?? 0}`);
    for (const p of problems.filter((x) => x.startsWith(`${f}:`))) console.error(`    ${p}`);
  }
  process.exit(1);
}
if (under.length) console.log(`  note: ${under.length} file(s) are below their baseline — run --write to lower it (${under.map(([f]) => f).join(', ')})`);
console.log(`=== check-softskip-after-assert OK — ${sites} soft-skip(s) after an assertion; ${annotated} annotated partial-witness-ok, ${sites - annotated} baseline debt (${Object.values(baseline).reduce((a, b) => a + b, 0)} baselined) ===`);
