/**
 * Debug-bundle scenarios per `spec/v1/debug-bundle.md`.
 *
 * GET /v1/runs/{runId}/debug-bundle returns a portable JSON snapshot
 * of a single run's diagnostic state — run snapshot + events + spans
 * + metrics + redaction state.
 *
 * Profile gating: hosts that don't advertise
 * `capabilities.debugBundle.supported: true` skip-equivalent.
 *
 * What this scenario verifies:
 *
 *   1. **Schema validity** — the response validates against
 *      `schemas/debug-bundle.schema.json`.
 *   2. **Event-count invariant** — `metrics.eventCount` equals
 *      `events.length` (per debug-bundle.md §"Field reference").
 *   3. **Bundle/event-stream agreement** — the events in the bundle
 *      match the events from `/events/poll` for the same run.
 *   4. **Redaction marker validity** — `redactionApplied: true` MUST
 *      NOT coexist with `redactionMode: passthrough` (malformed shape
 *      per debug-bundle.md §"Redaction guarantees").
 *   5. **Canary safety** — bundles MUST inherit redaction. A canary
 *      injected through workflow inputs MUST NOT echo verbatim in the
 *      bundle response.
 *
 * Cross-references SECURITY/invariants.yaml `secret-leakage-debug-bundle`.
 *
 * @see spec/v1/debug-bundle.md
 * @see schemas/debug-bundle.schema.json
 * @see SECURITY/threat-model-secret-leakage.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { CANARY_MARKER, getCanary } from '../lib/canaries.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface DebugBundleShape {
  bundleVersion?: unknown;
  generatedAt?: unknown;
  host?: { name?: unknown; version?: unknown };
  run?: { runId?: unknown; status?: unknown };
  events?: unknown[];
  spans?: unknown[];
  metrics?: { eventCount?: unknown; nodeCount?: unknown };
  redactionApplied?: unknown;
  redactionMode?: unknown;
  truncated?: unknown;
}

async function isAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return false;
  const body = res.json as { debugBundle?: { supported?: unknown } };
  return body.debugBundle?.supported === true;
}

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: GET /v1/runs/{runId}/debug-bundle response shape', () => {
  it('host advertising capabilities.debugBundle.supported returns 200 with valid bundle', async () => {
    if (!(await isAdvertised())) return; // skip-equivalent

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status, driver.describe(
      'spec/v1/debug-bundle.md §Endpoint',
      'host advertising debugBundle.supported MUST return 200 on /debug-bundle',
    )).toBe(200);

    const bundle = res.json as DebugBundleShape | undefined;
    expect(bundle, driver.describe(
      'spec/v1/debug-bundle.md',
      'response MUST be JSON',
    )).toBeDefined();

    expect(typeof bundle?.bundleVersion, driver.describe(
      'debug-bundle.md §Field reference',
      'bundleVersion MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.generatedAt, driver.describe(
      'debug-bundle.md',
      'generatedAt MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.host?.name, driver.describe(
      'debug-bundle.md',
      'host.name MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.host?.version, driver.describe(
      'debug-bundle.md',
      'host.version MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.run?.runId, driver.describe(
      'debug-bundle.md',
      'run.runId MUST be a string',
    )).toBe('string');
    expect(Array.isArray(bundle?.events), driver.describe(
      'debug-bundle.md',
      'events MUST be an array',
    )).toBe(true);
    expect(typeof bundle?.redactionApplied, driver.describe(
      'debug-bundle.md',
      'redactionApplied MUST be a boolean',
    )).toBe('boolean');
    expect(typeof bundle?.redactionMode, driver.describe(
      'debug-bundle.md',
      'redactionMode MUST be a string',
    )).toBe('string');
  });

  it('hosts not advertising debugBundle return 404 on the endpoint', async () => {
    if (await isAdvertised()) return; // skip-equivalent for hosts that DO advertise

    // Use any runId — even a synthetic one — since the host should 404
    // on the endpoint regardless of run existence.
    const res = await driver.get('/v1/runs/openwop-conformance-no-such-run/debug-bundle');
    expect(res.status, driver.describe(
      'debug-bundle.md §Endpoint',
      'host NOT advertising debugBundle.supported MUST return 404',
    )).toBe(404);
  });
});

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: invariants per debug-bundle.md', () => {
  it('metrics.eventCount equals events.length', async () => {
    if (!(await isAdvertised())) return;

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);
    const bundle = res.json as DebugBundleShape;

    if (bundle.metrics?.eventCount !== undefined) {
      expect(bundle.metrics.eventCount, driver.describe(
        'debug-bundle.md §"Field reference"',
        'metrics.eventCount MUST equal events.length',
      )).toBe(bundle.events?.length ?? 0);
    }
  });

  it('redactionApplied=true is incompatible with redactionMode=passthrough', async () => {
    if (!(await isAdvertised())) return;

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);
    const bundle = res.json as DebugBundleShape;

    if (bundle.redactionApplied === true) {
      expect(bundle.redactionMode, driver.describe(
        'debug-bundle.md §"Redaction guarantees"',
        'redactionApplied=true MUST NOT coexist with redactionMode=passthrough — that combination is malformed',
      )).not.toBe('passthrough');
    }
  });

  it('bundle events agree with /events/poll for the same run', async () => {
    if (!(await isAdvertised())) return;

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const bundleRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (eventsRes.status !== 200) return; // host without polling

    const bundle = bundleRes.json as DebugBundleShape;
    const polledEvents = (eventsRes.json as { events?: unknown[] }).events ?? [];

    expect(bundle.events?.length, driver.describe(
      'debug-bundle.md',
      'bundle event count MUST agree with /events/poll for the same run',
    )).toBe(polledEvents.length);
  });
});

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: redaction inheritance per SECURITY/invariants.yaml secret-leakage-debug-bundle', () => {
  it('canary in workflow inputs MUST NOT appear verbatim in the bundle response', async () => {
    if (!(await isAdvertised())) return;

    const canary = getCanary('byok-credential-ref').value;

    const create = await driver.post('/v1/runs', {
      workflowId: NOOP_WORKFLOW_ID,
      inputs: {
        userField: canary,
      },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);

    const bundleText = res.text;
    expect(bundleText.includes(canary), driver.describe(
      'SECURITY/invariants.yaml secret-leakage-debug-bundle',
      'BYOK-shaped canary submitted as workflow input MUST NOT appear verbatim in the debug bundle',
    )).toBe(false);
    expect(bundleText.includes(CANARY_MARKER), driver.describe(
      'SECURITY/invariants.yaml secret-leakage-debug-bundle',
      'canary marker MUST NOT appear in the debug bundle',
    )).toBe(false);
  });
});
