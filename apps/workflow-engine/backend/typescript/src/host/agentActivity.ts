/**
 * Agent run-activity projection (RFC 0086 attribution → activity feed items).
 *
 * A schedule / heartbeat / kanban fire stamps a content-free attribution block
 * onto the run's `metadata` (`{ heartbeat | schedule | kanban }`) naming the
 * roster member. This module projects the durable runs store into activity
 * items, shared by BOTH the per-agent feed (`/roster/:id/activity`) and the
 * fleet feed (`/fleet/activity`) so the two can't drift.
 *
 * Attribution lives inside the `metadata` JSON blob and the runs store has no
 * per-attribution index, so callers scan the most-recent tenant runs and
 * project here. They MUST surface a `truncated` flag when the scan window was
 * hit — no silent "no older activity" implication. A durable per-roster query
 * (indexed attribution column / side-table) is the production upgrade.
 *
 * @see src/routes/agentOps.ts — the per-agent + fleet endpoints
 * @see src/host/runStarter.ts — where the attribution block is stamped
 */

import type { RunRecord } from '../types.js';

export type AgentActivitySource = 'heartbeat' | 'schedule' | 'kanban' | 'approval';
const ATTRIBUTION_KEYS: readonly AgentActivitySource[] = ['heartbeat', 'schedule', 'kanban', 'approval'];

export interface AgentActivityItem {
  runId: string;
  workflowId: string;
  status: string;
  source: AgentActivitySource;
  rosterId?: string;
  agentId?: string;
  persona?: string;
  cardId?: string;
  /** Terminal time when available, else last-update / creation. */
  timestamp: string;
  /** ISO-8601 run creation time. */
  createdAt?: string;
  /** ISO-8601 terminal time; absent while still running. */
  completedAt?: string;
  /** Wall-clock run duration in ms (when both bookends are known) — lets the UI
   *  show "ran in 4.2s" without a per-run event scan. */
  durationMs?: number;
  /** RFC 0040 — the trigger event that caused this run, when recorded. */
  causationId?: string;
}

export interface ActivityFilter {
  /** Keep only runs attributed to this roster member. */
  rosterId?: string;
  /** Keep only runs in this terminal/active status (e.g. 'failed'). */
  status?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Project runs into activity items (newest first). A run contributes one item
 * when it carries a heartbeat/schedule/kanban attribution block (and matches the
 * optional rosterId/status filters). Runs with no agent attribution are dropped.
 */
export function projectAgentActivity(runs: readonly RunRecord[], filter: ActivityFilter = {}): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];
  for (const run of runs) {
    if (filter.status && run.status !== filter.status) continue;
    const md = (run.metadata ?? {}) as Record<string, unknown>;
    let chosen: { source: AgentActivitySource; block: Record<string, unknown> } | undefined;
    for (const key of ATTRIBUTION_KEYS) {
      const block = md[key];
      if (block && typeof block === 'object') {
        chosen = { source: key, block: block as Record<string, unknown> };
        break;
      }
    }
    if (!chosen) continue;
    if (filter.rosterId && chosen.block.rosterId !== filter.rosterId) continue;
    const durationMs = run.completedAt
      ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime())
      : undefined;
    items.push({
      runId: run.runId,
      workflowId: run.workflowId,
      status: run.status,
      source: chosen.source,
      rosterId: str(chosen.block.rosterId),
      agentId: str(chosen.block.agentId),
      persona: str(chosen.block.persona),
      cardId: str(chosen.block.cardId),
      timestamp: run.completedAt ?? run.updatedAt ?? run.createdAt,
      createdAt: run.createdAt,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(run.causationId ? { causationId: run.causationId } : {}),
    });
  }
  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
