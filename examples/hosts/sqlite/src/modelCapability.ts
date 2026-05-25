/**
 * RFC 0031 §B model-capability dispatch gate (ported from the reference
 * workflow-engine's `executor/modelCapabilityGate.ts` + `host/
 * modelCapabilityProbe.ts`).
 *
 * A node declaring `requiredModelCapabilities` the active model doesn't
 * advertise is refused at dispatch with `model.capability.insufficient`
 * (emitted BEFORE `node.failed`) + `error.code = "capability_not_provided"`
 * per RFC 0031 §B step 4 + §D. The reference host advertises
 * `substitutionSupported: false`, so a declared `fallbackModel` does not
 * trigger substitution.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §C + §D + §E
 * @see spec/v1/host-capabilities.md §"Model-capability declarations"
 */

// ── Static per-provider capability map (sample-grade; production hosts
//    probe vendor APIs). EMPTY here: the SQLite reference host routes NO
//    AI calls (it omits the `aiProviders` capability), so it knows no
//    provider's model capabilities. Any node requiring a capability is
//    therefore refused. A real AI-routing host populates this map (see
//    the Postgres reference host). ──
const PROVIDER_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {};

export function probeProviderCapabilities(provider: string): readonly string[] {
  return PROVIDER_CAPABILITIES[provider] ?? [];
}

/** Union of capabilities across the host's advertised providers — for the
 *  `capabilities.modelCapabilities.advertised` discovery field. */
export function aggregateAdvertisedCapabilities(supportedProviders: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const p of supportedProviders) for (const cap of probeProviderCapabilities(p)) set.add(cap);
  return [...set].sort();
}

interface FallbackModel {
  provider: string;
  model: string;
}

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
  | { route: 'refuse'; missingCapabilities: string[]; fallbackAttempted: boolean };

export interface ModelCapabilityGateInput {
  module: { requiredModelCapabilities?: readonly string[]; fallbackModel?: FallbackModel };
  activeProvider: string;
  activeModel: string;
  substitutionSupported: boolean;
  supportedProviders: readonly string[];
}

/** Pure function — no emission. RFC 0031 §B steps 1–4. */
export function evaluateModelCapabilityGate(input: ModelCapabilityGateInput): ModelCapabilityGateOutcome {
  const required = input.module.requiredModelCapabilities ?? [];
  if (required.length === 0) return { route: 'dispatch', substituted: false };

  const advertised = new Set(probeProviderCapabilities(input.activeProvider));
  const missing = required.filter((cap) => !advertised.has(cap));
  if (missing.length === 0) return { route: 'dispatch', substituted: false };

  const fallback = input.module.fallbackModel;
  if (!fallback) return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: false };
  if (!input.substitutionSupported) return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: false };
  if (!input.supportedProviders.includes(fallback.provider)) {
    return { route: 'refuse', missingCapabilities: missing, fallbackAttempted: true };
  }
  // No recursive fallback (RFC 0031 §"Unresolved questions" #3).
  const fallbackAdvertised = new Set(probeProviderCapabilities(fallback.provider));
  const stillMissing = required.filter((cap) => !fallbackAdvertised.has(cap));
  if (stillMissing.length > 0) return { route: 'refuse', missingCapabilities: stillMissing, fallbackAttempted: true };

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

export function buildSubstitutedPayload(
  outcome: Extract<ModelCapabilityGateOutcome, { route: 'substitute' }>,
  nodeId: string,
): Record<string, unknown> {
  return {
    nodeId,
    originalProvider: outcome.originalProvider,
    originalModel: outcome.originalModel,
    fallbackProvider: outcome.fallbackProvider,
    fallbackModel: outcome.fallbackModel,
    missingCapabilities: outcome.missingCapabilities,
  };
}

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

/** The host's active dispatch identity + posture. The SQLite reference host
 *  deliberately routes NO AI calls (it omits the `aiProviders` capability),
 *  so its active provider stack advertises NO model capabilities: every
 *  `requiredModelCapabilities` is unmet and the gate refuses. This keeps the
 *  discovery advertisement (`modelCapabilities.advertised: []`) consistent
 *  with the gate's behavior — honest for a non-AI-routing host. */
export const ACTIVE_PROVIDER = 'none';
export const ACTIVE_MODEL = 'none';
export const SUPPORTED_PROVIDERS: readonly string[] = [];
export const SUBSTITUTION_SUPPORTED = false;

/** Conformance typeId → declared `requiredModelCapabilities`. The SQLite
 *  reference host has no NodeModule manifest registry, so it hard-codes the
 *  conformance node's declaration (mirrors `FIXTURE_NODE_REQUIRES`). */
export const FIXTURE_NODE_MODEL_CAPABILITIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'conformance.modelCapability.insufficient': ['nonexistent-capability-9b3f'],
});
