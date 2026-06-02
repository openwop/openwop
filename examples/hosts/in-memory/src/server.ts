/**
 * OpenWOP in-memory reference host.
 *
 * A minimal, single-process, zero-runtime-deps implementation of the
 * OpenWOP v1 wire contract. Built to:
 *
 *   1. Serve as the runnable example for the "OpenWOP in 10 minutes" guide.
 *   2. Drive the @openwop/openwop-conformance suite end-to-end.
 *   3. Anchor the INTEROP-MATRIX as a minimal reference host.
 *
 * Design choices:
 *
 *   - Built-in Node `http` module — no express, no fetch dependencies.
 *   - All state in process memory — runs, events, idempotency cache.
 *   - Workflow "execution" is a tiny dispatch table over fixture node
 *     types: core.noop / core.delay. Real engines plug in here via
 *     a NodeRegistry; this host doesn't have one.
 *   - Profile: claims openwop-core + openwop-stream-poll + openwop-stream-sse.
 *
 * Reference-only limitations:
 *   - Persistence (process restart drops every run).
 *   - Multi-tenant scoping (single hardcoded tenant).
 *   - Auth beyond Bearer presence (no real JWT verification).
 *   - Layer 2 idempotency, redaction harness, BYOK, provider policy,
 *     node packs — none of these are advertised in the discovery
 *     payload, so the conformance suite doesn't gate on them.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import { loadWasmPack, type LoadedWasmPack, type WasmHostBridge } from './wasm-loader.js';
import {
  expandChainFromRegistry,
  WorkflowChainExpansionError,
} from './workflow-chain-expansion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3737);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-inmem-dev-key';
// RFC 0013 Phase 3 — filesystem-mounted registry mirror for workflow-
// chain pack expansion. When unset OR the dir doesn't exist, the host
// omits `capabilities.workflowChainPacks` and the expand endpoint
// returns 503. Default points at the in-tree examples/packs/ so the
// host works out of the box when run from the repo.
const PACK_REGISTRY_DIR = process.env.OPENWOP_PACK_REGISTRY_DIR ?? join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'examples', 'packs',
);
// Liveness probe — re-evaluated on every /.well-known/openwop request
// AND every expand call so the advertisement tracks reality if the
// registry dir is removed/created mid-process. The probe is a single
// `existsSync` per call; cheap.
function workflowChainExpansionSupported(): boolean {
  return existsSync(PACK_REGISTRY_DIR);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting-approval';

interface FixtureWorkflow {
  id: string;
  name: string;
  version: string;
  nodes: ReadonlyArray<{
    id: string;
    typeId: string;
    name: string;
    inputs: Record<string, unknown>;
  }>;
  variables?: ReadonlyArray<{
    name: string;
    type: string;
    required: boolean;
    defaultValue?: unknown;
  }>;
  settings?: { timeout?: number };
}

interface RunEvent {
  readonly seq: number;
  readonly runId: string;
  readonly type: string;
  readonly nodeId?: string;
  readonly data?: unknown;
  readonly timestamp: string;
}

interface Run {
  runId: string;
  workflowId: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  events: RunEvent[];
  startedAt: string;
  endedAt: string | null;
  error: { code: string; message: string } | null;
  cancelRequested: boolean;
  abortController: AbortController;
  // RFC 0058 — resolved per-run wall-clock deadline (ms), already clamped to
  // `capabilities.limits.maxRunDurationMs`. `null` ⇒ only the host ceiling
  // (always applied) bounds the run. `timedOut` distinguishes a deadline-driven
  // abort from a caller-driven cancel (both fire `abortController`).
  runTimeoutMs: number | null;
  timedOut: boolean;
  // RFC 0059 §D — immutable read snapshot of the run-owner's workspace, taken
  // at run start (metadata only). Replay-deterministic: a run observes the same
  // workspace state for its whole duration regardless of later writes.
  workspaceSnapshot: Array<{ path: string; version: number }>;
}

// RFC 0056 — a quality annotation is a per-run SIDE-RESOURCE, deliberately
// NOT a RunEvent (so it is never replayed and never copied into a fork per
// §D). `signal.correction` and `note` are untrusted user content and are
// secret-scrubbed (SR-1) BEFORE persistence — see scrubSecretShaped().
interface StoredAnnotation {
  annotationId: string;
  target: { runId: string; eventId?: string; nodeId?: string };
  signal: Record<string, unknown>;
  actor: { principalRef: string };
  note?: string;
  createdAt: string;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

const workflows = new Map<string, FixtureWorkflow>();
const runs = new Map<string, Run>();

// RFC 0056 annotation side-store, keyed by runId. Separate from `runs` so a
// fork (a new runId) starts with zero annotations without any copy logic.
const annotations = new Map<string, StoredAnnotation[]>();

// WASM pack registry. Map of node-typeId → (pack, typeId) so dispatch can
// route unknown typeIds to a loaded pack. See loadWasmPacks() below.
const wasmTypeRegistry = new Map<string, { pack: LoadedWasmPack; typeId: string }>();
// Pack names that successfully loaded (i.e., passed ABI version check +
// instantiation). Advertised in discovery as
// `capabilities.nodePackRuntimes.wasm.loadedPacks[]` so conformance can
// verify that rejected packs (e.g., ABI mismatch per RFC 0008 §H) are
// NOT present.
const loadedWasmPackNames = new Set<string>();

// Layer-1 idempotency cache. Per spec/v1/idempotency.md §"Cache key
// composition" — single tenant here so tenantId is constant. The composite
// key is sha256(tenantId + endpoint + idempotency-key); the stored entry
// includes the body hash so we can 409 on reuse with a different body.
interface IdempotencyEntry {
  status: number;
  body: string;
  contentType: string;
  bodyHash: string;
  storedAt: number;
}
const idempotencyCache = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours per spec

const eventBus = new EventEmitter();
eventBus.setMaxListeners(1000);

// ─── Fixture loading ─────────────────────────────────────────────────────────

function loadFixtures(): void {
  // Look for fixtures in conformance/fixtures/ at the public-repo root.
  // Walk up from this file until we find a `conformance/fixtures` dir.
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
  // No fixtures found — register a synthetic noop so basic discovery works.
  workflows.set('conformance-noop', {
    id: 'conformance-noop',
    name: 'Synthetic Noop',
    version: '1.0',
    nodes: [{ id: 'noop', typeId: 'core.noop', name: 'Noop', inputs: {} }],
  });
}

// ─── WASM pack loading (RFC 0008) ────────────────────────────────────────────

interface PackJson {
  name: string;
  version: string;
  runtime?: { language?: string; entry?: string; wasm?: { abiVersion?: number } };
  nodes?: ReadonlyArray<{ typeId: string }>;
}

async function loadWasmPacks(): Promise<void> {
  // Walk up to find `examples/packs/` next to `examples/hosts/`.
  let probe = __dirname;
  let packsDir: string | null = null;
  for (let i = 0; i < 10; i++) {
    const candidate = join(probe, 'examples', 'packs');
    if (existsSync(candidate)) {
      packsDir = candidate;
      break;
    }
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  if (!packsDir) return;

  let entries: string[];
  try {
    entries = readdirSync(packsDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const packJsonPath = join(packsDir, entry, 'pack.json');
    if (!existsSync(packJsonPath)) continue;
    let manifest: PackJson;
    try {
      manifest = JSON.parse(readFileSync(packJsonPath, 'utf8')) as PackJson;
    } catch {
      continue;
    }
    if (manifest.runtime?.language !== 'wasm') continue;
    const entryFile = manifest.runtime.entry;
    if (typeof entryFile !== 'string') continue;
    const wasmPath = join(packsDir, entry, entryFile);
    if (!existsSync(wasmPath)) {
      console.warn(
        `[openwop-host-in-memory] pack ${manifest.name}: wasm entry ${entryFile} not found at ${wasmPath}; skipping. ` +
          'Run `cargo build --target wasm32-unknown-unknown --release` in the pack directory first.',
      );
      continue;
    }
    try {
      const loaded = await loadWasmPack(wasmPath);
      for (const typeId of loaded.nodeTypeIds) {
        wasmTypeRegistry.set(typeId, { pack: loaded, typeId });
      }
      loadedWasmPackNames.add(loaded.packName);
      console.log(
        `[openwop-host-in-memory] loaded WASM pack ${loaded.packName} (ABI v${loaded.abiVersion}) ` +
          `with ${loaded.nodeTypeIds.length} node type(s): ${loaded.nodeTypeIds.join(', ')}`,
      );
    } catch (err) {
      console.warn(
        `[openwop-host-in-memory] pack ${manifest.name}: load failed (${(err as Error).message ?? 'unknown'}); skipping`,
      );
    }
  }
}

function buildWasmBridge(run: Run): WasmHostBridge {
  // Minimal bridge — this reference host has no channels/variables/interrupts.
  // Real hosts wire these to their existing run-state machinery.
  const variables: Map<string, unknown> = new Map();
  for (const [k, v] of Object.entries(run.inputs)) variables.set(k, v);
  return {
    channelRead: () => undefined,
    channelWrite: () => 0,
    variableGet: (key) => variables.get(key),
    variableSet: (key, value) => {
      variables.set(key, value);
      return 0;
    },
    interrupt: () => null,
    log: (level, message) => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error'];
      console.log(
        `[wasm:${run.runId}:${levels[level] ?? 'log'}] ${message}`,
      );
    },
  };
}

// ─── Workflow execution ──────────────────────────────────────────────────────

// RFC 0058 — engine-side wall-clock ceiling this host enforces and advertises
// as `capabilities.limits.maxRunDurationMs`. A caller's `runTimeoutMs` is
// resolved as `min(runTimeoutMs, MAX_RUN_DURATION_MS)`; the ceiling always
// applies even when the caller omits `runTimeoutMs`.
const MAX_RUN_DURATION_MS = 600_000; // 10 minutes

// RFC 0058 — finalize a run that breached its wall-clock deadline. Per
// `run-options.md` §"Reserved keys" (`runTimeoutMs`): emit `cap.breached`
// with `kind: 'run-duration'` so the breach is distinguishable on the wire
// from an application failure, then transition to `failed` with `run_timeout`.
function failRunDuration(run: Run, limitMs: number, elapsedMs: number): void {
  // The deadline timer firing proves the run genuinely exceeded `limitMs`, so
  // `observed` MUST be strictly greater than `limitMs` (run-event-payloads
  // §capBreached). Integer-millisecond measurement occasionally reads exactly
  // `limitMs` at the boundary even though real elapsed is fractionally past
  // it; floor to `limitMs + 1` to honor the strict-exceedance invariant.
  const observed = Math.max(elapsedMs, limitMs + 1);
  appendEvent(run, 'cap.breached', {
    data: { kind: 'run-duration', limit: limitMs, observed },
  });
  run.status = 'failed';
  run.error = {
    code: 'run_timeout',
    message: `Run exceeded its wall-clock deadline (RFC 0058 runTimeoutMs): observed ${observed}ms vs limit ${limitMs}ms.`,
  };
  appendEvent(run, 'run.failed', { data: run.error });
  run.endedAt = new Date().toISOString();
}

function appendEvent(run: Run, type: string, opts: { nodeId?: string; data?: unknown } = {}): void {
  const event: RunEvent = {
    seq: run.events.length,
    runId: run.runId,
    type,
    ...(opts.nodeId !== undefined ? { nodeId: opts.nodeId } : {}),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    timestamp: new Date().toISOString(),
  };
  run.events.push(event);
  eventBus.emit(`events:${run.runId}`, event);
}

type NodeOutcome = 'completed' | 'cancelled' | 'failed';

async function executeNode(
  run: Run,
  node: FixtureWorkflow['nodes'][number],
): Promise<NodeOutcome> {
  if (run.cancelRequested) {
    appendEvent(run, 'node.cancelled', { nodeId: node.id });
    return 'cancelled';
  }
  appendEvent(run, 'node.started', { nodeId: node.id });

  switch (node.typeId) {
    case 'core.noop':
      // Yields immediately.
      break;

    case 'core.delay': {
      const delayMs = resolveInputAsNumber(node.inputs.delayMs, run.inputs, 100);
      try {
        await sleep(delayMs, run.abortController.signal);
      } catch {
        // Aborted. Distinguish a caller cancel from the RFC 0058 wall-clock
        // deadline (both fire `abortController`) so the node-level outcome
        // agrees with the run's terminal state: a timed-out node `failed`,
        // a cancelled node `cancelled`. The loop's `run.timedOut` check then
        // emits the run-level `cap.breached` + `run.failed { run_timeout }`.
        if (run.timedOut) {
          appendEvent(run, 'node.failed', { nodeId: node.id, data: { code: 'run_timeout' } });
          return 'failed';
        }
        appendEvent(run, 'node.cancelled', { nodeId: node.id });
        return 'cancelled';
      }
      break;
    }

    default: {
      // WASM pack dispatch (RFC 0008). If the typeId is registered against
      // a loaded WASM pack, route through the loader.
      const entry = wasmTypeRegistry.get(node.typeId);
      if (entry) {
        const bridge = buildWasmBridge(run);
        const result = await entry.pack.invoke(
          entry.typeId,
          {
            nodeContext: {
              runId: run.runId,
              nodeId: node.id,
              tenantId: 'single-tenant',
              attempt: 0,
              configurable: {},
              agent: null,
            },
            inputs: { ...run.inputs, ...node.inputs },
          },
          bridge,
        );
        if (result.outcome === 'failed') {
          run.error = {
            code: result.error.code,
            message: result.error.message,
          };
          appendEvent(run, 'node.failed', {
            nodeId: node.id,
            data: { code: result.error.code, typeId: node.typeId },
          });
          return 'failed';
        }
        if (result.outcome === 'cap-breached') {
          // RFC 0008 §K — emit `cap.breached` before terminating the run so
          // observers can attribute the failure to the resource cap, then
          // fail the node + run with `wasm_cap_breached`.
          appendEvent(run, 'cap.breached', {
            data: {
              kind: result.kind,
              limit: result.limit,
              observed: result.observed,
              nodeId: node.id,
            },
          });
          run.error = {
            code: 'wasm_cap_breached',
            message: `WASM ${result.kind} cap breached on node ${node.id}: observed ${result.observed} bytes vs limit ${result.limit} bytes.`,
          };
          appendEvent(run, 'node.failed', {
            nodeId: node.id,
            data: { code: 'wasm_cap_breached', typeId: node.typeId, kind: result.kind },
          });
          return 'failed';
        }
        if (result.outcome === 'suspended') {
          // Reference host doesn't fully implement WASM-driven suspends;
          // treat as a soft failure with a recognizable code.
          run.error = {
            code: 'wasm_suspend_not_implemented',
            message:
              'In-memory reference host does not implement WASM-driven suspends. A production host would persist the interrupt and resume on resolve.',
          };
          appendEvent(run, 'node.failed', {
            nodeId: node.id,
            data: { code: 'wasm_suspend_not_implemented' },
          });
          return 'failed';
        }
        appendEvent(run, 'node.completed', {
          nodeId: node.id,
          data: { output: result.output },
        });
        return 'completed';
      }

      // Truly unknown — fail the run.
      run.error = {
        code: 'unsupported_node_type',
        message: `In-memory host does not implement node type "${node.typeId}". This host supports core.noop, core.delay, and WASM-packaged types loaded from examples/packs/.`,
      };
      appendEvent(run, 'node.failed', {
        nodeId: node.id,
        data: { code: 'unsupported_node_type', typeId: node.typeId },
      });
      return 'failed';
    }
  }

  appendEvent(run, 'node.completed', { nodeId: node.id });
  return 'completed';
}

async function runWorkflow(run: Run): Promise<void> {
  const workflow = workflows.get(run.workflowId);
  if (!workflow) {
    run.status = 'failed';
    run.error = {
      code: 'workflow_not_found',
      message: `Unknown workflowId: ${run.workflowId}`,
    };
    appendEvent(run, 'run.failed', { data: run.error });
    run.endedAt = new Date().toISOString();
    return;
  }

  run.status = 'running';
  appendEvent(run, 'run.started');

  // RFC 0058 — arm the wall-clock deadline. The resolved bound (clamped to
  // MAX_RUN_DURATION_MS at run-create) is always present because the host
  // ceiling applies even when the caller omits `runTimeoutMs`. The timer
  // aborts in-flight work; `timedOut` lets the loop attribute the abort to the
  // deadline rather than a caller cancel. `observed` is measured, not the
  // limit, per `cap.breached` semantics (limit=resolvedMs, observed=elapsedMs).
  const startMs = Date.now();
  const deadlineMs = run.runTimeoutMs ?? MAX_RUN_DURATION_MS;
  const timeoutTimer = setTimeout(() => {
    run.timedOut = true;
    run.abortController.abort();
  }, deadlineMs);
  // Don't let a pending deadline timer hold the event loop open; the HTTP
  // server keeps the process alive, and the timer is always cleared in the
  // `finally` below once the run settles.
  timeoutTimer.unref();

  try {
    for (const node of workflow.nodes) {
      if (run.timedOut) {
        failRunDuration(run, deadlineMs, Date.now() - startMs);
        return;
      }
      if (run.cancelRequested) {
        run.status = 'cancelled';
        appendEvent(run, 'run.cancelled');
        run.endedAt = new Date().toISOString();
        return;
      }
      const outcome = await executeNode(run, node);
      // A deadline that fired mid-node aborts the node (surfacing as
      // 'cancelled'); re-attribute it to the run-duration breach here.
      if (run.timedOut) {
        failRunDuration(run, deadlineMs, Date.now() - startMs);
        return;
      }
      if (outcome === 'failed') {
        run.status = 'failed';
        appendEvent(run, 'run.failed', { data: run.error });
        run.endedAt = new Date().toISOString();
        return;
      }
      if (outcome === 'cancelled') {
        run.status = 'cancelled';
        appendEvent(run, 'run.cancelled');
        run.endedAt = new Date().toISOString();
        return;
      }
    }

    if (run.cancelRequested) {
      run.status = 'cancelled';
      appendEvent(run, 'run.cancelled');
    } else {
      run.status = 'completed';
      appendEvent(run, 'run.completed');
    }
    run.endedAt = new Date().toISOString();
  } finally {
    clearTimeout(timeoutTimer);
  }
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
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

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  // Per spec/v1/auth.md error envelope: {error: <code>, message: <human>, ...}.
  sendJSON(res, status, { error: code, message, ...extra });
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    sendError(res, 401, 'unauthenticated', 'Missing or malformed Authorization header.');
    return false;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token !== API_KEY) {
    // Per spec/v1/auth.md §3: invalid credential returns 401. 403 is for
    // valid credential lacking permission for the resource.
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

function pruneIdempotencyCache(): void {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, entry] of idempotencyCache) {
    if (entry.storedAt < cutoff) idempotencyCache.delete(key);
  }
}

// ─── RFC 0059 — host.workspace (versioned tenant·workspace file store) ───────
//
// A durable, path-addressable ground-truth file layer complementing the
// transactional MemoryAdapter (RFC 0004). Every file is owned by a
// {tenant, workspace} triple (RFC 0048). This single-API-key host binds the
// production §C endpoints to one authenticated owner (DEFAULT_WORKSPACE_OWNER);
// the documented test seam (`host-sample-test-seams.md` §9) drives explicit
// owners so the WCT-1 cross-workspace-isolation invariant is exercisable.

const WORKSPACE_MAX_FILE_BYTES = 1_048_576; // 1 MiB
const WORKSPACE_MAX_FILES = 256;
const WORKSPACE_MAX_VERSIONS = 20;
const WORKSPACE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const DEFAULT_WORKSPACE_OWNER = { tenant: 'single-tenant', workspace: 'default' } as const;

interface WorkspaceVersion {
  content: string;
  contentType: string;
  version: number;
  etag: string;
  updatedAt: string;
  deleted: boolean; // tombstone — a deleted path keeps its history (versioned)
}

// owner key (`tenant workspace`) → path → version history (oldest..latest).
const workspaceStore = new Map<string, Map<string, WorkspaceVersion[]>>();

function workspaceOwnerFiles(tenant: string, workspace: string): Map<string, WorkspaceVersion[]> {
  const key = `${tenant} ${workspace}`;
  let files = workspaceStore.get(key);
  if (!files) {
    files = new Map();
    workspaceStore.set(key, files);
  }
  return files;
}

function workspaceEtag(path: string, version: number): string {
  // Opaque, deterministic per (path, version) — sufficient for If-Match.
  return `"${createHash('sha256').update(`${path}:${version}`).digest('hex').slice(0, 16)}"`;
}

function workspaceLatestLive(history: WorkspaceVersion[] | undefined): WorkspaceVersion | undefined {
  if (history === undefined || history.length === 0) return undefined;
  const last = history[history.length - 1]!;
  return last.deleted ? undefined : last;
}

function toWorkspaceFile(path: string, v: WorkspaceVersion): Record<string, unknown> {
  return {
    path,
    content: v.content,
    contentType: v.contentType,
    version: v.version,
    etag: v.etag,
    updatedAt: v.updatedAt,
  };
}

type WorkspaceOpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

// Core CRUD over the store, ALWAYS owner-scoped: a caller can only ever
// address its own {tenant, workspace} (WCT-1). Shared verbatim by the §C
// endpoints (bound to DEFAULT_WORKSPACE_OWNER) and the test seam (explicit
// owner). Routing isolation by the owner key — never trusting a caller hint
// to widen scope — is what makes WCT-1 hold.
function workspaceListOp(tenant: string, workspace: string, prefix: string | null): WorkspaceOpResult {
  const files = workspaceOwnerFiles(tenant, workspace);
  const out: Record<string, unknown>[] = [];
  for (const [path, history] of files) {
    const live = workspaceLatestLive(history);
    if (live === undefined) continue;
    if (prefix !== null && prefix !== '' && !path.startsWith(prefix)) continue;
    const { content: _content, ...metadata } = toWorkspaceFile(path, live); // list omits bodies
    void _content;
    out.push(metadata);
  }
  out.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { ok: true, status: 200, body: { files: out } };
}

function workspaceGetOp(
  tenant: string,
  workspace: string,
  path: string,
  version: number | null,
): WorkspaceOpResult {
  if (!WORKSPACE_PATH_PATTERN.test(path)) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Invalid workspace path.' };
  }
  const history = workspaceOwnerFiles(tenant, workspace).get(path);
  if (version !== null) {
    const v = history?.find((h) => h.version === version && !h.deleted);
    if (v === undefined) {
      return { ok: false, status: 404, code: 'not_found', message: 'No such workspace file version.' };
    }
    return { ok: true, status: 200, body: toWorkspaceFile(path, v) };
  }
  const live = workspaceLatestLive(history);
  if (live === undefined) {
    return { ok: false, status: 404, code: 'not_found', message: 'No such workspace file.' };
  }
  return { ok: true, status: 200, body: toWorkspaceFile(path, live) };
}

function workspacePutOp(
  tenant: string,
  workspace: string,
  path: string,
  content: unknown,
  contentType: unknown,
  ifMatch: string | null,
): WorkspaceOpResult {
  if (!WORKSPACE_PATH_PATTERN.test(path)) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Invalid workspace path.' };
  }
  if (typeof content !== 'string') {
    return { ok: false, status: 400, code: 'validation_error', message: 'content MUST be a string.' };
  }
  if (Buffer.byteLength(content, 'utf8') > WORKSPACE_MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'workspace_too_large',
      message: `content exceeds maxFileBytes (${WORKSPACE_MAX_FILE_BYTES}).`,
    };
  }
  const files = workspaceOwnerFiles(tenant, workspace);
  const history = files.get(path);
  const live = workspaceLatestLive(history);

  // Optimistic concurrency: a supplied If-Match MUST equal the current live
  // etag, else 409 workspace_conflict with details.currentVersion.
  if (ifMatch !== null) {
    const currentEtag = live?.etag ?? null;
    if (currentEtag !== ifMatch) {
      return {
        ok: false,
        status: 409,
        code: 'workspace_conflict',
        message: 'If-Match etag does not match the current version.',
        extra: { details: { currentVersion: live?.version ?? 0 } },
      };
    }
  }

  // File-count ceiling applies only when introducing a NEW live path.
  if (live === undefined) {
    let liveCount = 0;
    for (const h of files.values()) if (workspaceLatestLive(h) !== undefined) liveCount++;
    if (liveCount >= WORKSPACE_MAX_FILES) {
      return {
        ok: false,
        status: 413,
        code: 'workspace_too_large',
        message: `workspace already holds maxFiles (${WORKSPACE_MAX_FILES}).`,
      };
    }
  }

  const prevVersion = history !== undefined && history.length > 0 ? history[history.length - 1]!.version : 0;
  const version = prevVersion + 1;
  const v: WorkspaceVersion = {
    // WSR-1 (RFC 0059 §E): redact BYOK-resolved plaintext on write, reusing
    // the SR-1 mechanism. A subsequent GET/list never surfaces the plaintext.
    content: scrubSecretShaped(content),
    contentType: typeof contentType === 'string' ? contentType : 'text/markdown',
    version,
    etag: workspaceEtag(path, version),
    updatedAt: new Date().toISOString(),
    deleted: false,
  };
  const newHistory = history ?? [];
  newHistory.push(v);
  // Latest is the MUST; history retained best-effort up to maxVersions.
  while (newHistory.length > WORKSPACE_MAX_VERSIONS) newHistory.shift();
  files.set(path, newHistory);
  return { ok: true, status: 200, body: toWorkspaceFile(path, v) };
}

function workspaceDeleteOp(tenant: string, workspace: string, path: string): WorkspaceOpResult {
  if (!WORKSPACE_PATH_PATTERN.test(path)) {
    return { ok: false, status: 400, code: 'validation_error', message: 'Invalid workspace path.' };
  }
  const files = workspaceOwnerFiles(tenant, workspace);
  const history = files.get(path);
  const live = workspaceLatestLive(history);
  if (live === undefined) {
    return { ok: false, status: 404, code: 'not_found', message: 'No such workspace file.' };
  }
  // Write a tombstone version (history preserved when versioned).
  const version = live.version + 1;
  history!.push({
    content: '',
    contentType: live.contentType,
    version,
    etag: workspaceEtag(path, version),
    updatedAt: new Date().toISOString(),
    deleted: true,
  });
  while (history!.length > WORKSPACE_MAX_VERSIONS) history!.shift();
  return { ok: true, status: 204, body: null };
}

// §C endpoints — bound to the single authenticated owner. `{path}` is the
// percent-decoded remainder after `/v1/host/workspace/files/`.
function handleWorkspaceList(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!checkAuth(req, res)) return;
  const r = workspaceListOp(
    DEFAULT_WORKSPACE_OWNER.tenant,
    DEFAULT_WORKSPACE_OWNER.workspace,
    url.searchParams.get('prefix'),
  );
  if (!r.ok) return void sendError(res, r.status, r.code, r.message, r.extra);
  sendJSON(res, r.status, r.body);
}

function handleWorkspaceGet(req: IncomingMessage, res: ServerResponse, rawPath: string, url: URL): void {
  if (!checkAuth(req, res)) return;
  const versionParam = url.searchParams.get('version');
  const version = versionParam !== null ? Number(versionParam) : null;
  if (version !== null && !Number.isInteger(version)) {
    return void sendError(res, 400, 'validation_error', 'version MUST be an integer.');
  }
  const r = workspaceGetOp(
    DEFAULT_WORKSPACE_OWNER.tenant,
    DEFAULT_WORKSPACE_OWNER.workspace,
    decodeURIComponent(rawPath),
    version,
  );
  if (!r.ok) return void sendError(res, r.status, r.code, r.message, r.extra);
  sendJSON(res, r.status, r.body);
}

async function handleWorkspacePut(req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let parsed: { content?: unknown; contentType?: unknown };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  const ifMatchHeader = req.headers['if-match'];
  const ifMatch = typeof ifMatchHeader === 'string' ? ifMatchHeader : null;
  const r = workspacePutOp(
    DEFAULT_WORKSPACE_OWNER.tenant,
    DEFAULT_WORKSPACE_OWNER.workspace,
    decodeURIComponent(rawPath),
    parsed.content,
    parsed.contentType,
    ifMatch,
  );
  if (!r.ok) return void sendError(res, r.status, r.code, r.message, r.extra);
  sendJSON(res, r.status, r.body);
}

function handleWorkspaceDelete(req: IncomingMessage, res: ServerResponse, rawPath: string): void {
  if (!checkAuth(req, res)) return;
  const r = workspaceDeleteOp(
    DEFAULT_WORKSPACE_OWNER.tenant,
    DEFAULT_WORKSPACE_OWNER.workspace,
    decodeURIComponent(rawPath),
  );
  if (!r.ok) return void sendError(res, r.status, r.code, r.message, r.extra);
  res.writeHead(r.status).end(); // 204 No Content
}

// Test seam (host-sample-test-seams.md §9) — drives workspace CRUD against an
// EXPLICIT {tenant, workspace} owner so the WCT-1 cross-workspace-isolation
// invariant is exercisable on this single-credential host (mirrors the
// blob/kv/table cross-tenant seams on the persistent hosts).
async function handleWorkspaceSeam(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: {
    tenant?: unknown;
    workspace?: unknown;
    op?: unknown;
    path?: unknown;
    content?: unknown;
    contentType?: unknown;
    ifMatch?: unknown;
    prefix?: unknown;
    version?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  const tenant = typeof body.tenant === 'string' ? body.tenant : DEFAULT_WORKSPACE_OWNER.tenant;
  const workspace = typeof body.workspace === 'string' ? body.workspace : DEFAULT_WORKSPACE_OWNER.workspace;
  const path = typeof body.path === 'string' ? body.path : '';
  const ifMatch = typeof body.ifMatch === 'string' ? body.ifMatch : null;
  let r: WorkspaceOpResult;
  switch (body.op) {
    case 'list':
      r = workspaceListOp(tenant, workspace, typeof body.prefix === 'string' ? body.prefix : null);
      break;
    case 'get':
      r = workspaceGetOp(tenant, workspace, path, typeof body.version === 'number' ? body.version : null);
      break;
    case 'put':
      r = workspacePutOp(tenant, workspace, path, body.content, body.contentType, ifMatch);
      break;
    case 'delete':
      r = workspaceDeleteOp(tenant, workspace, path);
      break;
    default:
      return void sendError(res, 400, 'validation_error', 'op MUST be one of list|get|put|delete.');
  }
  if (!r.ok) return void sendError(res, r.status, r.code, r.message, r.extra);
  sendJSON(res, r.status, r.body ?? { ok: true });
}

// §D — snapshot of the run-owner's workspace taken at run.started, immutable
// for the run's duration (replay-deterministic). Metadata only (no bodies).
function workspaceSnapshotFor(tenant: string, workspace: string): Array<{ path: string; version: number }> {
  const files = workspaceOwnerFiles(tenant, workspace);
  const snapshot: Array<{ path: string; version: number }> = [];
  for (const [path, history] of files) {
    const live = workspaceLatestLive(history);
    if (live !== undefined) snapshot.push({ path, version: live.version });
  }
  snapshot.sort((a, b) => a.path.localeCompare(b.path));
  return snapshot;
}

// ─── RFC 0060 — host.heartbeat (predicate-gated polling) ─────────────────────
//
// System-managed, runtime-bounded evaluation of an idempotent predicate that
// emits state-change events and conditionally enqueues a run — rather than
// re-running an agent blindly. The anti-spam guarantee (§B.5): action is gated
// on a state *transition*, not on the tick. The cross-host driver is the
// documented `POST /v1/host/sample/heartbeat/tick` seam.

const HEARTBEAT_MIN_INTERVAL_SEC = 1;
const HEARTBEAT_MAX_RUNTIME_MS = 5_000;

// heartbeatId → the last tick's persisted predicate state (the transition
// detector). Opaque, host-defined; carries no secret material (§B payload).
const heartbeatState = new Map<string, Record<string, unknown>>();

// Stable stringify (sorted keys) so a transition is detected by VALUE, not by
// incidental key order across ticks.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

async function handleHeartbeatTick(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: { heartbeatId?: unknown; observedState?: unknown; simulateSlowMs?: unknown };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  if (typeof body.heartbeatId !== 'string' || body.heartbeatId.length === 0) {
    return void sendError(res, 400, 'validation_error', 'heartbeatId MUST be a non-empty string.');
  }
  const heartbeatId = body.heartbeatId;
  const observedState =
    body.observedState !== null && typeof body.observedState === 'object'
      ? (body.observedState as Record<string, unknown>)
      : {};

  // §B.2 — `simulateSlowMs` over the budget terminates the evaluation; report
  // `status: 'timeout'`. A terminated evaluation neither transitions nor
  // enqueues (it never completed), so the prior state is left untouched.
  const simulateSlowMs = typeof body.simulateSlowMs === 'number' ? body.simulateSlowMs : 0;
  if (simulateSlowMs > HEARTBEAT_MAX_RUNTIME_MS) {
    return void sendJSON(res, 200, {
      evaluated: [{ heartbeatId, status: 'timeout', changed: false }],
      stateChanged: [],
      enqueuedRuns: 0,
    });
  }

  // §B.5 — a transition is `observedState` differing from the prior tick's
  // persisted state. Only a transition emits `heartbeat.stateChanged` +
  // enqueues a run; an unchanged tick does neither (anti-spam).
  const prior = heartbeatState.get(heartbeatId);
  const changed = prior === undefined || stableStringify(prior) !== stableStringify(observedState);
  heartbeatState.set(heartbeatId, observedState);

  sendJSON(res, 200, {
    // §B.1 — exactly one `heartbeat.evaluated` per tick.
    evaluated: [{ heartbeatId, status: 'ok', changed }],
    stateChanged: changed
      ? [{ heartbeatId, from: prior ?? {}, to: observedState }]
      : [],
    enqueuedRuns: changed ? 1 : 0,
  });
}

// ─── RFC 0063 — core.subWorkflow output attestation + merge gating ───────────
//
// Verify-before-merge: a parent computes a byte-stable checksum of a child's
// outputs (RFC 8785 JCS-style canonical JSON + SHA-256, so a cross-host child
// verifies) and — when `requireApproval` is set — suspends via an RFC 0051
// approval interrupt BEFORE `outputMapping`, merging ONLY on accept and failing
// CLOSED on reject / absent / expired. The cross-host driver is the documented
// `POST /v1/host/sample/subrun/attest` seam.

// Canonical checksum of a child's outputs: `stableStringify` gives the
// JCS-style key-order-invariant serialization (RFC 8785 spirit; the v1 recipe
// in replay.md), hashed with SHA-256. Identical content → identical digest,
// independent of host or key order.
function subRunChecksum(childOutputs: unknown): string {
  return createHash('sha256').update(stableStringify(childOutputs)).digest('hex');
}

async function handleSubRunAttest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: {
    childOutputs?: unknown;
    outputAttestation?: { checksum?: unknown; algorithm?: unknown; requireApproval?: unknown };
    approvalAction?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  const childOutputs = body.childOutputs ?? {};
  const spec = body.outputAttestation ?? {};

  // §B — surface a checksum + algorithm on the harvested-output attestation
  // when the parent requested one.
  const attestation: { checksum?: string; algorithm?: string } =
    spec.checksum === true ? { checksum: subRunChecksum(childOutputs), algorithm: 'sha256' } : {};

  // §C — merge gate. `requireApproval` suspends before `outputMapping`; the
  // merge proceeds ONLY on an explicit accept (or edit-accept), and fails
  // CLOSED for reject / absent / expired (the no-approval default merges).
  const merged =
    spec.requireApproval === true
      ? body.approvalAction === 'accept' || body.approvalAction === 'edit-accept'
      : true;

  sendJSON(res, 200, {
    attestation,
    // The shape the host would surface on the existing RFC 0037
    // `core.workflowChain.event { phase: 'output.harvested' }` (no new event).
    harvestedEvent: {
      phase: 'output.harvested',
      ...(attestation.checksum !== undefined ? { attestation } : {}),
    },
    merged,
    ...(merged ? { mergedValues: childOutputs } : {}),
  });
}

// ─── RFC 0064 — host.toolHooks (per-tool authz + rate limit + content-free audit) ─
//
// Per-tool authorization (RFC 0049, fail-closed) + per-(principal, tool) rate
// limiting + a content-free tool-call audit trail, layered on the existing
// `agent.toolCalled` / `agent.toolReturned` events (RFC 0002) — no new event
// type or error code. The cross-host driver is the documented
// `POST /v1/host/sample/toolhooks/invoke` seam.

const TOOLHOOKS_TRANSPORT = 'native';

async function handleToolHooksInvoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: {
    principal?: unknown;
    toolName?: unknown;
    requiredScopes?: unknown;
    args?: unknown;
    simulateRateLimitExhausted?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  const principal = typeof body.principal === 'string' ? body.principal : 'core.system';
  const requiredScopes = Array.isArray(body.requiredScopes) ? body.requiredScopes : [];
  // `body.toolName` is accepted for request-shape fidelity but unused by this
  // simulation: the rate-limit is a pass-through flag, not a real per-
  // `(principal, toolName)` token bucket. A production host keys a real bucket
  // on `(principal, toolName)`.

  // §B — the content-free audit fields on `agent.toolCalled`. `argsHash` is the
  // JCS+SHA-256 of the args AFTER SR-1 redaction (a resolved secret is replaced
  // before hashing, so neither the hash input nor any emitted field carries the
  // plaintext).
  const argsHash = createHash('sha256')
    .update(scrubSecretShaped(stableStringify(body.args ?? {})))
    .digest('hex');
  const toolCalled = { argsHash, principal, transport: TOOLHOOKS_TRANSPORT };

  // §C — per-tool authorization, fail-closed (RFC 0049). This host has no role/
  // scope resolver, so any required scope is unevaluable ⇒ deny. §D — per-tool
  // rate limit. Either gate prevents the tool from running (no `durationMs`).
  let status: 'ok' | 'forbidden' | 'rate_limited';
  if (requiredScopes.length > 0) {
    status = 'forbidden';
  } else if (body.simulateRateLimitExhausted === true) {
    status = 'rate_limited';
  } else {
    status = 'ok';
  }

  const toolReturned: { status: string; durationMs?: number } = { status };
  // §B — a completed call records a non-negative duration; a call that never
  // started (forbidden / rate_limited) records none.
  if (status === 'ok') toolReturned.durationMs = 0;

  sendJSON(res, 200, { toolCalled, toolReturned });
}

// ─── RFC 0076 §B — host-provided ctx.http.safeFetch ──────────────────────────
//
// The pack-facing exposure of the SSRF-guarded HTTP client (capabilities
// httpClient.safeFetch). The guard is resolve->pin->connect: reject loopback /
// RFC 1918 / link-local / cloud-metadata targets, pin the resolved IP so a
// re-resolution cannot rebind to a blocked address, and refuse a Connection:
// upgrade (no 101 socket-hijack escape). Reuses the http-client-ssrf-guard
// invariant + the maxResponseBodyBytes cap — no new invariant. Because this host
// also advertises toolHooks.prePostEvents, a fetched call emits the
// agent.toolCalled / agent.toolReturned pair (transport: 'http'). The cross-host
// driver is the POST /v1/host/sample/http/safe-fetch seam. This reference seam
// SIMULATES the successful fetch (no real egress in the conformance env); the
// blocking decisions are real.

const SAFEFETCH_MAX_RESPONSE_BODY_BYTES = 10_485_760; // 10 MiB
const SAFEFETCH_REQUEST_TIMEOUT_MS = 30_000;

/** SSRF blocklist for a target host literal. Returns the block reason, or null
 *  when the address/name is public. IP-literal checks mirror the Postgres
 *  reference host's `checkHttpDestination`. */
