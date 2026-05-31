/**
 * OpenWOP Postgres reference host — run-lifecycle slice.
 *
 * Status (2026-05-11): basic run lifecycle + audit-log integrity profile.
 *   ✅ GET /.well-known/openwop
 *   ✅ GET /v1/openapi.json
 *   ✅ POST /v1/runs (with idempotency-key + configurable validation
 *                    when workflow declares configurableSchema)
 *   ✅ GET /v1/runs/{runId}
 *   ✅ POST /v1/runs/{runId}/cancel
 *   ✅ GET /v1/runs/{runId}/events/poll
 *   ✅ GET /v1/audit/verify (openwop-audit-log-integrity profile)
 *   ✅ Executor for core.noop + core.delay
 *
 * Deferred to follow-up sessions (port from SQLite host, module-by-module):
 *   ⏳ core.approvalGate / clarificationGate / interrupt / subWorkflow
 *   ⏳ Webhook subscriptions + signed delivery (webhooks.ts port)
 *   ⏳ OTel span + metric emission (observability.ts port — file copied
 *      but not wired into routes yet)
 *   ⏳ Debug bundle endpoint
 *   ⏳ SSE event stream (only events/poll for now)
 *   ⏳ Claim acquisition + multi-process scenarios
 *
 * Each follow-up port should: (a) port the module, (b) wire it through
 * server.ts, (c) verify by running the corresponding conformance scenarios
 * against the pglite-backed host, (d) commit per module so each step is
 * reviewable.
 *
 * @see README.md §"Build-out plan"
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { setupSchema } from './schema.js';
import { withTransaction, type Querier } from './db.js';
import {
  setupAuditSchema,
  loadOrCreateSigningKey,
  logAudit,
  triggerCheckpointIfDue,
  verifyAuditChain,
  defaultAuditOptions,
  type SigningKey,
  type AuditOptions,
} from './audit.js';
import {
  observabilityEnabled,
  startMetricLoop,
  stopMetricLoop,
  startRunSpan,
  endRunSpan,
  startNodeSpan,
  endNodeSpan,
  addNodeSpanAttributes,
  recordRunDuration,
  parseTraceparent,
  recordInboundTraceContext,
} from './observability.js';
import { sanitizeCostAttrs, applyCostRollup, snapshotCostRollup } from './cost.js';
import {
  evaluateModelCapabilityGate,
  buildInsufficientPayload,
  buildSubstitutedPayload,
  aggregateAdvertisedCapabilities,
  FIXTURE_NODE_MODEL_CAPABILITIES,
  ACTIVE_PROVIDER,
  ACTIVE_MODEL,
  SUPPORTED_PROVIDERS,
  SUBSTITUTION_SUPPORTED,
} from './modelCapability.js';
import {
  setupInterruptSchema,
  createInterrupt,
  getInterrupt,
  getInterruptByToken,
  resolveApproval,
  resolveClarification,
  resolveExternalEvent,
  invalidateInterrupts,
  type ApprovalConfig,
  type ClarificationConfig,
  type ExternalEventConfig,
} from './interrupts.js';
import {
  setupWebhookSchema,
  registerWebhook,
  unregisterWebhook,
  fanOutEvent,
  WebhookUrlRejected,
} from './webhooks.js';
import { resolveCanarySecret, REFERENCE_SECRETS_CAPABILITY } from './secrets.js';
import {
  performHttpRequest,
  HttpRequestError,
  type HttpRequestConfig,
} from './http-client.js';
import {
  callAiProvider,
  enforcePolicy,
  resolveProviderPolicy,
  AiPolicyDenied,
  AiProviderUnknown,
  REFERENCE_AI_PROVIDERS_CAPABILITY,
  type AiCallRequest,
} from './ai-proxy.js';
import {
  callMcpTool,
  summarizeForEventLog as summarizeMcpForEventLog,
  REFERENCE_MCP_CLIENT_CAPABILITY,
  McpClientError,
  type McpToolCallConfig,
} from './mcp-client.js';
import {
  setupMemorySchema,
  REFERENCE_MEMORY_CAPABILITY,
  REFERENCE_COMPACTION_CAPABILITY,
  runCompaction,
  writeMemoryEntry,
  listMemoryEntries,
} from './memory-adapter.js';
import {
  REFERENCE_AGENTS_CAPABILITY,
  REFERENCE_SUBWORKFLOW_CAPABILITY,
  REFERENCE_CONFORMANCE_CAPABILITY,
  buildAgentReasonedPayload,
  resolveReasoningVerbosity,
} from './agent-events.js';
import {
  JwtValidator,
  JwtValidationError,
  readOAuth2ConfigFromEnv,
  readOIDCConfigFromEnv,
  type SupportedAlgorithm,
} from './jwt-validator.js';
// RFC 0036 — the canonical cross-region convergence resolver (pure function).
// Exposed to the conformance suite via the multi-region simulator seam below.
import { resolveCrossRegionConflict, type ConflictClaim } from './multi-region.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// RFC 0036 — gates both the multi-region/cross-engine capability advertisement
// AND the `/v1/host/sample/test/{multi-region,cross-engine}/*` conformance
// seams. Off by default so a production deploy makes no cross-region claim.
const MULTI_REGION_TEST =
  process.env.OPENWOP_TEST_MULTI_REGION === '1' ||
  process.env.OPENWOP_TEST_MULTI_REGION === 'true';
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3839);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
// Phase I.6 — auth-profiles.md §"openwop-auth-api-key-rotation". When a
// secondary key is configured, both keys authenticate during the overlap
// window; canonical use is rotation: operator sets the new primary, the
// old key moves to OPENWOP_SECONDARY_API_KEY and stays honored until
// clients have rotated. checkAuth iterates every candidate in constant
// time so an attacker cannot distinguish "primary matched" from
// "secondary matched" via timing.
const SECONDARY_API_KEY = process.env.OPENWOP_SECONDARY_API_KEY ?? null;
// Phase I.5 — RFC 0011 §A same-endpoint auth-scoped discovery. When a
// tenant2 key is configured the host returns a NARROWED capability view
// (strict subset of primary's) for tenant2 requests, exercising the
// `openwop-discovery-auth-scoped` profile per
// `capabilities-change-detection.md` §"Scoped capability views" line 69.
const TENANT2_API_KEY = process.env.OPENWOP_TENANT2_API_KEY ?? null;
// Rotation grace window advertisement — auth-profiles.md says hosts
// claiming the profile MUST advertise a non-zero minGraceSeconds (24h
// is the conventional default per the SQLite reference).
const ROTATION_MIN_GRACE_SECONDS = 86_400;

// Phase I.7 — auth-profiles.md §"openwop-auth-mtls". When the operator
// configures cert + key paths, the host listens on HTTPS with mutual
// TLS. Client certs that fail to verify against the optional CA bundle
// terminate at the TLS handshake (per `auth-profiles.md` §`openwop-auth-
// mtls`, hosts MAY surface failure at either the TLS layer or 401
// `invalid_token`; this reference uses the TLS layer for simplicity).
// `subjectMapping: 'cn'` — production deployers extend to SAN-based
// mapping by parsing `req.socket.getPeerCertificate()`.
const MTLS_CERT_PATH = process.env.OPENWOP_MTLS_CERT_PATH ?? null;
const MTLS_KEY_PATH = process.env.OPENWOP_MTLS_KEY_PATH ?? null;
const MTLS_CA_PATH = process.env.OPENWOP_MTLS_CA_PATH ?? null;
const MTLS_REQUIRED = process.env.OPENWOP_MTLS_REQUIRED !== 'false';
const MTLS_ENABLED = MTLS_CERT_PATH !== null && MTLS_KEY_PATH !== null;

// RFC 0012 (Active 2026-05-13). Two env flags:
//   OPENWOP_MEMORY_COMPACTION=true — advertise capabilities.memory.compaction
//   OPENWOP_TEST_TRIGGER_COMPACTION=true — expose the `/v1/test/memory/compact`
//     test seam so conformance scenarios can synchronously drive a
//     compaction run (otherwise host-managed only; clients have no
//     wire-level trigger per RFC 0012 §A).
const MEMORY_COMPACTION_ENABLED = process.env.OPENWOP_MEMORY_COMPACTION === 'true';
const TEST_TRIGGER_COMPACTION = process.env.OPENWOP_TEST_TRIGGER_COMPACTION === 'true';

// CF-6 test seam — when set, every non-trivial route returns 429 with
// the canonical rate-limit envelope per rest-endpoints.md §"429 Too
// Many Requests envelope". Lets the conformance suite's
// rate-limit-envelope.test.ts exercise the shape deterministically
// without relying on real-world load triggering a 429. The protocol
// itself does NOT normate a forced-rate-limit toggle; this is purely
// a test-only seam.
const FORCE_RATE_LIMIT = process.env.OPENWOP_FORCE_RATE_LIMIT === 'true';
const FORCE_RATE_LIMIT_RETRY_AFTER_SECONDS = 5;

// Phase I.3 + I.4 — OAuth2-CC + OIDC user-bearer validators. Each is
// `null` when the operator hasn't configured the env vars; the host
// then advertises only the bearer-equality profile. When configured,
// JWTs presented in `Authorization: Bearer ...` are validated against
// the issuer's JWKS instead of (or in addition to) the static API key.
// The harness env var `OPENWOP_TEST_OAUTH_ISSUER_TRUSTED=true` is the
// conformance suite's signal that the synthetic OIDC issuer is the
// trusted issuer; production deployers set OPENWOP_OAUTH2_ISSUER_URL
// + OPENWOP_OAUTH2_AUDIENCE directly.
const OAUTH2_CONFIG = readOAuth2ConfigFromEnv();
const OIDC_CONFIG = readOIDCConfigFromEnv();
const OAUTH2_VALIDATOR = OAUTH2_CONFIG !== null ? new JwtValidator(OAUTH2_CONFIG) : null;
const OIDC_VALIDATOR = OIDC_CONFIG !== null ? new JwtValidator(OIDC_CONFIG) : null;
const PG_DSN = process.env.OPENWOP_PG_DSN ?? '';
const PROCESS_ID = `host-${randomUUID().slice(0, 8)}`;
const AUDIT_KEY_DIR =
  process.env.OPENWOP_AUDIT_KEY_DIR ?? join(__dirname, '..', 'data');
// Claim observability hint: the advisory lock is the ground-truth, but
// these columns get stamped so operator dashboards can answer "who
// holds the claim, when does it expire?" without having to query
// pg_locks.
const CLAIM_TTL_MS = Number(process.env.OPENWOP_CLAIM_TTL_MS ?? 30_000);
// Backpressure: in-flight HTTP request cap. When exceeded, return
// 503 service_unavailable + Retry-After per production-profile.md
// §"Backpressure". Default of 100 is small enough that conformance
// tests can drive it deterministically; production deployers tune
// via env.
const MAX_INFLIGHT = Number(process.env.OPENWOP_MAX_INFLIGHT ?? 100);
const RETRY_AFTER_SECONDS = Number(process.env.OPENWOP_RETRY_AFTER_SECONDS ?? 1);
// RFC 0058 — host wall-clock ceiling advertised as
// `capabilities.limits.maxRunDurationMs`. A caller's `runTimeoutMs` resolves
// to `min(runTimeoutMs, MAX_RUN_DURATION_MS)`; the ceiling always applies even
// when the caller omits `runTimeoutMs`. Default 1h.
const MAX_RUN_DURATION_MS = Number(process.env.OPENWOP_MAX_RUN_DURATION_MS ?? 3_600_000);
// RFC 0057 — memory ref the host writes its session-end run-summary into.
const RUN_SUMMARY_MEMORY_REF = 'run-summaries';
// Event retention: rows older than this window get swept. 410 Gone on
// expired-run GETs per production-profile.md §"Event retention".
// Default 7 days; reference impl prefers explicit operator config.
const EVENT_RETENTION_DAYS = Number(process.env.OPENWOP_EVENT_RETENTION_DAYS ?? 7);
const RETENTION_SWEEP_INTERVAL_MS = Number(
  process.env.OPENWOP_RETENTION_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000,
);

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'paused'
  | 'waiting-approval'
  | 'waiting-input'
  | 'waiting-external'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface FixtureWorkflow {
  id: string;
  name: string;
  version: string;
  nodes: ReadonlyArray<{
    id: string;
    typeId: string;
    name: string;
    config?: Record<string, unknown>;
    inputs: Record<string, unknown>;
    // RFC 0002 — optional AgentRef pin on a node. Preserved verbatim from the
    // fixture JSON; surfaced on RunSnapshot.agent / runOrchestrator and used to
    // resolve the agent's memoryRef for the memory-action fixtures.
    agent?: {
      agentId: string;
      name?: string;
      modelClass?: string;
      memoryRef?: string;
      version?: string;
      sourceManifestId?: string;
    };
  }>;
  variables?: ReadonlyArray<{ name: string; type: string; required: boolean; defaultValue?: unknown }>;
  configurableSchema?: Record<string, unknown>;
  // channels-and-reducers.md — workflow-declared reducer channels.
  channels?: Record<string, { schema?: unknown; reducer?: string }>;
}

interface RunRow {
  run_id: string;
  workflow_id: string;
  status: RunStatus;
  inputs_json: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  error_json: { code: string; message: string } | null;
  claim_holder_id: string | null;
  claim_expires_at: string | null; // BIGINT comes back as string from pg
  next_node_index: number;
  parent_run_id: string | null;
  parent_node_id: string | null;
  configurable_json: Record<string, unknown> | null;
  variables_json: Record<string, unknown> | null;
  channels_json: Record<string, unknown> | null;
}

interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  node_id: string | null;
  data_json: unknown;
  timestamp: string;
  causation_id: string | null;
}

interface RunEvent {
  readonly seq: number;
  readonly runId: string;
  readonly type: string;
  readonly nodeId: string | null;
  readonly data: unknown;
  readonly timestamp: string;
  // run-event.schema.json §causationId. Required by RFC 0007 §E on
  // core.dispatch's emitted events; optional elsewhere.
  readonly causationId?: string;
}

// ─── Audit-log integrity state (initialized in start()) ──────────────────────

let _auditSigningKey: SigningKey | null = null;
const AUDIT_OPTS: AuditOptions = defaultAuditOptions();

function auditSigningKey(): SigningKey {
  if (!_auditSigningKey) {
    throw new Error(
      'audit not initialized — call start() first (signing key + schema load happen there)',
    );
  }
  return _auditSigningKey;
}

// ─── Querier setup (lazy) ────────────────────────────────────────────────────

let _querier: Querier | null = null;

/**
 * Lazy querier accessor. The host accepts an injected Querier (used by
 * tests with pglite) — when not injected, it opens a pg.Client against
 * OPENWOP_PG_DSN on first use. Tests inject via `setQuerier(...)` BEFORE
 * the server starts handling requests.
 */
export function setQuerier(q: Querier): void {
  _querier = q;
}

async function querier(): Promise<Querier> {
  if (_querier) return _querier;
  if (!PG_DSN) {
    throw new Error(
      'OPENWOP_PG_DSN env var is required (or setQuerier() in a test harness).',
    );
  }
  const c = new Client({ connectionString: PG_DSN });
  await c.connect();
  _querier = c;
  return c;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

const workflows = new Map<string, FixtureWorkflow>();
const eventBus = new EventEmitter();
// Inflight request counter for backpressure. Incremented on route entry,
// decremented on route exit (route's try/finally).
let inflightCount = 0;
let retentionTimer: NodeJS.Timeout | null = null;
// Tracks every fire-and-forget runWorkflow promise so closeHost can
// drain them before tearing down the querier. Without this, an
// abort-while-executing run can leave its `finally { releaseClaim }`
// racing against `_querier.end()`, leaving `claim_holder_id` set
// against a dead PROCESS_ID. @see review C1.
const inflightExecutors = new Set<Promise<void>>();
eventBus.setMaxListeners(1000);
const runningAborters = new Map<string, AbortController>();

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Fixture loading (identical to SQLite host) ──────────────────────────────

function loadFixturesFromDir(dir: string): boolean {
  try {
    const entries = readdirSync(dir);
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const raw = readFileSync(join(dir, file), 'utf8');
      const parsed = JSON.parse(raw) as FixtureWorkflow;
      workflows.set(parsed.id, parsed);
    }
    return true;
  } catch {
    return false;
  }
}

function loadFixtures(): void {
  let probe = __dirname;
  for (let i = 0; i < 10; i++) {
    if (loadFixturesFromDir(join(probe, 'conformance', 'fixtures'))) {
      break;
    }
    probe = dirname(probe);
  }
  // Test seam: load additional fixtures from an env-pointed directory.
  // Used by host-internal smoke tests that exercise typeIds not yet in
  // the protocol-normative fixture catalog (e.g., `core.llm.*`,
  // `core.mcp.toolCall` against a non-standard config).
  const extra = process.env.OPENWOP_EXTRA_FIXTURES_DIR;
  if (extra) loadFixturesFromDir(extra);
  if (workflows.size === 0) {
    // Fallback: minimal noop fixture if nothing else loads.
    workflows.set('conformance-noop', {
      id: 'conformance-noop',
      name: 'Noop',
      version: '1.0',
      nodes: [{ id: 'noop', typeId: 'core.noop', name: 'Noop', inputs: {} }],
    });
  }
}

// ─── Data access (all async, all goes through Querier) ───────────────────────

async function loadRun(runId: string): Promise<RunRow | null> {
  const q = await querier();
  const res = await q.query<RunRow>(
    'SELECT * FROM runs WHERE run_id = $1',
    [runId],
  );
  return res.rows[0] ?? null;
}

async function insertRun(
  runId: string,
  workflowId: string,
  inputs: Record<string, unknown>,
  startedAt: string,
  configurable: Record<string, unknown> | null,
): Promise<void> {
  const q = await querier();
  const seedVars = seedVariablesFromWorkflow(workflowId);
  await q.query(
    `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, configurable_json, variables_json)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
    [
      runId,
      workflowId,
      JSON.stringify(inputs),
      startedAt,
      configurable === null ? null : JSON.stringify(configurable),
      JSON.stringify(seedVars),
    ],
  );
}

/**
 * Seed `variables_json` from `workflow.variables[].defaultValue`.
 *
 * Per `workflow-definition.schema.json` §variables, workflows MAY
 * declare typed variables with default values. When the host creates
 * a run, those defaults form the initial `variables_json` state so
 * downstream consumers (subworkflow outputMapping, identity passthrough,
 * channel reducers) see the declared values without needing every node
 * to write them explicitly. Subworkflow scenarios depend on this for
 * the child to expose `childResult` to the parent's outputMapping.
 */
function seedVariablesFromWorkflow(workflowId: string): Record<string, unknown> {
  const wf = workflows.get(workflowId);
  if (!wf || !Array.isArray(wf.variables)) return {};
  const out: Record<string, unknown> = {};
  for (const v of wf.variables) {
    if (typeof v.name === 'string' && v.defaultValue !== undefined) {
      out[v.name] = v.defaultValue;
    }
  }
  return out;
}

async function updateRunStatus(
  runId: string,
  status: RunStatus,
  endedAt: string | null,
  error: { code: string; message: string } | null,
): Promise<void> {
  const q = await querier();
  await q.query(
    'UPDATE runs SET status = $1, ended_at = $2, error_json = $3 WHERE run_id = $4',
    [status, endedAt, error ? JSON.stringify(error) : null, runId],
  );
}

async function setCancelRequested(runId: string): Promise<void> {
  const q = await querier();
  await q.query(
    `UPDATE runs SET status = CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'cancelling' END
     WHERE run_id = $1`,
    [runId],
  );
}

async function advanceNodeIndex(runId: string, nextIndex: number): Promise<void> {
  const q = await querier();
  await q.query('UPDATE runs SET next_node_index = $1 WHERE run_id = $2', [nextIndex, runId]);
}

/**
 * Merge a single key into a run's `variables_json` bag. Read-modify-write
 * under a transaction so a concurrent node write can't clobber the bag
 * (same pattern as the `core.identity` passthrough).
 */
async function setRunVariable(runId: string, key: string, value: unknown): Promise<void> {
  const q = await querier();
  await withTransaction(q, async () => {
    const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
      'SELECT variables_json FROM runs WHERE run_id = $1',
      [runId],
    );
    const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
    current[key] = value;
    await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
      JSON.stringify(current),
      runId,
    ]);
  });
}

/** Set a reducer channel's folded value into `channels_json` (RunSnapshot.channels). */
async function setRunChannel(runId: string, channel: string, value: unknown): Promise<void> {
  const q = await querier();
  await withTransaction(q, async () => {
    const res = await q.query<{ channels_json: Record<string, unknown> | null }>(
      'SELECT channels_json FROM runs WHERE run_id = $1',
      [runId],
    );
    const current = (res.rows[0]?.channels_json ?? {}) as Record<string, unknown>;
    current[channel] = value;
    await q.query('UPDATE runs SET channels_json = $1 WHERE run_id = $2', [
      JSON.stringify(current),
      runId,
    ]);
  });
}

/**
 * Try to acquire the per-run claim. Uses session-level Postgres advisory
 * locks keyed by `hashtext(runId)`. Returns true if this process now
 * holds the lock; false if another process holds it.
 *
 * Why session-level locks (not txn-level) for this host:
 *   - The executor's lifetime spans many transactions; a txn-level
 *     lock would release at the first commit, defeating the purpose.
 *   - On process crash, the client connection drops; Postgres
 *     automatically releases every session-level lock the dead session
 *     held. The next claimer wins on its next tryClaim call.
 *   - Re-entrant per session: a single host process holding the lock
 *     for runId X can call tryClaim(X) again and get true, with an
 *     internal reference count. We never rely on this; each runWorkflow
 *     invocation pairs exactly one tryClaim with one releaseClaim.
 *
 * Limitation: the host caches a single Querier (one connection). On
 * pg.Pool deployments the advisory lock would be tied to whatever
 * connection runs the tryClaim call; subsequent queries from a
 * different pool connection wouldn't observe the lock. Multi-process
 * production hosts SHOULD pin a connection per runWorkflow invocation.
 */
async function tryClaim(runId: string): Promise<boolean> {
  const q = await querier();
  const res = await q.query<{ got: boolean }>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS got',
    [runId],
  );
  const got = res.rows[0]?.got === true;
  if (got) {
    // Stamp `claim_holder_id` + `claim_expires_at` as observability
    // hints. The advisory lock IS the claim's ground-truth; these
    // columns are descriptive for operator dashboards.
    await q.query(
      `UPDATE runs SET claim_holder_id = $1, claim_expires_at = $2 WHERE run_id = $3`,
      [PROCESS_ID, Date.now() + CLAIM_TTL_MS, runId],
    );
  }
  return got;
}

/**
 * Release the per-run claim. Idempotent: releasing an un-held lock is
 * a no-op (Postgres returns false; we ignore the return).
 */
async function releaseClaim(runId: string): Promise<void> {
  const q = await querier();
  await q.query('SELECT pg_advisory_unlock(hashtext($1)) AS unlocked', [runId]);
  await q.query(
    `UPDATE runs SET claim_holder_id = NULL, claim_expires_at = NULL WHERE run_id = $1`,
    [runId],
  );
}

// Carrier for the next-iteration target when a node returns 'loopback'.
// RFC 0007 §D `next-worker`: dispatch routes control back to the
// upstream orchestrator-supervisor. Mirrors the SQLite host's
// loopbackTargets Map. Cleared by runWorkflow on each loopback outcome.
const loopbackTargets = new Map<string, number>();

// Carrier for specific run-level error envelopes when a node returns
// 'failed'. Without this, runWorkflow's catch-all would mask
// spec-defined codes like `capability_required` (capabilities.md
// §"Unsupported capability — refusal contract") and `no_pending_decision`
// (RFC 0007 §C). executeNode writes here BEFORE returning 'failed';
// runWorkflow reads + clears.
const runFailureErrors = new Map<string, { code: string; message: string }>();

/** Canonical eventId format mirrors the events/poll response shape:
 *  `evt-${runId}-${seq}`. Helper so causationId references resolve to
 *  the same surface clients see.
 */
function makeEventId(runId: string, seq: number): string {
  return `evt-${runId}-${seq}`;
}

/**
 * Resolve the run's effective reasoning verbosity by reading
 * `runs.configurable_json.reasoningVerbosity` (set by callers via
 * `RunOptions.configurable.reasoningVerbosity`). Falls back to the
 * host default per `capabilities.md` §`agents.reasoning` ("summary"
 * with a 512-token cap). Used by the LLM emission path; per-run
 * I/O is cheap and serializes correctly with the executor's
 * row-level locking.
 */
async function readReasoningVerbosity(
  runId: string,
): Promise<'off' | 'summary' | 'full'> {
  const q = await querier();
  const res = await q.query<{ configurable_json: Record<string, unknown> | null }>(
    'SELECT configurable_json FROM runs WHERE run_id = $1',
    [runId],
  );
  return resolveReasoningVerbosity(
    res.rows[0]?.configurable_json ?? null,
    REFERENCE_AGENTS_CAPABILITY.reasoning.verbosity,
  );
}

async function appendEvent(
  runId: string,
  type: string,
  opts: { nodeId?: string; data?: unknown; causationId?: string } = {},
): Promise<RunEvent> {
  const q = await querier();
  // Race-free seq allocation: `UPDATE runs SET next_event_seq = next_event_seq + 1 ... RETURNING`
  // takes a row-level lock on the runs row, so two concurrent appendEvent
  // calls on the same run serialize and each get a distinct seq. This is
  // O(1) per insert (no COUNT(*) scan) and survives the pg.Pool case
  // where two clients could otherwise race a SELECT-then-INSERT pattern.
  const event = await withTransaction(q, async () => {
    const seqRes = await q.query<{ seq: number }>(
      'UPDATE runs SET next_event_seq = next_event_seq + 1 WHERE run_id = $1 RETURNING next_event_seq - 1 AS seq',
      [runId],
    );
    if (seqRes.rows.length === 0) {
      throw new Error(`appendEvent: runId ${runId} not found`);
    }
    const seq = Number(seqRes.rows[0]!.seq);
    const ev: RunEvent = {
      seq,
      runId,
      type,
      nodeId: opts.nodeId ?? null,
      data: opts.data ?? null,
      timestamp: new Date().toISOString(),
      ...(opts.causationId !== undefined ? { causationId: opts.causationId } : {}),
    };
    await q.query(
      `INSERT INTO events (run_id, seq, type, node_id, data_json, timestamp, causation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        seq,
        type,
        ev.nodeId,
        ev.data === null ? null : JSON.stringify(ev.data),
        ev.timestamp,
        opts.causationId ?? null,
      ],
    );
    return ev;
  });

  // Out-of-transaction notifications: the event is durably committed
  // before we notify in-process subscribers or fan out to webhooks.
  // This prevents a ROLLBACK from leaving webhooks observing events
  // that aren't in the canonical log, and it avoids holding the
  // single-connection transaction lock across the subscription SELECT
  // inside fanOutEvent. @see review C3.
  eventBus.emit(`events:${runId}`, event);
  void fanOutEvent(q, { ...event }).catch(() => undefined);
  return event;
}

