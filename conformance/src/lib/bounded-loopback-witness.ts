/**
 * RFC 0258 — judges for `v2-bounded-loopback.test.ts`. Pure functions over a
 * run's event log, so each can be shown to fail on a sabotaged log
 * (`bounded-loopback-witness.test.ts`). Rules: `$defs/EdgeLoopback` in
 * `schemas/v2/workflow-definition.schema.json`, `$defs/nodeCompleted.loopback`
 * in `run-event-payloads.schema.json`, `$defs/ApprovalData.loopback` in
 * `suspend-request.schema.json`.
 */

export interface Ev { type?: string; sequence?: number; nodeId?: string; payload?: Record<string, unknown> }
export interface LoopFinding { ok: boolean; message: string }

const ok = (cond: boolean, message: string): LoopFinding => ({ ok: cond, message });
const nodeOf = (e: Ev): string | undefined => (typeof e.nodeId === 'string' ? e.nodeId : (e.payload?.['nodeId'] as string | undefined));
const of = (log: readonly Ev[], type: string, nodeId?: string): Ev[] => log.filter((e) => e.type === type && (nodeId === undefined || nodeOf(e) === nodeId));

/** Every `interrupt.requested` raised by `gate`, in log order. */
export function requestsOf(log: readonly Ev[], gate: string): Ev[] { return of(log, 'interrupt.requested', gate); }

/** The `ApprovalData.loopback` of one request, or undefined. */
export function approvalLoopback(e: Ev | undefined): Record<string, unknown> | undefined {
  const data = e?.payload?.['data'] as Record<string, unknown> | undefined;
  const lb = data?.['loopback'];
  return lb && typeof lb === 'object' ? (lb as Record<string, unknown>) : undefined;
}

/** The gate's `node.completed` events that carry the §C.1 marker. */
export function markersOf(log: readonly Ev[], gate: string): Ev[] {
  return of(log, 'node.completed', gate).filter((e) => e.payload?.['loopback'] !== undefined);
}

/**
 * `0258.refine-rearms` — after one refine: the gate's completion carries the
 * marker for round 1 naming every region node, the target starts again, the
 * gate is asked again under a different key, and the gate's forward target
 * never started.
 */
export function judgeRearm(log: readonly Ev[], o: { gate: string; target: string; edgeId: string; region: readonly string[]; forward: string }): LoopFinding[] {
  const marks = markersOf(log, o.gate);
  const m = marks[0]?.payload?.['loopback'] as Record<string, unknown> | undefined;
  const reqs = requestsOf(log, o.gate);
  const keys = reqs.map((e) => e.payload?.['key']);
  return [
    ok(marks.length === 1, `the gate's node.completed MUST carry loopback after one refine (found ${marks.length} marked completion(s))`),
    ok(m?.['edgeId'] === o.edgeId && m?.['targetNodeId'] === o.target && m?.['round'] === 1, `the marker MUST read {edgeId: ${o.edgeId}, targetNodeId: ${o.target}, round: 1} (got ${JSON.stringify(m)})`),
    ok(JSON.stringify(m?.['rearmed']) === JSON.stringify(o.region), `rearmed MUST list the region in nodes[] order, ${JSON.stringify(o.region)} (got ${JSON.stringify(m?.['rearmed'])})`),
    ok(of(log, 'node.started', o.target).length === 2, `the target MUST start again as a new visit (node.started ×${of(log, 'node.started', o.target).length}, want 2)`),
    ok(reqs.length === 2 && typeof keys[0] === 'string' && typeof keys[1] === 'string' && keys[0] !== keys[1], `the gate MUST be asked again under a different key (interrupt.requested ×${reqs.length}, keys ${JSON.stringify(keys)})`),
    ok(of(log, 'node.started', o.forward).length === 0, `nothing leaves the region on a refine: ${o.forward} MUST NOT start before accept`),
  ];
}

/**
 * `0258.history-from-log` — the target (an input-echoing node) shows the round
 * history it received: `[]` on its first visit, then one entry per round
 * holding exactly `round`, the target's own outputs from that round, and the
 * refine feedback. No other key, so no timestamp, principal, run id or key.
 */
export function judgeHistory(log: readonly Ev[], o: { target: string; port: string; feedback: readonly unknown[] }): LoopFinding[] {
  const done = of(log, 'node.completed', o.target).map((e) => (e.payload?.['outputs'] ?? {}) as Record<string, unknown>);
  const out: LoopFinding[] = [ok(done.length === o.feedback.length + 1, `the target MUST complete once per visit (${done.length} completion(s), want ${o.feedback.length + 1})`)];
  done.forEach((outputs, visit) => {
    const h = outputs[o.port];
    if (!Array.isArray(h)) { out.push(ok(false, `visit ${visit}: the ${o.port} input MUST be an array (got ${JSON.stringify(h)})`)); return; }
    out.push(ok(h.length === visit, `visit ${visit}: history MUST hold ${visit} entr${visit === 1 ? 'y' : 'ies'} (got ${h.length})`));
    h.forEach((entry: unknown, i: number) => {
      const en = (entry ?? {}) as Record<string, unknown>;
      const extra = Object.keys(en).filter((k) => !['round', 'outputs', 'refineFeedback'].includes(k));
      out.push(ok(en['round'] === i + 1, `visit ${visit} entry ${i}: round MUST be ${i + 1}, oldest first (got ${JSON.stringify(en['round'])})`));
      out.push(ok(JSON.stringify(en['outputs']) === JSON.stringify(done[i]), `visit ${visit} entry ${i}: outputs MUST be the target's own round-${i + 1} outputs`));
      out.push(ok(JSON.stringify(en['refineFeedback']) === JSON.stringify(o.feedback[i]), `visit ${visit} entry ${i}: refineFeedback MUST be round ${i + 1}'s (got ${JSON.stringify(en['refineFeedback'])})`));
      out.push(ok(extra.length === 0, `visit ${visit} entry ${i}: an entry MUST carry no other key (found ${JSON.stringify(extra)})`));
    });
  });
  return out;
}

