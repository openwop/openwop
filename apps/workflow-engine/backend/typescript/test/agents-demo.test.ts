/**
 * Agents-demo experience — backend foundations (PRD Phase 0).
 *
 * Covers the new host-extension surfaces that back the "AI coworkers" UX:
 *   - POST /v1/host/sample/demo/seed seeds the registered demo domains
 *     idempotently (no-op on re-run; never clobbers an existing roster)
 *   - seeded boards carry source-tagged cards; the To Do column triggers the
 *     agent's first portfolio workflow
 *   - POST /v1/host/sample/roster/:id/check (heartbeat) claims the first To Do
 *     card, starts a run, and moves the card to Working
 *   - scheduler jobs are durable + tenant-scoped + roster-filterable, and a
 *     :trigger on a workflow-bearing job starts a real run
 *   - PATCH /v1/host/sample/agents/:id edits a user-authored agent's instructions
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { getAgentRegistry } from '../src/executor/agentRegistry.js';

let server: http.Server;
const PORT = 18233;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text.length ? JSON.parse(text) : null) as T };
}

interface RosterEntry {
  rosterId: string;
  persona: string;
  workflows: string[];
  autonomyLevel?: 'auto' | 'review';
}

describe('agents-demo backend foundations', () => {
  it('seeds 5 demo agents and is idempotent', async () => {
    const first = await api<{ seeded: boolean; agents: number; domains: string[] }>('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);
    expect(first.body.seeded).toBe(true);
    expect(first.body.agents).toBe(5);
    expect(first.body.domains).toEqual(['user-agents', 'roster', 'boards', 'cards', 'schedules', 'org-chart']);

    const roster = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    expect(roster.body.roster.length).toBe(5);
    expect(roster.body.roster.map((r) => r.persona)).toContain('Sally');

    // Seedable autonomy (white-label): the stock seed ships Nora in `review`
    // (so the approval flow is demoable out of the box); others default to auto.
    const nora = roster.body.roster.find((r) => r.persona === 'Nora')!;
    expect(nora.autonomyLevel).toBe('review');
    const sally = roster.body.roster.find((r) => r.persona === 'Sally')!;
    expect(sally.autonomyLevel).toBeUndefined();

    // Re-seed is a no-op (does not clobber the existing roster).
    const second = await api<{ seeded: boolean; domains: string[] }>('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
    expect(second.body.seeded).toBe(false);
    expect(second.body.domains).toEqual(['user-agents', 'roster', 'boards', 'cards', 'schedules', 'org-chart']);
    const rosterAgain = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    expect(rosterAgain.body.roster.length).toBe(5);
  });

  it('registers each seeded persona as a chat-callable inventory agent (so @Nora works in chat)', async () => {
    // The chat `@`-mention list is fed by GET /v1/agents (RFC 0072); before this
    // wiring the personas existed ONLY as roster entries (a synthetic
    // attribution-only agentRef) and were unreachable from chat. The seed now
    // registers each as a tenant-owned user-agent with the persona's authored
    // systemPrompt, so it surfaces in the inventory and the chat-responder can
    // resolve inputs.agentId → systemPrompt (gated by ownerTenant).
    const inv = await api<{ agents: Array<{ agentId: string; persona: string; modelClass: string; packName: string }> }>(
      '/v1/agents',
    );
    expect(inv.status).toBe(200);
    const personas = inv.body.agents.map((a) => a.persona);
    for (const name of ['Sally', 'Marcus', 'Priya', 'Devon', 'Nora']) {
      expect(personas).toContain(name);
    }
    // The roster↔inventory link: the persona's inventory agentId is the
    // deterministic `user.<tenant>.<slug>` the roster entry's agentRef points at.
    const nora = inv.body.agents.find((a) => a.persona === 'Nora')!;
    expect(nora.agentId).toBe('user.default.nora');
    expect(nora.modelClass).toBe('chat');
    expect(nora.packName).toBe('user:default'); // tenant-scoped provenance (ownerTenant)
  });

  it('seeded board has source-tagged cards under a triggering To Do column', async () => {
    const roster = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    const sally = roster.body.roster.find((r) => r.persona === 'Sally')!;
    expect(sally.workflows[0]).toBe('sample.agents.lead-routing');

    const boards = await api<{ boards: Array<{ id: string; rosterId?: string; columns: Array<{ id: string; triggerWorkflowId?: string }> }> }>(
      '/v1/host/sample/kanban/boards',
    );
    const board = boards.body.boards.find((b) => b.rosterId === sally.rosterId)!;
    expect(board).toBeTruthy();
    const todo = board.columns.find((c) => c.id === 'todo')!;
    expect(todo.triggerWorkflowId).toBe('sample.agents.lead-routing');

    const detail = await api<{ cards: Array<{ source?: string; sourceLabel?: string; columnId: string }> }>(
      `/v1/host/sample/kanban/boards/${board.id}`,
    );
    expect(detail.body.cards.length).toBeGreaterThan(0);
    expect(detail.body.cards.some((c) => c.source === 'discord')).toBe(true);

    // ?include=cards returns every board WITH its cards in one request (the
    // dashboard batch path — no N+1 getBoard).
    const batched = await api<{ boards: Array<{ id: string; rosterId?: string; cards: Array<{ source?: string }> }> }>(
      '/v1/host/sample/kanban/boards?include=cards',
    );
    expect(batched.status).toBe(200);
    const sallyBoard = batched.body.boards.find((b) => b.rosterId === sally.rosterId)!;
    expect(Array.isArray(sallyBoard.cards)).toBe(true);
    expect(sallyBoard.cards.length).toBeGreaterThan(0);
  });

  it('heartbeat check claims a To Do card, starts a run, and moves it to Working', async () => {
    const roster = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    const sally = roster.body.roster.find((r) => r.persona === 'Sally')!;

    const checked = await api<{ picked: boolean; cardId: string; runId: string; lastHeartbeatAt?: string }>(
      `/v1/host/sample/roster/${sally.rosterId}/check`,
      { method: 'POST', body: '{}' },
    );
    expect(checked.status).toBe(200);
    expect(checked.body.picked).toBe(true);
    expect(typeof checked.body.runId).toBe('string');
    // The heartbeat stamps "last checked" on the entry + returns it.
    expect(typeof checked.body.lastHeartbeatAt).toBe('string');
    const afterCheck = await api<RosterEntry & { lastHeartbeatAt?: string }>(`/v1/host/sample/roster/${sally.rosterId}`);
    expect(afterCheck.status).toBe(200);
    expect(afterCheck.body.lastHeartbeatAt).toBe(checked.body.lastHeartbeatAt);

    // The run exists AND runs to completion — the demo role-workflow
    // (sample.agents.lead-routing → local.sample.demo.mock-ai) must execute
    // to a terminal `completed` state, not just be created. Dispatch is async
    // (setImmediate), so poll until terminal.
    let status = 'pending';
    for (let i = 0; i < 50 && status !== 'completed' && status !== 'failed'; i++) {
      const run = await api<{ status: string }>(`/v1/runs/${checked.body.runId}`);
      expect(run.status).toBe(200);
      status = run.body.status;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(status).toBe('completed');

    // The card moved out of To Do (into Working).
    const boards = await api<{ boards: Array<{ id: string; rosterId?: string }> }>('/v1/host/sample/kanban/boards');
    const board = boards.body.boards.find((b) => b.rosterId === sally.rosterId)!;
    const detail = await api<{ cards: Array<{ id: string; columnId: string }> }>(`/v1/host/sample/kanban/boards/${board.id}`);
    const movedCard = detail.body.cards.find((c) => c.id === checked.body.cardId)!;
    expect(movedCard.columnId).toBe('working');

    // The activity feed surfaces that run with its outcome, a timestamp, and
    // the enriched provenance fields (createdAt / completedAt / durationMs).
    const activity = await api<{
      items: Array<{
        runId: string; status: string; source: string; timestamp: string;
        createdAt?: string; completedAt?: string; durationMs?: number; causationId?: string;
      }>;
    }>(`/v1/host/sample/roster/${sally.rosterId}/activity`);
    expect(activity.status).toBe(200);
    const entry = activity.body.items.find((i) => i.runId === checked.body.runId)!;
    expect(entry).toBeTruthy();
    expect(entry.source).toBe('heartbeat');
    expect(entry.status).toBe('completed');
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    // A completed run carries both bookends and a non-negative duration.
    expect(typeof entry.createdAt).toBe('string');
    expect(typeof entry.completedAt).toBe('string');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it('scheduler jobs are durable + roster-filterable, and :trigger starts a run', async () => {
    const roster = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    const sally = roster.body.roster.find((r) => r.persona === 'Sally')!;

    // The seed registered Sally's schedules; filter by roster.
    const byRoster = await api<{ jobs: Array<{ jobId: string; rosterId?: string; workflowId?: string }> }>(
      `/v1/host/sample/scheduler/jobs?rosterId=${encodeURIComponent(sally.rosterId)}`,
    );
    expect(byRoster.body.jobs.length).toBeGreaterThan(0);
    expect(byRoster.body.jobs.every((j) => j.rosterId === sally.rosterId)).toBe(true);

    const job = byRoster.body.jobs.find((j) => j.workflowId)!;
    const fired = await api<{ runsFired: number; runId?: string }>(
      `/v1/host/sample/scheduler/jobs/${encodeURIComponent(job.jobId)}/trigger`,
      { method: 'POST', body: '{}' },
    );
    expect(fired.status).toBe(200);
    expect(fired.body.runsFired).toBe(1);
    expect(typeof fired.body.runId).toBe('string');
  });

  it('PATCH edits a user-authored agent’s instructions', async () => {
    const created = await api<{ agentId: string; systemPrompt?: string }>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({ persona: 'Edith', modelClass: 'chat', systemPrompt: 'You are Edith. Original.' }),
    });
    expect(created.status).toBe(201);

    const patched = await api<{ systemPrompt: string }>(`/v1/host/sample/agents/${created.body.agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ systemPrompt: 'You are Edith. Updated instructions.' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.systemPrompt).toBe('You are Edith. Updated instructions.');

    // persona is immutable.
    const rejected = await api<{ error: string }>(`/v1/host/sample/agents/${created.body.agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ persona: 'Renamed' }),
    });
    expect(rejected.status).toBe(400);
  });

  it('skips demo seeding entirely when OPENWOP_DEMO_SEED_ENABLED=false (white-label)', async () => {
    // The toggle is read per-call, so a branded deployment can ship a clean
    // tenant with no demo personas. Early-return shape is `agents: 0`, distinct
    // from the idempotent no-op (`seeded:false, agents:5`).
    process.env.OPENWOP_DEMO_SEED_ENABLED = 'false';
    try {
      const res = await api<{ seeded: boolean; agents: number }>('/v1/host/sample/demo/seed', {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBe(200);
      expect(res.body.seeded).toBe(false);
      expect(res.body.agents).toBe(0);
    } finally {
      delete process.env.OPENWOP_DEMO_SEED_ENABLED;
    }
  });

  it('resolve() reads a seeded agent through from durable storage on a cold registry (multi-instance)', async () => {
    // The registry is boot-hydrated, NOT read-through. Simulate an instance that
    // booted before the seed: drop the in-process map, leaving the durable
    // user-agent rows (written by the seed in the first test) intact. Runs last;
    // vitest isolates module state per file, so this reset can't leak into other
    // suites.
    getAgentRegistry()._resetForTest();
    expect(getAgentRegistry().get('user.default.nora')).toBeNull(); // cold: not in-process

    // resolve() falls through to the agent-pack resolver, which now hydrates a
    // user/seeded agent from storage on a miss — so the chat-responder dispatch
    // and the by-id inventory routes route correctly on any instance.
    const hydrated = await getAgentRegistry().resolve('user.default.nora');
    expect(hydrated?.persona).toBe('Nora');
    expect(hydrated?.ownerTenant).toBe('default'); // tenant-scoping preserved
    // Now cached in-process (last-write-wins register).
    expect(getAgentRegistry().get('user.default.nora')?.persona).toBe('Nora');
  });
});

describe('demo seed heal mode — restores missing surfaces (live bug 2026-06-04)', () => {
  // Reproduces the production failure: a tenant whose roster entries survived
  // but whose BOARD rows were lost (rows predating the read-through-durability
  // hardening). The old create-only seed skipped existing personas entirely,
  // so "Load demo data" could never bring the boards back.
  it('plain re-seed does NOT resurrect a deleted board; heal:true restores it with cards', async () => {
    const { listBoardsWithCards, deleteBoard } = await import('../src/host/kanbanService.js');
    const { deleteJob, getJob } = await import('../src/host/schedulingService.js');

    // Baseline from the suite's earlier seeding: every agent has a board.
    const before = await listBoardsWithCards('default');
    expect(before.length).toBeGreaterThan(0);
    const victim = before[0];
    expect(victim.rosterId).toBeTruthy();
    expect(await deleteBoard(victim.id)).toBe(true);
    // Also lose one schedule job for the same roster member, when present.
    const lostJobIds: string[] = [];
    for (const suffix of ['daily', 'hourly', 'weekly', 'standup', 'digest', 'triage', 'report', 'sync']) {
      const id = `${victim.rosterId}:${suffix}`;
      if (await getJob(id)) { await deleteJob(id); lostJobIds.push(id); }
    }

    // Silent auto-seed shape (no heal): the board MUST stay gone — the auto
    // path must never resurrect a deliberate deletion.
    const plain = await api<{ seeded: boolean; healed?: unknown }>('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
    expect(plain.status).toBe(200);
    expect(plain.body.healed).toBeUndefined();
    expect((await listBoardsWithCards('default')).some((b) => b.rosterId === victim.rosterId)).toBe(false);

    // Explicit heal: the board comes back, WITH its sample cards.
    const heal = await api<{ seeded: boolean; healed: { boards: number; schedules: number; orgChart: boolean } }>(
      '/v1/host/sample/demo/seed',
      { method: 'POST', body: JSON.stringify({ heal: true }) },
    );
    expect(heal.status).toBe(200);
    expect(heal.body.healed.boards).toBe(1);
    expect(heal.body.healed.schedules).toBe(lostJobIds.length);
    const after = (await listBoardsWithCards('default')).find((b) => b.rosterId === victim.rosterId);
    expect(after).toBeDefined();
    expect(after!.cards.length).toBeGreaterThan(0);
    for (const id of lostJobIds) expect(await getJob(id)).not.toBeNull();

    // Heal is idempotent: a second heal finds nothing missing.
    const again = await api<{ healed: { boards: number; schedules: number } }>(
      '/v1/host/sample/demo/seed',
      { method: 'POST', body: JSON.stringify({ heal: true }) },
    );
    expect(again.body.healed).toEqual({ boards: 0, schedules: 0, orgChart: false });
  });
});
