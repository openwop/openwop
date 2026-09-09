/**
 * v2-path-parity — RFC 0172 §C.2 (corpus wrapper).
 *
 * The `/v1 ↔ /v2` analogy is retracted: AsyncAPI `servers.production.pathname`
 * is empty and channel addresses carry their own path, exactly as OpenAPI path
 * keys do; `scripts/check-path-parity.mjs` fails on any difference.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0172.path-parity`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0172-v2-versioning-and-release.md §C.2
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

describe('v2-path-parity (RFC 0172 §C.2)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-path-parity.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0172.path-parity', 'RFC 0172 §C.2', `OpenAPI, AsyncAPI, and the path manifest resolve identical absolute paths — v2 keys are unversioned on a bare origin (no \`/v1/\` or \`/v2/\` prefix), the v1 leg resolves under \`/v1\`, and the proto leg is retired-by-0175 (check-path-parity.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
