/**
 * envelope-truncation-cap-exhaustion — RFC 0033 §B DoS-bound assertion.
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true` AND
 * `capabilities.envelopes.reliability.completion.distinguishesTruncation: true`
 * AND the host's test seam. Soft-skip cleanly on hosts that conflate truncation
 * with schema-violation (legacy v1.1 behavior).
 *
 * Asserts:
 *   1. When the mock LLM truncates every attempt up to `maxRetryAttempts + 1`,
 *      `envelope.retry.exhausted { finalReason: "truncation" }` fires.
 *   2. `cap.breached { kind: "schema" }` fires (truncation retries count
 *      against `limits.schemaRounds` per RFC 0033 §B).
 *   3. The node fails with `RunSnapshot.error.code = "envelope_truncation_unrecoverable"`
 *      per RFC 0033 §F.
 *   4. The run does NOT exceed `maxRetryAttempts` total LLM calls (no infinite loop).
 *      This is the DoS-bound assertion — without the cap, a host doubling the
 *      budget on every truncation could consume ever-larger token budgets until
 *      external cost limits intervene.
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the truncation-retry cap.
 *
 * @see RFCS/0033-envelope-completion-contract.md §B + §F
 * @see spec/v1/rest-endpoints.md §"Common error codes" — `envelope_truncation_unrecoverable`
 */

import { describe, it } from 'vitest';

describe('envelope-truncation-cap-exhaustion: DoS-bound retry budget (RFC 0033 §B)', () => {
  it.todo(
    'mock LLM truncates every attempt up to `maxRetryAttempts + 1` → `envelope.retry.exhausted { finalReason: "truncation" }` fires',
  );
  it.todo(
    '`cap.breached { kind: "schema" }` fires (truncation retries count against `limits.schemaRounds` per RFC 0033 §B)',
  );
  it.todo(
    'node fails with `RunSnapshot.error.code = "envelope_truncation_unrecoverable"` per RFC 0033 §F',
  );
  it.todo(
    'run does NOT exceed `maxRetryAttempts` total LLM calls — no infinite loop (DoS-bound assertion: without the cap, doubling budget on every truncation could consume ever-larger token budgets)',
  );
});
