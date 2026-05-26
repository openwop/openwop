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
 * Signature is `unknown → unknown` — callers know the shape they're
 * passing and re-narrow at the use site. A generic `<T>(value: T): T`
 * version would require `as unknown as T` escapes on every return
 * branch (string-replace, map, fresh object) which the project's
 * code-review skill bans across production code. Keeping the
 * signature honest at the price of one narrowing per call site is
 * the right trade.
 *
 * Preserves shape: arrays stay arrays, objects keep their keys, numbers
 * + booleans + nulls pass through unchanged. Cycles aren't handled —
 * call sites pass JSON-shaped payloads, not arbitrary graph values.
 */
export function sanitizeFreeTextDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeFreeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeFreeTextDeep(v));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeFreeTextDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * RFC 0012 §D — SR-1 carry-forward redaction for compaction-derived
 * content. When many short-lived MemoryEntry rows collapse into one
 * distilled entry, source-side leak signatures MUST be re-substituted with
 * the canonical `[REDACTED:<id>]` placeholder — never echoed verbatim, never
 * silently stripped (stripping loses audit signal). This converts the two
 * non-canonical source forms seen in practice plus the standard flat-string
 * key shapes:
 *   - `[BYOK:<id>]`        → `[REDACTED:byok]`        (BYOK ephemeral ref echo)
 *   - `<REDACTED:<id>>`    → `[REDACTED:<id>]`        (upstream non-canonical marker)
 *   - `sk-*` / `xai-*` / `Bearer *` / 32+hex via `sanitizeFreeText`.
 *
 * @see SECURITY/invariants.yaml `memory-compaction-sr-1-carry-forward`
 */
export function redactForCompaction(content: string): string {
  const remarked = content
    .replace(/\[BYOK:[^\]]*\]/g, '[REDACTED:byok]')
    .replace(/<REDACTED:([^>]*)>/g, (_m, id: string) => `[REDACTED:${id.length > 0 ? id : 'source'}]`);
  return sanitizeFreeText(remarked);
}

/**
 * Local type guard — narrows `unknown` to `Record<string, unknown>`.
 *
 * Without this, the recursive walk above needs an `as Record<string,
 * unknown>` at the `Object.entries` call to get a typed iteration —
 * which the project's code-review skill bans. The guard's predicate
 * `v is Record<string, unknown>` flows the type through naturally.
 */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
