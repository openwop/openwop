/**
 * Outbound notification delivery (messaging/notifyDeliverer.ts).
 *
 *   - synthetic deliverer reports accepted-but-not-delivered (no false positive)
 *   - webhook deliverer POSTs the message and reports delivered on 2xx
 *   - non-2xx / network failure degrade to not-delivered (never throws)
 */

import { describe, expect, it, vi } from 'vitest';
import {
  syntheticNotifyDeliverer,
  createWebhookNotifyDeliverer,
  type NotifyMessage,
} from '../src/messaging/notifyDeliverer.js';

const MSG: NotifyMessage = { kind: 'email', to: 'a@b.com', text: 'hi', subject: 'S', tenantId: 't1' };

describe('syntheticNotifyDeliverer', () => {
  it('accepts but does not claim delivery', async () => {
    const r = await syntheticNotifyDeliverer(MSG);
    expect(r.delivered).toBe(false);
    expect(r.provider).toBeUndefined();
    expect(r.detail).toContain('no provider configured');
  });
});

describe('createWebhookNotifyDeliverer', () => {
  it('POSTs the message and reports delivered on 2xx', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const deliver = createWebhookNotifyDeliverer('https://hook.example/notify', { fetchImpl, authHeader: 'Bearer k' });
    const r = await deliver(MSG);

    expect(r.delivered).toBe(true);
    expect(r.provider).toBe('webhook');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://hook.example/notify');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k');
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({ kind: 'email', to: 'a@b.com', text: 'hi', subject: 'S', tenantId: 't1' });
  });

  it('reports not-delivered on a non-2xx response (no throw)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 }));
    const r = await createWebhookNotifyDeliverer('https://hook.example/notify', { fetchImpl })(MSG);
    expect(r.delivered).toBe(false);
    expect(r.detail).toContain('503');
  });

  it('reports not-delivered when the webhook is unreachable (no throw)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('ECONNREFUSED'); });
    const r = await createWebhookNotifyDeliverer('https://hook.example/notify', { fetchImpl })(MSG);
    expect(r.delivered).toBe(false);
    expect(r.detail).toContain('unreachable');
  });
});
