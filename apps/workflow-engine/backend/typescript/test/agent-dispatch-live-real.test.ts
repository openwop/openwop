/**
 * Live agent dispatch through the REAL provider pipeline — no mocked callAI.
 *
 * Closes the smoke's honest gap (it covered everything except an actual model
 * call). Here `runAgentDispatchLive` runs through the real
 * `createAiProvidersAdapter().callAI` → policy → `dispatchStructured` →
 * `dispatchMock`, exercising structured-output parsing/validation, §F
 * escalation, usage emission, and SR-1 — all in-sandbox via the keyless
 * conformance `mock` provider (pinned through modelClassResolver).
 *
 * createApp installs the invocation-log / event-log / policy singletons the
 * adapter needs; we don't open an HTTP listener.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import type { HostAdapterSuite } from '../src/host/index.js';
import { createAiProvidersAdapter } from '../src/aiProviders/aiProvidersHost.js';
import { programMock } from '../src/providers/dispatchMock.js';
import { getAgentRegistry, type ResolvedAgentManifest } from '../src/executor/agentRegistry.js';
import { runAgentDispatchLive } from '../src/host/agentDispatch.js';

let app: Awaited<ReturnType<typeof createApp>>;
let port = 19600;

beforeEach(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  app = await createApp({ port: port++, storageDsn: 'memory://', serviceName: 't', serviceVersion: '0', enableConsoleTracer: false });
});
afterEach(async () => {
  await (app.locals.storage as { close: () => Promise<void> }).close();
});

function answerValidator(value: unknown): { ok: boolean; errors?: string } {
  if (value && typeof value === 'object' && typeof (value as { answer?: unknown }).answer === 'string') return { ok: true };
  return { ok: false, errors: 'missing string answer' };
}

function registerAgent(agentId: string, over: Partial<ResolvedAgentManifest> = {}): void {
  getAgentRegistry().register({
    agentId, persona: 'Tess', modelClass: 'chat', systemPrompt: 'You are Tess.',
    packName: 'test', packVersion: '0', toolAllowlist: [],
    handoff: {
      returnSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
      validateReturn: answerValidator,
    },
    ...over,
  });
}

/** A real adapter's callAI bound to a unique nodeId, capturing emitted events. */
function realCallAI(nodeId: string, events: Array<{ type: string }>) {
  const hostSuite = app.locals.hostSuite as HostAdapterSuite;
  const adapter = createAiProvidersAdapter({
    runId: `run-${nodeId}`, nodeId, tenantId: 't1', attempt: 1,
    secrets: {}, policyResolver: hostSuite.providerPolicyResolver,
    emit: async (type) => { events.push({ type }); return { eventId: `e${events.length}`, sequence: events.length }; },
  });
  return adapter.callAI; // the agent's turn pins the keyless mock provider via modelOptions
}

describe('runAgentDispatchLive — real callAI pipeline via mock provider', () => {
  it('completes a real structured-output turn (parse + schema validate)', async () => {
    const nodeId = 'agent.dispatch.complete';
    registerAgent('t.complete');
    programMock(nodeId, [{ content: '{"answer":"42"}', stopReason: 'end_turn', inputTokens: 5, outputTokens: 3 }]);
    const events: Array<{ type: string }> = [];
    const callAI = realCallAI(nodeId, events);

    const result = await runAgentDispatchLive(
      { agentId: 't.complete', task: { q: 'meaning?' } },
      { callAI, modelOptions: { provider: 'mock', model: nodeId } },
    );

    expect(result.status).toBe('completed');
    expect(result.live).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.result).toEqual({ answer: '42' });
    // A real provider.usage event was emitted by the pipeline (token counts set).
    expect(events.some((e) => e.type === 'provider.usage')).toBe(true);
  });

  it('escalates when the real model output declares low _confidence (§F)', async () => {
    const nodeId = 'agent.dispatch.escalate';
    registerAgent('t.escalate', { confidence: { defaultThreshold: 0.7 } });
    programMock(nodeId, [{ content: '{"answer":"maybe","_confidence":0.2}', stopReason: 'end_turn' }]);
    const events: Array<{ type: string }> = [];

    const result = await runAgentDispatchLive(
      { agentId: 't.escalate' },
      { callAI: realCallAI(nodeId, events), modelOptions: { provider: 'mock', model: nodeId } },
    );
    expect(result.status).toBe('escalated');
    expect(result.confidence).toBe(0.2);
  });

  it('SR-1: no cleartext credential appears in the result (intent check)', async () => {
    // Intent/regression guard: the mock path carries no credential, so this
    // cannot fail today — it pins the contract that a dispatch result never
    // serializes secret material. The real credential-redaction (credentialRef
    // hashing) is covered on a keyed provider by the opt-in managed test.
    const nodeId = 'agent.dispatch.sr1';
    registerAgent('t.sr1');
    programMock(nodeId, [{ content: '{"answer":"ok"}', stopReason: 'end_turn' }]);
    const result = await runAgentDispatchLive(
      { agentId: 't.sr1' },
      { callAI: realCallAI(nodeId, []), modelOptions: { provider: 'mock', model: nodeId } },
    );
    expect(result.status).toBe('completed');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/apiKey|sk-|secret/i);
  });
});
