/**
 * v2 — `channel.presence` delivery (`spec/v2/core/conversation.md`
 * §`channelPresence`; suite 2.45.20, target major 2; seam-gated).
 *
 * v2 mints no client route that opens a channel conversation
 * (`conversation.md`), so presence is observable only through the snapshot
 * seam (`host-sample-test-seams.md` §13, `api/seams-v2.yaml`
 * `snapshotChannelPresence`). The seam transiently joins `member` and returns
 * the payload the host would deliver to `observer`, through its production
 * membership gate.
 *
 *   advertised-emits         a host advertising `channelPresence` MUST emit
 *                            `channel.presence`: a member's snapshot answers
 *                            200, validates against the closed payload, and
 *                            lists that member;
 *   non-member-not-delivered a host MUST NOT deliver it to a non-member: asked
 *                            as an outsider, the seam MUST NOT answer 200.
 *
 * Every leg asks as `member` first. A 404 there means the seam is not wired
 * (`seamAbsent`), so the outsider's 403/404 is never mistaken for an unwired
 * seam, and a refusal is never mistaken for a pass.
 *
 * Not here: cross-tenant delivery needs a second tenant's credential; the
 * suite holds one. Whether presence is logged is unresolved in the corpus
 * (`conversation.md` names it open), so no leg reads the event log.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; seams profile or
 * `channelPresence` not advertised ⇒ `inapplicable`; seam unwired ⇒
 * `seamAbsent`.
 *
 * @see spec/v2/core/conversation.md §channelPresence
 * @see spec/v1/host-sample-test-seams.md §13
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/conversation.md §channelPresence';
const ID_EMITS = 'openwop.requirement.channel-presence.advertised-emits';
const ID_NON_MEMBER = 'openwop.requirement.channel-presence.non-member-not-delivered';
const SEAM = seamPath('/v1/host/sample/channel-presence/snapshot');
const CONVERSATION = 'conf:channel-presence:delivery';
const MEMBER = 'user:conformance-runner';
const OUTSIDER = 'user:conformance-outsider';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** The gate both legs share, then the member's snapshot; a skip reason otherwise. */
async function asMember(): Promise<OpenWOPResponse | { kind: 'blocked' | 'inapplicable' | 'seam'; reason: string }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'inapplicable', reason: 'seams profile not advertised (conformance.seamsProfile) — presence is observable only through the §13 seam' };
  if (!(await familyAdvertised('channelPresence'))) return { kind: 'inapplicable', reason: 'the host does not advertise channelPresence' };
  const res = await http(() => driver.post(SEAM, { conversationId: CONVERSATION, member: MEMBER }));
  if (res === null) return { kind: 'blocked', reason: `${SEAM} unreachable (fetch failed)` };
  if (res.status === 404 || res.status === 405) return { kind: 'seam', reason: `${SEAM} not mounted (${res.status}) — host-sample-test-seams.md §13` };
  return res;
}

describe('v2 channel-presence delivery (conversation.md §channelPresence — seam-gated)', () => {
  it('a host advertising channelPresence emits it: a member receives a closed, non-vacuous snapshot', async () => {
    const m = await asMember();
    if (!('status' in m)) return m.kind === 'seam' ? seamAbsent(m.reason) : softSkip(m.kind, m.reason);
    expect(m.status, req(ID_EMITS, DOC, `a host advertising channelPresence MUST emit channel.presence; the member snapshot answered ${m.status}`)).toBe(200);
    const v = v2Validator('channel-presence-payload')(m.json);
    expect(v.ok, req(ID_EMITS, DOC, `the snapshot MUST be the closed channel.presence payload (${v.errors})`)).toBe(true);
    const present = (m.json as { present?: unknown } | null)?.present;
    expect(Array.isArray(present) && present.includes(MEMBER), req(ID_EMITS, DOC, `the joined member ${MEMBER} MUST be present (got ${JSON.stringify(present)})`)).toBe(true);
  });

  it('a host does not deliver channel.presence to a non-member', async () => {
    const m = await asMember();
    if (!('status' in m)) return m.kind === 'seam' ? seamAbsent(m.reason) : softSkip(m.kind, m.reason);
    if (m.status !== 200) return softSkip('blocked', `the member snapshot answered ${m.status}, so the seam cannot show what an outsider receives (the advertised-emits leg owns that failure)`);
    const out = await http(() => driver.post(SEAM, { conversationId: CONVERSATION, member: MEMBER, observer: OUTSIDER }));
    if (out === null) return softSkip('blocked', `${SEAM} unreachable for the outsider request (fetch failed)`);
    expect(out.status, req(ID_NON_MEMBER, DOC, `a host MUST NOT deliver channel.presence to a non-member: asked as ${OUTSIDER}, the seam answered 200 with ${out.text.slice(0, 200)}`)).not.toBe(200);
  });
});
