/**
 * v2-req-only-assertions — RFC 0168 §A.1 (corpus wrapper).
 *
 * Suite 2.0.0: `req()` is the ONLY assertion-message form; `scripts/check-req-only.mjs`
 * (root) walks `src/scenarios` and `src/coherence` and fails on a bare
 * `driver.describe(...)` or an id outside the `openwop.` grammar.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.req-only-assertions`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §A.1
 * @see scripts/check-req-only.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

function tail(r: SpawnSyncReturns<string>): string {
  return (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
}

describe('v2-req-only-assertions (RFC 0168 §A.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-req-only.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.req-only-assertions', 'RFC 0168 §A.1', `\`req(id, section, requirement)\` is the only assertion-message form in src/scenarios and src/coherence — a bare \`driver.describe(...)\` or an id outside the grammar fails the suite lint (check-req-only.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
