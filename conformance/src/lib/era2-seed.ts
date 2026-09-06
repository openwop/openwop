/**
 * Suite 2.0.0 — the era-`2` event-log seed for the RFC 0176 persisted-data
 * scenarios (`v2-v1-events-translated`, `v2-unmapped-type-refused`,
 * `v2-fork-a-v1-run`, `v2-pinned-run-disposition`).
 *
 * A v2 host reading a run written by a v1 host translates every event through
 * `spec/v2/event-codemap.json` at the storage boundary (persistence.md §The
 * reader rule). To witness that from outside, the suite needs a run whose
 * persisted log is in v1 vocabulary — which only a host that predates the cut
 * has, unless a seam writes one. The seam these scenarios drive (seams-profile
 * gated, RFC 0168 §C):
 *
 *   POST /conformance/seams/sample/event-log/seed
 *     { eventLogSchemaVersion: 2, status, events: [{ type, sequence, payload, timestamp?, causationId? }] }
 *     → 201 { runId }
 *
 * The host MUST persist the rows verbatim (v1 `type` strings, the given
 * `sequence` space, no era stamp — the run reads as era `2` by the absent-⇒-`2`
 * rule) and MUST NOT translate them at write time; the point of the seam is
 * that the read projection does the work. `status` is the snapshot status the
 * seeded run holds (`completed` for a finished log, `running` for a run the
 * pinned-run disposition must decide). The seam is catalogued in
 * `api/seams-v2.yaml` (`seedEra2EventLog`); a host answering `404` /
 * `403` / `405` records `blocked` naming it (never a pass), and a host that
 * answers anything but `201 { runId }` records `blocked` with the status.
 *
 * The scenarios name the seam by its v1-shaped path
 * (`/v1/host/sample/event-log/seed`); under target major 2 the driver rewrites
 * it to the address above (lib/seams.ts).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from './driver.js';
import { loadEnv } from './env.js';
import { seamPath, seamsProfileAdvertised } from './seams.js';
import { readErrorCode } from './error-envelope.js';
import { V1_DIR } from './paths.js';

export const SEED_PATH_V1 = '/v1/host/sample/event-log/seed';
export const SEED_PATH = seamPath(SEED_PATH_V1);

export interface SeedEvent {
  readonly type: string;
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
  readonly timestamp?: string;
  readonly causationId?: string;
}

export interface ReadEvent {
  readonly type?: unknown;
  readonly sequence?: unknown;
  readonly payload?: unknown;
  readonly eventId?: unknown;
  readonly timestamp?: unknown;
  readonly causationId?: unknown;
}

export type Seeded =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly kind: 'blocked' | 'inapplicable' | 'skipped'; readonly reason: string };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** The gate every era-2 scenario applies before touching the seam. */
export function era2Gate(doc: Record<string, unknown> | null): Seeded | null {
  if (!doc) return { ok: false, kind: 'blocked', reason: 'discovery unreachable' };
  if (!seamsProfileAdvertised(doc)) {
    // rc.63: `inapplicable`, not `blocked` — the host never claimed the
    // instrument, so the obligation is out of scope for it (`lib/seams.ts`).
    // rc.62 fixed the fifteen scenarios that call `seamsProfileAdvertised`
    // directly and MISSED this one, which mints the same disposition one call
    // deeper for six scenarios that import only `era2Gate`: era-2-append-
    // vocabulary, fork-a-v1-run, pinned-run-disposition, stream-sse-projection,
    // unmapped-type-refused, v1-events-translated. On MyndHyve's bundle that
    // left 16 rows blocked on advert-absence after rc.62 — the same defect
    // wearing a different import. `blocked` above (discovery unreachable) and
    // below (the seam does not answer) is untouched: those are real failed
    // measurements.
    return { ok: false, kind: 'inapplicable', reason: `seams profile not advertised (conformance.seamsProfile !== openwop-conformance-seams-v2) — an era-2 log can only be seeded through ${SEED_PATH}` };
  }
  return null;
}

/** Seed an era-2 log in v1 vocabulary; the reason names the seam when it is absent. */
export async function seedEra2Log(events: readonly SeedEvent[], status: 'completed' | 'running' | 'paused' = 'completed'): Promise<Seeded> {
  const res = await http(() => driver.post(SEED_PATH_V1, { eventLogSchemaVersion: 2, status, events }));
  if (res === null) return { ok: false, kind: 'blocked', reason: `${SEED_PATH} unreachable (fetch failed)` };
  if (res.status === 404 || res.status === 403 || res.status === 405) {
    return { ok: false, kind: 'blocked', reason: `no seam seeds an era-2 event log — ${SEED_PATH} answered ${res.status} (uncatalogued in api/seams-v2.yaml; the reader rule is seam-gated, RFC 0176 falsifiability §A.3)` };
  }
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') {
    return { ok: false, kind: 'blocked', reason: `${SEED_PATH} answered ${res.status} ${readErrorCode(res.json) ?? ''} without a 201 { runId } — the seed contract is not honoured`.trim() };
  }
  return { ok: true, runId };
}

