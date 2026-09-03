/**
 * agent-loop-workspace-snapshot — RFC 0061 §C. A workspace PUT during turn i is
 * invisible to turn i's snapshot and visible to turn i+1 — per-iteration
 * snapshot immutability (writes land next turn, never retroactively).
 *
 * Gated on `executionModel.version >= 5` AND `host.workspace.supported` + the
 * host agent-loop seam; soft-skips when any is absent.
 *
 * @see RFCS/0061-agent-loop-lifecycle.md §C
 * @see RFCS/0059-agent-workspace.md §D — the workspace read snapshot
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readExecutionModelCap, isVersion5, hasWorkspace, invokeAgentLoop } from '../lib/agentLoop.js';
import { req } from '../lib/requirement-ids.js';

describe('agent-loop-workspace-snapshot (RFC 0061 §C)', () => {
  it('a turn-i workspace write is invisible to turn i, visible to turn i+1', async () => {
    if (!isVersion5(await readExecutionModelCap())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isVersion5(await readExecutionModelCap())` returned early');
    if (!(await hasWorkspace())) return softSkip('inapplicable', 'workspace optional — soft-skip (!(await hasWorkspace()))');
    const res = await invokeAgentLoop({ turns: 2, workspaceWriteAtTurn: 1 });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    const vis = res.workspaceVisible ?? {};
    expect(
      vis.atWriteTurn,
      req('openwop.it.agent-loop-workspace-snapshot.a-turn-i-workspace-write-is-invisible-to-turn-i-visible-to-turn-i-1', 'RFC 0061 §C', 'a workspace write during turn i MUST be invisible to turn i\'s snapshot'),
    ).toBe(false);
    expect(
      vis.atNextTurn,
      req('openwop.it.agent-loop-workspace-snapshot.a-turn-i-workspace-write-is-invisible-to-turn-i-visible-to-turn-i-1', 'RFC 0061 §C', 'a workspace write during turn i MUST be visible to turn i+1'),
    ).toBe(true);
  });
});
