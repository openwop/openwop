/**
 * vendor.myndhyve.wop-refinement — wop.feature.refine executor.
 *
 * Engine-side wrapper around the WOP refinement core (parseDecision +
 * applyDecision). Routes through `ctx.callAI` with `responseSchema` to
 * obtain a structured `feature.breakdown` decision payload, then applies
 * hard constraint checks (maxDepth, maxGeneratedItems) before emitting
 * stack-item mutations.
 *
 * The downstream consumer (runner OR chain) is responsible for actually
 * applying mutations — this executor surfaces the decision + mutation
 * array, not the side effects.
 *
 * Lifted from MyndHyve's src/core/wop/refinement/{featureRefineNode,
 * applyDecision, parseDecision}.ts. Original TypeScript imports zero
 * `@/core/*` runtime modules — only Zod schemas (translated to
 * JSON Schema below) and openwop-engine types.
 */

/* ─── ctx.callAI guard ──────────────────────────────────── */

function ensureCallAI(ctx) {
  if (typeof ctx.callAI !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.callAI — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing' }
    );
  }
}

/* ─── JSON Schema for feature.breakdown wire shape ───────
 *
 * Loose discriminator-bearing shape. Per-branch strict validation
 * happens inside parseRefinementDecision below — keeps malformed LLM
 * responses surfaceable as structured `invalid-decision` outcomes
 * rather than being rejected at the AI-call boundary.
 */
const FEATURE_BREAKDOWN_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    decision: { type: 'string' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
    sub_tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        additionalProperties: true,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    target: {},
    questions: { type: 'array', items: { type: 'string' } },
    blockedReason: { type: 'string' },
  },
};

/* ─── prompt builders ───────────────────────────────────── */

const FALLBACK_REFINEMENT_PROMPT = `You decide whether a WOP stack item is actionable.

Respond with a JSON object:
- decision: 'execute_as_node' | 'execute_as_chain' | 'split_into_stack_items' | 'request_clarification' | 'block'
- confidence: number 0..1
- rationale: short text
- For execute_as_node: target.kind='node', target.nodeTypeId, target.inputTemplate
- For execute_as_chain: target.kind='chain', target.workflowId, target.inputTemplate
- For split_into_stack_items: sub_tasks: [{ title, description?, priority? }]
- For request_clarification: questions: string[]
- For block: blockedReason: string

Choose ONLY from the supplied node + chain catalog. Do not invent ids.`;

function buildUserPrompt(inputs) {
  const lines = [];
  lines.push('# Stack item');
  lines.push(`Title: ${inputs.title}`);
  if (inputs.description) lines.push(`Description: ${inputs.description}`);
  if (inputs.goal) lines.push(`Goal: ${inputs.goal}`);
  if (Array.isArray(inputs.acceptanceCriteria) && inputs.acceptanceCriteria.length) {
    lines.push('Acceptance criteria:');
    for (const c of inputs.acceptanceCriteria) lines.push(`- ${c}`);
  }

  const availableNodes = Array.isArray(inputs.availableNodes) ? inputs.availableNodes : [];
  if (availableNodes.length) {
    lines.push('');
    lines.push('# Available single-node capabilities');
    for (const n of availableNodes) {
      lines.push(`- id: ${n.id} | risk: ${n.riskLevel} | approval: ${n.requiresApproval} — ${n.title}: ${n.description}`);
    }
  }
  const availableChains = Array.isArray(inputs.availableChains) ? inputs.availableChains : [];
  if (availableChains.length) {
    lines.push('');
    lines.push('# Available chain capabilities');
    for (const c of availableChains) {
      lines.push(`- id: ${c.id} | risk: ${c.riskLevel} | approval: ${c.requiresApproval} — ${c.title}: ${c.description}`);
    }
  }

  lines.push('');
  lines.push('# Constraints');
  lines.push(`- maxGeneratedItems: ${inputs.constraints.maxGeneratedItems}`);
  lines.push(`- maxDepth: ${inputs.constraints.maxDepth}`);
  lines.push(`- currentDepth: ${inputs.constraints.currentDepth}`);
  lines.push(`- requireHumanApprovalForNewChains: ${inputs.constraints.requireHumanApprovalForNewChains}`);
  return lines.join('\n');
}

