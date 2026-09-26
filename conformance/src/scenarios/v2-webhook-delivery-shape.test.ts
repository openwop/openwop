/**
 * `spec/v2/core/webhooks.md` §Delivery — a webhook delivery's `event` is the
 * verbatim run event AS THE SUBSCRIBER'S CONTRACT RENDERS IT (suite 2.3.3,
 * target major 2; gated on the `webhooks` family; creates one run per leg).
 *
 * `webhooks.md:22`: "The delivery envelope is generated from the same payload
 * definition as the event itself and the CloudEvents mapping — one source,
 * three renderings (RFC 0171 §A.4)." That was normative before this file
 * existed. What did not exist was a reader: seven webhook scenarios checked
 * signature, headers, durability, isolation and SSRF, and NONE opened the body
 * against a schema. A tier-1 host had two major-2 egress channels; poll/SSE
 * projected the payload and the webhook fan-out forwarded the raw in-process
 * event, so a major-2 subscriber received the v1 owner block (`principal`,
 * `principalKind`) — with every webhook scenario green. The wire truth is per
 * channel, and a channel nobody's scenario reads is a channel that can drift.
 *
 * WHERE THE OWNER LIVES (the 2.3.1 → 2.3.2 correction). The owner echo is a
 * property of the `run.started` PAYLOAD — `run-event-payloads.schema.json`
 * `runStarted.owner`, `{ tenant, workspace?, subject }` on the v2 wire and
 * `{ tenant, workspace?, principal?, principalKind? }` on the v1 wire, both
 * `additionalProperties: false` — not of the event envelope, which is closed
 * and names no `owner` in either major. 2.3.1 subscribed to `run.completed`
 * (whose payload is `{ outputs, durationMs }`) and read `event.owner`: a
 * predicate no host could satisfy, and a third leg that passed vacuously.
 * This file subscribes to `run.started` and reads `event.payload.owner`.
 *
 * Three legs, and the SECOND is the one that keeps the first honest. Leg 1: a
 * major-2 subscription's delivery validates against `webhook-delivery.schema.json`
 * (v2), its `run.started` payload against the v2 `runStarted` definition, and
 * the owner carries `subject` and never `principal`. Leg 2: a major-1
 * subscription's `run.started` payload validates against the V1 `runStarted`
 * definition — `versioning.md` §1.2 forbids moving the v1 wire mid-overlap, so
 * a host that projects BOTH channels to v2 is also wrong, and a v2-only check
 * would reward it. The owner's keys are NOT the discriminator: v1's owner admits
 * `subject` (RFC 0165 §B) beside `principal`, so a v2 owner is a valid v1 owner;
 * the v2 payload's integer `engineVersion` (string on v1) is what the v1 wire
 * cannot carry, and the v1 definition catches it. Leg 3 is
 * seam-gated: the tier-2 host's fan-out is ERA-aware, not major-aware — an
 * era-3 row was projected on write and passes through; only era-2 rows take the
 * read projection — so a single fresh (era-3) run witnesses one branch. A
 * seeded era-2 run witnesses the other.
 *
 * @see spec/v2/core/webhooks.md §Delivery
 * @see spec/v2/core/versioning.md §1.2
 */
import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { noDeliveryCause, startScopedReceiver, type ScopedReceiver } from '../lib/scoped-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { era2Gate, seedEra2Log, v1FixtureLog } from '../lib/era2-seed.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs a webhook delivery to the suite-owned scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL';

const ID = 'openwop.requirement.0171.webhook-delivery-shape';
const DOC = 'spec/v2/core/webhooks.md §Delivery';
const FIXTURE = 'conformance-noop';
/** The one event type whose payload carries the owner echo — the field that differs between the two wires. */
const EVENT_TYPE = 'run.started';

type Delivery = { body: string; headers: Record<string, string | string[] | undefined> };
type Validator = (doc: unknown) => { ok: boolean; errors: string };

async function startReceiver(): Promise<ScopedReceiver & { deliveries: Delivery[] }> {
  const deliveries: Delivery[] = [];
  // `startScopedReceiver` (2.37.0) replaces this file's own `createServer` +
  // pinned-port binding. The comment that stood here described the collision
  // from the inside: "a tunnelled run registers the tunnel URL here and the
  // tunnel forwards to the PINNED port — held by the other receiver, which
  // answers 500 by design — so this file's `deliveries` stays empty, its legs
  // soft-skip, and (because `register()` already asserted) the rows resolve
  // `executed-pass`." Four files registered that one byte-identical URL. Each
  // now registers its own nonce path, and `front-mux` routes a delivery to the
  // exercise it was addressed to whichever listener holds the port.
  const rx = await startScopedReceiver((hit, res) => {
    deliveries.push({ body: hit.body, headers: hit.headers });
    res.writeHead(204);
    res.end();
  });
  return { ...rx, deliveries };
}

