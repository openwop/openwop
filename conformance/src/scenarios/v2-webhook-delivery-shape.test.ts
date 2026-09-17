/**
 * `spec/v2/core/webhooks.md` §Deliveries — a major-2 webhook delivery carries the
 * v2 payload, not the host's in-process dialect (suite 2.3.1, target major 2;
 * gated on the `webhooks` family; creates one run per leg).
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
 * Three legs, and the SECOND is the one that keeps the first honest. Leg 1: a
 * major-2 subscription's delivery body validates against `run-event.schema.json`
 * (v2) and `owner` is exactly `{tenant, subject}`. Leg 2: a major-1
 * subscription still receives `principal` — `versioning.md` §1.2 forbids moving
 * the v1 wire mid-overlap, so a host that projects BOTH channels to v2 is also
 * wrong, and a v2-only check would reward it. Sabotage on the reporting host:
 * dropping the fan-out projection reds leg 1 and leaves leg 2 green. Leg 3 is
 * seam-gated: the tier-2 host's fan-out is ERA-aware, not major-aware — an era-3
 * row was projected on write and passes through; only era-2 rows take the read
 * projection — so a single fresh (era-3) run witnesses one branch. A seeded
 * era-2 run witnesses the other.
 *
 * @see spec/v2/core/webhooks.md §Deliveries
 * @see spec/v2/core/versioning.md §1.2
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { receiverBinding, resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { era2Gate, seedEra2Log, v1FixtureLog } from '../lib/era2-seed.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const ID = 'openwop.requirement.0171.webhook-delivery-shape';
const DOC = 'spec/v2/core/webhooks.md §Deliveries';
const FIXTURE = 'conformance-noop';

type Delivery = { body: string; headers: Record<string, string | string[] | undefined> };

async function startReceiver(): Promise<{ server: Server; url: string; deliveries: Delivery[] }> {
  const deliveries: Delivery[] = [];
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      deliveries.push({ body: Buffer.concat(chunks).toString('utf8'), headers: request.headers });
      res.writeHead(204); res.end();
    });
  });
  const { bind, advertise } = receiverBinding();
  await new Promise<void>((resolve) => server.listen(0, bind, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, url: `http://${advertise}:${port}/hook`, deliveries };
}

/** Register a subscription; `major` selects the contract the host speaks to this subscriber. */
async function register(url: string, major: 1 | 2): Promise<string | null> {
  const registration = resolveRegistrationUrl(url);
  const reg = await driver.post('/webhooks', { url: registration.url, events: ['run.completed'] }, { headers: { 'OpenWOP-Version': major === 2 ? '2.0' : '1.0' } });
  if (reg.status === 400 && readErrorCode(reg.json) === 'webhook_url_rejected') {
    softSkip('blocked', 'host SSRF guard rejected the loopback receiver (webhooks.md §Egress requires it); set OPENWOP_WEBHOOK_RECEIVER_URL to a public https receiver to witness');
    return null;
  }
  expect(reg.status, req(ID, 'webhooks.md §Surfaces', 'POST /webhooks MUST answer 201 { webhookId }')).toBe(201);
  const id = (reg.json as { webhookId?: unknown } | null)?.webhookId;
  return typeof id === 'string' ? id : null;
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

function v2RunEventValidator(): (doc: unknown) => { ok: boolean; errors: string } {
  const a = new Ajv2020({ strict: false, allErrors: true }); addFormats(a);
  const dir = join(SCHEMAS_DIR, 'v2');
  for (const f of readdirSync(dir)) { if (f.endsWith('.schema.json') && !statSync(join(dir, f)).isDirectory()) { try { a.addSchema(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>); } catch { /* dup */ } } }
  const fn = a.compile({ $ref: 'https://openwop.dev/spec/v2/run-event.schema.json' });
  return (doc) => ({ ok: fn(doc) === true, errors: a.errorsText(fn.errors, { separator: '; ' }) });
}

describe('webhook delivery shape is per-contract (webhooks.md §Deliveries, versioning.md §1.2)', () => {
  let active: Server | null = null;
  afterEach(async () => { const s = active; active = null; if (s) await new Promise<void>((r) => s.close(() => r())); });

  it('a major-2 subscriber receives the v2 payload: the body validates and owner is exactly {tenant, subject}', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const receiver = await startReceiver(); active = receiver.server;
    if ((await register(receiver.url, 2)) === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    const runId = await driveRun();
    const d = await waitFor(() => receiver.deliveries.find((x) => x.body.includes(runId)), 15_000);
    if (!d) return softSkip('blocked', 'no delivery for this run arrived inside 15s — durability is v2-webhook-durable-delivery\'s claim, not this file\'s');
    const parsed = JSON.parse(d.body) as { event?: Record<string, unknown> };
    const event = parsed.event ?? (parsed as Record<string, unknown>);
    const v = v2RunEventValidator()(event);
    expect(v.ok, req(ID, DOC, `a major-2 delivery body MUST validate against run-event.schema.json (v2) — "one source, three renderings" (RFC 0171 §A.4). ${v.errors}`)).toBe(true);
    const owner = (event as { owner?: Record<string, unknown> }).owner ?? {};
    expect(Object.keys(owner).sort(), req(ID, DOC, 'a major-2 delivery\'s owner MUST be exactly {tenant, subject} — a v1 owner block (principal, principalKind) on a v2 delivery is the fan-out forwarding the in-process dialect instead of projecting')).toEqual(['subject', 'tenant']);
  });

  it('a major-1 subscriber still receives principal — the v1 wire does not move mid-overlap', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const disc = await v2Discovery();
    const supported = ((disc?.versions as { supported?: unknown[] } | undefined)?.supported ?? []) as string[];
    if (!supported.some((s) => String(s).startsWith('1.'))) return softSkip('inapplicable', 'host advertises no 1.x contract — there is no v1 wire to keep still');
    const receiver = await startReceiver(); active = receiver.server;
    if ((await register(receiver.url, 1)) === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    const runId = await driveRun();
    const d = await waitFor(() => receiver.deliveries.find((x) => x.body.includes(runId)), 15_000);
    if (!d) return softSkip('blocked', 'no delivery for this run arrived inside 15s');
    const parsed = JSON.parse(d.body) as { event?: Record<string, unknown> };
    const event = parsed.event ?? (parsed as Record<string, unknown>);
    const owner = (event as { owner?: Record<string, unknown> }).owner ?? {};
    expect('principal' in owner, req(ID, 'spec/v2/core/versioning.md §1.2', 'a major-1 subscriber MUST still receive the v1 owner block (principal) — projecting every channel to v2 is as wrong as projecting none; the projection is contract-scoped')).toBe(true);
  });

  it('a seeded era-2 run is delivered projected too — the fan-out branch a fresh run cannot reach (seam-gated)', async () => {
    const disc = await v2Discovery();
    if (!disc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const seeded = era2Gate(disc);
    if (seeded === null) return softSkip('inapplicable', 'no era-2 seed seam advertised — the era-2 fan-out branch is unreachable without one (recorded under openwop.family.conformance)');
    const receiver = await startReceiver(); active = receiver.server;
    if ((await register(receiver.url, 2)) === null) return softSkip('blocked', 'registration refused (reason recorded above)');
    const log = await seedEra2Log(v1FixtureLog(FIXTURE), 'completed');
    if (!('runId' in log) || typeof (log as { runId?: unknown }).runId !== 'string') return softSkip('blocked', 'era-2 seed did not return a runId');
    const runId = (log as { runId: string }).runId;
    const d = await waitFor(() => receiver.deliveries.find((x) => x.body.includes(runId)), 15_000);
    if (!d) return softSkip('blocked', 'no delivery for the seeded era-2 run inside 15s — a host MAY not fan out seeded history; recorded blocked, not failed');
    const parsed = JSON.parse(d.body) as { event?: Record<string, unknown> };
    const event = parsed.event ?? (parsed as Record<string, unknown>);
    const v = v2RunEventValidator()(event);
    expect(v.ok, req(ID, DOC, `an era-2 row delivered to a major-2 subscriber MUST be projected — the read projection applies at the fan-out as at poll/SSE (events.md §Era-2). ${v.errors}`)).toBe(true);
    const owner = (event as { owner?: Record<string, unknown> }).owner ?? {};
    expect('principal' in owner, req(ID, DOC, 'a projected era-2 delivery MUST NOT carry the v1 owner block')).toBe(false);
  });
});
