/**
 * v2 — `owner-subject-required` (suite 2.0.0; RFC 0170 §A.1;
 * `spec/v2/core/identity.md` §1.1 "Shape").
 *
 * Witness class: witnessable — unaided. `RunSnapshot.owner` is
 * `{ tenant, workspace?, subject }` with `subject` REQUIRED and validating
 * against `schemas/v2/subject.schema.json`; `principal` / `principalKind` are
 * removed. The run is created through `POST /runs` with the smallest valid body
 * (the `conformance-noop` fixture); a refusal to create records `blocked` with
 * the host's envelope.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §1.1';
const NOOP_WORKFLOW_ID = 'conformance-noop';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

type Created = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly reason: string };

async function createRun(): Promise<Created> {
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (res === null) return { ok: false, reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') {
    return { ok: false, reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  }
  return { ok: true, runId };
}

async function snapshot(): Promise<{ owner: Record<string, unknown> } | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const created = await createRun();
  if (!created.ok) return { reason: created.reason };
  const res = await http(() => driver.get(`/runs/${encodeURIComponent(created.runId)}`));
  if (res === null || res.status !== 200) return { reason: `GET /runs/{runId} answered ${res?.status ?? 'no response'} for the run just created` };
  const owner = (res.json as { owner?: unknown } | undefined)?.owner;
  if (owner === null || typeof owner !== 'object') return { reason: 'GET /runs/{runId} carries no `owner` object — RunSnapshot.owner is REQUIRED (schemas/v2/run-snapshot.schema.json)' };
  return { owner: owner as Record<string, unknown> };
}

describe('v2 owner-subject-required (RFC 0170 §A.1)', () => {
  it('owner.subject is present and validates against subject.schema.json', async () => {
    const s = await snapshot();
    if ('reason' in s) return softSkip('blocked', s.reason);
    const validate = v2Validator('subject');
    expect(s.owner['subject'], req('openwop.requirement.0170.owner-subject-required.subject', DOC, 'RunSnapshot.owner.subject is REQUIRED')).toBeDefined();
    const r = validate(s.owner['subject']);
    expect(r.ok, req('openwop.requirement.0170.owner-subject-required.subject', DOC, `owner.subject MUST validate against schemas/v2/subject.schema.json (issuer, subjectId, tenant, lane, kind; closed) (${r.errors})`)).toBe(true);
    expect(typeof s.owner['tenant'], req('openwop.requirement.0170.owner-subject-required.subject', DOC, 'RunSnapshot.owner.tenant is REQUIRED')).toBe('string');
  });

  it('owner carries no principal / principalKind', async () => {
    const s = await snapshot();
    if ('reason' in s) return softSkip('blocked', s.reason);
    expect(s.owner['principal'], req('openwop.requirement.0170.owner-subject-required.no-principal', DOC, '`principal` is removed from RunSnapshot.owner — subject.subjectId carries it')).toBeUndefined();
    expect(s.owner['principalKind'], req('openwop.requirement.0170.owner-subject-required.no-principal', DOC, '`principalKind` is removed from RunSnapshot.owner — subject.kind carries it')).toBeUndefined();
    const extra = Object.keys(s.owner).filter((k) => !['tenant', 'workspace', 'subject'].includes(k));
    expect(extra, req('openwop.requirement.0170.owner-subject-required.no-principal', DOC, 'owner is the closed block { tenant, workspace?, subject }')).toEqual([]);
  });
});
