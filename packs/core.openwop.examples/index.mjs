/**
 * core.openwop.examples — spec-canonical examples pack runtime.
 *
 * Exports three node implementations conforming to the OpenWOP v1
 * runtime contract (see spec/v1/node-packs.md §"Runtime contract").
 * Each implementation is a `(ctx) => Promise<NodeResult>` where `ctx`
 * provides `config`, `inputs`, `signal`, and optional `emit(event)`
 * for streaming nodes. Hosts register these via their pack-loader at
 * workflow-register time.
 *
 * Pack manifest: pack.json (at repo root of the pack).
 * Schemas:       schemas/*.{config,input,output}.json (referenced from manifest).
 *
 * Zero external deps — uses node:crypto for the deterministic hash.
 * Node ≥ 20 required (per pack.json `runtime.minRuntimeVersion`).
 *
 * @see spec/v1/node-packs.md
 * @see docs/PACKS-MVP-PLAN.md (catalog plan)
 */

import { createHash } from 'node:crypto';

/**
 * Sleep helper that honours an AbortSignal.
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error('aborted'));
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * core.openwop.examples.echo
 *
 * Returns the `inputs.value` port verbatim. No side effects. Replay-
 * safe by construction — pure function of inputs. The host MAY cache
 * the result keyed on input shape (the `cacheable` capability is
 * advertised in the pack manifest).
 */
export async function echo(ctx) {
  return {
    status: 'success',
    outputs: { value: ctx.inputs.value },
  };
}

/**
 * core.openwop.examples.coin-flip
 *
 * Deterministic SHA-256-derived heads/tails. Same seed → same result
 * across replays, across hosts, across language reimplementations.
 *
 * Determinism rule (normative for this pack):
 *   result = SHA-256(seed)[0] % 2 === 0 ? 'heads' : 'tails'
 *
 * A second-language port (Python, Go, WASM) of this pack MUST follow
 * the same rule so cross-language hosts return identical results for
 * the same seed.
 */
export async function coinFlip(ctx) {
  const seed = String(ctx.inputs.seed);
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const result = digest[0] % 2 === 0 ? 'heads' : 'tails';
  return {
    status: 'success',
    outputs: { result },
  };
}

/**
 * core.openwop.examples.delay-with-progress
 *
 * Sleeps for `config.delayMs` total, emitting a `node.progress`
 * event every `config.tickMs` (default 100). The progress event
 * payload carries the elapsed milliseconds so streaming consumers
 * can render a progress bar without polling.
 *
 * Replay semantics: per spec/v1/replay.md §"Replay determinism", the
 * host's invocation log caches the terminal node.completed payload
 * on first execution. On replay, this function is NOT re-executed —
 * the host returns the cached `{ actualDelayMs, tickCount }` directly.
 * That makes the wall-clock cost of replay near-zero.
 *
 * Abort: respects `ctx.signal`. If aborted mid-delay, throws and the
 * host emits a node.failed event with code 'aborted'.
 */
export async function delayWithProgress(ctx) {
  const delayMs = ctx.config.delayMs;
  const tickMs = ctx.config.tickMs ?? 100;
  const start = Date.now();
  let tickCount = 0;
  let elapsed = 0;

  while (elapsed < delayMs) {
    const remaining = delayMs - elapsed;
    const nextTick = Math.min(tickMs, remaining);
    await sleep(nextTick, ctx.signal);
    elapsed = Date.now() - start;
    tickCount++;
    // Best-effort progress emission. `ctx.emit` is optional per the
    // runtime contract — hosts that don't support streaming events
    // simply don't expose it, in which case the loop still completes
    // correctly (it just produces no per-tick observability).
    ctx.emit?.({
      type: 'node.progress',
      data: { elapsedMs: elapsed, totalMs: delayMs, tick: tickCount },
    });
  }

  return {
    status: 'success',
    outputs: { actualDelayMs: elapsed, tickCount },
  };
}

/**
 * Pack-level registration export. The host's pack-loader reads this
 * to populate its node registry. Keys MUST match `typeId` values in
 * pack.json's `nodes[]` array (the manifest is authoritative; this
 * export is the runtime binding).
 */
export const nodes = {
  'core.openwop.examples.echo': echo,
  'core.openwop.examples.coin-flip': coinFlip,
  'core.openwop.examples.delay-with-progress': delayWithProgress,
};

export default nodes;
