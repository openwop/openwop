/**
 * run-execution-bounds-shape — RFC 0058 advertisement-shape + breach-contract
 * verification for the two run-scoped execution bounds.
 *
 * Status: ACTIVE. RFC 0058 (run execution bounds) is `Active`. The
 * `capabilities.limits.{maxRunDurationMs,maxLoopIterations}` fields and the
 * `run-duration` / `loop-iterations` kinds on `cap.breached` have landed in
 * `schemas/capabilities.schema.json` + `schemas/run-event-payloads.schema.json`.
 *
 * Always runs (shape-only): when the host advertises either limit, its value
 * MUST be well-formed. Behavior is capability- AND fixture-gated. The
 * `run-duration` (wall-clock timeout) block is now enforced + green against the
 * in-memory reference host. The `loop-iterations` block stays soft-skipped until
 * an execution-loop host advertises `multiAgent.executionModel` (RFC 0061),
 * mirroring the RFC 0052 scheduling pattern.
 *
 * What this scenario asserts:
 *   1. `capabilities.limits.maxRunDurationMs`, when present, is an integer ≥ 1000.
 *   2. `capabilities.limits.maxLoopIterations`, when present, is an integer ≥ 1.
 *   3. (gated) A run with `configurable.runTimeoutMs` below its real duration
 *      reaches terminal `failed` with `error.code = "run_timeout"` and emits
 *      `cap.breached { kind: "run-duration" }` whose `observed > limit`.
 *
 * @see RFCS/0058-run-execution-bounds.md
 * @see spec/v1/run-options.md §Reserved keys (runTimeoutMs / maxLoopIterations)
 * @see spec/v1/capabilities.md §"Engine-enforced limits and the cap.breached event"
 * @see schemas/run-event-payloads.schema.json §capBreached
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

interface DiscoveryLimits {
  maxRunDurationMs?: number;
  maxLoopIterations?: number;
}

interface DiscoveryDoc {
  capabilities?: { limits?: DiscoveryLimits };
}

interface RunEvent {
  readonly type: string;
  readonly sequence: number;
  readonly payload?: unknown;
}

const TIMEOUT_FIXTURE = 'conformance-run-duration-breach';

async function readLimits(): Promise<DiscoveryLimits | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return body?.capabilities?.limits ?? null;
}

describe('run-execution-bounds-shape: advertisement shape (RFC 0058)', () => {
  it('maxRunDurationMs is an integer >= 1000 when present', async () => {
    const limits = await readLimits();
    if (limits?.maxRunDurationMs === undefined) return; // not advertised
    expect(
      Number.isInteger(limits.maxRunDurationMs) && limits.maxRunDurationMs >= 1000,
      driver.describe(
        'capabilities.schema.json §limits.maxRunDurationMs',
        `capabilities.limits.maxRunDurationMs MUST be an integer >= 1000, got: ${limits.maxRunDurationMs}`,
      ),
    ).toBe(true);
  });

  it('maxLoopIterations is an integer >= 1 when present', async () => {
    const limits = await readLimits();
    if (limits?.maxLoopIterations === undefined) return; // not advertised
    expect(
      Number.isInteger(limits.maxLoopIterations) && limits.maxLoopIterations >= 1,
      driver.describe(
        'capabilities.schema.json §limits.maxLoopIterations',
        `capabilities.limits.maxLoopIterations MUST be an integer >= 1, got: ${limits.maxLoopIterations}`,
      ),
    ).toBe(true);
  });
});

// Behavior: capability- AND fixture-gated. Skips on hosts that do not enforce
// run-duration timeouts (incl. the reference hosts) until one wires the seam.
const SKIP_TIMEOUT = !isFixtureAdvertised(TIMEOUT_FIXTURE);

describe.skipIf(SKIP_TIMEOUT)('run-execution-bounds: run-duration breach (RFC 0058)', () => {
  it('a run with runTimeoutMs below its real duration fails with run_timeout + cap.breached{run-duration}', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: TIMEOUT_FIXTURE,
      configurable: { runTimeoutMs: 1000 },
    });
    expect(create.status, driver.describe(
      'rest-endpoints.md POST /v1/runs',
      'run creation MUST accept a runTimeoutMs override',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, driver.describe(
      'run-options.md §runTimeoutMs',
      'a run exceeding its runTimeoutMs MUST reach terminal `failed`',
    )).toBe('failed');
    expect(terminal.error?.code, driver.describe(
      'rest-endpoints.md §run_timeout',
      'RunSnapshot.error.code MUST equal "run_timeout" on wall-clock timeout',
    )).toBe('run_timeout');

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];
    const breach = events.find((e) => e.type === 'cap.breached');
    expect(breach, driver.describe(
      'capabilities.md §Engine-enforced limits',
      'a cap.breached event MUST be emitted on run-duration breach',
    )).toBeDefined();
    const payload = breach!.payload as { kind?: string; limit?: number; observed?: number } | undefined;
    expect(payload?.kind, driver.describe(
      'run-event-payloads.schema.json §capBreached.kind',
      'cap.breached payload MUST carry kind="run-duration"',
    )).toBe('run-duration');
    expect(
      typeof payload?.observed === 'number' && typeof payload?.limit === 'number' && payload!.observed > payload!.limit,
      driver.describe(
        'run-event-payloads.schema.json §capBreached.observed',
        'observed (elapsedMs) MUST be strictly greater than limit (resolved timeout)',
      ),
    ).toBe(true);
  });
});
