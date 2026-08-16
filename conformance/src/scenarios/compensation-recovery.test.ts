/**
 * RFC 0151 §C / §E / §B+§F — the compensation RECOVERY witness: retry-stable
 * identity, tenant-bound operator authority, recorded-facts-only inputs.
 *
 * `compensation-behavior.test.ts` proves the happy unwind: plan before effect,
 * reverse order, replay does not re-fire, content-free events, rollup ⇄ events.
 * RFC 0151 §G names three further invariants that file cannot see, and
 * `SECURITY/threat-model-compensation.md` §7 said so and named the seam each
 * one needs. This file is that seam's consumer (`host-sample-test-seams.md` §21
 * "Recovery extension"):
 *
 *   - **`compensation-effect-id-retry-stable`** (§C). `unwind` with
 *     `failFirstInverseAttempts: 2`: the first inverse action fails twice then
 *     succeeds. The response's `inverseActions[]` MUST show one entry for that
 *     ordinal with `attempts: 3` and a SINGLE distinct `downstreamKeys` value —
 *     one obligation, three attempts, the same idempotency key at the
 *     downstream every time. Two keys is two refunds.
 *   - **`compensation-tenant-authority-bound`** (§E). `unwind` with `hold: true`
 *     leaves a held plan (`compensationStatus: manual`); the `operator` seam is
 *     then driven three times — a cross-tenant actor (404: RFC 0132 §A.2,
 *     neutralize, do not reveal), a same-tenant non-operator (403, audited),
 *     the operator (200, `audited: true`). A seam that answers 200 to all
 *     three consults nothing.
 *   - **`compensation-input-recorded-facts-only`** (§B/§F). `replay` reports the
 *     inverse actions of the source run and of the replay with the input each
 *     executed with; they MUST deep-equal while `refiredEffects` stays 0. An
 *     inverse built from a re-derived value is not the inverse of what was
 *     done, and replay is where re-derivation would happen.
 *
 * Every leg is capability-gated on `compensation.supported` via `behaviorGate`
 * (soft-skips without the advert, HARD-FAILS under `OPENWOP_REQUIRE_BEHAVIOR=true`)
 * and records its RFC 0148 §A disposition. The three sub-features are
 * INDEPENDENTLY optional: a host that wires the base seams but not this
 * extension is `blocked` here (named as such via `softSkip`) and keeps its
 * `compensation-behavior` witness — the base and the extension are different
 * claims and are recorded separately.
 *
 * Mode does NOT change that (S24, corrected 2026-08-16 after the first host to
 * wire §21 read the contract back to us): the recovery extension has NO advert
 * flag — `capabilities.compensation` is closed over `supported` /
 * `profileVersion` / `orderingModels` / `manualIntervention` — so a host cannot
 * claim or disclaim it, and `seamAbsent` (whose contract is "an ADVERTISED
 * capability whose observation seam is absent", strict-failing) is the wrong
 * tool for it. An absent extension is `softSkip('blocked', …)` in both modes,
 * exactly as §21 says; the ledger still refuses to certify the three §G
 * invariants, so nothing weakens. The BASE seams (`unwind` / `replay`) are a
 * different matter: `compensation.supported` promises them, and a 404 there
 * stays `seamAbsent` (strict-fails) — that is `compensation-behavior`'s wall,
 * not this file's.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';

const PROFILE = 'openwop-compensation';
const UNWIND = '/v1/host/sample/test/compensation/unwind';
const REPLAY = '/v1/host/sample/test/compensation/replay';
const OPERATOR = '/v1/host/sample/test/compensation/operator';

interface InverseAction {
  readonly ordinal?: number;
  readonly effectId?: string;
  readonly attempts?: number;
  readonly outcome?: string;
  readonly downstreamKeys?: readonly string[];
  readonly input?: unknown;
}

interface UnwindResponse {
  readonly runId?: string;
  readonly events?: ReadonlyArray<{ type?: string; payload?: Record<string, unknown> }>;
  readonly compensatedOrder?: readonly number[];
  readonly inverseActions?: readonly InverseAction[];
}

interface ReplayResponse {
  readonly runId?: string;
  readonly refiredEffects?: number;
  readonly source?: readonly InverseAction[];
  readonly replayed?: readonly InverseAction[];
}

async function advertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<{ supported?: boolean }>(disco.json, 'compensation')?.supported === true;
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
  const r = await driver.post(path, body);
  if (r.status === 404 && path !== OPERATOR) {
    seamAbsent(`host advertises \`compensation.supported: true\` but ${path} answered 404 — the RFC 0151 recovery requirements are unobservable (host-sample-test-seams.md §21)`);
    return null;
  }
  return { status: r.status, json: r.json };
}

/**
 * The recovery extension is optional and has no advert flag, so its absence is
 * `blocked` in BOTH modes — `softSkip`, never `seamAbsent` (S24). The three §G
 * invariants stay uncertified either way; strict mode is not entitled to fail
 * a host for a sub-seam it was never asked to claim.
 */
