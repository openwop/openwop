/**
 * cross-host-traceparent-propagation — RFC 0040 §B behavioral (capability-gated).
 *
 * Status: ACTIVE (capability-gated; behavioral assertion soft-skipped
 * until a cross-host MCP/A2A composition test fixture ships). Gated on
 * `capabilities.multiAgent.executionModel.version >= 3` AND
 * `capabilities.multiAgent.executionModel.crossHostCausation.supported: true`.
 *
 * Asserts (when host advertises Phase 3 + a real MCP/A2A composition
 * endpoint is reachable):
 *
 *   1. An outbound MCP tool call dispatched from a Phase 3 host MUST
 *      carry the parent run's W3C `traceparent` header. The MCP server
 *      receives the header AND uses it as the parent trace for any
 *      spans it emits (closing the cross-host span linkage that
 *      RFC 0023's same-host coverage left open).
 *
 *   2. An inbound MCP tool reply OR A2A message handler MUST adopt the
 *      `traceparent` header from the inbound envelope as the trace
 *      parent for any subsequent events the receiving agent emits.
 *
 *   3. (Symmetric) Outbound A2A messages MUST carry the parent run's
 *      `traceparent`; inbound A2A handlers MUST adopt it.
 *
 * Behavioral wiring requires a cross-host test harness: either a real
 * MCP server peer (`OPENWOP_MCP_REAL_SERVER_URL`) or an A2A peer
 * (`OPENWOP_A2A_REAL_PEER_URL`) the host can call into. Without those,
 * the assertion soft-skips and only the shape probe in
 * cross-host-causation-shape.test.ts applies.
 *
 * @see RFCS/0040-multi-agent-cross-host-causation.md §B
 * @see spec/v1/multi-agent-execution.md §"W3C tracecontext across MCP + A2A composition"
 * @see RFCS/0023-conformance-agent-event-emitters.md (the same-host predecessor)
 */

import { describe, it } from 'vitest';

// Behavioral assertions in this file are currently `it.todo` placeholders;
// the cross-host MCP / A2A peer harness (gated on OPENWOP_MCP_REAL_SERVER_URL
// / OPENWOP_A2A_REAL_PEER_URL) hasn't landed yet. When it does, the
// `it.todo` calls flip back to runnable `it(...)` bodies that read discovery
// (via `driver.get('/.well-known/openwop')`), gate on `Phase 3` advertisement,
// and drive the workflow through the configured real peer.

describe('cross-host-traceparent-propagation: behavioral (RFC 0040 §B)', () => {
  // Behavioral assertion drives a workflow that calls an MCP tool via the
  // host's `core.mcp.toolCall` node. The MCP peer (configured via
  // OPENWOP_MCP_REAL_SERVER_URL) records inbound headers; the test reads
  // the recorded headers and asserts `traceparent` is present + matches
  // the format `00-{traceId}-{spanId}-{flags}` per W3C tracecontext.
  // Until the peer harness lands, the assertion is surfaced as `todo` so
  // test reporters track the gap rather than reporting a vacuous PASS.
  it.todo('Phase 3 host MUST inject parent run\'s traceparent into outbound MCP requests');

  // Behavioral assertion drives a workflow that dispatches an A2A message
  // via the host's `core.a2a.send` (or equivalent) node. The A2A peer
  // (configured via OPENWOP_A2A_REAL_PEER_URL) records inbound headers;
  // the test asserts `traceparent` is present + well-formed.
  it.todo('Phase 3 host MUST inject parent run\'s traceparent into outbound A2A messages');
});