/* ─── parseRefinementDecision — lifted verbatim ─────────── */

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampConfidence(raw) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 0.5;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function parsePriority(raw) {
  if (raw === 'critical' || raw === 'high' || raw === 'low') return raw;
  return 'medium';
}

function parseExecuteAsNode(raw, confidence, rationale) {
  const target = raw.target;
  if (!isObject(target) || target.kind !== 'node' || typeof target.nodeTypeId !== 'string') {
    return { ok: false, error: 'execute_as_node decision missing valid target { kind: node, nodeTypeId }' };
  }
  const inputTemplate = isObject(target.inputTemplate) ? target.inputTemplate : {};
  return {
    ok: true,
    decision: {
      kind: 'execute_as_node',
      target: { kind: 'node', nodeTypeId: target.nodeTypeId, inputTemplate },
      confidence,
      rationale,
    },
  };
}

function parseExecuteAsChain(raw, confidence, rationale) {
  const target = raw.target;
  if (!isObject(target) || target.kind !== 'chain' || typeof target.workflowId !== 'string') {
    return { ok: false, error: 'execute_as_chain decision missing valid target { kind: chain, workflowId }' };
  }
  const inputTemplate = isObject(target.inputTemplate) ? target.inputTemplate : {};
  const workflowVersion = typeof target.workflowVersion === 'string' ? target.workflowVersion : undefined;
  return {
    ok: true,
    decision: {
      kind: 'execute_as_chain',
      target: { kind: 'chain', workflowId: target.workflowId, workflowVersion, inputTemplate },
      confidence,
      rationale,
    },
  };
}

function parseSplit(inputs, raw, confidence, rationale) {
  if (!Array.isArray(raw.sub_tasks)) {
    return { ok: false, error: 'split_into_stack_items decision missing sub_tasks array' };
  }
  const generated = [];
  for (let i = 0; i < raw.sub_tasks.length; i++) {
    const st = raw.sub_tasks[i];
    if (!isObject(st) || typeof st.title !== 'string' || st.title.trim() === '') {
      return { ok: false, error: `sub_tasks[${i}] missing required string title` };
    }
    generated.push({
      workspaceId: inputs.workspaceId,
      objectiveId: inputs.objectiveId,
      title: st.title,
      description: typeof st.description === 'string' ? st.description : undefined,
      priority: parsePriority(st.priority),
    });
  }
  return {
    ok: true,
    decision: { kind: 'split_into_stack_items', generatedItems: generated, confidence, rationale },
  };
}

function parseClarification(raw, confidence, rationale) {
  if (!Array.isArray(raw.questions)) {
    return { ok: false, error: 'request_clarification decision missing questions array' };
  }
  const questions = [];
  for (let i = 0; i < raw.questions.length; i++) {
    const q = raw.questions[i];
    if (typeof q !== 'string' || q.trim() === '') {
      return { ok: false, error: `questions[${i}] is not a non-empty string` };
    }
    questions.push(q);
  }
  if (questions.length === 0) {
    return { ok: false, error: 'request_clarification decision needs at least one question' };
  }
  return { ok: true, decision: { kind: 'request_clarification', questions, confidence, rationale } };
}

function parseBlock(raw, confidence, rationale) {
  if (typeof raw.blockedReason !== 'string' || raw.blockedReason.trim() === '') {
    return { ok: false, error: 'block decision missing string blockedReason' };
  }
  return { ok: true, decision: { kind: 'block', blockedReason: raw.blockedReason, confidence, rationale } };
}

