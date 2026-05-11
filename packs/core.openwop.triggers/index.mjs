/**
 * core.openwop.triggers — workflow entry-point pack runtime.
 *
 * Trigger nodes don't "execute" in the normal sense — they're
 * declarative entry points the host's trigger subsystem uses to
 * register workflows for external-event dispatch (webhook arrival,
 * cron firing, event-bus match, envelope routing). When the engine
 * boots a run from a trigger, it sets `ctx.triggerData` with the
 * trigger payload. This runtime forwards that payload to outputs.
 *
 * Why a pass-through runtime instead of nothing? Two reasons:
 *   1. Replay safety. `ctx.triggerData` is captured at run start
 *      and persisted; replay returns the SAME data without
 *      re-fetching from the trigger source. The pass-through
 *      cements that contract in the node graph.
 *   2. Schema validation. Hosts that want to validate trigger
 *      payloads against the declared output schemas have a
 *      well-known seam — the node's output dispatch — to do so.
 *
 * All trigger nodes are `pure` + `cacheable` (no side effects;
 * deterministic given triggerData). NOT `side-effectful` — the
 * external-event-trigger surface is the host's concern, not the
 * node's; the node only reflects what the host captured.
 *
 * @see spec/v1/rest-endpoints.md (webhook + trigger endpoints)
 * @see spec/v1/webhooks.md (host webhook subsystem)
 * @see docs/PACKS-MVP-PLAN.md
 */

/**
 * Generic pass-through with default population. The engine populates
 * `ctx.triggerData` from the trigger event; we return it (with a few
 * defaults for shape stability). Host MAY supply only a subset of
 * fields; the schema then validates the result.
 */
function passThrough(ctx, defaults = {}) {
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: { ...defaults, ...data },
  };
}

/* ─── core.openwop.triggers.webhook ────────────────────────── */

export async function webhookTrigger(ctx) {
  // Defaults shape the output so downstream nodes can rely on
  // `headers` + `query` being objects (never undefined). `body` is
  // null when no body (matches the schema). receivedAt + remoteAddr
  // are host-best-effort; if absent, they don't show.
  return passThrough(ctx, {
    method: 'POST',
    headers: {},
    query: {},
    body: null,
  });
}

/* ─── core.openwop.triggers.schedule ───────────────────────── */

export async function scheduleTrigger(ctx) {
  return passThrough(ctx, {
    cron: ctx.config?.cron ?? '',
    timezone: ctx.config?.timezone ?? 'UTC',
    isCatchUp: false,
  });
}

/* ─── core.openwop.triggers.event ──────────────────────────── */

export async function eventTrigger(ctx) {
  return passThrough(ctx, {
    eventName: ctx.config?.eventName ?? '',
    payload: null,
  });
}

/* ─── core.openwop.triggers.envelope ───────────────────────── */

export async function envelopeTrigger(ctx) {
  return passThrough(ctx, {
    envelopeType: ctx.config?.envelopeType ?? '',
    payload: null,
  });
}

/* ─── Pack registry ────────────────────────────────────────── */

export const nodes = {
  'core.openwop.triggers.webhook': webhookTrigger,
  'core.openwop.triggers.schedule': scheduleTrigger,
  'core.openwop.triggers.event': eventTrigger,
  'core.openwop.triggers.envelope': envelopeTrigger,
};

export default nodes;
