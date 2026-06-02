/**
 * OPT-IN real-provider verification for live agent dispatch.
 *
 * Skipped by default (never runs in CI). When an operator has configured the
 * managed tier (set MINIMAX_API_KEY) and runs with OPENWOP_VERIFY_LIVE=1, this
 * exercises runAgentDispatchLive against a REAL model completion through the
 * managed provider — the one hop the keyless mock-provider test cannot cover.
 *
 *   MINIMAX_API_KEY=... OPENWOP_VERIFY_LIVE=1 \
 *     npx vitest run test/agent-dispatch-live-managed.test.ts
 *
 * @see test/agent-dispatch-live-real.test.ts — the in-sandbox (mock) pipeline test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import type { HostAdapterSuite } from '../src/host/index.js';
import { createAiProvidersAdapter } from '../src/aiProviders/aiProvidersHost.js';
import { getAgentRegistry } from '../src/executor/agentRegistry.js';
import { runAgentDispatchLive } from '../src/host/agentDispatch.js';

const LIVE = process.env.OPENWOP_VERIFY_LIVE === '1' || process.env.OPENWOP_VERIFY_LIVE === 'true';

describe.skipIf(!LIVE)('runAgentDispatchLive — real managed-provider completion (opt-in)', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeEach(async () => {
    process.env.OPENWOP_STORAGE_DSN = 'memory://';
    app = await createApp({ port: 19700, storageDsn: 'memory://', serviceName: 't', serviceVersion: '0', enableConsoleTracer: false });
  });
  afterEach(async () => {
    await (app.locals.storage as { close: () => Promise<void> }).close();
  });

  it('produces a non-empty completion from the managed tier', async () => {
    // No return schema → plain-text completion (result.content).
    getAgentRegistry().register({
      agentId: 'live.agent', persona: 'Live', modelClass: 'chat',
      systemPrompt: 'You are a terse assistant. Reply with a single short sentence.',
      packName: 'test', packVersion: '0', toolAllowlist: [],
    });
    const hostSuite = app.locals.hostSuite as HostAdapterSuite;
    const adapter = createAiProvidersAdapter({
      runId: 'live-run', nodeId: 'agent.dispatch.live', tenantId: 'default', attempt: 1,
      secrets: {}, policyResolver: hostSuite.providerPolicyResolver,
    });
    // Default modelOptions (preferManaged) → managed tier, real model call.
    const result = await runAgentDispatchLive(
      { agentId: 'live.agent', task: 'Say hello in five words or fewer.' },
      { callAI: adapter.callAI },
    );

    expect(result.status).toBe('completed');
    expect(result.live).toBe(true);
    const content = (result.result as { content?: string } | undefined)?.content ?? '';
    expect(content.length).toBeGreaterThan(0);
  }, 60_000);
});
