/**
 * queue-publish-consume-roundtrip — placeholder scenario for RFC 0017 §B (publish + consume roundtrip).
 *
 * Status: PLACEHOLDER. RFC 0017 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0017 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.queueBus.supported`.
 *
 * Summary: publish + consume + ack roundtrip with deduplicated delivery.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it } from 'vitest';

describe('queue-publish-consume-roundtrip: placeholder for RFC 0017', () => {
  it.todo("publish → consume returns the message with the right payload + headers");
  it.todo("ack removes the message; subsequent consume blocks (or returns not-found within timeout)");
});
