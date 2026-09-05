/**
 * v2-retention-floors — `spec/v2/core/overview.md` §v1 end-of-support, "Old-major
 * retention floors" (charter Phase 5). Corpus wrapper.
 *
 * Old-major artifacts MUST stay installable for 12 months from the 2.0.0
 * publish. Three legs, each a spawned gate script:
 *   1. the registry validates and the script exits 0 offline, printing the
 *      floor state;
 *   2. with a canned probe in which one pinned version is MISSING and a
 *      synthetic release date that puts the floor OPEN, the script FAILS naming
 *      the artifact — the arming is real;
 *   3. the same canned probe with every pinned version present PASSES.
 *
 * The probe and the dates are injected so the failure is the missing version,
 * not the network. Gates on a spec checkout (V1_DIR).
 *
 * @see spec/v2/core/overview.md §v1 end-of-support
 * @see spec/v2/retention-floors.json
 * @see scripts/check-retention-floors.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const ID = 'openwop.requirement.0174.retention-floors';
const DOC = 'spec/v2/core/overview.md §Old-major retention floors';
const SCRIPT = join(root, 'scripts', 'check-retention-floors.mjs');

function tail(r: SpawnSyncReturns<string>): string {
  return (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
}
function run(env: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 });
}
function cannedProbe(missing: string | null): string {
  const reg = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'retention-floors.json'), 'utf8')) as { artifacts: Array<{ name: string; lastOldMajor: string }> };
  const canned: Record<string, string[]> = {};
  for (const a of reg.artifacts) canned[a.name] = a.name === missing ? ['0.0.1'] : [a.lastOldMajor, '0.0.1'];
  const dir = mkdtempSync(join(tmpdir(), 'openwop-retention-'));
  const p = join(dir, 'probe.json');
  writeFileSync(p, JSON.stringify(canned));
  return p;
}

describe('v2-retention-floors (overview.md §Old-major retention floors)', () => {
  it('the registry validates and the script prints the floor state offline', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run({});
    expect(r.status, req(ID, DOC, `spec/v2/retention-floors.json MUST validate and the check MUST exit 0 offline — ${tail(r)}`)).toBe(0);
    expect(String(r.stdout ?? ''), req(ID, DOC, 'the floor state MUST be printed on every run — "not started" and "every version present" must not print the same nothing')).toMatch(/check-retention-floors: (not started|open|closed)/);
  }, 60_000);

  it('a pinned old-major version missing from its registry while the floor is open FAILS, naming the artifact', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run({ OPENWOP_RETENTION_PROBE_FILE: cannedProbe('@openwop/openwop'), OPENWOP_RETENTION_RELEASE_DATE: '2026-01-01', OPENWOP_TODAY: '2026-06-01' });
    expect(r.status, req(ID, DOC, `with the floor open and @openwop/openwop@1.x absent from the probe, the check MUST fail — exited ${r.status}: ${tail(r)}`)).not.toBe(0);
    expect(String(r.stderr ?? ''), req(ID, DOC, 'the failure MUST name the artifact and the version')).toMatch(/npm @openwop\/openwop@1\.\d+\.\d+ is not installable while the retention floor is open/);
  }, 60_000);

  it('the same probe with every pinned version present PASSES while the floor is open', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run({ OPENWOP_RETENTION_PROBE_FILE: cannedProbe(null), OPENWOP_RETENTION_RELEASE_DATE: '2026-01-01', OPENWOP_TODAY: '2026-06-01' });
    expect(r.status, req(ID, DOC, `every pinned version present ⇒ exit 0 — exited ${r.status}: ${tail(r)}`)).toBe(0);
    expect(String(r.stdout ?? ''), req(ID, DOC, 'the open floor MUST print its closing date')).toMatch(/open — 2\.0\.0 published 2026-01-01; floor closes 2027-01-01/);
  }, 60_000);
});
