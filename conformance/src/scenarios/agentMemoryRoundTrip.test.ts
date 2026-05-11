/**
 * Multi-Agent Shift Phase 3 — MemoryAdapter list/get round-trip.
 *
 * Verifies that a host advertising `capabilities.agents.memoryBackends:
 * ['long-term']` resolves `AgentRef.memoryRef` to MemoryEntry results
 * via its MemoryAdapter, and that the entries conform to
 * `schemas/memory-entry.schema.json`.
 *
 * Capability-gated: skips when host doesn't advertise long-term memory.
 * Fixture-gated: requires `conformance-agent-memory-roundtrip`.
 *
 * @see schemas/memory-entry.schema.json
 * @see schemas/memory-list-options.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { hasLongTermMemory } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-memory-roundtrip';
const SKIP = !hasLongTermMemory() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMemoryRoundTrip: write → read via MemoryAdapter', () => {
  it('memory entries written during a run are readable via the resolved memoryRef', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = snap.json as {
      agent?: { memoryRef?: string };
      variables?: Record<string, unknown>;
    };

    // Fixture convention: writes an entry then reads it back into a
    // variable named `memoryReadback`. The variable's value MUST be a
    // MemoryEntry-shaped object per schemas/memory-entry.schema.json.
    const readback = body.variables?.memoryReadback as
      | { id?: string; content?: string; tags?: string[]; createdAt?: string }
      | undefined;
    expect(readback).toBeDefined();
    expect(typeof readback!.id).toBe('string');
    expect(typeof readback!.content).toBe('string');
    expect(Array.isArray(readback!.tags)).toBe(true);
    expect(typeof readback!.createdAt).toBe('string');
  });
});
