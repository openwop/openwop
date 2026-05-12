/**
 * vendor.myndhyve.campaign-sequence-integration — three side-effectful
 * sequence-step nodes: email, sms, webhook.
 *
 * Companion to vendor.myndhyve.campaign-sequence (which carries the
 * three pure-control nodes — wait, tag, condition).
 *
 * Host capability surface:
 *
 *   ctx.campaignMessaging.isReady()                       → boolean
 *   ctx.campaignMessaging.sendEmail(step, enrollment, sequence)
 *                                                          → Promise<{ success, error?, nextStepId?, messageId? }>
 *   ctx.campaignMessaging.sendSms(step, enrollment, sequence)
 *                                                          → Promise<{ success, error?, nextStepId?, messageId? }>
 *
 * The webhook executor is self-contained — uses Node 20 `fetch` +
 * `node:crypto` for HMAC, no host capability beyond the runtime.
 * It mirrors the MyndHyve source's SSRF defense (rejects localhost,
 * 127/8, 10/8, 192.168/16, link-local 169.254.169.254) + signed body
 * format (event/enrollmentId/sequenceId/stepId/leadId/stepData/timestamp).
 *
 * Lifted from MyndHyve's src/canvas-types/campaign-studio/sequences/
 * sequenceStepModules.ts (the email/sms/webhook branch). The pure-
 * control branch shipped in vendor.myndhyve.campaign-sequence@1.0.0.
 */

import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';

/* ─── shared helpers ────────────────────────────────────── */

function readInputs(ctx) {
  const inputs = ctx.inputs ?? {};
  return {
    step: inputs.step ?? {},
    enrollment: inputs.enrollment ?? {},
    sequence: inputs.sequence ?? {},
  };
}

function success(extra = {}) {
  return { status: 'success', outputs: { success: true, ...extra } };
}

function failure(error, extra = {}) {
  // Validation failures are non-retryable per the MyndHyve source —
  // they yield `success: false` on the output but the run continues.
  return { status: 'success', outputs: { success: false, error, ...extra } };
}

function ensureMessaging(ctx) {
  if (!ctx.campaignMessaging || typeof ctx.campaignMessaging.sendEmail !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.campaignMessaging — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'host.campaignMessaging' }
    );
  }
}

function isReady(ctx) {
  return typeof ctx.campaignMessaging?.isReady === 'function'
    ? !!ctx.campaignMessaging.isReady()
    : true;
}

/* ─── campaign.sequence.email ───────────────────────────── */

export async function email(ctx) {
  const { step, enrollment, sequence } = readInputs(ctx);
  if (!step.subject) {
    return failure('Email step missing subject (non-retryable)');
  }
  ensureMessaging(ctx);
  if (!isReady(ctx)) {
    return failure('Email adapter not initialized — configure an email provider');
  }
  try {
    const result = await ctx.campaignMessaging.sendEmail(step, enrollment, sequence);
    return { status: 'success', outputs: { success: !!result?.success, ...result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (typeof ctx.log === 'function') {
      ctx.log('error', 'Email sequence node failed', { enrollmentId: enrollment.id, error: msg });
    }
    return failure(`Email delivery failed: ${msg}`);
  }
}

/* ─── campaign.sequence.sms ─────────────────────────────── */

export async function sms(ctx) {
  const { step, enrollment, sequence } = readInputs(ctx);
  if (!step.smsBody) {
    return failure('SMS step missing body (non-retryable)');
  }
  if (!ctx.campaignMessaging || typeof ctx.campaignMessaging.sendSms !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.campaignMessaging.sendSms'),
      { code: 'host_capability_missing', capability: 'host.campaignMessaging' }
    );
  }
  if (!isReady(ctx)) {
    return failure('SMS adapter not initialized — configure an SMS provider');
  }
  try {
    const result = await ctx.campaignMessaging.sendSms(step, enrollment, sequence);
    return { status: 'success', outputs: { success: !!result?.success, ...result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (typeof ctx.log === 'function') {
      ctx.log('error', 'SMS sequence node failed', { enrollmentId: enrollment.id, error: msg });
    }
    return failure(`SMS delivery failed: ${msg}`);
  }
}

/* ─── campaign.sequence.webhook ─────────────────────────── */

const SSRF_BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '169.254.169.254',
  '0.0.0.0',
]);

/**
 * Decide whether a hostname OR a resolved IP literal is in a denied range.
 * Covers IPv4 + IPv6 private + link-local + loopback + cloud-metadata.
 *
 * IPv4 blocked: 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16,
 *               172.16.0.0/12, 192.168.0.0/16, plus the cloud-metadata
 *               address 169.254.169.254 already in SSRF_BLOCKED_HOSTS.
 * IPv6 blocked: ::1, fc00::/7 (ULA), fe80::/10 (link-local).
 *
 * Range checks are string-prefix based — sufficient for the canonical
 * IPv4 dotted-quad + IPv6 lowercase-hex formats returned by `dns.lookup`.
 */
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (SSRF_BLOCKED_HOSTS.has(h)) return true;

  // IPv4 RFC1918: 10/8, 192.168/16, 172.16/12.
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('127.')) return true;
  if (h.startsWith('169.254.')) return true;
  if (h.startsWith('0.')) return true;
  // 172.16.0.0/12 = 172.16.0.0 through 172.31.255.255.
  if (h.startsWith('172.')) {
    const second = parseInt(h.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv6 ULA fc00::/7 — addresses starting with `fc` or `fd`.
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv6 link-local fe80::/10 — addresses starting with `fe80:` through `febf:`.
  if (/^fe[89ab][0-9a-f]?:/i.test(h)) return true;

  return false;
}

/**
 * Resolve hostname via DNS and check the resolved IP against the deny
 * list — defends against DNS rebinding where a public hostname maps
 * to a private IP. Bypassed for hostnames that are already literal IPs
 * (URL parser exposes them via `parsed.hostname`).
 *
 * Failure mode: if DNS lookup throws (NXDOMAIN, timeout), we let the
 * subsequent `fetch` fail naturally with a network-error. We do NOT
 * fail-closed here because legitimate webhooks may target hosts that
 * are temporarily unresolvable.
 */
async function resolveAndBlockCheck(hostname) {
  // If the URL parser yielded an IP literal, `isBlockedHost` already
  // ran against it — no DNS roundtrip needed.
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(':')) return null;
  try {
    const { address } = await dnsLookup(hostname, { verbatim: true });
    if (isBlockedHost(address)) {
      return `Webhook URL resolves to private/reserved address (${address})`;
    }
  } catch {
    // DNS error — defer to fetch.
  }
  return null;
}

