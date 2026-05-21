/**
 * parseRefusal — normalize per-provider LLM safety-stop signals to the
 * canonical RFC 0032 §B.3 refusal shape.
 *
 * The three Tier-1 vendors (Anthropic / OpenAI / Google Gemini) surface
 * refusals through different fields:
 *
 *   - **Anthropic Messages API**: `stop_reason: "refusal"` (their 2025
 *     release) OR `stop_reason: "end_turn"` accompanied by safety-stop
 *     markers in the content. Refusal text MAY be inline in the
 *     `content[]` array's text blocks.
 *   - **OpenAI Chat Completions**: `choices[0].finish_reason:
 *     "content_filter"` OR `choices[0].message.refusal: <string>` (the
 *     refusal-text field added in their structured-output release).
 *   - **Google Gemini**: `candidates[0].finishReason: "SAFETY"` OR
 *     `promptFeedback.blockReason: "SAFETY"` (input-side block).
 *
 * Without normalization, every host re-implements this detection. This
 * helper consolidates the per-vendor shape-detection and returns a
 * canonical `RefusalSignal | null` — null when the response is a
 * normal completion (no refusal detected).
 *
 * Per RFC 0032 §B.3 + RFC 0033 §D, hosts MUST NOT retry on refusal
 * (circumvention concern). Callers route the non-null return through
 * `envelope.refusal` emission + the `envelope_refusal` terminal error
 * code (per RFC 0033 §F).
 *
 * Per SECURITY/invariants.yaml §envelope-refusal-no-prompt-leak,
 * `refusalText` MUST be passed through the host's BYOK redaction
 * harness BEFORE persistence — this helper does NOT redact; the
 * caller is responsible for SR-1 carry-forward.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.3
 * @see RFCS/0033-envelope-completion-contract.md §D + §F
 * @see SECURITY/invariants.yaml §envelope-refusal-no-prompt-leak
 */

/**
 * Provider identifier for the matched shape. `"unknown"` is reserved
 * for refusals matched on heuristic signals without a definitive
 * vendor-shape match.
 */
export type RefusalProvider = 'anthropic' | 'openai' | 'google' | 'unknown';

/**
 * Canonical refusal signal. All three Tier-1 vendor shapes normalize
 * to this form. `null` from `parseRefusal()` means "no refusal detected"
 * (a normal completion); a non-null `RefusalSignal` means the caller
 * SHOULD route through the RFC 0032 §B.3 refusal-emission path.
 */
export interface RefusalSignal {
  /**
   * The provider's refusal text, when surfaced. MAY be `null` even for
   * detected refusals — Anthropic + Gemini frequently refuse without
   * inline text (the safety filter is opaque to the model). OpenAI's
   * `message.refusal` field is the most consistent source of human-
   * readable refusal text.
   *
   * **SECURITY:** When non-null, `refusalText` MAY contain prompt
   * content that triggered the safety filter. Callers MUST pass it
   * through their BYOK + prompt-content redaction harness BEFORE
   * persistence (per `envelope-refusal-no-prompt-leak` SECURITY
   * invariant).
   */
  refusalText: string | null;

  /**
   * Provider-specific safety-category identifier, when surfaced.
   * Examples: Gemini's safety-rating categories
   * (`HARM_CATEGORY_HARASSMENT`, etc.), OpenAI's content-filter category,
   * Anthropic's policy-violation tag. Hosts MAY echo this on the
   * `envelope.refusal.safetyCategory` event field for downstream
   * observability.
   */
  safetyCategory?: string;

  /**
   * Which provider's shape was matched. Useful for debugging
   * cross-host integration + for hosts that want to route refusals
   * differently per vendor (e.g., different operator notifications).
   */
  provider: RefusalProvider;
}

interface OpenAIChoiceMessage {
  refusal?: unknown;
  content?: unknown;
}

interface OpenAIChoice {
  finish_reason?: unknown;
  message?: unknown;
}

interface OpenAIResponse {
  choices?: unknown;
}

interface AnthropicTextBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicResponse {
  stop_reason?: unknown;
  content?: unknown;
}

interface GeminiSafetyRating {
  category?: unknown;
  probability?: unknown;
}

interface GeminiCandidate {
  finishReason?: unknown;
  safetyRatings?: unknown;
  content?: unknown;
}

interface GeminiPromptFeedback {
  blockReason?: unknown;
  safetyRatings?: unknown;
}

interface GeminiResponse {
  candidates?: unknown;
  promptFeedback?: unknown;
}

/**
 * Try to parse the response as OpenAI Chat Completions output.
 *
 * Detection: top-level `choices` array. Refusal signals:
 *   - `choices[0].finish_reason === "content_filter"`
 *   - `choices[0].message.refusal` is a non-empty string
 */
function tryParseOpenAI(response: unknown): RefusalSignal | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as OpenAIResponse;
  if (!Array.isArray(r.choices) || r.choices.length === 0) return null;
  const choice = r.choices[0] as OpenAIChoice;
  if (!choice || typeof choice !== 'object') return null;

  const finishReason = choice.finish_reason;
  const message = choice.message as OpenAIChoiceMessage | undefined;
  const refusalField = message && typeof message === 'object' ? message.refusal : undefined;

  // Primary signal: explicit refusal-text field. OpenAI's structured-output
  // release populates this when the safety filter intervenes.
  if (typeof refusalField === 'string' && refusalField.length > 0) {
    return { refusalText: refusalField, provider: 'openai' };
  }

  // Secondary signal: finish_reason. content_filter is the canonical
  // safety-stop value.
  if (finishReason === 'content_filter') {
    const text =
      message && typeof message === 'object' && typeof message.content === 'string'
        ? message.content
        : null;
    return { refusalText: text, safetyCategory: 'content_filter', provider: 'openai' };
  }

  return null;
}

