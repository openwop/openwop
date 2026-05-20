/**
 * model-capability-insufficient — RFC 0031 §B step 4 + §D runtime behavior.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true` AND
 * the host's test seam. Soft-skip when the capability is absent.
 *
 * Asserts:
 *   1. When a NodeModule declares `requiredModelCapabilities` the active model
 *      does NOT advertise AND no viable fallback is available (no `fallbackModel`
 *      declared, OR substitution unsupported, OR fallback authentication fails),
 *      the host emits exactly one `model.capability.insufficient` event AND
 *      refuses to dispatch.
 *   2. The run terminates with `RunSnapshot.error.code = "capability_not_provided"`
 *      per `capabilities.md` §"Unsupported capability — refusal contract".
 *   3. No envelope emission occurs (no `node.completed`, no `provider.usage`, etc.).
 *   4. Recursive substitution is NOT performed — if a declared fallback itself
 *      fails capability checks, the host emits this event with
 *      `fallbackAttempted: true` and refuses (no chaining).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the dispatch gate.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B step 4 + §D
 * @see schemas/run-event-payloads.schema.json §modelCapabilityInsufficient
 */

import { describe, it } from 'vitest';

describe('model-capability-insufficient: dispatch refusal (RFC 0031 §B step 4 + §D)', () => {
  it.todo(
    'when active model lacks a required capability AND no `fallbackModel` declared, the host emits `model.capability.insufficient` with `fallbackAttempted: false`',
  );
  it.todo(
    'when active model lacks a required capability AND `fallbackModel` declared but `substitutionSupported: false`, the host emits `model.capability.insufficient` with `fallbackAttempted: false`',
  );
  it.todo(
    'when active model lacks a required capability AND fallback authentication fails (no resolvable credential for `fallbackModel.provider`), the host emits `model.capability.insufficient` with `fallbackAttempted: true`',
  );
  it.todo(
    'run terminates with `RunSnapshot.error.code = "capability_not_provided"` per `capabilities.md` §"Unsupported capability — refusal contract"',
  );
  it.todo(
    'NO envelope emission occurs after `model.capability.insufficient` — no `node.completed`, `provider.usage`, or envelope-reliability events',
  );
  it.todo(
    'recursive substitution is NOT performed — if substituted fallback itself fails capability checks, the host emits this event with `fallbackAttempted: true` rather than chaining to another fallback (RFC 0031 §"Unresolved questions" #3)',
  );
});
