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

/* ─── core.chat.approvalGate ─────────────────────────────── */

/**
 * HITL approval gate. Suspends via ctx.suspend({reason:'approval'}) and
 * routes the decision (accept | edit-accept | refine | ask | reject |
 * timeout) back into outputs. Tracks loopback counter +
 * accumulated refine feedback on workflow variables so a downstream
 * loopback edge can re-generate with context.
 *
 * Preserved from in-tree byte-for-byte: variable keys
 *   _loopbackCount:<nodeId>
 *   _feedbackHistory:<nodeId>
 *   _previousArtifact:<nodeId>
 *
 * Multi-vote quorum + artifact-sync side-effects are HOST-side per
 * spec/v1/interrupt.md §"Host-side enforcement boundary". This
 * executor only mediates the suspend round-trip.
 */
export async function approvalGate(ctx) {
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.suspend'), {
      code: 'host_capability_missing',
    });
  }
  const config = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};
  const {
    title,
    artifactType,
    maxRequestChangesIterations = 0,
    timeoutMs,
  } = config;

  const loopbackKey = `_loopbackCount:${ctx.nodeId}`;
  const feedbackKey = `_feedbackHistory:${ctx.nodeId}`;
  const previousKey = `_previousArtifact:${ctx.nodeId}`;

  // Emit the approval card so the user sees the artifact + actions.
  if (ctx.chat && typeof ctx.chat.emitCard === 'function') {
    await ctx.chat.emitCard({
      cardId: `approval-${ctx.nodeId}`,
      cardType: 'approval',
      payload: {
        title: title ?? 'Approval Required',
        artifactType,
        artifact: inputs.artifact,
        loopbackCount: ctx.variables?.get?.(loopbackKey) ?? 0,
        feedbackHistory: ctx.variables?.get?.(feedbackKey) ?? [],
      },
      idempotencyKey: deriveIdempotencyKey([
        String(ctx.runId), String(ctx.nodeId), 'approval-card',
      ]),
    });
  }

  const resumePayload = await ctx.suspend({
    reason: 'approval',
    resumeKey: ctx.nodeId,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  // Resume payload shape: { decision, approved?, feedback?, editedArtifact?,
  //                          decidedBy?, decidedAt?, timedOut? }
  if (resumePayload?.timedOut === true) {
    return {
      status: 'success',
      outputs: {
        decision: 'timeout',
        approved: false,
        decidedAt: new Date().toISOString(),
        timedOut: true,
      },
    };
  }

  const rawDecision = resumePayload?.decision;
  const approved =
    rawDecision === 'approved' ||
    rawDecision === 'accept' ||
    rawDecision === 'edit-accept' ||
    resumePayload?.approved === true;

  // Classify into the 5-action union (matches in-tree classifyVoteAction).
  let action;
  if (rawDecision === 'edit-accept' || resumePayload?.editedArtifact) action = 'edit-accept';
  else if (rawDecision === 'accept' || rawDecision === 'approved' || approved) action = 'accept';
  else if (rawDecision === 'ask') action = 'ask';
  else if (rawDecision === 'reject' || rawDecision === 'rejected') action = 'reject';
  else action = 'refine'; // any other decision with feedback = refine

  // Loopback bookkeeping for refine.
  if (action === 'refine' && ctx.variables) {
    const prevCount = ctx.variables.get(loopbackKey) ?? 0;
    const nextCount = prevCount + 1;
    if (maxRequestChangesIterations > 0 && nextCount > maxRequestChangesIterations) {
      return {
        status: 'success',
        outputs: {
          decision: 'reject',
          approved: false,
          feedback: 'maxRequestChangesIterations exceeded',
          decidedAt: new Date().toISOString(),
        },
      };
    }
    ctx.variables.set(loopbackKey, nextCount);

    const prevFeedback = ctx.variables.get(feedbackKey) ?? [];
    if (resumePayload?.feedback) {
      ctx.variables.set(feedbackKey, [
        ...prevFeedback,
        {
          iteration: nextCount,
          feedback: resumePayload.feedback,
          submittedAt: resumePayload.decidedAt ?? new Date().toISOString(),
        },
      ]);
    }
    if (inputs.artifact !== undefined) {
      ctx.variables.set(previousKey, inputs.artifact);
    }
  }

  return {
    status: 'success',
    outputs: {
      decision: action,
      approved,
      ...(resumePayload?.feedback ? { feedback: resumePayload.feedback } : {}),
      ...(resumePayload?.editedArtifact ? { editedArtifact: resumePayload.editedArtifact } : {}),
      ...(resumePayload?.decidedBy ? { decidedBy: resumePayload.decidedBy } : {}),
      decidedAt: resumePayload?.decidedAt ?? new Date().toISOString(),
    },
  };
}

/* ─── core.chat.clarificationGate ────────────────────────── */

/**
 * HITL clarification gate. Asks a list of questions (from ask.clarify
 * envelope or upstream output), suspends until the user answers each,
 * returns answers paired with their questions.
 *
 * Per spec/v1/interrupt.md, uses suspend reason 'clarification' (or
 * 'conversation-input' when the host advertises RFC 0010
 * conversationPrimitive).
 */
export async function clarificationGate(ctx) {
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.suspend'), {
      code: 'host_capability_missing',
    });
  }
  const { title = 'Clarification Needed', timeoutMs = 0, writeToVariables = false } = ctx.config ?? {};
  const inputs = ctx.inputs ?? {};

  // Normalize questions — accept both string[] and Array<{question}>.
  const rawQuestions = Array.isArray(inputs.questions) ? inputs.questions : [];
  const questions = rawQuestions.map((q) =>
    typeof q === 'string' ? q : (q && typeof q.question === 'string' ? q.question : String(q)),
  );

  if (questions.length === 0) {
    return {
      status: 'success',
      outputs: { answers: [], submittedAt: new Date().toISOString() },
    };
  }

  if (ctx.chat && typeof ctx.chat.emitCard === 'function') {
    await ctx.chat.emitCard({
      cardId: `clarification-${ctx.nodeId}`,
      cardType: 'clarification',
      payload: { title, questions },
      idempotencyKey: deriveIdempotencyKey([
        String(ctx.runId), String(ctx.nodeId), 'clarification-card',
      ]),
    });
  }

  const resumePayload = await ctx.suspend({
    reason: 'clarification',
    resumeKey: ctx.nodeId,
    questions,
    ...(timeoutMs > 0 ? { timeoutMs } : {}),
  });

  if (resumePayload?.timedOut === true) {
    return {
      status: 'success',
      outputs: {
        answers: [],
        submittedAt: new Date().toISOString(),
        timedOut: true,
      },
    };
  }

  // Pair answers back to their questions.
  const rawAnswers = Array.isArray(resumePayload?.answers) ? resumePayload.answers : [];
  const answers = questions.map((question, i) => {
    const a = rawAnswers[i];
    const answer = typeof a === 'string' ? a : (a && typeof a.answer === 'string' ? a.answer : '');
    return { question, answer };
  });

  if (writeToVariables && ctx.variables) {
    for (let i = 0; i < answers.length; i++) {
      ctx.variables.set(`clarification_${i}_answer`, answers[i].answer);
    }
  }

  return {
    status: 'success',
    outputs: {
      answers,
      submittedAt: resumePayload?.submittedAt ?? new Date().toISOString(),
    },
  };
}

/* ─── Pack registry ──────────────────────────────────────── */

export const nodes = {
  'core.chat.sendMessage': sendMessage,
  'core.chat.progressCard': progressCard,
  'core.chat.updateCard': updateCard,
  'core.chat.phaseInputGate': phaseInputGate,
  'core.chat.approvalGate': approvalGate,
  'core.chat.clarificationGate': clarificationGate,
};

export default nodes;