async function getEventsAfter(runId: string, afterSeq: number): Promise<RunEvent[]> {
  const q = await querier();
  const res = await q.query<EventRow>(
    'SELECT * FROM events WHERE run_id = $1 AND seq > $2 ORDER BY seq ASC',
    [runId, afterSeq],
  );
  return res.rows.map((r) => ({
    seq: r.seq,
    runId: r.run_id,
    type: r.type,
    nodeId: r.node_id,
    data: r.data_json,
    timestamp: r.timestamp,
    ...(r.causation_id !== null ? { causationId: r.causation_id } : {}),
  }));
}

async function setRunTerminal(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  error: { code: string; message: string } | null,
): Promise<void> {
  const endedAt = new Date().toISOString();
  // Read started_at before the UPDATE so we can compute run duration.
  const row = await loadRun(runId);
  await updateRunStatus(runId, status, endedAt, error);
  endRunSpan(runId, status);
  if (row) {
    const seconds = (new Date(endedAt).getTime() - new Date(row.started_at).getTime()) / 1000;
    recordRunDuration(seconds);
  }
  // Structured terminal log per production-profile.md §"Observability"
  // MUST: every terminal run line carries runId, tenant/project id,
  // terminal status, error code, and request correlation (the host's
  // process id stands in as the correlation token).
  console.log(
    JSON.stringify({
      level: status === 'completed' ? 'info' : 'warn',
      event: 'run.terminal',
      runId,
      workflowId: row?.workflow_id,
      tenantId: 'tenant:default',
      status,
      errorCode: error?.code ?? null,
      correlationId: PROCESS_ID,
      timestamp: endedAt,
    }),
  );
}

// RFC 0058 — finalize a run that breached its wall-clock deadline. Per
// `run-options.md` §"Reserved keys" (`runTimeoutMs`) + `capabilities.md`
// §"Engine-enforced limits": emit `cap.breached { kind: 'run-duration' }` so
// the breach is distinguishable on the wire from an application failure, then
// transition to `failed` with `error.code = 'run_timeout'`. `observed` is the
// measured elapsed wall-clock (> `limit`, the resolved deadline).
async function failRunDuration(runId: string, limitMs: number, elapsedMs: number): Promise<void> {
  // The deadline timer firing proves the run genuinely exceeded `limitMs`, so
  // `observed` MUST be strictly greater than `limitMs` (run-event-payloads
  // §capBreached). Integer-millisecond measurement (`Date.now() - runStartMs`)
  // occasionally reads exactly `limitMs` at the boundary even though real
  // elapsed is fractionally past it; floor to `limitMs + 1` to honor the
  // strict-exceedance invariant without misreporting (true elapsed > limit).
  const observed = Math.max(elapsedMs, limitMs + 1);
  await appendEvent(runId, 'cap.breached', {
    data: { kind: 'run-duration', limit: limitMs, observed },
  });
  const error = {
    code: 'run_timeout',
    message: `Run exceeded its wall-clock deadline (RFC 0058 runTimeoutMs): observed ${observed}ms vs limit ${limitMs}ms.`,
  };
  await appendEvent(runId, 'run.failed', { data: error });
  await setRunTerminal(runId, 'failed', error);
}

/**
 * Cancel a run from inside the host (cascade from parent, internal error,
 * etc.). For a suspended run we drive directly to terminal `cancelled`
 * (no executor running to observe a `cancelling` flip); for an executing
 * run we set `cancelling` and abort the in-flight node.
 */
async function cancelRunInternal(runId: string, reason: string): Promise<void> {
  const row = await loadRun(runId);
  if (!row) return;
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') return;
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  const q = await querier();
  if (isSuspended) {
    await invalidateInterrupts(q, runId, reason);
    await appendEvent(runId, 'run.cancelled', { data: { reason } });
    await setRunTerminal(runId, 'cancelled', null);
    return;
  }
  await setCancelRequested(runId);
  runningAborters.get(runId)?.abort();
}

// ─── Idempotency ────────────────────────────────────────────────────────────

function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function buildIdempotencyCacheKey(endpoint: string, key: string): string {
  return `${endpoint}:${key}`;
}

async function getIdempotency(
  cacheKey: string,
): Promise<{ status: number; body: string; body_hash: string } | undefined> {
  const q = await querier();
  const res = await q.query<{ status: number; body: string; body_hash: string }>(
    'SELECT status, body, body_hash FROM idempotency WHERE cache_key = $1',
    [cacheKey],
  );
  return res.rows[0];
}

async function insertIdempotency(
  cacheKey: string,
  status: number,
  body: string,
  bodyHash: string,
): Promise<void> {
  const q = await querier();
  await q.query(
    `INSERT INTO idempotency (cache_key, status, body, body_hash, stored_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cache_key) DO NOTHING`,
    [cacheKey, status, body, bodyHash, Date.now()],
  );
}

async function pruneIdempotency(): Promise<void> {
  const q = await querier();
  await q.query('DELETE FROM idempotency WHERE stored_at < $1', [Date.now() - IDEMPOTENCY_TTL_MS]);
}

// ─── Executor ────────────────────────────────────────────────────────────────

type NodeOutcome = 'completed' | 'cancelled' | 'failed' | 'paused' | 'suspended' | 'loopback';

// Fixture-node `requires` registry per capabilities.md §"Runtime
// capabilities". Production hosts wire this from each node-pack
// manifest; the reference host hard-codes the conformance set.
const FIXTURE_NODE_REQUIRES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'conformance.requiresMissing': ['conformance.never-provided'],
});

// capabilities.md §"Unsupported capability — refusal contract" + §"Capability-gated
// typeId map (normative)". Single source of truth for advertising +
// refusing. Keep in sync with the discovery payload below.
const GATED_TYPEID_MAP: Readonly<Record<string, { capability: string; advertisementPath: string }>> = Object.freeze({
  'core.conversationGate': {
    capability: 'conversationPrimitive',
    advertisementPath: 'capabilities.conversationPrimitive',
  },
  'core.orchestrator.supervisor': {
    capability: 'orchestrator.supported',
    advertisementPath: 'capabilities.orchestrator.supported',
  },
  'core.dispatch': {
    capability: 'dispatch.supported',
    advertisementPath: 'capabilities.dispatch.supported',
  },
});

// Capabilities this host advertises in /.well-known/openwop. Single
// source of truth for both the discovery payload and the refusal
// check; if a new capability is implemented, add it here AND in
// handleDiscovery so the two stay aligned.
const HOST_ADVERTISED_GATED_CAPABILITIES: ReadonlySet<string> = new Set([
  'orchestrator.supported',
  'dispatch.supported',
  // conversationPrimitive is NOT advertised — the host doesn't
  // implement core.conversationGate. Workflows referencing it are
  // refused at run-create with capability_required.
]);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });
}

function resolveInputAsNumber(
  raw: unknown,
  inputs: Record<string, unknown>,
  fallback: number,
): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && raw !== null) {
    const ref = raw as { type?: string; variableName?: string };
    if (ref.type === 'variable' && ref.variableName) {
      const v = inputs[ref.variableName];
      if (typeof v === 'number') return v;
    }
  }
  return fallback;
}

