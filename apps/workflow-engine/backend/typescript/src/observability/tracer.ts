/**
 * OTel tracer init under the `openwop.*` semantic-namespace.
 *
 * Console exporter by default — production deployers swap for OTLP HTTP
 * by setting OTEL_EXPORTER_OTLP_ENDPOINT (the standard OTel env var).
 */

import { trace, type Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let tracer: Tracer | null = null;

export interface TracerInit {
  serviceName: string;
  serviceVersion: string;
  consoleExporter: boolean;
}

export function createTracer(init: TracerInit): Tracer {
  if (tracer) return tracer;

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: init.serviceName,
      [ATTR_SERVICE_VERSION]: init.serviceVersion,
      'openwop.protocol_version': '1.1',
    }),
  });

  if (init.consoleExporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // OTLP HTTP exporter — wired when OTEL_EXPORTER_OTLP_ENDPOINT is set.
  // Used by the conformance suite's in-suite OTel collector
  // (`OPENWOP_OTEL_COLLECTOR=true`) and by production deployers
  // forwarding to their own collector.
  //
  // !!! Production deployers MUST swap `SimpleSpanProcessor` for
  // `BatchSpanProcessor` !!! Simple flushes synchronously per span; a
  // 10ms collector roundtrip × hundreds of node spans per run will
  // dominate request-tail latency. We pick `Simple` here so the
  // conformance suite sees spans without flush-batch delay in 1-2 span
  // fixtures — that posture does NOT scale to real workflows.
  // (`@opentelemetry/sdk-trace-node` exports `BatchSpanProcessor`;
  // swap by replacing the wrapper class — same exporter underneath.)
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter()));
  }

  provider.register();

  tracer = trace.getTracer('openwop.workflow-engine-sample', init.serviceVersion);
  return tracer;
}

export function getTracer(): Tracer {
  if (!tracer) throw new Error('Tracer not initialized — call createTracer() at boot');
  return tracer;
}
