/**
 * v2-spec-artifacts-digest — RFC 0168 §D.2 (corpus wrapper).
 *
 * The corpus is digest-checked at suite start against the `@openwop/spec-artifacts`
 * peer (`lib/paths.ts`). This wrapper proves the generated peer tree and its
 * stamp digest are current with the corpus.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.spec-artifacts-digest`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §D.2
 * @see scripts/generate-spec-artifacts.mjs
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

describe('v2-spec-artifacts-digest (RFC 0168 §D.2)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'generate-spec-artifacts.mjs'), '--check'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.spec-artifacts-digest', 'RFC 0168 §D.2', `the @openwop/spec-artifacts tree and its stamp digest equal the corpus (schemas/, api/, spec/) — a suite run that digest-checks the peer at start refuses a drifted contract (generate-spec-artifacts.mjs --check exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
