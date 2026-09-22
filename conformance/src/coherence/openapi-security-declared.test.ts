/**
 * RFC 0200 §F — the canonical OpenAPI documents declare the auth lanes and the scope every
 * operation enforces.
 *
 * The corpus gate is `scripts/check-openapi-security.mjs`; this coherence test runs its
 * predicate so the ledger carries a row for it. A script alone mints nothing:
 * `check-accepted-predicate` rule 4 reads `evidence/corpus-ledger.json` and the certified
 * bundles, and the ledger is emitted only from `src/coherence/`.
 *
 * @see api/openapi.yaml components.securitySchemes; api/v2/openapi.yaml
 * @see RFCS/0200-host-as-oauth-protected-resource.md §F
 */
import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

function tail(r: SpawnSyncReturns<string>): string {
  return (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-8).join(' | ');
}

describe('openapi-security-declared (RFC 0200 §F)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [join(root, 'scripts', 'check-openapi-security.mjs')], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(
      r.status,
      req('openwop.requirement.0200.openapi-security-declared', 'RFC 0200 §F.1–§F.4', `every operation in api/openapi.yaml and api/v2/openapi.yaml declares either security: [] or the three alternatives carrying the rest-endpoints.md scope; the four schemes are declared; WWW-Authenticate is on both shared refusals (check-openapi-security.mjs exit 0) — ${tail(r)}`),
    ).toBe(0);
  }, 180_000);
});
