/**
 * sandbox-no-host-process-escape — RFC 0035 §B invariant `node-pack-sandbox-no-host-process-escape`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that attempts
 * to spawn a host process, fork, or call exec-family syscalls fails closed
 * with `error.code: "sandbox_escape_attempt"` AND
 * `details.escapeKind: "host-process-escape"`.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-host-process-escape
 */

import { describe, it } from 'vitest';

// Behavioral assertion lands when a sandbox-executing host advertises
// `capabilities.sandbox.supported: true` AND ships a misbehaving-process-escape
// typeId (e.g., vendor.openwop.misbehaving-process). The assertion drives:
//   1. POST /v1/runs { workflowId: 'conformance-sandbox-process-escape' }
//      where the workflow includes a node loading the misbehaving typeId.
//   2. The node attempts spawn/fork/exec inside the sandbox.
//   3. Assert the run terminates with error.code === 'sandbox_escape_attempt'
//      AND error.details.escapeKind === 'host-process-escape'.
//   4. Assert no host process was actually spawned (host-side probe).
// Surfaced as `todo` so test reporters track the gap rather than reporting
// a vacuous PASS.

describe('sandbox-no-host-process-escape: behavioral (RFC 0035 §B)', () => {
  // Behavioral coverage in `sandbox-mvp-behavior.test.ts` §"host-process-escape"
  // (drives `POST /v1/host/sample/test/sandbox-invoke` against the
  // workflow-engine's node:vm MVP). `it.skip` preserves the per-invariant
  // file structure without inflating the `it.todo` count.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"host-process-escape"');
});
