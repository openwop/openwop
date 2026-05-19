/**
 * stream-subscribe-from-beginning — RFC 0017 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0017 promoted to `Active`
 * 2026-05-17. The matching `capabilities.queueBus` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Stream subscribers with fromBeginning=true receive records published before subscription.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["queueBus"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('stream-subscribe-from-beginning: advertisement shape (RFC 0017)', () => {
  it('capabilities.queueBus is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §queueBus',
        'capabilities.queueBus.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('stream.supported is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ["stream","supported"];
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return; // optional sub-field
    expect(
      typeof sub,
      driver.describe(
        'RFC 0017 §A',
        'queueBus.stream.supported MUST be boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'queueBus', op, args });
}

describe('stream-subscribe-from-beginning: behavioral (RFC 0017 §A stream.fromBeginning)', () => {
  it('streamPublish 5 records then streamSubscribe({fromBeginning:true}) MUST surface all 5 in the snapshot', async () => {
    const probe = await call('streamSubscribe', { stream: '__probe__', fromBeginning: true });
    if (probe.status === 404) return; // seam not exposed
    const stream = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (let i = 1; i <= 5; i++) {
      const r = await call('streamPublish', { stream, record: { seq: i, value: `rec-${i}` } });
      expect(r.status).toBe(200);
    }
    const sub = await call('streamSubscribe', { stream, fromBeginning: true });
    expect(sub.status).toBe(200);
    const body = sub.json as { records?: Array<{ payload?: { seq?: number } }>; fromBeginningSnapshot?: boolean };
    expect(
      Array.isArray(body.records) && body.records.length === 5,
      driver.describe('RFC 0017 §A.stream.fromBeginning', 'subscribe with fromBeginning:true MUST return ALL records previously published on the stream'),
    ).toBe(true);
    // Order MUST be preserved (publish-order = sequential on the same stream).
    const seqs = body.records!.map((r) => r.payload?.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    expect(body.fromBeginningSnapshot).toBe(true);
  });

  it('streamSubscribe({fromBeginning:false}) MUST NOT include pre-subscribe records (live-tail semantics)', async () => {
    const probe = await call('streamSubscribe', { stream: '__probe__', fromBeginning: true });
    if (probe.status === 404) return;
    const stream = `s-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await call('streamPublish', { stream, record: { v: 'before' } });
    const sub = await call('streamSubscribe', { stream, fromBeginning: false });
    const body = sub.json as { records?: unknown[]; fromBeginningSnapshot?: boolean };
    expect(
      Array.isArray(body.records) && body.records.length === 0,
      driver.describe('RFC 0017 §A.stream.fromBeginning', 'subscribe with fromBeginning:false MUST omit pre-subscribe records'),
    ).toBe(true);
    expect(body.fromBeginningSnapshot).toBe(false);
  });
});
