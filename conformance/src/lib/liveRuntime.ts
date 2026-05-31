/**
 * Shared helpers for the RFC 0077 `agents.liveRuntime` conformance scenarios.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/liveRuntime.js`.
 *
 * RFC 0077 adds NO new endpoint — a live manifest invocation rides the existing
 * run surface (agent as root of `POST /v1/runs`, a `WorkflowNode.agent` step, or
 * a chat `@mention`) and brackets the existing `agent.*` family with
 * `agent.invocation.started` / `agent.invocation.completed`. To drive one
 * deterministically in conformance, the host exposes the OPTIONAL sample seam
 * `POST /v1/host/sample/agents/live-invoke` returning `{ runId, invocationId }`;
 * the bracketed events are read back via the test event-log seam. The seam is
 * deferred per RFC 0077 §Conformance, so scenarios soft-skip on 404/405.
 *
 * @see RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md
 * @see spec/v1/multi-agent-execution.md §"Live manifest dispatch"
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.liveRuntime` from discovery (root-first per RFC 0073); null
 *  when unadvertised. */
export async function readLiveRuntimeCap(): Promise<Record<string, unknown> | null> {
  const agents = await readCapabilityFamily<{ liveRuntime?: unknown }>('agents');
  const lr = agents?.liveRuntime;
  return lr && typeof lr === 'object' ? (lr as Record<string, unknown>) : null;
}

export interface LiveInvokeResult {
  runId?: string;
  invocationId?: string;
  outcome?: string;
}

/**
 * Drive one live manifest invocation via the host-sample seam. Body fields:
 *   - `agentId` (optional): the manifest agent to invoke; host picks a default
 *     when omitted.
 *   - `source` (optional): `workflow-node` | `run-api` | `chat-mention`.
 *   - `returnSchemaRef` (optional) + `forceInvalidResult` (optional): exercise
 *     the §B step-6 structured-output enforcement — force a result that violates
 *     the handoff schema so a `structuredOutput` host fails the run.
 *   - `attemptTool` (optional): the id of a tool OUTSIDE the agent's
 *     `toolAllowlist` the invocation should attempt (the §F-1 allowlist floor).
 * Returns null when the seam is unwired (404/405).
 */
export async function invokeLive(
  body: {
    agentId?: string;
    source?: string;
    returnSchemaRef?: string;
    forceInvalidResult?: boolean;
    attemptTool?: string;
  } = {},
): Promise<LiveInvokeResult | null> {
  const res = await driver.post('/v1/host/sample/agents/live-invoke', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as LiveInvokeResult | undefined) ?? {};
}
