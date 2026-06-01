// Suite-local worker for the RFC 0035 §B wall-clock-timeout conformance probe.
//
// Instantiates ONE WASM module on a dedicated worker thread and runs its entry.
// The main thread (see `probeTimeout` in wasm-sandbox-probe.ts) races a
// kill-timer against this worker: a non-terminating module (the
// `misbehaving-timeout` fixture) never posts and is terminated at the wall-clock
// cap → `sandbox_timeout`; a well-behaved module posts its result first. Mirrors
// the reference host's `examples/hosts/wasm-sandbox/src/sandbox-worker.mjs`; the
// suite carries its own copy so the published conformance package is
// self-contained (no dependency on the reference host).
import { workerData, parentPort } from 'node:worker_threads';

const { wasmBytes, entry, arg, memoryMaxPages } = workerData;

try {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: memoryMaxPages });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), { env: { memory } });
  const fn = instance.exports[entry];
  if (typeof fn !== 'function') {
    parentPort.postMessage({ ok: false, code: 'sandbox_invocation_error' });
  } else {
    const result = fn(arg); // a non-terminating module never returns — the host kill-timer fires
    parentPort.postMessage({ ok: true, result: Number(result) });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const code = /out of bounds memory access|memory access out of bounds/i.test(message)
    ? 'sandbox_memory_exceeded'
    : 'sandbox_invocation_error';
  parentPort.postMessage({ ok: false, code });
}
