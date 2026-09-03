/**
 * core.openwop.http.idempotency-key — determinism contract
 *
 * Verifies the normative MUST from `idempotency.md §"Idempotency-Key"`
 * and the pack's documented purpose (retry-safety): identical
 * `(runId, nodeId, payload)` → identical key, so the remote endpoint
 * can dedupe across retries.
 *
 * Hardens against the 1.1.0 / 1.1.1 defect where the default `uuid`
 * mode returned a fresh `randomUUID()` per call, defeating retry-safety
 * (each retry produced a different key → remote treated every attempt
 * as a new request). Removed in 1.1.2 as a safety-fix per
 * `COMPATIBILITY.md §3` — see CHANGELOG `[Unreleased]` §"core.openwop.http@1.1.2".
 *
 * Server-free. Loads the pack module via dynamic import and asserts:
 *
 *   1. Default mode (`composite`) produces a deterministic key for
 *      identical inputs.
 *   2. Payload sensitivity — same run+node, different payload → different key.
 *   3. Run isolation — same node+payload, different run → different key.
 *   4. Node isolation — same run+payload, different node → different key.
 *   5. `hash` mode is deterministic in the payload alone (run+node ignored).
 *   6. Output shape matches the canonical `^openwop-[0-9a-f]{16}$` pattern
 *      (per `idempotency-key.output.json` 1.1.2).
 *   7. Removed `uuid` mode rejects with `CONFIG_INVALID` — the safety-fix
 *      surfaces loudly rather than silently producing weak keys.
 *   8. Pack output matches the canonical SHA-256 formula computed
 *      independently in this test — third-party pack reimplementations
 *      can run the same scenario against their runtime to verify
 *      cross-impl agreement.
 *
 * Skip-conditions: none. The scenario validates the spec corpus +
 * reference pack source directly; runs in any environment with the
 * repo checked out.
 *
 * @see spec/v1/idempotency.md §"Idempotency-Key"
 * @see packs/core.openwop.http/schemas/idempotency-key.config.json
 * @see packs/core.openwop.http/schemas/idempotency-key.output.json
 * @see SECURITY/invariants.yaml#idempotency-key-deterministic
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = resolve(__dirname, '../../../packs/core.openwop.http/index.mjs');

interface IdempotencyKeyCtx {
  config?: { mode?: string };
  inputs?: { payload?: unknown; runId?: string; nodeId?: string };
  runId?: string;
  nodeId?: string;
}

interface IdempotencyKeyResult {
  status: 'success';
  outputs: { key: string };
}

type IdempotencyKeyFn = (ctx: IdempotencyKeyCtx) => Promise<IdempotencyKeyResult>;

const KEY_PATTERN = /^openwop-[0-9a-f]{16}$/;

/**
 * Canonical formula per `idempotency-key.{config,output}.json` (1.1.2):
 *   sha256( runId || \0 || nodeId || \0 || JSON.stringify(payload) )
 *   key = 'openwop-' + digest.hex().slice(0, 16)
 *
 * Mirrors `deriveIdempotencyKey` in `packs/core.openwop.http/index.mjs`
 * (the same formula `core.openwop.http.fetch` uses internally). Inlined
 * here so the test verifies the spec contract independent of the pack
 * runtime — a third-party reimplementation that follows the spec MUST
 * produce identical keys for these vectors.
 */
