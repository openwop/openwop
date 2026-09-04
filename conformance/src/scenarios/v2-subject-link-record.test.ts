/**
 * v2 — `subject-link-record` (suite 2.0.0; RFC 0170 §C.1;
 * `spec/v2/core/identity.md` §3 "The link is a record";
 * `schemas/v2/subject-link.schema.json`).
 *
 * Witness class: seam-gated (`openwop-conformance-seams-v2`). Advertising both
 * the `saml` and `scim` lanes implies the linking contract. Through the RFC
 * 0163 seams (`POST /conformance/seams/sample/auth/scim/provision`,
 * `POST /conformance/seams/sample/auth/saml/validate` — the v1-shaped paths
 * through `seamPath()`) a SCIM-provisioned user and a SAML assertion carrying
 * the same persistent NameID form a link; the record MUST validate against
 * `subject-link.schema.json` (closed; two SubjectRefs; never legacy or
 * anonymous), and deactivation MUST set `deniedAt` and deny the SAML path. The
 * record is read from the seam responses (`link`) or from
 * `GET …/auth/subject-links?externalId=`; a host that surfaces neither records
 * `blocked`. Opt-in: `OPENWOP_TEST_SAML_IDP_URL` + `OPENWOP_TEST_SCIM_URL`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator, familyAdvertised } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §3';
const PROVISION = seamPath('/v1/host/sample/auth/scim/provision');
const VALIDATE = seamPath('/v1/host/sample/auth/saml/validate');
const LINKS = seamPath('/v1/host/sample/auth/subject-links');

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

type Formed = { readonly link: Record<string, unknown>; readonly externalId: string; readonly idpUrl: string; readonly scimUrl: string } | { readonly kind: 'blocked' | 'inapplicable' | 'skipped' | 'absent'; readonly reason: string };

function linkOf(json: unknown): Record<string, unknown> | null {
  const l = (json as { link?: unknown } | undefined)?.link;
  return l !== null && typeof l === 'object' && !Array.isArray(l) ? (l as Record<string, unknown>) : null;
}

async function readLink(externalId: string): Promise<Record<string, unknown> | null> {
  const res = await http(() => driver.get(`${LINKS}?externalId=${encodeURIComponent(externalId)}`));
  if (res === null || res.status !== 200) return null;
  const body = res.json as { link?: unknown; links?: unknown } | undefined;
  const direct = linkOf(body);
  if (direct !== null) return direct;
  const arr = body?.links;
  return Array.isArray(arr) && arr.length > 0 && arr[0] !== null && typeof arr[0] === 'object' ? (arr[0] as Record<string, unknown>) : null;
}

/** Provision + assert; returns the link record the seams surfaced, or a reason. */
async function form(): Promise<Formed> {
  const doc = await discovery();
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'blocked', reason: 'seams profile not advertised (conformance.seamsProfile !== openwop-conformance-seams-v2) — the link record is seam-gated' };
  const auth = await familyAdvertised('auth');
  const lanes = new Set((Array.isArray(auth?.['lanes']) ? (auth['lanes'] as Array<Record<string, unknown>>) : []).map((l) => String(l['lane'])));
  if (!(lanes.has('saml') && lanes.has('scim'))) return { kind: 'inapplicable', reason: 'the host does not advertise both the saml and scim lanes — advertising both is what implies the linking contract (row C2.5)' };
  const idpUrl = process.env['OPENWOP_TEST_SAML_IDP_URL'];
  const scimUrl = process.env['OPENWOP_TEST_SCIM_URL'];
  if (!idpUrl || !scimUrl) return { kind: 'skipped', reason: 'opt-in not supplied: OPENWOP_TEST_SAML_IDP_URL and OPENWOP_TEST_SCIM_URL are required to drive the SCIM/SAML seams' };

  const externalId = `idp-op-${Date.now().toString(36)}`;
  const provision = await http(() => driver.post(PROVISION, { scimUrl, op: 'create-user', externalId, userName: 'r.smith' }));
  if (provision === null) return { kind: 'blocked', reason: `${PROVISION} unreachable (fetch failed)` };
  if (provision.status === 404 || provision.status === 403) return { kind: 'absent', reason: `${PROVISION} not mounted (${provision.status})` };
  const assertion = await http(() => driver.post(VALIDATE, { idpUrl, variant: 'valid', nameId: externalId }));
  if (assertion === null) return { kind: 'blocked', reason: `${VALIDATE} unreachable (fetch failed)` };
  if (assertion.status === 404 || assertion.status === 403) return { kind: 'absent', reason: `${VALIDATE} not mounted (${assertion.status})` };
  const link = linkOf(assertion.json) ?? linkOf(provision.json) ?? (await readLink(externalId));
  if (link === null) return { kind: 'absent', reason: `neither seam response carries \`link\` and ${LINKS}?externalId= is not served — the SubjectLink record RFC 0170 §C.1 defines is not surfaced by this host` };
  return { link, externalId, idpUrl, scimUrl };
}

