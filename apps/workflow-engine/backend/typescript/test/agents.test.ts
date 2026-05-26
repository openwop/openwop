import { beforeAll, describe, expect, it } from 'vitest';
import { ensureNodesRegistered } from '../src/bootstrap/nodes.js';
import { buildAgentInventory } from '../src/routes/agents.js';

beforeAll(async () => {
  ensureNodesRegistered();
});

describe('sample agents inventory', () => {
  it('derives agent roles from the registered agent-attributed node types', () => {
    const inventory = buildAgentInventory();
    const ids = inventory.agents.map((a) => a.agentId);
    // The demo registers all three agent-attributed node types.
    expect(ids).toContain('core.orchestrator.supervisor');
    expect(ids).toContain('core.dispatch');
    expect(ids).toContain('vendor.openwop-sample.chat-responder');
    for (const agent of inventory.agents) {
      expect(agent.available).toBe(true);
      expect(agent.nodeTypeId.length).toBeGreaterThan(0);
      expect(Array.isArray(agent.rfcs)).toBe(true);
      expect(typeof agent.reasoning.verbosity).toBe('string');
      expect(typeof agent.reasoning.streaming).toBe('boolean');
    }
  });

  it('shares the reasoning posture between the inventory root and each agent', () => {
    const inventory = buildAgentInventory();
    for (const agent of inventory.agents) {
      expect(agent.reasoning).toEqual(inventory.reasoning);
    }
  });
});
