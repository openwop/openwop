/**
 * v2-a2ui-v09-surface — RFC 0209 §A.1, §A.2, §C.9, §C.11, §C.12, the seam-gated
 * legs (suite 2.36.0, target major 2).
 *
 * `ui.a2ui-surface` at per-kind schema version 2 carries A2UI v0.9 messages. The
 * suite cannot make a model emit a chosen envelope, so every leg here drives the
 * v2 emit-surface seam (`POST /conformance/seams/sample/a2ui/emit-surface`,
 * api/seams-v2.yaml), which a host MUST route through its production envelope
 * admission. The server-free legs (profile ⊂ upstream, the excluded affordances,
 * the pinned catalog, the kind carve-out) are corpus rows in
 * `src/coherence/a2ui-v09-profile.test.ts`.
 *
 * Gates, all decided before any assertion so a skipped leg never records a
 * partial witness: the seams profile advertised; `schemaVersions.kinds` giving
 * the kind a floor of at least 2 (version-2 legs) or exactly 1 (the legacy leg);
 * the seam answering something other than 404/405. Any of these absent ⇒
 * `inapplicable` — a leg never passes on a non-answer.
 *
 * Every refusal leg carries an admitted control in the same run, so a host that
 * refuses everything fails as surely as one that refuses nothing.
 *
 * The last describe accounts for §C.9's `render-needs-root`, whose
 * Falsifiability verdict is `unwitnessable`: the guarantee is render-side, and
 * a server-oriented suite cannot observe a renderer. It records `inapplicable`
 * on EVERY host, before any request and before the seam gate, and names where
 * the real witness lives: a reference-app client probe, `tier: reference-impl`,
 * following the `a2ui-surface-no-code-exec` precedent. It never asserts and
 * cannot become a pass.
 *
 * @see RFCS/0209-v2-a2ui-surfaces-are-a2ui-v0-9.md
 * @see spec/v2/ext/a2uiSurface/README.md
 * @see spec/v2/core/events.md §"The envelope-kind catalog"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { FIXTURES_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const KIND = 'ui.a2ui-surface';
const SEAM = `${SEAMS_PREFIX}/sample/a2ui/emit-surface`;
const FIXTURE = 'conformance-approval';
const GATE_NODE = 'gate';
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const POSITIVE = JSON.parse(readFileSync(join(FIXTURES_DIR, 'a2ui-v09', 'positive-approve-brief.json'), 'utf8')) as Json;
const V1_SURFACE: Json = { catalogVersion: '0.9.1', surface: { title: 'Kickoff', components: [{ component: 'heading', text: 'Kickoff', level: 2 }, { component: 'action.button', id: 'go', label: 'Go', action: { target: 'resume' } }] } };
const V1_LATER: Json = { catalogVersion: '0.9.1', surface: { title: 'Kickoff, later', components: [{ component: 'heading', text: 'Kickoff, later', level: 2 }] } };

let seq = 0;
const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
function envelope(schemaVersion: number, payload: unknown, opts: { trust?: 'trusted' | 'untrusted'; nodeId?: string } = {}): Json {
  seq += 1;
  const meta: Json = { source: 'ai-generation', ts: new Date().toISOString() };
  if (opts.trust) meta['contentTrust'] = opts.trust;
  return { type: KIND, schemaVersion, envelopeId: `env-0209-${nonce}-${seq}`, correlationId: `corr-0209-${nonce}-${seq}`, ...(opts.nodeId ? { nodeId: opts.nodeId } : {}), payload, meta };
}
/** A version-2 payload for `surfaceId` carrying `messages` (surfaceId stamped into each). */
function v2(surfaceId: string, messages: Json[]): Json {
  return { version: 'v0.9', catalogId: CATALOG, surfaceId, messages: messages.map((m) => { const c = clone(m); const body = Object.entries(c).find(([k]) => k !== 'version')?.[1] as Json; body['surfaceId'] = surfaceId; return c; }) };
}
const createMsg = (): Json => ({ version: 'v0.9', createSurface: { surfaceId: '', catalogId: CATALOG } });
const componentsMsg = (): Json => clone((POSITIVE['messages'] as Json[])[1]);
const dataMsg = (): Json => ({ version: 'v0.9', updateDataModel: { surfaceId: '', value: { name: 'x' } } });
const deleteMsg = (): Json => ({ version: 'v0.9', deleteSurface: { surfaceId: '' } });
const sid = (tag: string): string => `s-${tag}-${nonce}`;

