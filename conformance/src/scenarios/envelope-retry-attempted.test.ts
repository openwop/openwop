/**
 * envelope-retry-attempted — RFC 0032 §B.1 runtime behavior.
 *
 * Capability-gated on `capabilities.envelopes.reliability.supported: true` AND
 * `events[]` includes `envelope.retry.attempted` AND the host's test seam
 * `POST /v1/host/sample/test/simulate-envelope-retry`.
 *
 * Asserts:
 *   1. When the mock LLM emits an invalid envelope on attempt 1 then a valid
 *      one on attempt 2, exactly one `envelope.retry.attempted` event fires
 *      before the second attempt.
 *   2. `attempt: 2`, `reason: "schema-violation"` (or `truncation` /
 *      `type-drift` / `type-mismatch` / `refusal` / `parse-error` / `unknown`
 *      / `x-host-<host>-*`).
 *   3. First attempt does NOT emit `envelope.retry.attempted` (per RFC 0032
 *      §B.1 normative text — only retries past the first emit).
 *   4. Eventual success is recorded normally (envelope acceptance + downstream
 *      RunEventDoc).
 *
 * Behavioral assertions are `it.todo()` until the reference workflow-engine
 * implements the emission via `executor/envelopeReliability.ts`.
 *
 * @see RFCS/0032-envelope-reliability-events.md §B.1
 * @see schemas/run-event-payloads.schema.json §envelopeRetryAttempted
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: {
      reliability?: {
        supported?: unknown;
        events?: unknown;
        maxRetryAttempts?: unknown;
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

describe.skipIf(HTTP_SKIP)('envelope-retry-attempted: advertisement shape (RFC 0032 §C)', () => {
  it('capabilities.envelopes.reliability (when present) conforms to RFC 0032 §C', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reliability = d.capabilities?.envelopes?.reliability;
    if (reliability === undefined) return;
    expect(typeof reliability.supported, 'reliability.supported MUST be boolean').toBe('boolean');
    if (reliability.events !== undefined) {
      expect(Array.isArray(reliability.events), 'reliability.events MUST be an array').toBe(true);
      const RFC_0032_EVENTS = [
        'envelope.retry.attempted',
        'envelope.retry.exhausted',
        'envelope.refusal',
        'envelope.truncated',
        'envelope.nlToFormat.engaged',
        'envelope.recovery.applied',
      ];
      for (const e of reliability.events as unknown[]) {
        expect(RFC_0032_EVENTS, `event "${String(e)}" MUST be one of the six RFC 0032 names`).toContain(String(e));
      }
      // When supported: true, MUST include the two MUST-tier events.
      if (reliability.supported === true) {
        const evts = reliability.events as string[];
        expect(
          evts.includes('envelope.retry.exhausted'),
          'RFC 0032 §C: hosts that advertise `supported: true` MUST include `envelope.retry.exhausted` in `events[]`',
        ).toBe(true);
        expect(
          evts.includes('envelope.refusal'),
          'RFC 0032 §C: hosts that advertise `supported: true` MUST include `envelope.refusal` in `events[]`',
        ).toBe(true);
      }
    }
    if (reliability.maxRetryAttempts !== undefined) {
      const n = reliability.maxRetryAttempts as number;
      expect(typeof n === 'number' && n >= 1 && n <= 16, 'maxRetryAttempts MUST be integer in [1, 16]').toBe(true);
    }
  });
});

describe('envelope-retry-attempted: runtime behavior (RFC 0032 §B.1)', () => {
  it.todo(
    'when mock LLM emits invalid envelope on attempt 1 then valid on attempt 2, exactly one `envelope.retry.attempted` event fires before the second attempt',
  );
  it.todo('event payload carries `attempt: 2` (1-indexed; first attempt does not emit)');
  it.todo(
    '`reason` is one of the spec-reserved closed-enum values OR matches the `x-host-<host>-<key>` extension pattern',
  );
  it.todo('eventual success records normally via envelope acceptance + downstream RunEventDoc');
  it.todo(
    '`previousError` (when populated) MUST NOT contain prompt or response substring excerpts — limit to validator output',
  );
});