function safeFetchBlockReason(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    return 'loopback/internal hostname';
  }
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    if (a === 127) return '127.0.0.0/8 (loopback)';
    if (a === 10) return '10.0.0.0/8 (RFC1918)';
    if (a === 172 && b >= 16 && b <= 31) return '172.16.0.0/12 (RFC1918)';
    if (a === 192 && b === 168) return '192.168.0.0/16 (RFC1918)';
    if (a === 169 && b === 254) return '169.254.0.0/16 (link-local; cloud metadata)';
    if (a === 0) return '0.0.0.0/8';
  }
  if (v === 6) {
    if (h === '::1' || h === '::ffff:127.0.0.1') return 'IPv6 loopback';
    if (h.startsWith('fe80')) return 'IPv6 link-local';
    if (h.startsWith('fc') || h.startsWith('fd')) return 'IPv6 unique-local';
  }
  return null;
}

async function handleSafeFetch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: {
    url?: unknown;
    init?: { method?: unknown; headers?: unknown; body?: unknown };
    simulateRebindTo?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  if (typeof body.url !== 'string') {
    return void sendError(res, 400, 'validation_error', 'url: string is required.');
  }
  let target: URL;
  try {
    target = new URL(body.url);
  } catch {
    return void sendError(res, 400, 'validation_error', 'url MUST be a valid absolute URL.');
  }

  // Connection: upgrade refusal — escaping HTTP into a raw bidirectional socket
  // would defeat the resolve->pin->connect boundary. Case-insensitive lookup.
  const rawHeaders =
    body.init && typeof body.init === 'object' && body.init.headers && typeof body.init.headers === 'object'
      ? (body.init.headers as Record<string, string>)
      : {};
  const connection = Object.entries(rawHeaders).find(([k]) => k.toLowerCase() === 'connection')?.[1];
  if (typeof connection === 'string' && connection.toLowerCase().includes('upgrade')) {
    return void sendJSON(res, 200, { outcome: 'blocked', blocked: 'upgrade' });
  }

  // SSRF guard on the request host.
  if (safeFetchBlockReason(target.hostname) !== null) {
    return void sendJSON(res, 200, { outcome: 'blocked', blocked: 'ssrf' });
  }
  // DNS-rebinding defeat: the resolved IP is pinned for the connection. The seam
  // models a re-resolution via `simulateRebindTo`; a public name that re-resolves
  // to a blocked address MUST still be blocked.
  if (typeof body.simulateRebindTo === 'string' && safeFetchBlockReason(body.simulateRebindTo) !== null) {
    return void sendJSON(res, 200, { outcome: 'blocked', blocked: 'ssrf' });
  }

  // Public target, no upgrade: the guarded client fetches (simulated here). The
  // body/timeout caps (SAFEFETCH_*) apply in a real impl. Emit the tool-hooks
  // audit pair since this host advertises toolHooks.prePostEvents (RFC 0064).
  const argsHash = createHash('sha256')
    .update(scrubSecretShaped(stableStringify({ url: body.url })))
    .digest('hex');
  const toolCalled = { argsHash, principal: 'core.system', transport: 'http' };
  const toolReturned = { status: 'ok', durationMs: 0 };
  sendJSON(res, 200, { outcome: 'fetched', status: 200, toolCalled, toolReturned });
}