function extensionAbsent(what: string): undefined {
  return softSkip('blocked', `the §21 recovery extension is not wired: ${what} (host-sample-test-seams.md §21 "Recovery extension") — retry-stability / operator authority / recorded-facts are unobservable`);
}

describe('RFC 0151 §C — inverse-action identity is retry-stable (capability-gated behavior)', () => {
  it('a transient inverse failure retries under the SAME identity and the same downstream key', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const r = await post(UNWIND, { nodes: 2, failFirstInverseAttempts: 2 });
    if (r === null) return;
    expect(r.status, driver.describe('spec/v1/host-sample-test-seams.md §21', 'unwind seam answers 200')).toBe(200);
    const body = r.json as UnwindResponse;
    if (!Array.isArray(body.inverseActions)) return extensionAbsent('`unwind` did not return `inverseActions[]`');
    // Under reverse-completion the first inverse to run is the highest forward ordinal (2).
    const first = body.inverseActions.find((a) => a.ordinal === 2) ?? body.inverseActions[0];
    expect(first, driver.describe('spec/v1/host-sample-test-seams.md §21', 'one entry per plan entry')).toBeDefined();
    const a = first as InverseAction;
    expect(a.attempts, driver.describe('RFCS/0151 §C', 'two transient failures then success is THREE attempts of one obligation')).toBe(3);
    expect(a.outcome, driver.describe('RFCS/0151 §C', 'a transient failure MUST be retryable — the action completes')).toBe('completed');
    expect(Array.isArray(a.downstreamKeys) ? a.downstreamKeys.length : -1, driver.describe('spec/v1/host-sample-test-seams.md §21', '`downstreamKeys` has one entry per attempt')).toBe(3);
    const distinct = new Set(a.downstreamKeys ?? []);
    expect(
      distinct.size,
      driver.describe(
        'RFCS/0151 §C + RFC 0150 §B',
        'a retry re-presents the SAME inverse-action identity as its idempotency key — a second key at the downstream is a second obligation (two refunds). `attempt` is outside the identity for exactly this reason.',
      ),
    ).toBe(1);
    // One obligation per ordinal: no duplicate plan entries.
    const ordinals = body.inverseActions.map((x) => x.ordinal);
    expect(new Set(ordinals).size, driver.describe('RFCS/0151 §C', 'exactly one plan entry per forward ordinal')).toBe(ordinals.length);
    expect(typeof a.effectId === 'string' && a.effectId.length > 0, driver.describe('RFCS/0151 §D', 'the identity is carried as an opaque `effectId`')).toBe(true);
  });
});

