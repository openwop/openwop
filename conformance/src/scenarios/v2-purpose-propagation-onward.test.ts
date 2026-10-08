/**
 * v2 — purpose labels on the onward hop (`spec/v2/core/security-defaults.md`
 * §Onward hops; suite 2.45.23, target major 2; relay path suite 2.45.29).
 *
 * A host advertising `purposePropagation` MUST re-emit a `permittedPurposes`
 * label it received on every onward hop of the same data, narrowing and never
 * widening, and MUST treat `[]` as no onward use. The suite plays both ends.
 *
 * Two ways in, the first preferred:
 *
 *   relay   normative operations only. The suite sends an A2A `SendMessage`,
 *           labelled with `metadata.openwop.permittedPurposes`, to the agent whose
 *           card routes the fixture `conformance-purpose-relay` (found through
 *           `GET /agents` and `GetExtendedAgentCard`, `interop.md` §Per-agent
 *           cards). The fixture relays the message's text to the suite's shared
 *           fake A2A peer, which reads the onward label. A nonce in the text
 *           matches each onward message to its inbound one.
 *   seam    the §22 `invoke` seam takes `permittedPurposes` and a peer URL.
 *
 *   onward-reemit-no-widen   the onward message carries the label, a subset of
 *                            the one received;
 *   empty-no-onward          with `[]` nothing reaches the peer, while an
 *                            unlabelled control message does (non-arrival is
 *                            evidence, not a dead pipe).
 *
 * Not here: a merge of labelled inputs carrying their intersection is RFC 0128
 * §3 text that v2 prose does not state.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `purposePropagation` absent,
 * `propagatesOnward` false or `a2a` absent ⇒ `inapplicable`; neither the relay
 * (`a2a-1.0` + `agentCards` + the fixture advertised) nor the seams profile ⇒
 * `inapplicable`; the fixture advertised but no card routing it, or the suite's
 * fake peer not running ⇒ `blocked`; seam unwired ⇒ `seamAbsent`. Each note names
 * the path used.
 *
 * @see spec/v2/core/security-defaults.md §Onward hops
 * @see conformance/fixtures.md §conformance-purpose-relay
 * @see spec/v1/host-sample-test-seams.md §22
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { SEAMS_PREFIX, seamsProfileAdvertised } from '../lib/seams.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { A2AFakePeer, getA2AFakePeer, type A2APeerInvocation } from '../lib/a2a-fake-peer.js';
import { relaysOf, labelOf, judgeReemit, judgeEmpty, type PeerSend } from '../lib/purpose-relay-witness.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A client calls the suite's fake A2A peer";

const DOC = 'spec/v2/core/security-defaults.md §Onward hops';
const ID_REEMIT = 'openwop.requirement.purpose-propagation.onward-reemit-no-widen';
const ID_EMPTY = 'openwop.requirement.purpose-propagation.empty-no-onward';
const SEAM = `${SEAMS_PREFIX}/sample/a2a/invoke`;
const RELAY = 'conformance-purpose-relay';
const LABEL = ['openwop-conformance-analytics', 'openwop-conformance-support'];

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

type Skip = { kind: 'blocked' | 'inapplicable' | 'seam'; reason: string };
const skip = (s: Skip): undefined => (s.kind === 'seam' ? seamAbsent(s.reason) : softSkip(s.kind, s.reason));

/** The relay agent: the host's JSONRPC 1.0 interface and the agent's routing value. */
interface Relay { kind: 'relay'; rpcUrl: string; tenant: string; peer: A2AFakePeer }
type Path = Relay | { kind: 'seam' };

async function rpc(url: string, method: string, params: unknown): Promise<{ status: number; result?: Record<string, unknown>; error?: unknown } | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': '1.0' };
  const key = process.env['OPENWOP_API_KEY'];
  if (key) headers['authorization'] = `Bearer ${key}`;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params }) });
    const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: unknown };
    return { status: res.status, ...(body.result !== undefined ? { result: body.result } : {}), ...(body.error !== undefined ? { error: body.error } : {}) };
  } catch {
    return null;
  }
}

/** Find the agent whose card routes the relay fixture; a Skip when the relay cannot be driven. */
async function relayPath(a2a: Record<string, unknown>): Promise<Relay | Skip> {
  const peer = getA2AFakePeer();
  if (peer === null) return { kind: 'blocked', reason: `relay path: the host advertises ${RELAY}, whose onward peer is the suite's fake A2A peer, and OPENWOP_A2A_FAKE_PEER is not enabled` };
  const cardUrl = a2a['agentCardUrl'];
  if (typeof cardUrl !== 'string') return { kind: 'blocked', reason: 'relay path: a2a.agentCardUrl is not advertised' };
  const card = await fetch(cardUrl, { headers: { accept: 'application/json', 'A2A-Version': '1.0' } }).then((r) => r.json() as Promise<{ supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }> }>).catch(() => null);
  const rpcUrl = card?.supportedInterfaces?.find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0')?.url;
  if (typeof rpcUrl !== 'string') return { kind: 'blocked', reason: `relay path: the public card at ${cardUrl} lists no JSONRPC 1.0 interface` };
  const inv = await http(() => driver.get('/agents'));
  const agents = inv?.status === 200 ? ((inv.json as { agents?: Array<{ a2aTenant?: unknown }> } | undefined)?.agents ?? []) : [];
  for (const a of agents) {
    if (typeof a.a2aTenant !== 'string') continue;
    const c = await rpc(rpcUrl, 'GetExtendedAgentCard', { tenant: a.a2aTenant });
    const skills = (c?.result?.['skills'] as Array<{ id?: unknown }> | undefined) ?? [];
    if (skills.length === 1 && skills[0]?.id === RELAY) return { kind: 'relay', rpcUrl, tenant: a.a2aTenant, peer };
  }
  return { kind: 'blocked', reason: `relay path: the host advertises ${RELAY}, but no agent in the caller's GET /agents has a card whose only skill is ${RELAY}` };
}