// ─── RFC 0062 — scheduled memory distillation ("dreams") ─────────────────────
//
// A budgeted compaction (RFC 0012) that writes a byte-stable archive and a
// retrievable `MEMORY-INDEX.json` workspace file (RFC 0059), emitting the
// existing `memory.compacted` event with an additive `distillation` sub-object
// — no parallel event. Composes RFC 0012 + 0052 + 0059. SR-1 carry-forward
// (RFC 0012 §D) holds: a redacted secret is scrubbed before archiving + never
// re-exposed. The cross-host driver is the `POST /v1/host/sample/memory/distill`
// seam.

const DISTILLATION_MAX_TOKEN_BUDGET = 100_000;

async function handleMemoryDistill(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: {
    memoryRef?: unknown;
    tokenBudget?: unknown;
    sources?: unknown;
    indexEmitted?: unknown;
    includeSecretCanary?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  // `body.memoryRef` + `body.includeSecretCanary` are accepted for request-
  // shape fidelity but unused: this seam distills `sources` directly, and SR-1
  // scrubbing below is UNCONDITIONAL (a redacted secret is always scrubbed,
  // not gated on `includeSecretCanary`). A production host resolves `memoryRef`
  // against its MemoryAdapter.
  const sources = Array.isArray(body.sources) ? body.sources : ['distill-default-1', 'distill-default-2'];

  // SR-1 carry-forward: scrub the corpus BEFORE archiving / hashing, so a
  // resolved secret never enters the archive, its checksum, or the event.
  const scrubbedCorpus = scrubSecretShaped(stableStringify(sources));

  // Budget resolution: clamp to the advertised ceiling. `tokensUsed` is a
  // deterministic estimate of the scrubbed corpus (~4 chars/token, floored).
  // A budget below the corpus minimum fails CLOSED with no partial archive.
  const budget = Math.min(
    typeof body.tokenBudget === 'number' && body.tokenBudget > 0 ? body.tokenBudget : DISTILLATION_MAX_TOKEN_BUDGET,
    DISTILLATION_MAX_TOKEN_BUDGET,
  );
  const tokensUsed = Math.max(16, Math.ceil(scrubbedCorpus.length / 4));
  if (budget < tokensUsed) {
    return void sendError(
      res,
      422,
      'token_budget_exceeded',
      `Distillation needs ~${tokensUsed} tokens but the resolved budget is ${budget}; no partial archive written (atomic).`,
    );
  }

  // Byte-stable archive checksum: a deterministic function of the scrubbed
  // sources (same sources ⇒ same digest, host-independent).
  const archiveChecksum = createHash('sha256').update(scrubbedCorpus).digest('hex');

  // §B index: when requested, write a content-free `MEMORY-INDEX.json` manifest
  // to the run-owner's workspace (RFC 0059) — metadata only, no raw source
  // content (so no secret can ride the index).
  const indexEmitted = body.indexEmitted === true;
  let indexFile: Record<string, unknown> | undefined;
  if (indexEmitted) {
    const manifest = {
      version: 1,
      archiveChecksum,
      entryCount: sources.length,
      updatedAt: new Date().toISOString(),
    };
    const r = workspacePutOp(
      DEFAULT_WORKSPACE_OWNER.tenant,
      DEFAULT_WORKSPACE_OWNER.workspace,
      'MEMORY-INDEX.json',
      JSON.stringify(manifest),
      'application/json',
      null,
    );
    if (r.ok) indexFile = manifest;
  }

  sendJSON(res, 200, {
    // The existing RFC 0012 `memory.compacted` event, extended with the
    // additive RFC 0062 `distillation` sub-object — no new event type.
    event: {
      type: 'memory.compacted',
      distillation: { tokenBudget: budget, tokensUsed, indexUpdated: indexEmitted },
    },
    archiveChecksum,
    indexUpdated: indexEmitted,
    ...(indexFile !== undefined ? { indexFile } : {}),
  });
}

// ─── RFC 0071 + RFC 0075 (P2-1) — store-only artifact-type seam ───────────────
//
// A store-only host: it persists artifacts of registered types but renders
// nothing (`host.artifactTypes.render: false`). This exists to exercise the
// store-without-render negotiation guarantee end-to-end — the path a
// render-everything host (e.g. MyndHyve) can only honestly soft-skip. Drives
// the documented POST /v1/host/sample/artifacttypes/{install,produce} seam.

interface InstalledArtifactType {
  schema: Record<string, unknown>;
  registrationSource: 'pack' | 'host';
}
const artifactTypeRegistry = new Map<string, InstalledArtifactType>();
// RFC 0075 R1 — bound third-party artifact-schema "compilation" (this host
// hand-rolls a subset validator, so the only DoS axis is raw size).
const ARTIFACT_SCHEMA_MAX_BYTES = 64 * 1024;

/**
 * Minimal validator over the artifact-schema subset the conformance pack uses
 * (`type: object`, `required[]`, `properties{ type }`, `additionalProperties`).
 * A production engine compiles with Ajv; the zero-dep reference host hand-rolls
 * the subset. Honors the `validation: "open"` (additionalProperties absent/true)
 * vs `"closed"` (additionalProperties:false) strictness from RFC 0075 P0-2.
 */
function validateArtifactPayload(schema: Record<string, unknown>, payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const obj = payload as Record<string, unknown>;
  const props = (schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}) as Record<string, { type?: string }>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const r of required) if (!(r in obj)) return false;
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(obj)) if (!(k in props)) return false;
  }
  for (const [k, v] of Object.entries(obj)) {
    const t = props[k]?.type;
    if (t === 'string' && typeof v !== 'string') return false;
    if (t === 'number' && typeof v !== 'number') return false;
    if (t === 'boolean' && typeof v !== 'boolean') return false;
    if (t === 'array' && !Array.isArray(v)) return false;
  }
  return true;
}

