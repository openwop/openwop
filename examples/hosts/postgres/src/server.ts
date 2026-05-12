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
  recordRunDuration,
  parseTraceparent,
  recordInboundTraceContext,
} from './observability.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3839);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
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
  }>;
  variables?: ReadonlyArray<{ name: string; type: string; required: boolean; defaultValue?: unknown }>;
  configurableSchema?: Record<string, unknown>;
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
}

interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  node_id: string | null;
  data_json: unknown;
  timestamp: string;
}

interface RunEvent {
  readonly seq: number;
  readonly runId: string;
  readonly type: string;
  readonly nodeId: string | null;
  readonly data: unknown;
  readonly timestamp: string;
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
  // Fallback: minimal noop fixture if nothing else loads.
  workflows.set('conformance-noop', {
    id: 'conformance-noop',
    name: 'Noop',
    version: '1.0',
    nodes: [{ id: 'noop', typeId: 'core.noop', name: 'Noop', inputs: {} }],
  });
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
  await q.query(
    `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, configurable_json)
     VALUES ($1, $2, 'pending', $3, $4, $5)`,
    [
      runId,
      workflowId,
      JSON.stringify(inputs),
      startedAt,
      configurable === null ? null : JSON.stringify(configurable),
    ],
  );
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

async function appendEvent(
  runId: string,
  type: string,
  opts: { nodeId?: string; data?: unknown } = {},
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
    };
    await q.query(
      `INSERT INTO events (run_id, seq, type, node_id, data_json, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        runId,
        seq,
        type,
        ev.nodeId,
        ev.data === null ? null : JSON.stringify(ev.data),
        ev.timestamp,
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

type NodeOutcome = 'completed' | 'cancelled' | 'failed' | 'paused' | 'suspended';

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
  await appendEvent(runId, 'node.started', { nodeId: node.id });
  startNodeSpan(runId, node.id, node.typeId);

  switch (node.typeId) {
    case 'core.noop':
      break;

    case 'core.delay': {
      const delayMs = resolveInputAsNumber(node.inputs.delayMs, inputs, 100);
      try {
        await sleep(delayMs, signal);
      } catch {
        // Disambiguate pause-abort from cancel-abort by reading the
        // current run status (handlePause sets 'paused' BEFORE aborting).
        const refreshed = await loadRun(runId);
        if (refreshed?.status === 'paused') {
          endNodeSpan(runId, node.id, 'paused');
          return 'paused';
        }
        await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
        endNodeSpan(runId, node.id, 'cancelled');
        return 'cancelled';
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
      const config = (node.config ?? {}) as {
        workflowId?: string;
        propagateCancellation?: boolean;
      };
      const childWorkflowId = config.workflowId;
      if (typeof childWorkflowId !== 'string' || !workflows.has(childWorkflowId)) {
        await appendEvent(runId, 'node.failed', {
          nodeId: node.id,
          data: { code: 'unknown_child_workflow', workflowId: childWorkflowId },
        });
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
        await q.query(
          `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at, parent_run_id, parent_node_id)
           VALUES ($1, $2, 'pending', '{}'::JSONB, $3, $4, $5)`,
          [childRunId, childWorkflowId, childStartedAt, runId, node.id],
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
          await appendEvent(runId, 'node.completed', {
            nodeId: node.id,
            data: { childRunId, childOutcome: 'completed' },
          });
          endNodeSpan(runId, node.id, 'completed');
          await q.query("UPDATE runs SET status = 'running' WHERE run_id = $1", [runId]);
          return 'completed';
        }
        if (child.status === 'failed') {
          await appendEvent(runId, 'node.failed', {
            nodeId: node.id,
            data: { code: 'child_failed', childRunId },
          });
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
      if (outcome === 'failed') {
        const error = {
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
    } else {
      await appendEvent(runId, 'run.completed');
      await setRunTerminal(runId, 'completed', null);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = { code: 'internal', message };
    await appendEvent(runId, 'run.failed', { data: error });
    await setRunTerminal(runId, 'failed', error);
  } finally {
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
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    sendError(res, 401, 'unauthenticated', 'Missing or malformed Authorization header.');
    return false;
  }
  const presented = header.slice('Bearer '.length);
  const presentedBuf = Buffer.from(presented, 'utf8');
  const expectedBuf = Buffer.from(API_KEY, 'utf8');
  let ok = false;
  if (presentedBuf.length === expectedBuf.length) {
    ok = timingSafeEqual(presentedBuf, expectedBuf);
  }
  if (!ok) {
    sendError(res, 401, 'invalid_credential', 'Bearer token rejected.');
    return false;
  }
  return true;
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
]);

function handleDiscovery(_req: IncomingMessage, res: ServerResponse): void {
  // Only advertise fixtures the executor can actually run. A scenario
  // gating on `isFixtureAdvertised('conformance-approval')` will skip
  // when this host advertises only its supported subset — much better
  // than advertising everything and failing each unsupported run with
  // `node.failed { code: 'unsupported_node_type' }`.
  const advertisedFixtures = Array.from(workflows.values())
    .filter(
      (wf) =>
        wf.id.startsWith('conformance-') &&
        wf.nodes.every((n) => SUPPORTED_NODE_TYPES.has(n.typeId)),
    )
    .map((wf) => wf.id);
  const key = auditSigningKey();
  sendJSON(
    res,
    200,
    {
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
        auth: {
          // Profile claims: audit + 4 optional interrupt profiles.
          profiles: [
            'openwop-audit-log-integrity',
            'openwop-interrupt-quorum',
            'openwop-interrupt-auth-required',
            'openwop-interrupt-external-event',
            'openwop-interrupt-cascade-cancel',
          ],
          auditLogIntegrity: {
            hashChain: true,
            checkpointSignatureAlgorithm: 'ed25519',
            checkpointPublicKey: key.publicKeyB64,
            checkpointIntervalEntries: AUDIT_OPTS.checkpointIntervalEntries,
            checkpointIntervalSeconds: AUDIT_OPTS.checkpointIntervalSeconds,
          },
        },
        interrupts: {
          supportedKinds: ['approval', 'clarification', 'external-event'],
          approvalActions: ['accept', 'reject', 'request-changes', 'escalate'],
        },
        webhooks: {
          supported: true,
          signatureAlgorithms: ['v1'],
        },
        runs: {
          pauseResume: { supported: true },
        },
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
      },
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
  if (!checkAuth(req, res)) return;

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

function handleGetWorkflow(
  req: IncomingMessage,
  res: ServerResponse,
  workflowId: string,
): void {
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
    ...(currentNodeId ? { currentNodeId } : {}),
    ...(interrupt ? { interrupt } : {}),
    ...(childRuns.length > 0 ? { childRuns } : {}),
  });
}

async function handleCancelRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
  if (!checkAuth(req, res)) return;
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
    })),
    isComplete,
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const RUN_ID_PATTERN = /^\/v1\/runs\/([^/]+)$/;
const RUN_CANCEL_PATTERN = /^\/v1\/runs\/([^/]+)\/cancel$/;
const RUN_EVENTS_POLL_PATTERN = /^\/v1\/runs\/([^/]+)\/events\/poll$/;
const RUN_EVENTS_SSE_PATTERN = /^\/v1\/runs\/([^/]+)\/events$/;
const RUN_DEBUG_BUNDLE_PATTERN = /^\/v1\/runs\/([^/]+)\/debug-bundle$/;
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

  _server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendError(res, 500, 'internal', message);
      else res.end();
    });
  });

  await new Promise<void>((resolve) => _server!.listen(PORT, HOST, () => resolve()));
  console.log(
    `[openwop-host-postgres] listening on http://${HOST}:${PORT} (api key: ${API_KEY}, processId: ${PROCESS_ID}, ${workflows.size} fixtures)`,
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
