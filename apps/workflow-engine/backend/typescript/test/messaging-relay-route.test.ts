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
    // Enabling alone is NOT deliverable — outbound needs a live relay device.
    const probe = await post(`/connectors/${id}/test`, OP, {});
    expect(probe.body.ok).toBe(false);
    expect(probe.body.liveRelayDevices).toBe(0);
    expect(probe.body.detail).toContain('no active relay device');
    const dis = await post(`/connectors/${id}/disable`, OP, {});
    expect(dis.body.enabled).toBe(false);

    const list = await get('/connectors', OP);
    expect(list.body.connectors.length).toBe(1);

    // wildcard operator scoping by ?tenantId — connector lives under 'default'
    const other = await get('/connectors?tenantId=someone-else', OP);
    expect(other.body.connectors.length).toBe(0);
  });

  it('test probe is deliverable only with a live relay device for the channel', async () => {
    const created = await post('/connectors', OP, { channel: 'signal', displayName: 'Signal' });
    const id = created.body.connectorId;
    await post(`/connectors/${id}/enable`, OP, {});

    // No device yet → not deliverable.
    expect((await post(`/connectors/${id}/test`, OP, {})).body.ok).toBe(false);

    // A device on a DIFFERENT channel doesn't make signal deliverable.
    await activeRelay('whatsapp');
    expect((await post(`/connectors/${id}/test`, OP, {})).body.ok).toBe(false);

    // An active, heartbeating signal device → deliverable.
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };
    await post('/device/heartbeat', dev, { status: 'connected' });
    const probe = await post(`/connectors/${id}/test`, OP, {});
    expect(probe.body.ok).toBe(true);
    expect(probe.body.liveRelayDevices).toBeGreaterThanOrEqual(1);
    expect(probe.body.detail).toContain('reachable');
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

describe('messaging relay-gateway — policy enforcement (Phase C)', () => {
  async function setupConnectorWithPolicy(channel = 'signal', dmPolicy = 'pairing', requireMention = false) {
    const c = await post('/connectors', OP, { channel });
    expect(c.status).toBe(201);
    await post(`/connectors/${c.body.connectorId}/enable`, OP, {});
    const put = await fetch(`${BASE}/connectors/${c.body.connectorId}/policy`, {
      method: 'PUT', headers: OP,
      body: JSON.stringify({ dmPolicy, requireMention }),
    });
    expect(put.status).toBe(200);
    return c.body.connectorId as string;
  }

  it('dmPolicy=pairing: unknown peer is dropped with a pairing code; approve unblocks the next inbound', async () => {
    const connectorId = await setupConnectorWithPolicy('signal', 'pairing', false);
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    // 1) Unknown peer → no run, pairing payload returned, outbound code-reply queued.
    const first = await post('/device/inbound', dev, {
      platformMessageId: 'p1', conversationId: 'dm-1', peerId: 'peer-unknown', text: 'hello',
    });
    expect(first.status).toBe(202);
    expect(first.body.accepted).toBe(false);
    expect(first.body.pairing).toBeTruthy();
    expect(first.body.pairing.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(first.body.runId).toBeUndefined();

    // 2) Operator approves → allowlist row written, pairing removed.
    const approve = await post('/pairing/approve', OP, { connectorId, code: first.body.pairing.code });
    expect(approve.status).toBe(200);
    expect(approve.body.approved).toBe(true);

    // 3) Same peer → now allowed; the bridge runs the workflow.
    const second = await post('/device/inbound', dev, {
      platformMessageId: 'p2', conversationId: 'dm-1', peerId: 'peer-unknown', text: 'follow-up',
    });
    expect(second.status).toBe(202);
    expect(second.body.accepted).toBe(true);
    expect(second.body.runId).toBeTruthy();

    // The (channel, peerId) is now on the allowlist.
    const al = await get(`/allowlist?connectorId=${encodeURIComponent(connectorId)}`, OP);
    expect(al.body.entries.some((e: any) => e.peerId === 'peer-unknown')).toBe(true);
  });

  it('dmPolicy=disabled drops every DM; the bridge is not invoked', async () => {
    await setupConnectorWithPolicy('signal', 'disabled', false);
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };
    const res = await post('/device/inbound', dev, {
      platformMessageId: 'd1', conversationId: 'dm-z', peerId: 'p', text: 'x',
    });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(false);
    expect(res.body.dropped).toBe('disabled');
    expect(res.body.runId).toBeUndefined();
  });

  it('requireMention drops DMs that do not mention the bot id', async () => {
    const connectorId = await setupConnectorWithPolicy('signal', 'open', true);
    // Allow open + requireMention: only @-mentioned messages pass.
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };

    process.env.OPENWOP_MESSAGING_BOT_ID_SIGNAL = 'bot-1';
    try {
      const noMention = await post('/device/inbound', dev, {
        platformMessageId: 'n1', conversationId: 'dm-m', peerId: 'p', text: 'hey there',
      });
      expect(noMention.body.accepted).toBe(false);
      expect(noMention.body.dropped).toBe('no-mention');

      const mentioned = await post('/device/inbound', dev, {
        platformMessageId: 'n2', conversationId: 'dm-m', peerId: 'p', text: 'hey bot',
        mentions: ['bot-1'],
      });
      expect(mentioned.body.accepted).toBe(true);
      expect(mentioned.body.runId).toBeTruthy();
    } finally {
      delete process.env.OPENWOP_MESSAGING_BOT_ID_SIGNAL;
    }
    expect(connectorId).toMatch(/^conn_/);
  });

  it('PUT /policy with requireMention:true but no bot-id env returns a warning (operator tripwire)', async () => {
    const c = await post('/connectors', OP, { channel: 'signal' });
    expect(c.status).toBe(201);
    delete process.env.OPENWOP_MESSAGING_BOT_ID_SIGNAL;
    delete process.env.OPENWOP_MESSAGING_BOT_NAME;
    const put = await fetch(`${BASE}/connectors/${c.body.connectorId}/policy`, {
      method: 'PUT', headers: OP,
      body: JSON.stringify({ requireMention: true }),
    });
    const body = await put.json() as any;
    expect(body.requireMention).toBe(true);
    expect(body.warning).toMatch(/OPENWOP_MESSAGING_BOT_ID_SIGNAL|OPENWOP_MESSAGING_BOT_NAME/);
  });

  it('PUT /policy with requireMention:true AND bot-id env set returns NO warning', async () => {
    const c = await post('/connectors', OP, { channel: 'signal' });
    process.env.OPENWOP_MESSAGING_BOT_ID_SIGNAL = 'bot-x';
    try {
      const put = await fetch(`${BASE}/connectors/${c.body.connectorId}/policy`, {
        method: 'PUT', headers: OP,
        body: JSON.stringify({ requireMention: true }),
      });
      const body = await put.json() as any;
      expect(body.requireMention).toBe(true);
      expect(body.warning).toBeUndefined();
    } finally {
      delete process.env.OPENWOP_MESSAGING_BOT_ID_SIGNAL;
    }
  });

  it('no connector for (tenant, channel) → no enforcement (backward-compat)', async () => {
    // Note: no /connectors POST → enforcement is skipped, behavior unchanged.
    const { deviceToken } = await activeRelay('signal');
    const dev = { 'x-openwop-device-token': deviceToken, 'content-type': 'application/json' };
    const res = await post('/device/inbound', dev, {
      platformMessageId: 'b1', conversationId: 'dm-b', peerId: 'p', text: 'still allowed',
    });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });
});