async function handleArtifactTypeInstall(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: { manifest?: Record<string, unknown>; schemas?: Record<string, unknown> };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  const manifest = body.manifest;
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    manifest.kind !== 'artifact-type' ||
    !Array.isArray(manifest.artifactTypes)
  ) {
    return void sendError(res, 400, 'pack_kind_invalid', 'manifest MUST be kind:"artifact-type" with a non-empty artifactTypes[].');
  }
  const schemas = (body.schemas ?? {}) as Record<string, unknown>;
  const installed: string[] = [];
  for (const at of manifest.artifactTypes as Array<Record<string, unknown>>) {
    const id = at?.artifactTypeId;
    if (typeof id !== 'string') continue;
    const schema = schemas[id];
    if (!schema || typeof schema !== 'object') {
      return void sendError(res, 400, 'pack_validation_failed', `no schema supplied for ${id}.`);
    }
    if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > ARTIFACT_SCHEMA_MAX_BYTES) {
      return void sendError(res, 400, 'pack_validation_failed', `schema for ${id} exceeds the size bound.`);
    }
    artifactTypeRegistry.set(id, { schema: schema as Record<string, unknown>, registrationSource: 'pack' });
    installed.push(id);
  }
  sendJSON(res, 200, { installed: true, artifactTypeIds: installed });
}

