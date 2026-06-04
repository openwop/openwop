/**
 * Sample-extension user-authored agents route tests (phase E1 fixes,
 * 2026-05-28).
 *
 * Covers the validate / conflict / cross-tenant gates for
 *   POST   /v1/host/sample/agents
 *   DELETE /v1/host/sample/agents/{agentId}
 *
 * Also exercises:
 *   - Idempotency-Key replay (#5) — same key + same body → cached
 *     201 with `openwop-Idempotent-Replay: true` marker
 *   - Cross-tenant agent isolation (#1) — `GET /v1/agents` filters
 *     user-authored agents to the requesting tenant
 *   - vendor.openwop-sample.agent.routed event namespacing (#3) is
 *     covered by the chat-responder; not exercised here
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { openStorage } from '../src/storage/index.js';
import { loadUserAgentsIntoRegistry } from '../src/routes/userAgents.js';
import type { UserAgentRecord } from '../src/types.js';

let server: http.Server;
const PORT = 18601;
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
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

interface RawResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

async function jsonFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<RawResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) {
    return { status: 204, headers: res.headers, body: undefined as unknown as T };
  }
  return { status: res.status, headers: res.headers, body: (await res.json()) as T };
}

interface AgentEntry {
  agentId: string;
  persona: string;
  modelClass: string;
  packName: string;
}

describe('user-authored agents — POST /v1/host/sample/agents', () => {
  it('creates a valid agent and returns the projected record', async () => {
    const r = await jsonFetch<AgentEntry>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Test Reviewer',
        description: 'Reviews diffs for correctness.',
        modelClass: 'coding',
        systemPrompt: 'You are a senior reviewer.',
        toolAllowlist: ['openwop:core.files.read'],
        memoryShape: { scratchpad: true },
        confidenceThreshold: 0.65,
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.persona).toBe('Test Reviewer');
    expect(r.body.modelClass).toBe('coding');
    // packName carries the synthetic `user:<tenant>` prefix per phase E1.
    expect(r.body.packName).toMatch(/^user:/);
    // agentId shape: `user.<tenant>.<persona-slug>`.
    expect(r.body.agentId).toMatch(/^user\..+\.test-reviewer$/);
  });

  it('rejects missing persona (400)', async () => {
    const r = await jsonFetch<{ message: string }>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        modelClass: 'chat',
        systemPrompt: 'You are helpful.',
      }),
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/persona/);
  });

  it('rejects unknown modelClass (400)', async () => {
    const r = await jsonFetch<{ message: string }>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Bad',
        modelClass: 'made-up',
        systemPrompt: 'You are helpful.',
      }),
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/modelClass/);
  });

  it('rejects out-of-range confidenceThreshold (400)', async () => {
    const r = await jsonFetch<{ message: string }>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Confident',
        modelClass: 'chat',
        systemPrompt: 'You are helpful.',
        confidenceThreshold: 1.5,
      }),
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/confidenceThreshold/);
  });

  it('returns 409 on duplicate persona', async () => {
    // First create succeeds.
    await jsonFetch('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Dupe Test',
        modelClass: 'chat',
        systemPrompt: 'You are helpful.',
      }),
    });
    // Second create with the same persona → 409.
    const r2 = await jsonFetch<{ message: string }>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Dupe Test',
        modelClass: 'chat',
        systemPrompt: 'You are also helpful.',
      }),
    });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/already exists/);
  });

  it('Idempotency-Key replay returns cached body with marker header', async () => {
    const body = JSON.stringify({
      persona: 'Idem Test',
      modelClass: 'chat',
      systemPrompt: 'You are helpful.',
    });
    const r1 = await jsonFetch<AgentEntry>('/v1/host/sample/agents', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-test-key-1' },
      body,
    });
    expect(r1.status).toBe(201);
    const r2 = await jsonFetch<AgentEntry>('/v1/host/sample/agents', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-test-key-1' },
      body,
    });
    expect(r2.status).toBe(201);
    expect(r2.headers.get('openwop-Idempotent-Replay')).toBe('true');
    expect(r2.body.agentId).toBe(r1.body.agentId);
  });

  it('Idempotency-Key with mismatched body returns 409', async () => {
    await jsonFetch('/v1/host/sample/agents', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-mismatch-key' },
      body: JSON.stringify({
        persona: 'Mismatch Test A',
        modelClass: 'chat',
        systemPrompt: 'You are helpful.',
      }),
    });
    const r2 = await jsonFetch<{ message: string }>('/v1/host/sample/agents', {
      method: 'POST',
      headers: { 'idempotency-key': 'idem-mismatch-key' },
      body: JSON.stringify({
        persona: 'Mismatch Test B',
        modelClass: 'chat',
        systemPrompt: 'You are helpful.',
      }),
    });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/different request body/);
  });
});

describe('user-authored agents — DELETE /v1/host/sample/agents/{agentId}', () => {
  it('deletes a user-authored agent and returns 204', async () => {
    const created = await jsonFetch<AgentEntry>('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Delete Me',
        modelClass: 'chat',
        systemPrompt: 'Short-lived.',
      }),
    });
    expect(created.status).toBe(201);
    const del = await jsonFetch(`/v1/host/sample/agents/${encodeURIComponent(created.body.agentId)}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
  });

  it('returns 404 for a non-existent agentId', async () => {
    const del = await jsonFetch<{ message: string }>('/v1/host/sample/agents/user.default.does-not-exist', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('returns 404 for a pack-installed agentId', async () => {
    // Pack agents register in the AgentRegistry but have no row in
    // `user_agents` — the DELETE route gates on the storage row, so
    // it 404s rather than mistakenly removing a pack agent.
    const del = await jsonFetch<{ message: string }>(
      '/v1/host/sample/agents/core.openwop.agents.code-reviewer.default',
      { method: 'DELETE' },
    );
    expect(del.status).toBe(404);
  });
});

describe('user-authored agents — cross-tenant isolation in GET /v1/agents', () => {
  it('user-authored agents projected through GET /v1/agents', async () => {
    // Create an agent (lands under the bearer-shared default tenant).
    await jsonFetch('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Inventory Probe',
        modelClass: 'chat',
        systemPrompt: 'You appear in /v1/agents.',
      }),
    });
    // GET /v1/agents should include the user-authored row.
    const r = await jsonFetch<{ agents: Array<{ persona: string; packName: string }> }>(
      '/v1/agents',
    );
    expect(r.status).toBe(200);
    const userAgent = r.body.agents.find((a) => a.persona === 'Inventory Probe');
    expect(userAgent).toBeDefined();
    expect(userAgent!.packName).toMatch(/^user:/);
  });

  it('does not expose user-authored agents across explicit tenant filters', async () => {
    await jsonFetch('/v1/host/sample/agents', {
      method: 'POST',
      body: JSON.stringify({
        persona: 'Tenant Scoped Probe',
        modelClass: 'chat',
        systemPrompt: 'You only appear in your tenant.',
      }),
    });

    const other = await jsonFetch<{ agents: Array<{ persona: string }> }>('/v1/agents?tenantId=someone-else');
    expect(other.status).toBe(200);
    expect(other.body.agents.some((a) => a.persona === 'Tenant Scoped Probe')).toBe(false);

    const wildcard = await jsonFetch<{ agents: Array<{ persona: string }> }>('/v1/agents?tenantId=*');
    expect(wildcard.status).toBe(200);
    expect(wildcard.body.agents.some((a) => a.persona === 'Tenant Scoped Probe')).toBe(true);
  });
});

describe('legacy `_anon` tenant migration — loadUserAgentsIntoRegistry', () => {
  it('rewrites a stored `_anon` record to the `default` tenant at boot (idempotent)', async () => {
    // Records created by bearer callers BEFORE the bearer-shared posture
    // rename were bucketed under `_anon`; without the boot migration they
    // orphan (invisible to the `default`-scoped list, undeletable). Uses an
    // isolated storage instance — this is the boot path, not the HTTP surface.
    const storage = await openStorage('memory://');
    try {
      const legacy: UserAgentRecord = {
        agentId: 'user._anon.legacy-probe',
        tenantId: '_anon',
        persona: 'Legacy Probe',
        modelClass: 'chat',
        systemPrompt: 'You predate the bearer-shared posture.',
        toolAllowlist: [],
        memoryShape: { scratchpad: true, conversation: true, longTerm: false },
        createdAt: new Date().toISOString(),
      };
      await storage.insertUserAgent(legacy);

      await loadUserAgentsIntoRegistry(storage);

      // Durable rewrite: tenant moves, the immutable agentId keeps its
      // legacy `user._anon.` prefix.
      const migrated = await storage.getUserAgent('user._anon.legacy-probe');
      expect(migrated?.tenantId).toBe('default');
      expect((await storage.listUserAgents('default')).some((r) => r.agentId === 'user._anon.legacy-probe')).toBe(true);
      expect((await storage.listUserAgents('_anon')).length).toBe(0);

      // Second boot: nothing left to migrate, registration still succeeds.
      await loadUserAgentsIntoRegistry(storage);
      expect((await storage.getUserAgent('user._anon.legacy-probe'))?.tenantId).toBe('default');
    } finally {
      await storage.close();
    }
  });
});
