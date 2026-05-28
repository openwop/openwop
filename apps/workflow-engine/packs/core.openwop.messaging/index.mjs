/**
 * core.openwop.messaging — queue + stream primitives.
 *
 * Delegates to ctx.queueBus.* (RFC 0017). Hosts MUST enforce
 * cross-tenant message isolation per SECURITY/invariants.yaml.
 *
 * Trigger nodes (mq.consume, stream.subscribe) are pass-through:
 * the host fires the workflow when a message arrives, and these
 * executors surface ctx.triggerData as outputs.
 */

function delegate(method) {
  return async function (ctx) {
    const fn = ctx.queueBus?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.queueBus.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(ctx.queueBus, { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

function trigger(field) {
  return async function (ctx) {
    const d = ctx.triggerData ?? {};
    return { status: 'success', outputs: d.payload !== undefined ? d : { [field]: d } };
  };
}

export const nodes = {
  'core.messaging.publish':           delegate('publish'),
  'core.messaging.consume':           trigger('payload'),
  'core.messaging.ack':               delegate('ack'),
  'core.messaging.nack':              delegate('nack'),
  'core.messaging.dead-letter':       delegate('deadLetter'),
  'core.messaging.stream-subscribe':  trigger('record'),
  'core.messaging.stream-publish':    delegate('streamPublish'),
};

export default nodes;