async function handleArtifactTypeProduce(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkAuth(req, res)) return;
  const bodyText = await readBody(req);
  let body: { artifactTypeId?: unknown; payload?: unknown };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return void sendError(res, 400, 'validation_error', 'Request body MUST be valid JSON.');
  }
  if (typeof body.artifactTypeId !== 'string') {
    return void sendError(res, 400, 'validation_error', 'artifactTypeId MUST be a string.');
  }
  const id = body.artifactTypeId;
  const artifactId = randomUUID();
  const entry = artifactTypeRegistry.get(id);

  // Unregistered tier (permanent first-class): accept + store unvalidated; registered:false.
  if (!entry) {
    return void sendJSON(res, 200, {
      artifactId,
      registered: false,
      validated: false,
      stored: true,
      rendered: false,
      runStatus: 'completed',
      artifactCreated: { artifactType: id, registered: false },
    });
  }

  const validated = validateArtifactPayload(entry.schema, body.payload);
  if (!validated) {
    // Registered + schema-invalid: MUST NOT emit artifact.created; the run fails.
    return void sendJSON(res, 200, {
      artifactId,
      registered: false,
      validated: false,
      stored: false,
      rendered: false,
      runStatus: 'failed',
    });
  }

  // Registered + valid: persist, complete the run, render NOTHING (render:false).
  // This is the store-without-render guarantee — no renderer, run still completes.
  sendJSON(res, 200, {
    artifactId,
    registered: true,
    validated: true,
    stored: true,
    rendered: false,
    runStatus: 'completed',
    artifactCreated: { artifactType: id, registered: true, registrationSource: entry.registrationSource },
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function handleOpenApi(_req: IncomingMessage, res: ServerResponse): void {
  // Minimal OpenAPI 3.1 stub. The reference impl serves the canonical
  // `api/openapi.yaml` bundle from this repo's root; to keep the in-memory
  // host single-file, we emit just enough structure to satisfy the
  // discovery scenario's "openapi >= 3.1" assertion. Hosts that target
  // full OpenAPI conformance should serve api/openapi.yaml's converted
  // JSON form here.
  sendJSON(res, 200, {
    openapi: '3.1',
    info: {
      title: 'openwop in-memory reference host',
      version: '1.1.7',
      description:
        'Stub OpenAPI document. The full canonical OpenAPI bundle lives at api/openapi.yaml in the openwop repo. This host serves only the shape conformance suites assert on.',
    },
    paths: {
      '/.well-known/openwop': { get: { summary: 'Capability discovery', responses: { '200': { description: 'OK' } } } },
      '/v1/runs': { post: { summary: 'Create run', responses: { '201': { description: 'Created' } } } },
      '/v1/runs/{runId}': { get: { summary: 'Get run snapshot', responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/cancel': { post: { summary: 'Cancel run', responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events': { get: { summary: 'SSE event stream', responses: { '200': { description: 'OK' } } } },
      '/v1/runs/{runId}/events/poll': { get: { summary: 'Polling event read', responses: { '200': { description: 'OK' } } } },
    },
  });
}

function handleDiscovery(_req: IncomingMessage, res: ServerResponse): void {
  // Per spec/v1/capabilities.md: protocolVersion / supportedEnvelopes /
  // schemaVersions / limits required. No auth required for /.well-known/openwop.

  // Advertise the conformance + smoke fixtures the host has loaded so
  // conformance scenarios can gate on `isFixtureAdvertised(...)`.
  const advertisedFixtures = Array.from(workflows.keys()).filter(
    (id) => id.startsWith('conformance-') || id.startsWith('openwop-smoke-'),
  );

  // Advertise WASM nodePackRuntime support when at least one WASM pack
  // is loaded. RFC 0008 §H requires `abiVersions[]` and §K requires
  // `maxMemoryBytes` (capability the host enforces — the in-memory
  // loader emits `cap.breached` with `kind: "wasm-memory"` when a
  // module trips its memory ceiling).
  const wasmSupported = wasmTypeRegistry.size > 0;
  const capabilities: Record<string, unknown> = {};
  if (workflowChainExpansionSupported()) {
    // RFC 0013 — host editor implements workflow-chain pack expansion
    // via the vendor-prefixed POST /v1/host/sample/workflow-chain:expand
    // endpoint. Per `capabilities.md §workflowChainPacks`: editor-only
    // surface; the runtime dispatch path is unchanged.
    capabilities.workflowChainPacks = { supported: true };
  }
  if (wasmSupported) {
    capabilities.nodePackRuntimes = {
      wasm: {
        supported: true,
        abiVersions: [1],
        maxMemoryBytes: 1024 * 65536, // 1024 pages — matches pack.json default
        // RFC 0008 §H + Track 7 — list the pack names that passed
        // ABI version + instantiation. Conformance asserts rejected
        // packs (declared ABI not in `abiVersions[]`) are absent.
        loadedPacks: Array.from(loadedWasmPackNames).sort(),
      },
    };
  }

  // RFC 0056 — advertise non-blocking run feedback. This host supports
  // run-level annotations carrying any of the four standard signal kinds.
  capabilities.feedback = {
    supported: true,
    targets: ['run'],
    signals: ['rating', 'correction', 'label', 'flag'],
  };

  // RFC 0059 — advertise the versioned tenant·workspace file store. The host
  // honors §C (CRUD + If-Match), §D (run-start read snapshot), and §E WCT-1
  // (cross-workspace isolation) / WSR-1 (SR-1 redaction on write) end-to-end.
  capabilities.workspace = {
    supported: true,
    versioned: true,
    maxFileBytes: WORKSPACE_MAX_FILE_BYTES,
    maxFiles: WORKSPACE_MAX_FILES,
    maxVersions: WORKSPACE_MAX_VERSIONS,
  };

  // RFC 0060 — predicate-gated heartbeat polling. The host evaluates an
  // idempotent predicate once per tick (via the documented tick seam),
  // emitting state-change events only on a transition (§B.5 anti-spam) and
  // terminating over-budget evaluations as `timeout` (§B.2).
  capabilities.heartbeat = {
    supported: true,
    minIntervalSec: HEARTBEAT_MIN_INTERVAL_SEC,
    maxRuntimeMs: HEARTBEAT_MAX_RUNTIME_MS,
  };

  // RFC 0063 — verify-before-merge on sub-workflow outputs. The host computes
  // a byte-stable JCS+SHA-256 checksum of a child's outputs and fails closed on
  // an unapproved merge (exercised via the sub-run attestation seam).
  capabilities.agents = {
    subRunAttestation: true,
  };

  // RFC 0064 — per-tool authorization (fail-closed, RFC 0049) + rate limiting +
  // content-free tool-call audit, layered on agent.toolCalled / agent.toolReturned
  // (exercised via the tool-hooks invoke seam).
  capabilities.toolHooks = {
    supported: true,
    prePostEvents: true,
    perToolAuthorization: true,
    perToolRateLimit: true,
  };

  // RFC 0076 §B — host outbound-HTTP surface. The HTTP-client egress is
  // SSRF-guarded (resolve->pin->connect; the http-client-ssrf-guard invariant)
  // with a response-body cap. `safeFetch` exposes that guarded client to pack
  // runtime code (ctx.http.safeFetch), exercised via the
  // POST /v1/host/sample/http/safe-fetch seam.
  capabilities.httpClient = {
    supported: true,
    ssrfGuard: true,
    maxResponseBodyBytes: SAFEFETCH_MAX_RESPONSE_BODY_BYTES,
    requestTimeoutMs: SAFEFETCH_REQUEST_TIMEOUT_MS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    safeFetch: { supported: true },
  };

  // RFC 0062 — scheduled, token-budgeted memory distillation ("dreams"). A
  // budgeted compaction that writes a byte-stable archive + a retrievable
  // `MEMORY-INDEX.json` workspace file (RFC 0059), exercised via the
  // memory-distillation seam. Nested under `memory` (no base MemoryAdapter
  // claimed — only the distillation sub-block).
  capabilities.memory = {
    distillation: {
      supported: true,
      maxTokenBudget: DISTILLATION_MAX_TOKEN_BUDGET,
      scheduled: false,
      indexEmitted: true,
      tokenizerName: 'claude',
      archiveRetention: 'P30D',
    },
  };

  // RFC 0071 + RFC 0075 (P2-1) — store-only artifact-type host. Advertises
  // `store: true, render: false` so the cross-host store-without-render
  // negotiation guarantee (artifact-type-packs.md §host.artifactTypes) is
  // exercised end-to-end: this reference host PERSISTS artifacts of registered
  // types + emits artifact.created, but renders nothing — a produce of a
  // registered, schema-valid artifact completes the run WITHOUT a renderer.
  // Exercised via the documented POST /v1/host/sample/artifacttypes/{install,produce}
  // seam. MyndHyve (render:true) can only honestly soft-skip this path.
  capabilities['host.artifactTypes'] = {
    supported: true,
    store: true,
    render: false,
    export: [],
  };

  const payload = {
    protocolVersion: '1.0',
    implementation: {
      name: 'openwop-host-in-memory',
      version: '1.1.7',
      vendor: 'openwop-spec (reference example)',
    },
    supportedEnvelopes: [],
    schemaVersions: {},
    limits: {
      clarificationRounds: 0,
      schemaRounds: 0,
      envelopesPerTurn: 0,
      maxNodeExecutions: 1000,
      // RFC 0058 — the host enforces this wall-clock ceiling on every run
      // (see runWorkflow). Advertising it lets clients pre-flight a
      // `runTimeoutMs` and pins the upper bound the value clamps to.
      maxRunDurationMs: MAX_RUN_DURATION_MS,
    },
    supportedTransports: ['rest'],
    debugBundle: {
      supported: true,
    },
    fixtures: advertisedFixtures,
    capabilities,
  };
  sendJSON(res, 200, payload, { 'Cache-Control': 'public, max-age=300' });
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

  // RFC 0058 — resolve the per-run wall-clock bound. Per `run-options.md`
  // §"Reserved keys", out-of-range `runTimeoutMs` is rejected at run-create
  // (400, never at runtime); an in-range value is clamped to the advertised
  // host ceiling via `min(runTimeoutMs, maxRunDurationMs)`. The spec types the
  // key as `number`, so a fractional value is accepted and floored to integer
  // ms — `cap.breached.limit` is an integer per `run-event-payloads.schema.json`.
  let resolvedRunTimeoutMs: number | null = null;
  const rawRunTimeoutMs = parsed.configurable?.runTimeoutMs;
  if (rawRunTimeoutMs !== undefined) {
    if (
      typeof rawRunTimeoutMs !== 'number' ||
      !Number.isFinite(rawRunTimeoutMs) ||
      rawRunTimeoutMs < 1
    ) {
      sendError(
        res,
        400,
        'validation_error',
        'configurable.runTimeoutMs MUST be a positive number (milliseconds).',
      );
      return;
    }
    resolvedRunTimeoutMs = Math.min(Math.floor(rawRunTimeoutMs), MAX_RUN_DURATION_MS);
  }

  const workflow = workflows.get(parsed.workflowId);
  if (!workflow) {
    // Per SECURITY/invariants.yaml `secret-leakage-error-envelope`:
    // don't echo user-supplied input verbatim in error messages.
    // Workflow IDs aren't credentials, but reflexively echoing inputs
    // is a class of leak the redaction discipline should prevent.
    sendError(res, 404, 'workflow_not_found', 'Unknown workflowId.');
    return;
  }

  // Layer-1 idempotency. Per spec/v1/idempotency.md §"Concurrent duplicates"
  // and §"Caller responsibilities": same key + same body → cached replay;
  // same key + different body → 409 (caller misuse: a key is supposed to
  // pin one logical operation).
  const idempotencyKey = req.headers['idempotency-key'];
  const incomingBodyHash = hashBody(bodyText);
  if (typeof idempotencyKey === 'string') {
    pruneIdempotencyCache();
    const cacheKey = buildIdempotencyCacheKey('POST /v1/runs', idempotencyKey);
    const cached = idempotencyCache.get(cacheKey);
    if (cached) {
      if (cached.bodyHash !== incomingBodyHash) {
        sendError(
          res,
          409,
          'idempotency_key_conflict',
          'Idempotency-Key reused with a different request body. A key MUST pin exactly one logical operation.',
        );
        return;
      }
      res.writeHead(cached.status, {
        'Content-Type': cached.contentType,
        'Content-Length': Buffer.byteLength(cached.body),
        'openwop-Idempotent-Replay': 'true',
      });
      res.end(cached.body);
      return;
    }
  }

  const runId = `run-${randomUUID()}`;
  // Seed inputs from the workflow's declared variable defaults, then let
  // caller-supplied inputs override them. The host previously ignored
  // `variables[].defaultValue`, so an un-supplied variable silently fell back
  // to a node-local literal — masking a fixture's intended parameters.
  const inputs: Record<string, unknown> = {};
  for (const variable of workflow.variables ?? []) {
    if (variable.defaultValue !== undefined) inputs[variable.name] = variable.defaultValue;
  }
  Object.assign(inputs, parsed.inputs ?? {});
  const run: Run = {
    runId,
    workflowId: parsed.workflowId,
    status: 'pending',
    inputs,
    events: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    cancelRequested: false,
    abortController: new AbortController(),
    runTimeoutMs: resolvedRunTimeoutMs,
    timedOut: false,
    // RFC 0059 §D — capture the owner's workspace as of run start (immutable
    // for the run). This single-tenant host owns one workspace.
    workspaceSnapshot: workspaceSnapshotFor(
      DEFAULT_WORKSPACE_OWNER.tenant,
      DEFAULT_WORKSPACE_OWNER.workspace,
    ),
  };
  runs.set(runId, run);

  const responseBody = {
    runId,
    status: run.status,
    workflowId: run.workflowId,
    startedAt: run.startedAt,
    // Required by api/openapi.yaml POST /v1/runs response schema.
    eventsUrl: `/v1/runs/${runId}/events`,
    statusUrl: `/v1/runs/${runId}`,
  };
  const responseText = JSON.stringify(responseBody);

  // Cache before kicking off async execution so a retry within the run's
  // lifetime gets the cached response.
  if (typeof idempotencyKey === 'string') {
    const cacheKey = buildIdempotencyCacheKey('POST /v1/runs', idempotencyKey);
    idempotencyCache.set(cacheKey, {
      status: 201,
      body: responseText,
      contentType: 'application/json',
      bodyHash: incomingBodyHash,
      storedAt: Date.now(),
    });
  }

  // Fire-and-forget execution. Any throw in runWorkflow becomes a
  // run.failed event; we don't bubble exceptions to the HTTP layer.
  void runWorkflow(run).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    run.status = 'failed';
    run.error = { code: 'internal', message };
    appendEvent(run, 'run.failed', { data: run.error });
    run.endedAt = new Date().toISOString();
  });

  res.writeHead(201, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseText),
    'openwop-Idempotent-Replay': typeof idempotencyKey === 'string' ? 'false' : '',
  });
  res.end(responseText);
}

