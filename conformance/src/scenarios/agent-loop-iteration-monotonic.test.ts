/**
 * agent-loop-iteration-monotonic — RFC 0061 §B. Across a multi-turn loop,
 * `runOrchestrator.decided.iteration` increments 1, 2, 3 … exactly once per turn
 * (1-based, monotonic) — the observable counter `maxLoopIterations` bounds.
 *
 * Gated on `executionModel.version >= 5` + the host agent-loop seam; soft-skips
 * when either is absent.
 *
 * @see RFCS/0061-agent-loop-lifecycle.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readExecutionModelCap, isVersion5, invokeAgentLoop } from '../lib/agentLoop.js';

describe('agent-loop-iteration-monotonic (RFC 0061 §B)', () => {
  it('iteration increments by exactly 1 per orchestrator turn, 1-based', async () => {
    if (!isVersion5(await readExecutionModelCap())) return;
    const res = await invokeAgentLoop({ turns: 3 });
    if (res === null) return; // seam absent — soft-skip
    const decisions = res.decisions ?? [];
    expect(
      decisions.length >= 1,
      driver.describe('RFC 0061 §B', 'a multi-turn loop MUST emit one runOrchestrator.decided per turn'),
    ).toBe(true);
    const iterations = decisions.map((d) => d.iteration);
    const expected = decisions.map((_, k) => k + 1);
    expect(
      JSON.stringify(iterations),
      driver.describe('RFC 0061 §B', 'iteration MUST be 1-based + monotonic, incrementing by exactly 1 per turn'),
    ).toBe(JSON.stringify(expected));
  });
});
