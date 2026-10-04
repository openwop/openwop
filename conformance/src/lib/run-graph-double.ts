/**
 * A run-graph double: the smallest HTTP server the wave-2 fixture witnesses
 * (sub-workflow linkage and input mapping, dispatch input mapping, the
 * dispatch loop, provider usage) and the artifact schema-URL witness can be
 * proven against, in both directions.
 *
 * `ScratchHost` plays one run per create. These witnesses follow a parent run
 * to the child it started, read the child's snapshot (`variables`, `inputs`)
 * and its `getRunAncestry` answer, and fetch paths outside the run surface,
 * so this double lets a case script a parent that spawns children, and answer
 * any other GET.
 *
 * It is a test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation. Ids are tenant-bound (`<tenant>/<opaque>`,
 * `ids.schema.json#/$defs/runId`) and accepted `~`-projected or percent-encoded.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { unprojectBoundId } from './bound-id.js';

export interface DoubleEvent {
  readonly type: string;
  /** The envelope's top-level `nodeId`. */
  readonly nodeId?: string | undefined;
  readonly payload?: Record<string, unknown> | undefined;
}
export interface DoubleRun {
  readonly workflowId?: string;
  readonly status: string;
  readonly variables?: Record<string, unknown> | undefined;
  readonly inputs?: Record<string, unknown> | undefined;
  readonly events?: readonly DoubleEvent[];
  /** The `GET /runs/{runId}/ancestry` answer, given the run's own id. Unset: 404. */
  readonly ancestry?: ((self: string) => { readonly status: number; readonly body: unknown }) | undefined;
}
export interface RawAnswer { readonly status: number; readonly headers?: Readonly<Record<string, string>>; readonly body: string }
export interface DoubleOptions {
  readonly discovery: Readonly<Record<string, unknown>>;
  /**
   * The run a create makes. `spawn` stores a further run (a child) and returns
   * its id; `self` is the id the created run will carry. Unset: every create is 404.
   */
  readonly onCreate?: ((workflowId: string, spawn: (run: DoubleRun) => string, self: string) => DoubleRun | undefined) | undefined;
  /** Any other GET, by path. `undefined` is 404. */
  readonly onGet?: ((path: string) => RawAnswer | undefined) | undefined;
}

export const DOUBLE_TENANT = 'tenant-a';

export class RunGraphDouble {
  private server: Server | undefined;
  private readonly runs = new Map<string, DoubleRun>();
  private seq = 0;
  url = '';

  constructor(private opts: DoubleOptions) {}

  /** Swap behaviour between cases. The address stays the same, since the driver caches its base URL per file. */
  reconfigure(next: Partial<DoubleOptions>): void {
    this.opts = { ...this.opts, ...next };
    this.runs.clear();
  }

  get discovery(): Readonly<Record<string, unknown>> { return this.opts.discovery; }

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

  private mint(): string { return `${DOUBLE_TENANT}/run-${String(++this.seq).padStart(16, '0')}`; }

  private send(res: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
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
    if (req.method === 'GET' && path === '/.well-known/openwop') return this.send(res, 200, this.opts.discovery);

    if (req.method === 'POST' && path === '/runs') {
      const workflowId = String((await this.body(req))['workflowId'] ?? '');
      const self = this.mint();
      const run = this.opts.onCreate?.(workflowId, (child) => { const id = this.mint(); this.runs.set(id, child); return id; }, self);
      if (run === undefined) return this.send(res, 404, { error: 'not_found', message: `no workflow ${workflowId}` });
      this.runs.set(self, { workflowId, ...run });
      return this.send(res, 201, { runId: self, status: 'running' });
    }

    const m = /^\/runs\/([^/]+)(\/events\/poll|\/ancestry)?$/.exec(path);
    if (req.method === 'GET' && m) {
      const seg = m[1] as string;
      const id = seg.includes('~') ? unprojectBoundId(seg) : decodeURIComponent(seg);
      const run = this.runs.get(id);
      if (run === undefined) return this.send(res, 404, { error: 'not_found', message: 'no such run' });
      if (m[2] === '/ancestry') {
        const a = run.ancestry?.(id);
        return a === undefined ? this.send(res, 404, { error: 'not_found', message: 'ancestry not served' }) : this.send(res, a.status, a.body);
      }
      if (m[2] === '/events/poll') {
        const events = (run.events ?? []).map((e, i) => ({
          eventId: `e${i + 1}`, runId: id, type: e.type, ...(e.nodeId === undefined ? {} : { nodeId: e.nodeId }),
          payload: e.payload ?? {}, sequence: i + 1, schemaVersion: 2, timestamp: new Date(0).toISOString(),
        }));
        return this.send(res, 200, { events });
      }
      return this.send(res, 200, {
        runId: id, workflowId: run.workflowId ?? 'double', status: run.status,
        ...(run.variables === undefined ? {} : { variables: run.variables }),
        ...(run.inputs === undefined ? {} : { inputs: run.inputs }),
      });
    }

    if (req.method === 'GET') {
      const raw = this.opts.onGet?.(path);
      if (raw !== undefined) {
        res.writeHead(raw.status, { ...(raw.headers ?? {}) });
        res.end(raw.body);
        return;
      }
    }
    return this.send(res, 404, { error: 'not_found', message: 'no such route' });
  }
}
