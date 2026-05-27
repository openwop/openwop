import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadAgentsFromManifest, resolveDependencyDisposition } from '../src/packs/agentLoader.js';
import { getAgentRegistry } from '../src/executor/agentRegistry.js';

// test/ → typescript → backend → workflow-engine → apps → repo root (5 up).
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');
const SUPERVISOR_PACK = join(REPO_ROOT, 'packs', 'core.openwop.agents.supervisor');

describe('agentLoader — RFC 0070 / RFC 0003 §C/§D manifest resolution', () => {
  beforeEach(() => getAgentRegistry()._resetForTest());

  it('loads a real agent pack, resolving systemPromptRef + handoff schemas', () => {
    const loaded = loadAgentsFromManifest(SUPERVISOR_PACK);
    expect(loaded.length).toBe(1);
    const a = loaded[0];
    expect(a.agentId).toBe('core.openwop.agents.supervisor.default');
    // §C: systemPromptRef resolved to inline body (non-empty), provenance kept.
    expect(a.systemPromptRef).toBe('prompts/supervisor.md');
    expect(a.systemPrompt.length).toBeGreaterThan(0);
    // §D: handoff schema refs resolved to parsed JSON Schema objects.
    expect(a.handoff?.taskSchema).toBeTypeOf('object');
    expect(a.handoff?.returnSchema).toBeTypeOf('object');
    expect(a.confidence?.defaultThreshold).toBe(0.75);
    // Registered + resolvable from the registry.
    expect(getAgentRegistry().get(a.agentId)?.persona).toBe(a.persona);
    expect(getAgentRegistry().listAgentIds()).toContain(a.agentId);
  });

  it('rejects a systemPromptRef that escapes the pack root (RFC 0003 §C)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentpack-'));
    try {
      mkdirSync(join(dir, 'prompts'), { recursive: true });
      writeFileSync(join(dir, 'prompts', 'ok.md'), 'safe prompt body');
      writeFileSync(join(dir, 'pack.json'), JSON.stringify({
        name: 'local.test.agents', version: '1.0.0', nodes: [],
        agents: [
          { agentId: 'local.test.agents.evil', persona: 'Evil', modelClass: 'general', systemPromptRef: '../../../../etc/passwd' },
          { agentId: 'local.test.agents.good', persona: 'Good', modelClass: 'general', systemPromptRef: 'prompts/ok.md' },
        ],
      }));
      const loaded = loadAgentsFromManifest(dir);
      // The traversal agent is skipped; the well-formed one still loads.
      expect(loaded.map((a) => a.agentId)).toEqual(['local.test.agents.good']);
      expect(getAgentRegistry().has('local.test.agents.evil')).toBe(false);
      expect(getAgentRegistry().has('local.test.agents.good')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveDependencyDisposition — RFC 0072 §C', () => {
  const sat = (have: string[]) => (cap: string) => have.includes(cap);

  it('a bare (required) peer-dep that is unmet is refused', () => {
    const d = resolveDependencyDisposition(
      { 'agents.manifestRuntime': 'supported', 'host.agentRuntime': 'supported' },
      undefined,
      sat(['agents.manifestRuntime']),
    );
    expect(d.refused).toEqual(['host.agentRuntime']);
    expect(d.degraded).toEqual([]);
  });

  it('an optional peer-dep that is unmet degrades (not refused)', () => {
    const d = resolveDependencyDisposition(
      { 'agents.manifestRuntime': 'supported', 'agents.memoryBackends': 'supported' },
      { 'agents.memoryBackends': { optional: true } },
      sat(['agents.manifestRuntime']),
    );
    expect(d.refused).toEqual([]);
    expect(d.degraded).toEqual(['agents.memoryBackends']);
  });

  it('all-satisfied ⇒ neither refused nor degraded', () => {
    const d = resolveDependencyDisposition(
      { 'agents.manifestRuntime': 'supported' }, { 'agents.manifestRuntime': { optional: true } },
      sat(['agents.manifestRuntime']),
    );
    expect(d).toEqual({ refused: [], degraded: [] });
  });
});

describe('loadAgentsFromManifest — RFC 0072 §C degraded[] + strict refuse', () => {
  beforeEach(() => getAgentRegistry()._resetForTest());

  function seedPack(peerDependencies: Record<string, string>, meta?: Record<string, { optional?: boolean }>): string {
    const dir = mkdtempSync(join(tmpdir(), 'agentpack72-'));
    writeFileSync(join(dir, 'pack.json'), JSON.stringify({
      name: 'local.test.tiers', version: '1.0.0', nodes: [],
      peerDependencies, ...(meta ? { peerDependenciesMeta: meta } : {}),
      agents: [{ agentId: 'local.test.tiers.worker', persona: 'W', modelClass: 'general', systemPrompt: 'x' }],
    }));
    return dir;
  }

  it('surfaces an unmet optional tier in the agent inventory degraded[]', () => {
    const dir = seedPack(
      { 'agents.manifestRuntime': 'supported', 'agents.memoryBackends': 'supported' },
      { 'agents.memoryBackends': { optional: true } },
    );
    const loaded = loadAgentsFromManifest(dir, { hostSatisfies: (c) => c === 'agents.manifestRuntime' });
    expect(loaded[0].degraded).toEqual(['agents.memoryBackends']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('strict mode refuses a pack with a required-unmet tier (no agents loaded)', () => {
    const dir = seedPack({ 'agents.manifestRuntime': 'supported', 'host.agentRuntime': 'supported' });
    const loaded = loadAgentsFromManifest(dir, { hostSatisfies: (c) => c === 'agents.manifestRuntime', strict: true });
    expect(loaded).toEqual([]);
    expect(getAgentRegistry().has('local.test.tiers.worker')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
