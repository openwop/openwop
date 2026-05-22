/**
 * Shared helpers for the LLM cache-key recipe per `spec/v1/replay.md`
 * §"LLM cache-key recipe" §A + §B.
 *
 * Used by:
 *   - `conformance/src/scenarios/replay-llm-cache-key.test.ts` — single-host
 *     recipe assertions + non-recipe-field invariance + (gated)
 *     cross-host parity via OPENWOP_BASE_URL_B.
 *   - `conformance/src/scenarios/replay-llm-cache-key-portable.test.ts` —
 *     RFC 0041 §E SECURITY-invariant probe (intra-host reproducibility +
 *     non-recipe-field invariance + Phase 4 advertisement alignment).
 *
 * `canonicalize` mirrors RFC 8785 JCS-style output (sorted keys, no
 * whitespace, preserved array order). Hosts that have a real JCS library
 * available SHOULD prefer it; this helper is for the conformance side,
 * not the host side. Keep in sync with `spec/v1/replay.md` §B.
 */

import { createHash } from 'node:crypto';
import { driver } from './driver.js';

/** RFC 8785 JCS-style canonicalization (subset suitable for the recipe
 *  fields). Sorted keys recursively; no whitespace; preserved array order;
 *  strings JSON-encoded verbatim (no NFC normalization — the recipe
 *  inputs in our test seam are ASCII). */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Project a raw recipe-input object to the closed set of fields per
 *  `replay.md` §A — omit absent optionals (do NOT emit null/default
 *  placeholders), sort tools[] by name. */
export function projectRecipe(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { provider: raw.provider, model: raw.model, messages: raw.messages };
  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    out.tools = [...(raw.tools as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (typeof raw.temperature === 'number') out.temperature = raw.temperature;
  if (typeof raw.topP === 'number') out.topP = raw.topP;
  if (typeof raw.topK === 'number') out.topK = raw.topK;
  if (raw.responseFormat && typeof raw.responseFormat === 'object') out.responseFormat = raw.responseFormat;
  return out;
}

/** Compute the canonical LLM cache key per `replay.md` §B:
 *  SHA-256(canonicalize(projectRecipe(input))) → lowercase hex. */
export function expectedCacheKey(input: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(projectRecipe(input)), 'utf8').digest('hex');
}

/** Drive the host's `POST /v1/host/sample/test/llm-cache-key` test seam.
 *  Returns the host's emitted cacheKey when the seam responds 200; status
 *  alone when the seam returns 404 (host doesn't expose the seam → caller
 *  soft-skips). */
export async function callCacheKeySeam(input: Record<string, unknown>): Promise<{ status: number; cacheKey?: string }> {
  const res = await driver.post('/v1/host/sample/test/llm-cache-key', input);
  const cacheKey = (res.json as { cacheKey?: string }).cacheKey;
  return cacheKey !== undefined ? { status: res.status, cacheKey } : { status: res.status };
}
