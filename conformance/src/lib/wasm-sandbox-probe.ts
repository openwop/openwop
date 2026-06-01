/**
 * Portable WASM-sandbox probe — the suite-local reference for the RFC 0035 §B
 * isolation invariants.
 *
 * The conformance suite is a standalone package, so it carries its own compact,
 * server-free probe (no host, no worker) rather than importing a reference
 * host's executor. It proves the invariants that hold *by construction* in any
 * WebAssembly sandbox:
 *
 *   - escape attempts (fs / env / network / process) and the capability gate are
 *     proven by STATIC inspection of `WebAssembly.Module.imports()` — a WASM
 *     module has no ambient host access, so a forbidden operation can only be a
 *     declared import; a sandbox refuses any import it did not grant, failing
 *     closed BEFORE instantiation.
 *   - the memory bound is proven by instantiating with a capped host memory and
 *     observing the engine trap on an access past the bound.
 *   - isolated-context is proven by instantiating the same module twice and
 *     observing no shared mutable state.
 *
 * The `timeout` invariant requires thread preemption (a worker kill-timer) and is
 * proven at reference-impl tier by the WASM host's `test/sandbox.test.ts`; it is
 * intentionally NOT exercised here (an in-process infinite loop cannot be
 * interrupted server-free).
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see examples/hosts/wasm-sandbox/ (the reference host this mirrors)
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

export interface ProbeResult {
  readonly ok: boolean;
  readonly result?: number;
  readonly code?: SandboxErrorCode;
  readonly escapeKind?: EscapeKind;
  readonly requestedCapability?: string;
}

const WASM_PAGE_BYTES = 65536;

// Minimal local types for the Node-global `WebAssembly` value. The full
// `WebAssembly.*` namespace types live in lib.dom (not @types/node); rather than
// widen the suite's global lib (which would pull in conflicting DOM `fetch`/
// `BodyInit` types), we declare exactly what this probe uses and read the global.
interface WAModule {
  readonly __wasmModule?: never;
}
interface WAInstance {
  readonly exports: Record<string, unknown>;
}
interface WAImportDescriptor {
  readonly module: string;
  readonly name: string;
}
const WA = (globalThis as unknown as {
  WebAssembly: {
    Module: { new (bytes: Uint8Array): WAModule; imports(m: WAModule): readonly WAImportDescriptor[] };
    Instance: { new (m: WAModule, imports: Record<string, Record<string, unknown>>): WAInstance };
    Memory: { new (descriptor: { initial: number; maximum: number }): unknown };
  };
}).WebAssembly;

function escapeKindFor(name: string): EscapeKind {
  if (/^fd_|^path_/.test(name)) return 'host-fs-escape';
  if (/^environ_/.test(name)) return 'host-env-leak';
  if (/^sock_/.test(name)) return 'network-escape';
  return 'host-process-escape';
}

/** Static capability gate — the first un-granted import, or `null` if all are host-provided. */
function gateImports(module: WAModule, allowedHostCalls: readonly string[]): ProbeResult | null {
  const allowed = new Set(allowedHostCalls);
  for (const imp of WA.Module.imports(module)) {
    if (imp.module === 'env' && imp.name === 'memory') continue;
    if (imp.module === 'openwop') {
      if (allowed.has(imp.name)) continue;
      return { ok: false, code: 'sandbox_capability_denied', requestedCapability: imp.name };
    }
    return { ok: false, code: 'sandbox_escape_attempt', escapeKind: escapeKindFor(imp.name) };
  }
  return null;
}

/**
 * Probe one WASM-compiled typeId under the RFC 0035 sandbox contract, server-free.
 * Statically gates imports; for a fully-granted module, instantiates with a
 * capped host memory and runs the entry, classifying any trap. Does NOT spawn a
 * worker — callers MUST NOT pass a non-terminating module (see `timeout` note).
 */
export function probeSandboxed(
  wasmBytes: Uint8Array,
  config: { readonly allowedHostCalls: readonly string[]; readonly memoryLimitBytes: number },
  entry = 'invoke',
  arg = 0,
): ProbeResult {
  let module: WAModule;
  try {
    module = new WA.Module(wasmBytes);
  } catch {
    return { ok: false, code: 'sandbox_invocation_error' };
  }
  const gate = gateImports(module, config.allowedHostCalls);
  if (gate) return gate;

  const memoryMaxPages = Math.max(1, Math.ceil(config.memoryLimitBytes / WASM_PAGE_BYTES));
  try {
    const memory = new WA.Memory({ initial: 1, maximum: memoryMaxPages });
    const openwop: Record<string, (x: number) => number> = {};
    for (const name of config.allowedHostCalls) openwop[name] = (x: number): number => x;
    const instance = new WA.Instance(module, { env: { memory }, openwop });
    const fn = instance.exports[entry];
    if (typeof fn !== 'function') return { ok: false, code: 'sandbox_invocation_error' };
    return { ok: true, result: Number((fn as (a: number) => number)(arg)) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/out of bounds memory access|memory access out of bounds/i.test(message)) {
      return { ok: false, code: 'sandbox_memory_exceeded' };
    }
    return { ok: false, code: 'sandbox_invocation_error' };
  }
}

const timeoutWorkerPath = fileURLToPath(new URL('./sandbox-timeout-worker.mjs', import.meta.url));

/**
 * Worker-based timeout probe — RFC 0035 §B invariant 6 (`node-pack-sandbox-timeout`).
 * A wall-clock cap can only be enforced by THREAD PREEMPTION: a same-thread timer
 * cannot interrupt a synchronous WASM loop. So this spawns a worker thread running
 * the module and races a main-thread kill-timer. A non-terminating module →
 * `sandbox_timeout` (the worker is terminated at `wallClockLimitMs`); a module that
 * completes within the budget posts its result first. This is the worker-driven
 * counterpart to the server-free `probeSandboxed` (which deliberately cannot run a
 * non-terminating module).
 */
export function probeTimeout(
  wasmBytes: Uint8Array,
  config: { readonly memoryLimitBytes: number; readonly wallClockLimitMs: number },
  entry = 'invoke',
  arg = 0,
): Promise<ProbeResult> {
  const memoryMaxPages = Math.max(1, Math.ceil(config.memoryLimitBytes / WASM_PAGE_BYTES));
  return new Promise((resolve) => {
    const worker = new Worker(timeoutWorkerPath, { workerData: { wasmBytes, entry, arg, memoryMaxPages } });
    let settled = false;
    const finish = (r: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, code: 'sandbox_timeout' }), config.wallClockLimitMs);
    worker.on('message', (m: { ok: boolean; result?: number; code?: SandboxErrorCode }) => {
      if (m.ok) finish(m.result === undefined ? { ok: true } : { ok: true, result: m.result });
      else finish({ ok: false, code: m.code ?? 'sandbox_invocation_error' });
    });
    worker.on('error', () => finish({ ok: false, code: 'sandbox_invocation_error' }));
  });
}
