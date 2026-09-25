/**
 * The driver sends the credential a scenario chose.
 *
 * Until 2.39.3 `driver.request` set `Authorization: Bearer <OPENWOP_API_KEY>`
 * AFTER spreading the caller's headers unless the caller also passed
 * `authenticated: false`. So a scenario that sent a second tenant's key (or a
 * low-scope key) as a header actually sent the owner's full key:
 * `workspace-cross-tenant-isolation-blackbox` recorded a false cross-tenant
 * leak (the "tenant B" read was the owner reading its own file, 200), and
 * `interrupt-auth-required-resume` would have recorded a false miss on the
 * low-scope 403. Measured on openwop-app's in-process lane (openwop-app #4107).
 *
 * Pinned here at the one place every scenario goes through, so a scenario
 * cannot reintroduce the defect by forgetting a flag.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const OWNER = 'owner-key-a';
const OTHER = 'tenant-b-key';

let sent: Array<Record<string, string>> = [];

beforeAll(() => {
  vi.stubEnv('OPENWOP_BASE_URL', 'http://driver-selftest.invalid');
  vi.stubEnv('OPENWOP_API_KEY', OWNER);
});
afterEach(() => { sent = []; vi.unstubAllGlobals(); });

function captureFetch(): void {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push({ ...(init.headers as Record<string, string>) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
const authOf = (h: Record<string, string>): string[] =>
  Object.entries(h).filter(([k]) => k.toLowerCase() === 'authorization').map(([, v]) => v);

describe('driver: a caller-supplied Authorization is sent as given', () => {
  it('the default credential applies when the caller names none', async () => {
    captureFetch();
    const { driver } = await import('./driver.js');
    await driver.get('/x');
    expect(authOf(sent[0]!)).toEqual([`Bearer ${OWNER}`]);
  });

  it('a caller header wins without authenticated:false, in either case, and is the ONLY credential sent', async () => {
    captureFetch();
    const { driver } = await import('./driver.js');
    await driver.get('/x', { headers: { Authorization: `Bearer ${OTHER}` } });
    await driver.post('/x', {}, { headers: { authorization: `Bearer ${OTHER}` } });
    for (const h of sent) expect(authOf(h)).toEqual([`Bearer ${OTHER}`]);
  });

  it('authenticated:false with no header sends no credential', async () => {
    captureFetch();
    const { driver } = await import('./driver.js');
    await driver.get('/x', { authenticated: false });
    expect(authOf(sent[0]!)).toEqual([]);
  });
});
