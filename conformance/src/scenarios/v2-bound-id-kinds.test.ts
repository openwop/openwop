/**
 * `spec/v2/core/identity.md` §5 + RFC 0187 §A — every tenant-bound KIND that
 * has a wire surface, not just `runId` (suite 2.4.0, target major 2).
 *
 * §5 names five tenant-bound kinds: `runId`, `interruptId`, `subscriptionId`,
 * `deliveryId`, `effectId`. Until this file, every v2 scenario that read a
 * bound id on the wire read `runId` — so a host that bound one kind of five was
 * green. A tier-1 host's own audit found exactly that: its id derivation walked
 * the `$ref`s but matched only `runId`, and `interruptId` / `subscriptionId` /
 * `deliveryId` / `effectId` went out BARE on every major-2 channel, with the
 * accept path unbound on two prefixes. The suite could not have caught it.
 *
 * `webhookId` is the `subscriptionId` kind as of RFC 0187 §A.1: the mint
 * surface (`POST /webhooks → { webhookId }`) had inherited v1's bare
 * `type: string`, so the kind had no HTTP surface and the HTTP surface had no
 * kind — and `identity.md` §5's `403 id_tenant_mismatch` check had nothing to
 * read. Both production hosts mint it bare today and say so; this file is why
 * that is now visible rather than assumed.
 *
 * One leg per kind, each gated on the family that mints it, so a host without
 * the family records `inapplicable` rather than a failure. The `deliveryId`
 * leg records `inapplicable` for a different reason and it is a corpus finding,
 * not a host one: `api/v2/openapi.yaml` serves no dead-letter read, so a bound
 * `deliveryId` has nowhere to appear (RFC 0187 §Unresolved).
 *
 * @see spec/v2/core/identity.md §5
 * @see RFCS/0187-host-found-bindings.md §A
 */
import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { receiverBinding, resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import { req } from '../lib/requirement-ids.js';
import { projectBoundId, BOUND_ID } from '../lib/bound-id.js';

const DOC = 'spec/v2/core/identity.md §5 (RFC 0187 §A)';
const WEBHOOK_ID = 'openwop.requirement.0187.bound-id-kinds.webhook';
const PER_KIND = 'openwop.requirement.0187.bound-id-kinds.per-kind';
/**
 * 2.35.0 (openwop#1450). The mint leg above reads the id a host RETURNS; a
 * subscriber identifies its deliveries by the id the host EMITS in the
 * delivery headers. A tier-2 host bound the first and left the second bare,
 * and this file stayed green — the defect surfaced only as a durability
 * failure in another file, whose delivery filter keys on the header.
 */
const WEBHOOK_EMITTED = 'openwop.requirement.0187.bound-id-kinds.webhook-emitted';

type Delivery = { body: string; headers: Record<string, string | string[] | undefined> };
/** The suite's receiver, bound the way every webhook scenario binds it (pinned port / public front honoured). */
async function startReceiver(): Promise<{ server: Server; url: string; deliveries: Delivery[] }> {
  const deliveries: Delivery[] = [];
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => { deliveries.push({ body: Buffer.concat(chunks).toString('utf8'), headers: request.headers }); res.writeHead(204); res.end(); });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  await new Promise<void>((resolve) => server.listen(bindPort, binding.bind, () => resolve()));
  const addr = server.address();
  return { server, url: `http://${binding.advertise}:${typeof addr === 'object' && addr ? addr.port : 0}/hook`, deliveries };
}
const header = (d: Delivery, name: string): string | undefined => { const v = d.headers[name]; return Array.isArray(v) ? v[0] : v; };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** A bound id whose tenant segment is NOT the caller's — the one input §5's 403 check exists for. */
function foreignTenant(id: string): string {
  const opaque = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
  return `not-the-callers-tenant/${opaque}`;
}

/** Assert one id is the tenant-bound grammar. */
function expectBound(id: unknown, kind: string, where: string, requirement: string): void {
  expect(
    typeof id === 'string' && BOUND_ID.test(id),
    req(requirement, DOC, `${kind} on the wire MUST be tenant-bound \`<tenantId>/<opaque>\` (identity.md §5 kind table) — ${where} carried ${JSON.stringify(id)}`),
  ).toBe(true);
}

