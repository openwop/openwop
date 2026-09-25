/**
 * The identity guard for the webhook receivers, asserted WITHOUT a host.
 *
 * The defect these tests pin is the suite's, not a host's: four scenario files
 * bound one pinned port and, behind a public front, registered ONE
 * byte-identical destination (`resolveRegistrationUrl` returns
 * `OPENWOP_WEBHOOK_RECEIVER_URL` verbatim). A webhook subscription outlives the
 * file that made it, so whichever receiver held the port read the leftovers —
 * including the 500s `v2-webhook-durable-delivery` answers BY DESIGN — as its
 * own traffic.
 *
 * So: distinct destinations per exercise, the nonce surviving a front, a
 * sibling's traffic routed to the sibling rather than recorded here, a request
 * for a FINISHED exercise refused rather than absorbed, and `foreign()` telling
 * a zero that is unmeasured from a zero that might be a verdict.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startScopedReceiver, noDeliveryCause, absenceIsUnmeasured, type ScopedReceiver } from './scoped-receiver.js';

const open: ScopedReceiver[] = [];
async function receiver(record: string[] = []): Promise<ScopedReceiver & { seen: string[] }> {
  const rx = await startScopedReceiver((hit, res) => {
    record.push(hit.path);
    res.writeHead(204);
    res.end();
  });
  open.push(rx);
  return { ...rx, seen: record };
}

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
  delete process.env['OPENWOP_WEBHOOK_RECEIVER_URL'];
});

async function post(url: string): Promise<number> {
  const res = await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  await res.text();
  return res.status;
}

describe('scoped-receiver — one destination per exercise', () => {
  it('mints a distinct destination for every exercise', async () => {
    const a = await receiver();
    const b = await receiver();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain(a.nonce);
  });

  it('keeps the per-exercise path behind a public front — the case a bare front loses', async () => {
    process.env['OPENWOP_WEBHOOK_RECEIVER_URL'] = 'https://front.example.com/';
    const a = await receiver();
    const b = await receiver();
    // This is the regression itself: before 2.37.0 both of these were the
    // front, character for character, so two subscriptions had one identity.
    expect(a.url).toBe(`https://front.example.com/fx/${a.nonce}`);
    expect(b.url).not.toBe(a.url);
    expect(a.tunnelled).toBe(true);
  });

  it('records only what was addressed to it, and routes a sibling exercise to the sibling', async () => {
    const mine: string[] = [];
    const theirs: string[] = [];
    const a = await receiver(mine);
    const b = await receiver(theirs);
    // Addressed to B, but delivered to A's listener — the shape a shared front
    // or a shared pinned port produces.
    expect(await post(`${a.localUrl.replace(`/fx/${a.nonce}`, '')}/fx/${b.nonce}/hook`)).toBe(204);
    expect(mine).toEqual([]);
    expect(theirs).toEqual(['/hook']);
    expect(a.foreign()).toBe(1);
    expect(b.foreign()).toBe(0);
  });

  it('refuses a request for an exercise that has FINISHED instead of absorbing it', async () => {
    const mine: string[] = [];
    const a = await receiver(mine);
    const b = await receiver();
    const gone = b.nonce;
    await b.close();
    open.splice(open.indexOf(b), 1);
    // A retry for a subscription an earlier leg left behind. It must not become
    // this exercise's delivery — that is how `v2-webhook-durable-delivery`'s
    // deliberate 500s landed in a sibling's budget.
    expect(await post(`${a.localUrl.replace(`/fx/${a.nonce}`, '')}/fx/${gone}/hook`)).toBe(404);
    expect(mine).toEqual([]);
    expect(a.foreign()).toBe(1);
  });

  it('refuses a request bearing no nonce at all, and counts it', async () => {
    const mine: string[] = [];
    const a = await receiver(mine);
    expect(await post(`${a.localUrl.replace(`/fx/${a.nonce}`, '')}/hook`)).toBe(404);
    expect(mine).toEqual([]);
    expect(a.foreign()).toBe(1);
  });

  it('delivers this exercise its own traffic, with the nonce prefix stripped', async () => {
    const mine: string[] = [];
    const a = await receiver(mine);
    expect(await post(`${a.localUrl}/hook?x=1`)).toBe(204);
    expect(mine).toEqual(['/hook?x=1']);
    expect(a.foreign()).toBe(0);
  });
});

describe('scoped-receiver — a zero says which zero it is', () => {
  it('is unmeasured only when other traffic DID reach the listener', async () => {
    const a = await receiver();
    expect(absenceIsUnmeasured(a)).toBe(false);
    expect(noDeliveryCause(a)).toContain('nothing else reached this listener either');
    expect(await post(`${a.localUrl.replace(`/fx/${a.nonce}`, '')}/stranger`)).toBe(404);
    expect(absenceIsUnmeasured(a)).toBe(true);
    // The sentence an operator reads in the bundle instead of hand-probing.
    expect(noDeliveryCause(a, 'run.completed attempt')).toContain('1 request(s) DID reach this listener');
    expect(noDeliveryCause(a, 'run.completed attempt')).toContain('run.completed attempt');
    expect(noDeliveryCause(a)).toContain(a.nonce);
  });

  it('names the public front rather than the local address when one is wired', async () => {
    process.env['OPENWOP_WEBHOOK_RECEIVER_URL'] = 'https://front.example.com';
    const a = await receiver();
    expect(noDeliveryCause(a)).toContain('https://front.example.com/fx/');
    expect(noDeliveryCause(a)).toContain(a.localUrl);
  });
});

describe('scoped-receiver — a front that carries a PATH (2.38.0)', () => {
  it('a delivery through a path-bearing front reaches its exercise, not "addressed elsewhere"', async () => {
    // Exactly the shape `cut-public.sh` wires: the receiver fronted at `…/hook`.
    // A tunnel forwards the whole path, so the listener sees `/hook/fx/<nonce>`.
    process.env['OPENWOP_WEBHOOK_RECEIVER_URL'] = 'https://front.example.com/hook';
    const a = await receiver();
    expect(a.url).toBe(`https://front.example.com/hook/fx/${a.nonce}`);
    const origin = a.localUrl.replace(`/fx/${a.nonce}`, '');
    const forwarded = `${origin}${new URL(a.url).pathname}`;
    expect(await post(forwarded)).toBe(204);
    expect(a.seen).toEqual(['/']);
    expect(a.foreign()).toBe(0);
  });

  it('a sibling behind the same path-bearing front is routed to the sibling', async () => {
    process.env['OPENWOP_WEBHOOK_RECEIVER_URL'] = 'https://front.example.com/hook';
    const a = await receiver();
    const b = await receiver();
    const origin = a.localUrl.replace(`/fx/${a.nonce}`, '');
    expect(await post(`${origin}/hook/fx/${b.nonce}/x`)).toBe(204);
    expect(b.seen).toEqual(['/x']);
    expect(a.seen).toEqual([]);
  });
});

describe('scoped-receiver — a PINNED port is shared, never re-bound (2.39.3)', () => {
  async function freePort(): Promise<number> {
    const { createServer } = await import('node:net');
    return new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 0)); }); });
  }
  afterEach(() => { delete process.env['OPENWOP_WEBHOOK_RECEIVER_PORT']; });

  it('two concurrent receivers on the pinned port both start, each gets its own traffic, and foreign is counted per receiver', async () => {
    const port = await freePort();
    process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] = String(port);
    const a = await receiver();
    const b = await receiver();
    expect(a.port).toBe(port);
    expect(b.port).toBe(port);
    expect(await post(`${a.localUrl}/x`)).toBe(204);
    expect(await post(`${b.localUrl}/y`)).toBe(204);
    expect(a.seen).toEqual(['/x']);
    expect(b.seen).toEqual(['/y']);
    expect(a.foreign()).toBe(1);
    expect(b.foreign()).toBe(1);
  });

  it('closing one receiver keeps its sibling serving on the shared port', async () => {
    const port = await freePort();
    process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] = String(port);
    const a = await receiver();
    const b = await receiver();
    await a.close();
    expect(await post(`${b.localUrl}/still`)).toBe(204);
    expect(b.seen).toEqual(['/still']);
    expect(await post(`${a.localUrl}/gone`)).toBe(404);
  });

  it('a pinned port another process holds REJECTS fast with a clear message instead of hanging', async () => {
    const { createServer } = await import('node:http');
    const squatter = createServer((_q, r) => { r.end(); });
    const port = await freePort();
    await new Promise<void>((ok) => squatter.listen(port, '127.0.0.1', () => ok()));
    try {
      process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] = String(port);
      const started = Date.now();
      await expect(startScopedReceiver((_h, res) => { res.end(); })).rejects.toThrow(/could not bind/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally { await new Promise<void>((ok) => squatter.close(() => ok())); }
  });
});
