/**
 * Frontend config. Reads VITE_OPENWOP_BASE_URL + VITE_OPENWOP_API_KEY +
 * VITE_OPENWOP_AUTH_MODE at build time (Vite inlines into the bundle).
 * A `.env.local` at the react project root overrides defaults.
 *
 * Auth modes:
 *   'bearer' (default) — send Authorization: Bearer <apiKey>. Used by
 *       local dev + the conformance harness. apiKey defaults to
 *       'sample-token' which matches the backend's OPENWOP_API_KEYS
 *       fallback.
 *   'cookie' — send `credentials: 'include'` on every request; rely on
 *       the openwop.session cookie minted by the backend's auth
 *       middleware (P0.2). The Authorization header is dropped entirely.
 *       Used by the public deploy at app.openwop.dev.
 *
 * `authedHeaders()` + `fetchOpts()` are the single-source helpers — all
 * client modules go through them so flipping `VITE_OPENWOP_AUTH_MODE`
 * at build time switches every fetch site at once.
 */

export type AuthMode = 'bearer' | 'cookie';

export const config = {
  baseUrl: (import.meta.env.VITE_OPENWOP_BASE_URL as string | undefined) ?? 'http://localhost:8080',
  /** Base URL for SSE subscriptions ONLY. Defaults to `baseUrl` for
   *  dev, but on production app.openwop.dev the Firebase Hosting proxy
   *  (`/api/**` → Cloud Run) silently buffers SSE responses, breaking
   *  long-lived event streams. Workflow runs that suspend on a HITL
   *  approval would never deliver events to the FE because the proxy
   *  doesn't flush. Bypassing the proxy and hitting Cloud Run directly
   *  is the only path that delivers events live.
   *
   *  Cloud Run's CORS already permits `app.openwop.dev` so cross-origin
   *  EventSource works without further config. */
  sseBaseUrl: (import.meta.env.VITE_OPENWOP_SSE_BASE_URL as string | undefined)
    ?? (import.meta.env.VITE_OPENWOP_BASE_URL as string | undefined)
    ?? 'http://localhost:8080',
  apiKey: (import.meta.env.VITE_OPENWOP_API_KEY as string | undefined) ?? 'sample-token',
  authMode: ((import.meta.env.VITE_OPENWOP_AUTH_MODE as string | undefined) ?? 'bearer') as AuthMode,
};

/**
 * Cached Firebase ID token. Populated by `setCurrentIdToken()` which
 * the auth bootstrap calls from its `onIdTokenChanged` subscriber.
 * Reading the token is synchronous so `authedHeaders()` stays sync —
 * all the existing fetch call sites don't need to become async.
 *
 * Lifecycle: starts null. On first `onIdTokenChanged` fire (immediately
 * after page-load auth restore), gets set to either a string or null
 * (depending on whether a Firebase session exists). On sign-out,
 * cleared to null. On token rotation (~hourly), replaced.
 *
 * Worst case: a fetch fires between page-load and the first
 * `onIdTokenChanged` callback — token is null, request falls back
 * to cookie/bearer mode. Acceptable because the session cookie still
 * works for the anon path AND the next fetch (post-rotation) is
 * authed correctly.
 */
let cachedIdToken: string | null = null;
export function setCurrentIdToken(token: string | null): void {
  cachedIdToken = token;
}

/** Headers carrying auth.
 *   - Signed-in (cached ID token present): Authorization: Bearer <id-token>
 *   - cookie mode: empty (cookie travels via credentials: 'include')
 *   - bearer mode: Authorization: Bearer <apiKey>
 *
 * Token takes precedence over cookie when both are available, so a
 * user who just signed in starts hitting the OIDC backend path without
 * the cookie path competing.
 */
export function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ? { ...extra } : {};
  if (cachedIdToken) {
    base['authorization'] = `Bearer ${cachedIdToken}`;
  } else if (config.authMode === 'bearer') {
    base['authorization'] = `Bearer ${config.apiKey}`;
  }
  return base;
}

/** Per-call fetch options. Includes `credentials: 'include'` in cookie
 *  mode AND when an ID token is present (defense-in-depth: if the
 *  token is rejected, the cookie fallback still works on the same
 *  request thanks to backend's bearer-then-cookie order). */
export function fetchOpts(init?: RequestInit): RequestInit {
  if (config.authMode === 'cookie' || cachedIdToken) {
    return { ...(init ?? {}), credentials: 'include' };
  }
  return init ?? {};
}
