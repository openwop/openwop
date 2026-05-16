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
import { corsMiddleware } from './middleware/cors.js';
import { errorEnvelopeMiddleware } from './middleware/errorEnvelope.js';
import { ensureNodesRegistered } from './bootstrap/nodes.js';
import { ensureSuspendManagerInstalled } from './bootstrap/suspend.js';
import { ensureEventLogInstalled } from './bootstrap/eventLog.js';
import { ensureInvocationLogInstalled } from './bootstrap/invocationLog.js';
import { ensureRuntimeCapabilityRegistryInstalled } from './bootstrap/runtimeCapabilityRegistry.js';
import { ensureNodePackResolverInstalled } from './bootstrap/nodePackResolver.js';
import { openStorage } from './storage/index.js';
import { createHostAdapterSuite } from './host/index.js';
import { configureSecretResolver, loadSecretsFromEnv } from './byok/secretResolver.js';
import { dirname, resolve as resolvePath } from 'node:path';
import { registerHealthRoutes } from './routes/health.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerInterruptRoutes } from './routes/interrupts.js';
import { registerStreamRoutes } from './routes/streams.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerPackRoutes } from './routes/packs.js';
import { registerByokRoutes } from './routes/byok.js';

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

  const storage = openStorage(config.storageDsn);
  const hostSuite = createHostAdapterSuite({ storage });

  // Wire BYOK to sqlite + AES-256-GCM-at-rest. Master key resolution:
  // env (OPENWOP_BYOK_ENCRYPTION_KEY) → data/.byok-master-key (auto-
  // generated 0600 on first boot). See src/byok/encryption.ts for the
  // honest security boundary discussion.
  const dataDir = config.storageDsn.startsWith('sqlite://')
    ? dirname(resolvePath(config.storageDsn.slice('sqlite://'.length)))
    : resolvePath('./data');
  configureSecretResolver({ storage, dataDir });

  // Pre-seed BYOK from env (kept for backward-compat with conformance
  // / scripted-test setups). Runtime adds via POST /v1/byok/secrets.
  loadSecretsFromEnv();

  // Pre-register node modules + install singletons before the first
  // request lands. Mirrors the MyndHyve workflow-runtime boot order.
  ensureNodesRegistered();
  ensureSuspendManagerInstalled(storage);
  ensureEventLogInstalled(storage);
  ensureInvocationLogInstalled(storage);
  ensureRuntimeCapabilityRegistryInstalled();
  ensureNodePackResolverInstalled(storage);

  const app = express();

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

  registerHealthRoutes(app);
  registerDiscoveryRoutes(app, { storage, config });
  registerRunRoutes(app, { storage, hostSuite });
  registerInterruptRoutes(app, { storage });
  registerStreamRoutes(app, { storage });
  registerWebhookRoutes(app, { storage });
  registerPackRoutes(app, { storage });
  registerByokRoutes(app);

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
