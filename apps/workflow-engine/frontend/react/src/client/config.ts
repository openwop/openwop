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
  apiKey: (import.meta.env.VITE_OPENWOP_API_KEY as string | undefined) ?? 'sample-token',
  authMode: ((import.meta.env.VITE_OPENWOP_AUTH_MODE as string | undefined) ?? 'bearer') as AuthMode,
};

/** Headers carrying auth. In cookie mode, returns an empty object —
 *  the browser sends the session cookie automatically as long as the
 *  fetch carries `credentials: 'include'` (see `fetchOpts`). */
export function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ? { ...extra } : {};
  if (config.authMode === 'bearer') base['authorization'] = `Bearer ${config.apiKey}`;
  return base;
}

/** Per-call fetch options injecting `credentials: 'include'` in cookie
 *  mode so the openwop.session cookie travels with the request. */
export function fetchOpts(init?: RequestInit): RequestInit {
  if (config.authMode === 'cookie') {
    return { ...(init ?? {}), credentials: 'include' };
  }
  return init ?? {};
}
