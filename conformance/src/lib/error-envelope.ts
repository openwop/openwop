/**
 * The canonical HTTP error envelope (`schemas/error-envelope.schema.json`,
 * `rest-endpoints.md` §"Error envelope") is FLAT:
 *
 *   { "error": "<code>", "message": "<text>", "details"?: { … } }
 *
 * `additionalProperties: false`; `retriable`, `retryAfter`, `correlationId`,
 * `supported`, `requested`, … live under `details`. Every conforming host,
 * the TypeScript SDK's `ErrorEnvelope`, and the v1 lock all agree on this.
 *
 * Between 2026-06 and 2026-08 a NESTED shape — `{ error: { code, retriable } }`
 * — crept into a few code-list entries of `rest-endpoints.md`, four
 * `host-sample-test-seams.md` seam contracts (§19/§20/§22/§23) and ~15
 * scenarios that read `body.error.code` off an HTTP response (S22, decided
 * 2026-08-16: flat wins — the schema is authoritative and re-shaping `error`
 * from string to object would break every conforming host under
 * COMPATIBILITY.md §2.2). Three OTHER error objects are legitimately nested and
 * are NOT this envelope: `RunSnapshot.error { code, message, retriable? }`
 * (run-level), bulk-result items `{ ok:false, error:{ code } }`, and JSON-RPC
 * bodies (MCP / A2A `{ error: { code, message } }`).
 *
 * These helpers read the CODE and the retriable hint from a canonical (flat)
 * envelope, and — for a deprecation window ending with the first suite minor
 * after 2026-11-10 — tolerate the legacy nested shape a seam may still emit,
 * so a host is not made red for a shape the catalog itself prescribed until
 * today. `assertCanonicalErrorEnvelope` is the strict form for legs that check
 * the envelope's shape rather than only its code.
 */

export interface CanonicalErrorEnvelope {
  readonly error: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** The error code from a canonical envelope; the legacy nested `error.code` is tolerated (deprecation window). */
export function readErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const e = (body as { error?: unknown }).error;
  if (typeof e === 'string') return e;
  if (e !== null && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** `details.retriable` from a canonical envelope; legacy nested `error.retriable` tolerated. */
export function readRetriable(body: unknown): boolean | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const d = (body as { details?: unknown }).details;
  if (d !== null && typeof d === 'object' && typeof (d as { retriable?: unknown }).retriable === 'boolean') {
    return (d as { retriable: boolean }).retriable;
  }
  const e = (body as { error?: unknown }).error;
  if (e !== null && typeof e === 'object' && typeof (e as { retriable?: unknown }).retriable === 'boolean') {
    return (e as { retriable: boolean }).retriable;
  }
  return undefined;
}

/** True iff the body is the legacy nested `{ error: { code } }` shape (for reporting, never for asserting a pass). */
export function isLegacyNestedEnvelope(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const e = (body as { error?: unknown }).error;
  return e !== null && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string';
}

/** Strict shape check: flat, `error` + `message` strings, only the three top-level keys. */
export function isCanonicalErrorEnvelope(body: unknown): body is CanonicalErrorEnvelope {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (typeof b['error'] !== 'string' || b['error'].length === 0) return false;
  if (typeof b['message'] !== 'string' || b['message'].length === 0) return false;
  for (const k of Object.keys(b)) if (k !== 'error' && k !== 'message' && k !== 'details') return false;
  return b['details'] === undefined || (b['details'] !== null && typeof b['details'] === 'object');
}
