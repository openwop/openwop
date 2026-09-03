/**
 * Replay/fork scenarios — exercises `POST /v1/runs/{runId}:fork` per
 * `replay.md` and `rest-endpoints.md`.
 *
 * Strategy: start a `conformance-noop` run, wait for terminal, then
 * fork it. Two modes covered:
 *   - replay: re-execute from `fromSeq=0` (full replay). Should produce
 *     a new runId in terminal `completed` with no inputs change.
 *   - branch: re-execute from `fromSeq=0` with optional runOptionsOverlay.
 *
 * Plus error-path tests:
 *   - 400 on negative fromSeq.
 *   - 422 on fromSeq beyond the source run's event log length.
 *   - 400 on `replay` mode with non-empty runOptionsOverlay (per
 *     openapi.yaml — overlay is for branch only).
 *
 * Mode-enumeration gating: tests are gated on advertised
 * `capabilities.replay.modes` per
 * `spec/v1/profiles.md` §"openwop-replay-fork." A host advertising only
 * `['branch']` (e.g., OpenWOP) skip-equivalents the replay-mode
 * tests; a host advertising only `['replay']` skip-equivalents the
 * branch-mode tests. Hosts that advertise no replay capability at all
 * skip every test in this file.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { forkDeclined } from '../lib/fork-availability.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const SOURCE_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(SOURCE_WORKFLOW_ID);

async function fetchReplayModes(): Promise<readonly string[]> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return [];
  // Discovery body IS the capabilities object — `replay` lives at the
  // top level, not under a `capabilities` envelope. Matches the
  // convention in lib/profiles.ts:isReplayFork() + replayDeterminism.test.ts.
  const replay = (res.json as { replay?: { supported?: unknown; modes?: unknown } })?.replay;
  if (replay?.supported !== true) return [];
  if (!Array.isArray(replay.modes)) return [];
  return replay.modes.filter((m): m is string => typeof m === 'string');
}

async function startAndFinishNoop(): Promise<string> {
  const create = await driver.post('/v1/runs', { workflowId: SOURCE_WORKFLOW_ID });
  if (create.status !== 201) {
    throw new Error(`Failed to start ${SOURCE_WORKFLOW_ID}: ${create.status}`);
  }
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId);
  return runId;
}

describe.skipIf(SKIP_NO_NOOP)('replay: fork from fromSeq=0 in replay mode', () => {
  it('produces a new run that reaches terminal `completed`', async (ctx) => {
    const modes = await fetchReplayModes();
    if (!modes.includes('replay')) {
      // Visible skip — earlier this was a silent `return` that
      // collapsed to a vacuous pass and made it impossible to tell
      // unexercised tests apart from honest passes.
      softSkip('inapplicable', "host does not advertise the `replay` fork mode — this leg's rule has no path to apply");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!modes.includes(\'replay\')` returned early');
    }
    const sourceRunId = await startAndFinishNoop();

    const fork = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 0, mode: 'replay' },
    );

    if (forkDeclined(fork.status, 'replay fork')) return softSkip('blocked', 'precondition not met — `forkDeclined(fork.status, \'replay fork\')` returned early (seam, prior step, or fixture unavailable)');
    expect(fork.status, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'fork MUST return 201 on accepted replay',
    )).toBe(201);

    const body = fork.json as { runId?: unknown; sourceRunId?: unknown; mode?: unknown };
    expect(typeof body.runId, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 
      'replay.md',
      'fork response MUST include a new runId',
    )).toBe('string');
    expect(body.runId, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 'replay.md', 'forked runId MUST differ from source')).not.toBe(sourceRunId);
    expect(body.sourceRunId, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 
      'replay.md',
      'fork response MUST echo sourceRunId',
    )).toBe(sourceRunId);
    expect(body.mode, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 'replay.md', 'fork response MUST echo mode')).toBe('replay');

    const newRunId = body.runId as string;
    const terminal = await pollUntilTerminal(newRunId, { timeoutMs: 15_000 });
    expect(terminal.status, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed', 
      'replay.md',
      'replay of a successful run MUST reach the same terminal status',
    )).toBe('completed');
  });
});

describe.skipIf(SKIP_NO_NOOP)('replay: fork from fromSeq=0 in branch mode with empty overlay', () => {
  it('produces a new run that reaches terminal `completed`', async (ctx) => {
    const modes = await fetchReplayModes();
    if (!modes.includes('branch')) {
      softSkip('inapplicable', "host does not advertise the `branch` fork mode — this leg's rule has no path to apply");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!modes.includes(\'branch\')` returned early');
    }
    const sourceRunId = await startAndFinishNoop();

    const fork = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 0, mode: 'branch', runOptionsOverlay: {} },
    );

    if (forkDeclined(fork.status, 'branch fork')) return softSkip('blocked', 'precondition not met — `forkDeclined(fork.status, \'branch fork\')` returned early (seam, prior step, or fixture unavailable)');
    expect(fork.status, req('openwop.it.replay-fork.produces-a-new-run-that-reaches-terminal-completed~2', 
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'branch fork MUST return 201',
    )).toBe(201);

    const body = fork.json as { runId: string; mode: string };
    expect(body.mode).toBe('branch');

    const terminal = await pollUntilTerminal(body.runId, { timeoutMs: 15_000 });
    expect(terminal.status).toBe('completed');
  });
});

describe.skipIf(SKIP_NO_NOOP)('replay: validation errors', () => {
  // Earlier each of these tests had a silent `return;` early-exit
  // when the host advertised no replay modes (or only the wrong mode for
  // the assertion). That collapsed unexercised paths into vacuous green
  // — a host that didn't implement replay/fork at all "passed" every
  // validation test. Migrated to `ctx.skip()` so suite output now
  // distinguishes "skipped because host doesn't claim this surface" from
  // "exercised the validation path and got the expected error code."

  it('rejects negative fromSeq with 400', async (ctx) => {
    const modes = await fetchReplayModes();
    if (modes.length === 0) {
      softSkip('inapplicable', "host advertises no usable fork mode for this leg");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `modes.length === 0` returned early');
    }
    const mode = modes.includes('branch') ? 'branch' : 'replay';
    const sourceRunId = await startAndFinishNoop();
    const res = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: -1, mode },
    );
    expect(res.status, req('openwop.it.replay-fork.rejects-negative-fromseq-with-400', 
      'rest-endpoints.md',
      'negative fromSeq MUST return 400',
    )).toBe(400);
  });

  it('rejects fromSeq beyond source event log length with 422', async (ctx) => {
    const modes = await fetchReplayModes();
    if (modes.length === 0) {
      softSkip('inapplicable', "host advertises no usable fork mode for this leg");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `modes.length === 0` returned early');
    }
    const mode = modes.includes('branch') ? 'branch' : 'replay';
    const sourceRunId = await startAndFinishNoop();
    // conformance-noop has at most a handful of events; 99999 is
    // guaranteed to be past the end.
    const res = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      { fromSeq: 99999, mode },
    );
    expect(res.status, req('openwop.it.replay-fork.rejects-fromseq-beyond-source-event-log-length-with-422', 
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'fromSeq beyond source event log MUST return 422',
    )).toBe(422);
  });

  it('rejects replay mode with non-empty runOptionsOverlay (overlay is branch-only)', async (ctx) => {
    const modes = await fetchReplayModes();
    if (!modes.includes('replay')) {
      // The rule under test (`replay` + non-empty `runOptionsOverlay`
      // → 400) only applies on hosts that advertise the `replay` mode.
      // A `branch`-only host has no path to even attempt the request.
      // Visible skip rather than silent vacuous pass.
      softSkip('inapplicable', "host does not advertise the `replay` fork mode — the runOptionsOverlay rejection rule only applies to hosts that do");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!modes.includes(\'replay\')` returned early');
    }
    const sourceRunId = await startAndFinishNoop();
    const res = await driver.post(
      `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
      {
        fromSeq: 0,
        mode: 'replay',
        runOptionsOverlay: { configurable: { recursionLimit: 50 } },
      },
    );
    expect(res.status, req('openwop.it.replay-fork.rejects-replay-mode-with-non-empty-runoptionsoverlay-overlay-is-branch-only', 
      'rest-endpoints.md POST /v1/runs/{runId}:fork',
      'replay mode + non-empty overlay MUST return 400 (overlay is branch-only)',
    )).toBe(400);
  });

  it('rejects fork on a non-existent run with 404', async (ctx) => {
    const modes = await fetchReplayModes();
    if (modes.length === 0) {
      softSkip('inapplicable', "host advertises no usable fork mode for this leg");
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `modes.length === 0` returned early');
    }
    const mode = modes.includes('branch') ? 'branch' : 'replay';
    const res = await driver.post(
      '/v1/runs/openwop-conformance-no-such-run-id:fork',
      { fromSeq: 0, mode },
    );
    expect(
      [403, 404].includes(res.status),
      req('openwop.it.replay-fork.rejects-fork-on-a-non-existent-run-with-404', 'rest-endpoints.md', 'fork on unknown run MUST return 404 or 403'),
    ).toBe(true);
  });
});
