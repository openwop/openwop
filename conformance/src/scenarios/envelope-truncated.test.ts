/**
 * envelope-truncated — RFC 0032 §B.4 runtime behavior (SHOULD tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true` AND
 * `events[]` includes `envelope.truncated`. Soft-skip when not advertised.
 *
 * Asserts:
 *   1. When the mock LLM stops at `max_tokens` mid-envelope, exactly one
 *      `envelope.truncated` event fires.
 *   2. `stopReason` is one of `max_tokens` / `length` / `stop_sequence` / `unknown`.
 *   3. When the host advertises `capabilities.envelopes.reliability.completion.distinguishesTruncation: true`,
 *      the retry call carries an INCREASED output budget (verified via the
 *      mock provider's `lastReceivedMaxTokens` introspection hook) and NO
 *      corrective schema fragment in the retry's system prompt (RFC 0033 §B).
 *   4. `outputTokenCount` (when populated) MUST replay identically.
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the emission at the `stop_reason` inspection point in
 * `aiProviders/aiProvidersHost.ts`.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.4
 * @see RFCS/0033-envelope-completion-contract.md §B
 * @see schemas/run-event-payloads.schema.json §envelopeTruncated
 */

import { describe, it } from 'vitest';

describe('envelope-truncated: runtime behavior (RFC 0032 §B.4 SHOULD)', () => {
  it.todo(
    'when mock LLM stops at `max_tokens` mid-envelope, exactly one `envelope.truncated` event fires',
  );
  it.todo(
    '`stopReason` is one of: `max_tokens` (default for OpenAI `length` + Anthropic `max_tokens` mapping), `length` (provider-side cap), `stop_sequence`, `unknown`',
  );
  it.todo(
    'when host advertises `completion.distinguishesTruncation: true`, retry carries INCREASED output budget per `truncationBudgetMultiplier` (RFC 0033 §B)',
  );
  it.todo(
    'when host advertises `completion.distinguishesTruncation: true`, retry MUST NOT include a corrective schema fragment (truncation is an output-size problem, not a schema problem — RFC 0033 §B)',
  );
  it.todo('`outputTokenCount` MUST replay identically across re-execution');
  it.todo(
    '`partialPayloadAvailable` is a boolean reflecting whether the host recovered a partial envelope before truncation',
  );
});

describe('envelope-truncated: combined truncation + schema-violation precedence (RFC 0033 §A)', () => {
  it.todo(
    'when a response is truncated AND the partial payload does not satisfy syntactic JSON, the host routes as TRUNCATION (output budget is the upstream cause) — emits `envelope.truncated`, NOT `envelope.retry.attempted { reason: "schema-violation" }`',
  );
});
