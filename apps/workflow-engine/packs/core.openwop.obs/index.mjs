/**
 * core.openwop.obs — observability emission primitives.
 *
 * Thin emitters that delegate to ctx.observability when the host
 * advertises it, no-op gracefully when not. Names are auto-prefixed
 * with `openwop.workflow.` if not already namespaced, per host-extensions.md.
 */

const NS = 'openwop.workflow.';

function prefix(name) {
  if (!name) return name;
  if (name.startsWith('openwop.')) return name;
  return NS + name;
}

function obs(ctx) {
  return ctx.observability || ctx.obs || null;
}

export async function logNode(ctx) {
  const level = ctx.config.level || ctx.inputs.level || 'info';
  const message = ctx.inputs.message;
  const attributes = ctx.inputs.attributes || {};
  const o = obs(ctx);
  if (o && typeof o.log === 'function') {
    await o.log({ level, message, attributes });
  }
  return { status: 'success', outputs: { emitted: !!o, level, message } };
}

async function recordMetric(ctx, kind) {
  const name = prefix(ctx.config.name || ctx.inputs.name);
  const value = ctx.inputs.value ?? (kind === 'counter' ? 1 : 0);
  const attributes = ctx.inputs.attributes || {};
  const o = obs(ctx);
  if (o && typeof o.metric === 'function') {
    await o.metric({ kind, name, value, attributes, unit: ctx.config.unit });
  }
  return { status: 'success', outputs: { emitted: !!o, kind, name, value } };
}

export const metricCounter = (ctx) => recordMetric(ctx, 'counter');
export const metricGauge = (ctx) => recordMetric(ctx, 'gauge');
export const metricHistogram = (ctx) => recordMetric(ctx, 'histogram');

export async function traceSpanStart(ctx) {
  const name = prefix(ctx.config.name || ctx.inputs.name);
  const attributes = ctx.inputs.attributes || {};
  const o = obs(ctx);
  let spanHandle = null;
  if (o && typeof o.startSpan === 'function') {
    spanHandle = await o.startSpan({ name, attributes });
  }
  return { status: 'success', outputs: { spanHandle, name } };
}

export async function traceSpanEnd(ctx) {
  const o = obs(ctx);
  const handle = ctx.inputs.spanHandle;
  if (o && typeof o.endSpan === 'function' && handle != null) {
    await o.endSpan({ spanHandle: handle, status: ctx.inputs.status || 'ok', attributes: ctx.inputs.attributes || {} });
  }
  return { status: 'success', outputs: { ended: !!o && handle != null } };
}

export async function alertFire(ctx) {
  const o = obs(ctx);
  const event = {
    severity: ctx.config.severity || ctx.inputs.severity || 'warning',
    title: ctx.inputs.title,
    description: ctx.inputs.description || null,
    attributes: ctx.inputs.attributes || {},
    dedupKey: ctx.inputs.dedupKey || null,
  };
  if (o && typeof o.alert === 'function') await o.alert(event);
  if (typeof ctx.publishEvent === 'function') {
    await ctx.publishEvent({ type: 'openwop.alert.fired', payload: event });
  }
  return { status: 'success', outputs: { fired: true, event } };
}

export const nodes = {
  'core.obs.log': logNode,
  'core.obs.metric-counter': metricCounter,
  'core.obs.metric-gauge': metricGauge,
  'core.obs.metric-histogram': metricHistogram,
  'core.obs.trace-span-start': traceSpanStart,
  'core.obs.trace-span-end': traceSpanEnd,
  'core.obs.alert-fire': alertFire,
};

export default nodes;