describe('v2 bound-id kinds (identity.md §5, RFC 0187 §A)', () => {
  it('subscriptionId: POST /webhooks mints a bound webhookId, the projected segment is accepted, and a foreign tenant segment is refused 403', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised — no subscription to mint (gate recorded under openwop.family.webhooks)');
    // Route the mint through `resolveRegistrationUrl` so an operator who sets
    // OPENWOP_WEBHOOK_RECEIVER_URL actually gets a reachable registration here.
    // Before this, the blocked note TOLD them to set that variable and this file
    // never read it — inoperative advice in a suite where one blocked row denies
    // every claimed profile (RFC 0168 §E.1). The fallback stays a reserved
    // `.invalid` host: this leg only needs the mint, never a delivery.
    const registration = resolveRegistrationUrl('https://subscriber.invalid/hook');
    const reg = await http(() => driver.post('/webhooks', { url: registration.url, events: ['run.completed'] }));
    if (reg === null) return softSkip('blocked', 'POST /webhooks unreachable (fetch failed)');
    if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') return softSkip('blocked', `host SSRF guard rejected the registration URL ${registration.url}${registration.tunnelled ? ' (from OPENWOP_WEBHOOK_RECEIVER_URL)' : ' — set OPENWOP_WEBHOOK_RECEIVER_URL to a public https receiver, which THIS leg now honours'}`);
    expect(reg.status, req(WEBHOOK_ID, 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
    const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
    expectBound(webhookId, 'webhookId', 'POST /webhooks 201', WEBHOOK_ID);
    // Never leave the subscription behind, whatever happens below (a leaked
    // subscription is delivered to for the rest of the run and skews every
    // later webhook file's attribution).
    let deleted = false;
    try {
    if (typeof webhookId !== 'string' || !BOUND_ID.test(webhookId)) return softSkip('blocked', `the mint answered ${JSON.stringify(webhookId)}, which is not a tenant-bound id — the projection and 403 legs have no bound id to drive (the grammar failure is recorded by the assertion above)`);

    // The 403 check §5 exists for: a bound id whose tenant is not the caller's.
    const foreign = await http(() => driver.delete(`/webhooks/${projectBoundId(foreignTenant(webhookId))}`));
    expect(
      foreign?.status ?? null,
      req(WEBHOOK_ID, DOC, `a tenant-bound webhookId whose tenant segment is not the caller's MUST be refused 403 id_tenant_mismatch — got ${foreign?.status ?? 'no response'} ${readErrorCode(foreign?.json) ?? ''}`.trim()),
    ).toBe(403);
    expect(readErrorCode(foreign?.json), req(WEBHOOK_ID, DOC, 'the refusal MUST name id_tenant_mismatch, not not_found — the tenant check is the point')).toBe('id_tenant_mismatch');

    // The accept side: the RFC 0184 projection on a tenant-bound parameter that is not runId.
    const del = await http(() => driver.delete(`/webhooks/${projectBoundId(webhookId)}`));
    deleted = del?.status === 204;
    expect(
      del?.status ?? null,
      req(WEBHOOK_ID, DOC, `DELETE /webhooks/{webhookId} MUST accept the ~-projected spelling of the id it minted (RFC 0184 §A: every tenant-bound path parameter) — got ${del?.status ?? 'no response'} ${readErrorCode(del?.json) ?? ''}`.trim()),
    ).toBe(204);
    } finally {
      if (!deleted && typeof webhookId === 'string') await http(() => driver.delete(`/webhooks/${projectBoundId(webhookId)}`));
    }
  });

  it('subscriptionId: the webhookId a host EMITS on a delivery is the one it minted', async () => {
    const doc = await v2Discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised — nothing is delivered (gate recorded under openwop.family.webhooks)');
    const rx = await startReceiver();
    let webhookId: string | null = null;
    try {
      const registration = resolveRegistrationUrl(rx.url);
      const reg = await http(() => driver.post('/webhooks', { url: registration.url, events: ['run.completed'] }));
      if (reg === null) return softSkip('blocked', 'POST /webhooks unreachable (fetch failed)');
      if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') {
        return softSkip('blocked', `host SSRF guard rejected the suite receiver ${registration.url} (webhooks.md §SSRF requires it) — set OPENWOP_WEBHOOK_RECEIVER_URL to a public https front for the receiver to witness what the host emits`);
      }
      const minted = (reg.json as { webhookId?: unknown } | null)?.webhookId;
      if (reg.status !== 201 || typeof minted !== 'string') return softSkip('blocked', `POST /webhooks answered ${reg.status} without a webhookId — the mint leg above owns that obligation; this leg needs an id to compare`);
      webhookId = minted;
      const create = await http(() => driver.post('/runs', { workflowId: 'conformance-noop' }));
      const runId = (create?.json as { runId?: unknown } | null)?.runId;
      if (create === null || create.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${create?.status ?? 'no response'} — no run, so no delivery to read`);
      // Select the delivery by the RUN in the body, never by the header under
      // test: filtering on the header is exactly how a bare header hid in the
      // durability scenario (openwop#1450).
      const ours = (): Delivery[] => rx.deliveries.filter((d) => { try { return (JSON.parse(d.body) as { runId?: unknown }).runId === runId; } catch { return false; } });
      const deadline = Date.now() + scaledTimeoutMs(20_000);
      while (ours().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      const delivery = ours()[0];
      if (delivery === undefined) return softSkip('blocked', `no delivery for run ${runId} reached the suite receiver within ${scaledTimeoutMs(20_000)}ms — what the host emits was not observed`);
      expect(
        header(delivery, 'openwop-webhook-id'),
        req(WEBHOOK_EMITTED, 'webhooks.md §Headers (RFC 0187 §A.1)', `the delivery's OpenWOP-Webhook-Id MUST equal the tenant-bound webhookId the host minted (${minted}) — a subscriber identifies its deliveries by the header, not by the 201 it received once`),
      ).toBe(minted);
      // The X-openwop-* family is required only of a host advertising BOTH
      // majors (webhooks.md: dual emission through the overlap). A v2-only host
      // sends none, and failing it for that would be the suite's error.
      const both = Array.isArray(doc.protocolVersions) && doc.protocolVersions.some((v) => typeof v === 'string' && v.startsWith('1.'));
      if (both) {
        expect(
          header(delivery, 'x-openwop-webhook-id'),
          req(WEBHOOK_EMITTED, 'webhooks.md §Headers (dual emission, RFC 0176 §D.2)', `a host advertising both majors MUST send X-openwop-Webhook-Id with the same value as OpenWOP-Webhook-Id (${minted})`),
        ).toBe(minted);
      }
    } finally {
      if (webhookId !== null) await http(() => driver.delete(`/webhooks/${projectBoundId(webhookId as string)}`));
      await new Promise<void>((ok) => rx.server.close(() => ok()));
    }
  });

  it('interruptId: the id a suspension puts on the wire is bound', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('interrupt'))) return softSkip('inapplicable', 'interrupt family not advertised — no suspension to read (gate recorded under openwop.family.interrupt)');
    const create = await http(() => driver.post('/runs', { workflowId: 'conformance-approval' }));
    if (create === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (create.status !== 201) return softSkip('blocked', `POST /runs {workflowId: conformance-approval} answered ${create.status} ${readErrorCode(create.json) ?? ''} — the suspending fixture is not seeded on this host`.trim());
    const runId = (create.json as { runId?: unknown }).runId;
    if (typeof runId !== 'string') return softSkip('blocked', 'the create answered no runId');
    const until = Date.now() + 15_000;
    let suspended: Record<string, unknown> | undefined;
    while (Date.now() < until && !suspended) {
      const poll = await http(() => driver.get(`/runs/${projectBoundId(runId)}/events/poll?timeout=1`));
      const events = ((poll?.json as { events?: Array<Record<string, unknown>> } | null)?.events ?? []);
      suspended = events.find((e) => e['type'] === 'node.suspended');
      if (!suspended) await new Promise((r) => setTimeout(r, 300));
    }
    if (!suspended) return softSkip('blocked', 'the approval fixture did not reach node.suspended inside 15s — no interruptId on the wire to read');
    const payload = (suspended['payload'] ?? {}) as Record<string, unknown>;
    expectBound(payload['interruptId'], 'interruptId', 'node.suspended.payload', PER_KIND);
  });

  it('effectId: every row GET /runs/{runId}/effects serves is bound', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('idempotency'))) return softSkip('inapplicable', 'idempotency family not advertised — the Layer-2 effect ledger is its obligation (gate recorded under openwop.family.idempotency)');
    const create = await http(() => driver.post('/runs', { workflowId: 'conformance-noop' }));
    if (create === null || create.status !== 201) return softSkip('blocked', `POST /runs answered ${create?.status ?? 'no response'} — no run to read effects on`);
    const runId = (create.json as { runId: string }).runId;
    const res = await http(() => driver.get(`/runs/${projectBoundId(runId)}/effects`));
    if (res === null) return softSkip('blocked', 'GET /runs/{runId}/effects unreachable (fetch failed)');
    if (res.status === 404 || res.status === 405) return softSkip('inapplicable', `the host advertises idempotency but serves no effect ledger at /runs/{runId}/effects (${res.status})`);
    expect(res.status, req(PER_KIND, 'security-defaults.md §Layer-2 effect identity', 'GET /runs/{runId}/effects MUST answer 200')).toBe(200);
    const effects = ((res.json as { effects?: Array<Record<string, unknown>> } | null)?.effects ?? []);
    if (effects.length === 0) return softSkip('inapplicable', 'the noop fixture records no effects — no effectId on the wire to read (a host with an effect-producing fixture witnesses this leg)');
    for (const e of effects) expectBound(e['effectId'], 'effectId', 'GET /runs/{runId}/effects', PER_KIND);
  });

  it('deliveryId: every record in the dead-letter read carries a bound id in the caller\'s tenant', async () => {
    // Until RFC 0188 this leg was an unconditional softSkip recording a CORPUS
    // gap: `identity.md` §5 bound the kind and no v2 surface returned one, so no
    // host could be held to it. The dead-letter read is that surface.
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const fam = await gateFamily('webhooks');
    if (!fam) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!fam['deadLetter']) return softSkip('inapplicable', 'host does not advertise the webhooks.deadLetter facet — it serves no dead-letter read, and RFC 0188 §A.5 makes that a 404 rather than an obligation');
    const reg = await http(() => driver.post('/webhooks', { url: 'https://subscriber.invalid/hook', events: ['run.completed'] }));
    if (reg === null || reg.status !== 201) return softSkip('blocked', `POST /webhooks answered ${reg?.status ?? 'no response'} — no subscription to read a sink for`);
    const webhookId = (reg.json as { webhookId?: unknown } | null)?.webhookId;
    if (typeof webhookId !== 'string') return softSkip('blocked', 'the mint returned no webhookId');
    // This leg only READS the sink; it must not leave its subscription behind
    // (measured: it left one on every run until 2.35.0).
    try {
    const res = await http(() => driver.get(`/webhooks/${projectBoundId(webhookId)}/dead-letters`));
    if (res === null) return softSkip('blocked', 'GET /webhooks/{webhookId}/dead-letters unreachable (fetch failed)');
    expect(res.status, req(PER_KIND, 'RFC 0188 §A.1', 'a host advertising webhooks.deadLetter MUST serve the dead-letter read (200)')).toBe(200);
    const rows = ((res.json as { deliveries?: Array<Record<string, unknown>> } | null)?.deliveries ?? []);
    if (rows.length === 0) return softSkip('inapplicable', 'the subscription has no dead-lettered delivery in this run — the read is served and the shape is unwitnessed here; v2-webhook-durable-delivery drives an exhaustion and asserts the record');
    for (const r of rows) expectBound(r['deliveryId'], 'deliveryId', 'GET /webhooks/{webhookId}/dead-letters', PER_KIND);
    } finally {
      await http(() => driver.delete(`/webhooks/${projectBoundId(webhookId)}`));
    }
  });
});
