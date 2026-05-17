/**
 * stream-subscribe-from-beginning — placeholder scenario for RFC 0017 §A `stream.fromBeginning`.
 *
 * Status: PLACEHOLDER. RFC 0017 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0017 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.queueBus.stream.fromBeginning`.
 *
 * Summary: Stream subscribers with fromBeginning=true receive records published before subscription.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it } from 'vitest';

describe('stream-subscribe-from-beginning: placeholder for RFC 0017', () => {
  it.todo("publish 5 records then subscribe(fromBeginning=true) → consumer receives all 5");
});
