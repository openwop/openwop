/**
 * Live agent dispatch (host/agentDispatch.ts runAgentDispatchLive) with a mock
 * callAI — verifies the real-turn path honors the same floor contracts as the
 * deterministic seam:
 *
 *   - resolves modelClass → a concrete (provider, model) and calls callAI with
 *     the agent's systemPrompt
 *   - structured-output mode when a return schema is declared; the parsed data
 *     is the result and is validated against the schema
 *   - §D return-schema violation → failed
 *   - §D inbound task violation → failed (no model call)
 *   - §F escalation when the model's structured output declares low confidence
 *   - tool surface filtered to the allowlist
 *   - provider error → failed (not thrown), with the provider error code
 *   - unknown agent → throws AgentNotFoundError
 *
 * No live credentials needed — callAI is injected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentRegistry, type ResolvedAgentManifest } from '../src/executor/agentRegistry.js';
import { runAgentDispatchLive, AgentNotFoundError, type CallAi } from '../src/host/agentDispatch.js';
import type { AiCallRequest, AiCallResult } from '../src/executor/types.js';

const registry = getAgentRegistry();

/** A return-schema validator that requires an object with a string `answer`. */
function answerValidator(value: unknown): { ok: boolean; errors?: string } {
  if (value && typeof value === 'object' && typeof (value as { answer?: unknown }).answer === 'string') return { ok: true };
  return { ok: false, errors: 'missing string answer' };
}

function registerAgent(over: Partial<ResolvedAgentManifest> = {}): ResolvedAgentManifest {
  const agent: ResolvedAgentManifest = {
    agentId: 'test.agent',
    persona: 'Tess',
    modelClass: 'chat',
    systemPrompt: 'You are Tess.',
    packName: 'test',
    packVersion: '0',
    toolAllowlist: ['search'],
    handoff: {
      returnSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
      validateReturn: answerValidator,
    },
    ...over,
  };
  registry.register(agent);
  return agent;
}

beforeEach(() => registry._resetForTest());
afterEach(() => vi.restoreAllMocks());

describe('runAgentDispatchLive', () => {
  it('makes a real turn: resolves a model, passes the system prompt, returns the parsed data', async () => {
    registerAgent();
    const callAI = vi.fn<(req: AiCallRequest) => Promise<AiCallResult>>(async () => ({ data: { answer: 'forty-two' } }));
    const result = await runAgentDispatchLive({ agentId: 'test.agent', availableTools: ['search', 'delete'] }, { callAI });

    expect(result.status).toBe('completed');
    expect(result.live).toBe(true);
    expect(result.result).toEqual({ answer: 'forty-two' });
    expect(result.provider).toBeTruthy();
    expect(result.model).toBeTruthy();
    // tool surface filtered to the allowlist (delete dropped)
    expect(result.toolSurface).toEqual(['search']);

    // callAI was invoked once, in structured-output mode, with the system prompt.
    expect(callAI).toHaveBeenCalledTimes(1);
    const req = callAI.mock.calls[0]![0];
    expect(req.systemPrompt).toBe('You are Tess.');
    expect(req.responseSchema).toBeTruthy();
    expect(req.provider).toBe(result.provider);
  });

  it('fails on a return-schema violation against the real output', async () => {
    registerAgent();
    const callAI: CallAi = async () => ({ data: { wrong: true } }); // no `answer`
    const result = await runAgentDispatchLive({ agentId: 'test.agent' }, { callAI });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('return_schema_violation');
  });

  it('fails an inbound task-schema violation without calling the model', async () => {
    registerAgent({
      handoff: {
        taskSchema: { type: 'object', required: ['q'] },
        validateTask: (v) => (v && typeof v === 'object' && 'q' in (v as object) ? { ok: true } : { ok: false, errors: 'missing q' }),
        returnSchema: { type: 'object', required: ['answer'] },
        validateReturn: answerValidator,
      },
    });
    const callAI = vi.fn<(req: AiCallRequest) => Promise<AiCallResult>>(async () => ({ data: { answer: 'x' } }));
    const result = await runAgentDispatchLive({ agentId: 'test.agent', task: { nope: 1 } }, { callAI });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('task_schema_violation');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('escalates when the model declares _confidence below threshold (§F)', async () => {
    registerAgent({ confidence: { defaultThreshold: 0.7 } });
    // Reserved _confidence meta-field — a bare `confidence` is NOT honored.
    const callAI: CallAi = async () => ({ data: { answer: 'maybe', _confidence: 0.3 } });
    const result = await runAgentDispatchLive({ agentId: 'test.agent' }, { callAI });
    expect(result.status).toBe('escalated');
    expect(result.confidence).toBe(0.3);
  });

  it('does NOT escalate on a bare domain `confidence` field (no reserved key)', async () => {
    registerAgent({
      confidence: { defaultThreshold: 0.7 },
      handoff: {
        returnSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' }, confidence: { type: 'number' } } },
        validateReturn: answerValidator,
      },
    });
    // A domain field literally named `confidence` must not drive §F escalation.
    const callAI: CallAi = async () => ({ data: { answer: 'sure', confidence: 0.1 } });
    const result = await runAgentDispatchLive({ agentId: 'test.agent' }, { callAI });
    expect(result.status).toBe('completed');
  });

  it('returns failed (not thrown) when the provider call errors, carrying the code', async () => {
    registerAgent();
    const callAI: CallAi = async () => {
      throw Object.assign(new Error('byok required'), { code: 'byok_required' });
    };
    const result = await runAgentDispatchLive({ agentId: 'test.agent' }, { callAI });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('byok_required');
  });

  it('returns plain content when the agent declares no return schema', async () => {
    registerAgent({ handoff: undefined });
    const callAI: CallAi = async () => ({ content: 'hello there' });
    const result = await runAgentDispatchLive({ agentId: 'test.agent' }, { callAI });
    expect(result.status).toBe('completed');
    expect(result.result).toEqual({ content: 'hello there' });
  });

  it('throws AgentNotFoundError for an unknown agent', async () => {
    const callAI: CallAi = async () => ({ content: '' });
    await expect(runAgentDispatchLive({ agentId: 'nope' }, { callAI })).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});