function hmacSignature(body, secret) {
  // HMAC-SHA256 hex digest. Matches the MyndHyve generateWebhookSignature
  // shape (secret may be empty — node:crypto accepts a zero-length key).
  return createHmac('sha256', String(secret ?? '')).update(body).digest('hex');
}

export async function webhook(ctx) {
  const { step, enrollment, sequence } = readInputs(ctx);
  if (!step.webhookUrl) {
    return failure('Webhook step missing URL (non-retryable)');
  }

  let parsed;
  try {
    parsed = new URL(step.webhookUrl);
  } catch {
    return failure('Webhook URL is not parseable');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return failure('Webhook URL must use HTTP(S) protocol');
  }
  if (isBlockedHost(parsed.hostname)) {
    return failure('Webhook URL cannot target private/reserved addresses');
  }
  // DNS-rebinding defense: resolve the hostname and verify the IP isn't
  // in the deny list. For hostname URLs only (skip if already an IP).
  const dnsBlock = await resolveAndBlockCheck(parsed.hostname);
  if (dnsBlock !== null) {
    return failure(dnsBlock);
  }

  // Empty-secret refusal: a webhook with no shared secret produces an
  // empty-key HMAC the receiver cannot use for authentication. For
  // localhost targets (development) this is acceptable; for any
  // routable host it would mean delivering "signed" payloads any third
  // party can forge. Refuse rather than silently degrade.
  const hasSecret = typeof step.webhookSecret === 'string' && step.webhookSecret.length > 0;
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname.startsWith('127.');
  if (!hasSecret && !isLocalhost) {
    return failure('webhookSecret is required for non-localhost delivery (HMAC with empty key is forgeable)');
  }

  const timeoutMs = Math.max(1000, Math.min(60000, ctx.config?.timeoutMs ?? 30000));
  const userAgent = typeof ctx.config?.userAgent === 'string'
    ? ctx.config.userAgent
    : 'openwop-campaign-sequence/1.0';

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    event: 'sequence.step.webhook',
    enrollmentId: enrollment.id,
    sequenceId: sequence.id,
    stepId: step.id,
    leadId: enrollment.leadId,
    stepData: step.webhookBody,
    timestamp: new Date().toISOString(),
  });

  const signature = hmacSignature(body, step.webhookSecret);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-MyndHyve-Signature': signature,
    'X-MyndHyve-Event': 'sequence.step.webhook',
    ...(step.webhookHeaders ?? {}),
  };
  const method = (step.webhookMethod ?? 'POST').toUpperCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(step.webhookUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    if (response.ok) {
      return { status: 'success', outputs: { success: true, status: response.status } };
    }
    return { status: 'success', outputs: { success: false, status: response.status, error: `Webhook returned HTTP ${response.status}` } };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    const msg = aborted
      ? `Webhook timed out after ${timeoutMs}ms`
      : (err instanceof Error ? err.message : 'Unknown error');
    if (typeof ctx.log === 'function') {
      ctx.log('error', 'Webhook sequence node failed', {
        enrollmentId: enrollment.id,
        stepId: step.id,
        error: msg,
      });
    }
    return failure(`Webhook delivery failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/* ─── default export — typeId → executor map ───────────── */

const nodes = {
  'campaign.sequence.email': email,
  'campaign.sequence.sms': sms,
  'campaign.sequence.webhook': webhook,
};

export default nodes;
