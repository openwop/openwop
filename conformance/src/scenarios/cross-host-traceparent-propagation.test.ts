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

// Behavioral assertions in this file are currently `it.skip` placeholders;
// the cross-host MCP / A2A peer harness (gated on OPENWOP_MCP_REAL_SERVER_URL
// / OPENWOP_A2A_REAL_PEER_URL) hasn't landed yet. When it does, the
// `it.skip` calls flip back to runnable `it(...)` bodies that read discovery
// (via `driver.get('/.well-known/openwop')`), gate on `Phase 3` advertisement,
// and drive the workflow through the configured real peer.

describe('cross-host-traceparent-propagation: behavioral (RFC 0040 §B)', () => {
  // Behavioral assertion drives a workflow that calls an MCP tool via the
  // host's `core.mcp.toolCall` node. The MCP peer (configured via
  // OPENWOP_MCP_REAL_SERVER_URL) records inbound headers; the test reads
  // the recorded headers and asserts `traceparent` is present + matches
  // the format `00-{traceId}-{spanId}-{flags}` per W3C tracecontext.
  // Until the peer harness lands, the assertion is surfaced as `it.skip` so
  // test reporters track the gap rather than reporting a vacuous PASS.
  // Marked out of stable profile via RFC 0042 §B (experimental tier):
  // RFC 0040 remains Active. Hosts that wire Phase 3 cross-host causation
  // before RFC 0040 graduates SHOULD advertise
  // `multiAgent.executionModel.tier: 'experimental'` per RFC 0042 §A
  // until cross-host evidence drives the promotion. Path-to-runnable
  // requires the MCP peer harness (OPENWOP_MCP_REAL_SERVER_URL) +
  // inbound-header recorder; flips to a real `it()` on first non-steward
  // Phase 3 host advertising matching capabilities.
  it.skip('Phase 3 host MUST inject parent run\'s traceparent into outbound MCP requests — out of stable profile via RFC 0042');

  // Same routing — out of stable profile via RFC 0042 §B until RFC 0040
  // graduates to Accepted; behavioral A2A test seam contract still to be
  // designed alongside the corresponding peer harness.
  it.skip('Phase 3 host MUST inject parent run\'s traceparent into outbound A2A messages — out of stable profile via RFC 0042');
});
