/**
 * v2 — purpose labels on the onward hop (`spec/v2/core/security-defaults.md`
 * §Onward hops; suite 2.45.23, target major 2; seam-gated).
 *
 * A host advertising `purposePropagation` MUST re-emit a `permittedPurposes`
 * label it received on every onward hop of the same data, narrowing and never
 * widening, and MUST treat `[]` as no onward use. The v1 twin read a
 * self-reported forward seam; this file observes a real onward hop instead.
 * The suite plays both ends: it hands the host a label through the §22 `invoke`
 * seam (`permittedPurposes`), and its fake A2A peer receives what the host's
 * production A2A client actually sends.
 *
 *   onward-reemit-no-widen   the onward message carries
 *                            `metadata.openwop.permittedPurposes`, a subset of
 *                            the label sent;
 *   empty-no-onward          with `[]` the host makes no onward call, while an
 *                            unlabelled control call through the same seam
 *                            reaches the peer (non-arrival is evidence, not a
 *                            dead pipe).
 *
 * Not here: the derived-output rule (a merge of labelled inputs carries their
 * intersection) needs two inputs on one hop; the seam forwards one.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `purposePropagation` absent,
 * `propagatesOnward` false, `a2a` absent or no seams profile ⇒ `inapplicable`;
 * seam unwired ⇒ `seamAbsent`.
 *
 * @see spec/v2/core/security-defaults.md §Onward hops
 * @see spec/v1/host-sample-test-seams.md §22
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { SEAMS_PREFIX, seamsProfileAdvertised } from '../lib/seams.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { A2AFakePeer, type A2APeerInvocation } from '../lib/a2a-fake-peer.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A client calls the suite's fake A2A peer";

const DOC = 'spec/v2/core/security-defaults.md §Onward hops';
const ID_REEMIT = 'openwop.requirement.purpose-propagation.onward-reemit-no-widen';
const ID_EMPTY = 'openwop.requirement.purpose-propagation.empty-no-onward';
const SEAM = `${SEAMS_PREFIX}/sample/a2a/invoke`;
const LABEL = ['openwop-conformance-analytics', 'openwop-conformance-support'];

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

type Skip = { kind: 'blocked' | 'inapplicable' | 'seam'; reason: string };
const skip = (s: Skip): undefined => (s.kind === 'seam' ? seamAbsent(s.reason) : softSkip(s.kind, s.reason));

async function gate(): Promise<Skip | null> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable' };
  const pp = await familyAdvertised('purposePropagation');
  if (pp === null) return { kind: 'inapplicable', reason: 'the host does not advertise purposePropagation' };
  if (pp['propagatesOnward'] === false) return { kind: 'inapplicable', reason: 'purposePropagation.propagatesOnward is false — the host has no onward hop' };
  if (!(await familyAdvertised('a2a'))) return { kind: 'inapplicable', reason: 'a2a not advertised — the onward hop observed here is the host A2A client' };
  if (!seamsProfileAdvertised(doc)) return { kind: 'inapplicable', reason: 'the onward hop is driven through the §22 invoke seam — the seams profile is not advertised' };
  return null;
}

/** The message sends the peer received. */
const sends = (peer: A2AFakePeer): A2APeerInvocation[] => peer.invocations().filter((i) => i.rpcMethod === 'SendMessage' || i.rpcMethod === 'message/send');

function labelOf(inv: A2APeerInvocation): unknown {
  const body = inv.body as { params?: { message?: { metadata?: { openwop?: { permittedPurposes?: unknown } } } } } | undefined;
  return body?.params?.message?.metadata?.openwop?.permittedPurposes;
}

async function invoke(peer: A2AFakePeer, permittedPurposes?: string[]): Promise<OpenWOPResponse | Skip> {
  const res = await http(() => driver.post(SEAM, { peerUrl: peer.hostFacingEndpoint(), ...(permittedPurposes ? { permittedPurposes } : {}) }));
  if (res === null) return { kind: 'blocked', reason: `${SEAM} unreachable (fetch failed)` };
  if (res.status === 404 || res.status === 405) return { kind: 'seam', reason: `${SEAM} not mounted (${res.status}) — host-sample-test-seams.md §22` };
  return res;
}

describe('v2 purpose labels on the onward hop (security-defaults.md §Onward hops — seam-gated)', () => {
  it('a received label is re-emitted on the onward message, never widened', async () => {
    const g = await gate();
    if (g) return skip(g);
    const peer = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await peer.start();
    try {
      const res = await invoke(peer, LABEL);
      if (!('status' in res)) return skip(res);
      const sent = sends(peer)[0];
      if (sent === undefined) return softSkip('blocked', `the seam answered ${res.status} and the suite peer received no message — the host's A2A client never reached it`);
      const label = labelOf(sent);
      expect(Array.isArray(label), req(ID_REEMIT, DOC, `the onward message MUST carry the received label as metadata.openwop.permittedPurposes (got ${JSON.stringify(label)})`)).toBe(true);
      const widened = (Array.isArray(label) ? label : []).filter((p) => !LABEL.includes(String(p)));
      expect(widened, req(ID_REEMIT, DOC, `the onward label MUST NOT widen the received one (${JSON.stringify(LABEL)}); it added ${JSON.stringify(widened)}`)).toEqual([]);
    } finally {
      await peer.stop();
    }
  });

  it('an empty label means no onward call, while an unlabelled control call goes through', async () => {
    const g = await gate();
    if (g) return skip(g);
    const peer = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await peer.start();
    try {
      const control = await invoke(peer);
      if (!('status' in control)) return skip(control);
      const before = sends(peer).length;
      if (before === 0) return softSkip('blocked', `the unlabelled control call answered ${control.status} but reached no peer, so a missing call under [] would prove nothing`);
      const res = await invoke(peer, []);
      if (!('status' in res)) return skip(res);
      expect(sends(peer).length - before, req(ID_EMPTY, DOC, `a host MUST treat [] as no onward use: the seam answered ${res.status}, and the peer received ${sends(peer).length - before} message(s) for the []-labelled data`)).toBe(0);
    } finally {
      await peer.stop();
    }
  });
});