async function gate(): Promise<Path | Skip> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable' };
  const pp = await familyAdvertised('purposePropagation');
  if (pp === null) return { kind: 'inapplicable', reason: 'the host does not advertise purposePropagation' };
  if (pp['propagatesOnward'] === false) return { kind: 'inapplicable', reason: 'purposePropagation.propagatesOnward is false — the host has no onward hop' };
  const a2a = await familyAdvertised('a2a');
  if (a2a === null) return { kind: 'inapplicable', reason: 'a2a not advertised — the onward hop observed here is the host A2A client' };
  const profiles = Array.isArray(a2a['profiles']) ? (a2a['profiles'] as unknown[]) : [];
  if (profiles.includes('a2a-1.0') && a2a['agentCards'] === true && isFixtureAdvertised(RELAY)) return relayPath(a2a);
  if (seamsProfileAdvertised(doc)) return { kind: 'seam' };
  return { kind: 'inapplicable', reason: `neither path is offered: the relay needs the a2a-1.0 profile, a2a.agentCards and the ${RELAY} fixture; the §22 invoke seam needs the seams profile` };
}

/** The message sends the peer received. */
const sends = (peer: A2AFakePeer): A2APeerInvocation[] => peer.invocations().filter((i) => i.rpcMethod === 'SendMessage' || i.rpcMethod === 'message/send');

/**
 * Cause one onward hop of `nonce`, labelled or not. Relay: an inbound SendMessage,
 * which blocks until the run is terminal (interop-map a2a SendMessage). Seam: §22.
 * Returns the onward sends carrying the nonce, or a Skip.
 */
async function cause(path: Path, peer: A2AFakePeer, nonce: string, permittedPurposes?: string[]): Promise<PeerSend[] | Skip> {
  if (path.kind === 'relay') {
    const message = { messageId: `purpose-${nonce}`, role: 'ROLE_USER', parts: [{ text: `relay ${nonce}` }], ...(permittedPurposes ? { metadata: { openwop: { permittedPurposes } } } : {}) };
    const r = await rpc(path.rpcUrl, 'SendMessage', { tenant: path.tenant, message });
    if (r === null) return { kind: 'blocked', reason: `relay path: SendMessage to ${path.rpcUrl} failed to connect` };
    if (r.status >= 400 && permittedPurposes?.length !== 0) return { kind: 'blocked', reason: `relay path: SendMessage answered HTTP ${r.status}` };
  } else {
    const res = await http(() => driver.post(SEAM, { peerUrl: peer.hostFacingEndpoint(), ...(permittedPurposes ? { permittedPurposes } : {}) }));
    if (res === null) return { kind: 'blocked', reason: `${SEAM} unreachable (fetch failed)` };
    if (res.status === 404 || res.status === 405) return { kind: 'seam', reason: `${SEAM} not mounted (${res.status}) — host-sample-test-seams.md §22` };
    // The seam's onward message carries no nonce: every send after the call is its relay.
    return sends(peer).map((i) => ({ body: i.body }));
  }
  return relaysOf(sends(peer).map((i) => ({ body: i.body })), nonce);
}

const nonce = (): string => `n-${randomBytes(6).toString('hex')}`;

describe('v2 purpose labels on the onward hop (security-defaults.md §Onward hops)', () => {
  it('a received label is re-emitted on the onward message, never widened', async () => {
    const g = await gate();
    if ('reason' in g) return skip(g);
    const peer = g.kind === 'relay' ? g.peer : new A2AFakePeer({ protocolVersions: ['1.0'] });
    if (g.kind === 'seam') await peer.start();
    try {
      const relayed = await cause(g, peer, nonce(), LABEL);
      if (!Array.isArray(relayed)) return skip(relayed);
      const sent = relayed[0];
      if (sent === undefined) return softSkip('blocked', `${g.kind} path: the labelled data never reached the suite peer, so there is no onward message to read`);
      const v = judgeReemit(LABEL, labelOf(sent.body));
      expect(v.ok ? '' : v.reason, req(ID_REEMIT, DOC, `${g.kind} path: the onward message MUST carry the received label as metadata.openwop.permittedPurposes, never widened`)).toBe('');
    } finally {
      if (g.kind === 'seam') await peer.stop();
    }
  });

  it('an empty label means no onward call, while an unlabelled control call goes through', async () => {
    const g = await gate();
    if ('reason' in g) return skip(g);
    const peer = g.kind === 'relay' ? g.peer : new A2AFakePeer({ protocolVersions: ['1.0'] });
    if (g.kind === 'seam') await peer.start();
    try {
      const control = await cause(g, peer, nonce());
      if (!Array.isArray(control)) return skip(control);
      const before = sends(peer).length;
      const empty = await cause(g, peer, nonce(), []);
      if (!Array.isArray(empty)) return skip(empty);
      // The seam's sends carry no nonce: count what arrived after the control.
      const emptyRelays = g.kind === 'seam' ? sends(peer).length - before : empty.length;
      const v = judgeEmpty(control.length, emptyRelays);
      if (v === 'blocked') return softSkip('blocked', `${g.kind} path: the unlabelled control message reached no peer, so a missing call under [] would prove nothing`);
      expect(v.ok ? '' : v.reason, req(ID_EMPTY, DOC, `${g.kind} path: a host MUST treat [] as no onward use`)).toBe('');
    } finally {
      if (g.kind === 'seam') await peer.stop();
    }
  });
});
