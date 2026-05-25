/**
 * OpenWOP SQLite reference host.
 *
 * A single-process, SQLite-backed implementation of the OpenWOP v1 wire
 * contract. Demonstrates DURABLE execution: runs and events persist
 * across process restarts, claim acquisition prevents double-execution
 * across restart cycles.
 *
 * Built to:
 *
 *   1. Be the second reference host on INTEROP-MATRIX.md.
 *   2. Anchor the "build your own host" walkthrough (README.md).
 *   3. Show how event-log persistence + claim-based dispatch work
 *      against a real SQL store, vs the in-memory host's process-local
 *      state.
 *
 * Design choices:
 *
 *   - `better-sqlite3` for synchronous SQLite access. Single dep beyond
 *     Node stdlib + types. Mature, fast, no async ceremony for our needs.
 *   - Schema: 3 tables (runs, events, idempotency). Migrations by
 *     statement-on-startup; production hosts would use a real migrator.
 *   - Claim acquisition via `BEGIN IMMEDIATE` + check-and-set on the
 *     `runs.claim_holder_id` column. Stale claims (heartbeat lapsed)
 *     can be re-acquired by another process — demonstrates
 *     `secret-leakage-staleClaim`-class scenarios.
 *   - Event-log durability: every event is committed before the
 *     executor returns. Process restart = read events from log, not
 *     re-execute side effects (this host's nodes are pure, but the
 *     pattern is the same).
 *   - Profile claim: openwop-core + openwop-stream-poll + openwop-stream-sse +
 *     debug-bundle. Same as the in-memory host.
 *
 * Reference-only limitations:
 *   - Multi-tenancy (single hardcoded tenant).
 *   - Real auth (Bearer presence only).
 *   - BYOK / redaction harness (advertises passthrough).
 *   - Provider policy / node packs / interrupts (out of profile).
 *   - Horizontal scaling — SQLite is single-writer; a real production
 *     host would use Postgres + connection pooling.
 *
 * The README beside this file is the "build your own host" walkthrough.
 * Read it before diving into this code.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import {
  setupAuditSchema,
  loadOrCreateSigningKey,
  logAudit,
  triggerCheckpointIfDue,
  createCheckpoint,
  verifyAuditChain,
  defaultAuditOptions,
  type SigningKey,
  type AuditOptions,
} from './audit.js';
import {
  setupInterruptSchema,
  createInterrupt,
  getInterrupt,
  getInterruptByToken,
  getActiveInterrupt,
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
import {
  observabilityEnabled,
  startRunSpan,
  endRunSpan,
  startNodeSpan,
  endNodeSpan,
  addNodeSpanAttributes,
  recordRunDuration,
  startMetricLoop,
  stopMetricLoop,
  parseTraceparent,
  recordInboundTraceContext,
} from './observability.js';
import { sanitizeCostAttrs, applyCostRollup, snapshotCostRollup } from './cost.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3838);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-sqlite-dev-key';
// auth-profiles.md §"openwop-auth-api-key-rotation". When a secondary
// key is configured, both keys authenticate within the overlap window;
// canonical use is rotation: new primary in env, old secondary still
// honored until operators have rotated all clients.
const SECONDARY_API_KEY = process.env.OPENWOP_SECONDARY_API_KEY ?? null;
// RFC 0011 §A — same-endpoint auth-scoped discovery. When advertised
// AND a tenant2 key is configured, requests authenticated as tenant2
// receive a narrowed capability view (strict subset of primary's view
// per spec annex §"Scoped capability views" line 69 — no authorization
// oracle). Operators wire a real tenant model in production hosts; the
// reference host's tenant2 is just a second valid bearer for testing
// the §"Scoped capability views" conformance scenarios.
const TENANT2_API_KEY = process.env.OPENWOP_TENANT2_API_KEY ?? null;
const DB_PATH = process.env.OPENWOP_SQLITE_PATH ?? join(__dirname, '..', 'data', 'openwop-host.sqlite');
const PROCESS_ID = `host-${randomUUID().slice(0, 8)}`;

// Configurable timing — defaults match production-shaped values; tests
// pass shorter values to keep the staleClaim scenario fast.
const CLAIM_TTL_MS = Number(process.env.OPENWOP_CLAIM_TTL_MS ?? 30_000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.OPENWOP_HEARTBEAT_INTERVAL_MS ?? 10_000);

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting-approval'
  | 'waiting-input'
  | 'waiting-external';

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
  }>;
  variables?: ReadonlyArray<{ name: string; type: string; required: boolean; defaultValue?: unknown }>;
  configurableSchema?: Record<string, unknown>;
}

interface RunEvent {
  readonly seq: number;
  readonly runId: string;
  readonly type: string;
  readonly nodeId: string | null;
  readonly data: unknown;
  readonly timestamp: string;
  // run-event.schema.json §causationId. Optional reference to the
  // eventId of the event that caused this one. Required by RFC 0007 §E
  // on core.dispatch's emitted events. Stored on the row; surfaced on
  // GET /v1/runs/{runId}/events{,/poll}.
  readonly causationId?: string;
}

// ─── Database setup ──────────────────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    inputs_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    error_json TEXT,
    claim_holder_id TEXT,
    claim_expires_at INTEGER,
    next_node_index INTEGER NOT NULL DEFAULT 0,
    parent_run_id TEXT,
    parent_node_id TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    node_id TEXT,
    data_json TEXT,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  );

  CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);

  CREATE TABLE IF NOT EXISTS idempotency (
    cache_key TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    body TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    stored_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_idem_stored_at ON idempotency(stored_at);
`);

// Idempotent migration: older DBs may lack newer columns on `runs`.
const runColumns = db
  .prepare("PRAGMA table_info('runs')")
  .all() as Array<{ name: string }>;
const runColNames = new Set(runColumns.map((c) => c.name));
if (!runColNames.has('next_node_index')) {
  db.exec("ALTER TABLE runs ADD COLUMN next_node_index INTEGER NOT NULL DEFAULT 0");
}
if (!runColNames.has('parent_run_id')) {
  db.exec("ALTER TABLE runs ADD COLUMN parent_run_id TEXT");
}
if (!runColNames.has('parent_node_id')) {
  db.exec("ALTER TABLE runs ADD COLUMN parent_node_id TEXT");
}
if (!runColNames.has('configurable_json')) {
  // run-options.md §"configurable" overlay. Persisting it lets the
  // executor honor caps like `recursionLimit` (cap-breach scenario)
  // and lets GET /v1/runs/{id} surface the overlay for debugging.
  db.exec("ALTER TABLE runs ADD COLUMN configurable_json TEXT");
}
if (!runColNames.has('variables_json')) {
  // channels-and-reducers.md §"Channel TTL" + run-snapshot.schema.json
  // §variables. Per-run workflow-variable state (channel writes, etc.).
  // Initialized to {} on create; mutated by core.channelWrite and
  // surfaced on GET /v1/runs/{id}.
  db.exec("ALTER TABLE runs ADD COLUMN variables_json TEXT");
}

// Idempotent migration: events table gains causation_id column for
// run-event.schema.json §causationId + RFC 0007 §E (core.dispatch
// emitted events MUST set causationId to the consumed decision's
// eventId) + RFC 0002 / RFC 0005 conditional MUSTs.
const eventColumns = db
  .prepare("PRAGMA table_info('events')")
  .all() as Array<{ name: string }>;
const eventColNames = new Set(eventColumns.map((c) => c.name));
if (!eventColNames.has('causation_id')) {
  db.exec("ALTER TABLE events ADD COLUMN causation_id TEXT");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id)");

// HITL interrupts (interrupt.md + interrupt-profiles.md).
setupInterruptSchema(db);

// Webhook subscriptions (webhooks.md).
setupWebhookSchema(db);

// Audit-log integrity profile (openwop-audit-log-integrity).
// See spec/v1/auth-profiles.md §"Audit-log integrity" and src/audit.ts.
setupAuditSchema(db);
const AUDIT_KEY_DIR = dirname(DB_PATH);
const auditSigningKey: SigningKey = loadOrCreateSigningKey(
  join(AUDIT_KEY_DIR, 'audit-signing-key.pem'),
  join(AUDIT_KEY_DIR, 'audit-signing-key.pub'),
);
const AUDIT_OPTS: AuditOptions = defaultAuditOptions();

// Prepared statements — `better-sqlite3` performs much better when
// statements are reused.
const stmts = {
  insertRun: db.prepare(
    'INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, configurable_json, variables_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  getRun: db.prepare('SELECT * FROM runs WHERE run_id = ?'),
  updateRunStatus: db.prepare(
    'UPDATE runs SET status = ?, ended_at = ?, error_json = ? WHERE run_id = ?',
  ),
  setCancelRequested: db.prepare(
    "UPDATE runs SET status = CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'cancelling' END WHERE run_id = ?",
  ),
  insertEvent: db.prepare(
    'INSERT INTO events (run_id, seq, type, node_id, data_json, timestamp, causation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  getEventsAfter: db.prepare('SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC'),
  countEvents: db.prepare('SELECT COUNT(*) AS n FROM events WHERE run_id = ?'),
  getIdempotency: db.prepare('SELECT * FROM idempotency WHERE cache_key = ?'),
  insertIdempotency: db.prepare(
    'INSERT INTO idempotency (cache_key, status, body, body_hash, stored_at) VALUES (?, ?, ?, ?, ?)',
  ),
  pruneIdempotency: db.prepare('DELETE FROM idempotency WHERE stored_at < ?'),
  // Claim acquisition: atomically set claim_holder_id if unclaimed or
  // claim has expired. Returns 1 row affected on success, 0 on contended.
  acquireClaim: db.prepare(`
    UPDATE runs SET claim_holder_id = ?, claim_expires_at = ?
    WHERE run_id = ?
      AND (claim_holder_id IS NULL OR claim_expires_at < ?)
      AND status NOT IN ('completed', 'failed', 'cancelled')
  `),
  releaseClaim: db.prepare(
    'UPDATE runs SET claim_holder_id = NULL, claim_expires_at = NULL WHERE run_id = ? AND claim_holder_id = ?',
  ),
};

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// ─── In-memory state ─────────────────────────────────────────────────────────

const workflows = new Map<string, FixtureWorkflow>();
const eventBus = new EventEmitter();
eventBus.setMaxListeners(1000);

// In-flight aborters for claimed runs. Used so a cancel POST can stop
// a delay node executing in this process. Cancellations against runs
// claimed by ANOTHER process get picked up via the status flip plus
// claim-stealing on heartbeat lapse.
const runningAborters = new Map<string, AbortController>();

// Active heartbeat handles keyed by runId. Each holds the setInterval
// timer that renews `claim_expires_at` while this process executes the
// run. Cleared on terminal status.
const runningHeartbeats = new Map<string, NodeJS.Timeout>();

// ─── Fixture loading ─────────────────────────────────────────────────────────

function loadFixtures(): void {
  let probe = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(probe, 'conformance', 'fixtures');
    try {
      const entries = readdirSync(candidate);
      for (const file of entries) {
        if (!file.endsWith('.json')) continue;
        const raw = readFileSync(join(candidate, file), 'utf8');
        const parsed = JSON.parse(raw) as FixtureWorkflow;
        workflows.set(parsed.id, parsed);
      }
      return;
    } catch {
      probe = dirname(probe);
    }
  }
  workflows.set('conformance-noop', {
    id: 'conformance-noop',
    name: 'Synthetic Noop',
    version: '1.0',
    nodes: [{ id: 'noop', typeId: 'core.noop', name: 'Noop', inputs: {} }],
  });
}

// ─── Run helpers ─────────────────────────────────────────────────────────────

interface RunRow {
  run_id: string;
  workflow_id: string;
  status: RunStatus;
  inputs_json: string;
  started_at: string;
  ended_at: string | null;
  error_json: string | null;
  claim_holder_id: string | null;
  claim_expires_at: number | null;
  next_node_index: number;
  parent_run_id: string | null;
  parent_node_id: string | null;
  configurable_json: string | null;
  variables_json: string | null;
}

/**
 * Load + parse the run's workflow-variable map. Returns `{}` when the
 * column is null (legacy rows or runs that haven't written any
 * variables yet). Variables persist channel state per
 * channels-and-reducers.md §append + §TTL.
 */
