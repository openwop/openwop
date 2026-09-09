/**
 * core.openwop.agents.run — tool-allowlist enforcement contract
 *
 * Closes `OPENWOP-AUDIT-2026-003`: the 1.0.0 pack invoked workflow-supplied
 * `tool.handler` as raw JS in its fallback loop, breaking the spec's
 * `prompt-injection-tool-allowlist` invariant (`threat-model-prompt-injection.md`
 * §"Authority bypass"). 1.0.1 refuses function-typed handlers outright; this
 * scenario locks the refusal in as a CI gate so a future pack reimplementation
 * cannot silently regress.
 *
 * Server-free. Loads the pack via dynamic import and asserts:
 *
 *   1. `tools[]` entries with `typeof handler === 'function'` are rejected
 *      with `INVALID_TOOL_DECLARATION` BEFORE any LLM call. The defect path.
 *   2. `tools[]` entries missing a `name` are rejected (declaration discipline).
 *   3. `tools[]` entries missing a `kind` discriminator are rejected (the host
 *      cannot resolve an unkinded tool through its connector registry).
 *   4. Tool-driven runs (`tools.length > 0`) WITHOUT `ctx.agentRuntime` refuse
 *      with `HOST_CAPABILITY_MISSING` — the inline fallback that invoked raw
 *      handlers was removed in 1.0.1; there is no longer a host-less path for
 *      tool dispatch.
 *   5. Tool-less runs (`tools.length === 0`) succeed via `ctx.callAIWithTools`
 *      with no tool dispatch (safe path preserved across the fix).
 *   6. The preferred `ctx.agentRuntime.run` path threads through unchanged.
 *
 * Skip-conditions: soft-skips when `packs/core.openwop.agents/index.mjs` is not
 * present (published-conformance-package context where pack source isn't shipped).
 *
 * @see SECURITY/internal-pre-audit-findings.json#OPENWOP-AUDIT-2026-003
 * @see SECURITY/threat-model-prompt-injection.md §"Authority bypass" + §"prompt-injection-tool-allowlist"
 * @see SECURITY/invariants.yaml#agents-run-no-raw-handler
 * @see packs/core.openwop.agents/index.mjs (1.0.1)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = resolve(__dirname, '../../../packs/core.openwop.agents/index.mjs');

interface AgentRunCtx {
  config?: Record<string, unknown>;
  inputs?: {
    userPrompt?: string;
    tools?: unknown[];
    memory?: unknown;
    outputParser?: unknown;
  };
  agentRuntime?: { run?: (...args: unknown[]) => Promise<unknown> };
  callAIWithTools?: (...args: unknown[]) => Promise<{ text?: string; usage?: unknown; toolCalls?: unknown[] }>;
  emit?: (...args: unknown[]) => Promise<void>;
}

type AgentRunFn = (ctx: AgentRunCtx) => Promise<{ status: 'success'; outputs: Record<string, unknown> }>;

async function expectRejection(fn: () => Promise<unknown>, expectedCode: string, description: string): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, description).toBeInstanceOf(Error);
  expect((caught as Error & { code?: string }).code, `${description} → code`).toBe(expectedCode);
}

describe('category: core.openwop.agents.run — tool-allowlist enforcement (OPENWOP-AUDIT-2026-003)', () => {
  let agentRun: AgentRunFn;
  let packAvailable: boolean;

  beforeAll(async () => {
    packAvailable = existsSync(PACK_PATH);
    if (!packAvailable) return;
    const mod = (await import(PACK_PATH)) as { agentRun?: AgentRunFn };
    if (typeof mod.agentRun !== 'function') {
      throw new Error(`expected packs/core.openwop.agents/index.mjs to export agentRun; got ${typeof mod.agentRun}`);
    }
    agentRun = mod.agentRun;
  });

  it('skips cleanly when pack source is not bundled', () => {
    if (!packAvailable) {
      console.warn('[agents-run-tool-allowlist] pack source not present; skipping');
      expect(packAvailable, req('openwop.it.agents-run-tool-allowlist.skips-cleanly-when-pack-source-is-not-bundled', 'threat-model-prompt-injection.md', 'skips cleanly when pack source is not bundled')).toBe(false);
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early ([agents-run-tool-allowlist] pack source not present; skipping)');
    }
    expect(packAvailable).toBe(true);
  });

  it('rejects function-typed tool.handler (the defect path)', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    // The 1.0.0 defect: a workflow author could supply executable JS via
    // tools[].handler and the pack would await it directly with ctx. Closed
    // in 1.0.1 — the validator throws INVALID_TOOL_DECLARATION at the run
    // boundary, BEFORE any LLM call.
    await expectRejection(
      () => agentRun({
        config: {},
        inputs: {
          userPrompt: 'x',
          tools: [{ name: 'evil', kind: 'function', handler: () => 'rce' }],
        },
      }),
      'INVALID_TOOL_DECLARATION',
      'function-typed handler MUST be refused',
    );
  });

  it('rejects tool declaration missing a name', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    await expectRejection(
      () => agentRun({ config: {}, inputs: { userPrompt: 'x', tools: [{ kind: 'workflow' }] } }),
      'INVALID_TOOL_DECLARATION',
      'unnamed tool MUST be refused',
    );
  });

  it('rejects tool declaration missing a kind discriminator', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    await expectRejection(
      () => agentRun({ config: {}, inputs: { userPrompt: 'x', tools: [{ name: 't1' }] } }),
      'INVALID_TOOL_DECLARATION',
      'unkinded tool MUST be refused — host cannot resolve through its registry',
    );
  });

  it('rejects tool-driven runs when host does not provide agentRuntime', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    // Tool dispatch MUST go through a host-resolved runtime — the 1.0.0
    // inline-handler fallback is gone.
    await expectRejection(
      () => agentRun({
        config: {},
        inputs: { userPrompt: 'x', tools: [{ name: 't1', kind: 'workflow' }] },
      }),
      'HOST_CAPABILITY_MISSING',
      'tools[] with no agentRuntime MUST refuse',
    );
  });

  it('tool-less run succeeds via callAIWithTools (safe fallback preserved)', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    let toolsSeen: unknown = 'never-called';
    const ctx: AgentRunCtx = {
      config: {},
      inputs: { userPrompt: 'hi', tools: [] },
      callAIWithTools: async (args: unknown) => {
        toolsSeen = (args as { tools?: unknown[] }).tools;
        return { text: 'hello back', usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const result = await agentRun(ctx);
    expect(result.outputs.result).toBe('hello back');
    expect(result.outputs.finishReason).toBe('complete');
    expect(toolsSeen, req('openwop.it.agents-run-tool-allowlist.tool-less-run-succeeds-via-callaiwithtools-safe-fallback-preserved', 'threat-model-prompt-injection.md', 'tool-less fallback MUST pass an empty tools array — no LLM-driven dispatch')).toEqual([]);
  });

  it('agentRuntime.run path threads through unchanged when host provides it', async () => {
    if (!packAvailable) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!packAvailable` returned early');
    let receivedTools: unknown;
    const ctx: AgentRunCtx = {
      config: {},
      inputs: {
        userPrompt: 'x',
        tools: [{ name: 't1', kind: 'workflow', ref: 'vendor.acme.demo' }],
      },
      agentRuntime: {
        run: async (reqBody: unknown) => {
          receivedTools = (reqBody as { tools?: unknown[] }).tools;
          return { result: 'from-runtime', toolCalls: [{ name: 't1' }] };
        },
      },
    };
    const result = await agentRun(ctx);
    expect(result.outputs.result).toBe('from-runtime');
    expect(receivedTools, req('openwop.it.agents-run-tool-allowlist.agentruntime-run-path-threads-through-unchanged-when-host-provides-it', 'threat-model-prompt-injection.md', 'host MUST receive the validated tools array')).toEqual([
      { name: 't1', kind: 'workflow', ref: 'vendor.acme.demo' },
    ]);
  });
});
