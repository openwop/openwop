/**
 * Live manifest-dispatch tool-allowlist enforcement (RFC 0077 §F-1) —
 * behavioral.
 *
 * Gated on `capabilities.agents.liveRuntime.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * Asserts the §F-1 safety carry-forward: a live invocation MUST NOT call a tool
 * outside the agent's `toolAllowlist` (the per-tool application of the RFC 0002
 * §A14 mandatory-allowlist floor). Driven by the `attemptTool` seam param naming
 * a disallowed tool; the invocation MUST NOT emit an `agent.toolCalled` for it
 * (a refused/failed outcome is acceptable, a silent successful call is not).
 * Soft-skips when the seam/hook is unwired.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md (§"Live manifest dispatch")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md (§F-1)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0002-agent-identity-and-handoff.md (§A14 toolAllowlist)
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readLiveRuntimeCap, invokeLive } from '../lib/liveRuntime.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const DISALLOWED_TOOL = 'conformance-disallowed-tool';

describe('agent-live-allowlist-enforced (RFC 0077 §F-1)', () => {
  it('does not call a tool outside the agent toolAllowlist', async () => {
    const cap = await readLiveRuntimeCap();
    if (!behaviorGate('openwop-live-allowlist-enforced', cap?.supported === true)) return;

    if (!(await isEventLogSeamAvailable())) return softSkip('blocked', 'precondition not met — `!(await isEventLogSeamAvailable())` returned early (soft-skip) (seam, prior step, or fixture unavailable)'); // soft-skip
    const res = await invokeLive({ source: 'run-api', attemptTool: DISALLOWED_TOOL });
    if (res === null || !res.runId) return softSkip('blocked', 'precondition not met — `res === null || !res.runId` returned early (seam/hook absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam/hook absent — soft-skip

    const q = await queryTestEvents(res.runId, { type: 'agent.toolCalled' });
    if (!q.ok) return softSkip('blocked', 'precondition not met — `!q.ok` returned early (seam, prior step, or fixture unavailable)');

    const calledDisallowed = q.events.some((e) => {
      const tool = e.payload.tool ?? e.payload.toolId ?? e.payload.name;
      return tool === DISALLOWED_TOOL;
    });
    expect(
      calledDisallowed === false,
      req('openwop.it.agent-live-allowlist-enforced.does-not-call-a-tool-outside-the-agent-toolallowlist', 'RFC 0077 §F-1 / RFC 0002 §A14', 'a live invocation MUST NOT call a tool outside the agent toolAllowlist'),
    ).toBe(true);

    await resetTestSeam();
  });
});