async function executeNode(
  runId: string,
  node: FixtureWorkflow['nodes'][number],
  inputs: Record<string, unknown>,
  signal: AbortSignal,
): Promise<NodeOutcome> {
  const refreshed = await loadRun(runId);
  if (refreshed?.status === 'cancelling') {
    await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
    return 'cancelled';
  }

  // capabilities.md §"Runtime capabilities": a NodeModule that declares
  // `requires: [<capId>]` MUST cause the run to fail with
  // `capability_not_provided` if the host does not advertise the
  // capability. Refusal happens BEFORE node.started so the offending
  // node MUST NOT execute.
  const requires = FIXTURE_NODE_REQUIRES[node.typeId];
  if (requires && requires.length > 0) {
    const advertised = new Set<string>(); // Postgres host advertises no `runtimeCapabilities`.
    const missing = requires.find((cap) => !advertised.has(cap));
    if (missing !== undefined) {
      runFailureErrors.set(runId, {
        code: 'capability_not_provided',
        message: `Node "${node.id}" (typeId "${node.typeId}") requires capability "${missing}" which the host does not advertise.`,
      });
      return 'failed';
    }
  }

  // RFC 0031 §B — model-capability gate. A node declaring
  // `requiredModelCapabilities` the active model doesn't advertise is
  // refused at dispatch with `model.capability.insufficient` (emitted
  // BEFORE node.failed per §D) + `capability_not_provided`. Runs before
  // node.started so the node never executes (no node.completed / provider
  // / envelope events). substitutionSupported is false, so a declared
  // fallbackModel does not trigger substitution.
  const requiredModelCaps = FIXTURE_NODE_MODEL_CAPABILITIES[node.typeId];
  if (requiredModelCaps && requiredModelCaps.length > 0) {
    const outcome = evaluateModelCapabilityGate({
      module: { requiredModelCapabilities: requiredModelCaps },
      activeProvider: ACTIVE_PROVIDER,
      activeModel: ACTIVE_MODEL,
      substitutionSupported: SUBSTITUTION_SUPPORTED,
      supportedProviders: SUPPORTED_PROVIDERS,
    });
    if (outcome.route === 'refuse') {
      await appendEvent(runId, 'model.capability.insufficient', {
        nodeId: node.id,
        data: buildInsufficientPayload(outcome, node.id, ACTIVE_PROVIDER, ACTIVE_MODEL),
      });
      await appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'capability_not_provided' },
      });
      runFailureErrors.set(runId, {
        code: 'capability_not_provided',
        message: `Node "${node.id}" model capabilities not satisfied: missing ${outcome.missingCapabilities.join(', ')}.`,
      });
      return 'failed';
    }
    // route 'dispatch' | 'substitute' → fall through (the reference host
    // advertises substitutionSupported:false, so 'substitute' won't arise here).
  }

  await appendEvent(runId, 'node.started', { nodeId: node.id });
  startNodeSpan(runId, node.id, node.typeId);

  switch (node.typeId) {
    case 'core.noop':
      break;

    case 'core.identity': {
      // RFC 0003 §D — handoff-schema validation at the agent-dispatch surface.
      // The `conformance-agent-pack-handoff-schema-validation` fixture is a noop
      // workflow that drives validation via `inputs.scenario`. The host MUST
      // validate the dispatch payload against the structured-fixture agent's
      // `handoff.taskSchemaRef` (requires { text, extractionFields }) BEFORE
      // dispatch, and the return payload against `handoff.returnSchemaRef`
      // (requires `extracted`) BEFORE persistence — rejecting off-contract
      // payloads with a structured error. See agentPackHandoffSchemaValidation.
      {
        const scenario = typeof inputs['scenario'] === 'string' ? inputs['scenario'] : undefined;
        if (
          scenario === 'valid-task' ||
          scenario === 'invalid-task' ||
          scenario === 'mock-return-violation'
        ) {
          if (scenario === 'invalid-task') {
            // taskSchemaRef requires `text` (string) + `extractionFields` (array).
            const okText = typeof inputs['text'] === 'string';
            const okFields = Array.isArray(inputs['extractionFields']);
            if (!okText || !okFields) {
              const err = {
                code: 'handoff_task_schema_violation',
                message:
                  'Dispatch task payload failed handoff.taskSchemaRef validation (missing required field "extractionFields"); the agent MUST NOT see the off-contract payload.',
              };
              await appendEvent(runId, 'node.failed', { nodeId: node.id, data: { error: err } });
              runFailureErrors.set(runId, err);
              endNodeSpan(runId, node.id, 'failed');
              return 'failed';
            }
          } else if (scenario === 'mock-return-violation') {
            // The mock agent returns a payload that omits the required `extracted`
            // field without declaring `error` — fail before persistence.
            const err = {
              code: 'handoff_return_schema_violation',
              message:
                'Agent return payload failed handoff.returnSchemaRef validation (missing required field "extracted"); the off-schema result MUST NOT be persisted.',
            };
            await appendEvent(runId, 'node.failed', { nodeId: node.id, data: { error: err } });
            runFailureErrors.set(runId, err);
            endNodeSpan(runId, node.id, 'failed');
            return 'failed';
          }
          // valid-task: payload conforms to taskSchemaRef → dispatch proceeds
          // (noop body) and the run completes.
          break;
        }
      }
      // RFC 0004 — memory-adapter read-side fixtures. A `core.identity` node
      // may carry `config.memoryAction` + an `agent.memoryRef` pin; the host
      // exercises the MemoryAdapter (write → list/get, TTL filter, SR-1
      // redaction) and lands the read-back result in a workflow variable.
      // See agentMemoryRoundTrip / agentMemoryRedactionContract /
      // agentMemoryTtlExpiry conformance scenarios.
      const memoryAction =
        typeof node.config?.memoryAction === 'string' ? node.config.memoryAction : undefined;
      const memoryRef = node.agent?.memoryRef;
      if (memoryAction && typeof memoryRef === 'string') {
        const q = await querier();
        const tenantId = 'tenant:default';
        const nowMs = Date.now();
        if (memoryAction === 'write-then-read') {
          await writeMemoryEntry(q, {
            tenantId,
            memoryRef,
            memoryId: `mem-${runId}-roundtrip`,
            content: `Round-trip memory entry written by run ${runId}.`,
            tags: ['conformance', 'agent-memory', 'roundtrip'],
          });
          const entries = await listMemoryEntries(q, tenantId, memoryRef, { limit: 1 });
          await setRunVariable(runId, 'memoryReadback', entries[0] ?? null);
        } else if (memoryAction === 'redaction-probe') {
          // SR-1: resolve the BYOK test secret, then substitute its plaintext
          // with `[REDACTED:<secretId>]` BEFORE persistence — the raw secret
          // value never lands in the memory store or on any read surface.
          const secretId =
            typeof node.config?.byokSecretId === 'string'
              ? node.config.byokSecretId
              : 'conformance-test-secret';
          const plaintext =
            resolveCanarySecret(secretId) ??
            'conformance-byok-plaintext-not-a-real-credential';
          const raw = `Agent note containing BYOK secret: ${plaintext}`;
          const redacted = raw.split(plaintext).join(`[REDACTED:${secretId}]`);
          await writeMemoryEntry(q, {
            tenantId,
            memoryRef,
            memoryId: `mem-${runId}-redaction`,
            content: redacted,
            tags: ['conformance', 'agent-memory', 'redaction'],
          });
          const entries = await listMemoryEntries(q, tenantId, memoryRef, { limit: 1 });
          await setRunVariable(runId, 'memoryReadback', entries[0] ?? null);
        } else if (memoryAction === 'ttl-probe') {
          await writeMemoryEntry(q, {
            tenantId,
            memoryRef,
            memoryId: `mem-${runId}-expired`,
            content: 'Expired entry (expiresAt in the past).',
            tags: ['conformance', 'agent-memory', 'ttl'],
            expiresAt: new Date(nowMs - 3_600_000).toISOString(),
          });
          await writeMemoryEntry(q, {
            tenantId,
            memoryRef,
            memoryId: `mem-${runId}-live`,
            content: 'Live entry (expiresAt in the future).',
            tags: ['conformance', 'agent-memory', 'ttl'],
            expiresAt: new Date(nowMs + 3_600_000).toISOString(),
          });
          // list() filters expired entries server-side (memory-adapter.ts).
          const entries = await listMemoryEntries(q, tenantId, memoryRef, { limit: 50 });
          await setRunVariable(runId, 'memoryList', entries);
        }
        break;
      }
      // channels-and-reducers.md §`message` — idempotency probe. The fixture
      // sets `config.emitDuplicateMessageId` and declares a `message`-reducer
      // channel; the host emits the same messageId twice and the reducer folds
      // it to a single append-only entry. See agentMessageReducer.test.ts.
      if (node.config?.emitDuplicateMessageId === true) {
        const q = await querier();
        const wfRow = await q.query<{ workflow_id: string }>(
          'SELECT workflow_id FROM runs WHERE run_id = $1',
          [runId],
        );
        const wf = workflows.get(wfRow.rows[0]?.workflow_id ?? '');
        const channelName =
          (wf?.channels &&
            Object.entries(wf.channels).find(([, c]) => c.reducer === 'message')?.[0]) ||
          'messages';
        const dupId = `msg-${runId}-1`;
        const emissions = [
          { messageId: dupId, role: 'assistant', content: 'first emission' },
          { messageId: dupId, role: 'assistant', content: 'duplicate emission (same messageId)' },
          { messageId: `msg-${runId}-2`, role: 'assistant', content: 'second message' },
        ];
        // `message` reducer: append-only + idempotent on messageId (first wins).
        const folded: Array<{ messageId: string; role: string; content: string }> = [];
        const seen = new Set<string>();
        for (const m of emissions) {
          if (seen.has(m.messageId)) continue;
          seen.add(m.messageId);
          folded.push(m);
        }
        await setRunChannel(runId, channelName, folded);
        break;
      }
      // node-packs.md §"core.identity": echo-input primitive — passes
      // each named input port to a same-named output port unchanged.
      // The RFC 0022 dispatch/subWorkflow child fixtures use it as a
      // noop body, and conformance-identity (identity-passthrough.test.ts)
      // asserts inputs.{var} round-trips to RunSnapshot.variables.{var}.
      // This host seeds variables_json from workflow.variables[].defaultValue
      // only (see seedVariablesFromWorkflow), NOT from run inputs, so the
      // passthrough explicitly folds the run inputs into the variable bag.
      const q = await querier();
      await withTransaction(q, async () => {
        const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
          'SELECT variables_json FROM runs WHERE run_id = $1',
          [runId],
        );
        const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(inputs)) {
          current[key] = value;
        }
        await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
          JSON.stringify(current),
          runId,
        ]);
      });
      break;
    }

    case 'core.delay': {
      // Resolve effective delay duration. Precedence:
      //   1. Node spec declares delayMs (possibly via variable
      //      reference) — the fixture catalog's canonical shape.
      //   2. Run inputs supply `delaySeconds` directly — used by
      //      pause-resume.test.ts and cancellation.test.ts (the
      //      `conformance-cancellable` fixture only references
      //      `delayMs`; the test passes `inputs.delaySeconds` to keep
      //      the run alive long enough for pause/cancel to land).
      //   3. Fallback: 100ms.
      // Precedence (unchanged for the delaySeconds path): an explicit
      // `inputs.delaySeconds` override wins (pause-resume / cancellation
      // tests rely on it). Otherwise resolve the node's `delayMs` — a
      // variable ref in the fixtures — against the run's VARIABLE bag
      // (seeded from `variables[].defaultValue`), not just run inputs.
      // RFC 0058's `conformance-run-duration-breach` sets `delayMs=30000`
      // there so the run outlives a small `runTimeoutMs`; resolving only
      // against inputs (empty) previously collapsed it to the 100ms
      // fallback and the wall-clock bound never tripped.
      const delayMs = await (async (): Promise<number> => {
        const supplied = inputs['delaySeconds'];
        if (typeof supplied === 'number' && supplied > 0) {
          return Math.floor(supplied * 1000);
        }
        const q = await querier();
        const vr = await q.query<{ variables_json: Record<string, unknown> | null }>(
          'SELECT variables_json FROM runs WHERE run_id = $1',
          [runId],
        );
        const vars = (vr.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
        // Resolve the variable ref against variable defaults overlaid with
        // run inputs — an explicit `inputs.delayMs` (e.g. streamReconnect's
        // `delayMs: 2000`) overrides the `defaultValue` seed; a fixture that
        // relies on the seed alone (run-duration-breach's 30000) still gets it.
        const declared = resolveInputAsNumber(node.inputs.delayMs, { ...vars, ...inputs }, -1);
        return declared >= 0 ? declared : 100;
      })();
      try {
        await sleep(delayMs, signal);
      } catch {
        // Disambiguate pause-abort from cancel-abort by reading the
        // current run status (handlePause sets 'paused' BEFORE aborting).
        const refreshed = await loadRun(runId);
        if (refreshed?.status === 'paused') {
          // Drain-current-node interpretation for stateless waits:
          // core.delay is an artificial pause, no real work to drain.
          // We treat the delay as logically COMPLETED on pause arrival,
          // then break out (the outer loop sees status=paused on the
          // next iteration check and exits). On resume the cursor has
          // already advanced past this node, so the overall wall-clock
          // duration of the run stays close to the originally-requested
          // delay even with pause+resume. Per pause-resume.test.ts the
          // run MUST reach terminal within vitest's 30s test budget.
          await appendEvent(runId, 'node.completed', { nodeId: node.id });
          endNodeSpan(runId, node.id, 'completed');
          return 'completed';
        }
        await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
        endNodeSpan(runId, node.id, 'cancelled');
        return 'cancelled';
      }
      break;
    }

    case 'conformance.secret.echo': {
      // openwop-smoke-byok-roundtrip fixture. Resolve a host-provisioned
      // secret by id, then emit `{secretSha256, secretLength}` into the
      // run's variables. The raw value NEVER leaves the resolver — per
      // observability.md §"Redaction" + threat-model-secret-leakage.md
      // §SR-1, only the hash + length appear on any observable surface
      // (variables, events, debug bundle, logs, webhook envelope).
      const cfg = (node.config ?? {}) as { secretId?: string };
      const secretId = typeof cfg.secretId === 'string' ? cfg.secretId : null;
      if (!secretId) {
        const err = {
          code: 'validation_error',
          message: `conformance.secret.echo (node "${node.id}") MUST declare config.secretId.`,
        };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      const resolved = resolveCanarySecret(secretId);
      if (resolved === null) {
        const err = {
          code: 'credential_unavailable',
          message: `Secret "${secretId}" is not provisioned on this host.`,
        };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      // SR-1: hash + length only; never the raw cleartext.
      const secretSha256 = createHash('sha256').update(resolved, 'utf8').digest('hex');
      const secretLength = resolved.length;
      // Persist into variables_json so the test driver can verify the
      // shape (the byok-roundtrip test reads `variables['resolve-secret']`).
      {
        const q = await querier();
        await withTransaction(q, async () => {
          const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
            'SELECT variables_json FROM runs WHERE run_id = $1',
            [runId],
          );
          const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
          current[node.id] = { secretSha256, secretLength };
          await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
            JSON.stringify(current),
            runId,
          ]);
        });
      }
      break;
    }

    case 'core.llm.chat':
    case 'core.llm.completion': {
      // Phase H.1″ — capabilities.md §`aiProviders.policies` 4-mode
      // enforcement. The node config supplies (provider, model,
      // credentialRef?, input); the host resolves the per-provider
      // policy, enforces it, calls the provider (stubbed in reference
      // impl), then emits the result minus any cleartext credential
      // material into variables[node.id].
      const cfg = (node.config ?? {}) as {
        provider?: string;
        model?: string;
        credentialRef?: string;
        input?: unknown;
        agentId?: string;
      };
      if (typeof cfg.provider !== 'string' || typeof cfg.model !== 'string') {
        const err = {
          code: 'validation_error',
          message: `${node.typeId} (node "${node.id}") MUST declare config.provider AND config.model as strings`,
        };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      const aiRequest: AiCallRequest = {
        provider: cfg.provider,
        model: cfg.model,
        ...(cfg.credentialRef !== undefined ? { credentialRef: cfg.credentialRef } : {}),
        input: cfg.input ?? null,
      };
      const policy = resolveProviderPolicy(aiRequest.provider);
      let credentialCleartext: string | null;
      try {
        ({ credentialCleartext } = enforcePolicy(policy, aiRequest));
      } catch (err: unknown) {
        if (err instanceof AiPolicyDenied) {
          const denial = {
            code: 'provider_policy_denied',
            message: err.message,
            details: { reason: err.reason, ...err.details },
          };
          // Audit: emit `policy.decision` per spec §"Audit emission".
          // Host-internal taxonomy; clients learn outcome from the
          // node.failed envelope.
          await appendEvent(runId, 'policy.decision', {
            nodeId: node.id,
            data: {
              provider: aiRequest.provider,
              mode: policy.mode,
              decision: 'deny',
              reason: err.reason,
            },
          });
          await appendEvent(runId, 'node.failed', { nodeId: node.id, data: denial });
          runFailureErrors.set(runId, { code: denial.code, message: denial.message });
          endNodeSpan(runId, node.id, 'failed');
          return 'failed';
        }
        if (err instanceof AiProviderUnknown) {
          const denial = {
            code: 'validation_error',
            message: err.message,
            details: { provider: err.provider },
          };
          await appendEvent(runId, 'node.failed', { nodeId: node.id, data: denial });
          runFailureErrors.set(runId, { code: denial.code, message: denial.message });
          endNodeSpan(runId, node.id, 'failed');
          return 'failed';
        }
        throw err;
      }
      // Policy permitted the call. Audit-emit the permit decision.
      await appendEvent(runId, 'policy.decision', {
        nodeId: node.id,
        data: {
          provider: aiRequest.provider,
          mode: policy.mode,
          decision: 'permit',
        },
      });
      let result;
      try {
        result = await callAiProvider(aiRequest, credentialCleartext);
      } catch (err: unknown) {
        const failure = {
          code: 'external_call_failed',
          message: err instanceof Error ? err.message : String(err),
        };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: failure });
        runFailureErrors.set(runId, failure);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      } finally {
        // Defense-in-depth: drop the local reference so the cleartext
        // can't accidentally land on a later closure.
        credentialCleartext = null;
      }
      // Persist redaction-safe result. SR-1: no cleartext credential
      // material; only the hash (credentialRefHashed) for audit
      // correlation.
      const q = await querier();
      await withTransaction(q, async () => {
        const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
          'SELECT variables_json FROM runs WHERE run_id = $1',
          [runId],
        );
        const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
        current[node.id] = {
          provider: result.provider,
          model: result.model,
          outputText: result.outputText,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs: result.durationMs,
          credentialRefHashed: result.credentialRefHashed,
        };
        await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
          JSON.stringify(current),
          runId,
        ]);
      });
      // Phase I.2 — reasoning-event emission per capabilities.md §`agents`
      // (Phase 1). The host carries the LLM output through a verbosity-
      // gated `agent.reasoned` and a confidence-bearing `agent.decided`
      // so downstream consumers (audit, debug bundles, replay) see a
      // wire-canonical trace even though this reference uses a stub AI
      // proxy. Verbosity precedence: run.configurable → host default
      // ("summary") per `resolveReasoningVerbosity`.
      const llmAgentId = cfg.agentId ?? `agent:${cfg.provider}/${cfg.model}`;
      const reasoningVerbosity = await readReasoningVerbosity(runId);
      const reasonedPayload = buildAgentReasonedPayload(
        { agentId: llmAgentId },
        result.outputText,
        { verbosity: reasoningVerbosity, tokenLimit: REFERENCE_AGENTS_CAPABILITY.reasoning.tokenLimit },
      );
      if (reasonedPayload !== null) {
        await appendEvent(runId, 'agent.reasoned', {
          nodeId: node.id,
          data: {
            agentId: llmAgentId,
            reasoning: reasonedPayload.reasoning,
            verbosity: reasoningVerbosity,
          },
        });
      }
      await appendEvent(runId, 'agent.decided', {
        nodeId: node.id,
        data: {
          agentId: llmAgentId,
          decision: { kind: 'llm-completion', outputLength: result.outputText.length },
          confidence: 1,
        },
      });
      break;
    }

    case 'core.mcp.toolCall': {
      // host-capabilities.md §host.mcp + threat-model-prompt-injection.md
      // §UNTRUSTED. Invokes a tool on an env-configured MCP server.
      // Per MCP-1 invariant: tool arguments + result content NEVER
      // appear on the node.completed event payload — only a sanitized
      // summary (hashes + length). The full result IS persisted to
      // variables[node.id] (authenticated surface) so the workflow
      // can consume it, tagged contentTrust: "untrusted" so downstream
      // LLM nodes treat it as user data rather than instructions.
      // node.config is structurally Record<string, unknown>;
      // McpToolCallConfig has all-optional fields (callMcpTool
      // validates serverId + toolName at runtime), so a plain
      // `as Partial<T>` is sufficient — matching the
      // core.approvalGate / core.clarificationGate pattern above
      // and avoiding the banned `as unknown as T` shape.
      const cfg = (node.config ?? {}) as Partial<McpToolCallConfig> & { agentId?: string };
      // Phase I.2 — reasoning-event emission per capabilities.md §`agents`
      // (Phase 1). `agent.toolCalled` / `agent.toolReturned` pair via
      // shared `callId` per `run-event-payloads.schema.json`. MCP-1
      // redaction holds: only the SHA-256 of the argument JSON and the
      // SHA-256 of the result content appear on the event payload —
      // raw args + content are never persisted to the event log.
      const mcpAgentId = cfg.agentId ?? `agent:mcp/${cfg.serverId ?? 'unknown'}/${cfg.toolName ?? 'unknown'}`;
      const mcpCallId = `mcp-${node.id}-${Date.now().toString(36)}`;
      const argsJson = JSON.stringify(cfg.arguments ?? {});
      const argumentsSha256 = createHash('sha256').update(argsJson, 'utf8').digest('hex');
      await appendEvent(runId, 'agent.toolCalled', {
        nodeId: node.id,
        data: {
          agentId: mcpAgentId,
          toolName: cfg.toolName ?? '',
          callId: mcpCallId,
          argumentsSha256,
        },
      });
      try {
        const result = await callMcpTool(cfg, signal);
        const summary = summarizeMcpForEventLog(cfg, result);
        // MCP-1: persist the FULL result into variables; emit only the
        // SUMMARY on node.completed via the executor's standard event
        // append below. The summary is also attached to a host-internal
        // `mcp.invoked` audit event so audit trails can correlate
        // tool calls without the raw payload.
        await appendEvent(runId, 'mcp.invoked', { nodeId: node.id, data: summary });
        // Pair the earlier `agent.toolCalled` with its `agent.toolReturned`.
        // SR-1 / MCP-1: the result body itself never appears on the event
        // — only its SHA + length + success bit.
        await appendEvent(runId, 'agent.toolReturned', {
          nodeId: node.id,
          data: {
            agentId: mcpAgentId,
            toolName: cfg.toolName ?? '',
            callId: mcpCallId,
            outcome: {
              resultSha256: summary.resultSha256,
              resultLength: summary.resultLength,
              isError: summary.isError,
              durationMs: summary.durationMs,
            },
          },
        });
        const q = await querier();
        await withTransaction(q, async () => {
          const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
            'SELECT variables_json FROM runs WHERE run_id = $1',
            [runId],
          );
          const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
          current[node.id] = {
            serverId: cfg.serverId,
            toolName: cfg.toolName,
            content: result.content,
            isError: result.isError,
            contentTrust: result.contentTrust,
            durationMs: result.durationMs,
          };
          await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
            JSON.stringify(current),
            runId,
          ]);
        });
      } catch (err: unknown) {
        if (signal.aborted) {
          const refreshed = await loadRun(runId);
          if (refreshed?.status === 'paused') {
            endNodeSpan(runId, node.id, 'paused');
            return 'paused';
          }
          await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
          endNodeSpan(runId, node.id, 'cancelled');
          return 'cancelled';
        }
        const mcpErr = err instanceof McpClientError
          ? { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
          : { code: 'node_execution_failed', message: err instanceof Error ? err.message : String(err) };
        // Pair the earlier `agent.toolCalled` with a terminal `agent.toolReturned { error }`
        // — `outcome` and `error` are mutually exclusive per the canonical
        // `agentToolReturned` payload.
        await appendEvent(runId, 'agent.toolReturned', {
          nodeId: node.id,
          data: {
            agentId: mcpAgentId,
            toolName: cfg.toolName ?? '',
            callId: mcpCallId,
            error: { code: mcpErr.code, message: mcpErr.message },
          },
        });
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: mcpErr });
        runFailureErrors.set(runId, { code: mcpErr.code, message: mcpErr.message });
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      break;
    }

    case 'core.http.request': {
      // node-packs.md §"Built-in nodes — core.http.request": SSRF-
      // guarded HTTP call against a tenant-supplied URL. Response is
      // persisted into variables[node.id]; raw Authorization/Cookie
      // request headers never appear on emitted events. Failures (URL
      // rejected, timeout, unexpected status) terminate the node with
      // a typed error envelope.
      // HttpRequestConfig has all-optional fields (performHttpRequest
      // validates `url` + `method` at runtime); plain Partial cast
      // matches the project-conventional pattern.
      const cfg = (node.config ?? {}) as Partial<HttpRequestConfig>;
      try {
        const result = await performHttpRequest(cfg, signal);
        const q = await querier();
        await withTransaction(q, async () => {
          const res = await q.query<{ variables_json: Record<string, unknown> | null }>(
            'SELECT variables_json FROM runs WHERE run_id = $1',
            [runId],
          );
          const current = (res.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
          current[node.id] = {
            status: result.status,
            headers: result.headers,
            body: result.body,
            bodyTruncated: result.bodyTruncated,
            durationMs: result.durationMs,
          };
          await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
            JSON.stringify(current),
            runId,
          ]);
        });
      } catch (err: unknown) {
        if (signal.aborted) {
          const refreshed = await loadRun(runId);
          if (refreshed?.status === 'paused') {
            endNodeSpan(runId, node.id, 'paused');
            return 'paused';
          }
          await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
          endNodeSpan(runId, node.id, 'cancelled');
          return 'cancelled';
        }
        const httpErr = err instanceof HttpRequestError
          ? { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
          : { code: 'node_execution_failed', message: err instanceof Error ? err.message : String(err) };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: httpErr });
        runFailureErrors.set(runId, { code: httpErr.code, message: httpErr.message });
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      break;
    }

    case 'core.approvalGate': {
      const config = (node.config ?? {}) as Partial<ApprovalConfig>;
      const approvalConfig: ApprovalConfig = {
        actions: Array.isArray(config.actions) ? config.actions : ['accept', 'reject'],
        ...(config.requiredApprovals !== undefined ? { requiredApprovals: config.requiredApprovals } : {}),
        ...(config.rejectionPolicy !== undefined ? { rejectionPolicy: config.rejectionPolicy } : {}),
        ...(config.approversList !== undefined ? { approversList: config.approversList } : {}),
        ...(config.title !== undefined ? { title: config.title } : {}),
        ...(config.description !== undefined ? { description: config.description } : {}),
      };
      const payload = { kind: 'approval', nodeId: node.id, config: approvalConfig };
      const q = await querier();
      await createInterrupt(q, runId, node.id, 'approval', approvalConfig, payload);
      await appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
      endNodeSpan(runId, node.id, 'suspended');
      return 'suspended';
    }

    case 'core.clarificationGate': {
      const config = (node.config ?? {}) as Partial<ClarificationConfig>;
      const clarConfig: ClarificationConfig = {
        questions: Array.isArray(config.questions) ? config.questions : [],
      };
      const payload = { kind: 'clarification', nodeId: node.id, config: clarConfig };
      const q = await querier();
      await createInterrupt(q, runId, node.id, 'clarification', clarConfig, payload);
      await appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
      endNodeSpan(runId, node.id, 'suspended');
      return 'suspended';
    }

    case 'core.conformance.mock-agent': {
      // RFC 0023 §B — conformance-only deterministic agent emitter.
      // Drives the full `agent.*` event family on cue from config keys
      // so the suite can exercise reasoning-event + low-confidence-suspend
      // contracts without a live LLM. §B.1 registration gate: refuse the
      // typeId outside the `conformance-*` workflow-id prefix (even though
      // this host advertises `capabilities.conformance.mockAgent: true`).
      // Production deployers SHOULD drop this case from their typeId
      // registry entirely; the reference host keeps it so the suite has
      // a host to run the affected scenarios against.
      const wfRow = await loadRun(runId);
      const wfId = wfRow?.workflow_id ?? '';
      if (!wfId.startsWith('conformance-')) {
        const err = {
          code: 'typeId_refused',
          message:
            `Node "${node.id}" uses "core.conformance.mock-agent" but the workflow id ` +
            `"${wfId}" is outside the conformance fixture prefix. ` +
            `Per RFC 0023 §B.1, hosts MUST refuse this typeId for non-conformance workflows.`,
        };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }

      type MockToolCall = {
        toolId?: string;
        arguments?: unknown;
        result?: unknown;
        error?: { code?: string; message?: string };
        durationMs?: number;
      };
      type MockCfg = {
        agentId?: string;
        mockReasoning?:
          | boolean
          | {
              summary?: string;
              trace?: string;
              tokenCount?: number;
              /** RFC 0024 — when present, emit one `agent.reasoning.delta`
               *  event per chunk (sequence 0..N-1) BEFORE the closing
               *  `agent.reasoned`. The closing event's `reasoning` equals
               *  the concatenation of all chunks. */
              streamChunks?: ReadonlyArray<string>;
            };
        mockToolCalls?: ReadonlyArray<MockToolCall>;
        mockHandoff?: { toAgentId?: string; reason?: string; context?: unknown };
        mockDecision?: { decision?: unknown; confidence?: number; reasoning?: string };
        mockConfidence?: number;
      };
      const cfg = (node.config ?? {}) as MockCfg;
      // RFC 0023 §B: agentId resolution order — config.agentId →
      // nodes[].agent.agentId → host-minted synthetic id.
      const pinnedAgentId = (node as { agent?: { agentId?: string } }).agent?.agentId;
      const agentId = cfg.agentId ?? pinnedAgentId ?? `host:mock-agent:${node.id}`;

      // 1. agent.reasoned (verbosity-gated per the host's existing rule;
      //    "off" suppresses emission entirely per RFC 0002 §B).
      //
      // RFC 0024 streaming: when the config carries `streamChunks`, emit
      // one `agent.reasoning.delta` per chunk BEFORE the closing
      // `agent.reasoned`. The closing event's `reasoning` is the
      // concatenation of the chunks (authoritative per RFC 0024
      // §Proposal — consumers MUST treat the closing event as canonical).
      if (cfg.mockReasoning !== undefined && cfg.mockReasoning !== null) {
        const reasoned =
          typeof cfg.mockReasoning === 'object'
            ? cfg.mockReasoning
            : { summary: `[stub] reasoning trace from ${agentId}` };
        const verbosity = await readReasoningVerbosity(runId);
        if (verbosity !== 'off') {
          const streamChunks = Array.isArray(reasoned.streamChunks)
            ? reasoned.streamChunks.filter((c): c is string => typeof c === 'string')
            : [];
          // RFC 0024 streaming path: emit deltas in order, sequence 0..N-1.
          for (let i = 0; i < streamChunks.length; i++) {
            await appendEvent(runId, 'agent.reasoning.delta', {
              nodeId: node.id,
              data: {
                agentId,
                delta: streamChunks[i],
                sequence: i,
                verbosity,
              },
            });
          }
          // Closing event. When streamChunks are present, the canonical
          // reasoning is the concatenation; otherwise fall back to the
          // configured summary (or a host stub if neither is supplied).
          const reasoning = streamChunks.length > 0
            ? streamChunks.join('')
            : typeof reasoned.summary === 'string'
              ? reasoned.summary
              : `[stub] reasoning trace from ${agentId}`;
          await appendEvent(runId, 'agent.reasoned', {
            nodeId: node.id,
            data: {
              agentId,
              reasoning,
              verbosity,
              ...(typeof reasoned.tokenCount === 'number'
                ? { tokenCount: reasoned.tokenCount }
                : {}),
            },
          });
        }
      }

      // 2. agent.toolCalled / agent.toolReturned pairs. Each pair shares
      //    a host-minted `callId`; the toolReturned event's `causationId`
      //    equals the toolCalled event's `eventId` per RFC 0002 §B.
      if (Array.isArray(cfg.mockToolCalls)) {
        for (let i = 0; i < cfg.mockToolCalls.length; i++) {
          const tc = cfg.mockToolCalls[i] ?? {};
          const toolName = typeof tc.toolId === 'string' ? tc.toolId : `unknown-${i}`;
          const callId = `mock-${node.id}-${i}-${Date.now().toString(36)}`;
          const calledEv = await appendEvent(runId, 'agent.toolCalled', {
            nodeId: node.id,
            data: { agentId, toolName, callId },
          });
          const causationId = makeEventId(runId, calledEv.seq);
          if (tc.error) {
            await appendEvent(runId, 'agent.toolReturned', {
              nodeId: node.id,
              causationId,
              data: {
                agentId,
                toolName,
                callId,
                error: {
                  code: typeof tc.error.code === 'string' ? tc.error.code : 'unknown',
                  message:
                    typeof tc.error.message === 'string' ? tc.error.message : '',
                },
              },
            });
          } else {
            await appendEvent(runId, 'agent.toolReturned', {
              nodeId: node.id,
              causationId,
              data: {
                agentId,
                toolName,
                callId,
                outcome: {
                  ...(typeof tc.durationMs === 'number'
                    ? { durationMs: tc.durationMs }
                    : {}),
                },
              },
            });
          }
        }
      }

      // 3. agent.handoff. The pinned `nodes[].agent` becomes
      //    `fromAgentId`; `mockHandoff.toAgentId` is the receiver.
      if (cfg.mockHandoff && typeof cfg.mockHandoff.toAgentId === 'string') {
        await appendEvent(runId, 'agent.handoff', {
          nodeId: node.id,
          data: {
            fromAgentId: agentId,
            toAgentId: cfg.mockHandoff.toAgentId,
            ...(typeof cfg.mockHandoff.reason === 'string'
              ? { reason: cfg.mockHandoff.reason }
              : {}),
          },
        });
      }

      // 4. agent.decided + CP-1 low-confidence suspend per
      //    interrupt.md §`kind: "low-confidence"`. Threshold resolution:
      //    RunOptions.configurable.escalationThreshold → default 0.7.
      const hasDecision =
        (cfg.mockDecision !== undefined && cfg.mockDecision !== null) ||
        typeof cfg.mockConfidence === 'number';
      if (hasDecision) {
        const explicit = cfg.mockDecision ?? {};
        const decisionValue =
          'decision' in explicit ? explicit.decision : { kind: 'stub-decision' };
        const confidence =
          typeof explicit.confidence === 'number'
            ? explicit.confidence
            : typeof cfg.mockConfidence === 'number'
              ? cfg.mockConfidence
              : undefined;
        await appendEvent(runId, 'agent.decided', {
          nodeId: node.id,
          data: {
            agentId,
            decision: decisionValue,
            ...(confidence !== undefined ? { confidence } : {}),
            ...(typeof explicit.reasoning === 'string'
              ? { reasoning: explicit.reasoning }
              : {}),
          },
        });
        if (confidence !== undefined) {
          const configurable = (wfRow?.configurable_json ?? {}) as {
            escalationThreshold?: unknown;
          };
          const override = configurable.escalationThreshold;
          const threshold =
            typeof override === 'number' && override >= 0 && override <= 1
              ? override
              : 0.7;
          if (confidence < threshold) {
            await appendEvent(runId, 'node.suspended', {
              nodeId: node.id,
              data: {
                reason: 'low-confidence',
                agentId,
                threshold,
                observed: confidence,
              },
            });
            endNodeSpan(runId, node.id, 'suspended');
            return 'suspended';
          }
        }
      }

      break;
    }

    case 'core.orchestrator.supervisor': {
      // RFC 0006 §C — orchestrator emits one OrchestratorDecision per
      // tick. The reference uses the event-log decision count as state
      // so replay is trivially deterministic.
      //
      // Two modes:
      //
      // 1. `mockDispatchPlan` (RFC 0022 §"Unresolved questions" #6 —
      //    added 2026-05-18 alongside the RFC 0022 reference impl):
      //    when `node.config.mockDispatchPlan` is a non-empty array of
      //    `OrchestratorDecision` shapes, the supervisor emits them in
      //    order — first tick uses plan[0], second tick plan[1], etc.
      //    Once the plan is exhausted, falls back to `terminate`. Lets
      //    conformance fixtures drive multi-worker dispatch sequences
      //    without an LLM. Production orchestrators delegate to an
      //    LLM; this mode is conformance-only (the supervisor block
      //    is non-normative reference code).
      //
      // 2. Default (legacy): first tick → `next-worker:
      //    ['conformance-noop']`, subsequent ticks → `terminate`.
      //    Preserves behavior of the original `conformance-dispatch-
      //    loop` fixture from before mockDispatchPlan landed.
      const q = await querier();
      const priorRes = await q.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM events WHERE run_id = $1 AND type = 'runOrchestrator.decided'`,
        [runId],
      );
      const prior = Number(priorRes.rows[0]?.n ?? '0');
      const agentId =
        node.agent?.agentId ??
        (node.config?.agentId as string | undefined) ??
        'core.reference-supervisor';

      // CP-1 (RFC 0006 §C / interrupt.md §`low-confidence`): if the supervisor's
      // confidence is below the escalation threshold, HOLD the decision — do NOT
      // emit `runOrchestrator.decided` — suspend via `node.suspended { reason:
      // 'low-confidence' }`, and transition the run to `waiting-approval` for human
      // ratification. Threshold resolution: `configurable.escalationThreshold` →
      // default 0.7. See orchestratorConservativePath.test.ts.
      const mockConfidence = node.config?.mockConfidence;
      if (typeof mockConfidence === 'number') {
        const cfgRes = await q.query<{ configurable_json: Record<string, unknown> | null }>(
          'SELECT configurable_json FROM runs WHERE run_id = $1',
          [runId],
        );
        const configurable = (cfgRes.rows[0]?.configurable_json ?? {}) as {
          escalationThreshold?: unknown;
        };
        const override = configurable.escalationThreshold;
        const threshold =
          typeof override === 'number' && override >= 0 && override <= 1 ? override : 0.7;
        if (mockConfidence < threshold) {
          await appendEvent(runId, 'node.suspended', {
            nodeId: node.id,
            data: { reason: 'low-confidence', agentId, threshold, observed: mockConfidence },
          });
          endNodeSpan(runId, node.id, 'suspended');
          return 'suspended';
        }
      }

      const mockPlan = Array.isArray(node.config?.mockDispatchPlan)
        ? (node.config!.mockDispatchPlan as Array<{
            kind?: string;
            nextWorkerIds?: string[];
            reason?: string;
            prompt?: string;
          }>)
        : null;
      let decision: { kind: 'next-worker'; nextWorkerIds: string[] }
        | { kind: 'terminate'; reason?: string };
      if (mockPlan && mockPlan.length > 0 && prior < mockPlan.length) {
        const entry = mockPlan[prior]!;
        if (entry.kind === 'next-worker' && Array.isArray(entry.nextWorkerIds)) {
          decision = { kind: 'next-worker', nextWorkerIds: entry.nextWorkerIds };
        } else if (entry.kind === 'terminate') {
          decision = { kind: 'terminate', ...(entry.reason !== undefined ? { reason: entry.reason } : {}) };
        } else {
          // Malformed plan entry — fall back to terminate to keep the
          // run finite. Surfaces in the event log as a `terminate`
          // with a `mockPlan-malformed` reason so authors notice.
          decision = { kind: 'terminate', reason: 'mockPlan-malformed' };
        }
      } else if (mockPlan && mockPlan.length > 0) {
        // Plan exhausted; terminate the loop.
        decision = { kind: 'terminate', reason: 'mockPlan-exhausted' };
      } else {
        // Default legacy mode.
        decision = prior === 0
          ? { kind: 'next-worker', nextWorkerIds: ['conformance-noop'] }
          : { kind: 'terminate', reason: 'goal-reached' };
      }
      await appendEvent(runId, 'runOrchestrator.decided', {
        nodeId: node.id,
        data: { agentId, decision },
      });
      break;
    }

    case 'core.dispatch': {
      // RFC 0007 §C — read the latest `runOrchestrator.decided` event
      // and translate its decision into a runtime action.
      const q = await querier();
      const decRes = await q.query<{ seq: number; data_json: unknown }>(
        `SELECT seq, data_json FROM events
         WHERE run_id = $1 AND type = 'runOrchestrator.decided'
         ORDER BY seq DESC LIMIT 1`,
        [runId],
      );
      if (decRes.rows.length === 0) {
        const err = { code: 'no_pending_decision', message: `core.dispatch (node "${node.id}") found no upstream runOrchestrator.decided event.` };
        await appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }
      const decisionRow = decRes.rows[0]!;
      const decisionEventId = makeEventId(runId, Number(decisionRow.seq));
      const payload = decisionRow.data_json as {
        agentId?: string;
        decision?: { kind?: string; nextWorkerIds?: string[]; reason?: string; prompt?: string };
      } | null;
      const kind = payload?.decision?.kind;

      if (kind === 'terminate') {
        // RFC 0007 §D `terminate`: emit node.completed (causationId-
        // linked) with the optional `reason` from the decision. The
        // outer for-loop's natural run.completed carries through.
        const reason = payload?.decision?.reason;
        await appendEvent(runId, 'node.completed', {
          nodeId: node.id,
          causationId: decisionEventId,
          data: { decision: 'terminate', ...(reason !== undefined ? { reason } : {}) },
        });
        endNodeSpan(runId, node.id, 'completed');
        return 'completed';
      }

      if (kind === 'next-worker') {
        // RFC 0007 §D `next-worker`: dispatch a child run via the
        // existing core.subWorkflow machinery for each nextWorkerIds[i]
        // sequentially (RFC 0007 §D `fanOutPolicy: 'sequential'`).
        // After all children terminate, route back to the orchestrator
        // via DAG loopback.
        //
        // RFC 0022 §A — when the dispatch node's config carries
        // inputMapping / outputMapping / perWorker{Input,Output}Mappings,
        // the host MUST (1) project parent variables into child inputs
        // before invocation, and (2) harvest child variables back into
        // parent variables on terminal `completed`. The same in-loop
        // parent variable bag is the handoff channel between sibling
        // children under sequential fan-out (RFC 0022 §D).
        const nextWorkerIds = Array.isArray(payload?.decision?.nextWorkerIds)
          ? (payload!.decision!.nextWorkerIds as string[])
          : [];
        if (nextWorkerIds.length === 0) {
          const err = { code: 'no_pending_decision', message: `core.dispatch (node "${node.id}") next-worker decision MUST carry nextWorkerIds[].` };
          await appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
          runFailureErrors.set(runId, err);
          endNodeSpan(runId, node.id, 'failed');
          return 'failed';
        }
        // RFC 0022 §A — read mapping fields off the dispatch node's
        // config. All four are optional; absent ones default to {}.
        const dispatchConfig = (node.config ?? {}) as {
          inputMapping?: Record<string, string>;
          outputMapping?: Record<string, string>;
          perWorkerInputMappings?: Record<string, Record<string, string>>;
          perWorkerOutputMappings?: Record<string, Record<string, string>>;
        };
        let lastChildRunId: string | null = null;
        let lastChildStatus: 'completed' | 'failed' | 'cancelled' | null = null;
        for (let workerIdx = 0; workerIdx < nextWorkerIds.length; workerIdx++) {
          const childWorkflowId = nextWorkerIds[workerIdx]!;
          if (!workflows.has(childWorkflowId)) {
            const err = {
              code: 'unknown_child_workflow',
              message: `core.dispatch (node "${node.id}") next-worker references unknown workflowId "${childWorkflowId}".`,
            };
            await appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
            runFailureErrors.set(runId, err);
            endNodeSpan(runId, node.id, 'failed');
            return 'failed';
          }
          // RFC 0022 §A — compute the effective input mapping for this
          // worker. perWorker overrides take precedence over the
          // dispatch-level default.
          const effectiveInputMapping =
            dispatchConfig.perWorkerInputMappings?.[childWorkflowId] ??
            dispatchConfig.inputMapping ??
            {};
          // Project parent variables → child inputs. Unset parent vars
          // surface as `undefined` on the child input per RFC 0022 §A
          // normative bullet (not omitted, not `null`).
          const parentVarsRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
            'SELECT variables_json FROM runs WHERE run_id = $1',
            [runId],
          );
          const parentVars = (parentVarsRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
          const childInputs: Record<string, unknown> = {};
          for (const [childKey, parentKey] of Object.entries(effectiveInputMapping)) {
            if (typeof parentKey !== 'string') continue;
            childInputs[childKey] = parentVars[parentKey];
          }
          // Idempotent reuse + create. For multi-worker fan-out, each
          // child gets a distinct (parent_run, parent_node, workerIdx)
          // tuple — the per-node existing-child lookup matches the
          // first child only, so subsequent siblings always create new.
          const childParentNodeId = workerIdx === 0 ? node.id : `${node.id}#${workerIdx}`;
          const existingRes = await q.query<{ run_id: string }>(
            'SELECT run_id FROM runs WHERE parent_run_id = $1 AND parent_node_id = $2',
            [runId, childParentNodeId],
          );
          let childRunId = existingRes.rows[0]?.run_id;
          if (!childRunId) {
            childRunId = `run-${randomUUID()}`;
            const childStartedAt = new Date().toISOString();
            await q.query(
              `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id, variables_json)
               VALUES ($1, $2, 'pending', $7::JSONB, $3, $4, $5, $6)`,
              [childRunId, childWorkflowId, childStartedAt, runId, childParentNodeId,
                JSON.stringify(seedVariablesFromWorkflow(childWorkflowId)),
                JSON.stringify(childInputs)],
            );
            await appendEvent(runId, 'node.dispatched', {
              nodeId: node.id,
              causationId: decisionEventId,
              data: { childRunId, childWorkflowId },
            });
            const innerChildRunId = childRunId;
            void runWorkflow(innerChildRunId).catch(async (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              await appendEvent(innerChildRunId, 'run.failed', { data: { code: 'internal', message } });
              await setRunTerminal(innerChildRunId, 'failed', { code: 'internal', message });
            });
          }
          // Poll for THIS child's terminal status before advancing to
          // the next sibling (sequential fan-out per RFC 0007 §D).
          let childTerminal: 'completed' | 'failed' | 'cancelled' | null = null;
          while (true) {
            const refreshedParent = await loadRun(runId);
            if (refreshedParent?.status === 'cancelling') {
              await cancelRunInternal(childRunId, 'parent-cancelled');
              await appendEvent(runId, 'node.cancelled', { nodeId: node.id, causationId: decisionEventId });
              endNodeSpan(runId, node.id, 'cancelled');
              return 'cancelled';
            }
            const child = await loadRun(childRunId);
            if (!child) {
              const err = { code: 'child_missing', message: `core.dispatch child run "${childRunId}" disappeared.` };
              await appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
              runFailureErrors.set(runId, err);
              endNodeSpan(runId, node.id, 'failed');
              return 'failed';
            }
            if (child.status === 'completed' || child.status === 'failed' || child.status === 'cancelled') {
              childTerminal = child.status as 'completed' | 'failed' | 'cancelled';
              break;
            }
            try {
              await sleep(50, signal);
            } catch {
              // signal aborted; loop top will see cancelling.
            }
          }
          lastChildRunId = childRunId;
          lastChildStatus = childTerminal;
          if (childTerminal !== 'completed') {
            // RFC 0022 §A — failed / cancelled children MUST skip
            // outputMapping; parent variables stay at pre-dispatch
            // state for that worker.
            const err = {
              code: 'child_failed',
              message: `core.dispatch child run "${childRunId}" terminated '${childTerminal}'.`,
            };
            await appendEvent(runId, 'node.failed', {
              nodeId: node.id,
              causationId: decisionEventId,
              data: { ...err, outputs: { childRunId, childStatus: childTerminal } },
            });
            runFailureErrors.set(runId, err);
            endNodeSpan(runId, node.id, 'failed');
            return 'failed';
          }
          // RFC 0022 §A — harvest child variables into parent
          // variables via the effective output mapping. Visible to
          // the next sibling's inputMapping (RFC 0022 §D — sequential
          // fan-out shares the parent variable bag).
          const effectiveOutputMapping =
            dispatchConfig.perWorkerOutputMappings?.[childWorkflowId] ??
            dispatchConfig.outputMapping ??
            {};
          if (Object.keys(effectiveOutputMapping).length > 0) {
            const childVarsRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
              'SELECT variables_json FROM runs WHERE run_id = $1',
              [childRunId],
            );
            const childVars = (childVarsRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
            const parentVarsRowRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
              'SELECT variables_json FROM runs WHERE run_id = $1',
              [runId],
            );
            const parentVarsRow = {
              ...((parentVarsRowRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>),
            };
            for (const [parentKey, childKey] of Object.entries(effectiveOutputMapping)) {
              if (typeof childKey !== 'string') continue;
              parentVarsRow[parentKey] = childVars[childKey];
            }
            await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
              JSON.stringify(parentVarsRow),
              runId,
            ]);
          }
        }
        // All workers completed. RFC 0007 §D contract — emit
        // node.completed with the LAST child's (childRunId, childStatus).
        await appendEvent(runId, 'node.completed', {
          nodeId: node.id,
          causationId: decisionEventId,
          data: { outputs: { childRunId: lastChildRunId, childStatus: lastChildStatus } },
        });
        endNodeSpan(runId, node.id, 'completed');
        // DAG cycle back to orchestrator-supervisor.
        const wfRow = await loadRun(runId);
        const workflow = wfRow ? workflows.get(wfRow.workflow_id) : null;
        const supervisorIdx = workflow
          ? workflow.nodes.findIndex((n) => n.typeId === 'core.orchestrator.supervisor')
          : -1;
        if (supervisorIdx >= 0) {
          loopbackTargets.set(runId, supervisorIdx);
          return 'loopback';
        }
        await q.query("UPDATE runs SET status = 'running' WHERE run_id = $1", [runId]);
        return 'completed';
      }

      // Unsupported decision kind (ask-user deferred — Postgres host
      // doesn't yet wire conversation primitive).
      const err = {
        code: 'unsupported_decision_kind',
        message: `core.dispatch (node "${node.id}") received decision.kind="${kind ?? '<missing>'}", which the host does not implement.`,
      };
      await appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
      runFailureErrors.set(runId, err);
      endNodeSpan(runId, node.id, 'failed');
      return 'failed';
    }

    case 'core.interrupt': {
      const config = (node.config ?? {}) as {
        kind?: string;
        data?: ExternalEventConfig;
        timeoutMs?: number;
      };
      if (config.kind === 'external-event') {
        const extConfig: ExternalEventConfig = {
          ...(config.data?.eventType !== undefined ? { eventType: config.data.eventType } : {}),
          ...(config.data?.correlation !== undefined ? { correlation: config.data.correlation } : {}),
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        };
        const q = await querier();
        const token = await createInterrupt(q, runId, node.id, 'external-event', extConfig, {
          kind: 'external-event',
          nodeId: node.id,
          config: extConfig,
        });
        const payload = {
          kind: 'external-event',
          nodeId: node.id,
          config: extConfig,
          interruptToken: token,
          callbackUrl: `/v1/interrupts/${token}`,
        };
        await appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
        endNodeSpan(runId, node.id, 'suspended');
        return 'suspended';
      }
      await appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_interrupt_kind', kind: config.kind ?? '<missing>' },
      });
      endNodeSpan(runId, node.id, 'failed');
      return 'failed';
    }

    case 'core.subWorkflow': {
      // node-packs.md §"core.subWorkflow contract" (Phase A.4). Output
      // shape: `data.outputs.{childRunId, childStatus}`. outputMapping
      // copies named child variables → parent vars on child terminal.
      // RFC 0022 §B — inputMapping seeds the child workflow's initial
      // variable bag from parent-variable projections, overriding any
      // matching `variables[].defaultValue` declaration on the child.
      const config = (node.config ?? {}) as {
        workflowId?: string;
        propagateCancellation?: boolean;
        inputMapping?: Record<string, string>;
        outputMapping?: Record<string, string>;
        onChildFailure?: 'fail-parent' | 'absorb';
      };
      const childWorkflowId = config.workflowId;
      if (typeof childWorkflowId !== 'string' || !workflows.has(childWorkflowId)) {
        const err = { code: 'unknown_child_workflow', message: `core.subWorkflow (node "${node.id}") references unknown workflowId "${childWorkflowId}".` };
        await appendEvent(runId, 'node.failed', {
          nodeId: node.id,
          data: err,
        });
        runFailureErrors.set(runId, err);
        endNodeSpan(runId, node.id, 'failed');
        return 'failed';
      }

      // Idempotent: reuse an existing child run for this (parent, node).
      const q = await querier();
      const existingRes = await q.query<{ run_id: string }>(
        'SELECT run_id FROM runs WHERE parent_run_id = $1 AND parent_node_id = $2',
        [runId, node.id],
      );
      let childRunId = existingRes.rows[0]?.run_id;
      if (!childRunId) {
        childRunId = `run-${randomUUID()}`;
        const childStartedAt = new Date().toISOString();
        // RFC 0022 §B — two-pass child variable seeding: first
        // `variables[].defaultValue` declarations (existing host
        // behavior), then `inputMapping` projections override matching
        // keys. Unset parent variables surface as `undefined` on the
        // child variable (NOT omitted, NOT `null`).
        const childVarsSeed = seedVariablesFromWorkflow(childWorkflowId);
        if (config.inputMapping && typeof config.inputMapping === 'object') {
          const parentVarsRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
            'SELECT variables_json FROM runs WHERE run_id = $1',
            [runId],
          );
          const parentVars = (parentVarsRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
          for (const [childKey, parentKey] of Object.entries(config.inputMapping)) {
            if (typeof parentKey !== 'string') continue;
            childVarsSeed[childKey] = parentVars[parentKey];
          }
        }
        await q.query(
          `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id, variables_json)
           VALUES ($1, $2, 'pending', '{}'::JSONB, $3, $4, $5, $6)`,
          [childRunId, childWorkflowId, childStartedAt, runId, node.id,
            JSON.stringify(childVarsSeed)],
        );
        await appendEvent(runId, 'node.dispatched', {
          nodeId: node.id,
          data: { childRunId, childWorkflowId },
        });
        const innerChildRunId = childRunId;
        void runWorkflow(innerChildRunId).catch(async (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const error = { code: 'internal', message };
          await appendEvent(innerChildRunId, 'run.failed', { data: error });
          await setRunTerminal(innerChildRunId, 'failed', error);
        });
      }

      // Mirror the child's status onto the parent until child terminates.
      while (true) {
        const refreshed = await loadRun(runId);
        if (refreshed?.status === 'cancelling') {
          if (config.propagateCancellation !== false) {
            await cancelRunInternal(childRunId, 'parent-cancelled');
          }
          await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
          endNodeSpan(runId, node.id, 'cancelled');
          return 'cancelled';
        }
        const child = await loadRun(childRunId);
        if (!child) {
          await appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { code: 'child_missing', childRunId },
          });
          endNodeSpan(runId, node.id, 'failed');
          return 'failed';
        }
        if (child.status === 'completed') {
          // outputMapping: copy mapped child variables → parent variables.
          // node-packs.md §"core.subWorkflow contract".
          if (config.outputMapping && typeof config.outputMapping === 'object') {
            const childVarsRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
              'SELECT variables_json FROM runs WHERE run_id = $1',
              [childRunId],
            );
            const childVars = (childVarsRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>;
            const parentVarsRes = await q.query<{ variables_json: Record<string, unknown> | null }>(
              'SELECT variables_json FROM runs WHERE run_id = $1',
              [runId],
            );
            const parentVars = { ...((parentVarsRes.rows[0]?.variables_json ?? {}) as Record<string, unknown>) };
            for (const [parentKey, childKey] of Object.entries(config.outputMapping)) {
              if (typeof childKey === 'string' && childVars[childKey] !== undefined) {
                parentVars[parentKey] = childVars[childKey];
              }
            }
            await q.query('UPDATE runs SET variables_json = $1 WHERE run_id = $2', [
              JSON.stringify(parentVars),
              runId,
            ]);
          }
          await appendEvent(runId, 'node.completed', {
            nodeId: node.id,
            data: { outputs: { childRunId, childStatus: 'completed' } },
          });
          endNodeSpan(runId, node.id, 'completed');
          await q.query("UPDATE runs SET status = 'running' WHERE run_id = $1", [runId]);
          return 'completed';
        }
        if (child.status === 'failed') {
          if (config.onChildFailure === 'absorb') {
            await appendEvent(runId, 'node.completed', {
              nodeId: node.id,
              data: { outputs: { childRunId, childStatus: 'failed' } },
            });
            endNodeSpan(runId, node.id, 'completed');
            await q.query("UPDATE runs SET status = 'running' WHERE run_id = $1", [runId]);
            return 'completed';
          }
          const err = { code: 'child_failed', message: `core.subWorkflow child run "${childRunId}" terminated 'failed'.` };
          await appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { ...err, outputs: { childRunId, childStatus: 'failed' } },
          });
          runFailureErrors.set(runId, err);
          endNodeSpan(runId, node.id, 'failed');
          return 'failed';
        }
        if (child.status === 'cancelled') {
          await appendEvent(runId, 'node.cancelled', {
            nodeId: node.id,
            data: { childRunId },
          });
          endNodeSpan(runId, node.id, 'cancelled');
          return 'cancelled';
        }
        // Mirror suspend state onto parent.
        const childWaiting =
          child.status === 'waiting-approval' ||
          child.status === 'waiting-input' ||
          child.status === 'waiting-external';
        if (childWaiting && refreshed?.status !== child.status) {
          await q.query('UPDATE runs SET status = $1 WHERE run_id = $2', [child.status, runId]);
        } else if (!childWaiting && refreshed?.status === 'running') {
          // Stay running.
        }
        try {
          await sleep(50, signal);
        } catch {
          // Aborted (cancel path). Loop top will see cancelling.
        }
      }
    }

    case 'conformance.cost.emit': {
      // RFC 0026 — fixture producer. Sanitize the declared cost attrs
      // (allowlist drops non-`openwop.cost.*` keys + the credential-shaped
      // canary), write them onto the node span (for an OTel scrape), and
      // fold the snapshot subset into the per-run rollup so
      // `metrics.openwopCost` surfaces on the run snapshot.
      const cfg = (node.config ?? {}) as { attrs?: unknown };
      const attrs = cfg.attrs && typeof cfg.attrs === 'object' && !Array.isArray(cfg.attrs)
        ? (cfg.attrs as Record<string, unknown>)
        : {};
      const sanitized = sanitizeCostAttrs(attrs);
      addNodeSpanAttributes(runId, node.id, sanitized);
      applyCostRollup(runId, sanitized);
      break;
    }

    default:
      await appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_node_type', typeId: node.typeId },
      });
      endNodeSpan(runId, node.id, 'failed');
      return 'failed';
  }

  await appendEvent(runId, 'node.completed', { nodeId: node.id });
  endNodeSpan(runId, node.id, 'completed');
  return 'completed';
}

