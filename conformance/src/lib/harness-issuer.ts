/**
 * The suite's harness OIDC issuer, as an INSTRUMENT a host claims.
 *
 * Two major-2 scenarios need a token the host would accept, and the suite can
 * mint one only with a key it holds: `v2-oidc-id-token-audience` (RFC 0200 §D)
 * and `v2-lane-exp-only-bound` (RFC 0210 §B). The suite holds the key of exactly
 * one issuer, the one it stands up at `OPENWOP_TEST_OIDC_ISSUER_URL`.
 *
 * ── Why the gate reads the host's lane, not only the environment ────────────
 * Until 2.39.3 both files recorded `blocked` whenever the harness was not the
 * host's trust root. A PRODUCTION host MUST NOT trust a test issuer — a deployed
 * service that accepts tokens signed by a key living on a test runner has an
 * authentication bypass — so every honest production bundle advertising an
 * `oidc` or `exp-only` lane carried `blocked` rows, and RFC 0168 §E.1 makes one
 * `blocked` row deny certification bundle-wide. Measured on openwop-app
 * (ADR 0745 corpus defect 1); MyndHyve is in the same position.
 *
 * RFC 0168 §C.1 already rules on this shape for the other suite instrument a
 * host has to be configured for, the seams profile: "a scenario that finds the
 * exact advert absent records `inapplicable` — never `blocked`, which is
 * reserved for an advertised profile whose seam does not answer". The harness
 * issuer is claimed the same way, by the host's own advertisement: a lane's
 * `issuers[]` (`spec/v2/facets/auth.schema.json`) names the trust roots that
 * lane accepts. So:
 *
 *   - the lane's `issuers[]` does not name the harness URL (or no harness URL is
 *     configured) → `inapplicable`, and the reason names the issuers the host
 *     DOES trust — a fact about the host, not about the suite;
 *   - the lane names it → the host has claimed the instrument; a harness that
 *     cannot be served, or a control token the host then refuses, is `blocked`
 *     or a failure exactly as before.
 *
 * The cost, stated rather than hidden: a production bundle no longer witnesses
 * these rows at all, just as it witnesses no seam-gated row. The witness comes
 * from a cut whose lane advertises the harness issuer — the reference host, or
 * a colocated boot of the same release image.
 *
 * ── Reachability ─────────────────────────────────────────────────────────────
 * The issuer listens where the webhook receiver and the OAuth doubles do:
 * `receiverBinding()` (loopback, or `0.0.0.0` when
 * `OPENWOP_CONFORMANCE_HARNESS_HOST` says the host is in a container or on
 * another box), on `OPENWOP_CONFORMANCE_OIDC_PORT` when set, else the issuer
 * URL's own port. The URL itself is what the host was configured with and is
 * what `iss` and the discovery document carry; only the listening socket moves.
 * Before 2.39.3 the issuer bound `127.0.0.1` at the URL's port, so an issuer
 * URL naming `host.docker.internal` from a Linux container reached nothing.
 */

import { createServer, type Server } from 'node:http';
import { receiverBinding } from './webhook-receiver.js';
import type { SyntheticOIDCIssuer } from './oidc-issuer.js';

const norm = (u: string): string => u.trim().replace(/\/+$/, '');

export type HarnessClaim =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly kind: 'inapplicable'; readonly reason: string };

/**
 * Has the host claimed the harness issuer on `lane`? Pure: decided from the
 * advertised lane record and the configured harness URL.
 */
export function harnessClaimed(lane: Readonly<Record<string, unknown>>, harnessUrl: string | undefined): HarnessClaim {
  const name = String(lane['lane']);
  const issuers = Array.isArray(lane['issuers']) ? (lane['issuers'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const listed = issuers.length > 0 ? issuers.join(', ') : 'none';
  const url = harnessUrl?.trim();
  if (!url) {
    return { ok: false, kind: 'inapplicable', reason: `lane ${name} trusts ${listed}, and no harness issuer is configured (OPENWOP_TEST_OIDC_ISSUER_URL unset): the suite holds a signing key for none of the host's trust roots, so no token it mints could be accepted. A host claims the harness by listing it in the lane's issuers[] (RFC 0168 §C.1's reading for suite instruments)` };
  }
  if (!issuers.some((i) => norm(i) === norm(url))) {
    return { ok: false, kind: 'inapplicable', reason: `lane ${name} trusts ${listed}, which does not include the harness issuer ${url}: this host has not claimed the suite's issuer as a trust root (a production host must not), so the suite holds no key the host accepts. RFC 0168 §C.1's reading for suite instruments — witnessed on a cut whose lane lists the harness` };
  }
  return { ok: true, url: norm(url) };
}

/** Serve `issuer`'s discovery + JWKS for the host to fetch. Resolves to the listening server. */
export async function serveHarnessIssuer(issuer: SyntheticOIDCIssuer, url: string): Promise<Server> {
  const parsed = new URL(url);
  const pinned = Number(process.env['OPENWOP_CONFORMANCE_OIDC_PORT'] ?? '');
  const port = Number.isInteger(pinned) && pinned > 0 && pinned < 65536
    ? pinned
    : parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
  const { bind } = receiverBinding();
  const srv = createServer((r, res) => {
    if (r.url === '/.well-known/jwks.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(issuer.jwksJson); return; }
    if (r.url === '/.well-known/openid-configuration') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(issuer.discoveryJson); return; }
    res.writeHead(404); res.end();
  });
  // Two scenario files serve the one issuer URL, and vitest runs files in
  // parallel: wait for the holder to close rather than fail (each instance has
  // its own kid, so a host that cached the other file's JWKS re-fetches).
  const deadline = Date.now() + 25_000;
  for (;;) {
    const e = await new Promise<NodeJS.ErrnoException | null>((ok) => {
      const onErr = (err: NodeJS.ErrnoException): void => ok(err);
      srv.once('error', onErr);
      srv.listen(port, bind, () => { srv.off('error', onErr); ok(null); });
    });
    if (e === null) return srv;
    if (e.code !== 'EADDRINUSE' || Date.now() > deadline) throw e;
    await new Promise((ok) => setTimeout(ok, 250));
  }
}
