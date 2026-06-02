/**
 * Agent run-activity projection (host/agentActivity.ts) — the logic shared by
 * the per-agent and fleet activity feeds.
 *
 *   - projects heartbeat/schedule/kanban attribution into items
 *   - drops runs with no agent attribution
 *   - filters by rosterId and by status (the failures view)
 *   - newest-first ordering; carries persona/agentId/cardId; terminal timestamp
 */

import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/types.js';
import { projectAgentActivity } from '../src/host/agentActivity.js';

function run(over: Partial<RunRecord> & { runId: string }): RunRecord {
  return {
    workflowId: 'wf-1',
    tenantId: 't1',
    status: 'completed',
    inputs: null,
    metadata: {},
    configurable: {},
    createdAt: '2026-06-02T10:00:00.000Z',
    updatedAt: '2026-06-02T10:00:00.000Z',
    ...over,
  };
}

const RUNS: RunRecord[] = [
  run({
    runId: 'hb-sally',
    status: 'completed',
    completedAt: '2026-06-02T12:00:00.000Z',
    metadata: { heartbeat: { rosterId: 'host:sally', persona: 'Sally', agentId: 'host:demo-sales', cardId: 'card-1', source: 'heartbeat' } },
  }),
  run({
    runId: 'sched-priya',
    status: 'failed',
    completedAt: '2026-06-02T11:00:00.000Z',
    error: { code: 'x', message: 'boom' },
    metadata: { schedule: { jobId: 'j1', source: 'schedule', rosterId: 'host:priya', agentId: 'host:demo-finance' } },
  }),
  run({
    runId: 'kanban-sally',
    status: 'failed',
    completedAt: '2026-06-02T13:00:00.000Z',
    metadata: { kanban: { rosterId: 'host:sally', persona: 'Sally', cardId: 'card-9', triggerSource: 'queue' } },
  }),
  run({ runId: 'no-attribution', metadata: { other: { x: 1 } } }), // dropped
];

describe('projectAgentActivity', () => {
  it('projects only agent-attributed runs, newest first', () => {
    const items = projectAgentActivity(RUNS);
    expect(items.map((i) => i.runId)).toEqual(['kanban-sally', 'hb-sally', 'sched-priya']); // 13:00, 12:00, 11:00
    expect(items.find((i) => i.runId === 'no-attribution')).toBeUndefined();
  });

  it('carries source, persona, agentId, cardId', () => {
    const hb = projectAgentActivity(RUNS).find((i) => i.runId === 'hb-sally')!;
    expect(hb.source).toBe('heartbeat');
    expect(hb.persona).toBe('Sally');
    expect(hb.agentId).toBe('host:demo-sales');
    expect(hb.cardId).toBe('card-1');
    expect(hb.timestamp).toBe('2026-06-02T12:00:00.000Z'); // completedAt preferred
  });

  it('filters by rosterId', () => {
    const items = projectAgentActivity(RUNS, { rosterId: 'host:sally' });
    expect(items.map((i) => i.runId).sort()).toEqual(['hb-sally', 'kanban-sally']);
  });

  it('filters by status (failures view)', () => {
    const failed = projectAgentActivity(RUNS, { status: 'failed' });
    expect(failed.map((i) => i.runId)).toEqual(['kanban-sally', 'sched-priya']);
    expect(failed.every((i) => i.status === 'failed')).toBe(true);
  });

  it('combines rosterId + status filters', () => {
    const items = projectAgentActivity(RUNS, { rosterId: 'host:priya', status: 'failed' });
    expect(items.map((i) => i.runId)).toEqual(['sched-priya']);
  });
});
