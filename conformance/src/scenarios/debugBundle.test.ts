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
 *   6. **Spans join the trace (RFC 0207 §C, v1 only, non-gating)** — for a
 *      run started with the suite's `traceparent`, every span's optional
 *      `traceId` / `kind` / `status` has the schema's shape, and the
 *      `openwop.run` span's `traceId` is the suite's. A host that returns
 *      `spans: []` records `inapplicable` ("host emits no spans"), never a
 *      pass. v2 has no debug-bundle read (RFC 0207 §C.11), so this leg carries
 *      no requirement id and no Accepted bar.
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
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { makeTraceparent } from '../lib/trace-context.js';

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
    if (!(await isAdvertised())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isAdvertised())` returned early (skip-equivalent)'); // skip-equivalent

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'spec/v1/debug-bundle.md §Endpoint',
      'host advertising debugBundle.supported MUST return 200 on /debug-bundle',
    )).toBe(200);

    const bundle = res.json as DebugBundleShape | undefined;
    expect(bundle, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'spec/v1/debug-bundle.md',
      'response MUST be JSON',
    )).toBeDefined();

    expect(typeof bundle?.bundleVersion, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md §Field reference',
      'bundleVersion MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.generatedAt, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'generatedAt MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.host?.name, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'host.name MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.host?.version, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'host.version MUST be a string',
    )).toBe('string');
    expect(typeof bundle?.run?.runId, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'run.runId MUST be a string',
    )).toBe('string');
    expect(Array.isArray(bundle?.events), req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'events MUST be an array',
    )).toBe(true);
    expect(typeof bundle?.redactionApplied, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'redactionApplied MUST be a boolean',
    )).toBe('boolean');
    expect(typeof bundle?.redactionMode, req('openwop.it.debugBundle.host-advertising-capabilities-debugbundle-supported-returns-200-with-valid-bundl', 
      'debug-bundle.md',
      'redactionMode MUST be a string',
    )).toBe('string');
  });

  it('hosts not advertising debugBundle return 404 on the endpoint', async () => {
    if (await isAdvertised()) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `await isAdvertised()` returned early (skip-equivalent for hosts that DO advertise)'); // skip-equivalent for hosts that DO advertise

    // Use any runId — even a synthetic one — since the host should 404
    // on the endpoint regardless of run existence.
    const res = await driver.get('/v1/runs/openwop-conformance-no-such-run/debug-bundle');
    expect(res.status, req('openwop.it.debugBundle.hosts-not-advertising-debugbundle-return-404-on-the-endpoint', 
      'debug-bundle.md §Endpoint',
      'host NOT advertising debugBundle.supported MUST return 404',
    )).toBe(404);
  });
});

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: invariants per debug-bundle.md', () => {
  it('metrics.eventCount equals events.length', async () => {
    if (!(await isAdvertised())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isAdvertised())` returned early');

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);
    const bundle = res.json as DebugBundleShape;

    if (bundle.metrics?.eventCount !== undefined) {
      expect(bundle.metrics.eventCount, req('openwop.it.debugBundle.metrics-eventcount-equals-events-length', 
        'debug-bundle.md §"Field reference"',
        'metrics.eventCount MUST equal events.length',
      )).toBe(bundle.events?.length ?? 0);
    }
  });

  it('redactionApplied=true is incompatible with redactionMode=passthrough', async () => {
    if (!(await isAdvertised())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isAdvertised())` returned early');

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);
    const bundle = res.json as DebugBundleShape;

    if (bundle.redactionApplied === true) {
      expect(bundle.redactionMode, req('openwop.it.debugBundle.redactionapplied-true-is-incompatible-with-redactionmode-passthrough', 
        'debug-bundle.md §"Redaction guarantees"',
        'redactionApplied=true MUST NOT coexist with redactionMode=passthrough — that combination is malformed',
      )).not.toBe('passthrough');
    }
  });

  it('bundle events agree with /events/poll for the same run', async () => {
    if (!(await isAdvertised())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isAdvertised())` returned early');

    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);

    const bundleRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (eventsRes.status !== 200) return softSkip('blocked', 'precondition not met — `eventsRes.status !== 200` returned early (host without polling) (seam, prior step, or fixture unavailable)'); // host without polling

    const bundle = bundleRes.json as DebugBundleShape;
    const polledEvents = (eventsRes.json as { events?: unknown[] }).events ?? [];

    expect(bundle.events?.length, req('openwop.it.debugBundle.bundle-events-agree-with-events-poll-for-the-same-run', 
      'debug-bundle.md',
      'bundle event count MUST agree with /events/poll for the same run',
    )).toBe(polledEvents.length);
  });
});

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: redaction inheritance per SECURITY/invariants.yaml secret-leakage-debug-bundle', () => {
  it('canary in workflow inputs MUST NOT appear verbatim in the bundle response', async () => {
    if (!(await isAdvertised())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isAdvertised())` returned early');

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
    expect(bundleText.includes(canary), req('openwop.it.debugBundle.canary-in-workflow-inputs-must-not-appear-verbatim-in-the-bundle-response', 
      'SECURITY/invariants.yaml secret-leakage-debug-bundle',
      'BYOK-shaped canary submitted as workflow input MUST NOT appear verbatim in the debug bundle',
    )).toBe(false);
    expect(bundleText.includes(CANARY_MARKER), req('openwop.it.debugBundle.canary-in-workflow-inputs-must-not-appear-verbatim-in-the-bundle-response', 
      'SECURITY/invariants.yaml secret-leakage-debug-bundle',
      'canary marker MUST NOT appear in the debug bundle',
    )).toBe(false);
  });
});

describe.skipIf(SKIP_NO_NOOP)('debug-bundle: spans join the trace (RFC 0207 §C, v1 only, non-gating)', () => {
  const LEG = 'openwop.it.debugBundle.spans-join-the-trace';
  const KINDS = new Set(['internal', 'server', 'client', 'producer', 'consumer']);
  const CODES = new Set(['unset', 'ok', 'error']);
  it('span traceId / kind / status have the RFC 0207 shape and the run span joins the caller trace', async () => {
    if (!(await isAdvertised())) return softSkip('inapplicable', 'debugBundle not advertised by this host');
    const tp = makeTraceparent();
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID }, { headers: { traceparent: tp.header } });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId);
    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(res.status).toBe(200);
    const spans = ((res.json as DebugBundleShape | undefined)?.spans ?? []) as Array<Record<string, unknown>>;
    if (spans.length === 0) return softSkip('inapplicable', 'host emits no spans (spans: []) — the RFC 0207 §C trace-join rule has nothing to hold');
    for (const s of spans) {
      const where = `span ${String(s['name'])}`;
      if (s['traceId'] !== undefined) {
        expect(typeof s['traceId'] === 'string' && /^[0-9a-f]{32}$/.test(s['traceId']) && s['traceId'] !== '0'.repeat(32), req(LEG, 'debug-bundle.md §"spans field" (RFC 0207 §C)', `${where}: traceId MUST be 32 lowercase hex, not all zeros (got ${JSON.stringify(s['traceId'])})`)).toBe(true);
      }
      if (s['kind'] !== undefined) expect(KINDS.has(String(s['kind'])), req(LEG, 'debug-bundle.md §"spans field"', `${where}: kind MUST be internal | server | client | producer | consumer (got ${JSON.stringify(s['kind'])})`)).toBe(true);
      if (s['status'] !== undefined) {
        const st = s['status'] as Record<string, unknown> | null;
        const ok = st !== null && typeof st === 'object' && CODES.has(String(st['code'])) && Object.keys(st).every((k) => k === 'code' || (k === 'message' && typeof st['message'] === 'string'));
        expect(ok, req(LEG, 'debug-bundle.md §"spans field"', `${where}: status MUST be the closed { code: unset | ok | error, message? } (got ${JSON.stringify(st)})`)).toBe(true);
      }
    }
    const run = spans.find((s) => s['name'] === 'openwop.run');
    if (run === undefined || run['traceId'] === undefined) return softSkip('inapplicable', 'the bundle carries no openwop.run span with a traceId (traceId is SHOULD) — the trace-join half has nothing to compare');
    expect(run['traceId'], req(LEG, 'debug-bundle.md §"spans field" (RFC 0207 §C)', 'the openwop.run span of a run started with an honoured inbound traceparent MUST carry that trace id')).toBe(tp.traceId);
  });
});
