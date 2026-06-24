/**
 * Conversation-turn model provenance — `agent.model` (RFC 0109).
 *
 * Always-on, server-free schema-shape probe. Verifies the additive, normative
 * RFC 0109 wire facts on the published schemas:
 *
 *   1. `conversation-turn.schema.json` `agent.model` is an OPTIONAL object that
 *      validates a conforming `{ provider, model }`, REQUIRES both fields, and is
 *      CLOSED (`additionalProperties: false`) — the SR-1 secret-redaction guard:
 *      no credential / endpoint / prompt can ride in the provenance stamp.
 *   2. `agent.model` is OPTIONAL — an agent turn that omits it still validates
 *      (additive; pre-RFC-0109 producers + hosts that do not advertise).
 *   3. `capabilities.schema.json` declares the `conversationTurnModelProvenance`
 *      block with its `supported` flag, and it is closed (`additionalProperties: false`).
 *
 * The host-side MUST (a host that advertises `supported: true` MUST stamp
 * `agent.model`; one that does NOT advertise MUST omit it) is a behavioral
 * contract gated on `conversationTurnModelProvenance.supported`, landing at the
 * reference-host implementation (RFC 0109 §Conformance — same staging as RFC
 * 0101's non-participant-rejection behavioral leg). This scenario asserts the
 * wire SHAPE; the behavioral leg is gated.
 *
 * Normative references:
 *   - RFCS/0109-conversation-turn-model-provenance.md (§Proposal / §Conformance)
 *   - RFCS/0005-conversation.md (the conversation primitive this extends)
 *   - schemas/conversation-turn.schema.json (agent.model)
 *   - schemas/capabilities.schema.json (conversationTurnModelProvenance)
 *
 * @see RFCS/0109-conversation-turn-model-provenance.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('conversation-turn-model-provenance-shape: agent.model on a role:agent turn (RFC 0109 §Proposal, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const turn = ajv.compile(loadSchema('conversation-turn.schema.json'));

  const agentBase = {
    messageId: 'council-q1:1:agent',
    from: 'host:advisor-cfo',
    content: 'From a cash-runway view I would push the launch one quarter.',
    ts: 1718900000000,
    role: 'agent' as const,
    turnIndex: 1,
    speakerId: 'host:advisor-cfo',
  };

  it('an agent turn carrying a conforming agent.model { provider, model } validates', () => {
    expect(
      turn({ ...agentBase, agent: { agentId: 'advisor-cfo', model: { provider: 'anthropic', model: 'claude-opus-4-8' } } }),
      why('RFC 0109 §Proposal', "a role:'agent' turn with agent.model { provider, model } MUST validate"),
    ).toBe(true);
  });

  it('agent.model REQUIRES both provider and model', () => {
    expect(
      turn({ ...agentBase, agent: { model: { provider: 'anthropic' } } }),
      why('RFC 0109 §Proposal', 'agent.model without `model` MUST be rejected'),
    ).toBe(false);
    expect(
      turn({ ...agentBase, agent: { model: { model: 'claude-opus-4-8' } } }),
      why('RFC 0109 §Proposal', 'agent.model without `provider` MUST be rejected'),
    ).toBe(false);
  });

  it('agent.model is CLOSED — an extra key (a secret/endpoint/prompt) MUST be rejected (the SR-1 guard)', () => {
    expect(
      turn({ ...agentBase, agent: { model: { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-secret' } } }),
      why('RFC 0109 §Proposal', 'agent.model MUST forbid extra keys — no credential/endpoint/prompt rides the provenance stamp'),
    ).toBe(false);
  });

  it('agent.model is OPTIONAL — an agent turn that omits it still validates (additive, back-compat)', () => {
    expect(
      turn({ ...agentBase, agent: { agentId: 'advisor-cfo' } }),
      why('RFC 0109 §Compatibility', 'agent.model is additive — a turn without it MUST still validate'),
    ).toBe(true);
    expect(
      turn(agentBase),
      why('RFC 0109 §Compatibility', 'a turn with no agent object at all MUST still validate'),
    ).toBe(true);
  });
});

describe('conversation-turn-model-provenance-shape: capability advertisement (RFC 0109 §Conformance, server-free)', () => {
  it('capabilities.schema.json declares conversationTurnModelProvenance with supported, closed', () => {
    const caps = loadSchema('capabilities.schema.json');
    const props = caps.properties as Record<string, Record<string, unknown>>;
    const block = props.conversationTurnModelProvenance as
      | { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
      | undefined;
    expect(block, why('RFC 0109 §Conformance', 'capabilities.conversationTurnModelProvenance MUST be declared')).toBeDefined();
    expect(block?.properties?.supported, why('RFC 0109 §Conformance', 'conversationTurnModelProvenance.supported MUST be declared')).toBeDefined();
    expect(block?.required, why('RFC 0109 §Conformance', 'supported MUST be required on the block')).toContain('supported');
    expect(block?.additionalProperties, why('RFC 0109 §Conformance', 'the block MUST be closed')).toBe(false);
  });

  it('the conversationTurnModelProvenance block validates a conforming advertisement and rejects extras', () => {
    const caps = loadSchema('capabilities.schema.json');
    const block = (caps.properties as Record<string, Record<string, unknown>>).conversationTurnModelProvenance;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(block);
    expect(validate({ supported: true }), why('RFC 0109 §Conformance', 'a conforming advertisement MUST validate')).toBe(true);
    expect(validate({}), why('RFC 0109 §Conformance', 'supported is required')).toBe(false);
    expect(validate({ supported: true, unexpected: 1 }), why('RFC 0109 §Conformance', 'an extra key MUST be rejected (closed block)')).toBe(false);
  });
});