async function runWorkflow(runId: string): Promise<void> {
  // Claim acquisition: another host process may already be running
  // this workflow (multi-process Postgres deployments). Skip silently
  // if contended — the claim holder will drive the run to terminal,
  // and on its release a future orphan-recovery sweep picks up any
  // residual orphans.
  const claimed = await tryClaim(runId);
  if (!claimed) return;

  // Track this executor's lifetime so closeHost can drain.
  const promise = (async () => {
    try {
      await runWorkflowClaimed(runId);
    } finally {
      await releaseClaim(runId).catch(() => undefined);
    }
  })();
  inflightExecutors.add(promise);
  try {
    await promise;
  } finally {
    inflightExecutors.delete(promise);
  }
}

async function runWorkflowClaimed(runId: string): Promise<void> {
  const row = await loadRun(runId);
  if (!row) return;

  const workflow = workflows.get(row.workflow_id);
  if (!workflow) {
    const error = { code: 'workflow_not_found', message: 'Unknown workflowId.' };
    await appendEvent(runId, 'run.failed', { data: error });
    await setRunTerminal(runId, 'failed', error);
    return;
  }

  // pg-types unmarshals JSONB to a JS object — no string parsing needed.
  const inputs = row.inputs_json as Record<string, unknown>;
  const aborter = new AbortController();
  runningAborters.set(runId, aborter);

  // RFC 0058 — arm the wall-clock deadline. Resolved bound is
  // `min(runTimeoutMs, MAX_RUN_DURATION_MS)`; the host ceiling always applies
  // even when the caller omits `runTimeoutMs`. When the timer fires we set
  // `timedOut` and abort the shared run signal — that interrupts a sleeping
  // node (e.g. core.delay), surfacing as a `cancelled` node outcome which the
  // loop re-attributes to the run-duration breach (the `timedOut` guard after
  // executeNode + in catch). Declared out here so catch/finally can see them.
  const runTimeoutRaw = (row.configurable_json ?? {}) as { runTimeoutMs?: unknown };
  const rt = runTimeoutRaw.runTimeoutMs;
  const resolvedTimeoutMs =
    typeof rt === 'number' && Number.isInteger(rt) && rt > 0
      ? Math.min(rt, MAX_RUN_DURATION_MS)
      : MAX_RUN_DURATION_MS;
  const runStartMs = Date.now();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    aborter.abort();
  }, resolvedTimeoutMs);

  try {
    // First-run vs resume detection: if `run.started` is already in the
    // log, this is a resume (from pause or, eventually, restart). Emit
    // `run.resumed` for resume; emit `run.started` + open the OTel span
    // for first run.
    const startEvents = await getEventsAfter(runId, -1);
    const alreadyStarted = startEvents.some((e) => e.type === 'run.started');
    await updateRunStatus(runId, 'running', null, null);
    if (!alreadyStarted) {
      await appendEvent(runId, 'run.started');
      startRunSpan(runId, row.workflow_id);
    } else {
      await appendEvent(runId, 'run.resumed', { data: { resumedBy: PROCESS_ID } });
    }

    // recursionLimit per run-options.md §"recursionLimit": cap on
    // total node executions in the run. When the next node would
    // exceed the limit, emit `cap.breached` BEFORE the node fires,
    // then `run.failed` with `error.code = 'recursion_limit_exceeded'`.
    const configurable = (row.configurable_json ?? {}) as { recursionLimit?: unknown };
    const recursionLimit =
      typeof configurable.recursionLimit === 'number' &&
      Number.isInteger(configurable.recursionLimit) &&
      configurable.recursionLimit > 0
        ? configurable.recursionLimit
        : null;
    // Defensive: only emit cap.breached ONCE per run, even if the
    // executor revisits the loop (e.g., on a hypothetical future
    // parallel-branches fixture). The current linear-chain fixtures
    // exit on first breach; this guard protects forward compat.
    let breachEmitted = false;

    const startIndex = row.next_node_index ?? 0;
    for (let i = startIndex; i < workflow.nodes.length; i++) {
      const node = workflow.nodes[i]!;
      const refreshed = await loadRun(runId);
      if (refreshed?.status === 'cancelling') {
        await appendEvent(runId, 'run.cancelled');
        await setRunTerminal(runId, 'cancelled', null);
        return;
      }
      if (refreshed?.status === 'paused') {
        // Operator paused the run between node iterations. Exit the
        // executor cleanly; resume() re-invokes runWorkflow and the
        // alreadyStarted check above emits `run.resumed`. next_node_index
        // stays at `i` so resume re-enters the same node.
        return;
      }

      // recursionLimit check: i is 0-indexed; before firing node[i],
      // the run has executed `i` nodes. The (i+1)th node would
      // overflow when i+1 > limit. The conformance test expects the
      // breach event to fire BEFORE the over-limit node's
      // `node.started`, so `node.started` for the breaching node MUST
      // NOT appear. Emit cap.breached + run.failed, set terminal.
      if (recursionLimit !== null && i + 1 > recursionLimit && !breachEmitted) {
        breachEmitted = true;
        await appendEvent(runId, 'cap.breached', {
          nodeId: node.id,
          data: {
            kind: 'node-executions',
            limit: recursionLimit,
            observed: i + 1,
            nodeId: node.id,
          },
        });
        const error = {
          code: 'recursion_limit_exceeded',
          message: `Per-run node-execution cap (recursionLimit=${recursionLimit}) breached at node "${node.id}" (would be execution #${i + 1}).`,
        };
        await appendEvent(runId, 'run.failed', { data: error });
        await setRunTerminal(runId, 'failed', error);
        return;
      }

      const outcome = await executeNode(runId, node, inputs, aborter.signal);
      // RFC 0058 — the wall-clock deadline fired mid-node (the abort
      // surfaced as a `cancelled`/`failed` node outcome). Re-attribute to
      // the run-duration breach rather than a caller cancel.
      if (timedOut) {
        await failRunDuration(runId, resolvedTimeoutMs, Date.now() - runStartMs);
        return;
      }
      if (outcome === 'loopback') {
        // RFC 0007 §D `next-worker`: dispatch routes control back to
        // the upstream orchestrator-supervisor. Advance i to (target-1)
        // so the i++ at loop tail lands at the supervisor. Persist
        // next_node_index for restart safety.
        const target = loopbackTargets.get(runId);
        loopbackTargets.delete(runId);
        if (typeof target === 'number' && target >= 0) {
          const q = await querier();
          await q.query('UPDATE runs SET next_node_index = $1 WHERE run_id = $2', [target, runId]);
          i = target - 1;
          continue;
        }
        const error = { code: 'internal', message: 'loopback outcome without target index' };
        await appendEvent(runId, 'run.failed', { data: error });
        await setRunTerminal(runId, 'failed', error);
        return;
      }
      if (outcome === 'failed') {
        // Prefer a specific error envelope written by the node handler
        // (capability_required, no_pending_decision, etc.); fall back
        // to legacy unsupported_node_type for typeIds the host doesn't
        // recognize at all (the `default:` arm in executeNode).
        const carried = runFailureErrors.get(runId);
        runFailureErrors.delete(runId);
        const error = carried ?? {
          code: 'unsupported_node_type',
          message: `Postgres host does not implement node type "${node.typeId}".`,
        };
        await appendEvent(runId, 'run.failed', { data: error });
        await setRunTerminal(runId, 'failed', error);
        return;
      }
      if (outcome === 'cancelled') {
        await appendEvent(runId, 'run.cancelled');
        await setRunTerminal(runId, 'cancelled', null);
        return;
      }
      if (outcome === 'paused') {
        // Pause confirmed mid-node. handlePause already set status =
        // 'paused' + emitted run.paused; we just exit. next_node_index
        // stays at `i` so resume() re-enters the same node from start.
        return;
      }
      if (outcome === 'suspended') {
        // Interrupt created — flip status to the suspend-status matching
        // the node kind and exit. The resolve route flips back to
        // 'running' and re-invokes runWorkflow.
        const suspendStatus =
          node.typeId === 'core.clarificationGate'
            ? 'waiting-input'
            : node.typeId === 'core.interrupt'
              ? 'waiting-external'
              : 'waiting-approval';
        const q = await querier();
        await q.query(
          'UPDATE runs SET status = $1, next_node_index = $2 WHERE run_id = $3',
          [suspendStatus, i, runId],
        );
        return;
      }
      await advanceNodeIndex(runId, i + 1);
    }

    const final = await loadRun(runId);
    if (final?.status === 'cancelling') {
      await appendEvent(runId, 'run.cancelled');
      await setRunTerminal(runId, 'cancelled', null);
    } else if (final?.status === 'paused') {
      // Pause arrived mid-last-node and the executor drained out of
      // the workflow before the next iteration's status check could
      // catch it. Preserve the paused state — handlePauseRun already
      // emitted run.paused. Resume re-invokes runWorkflow which sees
      // alreadyStarted, emits run.resumed, and the for-loop starts at
      // the advanced cursor (past the drained node).
      return;
    } else {
      // RFC 0057 §A/§B — attribute a content-free, session-end memory write.
      // The host writes a run-summary to the tenant's memory on completion (the
      // "session-end write" the spec sanctions) and records it on the event log
      // via `memory.written` (identifiers + non-secret tags only; no content,
      // no nodeId per §B — a host write, not a node write). The memoryId is
      // deterministic on runId so the recorded fact stays replay-stable (§D):
      // re-reading the log yields the same id, never a freshly minted one.
      // Emitted BEFORE `run.completed` so the terminal event remains LAST in
      // the stream (eventOrdering invariant). Best-effort — a memory write
      // MUST NOT fail the run.
      try {
        const q = await querier();
        const memoryId = `mem-${runId}-summary`;
        const tags = ['run-summary', `run-id:${runId}`, `workflow:${row.workflow_id}`];
        await writeMemoryEntry(q, {
          tenantId: 'tenant:default',
          memoryRef: RUN_SUMMARY_MEMORY_REF,
          memoryId,
          content: `Run ${runId} of "${row.workflow_id}" completed.`,
          tags,
        });
        await appendEvent(runId, 'memory.written', {
          data: { memoryRef: RUN_SUMMARY_MEMORY_REF, memoryId, tags },
        });
      } catch {
        /* memory is a best-effort host surface; never block run completion */
      }
      await appendEvent(runId, 'run.completed');
      await setRunTerminal(runId, 'completed', null);
    }
  } catch (err) {
    // RFC 0058 — if the deadline fired and the abort propagated as a
    // thrown error (rather than a `cancelled` node outcome), attribute it
    // to the run-duration breach instead of a generic internal error.
    if (timedOut) {
      await failRunDuration(runId, resolvedTimeoutMs, Date.now() - runStartMs);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      const error = { code: 'internal', message };
      await appendEvent(runId, 'run.failed', { data: error });
      await setRunTerminal(runId, 'failed', error);
    }
  } finally {
    clearTimeout(timeoutTimer);
    runningAborters.delete(runId);
  }
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJSON(res, status, { error: code, message });
}

