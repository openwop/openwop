/**
 * Writer for the append-only agent-attributed-run index (RFC 0086).
 *
 * Called once, right after a run carrying agent attribution is inserted (the
 * shared run-starter for schedule/heartbeat/approval, plus the Kanban card→run
 * path). Extracts the single attribution block from the run's metadata and
 * records (runId → rosterId/agentId/source). The index is immutable — live run
 * status is joined from the runs table at query time — so there is nothing to
 * update when the run later completes/fails.
 *
 * Best-effort: a write failure is logged but never propagated, so the index can
 * never break run dispatch. A run that misses the index simply won't appear in
 * indexed activity queries (degraded visibility, not a broken run).
 *
 * @see src/storage/storage.ts — recordAgentRunAttribution / listAgentRunActivity
 * @see src/host/agentActivity.ts — the projection these runs feed
 */

import type { Storage, AgentRunAttributionRow } from '../storage/storage.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('agentRunActivityIndex');

const ATTRIBUTION_KEYS = ['heartbeat', 'schedule', 'kanban', 'approval'] as const;

interface AttributedRun {
  runId: string;
  tenantId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** Record a run's agent attribution in the index, if it carries one. No-op for
 *  runs with no heartbeat/schedule/kanban/approval block. */
export async function recordRunAttribution(storage: Storage, run: AttributedRun): Promise<void> {
  const md = (run.metadata ?? {}) as Record<string, unknown>;
  for (const source of ATTRIBUTION_KEYS) {
    const block = md[source];
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.rosterId !== 'string') return; // attributed block but no member
    const row: AgentRunAttributionRow = {
      runId: run.runId,
      tenantId: run.tenantId,
      rosterId: b.rosterId,
      source,
      createdAt: run.createdAt,
      ...(typeof b.agentId === 'string' ? { agentId: b.agentId } : {}),
    };
    try {
      await storage.recordAgentRunAttribution(row);
    } catch (err) {
      log.warn('agent run attribution index write failed', {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return; // a run carries at most one attribution block
  }
}
