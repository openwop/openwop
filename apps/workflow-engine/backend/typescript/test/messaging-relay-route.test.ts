/**
 * Demo messaging relay-gateway (sample-extension, non-normative).
 * Boots the real app and exercises the device lifecycle + outbound queue +
 * connector CRUD over HTTP, plus device-token auth and tenant scoping.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

const OP = { authorization: 'Bearer sample-token', 'content-type': 'application/json' };

let server: http.Server;
let BASE = '';
// Unique port per test: the self-HTTP bridge captures config.port, so it must
// match the listening port; a distinct port per test also avoids close/
// re-listen races and stale detached pollers hitting a reused port.
let portCounter = 18290;

// Fresh in-memory SQLite per test → durable-but-isolated relay state (replaces
// the old module-Map reset; the gateway is now Storage-backed).
beforeEach(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  // The bridge self-polls /v1/runs and the test polls /device/outbound; both
  // share the per-IP (127.0.0.1) sliding window. Disable for the suite.
  process.env.OPENWOP_RATELIMIT_DISABLED = 'true';
  const port = portCounter++;
  const app = await createApp({
    port,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => { server = app.listen(port, res); });
  BASE = `http://127.0.0.1:${port}/v1/host/sample/messaging`;
});

afterEach(async () => { await new Promise<void>((res) => server.close(() => res())); });

async function post(path: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}
async function get(path: string, headers: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}
async function put(path: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}
async function del(path: string, headers: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function activeRelay(channel = 'signal') {
  const reg = await post('/relay/register', OP, { channel });
  const act = await post('/relay/activate', OP, {
    relayId: reg.body.relayId,
    activationCode: reg.body.activationCode,
  });
  return { relayId: reg.body.relayId as string, deviceToken: act.body.deviceToken as string };
}

describe('messaging relay-gateway — device lifecycle', () => {
  it('register → activate → heartbeat → inbound → enqueue/outbound → ack → revoke', async () => {
    const reg = await post('/relay/register', OP, { channel: 'signal', deviceName: 'my-mac' });
    expect(reg.status).toBe(201);
    expect(reg.body.relayId).toMatch(/^relay_/);
    expect(reg.body.activationCode).toBeTruthy();

    const act = await post('/relay/activate', OP, {
      relayId: reg.body.relayId,
      activationCode: reg.body.activationCode,
    });
    expect(act.status).toBe(200);
    expect(act.body.deviceToken).toMatch(/^dtok_/);
    expect(act.body.heartbeatIntervalSeconds).toBeGreaterThan(0);

    const dev = { 'x-openwop-device-token': act.body.deviceToken, 'content-type': 'application/json' };

    const hb = await post('/device/heartbeat', dev, { status: 'connected' });
    expect(hb.status).toBe(200);
    expect(hb.body.ok).toBe(true);

    const inbound = await post('/device/inbound', dev, {
      platformMessageId: 'm1',
      conversationId: 'c1',
      peerId: 'peer1',
      peerDisplay: 'Alice',
      text: 'hello',
      timestamp: new Date().toISOString(),
    });
    expect(inbound.status).toBe(202);
    expect(inbound.body.accepted).toBe(true);
    expect(inbound.body.sessionKey).toBe('signal:c1');

    // operator enqueues an outbound reply
    const enq = await post('/relay/enqueue', OP, {
      relayId: reg.body.relayId,
      conversationId: 'c1',
      text: 'hi back',
    });
    expect(enq.status).toBe(201);
    expect(enq.body.egressId).toMatch(/^egr_/);

    // device pulls it
    const out = await get('/device/outbound', dev);
    expect(out.status).toBe(200);
    expect(out.body.messages).toHaveLength(1);
    expect(out.body.messages[0].text).toBe('hi back');

    // device acks → queue drains
    const ack = await post('/device/ack', dev, { egressIds: [enq.body.egressId] });
    expect(ack.body.acked).toBe(1);
    const out2 = await get('/device/outbound', dev);
    expect(out2.body.messages).toHaveLength(0);

    // revoke → token no longer works
    const rev = await post('/relay/revoke', OP, { relayId: reg.body.relayId });
    expect(rev.body.revoked).toBe(true);
    const hb2 = await post('/device/heartbeat', dev, {});
    expect(hb2.status).toBe(401);
  });

  it('rejects device-loop endpoints without a valid device token', async () => {
    const noTok = await post('/device/heartbeat', OP, {});
    expect(noTok.status).toBe(401);
    const badTok = await post('/device/inbound', { 'x-openwop-device-token': 'dtok_bogus', 'content-type': 'application/json' }, {});
    expect(badTok.status).toBe(401);
  });

  it('rejects an unknown channel and invalid activation code', async () => {
    const bad = await post('/relay/register', OP, { channel: 'telegram' });
    expect(bad.status).toBe(400);
    const reg = await post('/relay/register', OP, { channel: 'whatsapp' });
    const act = await post('/relay/activate', OP, { relayId: reg.body.relayId, activationCode: 'wrong' });
    expect(act.status).toBe(400);
  });

  it('records a session and bumps messageCount across inbound messages', async () => {
    const { relayId, deviceToken } = await activeRelay('imessage');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };
    for (let i = 0; i < 3; i++) {
      await post('/device/inbound', dev, { platformMessageId: `m${i}`, conversationId: 'conv', peerId: 'p', text: `t${i}` });
    }
    const sessions = await get('/sessions', OP);
    const s = sessions.body.sessions.find((x: any) => x.sessionKey === 'imessage:conv');
    expect(s.messageCount).toBe(3);

    const detail = await get('/sessions/imessage:conv', OP);
    expect(detail.body.peerId).toBe('p');
    const del = await fetch(`${BASE}/sessions/imessage:conv`, { method: 'DELETE', headers: OP });
    expect(del.status).toBe(200);
    expect((await get('/sessions/imessage:conv', OP)).status).toBe(404);
    expect(relayId).toMatch(/^relay_/);
  });
});

describe('messaging relay-gateway — inbound→run bridge', () => {
  it('inbound message drives a run and the reply lands on the outbound queue', async () => {
    const { relayId, deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    const inbound = await post('/device/inbound', dev, {
      platformMessageId: 'pm1',
      conversationId: 'conv-bridge',
      peerId: 'p1',
      text: 'hello bridge',
    });
    expect(inbound.status).toBe(202);
    expect(inbound.body.runId).toBeTruthy(); // bridge created a run

    // Poll the device outbound queue until the bridge enqueues the reply.
    let reply: any;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const out = await get('/device/outbound', dev);
      if (out.body.messages.length > 0) { reply = out.body.messages[0]; break; }
    }
    expect(reply, 'bridge should enqueue an outbound reply').toBeTruthy();
    expect(reply.conversationId).toBe('conv-bridge');
    // sample.demo.uppercase uppercases the inbound text
    expect(reply.text).toBe('HELLO BRIDGE');
    expect(reply.replyToMessageId).toBe('pm1');
    expect(relayId).toMatch(/^relay_/);
  });
});

describe('messaging relay-gateway — connectors', () => {
  it('upsert → list → enable/disable → test → tenant-isolated', async () => {
    const created = await post('/connectors', OP, { channel: 'signal', displayName: 'Signal' });
    expect(created.status).toBe(201);
    const id = created.body.connectorId;
    expect(created.body.enabled).toBe(false);

    const en = await post(`/connectors/${id}/enable`, OP, {});
    expect(en.body.enabled).toBe(true);
    const probe = await post(`/connectors/${id}/test`, OP, {});
    expect(probe.body.ok).toBe(true);
    const dis = await post(`/connectors/${id}/disable`, OP, {});
    expect(dis.body.enabled).toBe(false);

    const list = await get('/connectors', OP);
    expect(list.body.connectors.length).toBe(1);

    // wildcard operator scoping by ?tenantId — connector lives under 'default'
    const other = await get('/connectors?tenantId=someone-else', OP);
    expect(other.body.connectors.length).toBe(0);
  });
});

describe('messaging relay-gateway — access policy', () => {
  it('returns host-default policy then accepts a PUT override', async () => {
    const created = await post('/connectors', OP, { channel: 'signal' });
    const id = created.body.connectorId;

    const def = await get(`/connectors/${id}/policy`, OP);
    expect(def.status).toBe(200);
    expect(def.body.dmPolicy).toBe('pairing');
    expect(def.body.groupPolicy).toBe('allowlist');
    expect(def.body.requireMention).toBe(true);

    const upd = await put(`/connectors/${id}/policy`, OP, { dmPolicy: 'open', requireMention: false });
    expect(upd.status).toBe(200);
    expect(upd.body.dmPolicy).toBe('open');
    expect(upd.body.groupPolicy).toBe('allowlist'); // untouched
    expect(upd.body.requireMention).toBe(false);

    // persisted
    const after = await get(`/connectors/${id}/policy`, OP);
    expect(after.body.dmPolicy).toBe('open');

    const bad = await put(`/connectors/${id}/policy`, OP, { dmPolicy: 'nonsense' });
    expect(bad.status).toBe(400);
  });
});

describe('messaging relay-gateway — routing rules', () => {
  it('add → list (priority order) → delete', async () => {
    const r1 = await post('/routing', OP, { pattern: '*', workflowId: 'wf.fallback', priority: 0 });
    expect(r1.status).toBe(201);
    expect(r1.body.ruleId).toMatch(/^route_/);
    const r2 = await post('/routing', OP, { channel: 'signal', pattern: 'support', workflowId: 'wf.support', priority: 10 });
    expect(r2.status).toBe(201);

    const list = await get('/routing', OP);
    expect(list.body.rules).toHaveLength(2);
    expect(list.body.rules[0].workflowId).toBe('wf.support'); // higher priority first

    const gone = await del(`/routing/${r1.body.ruleId}`, OP);
    expect(gone.body.deleted).toBe(true);
    expect((await get('/routing', OP)).body.rules).toHaveLength(1);

    const miss = await del('/routing/route_missing', OP);
    expect(miss.status).toBe(404);
  });

  it('rejects an unknown channel and a missing workflowId', async () => {
    expect((await post('/routing', OP, { channel: 'telegram', pattern: '*', workflowId: 'w' })).status).toBe(400);
    expect((await post('/routing', OP, { pattern: '*' })).status).toBe(400);
  });
});

describe('messaging relay-gateway — cross-channel identities', () => {
  it('create → link more peers → unlink one → list → delete', async () => {
    const created = await post('/identities', OP, {
      displayName: 'Alice',
      peers: [{ channel: 'signal', peerId: '+15551234' }],
    });
    expect(created.status).toBe(201);
    const id = created.body.identityId;
    expect(created.body.peers).toHaveLength(1);

    // link mode (identityId present) merges, de-duping
    const linked = await post('/identities', OP, {
      identityId: id,
      peers: [{ channel: 'whatsapp', peerId: 'wa-1' }, { channel: 'signal', peerId: '+15551234' }],
    });
    expect(linked.status).toBe(200);
    expect(linked.body.peers).toHaveLength(2);

    // unlink one peer via query params
    const unlinked = await del(`/identities/${id}?channel=whatsapp&peerId=wa-1`, OP);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.peers).toHaveLength(1);

    const list = await get('/identities', OP);
    expect(list.body.identities).toHaveLength(1);

    const gone = await del(`/identities/${id}`, OP);
    expect(gone.body.deleted).toBe(true);
    expect((await get(`/identities/${id}`, OP)).status).toBe(404);
  });
});

describe('messaging relay-gateway — delivery log', () => {
  it('records inbound + outbound entries and filters by direction', async () => {
    const { relayId, deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    await post('/device/inbound', dev, { platformMessageId: 'm1', conversationId: 'c1', peerId: 'p', text: 'hi' });
    await post('/relay/enqueue', OP, { relayId, conversationId: 'c1', text: 'reply' });

    const all = await get('/logs', OP);
    expect(all.body.entries.length).toBeGreaterThanOrEqual(2);

    const inbound = await get('/logs?direction=inbound', OP);
    expect(inbound.body.entries.every((e: any) => e.direction === 'inbound')).toBe(true);
    const outbound = await get('/logs?direction=outbound', OP);
    expect(outbound.body.entries.some((e: any) => e.status === 'queued')).toBe(true);
  });

  it('clamps ?limit — positive bounds, and rejects negative/non-numeric without dumping or erroring', async () => {
    const { relayId } = await activeRelay('signal');
    // Seed three outbound entries.
    for (let i = 0; i < 3; i++) {
      await post('/relay/enqueue', OP, { relayId, conversationId: 'climit', text: `m${i}` });
    }

    const one = await get('/logs?limit=1', OP);
    expect(one.status).toBe(200);
    expect(one.body.entries).toHaveLength(1);

    // SQLite treats a negative LIMIT as unbounded; the clamp must coerce -1 to
    // the default (100), NOT return the whole table and NOT error.
    const neg = await get('/logs?limit=-1', OP);
    expect(neg.status).toBe(200);
    expect(neg.body.entries.length).toBeLessThanOrEqual(100);

    // Non-numeric limit must not reach the driver as NaN (would 500).
    const nan = await get('/logs?limit=abc', OP);
    expect(nan.status).toBe(200);
    expect(Array.isArray(nan.body.entries)).toBe(true);
  });
});

describe('messaging relay-gateway — notify', () => {
  it('accepts an email/sms dispatch and rejects an unknown kind', async () => {
    const email = await post('/notify', OP, { kind: 'email', to: 'a@b.dev', subject: 'Hi', text: 'body' });
    expect(email.status).toBe(202);
    expect(email.body.notifyId).toMatch(/^ntf_/);
    expect(email.body.status).toBe('accepted');

    const sms = await post('/notify', OP, { kind: 'sms', to: '+15550000', text: 'pong' });
    expect(sms.status).toBe(202);

    expect((await post('/notify', OP, { kind: 'carrier-pigeon', to: 'x', text: 'y' })).status).toBe(400);
    expect((await post('/notify', OP, { kind: 'email', to: 'x' })).status).toBe(400); // missing text
  });
});

describe('messaging relay-gateway — envelope v2', () => {
  it('round-trips outbound media/components/reactions through the queue (extra column)', async () => {
    const { relayId, deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    const enq = await post('/relay/enqueue', OP, {
      relayId,
      conversationId: 'c-v2',
      text: 'pick one',
      replyToMessageId: 'm-parent',
      media: [{ url: 'https://x/y.png', mimeType: 'image/png', filename: 'y.png' }],
      components: [{ id: 'yes', label: 'Yes', style: 'reply' }, { id: 'docs', label: 'Docs', style: 'link', url: 'https://o' }],
      reactions: ['👍'],
    });
    expect(enq.status).toBe(201);
    expect(enq.body.components).toHaveLength(2);

    // Pull from the device queue — the v2 fields must survive persistence.
    const out = await get('/device/outbound', dev);
    expect(out.status).toBe(200);
    const m = out.body.messages.find((x: any) => x.conversationId === 'c-v2');
    expect(m).toBeTruthy();
    expect(m.text).toBe('pick one');
    expect(m.media[0]).toMatchObject({ url: 'https://x/y.png', filename: 'y.png' });
    expect(m.components.map((c: any) => c.id)).toEqual(['yes', 'docs']);
    expect(m.reactions).toEqual(['👍']);
  });

  it('accepts inbound v2 kinds (reaction/command) without rejecting them', async () => {
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    const reaction = await post('/device/inbound', dev, {
      platformMessageId: 'r1', conversationId: 'cv2', peerId: 'p', text: '',
      kind: 'reaction', reaction: { emoji: '❤️', targetMessageId: 'm9' },
    });
    expect(reaction.status).toBe(202);

    const command = await post('/device/inbound', dev, {
      platformMessageId: 'cmd1', conversationId: 'cv2', peerId: 'p', text: '/help',
      kind: 'command', command: { name: 'help', args: 'verbose' },
      channelMeta: { guildId: 'g1', threadId: 't1' },
    });
    expect(command.status).toBe(202);
  });
});

import { selectWorkflowByRules } from '../src/messaging/bridge.js';

describe('messaging bridge — selectWorkflowByRules (pure)', () => {
  const dev = { channel: 'signal' as const };
  const env = (conversationId: string, peerId: string) => ({ conversationId, peerId });
  const rule = (over: Partial<any> = {}) => ({
    ruleId: 'r', tenantId: 't', pattern: '*', workflowId: 'wf.default', priority: 0,
    createdAt: '2026-01-01T00:00:00Z', ...over,
  });

  it("no rules → undefined (bridge falls back to default)", () => {
    expect(selectWorkflowByRules([], dev, env('any', 'p'))).toBeUndefined();
  });
  it("'*' matches everything", () => {
    expect(selectWorkflowByRules([rule({ workflowId: 'wf.A' })], dev, env('c', 'p'))).toBe('wf.A');
  });
  it('substring matches conversationId OR peerId', () => {
    expect(selectWorkflowByRules([rule({ pattern: 'supp', workflowId: 'wf.S' })], dev, env('support-room', 'p'))).toBe('wf.S');
    expect(selectWorkflowByRules([rule({ pattern: 'ada', workflowId: 'wf.S' })], dev, env('c', 'ada-peer'))).toBe('wf.S');
    expect(selectWorkflowByRules([rule({ pattern: 'nope', workflowId: 'wf.S' })], dev, env('c', 'p'))).toBeUndefined();
  });
  it('channel filter rejects mismatches and accepts unset', () => {
    expect(selectWorkflowByRules([rule({ channel: 'whatsapp', workflowId: 'wf.W' })], dev, env('*', '*'))).toBeUndefined();
    expect(selectWorkflowByRules([rule({ channel: 'signal', workflowId: 'wf.S' })], dev, env('*', '*'))).toBe('wf.S');
    expect(selectWorkflowByRules([rule({ workflowId: 'wf.U' })], dev, env('*', '*'))).toBe('wf.U');
  });
  it('priority desc, then earliest createdAt', () => {
    const r1 = rule({ ruleId: 'r1', priority: 1, workflowId: 'wf.low', createdAt: '2026-01-01T00:00:00Z' });
    const r2 = rule({ ruleId: 'r2', priority: 10, workflowId: 'wf.hi',  createdAt: '2026-01-02T00:00:00Z' });
    const r3 = rule({ ruleId: 'r3', priority: 10, workflowId: 'wf.tie', createdAt: '2026-01-01T00:00:00Z' });
    expect(selectWorkflowByRules([r1, r2], dev, env('c', 'p'))).toBe('wf.hi');
    expect(selectWorkflowByRules([r2, r3], dev, env('c', 'p'))).toBe('wf.tie'); // tie → earliest createdAt
  });
});

import { createSelfHttpBridge } from '../src/messaging/bridge.js';

/** Build a fake Storage that exposes only the methods the bridge touches. */
function mockStorage(rules: any[], seedTurns: any[] = []) {
  const turns: any[] = [...seedTurns];
  return {
    listMessagingRoutingRules: async () => rules,
    // Phase B: turn history seam.
    listMessagingTurns: async (sessionKey: string, limit: number) =>
      turns.filter((t) => t.sessionKey === sessionKey).slice(-Math.max(1, limit)),
    appendMessagingTurn: async (t: any) => { turns.push(t); },
    _turns: turns as any[],
    // The detached completeAndReply path polls + enqueues; we never let it
    // complete because the spy fetchImpl returns a non-terminal status forever.
    getRelayDevice: async () => null,
    enqueueRelayOutbound: async () => {},
    appendDeliveryLog: async () => {},
  } as any;
}

