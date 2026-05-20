/**
 * modelCapabilityProbe — static per-provider capability map for the RFC 0031
 * dispatch gate. The reference workflow-engine sample uses a configured
 * lookup table rather than a vendor-API probe — production hosts replace
 * this with their own dynamic capability detection.
 *
 * Each entry pairs a `ProviderId` (lowercase ASCII identifier matching
 * `capabilities.aiProviders.supported[]`) with the model capabilities the
 * host's dispatcher knows the provider's models advertise. The set is
 * conservative — only capabilities the host has actually verified
 * end-to-end appear here.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §C + §E
 * @see spec/v1/host-capabilities.md §"Model-capability declarations"
 * @see schemas/capabilities.schema.json §modelCapabilities.advertised
 */

const PROVIDER_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  anthropic: [
    // Strict tool use + structured-outputs GA (2026).
    'structured-output',
    // `anyOf` + single-string-enum discriminator: supported under strict tool use.
    'discriminator-enum',
    // 200k context window across Claude 3.5+ models; the reference host
    // advertises this for any Anthropic dispatch path.
    'long-context',
    // Extended thinking on Claude 3.7+ (the reference host's default class
    // for envelope-emitting nodes).
    'reasoning',
    // Multi-turn tool use loop.
    'function-calling',
  ],
  openai: [
    // strict mode on `response_format.json_schema.strict: true` + strict tool calling.
    'structured-output',
    'discriminator-enum',
    // o-series + GPT-4-class 128k+ models. Conservative advertisement —
    // the reference host's dispatcher routes to long-context-capable models.
    'long-context',
    // o-series reasoning tokens.
    'reasoning',
    'function-calling',
  ],
  google: [
    // `responseSchema` on generateContent (Vertex AI / Gemini API).
    'structured-output',
    // Discriminator-enum support landed in the Nov 2025 Gemini update.
    'discriminator-enum',
    // Gemini 1.5+ 1M context.
    'long-context',
    // Gemini 2.0 Flash Thinking + 2.5 Pro `thinkingBudget`.
    'reasoning',
    'function-calling',
  ],
};

/**
 * Return the set of capabilities the host knows the provider's active
 * models advertise. Unknown providers return an empty set — the dispatch
 * gate then treats every required capability as unmet and refuses
 * conservatively rather than dispatching with unknown semantics.
 */
export function probeProviderCapabilities(provider: string): readonly string[] {
  return PROVIDER_CAPABILITIES[provider] ?? [];
}

/**
 * Compute the union of all spec-reserved capabilities across the
 * providers the host advertises in `capabilities.aiProviders.supported[]`.
 * Used by the discovery advertisement so clients can introspect what
 * the host's active provider stack offers at install time.
 */
export function aggregateAdvertisedCapabilities(supportedProviders: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const provider of supportedProviders) {
    for (const cap of probeProviderCapabilities(provider)) {
      set.add(cap);
    }
  }
  return [...set].sort();
}
