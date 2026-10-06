/**
 * The WASM memory-ceiling witness, proven in both directions against a double.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetV2Discovery } from './v2.js';
import { MEMORY_CAP_FIXTURE, memoryCapLeg } from './wasm-memory-cap-witness.js';

type Defect = 'none' | 'no-breach-event' | 'wrong-kind' | 'completes' | 'no-max' | 'no-wasm' | 'not-advertised';
let defect: Defect = 'none';

const server: Server = createServer((req, res) => {
  const send = (status: number, body: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = req.url ?? '';
  if (url.startsWith('/.well-known/openwop')) {
    const wasm = { abiVersions: [1], ...(defect === 'no-max' ? {} : { maxMemoryBytes: 134217728 }) };
    return send(200, { protocolVersions: ['2.0'], ...(defect === 'no-wasm' ? {} : { nodePackRuntimes: { status: 'experimental', since: '2.0', until: '2027-01-01', witness: 'claims-check', wasm } }), fixtures: defect === 'not-advertised' ? [] : [MEMORY_CAP_FIXTURE] });
  }
  if (url === '/runs' && req.method === 'POST') return send(201, { runId: 'run-1' });
  if (url === '/runs/run-1') return send(200, { runId: 'run-1', status: defect === 'completes' ? 'completed' : 'failed' });
  if (url === '/runs/run-1/events/poll') {
    const events = [{ type: 'run.started', sequence: 0, payload: {} }];
    if (defect !== 'no-breach-event') events.push({ type: 'cap.breached', sequence: 1, payload: { kind: defect === 'wrong-kind' ? 'run-duration' : 'wasm-memory' } });
    return send(200, { runId: 'run-1', events, lastSequence: events.length - 1, status: 'failed', isTerminal: true });
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
  const o = await memoryCapLeg();
  return o.kind === 'skip' ? o.skip : o.findings.length ? 'fail' : 'pass';
}

describe('wasm-memory-cap-witness', () => {
  it('a conforming double passes', async () => { expect(await outcome('none')).toBe('pass'); });
  it('no cap.breached fails', async () => { expect(await outcome('no-breach-event')).toBe('fail'); });
  it('a breach of another kind fails', async () => { expect(await outcome('wrong-kind')).toBe('fail'); });
  it('a run that completes after the breach fails', async () => { expect(await outcome('completes')).toBe('fail'); });
  it('no maxMemoryBytes is inapplicable', async () => { expect(await outcome('no-max')).toBe('inapplicable'); });
  it('no nodePackRuntimes.wasm is inapplicable', async () => { expect(await outcome('no-wasm')).toBe('inapplicable'); });
  it('the fixture not advertised is inapplicable', async () => { expect(await outcome('not-advertised')).toBe('inapplicable'); });
});
