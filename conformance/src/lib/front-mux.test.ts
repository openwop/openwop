/**
 * The one-front-many-fakes guard, asserted WITHOUT a host or a tunnel.
 *
 * The defect these tests pin is in the suite: a scenario that constructs its
 * own fake on an ephemeral port and hands the host `hostFacingEndpoint()` must
 * be reached through the operator's single public front, not have its traffic
 * land on the shared fake that owns the pinned port. The "tunnel" here is a
 * plain request to the pinned local port carrying the path the front would
 * forward — which is all a TLS-terminating tunnel does.
 */
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { A2AFakePeer } from './a2a-fake-peer.js';
import { McpFakeServer } from './mcp-fake-server.js';

const FRONT = 'https://front.example.com';
const ENV = ['OPENWOP_A2A_FAKE_PEER_URL', 'OPENWOP_A2A_FAKE_PEER_PORT', 'OPENWOP_MCP_FAKE_SERVER_URL', 'OPENWOP_MCP_FAKE_SERVER_PORT'] as const;
const stops: Array<() => Promise<void>> = [];

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** What the tunnel does: forward the front's path to the pinned local port. */
function viaTunnel(pinned: number, hostFacing: string): string {
  return `http://127.0.0.1:${pinned}${new URL(hostFacing).pathname.replace(/\/+$/, '')}`;
}

afterEach(async () => {
  while (stops.length > 0) await stops.pop()?.();
  for (const k of ENV) delete process.env[k];
});

describe('front-mux — a scenario-owned fake is reachable through the shared front', () => {
  it('A2A: the host reaches the scenario\'s own peer, and the shared peer sees nothing', async () => {
    const pinned = await freePort();
    process.env['OPENWOP_A2A_FAKE_PEER_URL'] = FRONT;
    process.env['OPENWOP_A2A_FAKE_PEER_PORT'] = String(pinned);
    const shared = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await shared.start(pinned);
    stops.push(() => shared.stop());
    const own = new A2AFakePeer({ protocolVersions: ['0.3'] });
    await own.start();
    stops.push(() => own.stop());

    // The pinned owner keeps the bare front (unchanged); the other fake gets a nonce path.
    expect(shared.hostFacingEndpoint()).toBe(FRONT);
    expect(own.hostFacingEndpoint()).toMatch(/^https:\/\/front\.example\.com\/fx\/[0-9a-f]{18}$/);

    const base = viaTunnel(pinned, own.hostFacingEndpoint());
    const card = await fetch(`${base}/.well-known/agent-card.json`).then((r) => r.json()) as { url?: string; protocolVersion?: string };
    // The 0.3 card is the OWN peer's, and its RPC URL carries the nonce so the host's next call comes back here too.
    expect(card.protocolVersion?.startsWith('0.3')).toBe(true);
    expect(card.url).toBe(`${own.hostFacingEndpoint()}/a2a/jsonrpc`);
    const rpc = await fetch(`${base}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'A2A-Version': '0.3' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } } }),
    });
    expect(rpc.status).toBe(200);

    expect(own.invocations().map((i) => i.path)).toEqual(['/.well-known/agent-card.json', '/a2a/jsonrpc']);
    expect(shared.invocations()).toHaveLength(0);
  });

  it('MCP: the host reaches the scenario\'s own server, and the shared server sees nothing', async () => {
    const pinned = await freePort();
    process.env['OPENWOP_MCP_FAKE_SERVER_URL'] = `${FRONT}/`;
    process.env['OPENWOP_MCP_FAKE_SERVER_PORT'] = String(pinned);
    const shared = new McpFakeServer();
    await shared.start(pinned);
    stops.push(() => shared.stop());
    const own = new McpFakeServer({ protocolVersions: ['2025-06-18'] });
    await own.start();
    stops.push(() => own.stop());

    const res = await fetch(viaTunnel(pinned, own.hostFacingEndpoint()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(200);
    expect(own.invocations()).toHaveLength(1);
    expect(shared.invocations()).toHaveLength(0);
  });

  it('a request for a stopped fake is answered 404 by the owner, never counted by it', async () => {
    const pinned = await freePort();
    process.env['OPENWOP_A2A_FAKE_PEER_URL'] = FRONT;
    process.env['OPENWOP_A2A_FAKE_PEER_PORT'] = String(pinned);
    const shared = new A2AFakePeer();
    await shared.start(pinned);
    stops.push(() => shared.stop());
    const own = new A2AFakePeer();
    await own.start();
    const url = viaTunnel(pinned, own.hostFacingEndpoint());
    await own.stop();

    const res = await fetch(`${url}/.well-known/agent-card.json`);
    expect(res.status).toBe(404);
    expect(shared.invocations()).toHaveLength(0);
  });

  it('with no front configured, every fake keeps its own local address', async () => {
    const own = new A2AFakePeer();
    await own.start();
    stops.push(() => own.stop());
    expect(own.hostFacingEndpoint()).toBe(own.endpoint());
  });
});

describe('front-mux — a front that carries a PATH (2.38.0)', () => {
  it('routes `${frontPath}/fx/<nonce>` to the registered fake, and gives the owner its own traffic without the prefix', async () => {
    const pinned = await freePort();
    process.env['OPENWOP_A2A_FAKE_PEER_URL'] = `${FRONT}/peer`;
    process.env['OPENWOP_A2A_FAKE_PEER_PORT'] = String(pinned);
    const shared = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await shared.start(pinned);
    stops.push(() => shared.stop());
    const own = new A2AFakePeer({ protocolVersions: ['0.3'] });
    await own.start();
    stops.push(() => own.stop());

    expect(own.hostFacingEndpoint()).toMatch(/^https:\/\/front\.example\.com\/peer\/fx\/[0-9a-f]{18}$/);
    const ownCard = await fetch(`${viaTunnel(pinned, own.hostFacingEndpoint())}/.well-known/agent-card.json`);
    expect(ownCard.status).toBe(200);
    expect(own.invocations().map((i) => i.path)).toEqual(['/.well-known/agent-card.json']);

    // The owner's own card, through the same path-bearing front.
    const sharedCard = await fetch(`http://127.0.0.1:${pinned}/peer/.well-known/agent-card.json`);
    expect(sharedCard.status).toBe(200);
    expect(shared.invocations().map((i) => i.path)).toEqual(['/.well-known/agent-card.json']);
  });
});