describe('messaging relay-gateway — allowlist CRUD', () => {
  it('add → list → delete', async () => {
    const c = await post('/connectors', OP, { channel: 'signal' });
    const connectorId = c.body.connectorId;
    const add = await post('/allowlist', OP, { connectorId, channel: 'signal', peerId: '+15551111' });
    expect(add.status).toBe(201);
    const list = await get(`/allowlist?connectorId=${encodeURIComponent(connectorId)}`, OP);
    expect(list.body.entries.length).toBe(1);
    const del = await fetch(`${BASE}/allowlist?connectorId=${encodeURIComponent(connectorId)}&channel=signal&peerId=${encodeURIComponent('+15551111')}`, { method: 'DELETE', headers: OP });
    expect(del.status).toBe(200);
    const after = await get(`/allowlist?connectorId=${encodeURIComponent(connectorId)}`, OP);
    expect(after.body.entries.length).toBe(0);
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
function mockStorage(rules: any[], seedTurns: any[] = [], identities: any[] = [], sessions: any[] = []) {
  const turns: any[] = [...seedTurns];
  return {
    listMessagingRoutingRules: async () => rules,
    // Phase B: turn history seam (tenantId filter is defense-in-depth).
    listMessagingTurns: async (sessionKey: string, limit: number, tenantId: string) =>
      turns.filter((t) => t.sessionKey === sessionKey && t.tenantId === tenantId).slice(-Math.max(1, limit)),
    appendMessagingTurn: async (t: any) => { turns.push(t); },
    // Phase E: identities + sessions seam.
    listMessagingIdentities: async () => identities,
    listMessagingSessions: async () => sessions,
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

  it('cross-channel identity merges history across linked peers (Phase E)', async () => {
    let postBody: any;
    const fetchImpl: any = async (url: string, init?: any) => {
      if (String(url).endsWith('/v1/runs') && init?.method === 'POST') {
        postBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ runId: 'r-1' }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    // Identity links signal:+15551111 ↔ discord:user-X.
    const identity = {
      identityId: 'idn1', tenantId: 't', displayName: 'Ada',
      peers: [{ channel: 'signal', peerId: '+15551111' }, { channel: 'discord', peerId: 'user-X' }],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    const sessions = [
      { sessionKey: 'signal:c-sig', tenantId: 't', channel: 'signal', conversationId: 'c-sig', peerId: '+15551111', lastInboundAt: '2026-05-27T00:00:00Z', messageCount: 1 },
      { sessionKey: 'discord:c-dis', tenantId: 't', channel: 'discord', conversationId: 'c-dis', peerId: 'user-X', lastInboundAt: '2026-05-27T00:00:02Z', messageCount: 1 },
    ];
    const seedTurns = [
      { turnId: 'ts1', sessionKey: 'signal:c-sig', tenantId: 't', role: 'user', content: 'said on signal', at: '2026-05-27T00:00:00Z' },
      { turnId: 'ts2', sessionKey: 'signal:c-sig', tenantId: 't', role: 'assistant', content: 'replied on signal', at: '2026-05-27T00:00:01Z' },
    ];
    const bridge = createSelfHttpBridge({
      storage: mockStorage([], seedTurns, [identity], sessions),
      baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
    });
    // Inbound on Discord from the linked peer — its history should include the prior Signal turns.
    await bridge.onInbound({
      device: { relayId: 'rl', tenantId: 't', channel: 'discord' },
      envelope: { channel: 'discord', platformMessageId: 'm-d1', conversationId: 'c-dis', peerId: 'user-X', text: 'now on discord', timestamp: '2026-05-27T00:00:03Z' } as any,
      sessionKey: 'discord:c-dis',
    });
    expect(postBody.inputs.messages.map((m: any) => m.content)).toEqual([
      'said on signal', 'replied on signal', 'now on discord',
    ]);
  });

  it('rule with agentId dispatches the agent instead of POST /v1/runs (Phase D)', async () => {
    let runPost: any;
    let dispatchPost: any;
    const fetchImpl: any = async (url: string, init?: any) => {
      const u = String(url);
      if (u.endsWith('/v1/runs') && init?.method === 'POST') {
        runPost = JSON.parse(init.body as string);
        return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('/v1/host/sample/agents/') && u.endsWith('/dispatch') && init?.method === 'POST') {
        dispatchPost = { url: u, body: JSON.parse(init.body as string) };
        return new Response(JSON.stringify({ status: 'completed', result: { text: 'AGENT REPLY' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const bridge = createSelfHttpBridge({
      storage: mockStorage([
        { ruleId: 'r1', tenantId: 't', pattern: '*', agentId: 'core.openwop.agents.assistant', priority: 9, createdAt: '2026-01-01T00:00:00Z' },
      ]),
      baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
    });
    await bridge.onInbound({
      device: { relayId: 'rl', tenantId: 't', channel: 'signal' },
      envelope: { channel: 'signal', platformMessageId: 'm1', conversationId: 'c1', peerId: 'p', text: 'hi', timestamp: '2026-05-27T00:00:00Z' } as any,
      sessionKey: 'signal:c1',
    });
    expect(runPost, 'should NOT POST /v1/runs when bound to an agent').toBeUndefined();
    expect(dispatchPost).toBeTruthy();
    expect(dispatchPost.url).toContain('/agents/core.openwop.agents.assistant/dispatch');
    expect(dispatchPost.body.task.text).toBe('hi');
  });

  it('agent dispatch is bounded by a timeout (no inbound hang on a slow agent)', async () => {
    let enqueued: any;
    // fetchImpl for /dispatch hangs until the AbortController aborts; the
    // request body capture proves we actually called dispatch, the
    // OutboundEnqueue capture proves the timeout path enqueues a notice.
    const fetchImpl: any = async (url: string, init?: any) => {
      const u = String(url);
      if (u.endsWith('/dispatch')) {
        // Hang until the signal aborts; throw the abort error fetch would throw.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e: any = new Error('aborted'); e.name = 'AbortError'; reject(e);
          });
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    // Capture enqueueOutbound via a storage stub that records the enqueue call.
    const store = {
      ...mockStorage([{ ruleId: 'r1', tenantId: 't', pattern: '*', agentId: 'a1', priority: 5, createdAt: '2026-01-01T00:00:00Z' }]),
      getRelayDevice: async () => ({ relayId: 'rl', tenantId: 't', channel: 'signal' } as any),
      enqueueRelayOutbound: async (e: any) => { enqueued = e; },
    };
    const prev = process.env.OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS;
    process.env.OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS = '50';
    try {
      const bridge = createSelfHttpBridge({
        storage: store, baseUrl: 'http://test', bearer: 'x', defaultWorkflowId: 'wf.default', fetchImpl,
      });
      const start = Date.now();
      await bridge.onInbound({
        device: { relayId: 'rl', tenantId: 't', channel: 'signal' },
        envelope: { channel: 'signal', platformMessageId: 'm1', conversationId: 'c1', peerId: 'p', text: 'hi', timestamp: '2026-05-27T00:00:00Z' } as any,
        sessionKey: 'signal:c1',
      });
      // Bounded by 50ms (+a little slack), NOT the natural 5min request budget.
      expect(Date.now() - start).toBeLessThan(2000);
      expect(enqueued).toBeTruthy();
      expect(String(enqueued.text)).toMatch(/timed out/i);
    } finally {
      if (prev === undefined) delete process.env.OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS;
      else process.env.OPENWOP_MESSAGING_AGENT_DISPATCH_TIMEOUT_MS = prev;
    }
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