async function emit(runId: string, env: Json): Promise<OpenWOPResponse> {
  return driver.post(SEAM, { runId, envelope: env });
}
const code = (r: OpenWOPResponse): string => `${r.status} ${readErrorCode(r.json) ?? ''}`.trim();

async function waitStatus(runId: string, wanted: ReadonlySet<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    const status = res.status === 200 ? String((res.json as { status?: unknown } | null)?.status ?? '') : null;
    if (status !== null && wanted.has(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 250));
  }
}

type Ctx = { readonly floor: number; readonly strict: boolean; readonly runId: string };
type Gate = { ok: true; ctx: Ctx } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

/** Everything a leg needs, decided before its first assertion. `want` is the floor predicate. */
async function gate(want: (floor: number) => boolean, wantText: string): Promise<Gate> {
  const doc = await v2Discovery();
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  if (!seamsProfileAdvertised(doc)) return { ok: false, kind: 'inapplicable', reason: 'host does not advertise conformance.seamsProfile: openwop-conformance-seams-v2 — the emit-surface seam is the only way the suite can choose an envelope (RFC 0209 Falsifiability)' };
  const kinds = ((doc['schemaVersions'] as Json | undefined)?.['kinds'] ?? {}) as Json;
  const floor = typeof kinds[KIND] === 'number' ? (kinds[KIND] as number) : 0;
  if (!want(floor)) return { ok: false, kind: 'inapplicable', reason: `schemaVersions.kinds["${KIND}"] is ${floor}; this leg needs ${wantText}` };
  const strict = ((doc['envelopeStrictness'] as Json | undefined)?.['mode']) === 'strict';
  const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
  if (!fixtures.includes(FIXTURE)) return { ok: false, kind: 'inapplicable', reason: `the host does not advertise the ${FIXTURE} fixture the legs run inside` };
  const create = await driver.post('/runs', { workflowId: FIXTURE });
  if (create.status !== 201) return { ok: false, kind: 'blocked', reason: `POST /runs {workflowId: ${FIXTURE}} answered ${code(create)}` };
  const runId = (create.json as { runId: string }).runId;
  const status = await waitStatus(runId, new Set(['waiting-approval', 'completed', 'failed', 'cancelled']), 10_000);
  if (status !== 'waiting-approval') return { ok: false, kind: 'blocked', reason: `${FIXTURE} did not suspend (status ${status})` };
  // Probe the seam with a payload every host that has it must refuse (no createSurface first), so the probe records nothing.
  const probe = await emit(runId, envelope(floor, floor >= 2 ? v2(sid('probe'), [dataMsg()]) : { catalogVersion: '9.9.9', surface: { components: [] } }));
  if (probe.status === 404 || probe.status === 405) {
    await driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {});
    return { ok: false, kind: 'inapplicable', reason: `${SEAM} answered ${probe.status} — the emit-surface seam is not wired` };
  }
  return { ok: true, ctx: { floor, strict, runId } };
}
async function done(runId: string): Promise<void> { await driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}); }

/** Every subtree of `v`, depth-first. */
function* subtrees(v: unknown): Generator<unknown> {
  yield v;
  if (Array.isArray(v)) for (const x of v) yield* subtrees(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* subtrees(x);
}
const carries = (events: unknown[], payload: unknown): boolean => {
  const want = JSON.stringify(payload);
  return events.some((e) => [...subtrees((e as Json)['payload'])].some((s) => JSON.stringify(s) === want));
};
async function eventsOf(runId: string): Promise<unknown[]> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  const ev = (r.json as { events?: unknown } | null)?.events;
  return Array.isArray(ev) ? ev : [];
}

