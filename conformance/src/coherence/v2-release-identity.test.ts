/**
 * v2-release-identity — RFC 0172 §D.1 (corpus wrapper).
 *
 * The corpus tag is the only release event; every human-surface version (README
 * banner, PROTOCOL-STATUS, OpenAPI/AsyncAPI `info.version`) is generated with
 * `--check` in the merge gate. Two commands, both must exit 0.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0172.release-identity`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0172-v2-versioning-and-release.md §D.1
 * @see scripts/generate-protocol-status.mjs
 * @see scripts/derive-v2-api.py
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

describe('v2-release-identity (RFC 0172 §D.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'generate-protocol-status.mjs'), '--check'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0172.release-identity', 'RFC 0172 §D.1', `every human-surface version and count (README banner, docs/PROTOCOL-STATUS.md, the derived v2 OpenAPI/AsyncAPI) is generated and current with the tree — the corpus tag is the only release event and no surface is hand-kept (generate-protocol-status.mjs --check AND derive-v2-api.py --check exit 0) — ${tail(r0)}`)).toBe(0);
    const r1 = spawnSync('python3', [join(root, 'scripts', 'derive-v2-api.py'), '--check'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r1.status, req('openwop.requirement.0172.release-identity', 'RFC 0172 §D.1', `every human-surface version and count (README banner, docs/PROTOCOL-STATUS.md, the derived v2 OpenAPI/AsyncAPI) is generated and current with the tree — the corpus tag is the only release event and no surface is hand-kept (generate-protocol-status.mjs --check AND derive-v2-api.py --check exit 0) — ${tail(r1)}`)).toBe(0);
  }, 180_000);
});
