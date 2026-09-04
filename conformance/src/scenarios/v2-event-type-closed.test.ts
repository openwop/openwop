/**
 * v2 — `event-type-closed` (suite 2.0.0; RFC 0171 §A.1, §A.5;
 * `spec/v2/core/events.md` §"The envelope", §"Types").
 *
 * Witness class: witnessable — unaided. Every event a host emits on a run's
 * poll response carries a `type` that is EITHER a member of the closed enum in
 * `schemas/v2/run-event.schema.json` OR a vendor type matching the positive
 * `<org>.<name>` pattern whose org the host itself advertises under
 * `extensions` — a producer MUST NOT emit an unregistered member. Each event is
 * validated as a whole `RunEventDoc`. The run is the `conformance-noop`
 * fixture, awaited to a terminal status so the log holds the run transitions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/events.md §Types';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const VENDOR = /^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$/;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const TIMEOUT_MS = Number(process.env['OPENWOP_LIFECYCLE_TIMEOUT_MS'] ?? 10_000);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** The closed protocol enum, read from the generated schema. */
function protocolTypes(): Set<string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event.schema.json'), 'utf8')) as { properties: { type: { oneOf: Array<{ enum?: string[] }> } } };
  return new Set(schema.properties.type.oneOf.flatMap((b) => b.enum ?? []));
}

/** Orgs the host registers under `extensions.<org>.<name>`. */
function advertisedOrgs(doc: Record<string, unknown>): Set<string> {
  const ext = doc['extensions'];
  const keys = ext !== null && typeof ext === 'object' ? Object.keys(ext as Record<string, unknown>) : [];
  return new Set(keys.map((k) => k.split('.')[0] ?? ''));
}

async function terminalEvents(): Promise<{ events: unknown[]; doc: Record<string, unknown> } | { reason: string }> {
  const doc = await discovery();
  if (!doc) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap !== null && TERMINAL.has(String((snap.json as { status?: unknown } | undefined)?.status))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const poll = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`));
  if (poll === null || poll.status !== 200) return { reason: `GET /runs/{runId}/events/poll answered ${poll?.status ?? 'no response'}` };
  const events = (poll.json as { events?: unknown } | undefined)?.events;
  if (!Array.isArray(events) || events.length === 0) return { reason: 'the poll returned no events for a run driven to terminal status — the log is not observable' };
  return { events, doc };
}

describe('v2 event-type-closed (RFC 0171 §A.1, §A.5)', () => {
  it('every emitted type is a registered protocol type or a vendor type under an advertised org', async () => {
    const t = await terminalEvents();
    if ('reason' in t) return softSkip('blocked', t.reason);
    const enumSet = protocolTypes();
    const orgs = advertisedOrgs(t.doc);
    for (const ev of t.events) {
      const type = String((ev as { type?: unknown }).type);
      const registered = enumSet.has(type);
      const vendor = !registered && VENDOR.test(type) && orgs.has(type.split('.')[0] ?? '');
      expect(registered || vendor, req('openwop.requirement.0171.event-type-closed.type', DOC, `event type ${type} MUST be a member of the closed enum or a vendor type <org>.<name> whose org the host advertises under extensions (a producer MUST NOT emit an unregistered member; openwop. is reserved)`)).toBe(true);
    }
  });

  it('every emitted event validates as a RunEventDoc', async () => {
    const t = await terminalEvents();
    if ('reason' in t) return softSkip('blocked', t.reason);
    const validate = v2Validator('run-event');
    let previous = -1;
    for (const ev of t.events) {
      const r = validate(ev);
      expect(r.ok, req('openwop.requirement.0171.event-type-closed.envelope', 'spec/v2/core/events.md §The envelope', `every event MUST validate against schemas/v2/run-event.schema.json — eventId, runId, type, payload, timestamp, sequence, schemaVersion REQUIRED; closed (${r.errors})`)).toBe(true);
      const seq = (ev as { sequence?: unknown }).sequence;
      expect(typeof seq === 'number' && seq > previous, req('openwop.requirement.0171.event-type-closed.envelope', 'spec/v2/core/events.md §The envelope', 'sequence is the one ordering field: integer ≥ 0, strictly increasing per run')).toBe(true);
      previous = typeof seq === 'number' ? seq : previous;
    }
  });
});
