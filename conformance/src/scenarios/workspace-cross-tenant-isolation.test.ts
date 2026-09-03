/**
 * workspace-cross-tenant-isolation — RFC 0059 §E WCT-1.
 *
 * Status: ACTIVE (advertisement + behavioral). Public test for the
 * `workspace-cross-tenant-isolation` SECURITY invariant: a workspace file
 * owned by `{tenant, workspace}` MUST NOT be readable (get or list) under a
 * different `{tenant′, workspace′}`, regardless of the caller's permissions
 * elsewhere. Mirrors `kv-cross-tenant-isolation` / `agent-memory-cti-1`.
 *
 * The two owners are driven through the documented test seam
 * `POST /v1/host/sample/workspace/op` (host-sample-test-seams.md §9), which
 * lets a single-credential host exercise distinct owners. Hosts without the
 * seam soft-skip the behavioral probe; the advertisement-shape assertion still
 * runs whenever `capabilities.workspace.supported` is advertised.
 *
 * @see RFCS/0059-agent-workspace.md §E WCT-1
 * @see spec/v1/agent-workspace.md §"§E — Invariants"
 * @see SECURITY/invariants.yaml workspace-cross-tenant-isolation
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

interface DiscoveryDoc {
  capabilities?: { workspace?: { supported?: boolean } };
}

async function workspaceSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'workspace')?.supported === true;
}

function seam(args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/workspace/op', args);
}

const SEAM_PATH = 'WCT1-SECRET.md';

describe('workspace-cross-tenant-isolation: a workspace file MUST NOT leak across owners (RFC 0059 §E WCT-1)', () => {
  it('a file written under {tenant A, workspace A} is not readable under a different owner', async () => {
    if (!(await workspaceSupported())) return softSkip('inapplicable', 'capability not advertised — skip');

    // Owner A writes a file.
    const put = await seam({ tenant: 'wct1-tenant-a', workspace: 'ws-a', op: 'put', path: SEAM_PATH, content: 'A-only secret body' });
    if (put.status === 404) return softSkip('blocked', 'seam unwired — soft-skip the behavioral probe');
    expect(put.status, req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §C PUT', 'seam put MUST succeed for the owning workspace')).toBe(200);

    // A DIFFERENT workspace (same tenant) MUST NOT read it.
    const crossWs = await seam({ tenant: 'wct1-tenant-a', workspace: 'ws-b', op: 'get', path: SEAM_PATH });
    expect(
      crossWs.status === 404 || crossWs.status === 403,
      req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §E WCT-1', `a cross-workspace get MUST fail closed (404/403, no existence leak), got ${crossWs.status}`),
    ).toBe(true);
    const crossWsBody = JSON.stringify(crossWs.json ?? '');
    expect(
      !crossWsBody.includes('A-only secret body'),
      req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §E WCT-1', 'a cross-workspace read MUST NOT surface the other owner\'s content'),
    ).toBe(true);

    // A DIFFERENT tenant MUST NOT read it either.
    const crossTenant = await seam({ tenant: 'wct1-tenant-b', workspace: 'ws-a', op: 'get', path: SEAM_PATH });
    expect(
      crossTenant.status === 404 || crossTenant.status === 403,
      req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §E WCT-1', `a cross-tenant get MUST fail closed, got ${crossTenant.status}`),
    ).toBe(true);

    // And list MUST NOT enumerate the other owner's path.
    const crossList = await seam({ tenant: 'wct1-tenant-a', workspace: 'ws-b', op: 'list' });
    const listed = JSON.stringify((crossList.json as { files?: unknown })?.files ?? []);
    expect(
      !listed.includes(SEAM_PATH),
      req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §E WCT-1', 'a cross-workspace list MUST NOT enumerate another owner\'s file'),
    ).toBe(true);

    // Sanity: the owner itself still reads its file (isolation, not loss).
    const ownerRead = await seam({ tenant: 'wct1-tenant-a', workspace: 'ws-a', op: 'get', path: SEAM_PATH });
    expect(
      (ownerRead.json as { content?: string } | undefined)?.content,
      req('openwop.it.workspace-cross-tenant-isolation.a-file-written-under-tenant-a-workspace-a-is-not-readable-under-a-different-owne', 'agent-workspace.md §C GET', 'the owning workspace MUST still read its own file'),
    ).toBe('A-only secret body');
  });
});
