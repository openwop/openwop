/**
 * v2 — `interrupt.resolved` records the instrument of a token resolution
 * (RFC 0259; the rules are `$defs/interruptResolved.resolvedBy` and
 * `.resolvedVia` in `schemas/v2/run-event-payloads.schema.json`, and the
 * `interrupt.resolvedVia` facet in `spec/v2/facets/interrupt.schema.json`).
 *
 * Server-free (always on):
 *   1. `0259.shape` — `resolvedVia` is a closed object with a REQUIRED
 *      `scheme` from a closed vocabulary; `tokenRef` is opaque; `boundTo` is a
 *      Subject of kind `user` or `agent` with a non-legacy issuer.
 *
 * Host legs — each needs the resume token, which v2 gives no unaided way to
 * read (interrupt.md: the signed-token surface is a SHOULD and the suite cannot
 * mint a token). They are gated on the seams profile and the
 * `readInterruptToken` seam (RFC 0259 §C.1): unadvertised → `inapplicable`; an
 * advertised profile with the seam unwired → `blocked`.
 *   2. `0259.token-resolve-names-no-subject` — UNCONDITIONAL (§A.1): an
 *      unauthenticated `POST /interrupts/{token}` records no `resolvedBy`.
 *   3. `0259.resolved-via-recorded` — gated on `interrupt.resolvedVia: true`:
 *      the same resolution records `resolvedVia.scheme: "interrupt-token"`
 *      and, with no binding asked for, no `boundTo`.
 *   4. `0259.token-ref-opaque` — gated as 3, and on `tokenRef` being present:
 *      it is not the token, contains no segment of it, and is not a prefix of
 *      a digest of the token or a segment in hex, base64 or base64url.
 *   5. `0259.run-resolve-no-via` — gated as 3: a run-scoped resolution
 *      records no `resolvedVia`.
 *   6. `0259.bound-to-caller` — gated as 3, and on the seam returning
 *      `resumeValueMembers` for `bind: true`: `boundTo` deep-equals the
 *      `run.started.owner.subject` of the run the caller created.
 *   7. `0259.forged-binding-binds-no-one` — gated as 6: the same binding with
 *      every returned member altered by one character (a token bound to the
 *      caller, presented as bound to someone else) records no `boundTo`; the
 *      host may refuse the resolution instead.
 *
 * Fork copying `resolvedVia` verbatim (§A.5) is not a leg here: it is the
 * general rule that a fork copies the recorded resolution, witnessed for
 * `decision` / `action` / `reason` by `v2-approval-reject-disposition` leg 9.
 *
 * @see RFCS/0259-interrupt-resolved-via.md
 * @see spec/v2/core/interrupt.md §Resolve surfaces
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { SEAMS_PREFIX, seamsProfileAdvertised } from '../lib/seams.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';

const DOC = 'run-event-payloads.schema.json $defs/interruptResolved.resolvedBy + .resolvedVia (RFC 0259)';
const R = (slug: string): string => `openwop.requirement.0259.${slug}`;
const FIXTURE = 'conformance-approval';
const NODE_ID = 'gate';
const SEAM = `${SEAMS_PREFIX}/sample/interrupts/token`;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface Ev { type?: string; nodeId?: string; sequence?: number; payload?: Record<string, unknown> }

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const obj = (x: unknown): Record<string, unknown> | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);

async function snapshot(runId: string): Promise<Record<string, unknown> | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}`));
  return res?.status === 200 ? (obj(res.json) ?? null) : null;
}
async function waitStatus(runId: string, wanted: ReadonlySet<string>): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + scaledTimeoutMs(10_000);
  for (;;) {
    const s = await snapshot(runId);
    if (s !== null && wanted.has(String(s['status']))) return s;
    if (Date.now() > deadline) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function logOf(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = obj(res?.json)?.['events'];
  return Array.isArray(events) ? (events as Ev[]) : [];
}
async function resolvedPayload(runId: string): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + scaledTimeoutMs(10_000);
  for (;;) {
    const e = (await logOf(runId)).find((x) => x.type === 'interrupt.resolved' && x.nodeId === NODE_ID);
    if (e) return obj(e.payload);
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** A suspended `conformance-approval` run, or why there is none. */
async function suspended(): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
  const runId = obj(res?.json)?.['runId'];
  if (res === null || res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${FIXTURE}) answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''}`.trim() };
  const s = await waitStatus(runId, new Set(['waiting-approval', ...TERMINAL]));
  if (s?.['status'] !== 'waiting-approval') return { reason: `the ${FIXTURE} run did not suspend on its approval gate (status ${String(s?.['status'])})` };
  return { runId };
}

type Gate = { inapplicable: string } | { blocked: string } | { ok: true; doc: Record<string, unknown> | null };
async function seamGate(): Promise<Gate> {
  if (!isFixtureAdvertised(FIXTURE)) return { inapplicable: `fixture ${FIXTURE} is not advertised` };
  const d = await v2Discovery().catch(() => null);
  if (!seamsProfileAdvertised(d)) return { inapplicable: 'seams profile not advertised — v2 gives the suite no unaided way to read a resume token (interrupt.md §Resolve surfaces), so a token resolution is seam-gated' };
  return { ok: true, doc: d };
}
const facetOn = (doc: Record<string, unknown> | null): boolean => obj(doc?.['interrupt'])?.['resolvedVia'] === true;

/** Suspend, read the token (and a binding when asked), resolve accept through the token surface unauthenticated. */
const alter = (v: unknown): unknown => (typeof v === 'string' && v.length > 0 ? `${v.slice(0, -1)}${v.endsWith('x') ? 'y' : 'x'}` : v);

async function tokenResolution(bind: boolean, forge = false): Promise<{ runId: string; token: string; bound: boolean; refused: boolean; payload: Record<string, unknown> | undefined } | { blocked: string } | { inapplicable: string }> {
  const s = await suspended();
  if ('reason' in s) return { blocked: s.reason };
  const seam = await http(() => driver.post(SEAM, { runId: s.runId, nodeId: NODE_ID, ...(bind ? { bind: true } : {}) }));
  const token = obj(seam?.json)?.['token'];
  if (seam === null || seam.status !== 200 || typeof token !== 'string') return { blocked: `the readInterruptToken seam answered ${seam?.status ?? 'nothing'} (RFC 0259 §C.1) — the token resolution is unobserved` };
  const members = obj(obj(seam.json)?.['resumeValueMembers']);
  if (bind && members === undefined) return { inapplicable: 'the host returned no resumeValueMembers for bind: true — it binds no presentation to this caller' };
  const presented = forge && members !== undefined ? Object.fromEntries(Object.entries(members).map(([k, v]) => [k, alter(v)])) : members;
  const res = await http(() => driver.post(`/interrupts/${enc(token)}`, { resumeValue: { action: 'accept', ...(presented ?? {}) } }, { authenticated: false }));
  if (forge && res !== null && (res.status === 400 || res.status === 403)) return { runId: s.runId, token, bound: false, refused: true, payload: undefined };
  if (res === null || res.status < 200 || res.status >= 300) return { blocked: `POST /interrupts/{token} answered ${res?.status ?? 'nothing'} ${readErrorCode(res?.json) ?? ''} — interrupt resolution owns that contract` };
  return { runId: s.runId, token, bound: members !== undefined, refused: false, payload: await resolvedPayload(s.runId) };
}

let unbound: ReturnType<typeof tokenResolution> | undefined;
const unboundResolution = (): ReturnType<typeof tokenResolution> => (unbound ??= tokenResolution(false));

/** sha256 of `s` in hex, base64 and base64url — the bare digests a token-derived tokenRef would carry. */
function digests(s: string): string[] {
  const d = createHash('sha256').update(s).digest();
  return [d.toString('hex'), d.toString('base64').replace(/=+$/, ''), d.toString('base64url')];
}
/**
 * Why `tokenRef` is not opaque, if it is not. A tokenRef carrying a bare digest
 * of the token, or any prefix of one, shares an 8-character run with that
 * digest; for an independent value the chance of that is negligible (an
 * 8-character run over a 64-symbol alphabet), so the test has no practical
 * false positive and catches the truncated-hash convention.
 */
function tokenRefFindings(tokenRef: string, token: string): string[] {
  const out: string[] = [];
  const segments = [token, ...token.split('.').filter((x) => x.length >= 8)];
  const windows = Array.from({ length: Math.max(0, tokenRef.length - 7) }, (_, i) => tokenRef.slice(i, i + 8));
  for (const seg of segments) {
    if (tokenRef.includes(seg)) out.push('tokenRef MUST NOT equal or contain the token or any of its segments');
    if (digests(seg).some((d) => windows.some((w) => d.includes(w)))) out.push('tokenRef MUST NOT be computable from the token without a host-held secret: it shares a run with a bare sha256 of the token or a segment');
  }
  return out;
}

describe('v2 RFC 0259 — resolvedVia wire shape (server-free)', () => {
  it('resolvedVia is a closed object with a registered scheme; boundTo is a non-legacy user or agent Subject', () => {
    const v = v2RefValidator('run-event-payloads.schema.json#/$defs/interruptResolved');
    const base = { nodeId: 'gate', interruptId: 'acme/0123456789abcdef', kind: 'approval', decision: 'granted', action: 'accept' };
    const person = { issuer: 'urn:example:session', subjectId: 'u_7f3a9c1e', tenant: 'acme', lane: 'session', kind: 'user' };
    expect(v(base).ok, req(R('shape'), DOC, 'interrupt.resolved without resolvedVia MUST validate')).toBe(true);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token' } }).ok, req(R('shape'), DOC, 'a bare token resolution (no resolvedBy) with resolvedVia MUST validate')).toBe(true);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', tokenRef: 'tr_0000synthetic0000', boundTo: person } }).ok, req(R('shape'), DOC, 'tokenRef and a user boundTo MUST validate')).toBe(true);
    expect(v({ ...base, resolvedVia: {} }).ok, req(R('shape'), DOC, 'scheme is REQUIRED')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'share-link' } }).ok, req(R('shape'), DOC, 'an unregistered scheme MUST fail')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', token: 'ow2.hs256.k.p.m' } }).ok, req(R('shape'), DOC, 'resolvedVia is closed: a token member MUST fail')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', tokenRef: 'ow2.hs256.k.p.m' } }).ok, req(R('shape'), DOC, 'tokenRef is opaque: a dotted token-shaped value MUST fail the grammar')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', boundTo: { ...person, kind: 'anonymous', lane: 'anonymous' } } }).ok, req(R('shape'), DOC, 'boundTo of kind anonymous MUST fail')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', boundTo: { ...person, kind: 'workload', lane: 'workload' } } }).ok, req(R('shape'), DOC, 'boundTo of kind workload MUST fail')).toBe(false);
    expect(v({ ...base, resolvedVia: { scheme: 'interrupt-token', boundTo: { ...person, issuer: 'urn:openwop:legacy' } } }).ok, req(R('shape'), DOC, 'boundTo with the legacy issuer MUST fail')).toBe(false);
  });
});

describe('v2 RFC 0259 — token resolutions (host, seam-gated)', () => {
  it('an unauthenticated token resolution records no resolvedBy', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    const r = await unboundResolution();
    if ('inapplicable' in r) return softSkip('inapplicable', r.inapplicable);
    if ('blocked' in r) return seamAbsent(r.blocked);
    expect(r.payload, req(R('token-resolve-names-no-subject'), DOC, 'the token resolution logged no interrupt.resolved for the gate')).toBeDefined();
    expect(r.payload?.['resolvedBy'], req(R('token-resolve-names-no-subject'), DOC, 'a resolution whose request authenticated nothing MUST NOT record resolvedBy (§A.1)')).toBeUndefined();
  });

  it('a host advertising interrupt.resolvedVia records scheme interrupt-token and no boundTo on an unbound token resolution', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    if (!facetOn(g.doc)) return softSkip('inapplicable', 'interrupt.resolvedVia is not advertised');
    const r = await unboundResolution();
    if ('inapplicable' in r) return softSkip('inapplicable', r.inapplicable);
    if ('blocked' in r) return seamAbsent(r.blocked);
    const via = obj(r.payload?.['resolvedVia']);
    expect(via?.['scheme'], req(R('resolved-via-recorded'), DOC, 'a host advertising interrupt.resolvedVia MUST record resolvedVia.scheme "interrupt-token" on a token resolution')).toBe('interrupt-token');
    expect(via?.['boundTo'], req(R('resolved-via-recorded'), DOC, 'boundTo MUST be absent when the host bound the presentation to no one')).toBeUndefined();
  });

  it('tokenRef, when present, is not the token and not computable from it', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    if (!facetOn(g.doc)) return softSkip('inapplicable', 'interrupt.resolvedVia is not advertised');
    const r = await unboundResolution();
    if ('inapplicable' in r) return softSkip('inapplicable', r.inapplicable);
    if ('blocked' in r) return seamAbsent(r.blocked);
    const tokenRef = obj(r.payload?.['resolvedVia'])?.['tokenRef'];
    if (typeof tokenRef !== 'string') return softSkip('inapplicable', 'the host records no tokenRef (OPTIONAL)');
    expect(tokenRefFindings(tokenRef, r.token), req(R('token-ref-opaque'), DOC, 'tokenRef MUST NOT equal, contain or be a bare digest of the token or its segments (§A.3)')).toEqual([]);
  });

  it('a run-scoped resolution records no resolvedVia', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    if (!facetOn(g.doc)) return softSkip('inapplicable', 'interrupt.resolvedVia is not advertised');
    const s = await suspended();
    if ('reason' in s) return seamAbsent(s.reason);
    const res = await http(() => driver.post(`/runs/${enc(s.runId)}/interrupts/${enc(NODE_ID)}`, { resumeValue: { action: 'accept' } }));
    if (res === null || res.status < 200 || res.status >= 300) return seamAbsent(`the run-scoped resolve answered ${res?.status ?? 'nothing'} — interrupt resolution owns that contract`);
    const payload = await resolvedPayload(s.runId);
    expect(payload, req(R('run-resolve-no-via'), DOC, 'the run-scoped resolution logged no interrupt.resolved for the gate')).toBeDefined();
    expect(payload?.['resolvedVia'], req(R('run-resolve-no-via'), DOC, 'resolvedVia MUST NOT be recorded on a resolution that presented no token')).toBeUndefined();
  });

  it('a binding the host made to the caller is recorded as boundTo, equal to the caller\'s owner subject', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    if (!facetOn(g.doc)) return softSkip('inapplicable', 'interrupt.resolvedVia is not advertised');
    const r = await tokenResolution(true);
    if ('inapplicable' in r) return softSkip('inapplicable', r.inapplicable);
    if ('blocked' in r) return seamAbsent(r.blocked);
    const owner = obj(obj((await logOf(r.runId)).find((e) => e.type === 'run.started')?.payload?.['owner'])?.['subject']);
    if (owner === undefined) return seamAbsent('run.started carried no owner.subject to compare boundTo against');
    expect(obj(r.payload?.['resolvedVia'])?.['boundTo'], req(R('bound-to-caller'), DOC, 'boundTo MUST be the Subject the host bound the presentation to, built with the owner.subject mapping (§A.4)')).toEqual(owner);
    expect(r.payload?.['resolvedBy'], req(R('bound-to-caller'), DOC, 'a bound but unauthenticated presentation still MUST NOT record resolvedBy (§A.1)')).toBeUndefined();
  });

  it('a binding altered to claim someone else binds no one', async () => {
    const g = await seamGate();
    if ('inapplicable' in g) return softSkip('inapplicable', g.inapplicable);
    if ('blocked' in g) return seamAbsent(g.blocked);
    if (!facetOn(g.doc)) return softSkip('inapplicable', 'interrupt.resolvedVia is not advertised');
    const r = await tokenResolution(true, true);
    if ('inapplicable' in r) return softSkip('inapplicable', r.inapplicable);
    if ('blocked' in r) return seamAbsent(r.blocked);
    if (r.refused) {
      expect(r.refused, req(R('forged-binding-binds-no-one'), DOC, 'refusing a presentation whose binding does not verify satisfies §A.4')).toBe(true);
      return;
    }
    expect(obj(r.payload?.['resolvedVia'])?.['boundTo'], req(R('forged-binding-binds-no-one'), DOC, 'a host MUST NOT set boundTo from a binding it did not make (§A.4)')).toBeUndefined();
    expect(r.payload?.['resolvedBy'], req(R('forged-binding-binds-no-one'), DOC, 'and MUST NOT record the claimed name in resolvedBy (§A.1)')).toBeUndefined();
  });
});
