/**
 * The suite's own destination for ONE staged outbound effect — the oracle RFC
 * 0158 §C's exactly-once claim is counted at.
 *
 * ── Why this file exists (2.37.0) ────────────────────────────────────────────
 * Two scenarios stage the SAME host seam (`POST /host/durability/kill`,
 * `mode=duplicate-delivery`) and each counted arrivals at its own copy of a
 * receiver: `v2-durability-recovery.test.ts` (`0158.duplicate-delivery`) and
 * `v2-terminal-event-once.test.ts` (`0194.terminal-once.duplicate-delivery`).
 * Both handed the seam the SAME destination — `resolveRegistrationUrl(...)`,
 * which on a tunnelled cut returns `OPENWOP_WEBHOOK_RECEIVER_URL` verbatim, a
 * byte-identical string for every caller.
 *
 * An outbound effect's Layer-2 identity is its BUSINESS identity — tenant,
 * workflow, node, request digest, and no runId (`spec/v1/idempotency.md`
 * §"Layer 2 Keying"; RFC 0150 §B). Two exercises that stage the same fixture at
 * the same URL therefore have the SAME effect identity, and a conformant host
 * MUST resolve the second one to the first one's recorded outcome instead of
 * calling out again. Measured on the v2 reference host: exercise 1 landed one
 * arrival; exercise 2, identical URL, landed ZERO and its ledger row read
 * `invocationId: "deduplicated-of:<run 1>"`.
 *
 * So whichever of the two legs vitest happened to run SECOND observed zero
 * arrivals — `blocked` on loopback, and a hard `executed-fail` on a tunnelled
 * cut, where zero deliveries must never read as a pass. Nothing about the host
 * changed between runs; only the file order did. That is a suite defect: the
 * row measured cross-exercise deduplication (correct behaviour) instead of the
 * within-exercise exactly-once RFC 0158 §C actually states.
 *
 * The fix is here rather than in either scenario, because two copies of a
 * receiver are what let the two legs collide in the first place: every
 * destination this helper mints carries a fresh NONCE in its path, so every
 * exercise has its own effect identity by construction, and each receiver
 * counts ONLY the arrivals bearing its own nonce. A stale retry aimed at a
 * shared front can no longer be counted as this exercise's second fire, and a
 * sibling leg can no longer consume this exercise's identity.
 *
 * @see spec/v1/idempotency.md §"Layer 2 Keying"
 * @see RFCS/0158-durable-execution-and-disaster-recovery-qualification.md §C
 */

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { receiverBinding, resolveRegistrationUrl } from './webhook-receiver.js';

export interface EffectArrival {
  /** The request line's path, as the host addressed it. */
  readonly path: string;
  readonly method: string;
  readonly at: number;
  /** False when the path carried some other exercise's nonce (or none). */
  readonly mine: boolean;
}

export interface EffectReceiver {
  readonly server: Server;
  /** The destination handed to the host: the public front when one is wired, else the local address. */
  readonly url: string;
  /** True when `url` is an operator-supplied public front rather than this listener's address. */
  readonly tunnelled: boolean;
  /** The local address this listener actually answers on — for failure detail. */
  readonly localUrl: string;
  /** The per-exercise nonce that makes this destination, and so this effect's identity, unique. */
  readonly nonce: string;
  /** Arrivals bearing this exercise's nonce. THE count RFC 0158 §C asks for. */
  arrivals(): number;
  /** Arrivals at this listener that belong to some other exercise — reported, never counted. */
  foreign(): number;
  all(): readonly EffectArrival[];
  close(): Promise<void>;
}

/**
 * Wait until at least one arrival is observed, or `budgetMs` elapses.
 *
 * A blind sleep measures the host's effect LATENCY, not its exactly-once
 * behaviour: on a loaded machine the one legitimate delivery can trail the
 * run's terminal status by more than a fixed window, and the row then reads
 * zero and calls a conformant host non-conformant. Waiting FOR the arrival and
 * only then waiting OUT the quiet window keeps both halves honest — the first
 * bound may be generous without weakening anything, because the assertion that
 * follows is that a SECOND arrival never comes.
 */
export async function waitForFirstArrival(rx: EffectReceiver, budgetMs: number): Promise<number> {
  const deadline = Date.now() + budgetMs;
  while (rx.arrivals() === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return rx.arrivals();
}

/**
 * Start a receiver for exactly one staged effect.
 *
 * Honours `OPENWOP_WEBHOOK_RECEIVER_PORT` so a tunnelled cut forwards here (a
 * certification cut already runs `--max-workers 1`, so the pinned port is not
 * contended). The nonce is in the PATH, never the port, so the destination is
 * distinct per exercise whether the port is pinned, ephemeral, or replaced by
 * an operator's public front.
 */
export async function startEffectReceiver(): Promise<EffectReceiver> {
  const nonce = randomBytes(9).toString('hex');
  const path = `/effect/${nonce}`;
  const seen: EffectArrival[] = [];
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    request.on('data', () => { /* drain */ });
    request.on('end', () => {
      const requestPath = request.url ?? '';
      // Matched by CONTAINMENT, not equality: a TLS-terminating front may add
      // or strip a prefix, and the nonce is what identifies the exercise.
      seen.push({ path: requestPath, method: request.method ?? '', at: Date.now(), mine: requestPath.includes(nonce) });
      res.writeHead(204);
      res.end();
    });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  await new Promise<void>((resolve) => server.listen(bindPort, binding.bind, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const localUrl = `http://${binding.advertise}:${port}${path}`;
  // The front is resolved on the ORIGIN and the nonce path appended, so the
  // per-exercise path survives a tunnel — `resolveRegistrationUrl` returns the
  // operator's value verbatim and would otherwise drop it.
  const front = resolveRegistrationUrl(`http://${binding.advertise}:${port}`);
  const url = `${front.url.replace(/\/+$/, '')}${path}`;
  return {
    server, url, localUrl, nonce, tunnelled: front.tunnelled,
    arrivals: () => seen.filter((a) => a.mine).length,
    foreign: () => seen.filter((a) => !a.mine).length,
    all: () => seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
