/**
 * Final error-envelope formatter. Catches OpenwopError + thrown
 * unknowns and returns the canonical openwop ErrorEnvelope shape per
 * spec/v1/rest-endpoints.md §"Error envelope".
 */

import type { ErrorRequestHandler } from 'express';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { sanitizeForErrorMessage, sanitizeDetails } from './sanitize.js';

const log = createLogger('error-envelope');

export function errorEnvelopeMiddleware(): ErrorRequestHandler {
  // The 4-arg signature is required for express to recognize this as
  // an error-handling middleware. _next stays unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof OpenwopError) {
      // Defense-in-depth: scrub credential-shaped substrings from the
      // outgoing message + details so user input can't weaponize the
      // error envelope as a leak channel.
      const env = err.toEnvelope();
      const scrubbed = {
        ...env,
        message: sanitizeForErrorMessage(env.message ?? ''),
        ...(env.details ? { details: sanitizeDetails(env.details) } : {}),
      };
      res.status(err.httpStatus).json(scrubbed);
      return;
    }
    log.error('unhandled error', {
      path: req.path,
      method: req.method,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred.',
    });
  };
}
