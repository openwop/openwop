/**
 * RFC 0012 §D — SR-1 carry-forward through memory compaction.
 *
 * Verifies the load-bearing security claim of RFC 0012 (Memory
 * Compaction Profile, currently `Active` — comment window closes
 * 2026-05-20): when a host advertising
 * `capabilities.memory.compaction.supported: true` produces a
 * compacted `MemoryEntry`, the derived content MUST pass the
 * same BYOK redaction harness as a fresh `put`. The fact that
 * source entries were SR-1-compliant at original `put` time is
 * NOT evidence to skip redaction on derived content —
 * summarization models can introduce secret-shaped substrings
 * not present in any source.
 *
 * Capability-gated: skips when `capabilities.memory.compaction.supported`
 * is absent (or false). When advertised, the host MUST also expose a
 * test seam to trigger a compaction run (env var or test endpoint —
 * the conformance suite's convention is `OPENWOP_TEST_TRIGGER_COMPACTION=true`).
 *
 * STATUS: Phase 2 stub (RFC 0012 Active 2026-05-13). The full
 * scenario lands in Phase 3 after the comment window closes
 * (on or after 2026-05-20) alongside the reference-host
 * implementation. Tracked by `SECURITY/invariants.yaml` row
 * `memory-compaction-sr-1-carry-forward`.
 *
 * @see RFCS/0012-memory-compaction-profile.md §D
 * @see SECURITY/invariants.yaml `memory-compaction-sr-1-carry-forward`
 * @see spec/v1/capabilities.md §`memory.compaction (RFC 0012, Active)`
 */

import { describe, it } from 'vitest';

describe('memory-compaction-sr1-carry-forward: derived content passes the BYOK redaction harness', () => {
  it.todo('plant source entries with post-redaction markers + adversarial near-secret strings; trigger compaction; assert output passes the redaction harness (no plaintext, no [BYOK:...] form-leaks)');
});
