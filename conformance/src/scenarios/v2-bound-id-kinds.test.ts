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
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { req } from '../lib/requirement-ids.js';
import { projectBoundId, BOUND_ID } from '../lib/bound-id.js';

const DOC = 'spec/v2/core/identity.md §5 (RFC 0187 §A)';
const WEBHOOK_ID = 'openwop.requirement.0187.bound-id-kinds.webhook';
const PER_KIND = 'openwop.requirement.0187.bound-id-kinds.per-kind';

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
    expect(
      del?.status ?? null,
      req(WEBHOOK_ID, DOC, `DELETE /webhooks/{webhookId} MUST accept the ~-projected spelling of the id it minted (RFC 0184 §A: every tenant-bound path parameter) — got ${del?.status ?? 'no response'} ${readErrorCode(del?.json) ?? ''}`.trim()),
    ).toBe(204);
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

  it('deliveryId: the kind has no wire surface to be bound on — a corpus gap, recorded', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    return softSkip('inapplicable', 'identity.md §5 binds deliveryId, but api/v2/openapi.yaml serves no dead-letter read (a GET /webhooks/{webhookId}/dead-letters projection is needed) — the kind has nowhere to appear on the wire, so no host can be held to it. RFC 0187 §Unresolved; v2-webhook-durable-delivery records the same absence for exhaustion.');
  });
});
