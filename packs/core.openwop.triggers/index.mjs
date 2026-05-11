/**
 * core.openwop.triggers — workflow entry-point pack runtime.
 *
 * Trigger nodes are declarative entry points: when the engine boots a
 * run from a trigger, it sets `ctx.triggerData` with the trigger
 * payload and these executors forward that payload to outputs.
 *
 * Why a pass-through runtime?
 *   1. Replay safety. ctx.triggerData is captured at run start and
 *      persisted; replay returns the SAME data without re-fetching.
 *   2. Schema validation. Hosts that want to validate trigger payloads
 *      have a well-known seam — the node's output dispatch.
 *
 * All trigger nodes are `pure` + `cacheable` (deterministic given
 * triggerData; no side effects in the node itself).
 *
 * typeIds match the in-tree MyndHyve names verbatim (core.trigger.*)
 * per migration plan §4 rule 1 (typeId-preserve).
 */

function passThrough(ctx, defaults = {}) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: { ...defaults, ...data },
  };
}

const asStr = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const asObj = (v) => (v && typeof v === 'object' ? v : {});

/* ─── core.trigger.webhook ──────────────────────────────────── */

export async function webhookTrigger(ctx) {
  return passThrough(ctx, {
    method: 'POST',
    headers: {},
    query: {},
    body: null,
  });
}

/* ─── core.trigger.schedule ─────────────────────────────────── */

export async function scheduleTrigger(ctx) {
  return passThrough(ctx, {
    cron: ctx.config?.cron ?? '',
    timezone: ctx.config?.timezone ?? 'UTC',
    isCatchUp: false,
  });
}

/* ─── core.trigger.event ────────────────────────────────────── */

export async function eventTrigger(ctx) {
  return passThrough(ctx, {
    eventName: ctx.config?.eventName ?? '',
    payload: null,
  });
}

/* ─── core.trigger.envelope ─────────────────────────────────── */

export async function envelopeTrigger(ctx) {
  return passThrough(ctx, {
    envelopeType: ctx.config?.envelopeType ?? '',
    payload: null,
  });
}

/* ─── core.trigger.chatMessage ──────────────────────────────── */

export async function chatMessageTrigger(ctx) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: {
      channel: asStr(data.channel),
      messageText: asStr(data.messageText),
      conversationId: asStr(data.conversationId),
      peerId: asStr(data.peerId),
      conversationKind: asStr(data.conversationKind, 'dm'),
    },
  };
}

/* ─── core.trigger.canvas ───────────────────────────────────── */

export async function canvasTrigger(ctx) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: {
      canvasTypeId: asStr(data.canvasTypeId),
      canvasEvent: asStr(data.canvasEvent),
      objectId: asStr(data.objectId),
      eventData: asObj(data.eventData),
    },
  };
}

/* ─── core.trigger.artifact ─────────────────────────────────── */

export async function artifactTrigger(ctx) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: {
      artifactId: asStr(data.artifactId),
      artifactTypeId: asStr(data.artifactTypeId),
      action: asStr(data.action),
      artifactData: asObj(data.artifactData),
    },
  };
}

/* ─── Pack registry ─────────────────────────────────────────── */

export const nodes = {
  'core.trigger.webhook': webhookTrigger,
  'core.trigger.schedule': scheduleTrigger,
  'core.trigger.event': eventTrigger,
  'core.trigger.envelope': envelopeTrigger,
  'core.trigger.chatMessage': chatMessageTrigger,
  'core.trigger.canvas': canvasTrigger,
  'core.trigger.artifact': artifactTrigger,
};

export default nodes;
