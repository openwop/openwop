/**
 * v2 — a council's roster has an input seat and its refusals have codes
 * (RFC 0239; `spec/v2/core/conversation.md` §multiPartyConversation). Gated on
 * `multiPartyConversation` and the advertised council fixtures.
 *
 * The three roster MUSTs were witnessed only by the v1 seam
 * `/v1/host/sample/conversation/multi-party/*`. Here every leg uses normative
 * operations: run creation, the snapshot and event poll, and `resolveInterrupt`.
 *
 *   roster-carried    `conversation.opened.participants` equals the
 *                     `core.conversationGate` roster of `conformance-multi-party-council`;
 *   speaker-refused   resuming the exchange with a non-member `speakerId` is
 *                     `422 conversation_speaker_not_participant`, unconsumed (the run
 *                     still waits, no `conversation.exchanged`); a member's turn then
 *                     resolves it (the control);
 *   roster-exceeded   with `maxParticipants` below 64, creating a run of
 *                     `conformance-multi-party-council-oversize` is
 *                     `422 conversation_roster_exceeded`.
 *
 * The legs live in `lib/council-roster-witness.ts`, proven against a double in
 * `lib/council-roster-witness.test.ts`.
 *
 * Dispositions: no `multiPartyConversation`, or the fixture not advertised ⇒
 * `inapplicable`. roster-exceeded is `inapplicable` when `maxParticipants` is
 * absent or 64 or more (RFC 0239 §Decisions 4).
 *
 * @see RFCS/0239-council-roster-input.md §A–§F
 * @see spec/v2/core/conversation.md §multiPartyConversation
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { oversizeLeg, rosterLeg, speakerLeg } from '../lib/council-roster-witness.js';

const DOC = 'spec/v2/core/conversation.md §multiPartyConversation';

describe('v2 multi-party council (RFC 0239)', () => {
  it('the configured roster is carried on conversation.opened', async () => {
    const out = await rosterLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req('openwop.requirement.0239.council.roster-carried', DOC, 'a host MUST accept participants in core.conversationGate config and carry them on conversation.opened')).toBe('');
  });

  it('a turn from outside the roster is refused and left unconsumed', async () => {
    const out = await speakerLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req('openwop.requirement.0239.council.speaker-refused', DOC, 'a host MUST refuse a resumed turn whose speakerId is off the roster with conversation_speaker_not_participant, leaving the interrupt open')).toBe('');
  });

  it('an oversized roster is refused at run creation', async () => {
    const out = await oversizeLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req('openwop.requirement.0239.council.roster-exceeded', DOC, 'a host MUST refuse at run creation, never truncate, a roster over maxParticipants, with conversation_roster_exceeded')).toBe('');
  });
});
