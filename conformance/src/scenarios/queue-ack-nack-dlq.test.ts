/**
 * queue-ack-nack-dlq — RFC 0017 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0017 promoted to
 * `Active` 2026-05-17. The matching `capabilities.queueBus` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: nack returns for redelivery; deadLetter routes to the configured DLQ.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["queueBus"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('queue-ack-nack-dlq: advertisement shape (RFC 0017)', () => {
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

  it('deadLetterSupported is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ["deadLetterSupported"];
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
        'queueBus.deadLetterSupported MUST be boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'queueBus', op, args });
}

describe('queue-ack-nack-dlq: behavioral (RFC 0017 §B point 2 — nack + DLQ)', () => {
  it('nack(requeue=true) → message is redelivered on next consume with deliveryCount incremented', async () => {
    const probe = await call('consume', { subject: '__probe__' });
    if (probe.status === 404) return;
    const subject = `q-nack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await call('publish', { subject, payload: { v: 'redeliver-me' } });

    const first = await call('consume', { subject });
    const firstBody = first.json as { deliveryToken?: string; payload?: unknown; deliveryCount?: number };
    expect(firstBody.deliveryCount).toBe(1);
    const nackRes = await call('nack', { deliveryToken: firstBody.deliveryToken, requeue: true });
    expect((nackRes.json as { requeued?: boolean }).requeued).toBe(true);

    const second = await call('consume', { subject });
    const secondBody = second.json as { found?: boolean; payload?: unknown; deliveryCount?: number };
    expect(
      secondBody.found,
      driver.describe('RFC 0017 §B point 2', 'nack(requeue=true) MUST make the message available to next consume'),
    ).toBe(true);
    expect(secondBody.payload).toEqual(firstBody.payload);
    expect(
      secondBody.deliveryCount,
      driver.describe('RFC 0017 §B point 2', 'redelivered message MUST have incremented deliveryCount'),
    ).toBe(2);
  });

  it('deadLetter → message appears on the <subject>.dlq subject; original subject is empty', async () => {
    const probe = await call('consume', { subject: '__probe__' });
    if (probe.status === 404) return;
    const subject = `q-dlq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await call('publish', { subject, payload: { v: 'poison' } });

    const consumed = await call('consume', { subject });
    const deliveryToken = (consumed.json as { deliveryToken?: string }).deliveryToken;
    const dlqRes = await call('deadLetter', { deliveryToken, reason: 'unparseable_payload' });
    expect((dlqRes.json as { deadLettered?: boolean }).deadLettered).toBe(true);
    const dlqSubject = (dlqRes.json as { dlqSubject?: string }).dlqSubject;
    expect(dlqSubject).toBe(`${subject}.dlq`);

    // Original subject MUST be empty now
    const originalEmpty = await call('consume', { subject });
    expect((originalEmpty.json as { found?: boolean }).found).toBe(false);

    // DLQ MUST carry the message + the deadLetterReason
    const dlqMsg = await call('consume', { subject: `${subject}.dlq` });
    const dlqBody = dlqMsg.json as { found?: boolean; payload?: { original?: unknown; deadLetterReason?: string } };
    expect(
      dlqBody.found,
      driver.describe('RFC 0017 §B point 2', 'deadLetter MUST route the message to the <subject>.dlq subject'),
    ).toBe(true);
    expect(dlqBody.payload?.deadLetterReason).toBe('unparseable_payload');
    expect(dlqBody.payload?.original).toEqual({ v: 'poison' });
  });
});
