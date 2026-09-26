import { afterEach, describe, expect, it } from 'vitest';
import { HOST_FRONT_ENV, hostPublicOrigin } from './host-public-origin.js';

const BASE = 'http://127.0.0.1:3838';
const FRONT = 'https://host-front.example.com';
const DOC = JSON.stringify({ protocolVersions: ['2.0'], capabilities: { oauth: { credentialInterrupt: true } } });

afterEach(() => { delete process.env[HOST_FRONT_ENV]; });

describe('hostPublicOrigin — the origin a user agent reaches the host on', () => {
  it('is inert when no front is declared: the --base-url origin, and no fetch at all', async () => {
    let fetched = 0;
    const r = await hostPublicOrigin(BASE, async () => { fetched += 1; return { status: 200, text: DOC }; });
    expect(r).toEqual({ ok: true, origin: BASE, declared: false });
    expect(fetched).toBe(0);
  });

  it('is the declared front once discovery through it equals discovery over --base-url', async () => {
    process.env[HOST_FRONT_ENV] = `${FRONT}/`;
    // Same document, different key order — equality is structural.
    const reordered = JSON.stringify({ capabilities: { oauth: { credentialInterrupt: true } }, protocolVersions: ['2.0'] });
    const r = await hostPublicOrigin(BASE, async (u) => ({ status: 200, text: u.startsWith(FRONT) ? reordered : DOC }));
    expect(r).toEqual({ ok: true, origin: FRONT, declared: true });
  });

  it('a host that derives its advertised URLs from the REQUEST origin still verifies (2.39.5)', async () => {
    process.env[HOST_FRONT_ENV] = FRONT;
    // Measured shape: the loopback fetch embeds the loopback origin, the fronted one the tunnel origin.
    const doc = (origin: string): string => JSON.stringify({ protocolVersions: ['2.0'], capabilities: { a2a: { agentCardUrl: `${origin}/.well-known/agent-card.json` }, mcp: { serverUrls: [`${origin}/mcp`] } } });
    const r = await hostPublicOrigin(BASE, async (u) => ({ status: 200, text: u.startsWith(FRONT) ? doc(FRONT) : doc(BASE) }));
    expect(r).toEqual({ ok: true, origin: FRONT, declared: true });
  });

  it('a host with a public base that embeds the FRONT origin in both documents still verifies', async () => {
    process.env[HOST_FRONT_ENV] = FRONT;
    const both = JSON.stringify({ capabilities: { oauth: { connect: `${FRONT}/oauth/connect` } } });
    const r = await hostPublicOrigin(BASE, async () => ({ status: 200, text: both }));
    expect(r.ok).toBe(true);
  });

  it('SABOTAGE: a different host whose URLs differ only by origin but whose content differs is still refused', async () => {
    process.env[HOST_FRONT_ENV] = FRONT;
    const a = JSON.stringify({ protocolVersions: ['2.0'], capabilities: { a2a: { agentCardUrl: `${BASE}/card` } } });
    const b = JSON.stringify({ protocolVersions: ['2.0'], capabilities: { a2a: { agentCardUrl: `${FRONT}/card` }, extra: true } });
    const r = await hostPublicOrigin(BASE, async (u) => ({ status: 200, text: u.startsWith(FRONT) ? b : a }));
    expect(r.ok).toBe(false);
  });

  it('SABOTAGE: a front serving a different host is refused, never trusted', async () => {
    process.env[HOST_FRONT_ENV] = FRONT;
    const other = JSON.stringify({ protocolVersions: ['2.0'], capabilities: {} });
    const r = await hostPublicOrigin(BASE, async (u) => ({ status: 200, text: u.startsWith(FRONT) ? other : DOC }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/differs from the one over --base-url/);
  });

  it('a front that does not answer discovery is refused', async () => {
    process.env[HOST_FRONT_ENV] = FRONT;
    const r = await hostPublicOrigin(BASE, async (u) => ({ status: u.startsWith(FRONT) ? 502 : 200, text: DOC }));
    expect(r.ok).toBe(false);
  });

  it('a non-https or private front is rejected by the shared front validation', async () => {
    process.env[HOST_FRONT_ENV] = 'http://host-front.example.com';
    await expect(hostPublicOrigin(BASE, async () => ({ status: 200, text: DOC }))).rejects.toThrow(/MUST be https/);
    process.env[HOST_FRONT_ENV] = 'https://127.0.0.1:8443';
    await expect(hostPublicOrigin(BASE, async () => ({ status: 200, text: DOC }))).rejects.toThrow(/publicly-resolvable/);
  });
});