/** `0258.approval-data-loopback` — each visit's `ApprovalData.loopback` reads the expected triple. */
export function judgeApprovalData(log: readonly Ev[], gate: string, want: ReadonlyArray<{ round: number; maxIterations: number; exhausted: boolean }>): LoopFinding[] {
  const got = requestsOf(log, gate).map(approvalLoopback);
  const out: LoopFinding[] = [ok(got.length === want.length, `the gate MUST be asked ${want.length} time(s) (got ${got.length})`)];
  want.forEach((w, i) => out.push(ok(JSON.stringify(got[i]) === JSON.stringify(w), `visit ${i}: ApprovalData.loopback MUST be ${JSON.stringify(w)} (got ${JSON.stringify(got[i])})`)));
  return out;
}

/** `0258.withdraw-refine` — the exhausted visit omits `refine` from `actions`. */
export function judgeWithdrawn(log: readonly Ev[], gate: string): LoopFinding[] {
  const last = requestsOf(log, gate).at(-1);
  const actions = (last?.payload?.['data'] as Record<string, unknown> | undefined)?.['actions'];
  return [
    ok(approvalLoopback(last)?.['exhausted'] === true, 'the last visit MUST read exhausted: true'),
    ok(Array.isArray(actions) && !actions.includes('refine') && actions.length > 0, `the exhausted visit MUST omit refine from actions and keep the others (got ${JSON.stringify(actions)})`),
  ];
}

/** `0258.fail-on-exhausted` — a refine on the exhausted visit, under `onExhausted: fail`. */
export function judgeFailExhausted(log: readonly Ev[], gate: string, maxIterations: number): LoopFinding[] {
  const limit = of(log, 'workflow.loopback-limit')[0];
  const cap = of(log, 'cap.breached').find((e) => e.payload?.['kind'] === 'loopback-iterations');
  const failed = of(log, 'run.failed')[0];
  const err = (failed?.payload?.['error'] ?? {}) as Record<string, unknown>;
  const seq = (e: Ev | undefined): number => (typeof e?.sequence === 'number' ? e.sequence : Number.NaN);
  return [
    ok(limit?.payload?.['nodeId'] === gate && limit?.payload?.['iterations'] === maxIterations && limit?.payload?.['limit'] === maxIterations, `workflow.loopback-limit MUST read {nodeId: ${gate}, iterations: ${maxIterations}, limit: ${maxIterations}} (got ${JSON.stringify(limit?.payload)})`),
    ok(cap !== undefined && cap.payload?.['limit'] === maxIterations && cap.payload?.['observed'] === maxIterations + 1, `cap.breached {kind: loopback-iterations, limit: ${maxIterations}, observed: ${maxIterations + 1}} MUST be emitted (got ${JSON.stringify(cap?.payload)})`),
    ok(seq(limit) < seq(cap) && seq(cap) < seq(failed), 'the order MUST be workflow.loopback-limit, then cap.breached, then run.failed'),
    ok(err['code'] === 'loop_limit_exceeded', `run.failed MUST carry loop_limit_exceeded (got ${JSON.stringify(err['code'])})`),
    ok(failed?.payload?.['failedNodeId'] === gate, `run.failed.failedNodeId MUST name the gate (got ${JSON.stringify(failed?.payload?.['failedNodeId'])})`),
  ];
}

/**
 * `0258.replay-rearms` — a replay fork whose prefix ends at the marked
 * completion reaches the gate's second visit: a new request for the gate after
 * the fork point, and no resolution of the gate after it (round 1 is not
 * decided again).
 */
export function judgeReplayRearm(fork: readonly Ev[], gate: string, fromSeq: number): LoopFinding[] {
  const after = fork.filter((e) => typeof e.sequence === 'number' && e.sequence >= fromSeq);
  return [
    ok(of(after, 'interrupt.requested', gate).length === 1, `the fork MUST re-arm and ask the gate again after the marker (requests after fromSeq: ${of(after, 'interrupt.requested', gate).length})`),
    ok(of(after, 'interrupt.resolved', gate).length === 0, 'the fork MUST NOT decide round 1 again (no interrupt.resolved for the gate after fromSeq)'),
    ok(!after.some((e) => e.type === 'run.completed' || e.type === 'run.failed'), 'the fork MUST wait at the gate, not settle the run'),
  ];
}
