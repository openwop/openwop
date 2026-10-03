/**
 * A scratch double for the trigger bridge's normative surface at major 2: the
 * signed ingest (RFC 0230) and the dead-letter read (RFC 0232). Each self-test
 * turns on ONE defect to show `trigger-delivery-witness.ts` convicts it, and a
 * standalone instance lets the scenario files themselves be run against it.
 *
 * A test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { unprojectBoundId } from './bound-id.js';
import { standardWebhooksSignature } from './triggerBridge.js';

/** The credential the double treats as a second tenant. */
export const OTHER_TENANT_KEY = 'tenant-b-key';

export type TriggerDefect =
  | 'none' | 'dedup-new-run' | 'refused-starts-run' | 'refused-changes-state' | 'no-causation'
  | 'record-leaks-canary' | 'refused-not-recorded' | 'refused-records-state-change' | 'wrong-retention'
  | 'limit-ignored' | 'cursor-not-bound' | 'tenant-leak';

interface DoubleSub { id: string; n: number; mode: string; secret: string; state: string; seen: Map<string, string>; dead: Array<Record<string, unknown>> }

export class TriggerDouble {
  defect: TriggerDefect = 'none';
  url = '';
  private server: Server | undefined;
  private subs = new Map<string, DoubleSub>();
  private runs = new Map<string, Array<Record<string, unknown>>>();
  private seq = 0;
  discovery: Record<string, unknown> = { triggerBridge: { status: 'experimental', since: '2.45', witness: 'self', ingestion: { inboundSigning: ['standard-webhooks-1'] }, deadLetter: { retentionDays: 7, maxPageSize: 100 } } };

  async start(): Promise<string> {
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { const s = this.server; if (s) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); } }
  reset(defect: TriggerDefect): void { this.defect = defect; this.subs.clear(); this.runs.clear(); }

  private id(prefix: string): string { return `acme/${prefix}-${String(++this.seq).padStart(16, '0')}`; }
  private send(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
  private async raw(req: IncomingMessage): Promise<string> { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c).toString('utf8'); }

  private startRun(sub: DoubleSub): string {
    const runId = this.id('run');
    const attemptId = `evt${String(++this.seq).padStart(16, '0')}`;
    this.runs.set(runId, [
      { eventId: attemptId, type: 'trigger.delivery-attempted', payload: { subscriptionId: sub.id, dedupKey: 'opaque', attempt: 1, outcome: 'delivered', runId }, sequence: 1 },
      { eventId: `evt${String(++this.seq).padStart(16, '0')}`, type: 'run.started', ...(this.defect === 'no-causation' ? {} : { causationId: attemptId }), payload: {}, sequence: 2 },
    ]);
    return runId;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = new URL(req.url ?? '/', 'http://x');
    const path = u.pathname;
    if (req.method === 'GET' && path === '/.well-known/openwop') return this.send(res, 200, this.discovery);

    if (req.method === 'POST' && path === '/trigger-subscriptions') {
      const body = JSON.parse(await this.raw(req) || '{}') as { verification?: { mode?: string } };
      const n = this.subs.size + 1;
      const sub: DoubleSub = { id: this.id('sub'), n, mode: body.verification?.mode ?? 'none', secret: `whsec_${Buffer.from(`secret-${n}-bytes`).toString('base64')}`, state: 'active', seen: new Map(), dead: [] };
      this.subs.set(sub.id, sub);
      return this.send(res, 201, { subscription: { subscriptionId: sub.id, source: 'webhook', state: 'active' }, binding: { ingestUrl: `${this.url}/ingest/${n}`, signingSecret: sub.secret } });
    }

    const ing = /^\/ingest\/(\d+)$/.exec(path);
    if (req.method === 'POST' && ing) {
      const sub = [...this.subs.values()].find((s) => s.n === Number(ing[1]));
      if (!sub) return this.send(res, 404, { error: 'not_found', message: 'no ingest' });
      const body = await this.raw(req);
      const id = String(req.headers['webhook-id'] ?? ''); const ts = String(req.headers['webhook-timestamp'] ?? '');
      const good = req.headers['webhook-signature'] === standardWebhooksSignature(sub.secret, id, ts, body);
      if (!good && sub.mode === 'required') {
        if (this.defect !== 'refused-not-recorded') {
          const at = Date.now();
          sub.dead.unshift({
            subscriptionId: sub.id, attemptEventId: `evt${String(++this.seq).padStart(16, '0')}`,
            attempt: { subscriptionId: sub.id, dedupKey: 'opaque', attempt: 1, outcome: 'dead-lettered' },
            reason: 'verification_failed',
            deadLetteredAt: new Date(at).toISOString(),
            expiresAt: new Date(at + (this.defect === 'wrong-retention' ? 1 : 7) * 86_400_000).toISOString(),
            ...(this.defect === 'record-leaks-canary' ? { body } : {}),
            ...(this.defect === 'refused-records-state-change' ? { stateChange: { subscriptionId: sub.id, source: 'webhook', fromState: 'active', toState: 'failed', reason: 'signature-invalid' } } : {}),
          });
        }
        if (this.defect === 'refused-changes-state') sub.state = 'failed';
        return this.send(res, 401, { error: 'signature_invalid', message: 'bad signature', ...(this.defect === 'refused-starts-run' ? { runId: this.startRun(sub) } : {}) });
      }
      const prior = sub.seen.get(id);
      if (prior !== undefined && this.defect !== 'dedup-new-run') return this.send(res, 200, { outcome: 'duplicate', runId: prior });
      const runId = this.startRun(sub);
      sub.seen.set(id, runId);
      return this.send(res, 202, { outcome: 'delivered', runId });
    }

    const poll = /^\/runs\/([^/]+)\/events\/poll$/.exec(path);
    if (req.method === 'GET' && poll) {
      const events = this.runs.get(unprojectBoundId(poll[1]!));
      return events ? this.send(res, 200, { events }) : this.send(res, 404, { error: 'not_found', message: 'no run' });
    }

    const m = /^\/trigger-subscriptions\/([^/]+)(\/dead-letters)?$/.exec(path);
    if (req.method === 'GET' && m) {
      const auth = String(req.headers['authorization'] ?? '');
      const sub = this.subs.get(unprojectBoundId(m[1]!));
      const foreign = auth === `Bearer ${OTHER_TENANT_KEY}` && this.defect !== 'tenant-leak';
      if (!sub || foreign) return this.send(res, 404, { error: 'not_found', message: 'no such subscription' });
      if (!m[2]) return this.send(res, 200, { subscription: { subscriptionId: sub.id, source: 'webhook', state: sub.state } });
      const limit = Math.min(Number(u.searchParams.get('limit') ?? '100'), 100);
      const cursor = u.searchParams.get('cursor');
      let offset = 0;
      if (cursor !== null) {
        const [cid, off] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        if (cid !== sub.id && this.defect !== 'cursor-not-bound') return this.send(res, 400, { error: 'validation_error', message: 'cursor is for another subscription' });
        offset = Number(off);
      }
      const size = this.defect === 'limit-ignored' ? sub.dead.length : limit;
      const page = sub.dead.slice(offset, offset + size);
      const next = offset + size < sub.dead.length ? Buffer.from(`${sub.id}|${offset + size}`).toString('base64url') : undefined;
      return this.send(res, 200, { deliveries: page, ...(next ? { nextCursor: next } : {}) });
    }
    return this.send(res, 404, { error: 'not_found', message: `no route ${req.method} ${path}` });
  }
}