/**
 * Register a subscription; `major` selects the contract the host speaks to this
 * subscriber. A 1.x registration goes to `/v1/webhooks` — v1 operations keep
 * their `/v1/` path keys through the overlap (versioning.md §1.4) — and a host
 * that serves no 1.x webhook surface answers 404 there, which is `inapplicable`
 * for leg 2, not a failure: there is no v1 wire to keep still.
 */
async function register(url: string, major: 1 | 2): Promise<string | null> {
  // `url` is already the destination for THIS exercise — the public front (when
  // one is wired) plus this receiver's nonce path. It is no longer run through
  // `resolveRegistrationUrl`, which returned the front VERBATIM and so dropped
  // the path that makes the subscription this exercise's.
  const reg = await driver.post(major === 2 ? '/webhooks' : '/v1/webhooks', { url, events: [EVENT_TYPE] }, { headers: { 'OpenWOP-Version': major === 2 ? '2.0' : '1.0' } });
  if (major === 1 && reg.status === 404) {
    softSkip('inapplicable', 'host serves no 1.x webhook surface (POST /v1/webhooks not_found) — no v1 wire to keep still');
    return null;
  }
  if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') {
    softSkip('blocked', 'host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https receiver to witness');
    return null;
  }
  expect(reg.status, req(ID, 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
  const id = (reg.json as { webhookId?: unknown } | null)?.webhookId;
  if (typeof id === 'string') registered.push({ id, major });
  return typeof id === 'string' ? id : null;
}

/**
 * Every subscription this file registers, unregistered after the leg that made
 * it. Until 2.33.1 NOTHING here was ever unregistered. On loopback that was
 * invisible: each leg's receiver bound its own ephemeral port, so a leftover
 * subscription delivered to a dead address. Behind a public front every leg
 * shares ONE URL on ONE pinned port - so leg 1's still-live MAJOR-2
 * subscription delivered its v2 rendering into leg 2, and the major-1 leg read
 * it and failed a host that had rendered both contracts correctly ("a major-1
 * run.started payload MUST validate against the V1 definition … engineVersion
 * must be string"). Found on the v2 reference host's first relaxation-free cut;
 * reproduced with no ingress at all by pinning OPENWOP_WEBHOOK_RECEIVER_PORT on
 * a loopback run. It also left a live subscription on every host this file ever
 * ran against.
 */
const registered: Array<{ id: string; major: 1 | 2 }> = [];
async function unregisterAll(): Promise<void> {
  for (const r of registered.splice(0)) {
    const path = `${r.major === 2 ? '' : '/v1'}/webhooks/${encodeURIComponent(r.id)}`;
    try { await driver.delete(path, { headers: { 'OpenWOP-Version': r.major === 2 ? '2.0' : '1.0' } }); } catch { /* best effort: the leg's verdict is already recorded */ }
  }
}

async function driveRun(): Promise<string> {
  const create = await driver.post('/runs', { workflowId: FIXTURE });
  expect(create.status, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
  return (create.json as { runId: string }).runId;
}

async function waitFor<T>(fn: () => T | undefined, ms: number): Promise<T | undefined> {
  const until = Date.now() + ms;
  while (Date.now() < until) { const v = fn(); if (v !== undefined) return v; await new Promise((r) => setTimeout(r, 200)); }
  return fn();
}

/**
 * The delivery for `runId` carrying the subscribed type. A v1 subscriber may
 * receive the bare opaque id (versioning.md §5), so the match is on the segment
 * both spellings share.
 */
/** The subscription a delivery says it belongs to, from either header family; undefined when it carries neither. */
function subscriptionOf(d: Delivery): string | undefined {
  const h = d.headers['openwop-webhook-id'] ?? d.headers['x-openwop-webhook-id'];
  return typeof h === 'string' ? h : Array.isArray(h) ? h[0] : undefined;
}
const bare = (id: string): string => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id);

function deliveryFor(deliveries: Delivery[], runId: string, webhookId?: string): { event: Record<string, unknown>; envelope: Record<string, unknown> } | undefined {
  const opaque = runId.includes('/') ? runId.slice(runId.indexOf('/') + 1) : runId;
  for (const d of deliveries) {
    if (!d.body.includes(opaque)) continue;
    // Belt and braces beside unregisterAll(): a delivery that NAMES another
    // subscription is not this leg's, whatever URL it arrived on.
    const sub = subscriptionOf(d);
    if (webhookId !== undefined && sub !== undefined && bare(sub) !== bare(webhookId)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(d.body); } catch { continue; }
    if (parsed === null || typeof parsed !== 'object') continue;
    const envelope = parsed as Record<string, unknown>;
    const event = (envelope['event'] ?? envelope) as Record<string, unknown>;
    if (event['type'] === EVENT_TYPE) return { event, envelope };
  }
  return undefined;
}

function ownerOf(event: Record<string, unknown>): Record<string, unknown> | null {
  const p = event['payload'];
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null;
  const owner = (p as Record<string, unknown>)['owner'];
  return owner !== null && typeof owner === 'object' && !Array.isArray(owner) ? (owner as Record<string, unknown>) : null;
}

/** One Ajv per wire: the v2 tree under `schemas/v2/`, the v1 tree at the root — each addressed by its absolute `$id`. */
const AJV_BY_MAJOR = new Map<1 | 2, Ajv2020>();
function validators(major: 1 | 2): { ref: (id: string) => Validator } {
  const cached = AJV_BY_MAJOR.get(major);
  if (cached) return { ref: (id) => { const fn = cached.compile({ $ref: id }); return (doc) => ({ ok: fn(doc) === true, errors: cached.errorsText(fn.errors, { separator: '; ' }) }); } };
  const a = new Ajv2020({ strict: false, allErrors: true }); addFormats(a); AJV_BY_MAJOR.set(major, a);
  const dir = major === 2 ? join(SCHEMAS_DIR, 'v2') : SCHEMAS_DIR;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (!f.endsWith('.schema.json') || statSync(full).isDirectory()) continue;
    try { a.addSchema(JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown>); } catch { /* duplicate $id */ }
  }
  return {
    ref: (id: string): Validator => {
      const fn = a.compile({ $ref: id });
      return (doc) => ({ ok: fn(doc) === true, errors: a.errorsText(fn.errors, { separator: '; ' }) });
    },
  };
}

