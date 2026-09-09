/**
 * v2-externally-gated-never-stable — RFC 0169 §C.4 (corpus wrapper).
 *
 * `externally-gated` is the third disposition; such a family MAY be declared
 * `status: experimental` with an `until` equal to the tripwire review date, or
 * omitted, and MUST NOT be `stable`. The declaration schema + check hold it.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0169.externally-gated-never-stable`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0169-v2-discovery-and-capabilities.md §C.4
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

describe('v2-externally-gated-never-stable (RFC 0169 §C.4)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-declaration.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0169.externally-gated-never-stable', 'RFC 0169 §C.4', `an \`externally-gated\` family (RFC 0121 legal citation, RFC 0035 tripwire — \`capabilities.sandbox\` first) is declared \`experimental\` with an \`until\`, or omitted; it is never \`stable\` (check-declaration.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
