/**
 * Account management routes (P3.6.5).
 *
 *   DELETE /v1/host/sample/account   — hard delete the caller's data
 *
 * Hard delete wipes:
 *   - every row owned by the caller's user:* tenant (runs, events,
 *     interrupts, workflows, byok_tenant_secrets)
 *   - cached tenant secrets in the in-process resolver
 *
 * Firebase user revocation is the caller's responsibility — the SPA
 * follows the backend DELETE with `user.delete()` on the Firebase JS
 * SDK. We don't pull in firebase-admin server-side because:
 *   (a) it's a heavyweight dep with native modules,
 *   (b) the JS SDK already does the right thing with the user's own
 *       fresh ID token, no service-account credentials needed,
 *   (c) defense-in-depth: server-side data deletion is independent of
 *       Firebase availability.
 *
 * Audit: every deletion writes one row to `audit_log` with the row
 * counts. The audit log itself is NOT cleared — security-relevant
 * events outlive the account by design.
 */

import type { Express } from 'express';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';
import { createLogger } from '../observability/logger.js';
import { clearTenantSecretCache } from '../byok/secretResolver.js';

const log = createLogger('routes.account');

export function registerAccountRoutes(app: Express, deps: { storage: Storage }): void {
  app.delete('/v1/host/sample/account', async (req, res, next) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId || !tenantId.startsWith('user:')) {
        throw new OpenwopError(
          'unauthenticated',
          'Account deletion requires a signed-in user (OIDC Bearer).',
          401,
        );
      }
      // Wipe Postgres rows first (transactional). The KMS-wrapped DEKs
      // for this tenant become orphaned blobs; without the row in
      // byok_secrets there's no way to recover the plaintext.
      const counts = await deps.storage.deleteAllTenantData(tenantId);
      // Drop in-process plaintext cache entries — the rows are already
      // gone via the cascade above; we only need to invalidate caches.
      clearTenantSecretCache(tenantId);

      await deps.storage.appendAudit({
        timestamp: new Date().toISOString(),
        principalId: req.principal?.principalId,
        action: 'account.delete',
        resource: tenantId,
        outcome: 'success',
        payload: counts,
      });

      log.info('account hard-delete', { tenantId, ...counts });
      res.json({ deleted: true, ...counts });
    } catch (err) {
      next(err);
    }
  });
}
