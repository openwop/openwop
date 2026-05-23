/**
 * sandbox-capability-gate-respected — RFC 0035 §B invariant
 * `node-pack-sandbox-capability-gate-respected`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that calls
 * a host capability NOT in `capabilities.sandbox.allowedHostCalls` fails
 * closed with `error.code: "sandbox_capability_denied"` AND
 * `details.requestedCapability` identifying the disallowed capability.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-capability-gate-respected
 */

import { describe, it } from 'vitest';

// Behavioral assertion lands when the misbehaving-capability-gate typeId
// ships + a host advertises `capabilities.sandbox.supported: true`.
// Expected: error.code === 'sandbox_capability_denied';
// details.requestedCapability is set to the disallowed identifier.
// Surfaced as `todo` so test reporters track the gap rather than
// reporting a vacuous PASS.

describe('sandbox-capability-gate-respected: behavioral (RFC 0035 §B)', () => {
  // Behavioral coverage in `sandbox-mvp-behavior.test.ts` §"capability-gate-respected"
  // (drives `POST /v1/host/sample/test/sandbox-invoke` against the
  // workflow-engine's node:vm MVP and asserts `error.code:
  // 'sandbox_capability_denied'` + `details.requestedCapability` per
  // `host-capabilities.md` §"Error codes"). `it.skip` preserves the
  // per-invariant file structure without inflating the `it.todo` count.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"capability-gate-respected"');
});
