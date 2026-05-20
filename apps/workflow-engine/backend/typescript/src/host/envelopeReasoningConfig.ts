/**
 * envelopeReasoningConfig — runtime accessor for the reference host's
 * RFC 0030 `reasoning`-field prompt-directive posture.
 *
 * Decoupled from `discovery.ts` (which builds the static advertisement
 * object) so the dispatch layer can read the active config without a
 * circular import. Operators MAY override the default `"advisory"`
 * posture via `OPENWOP_ENVELOPE_REASONING_DIRECTIVE` (one of `off` /
 * `advisory` / `mandatory`); the discovery advertisement reads through
 * the same accessor so what the host advertises and what it actually
 * injects stay in lockstep.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §A + §C
 * @see apps/workflow-engine/backend/typescript/src/host/envelopeDirective.ts
 * @see apps/workflow-engine/backend/typescript/src/routes/discovery.ts
 */

import type { ReasoningDirectiveStrength } from './envelopeDirective.js';

interface EnvelopeReasoningConfig {
  /** RFC 0030 §A. `true` when the host's schemas accept `reasoning` AND
   *  the host has chosen to surface the convention. The reference host
   *  always advertises `true` (the universal-kind schemas carry the
   *  field; this flag toggles the host's intent to USE it). */
  supported: boolean;
  /** RFC 0030 §C. The strength of the system-prompt directive the host
   *  injects when an envelope's responseSchema declares a `reasoning`
   *  property. Default `"advisory"` (suggestive). Operators MAY set
   *  `"off"` to disable injection entirely OR `"mandatory"` to firm up
   *  the wording. */
  promptDirective: ReasoningDirectiveStrength;
}

const VALID_STRENGTHS: ReadonlySet<ReasoningDirectiveStrength> = new Set(['off', 'advisory', 'mandatory']);

function parseStrengthEnv(value: string | undefined): ReasoningDirectiveStrength {
  if (value && VALID_STRENGTHS.has(value as ReasoningDirectiveStrength)) {
    return value as ReasoningDirectiveStrength;
  }
  // Default posture: advisory. Matches the RFC 0030 §C recommendation
  // (suggestive directive; never refuses envelopes where `reasoning` is
  // absent regardless of strength).
  return 'advisory';
}

/**
 * Read the host's active envelope-reasoning posture. Pure read — no
 * caching, no side effects. Cheap enough to call per-dispatch.
 */
export function getEnvelopeReasoningConfig(): EnvelopeReasoningConfig {
  return {
    supported: true,
    promptDirective: parseStrengthEnv(process.env.OPENWOP_ENVELOPE_REASONING_DIRECTIVE),
  };
}
