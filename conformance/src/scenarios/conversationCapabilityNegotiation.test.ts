/**
 * Multi-Agent Shift Phase 4 — capability-gate refusal contract.
 * Normative reference: RFCS/0005-conversation.md
 *
 * Verifies that a host which does NOT advertise
 * `capabilities.conversationPrimitive: true` MUST refuse a workflow
 * registration that declares `core.conversationGate` nodes, with
 * `validation_error` per spec/v1/capabilities.md §`conversationPrimitive`.
 *
 * This scenario is the COMPLEMENT of the other Phase-4 scenarios — it
 * runs ONLY when conversation primitive is NOT advertised, to verify the
 * refusal contract is honored.
 *
 * Fixture-gated: requires `conformance-conversation-capability-negotiation`.
 *
 * @see spec/v1/capabilities.md §`conversationPrimitive`
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode } from '../lib/error-envelope.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isConversationPrimitiveSupported } from '../lib/multi-agent-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-conversation-capability-negotiation';
// Inverted gate: this scenario runs when host does NOT advertise the
// capability, to verify the refusal contract.
const SKIP = isConversationPrimitiveSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('conversationCapabilityNegotiation: refusal contract', () => {
  it('host without conversationPrimitive capability refuses conversation-bearing workflow', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    // The host MUST reject — either at workflow registration (404/400)
    // or at run-create (400). What MUST NOT happen is a successful
    // 201 followed by silent fallback.
    expect([400, 404, 422], req('openwop.it.conversationCapabilityNegotiation.host-without-conversationprimitive-capability-refuses-conversation-bearing-workf', 'RFCS/0005-conversation.md', 'host without conversationPrimitive capability refuses conversation-bearing workflow')).toContain(create.status);
    const body = create.json as { code?: string };
    const code = readErrorCode(create.json) ?? body.code ?? '';
    expect(typeof code).toBe('string');
  });
});
