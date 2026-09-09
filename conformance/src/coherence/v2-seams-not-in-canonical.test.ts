/**
 * v2-seams-not-in-canonical — RFC 0168 §C.2 (corpus wrapper).
 *
 * No seam operation in the canonical documents: `scripts/check-path-parity.mjs`
 * fails when `api/v2/openapi.yaml` or `spec/v2/path-manifest.json` carries a
 * seam / test-mode prefix.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.seams-not-in-canonical`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §C.2
 * @see scripts/check-path-parity.mjs
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

describe('v2-seams-not-in-canonical (RFC 0168 §C.2)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-path-parity.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.seams-not-in-canonical', 'RFC 0168 §C.2', `the canonical v2 OpenAPI and path manifest carry no seam or test-mode operation (\`/host/sample/\`, \`/host/workspace/files\`, \`/packs-test/\`) — seams live in the seams profile, never in the canonical documents (check-path-parity.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
