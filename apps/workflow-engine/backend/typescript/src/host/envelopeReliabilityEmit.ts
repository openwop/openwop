/**
 * envelopeReliabilityEmit — RFC 0032 §B payload builders for the four
 * envelope-reliability events the reference host emits from
 * `dispatchStructured()`. Pure functions — no I/O, no event emission;
 * callers (the dispatch retry loop) construct the payload and emit via
 * `scope.emit?.()`.
 *
 * Each builder returns a `Record<string, unknown>` matching the canonical
 * `$def` shape in `schemas/run-event-payloads.schema.json`:
 *   - `envelopeRetryAttempted` — `{ nodeId, attempt, reason, previousError? }`
 *   - `envelopeRetryExhausted` — `{ nodeId, totalAttempts, finalReason, finalError? }`
 *   - `envelopeRefusal` — `{ nodeId, provider, model, refusalText?, safetyCategory? }`
 *   - `envelopeTruncated` — `{ nodeId, provider, model, stopReason, partialPayloadAvailable, outputTokenCount? }`
 *
 * `previousError` / `finalError` / `refusalText` MUST be passed through
 * the host's SR-1 redaction harness BEFORE being persisted to the run
 * event log. Callers route the emit through the executor's `eventLog.append`
 * which applies `stripSecretsFromPersisted()` per the existing precedent.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B + §G
 * @see schemas/run-event-payloads.schema.json §envelopeRetryAttempted +
 *      §envelopeRetryExhausted + §envelopeRefusal + §envelopeTruncated
 */

/**
 * Why the retry was triggered. Closed enum matching the RFC 0032 §B.1
 * `reason` field (plus `x-host-<host>-<key>` extension support that the
 * sample doesn't use — production hosts may pass through host-private
 * reasons that match the regex).
 */
export type RetryReason =
  | 'schema-violation'
  | 'truncation'
  | 'type-drift'
  | 'type-mismatch'
  | 'refusal'
  | 'parse-error'
  | 'unknown'
  | (string & { __hostExtension?: true });

/**
 * Provider-normalized stop reason. Matches the canonical `envelopeTruncated.stopReason`
 * enum per RFC 0032 §B.4 — `'max_tokens'` covers OpenAI `length` + Anthropic
 * `max_tokens`; `'length'` is preserved for hosts that distinguish provider-
 * side length caps from host-side budget caps.
 */
export type TruncationStopReason = 'max_tokens' | 'length' | 'stop_sequence' | 'unknown';

/**
 * RFC 0032 §B.1 — `envelope.retry.attempted`. Fires when the dispatch
 * retry loop tries again after a prior attempt's failure. The FIRST
 * attempt does NOT emit; the second attempt emits with `attempt: 2`,
 * etc. Per RFC 0032 normative text.
 */
export function buildRetryAttemptedPayload(
  nodeId: string,
  attempt: number,
  reason: RetryReason,
  previousError?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { nodeId, attempt, reason };
  // `previousError` is optional; omit (rather than emit `null`) when
  // absent so the wire shape stays tight. When present, the caller has
  // already passed it through `stripSecretsFromPersisted()`.
  if (previousError !== undefined) payload.previousError = previousError;
  return payload;
}

/**
 * RFC 0032 §B.2 — `envelope.retry.exhausted`. Fires when the retry budget
 * is exhausted and the host is about to surface a terminal envelope
 * failure. MUST-tier event per RFC 0032 §C — hosts that don't retry MUST
 * still emit this event when an envelope attempt terminally fails (with
 * `totalAttempts: 1`).
 */
export function buildRetryExhaustedPayload(
  nodeId: string,
  totalAttempts: number,
  finalReason: RetryReason,
  finalError?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { nodeId, totalAttempts, finalReason };
  if (finalError !== undefined) payload.finalError = finalError;
  return payload;
}

/**
 * RFC 0032 §B.3 — `envelope.refusal`. Fires when the LLM provider returns
 * an explicit refusal (OpenAI `content_filter`, Anthropic safety-stop,
 * Gemini SAFETY). MUST-tier. Hosts MUST NOT retry on refusal per RFC
 * 0032 §B.3 + RFC 0033 §D — retrying with prompt mutation creates a
 * circumvention concern.
 *
 * `refusalText` and `safetyCategory` are OPTIONAL on the wire shape.
 * `refusalText` MUST be passed through the host's BYOK redaction AND
 * prompt-content redaction pipelines before emission per SECURITY
 * invariant `envelope-refusal-no-prompt-leak`.
 */
export function buildRefusalPayload(
  nodeId: string,
  provider: string,
  model: string,
  refusalText?: string | null,
  safetyCategory?: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { nodeId, provider, model };
  if (refusalText !== undefined) payload.refusalText = refusalText;
  if (safetyCategory !== undefined) payload.safetyCategory = safetyCategory;
  return payload;
}

/**
 * RFC 0032 §B.4 — `envelope.truncated`. Fires when the LLM emission was
 * cut off mid-envelope (typically `stop_reason: "max_tokens"`).
 *
 * The companion retry routing in `dispatchStructured()` MAY re-issue
 * the LLM call with an increased output budget per RFC 0033 §B (the
 * `truncationBudgetMultiplier` field on the capability advertisement).
 * Truncation retries MUST NOT include a corrective schema fragment per
 * RFC 0033 §B normative text.
 */