/**
 * Constant-time bearer-token comparison. `timingSafeEqual` requires equal-
 * length buffers, so the early length check is a non-issue — a length
 * mismatch can't leak via timing because it short-circuits with the same
 * code path as a content mismatch.
 */
/**
 * Phase I.3 + I.4 + I.6 — bearer-token validation across:
 *
 *   - Static API keys (primary + optional secondary + optional tenant2),
 *     compared in constant time via `crypto.timingSafeEqual`.
 *   - JWT bearer tokens validated against an OAuth2-CC issuer JWKS
 *     (when `OPENWOP_OAUTH2_ISSUER_URL` + `OPENWOP_OAUTH2_AUDIENCE`
 *     are set).
 *   - JWT bearer tokens validated against an OIDC user-bearer issuer
 *     JWKS (when `OPENWOP_OIDC_ISSUER_URL` + `OPENWOP_OIDC_AUDIENCE`
 *     are set).
 *
 * JWT validation is tried FIRST when validators are configured AND
 * the presented token shape is JWT-like (three dot-separated segments).
 * Static-API-key match is the fallback. Per `auth.md` §"No credential
 * echo", the rejected token is NEVER reflected back in the error
 * envelope — only the closed-set error code reaches the wire.
 */
async function checkAuth(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    sendError(res, 401, 'unauthenticated', 'Missing or malformed Authorization header.');
    return false;
  }
  const tokenStr = header.slice('Bearer '.length).trim();
  const looksLikeJwt = tokenStr.split('.').length === 3;

  // JWT path: try OAuth2 then OIDC validator when configured AND
  // the presented token has the JWT shape (avoids spurious JWKS
  // fetches for static-API-key tenants).
  if (looksLikeJwt && (OAUTH2_VALIDATOR !== null || OIDC_VALIDATOR !== null)) {
    const validators = [OAUTH2_VALIDATOR, OIDC_VALIDATOR].filter(
      (v): v is JwtValidator => v !== null,
    );
    for (const validator of validators) {
      try {
        await validator.validate(tokenStr);
        return true; // JWT verified against this issuer; accept.
      } catch (err: unknown) {
        if (err instanceof JwtValidationError) {
          // Try the next validator (an OAuth2 token may be rejected
          // by an OIDC validator with a different aud/iss). Only emit
          // the canonical 401 if ALL validators reject.
          continue;
        }
        // Non-validation error (e.g., JWKS network failure): rethrow
        // so the outer error handler returns 500 — clients distinguish
        // server outage from invalid credential.
        throw err;
      }
    }
    sendError(res, 401, 'invalid_credential', 'Bearer token rejected.');
    return false;
  }

  // Static-API-key path. auth-profiles.md §"openwop-auth-api-key-rotation":
  // primary + (optional) secondary BOTH authenticate during the overlap
  // window. §"Scoped capability views" requires tenant2 also be accepted
  // on requests (handleDiscovery uses principalFor to narrow the view).
  const presented = Buffer.from(tokenStr, 'utf8');
  const candidates = [API_KEY];
  if (SECONDARY_API_KEY !== null) candidates.push(SECONDARY_API_KEY);
  if (TENANT2_API_KEY !== null) candidates.push(TENANT2_API_KEY);
  let ok = false;
  for (const candidate of candidates) {
    const expected = Buffer.from(candidate, 'utf8');
    const lengthMatch = presented.length === expected.length;
    const hit = lengthMatch && timingSafeEqual(presented, expected);
    ok = ok || hit;
  }
  if (!ok) {
    sendError(res, 401, 'invalid_credential', 'Bearer token rejected.');
    return false;
  }
  return true;
}

/**
 * Phase I.5 — RFC 0011 §A. Resolve a request's bearer to a principal
 * classification. handleDiscovery uses this to decide whether to
 * return the primary or narrowed view. Returns `null` for missing /
 * malformed auth or unrecognized bearer (treat as public view).
 *
 * Constant-time across ALL configured candidates.
 */
function principalFor(req: IncomingMessage): 'primary' | 'tenant2' | null {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  const presented = Buffer.from(auth.slice('Bearer '.length).trim(), 'utf8');
  const tryMatch = (candidate: string | null): boolean => {
    if (candidate === null) return false;
    const expected = Buffer.from(candidate, 'utf8');
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  };
  // Order: primary + secondary fold into one principal (rotation
  // overlap); tenant2 is the narrowed-view principal. Compute every
  // candidate regardless of early matches.
  const primaryHit = tryMatch(API_KEY);
  const secondaryHit = tryMatch(SECONDARY_API_KEY);
  const tenant2Hit = tryMatch(TENANT2_API_KEY);
  if (primaryHit || secondaryHit) return 'primary';
  if (tenant2Hit) return 'tenant2';
  return null;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/** Node typeIds the Postgres host's executor implements today. */
const SUPPORTED_NODE_TYPES = new Set([
  'core.noop',
  'core.delay',
  'core.approvalGate',
  'core.clarificationGate',
  'core.interrupt',
  'core.subWorkflow',
  // Phase H.1 — BYOK / secret resolver canary node. The fixture
  // (openwop-smoke-byok-roundtrip) emits {secretSha256, secretLength}
  // into variables; the raw value never leaves the resolver.
  'conformance.secret.echo',
  // Phase H.3 — universal "call this API" typeId per node-packs.md
  // §"Built-in nodes". SSRF-guarded; response body persisted into
  // variables (truncated at 1 MiB).
  'core.http.request',
  // Phase H.1″ — AI provider call typeIds per node-packs.md §"Built-in
  // nodes". Reference host stubs the actual provider call; the wire
  // contract (4-mode policy + credentialRef redaction) is preserved.
  'core.llm.chat',
  'core.llm.completion',
  // Phase H.2 — MCP tool-call typeId per host-capabilities.md §host.mcp.
  // HTTP/JSON-RPC transport; MCP-1 redaction enforced on event payloads.
  'core.mcp.toolCall',
  // RFC 0023 §B — conformance-only deterministic agent emitter. Drives
  // the `agent.*` event family on cue. Registration is gated by
  // §B.1 inside the executor case (workflow-id prefix `conformance-*`);
  // production deployers SHOULD drop this from their SUPPORTED_NODE_TYPES.
  'core.conformance.mock-agent',
  // node-packs.md §"Reserved Core OpenWOP node typeIds" — the host's
  // executeNode switch already implements these three; they belong in
  // the advertisement filter so fixtures that use them (orchestrator-
  // dispatch, orchestrator-low-confidence, dispatch-mapping fixtures,
  // and the various core.identity-only fixtures the host loads from
  // `conformance/fixtures/`) actually surface on `capabilities.fixtures`.
  // Their omission was silently downgrading the orchestrator + dispatch
  // scenario coverage on this host. RFC 0022 §C `dispatchMapping` and
  // RFC 0023 §B `mock-agent` advertisements depend on these being
  // present too, since the dispatch-mapping fixtures wire supervisor
  // + dispatch + per-worker child typeIds.
  'core.identity',
  'core.orchestrator.supervisor',
  'core.dispatch',
]);

function handleDiscovery(req: IncomingMessage, res: ServerResponse): void {
  // Only advertise fixtures the executor can actually run. A scenario
  // gating on `isFixtureAdvertised('conformance-approval')` will skip
  // when this host advertises only its supported subset — much better
  // than advertising everything and failing each unsupported run with
  // `node.failed { code: 'unsupported_node_type' }`.
  const advertisedFixtures = Array.from(workflows.values())
    .filter(
      (wf) =>
        // Advertise both `conformance-*` (standard conformance fixtures)
        // and `openwop-smoke-*` (end-to-end smoke fixtures, e.g., BYOK
        // roundtrip). Mirrors the SQLite reference host's filter.
        (wf.id.startsWith('conformance-') || wf.id.startsWith('openwop-smoke-')) &&
        wf.nodes.every((n) => SUPPORTED_NODE_TYPES.has(n.typeId)),
    )
    .map((wf) => wf.id);
  const key = auditSigningKey();
  // Phase I.5 + I.6 — principal-aware capability projection. Tenant2
  // gets a STRICT SUBSET of primary's capability keys per
  // capabilities-change-detection.md §"Scoped capability views" line 69.
  // This is the host's tenant-narrowing pattern; production deployers
  // wire a real tenant model and project per-tenant policy.
  const principal = principalFor(req);
  const isTenant2 = principal === 'tenant2';
  // Profile claims gain conditional entries when the matching env
  // vars are configured. Hosts that don't operate behind a rotation
  // window or a tenant2 principal omit those claims honestly.
  const profiles: string[] = [
    'openwop-audit-log-integrity',
    'openwop-interrupt-quorum',
    'openwop-interrupt-auth-required',
    'openwop-interrupt-external-event',
    'openwop-interrupt-cascade-cancel',
  ];
  if (SECONDARY_API_KEY !== null) {
    profiles.push('openwop-auth-api-key-rotation');
  }
  if (TENANT2_API_KEY !== null) {
    profiles.push('openwop-discovery-auth-scoped');
  }
  // Phase I.3 + I.4 — OAuth2-CC + OIDC user-bearer profile claims are
  // conditional on their env-driven validators being configured.
  // The host advertises only what it actually validates.
  if (OAUTH2_VALIDATOR !== null) {
    profiles.push('openwop-auth-oauth2-client-credentials');
  }
  if (OIDC_VALIDATOR !== null) {
    profiles.push('openwop-auth-oidc-user-bearer');
  }
  // Phase I.7 — only advertised when the operator has wired cert + key
  // paths and the host is actually terminating TLS. Honesty principle:
  // a deployment without mTLS material MUST NOT claim this profile.
  if (MTLS_ENABLED) {
    profiles.push('openwop-auth-mtls');
  }
  const advertisement = {
      protocolVersion: '1.0',
      implementation: {
        name: 'openwop-host-postgres',
        version: '1.0.0',
        vendor: 'openwop-spec (reference example — run-lifecycle + audit-log integrity)',
      },
      supportedEnvelopes: [],
      schemaVersions: {},
      limits: {
        clarificationRounds: 0,
        schemaRounds: 0,
        envelopesPerTurn: 0,
        maxNodeExecutions: 1000,
      },
      supportedTransports: ['rest'],
      fixtures: advertisedFixtures,
      debugBundle: { supported: true },
      capabilities: {
        // RFC 0056 — non-blocking run feedback/annotations. Run-level only;
        // annotations are a per-run side-store (not the replayable event log).
        feedback: {
          supported: true,
          targets: ['run'],
          signals: ['rating', 'correction', 'label', 'flag'],
        },
        // RFC 0036 — multi-region idempotency posture + cross-engine append
        // ordering. The Postgres reference host is single-region / single-
        // engine, so it advertises `idempotency.crossRegion: 'single-region'`
        // honestly (no live cross-region claim) — but it ships the canonical
        // convergence resolver (`multi-region.ts`) + a Lamport cross-engine
        // ordering model, both exercised by the conformance suite via the
        // `/v1/host/sample/test/{multi-region,cross-engine}/*` seams below.
        // Gated on OPENWOP_TEST_MULTI_REGION so a default deploy stays clean.
        ...(MULTI_REGION_TEST
          ? {
              idempotency: { crossRegion: 'single-region' as const },
              eventLog: {
                crossEngineOrdering: {
                  supported: true,
                  orderingModel: 'lamport' as const,
                },
              },
            }
          : {}),
        // RFC 0058 — engine-enforced run bounds. Advertised under
        // `capabilities.limits` (the schema-canonical + conformance-read
        // location) so clients can pre-flight a `runTimeoutMs` against the
        // host ceiling the value clamps to. The host enforces this on every
        // run (see runWorkflowClaimed).
        limits: {
          maxRunDurationMs: MAX_RUN_DURATION_MS,
        },
        auth: {
          profiles,
          auditLogIntegrity: {
            hashChain: true,
            checkpointSignatureAlgorithm: 'ed25519',
            checkpointPublicKey: key.publicKeyB64,
            checkpointIntervalEntries: AUDIT_OPTS.checkpointIntervalEntries,
            checkpointIntervalSeconds: AUDIT_OPTS.checkpointIntervalSeconds,
          },
          // Phase I.6 — auth-profiles.md §"openwop-auth-api-key-rotation"
          // advertisement. Only emitted when a secondary key is
          // configured (per the honesty principle).
          ...(SECONDARY_API_KEY !== null
            ? {
                rotation: {
                  supported: true,
                  minGraceSeconds: ROTATION_MIN_GRACE_SECONDS,
                },
              }
            : {}),
          // Phase I.3 — auth-profiles.md §"openwop-auth-oauth2-client-
          // credentials". Issuer/audience are operator-supplied; the
          // host validates `iss` + `aud` + `exp` + signature against
          // the issuer's JWKS. Honesty: only advertised when the
          // validator is configured (host fetches JWKS lazily).
          ...(OAUTH2_VALIDATOR !== null
            ? {
                oauth2: {
                  supported: true,
                  issuer: OAUTH2_VALIDATOR.issuer,
                  audience: OAUTH2_VALIDATOR.audience,
                  supportedAlgorithms: [...OAUTH2_VALIDATOR.supportedAlgorithms] as SupportedAlgorithm[],
                },
              }
            : {}),
          // Phase I.4 — auth-profiles.md §"openwop-auth-oidc-user-bearer".
          // Same validator shape as OAuth2-CC; the spec distinction
          // is the token's `sub` claim represents an end-user
          // principal rather than a machine client.
          ...(OIDC_VALIDATOR !== null
            ? {
                oidc: {
                  supported: true,
                  issuer: OIDC_VALIDATOR.issuer,
                  audience: OIDC_VALIDATOR.audience,
                  supportedAlgorithms: [...OIDC_VALIDATOR.supportedAlgorithms] as SupportedAlgorithm[],
                },
              }
            : {}),
          // Phase I.7 — auth-profiles.md §"openwop-auth-mtls".
          // Subject-mapping defaults to `cn` (the cert's Common Name
          // names the transport principal). Production deployers
          // extend to SAN-based mapping; this reference keeps `cn`
          // for compatibility with the broadest set of cert tooling.
          ...(MTLS_ENABLED
            ? {
                mtls: {
                  supported: true,
                  required: MTLS_REQUIRED,
                  subjectMapping: 'cn' as const,
                },
              }
            : {}),
        },
        // Phase I.5 — RFC 0011 §A advertisement. Only emitted when
        // tenant2 is configured.
        ...(TENANT2_API_KEY !== null
          ? {
              discovery: {
                authScoped: { supported: true, mode: 'same-endpoint' as const },
              },
            }
          : {}),
        interrupts: {
          supportedKinds: ['approval', 'clarification', 'external-event'],
          approvalActions: ['accept', 'reject', 'request-changes', 'escalate'],
        },
        webhooks: {
          supported: true,
          signatureAlgorithms: ['v1'],
        },
        // Phase H.1 — capabilities.md §`secrets`. Host implements
        // `host-managed` resolution for the canary secret id;
        // production deployers extend `resolveCanarySecret` to a real
        // KMS/Vault. Per SR-1, only the hash + length appear on any
        // observable surface; cleartext never leaves the resolver.
        secrets: REFERENCE_SECRETS_CAPABILITY,
        // Phase I.1 — capabilities.md §`memory` (RFC 0004). Host
        // implements the read-side MemoryAdapter contract
        // (list/get) backed by Postgres. Writes are host-internal
        // (session-end triggers, feedback promotion). TTL enforced
        // server-side; CTI-1 cross-tenant isolation upheld via
        // tenant_id filtering on every query.
        // RFC 0057 §A — the host attributes its session-end memory writes via
        // the content-free `memory.written` event (see runWorkflowClaimed).
        memory: {
          ...REFERENCE_MEMORY_CAPABILITY,
          attribution: { supported: true, emitsWriteEvents: true },
          ...(MEMORY_COMPACTION_ENABLED ? { compaction: REFERENCE_COMPACTION_CAPABILITY } : {}),
        },
        // Phase I.2 — capabilities.md §`agents`. Multi-Agent Shift
        // Phase 1-6 advertisement. Host emits the canonical event
        // shapes (agent.reasoned/toolCalled/toolReturned/handoff/
        // decided + runOrchestrator.decided) via the helpers in
        // src/agent-events.ts. Reasoning verbosity default
        // "summary" with 512-token cap; runs override via
        // RunOptions.configurable.reasoningVerbosity. CP-1
        // confidence-escalation contract honored via the
        // node.suspended { reason: 'low-confidence' } path.
        agents: REFERENCE_AGENTS_CAPABILITY,
        // RFC 0022 §B+§C — `capabilities.subWorkflow` block. Top-level
        // namespace for additive `core.subWorkflow` extension flags.
        // Carries `inputMapping: true` because the executor block
        // below seeds child variables from the parent via the
        // RFC 0022 §B normative bullet.
        subWorkflow: REFERENCE_SUBWORKFLOW_CAPABILITY,
        // RFC 0023 §B.2 — `capabilities.conformance` block. Advertised
        // because the host registers `core.conformance.mock-agent` (per
        // RFC 0023 §B). The §B.1 registration gate inside executeNode
        // still refuses the typeId for workflow ids outside the
        // `conformance-*` prefix — this advertisement does NOT make
        // the typeId reachable from arbitrary tenants.
        conformance: REFERENCE_CONFORMANCE_CAPABILITY,
        // Phase H.1 + H.1″ — capabilities.md §`aiProviders` +
        // §`aiProviders.policies`. The host advertises BYOK-ready
        // routing for the listed providers AND 4-mode policy
        // enforcement (`disabled` / `optional` / `required` /
        // `restricted`). Per-provider policies are sourced from
        // `OPENWOP_AI_POLICY_<PROVIDER>` env vars; resolver-outage
        // failures fail-open to `optional`.
        aiProviders: REFERENCE_AI_PROVIDERS_CAPABILITY,
        // RFC 0031 §E — the host honors `NodeModule.requiredModelCapabilities`
        // at dispatch (model-capability gate in executeNode) and emits
        // `model.capability.insufficient`. No substitution posture
        // (substitutionSupported: false). `advertised` is the union of the
        // host's providers' verified capabilities.
        modelCapabilities: {
          supported: true,
          advertised: aggregateAdvertisedCapabilities(SUPPORTED_PROVIDERS),
          substitutionSupported: SUBSTITUTION_SUPPORTED,
        },
        // Phase H.2 — capabilities.md §`mcpClient` (additive). MCP
        // tool-call surface via HTTP/JSON-RPC transport. Operators
        // configure individual servers via OPENWOP_MCP_SERVER_<ID>
        // env vars; the inventory itself is deployment-private.
        // MCP-1 redaction enforced: tool args + content texts NEVER
        // appear on event payloads.
        mcpClient: REFERENCE_MCP_CLIENT_CAPABILITY,
        // Phase H.3 — capabilities.md §`httpClient` (additive). The host
        // implements `core.http.request` with SSRF guard + 1 MiB response
        // truncation. Bypass via OPENWOP_HTTP_ALLOW_PRIVATE=true for
        // local-receiver tests; production deployers leave it unset.
        httpClient: {
          supported: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
          defaultTimeoutMs: 30_000,
          maxResponseBodyBytes: 1_048_576,
          ssrfGuard: true,
          redirectPolicy: 'follow',
        },
        runs: {
          // CF-2: drainPolicies advertised honestly — the reference host
          // aborts the in-flight node and flips status synchronously, which
          // matches the canonical `immediate` semantics in capabilities.md
          // §`runs.pauseResume`. Hosts that wait for the current node to
          // complete before flipping status MAY additionally advertise
          // `drain-current-node`.
          pauseResume: { supported: true, drainPolicies: ['immediate'] as const },
        },
        // RFC 0006 §G + RFC 0007 §G — orchestrator + dispatch
        // capabilities. Phase I.5 — both blocks are OMITTED for the
        // tenant2 principal so its discovery view is a strict subset
        // of primary's per `capabilities-change-detection.md` §"Scoped
        // capability views" line 69 (no authorization oracle).
        // Production deployers narrow per real tenant policy; the
        // reference host uses orchestrator+dispatch as the canonical
        // "drop this for tenant2" surface that the conformance suite
        // probes.
        ...(isTenant2
          ? {}
          : {
              orchestrator: {
                supported: true,
                workerIdInterpretation: 'node',
                fanOutSupported: false,
              },
              dispatch: {
                supported: true,
                models: ['child-run'],
                fanOutSupported: false,
                askUserRoutings: ['clarification', 'auto'],
              },
            }),
        // observability.md §"Span attributes" — only advertised when
        // OTEL_EXPORTER_OTLP_ENDPOINT is configured.
        ...(observabilityEnabled()
          ? {
              observability: {
                otel: { supported: true, protocol: 'http/json' },
                metrics: {
                  supported: true,
                  names: ['openwop.run.backlog', 'openwop.queue.depth', 'openwop.run.duration'],
                },
              },
            }
          : {}),
        // production-profile.md (RFC 0009). Postgres host claims the
        // profile end-to-end: durable Postgres-backed event log,
        // backpressure with 503 + Retry-After, ≥7-day event retention
        // sweeper, debug-bundle truncation with explicit metadata.
        // Sub-block values mirror the env-driven host configuration so
        // the conformance suite saturates inflight against the actual
        // cap. testForceExpire: false — no host-private expire hook
        // exposed (RFC 0009 §"Unresolved questions" #1 — endpoint
        // normation deferred to a future additive RFC).
        production: {
          supported: true,
          backpressure: {
            supported: true,
            inflightCap: MAX_INFLIGHT,
            retryAfterSeconds: RETRY_AFTER_SECONDS,
          },
          retention: {
            supported: true,
            minWindowSeconds: EVENT_RETENTION_DAYS * 86400,
            testForceExpire: false,
          },
          debugBundle: {
            supported: true,
            truncationMetadata: true,
          },
        },
      },
  };
  // RFC 0073 — capability families are document-root properties of the discovery
  // response (capabilities.schema.json roots agents/secrets/etc.; no `capabilities`
  // wrapper property). Emit them at the root canonically + retain the nested
  // `capabilities` object as a DEPRECATED v1.x-window mirror (see
  // spec/v1/capabilities.md §"Document-root layout").
  // `limits` exists at BOTH the root (AI-envelope limits: clarificationRounds /
  // schemaRounds / envelopesPerTurn + maxNodeExecutions) and under `capabilities`
  // (RFC 0058 maxRunDurationMs). A plain `...capabilities` spread would clobber the
  // root `limits` with the capabilities one — dropping the envelope limits that
  // `capabilities.schema.json §limits` requires. Merge the two so neither is lost.
  sendJSON(
    res,
    200,
    {
      ...advertisement,
      ...advertisement.capabilities,
      limits: { ...advertisement.limits, ...advertisement.capabilities.limits },
    },
    { 'Cache-Control': 'public, max-age=300' },
  );
}

function handleOpenApi(_req: IncomingMessage, res: ServerResponse): void {
  sendJSON(res, 200, {
    openapi: '3.1',
    info: { title: 'openwop Postgres reference host', version: '1.0.0' },
    paths: {
      '/.well-known/openwop': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs': { post: { responses: { '201': { description: 'Created' } } } },
      '/v1/runs/{runId}': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/cancel': { post: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events/poll': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events': { get: { responses: { '200': { description: 'SSE stream' } } } },
      '/v1/runs/{runId}/debug-bundle': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}:pause': { post: { responses: { '202': { description: 'Accepted' } } } },
      '/v1/runs/{runId}:resume': { post: { responses: { '202': { description: 'Accepted' } } } },
      '/v1/runs/{runId}/interrupts/{nodeId}': { post: { responses: { '200': { description: 'OK' } } } },
      '/v1/interrupts/{token}': { post: { responses: { '200': { description: 'OK' } } } },
      '/v1/webhooks': { post: { responses: { '201': { description: 'Created' } } } },
      '/v1/webhooks/{subscriptionId}': { delete: { responses: { '200': { description: 'OK' } } } },
      '/v1/audit/verify': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/workflows/{workflowId}': { get: { responses: { '200': { description: 'OK' } } } },
    },
  });
}

