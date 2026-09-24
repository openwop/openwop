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
 * `canonicalize` is RFC 8785 JCS with the RFC 0212 I-JSON refusal set (the
 * suite's one implementation, `./jcs.ts`), and `tools[]` sorts by UTF-16 code
 * units — never `localeCompare`, which orders `get_weather` / `getWeather`
 * differently per locale and so breaks the TS/Python/Go agreement RFC 0150 §C
 * asks for. Keep in sync with `spec/v1/replay.md` §B.
 */

import { createHash } from 'node:crypto';
import { driver } from './driver.js';
import { canonicalJSON, codeUnitCompare } from './jcs.js';

/** RFC 8785 JCS (RFC 0212). Throws `JcsRefusal` on a non-I-JSON value. */
export function canonicalize(value: unknown): string {
  return canonicalJSON(value);
}

/** @deprecated RETIRED v1 projection (pre RFC 0150 §C). Kept ONLY so a
 *  reader can see what the retired recipe excluded; no scenario may assert
 *  against it — `replay-llm-cache-key{,-portable}.test.ts` did until suite
 *  1.109.0 and thereby contradicted `semantic-digest-v2.test.ts` in the same
 *  package. Use `projectSemanticRequestV2` / `semanticRequestDigestV2`. */
export function projectRecipe(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { provider: raw.provider, model: raw.model, messages: raw.messages };
  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    out.tools = [...(raw.tools as Array<{ name: string }>)].sort((a, b) => codeUnitCompare(a.name, b.name));
  }
  if (typeof raw.temperature === 'number') out.temperature = raw.temperature;
  if (typeof raw.topP === 'number') out.topP = raw.topP;
  if (typeof raw.topK === 'number') out.topK = raw.topK;
  if (raw.responseFormat && typeof raw.responseFormat === 'object') out.responseFormat = raw.responseFormat;
  return out;
}

/** @deprecated RETIRED v1 key. See `projectRecipe`. Use `semanticRequestDigestV2`. */
export function expectedCacheKey(input: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(projectRecipe(input)), 'utf8').digest('hex');
}

/** RFC 0150 §C recipe stamp. Present in the preimage so a v1 digest and a v2
 *  digest for the same request cannot be mistaken for each other. */
export const SEMANTIC_REQUEST_RECIPE_V2 = 'openwop-semantic-request-v2';

/**
 * RFC 0150 §C — project to the **v2** semantic request.
 *
 * The difference from v1 is not additive tidying. v1 EXCLUDED `maxOutputTokens`,
 * `stop`, and `seed`, and every one of them changes the completion — so two
 * requests that produce different text hashed to the same key. That is a wrong
 * hit rather than a miss, which is why v2 is a safety-fix and not a refinement.
 *
 * Transport-only fields are still excluded. The test is whether a field can
 * change what the model returns, not whether it appears in the HTTP request.
 */
export function projectSemanticRequestV2(raw: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = { messages: raw.messages };
  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    request.tools = [...(raw.tools as Array<{ name: string }>)].sort((a, b) => codeUnitCompare(a.name, b.name));
  }
  for (const k of ['temperature', 'topP', 'topK', 'maxOutputTokens', 'seed'] as const) {
    if (typeof raw[k] === 'number') request[k] = raw[k];
  }
  if (Array.isArray(raw.stop)) request.stop = raw.stop;
  if (raw.responseFormat !== undefined && typeof raw.responseFormat === 'object') {
    request.responseFormat = raw.responseFormat;
  }
  if (raw.safetySettings !== undefined && typeof raw.safetySettings === 'object') {
    request.safetySettings = raw.safetySettings;
  }
  const out: Record<string, unknown> = {
    recipe: SEMANTIC_REQUEST_RECIPE_V2,
    provider: raw.provider,
    model: raw.model,
    request,
  };
  // Carried, never dropped: a dropped option that alters output is
  // indistinguishable from one that was never set.
  if (raw.providerOptions !== undefined && typeof raw.providerOptions === 'object') {
    out.providerOptions = raw.providerOptions;
  }
  return out;
}

/** RFC 0150 §C — SHA-256 over the JCS-canonical v2 object, lowercase hex. */
export function semanticRequestDigestV2(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalize(projectSemanticRequestV2(input)), 'utf8')
    .digest('hex');
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
