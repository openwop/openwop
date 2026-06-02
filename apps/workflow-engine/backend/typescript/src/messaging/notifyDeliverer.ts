/**
 * Outbound one-off notification delivery (email / SMS) for `/v1/host/sample/
 * messaging/notify`.
 *
 * The relay channels (signal/whatsapp/…) are delivered by an external relay
 * device pulling the queue. Email/SMS have no such device, so they were a pure
 * synthetic stub. This adds a real, pluggable delivery seam: when the host
 * configures a notification webhook, `/notify` actually POSTs the message to it
 * (a host-owned function that fronts SES / Twilio / etc.), and reports real
 * delivery. With nothing configured it falls back to the honest synthetic
 * receipt — no false "delivered".
 *
 * The deliverer is injected into the messaging routes so it is unit-testable
 * with a mock (no real network in tests).
 *
 * Trust boundary: `OPENWOP_NOTIFY_WEBHOOK_URL` is an OPERATOR-set env value (not
 * user input — no SSRF), but the POST body carries the message content +
 * recipient, so the configured endpoint must be a trusted host-owned function.
 */

import { createLogger } from '../observability/logger.js';

const log = createLogger('notifyDeliverer');

export interface NotifyMessage {
  kind: 'email' | 'sms';
  to: string;
  text: string;
  subject?: string;
  tenantId: string;
}

export interface NotifyDeliveryResult {
  /** true ⇒ a provider actually accepted the message; false ⇒ synthetic only. */
  delivered: boolean;
  /** Human-readable outcome for the API response + logs. */
  detail: string;
  /** Which provider handled it ('webhook'), absent for the synthetic fallback. */
  provider?: string;
}

export type NotifyDeliverer = (msg: NotifyMessage) => Promise<NotifyDeliveryResult>;

/** The honest default: no provider configured ⇒ accepted-but-not-delivered. */
export const syntheticNotifyDeliverer: NotifyDeliverer = async (msg) => ({
  delivered: false,
  detail: `synthetic ${msg.kind} dispatch accepted; no provider configured`,
});

/**
 * A webhook-backed deliverer: POSTs the notification JSON to `webhookUrl`
 * (a host function that fronts the real email/SMS provider). 2xx ⇒ delivered.
 * Any failure degrades to the synthetic outcome rather than throwing, so a
 * provider outage can't 500 the `/notify` call.
 *
 * `fetchImpl` is injectable for tests; defaults to global `fetch`.
 */
export function createWebhookNotifyDeliverer(
  webhookUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; authHeader?: string } = {},
): NotifyDeliverer {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetchImpl ?? fetch;
  return async (msg) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
        },
        body: JSON.stringify({
          kind: msg.kind,
          to: msg.to,
          text: msg.text,
          ...(msg.subject ? { subject: msg.subject } : {}),
          tenantId: msg.tenantId,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        return { delivered: true, detail: `${msg.kind} delivered via webhook (${res.status})`, provider: 'webhook' };
      }
      log.warn('notify webhook returned non-2xx', { kind: msg.kind, status: res.status });
      return { delivered: false, detail: `notify webhook returned ${res.status}; message not delivered`, provider: 'webhook' };
    } catch (err) {
      log.warn('notify webhook delivery failed', { kind: msg.kind, error: err instanceof Error ? err.message : String(err) });
      return { delivered: false, detail: 'notify webhook unreachable; message not delivered', provider: 'webhook' };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Build the deliverer the host should use from env. Webhook when
 *  `OPENWOP_NOTIFY_WEBHOOK_URL` is set; otherwise the synthetic fallback. */
export function resolveNotifyDelivererFromEnv(): NotifyDeliverer {
  const url = process.env.OPENWOP_NOTIFY_WEBHOOK_URL;
  if (url && url.length > 0) {
    return createWebhookNotifyDeliverer(url, {
      ...(process.env.OPENWOP_NOTIFY_WEBHOOK_AUTH ? { authHeader: process.env.OPENWOP_NOTIFY_WEBHOOK_AUTH } : {}),
    });
  }
  return syntheticNotifyDeliverer;
}
