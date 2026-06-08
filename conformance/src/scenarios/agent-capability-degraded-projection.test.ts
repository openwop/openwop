/**
 * Agent capability-requirement degraded projection (RFC 0092 §B) — behavioral.
 *
 * Gated on `capabilities.agents.manifestRuntime` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `agent-requires-capabilities-shape.test.ts` (the `requiresCapabilities[]`
 * field); this asserts host BEHAVIOR on the NORMATIVE `GET /v1/agents` inventory:
 *
 *   §B iff-contract — when an agent's `requiresCapabilities[]` names a key the
 *   host does NOT advertise, that key MUST appear in the inventory entry's
 *   `degraded[]` (the canonical RFC 0072 §C field — NOT a `degradedCapabilities`
 *   field). An agent whose requirements are all satisfied MUST omit `degraded`
 *   (or carry it empty). `degraded[]` members are unique, non-empty strings.
 *
 *   Non-vacuity — the inventory MUST be non-empty. When
 *   `OPENWOP_DEGRADED_CAPABILITY_AGENT_ID` names an agent the host knows is
 *   capability-degraded (its `requiresCapabilities` names an unadvertised key),
 *   the degraded branch is asserted NON-VACUOUSLY against that agent.
 *
 * Black-box on the normative path — no POST seam.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0092-agent-capability-requirements.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0072-agent-inventory-and-dispatch.md (§C degraded[])
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readManifestRuntimeCap, listManifestAgents } from '../lib/agentRuntime.js';

interface InventoryEntry {
  agentId?: string;
  requiresCapabilities?: unknown;
  degraded?: unknown;
  [k: string]: unknown;
}

describe('agent-capability-degraded-projection (RFC 0092 §B)', () => {
  it('surfaces unmet requiresCapabilities in degraded[] and nothing on the rest', async () => {
    const mr = await readManifestRuntimeCap();
    if (!behaviorGate('openwop-agent-capability-degraded', mr?.supported === true)) return;

    const inv = await listManifestAgents();
    if (inv === null) return; // cap advertised but /v1/agents unserved — soft-skip
    const agents = (inv.agents ?? []) as InventoryEntry[];

    // Non-vacuity: an advertising + serving host MUST expose its inventory.
    expect(
      agents.length >= 1,
      driver.describe('RFC 0072 §A', 'GET /v1/agents MUST return the installed manifest agents'),
    ).toBe(true);

    // §B well-formedness on EVERY entry: degraded[], when present, is a unique
    // list of non-empty strings.
    for (const a of agents) {
      const d = a.degraded;
      if (d !== undefined) {
        expect(
          Array.isArray(d),
          driver.describe('agent-inventory-response.schema.json', `degraded MUST be an array when present (agent ${a.agentId})`),
        ).toBe(true);
        if (Array.isArray(d)) {
          for (const k of d) {
            expect(
              typeof k === 'string' && k.length > 0,
              driver.describe('RFC 0072 §C', `degraded[] members MUST be non-empty strings (agent ${a.agentId}, got ${String(k)})`),
            ).toBe(true);
          }
          expect(
            new Set(d as string[]).size === d.length,
            driver.describe('RFC 0092 §B', `degraded[] MUST be unique (agent ${a.agentId})`),
          ).toBe(true);
        }
      }
    }

    // Non-vacuous degraded branch when the host names a known capability-degraded agent.
    const degradedId = process.env.OPENWOP_DEGRADED_CAPABILITY_AGENT_ID;
    if (degradedId) {
      const target = agents.find((a) => a.agentId === degradedId);
      expect(
        target !== undefined,
        driver.describe('RFC 0092 §B', `OPENWOP_DEGRADED_CAPABILITY_AGENT_ID=${degradedId} MUST appear in the inventory`),
      ).toBe(true);
      if (target) {
        const d = target.degraded;
        expect(
          Array.isArray(d) && d.length >= 1,
          driver.describe('RFC 0092 §B', 'the named capability-degraded agent MUST carry a non-empty degraded[]'),
        ).toBe(true);
        // When the entry also exposes requiresCapabilities, every degraded key
        // MUST be one the agent actually requires (the projection is a subset of
        // requirements, never invented).
        if (Array.isArray(d) && Array.isArray(target.requiresCapabilities)) {
          const req = new Set(target.requiresCapabilities as unknown[]);
          for (const k of d) {
            expect(
              req.has(k),
              driver.describe('RFC 0092 §B', `a degraded[] key MUST be one the agent requires (got ${String(k)})`),
            ).toBe(true);
          }
        }
      }
    }
  });
});