describe('RFC 0209 §A.1 — the schema version selects the branch (seam-gated)', () => {
  it('a version-2 envelope carrying a version-1 body is refused; the positive is admitted; above the floor is refused; below it follows envelopeStrictness', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId, floor, strict } = g.ctx;
    try {
      const good = await emit(runId, envelope(2, v2(sid('vsb-good'), (POSITIVE['messages'] as Json[]))));
      expect(good.status, req('openwop.requirement.0209.version-selects-branch', 'RFC 0209 §A.1', `the positive version-2 surface MUST be admitted (201), got ${code(good)}`)).toBe(201);
      expect(typeof (good.json as { sequence?: unknown } | null)?.sequence, req('openwop.requirement.0209.version-selects-branch', 'api/seams-v2.yaml emitA2uiSurface', 'a 201 names the recording event sequence')).toBe('number');
      const mixed = await emit(runId, envelope(2, V1_SURFACE));
      expect(mixed.status, req('openwop.requirement.0209.version-selects-branch', 'RFC 0209 §A.1', `a schemaVersion 2 envelope with a payloadV1 body MUST be refused — validating against the anyOf union would admit it (got ${code(mixed)})`)).toBe(422);
      expect(readErrorCode(mixed.json), req('openwop.requirement.0209.version-selects-branch', 'spec/v2/ext/a2uiSurface/README.md §Versions', 'the refusal is envelope_invalid')).toBe('envelope_invalid');
      const above = await emit(runId, envelope(floor + 1, v2(sid('vsb-above'), [createMsg()])));
      expect(code(above), req('openwop.requirement.0209.version-selects-branch', 'events.md §"The envelope-kind catalog"', 'a schemaVersion above the floor MUST be refused with unknown_schema_version whatever the strictness')).toBe('422 unknown_schema_version');
      const below = await emit(runId, envelope(1, v2(sid('vsb-below'), [createMsg()])));
      if (strict) {
        expect(code(below), req('openwop.requirement.0209.version-selects-branch', 'events.md §"The envelope-kind catalog"', 'under strict, a schemaVersion 1 envelope below floor 2 MUST be refused with unknown_schema_version')).toBe('422 unknown_schema_version');
      } else {
        expect(below.status, req('openwop.requirement.0209.version-selects-branch', 'events.md §"The envelope-kind catalog"', `under warn, a schemaVersion 1 envelope is validated against the advertised version 2; a payloadV2 body is therefore admitted with a drift log (got ${code(below)})`)).toBe(201);
        const belowV1 = await emit(runId, envelope(1, V1_SURFACE));
        expect(code(belowV1), req('openwop.requirement.0209.version-selects-branch', 'RFC 0209 §A.1', 'under warn, a schemaVersion 1 envelope with a payloadV1 body is validated against version 2 and MUST be refused')).toBe('422 envelope_invalid');
      }
    } finally { await done(runId); }
  });
});

describe('RFC 0209 §C.9 — the fold is guarded at record time (seam-gated)', () => {
  it('no first createSurface, a message after deleteSurface, and a second createSurface are each refused; the valid steps are admitted', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    const R = (why: string) => req('openwop.requirement.0209.fold-guarded', 'RFC 0209 §C.9', why);
    try {
      const orphan = await emit(runId, envelope(2, v2(sid('fold-a'), [componentsMsg()])));
      expect(code(orphan), R('the first envelope for a surfaceId MUST begin with createSurface — updateComponents alone is refused, not recorded')).toBe('422 envelope_invalid');
      const bCreate = await emit(runId, envelope(2, v2(sid('fold-b'), [createMsg(), componentsMsg()])));
      expect(bCreate.status, R(`createSurface + updateComponents for a new surfaceId MUST be admitted (control), got ${code(bCreate)}`)).toBe(201);
      const bDelete = await emit(runId, envelope(2, v2(sid('fold-b'), [deleteMsg()])));
      expect(bDelete.status, R(`deleteSurface on a live surface MUST be admitted (control), got ${code(bDelete)}`)).toBe(201);
      const bAfter = await emit(runId, envelope(2, v2(sid('fold-b'), [dataMsg()])));
      expect(code(bAfter), R('a message after deleteSurface without a new createSurface MUST be refused')).toBe('422 envelope_invalid');
      const cCreate = await emit(runId, envelope(2, v2(sid('fold-c'), [createMsg()])));
      expect(cCreate.status, R(`createSurface for a new surfaceId MUST be admitted (control), got ${code(cCreate)}`)).toBe(201);
      const cAgain = await emit(runId, envelope(2, v2(sid('fold-c'), [createMsg()])));
      expect(code(cAgain), R('createSurface for a live surfaceId MUST be refused')).toBe('422 envelope_invalid');
      const bRecreate = await emit(runId, envelope(2, v2(sid('fold-b'), [createMsg(), dataMsg()])));
      expect(bRecreate.status, R(`a new createSurface after deleteSurface MUST be admitted (control), got ${code(bRecreate)}`)).toBe(201);
    } finally { await done(runId); }
  });
});

