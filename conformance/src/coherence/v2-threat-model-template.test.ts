/**
 * v2-threat-model-template — RFC 0173 §E.2 / RFC 0175 §F.1 (corpus wrapper).
 *
 * Every threat model is written with the sibling template (§1–§8); a threat model
 * missing a sibling section fails the template gate. RFC 0175 §F.1 requires
 * `SECURITY/threat-model-interop.md` under the same template.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0173.threat-model-template`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * @see RFCS/0173-v2-security-defaults.md §E.2
 * @see RFCS/0175-v2-transport-and-interop.md §F.1
 * @see scripts/check-threat-model-template.mjs
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

describe('v2-threat-model-template (RFC 0173 §E.2 / RFC 0175 §F.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'scripts', 'check-threat-model-template.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0173.threat-model-template', 'RFC 0173 §E.2 / RFC 0175 §F.1', `every SECURITY/threat-model-*.md carries the sibling template sections §1–§8 (Residual risks, Verification, References) and threat-model-interop.md exists — a threat model missing a sibling section fails the template gate (check-threat-model-template.mjs exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});
