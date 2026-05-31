/**
 * WASM-isolation sandbox executor — the RFC 0035 §B reference implementation.
 *
 * Executes a pack-loaded typeId compiled to WebAssembly under real isolation.
 * The seven cross-runtime failure-mode invariants are enforced by construction:
 *
 *   fs / env / network / process (escape)   a WASM module has NO ambient host
 *     access — every host interaction is a DECLARED IMPORT. The host statically
 *     inspects `WebAssembly.Module.imports()` and refuses any import it did not
 *     grant, failing closed BEFORE instantiation (no execution of hostile code).
 *   capability-gate                          an `openwop.<name>` import whose
 *     `<name>` is not in `allowedHostCalls` → `sandbox_capability_denied` with
 *     the requested capability.
 *   memory-cap                               the host provides the module's
 *     linear memory with a fixed `maximum`; an access beyond the bound traps
 *     ("out of bounds memory access") → `sandbox_memory_exceeded`.
 *   timeout                                  the invocation runs on a dedicated
 *     worker thread; a main-thread kill-timer terminates it at the wall-clock
 *     cap → `sandbox_timeout`.
 *   isolated-context                         a fresh `WebAssembly.Instance` (in a
 *     fresh worker) per invocation — no module state survives across calls.
 *
 * `node-pack-sandbox-no-eval` is JS-runtime-specific (WASM has no `eval`) and is
 * not a WASM concern, per RFC 0035 — it stays a reference-impl/exempt invariant.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see spec/v1/host-capabilities.md §"Sandbox execution contract (RFC 0035)"
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export type SandboxErrorCode =
  | 'sandbox_memory_exceeded'
  | 'sandbox_timeout'
  | 'sandbox_capability_denied'
  | 'sandbox_escape_attempt'
  | 'sandbox_invocation_error';

export type EscapeKind = 'host-fs-escape' | 'host-env-leak' | 'network-escape' | 'host-process-escape';

export interface SandboxConfig {
  /** Capability names the host grants under the `openwop.*` import namespace (e.g. `['fetch']`). Empty = pure compute. */
  readonly allowedHostCalls: readonly string[];
  /** Per-invocation linear-memory bound (≥ 1 MiB per RFC 0035 §A). */
  readonly memoryLimitBytes: number;
  /** Per-invocation wall-clock bound in ms (≥ 100 per RFC 0035 §A). */
  readonly wallClockLimitMs: number;
}

export interface SandboxError {
  readonly code: SandboxErrorCode;
  readonly details?: {
    readonly requestedCapability?: string;
    readonly escapeKind?: EscapeKind;
    readonly message?: string;
  };
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly result?: number;
  readonly error?: SandboxError;
}

const WASM_PAGE_BYTES = 65536;
const workerPath = fileURLToPath(new URL('./sandbox-worker.mjs', import.meta.url));

/** Map a forbidden WASI import name to its RFC 0035 §C `escapeKind`. */
function escapeKindFor(name: string): EscapeKind {
  if (/^fd_|^path_/.test(name)) return 'host-fs-escape';
  if (/^environ_/.test(name)) return 'host-env-leak';
  if (/^sock_/.test(name)) return 'network-escape';
  if (/^proc_|^sched_|fork|exec/.test(name)) return 'host-process-escape';
  // Any other un-granted WASI syscall is, conservatively, a process-level escape.
  return 'host-process-escape';
}

/**
 * Static capability gate: inspect every declared import and reject the first one
 * the host did not grant. Returns the failure, or `null` if every import is
 * host-provided (host memory + granted `openwop.*` calls). This runs BEFORE any
 * code executes — hostile modules never instantiate.
 */
function gateImports(module: WebAssembly.Module, allowedHostCalls: readonly string[]): SandboxError | null {
  const allowed = new Set(allowedHostCalls);
  for (const imp of WebAssembly.Module.imports(module)) {
    // The host-provided, capped linear memory.
    if (imp.module === 'env' && imp.name === 'memory') continue;
    // Granted host capabilities live under the `openwop` namespace.
    if (imp.module === 'openwop') {
      if (allowed.has(imp.name)) continue;
      return { code: 'sandbox_capability_denied', details: { requestedCapability: imp.name } };
    }
    // A WASI (or any other) import the host did not grant is an escape attempt.
    return { code: 'sandbox_escape_attempt', details: { escapeKind: escapeKindFor(imp.name) } };
  }
  return null;
}

/** Run one already-gated invocation on a worker thread with a wall-clock kill-timer. */
function runInWorker(
  wasmBytes: Uint8Array,
  config: SandboxConfig,
  entry: string,
  arg: number,
): Promise<SandboxResult> {
  const memoryMaxPages = Math.max(1, Math.ceil(config.memoryLimitBytes / WASM_PAGE_BYTES));
  return new Promise((resolve) => {
    const worker = new Worker(workerPath, {
      workerData: { wasmBytes, entry, arg, allowedHostCalls: [...config.allowedHostCalls], memoryMaxPages },
      // A hard JS-heap ceiling on the sandbox as defense-in-depth beyond the
      // WASM linear-memory bound; a runaway allocation surfaces as a worker error.
      resourceLimits: { maxOldGenerationSizeMb: Math.max(16, Math.ceil(config.memoryLimitBytes / (1024 * 1024)) + 16) },
    });
    let settled = false;
    const finish = (r: SandboxResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: { code: 'sandbox_timeout' } }),
      config.wallClockLimitMs,
    );
    worker.on('message', (m: { ok: boolean; result?: number; code?: SandboxErrorCode; message?: string }) => {
      if (m.ok) {
        finish(m.result === undefined ? { ok: true } : { ok: true, result: m.result });
      } else {
        const code = m.code ?? 'sandbox_invocation_error';
        finish({ ok: false, error: m.message ? { code, details: { message: m.message } } : { code } });
      }
    });
    // A worker 'error' (e.g. JS-heap OOM from a runaway allocation) → memory-exceeded.
    worker.on('error', (e) => finish({ ok: false, error: { code: 'sandbox_memory_exceeded', details: { message: e.message } } }));
    worker.on('exit', (code) => {
      if (code !== 0) finish({ ok: false, error: { code: 'sandbox_invocation_error', details: { message: `worker exited ${code}` } } });
    });
  });
}

/**
 * Invoke a WASM-compiled pack typeId under the RFC 0035 sandbox contract.
 *
 * @param wasmBytes the module bytes
 * @param config the per-invocation isolation bounds
 * @param entry the exported function to call (default `"invoke"`)
 * @param arg a single i32 argument (default 0)
 */
export async function invokeSandboxed(
  wasmBytes: Uint8Array,
  config: SandboxConfig,
  entry = 'invoke',
  arg = 0,
): Promise<SandboxResult> {
  let module: WebAssembly.Module;
  try {
    // `wasmBytes` is a Uint8Array (a BufferSource); the assertion narrows the
    // TS 5.7 `ArrayBufferLike` generic to the `ArrayBuffer`-backed BufferSource.
    module = new WebAssembly.Module(wasmBytes as BufferSource);
  } catch (e) {
    return { ok: false, error: { code: 'sandbox_invocation_error', details: { message: e instanceof Error ? e.message : String(e) } } };
  }
  const gate = gateImports(module, config.allowedHostCalls);
  if (gate) return { ok: false, error: gate };
  return runInWorker(wasmBytes, config, entry, arg);
}
