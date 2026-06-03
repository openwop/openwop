import type { Express } from 'express';
import { createLogger } from '../observability/logger.js';
import { getManagedProviderStatuses } from '../providers/managedProvider.js';
import { sessionSecretConfigError } from '../middleware/auth.js';

const log = createLogger('routes.health');

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness reflects downstream-dependency health, not just process
  // liveness. Today it checks managed-provider key availability: if
  // providers.json advertises a managed ("Try it free") tier but its
  // server-held key isn't seeded (dropped/unmounted secret, missing env
  // at boot), every managed call fails with `managed_unavailable`. That
  // used to be invisible until a user ran a workflow; surfacing it here
  // — HTTP 503 + a per-provider `checks.managedProviders` block — turns
  // it into a deploy-time signal a smoke test can assert on.
  //
  // Cloud Run does not probe /readiness by default (TCP startup probe on
  // the port), so a 503 here flags degradation without evicting traffic
  // or failing the revision. Storage connectivity + other downstreams
  // can join the same checks block as they're wired.
  app.get('/readiness', async (_req, res) => {
    let managedProviders: Awaited<ReturnType<typeof getManagedProviderStatuses>>;
    try {
      managedProviders = await getManagedProviderStatuses();
    } catch (err) {
      log.error('readiness check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({ status: 'degraded', error: 'readiness_check_failed' });
      return;
    }
    const unconfigured = managedProviders.filter((p) => !p.ready);
    if (unconfigured.length > 0) {
      log.warn('readiness degraded — managed provider(s) advertised but unconfigured', {
        unconfigured: unconfigured.map((p) => p.providerId),
      });
    }
    // Required prod config: a cookie-mode deploy missing OPENWOP_SESSION_SECRET
    // throws on the first session-minting POST (a silent 503) while readiness
    // would otherwise 200. Surface it here so a deploy smoke test fails fast
    // instead of the health check lying (PRD §8.3 footgun).
    const configError = sessionSecretConfigError();
    if (configError) {
      log.warn('readiness degraded — required prod config missing', { error: configError });
    }
    const ready = unconfigured.length === 0 && !configError;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'degraded',
      checks: {
        managedProviders,
        config: configError ? { ok: false, error: configError } : { ok: true },
      },
    });
  });
}
