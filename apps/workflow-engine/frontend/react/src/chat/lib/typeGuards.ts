/**
 * Small runtime type guards used at parsing / narrowing boundaries
 * in the chat surface.
 *
 * Exists because TypeScript's `typeof === 'object'` narrowing leaves
 * `object`, not `Record<string, unknown>` — so without a guard the
 * idiomatic pattern at narrowing sites is `as Record<string, unknown>`,
 * which the code-review skill bans across the codebase.
 *
 * Mirrors the existing pattern in BE (`mcpJsonRpc.ts:isErrorResponse`,
 * `oidcVerifier.ts:isSupportedAlgorithm`, etc.).
 */

/** True when `v` is a plain object (not null, not an array, not a primitive). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
