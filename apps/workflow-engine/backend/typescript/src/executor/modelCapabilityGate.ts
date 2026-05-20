/**
 * modelCapabilityGate — RFC 0031 §B dispatch-time gate for model capabilities.
 *
 * Reads `NodeModule.requiredModelCapabilities` and checks against the active
 * provider's advertised capability set (per `host/modelCapabilityProbe.ts`).
 * On unmet capabilities the gate emits the appropriate
 * `model.capability.{substituted,insufficient}` event and returns a routing
 * decision the executor consumes.
 *
 * The reference workflow-engine sample advertises `substitutionSupported: false`
 * for v1.1 — when a NodeModule's `fallbackModel` is declared but the gate
 * needs to fire, the gate still emits `model.capability.insufficient`
 * (with `fallbackAttempted: false`, since the host's posture is "no
 * substitution"). Hosts that wire actual substitution flip the flag and
 * use this gate's `route: "substitute"` outcome.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §D
 * @see spec/v1/host-capabilities.md §"Model-capability declarations"
 * @see schemas/run-event-payloads.schema.json §modelCapabilitySubstituted + §modelCapabilityInsufficient
 */

import type { NodeModule } from './types.js';
import { probeProviderCapabilities } from '../host/modelCapabilityProbe.js';

export type ModelCapabilityGateOutcome =
  | { route: 'dispatch'; substituted: false }
  | {
      route: 'substitute';
      substituted: true;
      originalProvider: string;
      originalModel: string;
      fallbackProvider: string;
      fallbackModel: string;
      missingCapabilities: string[];
    }
  | {
      route: 'refuse';
      missingCapabilities: string[];
      fallbackAttempted: boolean;
    };

export interface ModelCapabilityGateInput {
  module: Pick<NodeModule, 'requiredModelCapabilities' | 'fallbackModel'>;
  /** Active provider id the dispatch path is about to route to. Lowercase
   *  ASCII; matches the convention in `capabilities.aiProviders.supported[]`. */
  activeProvider: string;
  /** Active model id (provider-stamped). Carried into the emitted event's
   *  `originalModel` field — informational only, no semantic gating. */
  activeModel: string;
  /** Whether the host has wired `capabilities.modelCapabilities.substitutionSupported: true`.
   *  The reference host defaults to `false` (no substitution); the gate
   *  honors this AND the per-NodeModule `fallbackModel` field. */
  substitutionSupported: boolean;
  /** Providers the host has credentials for. The gate authenticates the
   *  fallback by checking `fallbackModel.provider ∈ supportedProviders[]`
   *  per RFC 0031 §B step 3 ("host can authenticate to the fallback provider"). */
  supportedProviders: readonly string[];
}

/**
 * Evaluate the gate. Pure function — no emission, no side effects. Callers
 * (the executor) emit the appropriate event AND act on the outcome.
 *
 * Empty `requiredModelCapabilities` (or absent field) returns
 * `{ route: "dispatch", substituted: false }` — the gate is a no-op.
 */
export function evaluateModelCapabilityGate(input: ModelCapabilityGateInput): ModelCapabilityGateOutcome {
  const required = input.module.requiredModelCapabilities ?? [];
  if (required.length === 0) {
    return { route: 'dispatch', substituted: false };
  }

  const advertised = new Set(probeProviderCapabilities(input.activeProvider));
  const missing = required.filter((cap) => !advertised.has(cap));
  if (missing.length === 0) {
    return { route: 'dispatch', substituted: false };
  }

  // Active model is unsuitable. Attempt fallback per RFC 0031 §B step 3.
  const fallback = input.module.fallbackModel;
  if (!fallback) {
    // No declared fallback. Refuse with fallbackAttempted: false per RFC 0031 §B step 4.
    return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: false };
  }

  if (!input.substitutionSupported) {
    // Fallback declared but host's posture is "no substitution". Refuse
    // with fallbackAttempted: false — the host MUST NOT attempt fallback
    // even when the field is declared per RFC 0031 §E (substitutionSupported
    // semantics) + the schema description.
    return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: false };
  }

  if (!input.supportedProviders.includes(fallback.provider)) {
    // Cannot authenticate to fallback provider — emit insufficient with
    // fallbackAttempted: true per RFC 0031 §B step 4 + §D.
    return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: true };
  }

  // Verify the fallback model itself satisfies the required capabilities
  // (no-recursive-fallback per RFC 0031 §"Unresolved questions" #3).
  const fallbackAdvertised = new Set(probeProviderCapabilities(fallback.provider));
  const stillMissing = required.filter((cap) => !fallbackAdvertised.has(cap));
  if (stillMissing.length > 0) {
    return { route: 'refuse', missingCapabilities: stillMissing, fallbackAttempted: true };
  }

  return {
    route: 'substitute',
    substituted: true,
    originalProvider: input.activeProvider,
    originalModel: input.activeModel,
    fallbackProvider: fallback.provider,
    fallbackModel: fallback.model,
    missingCapabilities: missing,
  };
}

/**
 * Build the `model.capability.substituted` event payload for the executor
 * to emit. The host's workspace-policy redaction (per SECURITY invariant
 * `model-capability-substituted-no-credential-disclosure`) is applied by
 * the caller — this helper produces the unredacted shape.
 */
export function buildSubstitutedPayload(outcome: Extract<ModelCapabilityGateOutcome, { route: 'substitute' }>, nodeId: string): Record<string, unknown> {
  return {
    nodeId,
    originalProvider: outcome.originalProvider,
    originalModel: outcome.originalModel,
    fallbackProvider: outcome.fallbackProvider,
    fallbackModel: outcome.fallbackModel,
    missingCapabilities: outcome.missingCapabilities,
  };
}

/**
 * Build the `model.capability.insufficient` event payload.
 */
export function buildInsufficientPayload(
  outcome: Extract<ModelCapabilityGateOutcome, { route: 'refuse' }>,
  nodeId: string,
  provider: string,
  model: string,
): Record<string, unknown> {
  return {
    nodeId,
    provider,
    model,
    missingCapabilities: outcome.missingCapabilities,
    fallbackAttempted: outcome.fallbackAttempted,
  };
}
