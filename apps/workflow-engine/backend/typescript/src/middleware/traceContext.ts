/**
 * W3C `traceparent` propagation. Reads the inbound header, sets it as
 * the active OTel context for the rest of the handler — engine spans
 * become children of the caller's trace, giving end-to-end browser ↔
 * Cloud Run trace continuity.
 *
 * No-op when the header is absent or malformed.
 */

import type { RequestHandler } from 'express';
import { context, propagation } from '@opentelemetry/api';

export function traceContextMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const carrier: Record<string, string> = {};
    const traceparent = req.header('traceparent');
    const tracestate = req.header('tracestate');
    if (traceparent) carrier.traceparent = traceparent;
    if (tracestate) carrier.tracestate = tracestate;
    if (!carrier.traceparent) {
      next();
      return;
    }
    const ctx = propagation.extract(context.active(), carrier);
    context.with(ctx, () => next());
  };
}
