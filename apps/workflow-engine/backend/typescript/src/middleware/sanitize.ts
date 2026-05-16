/**
 * Defense-in-depth sanitizer for error envelopes.
 *
 * Strips high-entropy substrings that match common credential shapes
 * (JWT, API-key prefixes, base64 chunks ≥32 chars) before echoing them
 * back to the caller. Used by the error-envelope middleware so a
 * malformed workflowId / credentialRef / interrupt token can't be
 * weaponized as a credential-leak vector.
 *
 * Per `SECURITY/invariants.yaml secret-leakage-error-envelope` —
 * hosts SHOULD sanitize entropy-shaped substrings even when echoing
 * the user's input back in 4xx responses.
 */

const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const LONG_BASE64_RE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;
const PROVIDER_KEY_PREFIXES = /\b(sk|hk|pk|ak)_[A-Za-z0-9_-]{8,}\b/g;

export function sanitizeForErrorMessage(input: string): string {
  return input
    .replace(JWT_RE, '<redacted:jwt>')
    .replace(PROVIDER_KEY_PREFIXES, '<redacted:provider_key>')
    .replace(LONG_BASE64_RE, '<redacted:high-entropy>');
}

/**
 * Recursively walk a value and sanitize any string fields. Returns the
 * structural sibling of the input (strings replaced; arrays + objects
 * recursed; everything else returned as-is).
 *
 * Internal: non-generic to avoid `as unknown as T` casts. Callers cast
 * at the boundary via `sanitizeDetails(value) as typeof value` if they
 * want to preserve a static type.
 */
function sanitizeWalk(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeForErrorMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeWalk);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeWalk(v);
    }
    return out;
  }
  return value;
}

/**
 * Public wrapper preserving the caller's static type for ergonomics.
 * Because the walk is structurally invariant (strings are still strings,
 * arrays are still arrays, etc.), the runtime shape matches the input
 * type and the cast at the boundary is safe.
 */
export function sanitizeDetails<T>(value: T): T {
  return sanitizeWalk(value) as T;
}
