/**
 * envelopeReliabilityConfig — runtime accessor for the RFC 0032 + RFC 0033
 * envelope-reliability emission posture of the reference workflow-engine
 * sample. Decoupled from `discovery.ts` so the dispatch layer reads the
 * same config the advertisement publishes.
 *
 * Three operator overrides:
 *
 *   - `OPENWOP_ENVELOPE_RELIABILITY_END_TO_END` (default `"true"`) —
 *     toggle for the dispatchStructured retry-loop emission + truncation-
 *     routing branch. Setting `"false"` reverts to the legacy undifferentiated
 *     retry loop (defensive circuit-breaker; lets operators disable the
 *     new code path without redeploying). When `false`, the discovery
 *     advertisement drops `events[]` and flips `distinguishesTruncation`
 *     to false so the host's claim stays honest.
 *
 *   - `OPENWOP_ENVELOPE_RELIABILITY_TRUNCATION_MULTIPLIER` (default `2`,
 *     clamped to `[1, 8]`) — per RFC 0033 §B + `capabilities.schema.json
 *     §envelopes.reliability.completion.truncationBudgetMultiplier`. The
 *     spec recommends `2` as a sane default; operators MAY widen for
 *     hosts that see frequent mid-emission truncation on long-form
 *     envelopes.
 *
 *   - `OPENWOP_ENVELOPE_RELIABILITY_MAX_RETRY_ATTEMPTS` (default `3`,
 *     clamped to `[1, 16]`) — host's retry budget per envelope emission.
 *     Conformance scenarios use this to construct fixtures that exercise
 *     the retry-exhausted path. Independent of
 *     `Capabilities.limits.schemaRounds` (the engine-side per-emission
 *     cap) — `maxRetryAttempts` reports the host's actual configured value.
 *
 * @see RFCS/0032-envelope-reliability-events.md §C
 * @see RFCS/0033-envelope-completion-contract.md §B + §E
 * @see apps/workflow-engine/backend/typescript/src/aiProviders/aiProvidersHost.ts dispatchStructured()
 * @see apps/workflow-engine/backend/typescript/src/routes/discovery.ts capabilities.envelopes.reliability
 */

export interface EnvelopeReliabilityConfig {
  /** Master switch — when `false`, the dispatchStructured retry loop
   *  falls back to legacy undifferentiated retry behavior (no envelope-
   *  reliability emission, no truncation-routing branch). Operator
   *  circuit-breaker. */
  endToEndEnabled: boolean;
  /** RFC 0033 §B truncation-retry budget multiplier. Default 2. */
  truncationBudgetMultiplier: number;
  /** RFC 0032 §C maxRetryAttempts. Default 3. */
  maxRetryAttempts: number;
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function parseClampedIntEnv(value: string | undefined, defaultValue: number, min: number, max: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

/**
 * Read the host's active envelope-reliability posture. Pure read — no
 * caching, no side effects. Cheap enough to call per-dispatch.
 */
export function getEnvelopeReliabilityConfig(): EnvelopeReliabilityConfig {
  return {
    endToEndEnabled: parseBoolEnv(process.env.OPENWOP_ENVELOPE_RELIABILITY_END_TO_END, true),
    truncationBudgetMultiplier: parseClampedIntEnv(
      process.env.OPENWOP_ENVELOPE_RELIABILITY_TRUNCATION_MULTIPLIER,
      2,
      1,
      8,
    ),
    maxRetryAttempts: parseClampedIntEnv(
      process.env.OPENWOP_ENVELOPE_RELIABILITY_MAX_RETRY_ATTEMPTS,
      3,
      1,
      16,
    ),
  };
}
