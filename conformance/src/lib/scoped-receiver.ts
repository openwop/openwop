/**
 * A webhook receiver that owns its destination — one exercise, one identity.
 *
 * ── Why this file exists (2.37.0) ────────────────────────────────────────────
 * Five surfaces in this suite bind `OPENWOP_WEBHOOK_RECEIVER_PORT`, and on a
 * tunnelled cut four of them registered `resolveRegistrationUrl(...)`, which
 * returns `OPENWOP_WEBHOOK_RECEIVER_URL` VERBATIM — one byte-identical string
 * for every caller. `v2-bound-id-kinds`, `v2-webhook-delivery-shape`,
 * `v2-webhook-durable-delivery` and `webhook-signed-delivery` therefore pointed
 * four subscriptions at ONE destination.
 *
 * A webhook subscription is durable host-side state. It keeps delivering, and
 * RETRYING, after the file that created it has finished, so the collision is not
 * only between two live listeners — it is between an exercise and the leftovers
 * of an earlier one. Whichever receiver held the pinned port read those
 * leftovers as its own traffic, and `v2-webhook-durable-delivery` answers 500 BY
 * DESIGN for the first attempts of every delivery key, so the exercise it landed
 * on saw failures it never caused. `v2-webhook-delivery-shape`'s own
 * `startReceiver` carried a comment describing the symptom from the other end:
 * "the tunnel forwards to the PINNED port — held by the other receiver, which
 * answers 500 by design — so this file's `deliveries` stays empty, its legs
 * soft-skip, and the rows resolve `executed-pass`." A wire-shape scenario that
 * never opened a delivery body went green.
 *
 * This is the class openwop#1513 (two legs, one effect identity) and
 * openwop#1520 (many fakes, one public front) already opened. Those two supply
 * the halves, and this composes them rather than reimplementing either:
 *
 *   - ROUTING is `front-mux.ts`. Several receivers can be alive behind one
 *     front; each registers its handler under its nonce and calls `routeFronted`
 *     first, so a delivery reaches the receiver it was ADDRESSED to whichever
 *     listener happens to hold the port.
 *   - IDENTITY is here, and it is why the nonce is UNCONDITIONAL rather than
 *     `frontedEndpoint`'s "only when this fake does not own the pinned port".
 *     Routing alone does not close a webhook: a bare front is one identity
 *     shared ACROSS TIME, so a retry aimed at a finished exercise arrives
 *     indistinguishable from this one's traffic. With the nonce always present
 *     that retry addresses a nonce this listener does not serve, `routeFronted`
 *     answers it 404, and it is counted as `foreign()` — never as a delivery.
 *
 * What this does NOT do is relax any gate. The destination is still the
 * operator's own front or loopback; `resolvePublicFront` still refuses a
 * non-https or private front; `receiverBinding` still binds loopback unless the
 * operator declared otherwise. Only the PATH changed.
 *
 * @see lib/front-mux.ts (routing), lib/effect-receiver.ts (the same nonce idea
 *      for an outbound effect's Layer-2 identity)
 */

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { FRONT_MUX_PREFIX, registerBehindFront, routeFronted, unregisterBehindFront, withoutFrontPath } from './front-mux.js';
import { receiverBinding, resolvePublicFront } from './webhook-receiver.js';

/** The operator's public front for the suite's webhook receiver. */
export const WEBHOOK_FRONT_ENV = 'OPENWOP_WEBHOOK_RECEIVER_URL';

type HeaderBag = Record<string, string | string[] | undefined>;

/** One request addressed to THIS exercise. */
export interface ScopedHit {
  /** The path as this receiver sees it — the `/fx/<nonce>` prefix already stripped. */
  readonly path: string;
  readonly method: string;
  readonly headers: HeaderBag;
  readonly body: string;
}

export interface ScopedReceiver {
  readonly server: Server;
  /**
   * The destination to REGISTER with the host: the public front when one is
   * wired, else this listener's own address — this exercise's nonce path
   * appended either way.
   */
  readonly url: string;
  readonly tunnelled: boolean;
  /** The local address this listener actually answers on — for failure detail. */
  readonly localUrl: string;
  /** What makes this exercise's destination, and so its subscription, its own. */
  readonly nonce: string;
  /** The port this listener bound — the pinned one when the operator pinned it. */
  readonly port: number;
  /**
   * Requests that reached this listener bearing some OTHER exercise's nonce, or
   * none at all. Reported so a scenario can say WHY it saw nothing; never handed
   * to the scenario's recorder.
   */
  foreign(): number;
  close(): Promise<void>;
}

