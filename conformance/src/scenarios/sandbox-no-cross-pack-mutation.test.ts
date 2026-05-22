/**
 * sandbox-no-cross-pack-mutation — RFC 0035 §B invariant
 * `node-pack-sandbox-no-cross-pack-mutation`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): pack A's sandbox invocation
 * cannot mutate state visible to pack B running in the same host process.
 * Exercised via two synthetic packs from `vendor.openwop.misbehaving-sandbox`:
 *   - pack-a writes a sentinel to a shared address (e.g., a global object,
 *     a known process-singleton, an ambient module);
 *   - pack-b reads the same address;
 * the test asserts pack-b does NOT see pack-a's write (sandbox isolation
 * holds at the pack boundary, not just at the syscall boundary).
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-cross-pack-mutation
 */

import { describe, it } from 'vitest';

// Behavioral assertion lands when the misbehaving-cross-pack-mutation
// typeIds ship + a host advertises `capabilities.sandbox.supported: true`.
// Expected: pack-b read returns the absent sentinel value; pack-a's
// mutation did not cross the isolation boundary. Surfaced as `todo` so
// test reporters track the gap rather than reporting a vacuous PASS.

describe('sandbox-no-cross-pack-mutation: behavioral (RFC 0035 §B)', () => {
  it.todo('pack A writing a sentinel is NOT visible to pack B in the same host process');
});