/** `GET /runs/{runId}/events/poll` under OpenWOP-Version: 2.0 (the driver adds the header). */
export async function pollEvents(runId: string, query = ''): Promise<OpenWOPResponse | null> {
  return http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1${query}`));
}

export function eventsOf(body: unknown): ReadEvent[] {
  const events = (body as { events?: unknown } | undefined)?.events;
  return Array.isArray(events) ? (events as ReadEvent[]) : [];
}

/**
 * `GET /runs/{runId}/events?streamMode=debug` under OpenWOP-Version: 2.0 —
 * `debug` admits every event (events.md §Stream modes), so a `version.pinned`
 * or a vendor row is visible. lib/sse.ts sends no version header, and a
 * header-less request selects the v1 representation (RFC 0172 §A.3), so the
 * stream is read here with the header the scenario is speaking.
 */
export async function streamEvents(runId: string, timeoutMs = 8_000): Promise<{ status: number; events: ReadEvent[] } | null> {
  const env = loadEnv();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.baseUrl}/runs/${encodeURIComponent(runId)}/events?streamMode=debug`, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${env.apiKey}`, 'OpenWOP-Version': '2.0' },
      signal: ctl.signal,
    });
    if (res.status !== 200 || res.body === null) return { status: res.status, events: [] };
    let text = '';
    try { text = await res.text(); } catch (err) { if ((err as { name?: string }).name !== 'AbortError') throw err; }
    const events: ReadEvent[] = [];
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (data.length === 0) continue;
      try {
        const parsed = JSON.parse(data) as unknown;
        for (const e of Array.isArray(parsed) ? parsed : [parsed]) if (e && typeof e === 'object') events.push(e as ReadEvent);
      } catch { /* a keep-alive or a non-JSON frame */ }
    }
    return { status: res.status, events };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return { status: 0, events: [] };
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `POST /runs/{runId}:fork`; null when the request could not be made. */
export async function forkRun(runId: string, body: Record<string, unknown>): Promise<OpenWOPResponse | null> {
  return http(() => driver.post(`/runs/${encodeURIComponent(runId)}:fork`, body));
}

/**
 * The v1→v2 rows the seeds use, taken from `spec/v2/event-codemap.json` when the
 * corpus is present (the published tarball ships the codemap beside the
 * schemas; a layout without it falls back to the same rows spelled here, which
 * is what the codemap says for them — `counts.renamed: 36`).
 */
const FALLBACK: ReadonlyArray<readonly [string, string]> = [
  ['run.started', 'run.started'],
  ['run.completed', 'run.completed'],
  ['run.cancelled', 'run.cancelled'],
  ['version.pinned', 'version.pinned'],
  ['agent.toolCalled', 'agent.tool-called'],
  ['agent.toolReturned', 'agent.tool-returned'],
  ['run.resuming', 'run.resume-started'],
];

let codemap: Map<string, string> | undefined;
export function codemapV1toV2(): Map<string, string> {
  if (codemap) return codemap;
  const m = new Map<string, string>(FALLBACK);
  const candidate = V1_DIR ? join(V1_DIR, '..', 'v2', 'event-codemap.json') : null;
  if (candidate && existsSync(candidate)) {
    try {
      const doc = JSON.parse(readFileSync(candidate, 'utf8')) as { rows?: Array<{ v1?: unknown; v2?: unknown }> };
      for (const r of doc.rows ?? []) if (typeof r.v1 === 'string' && typeof r.v2 === 'string') m.set(r.v1, r.v2);
    } catch { /* the fallback rows stand */ }
  }
  codemap = m;
  return m;
}

/**
 * The registered vendor orgs, from `spec/v2/declaration.json` `extensions`
 * (events.md §Rules; RFC 0171 §A.1). A vendor event type's first segment MUST
 * be a key here, which is what separates "read under its own name unchanged"
 * from "fail the read with `event_type_unmapped`" (persistence.md §The codemap
 * is data / §The era key).
 *
 * `undefined` means the declaration is not on disk in this layout — a scenario
 * that needs the registry MUST record that as a soft-skip rather than guess.
 * There is no fallback list on purpose: a hard-coded org would make the suite
 * the registry, and the whole defect this closes was a rule citing a registry
 * that did not exist.
 */
let orgs: ReadonlySet<string> | null | undefined;
export function registeredOrgs(): ReadonlySet<string> | undefined {
  if (orgs !== undefined) return orgs ?? undefined;
  const candidate = V1_DIR ? join(V1_DIR, '..', 'v2', 'declaration.json') : null;
  orgs = null;
  if (candidate && existsSync(candidate)) {
    try {
      const doc = JSON.parse(readFileSync(candidate, 'utf8')) as { extensions?: Record<string, unknown> };
      if (doc.extensions && typeof doc.extensions === 'object') orgs = new Set(Object.keys(doc.extensions));
    } catch { /* left null: unreadable is indistinguishable from absent, and both are soft-skips */ }
  }
  return orgs ?? undefined;
}

/** A minimal era-2 log in v1 vocabulary: two renamed rows between run.started and run.completed. */
export function v1FixtureLog(workflowId = 'conformance-noop'): SeedEvent[] {
  const t0 = Date.parse('2026-01-15T10:00:00.000Z');
  const ts = (i: number) => new Date(t0 + i * 1000).toISOString();
  return [
    { type: 'run.started', sequence: 0, payload: { workflowId }, timestamp: ts(0) },
    { type: 'agent.toolCalled', sequence: 1, payload: { agentId: 'conformance-agent', toolName: 'echo', callId: 'call-0001' }, timestamp: ts(1) },
    { type: 'agent.toolReturned', sequence: 2, payload: { agentId: 'conformance-agent', toolName: 'echo', callId: 'call-0001', status: 'ok' }, timestamp: ts(2) },
    { type: 'run.completed', sequence: 3, payload: { durationMs: 3000 }, timestamp: ts(3) },
  ];
}

/** The observable part of an event for RFC 0041 §C byte-equivalence: type, sequence, payload (clock fields and minted ids excluded). */
export function observable(e: ReadEvent): string {
  return JSON.stringify({ type: e.type, sequence: e.sequence, payload: canonical(e.payload) });
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}
