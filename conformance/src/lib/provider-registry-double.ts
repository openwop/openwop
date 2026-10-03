/**
 * A scratch double for RFC 0233's provider registry reads. Each self-test turns
 * on ONE defect to show `provider-registry-witness.ts` convicts it.
 *
 * A test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FIRST_PACK, FIXTURE_ID, RIVAL_PACK } from './provider-registry-witness.js';

export type RegistryDefect =
  | 'none' | 'not-installed' | 'duplicate-id' | 'no-refusal' | 'wrong-holder' | 'first-refused'
  | 'rival-resolves' | 'qualified-wrong-pack' | 'leaks-endpoint' | 'not-served';

export class ProviderRegistryDouble {
  defect: RegistryDefect = 'none';
  url = '';
  /** The v2 discovery document, so the scenario files themselves can run against the double. */
  discovery: Record<string, unknown> = { connections: { status: 'experimental', since: '2.45', witness: 'witnessable-gated', packsSupported: true, providerRead: true } };
  private server: Server | undefined;

  async start(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { const s = this.server; if (s) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); } }

  private send(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

  private registry(): Record<string, unknown> {
    const d = this.defect;
    const providers: Array<Record<string, unknown>> = [{ id: 'github', source: 'builtin' }];
    if (d !== 'not-installed') {
      providers.push({ id: FIXTURE_ID, source: 'pack', packName: d === 'first-refused' ? RIVAL_PACK : FIRST_PACK, ...(d === 'leaks-endpoint' ? { tokenUrl: 'https://acme.example/token' } : {}) });
      if (d === 'duplicate-id') providers.push({ id: FIXTURE_ID, source: 'pack', packName: RIVAL_PACK });
    }
    const refusals: Array<Record<string, unknown>> = [];
    if (d !== 'not-installed' && d !== 'no-refusal') {
      refusals.push(d === 'first-refused'
        ? { packName: FIRST_PACK, providerId: FIXTURE_ID, code: 'connection_provider_conflict', heldBy: RIVAL_PACK }
        : { packName: RIVAL_PACK, providerId: FIXTURE_ID, code: 'connection_provider_conflict', heldBy: d === 'wrong-holder' ? 'builtin' : FIRST_PACK });
    }
    return { providers, refusals };
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const u = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && u.pathname === '/.well-known/openwop') return this.send(res, 200, this.discovery);
    if (this.defect === 'not-served' && u.pathname.startsWith('/connection-providers')) return this.send(res, 404, { error: 'not_found', message: 'no route' });
    if (req.method === 'GET' && u.pathname === '/connection-providers') return this.send(res, 200, this.registry());
    const m = /^\/connection-providers\/([^/]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]!);
      const pack = u.searchParams.get('pack');
      const reg = this.registry();
      const defs = (reg['providers'] as Array<Record<string, unknown>>).filter((p) => p['id'] === id);
      let hit: Record<string, unknown> | undefined;
      if (pack === null) hit = defs.length === 1 ? defs[0] : undefined;
      else if (pack === RIVAL_PACK && this.defect === 'rival-resolves') hit = defs[0];
      else if (pack === FIRST_PACK && this.defect === 'qualified-wrong-pack') hit = { id, source: 'builtin' };
      else hit = defs.find((p) => p['packName'] === pack);
      return hit ? this.send(res, 200, hit) : this.send(res, 404, { error: 'connection_provider_unresolved', message: `no definition for ${id}` });
    }
    return this.send(res, 404, { error: 'not_found', message: `no route ${req.method} ${u.pathname}` });
  }
}
