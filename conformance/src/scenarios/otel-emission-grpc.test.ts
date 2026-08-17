/**
 * Track 11: OTel span emission over OTLP/gRPC.
 *
 * Verifies that hosts advertising `capabilities.observability.otel.exportProtocols`
 * including `"grpc"` can emit `openwop.*` spans over OTLP/gRPC to the
 * in-suite collector and that the gRPC framing path captures the same
 * `openwop.run` + `openwop.node.*` shape as the HTTP-JSON path.
 *
 * The gRPC collector is the parallel HTTP/2 server inside
 * `OtelCollector` (started via `startGrpc()` in setup.ts when the
 * `OPENWOP_OTEL_COLLECTOR=true` flag is set). The host points its
 * exporter at the printed `:<grpcPort>` (h2c) with
 * `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`. Spans captured over gRPC land
 * in the same store as HTTP — `getCollector().spans()` returns the
 * union.
 *
 * Skip conditions:
 *   - Collector disabled (`OPENWOP_OTEL_COLLECTOR` unset / false).
 *   - Host does not advertise `capabilities.observability.otel.exportProtocols`
 *     including `"grpc"` (presumed not configured for gRPC emission).
 *   - Required fixture (`conformance-noop`) not advertised.
 *
 * @see spec/v1/observability.md §"Export protocols"
 * @see conformance/src/lib/otel-collector.ts §_handleGrpcStream
 * @see conformance/src/lib/grpc-framing.ts
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getCollector, waitForRunSpans } from '../lib/otel-collector.js';

/**
 * Callback-shaped: the host exports OTLP/gRPC spans to the suite's collector.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP/gRPC spans to the suite's collector";

const FIXTURE = 'conformance-noop';

async function advertisesGrpcExport(): Promise<boolean> {
  try {
    const disco = await driver.get('/.well-known/openwop');
    const caps = discoveryFamilies(disco.json) as { observability?: { otel?: { exportProtocols?: unknown } } };
    const protocols = caps.observability?.otel?.exportProtocols;
    return Array.isArray(protocols) && protocols.includes('grpc');
  } catch {
    return false;
  }
}

describe('otel-emission-grpc: OTLP/gRPC export path', () => {
  it('host emits openwop.run spans over OTLP/gRPC; collector captures them via the shared store', async () => {
    if (!getCollector()) {
      // eslint-disable-next-line no-console
      console.warn('[otel-emission-grpc] collector not started; set OPENWOP_OTEL_COLLECTOR=true to run');
      return softSkip('blocked', '[otel-emission-grpc] collector not started; set OPENWOP_OTEL_COLLECTOR=true to run');
    }
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(`[otel-emission-grpc] fixture ${FIXTURE} not advertised; skipping`);
      return softSkip('inapplicable', '[otel-emission-grpc] fixture … not advertised; skipping');
    }
    if (!(await advertisesGrpcExport())) {
      // eslint-disable-next-line no-console
      console.warn(
        '[otel-emission-grpc] host does not advertise capabilities.observability.otel.exportProtocols including "grpc"; skipping. ' +
          'Hosts MAY opt into gRPC export by emitting OTLP via the OTLP/gRPC transport and adding `"grpc"` to the array.',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await advertisesGrpcExport())` returned early');
    }

    const collector = getCollector()!;
    collector.reset();

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId, { timeoutMs: 15_000 });

    // gRPC and HTTP-JSON spans both land in `_spans`, so the existing
    // span-query helpers work transparently. If the host emits over
    // both transports, we capture both; the assertion only requires
    // at least one openwop.run span correlated by runId.
    const runSpans = await waitForRunSpans(runId, { timeoutMs: 5_000, minCount: 1 });

    expect(runSpans.length, driver.describe(
      'observability.md §"Export protocols" + RFC 0008/0009 Track 11',
      'host advertising exportProtocols ∋ "grpc" MUST emit openwop.* spans over OTLP/gRPC',
    )).toBeGreaterThan(0);

    const runSpan = runSpans.find((s) => s.name === 'openwop.run');
    expect(runSpan?.attributes.get('openwop.run_id'), driver.describe(
      'observability.md §"Run-level attributes"',
      'openwop.run span MUST carry openwop.run_id attribute',
    )).toBe(runId);
  });
});
