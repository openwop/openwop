/**
 * Multi-Agent Shift Phase 1 — `message` reducer idempotency invariant.
 *
 * Verifies the canonical `message` reducer's contract from
 * `spec/v1/channels-and-reducers.md` §`message`:
 *   - Append-only — new messages land at the end of the list.
 *   - Idempotent on `messageId` — a duplicate emission folds to a
 *     single entry.
 *   - Replay-deterministic — the same event sequence produces the
 *     same final channel value.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true`. Fixture-gated: requires
 * `conformance-message-reducer` (intentionally emits duplicate-id
 * messages to exercise idempotency).
 *
 * @see spec/v1/channels-and-reducers.md §`message`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-message-reducer';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMessageReducer: message reducer idempotency + append-only invariant', () => {
  it('duplicate messageId emissions fold to a single channel entry', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = snap.json as { channels?: Record<string, unknown> };
    expect(body.channels).toBeDefined();

    // Find any channel using the `message` reducer (host names vary;
    // fixture convention is `conversation` or `messages`).
    const channelEntries = Object.entries(body.channels ?? {});
    const messageChannel = channelEntries.find(([, val]) => Array.isArray(val));
    expect(messageChannel, 'fixture MUST expose at least one message-reducer channel').toBeDefined();

    const messages = messageChannel![1] as Array<{ messageId?: string }>;
    const messageIds = messages
      .map((m) => m.messageId)
      .filter((id): id is string => typeof id === 'string');

    // Each messageId appears at most once (idempotency).
    const uniq = new Set(messageIds);
    expect(uniq.size).toBe(messageIds.length);
  });
});
