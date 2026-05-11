/**
 * Cross-host LLM cache-key parity (replay.md §"LLM cache-key recipe").
 *
 * Verifies that two OpenWOP-compliant hosts replaying the same LLM
 * provider request compute the same cache key. The recipe is normative
 * (replay.md §B): canonical JSON of `(provider, model, messages, tools,
 * temperature, topP, topK, responseFormat)` → SHA-256 → lowercase hex.
 *
 * Status: PLACEHOLDER. As of 2026-05-11, neither reference host
 * (`examples/hosts/in-memory/`, `examples/hosts/sqlite/`) implements
 * LLM-calling nodes — both execute only `core.noop` / `core.delay` /
 * `core.approvalGate` fixtures. This scenario lands as `it.todo()` so
 * the contract surface is tracked; assertions land when the first
 * reference host ships an LLM-call node.
 *
 * What the live scenario WILL exercise (when implemented):
 *   1. Boot host A against `OPENWOP_BASE_URL`.
 *   2. Boot host B against `OPENWOP_BASE_URL_B`.
 *   3. Submit the same workflow + inputs (an LLM-calling fixture).
 *   4. Read each host's emitted `node.completed.payload.cacheKey` (or
 *      equivalent debug-bundle surface).
 *   5. Assert the two hex strings are equal.
 *
 * @see spec/v1/replay.md §"LLM cache-key recipe"
 */

import { describe, it } from 'vitest';

describe('replay-llm-cache-key: cross-host determinism (placeholder)', () => {
  it.todo(
    'two hosts replaying the same LLM provider request compute the same cache key (replay.md §D)',
  );
  it.todo('LLM cache key is computed via SHA-256 of canonical JSON per replay.md §B');
  it.todo('cache key omits non-recipe fields (max_tokens, stop, stream, seed, etc.) per replay.md §A');
});