function handleGetRun(req: IncomingMessage, res: ServerResponse, runId: string): void {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  const snapshot = {
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    inputs: run.inputs,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    ...(run.error ? { error: run.error } : {}),
    // RFC 0059 §D — the workspace read snapshot the run observed at start.
    workspace: run.workspaceSnapshot,
  };
  sendJSON(res, 200, snapshot);
}

// RFC 0056 §E + SECURITY/invariants.yaml `annotation-content-redaction`.
// `signal.correction` and `note` are untrusted user content; secret-shaped
// material MUST be redacted (SR-1) before it is persisted, listed, or
// exported. We scrub at write time so the side-store never holds plaintext.
const SECRET_SHAPED = [
  /\bsk-[A-Za-z0-9_-]{6,}/g, // OpenAI-style and similar `sk-` prefixed keys
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g, // AWS access key IDs
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];
function scrubSecretShaped(value: string): string {
  let out = value;
  for (const re of SECRET_SHAPED) out = out.replace(re, '[redacted]');
  return out;
}

async function handleCreateAnnotation(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  const bodyText = await readBody(req);
  let body: {
    signal?: Record<string, unknown>;
    target?: { eventId?: unknown; nodeId?: unknown };
    note?: unknown;
  };
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
    // annotation.schema.json §signal.rating: integer, minimum 1, maximum 5.
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
  // annotation.schema.json declares `signal` with additionalProperties:false.
  // Reject unknown keys rather than silently persisting (and potentially
  // leaking secret-shaped content through) an un-scrubbed extra field.
  const ALLOWED_SIGNAL_KEYS = new Set(['kind', 'rating', 'label', 'correction']);
  for (const key of Object.keys(signal)) {
    if (!ALLOWED_SIGNAL_KEYS.has(key)) {
      sendError(res, 400, 'validation_error', `signal.${key}: unknown field (signal allows kind|rating|label|correction).`);
      return;
    }
  }

  // Scrub EVERY untrusted free-text value BEFORE persistence (SR-1, RFC 0056
  // §E) — walk all string-valued signal fields rather than an allow-list, so
  // no free-text field can carry secret-shaped content into the store.
  const storedSignal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(signal)) {
    storedSignal[key] = typeof value === 'string' ? scrubSecretShaped(value) : value;
  }

  const annotation: StoredAnnotation = {
    annotationId: `ann-${randomUUID()}`,
    target: {
      runId,
      ...(typeof body.target?.eventId === 'string' ? { eventId: body.target.eventId } : {}),
      ...(typeof body.target?.nodeId === 'string' ? { nodeId: body.target.nodeId } : {}),
    },
    signal: storedSignal,
    // Single-API-key host: the principal is the bearer-token identity. Opaque
    // ref per the schema; never the credential itself.
    actor: { principalRef: 'apikey:in-memory' },
    ...(typeof body.note === 'string' ? { note: scrubSecretShaped(body.note) } : {}),
    createdAt: new Date().toISOString(),
  };

  const list = annotations.get(runId) ?? [];
  list.push(annotation);
  annotations.set(runId, list);

  sendJSON(res, 201, annotation);
}

