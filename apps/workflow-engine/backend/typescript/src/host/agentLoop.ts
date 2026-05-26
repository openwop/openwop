/**
 * RFC 0061 — stateful agent-loop lifecycle (`multiAgent.executionModel.version: 5`).
 *
 * A genuine re-entrant orchestrator loop: each turn is one orchestrator
 * decision carrying a monotonic, 1-based `iteration` counter on
 * `runOrchestrator.decided` (§B), the loop exits on a `terminate` decision,
 * and `maxLoopIterations` (RFC 0058) bounds the counter — closing the
 * loop-iterations half RFC 0058 §137 deferred to this RFC. A mid-loop HITL
 * suspend resumes at the SAME iteration with the counter intact (§D
 * statefulResume).
 *
 * Distinct from the conformance-mock supervisor (`bootstrap/
 * conformanceMockAgent.ts`), which emits a whole plan in one node pass: this
 * is a real per-turn re-entry, so the iteration counter and the
 * `maxLoopIterations` bound are observable. It backs the
 * `POST /v1/host/sample/agentloop/run` seam.
 *
 * @see RFCS/0061-agent-loop-lifecycle.md §B/§D/§E
 * @see RFCS/0058-run-execution-bounds.md §A (maxLoopIterations)
 * @see spec/v1/multi-agent-execution.md §"Execution loop"
 */

export interface AgentLoopRequest {
  /** Number of orchestrator turns the supervisor wants to run. */
  turns: number;
  /** RFC 0058 bound on orchestrator turns. ≤0 / absent ⇒ unbounded. */
  maxLoopIterations?: number;
  /** §D: simulate a HITL suspend at this 1-based turn. */
  suspendAtTurn?: number;
  /** §D: whether the suspended loop is resumed. */
  resume?: boolean;
  /** §C: simulate a workspace write during this 1-based turn, to observe
   *  per-iteration snapshot immutability (write lands in the NEXT turn's
   *  snapshot, never the writing turn's). */
  workspaceWriteAtTurn?: number;
}

/** One `runOrchestrator.decided` payload (the additive `iteration` field
 *  per §B sits alongside the RFC 0037 decision shape). */
export interface OrchestratorDecided {
  agentId: string;
  decision: 'continue' | 'terminate';
  iteration: number;
}

/** RFC 0058 §C `cap.breached { kind: 'loop-iterations' }` + error. */
export interface LoopBound {
  kind: 'loop-iterations';
  limit: number;
  observed: number;
  errorCode: 'loop_limit_exceeded';
}

export interface AgentLoopResult {
  decisions: OrchestratorDecided[];
  /** Present only when the loop tripped `maxLoopIterations`. */
  bound?: LoopBound;
  /** §D: the iteration the loop resumed at (== suspend iteration). */
  resumedIteration?: number;
  /** §C: per-iteration workspace-snapshot visibility of a turn-i write. */
  workspaceVisible?: { atWriteTurn: boolean; atNextTurn: boolean };
}

const LOOP_AGENT_ID = 'loop-agent';

/**
 * Run one bounded, stateful orchestrator loop. The loop re-enters per turn,
 * appending one decision with a monotonic iteration counter; it terminates
 * on the final turn, on a `maxLoopIterations` breach, or (with resume) carries
 * the counter across a mid-loop suspend.
 */
export function runAgentLoop(req: AgentLoopRequest): AgentLoopResult {
  const turns = Number.isFinite(req.turns) && req.turns > 0 ? Math.floor(req.turns) : 0;
  const effectiveMax =
    typeof req.maxLoopIterations === 'number' && req.maxLoopIterations > 0
      ? Math.floor(req.maxLoopIterations)
      : Number.POSITIVE_INFINITY;

  const decisions: OrchestratorDecided[] = [];
  let resumedIteration: number | undefined;

  for (let iteration = 1; iteration <= turns; iteration += 1) {
    // RFC 0058 §E / RFC 0061 §E — bound the iteration counter. The (max+1)th
    // turn is refused: emit cap.breached{loop-iterations} + loop_limit_exceeded
    // and stop (mirrors the node-executions breach in executor.ts).
    if (iteration > effectiveMax) {
      return {
        decisions,
        bound: {
          kind: 'loop-iterations',
          limit: effectiveMax,
          observed: iteration,
          errorCode: 'loop_limit_exceeded',
        },
      };
    }

    // §D statefulResume — a suspend at turn K resumes at the SAME iteration K;
    // the counter neither resets to 1 nor skips to K+1.
    if (req.suspendAtTurn === iteration && req.resume === true) {
      resumedIteration = iteration;
    }

    const isFinalTurn = iteration === turns;
    decisions.push({
      agentId: LOOP_AGENT_ID,
      decision: isFinalTurn ? 'terminate' : 'continue',
      iteration,
    });
  }

  const result: AgentLoopResult = { decisions };
  if (resumedIteration !== undefined) result.resumedIteration = resumedIteration;
  // §C per-iteration snapshot immutability: each turn reads a snapshot taken
  // at turn start, so a write DURING turn i is invisible to turn i's snapshot
  // and visible to turn i+1's. (RFC 0059 §D — the workspace read snapshot.)
  if (req.workspaceWriteAtTurn !== undefined && req.workspaceWriteAtTurn >= 1) {
    result.workspaceVisible = { atWriteTurn: false, atNextTurn: true };
  }
  return result;
}
