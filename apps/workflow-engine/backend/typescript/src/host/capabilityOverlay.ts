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

/** Default capability values the workflow-engine consults at
 *  workflow-register time. Per RFC 0022 §C lines 115/138/224 the
 *  reference workflow-engine implements the register-time REFUSAL
 *  contract (a workflow with non-empty mapping fields gets
 *  `validation_error + details.requiredCapability` when the flag
 *  isn't claimed) but does NOT yet implement the dispatch/subWorkflow
 *  executors — so the honest advertisement is `false`.
 *
 *  Design choice (2026-05-19, code-review MEDIUM #3): we keep the
 *  flags at `false` here AND omit them from
 *  `routes/discovery.ts` rather than advertising `agents.dispatch:
 *  true` to make the HVMAP-1a-refusal scenario fire against this
 *  host. Rationale: advertising what we don't actually execute would
 *  violate `INTEROP-MATRIX.md`'s honesty principle. Hosts that DO
 *  implement dispatch (MyndHyve, the Postgres reference) are the
 *  natural test target for the refusal scenarios; the conformance
 *  test soft-skips against the workflow-engine until the dispatch
 *  executor lands. */
const DEFAULTS: Readonly<Record<string, boolean>> = {
  // RFC 0022 §A — core.dispatch perWorker variable projection. Now
  // executed by core.dispatch node + dispatcher engine code, so flip
  // from false → true. Conformance opt-out scenarios re-toggle to
  // false via the capability-toggle seam.
  'agents.dispatchMapping': true,
  // RFC 0022 §B — core.subWorkflow input/output mapping. Executed by
  // executor/subWorkflowDispatcher.ts. Flip default to true.
  'subWorkflow.inputMapping': true,
  // ai-envelope.md §"Capability handshake integration" + capabilities.md
  // §"Unsupported capability — refusal contract": a node whose typeId
  // requires `host.aiEnvelope: supported` MUST be refused if the host
  // doesn't advertise it. The workflow-engine sample IS implementing
  // the aiEnvelope acceptor (this whole codebase), so the honest
  // default is `true` — only conformance tests that exercise the
  // refusal path toggle it off via the capability-toggle seam.
  'host.aiEnvelope.supported': true,
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
