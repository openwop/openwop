/**
 * The budget ACCOUNTING witness: what the numbers on a budgeted run's log must
 * say, beyond the events existing (`budget-witness.ts` owns that).
 *
 * It reads the same observation `budget-witness.ts` `drive` returns — a run of
 * `conformance-budget-tool-calls` under `{ maxToolCalls: 2, thresholdPercent:
 * 50, onExhaustion: "fail" }` — and judges three rules of `runs.md` §`budget`
 * section and `schemas/v2/budget-policy.schema.json`. Pure: no I/O.
 *
 *   derived      consumption is derived from `agent.tool-called`, "never
 *                measured twice": every `toolCalls` `budget.consumed`,
 *                `budget.threshold-crossed` and `budget.exhausted` carries a
 *                `consumed` equal to the number of `agent.tool-called` events
 *                before it in the log. A host that counts a call twice, or
 *                counts `agent.tool-returned` as well, reports twice the calls.
 *   limit        `budget.reserved` records the effective budget: its
 *                `effectiveBudget.maxToolCalls` is at most the run's own
 *                ceiling (the effective budget is the minimum across scopes),
 *                and every `toolCalls` accounting event's `limit` equals it. A
 *                host that enforces a number it did not record breaks replay,
 *                which re-reads `budget.reserved` and never re-resolves.
 *   threshold    `budget.threshold-crossed` is emitted once for the dimension,
 *                at the policy's percent (`percent` equals `thresholdPercent`)
 *                and not before consumption reached it.
 *
 * An empty finding list means the log offers nothing to judge for that rule;
 * the scenario records that as `blocked`, never as a pass.
 */

import type { BudgetObservation, RunEvent } from './budget-witness.js';

export const ACCOUNTING_DIMENSION = 'toolCalls';

export interface AccountingNames {
  readonly toolCalled: string;
  readonly consumed: string;
}

export interface AccountingPolicy {
  readonly maxToolCalls: number;
  readonly thresholdPercent: number;
}

export interface AccountingFinding {
  readonly rule: 'derived' | 'limit' | 'threshold';
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The `toolCalls` accounting events: consumed, threshold-crossed, exhausted. */
function accountingEvents(o: BudgetObservation, names: AccountingNames): RunEvent[] {
  const types = new Set([names.consumed, o.names.threshold, o.names.exhausted]);
  return o.events.filter((e) => types.has(e.type) && e.payload['dimension'] === ACCOUNTING_DIMENSION);
}

/** Judge the accounting rules on one observed budgeted run. Pure. */
export function judgeAccounting(o: BudgetObservation, names: AccountingNames, policy: AccountingPolicy, home: string): AccountingFinding[] {
  const out: AccountingFinding[] = [];
  const calls = o.events.filter((e) => e.type === names.toolCalled).map((e) => e.sequence);
  const accounting = accountingEvents(o, names);

  // derived — judged only when the log carries calls and accounting to compare.
  if (calls.length > 0) {
    for (const e of accounting) {
      const consumed = num(e.payload['consumed']);
      const before = calls.filter((s) => s < e.sequence).length;
      out.push({
        rule: 'derived',
        ok: consumed === before,
        doc: home,
        message: `consumption is derived from ${names.toolCalled} and never measured twice: ${e.type} at sequence ${e.sequence} MUST report consumed ${before} (the ${names.toolCalled} events before it), got ${String(e.payload['consumed'])}`,
      });
    }
  }

  // limit — the recorded effective budget is the one every accounting event names.
  const reserved = o.events.find((e) => e.type === o.names.reserved);
  if (reserved !== undefined) {
    const eff = reserved.payload['effectiveBudget'];
    const recorded = eff !== null && typeof eff === 'object' && !Array.isArray(eff) ? num((eff as Record<string, unknown>)['maxToolCalls']) : undefined;
    out.push({
      rule: 'limit',
      ok: recorded !== undefined && Number.isInteger(recorded) && recorded <= policy.maxToolCalls,
      doc: home,
      message: `${o.names.reserved} MUST record the effective budget: effectiveBudget.maxToolCalls is the minimum across scopes, so at most the run's own ${policy.maxToolCalls} (got ${String(recorded)})`,
    });
    if (recorded !== undefined) {
      for (const e of accounting) {
        out.push({
          rule: 'limit',
          ok: num(e.payload['limit']) === recorded,
          doc: home,
          message: `${e.type} at sequence ${e.sequence} MUST name the limit ${o.names.reserved} recorded (${recorded}), got ${String(e.payload['limit'])} — a replay re-reads the reserved budget and never re-resolves it`,
        });
      }
    }
  }

  // threshold — once, at the policy's percent, not early.
  const crossings = o.events.filter((e) => e.type === o.names.threshold && e.payload['dimension'] === ACCOUNTING_DIMENSION);
  if (crossings.length > 0) {
    out.push({
      rule: 'threshold',
      ok: crossings.length === 1,
      doc: 'schemas/v2/budget-policy.schema.json thresholdPercent',
      message: `${o.names.threshold} MUST be emitted once per dimension (got ${crossings.length} for ${ACCOUNTING_DIMENSION} at sequences ${crossings.map((e) => e.sequence).join(', ')})`,
    });
    const first = crossings[0] as RunEvent;
    const percent = num(first.payload['percent']);
    const consumed = num(first.payload['consumed']);
    const limit = num(first.payload['limit']);
    out.push({
      rule: 'threshold',
      ok: percent === policy.thresholdPercent,
      doc: home,
      message: `${o.names.threshold}.percent MUST be the percent-of-limit threshold the policy set (${policy.thresholdPercent}), got ${String(first.payload['percent'])}`,
    });
    out.push({
      rule: 'threshold',
      ok: consumed !== undefined && limit !== undefined && limit > 0 && (consumed / limit) * 100 >= policy.thresholdPercent,
      doc: 'schemas/v2/budget-policy.schema.json thresholdPercent',
      message: `${o.names.threshold} MUST NOT precede the threshold: emitted at consumed ${String(first.payload['consumed'])} of limit ${String(first.payload['limit'])}, below ${policy.thresholdPercent}%`,
    });
  }
  return out;
}
