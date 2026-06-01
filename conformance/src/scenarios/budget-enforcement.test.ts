/**
 * Budget enforcement — the §C lifecycle + §D hard-stop (RFC 0084) — behavioral.
 *
 * Gated on `capabilities.budget.supported` (root-first per RFC 0073). Soft-skips
 * when unadvertised (default) / hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`.
 * The always-on wire-shape coverage lives in `budget-policy-shape.test.ts`; this
 * asserts host BEHAVIOR via the `POST /v1/host/sample/budget/run` seam + the test
 * event-log seam:
 *
 *   1. HARD COST EXHAUST (§C/§D, requires `enforce:"hard"`) — a hard-cost run
 *      accrues to exhaustion, emitting in strict sequence:
 *      `budget.reserved` → `budget.consumed` → `budget.threshold.crossed{percent}`
 *      → `budget.exhausted` → `cap.breached{kind:"budget-cost"}` →
 *      `run.failed{error:"budget_exhausted"}`.
 *   2. MODEL DENIED (§D model policy) — a run whose model violates the budget
 *      allow/deny list is refused with `budget_model_denied` BEFORE the provider
 *      call (no model call, fail-closed).
 *   3. ADVISORY (§D, `enforce:"advisory"`) — the same accrual emits the
 *      `budget.*` events but does NOT stop the run (no `cap.breached`, no
 *      `run.failed{budget_exhausted}`).
 *   4. CONTENT-FREE (SR-1 / `budget-no-pricing-leak`) — every `budget.*` payload
 *      carries only dimension/limit/consumed/remaining/percent scalars, never a
 *      provider pricing table or per-token rate.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/budget-policy.md (§C/§D)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0084-budget-quota-and-cost-policy.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (budget-no-pricing-leak)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readBudgetCap, driveBudgetRun, BUDGET_CAP_KINDS, BUDGET_CONTENT_FORBIDDEN } from '../lib/budgetPolicy.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import type { TestEvent } from '../lib/event-log-query.js';

function seq(events: TestEvent[], type: string): number {
  const e = events.find((x) => x.type === type);
  return e ? e.sequence : -1;
}

function expectContentFree(events: TestEvent[]): void {
  for (const e of events.filter((x) => x.type.startsWith('budget.'))) {
    for (const f of BUDGET_CONTENT_FORBIDDEN) {
      expect(
        !(f in e.payload),
        driver.describe('RFC 0084 §F (SR-1) / budget-no-pricing-leak', `budget.* MUST be content-free (no ${f})`),
      ).toBe(true);
    }
  }
}

describe('budget-enforcement (RFC 0084 §C/§D)', () => {
  it('runs the reserved→consumed→threshold→exhausted→cap.breached→run.failed chain, refuses denied models, and honors advisory mode', async () => {
    const cap = await readBudgetCap();
    if (!behaviorGate('openwop-budget-enforcement', cap?.supported === true)) return;
    if (!(await isEventLogSeamAvailable())) return; // event-log seam absent — soft-skip

    // ---- Leg 1: hard cost exhaust (§C/§D) -------------------------------
    const hard = await driveBudgetRun({ scenario: 'hard-cost-exhaust' });
    if (hard === null) return; // budget seam absent — soft-skip the whole behavior
    if (hard.runId) {
      const q = await queryTestEvents(hard.runId);
      if (q.ok) {
        const ev = q.events.slice().sort((a, b) => a.sequence - b.sequence);
        const reserved = seq(ev, 'budget.reserved');
        const threshold = seq(ev, 'budget.threshold.crossed');
        const exhausted = seq(ev, 'budget.exhausted');
        const failed = seq(ev, 'run.failed');
        const capBreached = ev.find((e) => e.type === 'cap.breached' && typeof e.payload.kind === 'string' && (e.payload.kind as string).startsWith('budget-'));

        expect(
          reserved >= 0 && exhausted >= 0,
          driver.describe('budget-policy.md §C', 'a hard budget run MUST emit budget.reserved + budget.exhausted'),
        ).toBe(true);
        // §C ordering: reserved < threshold.crossed < exhausted < run.failed.
        if (threshold >= 0) {
          expect(
            reserved < threshold && threshold < exhausted,
            driver.describe('RFC 0084 §C', 'ordering MUST be reserved < threshold.crossed < exhausted'),
          ).toBe(true);
          const tc = ev.find((e) => e.type === 'budget.threshold.crossed');
          expect(
            typeof tc?.payload.percent === 'number',
            driver.describe('run-event-payloads.schema.json#budgetThresholdCrossed', 'threshold.crossed MUST carry a numeric percent'),
          ).toBe(true);
        }
        // §D hard-stop: exhausted → cap.breached{budget-*} → run.failed{budget_exhausted}.
        expect(
          capBreached !== undefined,
          driver.describe('RFC 0084 §D', 'exhaustion MUST emit cap.breached with a budget-* kind'),
        ).toBe(true);
        if (capBreached) {
          expect(
            BUDGET_CAP_KINDS.includes(capBreached.payload.kind as string),
            driver.describe('RFC 0084 §D', 'cap.breached.kind MUST be in the closed budget vocabulary'),
          ).toBe(true);
          expect(
            exhausted <= capBreached.sequence && capBreached.sequence <= failed,
            driver.describe('RFC 0084 §D', 'ordering MUST be exhausted ≤ cap.breached ≤ run.failed'),
          ).toBe(true);
        }
        const failedEvt = ev.find((e) => e.type === 'run.failed');
        expect(
          failedEvt?.payload.error === 'budget_exhausted',
          driver.describe('RFC 0084 §D', 'a hard-budget overrun MUST fail the run with error budget_exhausted'),
        ).toBe(true);
        expectContentFree(ev);
      }
    }

    // ---- Leg 2: model denied (§D model policy, fail-closed) -------------
    const denied = await driveBudgetRun({ scenario: 'model-denied' });
    if (denied !== null) {
      expect(
        denied.error === 'budget_model_denied',
        driver.describe('RFC 0084 §D', 'a model violating the budget allow/deny list MUST be refused with budget_model_denied'),
      ).toBe(true);
      expect(
        denied.modelCalled !== true,
        driver.describe('RFC 0084 §D', 'a denied model MUST be refused BEFORE the provider call (fail-closed)'),
      ).toBe(true);
    }

    // ---- Leg 3: advisory mode emits events but never stops --------------
    if (cap?.enforce === 'advisory' || cap?.enforce === undefined) {
      const adv = await driveBudgetRun({ scenario: 'advisory' });
      if (adv !== null && adv.runId) {
        const q = await queryTestEvents(adv.runId);
        if (q.ok) {
          const ev = q.events;
          const hasBudgetEvents = ev.some((e) => e.type.startsWith('budget.'));
          const stopped = ev.some(
            (e) =>
              (e.type === 'cap.breached' && typeof e.payload.kind === 'string' && (e.payload.kind as string).startsWith('budget-')) ||
              (e.type === 'run.failed' && e.payload.error === 'budget_exhausted'),
          );
          if (hasBudgetEvents) {
            expect(
              !stopped,
              driver.describe('RFC 0084 §D', 'advisory enforcement MUST emit budget.* events without stopping the run'),
            ).toBe(true);
          }
          expectContentFree(ev);
        }
      }
    }

    await resetTestSeam();
  });
});
