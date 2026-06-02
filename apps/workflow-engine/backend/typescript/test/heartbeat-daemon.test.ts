/**
 * Autonomous heartbeat daemon (host/heartbeatService.ts).
 *
 *   - a member with no heartbeatIntervalMs is never auto-checked (manual only)
 *   - a member due for a heartbeat picks a To Do card and starts its run
 *   - a member checked within its interval is not re-run
 *   - a disabled member is never auto-checked
 *   - MULTI-INSTANCE: two concurrent passes run the member's heartbeat once
 *
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { StartRunDeps } from '../src/host/runStarter.js';
import { initHostExtPersistence, __resetHostExtPersistence } from '../src/host/hostExtPersistence.js';
import {
  createRosterEntry,
  updateRosterEntry,
  __resetRosterStore,
  listRosterTenants,
  type RosterEntry,
} from '../src/host/rosterService.js';
import { createBoard, createCard, __resetKanbanStore } from '../src/host/kanbanService.js';
import { processDueHeartbeats } from '../src/host/heartbeatService.js';

// Fully typed against the narrowed StartRunDeps['hostSuite'] — no cast.
const hostSuite: StartRunDeps['hostSuite'] = {
  workflowCatalog: { getWorkflow: async (id) => ({ workflowId: id, definition: { workflowId: id, nodes: [] } }) },
  providerPolicyResolver: { resolveForRun: async () => [] },
};

let storage: Storage;
let deps: StartRunDeps;

const TENANT = 't1';
const NOW = Date.parse('2026-06-02T12:00:00Z');

beforeEach(async () => {
  storage = await openStorage('memory://');
  initHostExtPersistence(storage);
  await __resetRosterStore();
  await __resetKanbanStore();
  deps = { storage, hostSuite };
});
afterEach(() => {
  __resetHostExtPersistence();
});

/** Create a member with a board carrying one To Do card that triggers a wf. */
async function makeAgentWithTask(over: Partial<Parameters<typeof createRosterEntry>[0]> = {}): Promise<RosterEntry> {
  const entry = await createRosterEntry({
    tenantId: TENANT,
    persona: 'Sally',
    agentRef: { agentId: 'host:demo-sales' },
    workflows: ['wf-1'],
    ...over,
  });
  const board = await createBoard({
    tenantId: TENANT,
    name: 'Sally board',
    rosterId: entry.rosterId,
    triggerWorkflowId: 'wf-1',
  });
  const todo = board.columns.find((c) => c.id === 'todo' || c.name.toLowerCase() === 'to do')!;
  await createCard({ boardId: board.id, columnId: todo.id, title: 'Do the thing' });
  return entry;
}

async function heartbeatRuns(rosterId: string) {
  const runs = await storage.listRuns({ limit: 100 });
  return runs.filter((r) => {
    const block = (r.metadata as Record<string, unknown>)?.heartbeat as Record<string, unknown> | undefined;
    return block?.rosterId === rosterId;
  });
}

describe('heartbeatService — autonomous daemon', () => {
  it('never auto-checks a member with no heartbeatIntervalMs (manual only)', async () => {
    const entry = await makeAgentWithTask(); // no interval
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW)).toBe(0);
    expect(await heartbeatRuns(entry.rosterId)).toHaveLength(0);
  });

  it('auto-checks a due member: picks a To Do card and starts its run', async () => {
    const entry = await makeAgentWithTask({ heartbeatIntervalMs: 60_000 });
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW)).toBe(1);
    expect(await heartbeatRuns(entry.rosterId)).toHaveLength(1);
  });

  it('does not re-run a member checked within its interval', async () => {
    const entry = await makeAgentWithTask({ heartbeatIntervalMs: 3_600_000 });
    // First pass checks it (stamps lastHeartbeatAt = NOW).
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW)).toBe(1);
    // 10 minutes later — still inside the 1h interval → not due.
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW + 600_000)).toBe(0);
    expect(await heartbeatRuns(entry.rosterId)).toHaveLength(1);
  });

  it('does not auto-check a disabled member', async () => {
    const entry = await makeAgentWithTask({ heartbeatIntervalMs: 60_000, enabled: false });
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW)).toBe(0);
    expect(await heartbeatRuns(entry.rosterId)).toHaveLength(0);

    // Re-enabling makes it eligible.
    await updateRosterEntry(entry.rosterId, { enabled: true });
    expect(await processDueHeartbeats(deps, listRosterTenants, NOW)).toBe(1);
  });

  it('runs a due member once across two concurrent instances', async () => {
    const entry = await makeAgentWithTask({ heartbeatIntervalMs: 60_000 });
    const [a, b] = await Promise.all([
      processDueHeartbeats(deps, listRosterTenants, NOW),
      processDueHeartbeats(deps, listRosterTenants, NOW),
    ]);
    expect(a + b).toBe(1);
    expect(await heartbeatRuns(entry.rosterId)).toHaveLength(1);
  });
});
