// Worker that instantiates + runs ONE WASM invocation in isolation.
//
// Runs on a dedicated worker thread so the host's main thread can enforce a
// wall-clock cap by terminating this worker (a same-thread setTimeout cannot
// interrupt a synchronous WASM loop). The host has already statically gated the
// module's imports (see wasm-sandbox.ts), so by the time we instantiate, every
// declared import is host-provided: the host memory (capped) + the granted
// `openwop.*` capability stubs. A trap (e.g. an out-of-bounds access past the
// memory bound) is caught and classified; the result is posted back.
import { workerData, parentPort } from 'node:worker_threads';

const { wasmBytes, entry, arg, allowedHostCalls, memoryMaxPages } = workerData;

/** Classify a runtime trap message into an RFC 0035 §C error code. */
function classifyTrap(message) {
  if (/out of bounds memory access|memory access out of bounds/i.test(message)) {
    return 'sandbox_memory_exceeded';
  }
  return 'sandbox_invocation_error';
}

try {
  // Host-provided, capped linear memory. A module that accesses beyond this
  // bound traps — the engine enforces the cap.
  const memory = new WebAssembly.Memory({ initial: 1, maximum: memoryMaxPages });
  const openwop = {};
  for (const name of allowedHostCalls) {
    // Granted host capability — a deterministic stub for conformance (e.g. a
    // `fetch` that echoes its argument). A real host wires the actual capability.
    openwop[name] = (x) => x;
  }
  const imports = { env: { memory }, openwop };

  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), imports);
  const fn = instance.exports[entry];
  if (typeof fn !== 'function') {
    parentPort.postMessage({ ok: false, code: 'sandbox_invocation_error', message: `no exported function '${entry}'` });
  } else {
    const result = fn(arg);
    parentPort.postMessage({ ok: true, result: Number(result) });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  parentPort.postMessage({ ok: false, code: classifyTrap(message), message });
}
