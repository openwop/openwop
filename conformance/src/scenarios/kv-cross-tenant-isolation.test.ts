/**
 * kv-cross-tenant-isolation — placeholder scenario for RFC 0015 §C `kv-cross-tenant-isolation` invariant.
 *
 * Status: PLACEHOLDER. RFC 0015 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0015 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.kvStorage.supported`.
 *
 * Summary: host.kvStorage MUST partition values by tenant. Cross-tenant reads MUST return not-found.
 *
 * @see RFCS/0015-*.md
 */

import { describe, it } from 'vitest';

describe('kv-cross-tenant-isolation: placeholder for RFC 0015', () => {
  it.todo("set under tenant A → get under tenant B with same key returns `found:false`");
  it.todo("list under tenant B does not include keys set under tenant A");
});
