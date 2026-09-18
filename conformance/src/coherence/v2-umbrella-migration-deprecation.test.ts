/**
 * v2-umbrella-migration-deprecation — RFC 0167 §D.1 (corpus wrapper).
 *
 * RFC 0167 is the v2 umbrella, and until this file its falsifiability table
 * named ZERO requirement ids — so RFC 0174 §B.1 rule 4 passed vacuously for the
 * largest flip in the program. The evidence always existed and hard-failed in
 * the merge gate; only the binding was missing.
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle: it spawns the root gate script and asserts exit 0 under its
 * requirement id, so evidence/corpus-ledger.json carries a row the RFC's
 * falsifiability entry can name (RFC 0168 §D.1 — two products, two ledgers).
 *
 * @see RFCS/0167-openwop-v2-umbrella.md §D.1
 * @see scripts/check-migrations.mjs
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

describe('v2-umbrella-migration-deprecation (RFC 0167 §D.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-migrations.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0167.migration-deprecation-bound', 'RFC 0167 §D.1', `every migration names the deprecation it discharges — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
