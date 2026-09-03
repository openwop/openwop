/**
 * Multi-Agent Shift — `core.openwop.agents.{deep-research, react, supervisor}`
 * pack-catalog evidence.
 *
 * The three reference agent packs published 2026-05-17 are registry-signed
 * (keyId `openwop-team-1`) but had no in-tree conformance scenarios
 * proving their `agents[]` manifests are reachable via the host pack
 * surface AND that each manifest's contents match the contract documented
 * in `RFCS/0003-agent-packs.md` + `schemas/agent-manifest.schema.json`.
 *
 * This file closes that gap. Three test groups, one per pack. Each group:
 *   1. Skips when the host doesn't advertise `capabilities.agents.supported`
 *      OR doesn't expose a pack-listing endpoint (`/v1/packs` returning
 *      404/501 → soft-skip).
 *   2. Locates the pack by name in the host's pack list.
 *   3. Validates the pack's `agents[]` entry against the AgentManifest
 *      contract: required fields, agentId namespace pattern, modelClass
 *      enum, toolAllowlist format, handoff schema refs.
 *
 * Behavioral assertions (the agent actually researches / reacts / supervises)
 * require an LLM + real agentRuntime host and live outside the public
 * conformance suite. The advertisement-shape + manifest-validity coverage
 * here is the wire-level guarantee a third-party host MUST satisfy to
 * claim "I ship the reference agent packs."
 *
 * @see RFCS/0003-agent-packs.md
 * @see schemas/agent-manifest.schema.json
 * @see packs/core.openwop.agents.{deep-research,react,supervisor}/pack.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface PackList {
  packs?: Array<{
    name?: string;
    version?: string;
    agents?: Array<{
      agentId?: string;
      persona?: string;
      modelClass?: string;
      systemPrompt?: string;
      systemPromptRef?: string;
      toolAllowlist?: string[];
      memoryShape?: Record<string, unknown>;
      handoff?: { taskSchemaRef?: string; returnSchemaRef?: string };
    }>;
  }>;
}

// AgentManifest agentId pattern from schemas/agent-manifest.schema.json.
const AGENT_ID_PATTERN = /^(core|vendor|community|private|local)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;
const VALID_MODEL_CLASSES = new Set([
  'reasoning', 'tool-using', 'chat', 'code', 'vision', 'multimodal',
  'embedding', 'classification', 'retrieval', 'research', 'delegate',
]);
const VALID_TOOL_SCOPES = ['openwop:', 'mcp:', 'vendor.', 'community.', 'private.', 'local.', 'host:'];

async function findPack(name: string): Promise<PackList['packs'] extends Array<infer T> | undefined ? T | null : never> {
  const res = await driver.get('/v1/packs');
  if (res.status === 404 || res.status === 501) return null as never;
  if (res.status !== 200) return null as never;
  const body = res.json as PackList;
  if (!Array.isArray(body.packs)) return null as never;
  const found = body.packs.find((p) => p.name === name);
  // Cast through unknown to satisfy the conditional return type.
  return (found ?? null) as never;
}

function assertAgentManifestShape(requirementId: string, 
  agent: NonNullable<NonNullable<PackList['packs']>[number]['agents']>[number],
  expectations: { agentIdEndsWith?: string; modelClass?: string; minTools?: number },
): void {
  // Required: agentId, persona, modelClass.
  expect(typeof agent.agentId, 'AgentManifest.agentId MUST be a string').toBe('string');
  expect(typeof agent.persona, 'AgentManifest.persona MUST be a string').toBe('string');
  expect(typeof agent.modelClass, 'AgentManifest.modelClass MUST be a string').toBe('string');

  // agentId pattern (RFCS/0003 §A namespace tiers).
  expect(
    AGENT_ID_PATTERN.test(agent.agentId ?? ''),
    req(requirementId, 
      'schemas/agent-manifest.schema.json §agentId',
      `agentId "${agent.agentId}" MUST match the namespace-tier pattern`,
    ),
  ).toBe(true);

  // modelClass enum check (loose — the schema declares an enum but
  // hosts MAY extend with research/delegate per the reference packs).
  if (agent.modelClass !== undefined) {
    expect(
      VALID_MODEL_CLASSES.has(agent.modelClass),
      `AgentManifest.modelClass "${agent.modelClass}" SHOULD be a recognized class`,
    ).toBe(true);
  }

  // systemPrompt XOR systemPromptRef.
  const hasInline = typeof agent.systemPrompt === 'string' && agent.systemPrompt.length > 0;
  const hasRef = typeof agent.systemPromptRef === 'string' && agent.systemPromptRef.length > 0;
  expect(
    hasInline !== hasRef,
    'AgentManifest MUST have exactly one of systemPrompt | systemPromptRef',
  ).toBe(true);

  // toolAllowlist: optional, but when present each entry MUST start with a recognized scope.
  if (Array.isArray(agent.toolAllowlist)) {
    for (const tool of agent.toolAllowlist) {
      expect(
        VALID_TOOL_SCOPES.some((scope) => tool.startsWith(scope)),
        `toolAllowlist entry "${tool}" MUST start with a recognized scope`,
      ).toBe(true);
    }
    if (expectations.minTools !== undefined) {
      expect(
        agent.toolAllowlist.length,
        `agent's toolAllowlist MUST have at least ${expectations.minTools} entries`,
      ).toBeGreaterThanOrEqual(expectations.minTools);
    }
  }

  // Per-pack expectations.
  if (expectations.agentIdEndsWith !== undefined) {
    expect(agent.agentId ?? '').toContain(expectations.agentIdEndsWith);
  }
  if (expectations.modelClass !== undefined) {
    expect(agent.modelClass).toBe(expectations.modelClass);
  }
}

const SKIP = !isAgentSupported();

describe.skipIf(SKIP)('core.openwop.agents.deep-research — pack catalog evidence', () => {
  it('host pack-list includes deep-research with a well-formed AgentManifest', async () => {
    const pack = await findPack('core.openwop.agents.deep-research');
    if (pack === null) return softSkip('blocked', 'precondition not met — `pack === null` returned early (host doesn\'t expose /v1/packs or doesn\'t have this pack) (seam, prior step, or fixture unavailable)'); // host doesn't expose /v1/packs or doesn't have this pack
    expect(pack.version, req('openwop.it.agentPackCatalog.host-pack-list-includes-deep-research-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'pack version MUST be present')).toBeDefined();
    expect(Array.isArray(pack.agents) && pack.agents.length === 1, req('openwop.it.agentPackCatalog.host-pack-list-includes-deep-research-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'deep-research ships exactly one agent')).toBe(true);
    assertAgentManifestShape('openwop.it.agentPackCatalog.host-pack-list-includes-deep-research-with-a-well-formed-agentmanifest', pack.agents![0]!, {
      agentIdEndsWith: 'deep-research',
      modelClass: 'research',
      minTools: 1,
    });
    // Domain-specific: deep-research uses long-term memory + RAG retrievers.
    const tools = pack.agents![0]!.toolAllowlist ?? [];
    expect(
      tools.some((t) => t.includes('rag') || t.includes('retriever')),
      req('openwop.it.agentPackCatalog.host-pack-list-includes-deep-research-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'deep-research SHOULD allow at least one rag/retriever tool'),
    ).toBe(true);
    expect(
      pack.agents![0]!.memoryShape?.longTerm,
      req('openwop.it.agentPackCatalog.host-pack-list-includes-deep-research-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'deep-research MUST request longTerm memory (it persists facts across runs)'),
    ).toBe(true);
  });
});

describe.skipIf(SKIP)('core.openwop.agents.react — pack catalog evidence', () => {
  it('host pack-list includes react with a well-formed AgentManifest', async () => {
    const pack = await findPack('core.openwop.agents.react');
    if (pack === null) return softSkip('blocked', 'precondition not met — `pack === null` returned early (seam, prior step, or fixture unavailable)');
    expect(pack.version).toBeDefined();
    expect(Array.isArray(pack.agents) && pack.agents.length >= 1, req('openwop.it.agentPackCatalog.host-pack-list-includes-react-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'react ships at least one agent')).toBe(true);
    assertAgentManifestShape('openwop.it.agentPackCatalog.host-pack-list-includes-react-with-a-well-formed-agentmanifest', pack.agents![0]!, {
      agentIdEndsWith: 'react',
    });
    // ReAct pattern requires handoff schemas (task + return).
    const handoff = pack.agents![0]!.handoff;
    expect(handoff, req('openwop.it.agentPackCatalog.host-pack-list-includes-react-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'react AgentManifest MUST include a handoff block')).toBeDefined();
    expect(typeof handoff?.taskSchemaRef, req('openwop.it.agentPackCatalog.host-pack-list-includes-react-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'handoff.taskSchemaRef MUST be a string')).toBe('string');
    expect(typeof handoff?.returnSchemaRef, req('openwop.it.agentPackCatalog.host-pack-list-includes-react-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'handoff.returnSchemaRef MUST be a string')).toBe('string');
  });
});

describe.skipIf(SKIP)('core.openwop.agents.supervisor — pack catalog evidence', () => {
  it('host pack-list includes supervisor with a well-formed AgentManifest', async () => {
    const pack = await findPack('core.openwop.agents.supervisor');
    if (pack === null) return softSkip('blocked', 'precondition not met — `pack === null` returned early (seam, prior step, or fixture unavailable)');
    expect(pack.version).toBeDefined();
    expect(Array.isArray(pack.agents) && pack.agents.length >= 1, req('openwop.it.agentPackCatalog.host-pack-list-includes-supervisor-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'supervisor ships at least one agent')).toBe(true);
    assertAgentManifestShape('openwop.it.agentPackCatalog.host-pack-list-includes-supervisor-with-a-well-formed-agentmanifest', pack.agents![0]!, {
      agentIdEndsWith: 'supervisor',
    });
    // Supervisor pattern delegates to crew members; its modelClass should
    // be `delegate` or `reasoning` (it makes orchestration decisions).
    const mc = pack.agents![0]!.modelClass;
    expect(
      mc === 'delegate' || mc === 'reasoning',
      req('openwop.it.agentPackCatalog.host-pack-list-includes-supervisor-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', `supervisor SHOULD have modelClass=delegate|reasoning, got "${mc}"`),
    ).toBe(true);
    // Supervisor needs handoff schemas to dispatch work.
    expect(pack.agents![0]!.handoff, req('openwop.it.agentPackCatalog.host-pack-list-includes-supervisor-with-a-well-formed-agentmanifest', 'RFCS/0003-agent-packs.md', 'supervisor MUST include handoff schemas')).toBeDefined();
  });
});

describe.skipIf(SKIP)('agent-pack catalog summary', () => {
  it('all three 2026-05-17 reference agent packs are catalog-reachable', async () => {
    const names = [
      'core.openwop.agents.deep-research',
      'core.openwop.agents.react',
      'core.openwop.agents.supervisor',
    ];
    const found: string[] = [];
    for (const n of names) {
      const p = await findPack(n);
      if (p !== null) found.push(n);
    }
    // Either none are present (host doesn't ship these — skip) OR all are
    // present (host ships the full reference batch). Half-shipping is a
    // configuration error worth flagging.
    if (found.length === 0) return softSkip('blocked', 'precondition not met — `found.length === 0` returned early (Either none are present (host doesn\'t ship these — skip) OR all are present (host ships the full reference batch). Half-shipping is a configuration error wor…');
    expect(
      found.length,
      req('openwop.it.agentPackCatalog.all-three-2026-05-17-reference-agent-packs-are-catalog-reachable', 'RFCS/0003-agent-packs.md', 'host SHOULD ship the reference agent packs as a coherent batch (none, or all three)'),
    ).toBe(names.length);
  });
});
