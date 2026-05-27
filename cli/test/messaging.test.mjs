// Run via `npm test` (builds dist/ first) — these import the esbuild bundle at ../dist/cli.js.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readConfigSafe, configPathFor, runCli } from '../dist/cli.js';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

/**
 * In-memory stand-in for the /v1/host/sample/messaging relay-gateway, enough
 * to exercise the CLI command paths end-to-end (register/activate/connectors/
 * enqueue/device-loop).
 */
function relayServer() {
  const devices = new Map();
  const tokens = new Map();
  const outbound = new Map();
  const connectors = new Map();
  const policies = new Map();
  const routing = new Map();
  const identities = new Map();
  const deliveryLog = [];
  let seq = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  return async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace('/v1/host/sample/messaging', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const devToken = init.headers?.['x-openwop-device-token'];
    const device = devToken ? devices.get(tokens.get(devToken)) : undefined;

    if (path === '/relay/register' && method === 'POST') {
      const relayId = `relay_${++seq}`;
      devices.set(relayId, { relayId, channel: body.channel, status: 'registered', activationCode: 'CODE' + seq });
      return json(201, { relayId, channel: body.channel, activationCode: 'CODE' + seq });
    }
    if (path === '/relay/activate' && method === 'POST') {
      const d = devices.get(body.relayId);
      if (!d || d.activationCode !== body.activationCode) return json(400, { error: 'invalid_request' });
      const deviceToken = `dtok_${d.relayId}`;
      d.status = 'active'; d.deviceToken = deviceToken; tokens.set(deviceToken, d.relayId); outbound.set(d.relayId, []);
      return json(200, { relayId: d.relayId, channel: d.channel, deviceToken, tokenExpiresAt: '2099-01-01T00:00:00Z', heartbeatIntervalSeconds: 30, outboundPollIntervalSeconds: 5 });
    }
    if (path === '/relay/revoke' && method === 'POST') {
      const d = devices.get(body.relayId);
      if (d) { tokens.delete(d.deviceToken); d.status = 'revoked'; }
      return json(200, { relayId: body.relayId, revoked: true });
    }
    if (path === '/relay/enqueue' && method === 'POST') {
      const egress = { egressId: `egr_${++seq}`, relayId: body.relayId, channel: 'signal', conversationId: body.conversationId, text: body.text, enqueuedAt: 'now' };
      (outbound.get(body.relayId) ?? []).push(egress);
      deliveryLog.push({ logId: `dlv_${seq}`, tenantId: 'default', relayId: body.relayId, channel: 'signal', direction: 'outbound', conversationId: body.conversationId, status: 'queued', detail: `egress ${egress.egressId}`, at: 'now' });
      return json(201, egress);
    }
    if (path === '/device/heartbeat' && method === 'POST') {
      if (!device || device.status !== 'active') return json(401, { error: 'unauthenticated' });
      return json(200, { ok: true, serverTime: 'now', heartbeatIntervalSeconds: 30, outboundPollIntervalSeconds: 5 });
    }
    if (path === '/device/outbound' && method === 'GET') {
      if (!device) return json(401, { error: 'unauthenticated' });
      return json(200, { relayId: device.relayId, messages: outbound.get(device.relayId) ?? [] });
    }
    if (path === '/device/ack' && method === 'POST') {
      if (!device) return json(401, { error: 'unauthenticated' });
      const ackSet = new Set(body.egressIds);
      const q = outbound.get(device.relayId) ?? [];
      outbound.set(device.relayId, q.filter((m) => !ackSet.has(m.egressId)));
      return json(200, { acked: q.length - (outbound.get(device.relayId) ?? []).length });
    }
    if (path === '/connectors' && method === 'POST') {
      const id = body.connectorId ?? `conn_${body.channel}`;
      const existed = connectors.has(id);
      connectors.set(id, { connectorId: id, channel: body.channel, displayName: body.displayName ?? body.channel, enabled: existed ? connectors.get(id).enabled : false });
      return json(existed ? 200 : 201, connectors.get(id));
    }
    if (path === '/connectors' && method === 'GET') {
      return json(200, { connectors: [...connectors.values()] });
    }
    const enMatch = path.match(/^\/connectors\/([^/]+)\/(enable|disable|test)$/);
    if (enMatch && method === 'POST') {
      const c = connectors.get(enMatch[1]);
      if (!c) return json(404, { error: 'not_found' });
      if (enMatch[2] === 'test') return json(200, { connectorId: c.connectorId, ok: c.enabled, detail: c.enabled ? 'ok' : 'disabled' });
      c.enabled = enMatch[2] === 'enable';
      return json(200, c);
    }
    // ---- policy ----
    const polMatch = path.match(/^\/connectors\/([^/]+)\/policy$/);
    if (polMatch) {
      const id = polMatch[1];
      const def = { connectorId: id, tenantId: 'default', dmPolicy: 'pairing', groupPolicy: 'allowlist', requireMention: true, updatedAt: 'now' };
      if (method === 'GET') return json(200, policies.get(id) ?? def);
      if (method === 'PUT') {
        const base = policies.get(id) ?? def;
        if (body.dmPolicy && !['pairing', 'allowlist', 'open', 'disabled'].includes(body.dmPolicy)) return json(400, { error: 'invalid_request' });
        const next = {
          ...base,
          ...(body.dmPolicy ? { dmPolicy: body.dmPolicy } : {}),
          ...(body.groupPolicy ? { groupPolicy: body.groupPolicy } : {}),
          ...(typeof body.requireMention === 'boolean' ? { requireMention: body.requireMention } : {}),
          updatedAt: 'now',
        };
        policies.set(id, next);
        return json(200, next);
      }
    }
    // ---- routing ----
    if (path === '/routing' && method === 'GET') {
      return json(200, { rules: [...routing.values()].sort((a, b) => b.priority - a.priority) });
    }
    if (path === '/routing' && method === 'POST') {
      if (!body.pattern || !body.workflowId) return json(400, { error: 'invalid_request' });
      const ruleId = body.ruleId ?? `route_${++seq}`;
      const rule = { ruleId, tenantId: 'default', channel: body.channel, pattern: body.pattern, workflowId: body.workflowId, priority: body.priority ?? 0, createdAt: 'now' };
      routing.set(ruleId, rule);
      return json(201, rule);
    }
    const routeDel = path.match(/^\/routing\/([^/]+)$/);
    if (routeDel && method === 'DELETE') {
      if (!routing.has(routeDel[1])) return json(404, { error: 'not_found' });
      routing.delete(routeDel[1]);
      return json(200, { ruleId: routeDel[1], deleted: true });
    }
    // ---- identities ----
    if (path === '/identities' && method === 'GET') {
      return json(200, { identities: [...identities.values()] });
    }
    if (path === '/identities' && method === 'POST') {
      const peers = Array.isArray(body.peers) ? body.peers : [];
      if (body.identityId) {
        const existing = identities.get(body.identityId);
        if (!existing) return json(404, { error: 'not_found' });
        const seen = new Set(existing.peers.map((p) => `${p.channel} ${p.peerId}`));
        for (const p of peers) { const k = `${p.channel} ${p.peerId}`; if (!seen.has(k)) { seen.add(k); existing.peers.push(p); } }
        if (body.displayName) existing.displayName = body.displayName;
        return json(200, existing);
      }
      const identityId = `idn_${++seq}`;
      const idn = { identityId, tenantId: 'default', displayName: body.displayName, peers, createdAt: 'now', updatedAt: 'now' };
      identities.set(identityId, idn);
      return json(201, idn);
    }
    const idnMatch = path.match(/^\/identities\/([^/]+)$/);
    if (idnMatch) {
      const idn = identities.get(idnMatch[1]);
      if (!idn) return json(404, { error: 'not_found' });
      if (method === 'GET') return json(200, idn);
      if (method === 'DELETE') {
        const channel = u.searchParams.get('channel');
        const peerId = u.searchParams.get('peerId');
        if (channel && peerId) {
          idn.peers = idn.peers.filter((p) => !(p.channel === channel && p.peerId === peerId));
          return json(200, idn);
        }
        identities.delete(idnMatch[1]);
        return json(200, { identityId: idnMatch[1], deleted: true });
      }
    }
    // ---- delivery log ----
    if (path === '/logs' && method === 'GET') {
      let entries = [...deliveryLog];
      const dir = u.searchParams.get('direction');
      if (dir) entries = entries.filter((e) => e.direction === dir);
      return json(200, { entries });
    }
    // ---- notify ----
    if (path === '/notify' && method === 'POST') {
      if (!['email', 'sms'].includes(body.kind)) return json(400, { error: 'invalid_request' });
      if (!body.to || !body.text) return json(400, { error: 'invalid_request' });
      return json(202, { notifyId: `ntf_${++seq}`, kind: body.kind, to: body.to, status: 'accepted', detail: 'synthetic dispatch accepted', acceptedAt: 'now' });
    }
    return json(404, { error: 'not_found' });
  };
}

