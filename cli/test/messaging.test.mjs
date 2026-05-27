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
