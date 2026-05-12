/**
 * Multi-Agent Shift Phase 3 — SR-1 secret-redaction invariant.
 * Normative reference: RFCS/0004-memory-layer.md
 *
 * Verifies the SR-1 normative invariant: when a memory write contains
 * a value the run's BYOK vault resolved during the run, the persisted
 * entry MUST carry `[REDACTED:<secretId>]` in place of the plaintext.
 * Read-back from MemoryAdapter MUST surface the redacted form.
 *
 * Capability-gated: skips when host doesn't advertise long-term memory.
 * Fixture-gated: requires `conformance-agent-memory-redaction`
 * (resolves a BYOK secret, writes a memory entry containing the
 * plaintext, reads it back).
 *
 * @see docs/MULTI-AGENT-INTEGRATION-GAPS.md §`Phase 3`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { hasLongTermMemory } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-memory-redaction';
const SKIP = !hasLongTermMemory() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMemoryRedactionContract: SR-1 invariant', () => {
  it('BYOK plaintext is redacted to [REDACTED:<secretId>] at the read surface', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = snap.json as { variables?: Record<string, unknown> };

    // Fixture convention: writes a memory entry containing a registered
    // BYOK plaintext, then reads it back into `memoryReadback.content`.
    // The read-side value MUST contain the redaction marker, not the
    // plaintext.
    const readback = body.variables?.memoryReadback as { content?: string } | undefined;
    expect(readback).toBeDefined();
    expect(readback!.content).toMatch(/\[REDACTED:[^\]]+\]/);
  });
});
