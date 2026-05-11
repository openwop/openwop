/**
 * vendor.myndhyve.chat — MyndHyve chat-bridge pack.
 *
 * Four nodes route through the host's chat adapter (ctx.chat.*):
 *   sendMessage, progressCard, updateCard, phaseInputGate.
 *
 * typeId-preserve strategy: typeIds keep their core.chat.* prefixes
 * even though the pack is vendor-namespaced (per migration plan §4).
 *
 * Host contract (informative — host.chat is host-extension pending
 * Tracks 10/13 normative coverage):
 *
 *   ctx.chat.sendMessage({ role, content, citations?, sessionId?,
 *     idempotencyKey }) → Promise<{ messageId, sentAt }>
 *
 *   ctx.chat.emitCard({ cardId, cardType, payload, idempotencyKey })
 *     → Promise<{ cardId, emittedAt }>
 *
 *   ctx.chat.updateCard({ cardId, patch, patchType, idempotencyKey })
 *     → Promise<{ cardId, updatedAt, found }>
 *
 *   ctx.suspend({ reason, resumeKey, ... }) — RFC 0007 §F suspend
 *     primitive. phaseInputGate uses this with reason 'conversation-
 *     input' (per RFC 0010 H3 ratification).
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureChat(ctx) {
  if (!ctx.chat || typeof ctx.chat.sendMessage !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.chat — workflow-register should have refused this pack at peerDependency resolution time'),
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
    h.update('\x1e');
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/* ─── core.chat.sendMessage ──────────────────────────────── */

export async function sendMessage(ctx) {
  ensureChat(ctx);
  const role = ctx.config?.role ?? 'agent';
  const sessionId = ctx.config?.sessionId;
  const { content, citations } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), role, content,
    citations ?? [],
  ]);
  const result = await ctx.chat.sendMessage({
    role,
    content,
    ...(citations !== undefined ? { citations } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      messageId: result?.messageId ?? '',
      sentAt: result?.sentAt ?? new Date().toISOString(),
      idempotencyKey,
    },
  };
}

/* ─── core.chat.progressCard ─────────────────────────────── */

export async function progressCard(ctx) {
  ensureChat(ctx);
  if (typeof ctx.chat.emitCard !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.chat.emitCard'), { code: 'host_capability_missing' });
  }
  const { cardId, stages, title } = ctx.config;
  const { currentStageId, details } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), cardId, currentStageId,
  ]);
  const result = await ctx.chat.emitCard({
    cardId,
    cardType: 'progress',
    payload: {
      stages,
      currentStageId,
      ...(title !== undefined ? { title } : {}),
      ...(details !== undefined ? { details } : {}),
    },
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      cardId: result?.cardId ?? cardId,
      emittedAt: result?.emittedAt ?? new Date().toISOString(),
    },
  };
}

/* ─── core.chat.updateCard ───────────────────────────────── */

export async function updateCard(ctx) {
  ensureChat(ctx);
  if (typeof ctx.chat.updateCard !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.chat.updateCard'), { code: 'host_capability_missing' });
  }
  const { cardId, patchType = 'merge' } = ctx.config;
  const { patch } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), cardId, patchType, patch,
  ]);
  const result = await ctx.chat.updateCard({
    cardId,
    patch,
    patchType,
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      cardId: result?.cardId ?? cardId,
      updatedAt: result?.updatedAt ?? new Date().toISOString(),
      found: result?.found !== false,
    },
  };
}

/* ─── core.chat.phaseInputGate ───────────────────────────── */

/**
 * HITL gate. Emits a phase-input dialog into the chat session,
 * suspends the run, and on resume returns the user's validated
 * answers as outputs.
 *
 * Suspend semantics:
 *   Uses RFC 0007 §F primitive (ctx.suspend with reason). When the
 *   host advertises core.openwop.conversationPrimitive (RFC 0010),
 *   reason is 'conversation-input'; otherwise 'clarification'. The
 *   host's suspend resolver validates the user's response against
 *   config.answerSchema before resuming.
 */
export async function phaseInputGate(ctx) {
  ensureChat(ctx);
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.suspend'), { code: 'host_capability_missing' });
  }
  const { phaseId, prompt, answerSchema, timeoutMs } = ctx.config;
  const context = ctx.inputs?.context;

  // Emit the dialog card so the user sees it.
  if (typeof ctx.chat.emitCard === 'function') {
    await ctx.chat.emitCard({
      cardId: `phase-input-${phaseId}`,
      cardType: 'phase-input',
      payload: {
        phaseId,
        prompt,
        answerSchema,
        ...(context !== undefined ? { context } : {}),
      },
      idempotencyKey: deriveIdempotencyKey([String(ctx.runId), String(ctx.nodeId), phaseId, 'card']),
    });
  }

  // Suspend until the user responds. Host validates against
  // answerSchema before resuming; on resume, ctx.suspend returns
  // the validated answers.
  const resumePayload = await ctx.suspend({
    reason: 'conversation-input',
    resumeKey: phaseId,
    answerSchema,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  // Resume payload shape: { answers, respondent?, timedOut? }
  if (resumePayload?.timedOut === true) {
    return {
      status: 'success',
      outputs: {
        phaseId,
        respondedAt: new Date().toISOString(),
        timedOut: true,
      },
    };
  }

  return {
    status: 'success',
    outputs: {
      phaseId,
      answers: resumePayload?.answers ?? {},
      ...(resumePayload?.respondent ? { respondent: resumePayload.respondent } : {}),
      respondedAt: resumePayload?.respondedAt ?? new Date().toISOString(),
    },
  };
}

/* ─── Pack registry ──────────────────────────────────────── */

export const nodes = {
  'core.chat.sendMessage': sendMessage,
  'core.chat.progressCard': progressCard,
  'core.chat.updateCard': updateCard,
  'core.chat.phaseInputGate': phaseInputGate,
};

export default nodes;
