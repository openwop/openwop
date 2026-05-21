/**
 * envelopeDirective — RFC 0030 §A `reasoning`-field prompt directive synthesis.
 *
 * Hosts that advertise `capabilities.envelopes.reasoning.supported: true`
 * with `promptDirective: "advisory"` or `"mandatory"` inject a system-prompt
 * directive instructing the model to populate the OPTIONAL `reasoning` field
 * on envelope payload schemas that carry it. The directive is informational
 * — hosts MUST NOT reject envelopes where `reasoning` is absent regardless
 * of `promptDirective` strength (RFC 0030 §A).
 *
 * The directive fires only when the envelope's `responseSchema` declares a
 * top-level `reasoning` property. Schemas without `reasoning` (e.g.,
 * `schema.response` per RFC 0030 §A) do NOT receive the directive.
 *
 * Honest separation of concerns:
 *   - This module decides WHEN to inject (schema has `reasoning`).
 *   - The caller decides WHETHER to inject (read `promptDirective` from
 *     the host's discovery advertisement).
 *   - The model decides whether to ACTUALLY populate the field (the spec
 *     forbids rejecting envelopes where `reasoning` is absent).
 *
 * **Operational note on `"mandatory"`** (per RFC 0030 §A 2026-05-21
 * amendment). Strict-output models may honor the mandatory wording
 * literally and refuse mid-emission when reasoning would be vacuous.
 * Hosts SHOULD prefer `"advisory"` unless empirical testing against the
 * active model class confirms `"mandatory"` doesn't trigger refusals.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §A
 * @see spec/v1/ai-envelope.md §"Reasoning field (normative)"
 */

/**
 * The strength of the host's `reasoning`-directive prompt injection.
 *
 * `"off"`      — no directive injected. Caller skips this module entirely.
 * `"advisory"` — directive is suggestive ("populate `reasoning` with your
 *                analytical process if the schema permits it"). The
 *                spec-recommended default per RFC 0030 §C.
 * `"mandatory"` — directive is firm ("you MUST populate `reasoning` before
 *                 emitting the structured fields"). Hosts SHOULD prefer
 *                 `"advisory"` unless model-class-specific testing shows
 *                 `"mandatory"` is safe.
 *
 * Both `"advisory"` and `"mandatory"` are prompt-injection postures, NOT
 * wire-level refusal contracts — the host accepts envelopes regardless of
 * whether `reasoning` is populated (RFC 0030 §A normative MUST NOT).
 */
export type ReasoningDirectiveStrength = 'off' | 'advisory' | 'mandatory';

/**
 * Build the directive string to append to the system prompt, OR `null` if
 * the schema does not declare a top-level `reasoning` property.
 *
 * Callers append the returned string to the existing system prompt with a
 * separating newline. When `strength === 'off'`, callers SHOULD short-circuit
 * before invoking this helper (returning `null` here is treated as "no
 * applicable schema," not "directive disabled").
 *
 * The helper inspects only the top-level `properties.reasoning` slot.
 * Nested `reasoning` fields (e.g., inside an `anyOf` branch's payload) are
 * not auto-detected — vendor-kind authors who want per-branch directives
 * synthesize their own.
 *
 * @example
 * ```ts
 * import { buildReasoningDirective } from '@openwop/openwop';
 *
 * const directive = buildReasoningDirective(
 *   { type: 'object', properties: { reasoning: { type: 'string' }, ... } },
 *   'advisory',
 * );
 * // directive is a string ~80 words; null when schema lacks `reasoning`
 * const systemPrompt = [originalSystemPrompt, schemaHint, directive]
 *   .filter((s): s is string => Boolean(s))
 *   .join('\n\n');
 * ```
 */
export function buildReasoningDirective(
  responseSchema: unknown,
  strength: ReasoningDirectiveStrength,
): string | null {
  if (strength === 'off') return null;
  if (!responseSchema || typeof responseSchema !== 'object') return null;

  const schema = responseSchema as { properties?: unknown };
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return null;

  const reasoningProp = (properties as { reasoning?: unknown }).reasoning;
  if (!reasoningProp || typeof reasoningProp !== 'object') return null;

  if (strength === 'mandatory') {
    return [
      'BEFORE emitting the structured fields, populate the `reasoning` property with your analytical',
      'process — explain how you derived each structured field, what assumptions you made, and what',
      'risks or alternative interpretations you considered. The `reasoning` field is REQUIRED in your',
      'output; do not skip it. (Note: the host accepts envelopes where `reasoning` is absent per',
      'RFC 0030 §A, but for this dispatch the host expects it populated.)',
    ].join(' ');
  }

  // strength === 'advisory'
  return [
    'If your response schema declares a `reasoning` property, populate it as the first field with',
    'your analytical process — explain how you derived each structured field. Per Tam et al. (arXiv',
    "2408.02442), models constrained to strict JSON output suffer reasoning-quality collapse when",
    'no reasoning slot exists; use this field to think before emitting the structured payload. The',
    'host accepts envelopes where `reasoning` is absent — populate it when it improves clarity.',
  ].join(' ');
}