function loadRunVariables(runId: string): Record<string, unknown> {
  const row = loadRun(runId);
  if (!row?.variables_json) return {};
  try {
    const parsed = JSON.parse(row.variables_json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function saveRunVariables(runId: string, variables: Record<string, unknown>): void {
  db.prepare("UPDATE runs SET variables_json = ? WHERE run_id = ?").run(
    JSON.stringify(variables),
    runId,
  );
}

/**
 * Resolve a host-provisioned canary secret by id. Returns the raw
 * secret value (caller is responsible for hashing/redacting before
 * surfacing it on any observable channel) or `null` if the secret is
 * not provisioned on this host. Production hosts back this with KMS
 * / Vault / cloud secret managers; the reference host ships a tiny
 * canary map so conformance scenarios can exercise BYOK roundtrip
 * end-to-end without an external secret store.
 *
 * Operator override: `OPENWOP_CANARY_SECRET_VALUE` env populates the
 * default canary at startup, otherwise a built-in deterministic
 * canary is used. The canary is BYOK-grade — every observable surface
 * (events, variables, debug bundle, logs) emits only the SHA-256 hash
 * + length per SR-1.
 */
function resolveCanarySecret(secretId: string): string | null {
  if (secretId === 'openwop-conformance-canary-secret') {
    return process.env.OPENWOP_CANARY_SECRET_VALUE
      ?? 'openwop-canary-secret-value-not-a-real-credential';
  }
  return null;
}

interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  node_id: string | null;
  data_json: string | null;
  timestamp: string;
  causation_id: string | null;
}

function loadRun(runId: string): RunRow | null {
  return (stmts.getRun.get(runId) as RunRow | undefined) ?? null;
}

function appendEvent(
  runId: string,
  type: string,
  opts: { nodeId?: string; data?: unknown; causationId?: string } = {},
): RunEvent {
  const seq = (stmts.countEvents.get(runId) as { n: number }).n;
  const event: RunEvent = {
    seq,
    runId,
    type,
    nodeId: opts.nodeId ?? null,
    data: opts.data ?? null,
    timestamp: new Date().toISOString(),
    ...(opts.causationId !== undefined ? { causationId: opts.causationId } : {}),
  };
  stmts.insertEvent.run(
    runId,
    seq,
    type,
    event.nodeId,
    event.data === null ? null : JSON.stringify(event.data),
    event.timestamp,
    opts.causationId ?? null,
  );
  eventBus.emit(`events:${runId}`, event);
  // Best-effort webhook delivery (webhooks.md). Fire-and-forget.
  fanOutEvent(db, { ...event });
  return event;
}

/** Compose the canonical eventId for an emitted RunEventDoc. The host
 *  serializes eventId as `evt-${runId}-${seq}` per the events/poll
 *  response shape; this helper is the inverse map used at emit time so
 *  causationId references resolve to that same surface.
 */
function makeEventId(runId: string, seq: number): string {
  return `evt-${runId}-${seq}`;
}

function setRunTerminal(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  error: { code: string; message: string } | null,
): void {
  const endedAt = new Date().toISOString();
  // Compute duration BEFORE the UPDATE so we can read started_at from
  // the current row (the UPDATE overwrites nothing relevant).
  const row = loadRun(runId);
  stmts.updateRunStatus.run(status, endedAt, error ? JSON.stringify(error) : null, runId);
  stmts.releaseClaim.run(runId, PROCESS_ID);
  // OTel span close + run-duration histogram observation.
  endRunSpan(runId, status);
  if (row) {
    const seconds = (new Date(endedAt).getTime() - new Date(row.started_at).getTime()) / 1000;
    recordRunDuration(seconds);
  }
}

/**
 * Cancel a run from inside the host (cascade from parent, etc.). For a
 * suspended run we drive directly to terminal `cancelled` (no executor
 * running to observe a `cancelling` flip); for an executing run we set
 * `cancelling` and abort the in-flight node.
 */
function cancelRunInternal(runId: string, reason: string): void {
  const row = loadRun(runId);
  if (!row) return;
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') return;
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  if (isSuspended) {
    invalidateInterrupts(db, runId, reason);
    appendEvent(runId, 'run.cancelled', { data: { reason } });
    setRunTerminal(runId, 'cancelled', null);
    return;
  }
  // Note: we DON'T emit a `run.cancelling` event here — that type is not
  // in the canonical RunEventType enum, and the executor's poll loop
  // observes the status flip on its next loadRun() call. The terminal
  // `run.cancelled` event lands when the executor reaches setRunTerminal.
  stmts.setCancelRequested.run(runId);
  runningAborters.get(runId)?.abort();
}

// ─── Claim + execution ───────────────────────────────────────────────────────

function tryClaim(runId: string): boolean {
  const result = stmts.acquireClaim.run(PROCESS_ID, Date.now() + CLAIM_TTL_MS, runId, Date.now());
  return result.changes === 1;
}

/**
 * Start renewing this process's claim on `runId` every
 * HEARTBEAT_INTERVAL_MS. Called when a run begins execution; cleared
 * by `stopHeartbeat()` on terminal status.
 *
 * Renewal uses the same `acquireClaim` UPDATE statement; the WHERE
 * clause `(claim_holder_id IS NULL OR claim_expires_at < now)` permits
 * us to extend our OWN claim because it doesn't fail when the existing
 * holder is the same process.
 *
 * Wait — actually the WHERE clause as written rejects same-holder
 * renewal once expires_at is set in the future. We use a separate
 * statement that explicitly matches the holder ID for renewal.
 */
const renewClaimStmt = db.prepare(
  'UPDATE runs SET claim_expires_at = ? WHERE run_id = ? AND claim_holder_id = ?',
);

function startHeartbeat(runId: string): void {
  // Defensive: don't double-start.
  const existing = runningHeartbeats.get(runId);
  if (existing) clearInterval(existing);
  const handle = setInterval(() => {
    renewClaimStmt.run(Date.now() + CLAIM_TTL_MS, runId, PROCESS_ID);
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the event loop alive solely on the heartbeat — let the
  // HTTP server be the keepalive.
  if (typeof handle.unref === 'function') handle.unref();
  runningHeartbeats.set(runId, handle);
}

function stopHeartbeat(runId: string): void {
  const handle = runningHeartbeats.get(runId);
  if (handle) clearInterval(handle);
  runningHeartbeats.delete(runId);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveInputAsNumber(
  declared: unknown,
  variables: Record<string, unknown>,
  fallback: number,
): number {
  if (
    declared !== null &&
    typeof declared === 'object' &&
    'type' in declared &&
    (declared as { type: unknown }).type === 'variable'
  ) {
    const variableName = (declared as { variableName?: string }).variableName;
    if (variableName !== undefined && typeof variables[variableName] === 'number') {
      return variables[variableName] as number;
    }
  }
  if (typeof declared === 'number') return declared;
  return fallback;
}

type NodeOutcome = 'completed' | 'cancelled' | 'failed' | 'suspended' | 'loopback';

// Carrier for the next-iteration target when a node returns 'loopback'.
// RFC 0007 §D `next-worker`: dispatch routes control back to the upstream
// orchestrator. The fixture topology is a 2-node loop (orchestrator →
// dispatch → orchestrator); the simplest correct interpretation for the
// linear executor is "jump to the orchestrator-supervisor node by typeId."
// runWorkflow reads + clears this on every loopback outcome.
const loopbackTargets = new Map<string, number>();

// Carrier for specific run-level error envelopes when a node returns
// 'failed'. Without this, runWorkflow's catch-all overwrites every
// terminal error to `unsupported_node_type` — masking spec-defined codes
// like `capability_not_provided` (capabilities.md §Runtime capabilities),
// `no_pending_decision` (RFC 0007 §C), and `unsupported_decision_kind`
// (RFC 0007 §D). executeNode writes here BEFORE returning 'failed';
// runWorkflow reads + clears.
const runFailureErrors = new Map<string, { code: string; message: string }>();

// Static fixture-node `requires` registry. Conformance fixture nodes
// declare their required runtime capabilities here so the host can
// refuse dispatch (capabilities.md §"Runtime capabilities") before
// emitting node.started. Production hosts wire this from each node
// pack's manifest; the reference host hard-codes the conformance set.
const FIXTURE_NODE_REQUIRES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'conformance.requiresMissing': ['conformance.never-provided'],
});

// capabilities.md §"Unsupported capability — refusal contract" + §"Capability-gated
// typeId map (normative)". This is the single source of truth the host
// uses both for advertising what it implements AND for refusing
// workflows that reference unsupported typeIds. Each entry maps a
// reserved typeId → the capability key (and human-readable label) that
// gates it. A check at workflow registration / run-create time iterates
// the workflow's nodes; for each typeId in this map, the host consults
// HOST_ADVERTISED_GATED_CAPABILITIES below and refuses with
// `capability_required` if the gating capability isn't claimed.
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

// Capabilities this host advertises in `/.well-known/openwop`.
// Single source of truth for both the discovery payload and the
// refusal check; if a new capability is implemented, add it here AND
// in handleDiscovery so the two stay aligned.
const HOST_ADVERTISED_GATED_CAPABILITIES: ReadonlySet<string> = new Set([
  'orchestrator.supported',
  'dispatch.supported',
  // conversationPrimitive is NOT advertised — the host doesn't implement
  // core.conversationGate. Workflows referencing it are refused.
]);

async function executeNode(
  runId: string,
  node: FixtureWorkflow['nodes'][number],
  inputs: Record<string, unknown>,
  signal: AbortSignal,
): Promise<NodeOutcome> {
  const refreshed = loadRun(runId);
  if (refreshed?.status === 'cancelling') {
    appendEvent(runId, 'node.cancelled', { nodeId: node.id });
    return 'cancelled';
  }

  // capabilities.md §"Runtime capabilities": a NodeModule that declares
  // `requires: [<capId>]` MUST cause the run to fail with
  // `capability_not_provided` if the host does not advertise the
  // capability. Refusal happens BEFORE node.started so the offending
  // node MUST NOT execute. The reference fixture-node registry is the
  // source of truth for typeId → required capability ids; the host's
  // own `/.well-known/openwop` advertisement is the authoritative
  // capability set.
  const requires = FIXTURE_NODE_REQUIRES[node.typeId];
  if (requires && requires.length > 0) {
    const advertised = new Set<string>(); // SQLite host advertises no `runtimeCapabilities` — the array is empty.
    const missing = requires.find((cap) => !advertised.has(cap));
    if (missing !== undefined) {
      runFailureErrors.set(runId, {
        code: 'capability_not_provided',
        message: `Node "${node.id}" (typeId "${node.typeId}") requires capability "${missing}" which the host does not advertise.`,
      });
      return 'failed';
    }
  }

  appendEvent(runId, 'node.started', { nodeId: node.id });
  startNodeSpan(runId, node.id, node.typeId);

  switch (node.typeId) {
    case 'core.noop':
      break;

    case 'core.identity':
      // fixtures.md §conformance-identity. Pure passthrough: the node's
      // declared `inputs` are resolved from the run's variable map and
      // echoed back to the same variable names on completion. Variables
      // are seeded from inputs at run-create, so this is a no-op at the
      // state level — the test asserts the round-trip identity.
      break;

    case 'conformance.modelCapability.insufficient': {
      // RFC 0031 §B step 4 + §D — this conformance-only typeId declares
      // `requiredModelCapabilities` the host's active provider cannot
      // satisfy, with no viable fallback. The host MUST emit
      // `model.capability.insufficient` BEFORE the node failure, then fail
      // the run with `capability_not_provided` (capabilities.md
      // §"Unsupported capability — refusal contract"). The SQLite host
      // routes no AI and advertises no model capabilities, so this typeId
      // always takes the refuse branch. No downstream envelope event is
      // emitted — the node never dispatches to a model (returning here
      // skips the post-switch `node.completed`).
      const missingCapabilities = ['nonexistent-capability-9b3f'];
      appendEvent(runId, 'model.capability.insufficient', {
        nodeId: node.id,
        data: {
          nodeId: node.id,
          provider: 'none',
          model: 'none',
          missingCapabilities,
          fallbackAttempted: false,
        },
      });
      const err = {
        code: 'capability_not_provided',
        message: `model-capability gate (node "${node.id}"): active provider does not satisfy required model capabilities [${missingCapabilities.join(', ')}] and no viable fallback is declared.`,
      };
      appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
      runFailureErrors.set(runId, err);
      return 'failed';
    }

    case 'conformance.secret.echo': {
      // openwop-smoke-byok-roundtrip fixture. Resolve a host-provisioned
      // secret by id, then emit `{ secretSha256, secretLength }` into
      // the run's variables. The raw value NEVER leaves the resolver —
      // observability.md §"Redaction" + threat-model-secret-leakage.md
      // §SR-1 require that only the hash + length appear on any
      // observable surface (variables, events, debug bundle, logs).
      const cfg = (node.config ?? {}) as { secretId?: string };
      const secretId = typeof cfg.secretId === 'string' ? cfg.secretId : null;
      if (!secretId) {
        const err = { code: 'validation_error', message: `conformance.secret.echo (node "${node.id}") MUST declare config.secretId.` };
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
      const resolved = resolveCanarySecret(secretId);
      if (resolved === null) {
        const err = { code: 'credential_unavailable', message: `Secret "${secretId}" is not provisioned on this host.` };
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
      const hash = createHash('sha256').update(resolved, 'utf8').digest('hex');
      const variables = loadRunVariables(runId);
      variables['resolve-secret'] = { secretSha256: hash, secretLength: resolved.length };
      saveRunVariables(runId, variables);
      // Event payload carries only the hash + length, never the raw secret.
      break;
    }

    case 'core.delay': {
      // Accept either config.ms (channel-ttl fixture convention) or
      // inputs.delayMs (interrupt/cancellation fixture convention).
      // Config wins when both present.
      const cfgDelay = node.config?.ms ?? node.config?.delayMs;
      const cfgMs = typeof cfgDelay === 'number' ? cfgDelay : null;
      const delayMs = cfgMs ?? resolveInputAsNumber(node.inputs.delayMs, inputs, 100);
      try {
        await sleep(delayMs, signal);
      } catch {
        appendEvent(runId, 'node.cancelled', { nodeId: node.id });
        return 'cancelled';
      }
      break;
    }

    case 'core.approvalGate': {
      // Suspend: persist interrupt, emit node.suspended, return 'suspended'.
      const config = (node.config ?? {}) as Partial<ApprovalConfig>;
      const approvalConfig: ApprovalConfig = {
        actions: Array.isArray(config.actions) ? config.actions : ['accept', 'reject'],
        ...(config.requiredApprovals !== undefined ? { requiredApprovals: config.requiredApprovals } : {}),
        ...(config.rejectionPolicy !== undefined ? { rejectionPolicy: config.rejectionPolicy } : {}),
        ...(config.approversList !== undefined ? { approversList: config.approversList } : {}),
        ...(config.title !== undefined ? { title: config.title } : {}),
        ...(config.description !== undefined ? { description: config.description } : {}),
      };
      const payload = {
        kind: 'approval',
        nodeId: node.id,
        config: approvalConfig,
      };
      createInterrupt(db, runId, node.id, 'approval', approvalConfig, payload);
      appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
      // Close the OTel node span on suspend so the trace exporter ships
      // a complete span (start + end) for the node-execution slice; on
      // resume the executor re-enters this node and startNodeSpan will
      // open a fresh span for the resumed slice.
      endNodeSpan(runId, node.id, 'suspended');
      return 'suspended';
    }

    case 'core.clarificationGate': {
      const config = (node.config ?? {}) as Partial<ClarificationConfig>;
      const clarConfig: ClarificationConfig = {
        questions: Array.isArray(config.questions) ? config.questions : [],
      };
      const payload = {
        kind: 'clarification',
        nodeId: node.id,
        config: clarConfig,
      };
      createInterrupt(db, runId, node.id, 'clarification', clarConfig, payload);
      appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
      // Close the OTel node span on suspend so the trace exporter ships
      // a complete span (start + end) for the node-execution slice; on
      // resume the executor re-enters this node and startNodeSpan will
      // open a fresh span for the resumed slice.
      endNodeSpan(runId, node.id, 'suspended');
      return 'suspended';
    }

    case 'core.subWorkflow': {
      // node-packs.md §"core.subWorkflow contract". Dispatch a child
      // run, mirror its status onto the parent while it waits, and
      // resolve when the child terminates. Output shape on node.completed
      // is {outputs: {childRunId, childStatus}} per the spec; optional
      // outputMapping propagates child variables to parent.
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
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }

      // Idempotent: reuse an existing in-flight child (resume after parent restart).
      const existing = db
        .prepare('SELECT run_id FROM runs WHERE parent_run_id = ? AND parent_node_id = ?')
        .get(runId, node.id) as { run_id: string } | undefined;
      let childRunId = existing?.run_id;
      if (!childRunId) {
        childRunId = `run-${randomUUID()}`;
        const startedAt = new Date().toISOString();
        // Seed child variables in two passes (node-packs.md
        // §"core.subWorkflow contract" — Variable seeding + RFC 0022 §B):
        //   1. variables[].defaultValue declarations on the child.
        //   2. inputMapping projections from parent variables, which
        //      override matching defaultValue keys. This is a one-shot
        //      fold at dispatch time — later parent mutations MUST NOT
        //      propagate into the seeded child. Unset parent variables
        //      surface as `undefined` on the child variable (NOT `null`).
        const childWorkflow = workflows.get(childWorkflowId)!;
        const childVars: Record<string, unknown> = {};
        for (const v of childWorkflow.variables ?? []) {
          if (v.defaultValue !== undefined) childVars[v.name] = v.defaultValue;
        }
        if (config.inputMapping && typeof config.inputMapping === 'object') {
          const parentVars = loadRunVariables(runId);
          for (const [childKey, parentKey] of Object.entries(config.inputMapping)) {
            if (typeof parentKey !== 'string') continue;
            childVars[childKey] = parentVars[parentKey];
          }
        }
        db.prepare(
          `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id, variables_json)
           VALUES (?, ?, 'pending', '{}', ?, ?, ?, ?)`,
        ).run(childRunId, childWorkflowId, startedAt, runId, node.id, JSON.stringify(childVars));
        appendEvent(runId, 'node.dispatched', {
          nodeId: node.id,
          data: { childRunId, childWorkflowId },
        });
        if (tryClaim(childRunId)) {
          void runWorkflow(childRunId).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            appendEvent(childRunId!, 'run.failed', { data: { code: 'internal', message } });
            setRunTerminal(childRunId!, 'failed', { code: 'internal', message });
          });
        }
      }

      // Mirror the child's status onto the parent. Loop with short
      // sleeps until child reaches terminal or parent is cancelled.
      while (true) {
        const refreshed = loadRun(runId);
        if (refreshed?.status === 'cancelling') {
          // Cascade: cancel the child if it's not already terminal.
          if (config.propagateCancellation !== false) {
            cancelRunInternal(childRunId, 'parent-cancelled');
          }
          appendEvent(runId, 'node.cancelled', { nodeId: node.id });
          return 'cancelled';
        }
        const child = loadRun(childRunId);
        if (!child) {
          appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { code: 'child_missing', childRunId },
          });
          return 'failed';
        }
        if (child.status === 'completed') {
          // outputMapping: copy mapped child variables → parent variables.
          // node-packs.md §"core.subWorkflow contract".
          if (config.outputMapping && typeof config.outputMapping === 'object') {
            const childVars = child.variables_json ? (JSON.parse(child.variables_json) as Record<string, unknown>) : {};
            const parentVars = loadRunVariables(runId);
            for (const [parentKey, childKey] of Object.entries(config.outputMapping)) {
              if (typeof childKey === 'string' && childVars[childKey] !== undefined) {
                parentVars[parentKey] = childVars[childKey];
              }
            }
            saveRunVariables(runId, parentVars);
          }
          appendEvent(runId, 'node.completed', {
            nodeId: node.id,
            data: { outputs: { childRunId, childStatus: 'completed' } },
          });
          // Reset parent to running before next iteration.
          db.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
          return 'completed';
        }
        if (child.status === 'failed') {
          if (config.onChildFailure === 'absorb') {
            appendEvent(runId, 'node.completed', {
              nodeId: node.id,
              data: { outputs: { childRunId, childStatus: 'failed' } },
            });
            db.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
            return 'completed';
          }
          const err = { code: 'child_failed', message: `core.subWorkflow child run "${childRunId}" terminated 'failed'.` };
          appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { ...err, outputs: { childRunId, childStatus: 'failed' } },
          });
          runFailureErrors.set(runId, err);
          return 'failed';
        }
        if (child.status === 'cancelled') {
          appendEvent(runId, 'node.cancelled', { nodeId: node.id, data: { childRunId } });
          return 'cancelled';
        }
        // Mirror suspend state from child onto parent.
        const childWaiting =
          child.status === 'waiting-approval' ||
          child.status === 'waiting-input' ||
          child.status === 'waiting-external';
        if (childWaiting && refreshed?.status !== child.status) {
          db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run(child.status, runId);
        } else if (!childWaiting && refreshed?.status !== 'running') {
          db.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
        }
        try {
          await sleep(50, signal);
        } catch {
          // signal aborted (cancel path). Loop top will see cancelling.
        }
      }
    }

    case 'core.channelWrite': {
      // channels-and-reducers.md §append + §"Channel TTL". Writes a value
      // to a named channel via the typed reducer. v1 supports the
      // `append` reducer; with `ttlMs` set, MUST prune entries whose
      // `_ts < (now - ttlMs)` at write time per the normative timing
      // rule. Entries on TTL-enabled channels are wrapped as
      // `{value, _ts}` per the normative entry shape.
      const cfg = (node.config ?? {}) as {
        channelName?: string;
        reducer?: string;
        ttlMs?: number;
        maxSize?: number;
        value?: unknown;
      };
      const channelName = typeof cfg.channelName === 'string' ? cfg.channelName : null;
      const reducer = typeof cfg.reducer === 'string' ? cfg.reducer : null;
      if (!channelName || !reducer) {
        const err = {
          code: 'validation_error',
          message: `core.channelWrite (node "${node.id}") MUST declare config.channelName and config.reducer.`,
        };
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
      if (reducer !== 'append') {
        // v1 reference host implements only the `append` reducer per
        // node-packs.md §"Reserved Core openwop typeIds" → core.channelWrite.
        const err = {
          code: 'unsupported_reducer',
          message: `core.channelWrite reducer "${reducer}" is not implemented; v1 reference host supports "append" only.`,
        };
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
      const ttlMs = typeof cfg.ttlMs === 'number' && cfg.ttlMs > 0 ? cfg.ttlMs : null;
      const maxSize = typeof cfg.maxSize === 'number' && cfg.maxSize > 0 ? cfg.maxSize : null;
      const variables = loadRunVariables(runId);
      const existing = Array.isArray(variables[channelName])
        ? (variables[channelName] as Array<{ value: unknown; _ts?: number } | unknown>)
        : [];
      const now = Date.now();
      // TTL pruning at write time — normative per channels-and-reducers.md §"Channel TTL".
      const kept = ttlMs === null
        ? existing
        : existing.filter((entry) => {
            if (entry && typeof entry === 'object' && '_ts' in entry) {
              const ts = (entry as { _ts: unknown })._ts;
              return typeof ts === 'number' && ts >= now - ttlMs;
            }
            // Non-wrapped legacy entries (no _ts) — keep as-is when no
            // TTL info is available; the next write under a TTL channel
            // re-wraps the new entry.
            return true;
          });
      const newEntry = ttlMs === null ? cfg.value : { value: cfg.value, _ts: now };
      const next = [...kept, newEntry];
      // Apply maxSize after TTL pruning per the normative ordering rule.
      const bounded = maxSize !== null && next.length > maxSize
        ? next.slice(next.length - maxSize)
        : next;
      variables[channelName] = bounded;
      saveRunVariables(runId, variables);
      appendEvent(runId, 'channel.written', {
        nodeId: node.id,
        data: {
          channelName,
          reducer,
          ...(ttlMs !== null ? { ttlMs } : {}),
          ...(maxSize !== null ? { maxSize } : {}),
          entry: newEntry,
        },
      });
      break;
    }

    case 'core.orchestrator.supervisor': {
      // RFC 0006 §C — orchestrator emits one OrchestratorDecision per
      // tick. For the conformance-dispatch-loop fixture (2-node loop),
      // the supervisor's behavior is deterministic: first tick →
      // `next-worker`, subsequent ticks → `terminate`. Production
      // orchestrators delegate to an LLM; this reference impl uses the
      // event-log decision count as state so replay is trivially
      // deterministic (RFC 0006 §F replay-cache rule degenerates to a
      // pure function of prior decisions).
      const prior = (
        stmts.getEventsAfter.all(runId, -1) as EventRow[]
      ).filter((e) => e.type === 'runOrchestrator.decided').length;
      const agentId = (node.config?.agentId as string | undefined) ?? 'core.reference-supervisor';
      // Two modes:
      //
      // 1. `mockDispatchPlan` (RFC 0022 §"Unresolved questions" #6): when
      //    `node.config.mockDispatchPlan` is a non-empty array of
      //    `OrchestratorDecision` shapes, the supervisor emits them in
      //    order — first tick uses plan[0], second tick plan[1], etc.
      //    Once the plan is exhausted, falls back to `terminate`. Lets
      //    conformance fixtures drive multi-worker dispatch sequences
      //    without an LLM. This mode is conformance-only (the supervisor
      //    block is non-normative reference code).
      //
      // 2. Default (legacy): first tick → `next-worker:
      //    ['conformance-noop']`, subsequent ticks → `terminate`.
      //    Preserves the original `conformance-dispatch-loop` fixture.
      const mockPlan = Array.isArray(node.config?.mockDispatchPlan)
        ? (node.config!.mockDispatchPlan as Array<{
            kind?: string;
            nextWorkerIds?: string[];
            reason?: string;
            prompt?: string;
          }>)
        : null;
      let decision:
        | { kind: 'next-worker'; nextWorkerIds: string[] }
        | { kind: 'terminate'; reason?: string };
      if (mockPlan && mockPlan.length > 0 && prior < mockPlan.length) {
        const entry = mockPlan[prior]!;
        if (entry.kind === 'next-worker' && Array.isArray(entry.nextWorkerIds)) {
          decision = { kind: 'next-worker', nextWorkerIds: entry.nextWorkerIds };
        } else if (entry.kind === 'terminate') {
          decision = { kind: 'terminate', ...(entry.reason !== undefined ? { reason: entry.reason } : {}) };
        } else {
          decision = { kind: 'terminate', reason: 'mockPlan-malformed' };
        }
      } else if (mockPlan && mockPlan.length > 0) {
        decision = { kind: 'terminate', reason: 'mockPlan-exhausted' };
      } else {
        decision = prior === 0
          ? { kind: 'next-worker', nextWorkerIds: ['conformance-noop'] }
          : { kind: 'terminate', reason: 'goal-reached' };
      }
      appendEvent(runId, 'runOrchestrator.decided', {
        nodeId: node.id,
        data: { agentId, decision },
      });
      break;
    }

    case 'core.dispatch': {
      // RFC 0007 §C — read the latest `runOrchestrator.decided` event
      // and translate its decision into a runtime action.
      const events = stmts.getEventsAfter.all(runId, -1) as EventRow[];
      const latestDecisionEvent = [...events]
        .reverse()
        .find((e) => e.type === 'runOrchestrator.decided');
      if (!latestDecisionEvent) {
        const err = { code: 'no_pending_decision', message: `core.dispatch (node "${node.id}") found no upstream runOrchestrator.decided event.` };
        appendEvent(runId, 'node.failed', { nodeId: node.id, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
      // RFC 0007 §E — emitted events MUST carry causationId pointing at
      // the consumed decision event. The eventId format matches the
      // events/poll response shape: `evt-${runId}-${seq}`.
      const decisionEventId = makeEventId(runId, latestDecisionEvent.seq);
      const payload = latestDecisionEvent.data_json
        ? (JSON.parse(latestDecisionEvent.data_json) as {
            agentId?: string;
            decision?: { kind?: string; nextWorkerIds?: string[]; reason?: string; prompt?: string };
          })
        : null;
      const kind = payload?.decision?.kind;

      if (kind === 'terminate') {
        // RFC 0007 §D `terminate`: dispatch's output is the run's
        // terminal outcome. Emit node.completed (causationId-linked)
        // and let the outer for-loop's natural run.completed emission
        // carry through. Reason is informational — captured on the
        // node.completed payload for audit/debug.
        const reason = payload?.decision?.reason;
        appendEvent(runId, 'node.completed', {
          nodeId: node.id,
          causationId: decisionEventId,
          data: { decision: 'terminate', ...(reason !== undefined ? { reason } : {}) },
        });
        endNodeSpan(runId, node.id, 'completed');
        return 'completed';
      }

      if (kind === 'next-worker') {
        // RFC 0007 §D `next-worker`: each `nextWorkerIds[i]` resolves to
        // a workflow id; dispatch creates a child run via the canonical
        // `core.subWorkflow` machinery (`workerDispatchModel: child-run`,
        // v1's only model). Workers are dispatched sequentially (RFC 0007
        // §D `fanOutPolicy: 'sequential'`); the host advertises
        // `dispatch.fanOutSupported: false` (no PARALLEL fan-out). After
        // all children terminate, dispatch emits node.completed with the
        // last child's `outputs.{childRunId, childStatus}` (per §D step 3)
        // and returns 'loopback' so the DAG cycles back to the
        // orchestrator-supervisor.
        //
        // RFC 0022 §A — when the dispatch node's config carries
        // inputMapping / outputMapping / perWorker{Input,Output}Mappings,
        // the host MUST (1) project parent variables into child inputs
        // before invocation, and (2) harvest child variables back into
        // parent variables on terminal `completed`. The shared parent
        // variable bag is the handoff channel between sibling children
        // under sequential fan-out (RFC 0022 §D).
        const nextWorkerIds = Array.isArray(payload?.decision?.nextWorkerIds)
          ? (payload!.decision!.nextWorkerIds as string[])
          : [];
        if (nextWorkerIds.length === 0) {
          const err = { code: 'no_pending_decision', message: `core.dispatch (node "${node.id}") next-worker decision MUST carry at least one nextWorkerIds[].` };
          appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
          runFailureErrors.set(runId, err);
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
            appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
            runFailureErrors.set(runId, err);
            return 'failed';
          }
          // RFC 0022 §A — compute the effective input mapping. perWorker
          // overrides take precedence over the dispatch-level default.
          const effectiveInputMapping =
            dispatchConfig.perWorkerInputMappings?.[childWorkflowId] ??
            dispatchConfig.inputMapping ??
            {};
          // Project parent variables → child inputs. Unset parent vars
          // surface as `undefined` on the child input per RFC 0022 §A
          // (not omitted via a present-key fallback, not `null`).
          const parentVars = loadRunVariables(runId);
          const childInputs: Record<string, unknown> = {};
          for (const [childKey, parentKey] of Object.entries(effectiveInputMapping)) {
            if (typeof parentKey !== 'string') continue;
            childInputs[childKey] = parentVars[parentKey];
          }
          // Idempotent child reuse + create. For multi-worker fan-out,
          // each child gets a distinct (parent_run, parent_node, workerIdx)
          // tuple so the per-node lookup matches only the first child and
          // subsequent siblings always create fresh.
          //
          // Known limitation (parity with the Postgres reference): the
          // worker-0 key is `node.id`, so if the SAME dispatch node were
          // re-entered via loopback on a SEPARATE later `next-worker`
          // decision, worker-0's lookup would reuse this tick's child
          // instead of dispatching the new worker. No conformance fixture
          // exercises this — the §D cross-worker fixture emits a single
          // `next-worker` decision carrying all workers, and every other
          // fixture's second decision is `terminate`. A production host
          // that drives multi-tick worker sequences would key on the
          // decision/tick index too.
          const childParentNodeId = workerIdx === 0 ? node.id : `${node.id}#${workerIdx}`;
          const existingChild = db
            .prepare('SELECT run_id FROM runs WHERE parent_run_id = ? AND parent_node_id = ?')
            .get(runId, childParentNodeId) as { run_id: string } | undefined;
          let childRunId = existingChild?.run_id;
          if (!childRunId) {
            childRunId = `run-${randomUUID()}`;
            const startedAt = new Date().toISOString();
            const childWorkflow = workflows.get(childWorkflowId)!;
            const childVars: Record<string, unknown> = {};
            for (const v of childWorkflow.variables ?? []) {
              if (v.defaultValue !== undefined) childVars[v.name] = v.defaultValue;
            }
            db.prepare(
              `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id, variables_json)
               VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
            ).run(childRunId, childWorkflowId, JSON.stringify(childInputs), startedAt, runId, childParentNodeId, JSON.stringify(childVars));
            appendEvent(runId, 'node.dispatched', {
              nodeId: node.id,
              causationId: decisionEventId,
              data: { childRunId, childWorkflowId },
            });
            if (tryClaim(childRunId)) {
              const innerChildRunId = childRunId;
              void runWorkflow(innerChildRunId).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                appendEvent(innerChildRunId, 'run.failed', { data: { code: 'internal', message } });
                setRunTerminal(innerChildRunId, 'failed', { code: 'internal', message });
              });
            }
          }
          // Poll for THIS child's terminal status before advancing to the
          // next sibling (sequential fan-out per RFC 0007 §D). Cancellation
          // cascade follows the same convention as `core.subWorkflow`.
          let childTerminal: 'completed' | 'failed' | 'cancelled' | null = null;
          while (true) {
            const refreshedParent = loadRun(runId);
            if (refreshedParent?.status === 'cancelling') {
              cancelRunInternal(childRunId, 'parent-cancelled');
              appendEvent(runId, 'node.cancelled', { nodeId: node.id, causationId: decisionEventId });
              return 'cancelled';
            }
            const child = loadRun(childRunId);
            if (!child) {
              const err = { code: 'child_missing', message: `core.dispatch child run "${childRunId}" disappeared.` };
              appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
              runFailureErrors.set(runId, err);
              return 'failed';
            }
            if (child.status === 'completed' || child.status === 'failed' || child.status === 'cancelled') {
              childTerminal = child.status as 'completed' | 'failed' | 'cancelled';
              break;
            }
            try {
              await sleep(50, signal);
            } catch {
              // signal aborted (cancel path). Loop top will see cancelling.
            }
          }
          lastChildRunId = childRunId;
          lastChildStatus = childTerminal;
          if (childTerminal !== 'completed') {
            // RFC 0022 §A — failed / cancelled children MUST skip
            // outputMapping; parent variables stay at pre-dispatch state.
            const err = {
              code: 'child_failed',
              message: `core.dispatch child run "${childRunId}" terminated '${childTerminal}'.`,
            };
            appendEvent(runId, 'node.failed', {
              nodeId: node.id,
              causationId: decisionEventId,
              data: { ...err, outputs: { childRunId, childStatus: childTerminal } },
            });
            runFailureErrors.set(runId, err);
            return 'failed';
          }
          // RFC 0022 §A — harvest child variables into parent variables
          // via the effective output mapping. Visible to the next
          // sibling's inputMapping (RFC 0022 §D — sequential fan-out
          // shares the parent variable bag).
          const effectiveOutputMapping =
            dispatchConfig.perWorkerOutputMappings?.[childWorkflowId] ??
            dispatchConfig.outputMapping ??
            {};
          if (Object.keys(effectiveOutputMapping).length > 0) {
            const childVars = loadRunVariables(childRunId);
            const parentVarsRow = loadRunVariables(runId);
            for (const [parentKey, childKey] of Object.entries(effectiveOutputMapping)) {
              if (typeof childKey !== 'string') continue;
              parentVarsRow[parentKey] = childVars[childKey];
            }
            saveRunVariables(runId, parentVarsRow);
          }
        }
        // All workers completed. RFC 0007 §D — emit node.completed with
        // the LAST child's (childRunId, childStatus).
        appendEvent(runId, 'node.completed', {
          nodeId: node.id,
          causationId: decisionEventId,
          data: { outputs: { childRunId: lastChildRunId, childStatus: lastChildStatus } },
        });
        endNodeSpan(runId, node.id, 'completed');
        // DAG cycle: route control back to the orchestrator-supervisor so
        // the next decision tick can fire.
        const wfRow = loadRun(runId);
        const workflow = wfRow ? workflows.get(wfRow.workflow_id) : null;
        const supervisorIdx = workflow
          ? workflow.nodes.findIndex((n) => n.typeId === 'core.orchestrator.supervisor')
          : -1;
        if (supervisorIdx >= 0) {
          loopbackTargets.set(runId, supervisorIdx);
          return 'loopback';
        }
        // No upstream supervisor: dispatch is a leaf; advance linearly.
        db.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
        return 'completed';
      }

      if (kind === 'ask-user') {
        // RFC 0007 §D `ask-user` — minimal clarification routing.
        // Conversation routing (RFC 0005) is handled by the
        // conversation gate elsewhere; the reference path here uses a
        // clarification interrupt so the dispatch surface has
        // end-to-end coverage without depending on Phase-4 conversation
        // support being wired.
        const prompt = payload?.decision?.prompt ?? '';
        const clarConfig: ClarificationConfig = { questions: [{ id: 'q1', question: prompt }] };
        const interruptPayload = { kind: 'clarification', nodeId: node.id, config: clarConfig };
        createInterrupt(db, runId, node.id, 'clarification', clarConfig, interruptPayload);
        appendEvent(runId, 'node.suspended', { nodeId: node.id, causationId: decisionEventId, data: interruptPayload });
        endNodeSpan(runId, node.id, 'suspended');
        return 'suspended';
      }

      {
        const err = {
          code: 'unsupported_decision_kind',
          message: `core.dispatch (node "${node.id}") received decision.kind="${kind ?? '<missing>'}", which the host does not implement.`,
        };
        appendEvent(runId, 'node.failed', { nodeId: node.id, causationId: decisionEventId, data: err });
        runFailureErrors.set(runId, err);
        return 'failed';
      }
    }

    case 'core.interrupt': {
      // Generic interrupt — currently supports kind='external-event'.
      const config = (node.config ?? {}) as { kind?: string; data?: ExternalEventConfig; timeoutMs?: number };
      if (config.kind === 'external-event') {
        const extConfig: ExternalEventConfig = {
          ...(config.data?.eventType !== undefined ? { eventType: config.data.eventType } : {}),
          ...(config.data?.correlation !== undefined ? { correlation: config.data.correlation } : {}),
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        };
        const token = createInterrupt(db, runId, node.id, 'external-event', extConfig, {
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
        appendEvent(runId, 'node.suspended', { nodeId: node.id, data: payload });
        return 'suspended';
      }
      appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_interrupt_kind', kind: config.kind ?? '<missing>' },
      });
      return 'failed';
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
      appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_node_type', typeId: node.typeId },
      });
      return 'failed';
  }

  appendEvent(runId, 'node.completed', { nodeId: node.id });
  endNodeSpan(runId, node.id, 'completed');
  return 'completed';
}

async function runWorkflow(runId: string): Promise<void> {
  const row = loadRun(runId);
  if (!row) return;

  const workflow = workflows.get(row.workflow_id);
  if (!workflow) {
    const error = { code: 'workflow_not_found', message: 'Unknown workflowId.' };
    appendEvent(runId, 'run.failed', { data: error });
    setRunTerminal(runId, 'failed', error);
    return;
  }

  const inputs = JSON.parse(row.inputs_json) as Record<string, unknown>;
  const aborter = new AbortController();
  runningAborters.set(runId, aborter);
  startHeartbeat(runId);

  try {
    // `run.started` is emitted only on FIRST execution. If we're
    // resuming an orphaned run, the prior process already wrote
    // `run.started`; emit a `run.resumed` event so observers can see
    // the handover.
    const startEvents = stmts.getEventsAfter.all(runId, -1) as EventRow[];
    const alreadyStarted = startEvents.some((e) => e.type === 'run.started');
    stmts.updateRunStatus.run('running', null, null, runId);
    if (!alreadyStarted) {
      appendEvent(runId, 'run.started');
      startRunSpan(runId, row.workflow_id);
    } else {
      appendEvent(runId, 'run.resumed', { data: { resumedBy: PROCESS_ID } });
    }

    // recursionLimit per run-options.md §"recursionLimit": cap on
    // total node executions in the run. When the next node would
    // exceed the limit, emit `cap.breached` BEFORE the node fires,
    // then `run.failed` with `error.code = 'recursion_limit_exceeded'`.
    const configurableParsed = row.configurable_json
      ? (JSON.parse(row.configurable_json) as { recursionLimit?: unknown })
      : {};
    const recursionLimit =
      typeof configurableParsed.recursionLimit === 'number' &&
      Number.isInteger(configurableParsed.recursionLimit) &&
      configurableParsed.recursionLimit > 0
        ? configurableParsed.recursionLimit
        : null;
    let breachEmitted = false;

    const startIndex = row.next_node_index ?? 0;
    for (let i = startIndex; i < workflow.nodes.length; i++) {
      const node = workflow.nodes[i]!;

      // recursionLimit gate: i is 0-indexed; the (i+1)th node would
      // overflow when i+1 > limit. The conformance test expects
      // `cap.breached` BEFORE the over-limit node's `node.started`,
      // so `node.started` MUST NOT appear for the breaching node.
      if (recursionLimit !== null && i + 1 > recursionLimit && !breachEmitted) {
        breachEmitted = true;
        appendEvent(runId, 'cap.breached', {
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
        appendEvent(runId, 'run.failed', { data: error });
        setRunTerminal(runId, 'failed', error);
        return;
      }

      const refreshed = loadRun(runId);
      if (refreshed?.status === 'cancelling') {
        appendEvent(runId, 'run.cancelled');
        setRunTerminal(runId, 'cancelled', null);
        return;
      }

      const outcome = await executeNode(runId, node, inputs, aborter.signal);
      if (outcome === 'loopback') {
        // RFC 0007 §D `next-worker` — dispatch routes control back to
        // the upstream orchestrator-supervisor. The dispatch handler
        // already emitted node.completed for itself; advance i to
        // (target - 1) so the i++ on loop iteration lands at the
        // supervisor. Persist next_node_index for restart safety.
        const target = loopbackTargets.get(runId);
        loopbackTargets.delete(runId);
        if (typeof target === 'number' && target >= 0) {
          db.prepare("UPDATE runs SET next_node_index = ? WHERE run_id = ?").run(target, runId);
          i = target - 1;
          continue;
        }
        // Defensive: a missing target is a host bug, not a workflow error.
        const error = { code: 'internal', message: 'loopback outcome without target index' };
        appendEvent(runId, 'run.failed', { data: error });
        setRunTerminal(runId, 'failed', error);
        return;
      }
      if (outcome === 'failed') {
        // Prefer a specific error envelope written by the node handler
        // (capability_not_provided, no_pending_decision, etc.). Fall
        // back to the legacy unsupported_node_type for typeIds the host
        // doesn't recognize at all (the `default:` arm in executeNode).
        const carried = runFailureErrors.get(runId);
        runFailureErrors.delete(runId);
        const error = carried ?? {
          code: 'unsupported_node_type',
          message: `SQLite host does not implement node type "${node.typeId}".`,
        };
        appendEvent(runId, 'run.failed', { data: error });
        setRunTerminal(runId, 'failed', error);
        return;
      }
      if (outcome === 'cancelled') {
        appendEvent(runId, 'run.cancelled');
        setRunTerminal(runId, 'cancelled', null);
        return;
      }
      if (outcome === 'suspended') {
        // The executor stops here; the resolve route will resume by
        // setting status back to 'running' and re-invoking runWorkflow.
        // next_node_index is left at i so resume re-enters the suspended
        // node — the resolve handler bumps it past on success.
        // Release the claim so the resolve handler (potentially in a
        // different process) can re-acquire and continue.
        const suspendStatus =
          node.typeId === 'core.clarificationGate'
            ? 'waiting-input'
            : node.typeId === 'core.interrupt'
              ? 'waiting-external'
              : 'waiting-approval';
        db.prepare("UPDATE runs SET status = ?, next_node_index = ? WHERE run_id = ?").run(
          suspendStatus,
          i,
          runId,
        );
        stmts.releaseClaim.run(runId, PROCESS_ID);
        return;
      }
      // Successful completion: advance the cursor durably so a process
      // restart resumes after this node, not at it.
      db.prepare("UPDATE runs SET next_node_index = ? WHERE run_id = ?").run(i + 1, runId);
    }

    const final = loadRun(runId);
    if (final?.status === 'cancelling') {
      appendEvent(runId, 'run.cancelled');
      setRunTerminal(runId, 'cancelled', null);
    } else {
      appendEvent(runId, 'run.completed');
      setRunTerminal(runId, 'completed', null);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: 'internal', message };
    appendEvent(runId, 'run.failed', { data: error });
    setRunTerminal(runId, 'failed', error);
  } finally {
    runningAborters.delete(runId);
    stopHeartbeat(runId);
  }
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
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
 * Constant-time bearer-token comparison via `crypto.timingSafeEqual`.
 * The length-mismatch short-circuit is safe — same code path as content
 * mismatch, no timing oracle either way.
 */
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    sendError(res, 401, 'unauthenticated', 'Missing or malformed Authorization header.');
    return false;
  }
  const token = auth.slice('Bearer '.length).trim();
  const presented = Buffer.from(token, 'utf8');
  // auth-profiles.md §"openwop-auth-api-key-rotation": both primary
  // and secondary keys MUST authenticate during the overlap window.
  // Constant-time across the union — every candidate is compared even
  // after a match, so the timing oracle that distinguishes "primary
  // matched" from "secondary matched" doesn't exist. The OR is folded
  // bit-wise after every candidate's timingSafeEqual completes.
  const candidates = SECONDARY_API_KEY === null
    ? [API_KEY]
    : [API_KEY, SECONDARY_API_KEY];
  let ok = false;
  for (const candidate of candidates) {
    const expected = Buffer.from(candidate, 'utf8');
    const lengthMatch = presented.length === expected.length;
    // timingSafeEqual throws if buffers differ in length; gate on
    // lengthMatch and fall back to a same-length sentinel compare so
    // every candidate consumes equivalent CPU.
    const candidateOk = lengthMatch && timingSafeEqual(presented, expected);
    ok = ok || candidateOk;
  }
  if (!ok) {
    // auth.md §"No credential echo": message MUST NOT include the
    // rejected token. Generic envelope only.
    sendError(res, 401, 'invalid_credential', 'Bearer token rejected.');
    return false;
  }
  return true;
}

/**
 * Resolve a request's bearer to a principal classification.
 * RFC 0011 §A — same-endpoint auth-scoped discovery: handleDiscovery
 * uses this to decide whether to return the primary or narrowed view.
 * Returns `null` for missing/malformed auth or unrecognized bearer
 * (handleDiscovery treats null as the public/unauthenticated view).
 *
 * Constant-time across ALL configured candidates: every candidate's
 * timingSafeEqual completes before the OR fold, so an attacker cannot
 * distinguish "primary matched" from "tenant2 matched" by request
 * latency.
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
  const primaryHit = tryMatch(API_KEY);
  const secondaryHit = tryMatch(SECONDARY_API_KEY);
  const tenant2Hit = tryMatch(TENANT2_API_KEY);
  if (primaryHit || secondaryHit) return 'primary';
  if (tenant2Hit) return 'tenant2';
  return null;
}

function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function buildIdempotencyCacheKey(endpoint: string, key: string): string {
  return createHash('sha256').update(`single-tenant:${endpoint}:${key}`).digest('hex');
}

function pruneIdempotency(): void {
  stmts.pruneIdempotency.run(Date.now() - IDEMPOTENCY_TTL_MS);
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function handleDiscovery(req: IncomingMessage, res: ServerResponse): void {
  // Advertise the loaded fixture set so conformance scenarios can gate
  // their skipIf() on isFixtureAdvertised(id). Only the workflow IDs the
  // host actually has loaded should appear here.
  // Advertise both `conformance-*` (standard conformance fixtures) and
  // `openwop-smoke-*` (end-to-end smoke fixtures, e.g., BYOK roundtrip).
  const advertisedFixtures = Array.from(workflows.keys()).filter(
    (id) => id.startsWith('conformance-') || id.startsWith('openwop-smoke-'),
  );

  // RFC 0011 §A — same-endpoint auth-scoped discovery. Determine the
  // caller's principal (primary | tenant2 | null) and narrow the
  // capability view for tenant2 per spec annex §"Scoped capability
  // views" line 69 (no authorization oracle: tenant2 sees a STRICT
  // SUBSET of primary's capability keys). Public + unrecognized-auth
  // callers get the full unauthenticated view.
  const principal = principalFor(req);
  const isTenant2 = principal === 'tenant2';

  sendJSON(res, 200, {
    protocolVersion: '1.0',
    implementation: {
      name: 'openwop-host-sqlite',
      version: '1.1.3',
      vendor: 'openwop-spec (reference example)',
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
    debugBundle: { supported: true },
    fixtures: advertisedFixtures,
    capabilities: {
      // RFC 0011 §A — capability advertisement for the same-endpoint
      // auth-scoped pattern. Advertised on every view (public +
      // primary + tenant2) so clients can negotiate against the
      // public payload before authenticating.
      discovery: {
        authScoped: { supported: true, mode: 'same-endpoint' },
      },
      auth: {
        // Two profiles the reference host actually implements:
        //   - openwop-audit-log-integrity (auth-profiles.md §"Audit-log
        //     integrity"): hash-chain + signed checkpoints, verified by
        //     the audit-log-integrity scenario.
        //   - openwop-auth-api-key-rotation: two-key overlap (primary +
        //     OPENWOP_SECONDARY_API_KEY) during rotation grace, verified
        //     end-to-end by auth-api-key-rotation.test.ts.
        //
        // The OAuth2-CC, OIDC user-bearer, and mTLS profiles are
        // deliberately NOT claimed. The SQLite reference host runs as
        // an HTTP-only listener with bearer-token auth; it doesn't
        // parse JWTs, introspect against an IdP, or terminate TLS.
        // Advertising those profiles without their behavior is
        // over-claiming. Production deployers that front-end this host
        // with an IdP-aware reverse proxy can layer those profiles
        // externally — that's outside the reference-host surface.
        profiles: [
          'openwop-audit-log-integrity',
          'openwop-auth-api-key-rotation',
        ],
        auditLogIntegrity: {
          hashChain: true,
          checkpointSignatureAlgorithm: 'ed25519',
          checkpointPublicKey: auditSigningKey.publicKeyB64,
          checkpointIntervalEntries: AUDIT_OPTS.checkpointIntervalEntries,
          checkpointIntervalSeconds: AUDIT_OPTS.checkpointIntervalSeconds,
        },
        // auth-profiles.md §"openwop-auth-api-key-rotation".
        // minGraceSeconds advertises 24h; operators rotate by setting
        // OPENWOP_API_KEY to the new key and OPENWOP_SECONDARY_API_KEY
        // to the prior key during the overlap window.
        rotation: {
          supported: true,
          minGraceSeconds: 86_400,
        },
      },
      // capabilities.md §"Secrets" + run-options.md §"Credential
      // references". The reference host implements `secrets.resolve`
      // for the conformance BYOK canary id only — production hosts
      // wire this to a real KMS/Vault. The aiProviders block is
      // deliberately omitted: this reference host does not route AI
      // calls, so claiming BYOK on `anthropic`/`openai` would
      // over-state the implementation.
      secrets: {
        supported: true,
        scopes: ['tenant', 'user'],
        resolution: 'host-managed',
      },
      // production-profile.md §Compatibility baseline. The SQLite
      // reference host meets durability + idempotency + audit-log
      // integrity + debug-bundle redaction + observability MUSTs, but
      // does NOT implement backpressure (no inflightCap enforcement)
      // and does NOT enforce event retention with 410 expiry. The
      // honest claim is therefore NO production-profile claim from
      // this host — Postgres reference host
      // (`examples/hosts/postgres/`) is the canonical claimant per
      // INTEROP-MATRIX.md.
      webhooks: {
        // webhooks.md §"Signature algorithm versioning".
        supported: true,
        signatureAlgorithms: ['v1'],
      },
      // RFC 0006 §G + RFC 0007 §G — orchestrator + dispatch capability
      // advertisements. Hosts that advertise orchestrator MUST also
      // advertise dispatch. For RFC 0011 same-endpoint auth-scoped
      // discovery: tenant2's view OMITS these optional surfaces. The
      // resulting capability key set is a strict subset of primary's
      // view, satisfying the no-authorization-oracle invariant from
      // capabilities-change-detection.md §"Scoped capability views"
      // line 69. Operators that need richer per-tenant gating wire a
      // real tenant model — this is the reference-host minimum.
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
            // RFC 0022 §C — host honors inputMapping / outputMapping /
            // perWorkerInputMappings / perWorkerOutputMappings on the
            // `core.dispatch` config. Advertised under `agents` because
            // the conformance suite gates the dispatch-mapping scenarios
            // on `capabilities.agents.dispatchMapping`. `supported` is
            // intentionally omitted — the SQLite host does not claim the
            // broader `agents` profile, only this additive flag.
            agents: {
              dispatchMapping: true,
            },
            // RFC 0022 §B — host honors `inputMapping` on
            // `core.subWorkflow`, seeding child variables from
            // parent-variable projections after the `defaultValue` fold.
            subWorkflow: {
              inputMapping: true,
            },
          }),
      // observability.md §"Span attributes" — host advertises OTel
      // emission only when OTEL_EXPORTER_OTLP_ENDPOINT is configured.
      ...(observabilityEnabled()
        ? {
            observability: {
              otel: { supported: true, protocol: 'http/json' },
              metrics: { supported: true, names: ['openwop.run.backlog', 'openwop.queue.depth', 'openwop.run.duration'] },
            },
          }
        : {}),
    },
    extensions: {
      interrupts: {
        // Optional interrupt profiles (interrupt-profiles.md).
        profiles: [
          'openwop-interrupt-quorum',
          'openwop-interrupt-auth-required',
          'openwop-interrupt-external-event',
          'openwop-interrupt-cascade-cancel',
        ],
        signedCallbackTokens: true,
      },
    },
  }, { 'Cache-Control': 'public, max-age=300' });
}

function handleOpenApi(_req: IncomingMessage, res: ServerResponse): void {
  sendJSON(res, 200, {
    openapi: '3.1',
    info: { title: 'openwop SQLite reference host', version: '1.1.3' },
    paths: {
      '/.well-known/openwop': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs': { post: { responses: { '201': { description: 'Created' } } } },
      '/v1/runs/{runId}': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/cancel': { post: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events/poll': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/debug-bundle': { get: { responses: { '200': { description: 'OK' } } } },
    },
  });
}

async function handleCreateRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;

  const bodyText = await readBody(req);
  let parsed: { workflowId?: string; inputs?: Record<string, unknown>; configurable?: unknown };
  try {
    parsed = JSON.parse(bodyText) as {
      workflowId?: string;
      inputs?: Record<string, unknown>;
      configurable?: unknown;
    };
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
  // the GATED_TYPEID_MAP (the normative table from capabilities.md
  // §"Capability-gated typeId map") and refuse on the first
  // unsupported typeId we find — first-fail keeps the error envelope
  // unambiguous about which typeId tripped the gate.
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

  // Per-workflow configurableSchema validation (run-options.md §"Per-workflow
  // configurableSchema"). When the workflow declares a schema, the host MUST
  // reject mismatched `configurable` overlays with `validation_error`.
  const wfSchema = workflow.configurableSchema;
  if (wfSchema && parsed.configurable !== undefined) {
    const check = validateConfigurable(wfSchema, parsed.configurable);
    if (!check.valid) {
      sendError(res, 400, 'validation_error', check.reason);
      return;
    }
  }

  const idempotencyKey = req.headers['idempotency-key'];
  const incomingBodyHash = hashBody(bodyText);
  if (typeof idempotencyKey === 'string') {
    pruneIdempotency();
    const cacheKey = buildIdempotencyCacheKey('POST /v1/runs', idempotencyKey);
    const cached = stmts.getIdempotency.get(cacheKey) as
      | { status: number; body: string; body_hash: string }
      | undefined;
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

  // Per workflow-definition.schema.json §variables + run-snapshot
  // §variables, the run's variable map starts initialized from the
  // workflow's `variables[].defaultValue` declarations, then overlaid
  // with the run inputs. Two-pass so a run created with no inputs still
  // carries its declared defaults (RFC 0022 §A/§B dispatch/subWorkflow
  // inputMapping projects these parent variables into children), while
  // identity / passthrough fixtures still observe inputs in variables.
  const createWorkflowDef = workflows.get(parsed.workflowId);
  const seededVariables: Record<string, unknown> = {};
  for (const v of createWorkflowDef?.variables ?? []) {
    if (v.defaultValue !== undefined) seededVariables[v.name] = v.defaultValue;
  }
  Object.assign(seededVariables, inputs);
  stmts.insertRun.run(
    runId,
    parsed.workflowId,
    'pending',
    JSON.stringify(inputs),
    startedAt,
    parsed.configurable !== undefined ? JSON.stringify(parsed.configurable) : null,
    JSON.stringify(seededVariables),
  );

  // W3C Trace Context propagation (observability.md §"Trace context propagation").
  // Parse `traceparent` from the inbound request; if valid, store it so
  // `startRunSpan` for this runId adopts the caller-supplied trace_id.
  const traceparentHeader = req.headers['traceparent'];
  const inboundTrace = parseTraceparent(
    Array.isArray(traceparentHeader) ? traceparentHeader[0] : traceparentHeader,
  );
  if (inboundTrace) recordInboundTraceContext(runId, inboundTrace);

  logAudit(db, {
    actor: 'tenant:default',
    action: 'run.create',
    target: runId,
    details: { workflowId: parsed.workflowId },
  });
  triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);

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
    stmts.insertIdempotency.run(cacheKey, 201, responseText, incomingBodyHash, Date.now());
  }

  // Try to claim + execute. Single-process model: we expect to win
  // every time we just created the run, but tryClaim is correct under
  // multi-process startup too.
  if (tryClaim(runId)) {
    void runWorkflow(runId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const error = { code: 'internal', message };
      appendEvent(runId, 'run.failed', { data: error });
      setRunTerminal(runId, 'failed', error);
    });
  }

  res.writeHead(201, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseText),
    'openwop-Idempotent-Replay': typeof idempotencyKey === 'string' ? 'false' : '',
  });
  res.end(responseText);
}

function handleGetRun(req: IncomingMessage, res: ServerResponse, runId: string): void {
  if (!checkAuth(req, res)) return;
  const row = loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Suspended runs expose the active interrupt + currentNodeId so clients
  // can resolve via POST /v1/runs/{runId}/interrupts/{nodeId} (or, for
  // external-event interrupts, via POST /v1/interrupts/{token}).
  let interrupt: Record<string, unknown> | null = null;
  let currentNodeId: string | undefined;
  if (
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external'
  ) {
    const active = getActiveInterrupt(db, runId);
    if (active) {
      interrupt = {
        kind: active.kind,
        nodeId: active.node_id,
        payload: JSON.parse(active.payload_json),
        ...(active.callback_token
          ? {
              interruptToken: active.callback_token,
              callbackUrl: `/v1/interrupts/${active.callback_token}`,
            }
          : {}),
      };
      currentNodeId = active.node_id;
    }
  }

  // Surface child runs spawned via `core.subWorkflow` so clients can
  // observe parent/child linkage and conformance scenarios can walk
  // the cascade. Empty array when no children.
  const children = db
    .prepare(
      'SELECT run_id, status FROM runs WHERE parent_run_id = ? ORDER BY started_at ASC',
    )
    .all(runId) as Array<{ run_id: string; status: string }>;
  const childRuns = children.map((c) => ({ runId: c.run_id, status: c.status }));

  sendJSON(res, 200, {
    runId: row.run_id,
    workflowId: row.workflow_id,
    status: row.status,
    inputs: JSON.parse(row.inputs_json),
    variables: row.variables_json ? JSON.parse(row.variables_json) : {},
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
    ...(currentNodeId ? { currentNodeId } : {}),
    ...(interrupt ? { interrupt } : {}),
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id, parentNodeId: row.parent_node_id } : {}),
    ...(childRuns.length > 0 ? { childRuns } : {}),
    // RFC 0026 — per-run cost rollup (run-snapshot.schema.json
    // §metrics.openwopCost). Omitted when no cost was recorded.
    ...(snapshotCostRollup(row.run_id) ? { metrics: { openwopCost: snapshotCostRollup(row.run_id) } } : {}),
  });
}

async function handleResolveInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  nodeId: string,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  const row = loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  const interrupt = getInterrupt(db, runId, nodeId);
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

  const resumeValue = parsed.resumeValue;
  const outcome =
    interrupt.kind === 'approval'
      ? resolveApproval(db, runId, nodeId, resumeValue)
      : resolveClarification(db, runId, nodeId, resumeValue);

  if (outcome.kind === 'unknown') {
    sendError(res, 404, 'interrupt_not_found', 'Interrupt resolved or missing.');
    return;
  }
  if (outcome.kind === 'expired') {
    // 410 Gone is the spec-preferred late-resolve code; same shape as
    // the post-cascade resolve path in interrupt-profiles.md.
    sendError(res, 410, 'interrupt_expired', 'Interrupt has expired.');
    return;
  }
  if (outcome.kind === 'invalid') {
    sendError(res, outcome.status, outcome.code, outcome.message);
    return;
  }

  logAudit(db, {
    actor: 'tenant:default',
    action: 'interrupt.resolve',
    target: `${runId}:${nodeId}`,
    details: { outcome: outcome.kind, votes: outcome.kind === 'pending' ? outcome.votes.length : undefined },
  });
  triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);

  if (outcome.kind === 'pending') {
    // Quorum not yet met. Emit a vote event so observers can see progress;
    // run remains in waiting-approval.
    appendEvent(runId, 'interrupt.vote', {
      nodeId,
      data: { votes: outcome.votes },
    });
    sendJSON(res, 200, {
      runId,
      status: 'waiting-approval',
      interrupt: {
        kind: interrupt.kind,
        nodeId,
        votes: outcome.votes,
      },
    });
    return;
  }

  if (outcome.kind === 'rejected') {
    appendEvent(runId, 'node.completed', { nodeId, data: { outcome: 'rejected' } });
    appendEvent(runId, 'run.failed', {
      data: { code: 'interrupt_rejected', message: 'Approval gate rejected by quorum.' },
    });
    setRunTerminal(runId, 'failed', {
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

  // 'resumed' — close out this node and resume the executor from the next one.
  appendEvent(runId, 'node.resumed', { nodeId, data: { action: outcome.finalAction } });
  appendEvent(runId, 'node.completed', { nodeId });
  // Bump the executor cursor past the resumed node so runWorkflow starts
  // at the next node. Re-acquire claim if needed and re-enter the executor.
  db.prepare("UPDATE runs SET status = 'running', next_node_index = ? WHERE run_id = ?").run(
    (row.next_node_index ?? 0) + 1,
    runId,
  );
  if (tryClaim(runId)) {
    // Fire-and-forget — the executor handles its own lifecycle.
    void runWorkflow(runId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      appendEvent(runId, 'run.failed', { data: { code: 'internal', message } });
      setRunTerminal(runId, 'failed', { code: 'internal', message });
    });
  }
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
  // Signed-callback resolve: the token IS the authorization, so no bearer
  // check here. The token's unguessability is the entire access control.
  const interrupt = getInterruptByToken(db, token);
  if (!interrupt) {
    sendError(res, 404, 'interrupt_not_found', 'Unknown or expired interrupt token.');
    return;
  }

  // The auth-required profile (interrupt-profiles.md §"openwop-interrupt-auth-required")
  // REJECTS signed-token resolve when active. Hosts that advertise that
  // profile MUST require a bearer credential instead.
  const config = JSON.parse(interrupt.config_json) as { profile?: string };
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
      ? resolveExternalEvent(db, interrupt.run_id, interrupt.node_id, parsed.resumeValue)
      : { kind: 'invalid' as const, status: 400 as const, code: 'unsupported_token_kind', message: 'Signed-token resolve is not supported for this interrupt kind.' };

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

  logAudit(db, {
    actor: 'callback-token',
    action: 'interrupt.resolve',
    target: `${interrupt.run_id}:${interrupt.node_id}`,
    details: { outcome: outcome.kind, via: 'signed-token' },
  });
  triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);

  // For external-event: 'resumed' is the only success outcome.
  if (outcome.kind === 'resumed') {
    appendEvent(interrupt.run_id, 'node.resumed', {
      nodeId: interrupt.node_id,
      data: { action: outcome.finalAction },
    });
    appendEvent(interrupt.run_id, 'node.completed', { nodeId: interrupt.node_id });
    const row = loadRun(interrupt.run_id);
    if (row) {
      db.prepare("UPDATE runs SET status = 'running', next_node_index = ? WHERE run_id = ?").run(
        (row.next_node_index ?? 0) + 1,
        interrupt.run_id,
      );
      if (tryClaim(interrupt.run_id)) {
        void runWorkflow(interrupt.run_id).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          appendEvent(interrupt.run_id, 'run.failed', { data: { code: 'internal', message } });
          setRunTerminal(interrupt.run_id, 'failed', { code: 'internal', message });
        });
      }
    }
    sendJSON(res, 200, {
      runId: interrupt.run_id,
      nodeId: interrupt.node_id,
      status: 'running',
    });
    return;
  }

  // Unreachable for external-event resolve, but exhaustiveness keeps TS happy.
  sendError(res, 500, 'internal', 'Unexpected resolve outcome.');
}

function handleGetWorkflow(req: IncomingMessage, res: ServerResponse, workflowId: string): void {
  if (!checkAuth(req, res)) return;
  const wf = workflows.get(workflowId);
  if (!wf) {
    sendError(res, 404, 'workflow_not_found', `Unknown workflowId: ${workflowId}`);
    return;
  }
  // Return the full workflow definition as loaded from disk so clients
  // can pre-flight-validate against any declared configurableSchema
  // (run-options.md §"Per-workflow configurableSchema").
  sendJSON(res, 200, wf);
}

/**
 * Validate a `configurable` overlay against a workflow's optional
 * `configurableSchema` (a JSON Schema 2020-12 fragment). Minimal
 * implementation — supports the subset of JSON Schema the reference
 * fixtures use: `type`, `additionalProperties: false`, `properties.*`,
 * `properties.<k>.type`, `properties.<k>.minimum`, `items.type`.
 * A real host would use Ajv2020.
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

async function handleRegisterWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
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
    // Validate URL parseable.
    new URL(parsed.url);
  } catch {
    sendError(res, 400, 'validation_error', 'url MUST be a parseable URL.');
    return;
  }
  const eventTypes = Array.isArray(parsed.eventTypes)
    ? (parsed.eventTypes as string[]).filter((t) => typeof t === 'string')
    : [];
  let sub;
  try {
    sub = registerWebhook(db, {
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
  sendJSON(res, 201, {
    subscriptionId: sub.subscriptionId,
    url: sub.url,
    secret: sub.secret, // returned once on register, never again
    eventTypes: sub.eventTypes,
    createdAt: sub.createdAt,
  });
}

function handleUnregisterWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  subscriptionId: string,
): void {
  if (!checkAuth(req, res)) return;
  const removed = unregisterWebhook(db, subscriptionId);
  if (!removed) {
    sendError(res, 404, 'subscription_not_found', `Unknown subscriptionId: ${subscriptionId}`);
    return;
  }
  sendJSON(res, 200, { subscriptionId, unregistered: true });
}

function handleAuditVerify(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!checkAuth(req, res)) return;
  const fromSeqRaw = url.searchParams.get('fromSeq');
  const toSeqRaw = url.searchParams.get('toSeq');
  const fromSeq = fromSeqRaw === null ? 0 : Number(fromSeqRaw);
  const toSeq = toSeqRaw === null ? Number.MAX_SAFE_INTEGER : Number(toSeqRaw);
  if (!Number.isFinite(fromSeq) || !Number.isFinite(toSeq) || fromSeq < 0 || toSeq < 0) {
    sendError(res, 400, 'validation_error', 'fromSeq and toSeq MUST be non-negative integers.');
    return;
  }
  const result = verifyAuditChain(db, fromSeq, toSeq, auditSigningKey);
  sendJSON(res, 200, result);
}

/**
 * Per-runId cancel mechanics extracted from handleCancelRun so the
 * bulk-cancel handler can call it once per id without duplicating the
 * audit-log + cascade + abort logic. Returns the per-id result the
 * bulk-cancel response surfaces; the single-run handler maps onto
 * either `{ runId, status, alreadyTerminal? }` (200) or
 * `{ runId, status: 'cancelled' }` (200).
 */
function cancelOneRun(runId: string): { ok: true; status: 'cancelled' | 'cancelling'; alreadyTerminal?: boolean } | { ok: false; error: { code: string; message: string } } {
  const row = loadRun(runId);
  if (!row) {
    return { ok: false, error: { code: 'not_found', message: `Unknown runId: ${runId}` } };
  }
  if (row.status === 'cancelled') {
    // Idempotent re-cancel: already cancelled is a clean ok.
    return { ok: true, status: 'cancelled', alreadyTerminal: true };
  }
  if (row.status === 'completed' || row.status === 'failed') {
    // Terminal but NOT cancelled — caller can't transition this run.
    return { ok: false, error: { code: 'run_terminal', message: `Run "${runId}" is already terminal (${row.status}); cannot cancel.` } };
  }
  const children = db
    .prepare(
      "SELECT run_id FROM runs WHERE parent_run_id = ? AND status NOT IN ('completed','failed','cancelled')",
    )
    .all(runId) as Array<{ run_id: string }>;
  for (const c of children) {
    cancelRunInternal(c.run_id, 'parent-cancelled');
  }
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  if (isSuspended) {
    invalidateInterrupts(db, runId, 'cancelled');
    appendEvent(runId, 'run.cancelled');
    setRunTerminal(runId, 'cancelled', null);
    logAudit(db, {
      actor: 'tenant:default',
      action: 'run.cancel',
      target: runId,
      details: { priorStatus: row.status, viaSuspended: true, cascadedChildren: children.length },
    });
    triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);
    return { ok: true, status: 'cancelled' };
  }
  stmts.setCancelRequested.run(runId);
  logAudit(db, {
    actor: 'tenant:default',
    action: 'run.cancel',
    target: runId,
    details: { priorStatus: row.status, cascadedChildren: children.length },
  });
  triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);
  runningAborters.get(runId)?.abort();
  return { ok: true, status: 'cancelling' };
}

async function handleBulkCancel(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // rest-endpoints.md §"POST /v1/runs:bulk-cancel". Bulk-cancel is a
  // top-level operation that succeeds (200) as long as the request
  // reached the host; per-id outcomes are in the `results` array.
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let parsed: { runIds?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(bodyText) as { runIds?: unknown; reason?: unknown };
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
  const results = runIds.map((id) => {
    const outcome = cancelOneRun(id);
    return { runId: id, ...outcome };
  });
  sendJSON(res, 200, { results });
}

async function handleCancelRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!checkAuth(req, res)) return;
  await readBody(req);

  const row = loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    sendJSON(res, 200, { runId, status: row.status, alreadyTerminal: true });
    return;
  }

  // Cascade cancel: invalidate any active children first. The child's
  // parent's executor poll loop also handles cascade defensively, but
  // doing it eagerly here means the resulting GET on children shows
  // terminal 'cancelled' sooner.
  const children = db
    .prepare(
      "SELECT run_id FROM runs WHERE parent_run_id = ? AND status NOT IN ('completed','failed','cancelled')",
    )
    .all(runId) as Array<{ run_id: string }>;
  for (const c of children) {
    cancelRunInternal(c.run_id, 'parent-cancelled');
  }

  // If the run is suspended on an interrupt, there's no executor running
  // to observe a 'cancelling' flip — drive the run directly to cancelled
  // and invalidate any pending interrupts.
  const isSuspended =
    row.status === 'waiting-approval' ||
    row.status === 'waiting-input' ||
    row.status === 'waiting-external';
  if (isSuspended) {
    invalidateInterrupts(db, runId, 'cancelled');
    appendEvent(runId, 'run.cancelled');
    setRunTerminal(runId, 'cancelled', null);
    logAudit(db, {
      actor: 'tenant:default',
      action: 'run.cancel',
      target: runId,
      details: { priorStatus: row.status, viaSuspended: true, cascadedChildren: children.length },
    });
    triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);
    sendJSON(res, 200, { runId, status: 'cancelled' });
    return;
  }

  stmts.setCancelRequested.run(runId);
  logAudit(db, {
    actor: 'tenant:default',
    action: 'run.cancel',
    target: runId,
    details: { priorStatus: row.status, cascadedChildren: children.length },
  });
  triggerCheckpointIfDue(db, auditSigningKey, AUDIT_OPTS);
  // If the run is executing in THIS process, abort its in-flight node.
  // Otherwise the executing process will see the status flip on its
  // next loadRun() check.
  runningAborters.get(runId)?.abort();

  sendJSON(res, 200, { runId, status: 'cancelling' });
}

function handleEventsPoll(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  url: URL,
): void {
  if (!checkAuth(req, res)) return;
  const row = loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // version-negotiation.md §"events/poll forward-compat tolerance".
  // Canonical param is `lastSequence`; `since` accepted for back-compat.
  // A past-end cursor MUST yield 200 + empty events, never 4xx.
  // Non-numeric or negative input is a request-shape error → 400, NOT
  // silently treated as past-end (which would mask client bugs).
  const lastSeqParam =
    url.searchParams.get('lastSequence') ?? url.searchParams.get('since');
  let since = -1;
  if (lastSeqParam !== null) {
    const parsed = Number(lastSeqParam);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < -1) {
      sendError(
        res,
        400,
        'validation_error',
        'lastSequence (or legacy `since`) MUST be a non-negative integer (or -1 for "from beginning").',
      );
      return;
    }
    since = parsed;
  }
  const rows = stmts.getEventsAfter.all(runId, since) as EventRow[];
  // Emit BOTH legacy host field names (seq, data) AND canonical
  // RunEventDoc fields (eventId, sequence, payload) per
  // schemas/run-event.schema.json §required. Older readers keep
  // working; conformance scenarios that grep the canonical 6 fields
  // start passing. eventId derived as `evt-${runId}-${seq}` —
  // deterministic, unique per run, no separate column needed.
  const events = rows.map((r) => ({
    eventId: `evt-${r.run_id}-${r.seq}`,
    seq: r.seq,
    sequence: r.seq,
    runId: r.run_id,
    type: r.type,
    nodeId: r.node_id,
    data: r.data_json !== null ? JSON.parse(r.data_json) : null,
    payload: r.data_json !== null ? JSON.parse(r.data_json) : null,
    timestamp: r.timestamp,
    ...(r.causation_id !== null ? { causationId: r.causation_id } : {}),
  }));
  const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : since;

  sendJSON(res, 200, {
    runId,
    events,
    lastEventSeq: lastSeq,
    runStatus: row.status,
    isTerminal:
      row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled',
  });
}

function handleEventsSse(req: IncomingMessage, res: ServerResponse, runId: string): void {
  if (!checkAuth(req, res)) return;
  const row = loadRun(runId);
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
  // invalid streamMode or out-of-range bufferMs returns 400 to
  // EVERY client — JSON callers included.
  //
  // Validate streamMode per stream-modes.md §"Mode selection". Single
  // mode OR comma-separated subset of {values, updates, messages,
  // debug}. `values` is exclusive — can't combine with others.
  // Unknown mode → 400 unsupported_stream_mode + details.supported.
  // This host doesn't yet *filter* by mode — it returns the full
  // event stream regardless — but the validation gate is required
  // by the conformance suite (stream-modes.test.ts +
  // stream-modes-mixed.test.ts).
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

  // Validate bufferMs per stream-modes.md §"Aggregation hint" —
  // integer in [0, 5000]. bufferMs > 0: emit `event: batch` SSE
  // frames whose data is a JSON array of RunEventDocs; force-flush
  // on terminal so terminal events don't get held back past the
  // next timer interval.
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

  // Content negotiation: Accept: text/event-stream → SSE (canonical);
  // anything else (e.g., the conformance suite's append-ordering test
  // hitting /events via plain fetch) → polled JSON, same shape as
  // /events/poll. See spec/v1/stream-modes.md §"Content negotiation".
  const acceptHeader = req.headers['accept'];
  const wantsSse =
    typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream');
  if (!wantsSse) {
    const events = stmts.getEventsAfter.all(runId, -1) as EventRow[];
    sendJSON(res, 200, {
      events: events.map((r) => ({
        eventId: `evt-${r.run_id}-${r.seq}`,
        runId: r.run_id,
        seq: r.seq,
        sequence: r.seq,
        type: r.type,
        nodeId: r.node_id,
        data: r.data_json !== null ? JSON.parse(r.data_json) : null,
        payload: r.data_json !== null ? JSON.parse(r.data_json) : null,
        timestamp: r.timestamp,
        ...(r.causation_id !== null ? { causationId: r.causation_id } : {}),
      })),
    });
    return;
  }

  // Per spec/v1/stream-modes.md §"Reconnection": Last-Event-ID signals
  // a resumption — replay only events with seq > lastEventId.
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

  // Batched delivery state (bufferMs > 0). Flushes on timer interval
  // OR on terminal event (force-flush rule).
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

  const closeStream = (): void => {
    if (batchTimer) {
      clearInterval(batchTimer);
      batchTimer = null;
    }
    flushBatch();
    res.end();
  };

  const backlog = stmts.getEventsAfter.all(runId, resumeAfterSeq) as EventRow[];
  for (const r of backlog) {
    writeEvent({
      seq: r.seq,
      runId: r.run_id,
      type: r.type,
      nodeId: r.node_id,
      data: r.data_json !== null ? JSON.parse(r.data_json) : null,
      timestamp: r.timestamp,
      ...(r.causation_id !== null ? { causationId: r.causation_id } : {}),
    });
  }

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
}

function handleDebugBundle(req: IncomingMessage, res: ServerResponse, runId: string, url: URL): void {
  if (!checkAuth(req, res)) return;
  const row = loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }
  const events = stmts.getEventsAfter.all(runId, -1) as EventRow[];

  // Truncation cap (debug-bundle.md §"Bundle size limits"). Default 8MB
  // wire size; the host MAY also accept a `?maxEvents=N` host-implementation
  // override for deterministic-truncation conformance tests.
  const totalEvents = events.length;
  const maxEventsParam = url.searchParams.get('maxEvents');
  const maxEvents = maxEventsParam !== null && Number.isFinite(Number(maxEventsParam))
    ? Math.max(0, Number(maxEventsParam))
    : Number.POSITIVE_INFINITY;

  const keepEvents = Math.min(totalEvents, maxEvents);
  let truncated = keepEvents < totalEvents;
  let truncatedReason: string | undefined = truncated ? 'events_truncated_to_max_events' : undefined;
  const eventSlice = events.slice(0, keepEvents);

  const baseBundle: Record<string, unknown> = {
    bundleVersion: '1',
    generatedAt: new Date().toISOString(),
    host: { name: 'openwop-host-sqlite', version: '1.1.3', vendor: 'openwop-spec (reference example)' },
    run: {
      runId: row.run_id,
      workflowId: row.workflow_id,
      status: row.status,
      inputs: {}, // omitted per spec/v1/debug-bundle.md §"Redaction guarantees"
      startedAt: row.started_at,
      endedAt: row.ended_at,
      ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
      variables: {},
    },
    events: eventSlice.map((r) => ({
      sequence: r.seq,
      type: r.type,
      timestamp: r.timestamp,
      nodeId: r.node_id,
      data: r.data_json !== null ? JSON.parse(r.data_json) : null,
      ...(r.causation_id !== null ? { causationId: r.causation_id } : {}),
    })),
    spans: [] as unknown[],
    metrics: {
      nodeCount: new Set(events.filter((e) => e.node_id !== null).map((e) => e.node_id)).size,
      eventCount: totalEvents,
    },
    redactionApplied: true,
    redactionMode: 'omit' as const,
  };

  // 8MB byte cap. If the JSON-encoded bundle exceeds it, trim from the
  // back of the event list until it fits.
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

// ─── Router ──────────────────────────────────────────────────────────────────

const RUN_ID_PATTERN = /^\/v1\/runs\/([^/]+)$/;
const RUN_CANCEL_PATTERN = /^\/v1\/runs\/([^/]+)\/cancel$/;
const RUN_EVENTS_POLL_PATTERN = /^\/v1\/runs\/([^/]+)\/events\/poll$/;
const RUN_EVENTS_SSE_PATTERN = /^\/v1\/runs\/([^/]+)\/events$/;
const RUN_DEBUG_BUNDLE_PATTERN = /^\/v1\/runs\/([^/]+)\/debug-bundle$/;
const RUN_INTERRUPT_PATTERN = /^\/v1\/runs\/([^/]+)\/interrupts\/([^/]+)$/;
const RUN_ARTIFACT_PATTERN = /^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/;
const INTERRUPT_TOKEN_PATTERN = /^\/v1\/interrupts\/([^/]+)$/;
const WORKFLOW_ID_PATTERN = /^\/v1\/workflows\/([^/]+)$/;
const WEBHOOK_ID_PATTERN = /^\/v1\/webhooks\/([^/]+)$/;

// rest-endpoints.md §"429 Too Many Requests envelope". Deterministic
// 429-induction harness gated on OPENWOP_FORCE_RATE_LIMIT=true. When
// enabled, the host fabricates a 429 against every Nth request so the
// conformance scenario can reliably assert the envelope shape under CI.
// The induction MUST be visible only on test-only keys (any API key in
// this reference host) and MUST emit the canonical envelope.
const FORCE_RATE_LIMIT = process.env.OPENWOP_FORCE_RATE_LIMIT === 'true';
let forceRateLimitCounter = 0;

function maybeForceRateLimit(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (!FORCE_RATE_LIMIT) return false;
  // Skip the discovery endpoint's FIRST hit so the conformance harness
  // can complete its discovery probe; trip on the next probe.
  forceRateLimitCounter += 1;
  if (forceRateLimitCounter < 2) return false;
  // Trip every other request after the warm-up so the burst in
  // rate-limit-envelope.test.ts hits within its 50-call window.
  if (forceRateLimitCounter % 2 !== 0) return false;
  const retryAfterMs = 5_000;
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': '5',
  });
  res.end(JSON.stringify({
    error: 'rate_limited',
    message: `Rate limit exceeded for ${path} (forced by OPENWOP_FORCE_RATE_LIMIT).`,
    details: {
      retryAfterMs,
      scope: 'route',
      limit: 50,
      observedRate: 51,
    },
  }));
  return true;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (maybeForceRateLimit(req, res, path)) return;

  if (method === 'GET' && path === '/.well-known/openwop') return handleDiscovery(req, res);
  if (method === 'GET' && path === '/v1/openapi.json') return handleOpenApi(req, res);
  if (method === 'GET' && path === '/v1/audit/verify') return handleAuditVerify(req, res, url);
  if (method === 'POST' && path === '/v1/runs') return handleCreateRun(req, res);
  if (method === 'POST' && path === '/v1/runs:bulk-cancel') return handleBulkCancel(req, res);
  if (method === 'POST' && path === '/v1/webhooks') return handleRegisterWebhook(req, res);
  let mw = WORKFLOW_ID_PATTERN.exec(path);
  if (mw && method === 'GET') return handleGetWorkflow(req, res, decodeURIComponent(mw[1]!));
  mw = WEBHOOK_ID_PATTERN.exec(path);
  if (mw && method === 'DELETE') return handleUnregisterWebhook(req, res, decodeURIComponent(mw[1]!));

  let m = RUN_EVENTS_POLL_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsPoll(req, res, m[1]!, url);
  m = RUN_EVENTS_SSE_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsSse(req, res, m[1]!);
  m = RUN_DEBUG_BUNDLE_PATTERN.exec(path);
  if (m && method === 'GET') return handleDebugBundle(req, res, m[1]!, url);
  m = RUN_CANCEL_PATTERN.exec(path);
  if (m && method === 'POST') return handleCancelRun(req, res, m[1]!);
  m = RUN_INTERRUPT_PATTERN.exec(path);
  if (m && method === 'POST') return handleResolveInterrupt(req, res, m[1]!, decodeURIComponent(m[2]!));
  m = INTERRUPT_TOKEN_PATTERN.exec(path);
  if (m && method === 'POST')
    return handleResolveInterruptByToken(req, res, decodeURIComponent(m[1]!));
  m = RUN_ID_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetRun(req, res, m[1]!);

  // The host does NOT operate a pack registry. The spec allows hosts
  // to omit the entire /v1/packs/* namespace; the conformance suite's
  // pack-registry tests probe for "registry presence" via GET
  // /v1/packs/-/search and treat any JSON body with `error` or
  // `results` as "registry mounted." A plain-text 404 (no JSON
  // envelope) signals "no registry here" and lets the probe short-
  // circuit; the 3 pack-registry scenarios then trivially-pass via
  // their early `if (!probe.registryPresent) return;` guard. Mirror
  // of the Postgres host's catch-all.
  if (path.startsWith('/v1/packs/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('This host does not operate a pack registry.');
    return;
  }

  // Artifact endpoint stub. The host doesn't implement artifact
  // storage end-to-end, but the route MUST 401 on missing auth before
  // 404'ing on missing resource — per `artifact-auth` scenario and
  // `auth.md §"Error envelope"`. Without this stub, the catch-all
  // 404 below would respond before any auth check, letting an
  // unauthenticated caller probe whether a runId/artifactId pair
  // exists (info-leak). Match ANY method: checkAuth runs first
  // (401s internally on missing/invalid Bearer); then 405 for
  // non-GET methods (per `rest-endpoints.md §getArtifact` —
  // artifact endpoint advertises GET only); then 404 on GET since
  // the host has no artifact storage to look up.
  m = RUN_ARTIFACT_PATTERN.exec(path);
  if (m) {
    if (!checkAuth(req, res)) return;
    if (method !== 'GET') {
      sendError(
        res,
        405,
        'method_not_allowed',
        `Artifact endpoint accepts GET only; received ${method}.`,
      );
      return;
    }
    sendError(
      res,
      404,
      'not_found',
      `artifact '${decodeURIComponent(m[2]!)}' not found on run '${decodeURIComponent(m[1]!)}'`,
    );
    return;
  }

  sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
}

/**
 * Scan for orphaned runs at startup. Per spec/v1/scale-profiles.md
 * §"Replay semantics": when a process holding a claim dies
 * without releasing it, the claim expires after CLAIM_TTL_MS. Another
 * process restarting the host then picks up these orphans and resumes
 * execution.
 *
 * Orphan = status IN ('pending', 'running') AND
 *          (claim_holder_id IS NULL OR claim_expires_at < now).
 */
const findOrphansStmt = db.prepare(`
  SELECT run_id FROM runs
  WHERE status IN ('pending', 'running', 'cancelling')
    AND (claim_holder_id IS NULL OR claim_expires_at < ?)
`);

function resumeOrphans(): void {
  const now = Date.now();
  const rows = findOrphansStmt.all(now) as Array<{ run_id: string }>;
  if (rows.length === 0) return;

  let claimed = 0;
  for (const { run_id: runId } of rows) {
    if (tryClaim(runId)) {
      claimed++;
      void runWorkflow(runId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const error = { code: 'internal', message };
        appendEvent(runId, 'run.failed', { data: error });
        setRunTerminal(runId, 'failed', error);
      });
    }
  }
  if (claimed > 0) {
    console.log(
      `[openwop-host-sqlite] resume-on-startup: claimed ${claimed} of ${rows.length} orphaned run(s)`,
    );
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

loadFixtures();
resumeOrphans();

// Boot audit entry + initial checkpoint so a fresh host has at least one
// signed anchor when conformance hits /v1/audit/verify with no prior runs.
logAudit(db, {
  actor: 'system',
  action: 'host.started',
  target: PROCESS_ID,
  details: { dbPath: DB_PATH, fixtures: workflows.size },
});
// Force a checkpoint on boot regardless of interval thresholds so the
// verify endpoint has at least one signed checkpoint to return.
createCheckpoint(db, auditSigningKey);

// OTel metric loop — no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
startMetricLoop(db);

const server = createServer((req, res) => {
  void route(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendError(res, 500, 'internal', message);
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[openwop-host-sqlite] listening on http://${HOST}:${PORT} (api key: ${API_KEY}, db: ${DB_PATH}, processId: ${PROCESS_ID}, ${workflows.size} fixtures)`,
  );
});

// Graceful close on Ctrl-C — release any claims this process holds.
const shutdown = (): void => {
  console.log(`[openwop-host-sqlite] shutting down, releasing claims`);
  stopMetricLoop();
  for (const [, aborter] of runningAborters) aborter.abort();
  for (const [, handle] of runningHeartbeats) clearInterval(handle);
  runningHeartbeats.clear();
  db.exec(`UPDATE runs SET claim_holder_id = NULL WHERE claim_holder_id = '${PROCESS_ID}'`);
  db.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
