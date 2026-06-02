/**
 * host.kanban — `vendor.myndhyve.kanban` bridge to the demo kanban store.
 *
 * Proves the surface is a REAL bridge, not a stub:
 *  - the `kanban.board.create` pack node, run end-to-end through createApp +
 *    the mounted pack, creates a board that appears in the SAME durable store
 *    (`kanbanService.listBoards`) the builder UI reads;
 *  - boardReview / taskAssign / timelinePlan / resourceMonitor / getReadyTasks /
 *    moveTask are genuinely computed against live cards (column counts, a
 *    dependency-aware critical path, per-assignee load, working-day schedule).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';
import { createCard, listBoards, getCard } from '../src/host/kanbanService.js';

let server: http.Server;
const PORT = 18195;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({
    port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false,
  });
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'op', typeId, config }], edges: [] }) });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
  }
  const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
  const ev = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op');
  return { __status: status, ...((ev?.payload?.outputs as Record<string, unknown>) ?? {}) };
}

describe('host.kanban: board.create node bridges to the durable store', () => {
  it('a kanban.board.create run creates a board visible in kanbanService', async () => {
    const out = await runNode('sample.kanban.create', 'kanban.board.create', {}, {
      name: 'Launch Board',
      columns: [{ id: 'todo', label: 'To Do' }, { id: 'doing', label: 'Doing' }, { id: 'done', label: 'Done' }],
    });
    expect(out.__status).toBe('completed');
    expect(typeof out.boardId).toBe('string');

    const boards = await listBoards('default');
    const created = boards.find((b) => b.id === out.boardId);
    expect(created, 'board must exist in the durable store the UI reads').toBeDefined();
    expect(created!.name).toBe('Launch Board');
    expect(created!.columns.map((c) => c.name)).toEqual(['To Do', 'Doing', 'Done']);
  });
});

describe('host.kanban: computed methods over live cards', () => {
  const k = () => buildHostSurfaceBundle({ tenantId: 'kanban-svc-test' }).kanban;

  it('boardReview aggregates column counts + at-risk cards; resourceMonitor tallies load', async () => {
    const { boardId } = await k().boardCreate({ name: 'Ops', columns: [{ id: 'todo', label: 'To Do' }, { id: 'done', label: 'Done' }], idempotencyKey: 'b1' });
    const soon = new Date(Date.now() + 86_400_000).toISOString(); // due in 1 day → at risk
    const past = new Date(Date.now() - 86_400_000).toISOString(); // overdue
    await createCard({ boardId, columnId: 'todo', title: 'T1', dueAt: soon, assigneeId: 'ada' });
    await createCard({ boardId, columnId: 'todo', title: 'T2', dueAt: past, assigneeId: 'ada' });
    await createCard({ boardId, columnId: 'done', title: 'T3', assigneeId: 'grace' });

    const review = await k().boardReview({ boardId, atRiskThresholdDays: 3 }) as Record<string, unknown>;
    expect(review.totalTasks).toBe(3);
    expect((review.columnCounts as Record<string, number>).todo).toBe(2);
    expect((review.columnCounts as Record<string, number>).done).toBe(1);
    // Both todo cards are at risk (one due soon, one overdue); the done card isn't.
    expect((review.atRiskTasks as unknown[]).length).toBe(2);

    const mon = await k().resourceMonitor({ boardId, maxConcurrentPerAssignee: 1 }) as Record<string, unknown>;
    expect((mon.assigneeLoad as Record<string, number>).ada).toBe(2); // 2 open cards
    expect((mon.assigneeLoad as Record<string, number>).grace ?? 0).toBe(0); // grace's card is done
    expect((mon.wipBreaches as unknown[]).length).toBe(1); // ada over max=1
    expect((mon.overdueTasks as unknown[]).length).toBe(1);
  });

  it('taskAssign records the previous assignee on reassignment', async () => {
    const { boardId } = await k().boardCreate({ name: 'Assign', columns: [{ id: 'todo', label: 'To Do' }], idempotencyKey: 'b2' });
    const card = await createCard({ boardId, columnId: 'todo', title: 'A' });
    const first = await k().taskAssign({ taskId: card.id, assigneeId: 'ada', idempotencyKey: 'a1' }) as Record<string, unknown>;
    expect(first.previousAssigneeId).toBeUndefined();
    const second = await k().taskAssign({ taskId: card.id, assigneeId: 'grace', idempotencyKey: 'a2' }) as Record<string, unknown>;
    expect(second.previousAssigneeId).toBe('ada');
    expect((await getCard(card.id))!.assigneeId).toBe('grace');
  });

  it('timelinePlan schedules a dependency chain with a real critical path', async () => {
    const { boardId } = await k().boardCreate({ name: 'Plan', columns: [{ id: 'todo', label: 'To Do' }], idempotencyKey: 'b3' });
    const a = await createCard({ boardId, columnId: 'todo', title: 'A', estimateHours: 8 });
    const b = await createCard({ boardId, columnId: 'todo', title: 'B', estimateHours: 8, dependsOn: [a.id] });
    const c = await createCard({ boardId, columnId: 'todo', title: 'C', estimateHours: 8, dependsOn: [b.id] });

    const plan = await k().timelinePlan({ boardId, startDate: '2026-06-01T00:00:00.000Z', workingHoursPerDay: 8, workingDaysPerWeek: 5, scheduler: 'critical-path', idempotencyKey: 'p1' }) as Record<string, unknown>;
    expect((plan.schedule as unknown[]).length).toBe(3);
    expect(plan.criticalPath).toEqual([a.id, b.id, c.id]);
    // C can't start before A+B finish: its start is after B's.
    const sched = plan.schedule as Array<{ taskId: string; startAt: string; endAt: string }>;
    const sa = sched.find((s) => s.taskId === a.id)!, sc = sched.find((s) => s.taskId === c.id)!;
    expect(sc.startAt > sa.endAt || sc.startAt === sa.endAt).toBe(true);
    expect(plan.projectEndDate).toBe(sc.endAt);
  });

  it('getReadyTasks gates on dependencies; moveTask resolves a column by name', async () => {
    const { boardId } = await k().boardCreate({ name: 'Ready', columns: [{ id: 'todo', label: 'To Do' }, { id: 'done', label: 'Done' }], idempotencyKey: 'b4' });
    const a = await createCard({ boardId, columnId: 'todo', title: 'A' });
    const b = await createCard({ boardId, columnId: 'todo', title: 'B', dependsOn: [a.id] });

    let ready = await k().getReadyTasks(boardId);
    expect(ready.map((t) => t.id)).toEqual([a.id]); // B blocked by A

    await k().moveTask(a.id, 'Done'); // resolve by column NAME
    expect((await getCard(a.id))!.columnId).toBe('done');

    ready = await k().getReadyTasks(boardId);
    expect(ready.map((t) => t.id)).toContain(b.id); // A done → B ready
  });
});
