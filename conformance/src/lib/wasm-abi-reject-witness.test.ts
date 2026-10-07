/**
 * The WASM ABI-rejection witness, proven in both directions against a double.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetV2Discovery } from './v2.js';
import { ABI_FIXTURE, ABI_PACK, abiRejectLeg } from './wasm-abi-reject-witness.js';

type Defect = 'none' | 'refused-at-create' | 'loaded-listed' | 'node-runs' | 'hangs' | 'server-error' | 'no-loaded-packs' | 'no-wasm' | 'not-advertised';
let defect: Defect = 'none';

const server: Server = createServer((req, res) => {
  const send = (status: number, body: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = req.url ?? '';
  if (url.startsWith('/.well-known/openwop')) {
    const loadedPacks = defect === 'loaded-listed' ? ['vendor.openwop.misbehaving', ABI_PACK] : ['vendor.openwop.misbehaving'];
    const wasm = { abiVersions: [1], ...(defect === 'no-loaded-packs' ? {} : { loadedPacks }) };
    return send(200, { protocolVersions: ['2.0'], ...(defect === 'no-wasm' ? {} : { nodePackRuntimes: { status: 'experimental', since: '2.0', until: '2027-01-01', witness: 'claims-check', wasm } }), fixtures: defect === 'not-advertised' ? [] : [ABI_FIXTURE] });
  }
  if (url === '/runs' && req.method === 'POST') {
    if (defect === 'refused-at-create') return send(422, { error: 'capability_not_provided', message: 'vendor.openwop.misbehaving.abi-bomb is not executable here' });
    if (defect === 'server-error') return send(500, { error: 'internal_error', message: 'boom' });
    return send(201, { runId: 'run-1' });
  }
  const status = defect === 'node-runs' ? 'completed' : defect === 'hangs' ? 'running' : 'failed';
  if (url === '/runs/run-1') return send(200, { runId: 'run-1', status });
  if (url === '/runs/run-1/events/poll') {
    const events: Array<Record<string, unknown>> = [{ type: 'run.started', sequence: 0, payload: {} }, { type: 'node.started', sequence: 1, nodeId: 'abi', payload: { nodeId: 'abi' } }];
    if (defect === 'node-runs') events.push({ type: 'node.completed', sequence: 2, nodeId: 'abi', payload: { nodeId: 'abi', outputs: {} } });
    else if (defect !== 'hangs') events.push({ type: 'node.failed', sequence: 2, nodeId: 'abi', payload: { nodeId: 'abi', error: { code: 'capability_not_provided', message: 'not loaded' } } });
    return send(200, { runId: 'run-1', events, lastSequence: events.length - 1, status, isTerminal: status !== 'running' });
  }
  send(404, { error: 'not_found', message: 'no' });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  vi.stubEnv('OPENWOP_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv('OPENWOP_API_KEY', 'scratch-key');
});
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => resetV2Discovery());

async function outcome(d: Defect): Promise<string> {
  defect = d;
  resetV2Discovery();
  const o = await abiRejectLeg();
  return o.kind === 'skip' ? o.skip : o.findings.length ? 'fail' : 'pass';
}

describe('wasm-abi-reject-witness', () => {
  it('a run that fails without the node completing passes', async () => { expect(await outcome('none')).toBe('pass'); });
  it('a run refused at creation passes', async () => { expect(await outcome('refused-at-create')).toBe('pass'); });
  it('no loadedPacks still judges the run', async () => { expect(await outcome('no-loaded-packs')).toBe('pass'); });
  it('loadedPacks listing the ABI-999 pack fails', async () => { expect(await outcome('loaded-listed')).toBe('fail'); });
  it('the node completing fails', async () => { expect(await outcome('node-runs')).toBe('fail'); });
  it('a run that never ends fails', async () => { expect(await outcome('hangs')).toBe('fail'); }, 40_000);
  it('a 5xx at creation is blocked', async () => { expect(await outcome('server-error')).toBe('blocked'); });
  it('no nodePackRuntimes.wasm is inapplicable', async () => { expect(await outcome('no-wasm')).toBe('inapplicable'); });
  it('the fixture not advertised is inapplicable', async () => { expect(await outcome('not-advertised')).toBe('inapplicable'); });
});
