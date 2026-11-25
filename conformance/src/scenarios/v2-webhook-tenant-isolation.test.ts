/**
 * `v2-webhook-tenant-isolation` (target major 2; gated on the `webhooks` family,
 * the `conformance-noop` fixture and a second-tenant credential).
 *
 * `spec/v2/core/webhooks.md` §Surfaces: "A subscription MUST receive only events
 * from runs within its tenant scope, and only host events of its tenant;
 * cross-tenant delivery is a protocol violation whatever the filter says
 * (invariant `webhook-cross-tenant-isolation`)", and `unregisterWebhook`
 * answers "`403` when the caller is outside the subscription's tenant".
 *
 * Until this file the invariant had a major-1 witness only
 * (`webhook-tenant-isolation`, which reads subscription LISTS through a v1 seam
 * and never observes a delivery). No v2 host was measured on the delivery half.
 *
 * Legs:
 *   1. `webhooks.cross-tenant-delivery-isolated` — tenant B
 *      (`OPENWOP_TEST_TENANT_B_API_KEY`) registers ONE subscription with the
 *      broadest filter the suite can name (`run.started` + `run.completed`) on a
 *      suite-owned scoped receiver. Tenant A (the suite's own credential) then
 *      runs `conformance-noop`, and after it tenant B runs one. B's own run is
 *      the CONTROL: it must arrive, which shows the path from host to receiver
 *      works and the host was fanning out after A's run had already finished.
 *      Once B's delivery is in and a settle window has passed, no delivery on
 *      B's receiver may name A's run. A host that selects subscribers by event
 *      type alone (not by the run's tenant) delivers A's run here.
 *   2. `webhooks.cross-tenant-unregister-refused` — tenant B's
 *      `DELETE /webhooks/{A's webhookId}` answers `403` (or `404`, the
 *      existence-neutral form identity.md §5 permits) and leaves A's subscription
 *      in place: A's own DELETE then answers `204`.
 *
 * Dispositions: discovery unreachable ⇒ `blocked`; `webhooks` not advertised or
 * the fixture not listed ⇒ `inapplicable`; no second-tenant credential, one equal
 * to the suite's own, or one the host does not authenticate ⇒ `blocked`; the
 * host's egress guard refusing the loopback receiver with no public front, or no
 * control delivery ⇒ `blocked` (never a pass: absence is evidence only next to
 * a control that arrived).
 *
 * Sabotage (local v2 reference host, `src/store.ts` `webhooksForTenant` with its
 * `WHERE tenant = ?` dropped so every subscription is a candidate for every
 * run): leg 1 fails on A's `run.started` / `run.completed` arriving at B.
 * `src/webhooks.ts` `unregisterWebhook` with its tenant checks removed: leg 2
 * fails on tenant B's `204`.
 *
 * @see spec/v2/core/webhooks.md §Surfaces
 * @see SECURITY/invariants.yaml id: webhook-cross-tenant-isolation
 */

import { afterEach, describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, blockedDespiteAssertions } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs webhook deliveries to the suite-owned scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL';

const DOC = 'spec/v2/core/webhooks.md §Surfaces';
const ID_DELIVERY = 'openwop.requirement.webhooks.cross-tenant-delivery-isolated';
const ID_UNREGISTER = 'openwop.requirement.webhooks.cross-tenant-unregister-refused';
const FIXTURE = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SETTLE_MS = 3_000;
const WINDOW_MS = 30_000;

type As = { authenticated: false; headers: Record<string, string> };
type Gate = { ok: true; asB: As } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

let receiver: ScopedReceiver | null = null;
const cleanup: Array<{ id: string; as?: As }> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await http(() => driver.delete(`/webhooks/${enc(c.id)}`, c.as ?? {}));
  if (receiver) { const rx = receiver; receiver = null; await rx.close(); }
});

