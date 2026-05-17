/**
 * core.openwop.agents — agent composition primitives.
 *
 * Root: agent.run. Sub-nodes: tool / memory / parser / model-selector.
 * Sub-nodes emit declarations; agent.run consumes them and runs the loop
 * via ctx.callAIWithTools (host.aiProviders.toolCalling) or ctx.agentRuntime.
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

export async function agentRun(ctx) {
  const tools = ctx.inputs.tools ?? [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
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
  // Fallback: call AI with tool-calling capability directly.
  if (typeof ctx.callAIWithTools !== 'function') {
    throw Object.assign(new Error('host does not implement agents.run or aiProviders.toolCalling'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const steps = [];
  const toolCalls = [];
  let messages = [{ role: 'user', content: ctx.inputs.userPrompt }];
  let finalMessage = '';
  let finishReason = 'max-steps';
  let usage = {};
  for (let step = 0; step < (ctx.config.maxSteps ?? 10); step++) {
    const r = await ctx.callAIWithTools({ systemPrompt: ctx.config.systemPrompt, messages, tools });
    usage = r.usage ?? usage;
    if (r.toolCalls?.length) {
      messages.push({ role: 'assistant', content: r.text ?? '', toolCalls: r.toolCalls });
      for (const call of r.toolCalls) {
        toolCalls.push(call);
        const tool = tools.find((t) => t.name === call.name);
        const result = tool?.handler ? await tool.handler(call.arguments, ctx) : { error: 'tool not invokable' };
        messages.push({ role: 'tool', content: JSON.stringify(result), toolUseId: call.id });
        if (emit) await emit({ kind: 'node.progress', payload: { step, toolCall: call, result } });
      }
      steps.push({ kind: 'tool', step });
    } else {
      finalMessage = r.text ?? '';
      finishReason = 'complete';
      steps.push({ kind: 'final', step });
      break;
    }
  }
  return { status: 'success', outputs: { result: finalMessage, finalMessage, steps, toolCalls, usage, finishReason } };
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
    for (const r of rules) {
      if (r.predicate && new RegExp(r.predicate).test(ctx.inputs.userPrompt ?? '')) {
        return { status: 'success', outputs: { model: r.model, rationale: r.rationale ?? 'matched predicate' } };
      }
    }
    return { status: 'success', outputs: { model: ctx.config.fallbackModel, rationale: 'fallback' } };
  },
};

export default nodes;
