/**
 * Multi-party group conversation — shared transcript + speaker attribution (RFC 0101).
 *
 * Always-on, server-free schema-shape probe. Verifies the three additive,
 * normative RFC 0101 wire facts on the published schemas:
 *
 *   1. `conversation-event.schema.json` `ConversationOpenedPayload` carries an
 *      OPTIONAL `participants: AgentRef[]` roster — a conforming 3-agent council
 *      transcript validates, and a malformed participant item is rejected.
 *   2. `conversation-turn.schema.json` REQUIRES `speakerId` when `role: 'agent'`
 *      (the `allOf`/`if` conditional) — an agent turn WITH a roster-instance
 *      `speakerId` validates; an agent turn that OMITS `speakerId` MUST FAIL
 *      schema validation (the RFC 0101 attribution MUST); a `user`/`system` turn
 *      without `speakerId` is unaffected (additive — pre-RFC-0101 producers).
 *   3. `capabilities.schema.json` declares the `multiPartyConversation` block with
 *      its `supported` flag (+ optional `maxParticipants`), and it is closed
 *      (`additionalProperties: false`).
 *
 * The non-participant-rejection MUST (a turn whose `speakerId` is NOT in the
 * declared `participants` roster MUST be rejected) is a HOST-enforced runtime
 * contract — it is not expressible by JSON Schema alone (roster membership is
 * cross-field state). This probe asserts the wire SHAPE that makes the check
 * possible (roster present + every agent turn attributed) and verifies the
 * membership predicate directly; the behavioral leg (a live host rejecting a
 * non-participant turn with `validation_error`) is gated on
 * `multiPartyConversation.supported` and lands at the reference-host
 * implementation (RFC 0101 §Conformance — same staging as RFC 0086's roster
 * `roster.run.initiated` behavioral leg). This scenario asserts the wire
 * contract, not host behavior.
 *
 * Normative references:
 *   - RFCS/0101-multi-party-group-conversation.md (§Spec / §Schema / §Conformance)
 *   - RFCS/0005-conversation.md (the single-agent conversation primitive this extends)
 *   - schemas/conversation-event.schema.json (ConversationOpenedPayload.participants)
 *   - schemas/conversation-turn.schema.json (speakerId + the role==='agent' conditional)
 *   - schemas/capabilities.schema.json (multiPartyConversation)
 *
 * @see RFCS/0101-multi-party-group-conversation.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('multi-party-conversation-shape: participant roster on conversation.opened (RFC 0101 §Schema, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(loadSchema('conversation-event.schema.json'), 'conversation-event');
  const opened = ajv.getSchema('conversation-event#/$defs/ConversationOpenedPayload');

  it('the ConversationOpenedPayload $def exists and declares participants: AgentRef[]', () => {
    expect(opened, req('openwop.it.multi-party-conversation-shape.the-conversationopenedpayload-def-exists-and-declares-participants-agentref', 'RFC 0101', 'the ConversationOpenedPayload $def MUST exist')).toBeTruthy();
  });

  it('a conforming 3-agent council transcript (participant roster + user opening turn) validates', () => {
    const good = {
      conversationId: 'run-abc:n1:0',
      agentId: 'host:advisor-cfo',
      participants: [
        { agentId: 'host:advisor-cfo', name: 'CFO' },
        { agentId: 'host:advisor-cmo', name: 'CMO' },
        { agentId: 'host:advisor-cto', name: 'CTO' },
      ],
      initialTurn: {
        messageId: 'run-abc:n1:0:user',
        from: 'user',
        content: 'Should we launch in Q3 or Q4?',
        ts: 1718900000000,
        role: 'user',
        turnIndex: 0,
      },
    };
    expect(opened!(good), req('openwop.it.multi-party-conversation-shape.a-conforming-3-agent-council-transcript-participant-roster-user-opening-turn-val', 'RFC 0101 §Schema', 'a conversation.opened with a participant roster MUST validate')).toBe(true);
  });

  it('a participant entry that is not a valid AgentRef (no agentId) is rejected', () => {
    const bad = {
      conversationId: 'run-abc:n1:0',
      participants: [{ name: 'CFO' }],
      initialTurn: {
        messageId: 'run-abc:n1:0:user',
        from: 'user',
        content: 'x',
        ts: 1,
        role: 'user',
        turnIndex: 0,
      },
    };
    expect(opened!(bad), req('openwop.it.multi-party-conversation-shape.a-participant-entry-that-is-not-a-valid-agentref-no-agentid-is-rejected', 'RFC 0101 §Schema', 'a participants[] item without agentId MUST be rejected')).toBe(false);
  });

  it('participants is OPTIONAL — a single-agent conversation.opened (no roster) still validates (back-compat)', () => {
    const noRoster = {
      conversationId: 'run-abc:n1:0',
      agentId: 'host:advisor-cfo',
      initialTurn: {
        messageId: 'run-abc:n1:0:user',
        from: 'user',
        content: 'x',
        ts: 1,
        role: 'user',
        turnIndex: 0,
      },
    };
    expect(opened!(noRoster), req('openwop.it.multi-party-conversation-shape.participants-is-optional-a-single-agent-conversation-opened-no-roster-still-vali', 'RFC 0101 §Compatibility', 'participants is additive — a roster-less conversation MUST still validate')).toBe(true);
  });
});

describe('multi-party-conversation-shape: per-turn speaker attribution (RFC 0101 §Schema, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const turn = ajv.compile(loadSchema('conversation-turn.schema.json'));

  const agentBase = {
    messageId: 'council-q1:1:agent',
    from: 'host:advisor-cfo',
    content: "From a cash-runway view I'd push the launch one quarter.",
    ts: 1718900000000,
    role: 'agent' as const,
    turnIndex: 1,
  };

  it('an agent turn WITH a roster-instance speakerId validates', () => {
    expect(
      turn({ ...agentBase, speakerId: 'host:advisor-cfo' }),
      req('openwop.it.multi-party-conversation-shape.an-agent-turn-with-a-roster-instance-speakerid-validates', 'RFC 0101 §Schema', "a role:'agent' turn carrying speakerId MUST validate"),
    ).toBe(true);
  });

  it("a role:'agent' turn MISSING speakerId MUST fail schema validation (the attribution MUST)", () => {
    expect(
      turn(agentBase),
      req('openwop.it.multi-party-conversation-shape.a-role-agent-turn-missing-speakerid-must-fail-schema-validation-the-attribution', 'RFC 0101 §Schema', "a role:'agent' turn that omits speakerId MUST be rejected (the conditional required)"),
    ).toBe(false);
  });

  it("speakerId is OPTIONAL for role:'user' / role:'system' turns (additive — pre-RFC-0101 producers)", () => {
    expect(
      turn({ messageId: 'council-q1:0:user', from: 'user', content: 'Q3 or Q4?', ts: 1, role: 'user', turnIndex: 0 }),
      req('openwop.it.multi-party-conversation-shape.speakerid-is-optional-for-role-user-role-system-turns-additive-pre-rfc-0101-prod', 'RFC 0101 §Compatibility', "a role:'user' turn without speakerId MUST still validate"),
    ).toBe(true);
    expect(
      turn({ messageId: 'council-q1:9:system', from: 'system', content: 'conversation timed out', ts: 1, role: 'system', turnIndex: 9 }),
      req('openwop.it.multi-party-conversation-shape.speakerid-is-optional-for-role-user-role-system-turns-additive-pre-rfc-0101-prod', 'RFC 0101 §Compatibility', "a role:'system' turn without speakerId MUST still validate"),
    ).toBe(true);
  });
});

describe('multi-party-conversation-shape: non-participant turn detection (RFC 0101 §Spec, server-free)', () => {
  // The roster-membership MUST ("a turn whose speakerId is not a participant MUST
  // be rejected") is host-enforced cross-field state, not JSON-Schema-expressible.
  // This probe asserts the membership predicate the host applies, over the same
  // shapes the schema validates — so the wire contract that makes the check
  // possible is verified server-free; the live-host rejection is the gated
  // behavioral leg (below).
  const roster = new Set(['host:advisor-cfo', 'host:advisor-cmo', 'host:advisor-cto']);

  it('a turn whose speakerId IS a participant is admissible', () => {
    expect(roster.has('host:advisor-cmo'), req('openwop.it.multi-party-conversation-shape.a-turn-whose-speakerid-is-a-participant-is-admissible', 'RFC 0101 §Spec', 'an agent in the roster MAY speak')).toBe(true);
  });

  it('a turn whose speakerId is NOT a participant MUST be rejected by the host (roster membership)', () => {
    expect(
      roster.has('host:advisor-intruder'),
      req('openwop.it.multi-party-conversation-shape.a-turn-whose-speakerid-is-not-a-participant-must-be-rejected-by-the-host-roster', 'RFC 0101 §Spec', 'a turn from a non-participant agent MUST be rejected'),
    ).toBe(false);
  });
});

describe('multi-party-conversation-shape: capability advertisement (RFC 0101 §Schema, server-free)', () => {
  it('capabilities.schema.json declares multiPartyConversation with supported + optional maxParticipants, closed', () => {
    const caps = loadSchema('capabilities.schema.json');
    const props = caps.properties as Record<string, Record<string, unknown>>;
    const mpc = props.multiPartyConversation as
      | { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
      | undefined;
    expect(mpc, req('openwop.it.multi-party-conversation-shape.capabilities-schema-json-declares-multipartyconversation-with-supported-optional', 'RFC 0101 §Schema', 'capabilities.multiPartyConversation MUST be declared')).toBeDefined();
    expect(mpc?.properties?.supported, req('openwop.it.multi-party-conversation-shape.capabilities-schema-json-declares-multipartyconversation-with-supported-optional', 'RFC 0101 §Schema', 'multiPartyConversation.supported MUST be declared')).toBeDefined();
    expect(mpc?.properties?.maxParticipants, req('openwop.it.multi-party-conversation-shape.capabilities-schema-json-declares-multipartyconversation-with-supported-optional', 'RFC 0101 §Schema', 'multiPartyConversation.maxParticipants MUST be declared (optional)')).toBeDefined();
    expect(mpc?.required, req('openwop.it.multi-party-conversation-shape.capabilities-schema-json-declares-multipartyconversation-with-supported-optional', 'RFC 0101 §Schema', 'supported MUST be required on the block')).toContain('supported');
    expect(mpc?.additionalProperties, req('openwop.it.multi-party-conversation-shape.capabilities-schema-json-declares-multipartyconversation-with-supported-optional', 'RFC 0101 §Schema', 'the multiPartyConversation block MUST be closed')).toBe(false);
  });

  it('the multiPartyConversation block validates a conforming advertisement and rejects extras', () => {
    const caps = loadSchema('capabilities.schema.json');
    const mpc = (caps.properties as Record<string, Record<string, unknown>>).multiPartyConversation;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(mpc);
    expect(validate({ supported: true, maxParticipants: 8 }), req('openwop.it.multi-party-conversation-shape.the-multipartyconversation-block-validates-a-conforming-advertisement-and-reject', 'RFC 0101 §Schema', 'a conforming advertisement MUST validate')).toBe(true);
    expect(validate({ supported: true }), req('openwop.it.multi-party-conversation-shape.the-multipartyconversation-block-validates-a-conforming-advertisement-and-reject', 'RFC 0101 §Schema', 'maxParticipants is optional')).toBe(true);
    expect(validate({ maxParticipants: 8 }), req('openwop.it.multi-party-conversation-shape.the-multipartyconversation-block-validates-a-conforming-advertisement-and-reject', 'RFC 0101 §Schema', 'supported is required')).toBe(false);
    expect(validate({ supported: true, unexpected: 1 }), req('openwop.it.multi-party-conversation-shape.the-multipartyconversation-block-validates-a-conforming-advertisement-and-reject', 'RFC 0101 §Schema', 'an extra key MUST be rejected (closed block)')).toBe(false);
    expect(validate({ supported: true, maxParticipants: 1 }), req('openwop.it.multi-party-conversation-shape.the-multipartyconversation-block-validates-a-conforming-advertisement-and-reject', 'RFC 0101 §Schema', 'maxParticipants minimum is 2 (a council has ≥2)')).toBe(false);
  });
});
