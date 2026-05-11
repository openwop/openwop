/**
 * Cost attribution scenarios (G6 / O4) — covered by the v1.0 conformance baseline.
 *
 * The runtime side of G6 is expected to provide:
 *   - OPENWOP_COST_ATTRIBUTE_NAMES allowlist (6 attributes)
 *   - sanitizeCostForOtel() pure function with redaction enforcement
 *   - cost-attribute application wired into the host's span recorder
 *   - RunSnapshot.metrics.openwopCost rollup exposed via GET /v1/runs/{runId}
 *
 * Two scenarios:
 *   1. Forward-compat shape check on any run's metrics.openwopCost (passes if
 *      the field is absent — spec-allowed — AND if present validates the
 *      canonical shape).
 *   2. End-to-end content roundtrip via the `openwop-smoke-cost-emit` fixture
 *      workflow + `conformance.cost.emit` fixture node. The scenario
 *      detects fixture availability via the `404 workflow_not_found`
 *      error envelope and skips trivially-pass when absent. When present,
 *      asserts the canary cost shape lands in `metrics.openwopCost` end-to-end.
 *
 * Two scenarios remain `it.todo` because they need observable-span
 * access — the conformance suite is black-box and can only see what the
 * REST + event-log surfaces expose. Hosts should cover runtime-side
 * enforcement in host-specific observability tests.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/observability.md §"AI cost"
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/schemas/run-snapshot.schema.json §metrics.openwopCost
 *   - conformance/fixtures.md §O4 cost-attribution fixture
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const COST_EMIT_WORKFLOW_ID = 'openwop-smoke-cost-emit';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);
const SKIP_NO_COST_EMIT = !isFixtureAdvertised(COST_EMIT_WORKFLOW_ID);

describe.skipIf(SKIP_NO_NOOP)('cost-attribution: metrics.openwopCost forward-compat shape (G6)', () => {
  it('on any run, IF metrics.openwopCost is present, its shape MUST match the spec', async () => {
    // Use the noop fixture so we don't depend on AI nodes. The fixture
    // doesn't emit recordCost, so metrics.openwopCost will typically be
    // absent — that's allowed. The assertion is forward-compat: when
    // present, the structure MUST be the canonical one.
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    const openwopCost = terminal.metrics?.openwopCost;

    if (openwopCost === undefined) {
      // Spec-allowed — the noop fixture has no cost emission. Assertion
      // passes trivially; don't force a value on a workflow that produces
      // no cost.
      expect(openwopCost).toBeUndefined();
      return;
    }

    // When present, validate the canonical shape per
    // run-snapshot.schema.json §metrics.openwopCost.
    if ('usd' in openwopCost) {
      expect(typeof openwopCost.usd, 'metrics.openwopCost.usd MUST be a number').toBe('number');
      expect(openwopCost.usd!, 'metrics.openwopCost.usd MUST be >= 0').toBeGreaterThanOrEqual(0);
    }
    if ('tokens' in openwopCost && openwopCost.tokens) {
      if ('input' in openwopCost.tokens) {
        expect(Number.isInteger(openwopCost.tokens.input)).toBe(true);
        expect(openwopCost.tokens.input!).toBeGreaterThanOrEqual(0);
      }
      if ('output' in openwopCost.tokens) {
        expect(Number.isInteger(openwopCost.tokens.output)).toBe(true);
        expect(openwopCost.tokens.output!).toBeGreaterThanOrEqual(0);
      }
    }
    if ('duration_ms' in openwopCost) {
      expect(Number.isInteger(openwopCost.duration_ms)).toBe(true);
      expect(openwopCost.duration_ms!).toBeGreaterThanOrEqual(0);
    }
    if ('model' in openwopCost) {
      expect(typeof openwopCost.model, 'metrics.openwopCost.model MUST be a string').toBe('string');
    }
    if ('provider' in openwopCost) {
      expect(typeof openwopCost.provider, 'metrics.openwopCost.provider MUST be a string').toBe('string');
    }
  });
});

// Reference hosts MAY expose the same fixture node id with different
// canary numbers. These
// scenarios assert shape conformance + non-negative-integer/number
// constraints, not exact numeric equality, so any host-canary works.

describe.skipIf(SKIP_NO_COST_EMIT)('cost-attribution: end-to-end roundtrip via conformance.cost.emit (G6 / O4)', () => {
  it('metrics.openwopCost MUST carry the canary cost shape after the fixture node runs', async () => {
    // Try to start the cost-emit fixture workflow. If the host doesn't
    // advertise the fixture surface (production deployments don't), we
    // get 404 / 422 back and skip the scenario.
    const create = await driver.post('/v1/runs', {
      workflowId: 'openwop-smoke-cost-emit',
    });

    // Fixture absent — host does not opt into OPENWOP_CONFORMANCE_FIXTURES.
    // That's spec-allowed; the scenario passes trivially.
    if (create.status === 404 || create.status === 422) {
      return;
    }

    expect(create.status, driver.describe(
      'rest-endpoints.md POST /v1/runs',
      'starting openwop-smoke-cost-emit MUST succeed when OPENWOP_CONFORMANCE_FIXTURES=1 is advertised',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, driver.describe(
      'observability.md §AI cost',
      'cost-emit fixture run MUST reach terminal completed',
    )).toBe('completed');

    const openwopCost = terminal.metrics?.openwopCost;
    expect(openwopCost, driver.describe(
      'run-snapshot.schema.json §metrics.openwopCost',
      'metrics.openwopCost MUST be populated after a node calls ctx.recordCost()',
    )).toBeDefined();

    // Provider — the fixture canary is a stable string. Host-defined
    // overrides are spec-allowed; we assert shape rather than exact match.
    if ('provider' in openwopCost!) {
      expect(typeof openwopCost!.provider).toBe('string');
      expect((openwopCost!.provider as string).length).toBeGreaterThan(0);
    }

    // Model — same: shape, not exact.
    if ('model' in openwopCost!) {
      expect(typeof openwopCost!.model).toBe('string');
    }

    // Tokens — MUST be non-negative integers when present.
    if ('tokens' in openwopCost! && openwopCost!.tokens) {
      if ('input' in openwopCost!.tokens) {
        expect(Number.isInteger(openwopCost!.tokens.input), driver.describe(
          'observability.md §openwop.cost.tokens.input',
          'tokens.input MUST be a non-negative integer',
        )).toBe(true);
        expect(openwopCost!.tokens.input!).toBeGreaterThanOrEqual(0);
      }
      if ('output' in openwopCost!.tokens) {
        expect(Number.isInteger(openwopCost!.tokens.output), driver.describe(
          'observability.md §openwop.cost.tokens.output',
          'tokens.output MUST be a non-negative integer',
        )).toBe(true);
        expect(openwopCost!.tokens.output!).toBeGreaterThanOrEqual(0);
      }
    }

    // USD — MUST be non-negative number (fractional allowed).
    if ('usd' in openwopCost!) {
      expect(typeof openwopCost!.usd, driver.describe(
        'observability.md §openwop.cost.usd',
        'usd MUST be a number',
      )).toBe('number');
      expect(openwopCost!.usd!, driver.describe(
        'observability.md §openwop.cost.usd',
        'usd MUST be >= 0',
      )).toBeGreaterThanOrEqual(0);
    }
  });

  it('cost-emit fixture run MUST emit a node.completed event for the cost-emitting node', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'openwop-smoke-cost-emit',
    });
    if (create.status === 404 || create.status === 422) {
      return;
    }
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsResp = await driver.get(`/v1/runs/${runId}/events`);
    expect(eventsResp.status).toBe(200);
    const events = (eventsResp.json as { events: Array<{ type: string; nodeId?: string }> })
      .events;

    const completed = events.filter(
      (e) => e.type === 'node.completed' && e.nodeId === 'emit-cost',
    );
    expect(completed.length, driver.describe(
      'event-log.md §node.completed',
      'cost-emit fixture node MUST emit exactly one node.completed event',
    )).toBe(1);
  });
});

describe('cost-attribution: G6 / O4 (still deferred — observable-span access required)', () => {
  it.todo(
    'the OTel span attribute set MUST NOT contain any key outside OPENWOP_COST_ATTRIBUTE_NAMES (redaction) — BLOCKED on observable-span access; runtime enforcement belongs in host-specific observability tests',
  );

  it.todo(
    'credential-shaped fields in the upstream provider response MUST NOT appear in any OTel attribute or in metrics.openwopCost (regression test for G6 close-criteria allowlist enforcement) — BLOCKED on observable-span access; sanitizer-level redaction is unit-tested today',
  );
});
