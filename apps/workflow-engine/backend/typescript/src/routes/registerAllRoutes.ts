/**
 * Centralized route registration (white-label PRD §3: "a new domain can't
 * ship unregistered").
 *
 * Every backend domain registers here, in ONE ordered list, instead of as a
 * loose stack of calls in index.ts. Registration order is mount order in
 * Express, so the list order is semantic — keep ordering comments intact.
 * Boot-time side effects that must interleave with mounting (registry
 * hydration, host-ext persistence wiring, messaging bridge construction)
 * are list entries too, so the single ordered list is the whole story.
 *
 * The companion test (`test/register-all-routes.test.ts`) asserts that every
 * `register*Routes` export under `src/routes/` appears in this file — adding a
 * new route module without listing it here FAILS CI instead of 404ing in
 * production (the CoLabCare fork shipped exactly that bug).
 */
import type { Express } from 'express';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from '../host/index.js';
// Type-only import from the app entry — erased at compile time, so the
// index.ts → registerAllRoutes.ts → index.ts shape is NOT a runtime cycle.
import type { AppConfig } from '../index.js';
import { registerHealthRoutes } from './health.js';
import { registerDiscoveryRoutes } from './discovery.js';
import { registerRunRoutes } from './runs.js';
import { registerInterruptRoutes } from './interrupts.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerPushSubscriptionRoutes } from './pushSubscriptions.js';
import { registerStreamRoutes } from './streams.js';
import { registerWebhookRoutes } from './webhooks.js';
import { registerPackRoutes } from './packs.js';
import { registerPackTestRoutes } from './packs-test.js';
import { registerByokRoutes } from './byok.js';
import { registerSampleChatRoutes } from './sampleChat.js';
import { registerPromptRoutes } from './prompts.js';
import { registerMigrateRoute } from './migrate.js';
import { registerAccountRoutes } from './account.js';
import { registerMemoryRoutes } from './memory.js';
import { registerMemoryCompactionSeamRoutes } from './memoryCompactionSeam.js';
import { registerWorkspaceRoutes } from './workspace.js';
import { registerMediaAssetRoutes } from './mediaAssets.js';
import { registerTestSeamRoutes } from './testSeam.js';
import { registerMcpServerRoutes } from './mcp.js';
import { registerAdminRoutes } from './admin.js';
import { registerWorkflowRoutes } from './workflows.js';
import { registerNodeCatalogRoute } from './nodeCatalog.js';
import { registerDemoSummaryRoutes } from './demoSummary.js';
import { registerDaemonStatusRoutes } from './daemonStatus.js';
import { registerAgentRoutes } from './agents.js';
import { registerUserAgentRoutes, loadUserAgentsIntoRegistry } from './userAgents.js';
import { registerAgentPackRegistryRoutes } from './agentPackRegistry.js';
import { registerSchedulerRoutes } from './scheduler.js';
import { registerRosterRoutes } from './roster.js';
import { registerOrgChartRoutes } from './orgChart.js';
import { registerAccessControlRoutes } from './accessControl.js';
import { registerKanbanRoutes } from './kanban.js';
import { registerAgentOpsRoutes } from './agentOps.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerTriggerBridgeRoutes } from './triggerBridge.js';
import { registerMessagingRoutes } from './messaging.js';
import { createSelfHttpBridge } from '../messaging/bridge.js';
import { resolveNotifyDelivererFromEnv } from '../messaging/notifyDeliverer.js';
import { initHostExtPersistence } from '../host/hostExtPersistence.js';
import { registerWidgetRoutes } from './widgets.js';

const log = createLogger('routes.registerAll');

export interface RouteDeps {
  app: Express;
  config: AppConfig;
  storage: Storage;
  hostSuite: HostAdapterSuite;
  startTimeMs: number;
}

interface RouteModule {
  name: string;
  register: (deps: RouteDeps) => void;
}

/** Mount order IS Express precedence order — append new domains where they
 *  belong semantically, and keep the ordering comments truthful. */
