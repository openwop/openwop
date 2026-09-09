/**
 * v2 — `payload-registry-closed` (suite 2.0.0; RFC 0171 §A.4;
 * `spec/v2/core/events.md` §"Payloads").
 *
 * Witness class: witnessable — unaided. `schemas/v2/run-event-payloads.schema.json`
 * holds one closed `$defs` entry per payload and the NORMATIVE `_typeIndex`
 * from v2 type to `$defs` key. A host MUST emit, for every registered type, a
 * payload that validates against the entry `_typeIndex` names; a registered
 * type with no index entry is a corpus defect and fails here too. Vendor
 * events have no registry entry and are not checked. The payload validator is
 * built locally (a `$ref` into the payload registry's `$defs`), because
 * `v2Validator` resolves whole schema files only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/events.md §Payloads';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const PAYLOADS_ID = 'https://openwop.dev/spec/v2/run-event-payloads.schema.json';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const TIMEOUT_MS = Number(process.env['OPENWOP_LIFECYCLE_TIMEOUT_MS'] ?? 10_000);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

let ajv: Ajv2020 | undefined;
function registry(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.schema.json') ? [p] : []; });
  for (const p of walk(join(SCHEMAS_DIR, 'v2'))) { try { ajv.addSchema(JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>); } catch { /* a duplicate $id is registered once */ } }
  return ajv;
}

/** `_typeIndex.properties[type].$ref` → the `$defs` key. */
function typeIndex(): Map<string, string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event-payloads.schema.json'), 'utf8')) as { _typeIndex?: { properties?: Record<string, { $ref?: string }> } };
  const out = new Map<string, string>();
  for (const [type, ref] of Object.entries(schema._typeIndex?.properties ?? {})) {
    const key = ref.$ref?.replace(/^#\/\$defs\//, '');
    if (key !== undefined) out.set(type, key);
  }
  return out;
}

function protocolTypes(): Set<string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event.schema.json'), 'utf8')) as { properties: { type: { oneOf: Array<{ enum?: string[] }> } } };
  return new Set(schema.properties.type.oneOf.flatMap((b) => b.enum ?? []));
}

const defValidators = new Map<string, ReturnType<Ajv2020['compile']>>();
function validatePayload(defKey: string, payload: unknown): { ok: boolean; errors: string } {
  const a = registry();
  let v = defValidators.get(defKey);
  if (v === undefined) { v = a.compile({ $ref: `${PAYLOADS_ID}#/$defs/${defKey}` }); defValidators.set(defKey, v); }
  return { ok: v(payload) as boolean, errors: a.errorsText(v.errors, { separator: '; ' }) };
}

async function terminalEvents(): Promise<unknown[] | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
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
  if (!Array.isArray(events) || events.length === 0) return { reason: 'the poll returned no events for a run driven to terminal status — no payload is observable' };
  return events;
}

describe('v2 payload-registry-closed (RFC 0171 §A.4)', () => {
  it('every registered event carries a payload that validates against its _typeIndex entry', async () => {
    const events = await terminalEvents();
    if (!Array.isArray(events)) return softSkip('blocked', events.reason);
    const index = typeIndex();
    const enumSet = protocolTypes();
    const registered = events.filter((ev) => enumSet.has(String((ev as { type?: unknown }).type)));
    if (registered.length === 0) return softSkip('blocked', 'the run emitted only vendor events — no registered payload to check');
    for (const ev of registered) {
      const type = String((ev as { type?: unknown }).type);
      const key = index.get(type);
      expect(key, req('openwop.requirement.0171.payload-registry-closed', DOC, `_typeIndex is normative: registered type ${type} MUST map to a $defs entry in run-event-payloads.schema.json`)).toBeDefined();
      if (key === undefined) continue;
      const r = validatePayload(key, (ev as { payload?: unknown }).payload);
      expect(r.ok, req('openwop.requirement.0171.payload-registry-closed', DOC, `the payload of ${type} MUST validate against $defs/${key} (every entry additionalProperties: false) (${r.errors})`)).toBe(true);
    }
  });
});
