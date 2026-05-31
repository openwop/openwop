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
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

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
    if (!run.runId) return;

    // ---- Legs 1+2: eval.* ordering + content-free (§C) -------------------
    const startedQ = await queryTestEvents(run.runId, { type: 'eval.started' });
    const scoredQ = await queryTestEvents(run.runId, { type: 'eval.scored' });
    const completedQ = await queryTestEvents(run.runId, { type: 'eval.completed' });

    if (startedQ.ok && scoredQ.ok && startedQ.events.length > 0) {
      const started = startedQ.events.sort((a, b) => a.sequence - b.sequence)[0]!;

      // eval.started precedes every eval.scored (§C ordering).
      for (const s of scoredQ.events) {
        expect(
          started.sequence < s.sequence,
          driver.describe('agent-evaluation.md §C', 'eval.started MUST precede every eval.scored'),
        ).toBe(true);
      }

      if (completedQ.ok && completedQ.events.length > 0) {
        const completed = completedQ.events.sort((a, b) => a.sequence - b.sequence)[completedQ.events.length - 1]!;
        for (const s of scoredQ.events) {
          expect(
            s.sequence < completed.sequence,
            driver.describe('agent-evaluation.md §C', 'every eval.scored MUST precede eval.completed'),
          ).toBe(true);
        }
        // eval.scored is emitted once per task (count == eval.completed.taskCount).
        if (typeof completed.payload.taskCount === 'number') {
          expect(
            scoredQ.events.length === completed.payload.taskCount,
            driver.describe('agent-evaluation.md §C', 'one eval.scored per task (count == eval.completed.taskCount)'),
          ).toBe(true);
        }
        expectContentFree(completed.payload, 'eval.completed');
      }

      // each eval.scored content-free + score ∈ 0..1, passed boolean.
      for (const s of scoredQ.events) {
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
      expectContentFree(started.payload, 'eval.started');
    }

    // ---- Leg 3: NORMATIVE EvalSummary read (§C) --------------------------
    const { status, summary } = await getEvalSummary(run.runId);
    if (status === 200 && summary) {
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(loadSchema('eval-summary.schema.json'));
      expect(
        validate(summary),
        driver.describe(
          'eval-summary.schema.json',
          `GET /v1/runs/{runId}/eval-summary MUST return a schema-valid EvalSummary (${ajv.errorsText(validate.errors)})`,
        ),
      ).toBe(true);

      const tasks = (summary.tasks as Array<Record<string, unknown>> | undefined) ?? [];
      const passedCount = summary.passedCount as number | undefined;
      const taskCount = summary.taskCount as number | undefined;
      if (typeof passedCount === 'number' && typeof taskCount === 'number') {
        expect(
          passedCount <= taskCount,
          driver.describe('agent-evaluation.md §C', 'EvalSummary.passedCount MUST NOT exceed taskCount'),
        ).toBe(true);
      }
      for (const t of tasks) {
        expectContentFree(t, 'EvalSummary.tasks[]');
      }
    }

    await resetTestSeam();
  });
});
