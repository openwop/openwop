/**
 * v2-alias-covers-reword — RFC 0168 §A.1 (corpus wrapper).
 *
 * Ids are minted in `conformance/requirements.json`; a title reword without a
 * `requirement-aliases.json` row fails CI because the generator diffs ids
 * against the last published set. This wrapper runs that diff (`--check`) with
 * cwd `conformance`, exactly as the merge gate does.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.alias-covers-reword`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §A.1
 * @see conformance/scripts/generate-requirement-registry.mjs
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

describe('v2-alias-covers-reword (RFC 0168 §A.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'conformance', 'scripts', 'generate-requirement-registry.mjs'), '--check'], { cwd: join(root, 'conformance'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.alias-covers-reword', 'RFC 0168 §A.1', `the requirement registry is current and every reworded title has a requirement-aliases.json row — a reword that orphans a published id fails the generator diff (generate-requirement-registry.mjs --check exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
