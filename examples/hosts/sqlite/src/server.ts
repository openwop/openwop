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
import { randomUUID, createHash } from 'node:crypto';
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
  recordRunDuration,
  startMetricLoop,
  stopMetricLoop,
  parseTraceparent,
  recordInboundTraceContext,
} from './observability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3838);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-sqlite-dev-key';
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
}

interface RunEvent {
  readonly seq: number;
  readonly runId: string;
  readonly type: string;
  readonly nodeId: string | null;
  readonly data: unknown;
  readonly timestamp: string;
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
    'INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at) VALUES (?, ?, ?, ?, ?)',
  ),
  getRun: db.prepare('SELECT * FROM runs WHERE run_id = ?'),
  updateRunStatus: db.prepare(
    'UPDATE runs SET status = ?, ended_at = ?, error_json = ? WHERE run_id = ?',
  ),
  setCancelRequested: db.prepare(
    "UPDATE runs SET status = CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'cancelling' END WHERE run_id = ?",
  ),
  insertEvent: db.prepare(
    'INSERT INTO events (run_id, seq, type, node_id, data_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
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
}

interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  node_id: string | null;
  data_json: string | null;
  timestamp: string;
}

function loadRun(runId: string): RunRow | null {
  return (stmts.getRun.get(runId) as RunRow | undefined) ?? null;
}

