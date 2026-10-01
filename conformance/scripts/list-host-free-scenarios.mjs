#!/usr/bin/env node
/**
 * The scenarios that need no host: those whose import closure through `src/`
 * never reaches a module that talks to one (`lib/driver`, `lib/sse`,
 * `lib/env`) and never calls `fetch(`. They read the suite's own sources,
 * fixtures and vectors, so they MUST pass on any tree, with no host running.
 *
 * `scripts/openwop-check.sh` runs this set at 100%. Until 2.45.4 it ran a hand
 * list of nine files, the host job passes at ≥92%, and two of these scenarios
 * (`host-callback-declaration`, `runner-ledger`) failed on every host through
 * three green PRs (#1825, #1826, #1834; fixed in #1835). The set is derived so
 * a new host-free scenario is covered without anyone remembering to list it.
 *
 * A floor, not an oracle: the walk reads static relative imports. A scenario
 * that reaches a host some other way is one this lists wrongly, and it then
 * fails the gate by asking for `OPENWOP_BASE_URL`, which is the loud outcome.
 *
 *   (no flag)   print the set, one path per line, relative to conformance/
 *   --check     also fail if the set is empty or has lost a known member
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONF = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = join(CONF, 'src/scenarios');
const HOST_MODULES = ['lib/driver.ts', 'lib/sse.ts', 'lib/env.ts'].map((m) => join(CONF, 'src', m));
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
// Guard against a vacuous pass: a walk that finds nothing, or that has stopped
// seeing these, is measuring nothing. Each was host-free when this was written.
const KNOWN = ['fixtures-valid.test.ts', 'host-callback-declaration.test.ts', 'runner-ledger.test.ts'];

function importsOf(file, source) {
  const out = [];
  for (const m of source.matchAll(IMPORT)) {
    const base = resolve(dirname(file), m[1]);
    const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')];
    const hit = candidates.find((c) => c.endsWith('.ts') && existsSync(c));
    if (hit) out.push(hit);
  }
  return out;
}

const memo = new Map();
function reachesHost(file, stack = new Set()) {
  if (memo.has(file)) return memo.get(file);
  if (stack.has(file)) return false;
  stack.add(file);
  const source = readFileSync(file, 'utf8');
  const reaches = HOST_MODULES.includes(file) || /\bfetch\s*\(/.test(source) || importsOf(file, source).some((i) => reachesHost(i, stack));
  stack.delete(file);
  // A cycle member answered `false` only for the walk in progress; cache the root's answer alone.
  if (stack.size === 0 || reaches) memo.set(file, reaches);
  return reaches;
}

const hostFree = readdirSync(SCENARIOS)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .filter((f) => !reachesHost(join(SCENARIOS, f)));

if (process.argv.includes('--check')) {
  const missing = KNOWN.filter((f) => !hostFree.includes(f));
  if (hostFree.length === 0 || missing.length > 0) {
    console.error(`list-host-free-scenarios: FAIL — ${hostFree.length} host-free scenario(s); missing known member(s): ${missing.join(', ') || 'none'}`);
    process.exit(1);
  }
}
process.stdout.write(hostFree.map((f) => `src/scenarios/${f}`).join('\n') + '\n');
