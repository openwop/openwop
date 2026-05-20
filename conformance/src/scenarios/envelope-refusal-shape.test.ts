/**
 * envelope-refusal-shape — RFC 0032 §B.3 runtime behavior (MUST tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`.
 * Non-skippable when the capability is advertised — `envelope.refusal` is
 * one of the two MUST-tier events.
 *
 * Also exercises SECURITY invariant `envelope-refusal-no-prompt-leak`.
 *
 * Asserts:
 *   1. When the mock LLM emits a provider refusal (mock provider's
 *      `mockRefusal` config), exactly one `envelope.refusal` event fires.
 *   2. The host does NOT retry — no `envelope.retry.attempted` event after
 *      the refusal (RFC 0032 §B.3 + RFC 0033 §D normative MUST NOT retry).
 *   3. `refusalText` (when populated) does NOT contain the offending prompt's
 *      `secret:`-prefixed substring (SECURITY invariant
 *      `envelope-refusal-no-prompt-leak`).
 *   4. `refusalText` (when populated) does NOT contain a verbatim copy of
 *      prompt content from the failing request — provider refusals can echo
 *      offending prompt material; emitting verbatim creates a prompt-injection
 *      telemetry side channel.
 *   5. The node fails with `RunSnapshot.error.code = "envelope_refused_by_provider"`
 *      per RFC 0033 §F.
 *   6. `RunSnapshot.error.message` MUST NOT include the provider's refusal text
 *      (that surface lives only on the event field, redacted).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the emission + redaction harness for `refusalText`.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.3 + §G
 * @see RFCS/0033-envelope-completion-contract.md §D + §F
 * @see SECURITY/threat-model-prompt-injection.md
 * @see schemas/run-event-payloads.schema.json §envelopeRefusal
 */

import { describe, it } from 'vitest';

describe('envelope-refusal-shape: runtime behavior (RFC 0032 §B.3 MUST)', () => {
  it.todo('when mock provider emits a refusal, exactly one `envelope.refusal` event fires');
  it.todo('the host does NOT retry — no `envelope.retry.attempted` after the refusal');
  it.todo(
    "node fails with `RunSnapshot.error.code = \"envelope_refused_by_provider\"` per RFC 0033 §F",
  );
  it.todo(
    '`RunSnapshot.error.message` MUST NOT echo the provider\'s refusal text (that surface lives only on the event field, redacted)',
  );
});

describe('envelope-refusal-shape: SECURITY invariant `envelope-refusal-no-prompt-leak`', () => {
  it.todo(
    "`refusalText` MUST be passed through the host's BYOK redaction harness — known `secret:`-prefixed substrings in input MUST NOT appear in `refusalText`",
  );
  it.todo(
    '`refusalText` MUST be passed through the host\'s prompt-content redaction pipeline — verbatim prompt substrings from the failing request MUST NOT appear in `refusalText`',
  );
  it.todo(
    'replay tooling MUST tolerate `refusalText: null` even when the original was non-null (host redaction policies legitimately tighten over time)',
  );
});

describe('envelope-refusal-shape: OTel projection (RFC 0032 §E RECOMMENDED)', () => {
  it.todo(
    'OTel span attributes for the refusal MAY include `openwop.envelope.refusal.safety_category` but MUST NOT include `refusalText` by default — operators who want refusal text in dashboards plumb through their own pipeline',
  );
});
