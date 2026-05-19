/**
 * Capability overlay — sample-namespaced test seam for the conformance
 * harness to flip advertised capability flags on/off without rebooting
 * the host. Per `host-extensions.md` §"Canonical prefixes" the overlay
 * is exposed via `/v1/host/sample/test/capability-toggle` and is
 * env-gated on `OPENWOP_TEST_SEAM_ENABLED=true` at the route layer.
 *
 * The overlay is consulted by workflow-register validation (`workflows.ts`
 * §`checkMappingCapability`) and any other site that needs to honor a
 * temporary capability state change. Lookup precedence:
 *
 *   1. Overlay value (when set, via `setCapabilityOverlay`).
 *   2. Hard-coded advertised default (per `routes/discovery.ts`).
 *
 * The overlay is process-local and reset on suite teardown.
 */

const overlay = new Map<string, boolean>();

/** Default capability values the workflow-engine advertises in
 *  `/.well-known/openwop`. Mirrors `routes/discovery.ts` for the keys
 *  the workflow-register handler consults. Extend as needed. */
const DEFAULTS: Readonly<Record<string, boolean>> = {
  // RFC 0022 §C — the reference workflow-engine does NOT implement
  // dispatch input/output mapping today; advertisement is false. The
  // overlay can flip this on for tests that want the host to claim
  // the contract, but the reference impl will still refuse at execute
  // time (separate concern from the register-time gate).
  'agents.dispatchMapping': false,
  'subWorkflow.inputMapping': false,
};

/** Resolve a capability flag, consulting the overlay first then the
 *  advertised default. Returns `undefined` for unknown flags so callers
 *  can distinguish "not configured" from "configured: false". */
export function resolveCapabilityFlag(name: string): boolean | undefined {
  if (overlay.has(name)) return overlay.get(name);
  return DEFAULTS[name];
}

/** Set an overlay value. `undefined` removes the entry (restoring default). */
export function setCapabilityOverlay(name: string, value: boolean | undefined): void {
  if (value === undefined) overlay.delete(name);
  else overlay.set(name, value);
}

/** Clear ALL overlay entries (suite teardown). */
export function resetCapabilityOverlay(): void {
  overlay.clear();
}

/** Snapshot the current overlay state — used by the test-seam endpoint
 *  to report back what's currently overridden. */
export function snapshotCapabilityOverlay(): Record<string, boolean> {
  return Object.fromEntries(overlay.entries());
}
