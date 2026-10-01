/**
 * A lost response is not a verdict on the host (#1829).
 *
 * `driver.request` called `fetch` with no bound. On MyndHyve's 2.45.2 cut the
 * runner's network dropped for about 9 s, the response to a discovery read
 * never arrived, and the test hung until vitest's 30 s `testTimeout`. The row
 * read `executed-fail` with 0 assertions against a host that had answered in
 * 2.6 ms.
 *
 * Two halves are pinned here: the driver bounds each request and names the
 * loss (`TransportError`), and the recorder turns an unobserved loss into
 * `blocked`. Each is proven in both directions.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REQUEST_TIMEOUT_MS, TRANSPORT_LOSS_PREFIX, TransportError, driver } from './driver.js';
import { TRANSPORT_LOSS_MARK, fileDisposition, resolveItRecord } from './scenario-disposition.js';

let stalled: Server;
let stalledUrl = '';
let closedUrl = '';

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', 'http://driver-selftest.invalid');
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  // Accepts the request and never answers: the runner's view of a dropped response.
  stalled = createServer(() => { /* never respond */ });
  await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', r));
  stalledUrl = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
  // A port nothing listens on: bind, read the port, close.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  closedUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
  await new Promise<void>((r) => probe.close(() => r()));
});
afterAll(async () => {
  stalled.closeAllConnections();
  await new Promise<void>((r) => stalled.close(() => r()));
});

describe('driver: a request is bounded and a loss is named', () => {
  it('the default bound sits below vitest\'s 30 s testTimeout', () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
    expect(TRANSPORT_LOSS_MARK).toBe(TRANSPORT_LOSS_PREFIX);
  });

  it('a host that never answers yields a timeout TransportError, not a hang', async () => {
    const started = Date.now();
    const err = await driver.get(`${stalledUrl}/.well-known/openwop?token=secret`, { timeoutMs: 150 }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    const t = err as TransportError;
    expect(t.kind).toBe('timeout');
    expect(t.message.startsWith(TRANSPORT_LOSS_PREFIX)).toBe(true);
    expect(t.message).toContain('/.well-known/openwop');
    expect(t.message).not.toContain('secret'); // the query string is dropped
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a refused connection yields a network TransportError', async () => {
    const err = await driver.get(`${closedUrl}/runs`).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('network');
  });

  it('a caller-supplied signal wins: its abort is rethrown as-is, not as a loss', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    const err = await driver.get(`${stalledUrl}/runs`, { signal: ctl.signal, timeoutMs: 10 }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeInstanceOf(TransportError);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('recorder: an unobserved transport loss is blocked, never executed-fail', () => {
  const loss = new TransportError('timeout', 'GET', 'https://host.example/.well-known/openwop', 'no response within 20000 ms').message;

  it('a failed test with 0 assertions and a transport loss records blocked', () => {
    const rec = resolveItRecord('fail', 0, undefined, null, loss, true, 'leg');
    expect(rec.disposition).toBe('blocked');
    expect(rec.detail).toContain('GET https://host.example/.well-known/openwop');
  });

  it('the same failure without the classification is executed-fail (the row #1829 saw)', () => {
    expect(resolveItRecord('fail', 0, undefined, null, 'Test timed out in 30000ms.', true, 'leg').disposition).toBe('executed-fail');
  });

  it('a transport loss after an assertion stays executed-fail', () => {
    expect(resolveItRecord('fail', 2, undefined, null, loss, true, 'leg').disposition).toBe('executed-fail');
  });

  it('an assertion failure is never excused by the rule', () => {
    expect(resolveItRecord('fail', 0, undefined, null, 'expected 404 to be 200', true, 'leg').disposition).toBe('executed-fail');
  });

  it('the file row follows: all failures lost and nothing asserted is blocked', () => {
    expect(fileDisposition(['fail', 'fail'], undefined, 0, [{ name: 'a', message: loss }, { name: 'b', message: loss }]).disposition).toBe('blocked');
  });

  it('the file row stays executed-fail when one failure is a real one, or anything was asserted', () => {
    expect(fileDisposition(['fail', 'fail'], undefined, 0, [{ name: 'a', message: loss }, { name: 'b', message: 'expected 1 to be 2' }]).disposition).toBe('executed-fail');
    expect(fileDisposition(['pass', 'fail'], undefined, 3, [{ name: 'b', message: loss }]).disposition).toBe('executed-fail');
  });
});