describe('RFC 0209 §A.2 — the cross-field rules are checked at admission (seam-gated)', () => {
  it('a createSurface.catalogId differing from the payload catalogId is refused', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    try {
      const p = v2(sid('cat'), [createMsg()]);
      ((p['messages'] as Json[])[0]['createSurface'] as Json)['catalogId'] = 'https://a2ui.org/specification/v0_9/catalogs/other/catalog.json';
      const r = await emit(runId, envelope(2, p));
      expect(code(r), req('openwop.requirement.0209.catalog-equality', 'RFC 0209 §A.2', 'a createSurface.catalogId MUST equal the payload catalogId; a differing one is refused, not recorded')).toBe('422 envelope_invalid');
      const ok = await emit(runId, envelope(2, v2(sid('cat-ok'), [createMsg()])));
      expect(ok.status, req('openwop.requirement.0209.catalog-equality', 'RFC 0209 §A.2', `the same payload with equal catalogIds MUST be admitted (control), got ${code(ok)}`)).toBe(201);
    } finally { await done(runId); }
  });

  it('a message whose surfaceId differs from the payload surfaceId is refused', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    try {
      const p = v2(sid('sid'), [createMsg(), componentsMsg()]);
      ((p['messages'] as Json[])[1]['updateComponents'] as Json)['surfaceId'] = sid('sid-other');
      const r = await emit(runId, envelope(2, p));
      expect(code(r), req('openwop.it.v2-a2ui-v09-surface.surface-id-equality', 'RFC 0209 §A.2', 'every message surfaceId MUST equal the payload surfaceId — the schema cannot express it, so the engine MUST refuse a mismatch')).toBe('422 envelope_invalid');
      const ok = await emit(runId, envelope(2, v2(sid('sid'), [createMsg(), componentsMsg()])));
      expect(ok.status, req('openwop.it.v2-a2ui-v09-surface.surface-id-equality', 'RFC 0209 §A.2', `the refused envelope left no trace: the same surfaceId is still new and admits createSurface (got ${code(ok)})`)).toBe(201);
    } finally { await done(runId); }
  });
});

