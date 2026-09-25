/**
 * The harness issuer is claimed by the host's lane, not assumed from the
 * environment (lib/harness-issuer.ts; RFC 0168 §C.1's reading).
 *
 * The regression this pins is a disposition: a production host whose `oidc` or
 * `exp-only` lane lists only its real IdP recorded `blocked` on the two
 * harness-issuer scenarios, and one `blocked` row denies certification
 * bundle-wide. It must record `inapplicable` naming the issuers it trusts, and
 * `blocked` must stay reachable for a host that DID claim the harness.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { harnessClaimed, serveHarnessIssuer } from './harness-issuer.js';
import { createSyntheticOIDCIssuer } from './oidc-issuer.js';

const HARNESS = 'http://127.0.0.1:18762';
const prod = { lane: 'oidc', issuers: ['https://securetoken.google.com/prod'], revocation: 'exp-only', revocationWindowSeconds: 3600 };

afterEach(() => { vi.unstubAllEnvs(); });

describe('harnessClaimed', () => {
  it('a production lane that lists only its real IdP is inapplicable, naming what it trusts, harness configured or not', () => {
    for (const env of [undefined, '', HARNESS]) {
      const c = harnessClaimed(prod, env);
      expect(c.ok).toBe(false);
      if (!c.ok) {
        expect(c.kind).toBe('inapplicable');
        expect(c.reason).toContain('https://securetoken.google.com/prod');
      }
    }
  });

  it('a lane that lists the harness issuer claims it (trailing slashes ignored on either side)', () => {
    for (const [listed, env] of [[HARNESS, HARNESS], [`${HARNESS}/`, HARNESS], [HARNESS, `${HARNESS}/`]] as const) {
      const c = harnessClaimed({ ...prod, issuers: ['https://idp.example', listed] }, env);
      expect(c).toEqual({ ok: true, url: HARNESS });
    }
  });

  it('a lane with no issuers[] claims nothing', () => {
    const c = harnessClaimed({ lane: 'oidc' }, HARNESS);
    expect(c.ok).toBe(false);
  });
});

describe('serveHarnessIssuer', () => {
  it('listens on OPENWOP_CONFORMANCE_OIDC_PORT when set, and serves the issuer the URL names', async () => {
    const issuer = createSyntheticOIDCIssuer({ issuer: 'http://harness.invalid:9', audience: 'a' });
    vi.stubEnv('OPENWOP_CONFORMANCE_OIDC_PORT', '0');
    // Port 0 is not a pin (out of range), so it falls back to the URL port; use a free pin instead.
    const probe = await serveHarnessIssuer(issuer, 'http://127.0.0.1:0');
    const free = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    vi.stubEnv('OPENWOP_CONFORMANCE_OIDC_PORT', String(free));
    const srv = await serveHarnessIssuer(issuer, 'http://harness.invalid:9');
    try {
      expect((srv.address() as { port: number }).port).toBe(free);
      const doc = await (await fetch(`http://127.0.0.1:${free}/.well-known/openid-configuration`)).json() as { issuer: string };
      expect(doc.issuer).toBe('http://harness.invalid:9');
    } finally { await new Promise<void>((r) => srv.close(() => r())); }
  });
});
