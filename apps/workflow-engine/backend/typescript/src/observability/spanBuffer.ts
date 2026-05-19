/**
 * Test-only in-memory OTel span buffer.
 *
 * Used by Thread E.2 of the test-coverage debt plan: conformance
 * scenarios that need to verify the absence (or presence) of specific
 * OTel span attributes scrape this buffer via
 * `GET /v1/host/sample/test/otel/spans?envelopeId=…&runId=…`.
 *
 * Production hosts wire a real OTel exporter (gRPC OTLP, Honeycomb,
 * etc.); this test-only buffer captures the same Span shape the
 * exporter would receive so the conformance assertions are equivalent
 * to those a real OTel collector would emit.
 *
 * Per `observability.md` §"AI cost" + RFC 0021 §"Redaction (SR-1
 * carry-forward)":
 *   - span attributes MUST NOT carry BYOK canary plaintext
 *   - schema-drift events SHOULD project to
 *     `envelope_schema_version_drift` span attributes
 *
 * Scope: keyed by envelopeId and/or runId. Cleared via
 * `resetSpanBuffer()` for suite teardown.
 */

/** Minimal Span shape — mirrors the subset of OTel SpanData the
 *  conformance scenarios care about (no SpanContext / trace state). */
export interface TestSpan {
  readonly spanId: string;
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly envelopeId?: string;
  readonly runId?: string;
  readonly timestamp: string;
}

const _spans: TestSpan[] = [];

let _seq = 0;

/** Append a span to the buffer. Auto-assigns spanId + timestamp. */
export function appendTestSpan(
  input: Omit<TestSpan, 'spanId' | 'timestamp'> & Partial<Pick<TestSpan, 'spanId' | 'timestamp'>>,
): TestSpan {
  const span: TestSpan = {
    name: input.name,
    attributes: input.attributes,
    spanId: input.spanId ?? `span-${++_seq}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...(input.envelopeId !== undefined ? { envelopeId: input.envelopeId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
  };
  _spans.push(span);
  return span;
}

/** Query spans with optional filters. */
export function listTestSpans(
  filter: { envelopeId?: string; runId?: string; name?: string } = {},
): TestSpan[] {
  return _spans.filter((s) => {
    if (filter.envelopeId && s.envelopeId !== filter.envelopeId) return false;
    if (filter.runId && s.runId !== filter.runId) return false;
    if (filter.name && s.name !== filter.name) return false;
    return true;
  });
}

/** Clear ALL spans (suite teardown). */
export function resetTestSpanBuffer(): void {
  _spans.length = 0;
}
