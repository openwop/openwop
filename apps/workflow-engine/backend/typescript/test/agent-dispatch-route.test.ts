/**
 * RFC 0070 end-to-end: the reference workflow-engine host loads a manifest
 * agent and dispatches it over HTTP. Boots the real app via createApp, seeds
 * the AgentRegistry from the on-disk supervisor pack (the same loadAgents path
 * bootstrap uses), then exercises the live routes:
 *   - GET  /v1/host/sample/agents               (registry-backed inventory)
 *   - POST /v1/host/sample/agents/{id}/dispatch (the dispatch floor)
 * and confirms the host advertises capabilities.agents.manifestRuntime.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { loadAgentsFromManifest } from '../src/packs/agentLoader.js';

const PORT = 18242;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');
const SUPERVISOR = 'core.openwop.agents.supervisor.default';

let server: http.Server;

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  // Guarantee a known agent is installed regardless of local-mount config in CI.
  loadAgentsFromManifest(join(REPO_ROOT, 'packs', 'core.openwop.agents.supervisor'));
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
});

afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

describe('RFC 0070 — host loads + dispatches a manifest agent over HTTP', () => {
  it('advertises capabilities.agents.manifestRuntime', async () => {
    const doc = await (await fetch(`${BASE}/.well-known/openwop`, { headers: H })).json() as {
      capabilities?: { agents?: { manifestRuntime?: { supported?: boolean } } };
    };
    expect(doc?.capabilities?.agents?.manifestRuntime?.supported).toBe(true);
  });

  it('serves the NORMATIVE inventory GET /v1/agents (RFC 0072 §A)', async () => {
    const list = await (await fetch(`${BASE}/v1/agents`, { headers: H })).json() as {
      agents?: Array<{ agentId?: string }>; total?: number;
    };
    expect(Array.isArray(list.agents)).toBe(true);
    expect(list.total).toBe(list.agents?.length);
    expect((list.agents ?? []).some((a) => a.agentId === SUPERVISOR)).toBe(true);
    // GET /v1/agents/{agentId}
    const one = await fetch(`${BASE}/v1/agents/${encodeURIComponent(SUPERVISOR)}`, { headers: H });
    expect(one.status).toBe(200);
    expect(((await one.json()) as { agentId?: string }).agentId).toBe(SUPERVISOR);
    // 404 for unknown
    expect((await fetch(`${BASE}/v1/agents/core.nope.absent`, { headers: H })).status).toBe(404);
  });

  it('serves the registry-backed inventory including the installed agent', async () => {
    const body = await (await fetch(`${BASE}/v1/host/sample/agents`, { headers: H })).json() as {
      runtime?: { manifestRuntime?: boolean }; agents?: Array<{ agentId?: string }>;
    };
    expect(body.runtime?.manifestRuntime).toBe(true);
    expect((body.agents ?? []).some((a) => a.agentId === SUPERVISOR)).toBe(true);
  });

  it('dispatches the agent end-to-end with attributed events', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/agents/${encodeURIComponent(SUPERVISOR)}/dispatch`, {
      method: 'POST', headers: H, body: JSON.stringify({ task: {}, validateHandoff: false }),
    });
    expect(res.status).toBe(200);
    const r = await res.json() as { status?: string; events?: Array<{ type?: string; agentId?: string }> };
    expect(r.status).toBe('completed');
    expect((r.events ?? []).map((e) => e.type)).toEqual(['agent.reasoned', 'agent.decided']);
    expect((r.events ?? []).every((e) => e.agentId === SUPERVISOR)).toBe(true);
  });

  it('escalates a sub-threshold dispatch (RFC 0002 §F)', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/agents/${encodeURIComponent(SUPERVISOR)}/dispatch`, {
      method: 'POST', headers: H, body: JSON.stringify({ task: {}, validateHandoff: false, simulateConfidence: 0.01, confidenceThreshold: 0.99 }),
    });
    const r = await res.json() as { status?: string; result?: unknown };
    expect(r.status).toBe('escalated');
    expect(r.result).toBeUndefined();
  });

  it('404s an unknown agent', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/agents/core.nope.absent/dispatch`, {
      method: 'POST', headers: H, body: JSON.stringify({ task: {} }),
    });
    expect(res.status).toBe(404);
  });
});