function parseRefinementDecision(inputs, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'feature.breakdown payload is not an object' };
  }
  const raw = payload;
  const confidence = clampConfidence(raw.confidence);
  const rationale = typeof raw.rationale === 'string' ? raw.rationale : '';

  const explicit = typeof raw.decision === 'string' ? raw.decision : null;
  if (explicit) {
    switch (explicit) {
      case 'execute_as_node':
        return parseExecuteAsNode(raw, confidence, rationale);
      case 'execute_as_chain':
        return parseExecuteAsChain(raw, confidence, rationale);
      case 'split_into_stack_items':
        return parseSplit(inputs, raw, confidence, rationale);
      case 'request_clarification':
        return parseClarification(raw, confidence, rationale);
      case 'block':
        return parseBlock(raw, confidence, rationale);
      default:
        return { ok: false, error: `Unknown decision discriminator: ${explicit}` };
    }
  }

  // Legacy fallback — no discriminator: presence of sub_tasks means split,
  // absence means clarification.
  if (Array.isArray(raw.sub_tasks) && raw.sub_tasks.length > 0) {
    return parseSplit(inputs, raw, confidence, rationale);
  }
  return parseClarification(
    { ...raw, questions: raw.questions ?? [] },
    confidence,
    rationale || 'No discriminator and no sub_tasks — defaulting to clarification.',
  );
}

/* ─── applyRefinementDecision — lifted verbatim ─────────── */

const DEPTH_TELEMETRY = {
  event: 'autoplay.refinement_depth_exceeded',
  metricKind: 'autoplay.refinement_depth_exceeded',
  detail: 'maxDepth exceeded — refinement loop halted',
};

const COMPLETED_TELEMETRY = {
  event: 'stack.item.refinement_completed',
  metricKind: 'stack.refinement.completed',
};

function terminalFailureTelemetry(detail) {
  return { event: 'autoplay.terminal_failure', metricKind: 'autoplay.terminal_failure', detail };
}

function applyRefinementDecision(inputs, decision) {
  // 1. Hard depth check before any decision is honored. Even a terminal
  //    "block" applies fine at depth, but `split` would seed N+1 children
  //    at depth+1 — refuse.
  if (
    decision.kind === 'split_into_stack_items' &&
    inputs.constraints.currentDepth >= inputs.constraints.maxDepth
  ) {
    return {
      status: 'depth-exceeded',
      mutations: [
        {
          kind: 'mark-blocked',
          stackItemId: inputs.stackItemId,
          reason: 'depth-exceeded',
          detail: `Refinement depth ${inputs.constraints.currentDepth} >= maxDepth ${inputs.constraints.maxDepth}`,
        },
      ],
      telemetry: DEPTH_TELEMETRY,
    };
  }

  // 2. Item-count cap on split decisions.
  if (
    decision.kind === 'split_into_stack_items' &&
    decision.generatedItems.length > inputs.constraints.maxGeneratedItems
  ) {
    return {
      status: 'too-many-items',
      mutations: [
        {
          kind: 'mark-blocked',
          stackItemId: inputs.stackItemId,
          reason: 'too-many-items',
          detail: `Refinement proposed ${decision.generatedItems.length} items; cap is ${inputs.constraints.maxGeneratedItems}`,
        },
      ],
      telemetry: terminalFailureTelemetry(
        `Refinement proposed ${decision.generatedItems.length} > ${inputs.constraints.maxGeneratedItems} items`,
      ),
    };
  }

  // 3. Honor the decision.
  switch (decision.kind) {
    case 'execute_as_node':
      return {
        status: 'applied',
        decision,
        mutations: [{ kind: 'update-target', stackItemId: inputs.stackItemId, target: decision.target }],
        telemetry: COMPLETED_TELEMETRY,
      };
    case 'execute_as_chain': {
      if (inputs.constraints.requireHumanApprovalForNewChains) {
        return {
          status: 'applied',
          decision,
          mutations: [
            {
              kind: 'update-target',
              stackItemId: inputs.stackItemId,
              target: { kind: 'human', checkpointType: 'approval' },
            },
          ],
          telemetry: COMPLETED_TELEMETRY,
        };
      }
      return {
        status: 'applied',
        decision,
        mutations: [{ kind: 'update-target', stackItemId: inputs.stackItemId, target: decision.target }],
        telemetry: COMPLETED_TELEMETRY,
      };
    }
    case 'split_into_stack_items': {
      const mutations = decision.generatedItems.map((options) => ({
        kind: 'create-child',
        options: {
          ...options,
          objectiveId: inputs.objectiveId,
          workspaceId: options.workspaceId,
          parentStackItemId: inputs.stackItemId,
        },
      }));
      mutations.push({ kind: 'mark-superseded', stackItemId: inputs.stackItemId });
      return { status: 'applied', decision, mutations, telemetry: COMPLETED_TELEMETRY };
    }
    case 'request_clarification':
      return {
        status: 'applied',
        decision,
        mutations: [
          { kind: 'request-clarification', stackItemId: inputs.stackItemId, questions: decision.questions },
        ],
        telemetry: COMPLETED_TELEMETRY,
      };
    case 'block':
      return {
        status: 'applied',
        decision,
        mutations: [
          {
            kind: 'mark-blocked',
            stackItemId: inputs.stackItemId,
            reason: 'policy-denied',
            detail: decision.blockedReason,
          },
        ],
        telemetry: COMPLETED_TELEMETRY,
      };
    default:
      return {
        status: 'invalid-decision',
        mutations: [],
        telemetry: terminalFailureTelemetry(`Unknown decision kind: ${decision.kind}`),
      };
  }
}

