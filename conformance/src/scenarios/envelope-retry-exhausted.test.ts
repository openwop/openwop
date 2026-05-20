/**
 * envelope-retry-exhausted — RFC 0032 §B.2 runtime behavior (MUST tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`.
 * Non-skippable when the capability is advertised — `envelope.retry.exhausted`
 * is one of the two MUST-tier events.
 *
 * Asserts:
 *   1. When the mock LLM emits invalid envelopes for `maxRetryAttempts + 1`
 *      attempts, exactly one `envelope.retry.exhausted` event fires with
 *      `totalAttempts` matching the host's advertised cap.
 *   2. `finalReason` is correctly set (one of the spec-reserved closed-enum
 *      values OR `x-host-<host>-*` extension).
 *   3. `RunSnapshot.error.code` reflects the cause:
 *      - `envelope_truncation_unrecoverable` when finalReason is `truncation`
 *        (RFC 0033 §F).
 *      - `envelope_payload_invalid` when finalReason is `schema-violation`
 *        (existing RFC 0021 code).
 *      - `envelope_refused_by_provider` when finalReason is `refusal`
 *        (RFC 0033 §F — but this path actually emits `envelope.refusal`,
 *        not retry-exhausted; flag if both events appear).
 *   4. Hosts that don't retry (`maxRetryAttempts: 1`) MUST still emit this
 *      event with `totalAttempts: 1` when an envelope attempt terminally
 *      fails (per RFC 0032 §B.2 normative text).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the emission. Advertisement shape is checked above in
 * `envelope-retry-attempted.test.ts`.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.2
 * @see RFCS/0033-envelope-completion-contract.md §F
 * @see schemas/run-event-payloads.schema.json §envelopeRetryExhausted
 */

import { describe, it } from 'vitest';

describe('envelope-retry-exhausted: runtime behavior (RFC 0032 §B.2 MUST)', () => {
  it.todo(
    'when mock LLM emits invalid envelopes for `maxRetryAttempts + 1` attempts, exactly one `envelope.retry.exhausted` event fires',
  );
  it.todo('event payload carries `totalAttempts` matching the host\'s advertised cap');
  it.todo(
    '`finalReason` is one of the spec-reserved closed-enum values OR matches the `x-host-<host>-<key>` extension pattern',
  );
  it.todo(
    "`RunSnapshot.error.code` is `envelope_truncation_unrecoverable` when `finalReason: 'truncation'` (RFC 0033 §F)",
  );
  it.todo(
    "`RunSnapshot.error.code` is `envelope_payload_invalid` when `finalReason: 'schema-violation'` (existing RFC 0021 code)",
  );
  it.todo(
    "hosts that don't retry (`maxRetryAttempts: 1`) MUST still emit `envelope.retry.exhausted` with `totalAttempts: 1` on terminal failure (RFC 0032 §B.2 normative text)",
  );
  it.todo(
    'event pairs with a `cap.breached` event when finalReason is `schema-violation` or `truncation` (per RFC 0033 §B + §C)',
  );
});
