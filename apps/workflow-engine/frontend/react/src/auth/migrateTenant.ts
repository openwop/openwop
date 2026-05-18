/**
 * Anon → user tenant migration helper (P3.5 client side).
 *
 * Called once after a successful Firebase Auth sign-in. POSTs to
 * /v1/host/sample/migrate-tenant carrying:
 *   - the Bearer ID token (auto-attached by authedHeaders())
 *   - the openwop.session cookie (auto-attached by credentials:'include')
 *
 * The server returns counts; we log them so the UI can surface a
 * "we kept your N workflows" toast if desired. Re-running is harmless
 * because once the cookie is cleared the second call returns
 * `migrated: false`.
 */

import { config, authedHeaders, fetchOpts } from '../client/config.js';

export interface MigrateResult {
  migrated: boolean;
  runs: number;
  workflows: number;
  secrets: number;
}

export async function migrateAnonToUser(): Promise<MigrateResult | null> {
  try {
    const res = await fetch(
      `${config.baseUrl}/v1/host/sample/migrate-tenant`,
      fetchOpts({
        method: 'POST',
        headers: authedHeaders({ 'content-type': 'application/json' }),
        body: '{}',
      }),
    );
    if (!res.ok) {
      // 401 here means the OIDC token wasn't ready yet — caller can
      // retry after onIdTokenChanged fires.
      return null;
    }
    return (await res.json()) as MigrateResult;
  } catch {
    // Network blip or CORS — non-fatal. User can still work; their
    // anon data just stays under the anon tenant.
    return null;
  }
}
