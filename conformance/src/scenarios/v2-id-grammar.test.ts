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
 *
 * Suite 2.0.10 adds the bare-id leg (`identity.md` §5, stated 2026-09-10):
 * a major-2 request whose tenant-bound path parameter carries only the opaque
 * segment — the v1 spelling of the run this caller just created — is the
 * overlap's affordance. While the host advertises a `1.x` member it MUST
 * resolve the bare id under the caller's tenant and answer 200 with the BOUND
 * id in the body (the same rule `v2-dual-stack-negotiation` measures for a
 * `/v1/`-created run); once no `1.x` member is advertised it MUST refuse the
 * bare form `400 validation_error`. The leg decides which branch applies from
 * live discovery, so it is the expiry's witness as well as the affordance's.
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

  it('a bare (unbound) run id in a major-2 path: admitted under the caller\'s tenant through the overlap, refused 400 validation_error after it', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const versions = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    const overlap = versions.some((v) => v.startsWith('1.'));
    const c = await createRun();
    if ('reason' in c) return softSkip('blocked', c.reason);
    if (!RUN_ID.test(c.runId)) return softSkip('blocked', `the created runId is not tenant-bound (${c.runId}) — the snapshot leg reports that; nothing to strip here`);
    const bare = c.runId.slice(c.runId.indexOf('/') + 1);
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(bare)}`));
    if (res === null) return softSkip('blocked', 'GET /runs/{bare runId} unreachable (fetch failed)');
    if (overlap) {
      expect(res.status, req('openwop.requirement.0170.id-grammar.bare-id', DOC, `through the overlap (protocolVersions ${versions.join(', ')} carries a 1.x member) a bare run id on a major-2 path MUST resolve under the caller's tenant — 200 for the run this caller just created; got ${res.status} ${readErrorCode(res.json) ?? ''}`)).toBe(200);
      expect((res.json as { runId?: unknown } | undefined)?.runId, req('openwop.requirement.0170.id-grammar.bare-id', DOC, 'a resource reached by its bare id MUST still be named by its bound projection in the major-2 response body (versioning.md §5) — the affordance is on the path parameter, never in a document')).toBe(c.runId);
    } else {
      expect(res.status, req('openwop.requirement.0170.id-grammar.bare-id', DOC, `after the overlap (protocolVersions ${versions.join(', ')} carries no 1.x member) the bare form MUST be refused 400 validation_error — the v1 spelling has nothing left to bridge; got ${res.status} ${readErrorCode(res.json) ?? ''}`)).toBe(400);
      expect(readErrorCode(res.json), req('openwop.requirement.0170.id-grammar.bare-id', 'spec/v2/core/errors.md', 'the refusal MUST carry validation_error — not id_tenant_mismatch (no segment to mismatch) and not not_found (a form the host no longer admits is not looked up)')).toBe('validation_error');
    }
  });
});
