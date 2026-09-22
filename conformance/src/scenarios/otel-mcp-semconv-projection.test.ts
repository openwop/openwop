/**
 * otel-mcp-semconv-projection — RFC 0207 §D (both majors: `BOTH_MAJORS`).
 *
 * `spec/v1/observability.md` §"MCP semantic-convention projection" (v1-carried
 * normative text at major 2): a host MAY project `openwop.mcp.invocation` onto
 * the OpenTelemetry MCP conventions (upstream Development stability). A host
 * that emits ANY `mcp.*` attribute under the projection MUST also emit
 * `openwop.otel.mcp_mapping_version: "0"` and `openwop.otel.mcp_semconv_ref:
 * "open-telemetry/semantic-conventions-genai@<commit>"`, MUST NOT emit
 * `mcp.session.id` for a 2026-07-28 exchange (that revision has no session), and
 * MUST NOT emit `gen_ai.tool.call.arguments` / `.result` (content).
 *
 * Read from the suite's OTLP collector after one MCP-tool fixture run
 * (`conformance-mcp-client` at major 2, `conformance-mcp-tool-roundtrip` at
 * major 1). The projection is OPTIONAL, so a host that sends no `mcp.*` span —
 * or a run with no collector to send it to — records `inapplicable` with that
 * reason, never a failure and never a pass. Written major-aware: unversioned
 * run paths through the driver, no capability-record gate.
 *
 * Sabotage: a projected span without the version stamp fails; one carrying
 * `mcp.session.id` on a 2026-07-28 exchange fails; one carrying the tool
 * arguments fails.
 *
 * @see spec/v1/observability.md §"MCP semantic-convention projection"
 * @see RFCS/0207-trace-context-across-mcp-and-a2a.md §D
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { targetMajor } from '../lib/seams.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { getCollector, type CapturedSpan } from '../lib/otel-collector.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host exports OTLP spans to the suite's collector";

const ID = 'openwop.requirement.0207.mcp-semconv-stamped';
const DOC = 'observability.md §"MCP semantic-convention projection" (RFC 0207 §D)';
const SEMCONV_REF = /^open-telemetry\/semantic-conventions-genai@[0-9a-f]{7,40}$/;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One MCP-tool fixture run through the host, so an MCP span has a reason to exist. Best effort. */
async function driveOneMcpCall(): Promise<void> {
  if (getMcpFakeServer() === null) return;
  const v2 = targetMajor() === 2;
  const fixture = v2 ? 'conformance-mcp-client' : 'conformance-mcp-tool-roundtrip';
  if (!isFixtureAdvertised(fixture)) return;
  const inputs = v2 ? { method: 'callTool', serverId: 'conformance', name: 'structured-echo', arguments: { nonce: randomUUID() } } : { text: 'semconv-probe' };
  const created = await driver.post(v2 ? '/runs' : '/v1/runs', { workflowId: fixture, inputs }).catch(() => null);
  const runId = (created?.json as { runId?: unknown } | null | undefined)?.runId;
  if (typeof runId !== 'string') return;
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    const snap = await driver.get(`${v2 ? '' : '/v1'}/runs/${encodeURIComponent(runId)}`).catch(() => null);
    if (TERMINAL.has(String((snap?.json as { status?: unknown } | null | undefined)?.status ?? ''))) return;
    await sleep(200);
  }
}

const projected = (s: CapturedSpan): boolean => [...s.attributes.keys()].some((k) => k.startsWith('mcp.'));

describe('otel-mcp-semconv-projection (RFC 0207 §D, both majors)', () => {
  it('every projected mcp.* span carries the v0 version stamp and no forbidden attribute', async () => {
    const collector = getCollector();
    if (collector === null) return softSkip('inapplicable', 'the mcp.* projection is optional and observable only through OTLP export to the suite collector, which is not started in this run (OPENWOP_OTEL_COLLECTOR) — no mcp.* span can arrive');
    await driveOneMcpCall();
    await sleep(2_000);
    const spans = collector.spans().filter(projected);
    if (spans.length === 0) return softSkip('inapplicable', 'no span carrying an mcp.* attribute reached the suite collector — the host does not project onto the OTel MCP conventions (optional, RFC 0207 §D.12)');
    for (const s of spans) {
      const where = `span ${s.name} (${s.spanId})`;
      expect(s.attributes.get('openwop.otel.mcp_mapping_version'), req(ID, DOC, `${where} carries mcp.* attributes and MUST carry openwop.otel.mcp_mapping_version: "0"`)).toBe('0');
      const ref = s.attributes.get('openwop.otel.mcp_semconv_ref');
      expect(typeof ref === 'string' && SEMCONV_REF.test(ref), req(ID, DOC, `${where} MUST carry openwop.otel.mcp_semconv_ref "open-telemetry/semantic-conventions-genai@<commit>" (got ${JSON.stringify(ref ?? null)})`)).toBe(true);
      if (s.attributes.get('mcp.protocol.version') === '2026-07-28') {
        expect(s.attributes.has('mcp.session.id'), req(ID, DOC, `${where} is a 2026-07-28 exchange and MUST NOT carry mcp.session.id (that revision is stateless)`)).toBe(false);
      }
      expect(s.attributes.has('gen_ai.tool.call.arguments') || s.attributes.has('gen_ai.tool.call.result'), req(ID, DOC, `${where} MUST NOT carry gen_ai.tool.call.arguments / .result under the projection (content)`)).toBe(false);
    }
  });
});