async function gate(): Promise<Gate> {
  if (!(await v2Discovery().catch(() => null))) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0' };
  if (!(await familyAdvertised('webhooks'))) return { ok: false, kind: 'inapplicable', reason: 'the webhooks family is not advertised — no subscription to isolate' };
  if (!isFixtureAdvertised(FIXTURE)) return { ok: false, kind: 'inapplicable', reason: `${FIXTURE} is not advertised — no run to deliver` };
  const b = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
  if (!b) return { ok: false, kind: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — cross-tenant delivery cannot be measured with one tenant' };
  if (b === loadEnv().apiKey) return { ok: false, kind: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant' };
  const asB: As = { authenticated: false, headers: { Authorization: `Bearer ${b}` } };
  const probe = await http(() => driver.get('/runs?limit=1', asB));
  if (probe === null || probe.status === 401) return { ok: false, kind: 'blocked', reason: `OPENWOP_TEST_TENANT_B_API_KEY does not authenticate on this host (GET /runs answered ${probe?.status ?? 'nothing'})` };
  return { ok: true, asB };
}

/** Create a noop run as `as` and wait for it to finish; the run id, or why not. */
async function finishedRun(as: As | Record<string, never>): Promise<string | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: FIXTURE }, as));
  const runId = (res?.json as { runId?: unknown } | null)?.runId;
  if (res === null || res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {${FIXTURE}} answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''}`.trim() };
  const deadline = Date.now() + WINDOW_MS;
  for (;;) {
    const s = await http(() => driver.get(`/runs/${enc(runId)}`, as));
    if (TERMINAL.has(String((s?.json as { status?: unknown } | null)?.status ?? ''))) return runId;
    if (Date.now() > deadline) return { reason: `${FIXTURE} run ${runId} did not reach a terminal status within ${WINDOW_MS} ms` };
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The opaque segment of a tenant-bound id (identity.md §5), or the id itself. */
const opaque = (id: string): string => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id);

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (pred()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return pred();
}

describe('v2 webhook tenant isolation (webhooks.md §Surfaces; invariant webhook-cross-tenant-isolation)', () => {
  it('a second tenant\'s subscription receives nothing from the first tenant\'s run', async () => {
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const bodies: string[] = [];
    const rx = await startScopedReceiver((hit, res) => { bodies.push(hit.body); res.writeHead(204); res.end(); });
    receiver = rx;
    const reg = await http(() => driver.post('/webhooks', { url: rx.url, events: ['run.started', 'run.completed'] }, g.asB));
    if (reg === null) return softSkip('blocked', 'POST /webhooks as tenant B unreachable (fetch failed)');
    if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected' && !rx.tunnelled) {
      return softSkip('blocked', 'the host SSRF guard refused the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https front for the suite receiver');
    }
    expect(reg.status, req(ID_DELIVERY, DOC, `registerWebhook as tenant B MUST answer 201 (got ${reg.status} ${readErrorCode(reg.json) ?? ''})`)).toBe(201);
    const bId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
    expect(typeof bId, req(ID_DELIVERY, DOC, 'the 201 body MUST carry webhookId')).toBe('string');
    cleanup.push({ id: bId as string, as: g.asB });

    const runA = await finishedRun({});
    if (typeof runA !== 'string') return blockedDespiteAssertions(`tenant A's run: ${runA.reason}`);
    const runB = await finishedRun(g.asB);
    if (typeof runB !== 'string') return blockedDespiteAssertions(`tenant B's control run: ${runB.reason}`);

    const control = await waitFor(() => bodies.some((b) => b.includes(opaque(runB))), WINDOW_MS);
    if (!control) {
      return blockedDespiteAssertions(absenceIsUnmeasured(rx)
        ? noDeliveryCause(rx, 'control delivery of tenant B\'s own run')
        : `tenant B's own run was never delivered to its subscription, so the absence of tenant A's run shows nothing — ${noDeliveryCause(rx, 'control delivery')}`);
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const leaked = bodies.filter((b) => b.includes(opaque(runA)));
    expect(
      leaked.length,
      req(ID_DELIVERY, DOC, `a subscription MUST receive only events from runs within its tenant scope — tenant B's subscription ${String(bId)} received ${leaked.length} delivery(ies) naming tenant A's run ${runA} (first: ${leaked[0]?.slice(0, 200) ?? ''})`),
    ).toBe(0);
  }, 90_000);

  it('a second tenant cannot unregister the first tenant\'s subscription', async () => {
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startScopedReceiver((_hit, res) => { res.writeHead(204); res.end(); });
    receiver = rx;
    const reg = await http(() => driver.post('/webhooks', { url: rx.url, events: ['run.completed'] }));
    if (reg === null) return softSkip('blocked', 'POST /webhooks unreachable (fetch failed)');
    if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected' && !rx.tunnelled) {
      return softSkip('blocked', 'the host SSRF guard refused the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https front for the suite receiver');
    }
    expect(reg.status, req(ID_UNREGISTER, DOC, `registerWebhook MUST answer 201 (got ${reg.status} ${readErrorCode(reg.json) ?? ''})`)).toBe(201);
    const aId = (reg.json as { webhookId?: unknown } | null)?.webhookId as string;
    cleanup.push({ id: aId });
    const foreign = await http(() => driver.delete(`/webhooks/${enc(aId)}`, g.asB));
    expect([403, 404], req(ID_UNREGISTER, DOC, `unregisterWebhook by a caller outside the subscription's tenant MUST be refused 403 (or the existence-neutral 404) — got ${foreign?.status ?? 'nothing'}`)).toContain(foreign?.status);
    const own = await http(() => driver.delete(`/webhooks/${enc(aId)}`));
    expect(own?.status, req(ID_UNREGISTER, DOC, `after the foreign refusal the owning tenant's subscription MUST still exist — its own unregister answers 204 (got ${own?.status ?? 'nothing'})`)).toBe(204);
    if (own?.status === 204) cleanup.splice(cleanup.findIndex((c) => c.id === aId), 1);
  }, 60_000);
});