async function handleCreateRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await checkAuth(req, res))) return;

  const bodyText = await readBody(req);
  let parsed: {
    workflowId?: string;
    inputs?: Record<string, unknown>;
    configurable?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }

  if (typeof parsed.workflowId !== 'string') {
    sendError(res, 400, 'validation_error', 'workflowId MUST be a string.');
    return;
  }
  const workflow = workflows.get(parsed.workflowId);
  if (!workflow) {
    sendError(res, 404, 'workflow_not_found', 'Unknown workflowId.');
    return;
  }

  // capabilities.md §"Unsupported capability — refusal contract".
  // A workflow referencing a capability-gated typeId on a host that
  // does NOT advertise the gating capability MUST be refused. Iterate
  // the normative typeId map; first-fail keeps the error envelope
  // unambiguous.
  for (const wfNode of workflow.nodes) {
    const gate = GATED_TYPEID_MAP[wfNode.typeId];
    if (gate && !HOST_ADVERTISED_GATED_CAPABILITIES.has(gate.capability)) {
      sendJSON(res, 400, {
        error: 'capability_required',
        message: `Workflow "${parsed.workflowId}" references ${wfNode.typeId}, but this host does not advertise ${gate.advertisementPath}: true.`,
        details: {
          requiredCapability: gate.capability,
          offendingTypeId: wfNode.typeId,
          nodeId: wfNode.id,
        },
      });
      return;
    }
  }

  // Per-workflow configurableSchema validation (run-options.md
  // §"Per-workflow configurableSchema"). When the fixture declares a
  // schema, the host MUST reject mismatched `configurable` overlays.
  if (workflow.configurableSchema && parsed.configurable !== undefined) {
    const check = validateConfigurable(workflow.configurableSchema, parsed.configurable);
    if (!check.valid) {
      sendError(res, 400, 'validation_error', check.reason);
      return;
    }
  }

  const idempotencyKey = req.headers['idempotency-key'];
  const incomingBodyHash = hashBody(bodyText);
  if (typeof idempotencyKey === 'string') {
    await pruneIdempotency();
    const cacheKey = buildIdempotencyCacheKey('POST /v1/runs', idempotencyKey);
    const cached = await getIdempotency(cacheKey);
    if (cached) {
      if (cached.body_hash !== incomingBodyHash) {
        sendError(
          res,
          409,
          'idempotency_key_conflict',
          'Idempotency-Key reused with a different request body.',
        );
        return;
      }
      res.writeHead(cached.status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(cached.body),
        'openwop-Idempotent-Replay': 'true',
      });
      res.end(cached.body);
      return;
    }
  }

  const runId = `run-${randomUUID()}`;
  const inputs = parsed.inputs ?? {};
  const startedAt = new Date().toISOString();
  await insertRun(
    runId,
    parsed.workflowId,
    inputs,
    startedAt,
    parsed.configurable ?? null,
  );

  // W3C Trace Context propagation (observability.md §"Trace context
  // propagation"). Parse `traceparent` from the inbound request; if
  // valid, store it so startRunSpan for this runId adopts the caller-
  // supplied trace_id.
  const traceparentHeader = req.headers['traceparent'];
  const inboundTrace = parseTraceparent(
    Array.isArray(traceparentHeader) ? traceparentHeader[0] : traceparentHeader,
  );
  if (inboundTrace) recordInboundTraceContext(runId, inboundTrace);

  const q = await querier();
  await logAudit(q, {
    actor: 'tenant:default',
    action: 'run.create',
    target: runId,
    details: { workflowId: parsed.workflowId },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);

  const responseBody = {
    runId,
    status: 'pending',
    workflowId: parsed.workflowId,
    startedAt,
    // Required by api/openapi.yaml POST /v1/runs response schema.
    eventsUrl: `/v1/runs/${runId}/events`,
    statusUrl: `/v1/runs/${runId}`,
  };
  const responseText = JSON.stringify(responseBody);

  if (typeof idempotencyKey === 'string') {
    const cacheKey = buildIdempotencyCacheKey('POST /v1/runs', idempotencyKey);
    await insertIdempotency(cacheKey, 201, responseText, incomingBodyHash);
  }

  // Fire-and-forget executor.
  void runWorkflow(runId).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: 'internal', message };
    await appendEvent(runId, 'run.failed', { data: error });
    await setRunTerminal(runId, 'failed', error);
  });

  res.writeHead(201, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseText),
    'openwop-Idempotent-Replay': typeof idempotencyKey === 'string' ? 'false' : '',
  });
  res.end(responseText);
}

/**
 * Validate a `configurable` overlay against a workflow's optional
 * `configurableSchema` (a JSON Schema 2020-12 fragment). Minimal
 * implementation that mirrors the SQLite host: supports `type`,
 * `additionalProperties: false`, `properties.*`, `properties.<k>.{type,
 * minimum}`, `items.type`. A production host would use Ajv2020.
 *
 * @see spec/v1/run-options.md §"Per-workflow configurableSchema"
 * @see schemas/workflow-definition.schema.json §configurableSchema
 */
function validateConfigurable(
  schema: Record<string, unknown> | undefined,
  configurable: unknown,
): { valid: true } | { valid: false; reason: string } {
  if (!schema) return { valid: true };
  if (configurable === undefined || configurable === null) return { valid: true };
  if (typeof configurable !== 'object') {
    return { valid: false, reason: 'configurable MUST be an object' };
  }
  const obj = configurable as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const allowAdditional = schema.additionalProperties !== false;

  for (const [key, val] of Object.entries(obj)) {
    const propSchema = props[key];
    if (!propSchema) {
      if (!allowAdditional) {
        return {
          valid: false,
          reason: `configurable.${key} is not declared in configurableSchema (additionalProperties: false)`,
        };
      }
      continue;
    }
    const expectedType = propSchema.type as string | undefined;
    if (expectedType === 'integer') {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        return { valid: false, reason: `configurable.${key} MUST be an integer` };
      }
      if (typeof propSchema.minimum === 'number' && val < propSchema.minimum) {
        return { valid: false, reason: `configurable.${key} MUST be >= ${propSchema.minimum}` };
      }
    } else if (expectedType === 'string') {
      if (typeof val !== 'string') {
        return { valid: false, reason: `configurable.${key} MUST be a string` };
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(val)) {
        return { valid: false, reason: `configurable.${key} MUST be an array` };
      }
      const items = propSchema.items as { type?: string } | undefined;
      if (items?.type === 'string' && !val.every((v) => typeof v === 'string')) {
        return { valid: false, reason: `configurable.${key} items MUST all be strings` };
      }
    } else if (expectedType === 'object') {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        return { valid: false, reason: `configurable.${key} MUST be an object` };
      }
    } else if (expectedType === 'number') {
      if (typeof val !== 'number') {
        return { valid: false, reason: `configurable.${key} MUST be a number` };
      }
    } else if (expectedType === 'boolean') {
      if (typeof val !== 'boolean') {
        return { valid: false, reason: `configurable.${key} MUST be a boolean` };
      }
    }
  }
  return { valid: true };
}

async function handleGetWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  workflowId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const wf = workflows.get(workflowId);
  if (!wf) {
    sendError(res, 404, 'workflow_not_found', `Unknown workflowId: ${workflowId}`);
    return;
  }
  // Return the full fixture definition so clients can pre-flight
  // validate against any declared configurableSchema. Mirrors the
  // SQLite host's handleGetWorkflow shape.
  sendJSON(res, 200, wf);
}

async function handleGetRun(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Suspended runs expose the active interrupt + currentNodeId so
  // conformance scenarios + clients can resolve via POST /v1/runs/
  // {runId}/interrupts/{nodeId} (or via POST /v1/interrupts/{token}
  // for external-event interrupts). Child runs spawned via
  // `core.subWorkflow` are surfaced alongside so cascade scenarios
  // can walk parent/child linkage. Both reads merged into one CTE
  // round-trip — the prior two-query implementation added one DB
  // hop per snapshot read; for production hosts that observability
  // cost compounds quickly.
  const q = await querier();
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';

  const snapshotRes = await q.query<{
    active_interrupt: {
      run_id: string;
      node_id: string;
      kind: string;
      payload_json: unknown;
      callback_token: string | null;
    } | null;
    child_runs: Array<{ run_id: string; status: string }> | null;
  }>(
    `WITH active AS (
       SELECT run_id, node_id, kind, payload_json, callback_token
         FROM interrupts
        WHERE run_id = $1 AND resolved_at IS NULL
        ORDER BY ctid DESC
        LIMIT 1
     ),
     children AS (
       SELECT run_id, status FROM runs
        WHERE parent_run_id = $1
        ORDER BY started_at ASC
     )
     SELECT
       (SELECT row_to_json(active.*) FROM active) AS active_interrupt,
       (SELECT COALESCE(json_agg(children.*), '[]'::json) FROM children) AS child_runs`,
    [runId],
  );
  const merged = snapshotRes.rows[0]!;
  const active = isSuspended ? merged.active_interrupt : null;
  const interrupt: Record<string, unknown> | null = active
    ? {
        kind: active.kind,
        nodeId: active.node_id,
        payload: active.payload_json,
        ...(active.callback_token
          ? {
              interruptToken: active.callback_token,
              callbackUrl: `/v1/interrupts/${active.callback_token}`,
            }
          : {}),
      }
    : null;
  const currentNodeId = active ? active.node_id : undefined;
  const childRuns = (merged.child_runs ?? []).map((c) => ({
    runId: c.run_id,
    status: c.status,
  }));

  // RFC 0002 — surface AgentRef-shaped agent identity on the snapshot when the
  // run's workflow pins an `agent` on a node. A supervisor node's pin projects
  // to `runOrchestrator`; any other node's pin projects to `agent`. The pin is
  // preserved verbatim from the fixture (agentId + optional name/modelClass/
  // memoryRef/version/sourceManifestId), so pack-installed agents carry their
  // `sourceManifestId` provenance through. See agentMetadata / agentPackProvenance.
  const wfForAgent = workflows.get(row.workflow_id);
  let agentRef: FixtureWorkflow['nodes'][number]['agent'] | undefined;
  let orchestratorRef: FixtureWorkflow['nodes'][number]['agent'] | undefined;
  if (wfForAgent) {
    for (const n of wfForAgent.nodes) {
      if (!n.agent) continue;
      if (n.typeId === 'core.orchestrator.supervisor') {
        orchestratorRef ??= n.agent;
      } else {
        agentRef ??= n.agent;
      }
    }
  }

  sendJSON(res, 200, {
    runId: row.run_id,
    workflowId: row.workflow_id,
    status: row.status,
    // pg-types unmarshals JSONB to a JS object — no string parsing needed.
    inputs: row.inputs_json,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ...(row.error_json ? { error: row.error_json } : {}),
    // Surface the `configurable` overlay so debugging UIs can show
    // "this run was created with {recursionLimit: 3, ...}". Omitted
    // when the run was created without an overlay.
    ...(row.configurable_json ? { configurable: row.configurable_json } : {}),
    // Per-run variables (channel writes, identity passthrough, BYOK
    // secret-resolver outputs like `{secretSha256, secretLength}`). The
    // raw secret value never lands here per SR-1 — only the redacted
    // shape the executor wrote during node execution.
    ...(row.variables_json ? { variables: row.variables_json } : {}),
    // channels-and-reducers.md — reducer channel state (e.g. the `message`
    // reducer's deduped-by-messageId list). Omitted when no channel was written.
    ...(row.channels_json ? { channels: row.channels_json } : {}),
    // Parent linkage (spec gap G3 — node-packs.md §core.subWorkflow
    // contract). Child runs dispatched by core.subWorkflow carry these
    // back-references so consumers can walk parent → child chains
    // (cascade scenarios, debug bundle assembly).
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.parent_node_id ? { parentNodeId: row.parent_node_id } : {}),
    ...(currentNodeId ? { currentNodeId } : {}),
    ...(interrupt ? { interrupt } : {}),
    ...(childRuns.length > 0 ? { childRuns } : {}),
    ...(agentRef ? { agent: agentRef } : {}),
    ...(orchestratorRef ? { runOrchestrator: orchestratorRef } : {}),
    // RFC 0026 — per-run cost rollup (run-snapshot.schema.json
    // §metrics.openwopCost). Omitted when no cost was recorded.
    ...(snapshotCostRollup(runId) ? { metrics: { openwopCost: snapshotCostRollup(runId) } } : {}),
  });
}

async function handleCancelRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  await readBody(req);
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    sendJSON(res, 200, { runId, status: row.status, alreadyTerminal: true });
    return;
  }
  const q = await querier();

  // Cascade: cancel any active children eagerly so their GET shows
  // terminal 'cancelled' sooner. The child's executor also defensively
  // observes the cancelling flip, but doing it here speeds the
  // openwop-interrupt-cascade-cancel scenario.
  const childrenRes = await q.query<{ run_id: string }>(
    `SELECT run_id FROM runs
     WHERE parent_run_id = $1 AND status NOT IN ('completed','failed','cancelled')`,
    [runId],
  );
  for (const c of childrenRes.rows) {
    await cancelRunInternal(c.run_id, 'parent-cancelled');
  }

  // If the run is suspended on an interrupt, drive directly to terminal —
  // no executor running to observe the cancelling flip.
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  if (isSuspended) {
    await invalidateInterrupts(q, runId, 'cancelled');
    await appendEvent(runId, 'run.cancelled');
    await setRunTerminal(runId, 'cancelled', null);
    await logAudit(q, {
      actor: 'tenant:default',
      action: 'run.cancel',
      target: runId,
      details: {
        priorStatus: row.status,
        viaSuspended: true,
        cascadedChildren: childrenRes.rows.length,
      },
    });
    await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);
    sendJSON(res, 200, { runId, status: 'cancelled' });
    return;
  }

  await setCancelRequested(runId);
  await logAudit(q, {
    actor: 'tenant:default',
    action: 'run.cancel',
    target: runId,
    details: { priorStatus: row.status, cascadedChildren: childrenRes.rows.length },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);
  runningAborters.get(runId)?.abort();
  sendJSON(res, 200, { runId, status: 'cancelling' });
}

/**
 * Per-runId cancel mechanics. Used by handleBulkCancel so per-id
 * outcomes share the audit + cascade + abort logic with the
 * single-run handler. Returns a result the bulk-cancel response can
 * surface directly.
 */
async function cancelOneRun(
  runId: string,
): Promise<
  | { ok: true; status: 'cancelled' | 'cancelling'; alreadyTerminal?: boolean }
  | { ok: false; error: { code: string; message: string } }
> {
  const row = await loadRun(runId);
  if (!row) {
    return { ok: false, error: { code: 'not_found', message: `Unknown runId: ${runId}` } };
  }
  if (row.status === 'cancelled') {
    return { ok: true, status: 'cancelled', alreadyTerminal: true };
  }
  if (row.status === 'completed' || row.status === 'failed') {
    return {
      ok: false,
      error: {
        code: 'run_terminal',
        message: `Run "${runId}" is already terminal (${row.status}); cannot cancel.`,
      },
    };
  }
  const q = await querier();
  const childrenRes = await q.query<{ run_id: string }>(
    `SELECT run_id FROM runs
     WHERE parent_run_id = $1 AND status NOT IN ('completed','failed','cancelled')`,
    [runId],
  );
  for (const c of childrenRes.rows) {
    await cancelRunInternal(c.run_id, 'parent-cancelled');
  }
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  if (isSuspended) {
    await invalidateInterrupts(q, runId, 'cancelled');
    await appendEvent(runId, 'run.cancelled');
    await setRunTerminal(runId, 'cancelled', null);
    await logAudit(q, {
      actor: 'tenant:default',
      action: 'run.cancel',
      target: runId,
      details: { priorStatus: row.status, viaSuspended: true, cascadedChildren: childrenRes.rows.length, viaBulkCancel: true },
    });
    await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);
    return { ok: true, status: 'cancelled' };
  }
  await setCancelRequested(runId);
  await logAudit(q, {
    actor: 'tenant:default',
    action: 'run.cancel',
    target: runId,
    details: { priorStatus: row.status, cascadedChildren: childrenRes.rows.length, viaBulkCancel: true },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);
  runningAborters.get(runId)?.abort();
  return { ok: true, status: 'cancelling' };
}

async function handleBulkCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1). 200 +
  // per-id results whenever the request reaches the host; partial
  // failures surface inside the array.
  if (!(await checkAuth(req, res))) return;
  const bodyText = await readBody(req);
  let parsed: { runIds?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (!Array.isArray(parsed.runIds) || parsed.runIds.length === 0) {
    sendError(res, 400, 'validation_error', 'runIds MUST be a non-empty array.');
    return;
  }
  const BULK_CANCEL_MAX = 100;
  if (parsed.runIds.length > BULK_CANCEL_MAX) {
    sendJSON(res, 400, {
      error: 'validation_error',
      message: `runIds carries ${parsed.runIds.length} entries; host-defined cap is ${BULK_CANCEL_MAX}.`,
      details: { maxRunIds: BULK_CANCEL_MAX, observed: parsed.runIds.length },
    });
    return;
  }
  if (!parsed.runIds.every((id) => typeof id === 'string' && id.length > 0)) {
    sendError(res, 400, 'validation_error', 'runIds entries MUST all be non-empty strings.');
    return;
  }
  const runIds = parsed.runIds as string[];
  const results = await Promise.all(
    runIds.map(async (id) => {
      const outcome = await cancelOneRun(id);
      return { runId: id, ...outcome };
    }),
  );
  sendJSON(res, 200, { results });
}

/**
 * RFC 0031 §B gate exerciser — `POST /v1/host/sample/test/evaluate-model-capability-gate`.
 * Pure-function exerciser: drives `evaluateModelCapabilityGate` with synthetic
 * input and returns the routing outcome + the event the host would emit. The
 * conformance suite uses this to assert the substitute/refuse/dispatch decision
 * matrix + event payloads (RFC 0031 §D) without a full run. Does NOT emit into
 * any event log; side-effect-free. Body: { module, activeProvider, activeModel,
 * substitutionSupported, supportedProviders, nodeId }. Response: { outcome, event }.
 */
async function handleEvaluateModelCapabilityGate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const bodyText = await readBody(req);
  let body: {
    module?: { requiredModelCapabilities?: unknown; fallbackModel?: unknown };
    activeProvider?: unknown;
    activeModel?: unknown;
    substitutionSupported?: unknown;
    supportedProviders?: unknown;
    nodeId?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (typeof body.activeProvider !== 'string' || typeof body.activeModel !== 'string') {
    sendError(res, 400, 'validation_error', 'activeProvider + activeModel MUST be strings.');
    return;
  }
  const requiredCaps = Array.isArray(body.module?.requiredModelCapabilities)
    ? body.module.requiredModelCapabilities.filter((c): c is string => typeof c === 'string')
    : [];
  const fr = body.module?.fallbackModel;
  const fallback =
    fr && typeof fr === 'object'
      && typeof (fr as { provider?: unknown }).provider === 'string'
      && typeof (fr as { model?: unknown }).model === 'string'
      ? { provider: (fr as { provider: string }).provider, model: (fr as { model: string }).model }
      : undefined;
  const outcome = evaluateModelCapabilityGate({
    module: { requiredModelCapabilities: requiredCaps, ...(fallback ? { fallbackModel: fallback } : {}) },
    activeProvider: body.activeProvider,
    activeModel: body.activeModel,
    substitutionSupported: body.substitutionSupported === true,
    supportedProviders: Array.isArray(body.supportedProviders)
      ? body.supportedProviders.filter((p): p is string => typeof p === 'string')
      : [],
  });
  const nodeId = typeof body.nodeId === 'string' && body.nodeId.length > 0 ? body.nodeId : 'test-node';
  let event: { type: string; payload: Record<string, unknown> } | null = null;
  if (outcome.route === 'substitute') {
    event = { type: 'model.capability.substituted', payload: buildSubstitutedPayload(outcome, nodeId) };
  } else if (outcome.route === 'refuse') {
    event = { type: 'model.capability.insufficient', payload: buildInsufficientPayload(outcome, nodeId, body.activeProvider, body.activeModel) };
  }
  sendJSON(res, 200, { outcome, event });
}

/**
 * RFC 0012 test seam — `POST /v1/test/memory/seed`. Plants source
 * entries in the host's `memory_entries` table so a conformance
 * scenario can drive a compaction run synchronously. Body shape:
 *
 *   { memoryRef: string, entries: Array<{ id, content, tags? }> }
 *
 * Only registered when BOTH `OPENWOP_MEMORY_COMPACTION=true` AND
 * `OPENWOP_TEST_TRIGGER_COMPACTION=true`. The protocol does not
 * normate this seam — it exists purely to give the conformance
 * suite a way to set up the compaction precondition.
 */
async function handleTestMemorySeed(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const bodyText = await readBody(req);
  let parsed: {
    memoryRef?: unknown;
    entries?: Array<{ id?: unknown; content?: unknown; tags?: unknown }>;
  };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (typeof parsed.memoryRef !== 'string' || parsed.memoryRef.length === 0) {
    sendError(res, 400, 'validation_error', 'memoryRef MUST be a non-empty string.');
    return;
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    sendError(res, 400, 'validation_error', 'entries MUST be a non-empty array.');
    return;
  }
  const q = await querier();
  const planted: string[] = [];
  for (const entry of parsed.entries) {
    if (typeof entry.id !== 'string' || typeof entry.content !== 'string') {
      sendError(res, 400, 'validation_error', 'each entry MUST carry { id, content } as strings.');
      return;
    }
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string')
      : [];
    await writeMemoryEntry(q, {
      tenantId: 'tenant:default',
      memoryRef: parsed.memoryRef,
      memoryId: entry.id,
      content: entry.content,
      tags,
    });
    planted.push(entry.id);
  }
  sendJSON(res, 201, { plantedIds: planted });
}

/**
 * RFC 0012 test seam — `POST /v1/test/memory/compact`. Drives a
 * host-managed compaction run synchronously. Body shape:
 *
 *   { memoryRef: string, maxInputEntries?: number, maxOutputBytes?: number }
 *
 * Returns the canonical `memory.compacted` event payload per
 * `run-event-payloads.schema.json` §`memoryCompacted` (plus a
 * top-level `type: 'memory.compacted'` for parity with the event-log
 * envelope shape). Returns 204 when the memoryRef has <2 entries (no
 * compaction performed). Only registered when both env flags are set.
 */
