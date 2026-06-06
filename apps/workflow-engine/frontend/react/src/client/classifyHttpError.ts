/**
 * classifyHttpError — generic transport-error → friendly copy for the
 * non-chat surfaces (Runs, Orgs, Kanban, Capabilities). The chat feed has its
 * own provider-error table (`chat/lib/errorClassify.ts`, keyed on serialized
 * provider error CODES); this is the complementary HTTP/network-status mapping
 * the fan-out list pages were missing — they rendered raw `listX failed: 429`
 * strings (GAP-ANALYSIS E5). Pair with the `<Notice>` component.
 *
 * The per-IP read budget (~60/min) means 429 is a *normal*, recoverable state
 * for a single real user on a busy page, not an error to apologize for — the
 * copy says "busy, retry shortly", not "something broke".
 */

export interface ClassifiedError {
  kind: 'rate-limited' | 'offline' | 'auth' | 'not-found' | 'server' | 'unknown';
  title: string;
  detail: string;
  /** True when a plain retry is the right next action. */
  retryable: boolean;
}

/** Pull an HTTP status out of an Error — both `status`/`statusCode` properties
 *  (SDK `WopError`) and the `... failed: 429 ...` message convention used by
 *  the raw-fetch clients. */
function statusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const anyErr = err as { status?: unknown; statusCode?: unknown };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = /\b(\d{3})\b/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** A failed `fetch()` rejects with a TypeError ("Failed to fetch") — i.e. the
 *  request never reached the server (offline, DNS, CORS, CDN fault). */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message));
}

export function classifyHttpError(err: unknown): ClassifiedError {
  if (isNetworkError(err)) {
    return {
      kind: 'offline',
      title: "Can't reach the server",
      detail: 'Check your connection — this view will recover once you are back online.',
      retryable: true,
    };
  }
  const status = statusOf(err);
  if (status === 429) {
    return {
      kind: 'rate-limited',
      title: 'Too many requests',
      detail: 'This page is busy. Wait a few seconds and retry.',
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      title: 'Not authorized',
      detail: 'Your session may have expired. Sign in again to continue.',
      retryable: false,
    };
  }
  if (status === 404) {
    return { kind: 'not-found', title: 'Not found', detail: 'This resource no longer exists.', retryable: false };
  }
  if (status !== null && status >= 500) {
    return {
      kind: 'server',
      title: 'Server error',
      detail: 'Something went wrong on the server. This is usually transient — retry shortly.',
      retryable: true,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: err instanceof Error ? err.message : String(err ?? 'Unknown error'),
    retryable: true,
  };
}