function handleListAnnotations(req: IncomingMessage, res: ServerResponse, runId: string): void {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Run-scoped store → the list is inherently isolated to this run (CTI-1).
  sendJSON(res, 200, { annotations: annotations.get(runId) ?? [] });
}

async function handleCancelRun(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): Promise<void> {
  if (!checkAuth(req, res)) return;

  // Drain body even if we don't use it, so request is closed cleanly.
  await readBody(req);

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    sendJSON(res, 200, { runId, status: run.status, alreadyTerminal: true });
    return;
  }

  run.cancelRequested = true;
  run.abortController.abort();
  // Cancellation propagates via the run loop's cancelRequested check.
  // Per rest-endpoints.md POST /v1/runs/{runId}/cancel: response status MUST
  // be one of `cancelled` or `cancelling`.
  sendJSON(res, 200, { runId, status: 'cancelling' });
}

function handleEventsPoll(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  url: URL,
): void {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  const sinceParam = url.searchParams.get('since');
  const since = sinceParam !== null ? Number(sinceParam) : -1;
  const filtered = run.events.filter((e) => e.seq > since);
  const lastSeq = filtered.length > 0 ? filtered[filtered.length - 1]!.seq : since;

  // Serialize each record in the canonical `run-event.schema.json` envelope
  // (`eventId` / `sequence` / `payload`). The host's internal `RunEvent` uses
  // `seq` / `data`; this maps to the canonical keys so the poll path matches
  // the schema exactly (`additionalProperties: false`) — no legacy `seq` /
  // `data` aliases, which the schema forbids. Conformance readers tolerate
  // both via `sequence ?? seq` / `payload ?? data`.
  const events = filtered.map((e) => ({
    eventId: `${e.runId}-${e.seq}`,
    runId: e.runId,
    type: e.type,
    sequence: e.seq,
    payload: e.data ?? null,
    timestamp: e.timestamp,
    ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}),
  }));

  sendJSON(res, 200, {
    runId,
    events,
    lastEventSeq: lastSeq,
    runStatus: run.status,
    isTerminal: run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled',
  });
}