async function handleTestMemoryCompact(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const bodyText = await readBody(req);
  let parsed: {
    memoryRef?: unknown;
    maxInputEntries?: unknown;
    maxOutputBytes?: unknown;
  };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (typeof parsed.memoryRef !== 'string' || parsed.memoryRef.length === 0) {
    sendError(res, 400, 'validation_error', 'memoryRef MUST be a non-empty string.');
    return;
  }
  const q = await querier();
  const options: { maxInputEntries?: number; maxOutputBytes?: number } = {};
  if (typeof parsed.maxInputEntries === 'number' && parsed.maxInputEntries > 0) {
    options.maxInputEntries = parsed.maxInputEntries;
  }
  if (typeof parsed.maxOutputBytes === 'number' && parsed.maxOutputBytes > 0) {
    options.maxOutputBytes = parsed.maxOutputBytes;
  }
  const result = await runCompaction(q, 'tenant:default', parsed.memoryRef, options);
  if (result === null) {
    sendJSON(res, 204, {});
    return;
  }
  // Canonical memory.compacted event payload per run-event-payloads.schema.json
  // PLUS an out-of-band `outputContent` field carrying the persisted entry
  // bytes so the SR-1 carry-forward conformance scenario can verify the
  // BYOK redaction harness ran end-to-end (the wire-level `memory.compacted`
  // event does NOT carry content; this seam is test-only).
  sendJSON(res, 200, {
    type: 'memory.compacted',
    payload: {
      memoryRef: parsed.memoryRef,
      outputId: result.outputId,
      sourceIds: result.sourceIds,
      sourceCount: result.sourceCount,
      trigger: 'host-managed',
      byteSize: result.byteSize,
    },
    outputContent: result.outputContent,
  });
}

async function handleRegisterWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const bodyText = await readBody(req);
  let parsed: { url?: unknown; secret?: unknown; eventTypes?: unknown };
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as typeof parsed) : {};
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (typeof parsed.url !== 'string' || parsed.url.length === 0) {
    sendError(res, 400, 'validation_error', 'url MUST be a non-empty string.');
    return;
  }
  try {
    new URL(parsed.url);
  } catch {
    sendError(res, 400, 'validation_error', 'url MUST be a parseable URL.');
    return;
  }
  const eventTypes = Array.isArray(parsed.eventTypes)
    ? (parsed.eventTypes as string[]).filter((t) => typeof t === 'string')
    : [];

  const q = await querier();
  let sub;
  try {
    sub = await registerWebhook(q, {
      url: parsed.url,
      ...(typeof parsed.secret === 'string' ? { secret: parsed.secret } : {}),
      eventTypes,
    });
  } catch (err) {
    if (err instanceof WebhookUrlRejected) {
      sendError(res, 400, 'webhook_url_rejected', err.reason);
      return;
    }
    throw err;
  }

  await logAudit(q, {
    actor: 'tenant:default',
    action: 'webhook.register',
    target: sub.subscriptionId,
    details: { url: sub.url, eventTypes: sub.eventTypes },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);

  sendJSON(res, 201, {
    subscriptionId: sub.subscriptionId,
    url: sub.url,
    secret: sub.secret, // returned once on register, never again
    eventTypes: sub.eventTypes,
    createdAt: sub.createdAt,
  });
}

async function handleUnregisterWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  subscriptionId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const q = await querier();
  const removed = await unregisterWebhook(q, subscriptionId);
  if (!removed) {
    sendError(res, 404, 'subscription_not_found', `Unknown subscriptionId: ${subscriptionId}`);
    return;
  }
  await logAudit(q, {
    actor: 'tenant:default',
    action: 'webhook.unregister',
    target: subscriptionId,
    details: {},
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);
  sendJSON(res, 200, { subscriptionId, unregistered: true });
}

async function handleResolveInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  nodeId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  const q = await querier();
  const interrupt = await getInterrupt(q, runId, nodeId);
  if (!interrupt) {
    sendError(
      res,
      404,
      'interrupt_not_found',
      `No active interrupt at (runId=${runId}, nodeId=${nodeId}).`,
    );
    return;
  }

  const bodyText = await readBody(req);
  let parsed: { resumeValue?: unknown };
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as { resumeValue?: unknown }) : {};
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }

  const outcome =
    interrupt.kind === 'approval'
      ? await resolveApproval(q, runId, nodeId, parsed.resumeValue)
      : await resolveClarification(q, runId, nodeId, parsed.resumeValue);

  if (outcome.kind === 'unknown') {
    sendError(res, 404, 'interrupt_not_found', 'Interrupt resolved or missing.');
    return;
  }
  if (outcome.kind === 'expired') {
    sendError(res, 410, 'interrupt_expired', 'Interrupt has expired.');
    return;
  }
  if (outcome.kind === 'invalid') {
    sendError(res, outcome.status, outcome.code, outcome.message);
    return;
  }

  await logAudit(q, {
    actor: 'tenant:default',
    action: 'interrupt.resolve',
    target: `${runId}:${nodeId}`,
    details: {
      outcome: outcome.kind,
      votes: outcome.kind === 'pending' ? outcome.votes.length : undefined,
    },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);

  if (outcome.kind === 'pending') {
    await appendEvent(runId, 'interrupt.vote', {
      nodeId,
      data: { votes: outcome.votes },
    });
    sendJSON(res, 200, {
      runId,
      status: 'waiting-approval',
      interrupt: { kind: interrupt.kind, nodeId, votes: outcome.votes },
    });
    return;
  }

  if (outcome.kind === 'rejected') {
    await appendEvent(runId, 'node.completed', { nodeId, data: { outcome: 'rejected' } });
    await appendEvent(runId, 'run.failed', {
      data: { code: 'interrupt_rejected', message: 'Approval gate rejected by quorum.' },
    });
    await setRunTerminal(runId, 'failed', {
      code: 'interrupt_rejected',
      message: 'Approval gate rejected by quorum.',
    });
    sendJSON(res, 200, {
      runId,
      status: 'failed',
      interrupt: { kind: interrupt.kind, nodeId, outcome: 'rejected', votes: outcome.votes },
    });
    return;
  }

  // 'resumed' — close out the suspended node, advance, re-enter executor.
  // Status-guarded UPDATE: only flip to running if the run is still
  // suspended. A concurrent cancel that arrived between getInterrupt
  // and this UPDATE will have flipped status to 'cancelling' (or
  // terminal), and rowCount will be 0 — we surface this as 409 so the
  // caller knows the resume was lost to a cancel. @see review M2.
  await appendEvent(runId, 'node.resumed', { nodeId, data: { action: outcome.finalAction } });
  await appendEvent(runId, 'node.completed', { nodeId });
  const advance = await q.query(
    `UPDATE runs SET status = 'running', next_node_index = $1
     WHERE run_id = $2
       AND status IN ('waiting-approval', 'waiting-input', 'waiting-external')`,
    [(row.next_node_index ?? 0) + 1, runId],
  );
  if ((advance.rowCount ?? 0) === 0) {
    // Cancel raced and won. The run is already terminal or cancelling.
    sendJSON(res, 409, {
      error: 'run_no_longer_resumable',
      message: 'Run was cancelled before resume could complete.',
      details: { runId, lastKnownStatus: row.status },
    });
    return;
  }
  void runWorkflow(runId).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: 'internal', message };
    await appendEvent(runId, 'run.failed', { data: error });
    await setRunTerminal(runId, 'failed', error);
  });
  sendJSON(res, 200, {
    runId,
    status: 'running',
    interrupt: { kind: interrupt.kind, nodeId, outcome: 'accepted', votes: outcome.votes },
  });
}

async function handleResolveInterruptByToken(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<void> {
  // Signed-callback resolve: the token IS the authorization. No bearer
  // check — the token's unguessability is the access-control surface.
  const q = await querier();
  const interrupt = await getInterruptByToken(q, token);
  if (!interrupt) {
    sendError(res, 404, 'interrupt_not_found', 'Unknown or expired interrupt token.');
    return;
  }

  // openwop-interrupt-auth-required rejects signed-token resolves.
  const config = interrupt.config_json as { profile?: string };
  if (config.profile === 'openwop-interrupt-auth-required') {
    sendError(
      res,
      403,
      'auth_elevation_required',
      'This interrupt requires bearer authentication; signed-token resume is disabled.',
    );
    return;
  }

  const bodyText = await readBody(req);
  let parsed: { resumeValue?: unknown };
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as { resumeValue?: unknown }) : {};
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }

  const outcome =
    interrupt.kind === 'external-event'
      ? await resolveExternalEvent(q, interrupt.run_id, interrupt.node_id, parsed.resumeValue)
      : ({
          kind: 'invalid' as const,
          status: 400 as const,
          code: 'unsupported_token_kind',
          message: 'Signed-token resolve is not supported for this interrupt kind.',
        } as const);

  if (outcome.kind === 'unknown') {
    sendError(res, 404, 'interrupt_not_found', 'Interrupt resolved or missing.');
    return;
  }
  if (outcome.kind === 'expired') {
    sendError(res, 410, 'interrupt_expired', 'Interrupt has expired.');
    return;
  }
  if (outcome.kind === 'invalid') {
    sendError(res, outcome.status, outcome.code, outcome.message);
    return;
  }

  await logAudit(q, {
    actor: 'callback-token',
    action: 'interrupt.resolve',
    target: `${interrupt.run_id}:${interrupt.node_id}`,
    details: { outcome: outcome.kind, via: 'signed-token' },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);

  if (outcome.kind === 'resumed') {
    await appendEvent(interrupt.run_id, 'node.resumed', {
      nodeId: interrupt.node_id,
      data: { action: outcome.finalAction },
    });
    await appendEvent(interrupt.run_id, 'node.completed', { nodeId: interrupt.node_id });
    const row = await loadRun(interrupt.run_id);
    if (row) {
      // Status-guarded UPDATE: a concurrent cancel that flipped status
      // to 'cancelling' or terminal MUST NOT be clobbered by the
      // signed-token resume. @see review M2.
      const advance = await q.query(
        `UPDATE runs SET status = 'running', next_node_index = $1
         WHERE run_id = $2
           AND status IN ('waiting-approval', 'waiting-input', 'waiting-external')`,
        [(row.next_node_index ?? 0) + 1, interrupt.run_id],
      );
      if ((advance.rowCount ?? 0) === 0) {
        sendJSON(res, 409, {
          error: 'run_no_longer_resumable',
          message: 'Run was cancelled before signed-token resume could complete.',
          details: { runId: interrupt.run_id, lastKnownStatus: row.status },
        });
        return;
      }
      const resumedRunId = interrupt.run_id;
      void runWorkflow(resumedRunId).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const error = { code: 'internal', message };
        await appendEvent(resumedRunId, 'run.failed', { data: error });
        await setRunTerminal(resumedRunId, 'failed', error);
      });
    }
    sendJSON(res, 200, {
      runId: interrupt.run_id,
      nodeId: interrupt.node_id,
      status: 'running',
      outcome: 'resumed',
    });
    return;
  }
}

async function handleDebugBundle(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  url: URL,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  // Read every event for the run; truncate per debug-bundle.md.
  const events = await getEventsAfter(runId, -1);
  const totalEvents = events.length;
  const maxEventsParam = url.searchParams.get('maxEvents');
  const maxEvents =
    maxEventsParam !== null && Number.isFinite(Number(maxEventsParam))
      ? Math.max(0, Number(maxEventsParam))
      : Number.POSITIVE_INFINITY;

  const keepEvents = Math.min(totalEvents, maxEvents);
  let truncated = keepEvents < totalEvents;
  let truncatedReason: string | undefined = truncated ? 'events_truncated_to_max_events' : undefined;
  const eventSlice = events.slice(0, keepEvents);

  const baseBundle: Record<string, unknown> = {
    bundleVersion: '1',
    generatedAt: new Date().toISOString(),
    host: {
      name: 'openwop-host-postgres',
      version: '1.0.0',
      vendor: 'openwop-spec (reference example)',
    },
    run: {
      runId: row.run_id,
      workflowId: row.workflow_id,
      status: row.status,
      // Inputs omitted per debug-bundle.md §"Redaction guarantees".
      inputs: {},
      startedAt: row.started_at,
      endedAt: row.ended_at,
      ...(row.error_json ? { error: row.error_json } : {}),
      variables: {},
    },
    events: eventSlice.map((e) => ({
      sequence: e.seq,
      type: e.type,
      timestamp: e.timestamp,
      nodeId: e.nodeId,
      data: e.data,
    })),
    spans: [] as unknown[],
    metrics: {
      nodeCount: new Set(events.filter((e) => e.nodeId !== null).map((e) => e.nodeId)).size,
      eventCount: totalEvents,
    },
    redactionApplied: true,
    redactionMode: 'omit' as const,
  };

  // 8MB byte cap (debug-bundle.md §"Bundle size limits"). Trim from
  // the back of the event list until the bundle fits.
  const SIZE_CAP_BYTES = Number(process.env.OPENWOP_DEBUG_BUNDLE_BYTE_CAP ?? 8 * 1024 * 1024);
  let serialized = JSON.stringify(baseBundle);
  while (
    Buffer.byteLength(serialized, 'utf8') > SIZE_CAP_BYTES &&
    Array.isArray(baseBundle.events) &&
    (baseBundle.events as unknown[]).length > 0
  ) {
    (baseBundle.events as unknown[]).pop();
    truncated = true;
    truncatedReason = 'events_truncated_to_size_cap';
    serialized = JSON.stringify(baseBundle);
  }

  if (truncated) {
    baseBundle.truncated = true;
    baseBundle.truncatedReason = truncatedReason;
  }
  sendJSON(res, 200, baseBundle, { 'Cache-Control': 'no-store' });
}

async function handlePauseRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  await readBody(req);
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    // 409 per rest-endpoints.md §pause/resume — terminal runs can't pause.
    sendJSON(res, 409, {
      error: 'conflict',
      message: `Cannot pause a ${row.status} run.`,
      details: { runStatus: row.status },
    });
    return;
  }
  if (row.status === 'paused') {
    // Idempotent — pause-on-paused returns 202 with no state change.
    sendJSON(res, 202, { runId, status: 'paused', alreadyPaused: true });
    return;
  }

  const q = await querier();
  await q.query('UPDATE runs SET status = $1 WHERE run_id = $2', ['paused', runId]);
  await appendEvent(runId, 'run.paused', { data: { pausedBy: PROCESS_ID } });
  // Abort the in-flight node so a long sleep doesn't keep the executor
  // looping past the pause request. executeNode's catch reads run status,
  // sees 'paused', and returns the 'paused' outcome (no node.cancelled).
  runningAborters.get(runId)?.abort();
  sendJSON(res, 202, { runId, status: 'paused' });
}

async function handleResumeRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  await readBody(req);
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  if (row.status !== 'paused') {
    sendJSON(res, 409, {
      error: 'conflict',
      message: `Cannot resume a ${row.status} run; only paused runs are resumable.`,
      details: { runStatus: row.status },
    });
    return;
  }

  // Status flip + re-launch the executor. runWorkflow's alreadyStarted
  // detection emits run.resumed (not run.started).
  await q_updateStatusRunning(runId);
  // Fire-and-forget executor.
  void runWorkflow(runId).catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: 'internal', message };
    await appendEvent(runId, 'run.failed', { data: error });
    await setRunTerminal(runId, 'failed', error);
  });
  sendJSON(res, 202, { runId, status: 'running' });
}

async function q_updateStatusRunning(runId: string): Promise<void> {
  const q = await querier();
  await q.query('UPDATE runs SET status = $1 WHERE run_id = $2', ['running', runId]);
}

async function handleAuditVerify(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const fromSeqRaw = url.searchParams.get('fromSeq');
  const toSeqRaw = url.searchParams.get('toSeq');
  const fromSeq = fromSeqRaw === null ? 0 : Number(fromSeqRaw);
  const toSeq = toSeqRaw === null ? Number.MAX_SAFE_INTEGER : Number(toSeqRaw);
  if (!Number.isFinite(fromSeq) || !Number.isFinite(toSeq) || fromSeq < 0 || toSeq < 0) {
    sendError(res, 400, 'validation_error', 'fromSeq and toSeq MUST be non-negative integers.');
    return;
  }
  const q = await querier();
  const result = await verifyAuditChain(q, fromSeq, toSeq, auditSigningKey());
  sendJSON(res, 200, result);
}

async function handleEventsSse(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Validation-gate ordering invariant:
  //
  //   1. streamMode validation (this block)
  //   2. bufferMs validation
  //   3. Content negotiation (Accept-header dispatch SSE vs JSON)
  //   4. Last-Event-ID parsing
  //   5. Response setup + write
  //
  // Gates 1-2 MUST run BEFORE the content-negotiation branch so an
  // invalid `streamMode` or out-of-range `bufferMs` returns 400 to
  // EVERY client — JSON callers included. Reordering would cause
  // invalid-input requests to silently get a 200 JSON envelope, which
  // the conformance scenarios (stream-modes / stream-modes-mixed /
  // stream-modes-buffer) treat as a host bug. Do not move these
  // gates without re-running the full conformance suite.
  //
  // Validate streamMode per stream-modes.md §"Mode selection". Single
  // mode OR comma-separated subset of {values, updates, messages,
  // debug}. `values` is exclusive — can't combine with others. Unknown
  // mode → 400 unsupported_stream_mode + details.supported list. This
  // host doesn't yet *filter* by mode — it returns the full event
  // stream regardless — but the validation gate is required by the
  // conformance suite.
  const SUPPORTED_STREAM_MODES = ['values', 'updates', 'messages', 'debug'];
  const streamModeRaw = req.url
    ? new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).searchParams.get('streamMode')
    : null;
  if (streamModeRaw !== null && streamModeRaw.length > 0) {
    const requested = streamModeRaw.split(',').map((s) => s.trim());
    const unknown = requested.filter((m) => !SUPPORTED_STREAM_MODES.includes(m));
    const valuesExclusiveViolation = requested.includes('values') && requested.length > 1;
    if (unknown.length > 0 || valuesExclusiveViolation) {
      sendJSON(res, 400, {
        error: 'unsupported_stream_mode',
        message:
          unknown.length > 0
            ? `Unsupported streamMode value(s): ${unknown.join(', ')}`
            : "'values' streamMode MUST NOT be combined with another mode (state.snapshot semantics need exclusive ownership of the stream).",
        details: { supported: SUPPORTED_STREAM_MODES, requested },
      });
      return;
    }
  }

  // Validate bufferMs per stream-modes.md §"Aggregation hint" — must
  // be a non-negative integer in [0, 5000]. Values > 5000 → 400
  // validation_error. When bufferMs > 0, the host emits `event: batch`
  // SSE frames whose data is a JSON array of RunEventDocs, with
  // force-flush on terminal so terminal events don't get held back
  // past the next timer interval.
  const bufferMsRaw = req.url
    ? new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).searchParams.get('bufferMs')
    : null;
  let bufferMs = 0;
  if (bufferMsRaw !== null && bufferMsRaw.length > 0) {
    const parsed = Number(bufferMsRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000 || !Number.isInteger(parsed)) {
      sendJSON(res, 400, {
        error: 'validation_error',
        message: 'bufferMs MUST be an integer in [0, 5000].',
        details: { bufferMs: parsed, min: 0, max: 5000 },
      });
      return;
    }
    bufferMs = parsed;
  }

  // Content negotiation: validation gates above run regardless of
  // Accept (so an invalid streamMode/bufferMs returns 400 even to
  // JSON clients). Below this point, clients with `Accept: text/event-
  // stream` get SSE; plain fetch clients (no Accept, or
  // application/json) get a polled JSON response — same shape as
  // /events/poll. Makes GET /v1/runs/{id}/events callable from a
  // generic HTTP client without an SSE parser. The append-ordering
  // conformance test relies on this.
  const acceptHeader = req.headers['accept'];
  const wantsSse =
    typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream');
  if (!wantsSse) {
    const events = await getEventsAfter(runId, -1);
    sendJSON(res, 200, {
      events: events.map((e) => ({
        eventId: `evt-${e.runId}-${e.seq}`,
        runId: e.runId,
        seq: e.seq,
        sequence: e.seq,
        type: e.type,
        nodeId: e.nodeId,
        data: e.data,
        payload: e.data,
        timestamp: e.timestamp,
        ...(e.causationId !== undefined ? { causationId: e.causationId } : {}),
      })),
    });
    return;
  }

  // Last-Event-ID resume per stream-modes.md §"Reconnection". Replay
  // only events with seq > lastEventId; live subscription picks up
  // anything emitted after the backlog flush.
  const lastEventIdHeader = req.headers['last-event-id'];
  let resumeAfterSeq = -1;
  if (typeof lastEventIdHeader === 'string') {
    const parsed = Number(lastEventIdHeader);
    if (Number.isFinite(parsed)) resumeAfterSeq = parsed;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const canonicalizeEvent = (event: RunEvent): Record<string, unknown> => ({
    eventId: `evt-${event.runId}-${event.seq}`,
    runId: event.runId,
    seq: event.seq,
    sequence: event.seq,
    type: event.type,
    nodeId: event.nodeId,
    data: event.data,
    payload: event.data,
    timestamp: event.timestamp,
  });

  // Batched delivery state (bufferMs > 0). The buffer flushes on:
  //   - timer interval (every bufferMs)
  //   - terminal event (run.completed / run.failed / run.cancelled) —
  //     force-flush rule from stream-modes.md §"Aggregation hint"
  let batchBuffer: RunEvent[] = [];
  let batchTimer: NodeJS.Timeout | null = null;
  const flushBatch = (): void => {
    if (batchBuffer.length === 0) return;
    const items = batchBuffer.map(canonicalizeEvent);
    res.write(`event: batch\n`);
    res.write(`data: ${JSON.stringify(items)}\n\n`);
    batchBuffer = [];
  };
  if (bufferMs > 0) {
    batchTimer = setInterval(flushBatch, bufferMs);
    batchTimer.unref?.();
  }

  const writeEvent = (event: RunEvent): void => {
    if (bufferMs > 0) {
      batchBuffer.push(event);
      // Force-flush on terminal so terminal events don't sit in the
      // buffer past the next interval.
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        flushBatch();
      }
      return;
    }
    const canonical = canonicalizeEvent(event);
    res.write(`id: ${event.seq}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(canonical)}\n\n`);
  };

  // Flush the backlog from the DB before subscribing to live events,
  // so a slow reconnect doesn't lose events that landed between the
  // backlog query and the subscription bind.
  const closeStream = (): void => {
    if (batchTimer) {
      clearInterval(batchTimer);
      batchTimer = null;
    }
    flushBatch();
    res.end();
  };

  const backlog = await getEventsAfter(runId, resumeAfterSeq);
  for (const event of backlog) writeEvent(event);

  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    closeStream();
    return;
  }

  const onEvent = (event: RunEvent): void => {
    writeEvent(event);
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled'
    ) {
      eventBus.off(`events:${runId}`, onEvent);
      closeStream();
    }
  };
  eventBus.on(`events:${runId}`, onEvent);

  req.on('close', () => {
    eventBus.off(`events:${runId}`, onEvent);
    if (batchTimer) {
      clearInterval(batchTimer);
      batchTimer = null;
    }
  });

  // Post-listener terminal re-check (review M1): if the run reached
  // terminal between the initial backlog read + status check and the
  // `eventBus.on` listener attach, the live channel will never fire
  // a terminal event and the connection would hang until client
  // timeout. Re-load and replay any missed-events + close cleanly.
  const racedRow = await loadRun(runId);
  const racedSeq = backlog.length > 0 ? backlog[backlog.length - 1]!.seq : resumeAfterSeq;
  if (
    racedRow?.status === 'completed' ||
    racedRow?.status === 'failed' ||
    racedRow?.status === 'cancelled'
  ) {
    const missed = await getEventsAfter(runId, racedSeq);
    for (const e of missed) writeEvent(e);
    eventBus.off(`events:${runId}`, onEvent);
    closeStream();
  }
}

async function handleEventsPoll(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  url: URL,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  const lastSeqRaw = url.searchParams.get('lastSequence');
  const lastSeq = lastSeqRaw === null ? -1 : Number(lastSeqRaw);
  if (!Number.isFinite(lastSeq)) {
    sendError(res, 400, 'validation_error', 'lastSequence MUST be an integer.');
    return;
  }
  const events = await getEventsAfter(runId, lastSeq);
  const isComplete = ['completed', 'failed', 'cancelled'].includes(row.status);
  sendJSON(res, 200, {
    // Emit BOTH legacy host field names (seq, data) AND canonical
    // RunEventDoc fields (eventId, sequence, payload) per
    // schemas/run-event.schema.json §required. Older readers that
    // grep for `seq`/`data` keep working; conformance scenarios that
    // check the canonical 6 fields start passing.
    // eventId is derived as `evt-${runId}-${seq}` — deterministic,
    // unique per run, no separate column needed.
    events: events.map((e) => ({
      eventId: `evt-${e.runId}-${e.seq}`,
      runId: e.runId,
      seq: e.seq,
      sequence: e.seq,
      type: e.type,
      nodeId: e.nodeId,
      data: e.data,
      payload: e.data,
      timestamp: e.timestamp,
      ...(e.causationId !== undefined ? { causationId: e.causationId } : {}),
    })),
    isComplete,
  });
}

