/**
 * Multi-party group conversation — behavioral leg (RFC 0101 §Conformance).
 *
 * Gated on `capabilities.multiPartyConversation.supported` (root-first per RFC
 * 0073, via `isMultiPartyConversationSupported()`). Soft-skips when unadvertised
 * (default) / hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true` via `behaviorGate`.
 * The companion always-on wire-shape coverage lives in
 * `multi-party-conversation-shape.test.ts`; THIS scenario asserts host BEHAVIOR
 * — the cross-field / runtime MUSTs JSON Schema cannot express.
 *
 * RFC 0101 standardizes the multi-party *shape* but mints NO normative client
 * wire-route to OPEN a conversation (opening / turn order / rounds are
 * non-normative product policy). The driver therefore initiates a council + submits
 * turns via the conformance-only seam `POST /v1/host/sample/conversation/multi-party/
 * {open,exchange}` (`host-sample-test-seams.md`), which routes through the SAME
 * roster-membership + attribution enforcement the host applies in production. The
 * seam is OPTIONAL — the scenario soft-skips on `404`/`405` (a capability-advertising
 * host whose enforcement is bound to a product flow witnesses instead via its own
 * host-side test + an `INTEROP-MATRIX.md` row, the RFC 0086 dual-staging).
 *
 * Behavioral MUSTs asserted (RFC 0101 §Spec):
 *   1. POSITIVE — a 3-agent council opens and a roster-valid, attributed agent
 *      turn (role:'agent' + in-roster speakerId) is accepted.
 *   2. ATTRIBUTION — a role:'agent' turn missing `speakerId` is rejected with
 *      `validation_error` (§Spec item 2).
 *   3. MEMBERSHIP — a turn whose `speakerId` is NOT in the declared roster is
 *      rejected with `validation_error` (§Spec item 3 / RFC 0005 §E).
 *   4. MAXPARTICIPANTS — when the host advertises `maxParticipants`, an `open`
 *      whose roster exceeds it is rejected with `validation_error` (§Spec item 4).
 *
 * RFC 0005 §E pins the rejection *code* (`validation_error`), not the HTTP status —
 * the leg asserts on `error.code` and tolerates `400`/`422`.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0101-multi-party-group-conversation.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0005-conversation.md (§E turn-validation)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-sample-test-seams.md (multi-party seam)
 */

import { describe, it, expect } from 'vitest';
import { seamAbsent } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isMultiPartyConversationSupported } from '../lib/multi-agent-capabilities.js';
import {
  readMultiPartyCap,
  openMultiPartyConversation,
  exchangeMultiPartyTurn,
  isValidationErrorRejection,
  type SeamAgentRef,
  type SeamTurn,
} from '../lib/multiPartyConversation.js';

const PROFILE = 'openwop-multi-party-conversation';

const ROSTER: SeamAgentRef[] = [
  { agentId: 'host:advisor-cfo', name: 'CFO' },
  { agentId: 'host:advisor-cmo', name: 'CMO' },
  { agentId: 'host:advisor-cto', name: 'CTO' },
];

/** A roster-valid, attributed agent turn from a named member. */
function agentTurn(speakerId: string, turnIndex: number): SeamTurn {
  return {
    messageId: `council-q1:${turnIndex}:agent`,
    from: speakerId,
    content: 'A roster-valid attributed turn.',
    ts: 1718900000000 + turnIndex,
    role: 'agent',
    turnIndex,
    speakerId,
  };
}

describe('multi-party-conversation-behavioral (RFC 0101 §Conformance)', () => {
  it('opens a council, accepts an attributed turn, and rejects missing/non-participant/over-cap', async () => {
    const cap = await readMultiPartyCap();
    const advertised = isMultiPartyConversationSupported() || cap?.supported === true;
    if (!behaviorGate(PROFILE, advertised)) return;

    // ---- Open a 3-agent council via the conformance seam ------------------
    const convId = 'conf:multi-party:council-q1';
    const opened = await openMultiPartyConversation({ conversationId: convId, participants: ROSTER });
    if (opened.unwired) return seamAbsent('host advertises multiPartyConversation but the open-conversation seam is not wired');
    expect(
      opened.status === 200,
      driver.describe('RFC 0101 §Spec', 'a conforming 3-agent council MUST open (≤ maxParticipants)'),
    ).toBe(true);

    // ---- MUST 1: POSITIVE — a roster-valid attributed turn is accepted ----
    const ok = await exchangeMultiPartyTurn({ conversationId: convId, turn: agentTurn('host:advisor-cfo', 1) });
    if (ok.unwired) return seamAbsent('host advertises multiPartyConversation but the conversation seam is not wired');
    expect(
      ok.status === 200,
      driver.describe('RFC 0101 §Spec', "a role:'agent' turn with an in-roster speakerId MUST be accepted"),
    ).toBe(true);

    // ---- MUST 2: ATTRIBUTION — agent turn missing speakerId is rejected ---
    const missing: SeamTurn = { ...agentTurn('host:advisor-cmo', 2) };
    delete missing.speakerId;
    const missingRes = await exchangeMultiPartyTurn({ conversationId: convId, turn: missing });
    if (!missingRes.unwired) {
      expect(
        isValidationErrorRejection(missingRes),
        driver.describe('RFC 0101 §Spec (attribution MUST)', "a role:'agent' turn missing speakerId MUST be rejected with validation_error"),
      ).toBe(true);
    }

    // ---- MUST 3: MEMBERSHIP — non-participant speakerId is rejected --------
    const intruder = agentTurn('host:advisor-intruder', 3);
    const intruderRes = await exchangeMultiPartyTurn({ conversationId: convId, turn: intruder });
    if (!intruderRes.unwired) {
      expect(
        isValidationErrorRejection(intruderRes),
        driver.describe('RFC 0101 §Spec (membership MUST) / RFC 0005 §E', 'a turn whose speakerId is not in the roster MUST be rejected with validation_error'),
      ).toBe(true);
    }

    // ---- MUST 4: MAXPARTICIPANTS — over-cap open is rejected ---------------
    // Only assertable when the host advertises a maxParticipants ceiling.
    const maxP = typeof cap?.maxParticipants === 'number' ? cap.maxParticipants : undefined;
    if (typeof maxP === 'number' && maxP >= 2) {
      const overflow: SeamAgentRef[] = Array.from({ length: maxP + 1 }, (_v, i) => ({
        agentId: `host:advisor-${i}`,
      }));
      const overRes = await openMultiPartyConversation({
        conversationId: 'conf:multi-party:overflow',
        participants: overflow,
      });
      if (!overRes.unwired) {
        expect(
          isValidationErrorRejection(overRes),
          driver.describe('RFC 0101 §Spec (maxParticipants MUST)', 'an open whose roster exceeds the advertised maxParticipants MUST be rejected with validation_error'),
        ).toBe(true);
      }
    }
  });
});
