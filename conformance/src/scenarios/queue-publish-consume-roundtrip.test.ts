/**
 * queue-publish-consume-roundtrip — RFC 0017 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0017 promoted to
 * `Active` 2026-05-17. The matching `capabilities.queueBus` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: publish + consume + ack roundtrip.
 *
 * @see RFCS/0017-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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

describe('queue-publish-consume-roundtrip: advertisement shape (RFC 0017)', () => {
  it('capabilities.queueBus is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early (host doesn\'t advertise — skip)'); // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      req('openwop.it.queue-publish-consume-roundtrip.capabilities-queuebus-is-either-absent-or-a-well-formed-object', 
        'capabilities.schema.json §queueBus',
        'capabilities.queueBus.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'queueBus', op, args });
}

describe('queue-publish-consume-roundtrip: behavioral (RFC 0017 §B point 2)', () => {
  it('publish → consume returns the same payload + subject', async () => {
    const probe = await call('consume', { subject: '__probe__' });
    if (probe.status === 404) return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam not exposed) (seam, prior step, or fixture unavailable)'); // seam not exposed
    const subject = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = { event: 'order.created', orderId: 42 };
    const pub = await call('publish', { subject, payload });
    expect(pub.status).toBe(200);

    const got = await call('consume', { subject });
    expect(got.status).toBe(200);
    const body = got.json as { found?: boolean; subject?: string; payload?: unknown; deliveryToken?: string };
    expect(body.found, req('openwop.it.queue-publish-consume-roundtrip.publish-consume-returns-the-same-payload-subject', 'RFC 0017 §B point 2', 'consume MUST find the just-published message')).toBe(true);
    expect(body.subject).toBe(subject);
    expect(
      body.payload,
      req('openwop.it.queue-publish-consume-roundtrip.publish-consume-returns-the-same-payload-subject', 'RFC 0017 §B point 2', 'consume MUST return the exact published payload'),
    ).toEqual(payload);
    expect(typeof body.deliveryToken, req('openwop.it.queue-publish-consume-roundtrip.publish-consume-returns-the-same-payload-subject', 'RFC 0017 §B point 2', 'consume MUST return a deliveryToken for ack/nack')).toBe('string');
  });

  it('ack removes the message; subsequent consume on empty queue returns found:false', async () => {
    const probe = await call('consume', { subject: '__probe__' });
    if (probe.status === 404) return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (seam, prior step, or fixture unavailable)');
    const subject = `q-ack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await call('publish', { subject, payload: { v: 1 } });
    const got = await call('consume', { subject });
    const deliveryToken = (got.json as { deliveryToken?: string }).deliveryToken;
    const ackRes = await call('ack', { deliveryToken });
    expect(ackRes.status).toBe(200);
    expect((ackRes.json as { acked?: boolean }).acked).toBe(true);

    const empty = await call('consume', { subject });
    const emptyBody = empty.json as { found?: boolean };
    expect(
      emptyBody.found,
      req('openwop.it.queue-publish-consume-roundtrip.ack-removes-the-message-subsequent-consume-on-empty-queue-returns-found-false', 'RFC 0017 §B point 2', 'consume after ack MUST surface as found:false'),
    ).toBe(false);
  });
});
