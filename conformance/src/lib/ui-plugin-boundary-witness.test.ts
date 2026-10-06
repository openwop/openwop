/**
 * The ui-plugin boundary witness (RFC 0238), proven in both directions against a
 * double. No host serves the operations yet, so each case turns on ONE defect in an
 * otherwise conforming double and checks that only the legs owning that rule fail.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANARIES } from './canaries.js';
import { resetV2Discovery } from './v2.js';
import { FIXTURE_ARTIFACT, allowlistLeg, egressLeg, isolationLeg, noByokLeg, parseCsp, type LegOutcome } from './ui-plugin-boundary-witness.js';

type Defect =
  | 'none' | 'same-origin' | 'no-sandbox' | 'egress-open' | 'connect-star'
  | 'executes-undeclared' | 'executes-unknown' | 'read-refused' | 'leaks-canary' | 'not-served' | 'not-installed';
let defect: Defect = 'none';
const GOOD_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'";
const FRAME = '/host/ui-plugins/core.openwop.conformance.ui-plugin-narrow/narrow/frame';
const RPC = '/host/ui-plugins/core.openwop.conformance.ui-plugin-narrow/narrow/rpc';
const canary = CANARIES[0]!.value;

function csp(): string {
  if (defect === 'same-origin') return "sandbox allow-scripts allow-same-origin; default-src 'none'";
  if (defect === 'no-sandbox') return "default-src 'none'";
  if (defect === 'egress-open') return 'sandbox allow-scripts; default-src *';
  if (defect === 'connect-star') return "sandbox allow-scripts; default-src 'none'; connect-src https://exfil.example";
  return GOOD_CSP;
}

const server: Server = createServer((req, res) => {
  const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body));
  };
  if (req.url?.startsWith('/.well-known/openwop')) {
    return send(200, { protocolVersions: ['2.0'], uiPlugins: { status: 'experimental', since: '2.0', until: '2027-01-01', witness: 'witnessable-gated', isolation: 'cross-origin-iframe', hostApi: ['artifact.read', 'artifact.write', 'host.toast', 'host.navigate'], ...(defect === 'not-served' ? {} : { served: true }) } });
  }
  if (defect === 'not-installed' && (req.url === FRAME || req.url === RPC)) return send(404, { error: { code: 'not_found' } });
  if (req.url === FRAME) { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp() }); res.end('<!doctype html><p>narrow</p>'); return; }
  if (req.url === RPC && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const msg = (JSON.parse(raw || '{}') as { message?: { id?: number; method?: string } }).message ?? {};
      const id = msg.id ?? 0;
      const ok = (result: Record<string, unknown>): void => send(200, { openwop: 'ui-plugin/1', type: 'response', id, ok: true, result });
      const refuse = (code: string): void => send(200, { openwop: 'ui-plugin/1', type: 'response', id, ok: false, error: { code } });
      if (!['artifact.read', 'artifact.write', 'host.toast', 'host.navigate'].includes(msg.method ?? '')) {
        return defect === 'executes-unknown' ? ok({}) : send(400, { error: { code: 'validation_error' } });
      }
      if (msg.method === 'artifact.read') {
        if (defect === 'read-refused') return refuse('method_not_allowed');
        return ok({ artifactId: FIXTURE_ARTIFACT, content: defect === 'leaks-canary' ? `key=${canary}` : 'secret ref: {{secrets.openwop-conformance-canary-secret}}', version: '1' });
      }
      return defect === 'executes-undeclared' ? ok({ version: '2' }) : refuse('method_not_allowed');
    });
    return;
  }
  send(404, { error: { code: 'not_found' } });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  vi.stubEnv('OPENWOP_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv('OPENWOP_API_KEY', 'scratch-key');
});
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => resetV2Discovery());

const legs = { isolation: isolationLeg, egress: egressLeg, allowlist: allowlistLeg, noByok: noByokLeg };
type Leg = keyof typeof legs;
const failed = (o: LegOutcome): boolean => o.kind === 'observed' && o.findings.length > 0;

async function outcomes(d: Defect): Promise<Record<Leg, string>> {
  defect = d;
  resetV2Discovery();
  const out = {} as Record<Leg, string>;
  for (const k of Object.keys(legs) as Leg[]) {
    const o = await legs[k]();
    out[k] = o.kind === 'skip' ? o.skip : failed(o) ? 'fail' : 'pass';
  }
  return out;
}
const all = (v: string): Record<Leg, string> => ({ isolation: v, egress: v, allowlist: v, noByok: v });

describe('ui-plugin-boundary-witness (RFC 0238)', () => {
  it('parses a policy into directives', () => {
    expect([...parseCsp("sandbox allow-scripts; default-src 'none'").entries()]).toEqual([['sandbox', ['allow-scripts']], ['default-src', ["'none'"]]]);
  });
  it('a conforming double passes every leg', async () => { expect(await outcomes('none')).toEqual(all('pass')); });
  it('allow-same-origin fails the isolation leg only', async () => { expect(await outcomes('same-origin')).toEqual({ ...all('pass'), isolation: 'fail' }); });
  it('no sandbox directive fails the isolation leg only', async () => { expect(await outcomes('no-sandbox')).toEqual({ ...all('pass'), isolation: 'fail' }); });
  it('an open default-src fails the egress leg only', async () => { expect(await outcomes('egress-open')).toEqual({ ...all('pass'), egress: 'fail' }); });
  it('an undeclared connect-src fails the egress leg only', async () => { expect(await outcomes('connect-star')).toEqual({ ...all('pass'), egress: 'fail' }); });
  it('executing an undeclared method fails the allowlist leg only', async () => { expect(await outcomes('executes-undeclared')).toEqual({ ...all('pass'), allowlist: 'fail' }); });
  it('executing a method outside the enum fails the allowlist leg only', async () => { expect(await outcomes('executes-unknown')).toEqual({ ...all('pass'), allowlist: 'fail' }); });
  it('refusing the declared method fails the allowlist control', async () => { expect(await outcomes('read-refused')).toEqual({ ...all('pass'), allowlist: 'fail' }); });
  it('canary material in a response fails the no-byok leg only', async () => { expect(await outcomes('leaks-canary')).toEqual({ ...all('pass'), noByok: 'fail' }); });
  it('a host without uiPlugins.served is inapplicable on every leg', async () => { expect(await outcomes('not-served')).toEqual(all('inapplicable')); });
  it('a host without the fixture installed is inapplicable on every leg', async () => { expect(await outcomes('not-installed')).toEqual(all('inapplicable')); });
});
