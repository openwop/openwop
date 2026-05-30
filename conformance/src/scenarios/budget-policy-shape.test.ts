/**
 * Budget, quota, and cost policy — policy + events + cap.breached kinds (RFC 0084).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `budget-policy.schema.json` round-trips a conforming `BudgetPolicy` and
 *     rejects the malformed (the §A orthogonality guard — a wall-time field is
 *     rejected by `additionalProperties:false`, because wall-time is RFC 0058's
 *     `runTimeoutMs`; a `thresholdPercent` out of 0..100; an out-of-enum
 *     `onExhaustion`).
 *   - the four `budget.{reserved,consumed,threshold.crossed,exhausted}` payload
 *     $defs validate conforming content-free records and reject malformed ones.
 *   - the four new `cap.breached.kind` values (`budget-tokens`/`budget-cost`/
 *     `budget-tool-calls`/`budget-retries`) are present in the enum.
 *   - the four `budget.*` event names appear in the RunEventType enum.
 *   - the `budget.*` payloads are CONTENT-FREE OF PRICING: none declares a
 *     rate-card / per-token-price / model-prose property (the public test for the
 *     protocol-tier SECURITY invariant `budget-no-pricing-leak`).
 *   - `capabilities.budget` + `limits.maxBudget{Tokens,CostUsd}` are declared.
 *
 * Behavioral assertions (accrue → threshold → exhaust → `cap.breached{budget-cost}`
 * → `run.failed{budget_exhausted}`; `budget_model_denied`; the advisory no-stop
 * path) are gated on `capabilities.budget.supported` + `enforce` and land in
 * `budget-enforcement.test.ts` (deferred per RFC 0084 §Conformance — reference host
 * deferred). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/budget-policy.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0084-budget-quota-and-cost-policy.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (budget-no-pricing-leak)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/** Property names that would betray pricing / credential prose leaking onto a budget event. */
const PRICING_PROP_NAMES = ['ratecard', 'pricepertoken', 'unitprice', 'pricing', 'rate', 'credential', 'apikey', 'model'];

describe('budget-policy-shape: BudgetPolicy (RFC 0084 §A, server-free)', () => {
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const validate = ajv.compile(loadSchema('budget-policy.schema.json'));

  it('a conforming budget policy validates', () => {
    expect(
      validate({ maxTokens: 200000, maxCostUsd: 1.0, maxToolCalls: 50, maxRetries: 10, modelAllow: ['claude-*'], modelDeny: ['gpt-4-32k'], thresholdPercent: 80, onExhaustion: 'fail' }),
      why('budget-policy.md §A', 'a conforming BudgetPolicy MUST validate'),
    ).toBe(true);
  });

  it('the orthogonality guard: a wall-time field is rejected (it is RFC 0058 runTimeoutMs)', () => {
    expect(validate({ maxCostUsd: 1.0, maxWallTimeMs: 60000 }), why('budget-policy.md §A/§E', 'wall-time is NOT a budget dimension')).toBe(false);
  });

  it('rejects an out-of-range thresholdPercent and an out-of-enum onExhaustion', () => {
    expect(validate({ thresholdPercent: 120 }), why('budget-policy.md §A', 'thresholdPercent MUST be 0..100')).toBe(false);
    expect(validate({ onExhaustion: 'explode' }), why('budget-policy.md §A', 'onExhaustion is a closed enum')).toBe(false);
  });
});

describe('budget-policy-shape: budget.* events + cap.breached kinds (RFC 0084 §C/§D, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const compile = (defName: string) => ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: (payloads as { $defs: Record<string, unknown> }).$defs,
    $ref: `#/$defs/${defName}`,
  } as Record<string, unknown>);

  it('the four budget.* payloads validate conforming content-free records', () => {
    expect(compile('budgetReserved')({ effectiveBudget: { maxCostUsd: 1.0 }, scope: 'run' }), why('budget-policy.md §C', 'budget.reserved MUST validate')).toBe(true);
    expect(compile('budgetConsumed')({ dimension: 'cost', consumed: 0.7, limit: 1.0, remaining: 0.3 }), why('budget-policy.md §C', 'budget.consumed MUST validate')).toBe(true);
    expect(compile('budgetThresholdCrossed')({ dimension: 'cost', consumed: 0.8, limit: 1.0, percent: 80 }), why('budget-policy.md §C', 'budget.threshold.crossed MUST validate')).toBe(true);
    expect(compile('budgetExhausted')({ dimension: 'cost', consumed: 1.02, limit: 1.0 }), why('budget-policy.md §C', 'budget.exhausted MUST validate')).toBe(true);
  });

  it('rejects an out-of-enum dimension and a missing required field', () => {
    expect(compile('budgetConsumed')({ dimension: 'vibes', consumed: 1, limit: 2 }), why('budget-policy.md §C', 'dimension is a closed enum')).toBe(false);
    expect(compile('budgetExhausted')({ dimension: 'cost', consumed: 1.0 }), why('budget-policy.md §C', 'limit is REQUIRED')).toBe(false);
  });

  it('the cap.breached kind enum carries the four budget-* values', () => {
    const kinds = ((payloads.$defs as Record<string, { properties?: Record<string, { enum?: string[] }> }>).capBreached.properties?.kind?.enum) ?? [];
    for (const k of ['budget-tokens', 'budget-cost', 'budget-tool-calls', 'budget-retries']) {
      expect(kinds.includes(k), why('budget-policy.md §D', `cap.breached.kind MUST include ${k}`)).toBe(true);
    }
  });

  it('all four budget.* event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = ((runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum) ?? [];
    for (const name of ['budget.reserved', 'budget.consumed', 'budget.threshold.crossed', 'budget.exhausted']) {
      expect(enumVals.includes(name), why('run-event.schema.json', `${name} MUST be in the RunEventType enum`)).toBe(true);
    }
  });

  it('the budget.* payloads declare no pricing/credential property (budget-no-pricing-leak)', () => {
    const defs = payloads.$defs as Record<string, { properties?: Record<string, unknown> }>;
    for (const def of ['budgetReserved', 'budgetConsumed', 'budgetThresholdCrossed', 'budgetExhausted']) {
      for (const p of Object.keys(defs[def].properties ?? {})) {
        expect(PRICING_PROP_NAMES.includes(p.toLowerCase()), why('budget-no-pricing-leak', `${def} MUST NOT declare a pricing-bearing property (${p})`)).toBe(false);
      }
    }
  });
});

describe('budget-policy-shape: capability advertisement (RFC 0084 §E, server-free)', () => {
  it('capabilities.budget + limits.maxBudget{Tokens,CostUsd} are declared', () => {
    const caps = loadSchema('capabilities.schema.json');
    const props = caps.properties as Record<string, { properties?: Record<string, unknown> }>;
    for (const flag of ['supported', 'dimensions', 'enforce', 'scopes']) {
      expect(props.budget?.properties?.[flag], why('budget-policy.md §E', `capabilities.budget.${flag} MUST be declared`)).toBeDefined();
    }
    for (const ceiling of ['maxBudgetTokens', 'maxBudgetCostUsd']) {
      expect(props.limits?.properties?.[ceiling], why('budget-policy.md §E', `limits.${ceiling} MUST be declared`)).toBeDefined();
    }
  });
});
