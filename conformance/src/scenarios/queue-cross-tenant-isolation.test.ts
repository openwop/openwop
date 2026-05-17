/**
 * queue-cross-tenant-isolation — placeholder scenario for RFC 0017 §C `queue-cross-tenant-isolation` invariant.
 *
 * Status: PLACEHOLDER. RFC 0017 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0017 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.queueBus.supported`.
 *
 * Summary: host.queueBus MUST partition messages by tenant.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it } from 'vitest';

describe('queue-cross-tenant-isolation: placeholder for RFC 0017', () => {
  it.todo("publish under tenant A on topic T → consume under tenant B on topic T returns not-found");
});
