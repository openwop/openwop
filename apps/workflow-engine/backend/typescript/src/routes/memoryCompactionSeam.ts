/**
 * RFC 0012 — memory-compaction test seam.
 *
 * Gated on `OPENWOP_TEST_TRIGGER_COMPACTION=true` (OFF by default so prod
 * deploys can't trigger compaction over the wire). Drives the conformance
 * scenarios memory-compaction-{event-emitted, sr1-carry-forward,
 * provenance-tag}:
 *
 *   POST /v1/test/memory/seed     { memoryRef, entries: [{ id, content, tags? }] }
 *     → 201 { seeded: <n> }
 *   POST /v1/test/memory/compact  { memoryRef }
 *     → 200 {
 *         type: 'memory.compacted',
 *         payload: { memoryRef, outputId, sourceCount, trigger, byteSize, sourceIds? },
 *         outputContent,   // non-wire: the SR-1-redacted distilled content,
 *                          // so the §D scenario can verify carry-forward.
 *       }
 *
 * The `payload` is the canonical `memory.compacted` event shape per
 * `run-event-payloads.schema.json §memoryCompacted` — the same payload the
 * host emits into the run event log on a host-managed compaction.
 *
 * @see RFCS/0012-memory-compaction-profile.md §B/§C/§D
 */

import type { Express } from 'express';
import { seedMemoryEntry, compactMemory } from '../host/inMemorySurfaces.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.memoryCompactionSeam');

/** Fixed tenant for the seam — seed + compact MUST share it. The seam is
 *  conformance-only; isolation from production tenants is by env-gate. */
const SEAM_TENANT = 'compaction-conformance';

export function registerMemoryCompactionSeamRoutes(app: Express): void {
  if (process.env.OPENWOP_TEST_TRIGGER_COMPACTION !== 'true') {
    log.info('memory-compaction seam disabled (set OPENWOP_TEST_TRIGGER_COMPACTION=true to enable)');
    return;
  }
  log.warn('memory-compaction seam ENABLED — /v1/test/memory/{seed,compact} reachable. NEVER enable in production.');

  app.post('/v1/test/memory/seed', (req, res) => {
    const body = (req.body ?? {}) as { memoryRef?: unknown; entries?: unknown };
    if (typeof body.memoryRef !== 'string' || body.memoryRef.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'memoryRef required' } });
      return;
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'entries[] required' } });
      return;
    }
    let seeded = 0;
    for (const e of body.entries) {
      if (
        e && typeof e === 'object' &&
        typeof (e as { id?: unknown }).id === 'string' &&
        typeof (e as { content?: unknown }).content === 'string'
      ) {
        const entry = e as { id: string; content: string; tags?: unknown };
        seedMemoryEntry(SEAM_TENANT, body.memoryRef, {
          id: entry.id,
          content: entry.content,
          ...(Array.isArray(entry.tags)
            ? { tags: entry.tags.filter((t): t is string => typeof t === 'string') }
            : {}),
        });
        seeded += 1;
      }
    }
    res.status(201).json({ seeded });
  });

  app.post('/v1/test/memory/compact', (req, res) => {
    const body = (req.body ?? {}) as { memoryRef?: unknown };
    if (typeof body.memoryRef !== 'string' || body.memoryRef.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'memoryRef required' } });
      return;
    }
    const result = compactMemory(SEAM_TENANT, body.memoryRef);
    if (!result) {
      res.status(400).json({ error: { code: 'nothing_to_compact', message: 'no live entries under memoryRef' } });
      return;
    }
    res.status(200).json({
      type: 'memory.compacted',
      payload: {
        memoryRef: body.memoryRef,
        outputId: result.outputId,
        sourceCount: result.sourceCount,
        // The host advertises trigger:'both' (it can do host-managed OR
        // client-requested); THIS compaction was invoked via the seam, so the
        // event honestly reports the actual trigger of this run.
        trigger: 'client-requested',
        byteSize: result.byteSize,
        // RFC 0012 §B: exhaustive when ≤ 100 sources; omit otherwise.
        ...(result.sourceIds.length <= 100 ? { sourceIds: result.sourceIds } : {}),
      },
      outputContent: result.outputContent,
    });
  });
}
