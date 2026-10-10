/**
 * RFC 0242 — judging a `negotiation.decided` record (`spec/v2/core/interop.md`
 * §The audit event).
 *
 * Two facts the record must carry beyond RFC 0175 §D.3:
 *   - `requested`: the version the requesting side named (§A.2). Outbound the
 *     host is the requester, and the suite's fake peer saw what it asked for;
 *     inbound the suite is the requester and knows what it named.
 *   - where it lands: a negotiation with no run is a durable host event (§B.2),
 *     listed in `hostEvents.types[]` whenever an inbound surface is advertised
 *     (§B.3).
 *
 * Pure functions only, so `negotiation-record.test.ts` can prove each judge
 * fails on the defect it exists to catch.
 */

export interface Finding { readonly ok: boolean; readonly message: string }

export const EVENT = 'negotiation.decided';

interface Invocation { readonly headers: Readonly<Record<string, string>>; readonly params?: unknown }

const META_V = 'io.modelcontextprotocol/protocolVersion';

/**
 * The version the host asked a suite peer for, read from what the peer
 * received: A2A's `A2A-Version` header; MCP's `MCP-Protocol-Version` header,
 * else the `_meta` protocol version, else legacy `initialize`'s
 * `protocolVersion`. `null` when the host named none, in which case §A.2 does
 * not require `requested`.
 */
export function askedVersion(protocol: 'a2a' | 'mcp', invocations: readonly Invocation[]): string | null {
  for (const inv of invocations) {
    if (protocol === 'a2a') {
      const v = inv.headers['a2a-version'];
      if (typeof v === 'string' && v.length > 0) return v;
      continue;
    }
    const h = inv.headers['mcp-protocol-version'];
    if (typeof h === 'string' && h.length > 0) return h;
    const p = (inv.params ?? {}) as Record<string, unknown>;
    const meta = (p['_meta'] ?? {}) as Record<string, unknown>;
    if (typeof meta[META_V] === 'string') return meta[META_V] as string;
    if (typeof p['protocolVersion'] === 'string') return p['protocolVersion'] as string;
  }
  return null;
}

/** §A.2: `requested` is present and equals what was named. */
export function judgeRequested(payload: Readonly<Record<string, unknown>>, named: string): Finding {
  const got = payload['requested'];
  if (typeof got !== 'string') return { ok: false, message: `${EVENT} MUST carry requested when a version was named (named ${named}; the record has none) — RFC 0242 §A.2` };
  return got === named
    ? { ok: true, message: 'requested matches the named version' }
    : { ok: false, message: `${EVENT}.requested MUST equal the version the requesting side named: named ${named}, recorded ${got} — RFC 0242 §A.2` };
}

/** Whether discovery advertises an inbound A2A or MCP surface (§B.3's condition). */
export function inboundServed(doc: Readonly<Record<string, unknown>>): { a2a: boolean; mcp: boolean } {
  const a2a = doc['a2a'] as Record<string, unknown> | undefined;
  const mcp = doc['mcp'] as Record<string, unknown> | undefined;
  const urls = Array.isArray(mcp?.['serverUrls']) ? (mcp!['serverUrls'] as unknown[]) : [];
  return {
    a2a: typeof a2a?.['agentCardUrl'] === 'string',
    mcp: mcp !== undefined && (urls.length > 0 || mcp['serverMount'] !== undefined),
  };
}

/** §B.3: an inbound surface implies `{ type: negotiation.decided, delivery: durable }` in `hostEvents.types[]`. */
export function judgeListed(doc: Readonly<Record<string, unknown>>): Finding {
  const served = inboundServed(doc);
  const which = [served.a2a ? 'a2a.agentCardUrl' : null, served.mcp ? 'mcp.serverUrls/serverMount' : null].filter(Boolean).join(' and ');
  const he = doc['hostEvents'] as Record<string, unknown> | undefined;
  if (he === undefined) return { ok: false, message: `the host serves ${which} inbound, so it MUST advertise hostEvents listing ${EVENT} (durable) — RFC 0242 §B.3` };
  const types = Array.isArray(he['types']) ? (he['types'] as Array<Record<string, unknown>>) : [];
  const row = types.find((t) => t?.['type'] === EVENT);
  if (!row) return { ok: false, message: `the host serves ${which} inbound, so hostEvents.types[] MUST list ${EVENT} — RFC 0242 §B.3` };
  return row['delivery'] === 'durable'
    ? { ok: true, message: `${EVENT} listed durable` }
    : { ok: false, message: `${EVENT} MUST be listed with delivery durable, not ${String(row['delivery'])} — RFC 0242 §B.2` };
}

/**
 * §B.2: the host event recording one inbound exchange. `envelopes` are the
 * parsed `data:` of every `negotiation.decided` frame seen while the exchange
 * ran; the judge picks the one whose `requested` is the version the suite
 * named, so a concurrent exchange cannot satisfy it.
 */
export function judgeInboundRecord(
  envelopes: readonly Record<string, unknown>[],
  expect: { protocol: 'a2a' | 'mcp'; named: string; outcome: 'accepted' | 'refused' },
): Finding[] {
  const mine = envelopes.filter((e) => ((e['payload'] ?? {}) as Record<string, unknown>)['requested'] === expect.named
    && ((e['payload'] ?? {}) as Record<string, unknown>)['protocol'] === expect.protocol);
  if (mine.length === 0) {
    return [{ ok: false, message: `an inbound ${expect.protocol} exchange naming ${expect.named} MUST leave a ${EVENT} host event on /host/events with requested ${expect.named}; ${envelopes.length} ${EVENT} frame(s) seen, none matching — RFC 0242 §B.2, §A.2` }];
  }
  const e = mine[mine.length - 1]!;
  const p = (e['payload'] ?? {}) as Record<string, unknown>;
  const out: Finding[] = [];
  out.push(e['delivery'] === 'durable' ? { ok: true, message: 'durable' } : { ok: false, message: `the host event MUST be durable, got ${String(e['delivery'])} — RFC 0242 §B.2` });
  out.push(!('runId' in e) && !('sequence' in e) ? { ok: true, message: 'runless' } : { ok: false, message: 'a host event carries no runId or sequence — events.md §Host events' });
  out.push(p['outcome'] === expect.outcome ? { ok: true, message: 'outcome' } : { ok: false, message: `the exchange was ${expect.outcome === 'accepted' ? 'served' : 'refused'}, so the recorded outcome MUST be ${expect.outcome}, got ${String(p['outcome'])}` });
  if (expect.outcome === 'accepted') {
    out.push(typeof p['version'] === 'string' ? { ok: true, message: 'version' } : { ok: false, message: 'an accepted record names the version used — interop.md §The audit event' });
  }
  return out;
}
