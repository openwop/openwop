/**
 * core.openwop.a2a — client-side A2A (Agent-to-Agent) primitives.
 *
 * Routes through the host's A2A client (ctx.a2a.* surface). The pack
 * speaks no JSON-RPC directly — host owns transport, auth, retry.
 *
 * Tracks spec/v1/a2a-integration.md.
 *
 * Host contract (informative; hosts advertising `a2a.supported` MUST expose):
 *   ctx.a2a.discoverAgent(baseUrl, opts?) → AgentCard
 *   ctx.a2a.sendMessage({baseUrl, message, taskId?, contextId?}) → Task | Message
 *   ctx.a2a.sendAndStream({baseUrl, message, taskId?, contextId?}, onEvent) → terminalTask
 *   ctx.a2a.getTask({baseUrl, taskId}) → Task
 *   ctx.a2a.listTasks({baseUrl, filter, cursor?}) → { tasks[], nextCursor? }
 *   ctx.a2a.cancelTask({baseUrl, taskId}) → Task
 *   ctx.a2a.resubscribe({baseUrl, taskId}, onEvent) → terminalTask
 *   ctx.a2a.pushConfig.{create,get,list,delete}({baseUrl, taskId, ...}) → result
 */

function ensure(ctx) {
  if (!ctx.a2a || typeof ctx.a2a.sendMessage !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.a2a'), { code: 'host_capability_missing' });
  }
}

export async function discoverAgent(ctx) {
  ensure(ctx);
  const card = await ctx.a2a.discoverAgent(ctx.config.baseUrl, { extended: ctx.config.extended === true });
  return { status: 'success', outputs: { card } };
}

export async function sendMessage(ctx) {
  ensure(ctx);
  const result = await ctx.a2a.sendMessage({
    baseUrl: ctx.config.baseUrl,
    message: ctx.inputs.message,
    taskId: ctx.inputs.taskId ?? null,
    contextId: ctx.inputs.contextId ?? null,
  });
  return { status: 'success', outputs: { result } };
}

export async function sendAndStream(ctx) {
  ensure(ctx);
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  const terminal = await ctx.a2a.sendAndStream(
    {
      baseUrl: ctx.config.baseUrl,
      message: ctx.inputs.message,
      taskId: ctx.inputs.taskId ?? null,
      contextId: ctx.inputs.contextId ?? null,
    },
    async (event) => {
      events.push(event);
      if (emit) await emit({ kind: 'node.progress', payload: event });
    },
  );
  return { status: 'success', outputs: { terminal, events, eventCount: events.length } };
}

export async function getTask(ctx) {
  ensure(ctx);
  const task = await ctx.a2a.getTask({ baseUrl: ctx.config.baseUrl, taskId: ctx.inputs.taskId });
  return { status: 'success', outputs: { task } };
}

export async function listTasks(ctx) {
  ensure(ctx);
  const result = await ctx.a2a.listTasks({
    baseUrl: ctx.config.baseUrl,
    filter: ctx.inputs.filter ?? {},
    cursor: ctx.inputs.cursor ?? null,
    limit: ctx.inputs.limit ?? null,
  });
  return { status: 'success', outputs: result };
}

export async function cancelTask(ctx) {
  ensure(ctx);
  const task = await ctx.a2a.cancelTask({ baseUrl: ctx.config.baseUrl, taskId: ctx.inputs.taskId });
  return { status: 'success', outputs: { task } };
}

export async function resubscribe(ctx) {
  ensure(ctx);
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  const terminal = await ctx.a2a.resubscribe(
    { baseUrl: ctx.config.baseUrl, taskId: ctx.inputs.taskId },
    async (event) => { events.push(event); if (emit) await emit({ kind: 'node.progress', payload: event }); },
  );
  return { status: 'success', outputs: { terminal, events } };
}

const PENDING_STATES = new Set(['INPUT_REQUIRED','AUTH_REQUIRED']);
const TERMINAL_STATES = new Set(['COMPLETED','FAILED','CANCELED','REJECTED']);

