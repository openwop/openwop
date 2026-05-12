/**
 * Multi-Agent Shift Phase 4 — `conversation.exchange` differs from `clarification.requested`.
 * Normative reference: RFCS/0005-conversation.md
 *
 * Verifies that `core.conversationGate.exchange` produces
 * `conversation.exchanged` events in the run log — distinct from the
 * pre-MAS `clarification.requested` / `clarification.resolved` shape.
 * Hosts MUST NOT emit `clarification.requested` for conversation.exchange
 * suspends; the two surfaces are independent.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.conversationPrimitive: true`. Fixture-gated: requires
 * `conformance-conversation-vs-clarification`.
 *
 * @see spec/v1/interrupt.md §`conversation.exchange` vs `clarification`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isConversationPrimitiveSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-conversation-vs-clarification';
const SKIP = !isConversationPrimitiveSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('conversationVsLegacySuspend: distinct event surfaces', () => {
  it('conversation suspend emits conversation.* events, not clarification.*', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string }> }).events ?? [];

    const conversationEvents = list.filter((e) => e.type.startsWith('conversation.'));
    const clarificationEvents = list.filter((e) => e.type.startsWith('clarification.'));

    expect(conversationEvents.length).toBeGreaterThan(0);
    expect(
      clarificationEvents.length,
      'conversation.exchange MUST NOT emit clarification.* events',
    ).toBe(0);
  });
});