describe('messaging bridge — routing wiring (unit)', () => {
  it('passes the rule-resolved workflowId on POST /v1/runs', async () => {
    let capturedBody: any;
    const fetchImpl: any = async (url: string, init?: any) => {
      if (String(url).endsWith('/v1/runs') && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ runId: 'r-1' }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      // Detached poll loop — keep it pending forever (test ends first).
      return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const bridge = createSelfHttpBridge({
      storage: mockStorage([
        { ruleId: 'r1', tenantId: 't', pattern: 'pick-me', workflowId: 'wf.routed', priority: 5, createdAt: '2026-01-01T00:00:00Z' },
      ]),
      baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
    });
    const res = await bridge.onInbound({
      device: { relayId: 'rl', tenantId: 't', channel: 'signal' },
      envelope: { channel: 'signal', platformMessageId: 'm1', conversationId: 'pick-me-room', peerId: 'p', text: 'hi', timestamp: '2026-05-27T00:00:00Z' } as any,
      sessionKey: 'signal:pick-me-room',
    });
    expect(res && (res as any).runId).toBe('r-1');
    expect(capturedBody.workflowId).toBe('wf.routed');
    expect(capturedBody.tenantId).toBe('t');
  });

  it('threads prior turns into messages[] (Phase B: chat-style continuity)', async () => {
    let bodies: any[] = [];
    const fetchImpl: any = async (url: string, init?: any) => {
      if (String(url).endsWith('/v1/runs') && init?.method === 'POST') {
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ runId: `r-${bodies.length}` }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    // Seed a prior assistant turn so the second inbound sees [user, assistant, user].
    const store = mockStorage([], [
      { turnId: 't0u', sessionKey: 'signal:c1', tenantId: 't', role: 'user', content: 'first', at: '2026-05-27T00:00:00Z' },
      { turnId: 't0a', sessionKey: 'signal:c1', tenantId: 't', role: 'assistant', content: 'first-reply', at: '2026-05-27T00:00:01Z' },
    ]);
    const bridge = createSelfHttpBridge({
      storage: store, baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
    });
    await bridge.onInbound({
      device: { relayId: 'rl', tenantId: 't', channel: 'signal' },
      envelope: { channel: 'signal', platformMessageId: 'm2', conversationId: 'c1', peerId: 'p', text: 'second', timestamp: '2026-05-27T00:00:02Z' } as any,
      sessionKey: 'signal:c1',
    });
    expect(bodies[0].inputs.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first-reply' },
      { role: 'user', content: 'second' },
    ]);
    // The new inbound user turn was persisted (prior-2 + new-1 = 3 user/assistant rows + the new user).
    const userTurns = (store._turns as any[]).filter((t) => t.role === 'user');
    expect(userTurns.map((t) => t.content)).toEqual(['first', 'second']);
  });

  it('falls back to the default workflow when no rule matches (backward-compat)', async () => {
    let capturedBody: any;
    const fetchImpl: any = async (url: string, init?: any) => {
      if (String(url).endsWith('/v1/runs') && init?.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ runId: 'r-2' }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const bridge = createSelfHttpBridge({
      storage: mockStorage([
        { ruleId: 'r1', tenantId: 't', pattern: 'support', channel: 'whatsapp', workflowId: 'wf.support', priority: 5, createdAt: '2026-01-01T00:00:00Z' },
      ]),
      baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
    });
    await bridge.onInbound({
      device: { relayId: 'rl', tenantId: 't', channel: 'signal' }, // wrong channel for the rule
      envelope: { channel: 'signal', platformMessageId: 'm1', conversationId: 'support-room', peerId: 'p', text: 'hi', timestamp: '2026-05-27T00:00:00Z' } as any,
      sessionKey: 'signal:support-room',
    });
    expect(capturedBody.workflowId).toBe('wf.default');
  });
});
