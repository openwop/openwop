/**
 * `spec/v2/core/host-services.md` §`httpClient` — the SSRF guard REFUSES, on
 * the resolved address (target major 2; gated on `httpClient.safeFetch` + the
 * `conformance-safefetch-probe` fixture).
 *
 * The rule: "Before connecting it MUST resolve the target, reject loopback,
 * RFC 1918, link-local and cloud-metadata addresses, and pin the resolved
 * address for the connection (invariant `http-client-ssrf-guard`). A refused
 * target is `egress_denied`, `reason: ssrf-blocked`; an unreachable one,
 * `upstream_unavailable`." And for `safeFetch`: it "MUST apply that guard".
 *
 * Until this file the guard had no refusal witness at any major that a
 * production host could run: `http-client-ssrf` (major 1) asserts only the
 * `ssrfGuard: true` advertisement, and `safefetch-behavior` drives a v1 seam.
 *
 * No seam. Each probe runs the `conformance-safefetch-probe` fixture through
 * `POST /runs`; its node calls the host's own `ctx.http.safeFetch(url)` and
 * passes a rejection through as `node.failed`, code and details unchanged
 * (conformance/fixtures.md §"The safeFetch probe fixture"). One `it` and one
 * requirement id per address class the sentence names, so a failure names its
 * class:
 *
 *   loopback      127.0.0.1, [::1]
 *   RFC 1918      10.0.0.1, 172.16.0.1, 192.168.0.1
 *   link-local /  169.254.169.254 (the cloud-metadata address), 169.254.0.1,
 *   metadata      [fe80::1]
 *   spellings     the same loopback / metadata / RFC 1918 addresses written as
 *                 a URL parser or getaddrinfo also reads them: decimal
 *                 (2130706433), octal (0177.0.0.1), short (127.1), and
 *                 IPv4-mapped IPv6 in hex ([::ffff:7f00:1], [::ffff:a9fe:a9fe],
 *                 [::ffff:a00:1]). They ARE those addresses, so the same
 *                 obligation applies; nothing beyond the sentence is asserted.
 *   resolved      `localhost`, a NAME the host must resolve before it can
 *   name          judge it — a guard that checks only the literal string lets
 *                 it connect (the sabotage the coverage report names).
 *
 * Every probe MUST end `failed` with `egress_denied` and `details.reason:
 * ssrf-blocked`. The loopback-reaching probes target a listener the suite
 * opens on its own loopback, with a per-run nonce in the path; when the host
 * runs on the suite's machine, a guard that connects first (or not at all) is
 * seen arriving there, and the "before connecting" half is asserted directly.
 * Against a remote host that listener is unreachable by construction and the
 * refusal code alone carries the leg.
 *
 * Not asserted, deliberately: a redirect to a private address (a public
 * redirector would need a tunnel, and the sentence does not say whether
 * safeFetch follows redirects), `0.0.0.0` and IPv6 ULA (not in the
 * sentence's list for httpClient), and names that resolve only on some
 * clouds (`metadata.google.internal` is unresolvable off GCP, where a correct
 * host answers `upstream_unavailable`).
 *
 * Dispositions: v2 root unreachable ⇒ `blocked`. `httpClient` absent, or
 * present without `safeFetch` ⇒ `inapplicable` (pack code has no egress to
 * guard). Fixture not advertised ⇒ `inapplicable`: safeFetch has no protocol
 * path, so the fixture is the only observation, and the host does not claim
 * it (the `v2-memory-cross-tenant-isolation` / `v2-queue-cross-tenant-isolation`
 * precedent). A fixture run that cannot be created or does not settle ⇒
 * `blocked`.
 *
 * Sabotage (patched local v2 reference host): a guard that checks only a
 * literal IP fails the resolved-name leg; a regex deny list on the hostname
 * fails the spellings and link-local legs; no guard fails every leg; a guard
 * that connects first and refuses after fails the loopback leg on the
 * listener; a refusal coded `forbidden` fails every leg on the code.
 *
 * @see spec/v2/core/host-services.md §httpClient
 * @see SECURITY/invariants.yaml id: http-client-ssrf-guard
 * @see conformance/fixtures.md §"The safeFetch probe fixture"
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-safefetch-probe';
const NODE_ID = 'safefetch-probe';
const DOC = 'spec/v2/core/host-services.md §httpClient';
const ID_LOOPBACK = 'openwop.requirement.httpClient.ssrf-loopback-refused';
const ID_PRIVATE = 'openwop.requirement.httpClient.ssrf-rfc1918-refused';
const ID_LINK_LOCAL = 'openwop.requirement.httpClient.ssrf-link-local-metadata-refused';
const ID_SPELLING = 'openwop.requirement.httpClient.ssrf-address-spellings-refused';
const ID_RESOLVED = 'openwop.requirement.httpClient.ssrf-resolved-name-refused';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const NONCE = randomUUID().replace(/-/g, '');

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

// ── The suite's own loopback listener: any request carrying NONCE is a connection the guard let through. ──
let listener: Server | null = null;
let port = 0;
const arrivals: string[] = [];
beforeAll(async () => {
  const s = createServer((rq, rs) => { arrivals.push(`${rq.method ?? ''} ${rq.url ?? ''}`); rs.writeHead(200, { 'content-type': 'text/plain' }); rs.end('openwop-ssrf-probe'); });
  // `::` with dual-stack takes 127.0.0.1 and ::1 alike; fall back to IPv4 loopback where IPv6 is off.
  const bound = await new Promise<boolean>((res) => { s.once('error', () => res(false)); s.listen({ host: '::', port: 0, ipv6Only: false }, () => res(true)); });
  if (!bound) await new Promise<void>((res, rej) => { s.removeAllListeners('error'); s.once('error', rej); s.listen({ host: '127.0.0.1', port: 0 }, () => res()); });
  listener = s; port = (s.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((res) => (listener ? listener.close(() => res()) : res())); });
const reached = (tag: string): string[] => arrivals.filter((a) => a.includes(`${NONCE}/${tag}/`));
const path = (tag: string): string => `/openwop-ssrf-probe/${NONCE}/${tag}`;

interface Outcome { readonly url: string; readonly status: string; readonly code: string | null; readonly detailReason: unknown }

/** Run the probe fixture for one URL and read the node's terminal event. */
async function probe(url: string): Promise<Outcome | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: { url } }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | null)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture run was refused`.trim() };
  const t0 = Date.now(); let status = '';
  while (Date.now() - t0 < 60_000) {
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = String((snap?.json as { status?: unknown } | null)?.status ?? '');
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!TERMINAL.has(status)) return { reason: `the ${FIXTURE} run for ${url} did not reach a terminal status within 60 s (last: ${status || 'unreadable'})` };
  const ev = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (ev?.json as { events?: unknown } | null)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return { reason: `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'}` };
  const failed = (events as Array<{ type?: unknown; payload?: Record<string, unknown> }>).find((e) => e.type === 'node.failed' && e.payload?.['nodeId'] === NODE_ID)?.payload;
  const error = (failed?.['error'] ?? null) as { code?: unknown; details?: { reason?: unknown } } | null;
  return { url, status, code: typeof error?.code === 'string' ? error.code : null, detailReason: error?.details?.reason };
}

