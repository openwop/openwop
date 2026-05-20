/**
 * modelCapabilityGateConfig — runtime accessor for the RFC 0031 dispatch
 * gate's host-level configuration. Decoupled from `discovery.ts` so the
 * executor's gate evaluation reads the same config the advertisement
 * publishes.
 *
 * The reference sample makes minimum-viable choices:
 *
 *   - `defaultProvider` — the static "active provider" used by the gate
 *     at execute-time. Production hosts derive this from
 *     `RunOptions.configurable.ai.provider` per-run; the sample uses a
 *     single host-wide default (`process.env.OPENWOP_DEFAULT_AI_PROVIDER`
 *     or `"anthropic"`) since per-call provider selection happens inside
 *     each node's `ctx.callAI`. The gate's purpose is host-level
 *     refusal-at-dispatch — a node whose declared `requiredModelCapabilities`
 *     don't intersect with ANY of the host's configured providers fails
 *     conservatively. Per-call provider mismatch is a future refinement.
 *
 *   - `substitutionSupported` — `false` by default. The sample's
 *     `dispatchPlain()` doesn't yet intercept `ctx.callAI({provider, ...})`
 *     to swap the per-call provider, so advertising `true` would be
 *     dishonest. Operators MAY flip via
 *     `OPENWOP_MODEL_CAPABILITY_SUBSTITUTION=true` once they've wired the
 *     interception (and accept the consequence that the gate emits
 *     `model.capability.substituted` events the dispatcher then honors).
 *
 *   - `supportedProviders` — the host's `capabilities.aiProviders.supported[]`.
 *     The gate checks `fallbackModel.provider ∈ supportedProviders[]` per
 *     RFC 0031 §B step 3 ("host can authenticate to the fallback provider").
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §E
 * @see apps/workflow-engine/backend/typescript/src/executor/modelCapabilityGate.ts
 * @see apps/workflow-engine/backend/typescript/src/host/modelCapabilityProbe.ts
 */

import { aggregateAdvertisedCapabilities } from './modelCapabilityProbe.js';

export interface ModelCapabilityGateConfig {
  /** RFC 0031 §E. `true` when the host honors `NodeModule.requiredModelCapabilities`
   *  at dispatch and emits `model.capability.{substituted,insufficient}`
   *  per RFC 0031 §D. */
  supported: boolean;
  /** Capability identifiers the host's active provider stack advertises.
   *  Used by the discovery advertisement so clients can introspect at
   *  install time. The gate uses per-provider lookup via
   *  `probeProviderCapabilities()` rather than this aggregated set. */
  advertised: readonly string[];
  /** RFC 0031 §E. When `false`, the gate refuses on any unmet capability
   *  rather than attempting fallback. Honest advertisement of the sample's
   *  current posture — full substitution requires per-call provider
   *  interception not yet wired into `dispatchPlain()`. */
  substitutionSupported: boolean;
  /** RFC 0031 §B step 3 — the providers the gate considers authenticatable.
   *  Mirrors `capabilities.aiProviders.supported[]`. */
  supportedProviders: readonly string[];
  /** Static "active provider" for the execute-time gate evaluation. Picks
   *  the first entry in `supportedProviders` unless overridden via
   *  `OPENWOP_DEFAULT_AI_PROVIDER`. Production hosts derive this from
   *  per-run `RunOptions.configurable.ai.provider`. */
  defaultProvider: string;
  /** Static "active model" used for event payload `originalModel`.
   *  Informational only — the gate's refusal/substitute decision keys
   *  on the provider, not the model. */
  defaultModel: string;
}

const SAMPLE_SUPPORTED_PROVIDERS: readonly string[] = ['anthropic', 'openai', 'google'] as const;

function pickDefaultProvider(supportedProviders: readonly string[]): string {
  const override = process.env.OPENWOP_DEFAULT_AI_PROVIDER;
  if (override && supportedProviders.includes(override)) return override;
  return supportedProviders[0] ?? 'anthropic';
}

/**
 * Read the host's active model-capability-gate posture. Pure read — no
 * caching, no side effects. Cheap enough to call per-dispatch.
 */
export function getModelCapabilityGateConfig(): ModelCapabilityGateConfig {
  const supportedProviders = SAMPLE_SUPPORTED_PROVIDERS;
  return {
    supported: true,
    advertised: aggregateAdvertisedCapabilities(supportedProviders),
    // The sample doesn't yet intercept ctx.callAI per-call to swap
    // providers. Operators that have wired the interception flip
    // OPENWOP_MODEL_CAPABILITY_SUBSTITUTION=true.
    substitutionSupported: process.env.OPENWOP_MODEL_CAPABILITY_SUBSTITUTION === 'true',
    supportedProviders,
    defaultProvider: pickDefaultProvider(supportedProviders),
    defaultModel: process.env.OPENWOP_DEFAULT_AI_MODEL ?? 'default',
  };
}
