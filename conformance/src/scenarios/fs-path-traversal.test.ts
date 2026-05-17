/**
 * fs-path-traversal — placeholder scenario for RFC 0014 §C `fs-path-traversal` invariant.
 *
 * Status: PLACEHOLDER. RFC 0014 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0014 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.fs.supported`.
 *
 * Summary: host.fs MUST reject path traversal (`../`) and symlink-escape attempts.
 *
 * @see RFCS/0014-*.md
 */

import { describe, it } from 'vitest';

describe('fs-path-traversal: placeholder for RFC 0014', () => {
  it.todo("read(\"../etc/passwd\") returns `path_outside_sandbox` (RFC 0014 §B)");
  it.todo("read(symlink-to-outside) returns `path_outside_sandbox` (RFC 0014 §B)");
  it.todo("write(huge-file) returns `file_too_large` when `maxFileSizeBytes` is advertised");
});
