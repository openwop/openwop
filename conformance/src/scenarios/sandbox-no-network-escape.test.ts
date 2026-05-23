/**
 * sandbox-no-network-escape — RFC 0035 §B invariant `node-pack-sandbox-no-network-escape`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that initiates
 * a network request (fetch/connect/etc.) fails closed with
 * `sandbox_capability_denied` AND `details.requestedCapability: "host.fetch"`
 * (or equivalent) UNLESS `host.fetch` appears in
 * `capabilities.sandbox.allowedHostCalls`.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-network-escape
 */

import { describe, it } from 'vitest';

// Behavioral assertion lands when a sandbox-executing host advertises
// `capabilities.sandbox.supported: true` (with `host.fetch` NOT in
// `allowedHostCalls`) AND ships a misbehaving-network-escape typeId.
// The assertion drives the pack to fetch() inside the sandbox and asserts
// error.code === 'sandbox_capability_denied' with
// details.requestedCapability === 'host.fetch'. Surfaced as `todo` so
// test reporters track the gap rather than reporting a vacuous PASS.

describe('sandbox-no-network-escape: behavioral (RFC 0035 §B)', () => {
  // Behavioral coverage in `sandbox-mvp-behavior.test.ts` §"network-escape"
  // (drives `POST /v1/host/sample/test/sandbox-invoke` against the
  // workflow-engine's node:vm MVP). `it.skip` preserves the per-invariant
  // file structure without inflating the `it.todo` count.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"network-escape"');
});
