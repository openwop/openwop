/**
 * Memory-consolidation + commitment event shapes (RFC 0068, `Draft`).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.memoryConsolidation` + `agents.commitments`
 *     sub-blocks are declared on the capabilities schema.
 *   - the `agent.memory.consolidated` + `commitment.fired` payload $defs
 *     validate conforming payloads and reject malformed ones (a
 *     `commitment.fired` missing `memoryRef` is rejected — a commitment
 *     with no memory provenance is not an *inferred* commitment).
 *   - both event names appear in the RunEventType enum.
 *
 * Distinct from RFC 0062 distillation (`memory.compacted`): consolidation
 * reconciles long-term memory; this scenario asserts the new event
 * contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md §"Background consolidation"
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md §"Inferred commitments"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0068-memory-consolidation-and-standing-commitments.md
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

describe('memory-consolidation-shape: capability advertisement (RFC 0068, server-free)', () => {
  it('the capabilities schema declares agents.memoryConsolidation + agents.commitments', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, unknown> }>).agents;
    expect(
      agents?.properties?.memoryConsolidation,
      why('capabilities.md §agents', 'agents.memoryConsolidation MUST be declared'),
    ).toBeDefined();
    expect(
      agents?.properties?.commitments,
      why('capabilities.md §agents', 'agents.commitments MUST be declared'),
    ).toBeDefined();
  });
});

describe('memory-consolidation-shape: event payloads (RFC 0068, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  const consolidated = ajv.getSchema('payloads#/$defs/agentMemoryConsolidated');
  const fired = ajv.getSchema('payloads#/$defs/commitmentFired');

  it('agent.memory.consolidated validates a content-free pass summary', () => {
    expect(consolidated, 'the agentMemoryConsolidated $def MUST exist').toBeTruthy();
    expect(
      consolidated!({ memoryRef: 'mem://a/agent-1', inputCount: 240, outputCount: 201, trigger: 'host-managed' }),
      why('RFC 0068 §B', 'a conforming agent.memory.consolidated payload MUST validate'),
    ).toBe(true);
    // Negative: outputCount as string fails the integer type.
    expect(consolidated!({ memoryRef: 'mem://a/agent-1', inputCount: 1, outputCount: 'x' })).toBe(false);
  });

  it('commitment.fired validates a content-free fire record and requires memoryRef', () => {
    expect(fired, 'the commitmentFired $def MUST exist').toBeTruthy();
    expect(
      fired!({ commitmentId: 'cmt-1', memoryRef: 'mem://a/agent-1', condition: 'predicate', enqueuedRunId: 'run-1' }),
      why('RFC 0068 §C', 'a conforming commitment.fired payload MUST validate'),
    ).toBe(true);
    // Negative: missing memoryRef — a commitment with no provenance breaks CTI-1 binding.
    expect(
      fired!({ commitmentId: 'cmt-1', condition: 'time' }),
      why('RFC 0068 §C', 'commitment.fired without memoryRef MUST be rejected'),
    ).toBe(false);
  });

  it('both event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(enumVals).toContain('agent.memory.consolidated');
    expect(enumVals).toContain('commitment.fired');
  });
});