/** The gate, then every probe of one class; or the recorded reason the leg cannot run. */
async function leg(urls: readonly string[]): Promise<Outcome[] | { skip: ['inapplicable' | 'blocked', string] }> {
  if (!(await v2Discovery().catch(() => null))) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'] };
  const hc = await familyAdvertised('httpClient');
  if (!hc) return { skip: ['inapplicable', 'httpClient is not advertised in the v2 discovery root — the host has no outbound client to guard'] };
  if (!hc['safeFetch'] || typeof hc['safeFetch'] !== 'object') return { skip: ['inapplicable', 'httpClient.safeFetch is not advertised — pack code has no ctx.http.safeFetch, so there is no pack-driven egress to observe'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['inapplicable', `fixture ${FIXTURE} is not advertised — safeFetch has no protocol path, and the host does not claim the fixture that observes it`] };
  if (listener === null) return { skip: ['blocked', 'the suite could not open its loopback listener'] };
  const out = await Promise.all(urls.map((u) => probe(u)));
  const bad = out.find((o): o is { reason: string } => !('url' in o));
  if (bad) return { skip: ['blocked', bad.reason] };
  return out as Outcome[];
}

const describeOutcome = (o: Outcome): string => `${o.url} → ${o.status}${o.code ? ` ${o.code}` : ''}${o.detailReason !== undefined ? ` (reason ${JSON.stringify(o.detailReason)})` : ''}`;

function assertRefused(id: string, cls: string, outcomes: readonly Outcome[]): void {
  const notRefused = outcomes.filter((o) => o.status !== 'failed' || o.code !== 'egress_denied');
  expect(notRefused.map(describeOutcome), req(id, DOC, `safeFetch MUST refuse a ${cls} target as egress_denied — these were not`)).toEqual([]);
  const wrongReason = outcomes.filter((o) => o.detailReason !== 'ssrf-blocked');
  expect(wrongReason.map(describeOutcome), req(id, DOC, `a refused ${cls} target carries details.reason: ssrf-blocked`)).toEqual([]);
}

describe('v2 safeFetch SSRF guard (host-services.md §httpClient)', () => {
  it('a loopback target is refused egress_denied, ssrf-blocked, before any connection', async () => {
    const r = await leg([`http://127.0.0.1:${port}${path('loopback')}/v4`, `http://[::1]:${port}${path('loopback')}/v6`]);
    if ('skip' in r) return softSkip(...r.skip);
    assertRefused(ID_LOOPBACK, 'loopback', r);
    expect(reached('loopback'), req(ID_LOOPBACK, DOC, 'the guard MUST refuse BEFORE connecting — these probe requests reached the suite\'s loopback listener')).toEqual([]);
  }, 120_000);

  it('an RFC 1918 target is refused egress_denied, ssrf-blocked', async () => {
    const r = await leg(['http://10.0.0.1/openwop-ssrf-probe', 'http://172.16.0.1/openwop-ssrf-probe', 'http://192.168.0.1/openwop-ssrf-probe']);
    if ('skip' in r) return softSkip(...r.skip);
    assertRefused(ID_PRIVATE, 'RFC 1918', r);
  }, 120_000);

  it('a link-local or cloud-metadata target is refused egress_denied, ssrf-blocked', async () => {
    const r = await leg(['http://169.254.169.254/latest/meta-data/', 'http://169.254.0.1/openwop-ssrf-probe', 'http://[fe80::1]/openwop-ssrf-probe']);
    if ('skip' in r) return softSkip(...r.skip);
    assertRefused(ID_LINK_LOCAL, 'link-local / cloud-metadata', r);
  }, 120_000);

  it('the same addresses in decimal, octal, short and IPv4-mapped IPv6 spellings are refused', async () => {
    const r = await leg([
      `http://2130706433:${port}${path('spelling')}/decimal`,
      `http://0177.0.0.1:${port}${path('spelling')}/octal`,
      `http://127.1:${port}${path('spelling')}/short`,
      `http://[::ffff:7f00:1]:${port}${path('spelling')}/mapped`,
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[::ffff:a00:1]/openwop-ssrf-probe',
    ]);
    if ('skip' in r) return softSkip(...r.skip);
    assertRefused(ID_SPELLING, 'loopback / metadata / RFC 1918 (alternate spelling)', r);
    expect(reached('spelling'), req(ID_SPELLING, DOC, 'the guard MUST refuse BEFORE connecting — these probe requests reached the suite\'s loopback listener')).toEqual([]);
  }, 120_000);

  it('a name that resolves to loopback is refused on its resolved address', async () => {
    const r = await leg([`http://localhost:${port}${path('resolved')}/name`]);
    if ('skip' in r) return softSkip(...r.skip);
    assertRefused(ID_RESOLVED, 'name resolving to loopback', r);
    expect(reached('resolved'), req(ID_RESOLVED, DOC, 'the host MUST resolve the target and reject a loopback address before connecting — the probe reached the suite\'s loopback listener')).toEqual([]);
  }, 120_000);
});