/**
 * Start a receiver for exactly one exercise.
 *
 * `respond` is called ONLY for this exercise's own requests, and sees the path
 * with the nonce prefix stripped — exactly what it would see on a listener of
 * its own. It owns the response.
 */
/**
 * The listener behind every scoped receiver.
 *
 * On a public cut the operator PINS the receiver port (`OPENWOP_WEBHOOK_RECEIVER_PORT`,
 * the one the front forwards to), so every receiver alive at once must share ONE
 * server on it: routing is already per-nonce (`routeFronted`), so the listener
 * only has to exist. Until 2.39.3 each receiver bound the pinned port itself; a
 * second concurrent receiver hit EADDRINUSE with no `error` listener attached,
 * its `listen` promise never settled, and the leg hung to vitest's timeout — the
 * three `v2-a2a-push-delivery` legs lost on the 2.39.0 and 2.39.2 public cuts.
 * Loopback runs bind ephemeral ports, which is why no rehearsal ever showed it.
 *
 * Unpinned, each receiver keeps a listener of its own (ephemeral port).
 */
interface Listener { server: Server; port: number; origin: string; members: Set<Member>; refs: number }
interface Member { nonce: string; foreign: number }
const sharedByPort = new Map<string, Promise<Listener>>();

function handlerFor(members: Set<Member>) {
  return (request: IncomingMessage, res: ServerResponse): void => {
    // Counted BEFORE routing, per live receiver: `routeFronted` answers an
    // unknown nonce itself and cannot report that it did, and a request that is
    // not an exercise's own must still be visible in that exercise's failure detail.
    const path = withoutFrontPath(WEBHOOK_FRONT_ENV, request.url ?? '/');
    for (const m of members) if (!path.startsWith(`${FRONT_MUX_PREFIX}${m.nonce}`)) m.foreign += 1;
    if (routeFronted(WEBHOOK_FRONT_ENV, request, res)) return;
    // Not an `/fx/` path at all: a stranger, or a host that dropped the path it
    // was given. Answered, never recorded — a receiver that counts what it was
    // not addressed to is the defect this helper exists to remove.
    request.resume();
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'this receiver serves one conformance exercise; address its nonce path' }));
  };
}

async function listen(port: number, binding: { bind: string; advertise: string }): Promise<Listener> {
  const members = new Set<Member>();
  const server = createServer(handlerFor(members));
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(new Error(`scoped receiver could not bind ${binding.bind}:${port} — ${err.message}. A pinned OPENWOP_WEBHOOK_RECEIVER_PORT must be free for this process (another process holds it?)`));
    };
    server.once('error', onError);
    server.listen(port, binding.bind, () => { server.off('error', onError); resolve(); });
  });
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('receiver address unavailable');
  return { server, port: addr.port, origin: `http://${binding.advertise}:${addr.port}`, members, refs: 0 };
}

function shut(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    // A keep-alive socket held open through a tunnel must not keep close() pending.
    (server as Server & { closeIdleConnections?: () => void }).closeIdleConnections?.();
    server.close(() => resolve());
    (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  });
}

export async function startScopedReceiver(
  respond: (hit: ScopedHit, res: ServerResponse) => void,
): Promise<ScopedReceiver> {
  const nonce = randomBytes(9).toString('hex');
  const own = (request: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      respond(
        {
          path: request.url ?? '/',
          method: request.method ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        },
        res,
      );
    });
  };
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const isPinned = Number.isInteger(pinned) && pinned > 0 && pinned < 65536;
  const binding = receiverBinding();
  let listener: Listener;
  let key: string | undefined;
  if (isPinned) {
    key = `${binding.bind}:${pinned}`;
    let p = sharedByPort.get(key);
    if (!p) {
      p = listen(pinned, binding);
      sharedByPort.set(key, p);
      p.catch(() => { if (sharedByPort.get(key!) === p) sharedByPort.delete(key!); });
    }
    listener = await p;
  } else {
    listener = await listen(0, binding);
  }
  const member: Member = { nonce, foreign: 0 };
  listener.members.add(member);
  listener.refs += 1;
  registerBehindFront(WEBHOOK_FRONT_ENV, nonce, own);
  const front = resolvePublicFront(WEBHOOK_FRONT_ENV, listener.origin);
  let closed = false;
  return {
    server: listener.server,
    url: `${front.url.replace(/\/+$/, '')}${FRONT_MUX_PREFIX}${nonce}`,
    tunnelled: front.tunnelled,
    localUrl: `${listener.origin}${FRONT_MUX_PREFIX}${nonce}`,
    nonce,
    port: listener.port,
    foreign: () => member.foreign,
    close: async () => {
      if (closed) return;
      closed = true;
      unregisterBehindFront(WEBHOOK_FRONT_ENV, nonce);
      listener.members.delete(member);
      listener.refs -= 1;
      if (listener.refs > 0) return;
      if (key !== undefined && sharedByPort.get(key) !== undefined) sharedByPort.delete(key);
      await shut(listener.server);
    },
  };
}