function canonicalCompositeKey(runId: string, nodeId: string, payload: unknown): string {
  const h = createHash('sha256');
  h.update(runId, 'utf8');
  h.update('\0', 'utf8');
  h.update(nodeId, 'utf8');
  h.update('\0', 'utf8');
  if (payload !== undefined && payload !== null) {
    h.update(JSON.stringify(payload), 'utf8');
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

function canonicalHashKey(payload: unknown): string {
  const h = createHash('sha256').update(JSON.stringify(payload ?? null), 'utf8').digest('hex');
  return 'openwop-' + h.slice(0, 16);
}

describe('category: core.openwop.http.idempotency-key — determinism contract', () => {
  let idempotencyKey: IdempotencyKeyFn;
  let packAvailable: boolean;

  beforeAll(async () => {
    packAvailable = existsSync(PACK_PATH);
    if (!packAvailable) return;
    const mod = (await import(PACK_PATH)) as { idempotencyKey?: IdempotencyKeyFn };
    if (typeof mod.idempotencyKey !== 'function') {
      throw new Error(
        `expected packs/core.openwop.http/index.mjs to export idempotencyKey; got ${typeof mod.idempotencyKey}`,
      );
    }
    idempotencyKey = mod.idempotencyKey;
  });

  it('skips cleanly when packs/ is not bundled', () => {
    // This scenario reads the in-tree pack source. When the conformance
    // suite is consumed as a published npm package, packs/ isn't shipped
    // — the scenario soft-skips rather than failing.
    if (!packAvailable) {
      console.warn(`[idempotency-key-determinism] packs/core.openwop.http/index.mjs not present; skipping`);
      expect(packAvailable, req('openwop.it.idempotency-key-determinism.skips-cleanly-when-packs-is-not-bundled', 'idempotency.md §"Idempotency-Key', 'skips cleanly when packs/ is not bundled')).toBe(false);
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early ([idempotency-key-determinism] packs/core.openwop.http/index.mjs not present; skipping)');
    }
    expect(packAvailable).toBe(true);
  });

  it('default mode (composite) — identical (runId, nodeId, payload) produces identical keys', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const ctx: IdempotencyKeyCtx = {
      runId: 'run-1',
      nodeId: 'node-1',
      inputs: { payload: { hello: 'world' } },
    };
    const a = await idempotencyKey(ctx);
    const b = await idempotencyKey(ctx);
    expect(a.outputs.key, req('openwop.it.idempotency-key-determinism.default-mode-composite-identical-runid-nodeid-payload-produces-identical-keys', 'idempotency.md §"Idempotency-Key', 'idempotency.md §Idempotency-Key: same logical request MUST produce same key')).toBe(b.outputs.key);
    expect(a.outputs.key).toMatch(KEY_PATTERN);
  });

  it('payload sensitivity — different payload produces different key', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const baseCtx = { runId: 'run-1', nodeId: 'node-1' };
    const a = await idempotencyKey({ ...baseCtx, inputs: { payload: { hello: 'world' } } });
    const b = await idempotencyKey({ ...baseCtx, inputs: { payload: { hello: 'CHANGED' } } });
    expect(a.outputs.key, req('openwop.it.idempotency-key-determinism.payload-sensitivity-different-payload-produces-different-key', 'idempotency.md §"Idempotency-Key', 'payload sensitivity — different payload produces different key')).not.toBe(b.outputs.key);
  });

  it('run isolation — different runId produces different key', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const payload = { hello: 'world' };
    const a = await idempotencyKey({ runId: 'run-1', nodeId: 'node-1', inputs: { payload } });
    const b = await idempotencyKey({ runId: 'run-2', nodeId: 'node-1', inputs: { payload } });
    expect(a.outputs.key, req('openwop.it.idempotency-key-determinism.run-isolation-different-runid-produces-different-key', 'idempotency.md §"Idempotency-Key', 'run isolation — different runId produces different key')).not.toBe(b.outputs.key);
  });

  it('node isolation — different nodeId produces different key', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const payload = { hello: 'world' };
    const a = await idempotencyKey({ runId: 'run-1', nodeId: 'node-A', inputs: { payload } });
    const b = await idempotencyKey({ runId: 'run-1', nodeId: 'node-B', inputs: { payload } });
    expect(a.outputs.key, req('openwop.it.idempotency-key-determinism.node-isolation-different-nodeid-produces-different-key', 'idempotency.md §"Idempotency-Key', 'node isolation — different nodeId produces different key')).not.toBe(b.outputs.key);
  });

  it('hash mode is deterministic in the payload alone (run/node ignored)', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const payload = { request: 'payload-here', id: 42 };
    const a = await idempotencyKey({ config: { mode: 'hash' }, runId: 'run-1', nodeId: 'node-1', inputs: { payload } });
    const b = await idempotencyKey({ config: { mode: 'hash' }, runId: 'run-2', nodeId: 'node-2', inputs: { payload } });
    expect(a.outputs.key, req('openwop.it.idempotency-key-determinism.hash-mode-is-deterministic-in-the-payload-alone-run-node-ignored', 'idempotency.md §"Idempotency-Key', 'hash mode MUST ignore run/node — useful for global remote-dedup caches')).toBe(b.outputs.key);
    expect(a.outputs.key).toMatch(KEY_PATTERN);
  });

  it('output shape — every emitted key matches openwop-<sha256-prefix-16>', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    const samples: IdempotencyKeyCtx[] = [
      { runId: 'r', nodeId: 'n', inputs: { payload: null } },
      { runId: 'r', nodeId: 'n', inputs: { payload: 'string-payload' } },
      { runId: 'r', nodeId: 'n', inputs: { payload: [1, 2, 3] } },
      { runId: 'r', nodeId: 'n', inputs: { payload: { nested: { value: true } } } },
      { config: { mode: 'hash' }, inputs: { payload: 'x' } },
    ];
    for (const ctx of samples) {
      const result = await idempotencyKey(ctx);
      expect(result.outputs.key, req('openwop.it.idempotency-key-determinism.output-shape-every-emitted-key-matches-openwop-sha256-prefix-16', 'idempotency.md §"Idempotency-Key', `key shape for ctx=${JSON.stringify(ctx)}`)).toMatch(KEY_PATTERN);
    }
  });

  it('uuid mode rejects with CONFIG_INVALID (safety-fix per 1.1.2)', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    // The removed mode names the safety-fix in its error message so
    // pinned-version callers diagnosing a regression find the fix.
    let caught: unknown;
    try {
      await idempotencyKey({ config: { mode: 'uuid' }, inputs: { payload: 'x' } });
    } catch (err) {
      caught = err;
    }
    expect(caught, req('openwop.it.idempotency-key-determinism.uuid-mode-rejects-with-config-invalid-safety-fix-per-1-1-2', 'idempotency.md §"Idempotency-Key', 'mode: uuid MUST be rejected — the 1.1.0/1.1.1 non-deterministic default was removed')).toBeInstanceOf(Error);
    expect((caught as Error & { code?: string }).code).toBe('CONFIG_INVALID');
    expect((caught as Error).message).toMatch(/uuid.*removed|safety-fix/i);
  });

  it('cross-impl invariant — pack output equals canonical SHA-256 formula', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    // Five fixed vectors. A third-party core.openwop.http reimplementation
    // can run the same scenario against its runtime — agreement on these
    // vectors proves wire-level interop on the Idempotency-Key shape.
    const vectors = [
      { runId: 'run-A', nodeId: 'node-1', payload: { task: 'create-charge', amount: 100 } },
      { runId: 'run-A', nodeId: 'node-2', payload: { task: 'create-charge', amount: 100 } },
      { runId: 'run-B', nodeId: 'node-1', payload: { task: 'create-charge', amount: 100 } },
      { runId: 'r', nodeId: 'n', payload: null },
      { runId: 'r', nodeId: 'n', payload: 'just-a-string' },
    ];
    for (const v of vectors) {
      const packed = await idempotencyKey({
        runId: v.runId,
        nodeId: v.nodeId,
        inputs: { payload: v.payload },
      });
      const expected = canonicalCompositeKey(v.runId, v.nodeId, v.payload);
      expect(
        packed.outputs.key,
        req('openwop.it.idempotency-key-determinism.cross-impl-invariant-pack-output-equals-canonical-sha-256-formula', 'idempotency.md §"Idempotency-Key', `vector ${JSON.stringify(v)} — pack output MUST match canonical sha256(runId\\0nodeId\\0JSON(payload))`),
      ).toBe(expected);
    }

    // Hash-mode vectors: same formula independent of run/node.
    for (const payload of [null, 'x', { nested: 1 }, [1, 2]]) {
      const packed = await idempotencyKey({ config: { mode: 'hash' }, inputs: { payload } });
      expect(packed.outputs.key).toBe(canonicalHashKey(payload));
    }
  });
});
