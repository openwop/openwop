/**
 * Append-only agent-attributed-run index (RFC 0086): storage round-trip +
 * the recordRunAttribution writer.
 *
 *   - writer indexes a run carrying heartbeat/schedule/kanban/approval attribution
 *   - a run with no attribution is not indexed
 *   - listAgentRunActivity filters by roster + status and joins LIVE run status
 *     (the index row is immutable; status reflects a later updateRun)
 *   - the query is index-scoped: a non-attributed run never appears even if it's
 *     the most recent run in the tenant
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { RunRecord } from '../src/types.js';
import { recordRunAttribution } from '../src/host/agentRunActivityIndex.js';

let storage: Storage;
beforeEach(async () => { storage = await openStorage('memory://'); });
afterEach(async () => { await storage.close(); });

function run(over: Partial<RunRecord> & { runId: string }): RunRecord {
  return {
    workflowId: 'wf-1', tenantId: 't1', status: 'pending', inputs: null,
    metadata: {}, configurable: {}, createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z', ...over,
  };
}

async function insertAndIndex(r: RunRecord): Promise<void> {
  await storage.insertRun(r);
  await recordRunAttribution(storage, r);
}

describe('agent run activity index', () => {
  it('indexes attributed runs, filters by roster, and joins live status', async () => {
    await insertAndIndex(run({
      runId: 'hb', status: 'completed', createdAt: '2026-06-02T12:00:00.000Z',
      metadata: { heartbeat: { rosterId: 'host:sally', agentId: 'a1', source: 'heartbeat' } },
    }));
    await insertAndIndex(run({
      runId: 'sched', status: 'failed', createdAt: '2026-06-02T11:00:00.000Z',
      metadata: { schedule: { rosterId: 'host:priya', agentId: 'a2', source: 'schedule' } },
    }));
    // No attribution → must NOT be indexed even though it is the newest run.
    await insertAndIndex(run({ runId: 'orphan', createdAt: '2026-06-02T13:00:00.000Z', metadata: {} }));

    const sally = await storage.listAgentRunActivity({ tenantId: 't1', rosterId: 'host:sally' });
    expect(sally.map((r) => r.runId)).toEqual(['hb']);

    const all = await storage.listAgentRunActivity({ tenantId: 't1' });
    expect(all.map((r) => r.runId).sort()).toEqual(['hb', 'sched']); // orphan excluded

    // status filter (failures view)
    const failed = await storage.listAgentRunActivity({ tenantId: 't1', status: 'failed' });
    expect(failed.map((r) => r.runId)).toEqual(['sched']);
  });

  it('reflects a later status change via the live join (index row is immutable)', async () => {
    await insertAndIndex(run({ runId: 'r1', status: 'running', metadata: { approval: { rosterId: 'host:x', source: 'approval' } } }));
    expect((await storage.listAgentRunActivity({ tenantId: 't1', status: 'completed' }))).toHaveLength(0);

    await storage.updateRun('r1', { status: 'completed', completedAt: '2026-06-02T10:05:00.000Z' });
    const done = await storage.listAgentRunActivity({ tenantId: 't1', status: 'completed' });
    expect(done.map((r) => r.runId)).toEqual(['r1']);
    expect(done[0]!.completedAt).toBe('2026-06-02T10:05:00.000Z'); // live status, not stale index
  });

  it('recordRunAttribution is a no-op for an attribution block without a rosterId', async () => {
    await insertAndIndex(run({ runId: 'noroster', metadata: { heartbeat: { source: 'heartbeat' } } }));
    expect(await storage.listAgentRunActivity({ tenantId: 't1' })).toHaveLength(0);
  });

  it('is idempotent on runId (re-recording does not duplicate)', async () => {
    const r = run({ runId: 'dup', metadata: { schedule: { rosterId: 'host:y', source: 'schedule' } } });
    await insertAndIndex(r);
    await recordRunAttribution(storage, r); // again
    expect(await storage.listAgentRunActivity({ tenantId: 't1' })).toHaveLength(1);
  });
});
