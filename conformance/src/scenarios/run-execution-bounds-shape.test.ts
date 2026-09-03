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
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
  return capabilityFamily(body, 'limits') ?? null;
}

describe('run-execution-bounds-shape: advertisement shape (RFC 0058)', () => {
  it('maxRunDurationMs is an integer >= 1000 when present', async () => {
    const limits = await readLimits();
    if (limits?.maxRunDurationMs === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `limits?.maxRunDurationMs === undefined` returned early (not advertised)'); // not advertised
    expect(
      Number.isInteger(limits.maxRunDurationMs) && limits.maxRunDurationMs >= 1000,
      req('openwop.it.run-execution-bounds-shape.maxrundurationms-is-an-integer-1000-when-present', 
        'capabilities.schema.json §limits.maxRunDurationMs',
        `capabilities.limits.maxRunDurationMs MUST be an integer >= 1000, got: ${limits.maxRunDurationMs}`,
      ),
    ).toBe(true);
  });

  it('maxLoopIterations is an integer >= 1 when present', async () => {
    const limits = await readLimits();
    if (limits?.maxLoopIterations === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `limits?.maxLoopIterations === undefined` returned early (not advertised)'); // not advertised
    expect(
      Number.isInteger(limits.maxLoopIterations) && limits.maxLoopIterations >= 1,
      req('openwop.it.run-execution-bounds-shape.maxloopiterations-is-an-integer-1-when-present', 
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
    expect(create.status, req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
      'rest-endpoints.md POST /v1/runs',
      'run creation MUST accept a runTimeoutMs override',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
      'run-options.md §runTimeoutMs',
      'a run exceeding its runTimeoutMs MUST reach terminal `failed`',
    )).toBe('failed');
    expect(terminal.error?.code, req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
      'rest-endpoints.md §run_timeout',
      'RunSnapshot.error.code MUST equal "run_timeout" on wall-clock timeout',
    )).toBe('run_timeout');

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];
    const breach = events.find((e) => e.type === 'cap.breached');
    expect(breach, req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
      'capabilities.md §Engine-enforced limits',
      'a cap.breached event MUST be emitted on run-duration breach',
    )).toBeDefined();
    const payload = breach!.payload as { kind?: string; limit?: number; observed?: number } | undefined;
    expect(payload?.kind, req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
      'run-event-payloads.schema.json §capBreached.kind',
      'cap.breached payload MUST carry kind="run-duration"',
    )).toBe('run-duration');
    // Three distinct failure modes, asserted separately and WITH THE VALUES.
    //
    // The previous form ANDed all three into one boolean over a message that
    // named none of them, so a failure said only "MUST be strictly greater" —
    // you could not tell whether `observed` was missing, equal, or smaller. A
    // tier-1 host hit this intermittently and had to reason out the mechanism
    // from first principles, because the assertion about observed values did
    // not report the observed values.
    expect(
      typeof payload?.observed,
      req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
        'run-event-payloads.schema.json §capBreached.observed',
        `cap.breached MUST carry a numeric \`observed\`; got ${JSON.stringify(payload?.observed)}`,
      ),
    ).toBe('number');
    expect(
      typeof payload?.limit,
      req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
        'run-event-payloads.schema.json §capBreached.limit',
        `cap.breached MUST carry a numeric \`limit\`; got ${JSON.stringify(payload?.limit)}`,
      ),
    ).toBe('number');

    // `capabilities.md` §"Engine-enforced limits": *"Always strictly greater
    // than limit."* This is satisfiable and it constrains the host's comparison:
    // breach when elapsed EXCEEDS the deadline, not when it reaches it. A host
    // testing `elapsed >= limit` emits `observed === limit` exactly when the
    // clock lands on the boundary — which is rare, machine-dependent, and
    // therefore reads as flake rather than as the deterministic defect it is.
    //
    // That asymmetry is why the diagnosis belongs in the message: system load
    // makes elapsed LARGER, so it makes this assertion easier to satisfy, not
    // harder. An `observed === limit` failure is not a loaded box — it is a
    // `>=` comparison in the host.
    const { observed = NaN, limit = NaN } = payload ?? {};
    expect(
      observed > limit,
      req('openwop.it.run-execution-bounds-shape.a-run-with-runtimeoutms-below-its-real-duration-fails-with-run-timeout-cap-breac', 
        'run-event-payloads.schema.json §capBreached.observed',
        `observed (elapsedMs) MUST be strictly greater than limit (resolved timeout). ` +
          `Got observed=${observed}, limit=${limit}` +
          (observed === limit
            ? '. They are EQUAL, which means the host breached at `elapsed >= limit` rather than ' +
              '`elapsed > limit`. The limit is not breached until it has been passed. This is ' +
              'deterministic in the host and only surfaces when the clock lands exactly on the ' +
              'boundary, so it presents as an intermittent failure — load makes elapsed larger and ' +
              'therefore makes this assertion PASS more often, not less.'
            : '.'),
      ),
    ).toBe(true);
  });
});
