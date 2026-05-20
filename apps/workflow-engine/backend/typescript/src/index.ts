/**
 * openwop-workflow-engine-sample — Cloud Run entry point.
 *
 * Express bootstrap mirroring the shape of myndhyve/services/workflow-runtime
 * but with neutral substitutes for everything product-specific:
 *   - sqlite (not Firestore) for storage
 *   - in-memory secret resolver (not KMS) for BYOK
 *   - synthetic Bearer principal (not Firebase Auth) for identity
 *   - inline dispatch (not Cloud Tasks) for run execution
 *
 * Each substitute is pluggable — see src/host/index.ts and src/storage/.
 */

import express, { type Express } from 'express';
import { createTracer } from './observability/tracer.js';
import { createLogger } from './observability/logger.js';
import { traceContextMiddleware } from './middleware/traceContext.js';
import { authMiddleware } from './middleware/auth.js';
import { ipRateLimitMiddleware } from './middleware/rateLimit.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorEnvelopeMiddleware } from './middleware/errorEnvelope.js';
import { ensureNodesRegistered } from './bootstrap/nodes.js';
import { ensureSuspendManagerInstalled } from './bootstrap/suspend.js';
import { ensureEventLogInstalled } from './bootstrap/eventLog.js';
import { ensureInvocationLogInstalled } from './bootstrap/invocationLog.js';
import { ensureRuntimeCapabilityRegistryInstalled } from './bootstrap/runtimeCapabilityRegistry.js';
import { ensureNodePackResolverInstalled } from './bootstrap/nodePackResolver.js';
import { ensureRegistryPacksInstalled } from './bootstrap/installRegistryPacks.js';
import { ensureLocalPacksMounted } from './bootstrap/mountLocalPacks.js';
import { seedDefaultHostSurfaces } from './bootstrap/hostSurfaceRegistry.js';
import { initInMemorySurfaces } from './host/inMemorySurfaces.js';
import { openStorage } from './storage/index.js';
import { createHostAdapterSuite } from './host/index.js';
import { configureSecretResolver, loadSecretsFromEnv } from './byok/secretResolver.js';
import { bootstrapKmsFromEnv } from './byok/kmsEncryption.js';
import {
  bootstrapManagedProvider,
  configureManagedProvider,
} from './providers/managedProvider.js';
import { dirname, resolve as resolvePath } from 'node:path';
import { registerHealthRoutes } from './routes/health.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerInterruptRoutes } from './routes/interrupts.js';
import { registerStreamRoutes } from './routes/streams.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerPackRoutes } from './routes/packs.js';
import { registerByokRoutes } from './routes/byok.js';
import { registerSampleChatRoutes } from './routes/sampleChat.js';
import { registerTestSeamRoutes } from './routes/testSeam.js';
import { registerMcpServerRoutes } from './routes/mcp.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerNodeCatalogRoute } from './routes/nodeCatalog.js';
import { registerMigrateRoute } from './routes/migrate.js';
import { registerAccountRoutes } from './routes/account.js';

const log = createLogger('workflow-engine');

export interface AppConfig {
  port: number;
  storageDsn: string;
  serviceName: string;
  serviceVersion: string;
  enableConsoleTracer: boolean;
}

export function loadConfigFromEnv(): AppConfig {
  return {
    port: Number(process.env.PORT) || 8080,
    storageDsn: process.env.OPENWOP_STORAGE_DSN || 'sqlite://./data/workflow-engine.db',
    serviceName: process.env.OPENWOP_SERVICE_NAME || 'openwop-workflow-engine-sample',
    serviceVersion: process.env.OPENWOP_SERVICE_VERSION || '0.1.0',
    enableConsoleTracer: process.env.OPENWOP_OTEL_CONSOLE !== 'false',
  };
}

