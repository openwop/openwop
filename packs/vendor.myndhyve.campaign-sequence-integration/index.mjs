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
]);

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (SSRF_BLOCKED_HOSTS.has(h)) return true;
  // IPv4 RFC1918: 10/8, 192.168/16. (Source executor also blocks these.)
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  return false;
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
