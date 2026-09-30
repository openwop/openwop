/**
 * RFC 0229 — the production-safe secret witness, shared by `secrets-run-witness`
 * (major 1, `/v1/...`) and `v2-secrets-run-witness` (major 2, unversioned
 * paths under `OpenWOP-Version: 2.0`, which the driver adds).
 *
 * The suite draws a fresh value `C` per run (48 CSPRNG bytes, base64url, 64
 * characters, no fixed prefix) and supplies it as the top-level
 * `runSecrets: [{ ref, value: C }]` of `createRun`. The fixture
 * `openwop-secrets-run-witness` runs one `core.secret.witness` node that
 * compares `sha256(C)` with an `expectedSha256` input and outputs only
 * `{ matched }`. The scans read RAW response text, never parsed JSON, so an
 * escaping difference cannot hide a hit (RFC 0229 Implementation notes).
 *
 * @see spec/v2/core/host-services.md §Run-supplied secrets
 * @see spec/v1/capabilities.md §"Run-supplied secrets"
 * @see RFCS/0229-production-safe-secrets-witness.md
 */

import { createHash, randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from './driver.js';
import { loadEnv } from './env.js';
import { discoveryFamilies } from './discovery-capabilities.js';
import { isFixtureAdvertised } from './fixtures.js';

export const WITNESS_FIXTURE = 'openwop-secrets-run-witness';
export const WITNESS_NODE = 'witness';
export const WITNESS_REF = 'run:openwop-witness';
export const CANARY_NAME = 'openwop-conformance-canary-secret';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export type Major = 1 | 2;
export type Gate =
  | { ok: true; maxEntries: number; branchFork: boolean }
  | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** A fresh witness value: 48 CSPRNG bytes, base64url, 64 characters, no fixed prefix. */
export function freshValue(): string {
  return randomBytes(48).toString('base64url');
}

/** A fresh non-`run:` secret name (the scope leg's "random name"). */
export function freshName(): string {
  return `openwop-witness-${randomBytes(9).toString('hex')}`;
}

/**
 * Every form in which `C` "appears" (RFC 0229 §F row 2): raw; standard and
 * URL-safe base64 of its UTF-8 bytes, padded and not; lower- and upper-case
 * hex of those bytes; percent-encoded; JSON-string-escaped; and `sha256(C)`
 * (lower and upper hex, and base64) — the digest is an output §B.3 forbids.
 */
export function forms(c: string): ReadonlyArray<{ name: string; text: string }> {
  const bytes = Buffer.from(c, 'utf8');
  const b64 = bytes.toString('base64');
  const b64url = bytes.toString('base64url');
  const digest = createHash('sha256').update(bytes).digest();
  const out = [
    { name: 'raw', text: c },
    { name: 'base64', text: b64 },
    { name: 'base64 (unpadded)', text: b64.replace(/=+$/, '') },
    { name: 'base64url', text: b64url },
    { name: 'base64url (padded)', text: b64url + '='.repeat((4 - (b64url.length % 4)) % 4) },
    { name: 'hex', text: bytes.toString('hex') },
    { name: 'HEX', text: bytes.toString('hex').toUpperCase() },
    { name: 'percent-encoded', text: encodeURIComponent(c) },
    { name: 'JSON-escaped', text: JSON.stringify(c).slice(1, -1) },
    { name: 'sha256 hex', text: digest.toString('hex') },
    { name: 'SHA256 HEX', text: digest.toString('hex').toUpperCase() },
    { name: 'sha256 base64', text: digest.toString('base64') },
  ];
  return out.filter((f, i) => out.findIndex((g) => g.text === f.text) === i);
}

/**
 * The forms of `c` that occur in `text`. `digestSupplied`: the suite itself
 * passed `sha256(C)` as the run's `expectedSha256` input, which a host may
 * legitimately echo as an input, so the digest forms are not a leak for that
 * run and are not scanned. They are scanned for every value whose digest the
 * suite never sent (the mismatch run, and the retried value `C′`).
 */
export function hits(text: string, c: string, digestSupplied = false): string[] {
  return forms(c).filter((f) => !(digestSupplied && f.name.toLowerCase().startsWith('sha256'))).filter((f) => text.includes(f.text)).map((f) => f.name);
}

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

export class WitnessHost {
  constructor(readonly major: Major) {}

  private p(path: string): string {
    return this.major === 1 ? `/v1${path}` : path;
  }

  private enc(id: string): string {
    return encodeURIComponent(id);
  }

  async discovery(): Promise<Record<string, unknown> | null> {
    const res = await http(() => driver.get('/.well-known/openwop', { authenticated: false }));
    return res?.status === 200 && res.json && typeof res.json === 'object' ? discoveryFamilies(res.json) : null;
  }

  /**
   * RFC 0229 §F dispositions: facet absent ⇒ `inapplicable` (the host offers
   * no run-supplied secrets); facet advertised without the fixture ⇒ `blocked`
   * (§C requires it). Discovery unreadable ⇒ `blocked`.
   */
  async gate(): Promise<Gate> {
    const doc = await this.discovery();
    if (doc === null) return { ok: false, kind: 'blocked', reason: '/.well-known/openwop did not answer 200 with a JSON body' };
    const secrets = doc['secrets'];
    const rs = secrets && typeof secrets === 'object' ? (secrets as Record<string, unknown>)['runSecrets'] : undefined;
    if (rs === undefined || rs === null || typeof rs !== 'object') {
      return { ok: false, kind: 'inapplicable', reason: 'secrets.runSecrets is not advertised — the host offers no run-supplied secrets (RFC 0229 §D)' };
    }
    if (!isFixtureAdvertised(WITNESS_FIXTURE)) {
      return { ok: false, kind: 'blocked', reason: `secrets.runSecrets is advertised but the fixture ${WITNESS_FIXTURE} is not — RFC 0229 §C requires it, so the witness cannot run` };
    }
    const maxEntries = Number((rs as Record<string, unknown>)['maxEntries']);
    const replay = doc['replay'];
    const modes = replay && typeof replay === 'object' ? (replay as Record<string, unknown>)['modes'] : undefined;
    const supported = this.major === 1 ? (replay as Record<string, unknown> | undefined)?.['supported'] === true : replay !== undefined;
    return { ok: true, maxEntries: Number.isFinite(maxEntries) ? maxEntries : 1, branchFork: supported && Array.isArray(modes) && modes.includes('branch') };
  }

  /** `createRun` of the witness fixture. `runSecrets` is omitted when `undefined`. */
  create(inputs: { ref: string; expectedSha256: string }, runSecrets?: ReadonlyArray<{ ref: string; value: string }>, idempotencyKey?: string): Promise<OpenWOPResponse | null> {
    const body: Record<string, unknown> = { workflowId: WITNESS_FIXTURE, inputs };
    if (runSecrets !== undefined) body['runSecrets'] = runSecrets;
    return http(() => driver.post(this.p('/runs'), body, idempotencyKey === undefined ? {} : { headers: { 'Idempotency-Key': idempotencyKey } }));
  }

  async snapshot(runId: string): Promise<OpenWOPResponse | null> {
    return http(() => driver.get(this.p(`/runs/${this.enc(runId)}`)));
  }

  async waitTerminal(runId: string, timeoutMs = 20_000): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await this.snapshot(runId);
      const snap = res?.status === 200 && res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : null;
      if (snap !== null && TERMINAL.has(String(snap['status']))) return snap;
      if (Date.now() > deadline) return snap;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async events(runId: string): Promise<{ text: string; events: Array<Record<string, unknown>> }> {
    const res = await http(() => driver.get(this.p(`/runs/${this.enc(runId)}/events/poll?timeout=1`)));
    let events: Array<Record<string, unknown>> = [];
    const body = res?.json as { events?: unknown } | undefined;
    if (Array.isArray(body?.events)) events = body.events as Array<Record<string, unknown>>;
    if (events.length === 0 && this.major === 1) {
      const alt = await http(() => driver.get(this.p(`/runs/${this.enc(runId)}/events`)));
      const b = alt?.json as { events?: unknown } | undefined;
      if (Array.isArray(b?.events)) return { text: `${res?.text ?? ''}\n${alt?.text ?? ''}`, events: b.events as Array<Record<string, unknown>> };
    }
    return { text: res?.text ?? '', events };
  }

  /** The raw SSE text under `streamMode=debug` — the most verbose mode (events.md §Stream modes). */
  async debugStream(runId: string, timeoutMs = 6_000): Promise<string> {
    const env = loadEnv();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${env.baseUrl}${this.p(`/runs/${this.enc(runId)}/events`)}?streamMode=debug`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${env.apiKey}`, ...(this.major === 2 ? { 'OpenWOP-Version': '2.0' } : {}) },
        signal: ctl.signal,
      });
      if (res.body === null) return '';
      try { return await res.text(); } catch { return ''; }
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Every readable surface of a terminal run, as raw text: the create answer,
   * the snapshot, the polled events, the `debug` stream, the run list (where
   * served), and the debug bundle (where the seam serves one).
   */
  async surfaces(runId: string, extra: readonly string[] = []): Promise<{ text: string; read: string[] }> {
    const read: string[] = [];
    const parts: string[] = [...extra];
    if (extra.length > 0) read.push('createRun response');
    const snap = await this.snapshot(runId);
    if (snap !== null) { parts.push(snap.text); read.push('snapshot'); }
    const ev = await this.events(runId);
    parts.push(ev.text); read.push('events (poll)');
    const dbg = await this.debugStream(runId);
    if (dbg.length > 0) { parts.push(dbg); read.push('events (streamMode=debug)'); }
    const list = await http(() => driver.get(this.p('/runs?limit=50')));
    if (list?.status === 200) { parts.push(list.text); read.push('listRuns'); }
    const bundle = await http(() => driver.post('/v1/host/sample/test/debug-bundle/export', { runId }));
    if (bundle?.status === 200) { parts.push(bundle.text); read.push('debug bundle'); }
    return { text: parts.join('\n'), read };
  }

  /** `witness`'s `matched`, from `node.completed` outputs or the snapshot; `undefined` when not observable. */
  async matched(runId: string, snap: Record<string, unknown> | null): Promise<boolean | undefined> {
    const { events } = await this.events(runId);
    for (const e of events) {
      if (e['type'] !== 'node.completed') continue;
      const payload = (e['payload'] ?? e['data'] ?? {}) as Record<string, unknown>;
      if ((payload['nodeId'] ?? e['nodeId']) !== WITNESS_NODE) continue;
      const outputs = (payload['outputs'] ?? e['outputs']) as Record<string, unknown> | undefined;
      if (typeof outputs?.['matched'] === 'boolean') return outputs['matched'] as boolean;
    }
    for (const key of ['outputs', 'variables', 'nodeOutputs']) {
      const bag = snap?.[key] as Record<string, unknown> | undefined;
      const node = bag?.[WITNESS_NODE] as Record<string, unknown> | undefined;
      if (typeof node?.['matched'] === 'boolean') return node['matched'] as boolean;
    }
    return undefined;
  }

  /** `witness`'s `node.failed` error code; `null` when no `node.failed` names it. */
  async nodeFailedCode(runId: string): Promise<string | null> {
    const { events } = await this.events(runId);
    for (const e of events) {
      if (e['type'] !== 'node.failed') continue;
      const payload = (e['payload'] ?? e['data'] ?? {}) as Record<string, unknown>;
      if ((payload['nodeId'] ?? e['nodeId']) !== WITNESS_NODE) continue;
      const err = (payload['error'] ?? e['error']) as Record<string, unknown> | undefined;
      return typeof err?.['code'] === 'string' ? (err['code'] as string) : '';
    }
    return null;
  }

  fork(runId: string): Promise<OpenWOPResponse | null> {
    return http(() => driver.post(this.p(`/runs/${this.enc(runId)}:fork`), { mode: 'branch', fromSeq: 0 }));
  }
}
