#!/usr/bin/env node
/**
 * report-invariant-majors — which protocol major each protocol-tier security
 * invariant is witnessed at.
 *
 * `check-security-invariants.sh` asks only that a protocol-tier invariant's
 * `tests:` glob resolve to a file. It does not ask WHICH major that file runs
 * at, so an invariant whose only test is a major-1 scenario reads "covered"
 * while no v2 host is ever checked for it — and v1 reached end of support on
 * 2026-10-04 (RFC 0234). This report reads `conformance/scenario-majors.json`
 * (the generated file → majors map) and prints, per protocol-tier invariant:
 * severity, its tests, the majors they run at, and any v2 scenario whose
 * source names the invariant id (a hint for a re-point, not cover by itself —
 * a mention is not an assertion).
 *
 * A test outside `conformance/src/scenarios/` (a coherence test, a sibling
 * repo pointer) runs at no protocol major: it reads the corpus, not a host.
 *
 *   node scripts/report-invariant-majors.mjs            # table
 *   node scripts/report-invariant-majors.mjs --json     # machine form
 *   node scripts/report-invariant-majors.mjs --check    # the v2 gate:
 *     FAIL when a protocol-tier `critical` invariant has no test that runs at
 *     major 2 and is not in SECURITY/invariant-v2-gaps.json (a shrink-only
 *     ratchet: a listed id that has gained v2 cover must be removed).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCEN = 'conformance/src/scenarios/';
const BASELINE = join(ROOT, 'SECURITY', 'invariant-v2-gaps.json');

/** The same minimal shape-parser check-security-invariants.sh uses (no YAML dependency). */
export function parseInvariants(text) {
  const out = [];
  let cur = null;
  let inTests = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '' || line === '---' || line.startsWith('invariants:')) continue;
    const item = line.match(/^  - id: (.+)$/);
    if (item) { if (cur) out.push(cur); cur = { id: item[1].trim(), tests: [] }; inTests = false; continue; }
    if (!cur) continue;
    const field = line.match(/^    (\w+): ?(.*)$/);
    if (field) {
      inTests = field[1] === 'tests' && field[2] !== '[]';
      if (field[1] !== 'tests' && field[1] !== 'note') cur[field[1]] = field[2].trim();
      continue;
    }
    const t = inTests && line.match(/^      - (.+)$/);
    if (t) cur.tests.push(t[1].trim());
  }
  if (cur) out.push(cur);
  return out;
}

export function measure(root = ROOT) {
  const majors = JSON.parse(readFileSync(join(root, 'conformance', 'scenario-majors.json'), 'utf8')).majors;
  const scenFiles = Object.keys(majors);
  const globRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  const v2Sources = scenFiles.filter((f) => majors[f].includes(2)).map((f) => [f, readFileSync(join(root, SCEN, f), 'utf8')]);
  const invariants = parseInvariants(readFileSync(join(root, 'SECURITY', 'invariants.yaml'), 'utf8'))
    .filter((i) => i.tier === 'protocol');
  return invariants.map((inv) => {
    const tests = inv.tests.map((t) => {
      if (!t.startsWith(SCEN)) return { test: t, majors: [] };
      const re = globRe(t.slice(SCEN.length));
      const ms = new Set(scenFiles.filter((f) => re.test(f)).flatMap((f) => majors[f]));
      return { test: t, majors: [...ms].sort() };
    });
    const listed = new Set(inv.tests.filter((t) => t.startsWith(SCEN)).map((t) => t.slice(SCEN.length)));
    const idRe = new RegExp(`(^|[^a-z0-9-])${inv.id.replace(/[-]/g, '\\-')}([^a-z0-9-]|$)`);
    const namedBy = v2Sources.filter(([f, src]) => !listed.has(f) && idRe.test(src)).map(([f]) => f);
    const runMajors = [...new Set(tests.flatMap((t) => t.majors))].sort();
    const twins = tests.flatMap((t) => {
      const f = t.test.slice(SCEN.length);
      return t.test.startsWith(SCEN) && !f.startsWith('v2-') && majors[`v2-${f}`] && !listed.has(`v2-${f}`) ? [`v2-${f}`] : [];
    });
    return { id: inv.id, severity: inv.severity, tests, runMajors, v2: runMajors.includes(2), namedBy, twins };
  });
}

function main() {
  const argv = process.argv.slice(2);
  const rows = measure();
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(rows, null, 2) + '\n'); return; }
  const noV2 = rows.filter((r) => !r.v2);
  const crit = noV2.filter((r) => r.severity === 'critical');
  if (argv.includes('--check')) {
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { critical: [] };
    const allowed = new Set(base.critical);
    const fresh = crit.filter((r) => !allowed.has(r.id)).map((r) => r.id);
    const known = new Set(rows.map((r) => r.id));
    const stale = [...allowed].filter((id) => !crit.some((r) => r.id === id));
    if (fresh.length || stale.length) {
      console.error('=== invariant v2 coverage FAILED ===');
      for (const id of fresh) console.error(`  FAIL: ${id} (critical) has no test that runs at protocol major 2 — add a v2 scenario to its tests: (v1 is end-of-support; a major-1-only witness checks no current host)`);
      for (const id of stale) console.error(`  STALE: ${id} is in SECURITY/invariant-v2-gaps.json but ${known.has(id) ? 'now has v2 cover' : 'is no longer a protocol-tier critical invariant'} — remove it (the ratchet only shrinks)`);
      process.exit(1);
    }
    console.log(`Invariant v2 coverage: ${rows.length - noV2.length}/${rows.length} protocol-tier invariants have a test at major 2; ${crit.length} critical gap(s), all in the shrink-only baseline.`);
    return;
  }
  for (const r of rows) {
    const tests = r.tests.map((t) => `${t.test.replace(SCEN, '')}[${t.majors.join(',') || '-'}]`).join(' ');
    const hint = [r.namedBy.length ? `named-by: ${r.namedBy.join(' ')}` : '', r.twins.length ? `twin: ${r.twins.join(' ')}` : ''].filter(Boolean).join(' ; ');
    console.log(`${r.v2 ? 'v2 ' : '-- '} ${r.severity.padEnd(8)} ${r.id}  ${tests}${hint ? '  ⟶ ' + hint : ''}`);
  }
  const by = (s) => noV2.filter((r) => r.severity === s).length;
  console.log(`\nprotocol-tier: ${rows.length}; with a test at major 2: ${rows.length - noV2.length}; without: ${noV2.length} (critical ${by('critical')}, high ${by('high')}, medium ${by('medium')}, low ${by('low')})`);
  console.log(`  of those without: named by a v2 scenario ${noV2.filter((r) => r.namedBy.length).length}; with a v2-<same-name> twin ${noV2.filter((r) => r.twins.length).length}; neither ${noV2.filter((r) => !r.namedBy.length && !r.twins.length).length} (critical ${noV2.filter((r) => r.severity === 'critical' && !r.namedBy.length && !r.twins.length).length})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
