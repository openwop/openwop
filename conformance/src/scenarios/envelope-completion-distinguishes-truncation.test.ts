/**
 * envelope-completion-distinguishes-truncation — RFC 0033 §A + §B + §C
 * truncation-vs-schema-violation retry-routing distinction.
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true`
 * AND `capabilities.envelopes.reliability.completion.distinguishesTruncation: true`
 * AND the host's test seam. Soft-skip cleanly on hosts that conflate the two
 * paths (legacy v1.1 behavior).
 *
 * Asserts two scenarios in sequence:
 *
 * 1. **Truncation path** (RFC 0033 §B). Mock LLM stops at `max_tokens` mid-envelope.
 *    - `envelope.truncated` event fires (RFC 0032 §B.4).
 *    - `envelope.retry.attempted { reason: "truncation" }` fires on retry.
 *    - The host's retry call carries an INCREASED output budget (verified via
 *      mock provider's `lastReceivedMaxTokens` introspection hook).
 *    - The retry's system prompt does NOT contain a corrective schema fragment.
 *
 * 2. **Schema-violation path** (RFC 0033 §C). Mock LLM returns a clean stop with
 *    malformed JSON (missing required field).
 *    - NO `envelope.truncated` event.
 *    - `envelope.retry.attempted { reason: "schema-violation" }` fires on retry.
 *    - The host's retry call carries an UNCHANGED output budget.
 *    - A corrective schema fragment IS present in the retry's system prompt
 *      (verified via mock provider's `lastReceivedSystemPrompt` introspection hook).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the retry-routing branch in `executor/envelopeReliability.ts`
 * (or equivalent helper).
 *
 * @see RFCS/0033-envelope-completion-contract.md §A + §B + §C
 * @see spec/v1/ai-envelope.md §"Envelope-completion criteria"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: {
      reliability?: {
        completion?: {
          distinguishesTruncation?: unknown;
          truncationBudgetMultiplier?: unknown;
        };
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('envelope-completion-distinguishes-truncation: advertisement shape (RFC 0033 §E)', () => {
  it('capabilities.envelopes.reliability.completion (when present) conforms to RFC 0033 §E', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const completion = d.capabilities?.envelopes?.reliability?.completion;
    if (completion === undefined) return;
    expect(
      typeof completion.distinguishesTruncation,
      'completion.distinguishesTruncation MUST be boolean when block is advertised',
    ).toBe('boolean');
    if (completion.truncationBudgetMultiplier !== undefined) {
      const n = completion.truncationBudgetMultiplier as number;
      expect(
        typeof n === 'number' && n >= 1 && n <= 8,
        'truncationBudgetMultiplier MUST be a number in [1, 8] (default 2)',
      ).toBe(true);
    }
  });
});

describe('envelope-completion-distinguishes-truncation: truncation path (RFC 0033 §B)', () => {
  it.todo(
    'mock LLM stops at `max_tokens` mid-envelope → `envelope.truncated` event fires (RFC 0032 §B.4)',
  );
  it.todo(
    'retry emits `envelope.retry.attempted { reason: "truncation" }` (RFC 0032 §B.1)',
  );
  it.todo(
    "retry call carries INCREASED output budget per `truncationBudgetMultiplier` (verified via mock provider's `lastReceivedMaxTokens`)",
  );
  it.todo(
    'retry\'s system prompt does NOT contain a corrective schema fragment (truncation is an output-size problem, not a schema problem)',
  );
});

describe('envelope-completion-distinguishes-truncation: schema-violation path (RFC 0033 §C)', () => {
  it.todo(
    'mock LLM returns clean stop with malformed JSON → NO `envelope.truncated` event',
  );
  it.todo(
    'retry emits `envelope.retry.attempted { reason: "schema-violation" }`',
  );
  it.todo(
    "retry call carries UNCHANGED output budget (no budget increase on schema-violation path)",
  );
  it.todo(
    'retry\'s system prompt CONTAINS a corrective schema fragment describing the validator\'s failure (host-authored, NOT from model output)',
  );
});
