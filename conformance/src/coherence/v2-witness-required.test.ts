/**
 * v2-witness-required — RFC 0168 §B.1 (corpus wrapper).
 *
 * `witness` from the closed set is required on every family in
 * `spec/v2/declaration.json`; `unwitnessable` may not be advertised by a core
 * family (RFC 0167 Axiom 1). `scripts/check-declaration.mjs` step 3 is the gate.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.witness-required`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §B.1
 * @see scripts/check-declaration.mjs
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

describe('v2-witness-required (RFC 0168 §B.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-declaration.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.witness-required', 'RFC 0168 §B.1', `every family in spec/v2/declaration.json carries a \`witness\` from the closed set and no core family advertises \`unwitnessable\` (check-declaration.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
