/**
 * Multi-Agent Shift Phase 4 — replay-fork of a conversation produces identical log.
 * Normative reference: RFCS/0005-conversation.md
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
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE = 'conformance-conversation-replay';
const SKIP = !isConversationPrimitiveSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('conversationReplayDeterminism: replay-fork preserves conversation log', () => {
  it('forked run yields byte-equal conversation channel projection', async () => {
    // unfailable-leg audit wave 2, 2026-09-27: the replay-fork gate used to be
    // the fork response itself (404/501 → soft-skip 'inapplicable'), reached
    // only AFTER the create/terminal asserts — a host with no fork surface
    // recorded a partial-witness pass. Gate on the advertised `replay.modes`
    // BEFORE any assertion; once `replay` is advertised, a 404/501 fork fails.
    const replayCap = await readCapabilityFamily<{ supported?: unknown; modes?: unknown }>('replay');
    const modes = replayCap?.supported === true && Array.isArray(replayCap.modes) ? replayCap.modes : [];
    if (!modes.includes('replay')) return softSkip('inapplicable', 'host does not advertise replay.modes including "replay"');

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.it.conversationReplayDeterminism.forked-run-yields-byte-equal-conversation-channel-projection', 'RFCS/0005-conversation.md', 'forked run yields byte-equal conversation channel projection')).toBe(201);
    const sourceRunId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(sourceRunId);
    expect(terminal.status).toBe('completed');

    const sourceSnap = await driver.get(`/v1/runs/${encodeURIComponent(sourceRunId)}`);
    const sourceConv = (sourceSnap.json as { channels?: Record<string, unknown> }).channels;
    // unfailable-leg audit wave 2, 2026-09-27: a host that projected NO
    // channels on either run compared `undefined` to `undefined` and passed
    // "byte-equal". The source projection must exist and be non-empty first.
    expect(
      sourceConv !== null && typeof sourceConv === 'object' && !Array.isArray(sourceConv) && Object.keys(sourceConv).length > 0,
      req('openwop.it.conversationReplayDeterminism.forked-run-yields-byte-equal-conversation-channel-projection', 'RFCS/0005-conversation.md', 'the source run of a conversation fixture MUST project a non-empty channels object'),
    ).toBe(true);

    const fork = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
      mode: 'replay',
    });
    expect([200, 201], req('openwop.it.conversationReplayDeterminism.forked-run-yields-byte-equal-conversation-channel-projection', 'spec/v1/replay.md', 'a host advertising replay.modes ["replay"] MUST accept a mode:"replay" fork (404/501 is a failure)')).toContain(fork.status);

    const forkedRunId = (fork.json as { runId: string }).runId;
    const forkedTerminal = await pollUntilTerminal(forkedRunId);
    expect(forkedTerminal.status).toBe('completed');

    const forkedSnap = await driver.get(`/v1/runs/${encodeURIComponent(forkedRunId)}`);
    const forkedConv = (forkedSnap.json as { channels?: Record<string, unknown> }).channels;

    expect(JSON.stringify(forkedConv), req('openwop.it.conversationReplayDeterminism.forked-run-yields-byte-equal-conversation-channel-projection', 'RFCS/0005-conversation.md', 'a replay-forked run MUST yield a byte-equal conversation channel projection')).toBe(JSON.stringify(sourceConv));
  });
});
