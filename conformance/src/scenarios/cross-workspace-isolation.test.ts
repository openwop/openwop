/**
 * cross-workspace-isolation — RFC 0048 §D verification.
 *
 * Status: DRAFT. RFC 0048 (tenant·workspace·principal identity model) is
 * `Draft`.
 *
 * What this scenario asserts:
 *   1. Run-ownership echo shape — when a readable run snapshot carries
 *      `owner`, it MUST include a non-empty `tenant` (RFC 0048 §C).
 *   2. Cross-workspace isolation MUST-NOT (§D) — when the host exposes the
 *      optional `POST /v1/host/sample/identity/cross-workspace-read` seam
 *      (a principal scoped to workspace A attempts to read a run owned by
 *      workspace B), the read MUST fail closed with `run_forbidden` (or a
 *      `404`/`403` that does not leak the other workspace's run contents).
 *
 * Hosts without the seam soft-skip the isolation probe (404). The
 * advertisement/ownership-shape assertion still runs.
 *
 * @see RFCS/0048-tenant-workspace-principal-identity-model.md
 * @see spec/v1/auth.md §"Identity claims — tenant · workspace · principal"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';

const ISOLATION_CODES: ReadonlySet<string> = new Set(['run_forbidden', 'not_found']);

interface OwnerTriple {
  tenant?: string;
  workspace?: string;
  principal?: string;
}

describe('cross-workspace-isolation: run-ownership echo shape (RFC 0048 §C)', () => {
  it('owner, when present on a run snapshot, carries a non-empty tenant', async () => {
    // Best-effort: probe a sample run if the host exposes one; otherwise skip.
    const res = await driver.get('/v1/host/sample/identity/owned-run');
    if (res.status === 404) return softSkip('blocked', 'no sample-run seam — soft-skip');
    const owner = (res.json as { owner?: OwnerTriple } | undefined)?.owner;
    if (owner === undefined) return softSkip('blocked', 'single-tenant host — owner omitted (owner === undefined)');
    expect(
      typeof owner.tenant === 'string' && owner.tenant.length > 0,
      req('openwop.it.cross-workspace-isolation.owner-when-present-on-a-run-snapshot-carries-a-non-empty-tenant', 'RFC 0048 §C', 'RunSnapshot.owner MUST carry a non-empty tenant when present'),
    ).toBe(true);
  });
});

describe('cross-workspace-isolation: a principal MUST NOT read another workspace\'s run (RFC 0048 §D)', () => {
  it('cross-workspace read fails closed with run_forbidden', async () => {
    // Seam contract: a principal scoped to workspace A requests a run owned
    // by workspace B. The host MUST refuse rather than return B's run.
    const res = await driver.post('/v1/host/sample/identity/cross-workspace-read', {});
    if (res.status === 404) return softSkip('blocked', 'seam unwired — soft-skip');

    expect(
      res.status,
      req('openwop.it.cross-workspace-isolation.cross-workspace-read-fails-closed-with-run-forbidden', 
        'spec/v1/auth.md §Identity claims',
        'a cross-workspace read MUST fail closed (4xx), never return the other workspace\'s run',
      ),
    ).toBeGreaterThanOrEqual(400);

    const code = (res.json as { error?: string } | undefined)?.error;
    expect(
      code !== undefined && ISOLATION_CODES.has(code),
      req('openwop.it.cross-workspace-isolation.cross-workspace-read-fails-closed-with-run-forbidden', 
        'spec/v1/rest-endpoints.md run_forbidden',
        `error MUST be one of {${[...ISOLATION_CODES].join(', ')}} (fail-closed, no existence leak), got: ${code ?? '(absent)'}`,
      ),
    ).toBe(true);
  });
});
