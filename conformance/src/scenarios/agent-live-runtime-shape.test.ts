/**
 * Live manifest dispatch — capability + invocation-event shapes (RFC 0077).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.liveRuntime` is declared on the capabilities schema
 *     (with the `supported` / `structuredOutput` / `confidenceEscalation` /
 *     `sources` sub-flags).
 *   - the `agent.invocation.started` + `agent.invocation.completed` payload
 *     $defs validate conforming content-free payloads and reject malformed
 *     ones (a `started` missing `source`; a `completed` with an out-of-enum
 *     `outcome`).
 *   - both event names appear in the RunEventType enum.
 *
 * Behavioral assertions (the started→completed bracket ordering, structured-
 * output enforcement, toolAllowlist enforcement) are gated on
 * `capabilities.agents.liveRuntime.supported` and soft-skip until a reference
 * host wires the live-invoke seam (RFC 0077 §Conformance — reference host
 * deferred). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md §"Live manifest dispatch"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

/** Server-free assertion-message helper (mirrors driver.describe's "spec — requirement" shape without requiring OPENWOP_BASE_URL). */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-live-runtime-shape: capability advertisement (RFC 0077, server-free)', () => {
  it('the capabilities schema declares agents.liveRuntime with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).agents;
    const live = agents?.properties?.liveRuntime;
    expect(
      live,
      why('capabilities.md §agents', 'agents.liveRuntime MUST be declared'),
    ).toBeDefined();
    for (const flag of ['supported', 'structuredOutput', 'confidenceEscalation', 'sources']) {
      expect(
        live?.properties?.[flag],
        why('multi-agent-execution.md §Live manifest dispatch', `agents.liveRuntime.${flag} MUST be declared`),
      ).toBeDefined();
    }
  });
});

describe('agent-live-runtime-shape: invocation event payloads (RFC 0077, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  const started = ajv.getSchema('payloads#/$defs/agentInvocationStarted');
  const completed = ajv.getSchema('payloads#/$defs/agentInvocationCompleted');

  it('agent.invocation.started validates a content-free start record and requires source', () => {
    expect(started, 'the agentInvocationStarted $def MUST exist').toBeTruthy();
    expect(
      started!({ invocationId: 'inv-1', agentId: 'vendor.acme.review.code-reviewer', source: 'run-api', modelClass: 'coding', toolSurfaceCount: 3, memoryBound: false }),
      why('RFC 0077 §C', 'a conforming agent.invocation.started payload MUST validate'),
    ).toBe(true);
    // Negative: missing source — every invocation must record its entry point.
    expect(
      started!({ invocationId: 'inv-1', agentId: 'vendor.acme.review.code-reviewer' }),
      why('RFC 0077 §C', 'agent.invocation.started without source MUST be rejected'),
    ).toBe(false);
  });

  it('agent.invocation.completed validates a content-free outcome record and pins the outcome enum', () => {
    expect(completed, 'the agentInvocationCompleted $def MUST exist').toBeTruthy();
    expect(
      completed!({ invocationId: 'inv-1', agentId: 'vendor.acme.review.code-reviewer', outcome: 'completed', schemaValidated: true, confidence: 0.91 }),
      why('RFC 0077 §C', 'a conforming agent.invocation.completed payload MUST validate'),
    ).toBe(true);
    // Negative: out-of-enum outcome — the canonical value is `completed`, not `done`.
    expect(
      completed!({ invocationId: 'inv-1', agentId: 'a', outcome: 'done' }),
      why('RFC 0077 §C', 'agent.invocation.completed with an out-of-enum outcome MUST be rejected'),
    ).toBe(false);
  });

  it('both invocation event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(enumVals).toContain('agent.invocation.started');
    expect(enumVals).toContain('agent.invocation.completed');
  });
});
