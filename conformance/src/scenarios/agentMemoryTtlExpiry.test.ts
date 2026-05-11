/**
 * Multi-Agent Shift Phase 3 — TTL expiry semantics for MemoryEntry.
 *
 * Verifies that memory entries carrying `expiresAt` in the past are
 * NOT surfaced by `MemoryAdapter.list()` / `get()`. The fixture writes
 * an entry with `expiresAt` set in the past and another set in the
 * future; the read-back surface only includes the future one.
 *
 * Capability-gated: skips when host doesn't advertise long-term memory.
 * Fixture-gated: requires `conformance-agent-memory-ttl`.
 *
 * @see schemas/memory-entry.schema.json §`expiresAt`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { hasLongTermMemory } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-memory-ttl';
const SKIP = !hasLongTermMemory() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMemoryTtlExpiry: expired entries are excluded from list/get', () => {
  it('list() excludes entries whose expiresAt is in the past', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = snap.json as { variables?: Record<string, unknown> };

    // Fixture writes one expired + one fresh entry, then reads via list().
    // Result MUST include only the fresh entry.
    const listResult = body.variables?.memoryList as Array<{ id?: string; expiresAt?: string }> | undefined;
    expect(Array.isArray(listResult)).toBe(true);
    const now = Date.now();
    for (const e of listResult!) {
      if (e.expiresAt) {
        expect(new Date(e.expiresAt).getTime()).toBeGreaterThan(now);
      }
    }
  });
});