describe('v2 subject-link-record (RFC 0170 §C.1 — seam-gated)', () => {
  it('the link formed across SCIM and SAML is a closed SubjectLink record', async () => {
    const f = await form();
    if ('kind' in f) return f.kind === 'absent' ? seamAbsent(f.reason) : softSkip(f.kind, f.reason);
    const r = v2Validator('subject-link')(f.link);
    expect(r.ok, req('openwop.requirement.0170.subject-link-record.shape', DOC, `the link MUST validate against schemas/v2/subject-link.schema.json — { a, b, keyClass, issuer, tenant, formedAt, deniedAt? }, closed, never a legacy or anonymous subject (${r.errors})`)).toBe(true);
    const a = f.link['a'] as { issuer?: unknown; subjectId?: unknown };
    const b = f.link['b'] as { issuer?: unknown; subjectId?: unknown };
    expect(`${String(a.issuer)}/${String(a.subjectId)}` !== `${String(b.issuer)}/${String(b.subjectId)}`, req('openwop.requirement.0170.subject-link-record.shape', DOC, 'a link MUST join exactly two distinct subjects')).toBe(true);
    expect(f.link['deniedAt'], req('openwop.requirement.0170.subject-link-record.shape', DOC, 'a freshly formed link carries no deniedAt')).toBeUndefined();
  });

  it('deactivation sets deniedAt and the SAML decision path consults it', async () => {
    const f = await form();
    if ('kind' in f) return f.kind === 'absent' ? seamAbsent(f.reason) : softSkip(f.kind, f.reason);
    const deactivate = await http(() => driver.post(PROVISION, { scimUrl: f.scimUrl, op: 'deactivate-user', externalId: f.externalId }));
    expect(deactivate !== null && deactivate.status < 400, req('openwop.requirement.0170.subject-link-record.denied-at', DOC, `SCIM deactivation MUST succeed (got ${deactivate?.status ?? 'no response'})`)).toBe(true);
    const after = await http(() => driver.post(VALIDATE, { idpUrl: f.idpUrl, variant: 'valid', nameId: f.externalId }));
    const denied = linkOf(deactivate?.json) ?? linkOf(after?.json) ?? (await readLink(f.externalId));
    if (denied === null) return seamAbsent('the deactivated link record is not surfaced by the seams — deniedAt cannot be read');
    expect(typeof denied['deniedAt'] === 'string' && !Number.isNaN(Date.parse(denied['deniedAt'] as string)), req('openwop.requirement.0170.subject-link-record.denied-at', DOC, 'deactivation MUST set deniedAt (date-time) on the link record')).toBe(true);
    expect((after?.json as { authenticated?: unknown } | undefined)?.authenticated === true, req('openwop.requirement.0170.subject-link-record.denied-at', DOC, 'after deniedAt is set the SAML decision path MUST deny the linked subject (the leaver contract)')).toBe(false);
  });
});
