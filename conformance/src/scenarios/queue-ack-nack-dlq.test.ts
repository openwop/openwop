/**
 * queue-ack-nack-dlq — placeholder scenario for RFC 0017 §B point 2 (ack/nack/deadLetter semantics).
 *
 * Status: PLACEHOLDER. RFC 0017 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0017 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.queueBus.deadLetterSupported`.
 *
 * Summary: nack returns for redelivery; deadLetter routes to the configured DLQ.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it } from 'vitest';

describe('queue-ack-nack-dlq: placeholder for RFC 0017', () => {
  it.todo("nack(requeue=true) → message is redelivered on next consume");
  it.todo("deadLetter → message appears on the configured DLQ");
});
