/**
 * Multi-Agent Shift Phase 3 — MemoryAdapter list/get round-trip.
 * Normative reference: RFCS/0004-memory-layer.md
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
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';

const FIXTURE = 'conformance-agent-memory-roundtrip';
const SKIP = !hasLongTermMemory() || !isFixtureAdvertised(FIXTURE);

/** Why the gate below holds, as RFC 0148 §A names it (openwop#1686: a describe-level skip recorded no disposition). */
const GATE_WHY: readonly [SoftSkipKind, string] =
  (!hasLongTermMemory()) ? ['inapplicable', `the host does not advertise the capability this scenario covers (hasLongTermMemory() is false)`] as const : 
  (!isFixtureAdvertised(FIXTURE)) ? ['blocked', `the \`${FIXTURE}\` fixture is not advertised`] as const : ['blocked', 'the gate held for no named reason'] as const;

describe('agentMemoryRoundTrip: write → read via MemoryAdapter', () => {
  it('memory entries written during a run are readable via the resolved memoryRef', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.it.agentMemoryRoundTrip.memory-entries-written-during-a-run-are-readable-via-the-resolved-memoryref', 'RFCS/0004-memory-layer.md', 'memory entries written during a run are readable via the resolved memoryRef')).toBe(201);
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
