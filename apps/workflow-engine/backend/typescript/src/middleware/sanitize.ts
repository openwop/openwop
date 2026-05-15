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

/** Recursively walk a value and sanitize any string fields. */
export function sanitizeDetails<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeForErrorMessage(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeDetails) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDetails(v);
    }
    return out as unknown as T;
  }
  return value;
}