let configHome;
beforeEach(() => { configHome = mkdtempSync(join(tmpdir(), 'owop-msg-')); });
afterEach(() => { rmSync(configHome, { recursive: true, force: true }); });

function opts(fetchImpl, cap) {
  return { io: cap.io, fetchImpl, env: { OPENWOP_CONFIG_HOME: configHome }, cwd: process.cwd(), repoRoot: process.cwd() };
}

// Relay device creds live in a dedicated 0600 file, NOT config.json.
function readRelayCreds() {
  const p = join(configHome, '.openwop', 'relay-credentials.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

describe('relay device lifecycle (CLI)', () => {
  it('setup registers + activates and stores the device token in config', async () => {
    const cap = capture();
    const code = await runCli(['relay', 'setup', '--channel', 'signal', '--name', 'mac'], opts(relayServer(), cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /registered \+ activated/);
    const creds = readRelayCreds();
    assert.equal(creds.channel, 'signal');
    assert.match(creds.deviceToken, /^dtok_/);
    // The device token (a host credential) must NOT land in config.json.
    const cfg = readConfigSafe(configPathFor(undefined, { OPENWOP_CONFIG_HOME: configHome })) ?? {};
    assert.equal(cfg.relay, undefined, 'device token must not be written to config.json');
  });

  it('rejects an unknown channel before any network call', async () => {
    const cap = capture();
    const code = await runCli(['relay', 'setup', '--channel', 'telegram'], opts(async () => { throw new Error('no fetch'); }, cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--channel must be one of/);
  });

  it('start --once heartbeats, delivers queued outbound, and acks', async () => {
    const fetchImpl = relayServer();
    // setup
    await runCli(['relay', 'setup', '--channel', 'signal'], opts(fetchImpl, capture()));
    const creds = readRelayCreds();
    // operator queues a message
    const sendCap = capture();
    await runCli(['relay', 'send', '--relay-id', creds.relayId, '--conversation', 'c1', '--text', 'hello world'], opts(fetchImpl, sendCap));
    assert.match(sendCap.stdout, /Queued egress/);
    // one bridge cycle delivers it (console delivery prints the text)
    const startCap = capture();
    const code = await runCli(['relay', 'start', '--once'], opts(fetchImpl, startCap));
    assert.equal(code, 0, startCap.stderr);
    assert.match(startCap.stdout, /\[signal\] c1: hello world/);
    assert.match(startCap.stdout, /delivered 1 message/);
    // second cycle: queue drained by the ack
    const startCap2 = capture();
    await runCli(['relay', 'start', '--once'], opts(fetchImpl, startCap2));
    assert.match(startCap2.stdout, /delivered 0 message/);
  });

  it('status probes the host with a heartbeat', async () => {
    const fetchImpl = relayServer();
    await runCli(['relay', 'setup', '--channel', 'whatsapp'], opts(fetchImpl, capture()));
    const cap = capture();
    const code = await runCli(['relay', 'status'], opts(fetchImpl, cap));
    assert.equal(code, 0);
    assert.match(cap.stdout, /status:\s+online/);
  });
});

describe('messaging connectors (CLI)', () => {
  it('add → list → enable → test', async () => {
    const fetchImpl = relayServer();
    const addCap = capture();
    let code = await runCli(['messaging', 'connectors', 'add', '--channel', 'signal', '--display-name', 'Signal'], opts(fetchImpl, addCap));
    assert.equal(code, 0, addCap.stderr);
    assert.match(addCap.stdout, /Connector conn_signal \(signal\)/);

    const listCap = capture();
    await runCli(['messaging', 'connectors', 'list'], opts(fetchImpl, listCap));
    assert.match(listCap.stdout, /conn_signal/);

    await runCli(['messaging', 'connectors', 'enable', 'conn_signal'], opts(fetchImpl, capture()));
    const testCap = capture();
    code = await runCli(['messaging', 'connectors', 'test', 'conn_signal'], opts(fetchImpl, testCap));
    assert.equal(code, 0);
    assert.match(testCap.stdout, /✓ conn_signal/);
  });
});

describe('messaging policy (CLI)', () => {
  it('get default → set override → get persisted', async () => {
    const fetchImpl = relayServer();
    const getCap = capture();
    let code = await runCli(['messaging', 'policy', 'get', 'conn_signal'], opts(fetchImpl, getCap));
    assert.equal(code, 0, getCap.stderr);
    assert.match(getCap.stdout, /dm=pairing group=allowlist requireMention=true/);

    const setCap = capture();
    code = await runCli(['messaging', 'policy', 'set', 'conn_signal', '--dm', 'open', '--require-mention', 'false'], opts(fetchImpl, setCap));
    assert.equal(code, 0, setCap.stderr);
    assert.match(setCap.stdout, /dm=open group=allowlist requireMention=false/);

    const get2 = capture();
    await runCli(['messaging', 'policy', 'get', 'conn_signal'], opts(fetchImpl, get2));
    assert.match(get2.stdout, /dm=open/);
  });
});

describe('messaging routing (CLI)', () => {
  it('add → list (priority order) → remove', async () => {
    const fetchImpl = relayServer();
    await runCli(['messaging', 'routing', 'add', '--pattern', '*', '--workflow', 'wf.fallback'], opts(fetchImpl, capture()));
    const addCap = capture();
    const code = await runCli(['messaging', 'routing', 'add', '--channel', 'signal', '--pattern', 'support', '--workflow', 'wf.support', '--priority', '10'], opts(fetchImpl, addCap));
    assert.equal(code, 0, addCap.stderr);
    assert.match(addCap.stdout, /wf\.support.*priority 10/);

    const listCap = capture();
    await runCli(['messaging', 'routing', 'list', '--json'], opts(fetchImpl, listCap));
    const rules = JSON.parse(listCap.stdout).rules;
    assert.equal(rules[0].workflowId, 'wf.support'); // higher priority first

    const rmCap = capture();
    await runCli(['messaging', 'routing', 'remove', rules[1].ruleId], opts(fetchImpl, rmCap));
    assert.match(rmCap.stdout, /Removed routing rule/);
  });

  it('rejects a routing add missing --workflow', async () => {
    const cap = capture();
    const code = await runCli(['messaging', 'routing', 'add', '--pattern', '*'], opts(relayServer(), cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--workflow is required/);
  });
});

describe('messaging identity (CLI)', () => {
  it('create → link → unlink → list → delete', async () => {
    const fetchImpl = relayServer();
    const createCap = capture();
    let code = await runCli(['messaging', 'identity', 'create', '--name', 'Alice', '--peer', 'signal:+15551234'], opts(fetchImpl, createCap));
    assert.equal(code, 0, createCap.stderr);
    assert.match(createCap.stdout, /Identity idn_\d+ \(Alice\) — 1 peer/);

    const listCap = capture();
    await runCli(['messaging', 'identity', 'list', '--json'], opts(fetchImpl, listCap));
    const id = JSON.parse(listCap.stdout).identities[0].identityId;

    const linkCap = capture();
    await runCli(['messaging', 'identity', 'link', id, '--peer', 'whatsapp:wa-1'], opts(fetchImpl, linkCap));
    assert.match(linkCap.stdout, /linked to 2 peer/);

    const unlinkCap = capture();
    await runCli(['messaging', 'identity', 'unlink', id, '--peer', 'whatsapp:wa-1'], opts(fetchImpl, unlinkCap));
    assert.match(unlinkCap.stdout, /Unlinked whatsapp:wa-1/);

    const delCap = capture();
    code = await runCli(['messaging', 'identity', 'delete', id], opts(fetchImpl, delCap));
    assert.equal(code, 0);
    assert.match(delCap.stdout, /Deleted identity/);
  });

  it('rejects a malformed --peer', async () => {
    const cap = capture();
    const code = await runCli(['messaging', 'identity', 'create', '--name', 'X', '--peer', 'no-colon'], opts(relayServer(), cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--peer must be <channel>:<peerId>/);
  });
});

describe('messaging logs (CLI)', () => {
  it('lists delivery-log entries and filters by direction', async () => {
    const fetchImpl = relayServer();
    await runCli(['relay', 'setup', '--channel', 'signal'], opts(fetchImpl, capture()));
    const creds = readRelayCreds();
    await runCli(['relay', 'send', '--relay-id', creds.relayId, '--conversation', 'c1', '--text', 'hi'], opts(fetchImpl, capture()));

    const logsCap = capture();
    const code = await runCli(['messaging', 'logs', '--direction', 'outbound'], opts(fetchImpl, logsCap));
    assert.equal(code, 0, logsCap.stderr);
    assert.match(logsCap.stdout, /outbound.*queued/);
  });
});

describe('notify (CLI)', () => {
  it('dispatches an email and an sms; rejects an unknown kind', async () => {
    const fetchImpl = relayServer();
    const emailCap = capture();
    let code = await runCli(['notify', 'email', '--to', 'a@b.dev', '--subject', 'Hi', '--text', 'body'], opts(fetchImpl, emailCap));
    assert.equal(code, 0, emailCap.stderr);
    assert.match(emailCap.stdout, /email ntf_\d+ → a@b\.dev: accepted/);

    const smsCap = capture();
    code = await runCli(['notify', 'sms', '--to', '+15550000', '--text', 'pong'], opts(fetchImpl, smsCap));
    assert.equal(code, 0, smsCap.stderr);

    const badCap = capture();
    code = await runCli(['notify', 'carrier-pigeon', '--to', 'x', '--text', 'y'], opts(fetchImpl, badCap));
    assert.equal(code, 2);
    assert.match(badCap.stderr, /Unknown notify kind/);
  });

  it('rejects notify without --text', async () => {
    const cap = capture();
    const code = await runCli(['notify', 'email', '--to', 'a@b.dev'], opts(relayServer(), cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--text is required/);
  });
});

import { detectChannelAvailability } from '../dist/cli.js';

describe('channel availability detection', () => {
  it('reports whatsapp as unavailable in the core CLI', () => {
    const r = detectChannelAvailability('whatsapp', {});
    assert.equal(r.available, false);
    assert.match(r.detail, /baileys|channel build/i);
  });
  it('gates imessage on macOS (forceable via env)', () => {
    assert.equal(detectChannelAvailability('imessage', { OPENWOP_FORCE_PLATFORM: 'darwin' }).available, true);
    assert.equal(detectChannelAvailability('imessage', { OPENWOP_FORCE_PLATFORM: 'linux' }).available, false);
  });
  it('reports an unknown channel', () => {
    assert.equal(detectChannelAvailability('telegram', {}).available, false);
  });
});

describe('doctor surfaces relay readiness', () => {
  it('warns when no relay configured, reports when configured', async () => {
    // no relay yet
    const cap1 = capture();
    await runCli(['doctor', '--json', '--base-url', 'http://127.0.0.1:0'], opts(async () => { throw new Error('offline'); }, cap1));
    const doc1 = JSON.parse(cap1.stdout);
    assert.ok(doc1.checks.some((c) => c.name === 'relay' && /no messaging relay/.test(c.message)));

    // configure a relay, then doctor should report it + channel readiness
    await runCli(['relay', 'setup', '--channel', 'imessage'], opts(relayServer(), capture()));
    const cap2 = capture();
    await runCli(['doctor', '--json', '--base-url', 'http://127.0.0.1:0'],
      { ...opts(async () => { throw new Error('offline'); }, cap2), env: { OPENWOP_CONFIG_HOME: configHome, OPENWOP_FORCE_PLATFORM: 'darwin' } });
    const doc2 = JSON.parse(cap2.stdout);
    assert.ok(doc2.checks.some((c) => c.name === 'relay' && /imessage relay relay_/.test(c.message)));
    assert.ok(doc2.checks.some((c) => c.name === 'channel imessage'));
  });
});

import { existsSync, readFileSync } from 'node:fs';

describe('relay daemon lifecycle (CLI)', () => {
  it('start --daemon spawns a detached process and records a pid; stop clears it', async () => {
    const fetchImpl = relayServer();
    await runCli(['relay', 'setup', '--channel', 'signal', '--base-url', 'http://127.0.0.1:0'], opts(fetchImpl, capture()));
    const startCap = capture();
    const code = await runCli(['relay', 'start', '--daemon', '--base-url', 'http://127.0.0.1:0'], opts(fetchImpl, startCap));
    assert.equal(code, 0, startCap.stderr);
    assert.match(startCap.stdout, /started in background \(pid \d+/);
    const recordPath = join(configHome, '.openwop', 'relay.pid.json');
    assert.ok(existsSync(recordPath), 'relay pid record written');
    const rec = JSON.parse(readFileSync(recordPath, 'utf8'));
    assert.equal(rec.channel, 'signal');
    assert.ok(Number.isInteger(rec.pid));

    const stopCap = capture();
    await runCli(['relay', 'stop'], opts(fetchImpl, stopCap));
    assert.match(stopCap.stdout, /Stopped relay daemon|Cleared stale relay/);
    assert.ok(!existsSync(recordPath), 'pid record cleared after stop');
  });

  it('stop with no daemon is a no-op', async () => {
    const cap = capture();
    const code = await runCli(['relay', 'stop'], opts(relayServer(), cap));
    assert.equal(code, 0);
    assert.match(cap.stdout, /No relay daemon recorded/);
  });
});
