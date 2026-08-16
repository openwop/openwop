/**
 * agent-loop-stateful-resume — RFC 0061 §D. A loop suspended on a clarify/escalate
 * HITL interrupt resumes at the SAME iteration — the counter does not reset or
 * skip — with the snapshot lineage intact.
 *
 * Gated on `executionModel.statefulResume: true` + the host agent-loop seam;
 * soft-skips when either is absent.
 *
 * @see RFCS/0061-agent-loop-lifecycle.md §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readExecutionModelCap, invokeAgentLoop } from '../lib/agentLoop.js';

describe('agent-loop-stateful-resume (RFC 0061 §D)', () => {
  it('a mid-loop suspend resumes at the same iteration, counter intact', async () => {
    const em = await readExecutionModelCap();
    if (em?.statefulResume !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `em?.statefulResume !== true` returned early');
    // Suspend at turn 2, then resume: the resumed iteration MUST be 2, not 1 or 3.
    const res = await invokeAgentLoop({ turns: 4, suspendAtTurn: 2, resume: true });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      res.resumedIteration,
      driver.describe('RFC 0061 §D', 'a stateful resume MUST continue at the suspend iteration — the counter does not reset or skip'),
    ).toBe(2);
  });
});
