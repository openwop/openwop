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