describe('RFC 0209 §C.11 — recorded surfaces are returned as recorded (seam-gated)', () => {
  it('a recorded version-2 surface is returned byte-equal on poll and carried by a fork at a later fromSeq', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    try {
      const payload = v2(sid('rec'), (POSITIVE['messages'] as Json[]));
      const r = await emit(runId, envelope(2, payload));
      expect(r.status, req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'RFC 0209 §C.11', `the positive surface MUST be admitted, got ${code(r)}`)).toBe(201);
      const sequence = (r.json as { sequence: number }).sequence;
      const events = await eventsOf(runId);
      expect(carries(events, payload), req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'RFC 0209 §C.11', 'the run\'s poll MUST return the recorded surface payload byte-equal — no surface is regenerated')).toBe(true);
      // The surface is the last event of the suspended run, so `sequence + 1`
      // names no event and runs.md §Fork REQUIRES 422 fork_point_invalid for it.
      // Record one more envelope on the same surface and fork AT that event:
      // the surface (sequence < fromSeq) is fixed history, the later one re-executes.
      const later = await emit(runId, envelope(2, v2(sid('rec'), [dataMsg()])));
      expect(later.status, req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'RFC 0209 §C.9', `an updateDataModel on the live surface MUST be admitted (it supplies the fork point), got ${code(later)}`)).toBe(201);
      const fromSeq = (later.json as { sequence: number }).sequence;
      expect(fromSeq > sequence, req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'api/seams-v2.yaml emitA2uiSurface', `a later recording names a later sequence (surface ${sequence}, update ${fromSeq})`)).toBe(true);
      const fork = await driver.post(`/runs/${encodeURIComponent(runId)}:fork`, { mode: 'replay', fromSeq });
      expect(fork.status, req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'RFC 0209 §C.11', `POST :fork at fromSeq ${fromSeq} (a recorded event after the surface) MUST answer 201, got ${code(fork)}`)).toBe(201);
      const forkId = (fork.json as { runId: string }).runId;
      expect(carries(await eventsOf(forkId), payload), req('openwop.it.v2-a2ui-v09-surface.recorded-as-recorded', 'RFC 0209 §C.11', 'a fork at a fromSeq after the surface MUST carry it unchanged')).toBe(true);
      await done(forkId);
    } finally { await done(runId); }
  });

  it('a version-1 surface recorded at floor 1 is returned byte-equal on poll and carried by a fork', async () => {
    const g = await gate((f) => f === 1, 'a floor of exactly 1 — a host whose floor is 2 has no admission path for a version-1 surface, and the suite cannot seed one (RFC 0209 §C.11 holds for what it recorded before raising the floor)');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    try {
      const r = await emit(runId, envelope(1, V1_SURFACE));
      expect(r.status, req('openwop.requirement.0209.legacy-readable', 'RFC 0209 §C.11', `a version-1 surface at floor 1 MUST be admitted, got ${code(r)}`)).toBe(201);
      const sequence = (r.json as { sequence: number }).sequence;
      expect(carries(await eventsOf(runId), V1_SURFACE), req('openwop.requirement.0209.legacy-readable', 'RFC 0209 §C.11', 'the poll MUST return the version-1 surface byte-equal')).toBe(true);
      // As in the version-2 leg: fork at a recorded event after the surface, never at `sequence + 1` (no such event; 422 fork_point_invalid).
      const later = await emit(runId, envelope(1, V1_LATER));
      expect(later.status, req('openwop.requirement.0209.legacy-readable', 'RFC 0209 §C.11', `a second version-1 surface at floor 1 MUST be admitted (it supplies the fork point), got ${code(later)}`)).toBe(201);
      const fromSeq = (later.json as { sequence: number }).sequence;
      expect(fromSeq > sequence, req('openwop.requirement.0209.legacy-readable', 'api/seams-v2.yaml emitA2uiSurface', `a later recording names a later sequence (surface ${sequence}, next ${fromSeq})`)).toBe(true);
      const fork = await driver.post(`/runs/${encodeURIComponent(runId)}:fork`, { mode: 'replay', fromSeq });
      expect(fork.status, req('openwop.requirement.0209.legacy-readable', 'RFC 0209 §C.11', `POST :fork at fromSeq ${fromSeq} (a recorded event after the surface) MUST answer 201, got ${code(fork)}`)).toBe(201);
      const forkId = (fork.json as { runId: string }).runId;
      expect(carries(await eventsOf(forkId), V1_SURFACE), req('openwop.requirement.0209.legacy-readable', 'RFC 0209 §C.11', 'a fork at a later fromSeq MUST carry the version-1 surface unchanged')).toBe(true);
      await done(forkId);
    } finally { await done(runId); }
  });
});