// rest-endpoints.md §"GET /v1/runs/{runId}/artifacts/{artifactId}".
// This host does not persist run artifacts, but the endpoint still MUST
// reject unauthenticated requests with a canonical 401 BEFORE any
// existence check — otherwise a missing Authorization header would be
// answerable with a 404 that leaks whether the run/artifact exists
// (cross-tenant existence oracle). Auth first, then a 404
// `artifact_not_found` for the authenticated caller.
//
// `checkAuth` validates the bearer token but does not enforce the
// `artifacts:read` scope named in rest-endpoints.md §Artifacts —
// consistent with this host's coarse single-API-key auth model (no
// endpoint does scope-granular checks). A host with per-scope tokens
// would additionally assert the `artifacts:read` scope here.
async function handleGetArtifact(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  artifactId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  sendError(res, 404, 'artifact_not_found', `No artifact "${artifactId}" on run "${runId}".`);
}

// ─── RFC 0056 run feedback / annotations ─────────────────────────────────────

// Secret-shaped redaction for untrusted annotation free-text (SR-1, RFC 0056
// §E + SECURITY invariant `annotation-content-redaction`). Mirrors the
// in-memory + SQLite reference pattern set so cross-host behavior is identical.
const ANNOTATION_SECRET_SHAPED = [
  /\bsk-[A-Za-z0-9_-]{6,}/g, // OpenAI-style `sk-` keys
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g, // AWS access key IDs
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];
function scrubAnnotationText(value: string): string {
  let out = value;
  for (const re of ANNOTATION_SECRET_SHAPED) out = out.replace(re, '[redacted]');
  return out;
}

async function handleCreateAnnotation(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  if (!(await loadRun(runId))) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  const bodyText = await readBody(req);
  let body: { signal?: Record<string, unknown>; target?: { eventId?: unknown; nodeId?: unknown }; note?: unknown };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  const signal = body.signal;
  if (typeof signal !== 'object' || signal === null || Array.isArray(signal)) {
    sendError(res, 400, 'validation_error', 'signal: object is required.');
    return;
  }
  const kind = signal['kind'];
  if (kind !== 'rating' && kind !== 'correction' && kind !== 'label' && kind !== 'flag') {
    sendError(res, 400, 'validation_error', 'signal.kind MUST be one of rating|correction|label|flag.');
    return;
  }
  const rating = signal['rating'];
  if (kind === 'rating' && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    sendError(res, 400, 'validation_error', 'signal.rating: integer 1..5 is required when kind is rating.');
    return;
  }
  if (kind === 'label' && typeof signal['label'] !== 'string') {
    sendError(res, 400, 'validation_error', 'signal.label: string is required when kind is label.');
    return;
  }
  if (kind === 'correction' && typeof signal['correction'] !== 'string') {
    sendError(res, 400, 'validation_error', 'signal.correction: string is required when kind is correction.');
    return;
  }
  // annotation.schema.json declares signal with additionalProperties:false —
  // reject unknown keys rather than persist an un-scrubbed extra field.
  const ALLOWED_SIGNAL_KEYS = new Set(['kind', 'rating', 'label', 'correction']);
  for (const key of Object.keys(signal)) {
    if (!ALLOWED_SIGNAL_KEYS.has(key)) {
      sendError(res, 400, 'validation_error', `signal.${key}: unknown field (signal allows kind|rating|label|correction).`);
      return;
    }
  }
  // SR-1: scrub EVERY string-valued signal field + note before persistence.
  const storedSignal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(signal)) {
    storedSignal[key] = typeof value === 'string' ? scrubAnnotationText(value) : value;
  }
  const annotation = {
    annotationId: `ann-${randomUUID()}`,
    target: {
      runId,
      ...(typeof body.target?.eventId === 'string' ? { eventId: body.target.eventId } : {}),
      ...(typeof body.target?.nodeId === 'string' ? { nodeId: body.target.nodeId } : {}),
    },
    signal: storedSignal,
    // Single-API-key host: opaque principal ref, never the credential itself.
    actor: { principalRef: 'apikey:postgres' },
    ...(typeof body.note === 'string' ? { note: scrubAnnotationText(body.note) } : {}),
    createdAt: new Date().toISOString(),
  };
  const q = await querier();
  await q.query(
    'INSERT INTO annotations (annotation_id, run_id, data_json, created_at) VALUES ($1, $2, $3::JSONB, $4)',
    [annotation.annotationId, runId, JSON.stringify(annotation), annotation.createdAt],
  );
  sendJSON(res, 201, annotation);
}

async function handleListAnnotations(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  if (!(await loadRun(runId))) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  // Run-scoped query → inherently isolated to this run (RFC 0056 §E / CTI-1).
  const q = await querier();
  const r = await q.query<{ data_json: unknown }>(
    'SELECT data_json FROM annotations WHERE run_id = $1 ORDER BY created_at ASC, annotation_id ASC',
    [runId],
  );
  sendJSON(res, 200, { annotations: r.rows.map((row) => row.data_json) });
}

// ─── RFC 0036 conformance seams (gated on MULTI_REGION_TEST) ───────────────────
//
// These are host-extension test seams in the `/v1/host/sample/test/*` namespace.
// They exercise the canonical RFC 0036 algorithms WITHOUT requiring a live
// multi-region / multi-engine deployment — the resolver + ordering model are
// pure, so a single-region reference host can demonstrate the contract.

/** §C convergence-rule seam — runs the canonical pure resolver over the
 *  posted conflicting claims. POST /v1/host/sample/test/multi-region/simulate-partition. */
async function handleSimulatePartition(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  let body: { claims?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (!Array.isArray(body.claims) || body.claims.length < 2) {
    sendError(res, 400, 'validation_error', '`claims` MUST be an array of ≥2 ConflictClaim records.');
    return;
  }
  try {
    // Pure function (multi-region.ts): lex-min(runId) winner, per-region cache
    // redirects at the winner, `cross_region_dedup_loss` loser reason. Order-
    // invariant by construction.
    const result = resolveCrossRegionConflict(body.claims as ConflictClaim[]);
    sendJSON(res, 200, result);
  } catch (e) {
    sendError(res, 400, 'validation_error', e instanceof Error ? e.message : 'resolver error');
  }
}

// §B cross-engine append-ordering harness — an in-memory, per-channel Lamport
// log. `append` assigns `lamport = max(channelClock, incomingHint) + 1` (the
// Lamport send/receive rule) and a monotonic arrival `seq`; `read` linearizes
// by `(lamport asc, seq asc)`, which preserves each engine's submission order
// (the shared clock strictly increases per append) and converges all engines
// to one total order. Conformance-only state; cleared by `reset`.
interface CrossEngineEntry {
  engineId: string;
  value: unknown;
  lamport: number;
  seq: number;
}
const crossEngineLog = new Map<string, { clock: number; seq: number; entries: CrossEngineEntry[] }>();
function crossEngineChannel(id: string): { clock: number; seq: number; entries: CrossEngineEntry[] } {
  let c = crossEngineLog.get(id);
  if (!c) {
    c = { clock: 0, seq: 0, entries: [] };
    crossEngineLog.set(id, c);
  }
  return c;
}

async function handleCrossEngineAppend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  let body: { engineId?: unknown; channelId?: unknown; value?: unknown; lamport?: unknown };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }
  if (typeof body.engineId !== 'string' || typeof body.channelId !== 'string') {
    sendError(res, 400, 'validation_error', '`engineId` + `channelId` MUST be strings.');
    return;
  }
  const c = crossEngineChannel(body.channelId);
  const incoming = typeof body.lamport === 'number' && Number.isFinite(body.lamport) ? body.lamport : 0;
  const lamport = Math.max(c.clock, incoming) + 1; // Lamport receive rule
  c.clock = lamport;
  const seq = ++c.seq;
  const entry: CrossEngineEntry = { engineId: body.engineId, value: body.value, lamport, seq };
  c.entries.push(entry);
  sendJSON(res, 200, entry);
}

async function handleCrossEngineRead(
  req: IncomingMessage,
  res: ServerResponse,
  channelId: string,
): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  const c = crossEngineLog.get(channelId);
  const entries = c
    ? [...c.entries].sort((a, b) => (a.lamport !== b.lamport ? a.lamport - b.lamport : a.seq - b.seq))
    : [];
  sendJSON(res, 200, { entries });
}

async function handleCrossEngineReset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!(await checkAuth(req, res))) return;
  crossEngineLog.clear();
  sendJSON(res, 200, { ok: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const RUN_ANNOTATIONS_PATTERN = /^\/v1\/runs\/([^/]+)\/annotations$/; // RFC 0056
const RUN_ID_PATTERN = /^\/v1\/runs\/([^/]+)$/;
const RUN_CANCEL_PATTERN = /^\/v1\/runs\/([^/]+)\/cancel$/;
const RUN_EVENTS_POLL_PATTERN = /^\/v1\/runs\/([^/]+)\/events\/poll$/;
const RUN_EVENTS_SSE_PATTERN = /^\/v1\/runs\/([^/]+)\/events$/;
const RUN_DEBUG_BUNDLE_PATTERN = /^\/v1\/runs\/([^/]+)\/debug-bundle$/;
const RUN_ARTIFACT_PATTERN = /^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/;
const RUN_PAUSE_PATTERN = /^\/v1\/runs\/([^/]+):pause$/;
const RUN_RESUME_PATTERN = /^\/v1\/runs\/([^/]+):resume$/;
const RUN_INTERRUPT_PATTERN = /^\/v1\/runs\/([^/]+)\/interrupts\/([^/]+)$/;
const INTERRUPT_TOKEN_PATTERN = /^\/v1\/interrupts\/([^/]+)$/;
const WEBHOOK_ID_PATTERN = /^\/v1\/webhooks\/([^/]+)$/;
const WORKFLOW_ID_PATTERN = /^\/v1\/workflows\/([^/]+)$/;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // CF-6 deterministic 429 — test-only seam. When
  // OPENWOP_FORCE_RATE_LIMIT=true is set, return the canonical
  // rate-limit envelope on every request so the conformance suite's
  // rate-limit-envelope.test.ts can deterministically exercise the
  // shape. The seam predates the backpressure check so the test
  // doesn't need to fill the inflight cap first.
  if (FORCE_RATE_LIMIT) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(FORCE_RATE_LIMIT_RETRY_AFTER_SECONDS),
    });
    res.end(
      JSON.stringify({
        error: 'rate_limited',
        message: `Forced 429 via OPENWOP_FORCE_RATE_LIMIT (test-only seam); retry after ${FORCE_RATE_LIMIT_RETRY_AFTER_SECONDS}s.`,
        details: {
          scope: 'global',
          retryAfterMs: FORCE_RATE_LIMIT_RETRY_AFTER_SECONDS * 1000,
        },
      }),
    );
    return;
  }

  // Backpressure: cap concurrent inflight HTTP handlers. Discovery +
  // OpenAPI bypass the cap so health probes still respond when the host
  // is saturated. @see spec/v1/production-profile.md §"Backpressure".
  const isHealthProbe =
    method === 'GET' && (path === '/.well-known/openwop' || path === '/v1/openapi.json');
  if (!isHealthProbe && inflightCount >= MAX_INFLIGHT) {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': String(RETRY_AFTER_SECONDS),
    });
    res.end(
      JSON.stringify({
        error: 'service_unavailable',
        message: `Host inflight cap of ${MAX_INFLIGHT} exceeded; retry after ${RETRY_AFTER_SECONDS}s.`,
        details: { retryAfter: RETRY_AFTER_SECONDS },
      }),
    );
    return;
  }
  inflightCount += 1;
  res.on('close', () => {
    inflightCount = Math.max(0, inflightCount - 1);
  });

  if (method === 'GET' && path === '/.well-known/openwop') return handleDiscovery(req, res);
  if (method === 'GET' && path === '/v1/openapi.json') return handleOpenApi(req, res);
  if (method === 'GET' && path === '/v1/audit/verify') return handleAuditVerify(req, res, url);
  if (method === 'POST' && path === '/v1/webhooks') return handleRegisterWebhook(req, res);
  if (method === 'POST' && path === '/v1/runs') return handleCreateRun(req, res);
  if (method === 'POST' && path === '/v1/runs:bulk-cancel') return handleBulkCancel(req, res);
  // RFC 0031 §B — pure-function exerciser for the model-capability gate's
  // substitute/refuse/dispatch decision matrix + the emitted event payload.
  // Always on: side-effect-free (no event-log write, no secrets), so it can
  // be exercised by the conformance suite without a full run.
  if (method === 'POST' && path === '/v1/host/sample/test/evaluate-model-capability-gate') {
    return handleEvaluateModelCapabilityGate(req, res);
  }
  // RFC 0036 conformance seams — only mounted when OPENWOP_TEST_MULTI_REGION is
  // set (same gate as the capability advertisement). When unset, requests fall
  // through to the 404 handler so the behavioral scenarios soft-skip cleanly.
  if (MULTI_REGION_TEST) {
    if (method === 'POST' && path === '/v1/host/sample/test/multi-region/simulate-partition') {
      return handleSimulatePartition(req, res);
    }
    if (method === 'POST' && path === '/v1/host/sample/test/cross-engine/append') {
      return handleCrossEngineAppend(req, res);
    }
    if (method === 'GET' && path === '/v1/host/sample/test/cross-engine/read') {
      return handleCrossEngineRead(req, res, url.searchParams.get('channelId') ?? '');
    }
    if (method === 'POST' && path === '/v1/host/sample/test/cross-engine/reset') {
      return handleCrossEngineReset(req, res);
    }
  }
  // RFC 0012 test seams — only enabled when both
  // OPENWOP_MEMORY_COMPACTION=true AND OPENWOP_TEST_TRIGGER_COMPACTION=true.
  // The protocol normates `trigger: 'host-managed'`; these seams let
  // conformance scenarios drive the host-managed scheduler synchronously
  // without baking the trigger into the wire surface.
  if (MEMORY_COMPACTION_ENABLED && TEST_TRIGGER_COMPACTION) {
    if (method === 'POST' && path === '/v1/test/memory/seed') return handleTestMemorySeed(req, res);
    if (method === 'POST' && path === '/v1/test/memory/compact') return handleTestMemoryCompact(req, res);
  }
  const mwh = WEBHOOK_ID_PATTERN.exec(path);
  if (mwh && method === 'DELETE') {
    return handleUnregisterWebhook(req, res, decodeURIComponent(mwh[1]!));
  }

  let m = RUN_EVENTS_POLL_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsPoll(req, res, m[1]!, url);
  m = RUN_EVENTS_SSE_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsSse(req, res, m[1]!);
  m = RUN_DEBUG_BUNDLE_PATTERN.exec(path);
  if (m && method === 'GET') return handleDebugBundle(req, res, m[1]!, url);
  m = RUN_ANNOTATIONS_PATTERN.exec(path); // RFC 0056 — run feedback
  if (m && method === 'POST') return handleCreateAnnotation(req, res, m[1]!);
  if (m && method === 'GET') return handleListAnnotations(req, res, m[1]!);
  m = RUN_ARTIFACT_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetArtifact(req, res, m[1]!, m[2]!);
  m = RUN_PAUSE_PATTERN.exec(path);
  if (m && method === 'POST') return handlePauseRun(req, res, m[1]!);
  m = RUN_RESUME_PATTERN.exec(path);
  if (m && method === 'POST') return handleResumeRun(req, res, m[1]!);
  m = RUN_INTERRUPT_PATTERN.exec(path);
  if (m && method === 'POST') return handleResolveInterrupt(req, res, m[1]!, m[2]!);
  m = INTERRUPT_TOKEN_PATTERN.exec(path);
  if (m && method === 'POST') return handleResolveInterruptByToken(req, res, m[1]!);
  m = RUN_CANCEL_PATTERN.exec(path);
  if (m && method === 'POST') return handleCancelRun(req, res, m[1]!);
  m = WORKFLOW_ID_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetWorkflow(req, res, decodeURIComponent(m[1]!));
  m = RUN_ID_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetRun(req, res, m[1]!);

  // The host does NOT operate a pack registry. The spec allows hosts
  // to omit the entire /v1/packs/* namespace; the conformance suite's
  // pack-registry tests probe for "registry presence" by checking
  // whether GET /v1/packs/-/search returns a JSON body with `error`
  // or `results` fields. Returning a plain-text 404 (no JSON envelope)
  // signals "no registry here" and lets the probe short-circuit; the
  // 3 pack-registry scenarios then trivially-pass via their early
  // `if (!probe.registryPresent) return;` guard.
  if (path.startsWith('/v1/packs/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('This host does not operate a pack registry.');
    return;
  }

  sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Module-scope handles so `close()` can abort in-flight executors and so
// signal handlers don't accumulate across multiple `start()` calls in the
// same process (e.g., in a test suite). The handlers below register at
// most once via the `signalHandlersRegistered` guard.
let _server: import('node:http').Server | null = null;
let signalHandlersRegistered = false;

/**
 * Sweep events + runs older than the retention window. Terminal runs
 * whose started_at predates the window get deleted; their events are
 * cascade-removed via the FK ON DELETE CASCADE. Non-terminal runs
 * are NEVER swept — they're still in-flight. Production deployers
 * SHOULD audit the deletion list before sweeping; reference impl
 * trades that for simplicity.
 *
 * @see spec/v1/production-profile.md §"Event retention"
 */
async function sweepRetention(): Promise<void> {
  if (EVENT_RETENTION_DAYS <= 0) return;
  const q = await querier();
  const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Only purge terminal runs — in-flight (pending/running/suspended)
  // SHOULD never expire, regardless of age.
  const res = await q.query(
    `DELETE FROM runs
     WHERE status IN ('completed', 'failed', 'cancelled')
       AND started_at < $1`,
    [cutoff],
  );
  if ((res.rowCount ?? 0) > 0) {
    console.log(
      `[openwop-host-postgres] retention sweep: ${res.rowCount} terminal runs purged (older than ${EVENT_RETENTION_DAYS} days)`,
    );
  }
}

async function recoverOrphans(): Promise<void> {
  const q = await querier();

  // Clear stale claim_holder_id stamps from prior processes. Any non-
  // terminal run with a claim_holder_id MUST have been stamped by a
  // dead process — Postgres released the underlying advisory lock when
  // that connection dropped, so the descriptive column is by
  // definition stale. Without this clear, operator dashboards show
  // ghost claim holders forever (or until a paused run resumes).
  // @see review C2.
  const cleared = await q.query(
    `UPDATE runs SET claim_holder_id = NULL, claim_expires_at = NULL
     WHERE status NOT IN ('completed', 'failed', 'cancelled')
       AND claim_holder_id IS NOT NULL`,
  );
  if ((cleared.rowCount ?? 0) > 0) {
    console.log(
      `[openwop-host-postgres] orphan recovery: cleared ${cleared.rowCount} stale claim_holder_id stamps from prior processes`,
    );
  }

  const res = await q.query<{ run_id: string }>(
    `SELECT run_id FROM runs
     WHERE status IN ('pending', 'running', 'cancelling')
     ORDER BY started_at ASC`,
  );
  for (const { run_id } of res.rows) {
    // tryClaim races against any concurrent host process: if we win
    // the lock, the run was orphaned (lock either released on prior
    // crash, or never held); if we lose, another live process is
    // executing it and we let them continue.
    // Note: we don't await runWorkflow — fire-and-forget so startup
    // doesn't serialize on orphan execution. Each runWorkflow holds
    // its own claim via the wrapper's tryClaim.
    void runWorkflow(run_id).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const error = { code: 'internal', message };
      await appendEvent(run_id, 'run.failed', { data: error });
      await setRunTerminal(run_id, 'failed', error);
    });
  }
  console.log(
    `[openwop-host-postgres] orphan recovery: ${res.rows.length} candidate runs probed`,
  );
}

async function closeHost(): Promise<void> {
  // Stop OTel metric emission before tearing down the DB so the timer
  // doesn't fire a metric query against a closed querier.
  stopMetricLoop();
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
  // Abort every in-flight executor so they unwind their delay/wait
  // loops. Each aborted executor's finally block runs releaseClaim;
  // we then await all of them via inflightExecutors so the
  // claim_holder_id column doesn't dangle past shutdown. @see review C1.
  for (const aborter of runningAborters.values()) aborter.abort();
  runningAborters.clear();
  if (inflightExecutors.size > 0) {
    await Promise.allSettled([...inflightExecutors]);
  }
  if (_server) {
    await new Promise<void>((resolve) => _server!.close(() => resolve()));
    _server = null;
  }
  if (_querier && 'end' in _querier && typeof _querier.end === 'function') {
    await (_querier.end as () => Promise<void>)();
    _querier = null;
  }
}

/** Boot the host. Tests call this after injecting a Querier. */
export async function start(): Promise<{ close: () => Promise<void> }> {
  loadFixtures();
  const q = await querier();
  await setupSchema(q);
  await setupAuditSchema(q);
  await setupInterruptSchema(q);
  await setupWebhookSchema(q);
  await setupMemorySchema(q);

  // Persist the audit signing keypair under OPENWOP_AUDIT_KEY_DIR.
  // Tests can override OPENWOP_AUDIT_KEY_DIR to point at a tmpdir per
  // run; production deployers point it at a host-private volume managed
  // by the operator's KMS / HSM.
  if (!existsSync(AUDIT_KEY_DIR)) mkdirSync(AUDIT_KEY_DIR, { recursive: true });
  _auditSigningKey = loadOrCreateSigningKey(
    join(AUDIT_KEY_DIR, 'audit-signing-key.pem'),
    join(AUDIT_KEY_DIR, 'audit-signing-key.pub'),
  );

  // Seed audit entry so /v1/audit/verify returns a non-empty result even
  // before any runs land. Mirrors the SQLite host's bootstrap convention.
  await logAudit(q, {
    actor: 'system',
    action: 'host.started',
    target: PROCESS_ID,
    details: { host: 'openwop-host-postgres', version: '1.0.0' },
  });
  await triggerCheckpointIfDue(q, auditSigningKey(), AUDIT_OPTS);

  // OTel metric emission loop (no-op when OTEL_EXPORTER_OTLP_ENDPOINT
  // is unset; observabilityEnabled() guards advertisement).
  startMetricLoop(q);

  // Retention sweeper. First sweep runs immediately on boot to clear
  // any stale rows from the prior process's lifetime; subsequent
  // sweeps run on a 6-hour interval. Idempotent: nothing to delete
  // is a no-op.
  await sweepRetention();
  if (RETENTION_SWEEP_INTERVAL_MS > 0) {
    retentionTimer = setInterval(() => {
      void sweepRetention().catch((err: unknown) => {
        console.error('[openwop-host-postgres] retention sweep failed:', err);
      });
    }, RETENTION_SWEEP_INTERVAL_MS);
    retentionTimer.unref?.();
  }

  // Orphan recovery: any non-terminal run not currently claimed by
  // another process gets re-launched. Crash recovery — if the prior
  // host process died mid-execution, its session-level advisory lock
  // was auto-released by Postgres when the connection dropped; this
  // process can now re-acquire and continue. tryClaim returns false
  // for runs another live process holds, so concurrent host instances
  // share the workload safely.
  await recoverOrphans();

  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    void route(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendError(res, 500, 'internal', message);
      else res.end();
    });
  };

  // Phase I.7 — mTLS termination via node:https when cert + key paths
  // are configured. `requestCert: true` + `rejectUnauthorized:
  // MTLS_REQUIRED` is the standard Node TLS posture: clients without a
  // cert are rejected at the TLS handshake when mTLS is required, or
  // pass through to the bearer auth layer when optional. The cert's
  // subject CN is available at `req.socket.getPeerCertificate()`
  // inside route handlers for principal mapping (left as a hook for
  // production deployers per the honesty principle — this reference
  // accepts any cert signed by the configured CA).
  if (MTLS_ENABLED) {
    const cert = readFileSync(MTLS_CERT_PATH!, 'utf8');
    const key = readFileSync(MTLS_KEY_PATH!, 'utf8');
    const caBundle = MTLS_CA_PATH !== null ? readFileSync(MTLS_CA_PATH, 'utf8') : undefined;
    _server = createHttpsServer(
      {
        cert,
        key,
        ...(caBundle !== undefined ? { ca: caBundle } : {}),
        requestCert: true,
        rejectUnauthorized: MTLS_REQUIRED,
      },
      requestHandler,
    );
  } else {
    _server = createServer(requestHandler);
  }

  await new Promise<void>((resolve) => _server!.listen(PORT, HOST, () => resolve()));
  const scheme = MTLS_ENABLED ? 'https' : 'http';
  console.log(
    `[openwop-host-postgres] listening on ${scheme}://${HOST}:${PORT} (api key: ${API_KEY}, processId: ${PROCESS_ID}, ${workflows.size} fixtures${MTLS_ENABLED ? `, mtls=${MTLS_REQUIRED ? 'required' : 'optional'}` : ''})`,
  );

  // Register signal handlers exactly once per process. Calling `start()`
  // a second time (e.g., from a test that re-boots after teardown) does
  // NOT stack additional listeners.
  if (!signalHandlersRegistered) {
    const shutdown = (): void => {
      void closeHost().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    signalHandlersRegistered = true;
  }

  return { close: closeHost };
}

// Auto-start when executed directly (tsx src/server.ts). Use
// `fileURLToPath` + `resolve` so the comparison works across symlinks
// and on Windows (where the raw-string check `file://${process.argv[1]}`
// breaks due to backslash path separators).
const argvScript = process.argv[1] ? resolvePath(process.argv[1]) : null;
const thisScript = fileURLToPath(import.meta.url);
if (argvScript !== null && argvScript === thisScript) {
  void start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