export async function multiTurnCoordinator(ctx) {
  ensure(ctx);
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not support suspend'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  let task = ctx.inputs.task;
  const baseUrl = ctx.config.baseUrl;
  const turns = [];
  let safety = ctx.config.maxTurns ?? 16;
  while (safety-- > 0 && task?.status && PENDING_STATES.has(task.status.state)) {
    const reply = await ctx.suspend({
      kind: 'clarification',
      profile: task.status.state === 'AUTH_REQUIRED' ? 'openwop-a2a-auth' : 'openwop-a2a-input',
      prompt: task.status.message?.parts?.find((p) => p.kind === 'text')?.text ?? '(awaiting input)',
      taskId: task.id,
      contextId: task.contextId,
    });
    turns.push({ requested: task.status, replied: reply });
    task = await ctx.a2a.sendMessage({
      baseUrl,
      message: reply.message ?? { role: 'user', parts: [{ kind: 'text', text: reply.text ?? '' }] },
      taskId: task.id,
      contextId: task.contextId,
    });
  }
  return { status: 'success', outputs: { task, terminal: TERMINAL_STATES.has(task?.status?.state), turns } };
}

function pushOp(method) {
  return async function (ctx) {
    ensure(ctx);
    const op = ctx.a2a.pushConfig?.[method];
    if (typeof op !== 'function') throw Object.assign(new Error(`host does not implement pushConfig.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    const result = await op({
      baseUrl: ctx.config.baseUrl,
      taskId: ctx.inputs.taskId,
      configId: ctx.inputs.configId ?? null,
      pushNotificationConfig: ctx.inputs.pushNotificationConfig ?? null,
    });
    return { status: 'success', outputs: { result } };
  };
}

export const pushConfigCreate = pushOp('create');
export const pushConfigGet = pushOp('get');
export const pushConfigList = pushOp('list');
export const pushConfigDelete = pushOp('delete');

/* ─── Server-side (workflow IS an A2A agent) ─────────────── */

export async function serverTrigger(ctx) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: {
      method: data.method ?? '',
      message: data.message ?? null,
      taskId: data.taskId ?? null,
      contextId: data.contextId ?? null,
      transport: data.transport ?? 'http',
    },
  };
}

export async function agentCardPublish(ctx) {
  const card = ctx.inputs.card ?? ctx.config.card;
  if (!card) throw Object.assign(new Error('card required'), { code: 'CONFIG_INVALID' });
  if (typeof ctx.a2a?.publishAgentCard === 'function') {
    await ctx.a2a.publishAgentCard({ card, signed: ctx.config.signed === true });
  }
  return { status: 'success', outputs: { card, published: !!ctx.a2a?.publishAgentCard } };
}

export async function emitStatus(ctx) {
  if (typeof ctx.a2a?.emitStatus !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.a2a.emitStatus'), { code: 'host_capability_missing' });
  }
  const event = {
    taskId: ctx.inputs.taskId,
    status: ctx.inputs.status,
    final: ctx.inputs.final === true,
  };
  await ctx.a2a.emitStatus(event);
  return { status: 'success', outputs: { event } };
}

export async function emitArtifact(ctx) {
  if (typeof ctx.a2a?.emitArtifact !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.a2a.emitArtifact'), { code: 'host_capability_missing' });
  }
  const event = {
    taskId: ctx.inputs.taskId,
    artifact: ctx.inputs.artifact,
    append: ctx.inputs.append === true,
    lastChunk: ctx.inputs.lastChunk === true,
  };
  await ctx.a2a.emitArtifact(event);
  return { status: 'success', outputs: { event } };
}

export async function pushSend(ctx) {
  if (typeof ctx.a2a?.pushSend !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.a2a.pushSend'), { code: 'host_capability_missing' });
  }
  const receipt = await ctx.a2a.pushSend({
    configId: ctx.inputs.configId,
    event: ctx.inputs.event,
  });
  return { status: 'success', outputs: { receipt } };
}

export const nodes = {
  'core.openwop.a2a.discover-agent': discoverAgent,
  'core.openwop.a2a.send-message': sendMessage,
  'core.openwop.a2a.send-and-stream': sendAndStream,
  'core.openwop.a2a.get-task': getTask,
  'core.openwop.a2a.list-tasks': listTasks,
  'core.openwop.a2a.cancel-task': cancelTask,
  'core.openwop.a2a.resubscribe': resubscribe,
  'core.openwop.a2a.multi-turn-coordinator': multiTurnCoordinator,
  'core.openwop.a2a.push-config-create': pushConfigCreate,
  'core.openwop.a2a.push-config-get': pushConfigGet,
  'core.openwop.a2a.push-config-list': pushConfigList,
  'core.openwop.a2a.push-config-delete': pushConfigDelete,
  'core.openwop.a2a.server-trigger': serverTrigger,
  'core.openwop.a2a.agent-card-publish': agentCardPublish,
  'core.openwop.a2a.emit-status': emitStatus,
  'core.openwop.a2a.emit-artifact': emitArtifact,
  'core.openwop.a2a.push-send': pushSend,
};

export default nodes;