function handleDebugBundle(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
): void {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Per spec/v1/debug-bundle.md — bundle aggregates run snapshot,
  // events, spans (empty for this host since we don't emit OTel),
  // metrics, redaction state.
  const bundle = {
    bundleVersion: '1',
    generatedAt: new Date().toISOString(),
    host: {
      name: 'openwop-host-in-memory',
      version: '1.1.7',
      vendor: 'openwop-spec (reference example)',
    },
    run: {
      runId: run.runId,
      workflowId: run.workflowId,
      status: run.status,
      // Per SECURITY/invariants.yaml secret-leakage-debug-bundle:
      // bundle inherits redaction. This reference host omits user-
      // supplied inputs from the bundle entirely — they're still
      // available via GET /v1/runs/{runId} for clients that need
      // them. A production host with a real redaction harness can
      // include masked inputs here.
      inputs: {},
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      ...(run.error ? { error: run.error } : {}),
      variables: {},
    },
    events: run.events.map((e) => ({
      sequence: e.seq,
      type: e.type,
      timestamp: e.timestamp,
      nodeId: e.nodeId ?? null,
      data: e.data ?? null,
    })),
    spans: [] as unknown[],
    metrics: {
      nodeCount: new Set(run.events.filter((e) => e.nodeId !== undefined).map((e) => e.nodeId)).size,
      eventCount: run.events.length,
    },
    redactionApplied: true,
    redactionMode: 'omit' as const,
  };
  sendJSON(res, 200, bundle, { 'Cache-Control': 'no-store' });
}

function handleEventsSse(req: IncomingMessage, res: ServerResponse, runId: string): void {
  if (!checkAuth(req, res)) return;

  const run = runs.get(runId);
  if (!run) {
    sendError(res, 404, 'run_not_found', `Unknown runId: ${runId}`);
    return;
  }

  // Per spec/v1/stream-modes.md §"Reconnection": Last-Event-ID
  // signals a resumption — replay only events with seq > lastEventId.
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

  // Replay backlog filtered by resume point.
  for (const event of run.events) {
    if (event.seq > resumeAfterSeq) writeEvent(event);
  }

  // If already terminal, close.
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    res.end();
    return;
  }

  const onEvent = (event: RunEvent): void => {
    writeEvent(event);
    if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
      eventBus.off(`events:${runId}`, onEvent);
      res.end();
    }
  };
  eventBus.on(`events:${runId}`, onEvent);

  req.on('close', () => {
    eventBus.off(`events:${runId}`, onEvent);
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const RUN_ID_PATTERN = /^\/v1\/runs\/([^/]+)$/;
const RUN_CANCEL_PATTERN = /^\/v1\/runs\/([^/]+)\/cancel$/;
const RUN_EVENTS_POLL_PATTERN = /^\/v1\/runs\/([^/]+)\/events\/poll$/;
const RUN_EVENTS_SSE_PATTERN = /^\/v1\/runs\/([^/]+)\/events$/;
const RUN_DEBUG_BUNDLE_PATTERN = /^\/v1\/runs\/([^/]+)\/debug-bundle$/;
const RUN_ANNOTATIONS_PATTERN = /^\/v1\/runs\/([^/]+)\/annotations$/; // RFC 0056
const WORKSPACE_FILES_PATTERN = /^\/v1\/host\/workspace\/files$/; // RFC 0059 list
const WORKSPACE_FILE_PATTERN = /^\/v1\/host\/workspace\/files\/(.+)$/; // RFC 0059 one file

/**
 * RFC 0013 Phase 3 — workflow-chain pack expansion endpoint.
 *
 * Vendor-prefixed under `/v1/host/sample/*` per
 * `spec/v1/host-extensions.md` §"Canonical prefixes" — chain expansion
 * is workflow-edit-time host behavior, not part of the v1 wire
 * contract. Conformance scenarios gate on
 * `capabilities.workflowChainPacks.supported` advertised via
 * `/.well-known/openwop`.
 *
 * Request body shape:
 *   {
 *     packName: string,
 *     version?: string,        // pinned version check; optional
 *     chainId: string,
 *     parameters: object,      // ALREADY validated against chain.parameters
 *     parentWorkflowId?: string // echoed in the response for the caller
 *   }
 *
 * Response (200):
 *   {
 *     expansionId: string,
 *     chainId, packName, packVersion,
 *     nodes: WorkflowFragmentNode[],
 *     edges: WorkflowFragmentEdge[]
 *   }
 *
 * Error mapping (status → code):
 *   404 → pack_not_found / chain_not_found
 *   422 → pack_kind_invalid / pack_manifest_invalid /
 *         pack_signature_invalid / chain_unresolvable_typeid /
 *         invalid_request
 *   500 → pack_signature_unverifiable / internal
 *   503 → host doesn't advertise the capability
 */
async function handleExpandWorkflowChain(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req, res)) return;
  if (!workflowChainExpansionSupported()) {
    sendError(
      res,
      503,
      'capability_not_advertised',
      'workflowChainPacks capability is not advertised by this host (OPENWOP_PACK_REGISTRY_DIR unset or unreadable).',
    );
    return;
  }
  const bodyText = await readBody(req);
  let body: {
    packName?: unknown;
    version?: unknown;
    chainId?: unknown;
    parameters?: unknown;
    parentWorkflowId?: unknown;
  };
  try {
    body = JSON.parse(bodyText);
  } catch {
    sendError(res, 422, 'invalid_request', 'request body is not valid JSON');
    return;
  }
  if (typeof body.packName !== 'string' || body.packName.length === 0) {
    sendError(res, 422, 'invalid_request', 'packName: string is required');
    return;
  }
  if (typeof body.chainId !== 'string' || body.chainId.length === 0) {
    sendError(res, 422, 'invalid_request', 'chainId: string is required');
    return;
  }
  if (typeof body.parameters !== 'object' || body.parameters === null || Array.isArray(body.parameters)) {
    sendError(res, 422, 'invalid_request', 'parameters: object is required (may be empty)');
    return;
  }
  if (body.version !== undefined && typeof body.version !== 'string') {
    sendError(res, 422, 'invalid_request', 'version: must be a string when present');
    return;
  }

  try {
    const result = await expandChainFromRegistry({
      registryDir: PACK_REGISTRY_DIR,
      packName: body.packName,
      chainId: body.chainId,
      parameters: body.parameters as Record<string, unknown>,
      ...(typeof body.version === 'string' ? { version: body.version } : {}),
    });
    sendJSON(res, 200, {
      expansionId: result.expansionId,
      chainId: result.chainId,
      packName: result.packName,
      packVersion: result.packVersion,
      nodes: result.nodes,
      edges: result.edges,
      ...(typeof body.parentWorkflowId === 'string' ? { parentWorkflowId: body.parentWorkflowId } : {}),
    });
  } catch (err) {
    if (err instanceof WorkflowChainExpansionError) {
      const status =
        err.code === 'pack_not_found' || err.code === 'chain_not_found' ? 404 :
        err.code === 'pack_signature_unverifiable' ? 500 :
        422;
      sendError(res, status, err.code, err.message, err.details ? { details: err.details } : {});
      return;
    }
    throw err;
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/.well-known/openwop') {
    return handleDiscovery(req, res);
  }
  if (method === 'GET' && path === '/v1/openapi.json') {
    return handleOpenApi(req, res);
  }
  if (method === 'POST' && path === '/v1/runs') {
    return handleCreateRun(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/workflow-chain:expand') {
    return handleExpandWorkflowChain(req, res);
  }
  // RFC 0059 — host.workspace §C endpoints + the cross-workspace-isolation seam.
  if (method === 'POST' && path === '/v1/host/sample/workspace/op') {
    return handleWorkspaceSeam(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/heartbeat/tick') {
    return handleHeartbeatTick(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/subrun/attest') {
    return handleSubRunAttest(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/toolhooks/invoke') {
    return handleToolHooksInvoke(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/http/safe-fetch') {
    return handleSafeFetch(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/memory/distill') {
    return handleMemoryDistill(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/artifacttypes/install') {
    return handleArtifactTypeInstall(req, res);
  }
  if (method === 'POST' && path === '/v1/host/sample/artifacttypes/produce') {
    return handleArtifactTypeProduce(req, res);
  }
  if (WORKSPACE_FILES_PATTERN.test(path) && method === 'GET') {
    return handleWorkspaceList(req, res, url);
  }
  {
    const wm = WORKSPACE_FILE_PATTERN.exec(path);
    if (wm) {
      if (method === 'GET') return handleWorkspaceGet(req, res, wm[1]!, url);
      if (method === 'PUT') return handleWorkspacePut(req, res, wm[1]!);
      if (method === 'DELETE') return handleWorkspaceDelete(req, res, wm[1]!);
    }
  }

  let m = RUN_EVENTS_POLL_PATTERN.exec(path);
  if (m && method === 'GET') return handleEventsPoll(req, res, m[1]!, url);

  m = RUN_EVENTS_SSE_PATTERN.exec(path);
  if (m && method === 'GET') {
    // Content-negotiate: clients explicitly asking for JSON (Accept:
    // application/json without text/event-stream) get the JSON poll
    // response; everyone else gets the SSE stream. Conformance scenarios
    // and JSON-only clients can read the events without parsing SSE.
    const accept = (req.headers.accept ?? '').toLowerCase();
    const wantsJson = accept.includes('application/json') && !accept.includes('text/event-stream');
    if (wantsJson) return handleEventsPoll(req, res, m[1]!, url);
    return handleEventsSse(req, res, m[1]!);
  }

  m = RUN_DEBUG_BUNDLE_PATTERN.exec(path);
  if (m && method === 'GET') return handleDebugBundle(req, res, m[1]!);

  m = RUN_CANCEL_PATTERN.exec(path);
  if (m && method === 'POST') return handleCancelRun(req, res, m[1]!);

  m = RUN_ANNOTATIONS_PATTERN.exec(path); // RFC 0056 — run feedback
  if (m && method === 'POST') return handleCreateAnnotation(req, res, m[1]!);
  if (m && method === 'GET') return handleListAnnotations(req, res, m[1]!);

  m = RUN_ID_PATTERN.exec(path);
  if (m && method === 'GET') return handleGetRun(req, res, m[1]!);

  sendError(res, 404, 'not_found', `No route for ${method} ${path}`);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

loadFixtures();
await loadWasmPacks();

const server = createServer((req, res) => {
  void route(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      sendError(res, 500, 'internal', message);
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[openwop-host-in-memory] listening on http://${HOST}:${PORT} (api key: ${API_KEY}, ${workflows.size} fixtures loaded, ${wasmTypeRegistry.size} WASM node types)`,
  );
});
