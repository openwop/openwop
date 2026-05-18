/**
 * core.openwop.agents — agent composition primitives.
 *
 * Root: agent.run. Sub-nodes: tool / memory / parser / model-selector.
 * Sub-nodes emit declarations; agent.run consumes them and runs the loop
 * via ctx.agentRuntime (host-resolved tool registry per
 * `prompt-injection-tool-allowlist`) or, for tool-less runs only, via
 * ctx.callAIWithTools.
 *
 * Security posture (1.0.1, OPENWOP-AUDIT-2026-003):
 *   - Tools MUST be structured declarations: `{ kind, name, ref?, argumentsSchema? }`.
 *   - Function-typed `handler` properties are REFUSED outright. The 1.0.0
 *     fallback that invoked `tool.handler(call.arguments, ctx)` as raw JS
 *     is removed — it broke `prompt-injection-tool-allowlist` by letting
 *     workflow-supplied JS execute against the pack's `ctx` (including
 *     `ctx.callAI`, `ctx.storage`, secrets views).
 *   - Tool-driven runs (`tools.length > 0`) REQUIRE `ctx.agentRuntime.run`
 *     so the host resolves each LLM-emitted tool call through its own
 *     gated connector / registry. Tool-less runs can still use the inline
 *     `ctx.callAIWithTools` fallback — no tool dispatch, no exposure.
 */

const decl = (kind) => async (ctx) => ({
  status: 'success',
  outputs: kind === 'tool'
    ? { tool: { kind: ctx.config.kind ?? null, ...ctx.config, ...ctx.inputs } }
    : kind === 'memory'
    ? { memory: { kind: ctx.config.kind ?? null, ...ctx.config, ...ctx.inputs } }
    : kind === 'parser'
    ? { parser: { kind: ctx.config.kind ?? null, ...ctx.config, ...ctx.inputs } }
    : { value: { ...ctx.config, ...ctx.inputs } },
});

/**
 * Validate every entry in `inputs.tools` is a structured host-resolvable
 * declaration. Throws INVALID_TOOL_DECLARATION on any function-typed
 * handler (the OPENWOP-AUDIT-2026-003 defect path).
 */
function validateTools(tools) {
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    if (tool == null || typeof tool !== 'object') {
      throw Object.assign(
        new Error(`tools[${i}] MUST be an object`),
        { code: 'INVALID_TOOL_DECLARATION' },
      );
    }
    if (typeof tool.handler === 'function') {
      throw Object.assign(
        new Error(
          `tools[${i}] '${tool.name ?? '<unnamed>'}' has a function-typed handler. ` +
          `Tools MUST be structured declarations the host resolves through its registry; ` +
          `function handlers were removed in 1.0.1 (OPENWOP-AUDIT-2026-003 — ` +
          `closes prompt-injection-tool-allowlist).`,
        ),
        { code: 'INVALID_TOOL_DECLARATION' },
      );
    }
    if (typeof tool.name !== 'string' || tool.name.length === 0) {
      throw Object.assign(
        new Error(`tools[${i}] MUST declare a non-empty string name`),
        { code: 'INVALID_TOOL_DECLARATION' },
      );
    }
    if (typeof tool.kind !== 'string' || tool.kind.length === 0) {
      throw Object.assign(
        new Error(
          `tools[${i}] '${tool.name}' MUST declare a 'kind' discriminator ` +
          `the host knows how to invoke (e.g., function, workflow, mcp, http).`,
        ),
        { code: 'INVALID_TOOL_DECLARATION' },
      );
    }
  }
}

export async function agentRun(ctx) {
  const tools = ctx.inputs.tools ?? [];
  validateTools(tools);

  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;

  // Preferred path: host-resolved agent runtime. Host gates each
  // LLM-emitted tool call against its allowlist + invokes the resolved
  // handler in its own process — pack does not see executable material.
  if (typeof ctx.agentRuntime?.run === 'function') {
    const result = await ctx.agentRuntime.run(
      {
        strategy: ctx.config.strategy ?? 'tools',
        systemPrompt: ctx.config.systemPrompt,
        userPrompt: ctx.inputs.userPrompt,
        tools,
        memory: ctx.inputs.memory ?? null,
        outputParser: ctx.inputs.outputParser ?? null,
        maxSteps: ctx.config.maxSteps ?? 10,
      },
      emit ? async (e) => emit({ kind: 'node.progress', payload: e }) : undefined,
    );
    return { status: 'success', outputs: result };
  }

  // Tool-driven runs require host.agentRuntime — the inline fallback
  // cannot safely resolve LLM-emitted tool calls. Refuse loudly with
  // the migration pointer so operators wiring this pack on a runtime-less
  // host see the right diagnostic.
  if (tools.length > 0) {
    throw Object.assign(
      new Error(
        'agents.run with tools requires host.agentRuntime. The inline tool-calling fallback ' +
        'was removed in 1.0.1 per OPENWOP-AUDIT-2026-003 — workflow-author-supplied tool ' +
        'handlers ran as raw JS in 1.0.0, breaking prompt-injection-tool-allowlist. ' +
        'Hosts not providing agentRuntime can still use tool-less agent runs (inputs.tools=[]).',
      ),
      { code: 'HOST_CAPABILITY_MISSING' },
    );
  }

  // Tool-less fallback: LLM-only run. No tool dispatch, no exposure.
  if (typeof ctx.callAIWithTools !== 'function') {
    throw Object.assign(
      new Error('host does not implement agents.run, agentRuntime, or aiProviders.toolCalling'),
      { code: 'HOST_CAPABILITY_MISSING' },
    );
  }
  const r = await ctx.callAIWithTools({
    systemPrompt: ctx.config.systemPrompt,
    messages: [{ role: 'user', content: ctx.inputs.userPrompt }],
    tools: [],
  });
  return {
    status: 'success',
    outputs: {
      result: r.text ?? '',
      finalMessage: r.text ?? '',
      steps: [{ kind: 'final', step: 0 }],
      toolCalls: [],
      usage: r.usage ?? {},
      finishReason: 'complete',
    },
  };
}

export const nodes = {
  'core.agents.run': agentRun,
  'core.agents.tool-function': decl('tool'),
  'core.agents.tool-workflow': decl('tool'),
  'core.agents.tool-mcp': decl('tool'),
  'core.agents.tool-http': decl('tool'),
  'core.agents.memory-window': decl('memory'),
  'core.agents.memory-summary': decl('memory'),
  'core.agents.memory-kv-store': decl('memory'),
  'core.agents.output-parser-structured': decl('parser'),
  'core.agents.output-parser-list': decl('parser'),
  'core.agents.output-parser-auto-fix': decl('parser'),
  'core.agents.model-selector': async (ctx) => {
    const rules = ctx.config.rules ?? [];
    // Cap prompt length defensively before regex evaluation — a long
    // adversarial prompt against a workflow-supplied regex could
    // catastrophically backtrack (ReDoS) and block the event loop.
    const prompt = String(ctx.inputs.userPrompt ?? '').slice(0, 4096);
    for (const r of rules) {
      if (!r.predicate) continue;
      let re;
      try {
        re = new RegExp(r.predicate);
      } catch {
        // Malformed regex — skip this rule rather than throwing an
        // uncaught SyntaxError; fall through to subsequent rules and
        // ultimately the fallback model.
        continue;
      }
      if (re.test(prompt)) {
        return { status: 'success', outputs: { model: r.model, rationale: r.rationale ?? 'matched predicate' } };
      }
    }
    return { status: 'success', outputs: { model: ctx.config.fallbackModel, rationale: 'fallback' } };
  },
};

export default nodes;