describe('RFC 0209 §C.12 — trust is sticky across the fold (seam-gated)', () => {
  it('one untrusted update taints a trusted surface, a later trusted update does not launder it, and the approval does not advance; an all-trusted surface does', async () => {
    const g = await gate((f) => f >= 2, 'a floor of at least 2');
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { runId } = g.ctx;
    const R = (why: string) => req('openwop.requirement.0209.taint-sticky', 'RFC 0209 §C.12', why);
    let controlRun: string | null = null;
    try {
      const s = sid('taint');
      const steps = [
        await emit(runId, envelope(2, v2(s, [createMsg(), componentsMsg()]), { nodeId: GATE_NODE })),
        await emit(runId, envelope(2, v2(s, [componentsMsg()]), { nodeId: GATE_NODE, trust: 'untrusted' })),
        await emit(runId, envelope(2, v2(s, [componentsMsg()]), { nodeId: GATE_NODE, trust: 'trusted' })),
      ];
      steps.forEach((r, i) => expect(r.status, R(`surface step ${i} MUST be recorded (201) — an untrusted envelope is recorded and tainted, not refused; got ${code(r)}`)).toBe(201));
      const resolve = await driver.post(`/runs/${encodeURIComponent(runId)}/interrupts/${GATE_NODE}`, { resumeValue: { action: 'accept' } });
      expect(resolve.status >= 400 && resolve.status < 500, R(`resolving the approval bound to a tainted surface MUST be refused (4xx), got ${code(resolve)}`)).toBe(true);
      const text = JSON.stringify(resolve.json ?? {});
      expect(text.includes('untrusted_content_blocks_approval'), R(`the refusal MUST name untrusted_content_blocks_approval (in error.details or message): ${text.slice(0, 300)}`)).toBe(true);
      expect(await waitStatus(runId, new Set(['waiting-approval']), 1_000), R('a refused resolve MUST NOT advance the run — the approval stays pending')).toBe('waiting-approval');

      // Control: the same fold with no untrusted envelope MUST let the approval advance, or the refusal above proves nothing.
      const ctl = await driver.post('/runs', { workflowId: FIXTURE });
      expect(ctl.status, R(`control run MUST start, got ${code(ctl)}`)).toBe(201);
      controlRun = (ctl.json as { runId: string }).runId;
      expect(await waitStatus(controlRun, new Set(['waiting-approval', 'completed', 'failed', 'cancelled']), 10_000), R('the control run MUST suspend on its approval')).toBe('waiting-approval');
      const c = sid('trusted');
      const c1 = await emit(controlRun, envelope(2, v2(c, [createMsg(), componentsMsg()]), { nodeId: GATE_NODE }));
      const c2 = await emit(controlRun, envelope(2, v2(c, [componentsMsg()]), { nodeId: GATE_NODE, trust: 'trusted' }));
      expect([c1.status, c2.status], R('the control surface MUST be recorded')).toEqual([201, 201]);
      const ok = await driver.post(`/runs/${encodeURIComponent(controlRun)}/interrupts/${GATE_NODE}`, { resumeValue: { action: 'accept' } });
      expect(ok.status, R(`resolving the approval bound to an all-trusted surface MUST succeed (control), got ${code(ok)}`)).toBe(200);
    } finally {
      await done(runId);
      if (controlRun) await done(controlRun);
    }
  });
});

describe('RFC 0209 §C.9 — no render before root (declared unwitnessable here; reference-impl witness)', () => {
  it('records why render-needs-root has no server-side witness, and where its witness lives', () => {
    req('openwop.requirement.0209.render-needs-root', 'RFC 0209 §C.9', 'a renderer does not render a surface before its root component exists');
    return softSkip('inapplicable', 'unwitnessable by this suite (RFC 0209 §C.9 Falsifiability verdict): a render-side guarantee, and a server-oriented suite cannot observe a renderer. The fold guard the server CAN observe is openwop.requirement.0209.fold-guarded, above. The render half is witnessed as a reference-app client probe (tier: reference-impl, the a2ui-surface-no-code-exec precedent): openwop/openwop-app frontend/react/src/chat/a2ui/__tests__/a2ui-v09-render-needs-root.test.tsx (openwop-app#4121, ADR 0749). Removing the `if (!state.renderable)` guard in frontend/react/src/chat/a2ui/v09/A2uiV09Surface.tsx turns 2 of its 4 cases red. This row records that the suite reached the requirement, and it is not a pass.');
  });
});