export async function createApp(config: AppConfig): Promise<Express> {
  // OTel must initialize before any spans are created downstream.
  createTracer({
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    consoleExporter: config.enableConsoleTracer,
  });

  const storage = await openStorage(config.storageDsn);
  const hostSuite = createHostAdapterSuite({ storage });

  // Wire BYOK to sqlite + AES-256-GCM-at-rest. Master key resolution:
  // env (OPENWOP_BYOK_ENCRYPTION_KEY) → data/.byok-master-key (auto-
  // generated 0600 on first boot). See src/byok/encryption.ts for the
  // honest security boundary discussion.
  const dataDir = config.storageDsn.startsWith('sqlite://')
    ? dirname(resolvePath(config.storageDsn.slice('sqlite://'.length)))
    : resolvePath('./data');
  configureSecretResolver({ storage, dataDir });
  // Conformance-only canary secret. When OPENWOP_TEST_SEAM_ENABLED is
  // set (we're running the conformance suite, not production), pre-
  // provision the canary used by `byok-roundtrip.test.ts` via
  // `conformance.secret.echo`. Production deployments NEVER hit this
  // path. Skipped if a real secret with the same id already exists.
  if (process.env.OPENWOP_TEST_SEAM_ENABLED === 'true') {
    void (async () => {
      try {
        const { setSecret } = await import('./byok/secretResolver.js');
        await setSecret('openwop-conformance-canary-secret', 'canary-value-CANARY-openwop-CONFORMANCE-NEVER-SECRET-' + Math.random().toString(36).slice(2, 8));
      } catch { /* swallow — best-effort */ }
    })();
  }

  // KMS envelope encryption for signed-in (`user:*`) tenants. When
  // OPENWOP_BYOK_KMS_KEY is set, every signed-in tenant secret gets
  // KMS-wrapped DEK encryption per src/byok/kmsEncryption.ts. Anon
  // tenants stay on the ephemeral in-memory path. Local dev / sqlite
  // boots without KMS — signed-in secrets are simply rejected with a
  // logged warning until the env is supplied.
  bootstrapKmsFromEnv();

  // Pre-seed BYOK from env (kept for backward-compat with conformance
  // / scripted-test setups). Runtime adds via POST /v1/host/sample/byok/secrets.
  await loadSecretsFromEnv();

  // Managed-provider key bootstrap. If MINIMAX_API_KEY (etc.) is set,
  // encrypt it with the BYOK master key and persist into byok_secrets
  // under `managed:<provider>`. Idempotent: rotates if the env value
  // changed, no-ops if unchanged. See providers/managedProvider.ts.
  configureManagedProvider({ storage, dataDir });
  await bootstrapManagedProvider();

  // Pre-register node modules + install singletons before the first
  // request lands. Mirrors the MyndHyve workflow-runtime boot order.
  // Seed host-surface registry with "supported=false" defaults so the
  // discovery + catalog routes can show the full surface list with
  // honest support flags. Phase-3 adapters call registerHostSurface()
  // again with `supported: true` once they're wired.
  seedDefaultHostSurfaces();

  // Wire demo-grade in-memory host surfaces (kv/table/cache/blob/queue
  // /fs/sql/vector/messaging/observability) so pack-authored nodes
  // delegating to ctx.storage / ctx.db / ctx.fs / ctx.queueBus / ctx.observability
  // actually execute. All state is process-local — restarts wipe it.
  // Phase 6 replaces these with real-backend adapters (see
  // examples/hosts/postgres). The surface shapes don't change.
  initInMemorySurfaces({ dataDir });

  ensureNodesRegistered();
  // Wire the subWorkflow dispatcher dependency injection. The node
  // registered above is a thin shim; the actual spawn-and-wait logic
  // calls back into executeRun (recursive child run). The dispatcher
  // module holds the late-bound deps so the node doesn't need direct
  // access to storage or the catalog.
  const { setSubWorkflowDispatcher } = await import('./executor/subWorkflowDispatcher.js');
  const { executeRun } = await import('./executor/executor.js');
  setSubWorkflowDispatcher({ storage, hostSuite, executeRun: executeRun as never });
  ensureSuspendManagerInstalled(storage);
  ensureEventLogInstalled(storage);
  ensureInvocationLogInstalled(storage);
  ensureRuntimeCapabilityRegistryInstalled();
  ensureNodePackResolverInstalled(storage);

  // Dev mount first: symlink every `core.openwop.*` pack from the
  // repo's `packs/` tree into the pack dir. When the backend boots
  // inside the workspace (most dev runs), this gives the builder
  // palette every pack in the repo with zero network calls.
  // Opt out with OPENWOP_MOUNT_LOCAL_PACKS=false. See
  // mountLocalPacks.ts for the trust-model discussion.
  const mountResult = ensureLocalPacksMounted();

  // Fetch + verify + install registry packs the sample wants in the
  // builder palette. Non-blocking: install failures are logged and
  // the sample still serves the locally-registered nodes.
  //
  // Default: when the local mount found the workspace AND
  // OPENWOP_INSTALL_PACKS is unset, skip the network registry install
  // — every default-pack the sample wants is already on disk from the
  // local mount. Explicit `OPENWOP_INSTALL_PACKS=<list>` or running
  // outside the workspace (e.g., Docker / Cloud Run) still triggers
  // the registry fetch.
  const localMountServedDefaults =
    !mountResult.disabled &&
    (mountResult.mounted.length + mountResult.skipped.length + mountResult.shadowed.length) > 0;
  if (!process.env.OPENWOP_INSTALL_PACKS && localMountServedDefaults) {
    process.env.OPENWOP_INSTALL_PACKS = 'none';
  }
  await ensureRegistryPacksInstalled();

  const app = express();

  // Firebase Hosting → Cloud Run rewrite preserves the `/api` source
  // prefix when proxying (e.g. browser hits `/api/v1/runs`, backend
  // receives `/api/v1/runs`). Strip the prefix here so the rest of
  // the routes (`/v1/*`, `/.well-known/openwop`, `/health`) work
  // without per-route `/api`-prefixed clones. Local dev + bearer
  // callers without the prefix are unaffected — the strip is a no-op
  // when the path doesn't start with `/api/`.
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/')) {
      req.url = req.url.slice(4) || '/';
    } else if (req.url === '/api') {
      req.url = '/';
    }
    next();
  });

  // Higher-limit JSON parser for /v1/packs/* publish payloads. MUST
  // register before the global 1mb parser; body-parser is no-op when
  // req._body is set, so registration order is precedence order.
  app.use('/v1/packs', express.json({ limit: '50mb' }));
  app.use(express.json({ limit: '1mb' }));

  // CORS — MUST come before auth so OPTIONS preflight succeeds without
  // credentials per the CORS spec.
  app.use(corsMiddleware());

  // W3C traceparent → active OTel context. Mounted before route
  // registrations so handlers see the propagated context.
  app.use(traceContextMiddleware());

  // Bearer-token auth — stub: any non-empty token resolves to a synthetic
  // principal. Replace with Firebase / OIDC / your IdP for real deploys.
  app.use(authMiddleware());

  // Per-IP request bucket. Applies to every authed route. Per-session
  // run-quota is mounted directly on POST /v1/runs in routes/runs.ts
  // (it needs the principal to scope by session).
  app.use(ipRateLimitMiddleware());

  registerHealthRoutes(app);
  registerDiscoveryRoutes(app, { storage, config });
  registerRunRoutes(app, { storage, hostSuite });
  registerInterruptRoutes(app, { storage });
  registerStreamRoutes(app, { storage });
  registerWebhookRoutes(app, { storage });
  registerPackRoutes(app, { storage });
  registerByokRoutes(app);
  registerSampleChatRoutes(app, { storage });
  registerMigrateRoute(app, { storage });
  registerAccountRoutes(app, { storage });
  registerTestSeamRoutes(app, { storage });
  registerMcpServerRoutes(app, { storage, hostSuite });
  registerAdminRoutes(app);
  registerWorkflowRoutes(app, { hostSuite });
  registerNodeCatalogRoute(app);

  // Express 4 catch-all (no path string — avoids path-to-regexp v6 issue).
  app.use((_req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: 'No route matches this request.',
    });
  });

  // Final canonical error envelope shape; runs after every other handler.
  app.use(errorEnvelopeMiddleware());

  return app;
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const app = await createApp(config);

  app.listen(config.port, () => {
    log.info('workflow-engine listening', { port: config.port });
  });
}

// Only run main() when this file is the entry point (not when imported
// from tests). import.meta.url comparison is the ESM idiom.
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    log.error('fatal startup error', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