/* ─── executor ──────────────────────────────────────────── */

export async function featureRefine(ctx) {
  ensureCallAI(ctx);
  const inputs = ctx.inputs;
  const config = ctx.config ?? {};

  // The host already validates ctx.inputs against the JSON Schema at
  // dispatch time. Defensive-check the critical shape so a misconfigured
  // host still gets a clear error rather than a deep TypeError.
  if (
    !inputs ||
    typeof inputs.workspaceId !== 'string' ||
    typeof inputs.stackItemId !== 'string' ||
    !inputs.constraints ||
    typeof inputs.constraints.maxDepth !== 'number' ||
    typeof inputs.constraints.maxGeneratedItems !== 'number'
  ) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'Refinement inputs missing required fields', retryable: false },
    };
  }

  const userPrompt = buildUserPrompt(inputs);
  const systemPrompt = typeof config.systemPromptOverride === 'string'
    ? config.systemPromptOverride
    : FALLBACK_REFINEMENT_PROMPT;

  if (typeof ctx.log === 'function') {
    ctx.log('info', 'Refinement node: invoking AI', {
      stackItemId: inputs.stackItemId,
      availableNodes: (inputs.availableNodes ?? []).length,
      availableChains: (inputs.availableChains ?? []).length,
    });
  }

  // Call AI via openwop's responseSchema-shaped structured-output path.
  // The host's aiProviders surface handles BYOK + budget tracking.
  let rawPayload = null;
  try {
    const result = await ctx.callAI({
      provider: config.provider,
      model: config.model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.2,
      responseSchema: FEATURE_BREAKDOWN_SCHEMA,
    });
    rawPayload = result?.data ?? null;
  } catch (err) {
    return {
      status: 'error',
      error: {
        code: 'AI_INVOKE_FAILED',
        message: err instanceof Error ? err.message : 'Refinement AI invoke failed',
        retryable: true,
      },
    };
  }

  if (rawPayload === null || rawPayload === undefined) {
    return {
      status: 'error',
      error: {
        code: 'AI_NO_ENVELOPE',
        message: 'Refinement AI completed without emitting a feature.breakdown payload',
        retryable: true,
      },
    };
  }

  const parsed = parseRefinementDecision(inputs, rawPayload);
  if (!parsed.ok) {
    return {
      status: 'error',
      error: {
        code: 'INVALID_DECISION_ENVELOPE',
        message: `Refinement returned an invalid envelope: ${parsed.error}`,
        retryable: false,
      },
    };
  }

  const outcome = applyRefinementDecision(inputs, parsed.decision);

  if (typeof ctx.log === 'function') {
    ctx.log('info', 'Refinement node: outcome', {
      stackItemId: inputs.stackItemId,
      status: outcome.status,
      mutationCount: outcome.mutations.length,
      telemetryEvent: outcome.telemetry.event,
    });
  }

  return {
    status: 'success',
    outputs: {
      status: outcome.status,
      decisionKind: outcome.decision?.kind,
      mutations: outcome.mutations,
      mutationCount: outcome.mutations.length,
      telemetryEvent: outcome.telemetry.event,
      telemetryDetail: outcome.telemetry.detail,
    },
  };
}

/* ─── default export — typeId → executor map ───────────── */

const nodes = {
  'wop.feature.refine': featureRefine,
};

export default nodes;
