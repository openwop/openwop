/**
 * Cost-attribution allowlist + sanitizer helpers
 * (`spec/v1/observability.md §"Cost attribution attributes"`).
 *
 * The spec MUSTs that hosts emitting `openwop.cost.*` OTel span attrs
 * route them through an allowlist sanitizer that drops any attribute
 * name outside the canonical set AND any non-primitive value. The
 * `cost-attribution-allowlist-redaction` SECURITY invariant + the
 * `cost-attribution.test.ts` conformance scenario are the public test
 * surface; this module is the SDK-side helper that independent hosts
 * (TypeScript / Python / Go) can share so the allowlist has a single
 * source of truth instead of being re-derived in each runtime.
 *
 * Why this lives in the SDK and not just the conformance suite:
 * implementations need the allowlist at HOST EMIT TIME (before spans
 * are written). Importing from `@openwop/openwop` keeps the runtime
 * + the conformance assertion in lockstep — if a future RFC adds an
 * eighth attribute, one PR updates the constant and both surfaces
 * pick it up.
 *
 * @see spec/v1/observability.md §"Cost attribution attributes"
 * @see SECURITY/invariants.yaml row `cost-attribution-allowlist-redaction`
 * @see conformance/src/scenarios/cost-attribution.test.ts
 */

/** Canonical allowlist of cost-attribute names. Mutating this list is
 *  a wire-shape change — needs an RFC. */
export const OPENWOP_COST_ATTRIBUTE_NAMES = [
  'openwop.cost.tokens.input',
  'openwop.cost.tokens.output',
  'openwop.cost.tokens.total',
  'openwop.cost.usd',
  'openwop.cost.currency',
  'openwop.cost.estimated',
  'openwop.cost.provider',
] as const;

/** Union of the canonical attribute names. Useful for typed
 *  sanitizer outputs in callers that pin the shape. */
export type OpenwopCostAttributeName = (typeof OPENWOP_COST_ATTRIBUTE_NAMES)[number];

const ALLOWLIST: ReadonlySet<string> = new Set<string>(OPENWOP_COST_ATTRIBUTE_NAMES);

/** Pure-function sanitizer. Returns a NEW object containing only
 *  allowlisted keys with primitive-typed values (number / string /
 *  boolean). Drops anything else — non-allowlisted keys, nested
 *  objects, arrays, functions, symbols, null, undefined.
 *
 *  Callers SHOULD invoke this immediately before writing cost attrs
 *  to an OTel span:
 *
 *  ```ts
 *  import { sanitizeCostAttributes } from '@openwop/openwop';
 *  for (const [k, v] of Object.entries(sanitizeCostAttributes(rawAttrs))) {
 *    span.setAttribute(k, v);
 *  }
 *  ```
 *
 *  The reference workflow-engine host wires this via
 *  `apps/workflow-engine/backend/typescript/src/observability/costEmitter.ts`. */
export function sanitizeCostAttributes(
  input: Record<string, unknown>,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWLIST.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}
