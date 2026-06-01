/**
 * secret-leakage-otel-attribute — SECURITY invariant verification via RFC 0034 seam.
 *
 * Verifies the two `SECURITY/invariants.yaml` rows
 *   - `secret-leakage-otel-attribute` (reference-impl → protocol per RFC 0034)
 *   - `secret-leakage-debug-bundle-otel` (reference-impl → protocol per RFC 0034)
 *
 * The host has a BYOK plumbing path that resolves a `credentialRef` and
 * passes the plaintext value into a NodeModule (the `openwop-smoke-byok-
 * roundtrip` fixture does exactly this). Two separate exfiltration risks
 * exist on the way back out:
 *
 *   1. OTel span attributes — host instrumentation MAY accidentally
 *      stamp the resolved plaintext onto a span attribute (`openwop.*`
 *      or vendor-namespaced). RFC 0034 §B's `GET /v1/host/sample/test/
 *      otel/spans?runId=<id>` seam exposes the full span buffer so
 *      conformance can mechanically prove no leak.
 *
 *   2. Debug-bundle exports — the optional `debug-bundle` capability
 *      exposes a portable JSON snapshot of a run's diagnostic state.
 *      RFC 0034 §B's `POST /v1/host/sample/test/debug-bundle/export`
 *      seam returns the bundle so conformance can prove the canary
 *      doesn't appear there either.
 *
 * Distinct from `envelope-reasoning-secret-redaction.test.ts`, which
 * narrows to the envelope-acceptor's redaction of `reasoning` field
 * canaries. This file verifies the broader executor-side claim: that
 * NO span attribute or debug-bundle field contains the resolved
 * plaintext anywhere in the run's instrumentation surface.
 *
 * Detection method: the host pre-provisions a canary secret under
 * `openwop-conformance-canary-secret` (any non-empty value). The
 * conformance scenario reads the same canary value via
 * `OPENWOP_CANARY_SECRET_VALUE` env (host operator + conformance runner
 * agree on it). The scenario then runs the `openwop-smoke-byok-
 * roundtrip` fixture, scrapes the OTel + debug-bundle seams, and
 * asserts the canary plaintext never appears in either surface.
 *
 * Gating:
 *   - `capabilities.secrets.supported: true` — host has BYOK plumbing.
 *   - `capabilities.observability.testSeams.otelScrape: true` (RFC 0034)
 *   - `capabilities.observability.testSeams.debugBundleExport: true` (RFC 0034)
 *   - Fixture `openwop-smoke-byok-roundtrip` advertised + the host has
 *     pre-provisioned the canary secret.
 *
 * Soft-skips on any unmet gate. Hard-fails on canary leak.
 *
 * @see RFCS/0034-otel-collector-test-seam.md §B
 * @see SECURITY/invariants.yaml secret-leakage-otel-attribute
 * @see SECURITY/invariants.yaml secret-leakage-debug-bundle-otel
 * @see SECURITY/threat-model-secret-leakage.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getCollector, waitForRunSpans } from '../lib/otel-collector.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const BYOK_WORKFLOW_ID = 'openwop-smoke-byok-roundtrip';
const FIXTURE_SKIP = !isFixtureAdvertised(BYOK_WORKFLOW_ID);
const CANARY_VALUE = process.env.OPENWOP_CANARY_SECRET_VALUE;

interface DiscoveryDoc {
  capabilities?: {
    secrets?: { supported?: unknown };
    observability?: {
      testSeams?: {
        otelScrape?: unknown;
        debugBundleExport?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

async function startByokRun(): Promise<string | null> {
  const create = await driver.post('/v1/runs', { workflowId: BYOK_WORKFLOW_ID });
  if (create.status === 404 || create.status === 422) return null;
  expect(create.status).toBe(201);
  return (create.json as { runId: string }).runId;
}

describe.skipIf(HTTP_SKIP || FIXTURE_SKIP)(
  'secret-leakage-otel-attribute: OTel span scrape (RFC 0034 §B)',
  () => {
    it('NO OTel span attribute MUST contain the BYOK canary plaintext for a run that resolved it', async (ctx) => {
      if (!CANARY_VALUE) {
        ctx.skip();
        return;
      }
      const d = await readDiscovery();
      const secretsOk = capabilityFamily<{ supported?: unknown }>(d, 'secrets')?.supported === true;
      const seamOk = capabilityFamily<{ testSeams?: Record<string, unknown> }>(d, 'observability')?.testSeams?.otelScrape === true;
      if (!secretsOk || !seamOk) {
        ctx.skip();
        return;
      }

      const runId = await startByokRun();
      if (runId === null) {
        ctx.skip();
        return;
      }
      const terminal = await pollUntilTerminal(runId);
      expect(
        terminal.status,
        driver.describe(
          'auth.md §"Secret resolution"',
          'BYOK fixture run MUST terminate `completed` when the canary is provisioned',
        ),
      ).toBe('completed');

      const spansRes = await driver.get(
        `/v1/host/sample/test/otel/spans?runId=${encodeURIComponent(runId)}`,
      );
      expect(
        spansRes.status,
        driver.describe(
          'RFCS/0034-otel-collector-test-seam.md §B',
          'host advertising capabilities.observability.testSeams.otelScrape MUST serve GET /v1/host/sample/test/otel/spans (200) — 404 is non-conformant',
        ),
      ).toBe(200);

      const body = spansRes.json as { spans?: Array<Record<string, unknown>> };
      const spans = body.spans ?? [];
      expect(
        Array.isArray(spans),
        driver.describe(
          'RFCS/0034-otel-collector-test-seam.md §B',
          'response body MUST have a `spans` array',
        ),
      ).toBe(true);

      // The host's instrumentation produces at least one span per run
      // (the engine emits `openwop.run.lifecycle` + per-node spans). If
      // the buffer is empty, the host isn't actually instrumenting — that
      // would be a separate non-conformance, but for this assertion we
      // only care about leak, not coverage.
      const serialized = JSON.stringify(spans);

      expect(
        serialized.includes(CANARY_VALUE),
        driver.describe(
          'SECURITY/invariants.yaml secret-leakage-otel-attribute',
          'no OTel span attribute may contain the BYOK canary plaintext — host instrumentation MUST redact or omit secret material before any span emission. Per `agent-memory.md` §SR-1, the canonical redaction marker is `[REDACTED:<secretId>]`.',
        ),
      ).toBe(false);
    });
  },
);

describe.skipIf(HTTP_SKIP || FIXTURE_SKIP)(
  'secret-leakage-debug-bundle-otel: debug-bundle export scrape (RFC 0034 §B)',
  () => {
    it('NO debug-bundle field MUST contain the BYOK canary plaintext for a run that resolved it', async (ctx) => {
      if (!CANARY_VALUE) {
        ctx.skip();
        return;
      }
      const d = await readDiscovery();
      const secretsOk = capabilityFamily<{ supported?: unknown }>(d, 'secrets')?.supported === true;
      const seamOk = capabilityFamily<{ testSeams?: Record<string, unknown> }>(d, 'observability')?.testSeams?.debugBundleExport === true;
      if (!secretsOk || !seamOk) {
        ctx.skip();
        return;
      }

      const runId = await startByokRun();
      if (runId === null) {
        ctx.skip();
        return;
      }
      const terminal = await pollUntilTerminal(runId);
      expect(terminal.status).toBe('completed');

      const bundleRes = await driver.post('/v1/host/sample/test/debug-bundle/export', { runId });
      expect(
        bundleRes.status,
        driver.describe(
          'RFCS/0034-otel-collector-test-seam.md §B',
          'host advertising capabilities.observability.testSeams.debugBundleExport MUST serve POST /v1/host/sample/test/debug-bundle/export (200) — 404 is non-conformant',
        ),
      ).toBe(200);

      const serialized = JSON.stringify(bundleRes.json ?? {});
      expect(
        serialized.includes(CANARY_VALUE),
        driver.describe(
          'SECURITY/invariants.yaml secret-leakage-debug-bundle-otel',
          'no debug-bundle field may contain the BYOK canary plaintext — debug-bundle export MUST redact or omit secret material. Per `debug-bundle.md` §"Redaction", the canonical marker is `[REDACTED:<secretId>]`.',
        ),
      ).toBe(false);
    });
  },
);

describe.skipIf(HTTP_SKIP || FIXTURE_SKIP)(
  'secret-leakage-otel-attribute: real OTLP export scrape (collector-side)',
  () => {
    // Distinct from the scrape-seam probe above: this asserts against what
    // the host's OTLP exporter ACTUALLY shipped over the wire to the
    // conformance collector, not what the host self-reports via its
    // `/v1/host/sample/test/otel/spans` seam. A host could redact in its
    // seam yet leak on the real export — only this catches that. Closes
    // the `docs/KNOWN-LIMITS.md` "collector seam doesn't inspect span
    // attributes" gap. Gated on the in-process collector being active
    // (`OPENWOP_OTEL_COLLECTOR=true` + the host configured to export to it).
    it('NO real-exported OTel span/metric attribute MUST contain the BYOK canary plaintext', async (ctx) => {
      const collector = getCollector();
      if (!collector || !CANARY_VALUE) {
        ctx.skip();
        return;
      }
      const d = await readDiscovery();
      const secretsOk = capabilityFamily<{ supported?: unknown }>(d, 'secrets')?.supported === true;
      const obsOk = capabilityFamily<unknown>(d, 'observability') !== undefined;
      if (!secretsOk || !obsOk) {
        ctx.skip();
        return;
      }

      collector.reset();
      const runId = await startByokRun();
      if (runId === null) {
        ctx.skip();
        return;
      }
      const terminal = await pollUntilTerminal(runId);
      expect(terminal.status).toBe('completed');

      // Hosts export spans asynchronously after terminal; poll until the
      // run's spans land (or the timeout elapses — an absent export is a
      // separate coverage concern, not a leak).
      await waitForRunSpans(runId, { timeoutMs: 8_000 });

      const leaks = collector.findCanaryLeakage(CANARY_VALUE);
      expect(
        leaks,
        driver.describe(
          'SECURITY/invariants.yaml secret-leakage-otel-attribute',
          `no real-exported OTel span/metric attribute may contain the BYOK canary plaintext. Leaking surfaces: ${JSON.stringify(leaks)}`,
        ),
      ).toEqual([]);
    });
  },
);

describe.skipIf(HTTP_SKIP || FIXTURE_SKIP)(
  'secret-leakage-otel-attribute: advertisement-shape probe (RFC 0034 §A)',
  () => {
    it('when secrets.supported is true, observability.testSeams advertisements MUST be boolean if present', async (ctx) => {
      const d = await readDiscovery();
      if (capabilityFamily<{ supported?: unknown }>(d, 'secrets')?.supported !== true) {
        ctx.skip();
        return;
      }
      const seams = capabilityFamily<{ testSeams?: Record<string, unknown> }>(d, 'observability')?.testSeams;
      if (seams === undefined) {
        ctx.skip(); // host honest about not exposing the seams — Drift #17 path
        return;
      }
      if ('otelScrape' in seams && seams.otelScrape !== undefined) {
        expect(
          typeof seams.otelScrape,
          driver.describe(
            'RFCS/0034-otel-collector-test-seam.md §A',
            'capabilities.observability.testSeams.otelScrape MUST be boolean when present',
          ),
        ).toBe('boolean');
      }
      if ('debugBundleExport' in seams && seams.debugBundleExport !== undefined) {
        expect(
          typeof seams.debugBundleExport,
          driver.describe(
            'RFCS/0034-otel-collector-test-seam.md §A',
            'capabilities.observability.testSeams.debugBundleExport MUST be boolean when present',
          ),
        ).toBe('boolean');
      }
    });
  },
);
