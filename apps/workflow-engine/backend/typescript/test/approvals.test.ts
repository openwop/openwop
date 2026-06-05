/**
 * Approval inbox — the "agents propose, humans dispose" gate (host extension).
 *
 * Covers:
 *   - a review-mode member's heartbeat QUEUES a proposal instead of running it
 *   - the proposal appears in GET /v1/host/sample/approvals?status=pending
 *   - a re-check does NOT duplicate the proposal for the same card (it proposes
 *     the next eligible card)
 *   - CLAIM starts the proposed run + flips the approval to approved+runId
 *   - REJECT dismisses the proposal + parks the card in the terminal column
 *   - resolving an already-resolved approval is a 409 (idempotency guard)
 *   - an AUTO-mode member is unchanged (regression): the heartbeat runs directly
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18746;
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

interface RosterEntry { rosterId: string; persona: string; autonomyLevel?: 'auto' | 'guided' | 'review' }
interface Approval {
  approvalId: string; rosterId: string; persona: string; workflowId: string;
  cardId?: string; status: 'pending' | 'approved' | 'rejected'; runId?: string;
}
type CheckResult = { picked: boolean; proposed?: boolean; approvalId?: string; cardId?: string; runId?: string };

async function roster(): Promise<RosterEntry[]> {
  return (await api<{ roster: RosterEntry[] }>('/v1/host/sample/roster')).body.roster;
}
async function pending(): Promise<Approval[]> {
  return (await api<{ items: Approval[] }>('/v1/host/sample/approvals?status=pending')).body.items;
}

describe('approval inbox — agents propose, humans dispose', () => {
  beforeAll(async () => {
    await api('/v1/host/sample/demo/seed', { method: 'POST', body: '{}' });
  });

  it('guided-mode: a HIGH-priority pick proposes; a routine pick runs (architect memo 2026-06-05)', async () => {
    // Devon ships guided in the seed, and Devon's first To Do card is high
    // priority — the heartbeat must QUEUE A PROPOSAL, not start the run.
    const devon = (await roster()).find((r) => r.persona === 'Devon')!;
    expect(devon.autonomyLevel).toBe('guided');

    const first = await api<CheckResult>(`/v1/host/sample/roster/${devon.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);
    expect(first.body.picked).toBe(true);
    expect(first.body.proposed).toBe(true);
    expect(typeof first.body.approvalId).toBe('string');
    expect(first.body.runId).toBeUndefined();

    // The NEXT pick is the routine (non-high) card — guided runs it
    // immediately, exactly like auto. (The high card stays parked in To Do
    // behind its pending approval; the dedup guard skips it.)
    const second = await api<CheckResult>(`/v1/host/sample/roster/${devon.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(second.status).toBe(200);
    expect(second.body.picked).toBe(true);
    expect(second.body.proposed).toBeUndefined();
    expect(typeof second.body.runId).toBe('string');

    // PATCH round-trips guided too (the update path had a review-only
    // normalizer that silently dropped it).
    const marcus = (await roster()).find((r) => r.persona === 'Marcus')!;
    const patched = await api<RosterEntry>(`/v1/host/sample/roster/${marcus.rosterId}`, {
      method: 'PATCH', body: JSON.stringify({ autonomyLevel: 'guided' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.autonomyLevel).toBe('guided');
    const back = await api<RosterEntry>(`/v1/host/sample/roster/${marcus.rosterId}`, {
      method: 'PATCH', body: JSON.stringify({ autonomyLevel: 'auto' }),
    });
    expect(back.body.autonomyLevel).toBeUndefined();
  });

  it('auto-mode member (default) runs directly on heartbeat — regression', async () => {
    const marcus = (await roster()).find((r) => r.persona === 'Marcus')!;
    expect(marcus.autonomyLevel).toBeUndefined(); // default = auto
    const checked = await api<CheckResult>(`/v1/host/sample/roster/${marcus.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(checked.status).toBe(200);
    expect(checked.body.picked).toBe(true);
    expect(checked.body.proposed).toBeUndefined();
    expect(typeof checked.body.runId).toBe('string');
  });

  it('review-mode heartbeat queues a proposal instead of running', async () => {
    const sally = (await roster()).find((r) => r.persona === 'Sally')!;

    const patched = await api<RosterEntry>(`/v1/host/sample/roster/${sally.rosterId}`, {
      method: 'PATCH', body: JSON.stringify({ autonomyLevel: 'review' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.autonomyLevel).toBe('review');

    const checked = await api<CheckResult>(`/v1/host/sample/roster/${sally.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(checked.status).toBe(200);
    expect(checked.body.picked).toBe(true);
    expect(checked.body.proposed).toBe(true);
    expect(typeof checked.body.approvalId).toBe('string');
    expect(checked.body.runId).toBeUndefined(); // nothing ran

    const queue = await pending();
    const mine = queue.find((a) => a.approvalId === checked.body.approvalId)!;
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('pending');
    expect(mine.rosterId).toBe(sally.rosterId);
  });

  it('a re-check proposes the NEXT card, never a duplicate for the same card', async () => {
    const sally = (await roster()).find((r) => r.persona === 'Sally')!;
    const before = await pending();
    const checked = await api<CheckResult>(`/v1/host/sample/roster/${sally.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(checked.body.proposed).toBe(true);
    const after = await pending();
    // A new, distinct proposal — and no card has two pending approvals.
    const cardIds = after.map((a) => a.cardId);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    expect(after.length).toBe(before.length + 1);
  });

  it('CLAIM starts the proposed run and flips the approval to approved', async () => {
    const queue = await pending();
    const target = queue[0];
    const claimed = await api<{ status: string; runId: string }>(
      `/v1/host/sample/approvals/${encodeURIComponent(target.approvalId)}/claim`,
      { method: 'POST', body: JSON.stringify({ note: 'looks right' }) },
    );
    expect(claimed.status).toBe(200);
    expect(claimed.body.status).toBe('approved');
    expect(typeof claimed.body.runId).toBe('string');

    expect((await pending()).some((a) => a.approvalId === target.approvalId)).toBe(false);
    const approved = (await api<{ items: Approval[] }>('/v1/host/sample/approvals?status=approved')).body.items;
    const found = approved.find((a) => a.approvalId === target.approvalId)!;
    expect(found.runId).toBe(claimed.body.runId);

    // Re-claiming a resolved approval is a conflict (idempotency guard).
    const again = await api(`/v1/host/sample/approvals/${encodeURIComponent(target.approvalId)}/claim`, { method: 'POST', body: '{}' });
    expect(again.status).toBe(409);
  });

  it('REJECT dismisses the proposal and parks the card in the terminal column', async () => {
    const queue = await pending();
    const target = queue[0];
    const boardId = (await api<{ items: Array<Approval & { boardId?: string }> }>('/v1/host/sample/approvals?status=pending'))
      .body.items.find((a) => a.approvalId === target.approvalId)!.boardId!;

    const rejected = await api<{ status: string }>(
      `/v1/host/sample/approvals/${encodeURIComponent(target.approvalId)}/reject`,
      { method: 'POST', body: JSON.stringify({ note: 'not now' }) },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');
    expect((await pending()).some((a) => a.approvalId === target.approvalId)).toBe(false);

    // The card moved to the board's terminal (rightmost) column.
    const board = await api<{ board: { columns: Array<{ id: string }> }; cards: Array<{ id: string; columnId: string }> }>(
      `/v1/host/sample/kanban/boards/${boardId}`,
    );
    const cols = board.body.board.columns;
    const terminalId = cols[cols.length - 1].id;
    const card = board.body.cards.find((c) => c.id === target.cardId)!;
    expect(card.columnId).toBe(terminalId);
  });

  it('a claimed run is attributed to the agent in its activity as an approved proposal', async () => {
    const sally = (await roster()).find((r) => r.persona === 'Sally')!;
    const checked = await api<CheckResult>(`/v1/host/sample/roster/${sally.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(checked.body.proposed).toBe(true);
    const claimed = await api<{ runId: string }>(
      `/v1/host/sample/approvals/${encodeURIComponent(checked.body.approvalId!)}/claim`, { method: 'POST', body: '{}' },
    );
    const activity = await api<{ items: Array<{ runId: string; source: string }> }>(
      `/v1/host/sample/roster/${sally.rosterId}/activity`,
    );
    const item = activity.body.items.find((i) => i.runId === claimed.body.runId)!;
    expect(item).toBeTruthy();
    expect(item.source).toBe('approval'); // not 'heartbeat'
  });

  it('concurrent claims for one proposal start exactly one run (resolve-before-dispatch lock)', async () => {
    // Fresh pending proposal from a different agent.
    const marcus = (await roster()).find((r) => r.persona === 'Marcus')!;
    await api(`/v1/host/sample/roster/${marcus.rosterId}`, { method: 'PATCH', body: JSON.stringify({ autonomyLevel: 'review' }) });
    const checked = await api<CheckResult>(`/v1/host/sample/roster/${marcus.rosterId}/check`, { method: 'POST', body: '{}' });
    expect(checked.body.proposed).toBe(true);
    const id = encodeURIComponent(checked.body.approvalId!);

    // Two claims race; the lock must let exactly one win.
    const [a, b] = await Promise.all([
      api<{ runId?: string }>(`/v1/host/sample/approvals/${id}/claim`, { method: 'POST', body: '{}' }),
      api<{ runId?: string }>(`/v1/host/sample/approvals/${id}/claim`, { method: 'POST', body: '{}' }),
    ]);
    const oks = [a, b].filter((r) => r.status === 200);
    const conflicts = [a, b].filter((r) => r.status === 409);
    expect(oks.length).toBe(1);
    expect(conflicts.length).toBe(1);
    expect(typeof oks[0].body.runId).toBe('string');
  });
});
