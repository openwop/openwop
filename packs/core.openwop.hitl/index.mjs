/**
 * core.openwop.hitl — human-in-the-loop primitives.
 *
 * Each node suspends the run via the existing interrupt mechanism
 * (interrupt.md / interrupt-profiles.md) and resumes when input arrives.
 */

function requireSuspend(ctx) {
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not support suspend'), { code: 'HOST_CAPABILITY_MISSING' });
  }
}

const FLAT_TYPES = new Set(['string','number','integer','boolean']);
const FLAT_FORMATS = new Set(['email','uri','date','date-time']);

function assertFlatSchema(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    throw Object.assign(new Error('form schema must be an object with properties[]'), { code: 'CONFIG_INVALID' });
  }
  for (const [k, prop] of Object.entries(schema.properties)) {
    if (prop.enum) continue;
    if (!FLAT_TYPES.has(prop.type)) {
      throw Object.assign(new Error(`form field ${k}: type must be string/number/integer/boolean/enum`), { code: 'CONFIG_INVALID' });
    }
    if (prop.format && !FLAT_FORMATS.has(prop.format)) {
      throw Object.assign(new Error(`form field ${k}: format must be one of email|uri|date|date-time`), { code: 'CONFIG_INVALID' });
    }
  }
}

export async function formRequest(ctx) {
  requireSuspend(ctx);
  assertFlatSchema(ctx.config.formSchema);
  const result = await ctx.suspend({
    kind: 'clarification',
    profile: 'openwop-form',
    prompt: ctx.inputs.prompt,
    formSchema: ctx.config.formSchema,
    deadlineSeconds: ctx.config.deadlineSeconds ?? null,
    locale: ctx.inputs.locale ?? null,
  });
  return {
    status: 'success',
    outputs: {
      action: result.action ?? 'accept',
      payload: result.payload ?? {},
      respondedBy: result.respondedBy ?? null,
      respondedAt: result.respondedAt ?? null,
    },
  };
}

export async function approvalRequest(ctx) {
  requireSuspend(ctx);
  const result = await ctx.suspend({
    kind: 'approval',
    prompt: ctx.inputs.prompt,
    metadata: ctx.inputs.metadata ?? {},
    approvers: ctx.config.approvers ?? null,
    quorum: ctx.config.quorum ?? null,
    deadlineSeconds: ctx.config.deadlineSeconds ?? null,
  });
  return {
    status: 'success',
    outputs: {
      decision: result.decision ?? 'reject',
      comment: result.comment ?? null,
      decidedBy: result.decidedBy ?? null,
      decidedAt: result.decidedAt ?? null,
    },
  };
}

export async function askUser(ctx) {
  requireSuspend(ctx);
  const result = await ctx.suspend({
    kind: 'clarification',
    profile: 'openwop-chat',
    prompt: ctx.inputs.prompt,
    deadlineSeconds: ctx.config.deadlineSeconds ?? null,
    chatId: ctx.inputs.chatId ?? null,
  });
  return {
    status: 'success',
    outputs: {
      answer: result.answer ?? '',
      answeredBy: result.answeredBy ?? null,
      answeredAt: result.answeredAt ?? null,
    },
  };
}

export const nodes = {
  'core.hitl.form-request': formRequest,
  'core.hitl.approval-request': approvalRequest,
  'core.hitl.ask-user': askUser,
};

export default nodes;
