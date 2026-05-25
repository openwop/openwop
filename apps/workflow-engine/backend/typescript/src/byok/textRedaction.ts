/**
 * Flat-string secret-redaction primitive.
 *
 * `stripSecretsFromPersisted` (in `ephemeralRunSecrets.ts`) handles
 * structured payloads — it walks objects and arrays, replacing values
 * that match the BYOK ephemeral-secret reference shape (`__secret:*`).
 * It does NOT scan free-text strings for accidentally-pasted API key
 * material.
 *
 * This module adds the complementary scrubber for **flat strings** —
 * the kind that flow into notification messages, HITL approval
 * comments ("Visible in audit trail" free-text), workflow names, and
 * any other user-typed text that gets persisted in the event log.
 *
 * Conservative regex set — covers the high-frequency leak shapes seen
 * in upstream provider 401/403 responses + accidental user paste:
 *   - `sk-*`     — OpenAI + Anthropic
 *   - `xai-*`    — xAI
 *   - `Bearer *` — generic OAuth-style bearer tokens
 *   - 32+ char hex — anthropic + miniMax sometimes echo the rejected
 *                    key as a hex digest in error payloads
 *
 * Intentionally NOT exhaustive: this is defense-in-depth, not a
 * substitute for the executor's `stripSecretsFromPersisted` at every
 * structured-payload write site. Combine both at every persistence
 * boundary.
 *
 * Behavior on non-string inputs is undefined — callers MUST guard
 * `typeof v === 'string'` themselves. The helper assumes string input
 * to stay zero-overhead in the common case.
 */

export function sanitizeFreeText(s: string): string {
  return s
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/\bxai-[A-Za-z0-9_-]{16,}/g, 'xai-***')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/g, 'Bearer ***')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '***');
}

/**
 * Recursively walk a payload and apply `sanitizeFreeText` to every
 * string leaf. Used to harden the executor's resume-time event-log
 * write so a HITL `comment` field carrying a pasted key gets scrubbed
 * before it lands in the `node.completed` event payload.
 *
 * Preserves shape: arrays stay arrays, objects keep their keys, numbers
 * + booleans + nulls pass through unchanged. Cycles aren't handled —
 * call sites pass JSON-shaped payloads, not arbitrary graph values.
 */
export function sanitizeFreeTextDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeFreeText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeFreeTextDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeFreeTextDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
