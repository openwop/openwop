/**
 * Channel presence — behavioral leg (RFC 0110 §Conformance).
 *
 * Gated on `capabilities.channelPresence.supported` via `behaviorGate`: soft-skips when
 * unadvertised (default) / hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`. The companion
 * always-on wire-shape coverage lives in `channel-presence-shape.test.ts`; THIS scenario
 * asserts host BEHAVIOR — the runtime MUSTs JSON Schema cannot express.
 *
 * RFC 0110 carries presence over a host SSE (a held connection a conformance client can't
 * assert against), and mints no normative client route to open presence. The driver
 * therefore reads a live `channel.presence` snapshot via the conformance-only seam
 * `POST /v1/host/sample/channel-presence/snapshot` (`host-sample-test-seams.md`), which
 * routes through the SAME membership gate + the closed payload the host applies in
 * production (a transient join → snapshot, so `present` is non-vacuous). The seam is
 * OPTIONAL — the scenario soft-skips on `404`/`405`; a capability-advertising host whose
 * presence is bound to a product flow (e.g. the openwop-app channels SSE) witnesses
 * instead via its own host-side route test + an `INTEROP-MATRIX.md` row (the RFC 0086
 * dual-staging, as in `multi-party-conversation-behavioral.test.ts`).
 *
 * Behavioral MUSTs asserted (RFC 0110 §Proposal):
 *   1. SHAPE — a snapshot is the CLOSED `{ conversationId, present, typing }` (no field
 *      beyond it — the no-PII guard).
 *   2. MEMBERS-ONLY — every ref in `present`/`typing` is an opaque RFC 0041 subject ref
 *      (`user:`/`agent:`), never PII, and a subset of the channel's members.
 *   3. NON-VACUOUS — the snapshotting member appears in `present`.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0110-channel-presence.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-sample-test-seams.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'openwop-channel-presence';
const SUBJECT_REF = /^(user|agent):.+/;

interface PresenceSnapshot { conversationId: string; present: string[]; typing: string[] }

describe('channel-presence-behavioral (RFC 0110 §Conformance)', () => {
  it('a presence snapshot is the closed, members-only, non-vacuous channel.presence shape', async () => {
    const cap = await readCapabilityFamily<{ supported?: boolean }>('channelPresence');
    const advertised = cap?.supported === true;
    if (!behaviorGate(PROFILE, advertised)) return;

    const conversationId = 'conf:channel-presence:c1';
    const res = await driver.post('/v1/host/sample/channel-presence/snapshot', { conversationId, member: 'user:conformance-runner' });
    if (res.status === 404 || res.status === 405) return; // seam unwired — host witnesses via its own route test (dual-staging)

    expect(
      res.status === 200,
      driver.describe('RFC 0110 §Proposal', 'the presence snapshot seam MUST return 200 for a member'),
    ).toBe(true);
    const snap = res.json as PresenceSnapshot;

    // MUST 1 — CLOSED shape: exactly conversationId / present / typing (no PII field rides).
    expect(
      Object.keys(snap).sort().join(','),
      driver.describe('RFC 0110 §Proposal', 'channel.presence carries ONLY conversationId/present/typing (no PII)'),
    ).toBe('conversationId,present,typing');
    expect(snap.conversationId, driver.describe('RFC 0110 §Proposal', 'the snapshot echoes the conversationId')).toBe(conversationId);

    // MUST 2 — every ref is an opaque RFC 0041 subject ref (no PII).
    for (const ref of [...snap.present, ...snap.typing]) {
      expect(
        SUBJECT_REF.test(ref),
        driver.describe('RFC 0110 §Proposal / RFC 0041', `present/typing ref "${ref}" MUST be an opaque user:/agent: subject ref`),
      ).toBe(true);
    }
    // typing is a subset of present.
    for (const ref of snap.typing) {
      expect(snap.present.includes(ref), driver.describe('RFC 0110 §Proposal', 'every typing ref MUST also be present')).toBe(true);
    }

    // MUST 3 — NON-VACUOUS: the snapshotting member is present.
    expect(
      snap.present.includes('user:conformance-runner'),
      driver.describe('RFC 0110 §Proposal', 'the snapshotting member MUST appear in present (members-only, real)'),
    ).toBe(true);
  });
});
