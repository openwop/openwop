/**
 * Agent eval-run — the `mode:"eval"` projection (RFC 0081 §B/§C) — behavioral.
 *
 * Capability-gated on `agents.evalSuite.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `agent-eval-suite-shape.test.ts`; this asserts host BEHAVIOR via the
 * `POST /v1/host/sample/agents/eval-run` seam + the test event-log seam + the
 * NORMATIVE `GET /v1/runs/{runId}/eval-summary` read:
 *
 *   1. ORDERING (§C) — an eval run emits `eval.started` FIRST, one `eval.scored`
 *      per task, then `eval.completed` once (count == eval.completed.taskCount).
 *   2. CONTENT-FREE (SR-1 / `eval-summary-no-content-leak`) — every `eval.scored`
 *      carries scores / ids / scalars ONLY (never task output / rubric / prose);
 *      `score` ∈ 0..1; `passed` is a boolean.
 *   3. NORMATIVE SUMMARY (§C) — `GET /v1/runs/{runId}/eval-summary` returns a
 *      schema-valid `EvalSummary` whose `passedCount <= taskCount` and whose
 *      task entries carry no output body.
 *
 * Each leg soft-skips independently (seam absent / event-log seam absent).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-evaluation.md (§B/§C)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0081-agent-evaluation-and-scorecards.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import {
  readEvalSuiteCap,
  driveEvalRun,
  getEvalSummary,
  EVAL_CONTENT_FORBIDDEN,
} from '../lib/agentEval.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

function expectContentFree(payload: Record<string, unknown>, where: string): void {
  for (const f of EVAL_CONTENT_FORBIDDEN) {
    expect(
      !(f in payload),
      driver.describe('RFC 0081 §C (eval-summary-no-content-leak)', `${where} MUST be content-free (no ${f})`),
    ).toBe(true);
  }
}

describe('agent-eval-run (RFC 0081 §B/§C)', () => {
  it('emits eval.started → per-task eval.scored → eval.completed and serves a content-free EvalSummary', async () => {
    const cap = await readEvalSuiteCap();
    if (!behaviorGate('openwop-eval-run', cap?.supported === true)) return;
    if (!(await isEventLogSeamAvailable())) return; // event-log seam absent — soft-skip

    const run = await driveEvalRun({ modes: ['golden'] });
    if (run === null) return; // eval-run seam unwired — soft-skip the whole behavioral suite

    // From here the host has ADVERTISED agents.evalSuite AND wired the eval-run
    // seam — missing evidence is a FAILURE, not a soft-skip. A host claiming the
    // capability MUST produce the runId, the full eval.* sequence, and the
    // normative EvalSummary, or it is advertising a capability it doesn't deliver.
    expect(
      typeof run.runId === 'string' && run.runId.length > 0,
      driver.describe('agent-evaluation.md §B', 'a wired eval-run seam MUST return the projected runId'),
    ).toBe(true);
    const runId = run.runId as string;

    // ---- Legs 1+2: eval.* ordering + content-free (§C) -------------------
    const startedQ = await queryTestEvents(runId, { type: 'eval.started' });
    const scoredQ = await queryTestEvents(runId, { type: 'eval.scored' });
    const completedQ = await queryTestEvents(runId, { type: 'eval.completed' });

    // The event-log seam MUST return the eval.* events for a wired eval run
    // (requireEvents hard-fails if a leg's query is not ok — no vacuous pass).
    const startedEvents = requireEvents(startedQ, 'eval.started');
    const scoredEvents = requireEvents(scoredQ, 'eval.scored');
    const completedEvents = requireEvents(completedQ, 'eval.completed');

    // eval.started exactly once (FIRST); eval.completed exactly once (LAST);
    // ≥1 eval.scored — a wired eval run MUST emit the full sequence.
    expect(
      startedEvents.length === 1,
      driver.describe('agent-evaluation.md §C', 'an eval run MUST emit exactly one eval.started'),
    ).toBe(true);
    expect(
      scoredEvents.length >= 1,
      driver.describe('agent-evaluation.md §C', 'an eval run MUST emit at least one eval.scored'),
    ).toBe(true);
    expect(
      completedEvents.length === 1,
      driver.describe('agent-evaluation.md §C', 'an eval run MUST emit exactly one eval.completed'),
    ).toBe(true);
    const started = startedEvents[0]!;
    const completed = completedEvents[0]!;

    // Ordering: eval.started precedes every eval.scored precedes eval.completed.
    for (const s of scoredEvents) {
      expect(
        started.sequence < s.sequence,
        driver.describe('agent-evaluation.md §C', 'eval.started MUST precede every eval.scored'),
      ).toBe(true);
      expect(
        s.sequence < completed.sequence,
        driver.describe('agent-evaluation.md §C', 'every eval.scored MUST precede eval.completed'),
      ).toBe(true);
    }

    // One eval.scored per task (count == eval.completed.taskCount).
    expect(
      typeof completed.payload.taskCount === 'number',
      driver.describe('run-event-payloads.schema.json#/$defs/evalCompleted', 'eval.completed MUST carry a numeric taskCount'),
    ).toBe(true);
    expect(
      scoredEvents.length === completed.payload.taskCount,
      driver.describe('agent-evaluation.md §C', 'one eval.scored per task (count == eval.completed.taskCount)'),
    ).toBe(true);

    // Content-free (§C / eval-summary-no-content-leak) + score ∈ 0..1, passed boolean.
    expectContentFree(started.payload, 'eval.started');
    expectContentFree(completed.payload, 'eval.completed');
    for (const s of scoredEvents) {
      expectContentFree(s.payload, 'eval.scored');
      expect(
        typeof s.payload.score === 'number' && (s.payload.score as number) >= 0 && (s.payload.score as number) <= 1,
        driver.describe('run-event-payloads.schema.json#/$defs/evalScored', 'eval.scored.score MUST be in 0..1'),
      ).toBe(true);
      expect(
        typeof s.payload.passed === 'boolean',
        driver.describe('run-event-payloads.schema.json#/$defs/evalScored', 'eval.scored.passed MUST be a boolean'),
      ).toBe(true);
    }

    // ---- Leg 3: NORMATIVE EvalSummary read (§C) — MUST serve a 200 -------
    const { status, summary } = await getEvalSummary(runId);
    expect(
      status === 200 && summary !== undefined,
      driver.describe('agent-evaluation.md §C', `GET /v1/runs/{runId}/eval-summary MUST serve a 200 EvalSummary for a completed eval run (got ${status})`),
    ).toBe(true);
    const sum = summary as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema('eval-summary.schema.json'));
    expect(
      validate(sum),
      driver.describe('eval-summary.schema.json', `EvalSummary MUST be schema-valid (${ajv.errorsText(validate.errors)})`),
    ).toBe(true);

    const tasks = (sum.tasks as Array<Record<string, unknown>> | undefined) ?? [];
    const passedCount = sum.passedCount as number | undefined;
    const taskCount = sum.taskCount as number | undefined;
    expect(
      typeof passedCount === 'number' && typeof taskCount === 'number',
      driver.describe('eval-summary.schema.json', 'EvalSummary MUST carry numeric passedCount + taskCount'),
    ).toBe(true);
    expect(
      (passedCount as number) <= (taskCount as number),
      driver.describe('agent-evaluation.md §C', 'EvalSummary.passedCount MUST NOT exceed taskCount'),
    ).toBe(true);
    for (const t of tasks) {
      expectContentFree(t, 'EvalSummary.tasks[]');
    }

    await resetTestSeam();
  });
});