function appendEvent(
  runId: string,
  type: string,
  opts: { nodeId?: string; data?: unknown } = {},
): RunEvent {
  const seq = (stmts.countEvents.get(runId) as { n: number }).n;
  const event: RunEvent = {
    seq,
    runId,
    type,
    nodeId: opts.nodeId ?? null,
    data: opts.data ?? null,
    timestamp: new Date().toISOString(),
  };
  stmts.insertEvent.run(
    runId,
    seq,
    type,
    event.nodeId,
    event.data === null ? null : JSON.stringify(event.data),
    event.timestamp,
  );
  eventBus.emit(`events:${runId}`, event);
  // Best-effort webhook delivery (webhooks.md). Fire-and-forget.
  fanOutEvent(db, { ...event });
  return event;
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

type NodeOutcome = 'completed' | 'cancelled' | 'failed' | 'suspended';

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
  appendEvent(runId, 'node.started', { nodeId: node.id });
  startNodeSpan(runId, node.id, node.typeId);

  switch (node.typeId) {
    case 'core.noop':
      break;

    case 'core.delay': {
      const delayMs = resolveInputAsNumber(node.inputs.delayMs, inputs, 100);
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
      return 'suspended';
    }

    case 'core.subWorkflow': {
      // Dispatch a child run, mirror its status onto the parent while
      // it waits, and resolve when the child terminates.
      const config = (node.config ?? {}) as { workflowId?: string; propagateCancellation?: boolean };
      const childWorkflowId = config.workflowId;
      if (typeof childWorkflowId !== 'string' || !workflows.has(childWorkflowId)) {
        appendEvent(runId, 'node.failed', {
          nodeId: node.id,
          data: { code: 'unknown_child_workflow', workflowId: childWorkflowId },
        });
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
        db.prepare(
          `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id)
           VALUES (?, ?, 'pending', '{}', ?, ?, ?)`,
        ).run(childRunId, childWorkflowId, startedAt, runId, node.id);
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
          appendEvent(runId, 'node.completed', {
            nodeId: node.id,
            data: { childRunId, childOutcome: 'completed' },
          });
          // Reset parent to running before next iteration.
          db.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
          return 'completed';
        }
        if (child.status === 'failed') {
          appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { code: 'child_failed', childRunId },
          });
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

    const startIndex = row.next_node_index ?? 0;
    for (let i = startIndex; i < workflow.nodes.length; i++) {
      const node = workflow.nodes[i]!;
      const refreshed = loadRun(runId);
      if (refreshed?.status === 'cancelling') {
        appendEvent(runId, 'run.cancelled');
        setRunTerminal(runId, 'cancelled', null);
        return;
      }

      const outcome = await executeNode(runId, node, inputs, aborter.signal);
      if (outcome === 'failed') {
        const error = {
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

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    sendError(res, 401, 'unauthenticated', 'Missing or malformed Authorization header.');
    return false;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token !== API_KEY) {
    sendError(res, 401, 'invalid_credential', 'Bearer token rejected.');
    return false;
  }
  return true;
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

function handleDiscovery(_req: IncomingMessage, res: ServerResponse): void {
  // Advertise the loaded fixture set so conformance scenarios can gate
  // their skipIf() on isFixtureAdvertised(id). Only the workflow IDs the
  // host actually has loaded should appear here.
  const advertisedFixtures = Array.from(workflows.keys()).filter((id) =>
    id.startsWith('conformance-'),
  );
  sendJSON(res, 200, {
    protocolVersion: '1.0',
    implementation: {
      name: 'openwop-host-sqlite',
      version: '1.0.0',
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
      auth: {
        // openwop-audit-log-integrity profile (auth-profiles.md §"Audit-log integrity").
        profiles: ['openwop-audit-log-integrity'],
        auditLogIntegrity: {
          hashChain: true,
          checkpointSignatureAlgorithm: 'ed25519',
          checkpointPublicKey: auditSigningKey.publicKeyB64,
          checkpointIntervalEntries: AUDIT_OPTS.checkpointIntervalEntries,
          checkpointIntervalSeconds: AUDIT_OPTS.checkpointIntervalSeconds,
        },
      },
      webhooks: {
        // webhooks.md §"Signature algorithm versioning".
        supported: true,
        signatureAlgorithms: ['v1'],
      },
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
    info: { title: 'openwop SQLite reference host', version: '1.0.0' },
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

  // Per-workflow configurableSchema validation (run-options.md §"Per-workflow
  // configurableSchema"). When the workflow declares a schema, the host MUST
  // reject mismatched `configurable` overlays with `validation_error`.
  const wfSchema = (workflow as unknown as { configurableSchema?: Record<string, unknown> })
    .configurableSchema;
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

  stmts.insertRun.run(runId, parsed.workflowId, 'pending', JSON.stringify(inputs), startedAt);

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
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
    ...(currentNodeId ? { currentNodeId } : {}),
    ...(interrupt ? { interrupt } : {}),
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id, parentNodeId: row.parent_node_id } : {}),
    ...(childRuns.length > 0 ? { childRuns } : {}),
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

  const sinceParam = url.searchParams.get('since');
  const since = sinceParam !== null ? Number(sinceParam) : -1;
  const rows = stmts.getEventsAfter.all(runId, since) as EventRow[];
  const events = rows.map((r) => ({
    seq: r.seq,
    runId: r.run_id,
    type: r.type,
    nodeId: r.node_id,
    data: r.data_json !== null ? JSON.parse(r.data_json) : null,
    timestamp: r.timestamp,
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

  const writeEvent = (event: RunEvent): void => {
    res.write(`id: ${event.seq}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
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
    });
  }

  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    res.end();
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
      res.end();
    }
  };
  eventBus.on(`events:${runId}`, onEvent);

  req.on('close', () => {
    eventBus.off(`events:${runId}`, onEvent);
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
    host: { name: 'openwop-host-sqlite', version: '1.0.0', vendor: 'openwop-spec (reference example)' },
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
const INTERRUPT_TOKEN_PATTERN = /^\/v1\/interrupts\/([^/]+)$/;
const WORKFLOW_ID_PATTERN = /^\/v1\/workflows\/([^/]+)$/;
const WEBHOOK_ID_PATTERN = /^\/v1\/webhooks\/([^/]+)$/;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/.well-known/openwop') return handleDiscovery(req, res);
  if (method === 'GET' && path === '/v1/openapi.json') return handleOpenApi(req, res);
  if (method === 'GET' && path === '/v1/audit/verify') return handleAuditVerify(req, res, url);
  if (method === 'POST' && path === '/v1/runs') return handleCreateRun(req, res);
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
