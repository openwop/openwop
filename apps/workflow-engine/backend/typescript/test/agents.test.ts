import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadAgentsFromManifest } from '../src/packs/agentLoader.js';
import { getAgentRegistry } from '../src/executor/agentRegistry.js';
import { runAgentDispatch, AgentNotFoundError } from '../src/host/agentDispatch.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');
const SUPERVISOR_PACK = join(REPO_ROOT, 'packs', 'core.openwop.agents.supervisor');

/** A controlled pack with simple handoff schemas + a tool allowlist, so the
 *  dispatch contract paths (RFC 0070 §A14/§D/§F) are deterministic. */
function seedControlledAgent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentpack-'));
  mkdirSync(join(dir, 'schemas'), { recursive: true });
  writeFileSync(join(dir, 'schemas', 'task.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    required: ['goal'], properties: { goal: { type: 'string' } }, additionalProperties: true,
  }));
  writeFileSync(join(dir, 'schemas', 'return.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    required: ['summary'], properties: { summary: { type: 'string' } }, additionalProperties: true,
  }));
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({
    name: 'local.test.agents', version: '1.0.0', nodes: [],
    agents: [{
      agentId: 'local.test.agents.worker', persona: 'Worker', modelClass: 'general',
      systemPrompt: 'You are a worker.', toolAllowlist: ['openwop:web.search', 'openwop:fs.read'],
      confidence: { defaultThreshold: 0.75 },
      handoff: { taskSchemaRef: 'schemas/task.json', returnSchemaRef: 'schemas/return.json' },
    }],
  }));
  return dir;
}

describe('runAgentDispatch — RFC 0070 manifest-agent dispatch floor', () => {
  beforeEach(() => getAgentRegistry()._resetForTest());

  it('dispatches a real installed manifest agent end-to-end', () => {
    loadAgentsFromManifest(SUPERVISOR_PACK);
    // Opaque-payload path (validateHandoff:false) — proves a real installed
    // manifest agent resolves + dispatches + emits attributed events without
    // coupling this assertion to the supervisor pack's specific task schema
    // (the §D validation paths are covered by the controlled agent below).
    const r = runAgentDispatch({ agentId: 'core.openwop.agents.supervisor.default', task: {}, validateHandoff: false });
    expect(r.status).toBe('completed');
    expect(r.events.map((e) => e.type)).toEqual(['agent.reasoned', 'agent.decided']);
    expect(r.events.every((e) => e.agentId === 'core.openwop.agents.supervisor.default')).toBe(true);
    expect(r.result).toBeTypeOf('object');
  });

  it('throws AgentNotFoundError for an unknown agentId', () => {
    expect(() => runAgentDispatch({ agentId: 'core.nope.absent', task: {} })).toThrow(AgentNotFoundError);
  });

  describe('with a controlled handoff-schema + toolAllowlist agent', () => {
    beforeEach(() => { loadAgentsFromManifest(seedControlledAgent()); });

    it('§A14 filters the tool surface to the allowlist', () => {
      const r = runAgentDispatch({
        agentId: 'local.test.agents.worker', task: { goal: 'x' },
        availableTools: ['openwop:web.search', 'openwop:shell.exec', 'openwop:fs.read'],
      });
      expect(r.status).toBe('completed');
      expect(r.toolSurface.sort()).toEqual(['openwop:fs.read', 'openwop:web.search']); // shell.exec dropped
    });

    it('§D fails a task that violates the handoff task schema', () => {
      const r = runAgentDispatch({ agentId: 'local.test.agents.worker', task: { notGoal: 1 } });
      expect(r.status).toBe('failed');
      expect(r.error?.code).toBe('task_schema_violation');
    });

    it('§D produces a return-schema-conformant result on success', () => {
      const r = runAgentDispatch({ agentId: 'local.test.agents.worker', task: { goal: 'ship it' } });
      expect(r.status).toBe('completed');
      expect((r.result as { summary?: unknown }).summary).toBeTypeOf('string');
    });

    it('§F escalates a sub-threshold decision instead of proceeding', () => {
      const r = runAgentDispatch({ agentId: 'local.test.agents.worker', task: { goal: 'x' }, simulateConfidence: 0.4 });
      expect(r.status).toBe('escalated');
      expect(r.events.at(-1)).toMatchObject({ type: 'agent.decided', decision: 'escalate', confidence: 0.4 });
      expect(r.result).toBeUndefined();
    });
  });
});
