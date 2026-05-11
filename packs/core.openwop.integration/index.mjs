/**
 * core.openwop.integration — universal communication-integration pack.
 *
 * Two nodes route through host-provider adapters:
 *   email-send  → ctx.email.send(...)
 *   slack-message → ctx.slack.postMessage(...)
 *
 * Pack speaks no SMTP, IMAP, Slack RTM/Web API directly. Host's
 * adapter handles provider selection, credentials, retry policy,
 * rate-limit handling, provider-specific quirks (Slack thread-reply
 * vs broadcast semantics; SES vs SendGrid bounce handling).
 *
 * Replay model:
 *   Both nodes declare `side-effectful + cacheable`. Engine's
 *   Layer-2 invocation log caches the terminal node.completed
 *   payload keyed on (runId, nodeId, request-hash). Replays return
 *   the cached payload — emails NOT re-sent, Slack messages NOT
 *   duplicated. Cost-once + replay-deterministic.
 *
 * Idempotency-Key derivation: deterministic SHA-256 over
 * (runId, nodeId, recipient/channel, subject/text, body/blocks).
 * Same run + node + payload → same key across replays. Surfaced in
 * output for debug + so provider-side dedup (if supported by
 * provider) sees a consistent key across retries.
 *
 * @see spec/v1/capabilities.md (host email + slack advertisement)
 * @see spec/v1/replay.md
 * @see docs/PACKS-MVP-PLAN.md
 */

import { createHash } from 'node:crypto';

function ensureEmailAdapter(ctx) {
  if (!ctx.email || typeof ctx.email.send !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.email.send — workflow-register should have refused'),
      { code: 'host_capability_missing' }
    );
  }
}

function ensureSlackAdapter(ctx) {
  if (!ctx.slack || typeof ctx.slack.postMessage !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.slack.postMessage — workflow-register should have refused'),
      { code: 'host_capability_missing' }
    );
  }
}

function deriveIdempotencyKey(parts) {
  const h = createHash('sha256');
  for (const p of parts) {
    if (p === undefined || p === null) h.update('\0');
    else if (typeof p === 'string') h.update(p, 'utf8');
    else h.update(JSON.stringify(p), 'utf8');
    h.update('\x1e'); // record separator
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/* ─── core.openwop.integration.email-send ──────────────────── */

export async function emailSend(ctx) {
  ensureEmailAdapter(ctx);
  const { from, provider, replyTo, fallbackOnFailure } = ctx.config;
  const { to, cc, bcc, subject, text, html } = ctx.inputs;

  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    Array.isArray(to) ? to.sort().join(',') : to,
    subject, text ?? '', html ?? '',
  ]);

  const result = await ctx.email.send({
    from,
    to,
    ...(cc !== undefined ? { cc } : {}),
    ...(bcc !== undefined ? { bcc } : {}),
    subject,
    ...(text !== undefined ? { text } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(fallbackOnFailure !== undefined ? { fallbackOnFailure } : {}),
    idempotencyKey,
  });

  const sent = result?.sent === true || (result?.messageId !== undefined && result?.messageId !== '');

  return {
    status: 'success',
    outputs: {
      sent,
      messageId: result?.messageId ?? '',
      provider: result?.provider ?? provider ?? 'default',
      idempotencyKey,
      ...(sent ? {} : { error: result?.error ?? 'unknown email send failure' }),
    },
  };
}

/* ─── core.openwop.integration.slack-message ───────────────── */

export async function slackMessage(ctx) {
  ensureSlackAdapter(ctx);
  const { channel, workspace, asUser } = ctx.config;
  const { text, blocks, threadTs, broadcast } = ctx.inputs;

  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    channel, text, blocks ?? null, threadTs ?? '',
  ]);

  const result = await ctx.slack.postMessage({
    channel,
    text,
    ...(blocks !== undefined ? { blocks } : {}),
    ...(threadTs !== undefined ? { threadTs } : {}),
    ...(broadcast !== undefined ? { broadcast } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(asUser !== undefined ? { asUser } : {}),
    idempotencyKey,
  });

  const posted = result?.ok === true || (result?.ts !== undefined && result?.ts !== '');

  return {
    status: 'success',
    outputs: {
      posted,
      ts: result?.ts ?? '',
      channel: result?.channel ?? channel,
      idempotencyKey,
      ...(posted ? {} : { error: result?.error ?? 'unknown slack post failure' }),
    },
  };
}

/* ─── Pack registry ────────────────────────────────────────── */

export const nodes = {
  'core.openwop.integration.email-send': emailSend,
  'core.openwop.integration.slack-message': slackMessage,
};

export default nodes;
