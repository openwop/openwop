/**
 * One public front, many suite fakes — path multiplexing behind
 * `OPENWOP_A2A_FAKE_PEER_URL` / `OPENWOP_MCP_FAKE_SERVER_URL`.
 *
 * ── Why this file exists (2.37.0) ────────────────────────────────────────────
 * An operator fronts ONE listener per fixture: the tunnel forwards the public
 * https origin to the pinned `_PORT`, where `setup.ts` starts the shared fake.
 * Several scenarios also construct a fake of their OWN — pinned to a protocol
 * version the shared one does not speak (a 0.3-only peer for the floor, a
 * 2025-06-18-only server for negotiation) or just fresh — start it on an
 * ephemeral port, and hand the host `hostFacingEndpoint()`. Until 2.37.0 that
 * returned the front URL verbatim, so on a tunnelled cut the host's request
 * went through the tunnel to the SHARED fake while the scenario read its own,
 * which had seen nothing. Two consequences, both measured on the v2 reference
 * host:
 *
 *   - `0207.a2a-traceparent-carried` recorded `blocked` in every public cut
 *     ("the suite peer received no SendMessage") — the host's A2A client had
 *     reached the suite, just not the listener that was counting;
 *   - the floor and authenticated-negotiation legs passed VACUOUSLY: the
 *     refusal is forced by the seam's `peerOffersOnly` knob, and the wire check
 *     "no below-floor call reached the peer" iterated a peer nobody called.
 *
 * Loopback cuts never showed it, because each fake's local address is distinct.
 *
 * The fix is the shape openwop#1513 used for the effect receiver: a per-fake
 * NONCE in the path. A fake that does not own the pinned port is handed
 * `${front}/fx/<nonce>`; whichever fake DOES own it (every fake's handler asks
 * first) strips the prefix and dispatches to the registered instance. Every
 * fake is then reachable through the one front, and each one counts only what
 * was addressed to it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolvePublicFront } from './webhook-receiver.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The path prefix a fronted nonce lives under. Exported so a caller that mints
 * its OWN destination (`scoped-receiver.ts`, which needs the nonce
 * unconditionally rather than only when it loses the pinned port) spells the
 * path the same way `routeFronted` parses it.
 */
export const FRONT_MUX_PREFIX = '/fx/';
const PREFIX = FRONT_MUX_PREFIX;
const registry = new Map<string, Map<string, Handler>>();

function pinnedPort(portEnv: string): number {
  const n = Number(process.env[portEnv] ?? '');
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 0;
}

/** Make `handler` reachable at `${front}/fx/<nonce>` through whichever fake owns the pinned port. */
export function registerBehindFront(frontEnv: string, nonce: string, handler: Handler): void {
  let m = registry.get(frontEnv);
  if (!m) registry.set(frontEnv, (m = new Map()));
  m.set(nonce, handler);
}

export function unregisterBehindFront(frontEnv: string, nonce: string): void {
  registry.get(frontEnv)?.delete(nonce);
}

/**
 * Dispatch a request addressed to another fake's nonce. Returns true when it
 * did (the caller then does nothing else). The prefix is stripped so the
 * target sees exactly the path it would have seen on its own listener.
 */
export function routeFronted(frontEnv: string, req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  if (!url.startsWith(PREFIX)) return false;
  const rest = url.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const q = rest.indexOf('?');
  const end = slash === -1 ? (q === -1 ? rest.length : q) : q === -1 ? slash : Math.min(slash, q);
  const target = registry.get(frontEnv)?.get(rest.slice(0, end));
  if (!target) {
    // Addressed to a fake that has stopped (or never existed). Answer, never
    // fall through: handling it here would count a stranger's request.
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no suite fake is registered under this nonce' }));
    return true;
  }
  const tail = rest.slice(end);
  req.url = tail.startsWith('/') ? tail : `/${tail}`;
  target(req, res);
  return true;
}

/**
 * The address to hand the host under test. No front ⇒ the local address. A
 * front and this fake owns the pinned port ⇒ the front itself (unchanged from
 * before 2.37.0). A front and any other port ⇒ the front plus this fake's
 * nonce path, which the pinned owner routes back here.
 */
export function frontedEndpoint(frontEnv: string, portEnv: string, localUrl: string, boundPort: number, nonce: string): string {
  const front = resolvePublicFront(frontEnv, localUrl);
  if (!front.tunnelled) return localUrl;
  const base = front.url.replace(/\/+$/, '');
  return boundPort === pinnedPort(portEnv) ? base : `${base}${PREFIX}${nonce}`;
}
