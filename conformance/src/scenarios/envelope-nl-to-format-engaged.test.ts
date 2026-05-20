/**
 * envelope-nl-to-format-engaged — RFC 0032 §B.5 runtime behavior (MAY tier).
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `events[]` includes `envelope.nlToFormat.engaged`. Soft-skip cleanly
 * on hosts that don't implement NL-to-Format fallback — NL-to-Format is one
 * of many possible recovery strategies; hosts that don't advertise it don't
 * need to emit.
 *
 * Asserts:
 *   1. When retry exhaustion triggers the NL-to-Format fallback (per Tam et al.
 *      mitigation: free-form reasoning in the first call → schema coercion
 *      in the second call), exactly one `envelope.nlToFormat.engaged` event
 *      fires.
 *   2. `originalEnvelopeType` carries the envelope kind the original attempt
 *      was trying to emit.
 *   3. `fallbackCalls >= 1` (informational — how many secondary LLM calls
 *      the host issued to reformat).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements NL-to-Format fallback in its retry pipeline.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.5
 * @see Tam et al., "Let Me Speak Freely?" — https://arxiv.org/pdf/2408.02442
 * @see schemas/run-event-payloads.schema.json §envelopeNlToFormatEngaged
 */

import { describe, it } from 'vitest';

describe('envelope-nl-to-format-engaged: runtime behavior (RFC 0032 §B.5 MAY)', () => {
  it.todo(
    'when retry exhaustion triggers the NL-to-Format fallback, exactly one `envelope.nlToFormat.engaged` event fires',
  );
  it.todo('`originalEnvelopeType` carries the envelope kind the original attempt targeted');
  it.todo(
    '`fallbackCalls >= 1` reports the number of secondary LLM calls used to reformat free-form output into the envelope schema',
  );
  it.todo(
    'the eventual envelope acceptance (when fallback succeeds) records normally via downstream RunEventDoc',
  );
});
