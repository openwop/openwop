/**
 * `ctx.suspend` / `ctx.interrupt` control-flow signal.
 *
 * `spec/v1/interrupt.md §"key field"` defines the normative model: a node calls
 * `interrupt(payload)` inline and the engine suspends; on re-entry (after process
 * death / resume) the engine calls the node again and, seeing the same `key`,
 * **short-circuits and returns the persisted resumeValue without re-prompting**.
 * The sample host realises this by throwing a `SuspendSignal` on the first call
 * (the executor converts it to a `{status:'suspended'}` outcome + a durable
 * interrupt) and, on resume, re-invoking the node with the resolution seeded so
 * `ctx.suspend`/`ctx.interrupt` returns it inline.
 *
 * Packs call `ctx.suspend({reason, resumeKey, ...})`; the spec names the surface
 * `ctx.interrupt({kind, key, ...})`. Both are exposed; this normalizes either
 * shape into one signal.
 */

/** Interrupt kinds the executor's NodeOutcome accepts (executor/types.ts). */
export type SuspendKind = 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event';

/** Map a pack `reason` / spec `kind` to the NodeOutcome kind enum. Unknown
 *  values fall through to `external-event` — the documented escape hatch
 *  (`interrupt.md §"custom / external-event"`). */
export function mapSuspendKind(reason: unknown): SuspendKind {
  switch (reason) {
    case 'approval':
    case 'low-confidence':
      return 'approval';
    case 'clarification':
    case 'conversation-input':
      return 'clarification';
    case 'refinement':
      return 'refinement';
    case 'cancellation':
      return 'cancellation';
    case 'external-event':
      return 'external-event';
    default:
      return 'external-event';
  }
}

export interface SuspendPayload {
  reason?: unknown;
  kind?: unknown;
  resumeKey?: unknown;
  key?: unknown;
  answerSchema?: unknown;
  resumeSchema?: unknown;
  timeoutMs?: unknown;
  [k: string]: unknown;
}

/** Thrown by `ctx.suspend`/`ctx.interrupt` on the first (un-resolved) call. */
export class SuspendSignal extends Error {
  readonly kind: SuspendKind;
  readonly resumeKey: string;
  readonly data: Record<string, unknown>;
  readonly resumeSchema?: Record<string, unknown>;
  readonly timeoutMs?: number;

  constructor(args: { kind: SuspendKind; resumeKey: string; data: Record<string, unknown>; resumeSchema?: Record<string, unknown>; timeoutMs?: number }) {
    super(`suspend:${args.kind}:${args.resumeKey}`);
    this.name = 'SuspendSignal';
    this.kind = args.kind;
    this.resumeKey = args.resumeKey;
    this.data = args.data;
    if (args.resumeSchema !== undefined) this.resumeSchema = args.resumeSchema;
    if (args.timeoutMs !== undefined) this.timeoutMs = args.timeoutMs;
  }
}

/** Build a `ctx.suspend`/`ctx.interrupt` method bound to a node. Returns the
 *  seeded resolution when re-invoked with the matching key (the spec's
 *  short-circuit); otherwise throws a `SuspendSignal`. */
export function makeSuspendFn(
  fallbackKey: string,
  resolution: { resumeKey: string; value: unknown } | undefined,
): (payload: SuspendPayload) => Promise<unknown> {
  return async (payload: SuspendPayload): Promise<unknown> => {
    const resumeKey = String(payload.resumeKey ?? payload.key ?? fallbackKey);
    if (resolution && resolution.resumeKey === resumeKey) {
      return resolution.value;
    }
    const schema = (payload.answerSchema ?? payload.resumeSchema) as Record<string, unknown> | undefined;
    throw new SuspendSignal({
      kind: mapSuspendKind(payload.reason ?? payload.kind),
      resumeKey,
      data: { ...payload },
      ...(schema !== undefined ? { resumeSchema: schema } : {}),
      ...(typeof payload.timeoutMs === 'number' ? { timeoutMs: payload.timeoutMs } : {}),
    });
  };
}