const ROUTE_MODULES: RouteModule[] = [
  { name: 'health', register: ({ app }) => registerHealthRoutes(app) },
  { name: 'discovery', register: ({ app, storage, config }) => registerDiscoveryRoutes(app, { storage, config }) },
  { name: 'runs', register: ({ app, storage, hostSuite }) => registerRunRoutes(app, { storage, hostSuite }) },
  { name: 'interrupts', register: ({ app, storage }) => registerInterruptRoutes(app, { storage }) },
  { name: 'notifications', register: ({ app, storage }) => registerNotificationRoutes(app, { storage }) },
  { name: 'pushSubscriptions', register: ({ app, storage }) => registerPushSubscriptionRoutes(app, { storage }) },
  { name: 'streams', register: ({ app, storage }) => registerStreamRoutes(app, { storage }) },
  { name: 'webhooks', register: ({ app, storage }) => registerWebhookRoutes(app, { storage }) },
  { name: 'packs', register: ({ app, storage }) => registerPackRoutes(app, { storage }) },
  // RFC 0025 — isolated test-mode mirror namespace. Gated on
  // OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true; routes are not mounted when the
  // env-gate is unset, so production deploys default to "off".
  { name: 'packs-test', register: ({ app }) => registerPackTestRoutes(app) },
  { name: 'byok', register: ({ app }) => registerByokRoutes(app) },
  { name: 'sampleChat', register: ({ app, storage }) => registerSampleChatRoutes(app, { storage }) },
  {
    name: 'prompts',
    register: ({ app }) => registerPromptRoutes(app, {
      capability: { endpointsSupported: true, mutableLibrary: true },
    }),
  },
  { name: 'migrate', register: ({ app, storage }) => registerMigrateRoute(app, { storage }) },
  { name: 'account', register: ({ app, storage }) => registerAccountRoutes(app, { storage }) },
  { name: 'memory', register: ({ app }) => registerMemoryRoutes(app) },
  { name: 'memoryCompactionSeam', register: ({ app }) => registerMemoryCompactionSeamRoutes(app) },
  { name: 'workspace', register: ({ app }) => registerWorkspaceRoutes(app) },
  { name: 'mediaAssets', register: ({ app }) => registerMediaAssetRoutes(app) },
  { name: 'testSeam', register: ({ app, storage }) => registerTestSeamRoutes(app, { storage }) },
  { name: 'mcp', register: ({ app, storage, hostSuite }) => registerMcpServerRoutes(app, { storage, hostSuite }) },
  { name: 'admin', register: ({ app }) => registerAdminRoutes(app) },
  { name: 'workflows', register: ({ app, hostSuite }) => registerWorkflowRoutes(app, { hostSuite }) },
  { name: 'nodeCatalog', register: ({ app }) => registerNodeCatalogRoute(app) },
  { name: 'demoSummary', register: ({ app, config }) => registerDemoSummaryRoutes(app, { config }) },
  { name: 'daemonStatus', register: ({ app, config, startTimeMs }) => registerDaemonStatusRoutes(app, { config, startTimeMs }) },
  { name: 'agents', register: ({ app, hostSuite, storage }) => registerAgentRoutes(app, { hostSuite, storage }) },
  { name: 'userAgents', register: ({ app, storage }) => registerUserAgentRoutes(app, { storage }) },
  { name: 'agentPackRegistry', register: ({ app }) => registerAgentPackRegistryRoutes(app) },
  {
    // Boot-time hydration of the AgentRegistry from persisted user-authored
    // rows (incl. the one-time `_anon`→`default` legacy-tenant migration).
    // Pack-installed agents are registered earlier in the pack loader; this
    // fold adds any user-authored ones so `GET /v1/agents` and the chat-tab
    // `@` picker both see them without per-request lookups.
    name: 'userAgents:hydrate',
    register: ({ storage }) => {
      void loadUserAgentsIntoRegistry(storage).catch((err) => {
        log.error('user_agents_load_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  },
  {
    // Host-extension durability (RFC 0086/0087/0083 sample stores): wire the
    // kv persistence layer. The stores are read-through (every read/write hits
    // storage), so there is no boot-time hydrate step and no per-instance
    // cache to drift — a multi-instance deployment stays consistent.
    name: 'hostExt:persistence',
    register: ({ storage }) => initHostExtPersistence(storage),
  },
  { name: 'scheduler', register: ({ app, storage, hostSuite }) => registerSchedulerRoutes(app, { storage, hostSuite }) },
  // Standing agent roster — RFCS/0086 reference impl (named agent instances +
  // workflow portfolios). Registered before Kanban so a board can bind to a
  // roster member.
  { name: 'roster', register: ({ app }) => registerRosterRoutes(app) },
  // Agent org-chart — RFCS/0087 reference impl (departments/roles/reportsTo
  // over roster members; descriptive only, confers no authority).
  { name: 'orgChart', register: ({ app }) => registerOrgChartRoutes(app) },
  // Organizations / teams / members + role-based access — sample host-extension
  // (non-normative). Roles map to RFC 0049 scopes; a SEPARATE layer from the
  // descriptive org-chart above (org position still confers no authority).
  { name: 'accessControl', register: ({ app }) => registerAccessControlRoutes(app) },
  // Kanban boards — sample host-extension (non-normative). The card→run
  // trigger is the RFCS/0086 "named workflow agents" demo surface.
  { name: 'kanban', register: ({ app, storage, hostSuite }) => registerKanbanRoutes(app, { storage, hostSuite }) },
  // Agent-experience ops (PRD §14): idempotent demo seed + the agent heartbeat
  // "Check now" task-claim. After roster + kanban since it composes both.
  { name: 'agentOps', register: ({ app, storage, hostSuite }) => registerAgentOpsRoutes(app, { storage, hostSuite }) },
  // Approval inbox — the human side of "agents propose, humans dispose". After
  // agentOps since it resolves proposals agentOps creates.
  { name: 'approvals', register: ({ app, storage, hostSuite }) => registerApprovalRoutes(app, { storage, hostSuite }) },
  // RFC 0083 durable trigger bridge — the deferred reference durable-delivery
  // (subscription state machine + dedup/retry/dead-letter + the read surface).
  // The Kanban card→run firing routes through it.
  { name: 'triggerBridge', register: ({ app }) => registerTriggerBridgeRoutes(app) },
  // REFERENCE DOMAIN (white-label PRD §4) — the canonical host-extension
  // vertical-slice example. Env-gated inside the module
  // (OPENWOP_EXAMPLE_WIDGETS_ENABLED=true); listed unconditionally so the
  // can't-ship-unregistered guard covers it.
  { name: 'widgets:example', register: ({ app }) => registerWidgetRoutes(app) },
  {
    // Inbound chat → workflow run bridge. Binds inbound messages to a workflow
    // (default deterministic `sample.demo.uppercase`; override via
    // OPENWOP_MESSAGING_WORKFLOW_ID) and enqueues the reply as outbound egress.
    name: 'messaging',
    register: ({ app, storage, config }) => {
      // Defense-in-depth: warn loudly if a production deploy left the bridge
      // on the wildcard demo bearer instead of a scoped bridge token.
      if (process.env.NODE_ENV === 'production' && !process.env.OPENWOP_MESSAGING_BRIDGE_TOKEN) {
        log.warn('messaging_bridge_unscoped_credential', {
          detail: 'OPENWOP_MESSAGING_BRIDGE_TOKEN is unset; the inbound→run bridge is using the host bearer. Set a tenant-scoped credential for production.',
        });
      }
      registerMessagingRoutes(app, {
        storage,
        bridge: createSelfHttpBridge({
          storage,
          baseUrl: `http://127.0.0.1:${config.port}`,
          // Prefer a dedicated, tenant-scopable bridge credential; fall back to
          // the host bearer for the demo. A real multi-tenant host SHOULD set
          // OPENWOP_MESSAGING_BRIDGE_TOKEN to a scoped credential (the run's
          // tenant still comes from the registered device, not the message).
          bearer: process.env.OPENWOP_MESSAGING_BRIDGE_TOKEN ?? process.env.OPENWOP_API_KEY ?? 'sample-token',
          defaultWorkflowId: process.env.OPENWOP_MESSAGING_WORKFLOW_ID ?? 'sample.demo.uppercase',
        }),
        // Email/SMS delivery: a real webhook (OPENWOP_NOTIFY_WEBHOOK_URL) when
        // set, else the honest synthetic fallback.
        notifyDeliverer: resolveNotifyDelivererFromEnv(),
      });
    },
  },
];

/** Mount every registered domain, in declaration order. */
export function registerAllRoutes(deps: RouteDeps): void {
  for (const m of ROUTE_MODULES) {
    m.register(deps);
  }
}