describe('RFC 0151 §E — operator authority is bound to the plan\'s tenant (capability-gated behavior)', () => {
  it('cross-tenant is neutralized (404), same-tenant non-operator is refused and audited (403), the operator acts (200)', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const held = await post(UNWIND, { nodes: 2, hold: true });
    if (held === null) return;
    const body = held.json as UnwindResponse;
    const runId = body.runId;
    if (typeof runId !== 'string') return extensionAbsent('`unwind` did not return a `runId`');
    const heldEntry = (body.inverseActions ?? []).find((x) => x.outcome === 'held');
    const manual = (body.events ?? []).some((e) => e.type === 'compensation.manual_intervention_required');
    if (heldEntry === undefined && !manual) return extensionAbsent('`unwind` with `hold: true` produced neither a held plan entry nor `compensation.manual_intervention_required`');
    // Snapshot must read `manual` while held (§D fold).
    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    expect(snap.status, driver.describe('rest-endpoints.md', 'GET /v1/runs/{runId} for the held run')).toBe(200);
    expect((snap.json as { compensationStatus?: string }).compensationStatus, driver.describe('spec/v1/compensation.md §D', 'a held plan reads `manual`')).toBe('manual');

    const op = async (actor: Record<string, unknown>) =>
      driver.post(OPERATOR, { runId, action: 'retry', actor });
    // 1. Cross-tenant actor: neutralize to the actor's tenant, do not reveal.
    const cross = await op({ tenantId: 'conformance-other-tenant', principalId: 'conformance-operator', operator: true });
    if (cross.status === 404 && readErrorCode(cross.json) === undefined && (cross.json === null || cross.json === undefined || Object.keys(cross.json as object).length === 0)) {
      return extensionAbsent(`${OPERATOR} answered a bodiless 404 — the operator seam is absent (an absent seam and a neutralized cross-tenant plan must be told apart by the envelope: RFC 0132 §A.2 answers \`not_found\` in the canonical envelope)`);
    }
    expect(cross.status, driver.describe('RFCS/0151 §E + RFC 0132 §A.2', 'an actor from another tenant MUST NOT learn the plan exists — 404, not 403')).toBe(404);
    expect(readErrorCode(cross.json), driver.describe('rest-endpoints.md §Error codes', '`not_found` — do not leak existence')).toBe('not_found');
    // 2. Same tenant, no operator authority: refused AND audited.
    const plain = await op({ tenantId: 'default', principalId: 'conformance-bystander', operator: false });
    expect(plain.status, driver.describe('RFCS/0151 §E', 'a principal without operator authority in the plan\'s tenant is refused')).toBe(403);
    expect(readErrorCode(plain.json), driver.describe('rest-endpoints.md §Error codes', '`forbidden`')).toBe('forbidden');
    expect(readRetriable(plain.json), driver.describe('spec/v1/host-sample-test-seams.md §21', 'a refused override is not retriable')).toBe(false);
    // 3. The operator: acts, audited, rollup moves off `manual`.
    const ok = await op({ tenantId: 'default', principalId: 'conformance-operator', operator: true });
    expect(ok.status, driver.describe('RFCS/0151 §E', 'an authorized operator MAY retry a held inverse action')).toBe(200);
    const res = ok.json as { compensationStatus?: string; audited?: boolean; planVersion?: unknown };
    expect(res.audited, driver.describe('RFCS/0151 §E', 'every override MUST be audited (`authorization.decided`)')).toBe(true);
    expect(
      ['completed', 'partial', 'failed', 'running'],
      driver.describe('spec/v1/compensation.md §D', 'after the operator retries, the rollup is whatever the recorded outcomes yield — never still `manual` for a resolved hold'),
    ).toContain(res.compensationStatus);
    // The refusal in step 2 was audited too: the plan's events carry a reason.
    const after = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    if (after.status === 200) {
      const evs = (after.json as { events?: Array<{ type?: string; payload?: Record<string, unknown> }> }).events ?? [];
      const decided = evs.filter((e) => e.type === 'authorization.decided');
      expect(decided.length, driver.describe('RFCS/0151 §E + RFC 0049', 'both the refusal and the override are `authorization.decided` records')).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('RFC 0151 §B/§F — inverse inputs are recorded facts, not re-derived (capability-gated behavior)', () => {
  it('a replay executes the same inverse actions with the same inputs, and re-fires nothing', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const r = await post(REPLAY, {});
    if (r === null) return;
    expect(r.status, driver.describe('spec/v1/host-sample-test-seams.md §21', 'replay seam answers 200')).toBe(200);
    const body = r.json as ReplayResponse;
    if (!Array.isArray(body.source) || !Array.isArray(body.replayed)) return extensionAbsent('`replay` did not return `source[]` / `replayed[]`');
    expect(body.refiredEffects, driver.describe('RFCS/0151 §F', 'replay MUST NOT re-fire inverse effects')).toBe(0);
    expect(body.source.length, driver.describe('spec/v1/host-sample-test-seams.md §21', 'the source run had inverse actions to compare')).toBeGreaterThan(0);
    const norm = (xs: readonly InverseAction[]) =>
      [...xs].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map((x) => ({ ordinal: x.ordinal, effectId: x.effectId, input: x.input }));
    expect(
      norm(body.replayed),
      driver.describe(
        'RFCS/0151 §B + §F',
        'a replay uses the RECORDED inverse inputs and identities — an inverse built from a re-derived (prompt / model / live) value is not the inverse of what was actually done',
      ),
    ).toEqual(norm(body.source));
    for (const x of body.source) {
      expect(x.input, driver.describe('RFCS/0151 §B', 'each inverse action executed with a recorded input')).toBeDefined();
    }
  });
});