const V2 = 'https://openwop.dev/spec/v2/';
const V1 = 'https://openwop.dev/spec/v1/';

describe('webhook delivery shape is per-contract (webhooks.md §Delivery, versioning.md §1.2)', () => {
  // Closed through the receiver, not the raw server: `close()` also drops this
  // exercise's nonce from the front-mux registry, so a retry that arrives after
  // the leg has finished is answered 404 by whoever holds the port rather than
  // being handed to the next exercise's recorder.
  let active: ScopedReceiver | null = null;
  afterEach(async () => { await unregisterAll(); const rx = active; active = null; if (rx) await rx.close(); });

  it('a major-2 subscriber receives the v2 rendering: the delivery validates, and run.started.owner carries subject, never principal', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const receiver = await startReceiver(); active = receiver;
    const webhookId = await register(receiver.url, 2);
    if (webhookId === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    const runId = await driveRun();
    const d = await waitFor(() => deliveryFor(receiver.deliveries, runId, webhookId), 15_000);
    if (!d) return softSkip('blocked', `no ${EVENT_TYPE} delivery for this run arrived inside 15s — durability is v2-webhook-durable-delivery's claim, not this file's. ${noDeliveryCause(receiver, `${EVENT_TYPE} delivery`)}`);
    const v2 = validators(2);
    const envelope = v2.ref(`${V2}webhook-delivery.schema.json`)(d.envelope);
    expect(envelope.ok, req(ID, DOC, `a major-2 delivery MUST validate against webhook-delivery.schema.json (v2) — { runId, workspaceId?, event } with event the verbatim v2 run event. ${envelope.errors}`)).toBe(true);
    const payload = v2.ref(`${V2}run-event-payloads.schema.json#/$defs/runStarted`)(d.event['payload']);
    expect(payload.ok, req(ID, DOC, `a major-2 run.started payload MUST validate against the v2 runStarted definition — "one source, three renderings" (RFC 0171 §A.4). ${payload.errors}`)).toBe(true);
    const owner = ownerOf(d.event);
    expect(owner !== null, req(ID, DOC, 'a major-2 run.started payload MUST carry the owner echo { tenant, subject } (identity.md §1; run-event-payloads runStarted.owner requires both)')).toBe(true);
    expect(Object.keys(owner ?? {}).filter((k) => k === 'principal' || k === 'principalKind'), req(ID, DOC, 'a major-2 owner echo MUST NOT carry the v1 keys principal / principalKind — that is the fan-out forwarding the in-process dialect instead of projecting')).toEqual([]);
    expect(typeof owner?.['tenant'] === 'string' && owner?.['subject'] !== undefined, req(ID, DOC, 'a major-2 owner echo carries tenant and subject')).toBe(true);
  });

  it('a major-1 subscriber still receives the v1 rendering — the v1 wire does not move mid-overlap', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const disc = await v2Discovery();
    // RFC 0172 §A.1: `protocolVersions` lists every <major>.<minor> the host serves — the 2.3.1 file read a
    // `versions.supported` that no discovery document has, so this leg was inapplicable on every host.
    const versions = Array.isArray(disc?.['protocolVersions']) ? (disc?.['protocolVersions'] as unknown[]).map(String) : [];
    if (!versions.some((v) => v.startsWith('1.'))) return softSkip('inapplicable', `host advertises [${versions.join(', ') || 'no protocolVersions'}] — no 1.x member, so there is no v1 wire to keep still`);
    const receiver = await startReceiver(); active = receiver;
    const webhookId = await register(receiver.url, 1);
    if (webhookId === null) return softSkip('blocked', 'registration refused or inapplicable (disposition recorded above)');
    const runId = await driveRun();
    const d = await waitFor(() => deliveryFor(receiver.deliveries, runId, webhookId), 15_000);
    if (!d) return softSkip('blocked', `no ${EVENT_TYPE} delivery for this run arrived inside 15s. ${noDeliveryCause(receiver, `${EVENT_TYPE} delivery`)}`);
    // The v1 definition is the discriminator, not the owner's keys: v1's owner admits `subject` (RFC 0165
    // §B, echoed verbatim when present) alongside `principal`, so a v2 owner is ALSO a valid v1 owner.
    // What the v1 wire cannot carry is the v2 payload's integer `engineVersion` (string on v1) — a fan-out
    // that forwards the v2 rendering to a 1.x subscriber fails here, on the field that actually differs.
    const payload = validators(1).ref(`${V1}run-event-payloads.schema.json#/$defs/runStarted`)(d.event['payload']);
    expect(payload.ok, req(ID, 'spec/v2/core/versioning.md §1.2', `a major-1 run.started payload MUST validate against the V1 runStarted definition — projecting every channel to v2 is as wrong as projecting none; the projection is contract-scoped. ${payload.errors}`)).toBe(true);
    const owner = ownerOf(d.event);
    expect(owner === null || typeof owner['tenant'] === 'string', req(ID, 'spec/v2/core/versioning.md §1.2', 'a v1 owner echo, when present, names the tenant (v1 runStarted.owner requires it)')).toBe(true);
  });

  it('a seeded era-2 run is delivered projected too — the fan-out branch a fresh run cannot reach (seam-gated)', async () => {
    const disc = await v2Discovery();
    if (!disc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    // era2Gate answers null when the seam IS advertised and a disposition when it is not — the 2.3.1 file
    // read null as absence, so this leg was inapplicable on exactly the hosts that could witness it.
    const gate = era2Gate(disc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);
    const receiver = await startReceiver(); active = receiver;
    const webhookId = await register(receiver.url, 2);
    if (webhookId === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    const log = await seedEra2Log(v1FixtureLog(FIXTURE), 'completed');
    if (!log.ok) return softSkip(log.kind, log.reason);
    const runId = log.runId;
    const d = await waitFor(() => deliveryFor(receiver.deliveries, runId, webhookId), 15_000);
    // The seam appends HISTORY — rows that already happened — and a host MAY not fan out history (the
    // reference host's seam appends with fan-out suppressed by design). No delivery inside 15s means the
    // era-2 fan-out branch is unobservable on this host, not that a measurement failed: inapplicable.
    if (!d) return softSkip('inapplicable', `no ${EVENT_TYPE} delivery for the seeded era-2 run inside 15s — this host does not fan out seeded history, so the era-2 fan-out branch is unobservable here (recorded under openwop.family.conformance). ${noDeliveryCause(receiver, `${EVENT_TYPE} delivery`)}`);
    const payload = validators(2).ref(`${V2}run-event-payloads.schema.json#/$defs/runStarted`)(d.event['payload']);
    expect(payload.ok, req(ID, DOC, `an era-2 row delivered to a major-2 subscriber MUST be projected — the read projection applies at the fan-out as at poll/SSE (events.md §Era-2). ${payload.errors}`)).toBe(true);
    const owner = ownerOf(d.event);
    expect(owner === null || !('principal' in owner || 'principalKind' in owner), req(ID, DOC, 'a projected era-2 delivery MUST NOT carry the v1 owner keys')).toBe(true);
  });
});
