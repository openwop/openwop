/**
 * RFC 0151 §C–§G — the compensation BEHAVIORAL witness.
 *
 * This file exists because RFC 0147 §A.5 requires "at least one host MUST
 * execute every normative behavioral path in strict mode", and until now RFC
 * 0151 had no behavioral scenario at all — only a server-free schema check.
 * A willing host had nothing to run.
 *
 * That is a gap in the *suite*, not in any host, and it is worth naming plainly:
 * for several turns the blocker was described as "no host implements this", when
 * part of it was that the evidence-collecting apparatus did not exist either.
 *
 * Every leg here is capability-gated on `compensation.supported` via
 * `behaviorGate`, so it soft-skips against a host that does not advertise and
 * HARD-FAILS under `OPENWOP_REQUIRE_BEHAVIOR=true`. The gate records an RFC 0148
 * §A ledger disposition either way, so an unrun requirement resolves to
 * `blocked` rather than to silence.
 *
 * What each leg pins, and why it is the observable projection of a §C rule that
 * would otherwise be unverifiable:
 *
 *   - **Plan before first effect.** §C: "the host MUST persist a compensation
 *     plan before executing its first inverse action." Black-box, that is
 *     `compensation.requested` strictly preceding `compensation.started`. A host
 *     that starts unwinding before persisting cannot resume after a crash — and
 *     the crash is exactly when it matters.
 *   - **Reverse-completion order.** §C orders by *descending durable
 *     forward-completion sequence*. Compensating in forward order can release a
 *     resource another inverse action still depends on.
 *   - **Replay does not re-fire.** §F. A replay that re-executes inverse effects
 *     turns a recovery into a second outage.
 *   - **No provider bodies or credentials in events.** §D and §G. These events
 *     land in the durable log, which is the least revocable place a credential
 *     can go.
 *   - **The snapshot rollup agrees with the events.** §D `compensationStatus` on
 *     `RunSnapshot` (UQ3 resolved 2026-08-16) is the deterministic fold defined in
 *     `spec/v1/compensation.md`; an advertising host MUST carry it, and a value
 *     that disagrees with the emitted events is a projection bug a client would
 *     act on.
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'openwop-compensation';

interface CompensationCaps {
  readonly supported?: boolean;
  readonly orderingModels?: readonly string[];
  readonly manualIntervention?: boolean;
}

/** §D's closed event set. Content-free by construction. */
const COMPENSATION_EVENTS = [
  'compensation.requested',
  'compensation.started',
  'compensation.completed',
  'compensation.failed',
  'compensation.paused',
  'compensation.manual_intervention_required',
] as const;

async function advertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = capabilityFamily<CompensationCaps>(disco.json, 'compensation');
  return caps?.supported === true;
}

