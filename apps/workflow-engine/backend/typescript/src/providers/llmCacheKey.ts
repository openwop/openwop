/**
 * RFC-grounded LLM cache-key recipe per `spec/v1/replay.md §"LLM
 * cache-key recipe"`.
 *
 * §A — Domain. The cache key is computed at invocation time over a
 *      closed set of fields. Hosts MUST NOT include host-specific
 *      metadata, request IDs, timestamps, or trace headers.
 *
 * §B — Computation:
 *      1. Build a canonical object with only the recipe fields,
 *         omitting absent optionals (NOT emitting `null` placeholders).
 *      2. Canonicalize to bytes via RFC 8785 JCS (sorted keys, no
 *         whitespace, no trailing commas, UTF-8 NFC).
 *      3. SHA-256 the canonical bytes.
 *      4. Encode as lowercase hex.
 *
 * The function explicitly STRIPS non-recipe fields (`max_tokens`,
 * `stop`, `stream`, `metadata`, `user`, `seed`, request IDs, trace
 * context, tenant id, run id) so cross-host determinism is preserved.
 */

import { createHash } from 'node:crypto';

export interface LLMCacheKeyInput {
  provider: string;
  model: string;
  messages: ReadonlyArray<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ReadonlyArray<{ type: string; [k: string]: unknown }>;
    name?: string;
    toolCallId?: string;
  }>;
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  }>;
  temperature?: number;
  topP?: number;
  topK?: number;
  responseFormat?: { type: 'text' | 'json' | 'tool_call'; schema?: Record<string, unknown> };
}

/** RFC 8785 JCS-style canonical serialization. Sort object keys
 *  recursively; preserve array order; emit no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Strip the input to ONLY the recipe fields, omitting absent optionals.
 *  Per §A, even non-recipe fields like `max_tokens`/`stop`/`seed` MUST
 *  NOT influence the key — we discard them here defensively. */
export function projectRecipe(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: raw.provider,
    model: raw.model,
    messages: raw.messages,
  };
  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    // Sort tools by name; sort each tool's parameters keys recursively (handled by canonicalize)
    out.tools = [...(raw.tools as Array<{ name: string }>)].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (typeof raw.temperature === 'number') out.temperature = raw.temperature;
  if (typeof raw.topP === 'number') out.topP = raw.topP;
  if (typeof raw.topK === 'number') out.topK = raw.topK;
  if (raw.responseFormat && typeof raw.responseFormat === 'object') {
    out.responseFormat = raw.responseFormat;
  }
  return out;
}

/** Compute the lowercase-hex SHA-256 cache key per replay.md §B steps 1–4. */
export function computeLLMCacheKey(input: Record<string, unknown>): string {
  const recipe = projectRecipe(input);
  const canonical = canonicalize(recipe);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return hash;
}
