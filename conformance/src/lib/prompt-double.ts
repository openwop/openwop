/**
 * A scratch double for the prompt surface at major 2: the `/prompts*`
 * operations (`host-services.md` §`prompts` → §Library) and a run surface that
 * plays the two prompt fixtures' event logs (`agent.prompt-resolved`,
 * `prompt.composed`). Each self-test turns on ONE defect to show
 * `prompt-library-witness.ts` or `prompt-events-witness.ts` convicts it; a
 * standalone instance lets the scenario files run against it.
 *
 * A test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { unprojectBoundId } from './bound-id.js';
import { ALL_FOUR_FIXTURE, ALL_FOUR_REFS, END_TO_END_FIXTURE, END_TO_END_NODE, END_TO_END_REF } from './prompt-events-witness.js';
import { REFERENCE_PACK } from './prompt-library-witness.js';

export type PromptDefect =
  // library
  | 'none' | 'list-invalid-item' | 'filter-ignored' | 'no-etag' | 'etag-no-304' | 'unknown-200' | 'unknown-nested-envelope' | 'gate-off-serves'
  | 'create-no-location' | 'source-not-user' | 'dup-accepted' | 'update-not-stored' | 'non-monotonic-accepted' | 'delete-not-gone'
  | 'builtin-deletable' | 'writes-unauthenticated' | 'mutable-gate-off-serves'
  | 'render-nondeterministic' | 'render-ignores-vars' | 'render-bad-hash' | 'render-leaks-body' | 'render-unbound-ok'
  | 'pack-unstamped' | 'reference-pack-404'
  // events
  | 'composed-before-resolved' | 'missing-few-shot-2' | 'chain-two-applied' | 'chain-source-mismatch' | 'v1-event-name'
  | 'body-under-hashed' | 'bad-hash' | 'wrong-layer';

export const API_KEY = 'k';
type Tpl = Record<string, unknown> & { templateId: string; version: string; kind: string; text: string; meta?: Record<string, unknown> };

const sha = (s: string): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const input = (name: string, required = true): Record<string, unknown> => ({ name, type: 'string', required, source: 'input' });

function seed(defect: PromptDefect): Tpl[] {
  const pack = (templateId: string): Tpl => ({ templateId, version: '1.0.0', kind: 'system', text: `${templateId} body`, meta: { source: 'pack', packName: REFERENCE_PACK, ...(defect === 'pack-unstamped' ? {} : { packVersion: '1.0.0' }) } });
  return [
    { templateId: 'conformance.prompt.writer-system', version: '1.0.0', kind: 'system', text: 'You are a writer. Topic: {{topic}}', variables: [input('topic'), input('tone', false)], meta: { source: 'host' } },
    { templateId: 'conformance.prompt.few-shot', version: '1.0.0', kind: 'few-shot', text: 'Example about {{topic}}', variables: [input('topic')], meta: { source: 'host' } },
    { templateId: 'conformance.prompt.secret-only', version: '1.0.0', kind: 'user', text: 'Key {{key}}', variables: [{ name: 'key', type: 'string', required: true, source: 'secret' }], meta: { source: 'host' } },
    pack('writer-system'),
    pack('critic-system'),
  ];
}

export class PromptDouble {
  defect: PromptDefect = 'none';
  url = '';
  private server: Server | undefined;
  private store: Tpl[] = seed('none');
  private renders = 0;
  private runs = new Map<string, string>();
  private seq = 0;
  discovery: Record<string, unknown> = PromptDouble.adverts();

  static adverts(facets: Record<string, unknown> = {}): Record<string, unknown> {
    return { prompts: { status: 'stable', since: '2.0', witness: 'witnessable-gated', endpointsSupported: true, mutableLibrary: true, packsSupported: true, observability: 'hashed', ...facets } };
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => { void this.handle(req, res); });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { const s = this.server; if (s) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); } }
  reset(defect: PromptDefect, discovery: Record<string, unknown> = PromptDouble.adverts()): void {
    this.defect = defect; this.discovery = discovery; this.store = seed(defect); this.renders = 0; this.runs.clear();
  }

  private facet(k: string): unknown { return (this.discovery['prompts'] as Record<string, unknown> | undefined)?.[k]; }
  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  private notFound(res: ServerResponse, what: string): void {
    if (this.defect === 'unknown-nested-envelope') return this.send(res, 404, { error: { code: 'not_found', message: what } });
    this.send(res, 404, { error: 'not_found', message: what });
  }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer);
    try { const v: unknown = JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; }
  }
  private latest(id: string, library?: string): Tpl | undefined {
    return this.store.filter((t) => t.templateId === id && (library === undefined || t.meta?.['packName'] === library))
      .sort((x, y) => y.version.localeCompare(x.version, undefined, { numeric: true }))[0];
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = new URL(req.url ?? '/', 'http://x');
    const path = u.pathname;
    const authed = req.headers['authorization'] === `Bearer ${API_KEY}`;
    if (req.method === 'GET' && path === '/.well-known/openwop') return this.send(res, 200, this.discovery);

    if (path.startsWith('/runs')) return this.handleRuns(req, res, path);

    if (!path.startsWith('/prompts')) return this.notFound(res, `no route ${req.method} ${path}`);
    const endpoints = this.facet('endpointsSupported') === true;
    const mutable = endpoints && this.facet('mutableLibrary') === true;
    const write = req.method !== 'GET' && path !== '/prompts:render';
    if (!endpoints && this.defect !== 'gate-off-serves') return this.send(res, 404, { error: 'not_found', message: 'prompts endpoints are not served' });
    if (write && !mutable && this.defect !== 'mutable-gate-off-serves') return this.send(res, 404, { error: 'not_found', message: 'the prompt library is not mutable' });
    if (write && !authed && this.defect !== 'writes-unauthenticated') return this.send(res, 401, { error: 'unauthenticated', message: 'credential required' });

    if (path === '/prompts:render' && req.method === 'POST') return this.render(res, await this.body(req));

    if (path === '/prompts') {
      if (req.method === 'GET') {
        const kind = u.searchParams.get('kind'); const source = u.searchParams.get('source');
        const limit = Number(u.searchParams.get('limit') ?? '50');
        const filter = this.defect !== 'filter-ignored';
        let items: Record<string, unknown>[] = this.store.filter((t) => !filter || ((kind === null || t.kind === kind) && (source === null || t.meta?.['source'] === source)));
        if (this.defect === 'list-invalid-item' && kind === null && source === null) items = [...items, { templateId: 'conformance.broken', version: '1.0.0', kind: 'user', meta: { source: 'user' } }];
        return this.send(res, 200, { items: items.slice(0, limit) });
      }
      if (req.method === 'POST') {
        const b = await this.body(req) as Tpl;
        if (this.store.some((t) => t.templateId === b.templateId && t.version === b.version)) {
          if (this.defect === 'dup-accepted') return this.send(res, 201, undefined, { location: `/prompts/${b.templateId}` });
          return this.send(res, 409, { error: 'conflict', message: 'duplicate (templateId, version)' });
        }
        this.store.push({ ...b, meta: { source: this.defect === 'source-not-user' ? 'host' : 'user' } });
        return this.send(res, 201, undefined, this.defect === 'create-no-location' ? {} : { location: `/prompts/${b.templateId}` });
      }
    }

    const m = /^\/prompts\/([^/]+)$/.exec(path);
    if (!m) return this.notFound(res, `no route ${req.method} ${path}`);
    const id = unprojectBoundId(m[1]!);
    const t = this.latest(id, u.searchParams.get('libraryId') ?? undefined);
    if (req.method === 'GET') {
      if (t === undefined) return this.defect === 'unknown-200' ? this.send(res, 200, { templateId: id }) : this.notFound(res, `no template ${id}`);
      if (this.defect === 'reference-pack-404' && t.meta?.['source'] === 'pack') return this.notFound(res, `no template ${id}`);
      const etag = `"${sha(JSON.stringify(t)).slice(7, 39)}"`;
      if (this.defect !== 'etag-no-304' && req.headers['if-none-match'] === etag) return this.send(res, 304, undefined);
      return this.send(res, 200, t, this.defect === 'no-etag' ? {} : { etag, 'cache-control': 'max-age=60' });
    }
    if (t === undefined) return this.notFound(res, `no template ${id}`);
    // Read-only by origin (seeded built-in or pack), not by the stamp a defect may have changed.
    const builtin = seed('none').some((x) => x.templateId === t.templateId && x.version === t.version);
    if (builtin && this.defect !== 'builtin-deletable') return this.send(res, 403, { error: 'forbidden', message: 'built-in and pack templates are read-only' });
    if (req.method === 'PUT') {
      const b = await this.body(req) as Tpl;
      if (b.version.localeCompare(t.version, undefined, { numeric: true }) <= 0 && this.defect !== 'non-monotonic-accepted') return this.send(res, 409, { error: 'conflict', message: 'version must increase' });
      if (this.defect !== 'update-not-stored') this.store.push({ ...b, meta: { source: 'user' } });
      return this.send(res, 200, b);
    }
    if (req.method === 'DELETE') {
      if (this.defect !== 'delete-not-gone') this.store = this.store.filter((x) => x.templateId !== id);
      return this.send(res, 204, undefined);
    }
    return this.notFound(res, `no route ${req.method} ${path}`);
  }

  private render(res: ServerResponse, b: Record<string, unknown>): void {
    const m = /^prompt:([^@]+)(?:@(.+))?$/.exec(String(b['ref']));
    const t = m ? this.store.find((x) => x.templateId === m[1] && (m[2] === undefined || x.version === m[2])) : undefined;
    if (t === undefined) return this.send(res, 400, { error: 'validation_error', message: 'unresolvable ref' });
    const vars = (b['variables'] ?? {}) as Record<string, unknown>;
    const declared = (t['variables'] as Array<{ name: string; required: boolean }> | undefined) ?? [];
    const unbound = declared.find((v) => v.required && vars[v.name] === undefined);
    if (unbound && this.defect !== 'render-unbound-ok') return this.send(res, 400, { error: 'validation_error', message: `required variable ${unbound.name} unbound` });
    const composed = t.text.replace(/\{\{(\w+)\}\}/g, (_m, n: string) => (this.defect === 'render-ignores-vars' ? '' : String(vars[n] ?? '')));
    const variableHashes = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, sha(this.defect === 'render-ignores-vars' ? '' : String(v))]));
    let hash = sha(this.defect === 'render-nondeterministic' ? `${composed}#${++this.renders}` : composed);
    if (this.defect === 'render-bad-hash') hash = hash.toUpperCase();
    const full = this.facet('observability') === 'full' || this.defect === 'render-leaks-body';
    return this.send(res, 200, { hash, refs: [String(b['ref'])], variableHashes, contentTrust: 'trusted', ...(full ? { composed } : {}) });
  }

  // ── run surface: the two prompt fixtures ─────────────────────────────────
  private events(fixture: string): Array<Record<string, unknown>> {
    const d = this.defect;
    const resolvedType = d === 'v1-event-name' ? 'agent.promptResolved' : 'agent.prompt-resolved';
    const obs = this.facet('observability');
    const out: Array<Record<string, unknown>> = [];
    const pair = (nodeId: string, kind: string, ref: string, compKind: string): void => {
      const chain: Array<Record<string, unknown>> = [
        { layer: d === 'wrong-layer' ? 'host-defaults' : 'node', source: d === 'chain-source-mismatch' ? 'prompt:other@9.9.9' : ref, applied: true },
        { layer: 'workflow-defaults', applied: d === 'chain-two-applied', reason: 'superseded by node-config layer' },
        { layer: 'host-defaults', applied: false, reason: 'no candidate at this layer' },
      ];
      const resolved = { type: resolvedType, nodeId, payload: { nodeId, kind, chain, resolved: ref } };
      const body = `composed ${ref}`;
      const showBody = obs === 'full' || d === 'body-under-hashed';
      const composed = { type: 'prompt.composed', nodeId, payload: { nodeId, refs: [ref], kind: compKind, hash: d === 'bad-hash' ? 'sha256:abc' : sha(body), variableHashes: {}, ...(showBody ? { composed: body, ...(compKind === 'system-only' ? { systemPrompt: body } : {}) } : {}) } };
      const emitComposed = obs !== 'off' || d === 'body-under-hashed';
      out.push(...(d === 'composed-before-resolved' ? [...(emitComposed ? [composed] : []), resolved] : [resolved, ...(emitComposed ? [composed] : [])]));
    };
    if (fixture === END_TO_END_FIXTURE) pair(END_TO_END_NODE, 'system', END_TO_END_REF, 'system-only');
    if (fixture === ALL_FOUR_FIXTURE) {
      const kinds = ['system', 'user', 'schema-hint', 'few-shot', 'few-shot'];
      ALL_FOUR_REFS.forEach((ref, i) => pair('all-kinds', kinds[i]!, d === 'missing-few-shot-2' && i === 4 ? ALL_FOUR_REFS[3] : ref, 'system+user'));
    }
    return [{ type: 'run.started', payload: {} }, ...out, { type: 'run.completed', payload: { outputs: {} } }]
      .map((e, i) => ({ eventId: `evt${String(i + 1).padStart(16, '0')}`, sequence: i + 1, schemaVersion: 2, timestamp: new Date(0).toISOString(), ...e }));
  }

  private async handleRuns(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.method === 'POST' && path === '/runs') {
      const b = await this.body(req);
      const wf = String(b['workflowId']);
      if (wf !== ALL_FOUR_FIXTURE && wf !== END_TO_END_FIXTURE) return this.send(res, 404, { error: 'not_found', message: `no workflow ${wf}` });
      const runId = `acme/run-${String(++this.seq).padStart(16, '0')}`;
      this.runs.set(runId, wf);
      return this.send(res, 201, { runId, status: 'running' });
    }
    const m = /^\/runs\/([^/]+)(\/events\/poll)?$/.exec(path);
    const runId = m ? unprojectBoundId(m[1]!) : '';
    const wf = this.runs.get(runId);
    if (!m || wf === undefined) return this.send(res, 404, { error: 'not_found', message: 'no such run' });
    if (m[2]) return this.send(res, 200, { events: this.events(wf).map((e) => ({ ...e, runId })) });
    return this.send(res, 200, { runId, workflowId: wf, status: 'completed' });
  }
}
