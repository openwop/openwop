/**
 * workspace-behavior — RFC 0059 §C/§D behavioral verification for a host
 * advertising `capabilities.workspace.supported: true`.
 *
 * Status: ACTIVE. Capability-gated: every block soft-skips when the host does
 * not advertise the workspace store.
 *
 * What this scenario asserts:
 *   1. §C CRUD round-trip — PUT create (version 1, etag), GET, list (metadata
 *      only, no `content`), DELETE, then GET → 404.
 *   2. §C optimistic concurrency — a PUT with a stale `If-Match` MUST return
 *      `409 workspace_conflict` with `details.currentVersion`; a matching
 *      `If-Match` MUST bump `version`.
 *   3. §C size ceiling — `content` beyond `maxFileBytes` MUST return
 *      `workspace_too_large`.
 *   4. §D run snapshot — a run started after a write exposes the workspace
 *      read snapshot on its run snapshot.
 *
 * @see RFCS/0059-agent-workspace.md §C §D
 * @see spec/v1/agent-workspace.md §"§C — Endpoints" / §"§D — Run-time exposure"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

interface DiscoveryWorkspace {
  supported?: boolean;
  maxFileBytes?: number;
}
interface DiscoveryDoc {
  capabilities?: { workspace?: DiscoveryWorkspace };
}

async function workspaceCap(): Promise<DiscoveryWorkspace | null> {
  const res = await driver.get('/.well-known/openwop');
  const ws = capabilityFamily((res.json as DiscoveryDoc | undefined), 'workspace');
  return ws?.supported === true ? ws : null;
}

const FILES = '/v1/host/workspace/files';

interface WorkspaceFile {
  path: string;
  content?: string;
  version: number;
  etag?: string;
}

describe('workspace-behavior: §C CRUD round-trip (RFC 0059)', () => {
  it('PUT creates v1, GET returns it, list omits content, DELETE removes it', async () => {
    if (!(await workspaceCap())) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    const path = 'behavior/CRUD.md';

    const created = await driver.put(`${FILES}/${encodeURIComponent(path)}`, { content: 'first body' });
    expect(created.status, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C PUT', 'create MUST return 200')).toBe(200);
    const file = created.json as WorkspaceFile;
    expect(file.version, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §File model', 'version MUST start at 1')).toBe(1);
    expect(typeof file.etag, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §File model', 'PUT MUST return an etag')).toBe('string');

    const got = await driver.get(`${FILES}/${encodeURIComponent(path)}`);
    expect((got.json as WorkspaceFile).content, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C GET', 'GET MUST return the content')).toBe('first body');

    const list = await driver.get(FILES);
    const rows = (list.json as { files?: WorkspaceFile[] }).files ?? [];
    const row = rows.find((r) => r.path === path);
    expect(row, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C list', 'list MUST include the created file')).toBeDefined();
    expect('content' in (row as object), req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C list', 'list MUST NOT include file bodies (metadata only)')).toBe(false);

    const del = await driver.del(`${FILES}/${encodeURIComponent(path)}`);
    expect(del.status, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C DELETE', 'DELETE MUST return 2xx')).toBeGreaterThanOrEqual(200);
    expect(del.status, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C DELETE', 'DELETE MUST be < 300')).toBeLessThan(300);

    const gone = await driver.get(`${FILES}/${encodeURIComponent(path)}`);
    expect(gone.status, req('openwop.it.workspace-behavior.put-creates-v1-get-returns-it-list-omits-content-delete-removes-it', 'agent-workspace.md §C GET', 'GET after DELETE MUST be 404')).toBe(404);
  });
});

describe('workspace-behavior: §C optimistic concurrency (RFC 0059)', () => {
  it('stale If-Match → 409 workspace_conflict; matching If-Match bumps version', async () => {
    if (!(await workspaceCap())) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    const path = 'behavior/ETAG.md';

    const v1 = await driver.put(`${FILES}/${encodeURIComponent(path)}`, { content: 'v1' });
    const etag = (v1.json as WorkspaceFile).etag!;

    const stale = await driver.put(`${FILES}/${encodeURIComponent(path)}`, { content: 'nope' }, { headers: { 'If-Match': '"definitely-stale"' } });
    expect(stale.status, req('openwop.it.workspace-behavior.stale-if-match-409-workspace-conflict-matching-if-match-bumps-version', 'agent-workspace.md §C PUT', 'a stale If-Match MUST return 409 workspace_conflict')).toBe(409);
    expect((stale.json as { error?: string }).error, req('openwop.it.workspace-behavior.stale-if-match-409-workspace-conflict-matching-if-match-bumps-version', 'rest-endpoints.md workspace_conflict', 'error code MUST be workspace_conflict')).toBe('workspace_conflict');
    const details = (stale.json as { details?: { currentVersion?: number } }).details;
    expect(typeof details?.currentVersion, req('openwop.it.workspace-behavior.stale-if-match-409-workspace-conflict-matching-if-match-bumps-version', 'agent-workspace.md §C PUT', '409 MUST carry details.currentVersion')).toBe('number');

    const v2 = await driver.put(`${FILES}/${encodeURIComponent(path)}`, { content: 'v2' }, { headers: { 'If-Match': etag } });
    expect(v2.status, req('openwop.it.workspace-behavior.stale-if-match-409-workspace-conflict-matching-if-match-bumps-version', 'agent-workspace.md §C PUT', 'a matching If-Match MUST succeed')).toBe(200);
    expect((v2.json as WorkspaceFile).version, req('openwop.it.workspace-behavior.stale-if-match-409-workspace-conflict-matching-if-match-bumps-version', 'agent-workspace.md §File model', 'a successful PUT MUST bump version')).toBe(2);

    await driver.del(`${FILES}/${encodeURIComponent(path)}`);
  });
});

describe('workspace-behavior: §C size ceiling (RFC 0059)', () => {
  it('content beyond maxFileBytes returns workspace_too_large', async () => {
    const cap = await workspaceCap();
    if (cap === null) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    const max = typeof cap.maxFileBytes === 'number' ? cap.maxFileBytes : 1_048_576;
    const tooBig = 'x'.repeat(max + 1);
    const res = await driver.put(`${FILES}/${encodeURIComponent('behavior/TOOBIG.md')}`, { content: tooBig });
    expect(res.status, req('openwop.it.workspace-behavior.content-beyond-maxfilebytes-returns-workspace-too-large', 'agent-workspace.md §C PUT', 'oversize content MUST be rejected (4xx)')).toBeGreaterThanOrEqual(400);
    expect((res.json as { error?: string }).error, req('openwop.it.workspace-behavior.content-beyond-maxfilebytes-returns-workspace-too-large', 'rest-endpoints.md workspace_too_large', 'error code MUST be workspace_too_large')).toBe('workspace_too_large');
  });
});

describe('workspace-behavior: §D run-start snapshot (RFC 0059)', () => {
  it('a run started after a write exposes the workspace snapshot', async () => {
    if (!(await workspaceCap())) return softSkip('inapplicable', 'optional advertisement — `capabilities.workspace` not advertised by this host (RFC 0059 §A)');
    const path = 'behavior/SNAPSHOT.md';
    await driver.put(`${FILES}/${encodeURIComponent(path)}`, { content: 'snapshot body' });

    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    if (create.status !== 201 && create.status !== 200) return seamAbsent(`host advertises workspace but the noop fixture run could not be created (POST /v1/runs → ${create.status})`);
    const runId = (create.json as { runId?: string }).runId;
    if (runId === undefined) return seamAbsent('host advertises workspace but the created run carried no runId');

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const ws = (snap.json as { workspace?: Array<{ path: string }> }).workspace;
    if (ws === undefined) return softSkip('blocked', 'precondition not met — `ws === undefined` returned early (host doesn\'t expose the snapshot field — skip) (seam, prior step, or fixture unavailable)'); // host doesn't expose the snapshot field — skip
    expect(
      ws.some((f) => f.path === path),
      req('openwop.it.workspace-behavior.a-run-started-after-a-write-exposes-the-workspace-snapshot', 'agent-workspace.md §D', 'the run snapshot MUST reflect a workspace file present at run start'),
    ).toBe(true);

    await driver.del(`${FILES}/${encodeURIComponent(path)}`);
  });
});
