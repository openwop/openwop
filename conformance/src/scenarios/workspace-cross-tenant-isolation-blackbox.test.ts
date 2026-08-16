/**
 * workspace-cross-tenant-isolation-blackbox — RFC 0059 §E WCT-1 on the PRODUCTION wire.
 *
 * The black-box, production-path counterpart to the seam-driven
 * `workspace-cross-tenant-isolation.test.ts`. Instead of the single-credential
 * `POST /v1/host/sample/workspace/op` seam, this drives the NORMATIVE §C
 * endpoints (`PUT`/`GET /v1/host/workspace/files/{path}`, `GET /v1/host/workspace
 * /files`) with TWO distinct operator credentials that resolve to two different
 * `{tenant, workspace}` owners (RFC 0048). It writes a secret as owner A and
 * proves owner B cannot read or enumerate it — no `/v1/host/sample/*` seam, the
 * exact contract a deployed multi-tenant host honors.
 *
 * This is the "replace seam-gated proofs with black-box production-path
 * conformance" step (independent-audit acceptance-bar item 3) for RFC 0059. Once
 * a host passes it non-vacuously, `workspace-cross-tenant-isolation` is proven on
 * the production wire and the surface graduates INTO the `openwop-core-standard`
 * floor (RFC 0088 §D Lever-2 → floor).
 *
 * Gating: soft-skips unless `capabilities.workspace.supported` AND
 * `OPENWOP_TEST_TENANT_B_API_KEY` (a credential for a SECOND, distinct
 * tenant·workspace) is supplied — the suite cannot mint a second tenant itself.
 *
 * @see RFCS/0059-agent-workspace.md §E WCT-1
 * @see SECURITY/invariants.yaml workspace-cross-tenant-isolation
 */
import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { randomUUID } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  workspace?: { supported?: boolean };
}

async function workspaceSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  return capabilityFamily(res.json as DiscoveryDoc | undefined, 'workspace')?.supported === true;
}

const tenantBKey = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
const asTenantB = { headers: { Authorization: `Bearer ${tenantBKey ?? ''}` } };

describe('workspace-cross-tenant-isolation (black-box): a §C file MUST NOT leak across owners (RFC 0059 §E WCT-1)', () => {
  it('a file written by owner A is unreadable + un-enumerable by a second-tenant credential', async () => {
    if (!(await workspaceSupported())) return softSkip('inapplicable', 'capability not advertised — skip');
    if (!tenantBKey) {
      // eslint-disable-next-line no-console
      console.warn('[workspace-cross-tenant-isolation-blackbox] OPENWOP_TEST_TENANT_B_API_KEY not supplied; skipping the production-path cross-tenant assertion');
      return softSkip('blocked', '[workspace-cross-tenant-isolation-blackbox] OPENWOP_TEST_TENANT_B_API_KEY not supplied; skipping the production-path cross-tenant assertion');
    }

    const path = `wct-blackbox-${randomUUID()}.md`;
    const secret = `WCT1-BLACKBOX-SECRET-${randomUUID()}`;

    // Owner A (default credential) writes the file via the NORMATIVE PUT.
    const put = await driver.put(`/v1/host/workspace/files/${path}`, { content: secret });
    expect(put.status, driver.describe('agent-workspace.md §C PUT', 'the owning workspace MUST create its file (200)')).toBe(200);

    try {
      // Owner B (second-tenant credential) MUST NOT read it — fail closed, no existence leak.
      const crossRead = await driver.get(`/v1/host/workspace/files/${path}`, asTenantB);
      expect(
        crossRead.status === 404 || crossRead.status === 403,
        driver.describe('agent-workspace.md §E WCT-1', `a second-tenant read MUST fail closed (404/403), got ${crossRead.status}`),
      ).toBe(true);
      expect(
        !JSON.stringify(crossRead.json ?? '').includes(secret),
        driver.describe('agent-workspace.md §E WCT-1', 'a second-tenant read MUST NOT surface the owner\'s content'),
      ).toBe(true);

      // Owner B MUST NOT enumerate it in the list projection.
      const crossList = await driver.get('/v1/host/workspace/files', asTenantB);
      if (crossList.status === 200) {
        expect(
          !JSON.stringify((crossList.json as { files?: unknown })?.files ?? []).includes(path),
          driver.describe('agent-workspace.md §E WCT-1', 'a second-tenant list MUST NOT enumerate the owner\'s path'),
        ).toBe(true);
      }

      // Isolation, not loss: owner A still reads its own file.
      const ownerRead = await driver.get(`/v1/host/workspace/files/${path}`);
      expect(ownerRead.status, driver.describe('agent-workspace.md §C GET', 'the owning workspace MUST still read its own file')).toBe(200);
      expect((ownerRead.json as { content?: string } | undefined)?.content).toBe(secret);
    } finally {
      // Best-effort cleanup as owner A.
      await driver.delete(`/v1/host/workspace/files/${path}`).catch(() => undefined);
    }
  });
});
