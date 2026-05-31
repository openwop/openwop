/**
 * Agents-demo experience — backend foundations (PRD Phase 0).
 *
 * Covers the new host-extension surfaces that back the "AI coworkers" UX:
 *   - POST /v1/host/sample/demo/seed seeds 5 agents idempotently (no-op on
 *     re-run; never clobbers an existing roster)
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
}

describe('agents-demo backend foundations', () => {
  it('seeds 5 demo agents and is idempotent', async () => {
    const first = await api<{ seeded: boolean; agents: number }>('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);
    expect(first.body.seeded).toBe(true);
    expect(first.body.agents).toBe(5);

    const roster = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    expect(roster.body.roster.length).toBe(5);
    expect(roster.body.roster.map((r) => r.persona)).toContain('Sally');

    // Re-seed is a no-op (does not clobber the existing roster).
    const second = await api<{ seeded: boolean }>('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
    expect(second.body.seeded).toBe(false);
    const rosterAgain = await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster');
    expect(rosterAgain.body.roster.length).toBe(5);
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

    const checked = await api<{ picked: boolean; cardId: string; runId: string }>(
      `/v1/host/sample/roster/${sally.rosterId}/check`,
      { method: 'POST', body: '{}' },
    );
    expect(checked.status).toBe(200);
    expect(checked.body.picked).toBe(true);
    expect(typeof checked.body.runId).toBe('string');

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
});
