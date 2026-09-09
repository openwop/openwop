/**
 * v2 — `id-grammar` (suite 2.0.0; RFC 0170 §D.1;
 * `spec/v2/core/identity.md` §5 "Identifier grammars").
 *
 * Witness class: witnessable — unaided. Every id in a run snapshot and in its
 * event log matches its kind in `schemas/v2/ids.schema.json` (the snapshot and
 * event schemas `$ref` the grammars, so a full-document validation is the
 * witness; `runId` is additionally checked against the tenant-bound grammar
 * by hand so a failure names the field). A crafted id whose tenant segment is
 * not the caller's MUST be refused — `403 id_tenant_mismatch`, or `404
 * not_found` where the host chooses not to leak existence.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §5';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const RUN_ID = /^[A-Za-z0-9._~-]{1,128}\/[A-Za-z0-9._~-]{16,128}$/;
const FOREIGN_RUN_ID = 'openwop-conformance-foreign-tenant/foreignopaque0123456789abcdef';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function createRun(): Promise<{ runId: string } | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  return { runId };
}

describe('v2 id-grammar (RFC 0170 §D.1)', () => {
  it('every id on the run snapshot matches its ids.schema.json kind', async () => {
    const c = await createRun();
    if ('reason' in c) return softSkip('blocked', c.reason);
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(c.runId)}`));
    if (res === null || res.status !== 200) return softSkip('blocked', `GET /runs/{runId} answered ${res?.status ?? 'no response'} for the run just created`);
    expect(RUN_ID.test(c.runId), req('openwop.requirement.0170.id-grammar.snapshot', DOC, `runId MUST be tenant-bound <tenantId>/<opaque> with a host-minted opaque segment ^[A-Za-z0-9._~-]{16,128}$ (got ${c.runId})`)).toBe(true);
    const r = v2Validator('run-snapshot')(res.json);
    expect(r.ok, req('openwop.requirement.0170.id-grammar.snapshot', DOC, `every id field on RunSnapshot MUST match its kind in schemas/v2/ids.schema.json (${r.errors})`)).toBe(true);
  });

  it('every id on the run events matches its ids.schema.json kind', async () => {
    const c = await createRun();
    if ('reason' in c) return softSkip('blocked', c.reason);
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(c.runId)}/events/poll?timeout=1`));
    if (res === null || res.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events/poll answered ${res?.status ?? 'no response'}`);
    const events = (res.json as { events?: unknown } | undefined)?.events;
    if (!Array.isArray(events) || events.length === 0) return softSkip('blocked', 'the poll returned no events for the run just created — nothing to check the eventId / runId / nodeId grammars against');
    const validate = v2Validator('run-event');
    for (const ev of events) {
      const r = validate(ev);
      expect(r.ok, req('openwop.requirement.0170.id-grammar.events', DOC, `every RunEventDoc id (eventId, runId, nodeId, causationId) MUST match its kind — event ${String((ev as { eventId?: unknown }).eventId)} (${r.errors})`)).toBe(true);
      expect((ev as { runId?: unknown }).runId, req('openwop.requirement.0170.id-grammar.events', DOC, 'every event MUST carry the run\'s own runId')).toBe(c.runId);
    }
  });

  it('a run id whose tenant segment is not the caller\'s is refused', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(FOREIGN_RUN_ID)}`));
    if (res === null) return softSkip('blocked', 'GET /runs/{foreign runId} unreachable (fetch failed)');
    expect([403, 404].includes(res.status), req('openwop.requirement.0170.id-grammar.tenant-binding', DOC, `a tenant-bound id whose tenant segment is not the caller's MUST be rejected with 403 id_tenant_mismatch (or 404 not_found where existence is not leaked); got ${res.status}`)).toBe(true);
    const code = readErrorCode(res.json);
    expect(code === 'id_tenant_mismatch' || code === 'not_found', req('openwop.requirement.0170.id-grammar.tenant-binding', DOC, `the refusal MUST carry id_tenant_mismatch or not_found (got ${String(code)})`)).toBe(true);
    expect(res.status === 403 ? code === 'id_tenant_mismatch' : code === 'not_found', req('openwop.requirement.0170.id-grammar.tenant-binding', 'spec/v2/core/errors.md', 'the code MUST be answered with its registered HTTP status (id_tenant_mismatch → 403, not_found → 404)')).toBe(true);
  });
});
