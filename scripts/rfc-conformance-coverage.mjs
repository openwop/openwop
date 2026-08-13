#!/usr/bin/env node
/**
 * RFC 0147 §A.3 — which scenarios each RFC's §Conformance section NAMES, and
 * which of those actually exist.
 *
 * Every RFC lists the scenarios it expects. Nothing checked that the list
 * corresponded to files, so an RFC could name eight scenarios, ship none, and
 * read as complete to anyone who trusted the section.
 *
 * **The raw count is misleading in both directions, which is the point of this
 * script rather than a `grep`.** Some named scenarios exist under a different
 * filename — RFC 0151 names `compensation-replay-no-refire.test.ts` and the
 * behavior lives as a leg inside `compensation-behavior.test.ts`. Reporting that
 * as "missing" would overstate the gap exactly as reporting it as "present"
 * would understate it. So renames are declared explicitly below, and everything
 * undeclared is counted as genuinely absent.
 *
 * The alias table is the honest part: it is hand-maintained, every row is a
 * claim someone can check, and adding a row to silence a finding is visible in
 * the diff. That is the opposite of the failure mode this program exists to
 * close, where a gap disappears because nothing was looking.
 *
 * Usage: node scripts/rfc-conformance-coverage.mjs [--json]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = join(ROOT, 'conformance', 'src', 'scenarios');

/**
 * Named-in-RFC → the file that actually carries the behavior.
 *
 * Each row asserts that the named scenario's REQUIREMENT is exercised by the
 * mapped file. A row is a claim, not a suppression: if the mapped file does not
 * actually cover it, the row is wrong and someone reading the diff can say so.
 */
const ALIASES = {
  // RFC 0151 — the unwind legs live in one behavioral file rather than eight.
  'compensation-shape.test.ts': 'compensation-profile.test.ts',
  'compensation-reverse-unwind.test.ts': 'compensation-behavior.test.ts',
  'compensation-replay-no-refire.test.ts': 'compensation-behavior.test.ts',
  // RFC 0152 / 0153 — negotiation and downgrade are one scenario each.
  'a2a-version-downgrade.test.ts': 'a2a-version-negotiation.test.ts',
  'mcp-version-downgrade.test.ts': 'mcp-version-negotiation.test.ts',
  'mcp-routing-headers.test.ts': 'mcp-version-negotiation.test.ts',
  // RFC 0154 — shape and the §A/§B behavior split across two files.
  'workload-identity-shape.test.ts': 'workload-identity-profile.test.ts',
  'delegation-tenant-audience.test.ts': 'workload-identity-behavior.test.ts',
  'delegation-chain-validation.test.ts': 'workload-identity-profile.test.ts',
  // RFC 0148 — the ledger carries the execution-witness requirement.
  'conformance-execution-witness.test.ts': 'requirement-ledger.test.ts',
  'conformance-advertised-seam-required.test.ts': 'strict-behavior-gate.test.ts',
  // RFC 0155 — canonical-name enforcement lives in the bundle v2 schema gate.
  'certification-profile-canonical-name.test.ts': 'certification-bundle-v2.test.ts',
  // RFC 0155 §B/§C — manifest parity and the registry legs are one file.
  'core-standard-manifest-parity.test.ts': 'core-manifest-and-extension-registry.test.ts',
  'extension-registry-validity.test.ts': 'core-manifest-and-extension-registry.test.ts',
  'extension-dependency-closure.test.ts': 'core-manifest-and-extension-registry.test.ts',
  'extension-stable-evidence.test.ts': 'core-manifest-and-extension-registry.test.ts',
  'profile-claim-floor-not-overstated.test.ts': 'certification-floor-enforcement.test.ts',
  // RFC 0150 — identity and digest, renamed during implementation.
  'activity-id-retry-stability.test.ts': 'effect-identity-composition.test.ts',
  'replay-semantic-request-digest-v2.test.ts': 'semantic-digest-v2.test.ts',
};

/*
 * Deliberately NOT aliased, though a looser reading would allow it:
 *
 *   multi-region-effect-ownership.test.ts  ->  multi-region-effect-vocabulary
 *
 * The vocabulary gate proves the corpus stopped advertising a posture it
 * contradicts. It does not prove any host fences an effect before issuing it —
 * that needs a partition simulator plus an observable effect sink (gap G10).
 * Aliasing it would convert a labelled gap into apparent coverage, which is the
 * move this whole script exists to make visible.
 */

function namedScenarios(rfcFile) {
  const doc = readFileSync(rfcFile, 'utf8');
  const lines = doc.split('\n');
  const out = new Set();
  let inSection = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) inSection = /^##\s+Conformance\s*$/.test(line);
    if (!inSection) continue;
    for (const m of line.matchAll(/`([a-z0-9-]+\.test\.ts)`/g)) out.add(m[1]);
  }
  return [...out].sort();
}

const rfcs = readdirSync(join(ROOT, 'RFCS'))
  .filter((f) => /^01(4[7-9]|5[0-6])-.*\.md$/.test(f))
  .sort();

const report = [];
for (const f of rfcs) {
  const named = namedScenarios(join(ROOT, 'RFCS', f));
  const rows = named.map((n) => {
    if (existsSync(join(SCENARIOS, n))) return { named: n, status: 'present', via: n };
    const alias = ALIASES[n];
    if (alias !== undefined && existsSync(join(SCENARIOS, alias))) {
      return { named: n, status: 'covered-by', via: alias };
    }
    return { named: n, status: 'absent', via: null };
  });
  report.push({ rfc: f.slice(0, 4), named: named.length, rows });
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  let present = 0;
  let covered = 0;
  let absent = 0;
  for (const r of report) {
    const a = r.rows.filter((x) => x.status === 'absent');
    const c = r.rows.filter((x) => x.status === 'covered-by');
    const p = r.rows.filter((x) => x.status === 'present');
    present += p.length;
    covered += c.length;
    absent += a.length;
    console.log(
      `RFC ${r.rfc}: ${p.length} present · ${c.length} covered-under-another-name · ${a.length} absent (of ${r.named} named)`,
    );
    for (const x of a) console.log(`    absent: ${x.named}`);
  }
  console.log(
    `\nTotal: ${present} present · ${covered} covered-by-alias · ${absent} absent of ${present + covered + absent} named.`,
  );
  console.log(
    'A named scenario that is absent is not a failing test — it is a requirement with no\n' +
      'witness, which RFC 0148 §A resolves to `blocked` rather than to a pass.',
  );
}
