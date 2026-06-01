/**
 * Standing agent roster (RFCS/0086 reference impl) + board attribution.
 *
 * Covers:
 *   1. The pure service (host/rosterService.ts): create/list/get/update/
 *      delete + tenant scoping + the host:<id> rosterId form.
 *   2. The REST routes (`/v1/host/sample/roster/*`) + the §C
 *      attribution path: a board bound to a roster member defaults its To
 *      Do column to the member's first portfolio workflow, and a card
 *      moved into it starts a run attributed to the member (persona +
 *      rosterId + agentId in the run's `kanban` metadata block).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { openSqliteStorage } from '../src/storage/sqlite/index.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  __resetRosterStore,
  createRosterEntry,
  getRosterEntry,
  listRoster,
  updateRosterEntry,
} from '../src/host/rosterService.js';
import { __resetKanbanStore } from '../src/host/kanbanService.js';

describe('roster service (pure)', () => {
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
    await __resetRosterStore();
  });

  it('creates a named instance with a host:<id> rosterId + portfolio', async () => {
    const e = await createRosterEntry({
      tenantId: 't1',
      persona: 'Sally',
      agentRef: { agentId: 'core.openwop.agents.brief-writer', channel: 'stable' },
      workflows: ['marketing-email-campaign'],
    });
    expect(e.rosterId.startsWith('host:')).toBe(true);
    expect(e.persona).toBe('Sally');
    expect(e.workflows).toEqual(['marketing-email-campaign']);
    expect(e.enabled).toBe(true);
  });

  it('scopes list by tenant', async () => {
    await createRosterEntry({ tenantId: 't1', persona: 'Sally', agentRef: { agentId: 'a.b.c.d' } });
    await createRosterEntry({ tenantId: 't2', persona: 'Sam', agentRef: { agentId: 'a.b.c.d' } });
    expect((await listRoster('t1')).map((e) => e.persona)).toEqual(['Sally']);
    expect((await listRoster('t2')).map((e) => e.persona)).toEqual(['Sam']);
  });

  it('updates the portfolio + enabled flag', async () => {
    const e = await createRosterEntry({ tenantId: 't1', persona: 'Sally', agentRef: { agentId: 'a.b.c.d' } });
    await updateRosterEntry(e.rosterId, { workflows: ['wf-1', 'wf-2'], enabled: false });
    const after = await getRosterEntry(e.rosterId);
    expect(after?.workflows).toEqual(['wf-1', 'wf-2']);
    expect(after?.enabled).toBe(false);
  });

  it('sets, leaves, and clears the avatarUrl', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const e = await createRosterEntry({ tenantId: 't1', persona: 'Sally', agentRef: { agentId: 'a.b.c.d' } });
    expect(e.avatarUrl).toBeUndefined();
    // set
    await updateRosterEntry(e.rosterId, { avatarUrl: dataUri });
    expect((await getRosterEntry(e.rosterId))?.avatarUrl).toBe(dataUri);
    // undefined patch leaves it untouched
    await updateRosterEntry(e.rosterId, { workflows: ['wf-9'] });
    expect((await getRosterEntry(e.rosterId))?.avatarUrl).toBe(dataUri);
    // null clears it
    await updateRosterEntry(e.rosterId, { avatarUrl: null });
    expect((await getRosterEntry(e.rosterId))?.avatarUrl).toBeUndefined();
  });
});

describe('roster routes + board attribution (sqlite memory app)', () => {
  let server: http.Server;
  const PORT = 18733;
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
    await __resetRosterStore();
    await __resetKanbanStore();
    await new Promise<void>((res) => {
      server = app.listen(PORT, res);
    });
  });

  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
  });

  async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
    });
    if (res.status === 204) return { status: 204, body: undefined as unknown as T };
    return { status: res.status, body: (await res.json()) as T };
  }

  it('advertises agents.roster.supported in discovery', async () => {
    const { body } = await jsonFetch<{ agents?: { roster?: { supported?: boolean } } }>('/.well-known/openwop');
    expect(body.agents?.roster?.supported).toBe(true);
  });

  it('binds a board to a roster member and attributes the triggered run', async () => {
    const triggerWorkflowId = (await jsonFetch<{ fixtures?: string[] }>('/.well-known/openwop')).body.fixtures?.[0];
    expect(typeof triggerWorkflowId).toBe('string');

    // Create "Sally" who owns that workflow.
    const sally = await jsonFetch<{ rosterId: string; persona: string }>('/v1/host/sample/roster', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Sally',
        agentRef: { agentId: 'core.openwop.agents.brief-writer' },
        workflows: [triggerWorkflowId],
      }),
    });
    expect(sally.status).toBe(201);
    expect(sally.body.rosterId.startsWith('host:')).toBe(true);

    // She shows up in the tenant roster.
    const roster = await jsonFetch<{ roster: { rosterId: string }[] }>('/v1/host/sample/roster');
    expect(roster.body.roster.some((e) => e.rosterId === sally.body.rosterId)).toBe(true);

    // A board bound to Sally defaults its To Do column to her first workflow.
    const board = await jsonFetch<{ id: string; rosterId?: string; columns: { id: string; triggerWorkflowId?: string }[] }>(
      '/v1/host/sample/kanban/boards',
      { method: 'POST', body: JSON.stringify({ name: "Sally's board", rosterId: sally.body.rosterId }) },
    );
    expect(board.status).toBe(201);
    expect(board.body.rosterId).toBe(sally.body.rosterId);
    expect(board.body.columns.find((c) => c.id === 'todo')?.triggerWorkflowId).toBe(triggerWorkflowId);

    // Card in Doing → move to To Do → run starts, attributed to Sally.
    const card = await jsonFetch<{ id: string }>(`/v1/host/sample/kanban/boards/${board.body.id}/cards`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Spring campaign', columnId: 'doing' }),
    });
    const moved = await jsonFetch<{
      triggeredRunId: string | null;
      attribution: { persona?: string; rosterId?: string; agentId?: string } | null;
    }>(`/v1/host/sample/kanban/cards/${card.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ columnId: 'todo' }),
    });
    expect(typeof moved.body.triggeredRunId).toBe('string');

    // The started run is attributed to Sally (RFC 0086 §C: persona +
    // rosterId + the manifest agentId, content-free).
    expect(moved.body.attribution?.persona).toBe('Sally');
    expect(moved.body.attribution?.rosterId).toBe(sally.body.rosterId);
    expect(moved.body.attribution?.agentId).toBe('core.openwop.agents.brief-writer');
  });

  it('rejects binding a board to an unknown roster member', async () => {
    const res = await jsonFetch('/v1/host/sample/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', rosterId: 'host:nope-00000000' }),
    });
    expect(res.status).toBe(400);
  });

  it('validates roster create + 404s a foreign entry', async () => {
    expect((await jsonFetch('/v1/host/sample/roster', { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
    expect((await jsonFetch('/v1/host/sample/roster/host:does-not-exist')).status).toBe(404);
  });

  it('validates avatarUrl and round-trips a valid data URI through PATCH→GET', async () => {
    const goodUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const created = await jsonFetch<{ rosterId: string }>('/v1/host/sample/roster', {
      method: 'POST',
      body: JSON.stringify({ persona: 'Pia', agentRef: { agentId: 'core.openwop.agents.brief-writer' } }),
    });
    expect(created.status).toBe(201);
    const id = created.body.rosterId;

    // A non-data: URL (would invite SSRF / off-row bytes) is refused.
    expect(
      (await jsonFetch(`/v1/host/sample/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl: 'https://evil.example/x.png' }) })).status,
    ).toBe(400);
    // A non-image data URI is refused.
    expect(
      (await jsonFetch(`/v1/host/sample/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl: 'data:text/html;base64,YQ==' }) })).status,
    ).toBe(400);
    // An oversized payload is refused (413-class validation, surfaced as 400).
    const huge = `data:image/png;base64,${'A'.repeat(700_001)}`;
    expect(
      (await jsonFetch(`/v1/host/sample/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl: huge }) })).status,
    ).toBe(400);

    // A valid small data URI is accepted and round-trips on the next GET.
    const ok = await jsonFetch(`/v1/host/sample/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl: goodUri }) });
    expect(ok.status).toBe(200);
    expect((await jsonFetch<{ avatarUrl?: string }>(`/v1/host/sample/roster/${id}`)).body.avatarUrl).toBe(goodUri);

    // null clears it.
    await jsonFetch(`/v1/host/sample/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl: null }) });
    expect((await jsonFetch<{ avatarUrl?: string }>(`/v1/host/sample/roster/${id}`)).body.avatarUrl).toBeUndefined();
  });

  it('does NOT fire the trigger when the bound roster member is disabled (RFC 0086 §A)', async () => {
    const triggerWorkflowId = (await jsonFetch<{ fixtures?: string[] }>('/.well-known/openwop')).body.fixtures?.[0];
    // A disabled member.
    const sam = await jsonFetch<{ rosterId: string }>('/v1/host/sample/roster', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Sam',
        agentRef: { agentId: 'core.openwop.agents.brief-writer' },
        workflows: [triggerWorkflowId],
        enabled: false,
      }),
    });
    const board = await jsonFetch<{ id: string }>('/v1/host/sample/kanban/boards', {
      method: 'POST',
      body: JSON.stringify({ name: "Sam's board", rosterId: sam.body.rosterId }),
    });
    const card = await jsonFetch<{ id: string }>(`/v1/host/sample/kanban/boards/${board.body.id}/cards`, {
      method: 'POST',
      body: JSON.stringify({ title: 'x', columnId: 'doing' }),
    });
    const moved = await jsonFetch<{ triggeredRunId: string | null }>(`/v1/host/sample/kanban/cards/${card.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ columnId: 'todo' }),
    });
    // Card still moved, but the disabled member's portfolio trigger is inert.
    expect(moved.body.triggeredRunId).toBeNull();
  });
});
