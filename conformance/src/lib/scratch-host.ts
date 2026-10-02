/**
 * A scratch host: the smallest HTTP server a shared witness can be proven
 * against, in both directions, inside the suite's own self-tests.
 *
 * Some families are advertised by no reference host, so a new witness for them
 * cannot be sabotage-proved against a real one. A witness that was never seen
 * to fail is not a witness. The scratch host serves a discovery document and a
 * scripted run surface, and each self-test turns on ONE defect to show the
 * witness convicts it.
 *
 * It is a test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation. It takes a {@link MajorProfile}, so the
 * same double proves the next major's port.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MajorProfile } from './major-profile.js';

export interface ScriptedEvent { readonly type: string; readonly payload?: Record<string, unknown> | undefined }
export interface ScriptedRun {
  readonly status: 'completed' | 'failed' | 'running';
  readonly error?: { readonly code: string; readonly message: string };
  readonly events: readonly ScriptedEvent[];
}
export interface ScratchRefusal {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}
export interface ScratchOptions {
  readonly profile: MajorProfile;
  /** The discovery document, served as given. */
  readonly discovery: Readonly<Record<string, unknown>>;
  /** What a created run looks like, by workflowId and request body. Default: an empty running run. */
  readonly script?: ((workflowId: string, body: Readonly<Record<string, unknown>>) => ScriptedRun) | undefined;
  /** Concurrent in-flight requests admitted before {@link refusal} answers. Unset: no cap. */
  readonly inflightCap?: number | undefined;
  readonly refusal?: ScratchRefusal | undefined;
  /** Refuse a create by its body. `undefined` admits it. Unset: every create is admitted. */
  readonly createRefusal?: ((workflowId: string, body: Readonly<Record<string, unknown>>) => ScratchRefusal | undefined) | undefined;
}

interface StoredRun { readonly id: string; run: ScriptedRun }

export class ScratchHost {
  private server: Server | undefined;
  private readonly runs = new Map<string, StoredRun>();
  private inflight = 0;
  private seq = 0;
  url = '';

  constructor(private opts: ScratchOptions) {}

  /** Swap behaviour between cases. The address stays the same, since the driver caches its base URL per file. */
  reconfigure(next: Partial<ScratchOptions>): void {
    this.opts = { ...this.opts, ...next };
    this.runs.clear();
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (s === undefined) return;
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch { return {}; }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const runs = this.opts.profile.runsPath;
    // Discovery is never counted against the cap.
    if (req.method === 'GET' && path === '/.well-known/openwop') return this.send(res, 200, this.opts.discovery);

    const cap = this.opts.inflightCap;
    if (cap !== undefined && this.inflight >= cap) {
      const r = this.opts.refusal ?? { status: 503, headers: { 'retry-after': '1' }, body: { error: 'service_unavailable', message: 'at capacity' } };
      return this.send(res, r.status, r.body, r.headers);
    }
    this.inflight++;
    res.on('close', () => { this.inflight--; });

    if (req.method === 'POST' && path === runs) {
      const body = await this.body(req);
      const workflowId = String(body['workflowId'] ?? '');
      const refused = this.opts.createRefusal?.(workflowId, body);
      if (refused !== undefined) return this.send(res, refused.status, refused.body, refused.headers);
      const id = `scratch/run-${++this.seq}`;
      this.runs.set(id, { id, run: this.opts.script?.(workflowId, body) ?? { status: 'running', events: [] } });
      return this.send(res, 201, { runId: id, status: 'running' });
    }
    if (req.method === 'POST' && path === `${runs}:bulk-cancel`) return this.send(res, 200, { results: [] });

    const m = new RegExp(`^${runs}/([^/]+)(/events/poll|/events|/cancel)?$`).exec(path);
    const stored = m ? this.runs.get(decodeURIComponent(m[1] as string)) : undefined;
    if (!m || stored === undefined) return this.send(res, 404, { error: 'not_found', message: 'no such route or run' });
    const tail = m[2];
    if (tail === '/cancel') return this.send(res, 200, { status: 'cancelled' });
    if (tail === '/events') {
      // Held open until the client aborts: this is what occupies a slot.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': held\n\n');
      return;
    }
    if (tail === '/events/poll') {
      const after = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('afterSequence') ?? '0');
      const events = stored.run.events
        .map((e, i) => ({ eventId: `e${i + 1}`, runId: stored.id, type: e.type, payload: e.payload ?? {}, sequence: i + 1, schemaVersion: 2, timestamp: new Date(0).toISOString() }))
        .filter((e) => e.sequence > after);
      return this.send(res, 200, { events });
    }
    return this.send(res, 200, { runId: stored.id, workflowId: 'scratch', status: stored.run.status, ...(stored.run.error === undefined ? {} : { error: stored.run.error }) });
  }
}