/**
 * Try to parse the response as Anthropic Messages API output.
 *
 * Detection: top-level `stop_reason` field (Anthropic's distinctive
 * marker). Refusal signals:
 *   - `stop_reason === "refusal"` (their 2025 release)
 *
 * Anthropic does not surface a distinct safety-category field on
 * refusals; the `refusal` stop_reason is the binary signal.
 */
function tryParseAnthropic(response: unknown): RefusalSignal | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as AnthropicResponse;
  if (typeof r.stop_reason !== 'string') return null;

  if (r.stop_reason === 'refusal') {
    // Extract refusal text from the content array (Anthropic returns an
    // array of typed blocks; refusal text appears in `text`-type blocks).
    let refusalText: string | null = null;
    if (Array.isArray(r.content)) {
      const textBlocks: string[] = [];
      for (const block of r.content) {
        if (block && typeof block === 'object') {
          const b = block as AnthropicTextBlock;
          if (b.type === 'text' && typeof b.text === 'string') {
            textBlocks.push(b.text);
          }
        }
      }
      if (textBlocks.length > 0) refusalText = textBlocks.join('\n');
    }
    return { refusalText, provider: 'anthropic' };
  }

  return null;
}

/**
 * Try to parse the response as Google Gemini `generateContent` output.
 *
 * Detection: top-level `candidates` array OR top-level `promptFeedback`
 * object. Refusal signals:
 *   - `candidates[0].finishReason === "SAFETY"` (output-side block)
 *   - `promptFeedback.blockReason === "SAFETY"` (input-side block)
 *
 * Gemini surfaces safety categories on `safetyRatings[]`; this helper
 * picks the highest-probability HIGH/MEDIUM-tier category as
 * `safetyCategory` when available.
 */
function tryParseGemini(response: unknown): RefusalSignal | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as GeminiResponse;

  // Output-side safety block.
  if (Array.isArray(r.candidates) && r.candidates.length > 0) {
    const candidate = r.candidates[0] as GeminiCandidate;
    if (candidate && typeof candidate === 'object' && candidate.finishReason === 'SAFETY') {
      const safetyCategory = extractGeminiHighestRiskCategory(candidate.safetyRatings);
      const result: RefusalSignal = { refusalText: null, provider: 'google' };
      if (safetyCategory !== undefined) result.safetyCategory = safetyCategory;
      return result;
    }
  }

  // Input-side safety block (Gemini rejected the prompt itself).
  if (r.promptFeedback && typeof r.promptFeedback === 'object') {
    const pf = r.promptFeedback as GeminiPromptFeedback;
    if (typeof pf.blockReason === 'string' && pf.blockReason.toUpperCase().includes('SAFETY')) {
      const safetyCategory = extractGeminiHighestRiskCategory(pf.safetyRatings);
      const result: RefusalSignal = { refusalText: null, provider: 'google' };
      if (safetyCategory !== undefined) result.safetyCategory = safetyCategory;
      return result;
    }
  }

  return null;
}

/**
 * From a Gemini `safetyRatings[]` array, return the highest-probability
 * non-NEGLIGIBLE category identifier. Returns `undefined` when the
 * array is absent or all ratings are NEGLIGIBLE.
 */
function extractGeminiHighestRiskCategory(safetyRatings: unknown): string | undefined {
  if (!Array.isArray(safetyRatings)) return undefined;
  const PROBABILITY_RANK: Record<string, number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    NEGLIGIBLE: 0,
  };
  let best: { category: string; rank: number } | null = null;
  for (const rating of safetyRatings) {
    if (!rating || typeof rating !== 'object') continue;
    const r = rating as GeminiSafetyRating;
    if (typeof r.category !== 'string' || typeof r.probability !== 'string') continue;
    const rank = PROBABILITY_RANK[r.probability.toUpperCase()] ?? 0;
    if (rank === 0) continue;
    if (best === null || rank > best.rank) {
      best = { category: r.category, rank };
    }
  }
  return best?.category;
}

/**
 * Parse a provider response into a canonical refusal signal.
 *
 * Returns `null` when no refusal is detected (normal completion).
 * Returns a `RefusalSignal` when the response matches one of the
 * three Tier-1 vendors' safety-stop shapes.
 *
 * Detection order: OpenAI → Anthropic → Gemini. Each detector inspects
 * a distinctive top-level field, so cross-vendor false-positives are
 * unlikely. A response that doesn't match any vendor shape returns
 * `null` (hosts that route through novel providers add their own
 * detector + fall back to this for the three known ones).
 *
 * @example
 * ```ts
 * import { parseRefusal } from '@openwop/openwop';
 *
 * const response = await callOpenAI({...});
 * const refusal = parseRefusal(response);
 * if (refusal) {
 *   // Route through envelope.refusal emission + envelope_refusal error code.
 *   // REMEMBER to redact refusalText through the BYOK harness before
 *   // persistence (SECURITY invariant envelope-refusal-no-prompt-leak).
 *   await emitEnvelopeRefusal({
 *     refusalText: redactBYOK(refusal.refusalText),
 *     safetyCategory: refusal.safetyCategory,
 *     provider: refusal.provider,
 *   });
 *   throw new EnvelopeRefusalError(...);
 * }
 * // ...normal-completion handling...
 * ```
 */
export function parseRefusal(providerResponse: unknown): RefusalSignal | null {
  return (
    tryParseOpenAI(providerResponse) ??
    tryParseAnthropic(providerResponse) ??
    tryParseGemini(providerResponse)
  );
}