describe('RFC 0151 §C — compensation lifecycle (capability-gated behavior)', () => {
  it('a host advertising compensation implements reverse-completion', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const disco = await driver.get('/.well-known/openwop');
    const caps = capabilityFamily<CompensationCaps>(disco.json, 'compensation');
    expect(
      caps?.orderingModels ?? [],
      driver.describe(
        'RFCS/0151-compensation-and-partial-failure-profile.md §A',
        'an advertising host MUST implement `reverse-completion`; `dependency-graph` is optional',
      ),
    ).toContain('reverse-completion');
  });

  it('the plan is persisted before the first inverse action', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    // §C's crash-safety rule, in its only black-box form: `requested` (plan
    // persisted) strictly precedes `started` (first inverse action). A host that
    // unwinds before persisting cannot resume — and the crash is precisely when
    // resumption is the thing that matters.
    const seam = await driver.post('/v1/host/sample/test/compensation/unwind', {});
    if (seam.status === 404) {
      expect(
        seam.status,
        driver.describe(
          'RFCS/0151 §C',
          'a host advertising `compensation` MUST expose the unwind sample seam so plan-before-effect ' +
            'ordering can be witnessed; without it the requirement is unobservable and the profile ' +
            'cannot be certified (RFC 0148 §A: unobservable resolves to `blocked`, not to a pass)',
        ),
      ).not.toBe(404);
      return;
    }
    const events = (seam.json as { events?: { type: string }[] }).events ?? [];
    const requestedAt = events.findIndex((e) => e.type === 'compensation.requested');
    const startedAt = events.findIndex((e) => e.type === 'compensation.started');
    expect(requestedAt, driver.describe('RFCS/0151 §D', '`compensation.requested` MUST be emitted')).toBeGreaterThanOrEqual(0);
    expect(startedAt, driver.describe('RFCS/0151 §D', '`compensation.started` MUST be emitted')).toBeGreaterThanOrEqual(0);
    expect(
      requestedAt,
      driver.describe(
        'RFCS/0151 §C',
        'the plan MUST be persisted BEFORE the first inverse action executes',
      ),
    ).toBeLessThan(startedAt);
  });

  it('inverse actions run in descending forward-completion order', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const seam = await driver.post('/v1/host/sample/test/compensation/unwind', { nodes: 3 });
    if (seam.status === 404) return; // covered by the seam assertion above
    const order = (seam.json as { compensatedOrder?: number[] }).compensatedOrder ?? [];
    const descending = [...order].sort((a, b) => b - a);
    expect(
      order,
      driver.describe(
        'RFCS/0151 §C',
        '`reverse-completion` orders compensations by DESCENDING durable forward-completion ' +
          'sequence. Compensating forward can release a resource a later inverse action still needs.',
      ),
    ).toEqual(descending);
  });

  it('replay does not re-fire inverse effects', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const seam = await driver.post('/v1/host/sample/test/compensation/replay', {});
    if (seam.status === 404) return;
    expect(
      (seam.json as { refiredEffects?: number }).refiredEffects ?? 0,
      driver.describe(
        'RFCS/0151 §F',
        'replay defaults MUST use recorded compensation outcomes and MUST NOT re-fire inverse ' +
          'effects — a replay that re-executes them turns a recovery into a second outage',
      ),
    ).toBe(0);
  });

  it('the run snapshot carries the §D rollup, and it agrees with the events', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const seam = await driver.post('/v1/host/sample/test/compensation/unwind', {});
    if (seam.status === 404) return; // covered by the seam assertion above
    const body = seam.json as { runId?: string; events?: { type: string }[] };
    expect(
      typeof body.runId === 'string' && body.runId.length > 0,
      driver.describe(
        'host-sample-test-seams.md §21',
        'the unwind seam MUST return the `runId` it created — without it the §D rollup has no ' +
          'black-box path to a witness and lands as another shape-only claim',
      ),
    ).toBe(true);
    const snap = await driver.get(`/v1/runs/${encodeURIComponent(body.runId ?? '')}`);
    expect(snap.status, driver.describe('rest-endpoints.md', 'GET /v1/runs/{runId} for the seam run')).toBe(200);
    const status = (snap.json as { compensationStatus?: unknown }).compensationStatus;
    expect(
      status,
      driver.describe(
        'compensation.md §"Run rollup: compensationStatus"',
        'a host that advertises `compensation` MUST include `compensationStatus` on every snapshot ' +
          '(`none` when idle) — presence is the wire witness of the advert',
      ),
    ).toBeDefined();
    const types = (body.events ?? []).map((e) => e.type);
    // The fold, applied to what the seam reports: a clean unwind ends `completed`; a
    // recorded `manual_intervention_required` dominates; a plan that never started is
    // `pending`. Anything else the seam produced is a shape this leg cannot judge from
    // outside, and it says so rather than passing.
    const expected = types.includes('compensation.manual_intervention_required')
      ? 'manual'
      : types.includes('compensation.completed')
        ? 'completed'
        : types.includes('compensation.started')
          ? null
          : types.includes('compensation.requested')
            ? 'pending'
            : 'none';
    if (expected === null) {
      expect(
        ['running', 'partial', 'failed'].includes(String(status)),
        driver.describe(
          'compensation.md §"Run rollup: compensationStatus"',
          'an unwind that started and did not complete MUST report `running`, `partial`, or `failed` ' +
            `— got ${String(status)}`,
        ),
      ).toBe(true);
      return;
    }
    expect(
      status,
      driver.describe(
        'compensation.md §"Run rollup: compensationStatus"',
        `the rollup MUST be the deterministic fold of the compensation.* events — events ${JSON.stringify(types)} fold to \`${expected}\``,
      ),
    ).toBe(expected);
  });

  it('compensation events carry no provider bodies or credentials', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const seam = await driver.post('/v1/host/sample/test/compensation/unwind', {});
    if (seam.status === 404) return;
    const events = (seam.json as { events?: Record<string, unknown>[] }).events ?? [];
    for (const e of events) {
      if (!COMPENSATION_EVENTS.includes(e['type'] as (typeof COMPENSATION_EVENTS)[number])) continue;
      const serialized = JSON.stringify(e);
      for (const forbidden of ['-----BEGIN', 'Bearer ', 'sk-', 'authorization', 'providerResponse']) {
        expect(
          serialized.toLowerCase().includes(forbidden.toLowerCase()),
          driver.describe(
            'RFCS/0151 §D + §G',
            'compensation event payloads carry opaque IDs and closed reason codes — never provider ' +
              'bodies or credentials. These land in the DURABLE log, which is the least revocable ' +
              `place a credential can reach. Found: ${forbidden}`,
          ),
        ).toBe(false);
      }
    }
  });

  it('a healthy run that DECLARES a compensator reports compensationStatus `none` (SP-11a)', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;

    // The rollup folds over the PLAN, and no plan exists until a trigger fires
    // (`compensation.md` §"Run rollup"). So a run that completes successfully while
    // declaring compensable nodes reads `none` — it has nothing to unwind.
    //
    // Nothing observed this. Every other leg of the §21 seam drives a FAILURE, so a
    // host that derived the rollup from the existence of obligation rows — minted per
    // compensable node, healthy or not — reported `pending` on every successful run
    // that declared a compensator and passed all of them. A tier-1 host shipped exactly
    // that (SP-11a / their AP-03). This leg is the healthy case, and it needs no failure:
    // `fail: false` on the unwind seam runs the same compensator-declaring workflow to
    // completion.
    const seam = await driver.post('/v1/host/sample/test/compensation/unwind', { fail: false });
    if (seam.status === 404) {
      return softSkip('blocked', 'the §21 unwind seam is not wired — the healthy-run rollup has no black-box witness');
    }
    if (seam.status >= 400) {
      // The host mounts the seam but rejects `fail: false`. That is the pre-extension
      // shape, not a pass: without it the healthy-run rollup stays unobservable.
      return softSkip(
        'blocked',
        `the §21 unwind seam does not honour \`fail: false\` (HTTP ${seam.status}) — the healthy-run ` +
          'rollup is unobservable until it does (host-sample-test-seams.md §21)',
      );
    }

    const body = seam.json as { runId?: string; events?: { type: string }[] };
    expect(
      typeof body.runId === 'string' && body.runId.length > 0,
      driver.describe('host-sample-test-seams.md §21', '`fail: false` MUST still return the runId it created'),
    ).toBe(true);

    // Positive control: the seam really did run a healthy compensator-declaring
    // workflow. If it emitted a `compensation.requested`, it failed the node anyway and
    // this is not the healthy case — say so rather than assert `none` against a run
    // that legitimately has a plan.
    const types = (body.events ?? []).map((e) => e.type);
    if (types.includes('compensation.requested')) {
      return softSkip(
        'blocked',
        `the seam emitted ${JSON.stringify(types)} under \`fail: false\` — a trigger fired, so this run ` +
          'is not the healthy case the leg needs',
      );
    }

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(body.runId ?? '')}`);
    expect(snap.status, driver.describe('rest-endpoints.md', 'GET /v1/runs/{runId} for the healthy seam run')).toBe(200);
    const snapshot = snap.json as { status?: unknown; compensationStatus?: unknown };

    expect(
      snapshot.compensationStatus,
      driver.describe(
        'compensation.md §"Run rollup: compensationStatus"',
        'a host advertising `compensation` MUST carry the field on EVERY snapshot — presence is the wire witness of the advert',
      ),
    ).toBeDefined();

    expect(
      snapshot.compensationStatus,
      driver.describe(
        'compensation.md §"Run rollup: compensationStatus"',
        'a run that completed while declaring compensable nodes has nothing to unwind: no `compensation.requested` ' +
          'was recorded, so the fold is `none`. `pending` here means the rollup was derived from obligation ROWS ' +
          `rather than from plan state — got \`${String(snapshot.compensationStatus)}\``,
      ),
    ).toBe('none');
  });
});
