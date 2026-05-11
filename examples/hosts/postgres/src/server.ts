/**
 * OpenWOP Postgres reference host — run-lifecycle slice.
 *
 * Status (2026-05-11): basic run lifecycle works.
 *   ✅ GET /.well-known/openwop
 *   ✅ GET /v1/openapi.json
 *   ✅ POST /v1/runs (with idempotency-key + configurable validation
 *                    when workflow declares configurableSchema)
 *   ✅ GET /v1/runs/{runId}
 *   ✅ POST /v1/runs/{runId}/cancel
 *   ✅ GET /v1/runs/{runId}/events/poll
 *   ✅ Executor for core.noop + core.delay
 *
 * Deferred to follow-up sessions (port from SQLite host, module-by-module):
 *   ⏳ core.approvalGate / clarificationGate / interrupt / subWorkflow
 *   ⏳ Audit-log integrity profile (audit.ts port)
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
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { setupSchema } from './schema.js';
import { withTransaction, type Querier } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3839);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
const PG_DSN = process.env.OPENWOP_PG_DSN ?? '';
const PROCESS_ID = `host-${randomUUID().slice(0, 8)}`;

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
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
): Promise<void> {
  const q = await querier();
  await q.query(
    `INSERT INTO runs (run_id, workflow_id, status, inputs_json, started_at)
     VALUES ($1, $2, 'pending', $3, $4)`,
    [runId, workflowId, JSON.stringify(inputs), startedAt],
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
  return withTransaction(q, async () => {
    const seqRes = await q.query<{ seq: number }>(
      'UPDATE runs SET next_event_seq = next_event_seq + 1 WHERE run_id = $1 RETURNING next_event_seq - 1 AS seq',
      [runId],
    );
    if (seqRes.rows.length === 0) {
      throw new Error(`appendEvent: runId ${runId} not found`);
    }
    const seq = Number(seqRes.rows[0]!.seq);
    const event: RunEvent = {
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
        event.nodeId,
        event.data === null ? null : JSON.stringify(event.data),
        event.timestamp,
      ],
    );
    eventBus.emit(`events:${runId}`, event);
    return event;
  });
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
  await updateRunStatus(runId, status, endedAt, error);
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

type NodeOutcome = 'completed' | 'cancelled' | 'failed';

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

  switch (node.typeId) {
    case 'core.noop':
      break;

    case 'core.delay': {
      const delayMs = resolveInputAsNumber(node.inputs.delayMs, inputs, 100);
      try {
        await sleep(delayMs, signal);
      } catch {
        await appendEvent(runId, 'node.cancelled', { nodeId: node.id });
        return 'cancelled';
      }
      break;
    }

    default:
      await appendEvent(runId, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_node_type', typeId: node.typeId },
      });
      return 'failed';
  }

  await appendEvent(runId, 'node.completed', { nodeId: node.id });
  return 'completed';
}

async function runWorkflow(runId: string): Promise<void> {
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
    await updateRunStatus(runId, 'running', null, null);
    await appendEvent(runId, 'run.started');

    const startIndex = row.next_node_index ?? 0;
    for (let i = startIndex; i < workflow.nodes.length; i++) {
      const node = workflow.nodes[i]!;
      const refreshed = await loadRun(runId);
      if (refreshed?.status === 'cancelling') {
        await appendEvent(runId, 'run.cancelled');
        await setRunTerminal(runId, 'cancelled', null);
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
const SUPPORTED_NODE_TYPES = new Set(['core.noop', 'core.delay']);

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
  sendJSON(
    res,
    200,
    {
      protocolVersion: '1.0',
      implementation: {
        name: 'openwop-host-postgres',
        version: '0.2.0-partial',
        vendor: 'openwop-spec (reference example — partial: run-lifecycle only)',
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
      capabilities: {},
    },
    { 'Cache-Control': 'public, max-age=300' },
  );
}

function handleOpenApi(_req: IncomingMessage, res: ServerResponse): void {
  sendJSON(res, 200, {
    openapi: '3.1',
    info: { title: 'openwop Postgres reference host', version: '0.2.0-partial' },
    paths: {
      '/.well-known/openwop': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs': { post: { responses: { '201': { description: 'Created' } } } },
      '/v1/runs/{runId}': { get: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/cancel': { post: { responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events/poll': { get: { responses: { '200': { description: 'OK' } } } },
    },
  });
}

async function handleCreateRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;

  const bodyText = await readBody(req);
  let parsed: { workflowId?: string; inputs?: Record<string, unknown> };
  try {
    parsed = JSON.parse(bodyText) as { workflowId?: string; inputs?: Record<string, unknown> };
  } catch {
    sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
    return;
  }

  if (typeof parsed.workflowId !== 'string') {
    sendError(res, 400, 'validation_error', 'workflowId MUST be a string.');
    return;
  }
  if (!workflows.has(parsed.workflowId)) {
    sendError(res, 404, 'workflow_not_found', 'Unknown workflowId.');
    return;
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
  await insertRun(runId, parsed.workflowId, inputs, startedAt);

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

async function handleGetRun(req: IncomingMessage, res: ServerResponse, runId: string): Promise<void> {
  if (!checkAuth(req, res)) return;
  const row = await loadRun(runId);
  if (!row) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
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
  await setCancelRequested(runId);
  runningAborters.get(runId)?.abort();
  sendJSON(res, 200, { runId, status: 'cancelling' });
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
    events: events.map((e) => ({
      runId: e.runId,
      seq: e.seq,
      type: e.type,
      nodeId: e.nodeId,
      data: e.data,
      timestamp: e.timestamp,
    })),
    isComplete,
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const RUN_ID_PATTERN = /^\/v1\/runs\/([^/]+)$/;
const RUN_CANCEL_PATTERN = /^\/v1\/runs\/([^/]+)\/cancel$/;
const RUN_EVENTS_POLL_PATTERN = /^\/v1\/runs\/([^/]+)\/events\/poll$/;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/.well-known/openwop') return handleDiscovery(req, res);
  if (method === 'GET' && path === '/v1/openapi.json') return handleOpenApi(req, res);
  if (method === 'POST' && path === '/v1/runs') return handleCreateRun(req, res);

  let m = RUN_EVENTS_POLL_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsPoll(req, res, m[1]!, url);
  m = RUN_CANCEL_PATTERN.exec(path);
  if (m && method === 'POST') return handleCancelRun(req, res, m[1]!);
  m = RUN_ID_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetRun(req, res, m[1]!);

  sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Module-scope handles so `close()` can abort in-flight executors and so
// signal handlers don't accumulate across multiple `start()` calls in the
// same process (e.g., in a test suite). The handlers below register at
// most once via the `signalHandlersRegistered` guard.
let _server: import('node:http').Server | null = null;
let signalHandlersRegistered = false;

async function closeHost(): Promise<void> {
  // Abort every in-flight executor before tearing down the server + DB so
  // the awaiting promises don't fire writes to a closed querier mid-shutdown.
  for (const aborter of runningAborters.values()) aborter.abort();
  runningAborters.clear();
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
