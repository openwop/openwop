/**
 * The `If-None-Match` witness (RFC 0235), proven in both directions against a
 * double. Each case turns on ONE defect in an otherwise conforming double and
 * checks that exactly the legs owning that rule fail.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenWOPResponse } from './driver.js';
import { headersLeg, judgeNot2xx, matchLeg, noCacheLeg, opaque, type Get, type LegOutcome } from './if-none-match-witness.js';

type Defect = 'none' | 'byte-exact' | 'no-list' | 'no-star' | 'strong-only' | 'no-etag-on-304' | 'no-vary-on-304' | 'no-cache-suppresses' | 'always-304' | 'star-before-readability';
let defect: Defect = 'none';
const TAG = '"seq-7"';

function matches(header: string): boolean {
  if (defect === 'byte-exact') return header === TAG;
  const parts = defect === 'no-list' ? [header.trim()] : header.split(',').map((s) => s.trim());
  return parts.some((p) => (p === '*' && defect !== 'no-star') || (defect === 'strong-only' ? p === TAG : opaque(p) === opaque(TAG)));
}

const server: Server = createServer((req, res) => {
  const inm = req.headers['if-none-match'];
  const readable = req.url === '/resource';
  if (defect === 'star-before-readability' && inm === '*') { res.writeHead(304, { ETag: TAG, Vary: 'Accept-Encoding' }); res.end(); return; }
  if (!readable) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"code":"not_found"}'); return; }
  const noCache = /no-cache/i.test(String(req.headers['cache-control'] ?? ''));
  const hit = typeof inm === 'string' && !(defect === 'no-cache-suppresses' && noCache) && (defect === 'always-304' || matches(inm));
  if (hit) {
    const h: Record<string, string> = {};
    if (defect !== 'no-etag-on-304') h['ETag'] = TAG;
    if (defect !== 'no-vary-on-304') h['Vary'] = 'Accept-Encoding';
    res.writeHead(304, h); res.end(); return;
  }
  res.writeHead(200, { ETag: TAG, Vary: 'Accept-Encoding', 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});

let base = '';
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const getAt = (path: string): Get => async (headers) => {
  try {
    const r = await fetch(base + path, { headers: { ...headers } });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: null } satisfies OpenWOPResponse;
  } catch { return null; }
};

const failed = (o: LegOutcome): boolean => o.kind === 'observed' && o.findings.length > 0;

async function not2xxFails(): Promise<boolean> {
  const get = getAt('/absent');
  const plain = await get({});
  const findings: string[] = [];
  for (const sent of ['*', TAG]) {
    const c = await get({ 'If-None-Match': sent });
    findings.push(...judgeNot2xx(plain?.status ?? 0, c?.status ?? 0, sent));
  }
  return findings.length > 0;
}

async function failing(d: Defect): Promise<string[]> {
  defect = d;
  const get = getAt('/resource');
  const out: string[] = [];
  if (failed(await matchLeg(get))) out.push('match');
  const h = await headersLeg(get);
  if (failed(h)) out.push('headers');
  if (failed(await noCacheLeg(get))) out.push('no-cache');
  if (await not2xxFails()) out.push('not-2xx');
  return out;
}

describe('if-none-match-witness (RFC 0235)', () => {
  it('a conforming double passes every leg', async () => { expect(await failing('none')).toEqual([]); });
  it('byte-exact comparison fails the match leg only', async () => { expect(await failing('byte-exact')).toEqual(['match']); });
  it('no list support fails the match leg only', async () => { expect(await failing('no-list')).toEqual(['match']); });
  it('no `*` support fails the match leg only', async () => { expect(await failing('no-star')).toEqual(['match']); });
  it('strong comparison fails the match leg only', async () => { expect(await failing('strong-only')).toEqual(['match']); });
  it('a 304 without ETag fails the headers leg only', async () => { expect(await failing('no-etag-on-304')).toEqual(['headers']); });
  it('a 304 without the Vary of the 200 fails the headers leg only', async () => { expect(await failing('no-vary-on-304')).toEqual(['headers']); });
  // Node's fetch (undici) adds `Cache-Control: no-cache` to EVERY request that carries
  // `If-None-Match`, so a host that skips evaluation on no-cache fails the match leg too.
  // That is the defect MyndHyve's discovery route had (Express `req.fresh`): no fetch-based
  // client ever got a 304. The no-cache leg states the rule for clients that do not add it.
  it('skipping evaluation on no-cache fails the no-cache leg (and, under fetch, the match leg)', async () => { expect(await failing('no-cache-suppresses')).toEqual(['match', 'no-cache']); });
  it('answering 304 to every conditional fails the match leg on its negatives', async () => { expect(await failing('always-304')).toEqual(['match']); });
  it('evaluating `*` before the readability check fails the not-2xx leg only', async () => { expect(await failing('star-before-readability')).toEqual(['not-2xx']); });
  it('the headers leg is unreadable, not passed, when nothing answers 304', async () => {
    defect = 'none';
    const never: Get = async (h) => { const r = await getAt('/resource')({ ...h, 'If-None-Match': '"x"' }); return r; };
    expect((await headersLeg(never)).kind).toBe('unreadable');
  });
});
