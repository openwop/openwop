/**
 * sandbox-no-host-env-leak — RFC 0035 §B invariant `node-pack-sandbox-no-host-env-leak`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that reads
 * `process.env` (or the platform equivalent) does NOT see host-level env
 * vars unless the host has forwarded them via an `allowedHostCalls` entry
 * exposing env resolution.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-host-env-leak
 */

import { describe, it } from 'vitest';

// Behavioral assertion lands when a sandbox-executing host advertises
// `capabilities.sandbox.supported: true` AND ships a misbehaving-env-leak
// typeId. The assertion sets a canary env var on the host process, runs
// the misbehaving pack that reads `process.env`, and asserts the pack's
// view of env does NOT contain the canary (unless the host has forwarded
// it via an `allowedHostCalls` entry). Surfaced as `todo` so test
// reporters track the gap rather than reporting a vacuous PASS.

describe('sandbox-no-host-env-leak: behavioral (RFC 0035 §B)', () => {
  // Behavioral coverage in `sandbox-mvp-behavior.test.ts` §"host-env-leak"
  // (drives `POST /v1/host/sample/test/sandbox-invoke` against the
  // workflow-engine's node:vm MVP). `it.skip` preserves the per-invariant
  // file structure without inflating the `it.todo` count.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"host-env-leak"');
});
