/**
 * End-to-end smoke for the agent-autonomy stack — boots the REAL app
 * (createApp + sqlite memory + real route registration + schema migrations) and
 * drives the actual daemon functions against the app's own storage/hostSuite.
 *
 * This is the wiring proof the unit tests can't give: routes registered,
 * migrations applied (incl. agent_run_activity + run_budget), the attribution
 * index populated by real run creation, the autonomous daemons firing real runs
 * through the real workflow catalog, and the fleet activity feed reading them
 * back via the index.
 *
 *   1. seed demo agents → roster + boards + cards + schedules exist
 *   2. autonomous heartbeat → an agent picks a To Do card and starts a real run
 *   3. fleet activity (index-backed) shows the heartbeat run attributed
 *   4. scheduler daemon → a due schedule fires a real run
 *   5. connector deliverability probe reflects a live relay device
 *   6. /notify returns an honest synthetic receipt (no webhook configured)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { HostAdapterSuite } from '../src/host/index.js';
import { processDueHeartbeats } from '../src/host/heartbeatService.js';
import { processDueSchedules } from '../src/host/scheduleDaemon.js';
import { updateRosterEntry, listRosterTenants, listRoster } from '../src/host/rosterService.js';
import { registerJob } from '../src/host/schedulingService.js';
import { createAiProvidersAdapter } from '../src/aiProviders/aiProvidersHost.js';
import { programMock } from '../src/providers/dispatchMock.js';
import { getAgentRegistry } from '../src/executor/agentRegistry.js';
import { runAgentDispatchLive } from '../src/host/agentDispatch.js';

const OP: Record<string, string> = { authorization: 'Bearer sample-token', 'content-type': 'application/json' };
let server: http.Server;
let base = '';
let app: Awaited<ReturnType<typeof createApp>>;
let port = 19450;

beforeEach(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_RATELIMIT_DISABLED = 'true';
  const p = port++;
  app = await createApp({ port: p, storageDsn: 'memory://', serviceName: 'smoke', serviceVersion: '0', enableConsoleTracer: false });
  await new Promise<void>((r) => { server = app.listen(p, r); });
  base = `http://127.0.0.1:${p}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

type Json = Record<string, any>;
async function post(path: string, body?: unknown, headers: Record<string, string> = OP): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
async function get(path: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${path}`, { headers: OP });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

function deps(): { storage: Storage; hostSuite: HostAdapterSuite } {
  return { storage: app.locals.storage as Storage, hostSuite: app.locals.hostSuite as HostAdapterSuite };
}

describe('agent autonomy — end-to-end smoke', () => {
  it('seeds, auto-heartbeats a real run, and shows it in the index-backed fleet feed', async () => {
    // 1. Seed demo agents (roster + boards + To Do cards + schedules).
    expect((await post('/v1/host/sample/demo/seed', {})).status).toBe(200);
    const roster = await listRoster('default');
    expect(roster.length).toBeGreaterThan(0);

    // 2. Opt the first agent into an autonomous heartbeat cadence, then run the
    //    real heartbeat daemon pass against the app's storage.
    const agent = roster[0]!;
    await updateRosterEntry(agent.rosterId, { heartbeatIntervalMs: 60_000 });
    const now = Date.now();
    const ran = await processDueHeartbeats(deps(), listRosterTenants, now);
    expect(ran).toBeGreaterThanOrEqual(1); // picked a To Do card → started a real run

    // 3. The fleet activity feed (index-backed, not a scan) shows it, attributed.
    const fleet = (await get('/v1/host/sample/fleet/activity')).body;
    expect(fleet.truncated).toBe(false);
    expect(fleet.items.length).toBeGreaterThanOrEqual(1);
    const hb = fleet.items.find((i: { source: string }) => i.source === 'heartbeat');
    expect(hb).toBeTruthy();
    expect(hb.rosterId).toBeTruthy();
    expect(hb.runId).toBeTruthy();
  });

  it('fires a due schedule through the real daemon', async () => {
    await post('/v1/host/sample/demo/seed', {});
    const agentEntry = (await listRoster('default'))[0]!;
    const workflowId = agentEntry.workflows[0]!;
    expect(workflowId).toBeTruthy();

    // Register a schedule, then drive the daemon with a clock 2h ahead so the
    // job's nextFireAt is due.
    const t0 = Date.parse('2026-06-02T10:00:00Z');
    await registerJob({ jobId: 'smoke-job', tenantId: 'default', cronExpr: '0 * * * *', workflowId, rosterId: agentEntry.rosterId, agentId: agentEntry.agentRef.agentId, timezone: 'UTC' }, t0);
    const fired = await processDueSchedules(deps(), t0 + 2 * 3_600_000);
    expect(fired).toBeGreaterThanOrEqual(1);

    // The schedule run is attributed in the fleet feed.
    const fleet = (await get('/v1/host/sample/fleet/activity?rosterId=' + encodeURIComponent(agentEntry.rosterId))).body;
    expect(fleet.items.some((i: { source: string }) => i.source === 'schedule')).toBe(true);
  });

  it('connector deliverability probe reflects a live relay device', async () => {
    const made = (await post('/v1/host/sample/messaging/connectors', { channel: 'signal', displayName: 'Signal' })).body;
    await post(`/v1/host/sample/messaging/connectors/${made.connectorId}/enable`, {});
    // No device yet → not deliverable.
    expect((await post(`/v1/host/sample/messaging/connectors/${made.connectorId}/test`, {})).body.ok).toBe(false);

    // Register + activate + heartbeat a signal relay device → deliverable.
    const reg = (await post('/v1/host/sample/messaging/relay/register', { channel: 'signal' })).body;
    const act = (await post('/v1/host/sample/messaging/relay/activate', { relayId: reg.relayId, activationCode: reg.activationCode })).body;
    await post('/v1/host/sample/messaging/device/heartbeat', { status: 'connected' }, { 'x-openwop-device-token': act.deviceToken, 'content-type': 'application/json' });
    const probe = (await post(`/v1/host/sample/messaging/connectors/${made.connectorId}/test`, {})).body;
    expect(probe.ok).toBe(true);
    expect(probe.liveRelayDevices).toBeGreaterThanOrEqual(1);
  });

  it('runs a real live-dispatch model turn end-to-end (keyless mock provider)', async () => {
    // Register an agent with a return schema, program the keyless mock provider,
    // and dispatch a LIVE turn through the app's real AI adapter — the actual
    // callAI → dispatchStructured → dispatchMock pipeline, no credentials.
    const nodeId = 'agent.dispatch.smoke';
    getAgentRegistry().register({
      agentId: 'smoke.agent', persona: 'Smokey', modelClass: 'chat', systemPrompt: 'Answer.',
      packName: 'test', packVersion: '0', toolAllowlist: [],
      handoff: {
        returnSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
        validateReturn: (v: unknown) =>
          v && typeof v === 'object' && typeof (v as { answer?: unknown }).answer === 'string'
            ? { ok: true }
            : { ok: false, errors: 'missing answer' },
      },
    });
    programMock(nodeId, [{ content: '{"answer":"live"}', stopReason: 'end_turn', inputTokens: 4, outputTokens: 2 }]);
    const hostSuite = app.locals.hostSuite as HostAdapterSuite;
    const adapter = createAiProvidersAdapter({
      runId: 'smoke-run', nodeId, tenantId: 'default', attempt: 1,
      secrets: {}, policyResolver: hostSuite.providerPolicyResolver,
    });
    const result = await runAgentDispatchLive(
      { agentId: 'smoke.agent', task: { q: 'hi' } },
      { callAI: adapter.callAI, modelOptions: { provider: 'mock', model: nodeId } },
    );
    expect(result.status).toBe('completed');
    expect(result.provider).toBe('mock');
    expect(result.result).toEqual({ answer: 'live' });
  });

  it('/notify returns an honest synthetic receipt with no webhook configured', async () => {
    const r = (await post('/v1/host/sample/messaging/notify', { kind: 'email', to: 'a@b.com', text: 'hi' })).body;
    expect(r.status).toBe('accepted'); // not 'delivered'
    expect(r.detail).toContain('no provider configured');
  });
});
