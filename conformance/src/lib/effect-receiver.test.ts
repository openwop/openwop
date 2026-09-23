/**
 * The determinism guard for `0158.duplicate-delivery`, asserted WITHOUT a host.
 *
 * The defect these tests pin is not a host behaviour, so it must not need a
 * host to catch: two exercises that hand a host the same destination URL share
 * one Layer-2 effect identity (idempotency.md §"Layer 2 Keying"), and the
 * second one is then correctly deduplicated to zero invocations. The suite must
 * mint a distinct destination per exercise, and each receiver must count only
 * what was addressed to it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startEffectReceiver, waitForFirstArrival, type EffectReceiver } from './effect-receiver.js';

const open: EffectReceiver[] = [];
async function receiver(): Promise<EffectReceiver> {
  const rx = await startEffectReceiver();
  open.push(rx);
  return rx;
}

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
  delete process.env['OPENWOP_WEBHOOK_RECEIVER_URL'];
});

describe('effect-receiver — one destination per exercise', () => {
  it('mints a distinct destination for every exercise, so two exercises never share an effect identity', async () => {
    const a = await receiver();
    const b = await receiver();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain(a.nonce);
  });

  it('keeps the per-exercise path when an operator fronts the receiver with a public URL', async () => {
    process.env['OPENWOP_WEBHOOK_RECEIVER_URL'] = 'https://front.example.com/';
    const a = await receiver();
    const b = await receiver();
    // The front is one fixed string for every caller; the nonce is what keeps
    // the two destinations — and so the two effect identities — apart.
    expect(a.url).toBe(`https://front.example.com/effect/${a.nonce}`);
    expect(b.url).not.toBe(a.url);
    expect(a.tunnelled).toBe(true);
  });

  it('counts only the arrivals bearing its own nonce, and reports the rest separately', async () => {
    const a = await receiver();
    await fetch(a.localUrl, { method: 'POST' });
    await fetch(a.localUrl.replace(a.nonce, 'some-other-exercise'), { method: 'POST' });
    expect(await waitForFirstArrival(a, 5_000)).toBe(1);
    expect(a.arrivals()).toBe(1);
    expect(a.foreign()).toBe(1);
  });

  it('counts a genuine double-fire at the same destination as two', async () => {
    const a = await receiver();
    await fetch(a.localUrl, { method: 'POST' });
    await fetch(a.localUrl, { method: 'POST' });
    expect(a.arrivals()).toBe(2);
  });

  it('waitForFirstArrival returns at the budget rather than hanging when nothing lands', async () => {
    const a = await receiver();
    const started = Date.now();
    expect(await waitForFirstArrival(a, 300)).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });
});
