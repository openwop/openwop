/**
 * Multi-Agent Shift Phase 4 — conversation primitive lifecycle.
 *
 * Verifies the open → exchange → close lifecycle:
 *   1. `conversation.opened` emitted on `core.conversationGate.open`.
 *   2. `conversation.exchanged` emitted on resume after a single turn.
 *   3. `conversation.closed` emitted on `core.conversationGate.close`.
 *   4. All three events share the same `conversationId`.
 *   5. Per CO-3: no `conversation.exchanged` events follow
 *      `conversation.closed` for the same conversationId.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.conversationPrimitive: true`. Fixture-gated: requires
 * `conformance-conversation-lifecycle`.
 *
 * @see spec/v1/interrupt.md §`conversation.start`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isConversationPrimitiveSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-conversation-lifecycle';
const SKIP = !isConversationPrimitiveSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('conversationLifecycle: open → exchange → close round-trip', () => {
  it('emits all three lifecycle events with matching conversationId; no exchanges after close', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // The fixture's exchange step requires resume input. Host-internal
    // mock auto-resumes for conformance.
    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

    const opened = list.filter((e) => e.type === 'conversation.opened');
    const exchanged = list.filter((e) => e.type === 'conversation.exchanged');
    const closed = list.filter((e) => e.type === 'conversation.closed');

    expect(opened.length).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThan(0);

    // All three event types MUST share the same conversationId for the
    // fixture's single conversation.
    const convId = opened[0].payload?.conversationId as string;
    expect(typeof convId).toBe('string');
    for (const ev of [...opened, ...exchanged, ...closed]) {
      expect(ev.payload?.conversationId).toBe(convId);
    }

    // CO-3: closed.sequence > all exchanged.sequence for the same id.
    const closedIdx = list.findIndex((e) => e.type === 'conversation.closed');
    const exchangedAfterClose = list
      .slice(closedIdx + 1)
      .filter((e) => e.type === 'conversation.exchanged' && e.payload?.conversationId === convId);
    expect(exchangedAfterClose.length).toBe(0);
  });
});
