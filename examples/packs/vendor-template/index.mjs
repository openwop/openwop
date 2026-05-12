/**
 * vendor.{ORG}.{PACK} — {one-line description}.
 *
 * Host contract (declared in pack.json `peerDependencies`):
 *
 *   ctx.aiEnvelope.generate({ ... }) → Promise<{ envelopeType, payload }>
 *
 * (Replace the contract block with the actual ctx surface your nodes
 * use. See spec/v1/host-capabilities.md for the canonical contracts.)
 *
 * Each named export is a NodeModule that the engine registers under its
 * declared `typeId` from pack.json. The engine calls `execute(ctx)`,
 * yielding `output` / `error` / `progress` events; the executor pulls
 * `ctx.inputs` (validated against `inputSchemaRef`) and `ctx.config`
 * (validated against `configSchemaRef`).
 */

import { defineNode } from '@openwop/workflow-engine';

// ─── Helpers (delete if not needed) ──────────────────────────────────

/**
 * Guard: fail-fast when the host doesn't advertise a required capability.
 * Pack manifests declare `peerDependencies` but a misconfigured host
 * could load the pack anyway. Throw a typed error with `code` so the
 * engine emits a clean `host_capability_missing` envelope instead of
 * an opaque crash.
 */
function ensureAiEnvelope(ctx) {
  if (!ctx.aiEnvelope || typeof ctx.aiEnvelope.generate !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.aiEnvelope; declare host.aiEnvelope: supported in pack.json peerDependencies'),
      { code: 'host_capability_missing' },
    );
  }
}

// ─── Node executors ──────────────────────────────────────────────────

/**
 * Example node — replace with your real implementation.
 *
 * Pattern this generates:
 *   1. Validate host capability availability
 *   2. Read ctx.inputs / ctx.config
 *   3. Call host capability (e.g., `ctx.aiEnvelope.generate(...)`)
 *   4. Yield `output` event with the payload
 *   5. Catch + re-throw as typed error
 */
export const exampleNode = defineNode({
  id: 'vendor.{ORG}.{PACK}.example',
  version: '1.0.0',
  label: 'Example Node',
  description: 'Replace with your real description.',
  category: 'data',
  role: 'side-effect',
  capabilities: ['cacheable', 'side-effectful'],

  // Schemas are bundled as separate JSON files referenced from pack.json.
  // The runtime loads them at registration; the executor consumes the
  // already-validated values from ctx.inputs / ctx.config.

  execute: async function* (ctx) {
    if (ctx.signal?.aborted) {
      yield { type: 'error', error: { code: 'aborted', message: 'cancelled before start' } };
      return;
    }
    ensureAiEnvelope(ctx);

    ctx.log('info', 'example: starting', {
      // structured log fields — pick what your operators need to debug
      userMessage: ctx.inputs?.userMessage?.length ?? 0,
    });

    try {
      // Replace this block with your real executor logic.
      const result = {
        message: 'Replace this body with the real implementation',
        echo: ctx.inputs,
      };

      yield { type: 'output', data: result };
    } catch (err) {
      ctx.log('error', 'example: failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      yield {
        type: 'error',
        error: {
          code: 'execution_failed',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
});

// Register every node module as a named export. The runtime collects
// them at pack-load time via the manifest's `nodes[].typeId`.
export const nodes = {
  'vendor.{ORG}.{PACK}.example': exampleNode,
};