export function buildTruncatedPayload(
  nodeId: string,
  provider: string,
  model: string,
  stopReason: TruncationStopReason,
  partialPayloadAvailable: boolean,
  outputTokenCount?: number | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nodeId,
    provider,
    model,
    stopReason,
    partialPayloadAvailable,
  };
  if (outputTokenCount !== undefined) payload.outputTokenCount = outputTokenCount;
  return payload;
}

/**
 * RFC 0032 §B.6 — `envelope.recovery.applied` payload (MAY tier).
 * Carries ONLY `{nodeId, path, byteOffset?}` per the SECURITY invariant
 * `envelope-recovery-no-content-leak`. The recovered content itself
 * rides on the downstream RunEventDoc; the recovery event documents
 * only that a recovery path engaged + which one.
 *
 * Closed enum on `path` per the spec:
 *   - 'direct' — strict JSON.parse succeeded. (NOT emitted — direct
 *     parse means no recovery applied; included here for completeness
 *     of the enum the seam validates against.)
 *   - 'jsonrepair' — host applied jsonrepair-style fix-ups
 *   - 'markdown-fence' — stripped ```json ... ``` wrapper
 *   - 'brace-walker' — extracted first balanced {...} substring
 *   - 'custom' — host-specific recovery (vendor-namespaced details NOT
 *     surfaced in the event payload per §G)
 */
export type RecoveryPath = 'direct' | 'jsonrepair' | 'markdown-fence' | 'brace-walker' | 'custom';

export function buildRecoveryAppliedPayload(
  nodeId: string,
  path: RecoveryPath,
  byteOffset?: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { nodeId, path };
  if (typeof byteOffset === 'number' && Number.isFinite(byteOffset) && byteOffset >= 0) {
    payload.byteOffset = byteOffset;
  }
  return payload;
}

/**
 * Try strict JSON.parse, then a small set of recovery paths. Returns
 * `{ data, path, byteOffset }` on success, `null` when every path
 * failed. Used by `aiProvidersHost.dispatchStructured()` between the
 * provider's `content` and the schema-validate step per RFC 0032 §B.6.
 *
 * Recovery paths are tried in declaration order; the first one that
 * yields a JSON value wins. `'direct'` is the no-recovery baseline —
 * callers MUST NOT emit `envelope.recovery.applied` for that path.
 */
export function tryLenientParse(text: string): { data: unknown; path: RecoveryPath; byteOffset?: number } | null {
  // Strict parse — the baseline. No recovery emit.
  try {
    return { data: JSON.parse(text), path: 'direct' };
  } catch {
    /* fall through */
  }
  // Markdown-fence: ```json\n...\n``` or ```\n...\n```. The fence is
  // a common LLM verbatim-output pattern. byteOffset reports where
  // the actual JSON started inside the raw text.
  const fenceMatch = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    try {
      return {
        data: JSON.parse(fenceMatch[1]),
        path: 'markdown-fence',
        byteOffset: fenceMatch.index + (fenceMatch[0].indexOf(fenceMatch[1])),
      };
    } catch {
      /* fall through */
    }
  }
  // Brace-walker: extract first balanced {...} block. Naive walker
  // tracks brace depth; doesn't handle string-escaped braces (rare in
  // LLM output and outside this fallback's scope).
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return {
              data: JSON.parse(text.slice(firstBrace, i + 1)),
              path: 'brace-walker',
              byteOffset: firstBrace,
            };
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * The reference host normalizes provider-specific finish-reason strings
 * into a closed 5-value enum at the dispatch boundary (per
 * `executor/types.ts §AiCallResult.finishReason`):
 *   - `'stop'` → model self-determined clean stop. NOT truncation, NOT refusal.
 *   - `'length'` → output budget exhausted (Anthropic `max_tokens` +
 *     OpenAI `length` + Google `MAX_TOKENS` all collapse here). Truncation.
 *   - `'content-filter'` → provider safety-stop (OpenAI `content_filter`,
 *     Anthropic safety/refusal stop_reasons, Google `SAFETY`). Refusal.
 *   - `'tool-call'` → model is requesting a tool invocation. NOT truncation.
 *   - `'other'` → catch-all (rare; treated as parse/unknown failure).
 *
 * Map the normalized enum to the canonical RFC 0032 §B.4 `stopReason`
 * shape. Returns `null` for non-truncation cases (let the caller
 * dispatch to the schema-violation / refusal branches).
 */
export type NormalizedFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-call' | 'other';

export function classifyTruncationStopReason(
  finishReason: NormalizedFinishReason | undefined,
): TruncationStopReason | null {
  if (finishReason === 'length') return 'max_tokens';
  return null;
}

/**
 * Classify the normalized finish-reason as a safety/content-filter refusal
 * per RFC 0032 §B.3. The reference host collapses all three Tier-1 vendors'
 * safety-stop signals into `'content-filter'` at the dispatch boundary;
 * this helper recognizes that collapsed form. Production hosts that pass
 * through raw provider strings refine for vendor-specific edge cases
 * (Anthropic's `'refusal'` stop_reason landed in their 2025 release, etc.).
 */
export function isRefusalFinishReason(finishReason: NormalizedFinishReason | undefined): boolean {
  return finishReason === 'content-filter';
}
