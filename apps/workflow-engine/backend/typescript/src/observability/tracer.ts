/**
 * OTel tracer init under the `openwop.*` semantic-namespace.
 *
 * Console exporter by default — production deployers swap for OTLP HTTP
 * by setting OTEL_EXPORTER_OTLP_ENDPOINT (the standard OTel env var).
 */

import { trace, type Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
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

  provider.register();

  tracer = trace.getTracer('openwop.workflow-engine-sample', init.serviceVersion);
  return tracer;
}

export function getTracer(): Tracer {
  if (!tracer) throw new Error('Tracer not initialized — call createTracer() at boot');
  return tracer;
}
