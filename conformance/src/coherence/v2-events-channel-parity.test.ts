/**
 * v2-events-channel-parity — RFC 0171 §E.1 (corpus wrapper).
 *
 * One `runEvents` channel at `/runs/{runId}/events`, one `hostEvents` heartbeat
 * channel with a real address (`address: null` is gone); OpenAPI and AsyncAPI
 * resolve identical absolute paths for the shared event stream.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0171.events-channel-parity`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0171-v2-wire-envelope.md §E.1
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

describe('v2-events-channel-parity (RFC 0171 §E.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-path-parity.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0171.events-channel-parity', 'RFC 0171 §E.1', `the v2 AsyncAPI \`runEvents\` channel address \`/runs/{runId}/events\` IS an OpenAPI path key with an empty server pathname, and the \`hostEvents\` heartbeat channel has a real address — OpenAPI and AsyncAPI resolve identical absolute paths for the shared event stream (check-path-parity.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
