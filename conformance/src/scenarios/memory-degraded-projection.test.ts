/**
 * Memory-capability degraded projection (RFC 0080 §C) — behavioral.
 *
 * Gated on `capabilities.agents.manifestRuntime` + `capabilities.memory`
 * (root-first per RFC 0073). Soft-skips when either is unadvertised (default) /
 * hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape
 * coverage lives in `memory-capability-model-shape.test.ts` (the schema fields +
 * the closed dimension enum); this asserts host BEHAVIOR on the NORMATIVE
 * `GET /v1/agents` inventory:
 *
 *   §C iff-contract — for EVERY inventory entry, when the host cannot satisfy an
 *   agent's requested `memoryShape` it MUST stamp `memoryDegraded: true` together
 *   with a NON-EMPTY `degradedMemoryDimensions[]` whose members are the RFC 0080
 *   §A dimension names (the CLOSED enum, NOT the `memoryShape` keys) and are
 *   unique; a non-degraded entry MUST carry `memoryDegraded` absent or `false`
 *   and MUST NOT carry a non-empty `degradedMemoryDimensions`.
 *
 *   Non-vacuity — the inventory MUST be non-empty (the cap is advertised + the
 *   endpoint serves). When `OPENWOP_DEGRADED_AGENT_ID` names an agent the host
 *   knows is degraded (an agent whose `memoryShape` exceeds host capability —
 *   e.g. one requesting `longTerm` on a host without long-term durability), the
 *   degraded branch is asserted NON-VACUOUSLY against that agent.
 *
 * Black-box on the normative path — no POST seam.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md (§"Memory capability model")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0080-agent-memory-capability-reconciliation.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { readManifestRuntimeCap, listManifestAgents } from '../lib/agentRuntime.js';

/** The CLOSED RFC 0080 §A dimension vocabulary (agent-inventory-response.schema.json
 *  `degradedMemoryDimensions` enum). NOT the `memoryShape` keys. */
const DIMENSIONS = [
  'read',
  'write',
  'search',
  'long-term-durability',
  'compaction',
  'attribution',
  'replay-snapshot',
  'retention',
];

interface InventoryEntry {
  agentId?: string;
  memoryDegraded?: unknown;
  degradedMemoryDimensions?: unknown;
  [k: string]: unknown;
}

describe('memory-degraded-projection (RFC 0080 §C)', () => {
  it('stamps memoryDegraded + a closed-enum degradedMemoryDimensions on degraded agents and nothing on the rest', async () => {
    const mr = await readManifestRuntimeCap();
    const memory = await readCapabilityFamily<Record<string, unknown>>('memory');
    const advertised = mr?.supported === true && !!memory && memory.supported === true;
    if (!behaviorGate('openwop-memory-degraded', advertised)) return;

    const inv = await listManifestAgents();
    if (inv === null) return; // host advertises the cap but doesn't serve /v1/agents — soft-skip
    const agents = (inv.agents ?? []) as InventoryEntry[];

    // Non-vacuity: an advertising + serving host MUST expose its inventory.
    expect(
      agents.length >= 1,
      driver.describe('agent-memory.md §"Memory capability model"', 'GET /v1/agents MUST return the installed manifest agents'),
    ).toBe(true);

    // §C iff-contract on EVERY entry.
    for (const a of agents) {
      const degraded = a.memoryDegraded === true;
      const dims = a.degradedMemoryDimensions;

      if (degraded) {
        expect(
          Array.isArray(dims) && dims.length >= 1,
          driver.describe('RFC 0080 §C', `memoryDegraded:true MUST carry a non-empty degradedMemoryDimensions (agent ${a.agentId})`),
        ).toBe(true);
        if (Array.isArray(dims)) {
          for (const d of dims) {
            expect(
              typeof d === 'string' && DIMENSIONS.includes(d),
              driver.describe('agent-inventory-response.schema.json', `degradedMemoryDimensions members MUST be RFC 0080 §A dimension names (got ${String(d)})`),
            ).toBe(true);
          }
          expect(
            new Set(dims as string[]).size === dims.length,
            driver.describe('RFC 0080 §C', 'degradedMemoryDimensions MUST be unique'),
          ).toBe(true);
        }
      } else {
        // Not degraded ⇒ no non-empty dimension list (absent or empty both pass).
        expect(
          dims === undefined || (Array.isArray(dims) && dims.length === 0),
          driver.describe('RFC 0080 §C', `a non-degraded entry MUST NOT carry a non-empty degradedMemoryDimensions (agent ${a.agentId})`),
        ).toBe(true);
      }
    }

    // Non-vacuous degraded branch when the host names a known-degraded agent.
    const degradedId = process.env.OPENWOP_DEGRADED_AGENT_ID;
    if (degradedId) {
      const target = agents.find((a) => a.agentId === degradedId);
      expect(
        target !== undefined,
        driver.describe('RFC 0080 §C', `OPENWOP_DEGRADED_AGENT_ID=${degradedId} MUST appear in the inventory`),
      ).toBe(true);
      if (target) {
        expect(
          target.memoryDegraded === true && Array.isArray(target.degradedMemoryDimensions) && target.degradedMemoryDimensions.length >= 1,
          driver.describe('RFC 0080 §C', 'the named degraded agent MUST project memoryDegraded:true + a non-empty degradedMemoryDimensions'),
        ).toBe(true);
      }
    }
  });
});