/**
 * A destination for an exercise that must REGISTER a subscription but wants no
 * delivery — the mint leg of `v2-bound-id-kinds`, say, which needs a 201 and a
 * bound id and nothing else.
 *
 * Such a leg still has to honour the operator's front, or its registration is
 * refused by an SSRF guard doing its job and the leg records `blocked` on every
 * public cut. But handing it the front VERBATIM gives it the same identity as
 * every other exercise, and a subscription is live from the 201 until the
 * DELETE: anything the host fans out in that window lands on whichever listener
 * holds the port and is read as that exercise's traffic.
 *
 * So it gets a nonce too. No receiver serves it, which is the point: a delivery
 * to this destination is answered 404 by whichever scoped receiver owns the
 * port rather than being absorbed into that exercise's record.
 */
export function unservedDestination(fallbackUrl: string): { url: string; tunnelled: boolean; nonce: string } {
  const nonce = randomBytes(9).toString('hex');
  const front = resolvePublicFront(WEBHOOK_FRONT_ENV, fallbackUrl);
  return {
    url: `${front.url.replace(/\/+$/, '')}${FRONT_MUX_PREFIX}${nonce}`,
    tunnelled: front.tunnelled,
    nonce,
  };
}

/**
 * Why a scoped receiver saw NO request of its own — the cause a `blocked` row
 * must name (RFC 0148 §A: anything other than `executed-pass` MUST say why).
 *
 * A zero here is not by itself evidence that the host failed to deliver, and
 * `foreign()` is what tells the two apart:
 *
 *   - `foreign() > 0` — traffic DID reach this listener, addressed to another
 *     nonce or to no nonce at all. The path between the host and this process
 *     works, so "the host did not deliver" is not what was observed; what was
 *     observed is that nothing arrived under THIS exercise's identity. That is
 *     unmeasured, not unmet, and callers record `blocked`.
 *   - `foreign() === 0` — nothing reached this listener at all. That is still
 *     ambiguous (a front not wired to this process, or a host that never called
 *     out), and callers keep whichever disposition the leg already carried; this
 *     function only supplies the sentence that says which address was in play.
 *
 * Either way the record names the observation rather than a conclusion, so a
 * reader can act on it without hand-probing production.
 */
export function noDeliveryCause(rx: ScopedReceiver, what = 'delivery'): string {
  const where = rx.tunnelled
    ? `the registered destination is the public front ${rx.url} (${WEBHOOK_FRONT_ENV}) and this listener answers on ${rx.localUrl}, port ${rx.port}`
    : `the registered destination is this listener at ${rx.url}, port ${rx.port}`;
  const strangers = rx.foreign();
  if (strangers > 0) {
    return `no ${what} bearing this exercise's nonce ${rx.nonce} arrived, but ${strangers} request(s) DID reach this listener addressed elsewhere — so the path from the host to this process works and the absence is of this exercise's identity, not of traffic (${where})`;
  }
  return `no ${what} bearing this exercise's nonce ${rx.nonce} arrived, and nothing else reached this listener either — ${where}`;
}

/**
 * True when a zero observation is provably NOT a verdict about the host: other
 * traffic reached this listener, so the absence is of this exercise's identity
 * rather than of delivery. Callers record `blocked` (which denies certification
 * exactly as a failure does, RFC 0168 §E.1) instead of convicting the host.
 */
export function absenceIsUnmeasured(rx: ScopedReceiver): boolean {
  return rx.foreign() > 0;
}
