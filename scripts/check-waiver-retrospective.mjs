#!/usr/bin/env node
/**
 * check-waiver-retrospective — the RFC 0156 §B register must cover the tree, and
 * an outcome must come from the vocabulary §B closed.
 *
 * §B: RFCs affecting auth, identity, tenant isolation, secrets, packs, execution
 * sandboxing, idempotency, replay, external effects, conformance/certification,
 * or governance MUST receive retrospective cross-organization review. Outcomes
 * are `ratified|corrective-rfc-required|provisional|withdrawn`; **silence MUST
 * NOT mean ratified**.
 *
 * Two things that sentence needed and did not have:
 *
 * 1. **Somewhere to record an outcome.** There was none, so a review could have
 *    happened and left no trace — which is indistinguishable from no review.
 *
 * 2. **A count that can tell the outcomes apart.** `generate-assurance-status.mjs`
 *    derived "reviews completed" from `/retrospective review (complete|closed|done)/i`
 *    over the gap registers. That free-text match counts a review whose outcome was
 *    `withdrawn` or `corrective-rfc-required` exactly like a `ratified` one — it
 *    measures whether someone *wrote a sentence*, not whether the obligation was
 *    discharged. Reporting "we reviewed it and it needs a corrective RFC" as
 *    completed is compliance over an open defect.
 *
 * So: only `ratified` discharges. Everything else is reported as still open, and
 * `not-reviewed` — a token §B does not define, added here because absence needs a
 * name or it gets read as one of the four — is the default.
 *
 * Derivation of the waived set is deliberately IDENTICAL to
 * `check-waiver-ledger.mjs` and `generate-assurance-status.mjs` (the literal
 * `comment window waived`), so the three surfaces cannot disagree about what a
 * waiver is.
 *
 * Exit 0 when register and tree agree and every outcome is legal; 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'docs/WAIVER-RETROSPECTIVE-REGISTER.md');

/** §B outcome vocabulary, plus the absence token. Only `ratified` discharges. */
const OUTCOMES = new Set(['ratified', 'corrective-rfc-required', 'provisional', 'withdrawn', 'not-reviewed']);
const DISCHARGES = new Set(['ratified']);

function derivedWaived() {
  const dir = join(ROOT, 'RFCS');
  return new Set(
    readdirSync(dir)
      .filter((x) => /^\d{4}-.*\.md$/.test(x))
      .filter((f) => /comment window waived/i.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.slice(0, 4)),
  );
}

function registerRows() {
  if (!existsSync(REGISTER)) return null;
  const rows = new Map();
  for (const line of readFileSync(REGISTER, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*(\d{4})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*`?([a-z-]+)`?\s*\|/);
    if (m) rows.set(m[1], { scope: m[3].trim(), reviewer: m[4].trim(), date: m[5].trim(), outcome: m[6].trim() });
  }
  return rows;
}

process.stdout.write('=== check-waiver-retrospective — RFC 0156 §B register vs the tree ===\n');

const waived = derivedWaived();
const rows = registerRows();
if (rows === null) {
  process.stdout.write(`  FAIL — ${REGISTER} does not exist. §B outcomes have nowhere to be recorded.\n`);
  process.exit(1);
}

const problems = [];
const missing = [...waived].filter((id) => !rows.has(id)).sort();
const extra = [...rows.keys()].filter((id) => !waived.has(id)).sort();
if (missing.length) problems.push(`  ${missing.length} waived RFC(s) absent from the register: ${missing.join(', ')}`);
if (extra.length) problems.push(`  ${extra.length} register row(s) name an RFC the tree does not show as waived: ${extra.join(', ')}`);

for (const [id, r] of [...rows].sort()) {
  if (!OUTCOMES.has(r.outcome)) {
    problems.push(`  RFC ${id}: outcome "${r.outcome}" is not in the §B vocabulary (${[...OUTCOMES].join(' | ')})`);
    continue;
  }
  // A recorded review must name who did it. §B requires the review be
  // cross-organization; an outcome with no reviewer cannot evidence that, and an
  // unattributed `ratified` is exactly the silence-means-ratified substitution
  // the last clause of §B forbids.
  if (r.outcome !== 'not-reviewed' && (!r.reviewer || r.reviewer === '—')) {
    problems.push(`  RFC ${id}: outcome "${r.outcome}" records no reviewer org — §B requires cross-organization review`);
  }
}

if (problems.length) {
  process.stdout.write(`\n${problems.join('\n')}\n\n`);
  process.stdout.write('  Regenerate rows for newly waived RFCs, or correct the outcome. Never fill an\n');
  process.stdout.write('  outcome to clear this gate: the register exists to make the gap visible.\n');
  process.exit(1);
}

const byOutcome = new Map();
for (const r of rows.values()) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + 1);
const discharged = [...rows.values()].filter((r) => DISCHARGES.has(r.outcome)).length;

process.stdout.write(`  ${rows.size} waived RFC(s), all present. Outcomes: `);
process.stdout.write([...byOutcome].sort().map(([k, v]) => `${k}=${v}`).join(', ') + '\n');
process.stdout.write(`  ${discharged} of ${rows.size} discharge §B (only \`ratified\` does).\n`);
if (discharged < rows.size) {
  process.stdout.write('  Not a failure: §B review is cross-organization and the non-steward-maintainer\n');
  process.stdout.write('  tripwire has not fired, so a non-zero open count is the honest state.\n');
}
process.stdout.write('\n=== check-waiver-retrospective OK ===\n');
process.exit(0);
