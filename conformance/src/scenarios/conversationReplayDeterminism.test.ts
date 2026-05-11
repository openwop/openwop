/**
 * Multi-Agent Shift Phase 4 — replay-fork of a conversation produces identical log.
 *
 * Verifies that running `:fork` on a conversation-bearing run yields
 * a child run whose conversation log (folded via the `message` reducer)
 * is byte-equal to the source run's. Replay determinism is required
 * for audit + debug-bundle consistency.
 *
 * Capability-gated: skips when host doesn't advertise conversation
 * primitive OR doesn't advertise replay-fork. Fixture-gated: requires
 * `conformance-conversation-replay`.
 *
 * @see spec/v1/replay.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isConversationPrimitiveSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-conversation-replay';
const SKIP = !isConversationPrimitiveSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('conversationReplayDeterminism: replay-fork preserves conversation log', () => {
  it('forked run yields byte-equal conversation channel projection', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const sourceRunId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(sourceRunId);
    expect(terminal.status).toBe('completed');

    const sourceSnap = await driver.get(`/v1/runs/${encodeURIComponent(sourceRunId)}`);
    const sourceConv = (sourceSnap.json as { channels?: Record<string, unknown> }).channels;

    const fork = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'replay',
    });
    if (fork.status === 404 || fork.status === 501) return; // host doesn't support replay-fork
    expect([200, 201]).toContain(fork.status);

    const forkedRunId = (fork.json as { runId: string }).runId;
    const forkedTerminal = await pollUntilTerminal(forkedRunId);
    expect(forkedTerminal.status).toBe('completed');

    const forkedSnap = await driver.get(`/v1/runs/${encodeURIComponent(forkedRunId)}`);
    const forkedConv = (forkedSnap.json as { channels?: Record<string, unknown> }).channels;

    expect(JSON.stringify(forkedConv)).toBe(JSON.stringify(sourceConv));
  });
});
