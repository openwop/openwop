/**
 * @openwop/openwop — TypeScript reference SDK for OpenWOP-compliant servers.
 *
 * Public surface:
 *   - OpenwopClient (auth + endpoint methods)
 *   - WopError (typed error wrapping ErrorEnvelope)
 *   - All request/response types mirroring the OpenAPI spec
 *   - streamEvents helper for advanced SSE use cases
 *
 * See README.md for usage examples.
 */

export { OpenwopClient } from './client.js';
export type { OpenwopClientOptions, MutationOptions } from './client.js';
export { WopError } from './types.js';
export type {
  AuditVerifyAnomaly,
  AuditVerifyCheckpoint,
  AuditVerifyResult,
  BulkCancelRunResult,
  BulkCancelRunsRequest,
  BulkCancelRunsResponse,
  Capabilities,
  CancelRunRequest,
  CancelRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  ErrorEnvelope,
  ForkRunRequest,
  ForkRunResponse,
  InterruptByTokenInspection,
  PollEventsResponse,
  ResolveInterruptByTokenResponse,
  ResolveInterruptRequest,
  ResolveInterruptResponse,
  RunConfigurable,
  RunEventDoc,
  RunSnapshot,
  RunStatus,
  StreamMode,
} from './types.js';
export { streamEvents } from './sse.js';
export type { EventsStreamContext, EventsStreamOptions } from './sse.js';

// Run-status + run-error helpers (added in 1). Forward-compat predicates
// over the wire-format unions declared above; full design + rationale in
// `run-helpers.ts`.
export {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  HTTP_ERROR_CODES,
  isHttpErrorCode,
  RUN_ERROR_CODES,
  isRunErrorCode,
} from './run-helpers.js';
export type {
  ActiveRunStatus,
  TerminalRunStatus,
  HttpErrorCode,
  RunErrorCode,
  RunError,
} from './run-helpers.js';
