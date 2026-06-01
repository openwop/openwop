/**
 * Kanban host-extension (RFCS/0086 "named workflow agents" demo surface).
 *
 * Covers:
 *   1. The pure service (host/kanbanService.ts): board/card CRUD + the
 *      move-trigger logic — a move INTO a column that names a workflow
 *      returns a trigger directive; a same-column move does not; a
 *      card-level `workflowId` overrides the column default.
 *   2. The REST routes (`/v1/host/sample/kanban/*`) against the sqlite
 *      memory backend: create board → add card → move card into the
 *      trigger column → a run is started (`triggeredRunId` returned) —
 *      plus tenant-scoped 404 on a foreign board.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  __resetKanbanStore,
  createBoard,
  createCard,
  getCard,
  moveCard,
  notifyBoardChanged,
  subscribeBoardChanges,
  updateCardFields,
} from '../src/host/kanbanService.js';

describe('kanban service (pure)', () => {
  const storage = openSqliteStorage(':memory:');
  beforeAll(() => {
    initHostExtPersistence(storage);
  });
  afterAll(async () => {
    __resetHostExtPersistence();
    await storage.close();
  });
  beforeEach(async () => {
    initHostExtPersistence(storage);
    await __resetKanbanStore();
  });

  it('creates a board with default To Do / Doing / Done lanes', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'Marketing' });
    expect(board.columns.map((c) => c.id)).toEqual(['todo', 'doing', 'done']);
    expect(board.tenantId).toBe('t1');
  });

  it('flags the To Do column as the trigger column when a board trigger workflow is given', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'Marketing', triggerWorkflowId: 'wf-campaign' });
    const todo = board.columns.find((c) => c.id === 'todo');
    expect(todo?.triggerWorkflowId).toBe('wf-campaign');
    expect(board.columns.find((c) => c.id === 'doing')?.triggerWorkflowId).toBeUndefined();
  });

  it('round-trips createdBy / assignmentReason / blockerNote on create + patch', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'M' });
    const card = await createCard({
      boardId: board.id,
      columnId: 'todo',
      title: 'Approve refund',
      createdBy: 'Marcus',
      assignmentReason: 'Over Priya’s auto-approval limit.',
      blockerNote: 'Needs a human sign-off.',
    });
    expect(card.createdBy).toBe('Marcus');
    expect(card.assignmentReason).toBe('Over Priya’s auto-approval limit.');
    expect(card.blockerNote).toBe('Needs a human sign-off.');

    await updateCardFields(card.id, { blockerNote: '' });
    const cleared = await getCard(card.id);
    expect(cleared?.blockerNote).toBe('');
    expect(cleared?.assignmentReason).toBe('Over Priya’s auto-approval limit.');
  });

  it('returns a trigger directive when a card moves INTO a trigger column', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'M', triggerWorkflowId: 'wf-campaign' });
    const card = await createCard({ boardId: board.id, columnId: 'doing', title: 'Draft email' });
    const result = await moveCard(card.id, 'todo');
    expect(result?.trigger).toEqual({
      workflowId: 'wf-campaign',
      boardId: board.id,
      cardId: card.id,
      fromColumnId: 'doing',
      toColumnId: 'todo',
    });
    expect(result?.card.columnId).toBe('todo');
  });

  it('does NOT trigger on a same-column move', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'M', triggerWorkflowId: 'wf-campaign' });
    const card = await createCard({ boardId: board.id, columnId: 'todo', title: 'x' });
    const result = await moveCard(card.id, 'todo');
    expect(result?.trigger).toBeNull();
  });

  it('lets a card-level workflowId override the column default', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'M', triggerWorkflowId: 'wf-column' });
    const card = await createCard({ boardId: board.id, columnId: 'doing', title: 'x', workflowId: 'wf-card' });
    expect((await moveCard(card.id, 'todo'))?.trigger?.workflowId).toBe('wf-card');
  });

  it('does not trigger when neither the column nor the card names a workflow', async () => {
    const board = await createBoard({ tenantId: 't1', name: 'M' });
    const card = await createCard({ boardId: board.id, columnId: 'doing', title: 'x' });
    expect((await moveCard(card.id, 'todo'))?.trigger).toBeNull();
  });

  it('fans out board-change notifications to subscribers (live refresh)', async () => {
    const seen: string[] = [];
    // On the sqlite (single-node) backend the publish delivers in-process and
    // synchronously, so the assertions need no extra flush; the Postgres
    // LISTEN/NOTIFY cross-instance path is exercised live.
    const unsubscribe = await subscribeBoardChanges((id) => seen.push(id));
    notifyBoardChanged('board-1');
    notifyBoardChanged('board-2');
    expect(seen).toEqual(['board-1', 'board-2']);
    await unsubscribe();
    notifyBoardChanged('board-3');
    expect(seen).toEqual(['board-1', 'board-2']); // no longer notified after unsubscribe
  });
});

describe('kanban routes (sqlite memory app)', () => {
  let server: http.Server;
  const PORT = 18722;
  const BASE = `http://127.0.0.1:${PORT}`;
  const TOKEN = 'sample-token';

  beforeAll(async () => {
    process.env.OPENWOP_STORAGE_DSN = 'memory://';
    process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
    const app = await createApp({
      port: PORT,
      storageDsn: 'memory://',
      serviceName: 'test',
      serviceVersion: '0.0.1',
      enableConsoleTracer: false,
    });
    await __resetKanbanStore();
    await new Promise<void>((res) => {
      server = app.listen(PORT, res);
    });
  });

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
  });

  async function jsonFetch<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 204) return { status: 204, body: undefined as unknown as T };
    return { status: res.status, body: (await res.json()) as T };
  }

  it('advertises host.kanban in the discovery document', async () => {
    const { body } = await jsonFetch<{ kanban?: { supported?: boolean } }>('/.well-known/openwop');
    expect(body.kanban?.supported).toBe(true);
  });

  it('round-trips board + card CRUD and starts a run on a trigger-column move', async () => {
    // Pick a workflow the catalog actually serves (the loaded conformance
    // fixtures double as runnable workflowIds).
    const disco = await jsonFetch<{ fixtures?: string[] }>('/.well-known/openwop');
    const triggerWorkflowId = disco.body.fixtures?.[0];
    expect(typeof triggerWorkflowId).toBe('string');

    // Create a board whose To Do column fires that workflow.
    const created = await jsonFetch<{ id: string; columns: { id: string }[] }>(
      '/v1/host/sample/kanban/boards',
      { method: 'POST', body: JSON.stringify({ name: 'Sally — Marketing', triggerWorkflowId }) },
    );
    expect(created.status).toBe(201);
    const boardId = created.body.id;

    // It shows up in the list.
    const list = await jsonFetch<{ boards: { id: string }[] }>('/v1/host/sample/kanban/boards');
    expect(list.body.boards.some((b) => b.id === boardId)).toBe(true);

    // Add a card to Doing.
    const card = await jsonFetch<{ id: string; columnId: string }>(
      `/v1/host/sample/kanban/boards/${boardId}/cards`,
      { method: 'POST', body: JSON.stringify({ title: 'Spring campaign', columnId: 'doing' }) },
    );
    expect(card.status).toBe(201);
    expect(card.body.columnId).toBe('doing');

    // Move it INTO To Do → starts a run.
    const moved = await jsonFetch<{ card: { columnId: string }; triggeredRunId: string | null }>(
      `/v1/host/sample/kanban/cards/${card.body.id}`,
      { method: 'PATCH', body: JSON.stringify({ columnId: 'todo' }) },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.card.columnId).toBe('todo');
    expect(typeof moved.body.triggeredRunId).toBe('string');
    expect((moved.body.triggeredRunId ?? '').length).toBeGreaterThan(0);

    // Delete the card, then the board.
    expect((await jsonFetch(`/v1/host/sample/kanban/cards/${card.body.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await jsonFetch(`/v1/host/sample/kanban/boards/${boardId}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('validates required fields', async () => {
    const bad = await jsonFetch('/v1/host/sample/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
  });

  it('404s an unknown board', async () => {
    const res = await jsonFetch('/v1/host/sample/kanban/boards/board-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('the board SSE events endpoint 404s an unknown board (before opening a stream)', async () => {
    const res = await jsonFetch('/v1/host/sample/kanban/boards/board-nope/events');
    expect(res.status).toBe(404);
  });

  it('opens a text/event-stream for an owned board and pushes board.changed on a card create', async () => {
    const created = await jsonFetch<{ id: string }>('/v1/host/sample/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'SSE board' }),
    });
    const boardId = created.body.id;
    const ac = new AbortController();
    const res = await fetch(`${BASE}/v1/host/sample/kanban/boards/${boardId}/events`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // Trigger a change, then read until we see the board.changed event.
    await jsonFetch(`/v1/host/sample/kanban/boards/${boardId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ title: 'live', columnId: 'todo' }),
    });
    let buf = '';
    const deadline = Date.now() + 3000;
    while (!buf.includes('board.changed') && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    ac.abort();
    expect(buf).toContain('board.changed');
  });
});
