/**
 * core.openwop.mcp — workflow-author-direct MCP-operation pack.
 *
 * Four nodes route through the host's MCP client (`ctx.mcp.{...}`)
 * — the pack itself speaks no MCP protocol. The host owns the
 * MCP server registry, transport (stdio / HTTP / SSE), connection
 * lifecycle, and the `prompt-injection-mcp-marker` security
 * invariant from SECURITY/threat-model-prompt-injection.md.
 *
 * Composition with spec/v1/mcp-integration.md:
 *   Implicit LLM-mediated tool calls happen inside an AI node when
 *   the LLM emits a tool-call envelope. THIS pack covers the
 *   EXPLICIT case — workflow authors invoking MCP operations
 *   deterministically from the DAG. Same host MCP client; different
 *   call site.
 *
 * Replay model:
 *   All 4 nodes declare `side-effectful + cacheable`. Engine's
 *   Layer-2 invocation log caches terminal outputs keyed on
 *   (runId, nodeId, request-hash). Replays return cached payloads
 *   without re-calling the MCP server.
 *
 * Host contract (informative; the openwop spec doesn't yet
 * normatively declare ctx.mcp — hosts advertising `mcp.supported`
 * MUST expose an equivalent surface):
 *
 *   ctx.mcp.listTools(serverId) → Promise<{ tools: Array<{name, description?, inputSchema?}> }>
 *   ctx.mcp.invokeTool(serverId, toolName, args, opts?) →
 *     Promise<{ result: any, isError: boolean, untrustedContent?: boolean }>
 *   ctx.mcp.readResource(serverId, uri, opts?) →
 *     Promise<{ content: string|object|null, mimeType: string, encoding?: 'utf-8'|'base64' }>
 *   ctx.mcp.serverStatus(serverId, opts?) →
 *     Promise<{ available: boolean, name?: string, version?: string, error?: string }>
 *
 * @see spec/v1/mcp-integration.md
 * @see spec/v1/capabilities.md (host MCP advertisement is host-extension)
 * @see SECURITY/threat-model-prompt-injection.md (mcp-* invariants)
 * @see docs/PACKS-MVP-PLAN.md
 */

function ensureMcp(ctx) {
  if (!ctx.mcp || typeof ctx.mcp.listTools !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.mcp — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing' }
    );
  }
}

/* ─── core.openwop.mcp.list-tools ──────────────────────────── */

export async function listTools(ctx) {
  ensureMcp(ctx);
  const { serverId } = ctx.config;
  const result = await ctx.mcp.listTools(serverId);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return {
    status: 'success',
    outputs: {
      tools,
      count: tools.length,
    },
  };
}

/* ─── core.openwop.mcp.invoke-tool ─────────────────────────── */

export async function invokeTool(ctx) {
  ensureMcp(ctx);
  const { serverId, toolName, timeoutMs } = ctx.config;
  const { args } = ctx.inputs;
  const start = Date.now();
  const result = await ctx.mcp.invokeTool(serverId, toolName, args, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  // RFC 0020 §D + SECURITY/threat-model-prompt-injection.md
  // `prompt-injection-mcp-marker` invariant: MCP tool responses MUST be
  // wrapped in `<UNTRUSTED tool="...">...</UNTRUSTED>` markers before
  // reaching the next LLM turn. We surface a `markedContent` convenience
  // field whenever (a) the host's MCP client flagged the response as
  // untrusted OR (b) the run is operating under an untrusted boundary
  // (every inbound MCP-server-mount tools/call). Downstream nodes can
  // consume markedContent directly OR re-derive from result.
  const untrustedContent = result?.untrustedContent === true;
  const runIsUntrusted = ctx.trustBoundary === 'untrusted';
  const shouldMark = untrustedContent || runIsUntrusted;
  let markedContent;
  if (shouldMark && result?.result != null) {
    const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    const safeTool = String(toolName).replace(/"/g, '&quot;');
    markedContent = `<UNTRUSTED tool="${safeTool}">${raw}</UNTRUSTED>`;
  }
  return {
    status: 'success',
    outputs: {
      result: result?.result ?? null,
      isError: result?.isError === true,
      ...(result?.untrustedContent !== undefined ? { untrustedContent } : {}),
      ...(markedContent !== undefined ? { markedContent } : {}),
      durationMs: Date.now() - start,
    },
  };
}

/* ─── core.openwop.mcp.read-resource ───────────────────────── */

export async function readResource(ctx) {
  ensureMcp(ctx);
  const { serverId, uri, timeoutMs } = ctx.config;
  const result = await ctx.mcp.readResource(serverId, uri, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return {
    status: 'success',
    outputs: {
      content: result?.content ?? null,
      mimeType: result?.mimeType ?? '',
      ...(result?.encoding ? { encoding: result.encoding } : {}),
      uri,
    },
  };
}

/* ─── core.openwop.mcp.server-status ───────────────────────── */

/**
 * Server-status returns a structural answer rather than throwing.
 * The whole point is health-checking; "server is down" is the
 * expected unhappy path, not an exception. Workflow authors branch
 * on `available`.
 */
export async function serverStatus(ctx) {
  ensureMcp(ctx);
  const { serverId, timeoutMs = 5000 } = ctx.config;
  const start = Date.now();

  try {
    const result = await ctx.mcp.serverStatus(serverId, { timeoutMs });
    const latencyMs = Date.now() - start;
    if (result?.available === true) {
      return {
        status: 'success',
        outputs: {
          available: true,
          ...(result.name ? { name: result.name } : {}),
          ...(result.version ? { version: result.version } : {}),
          latencyMs,
        },
      };
    }
    return {
      status: 'success',
      outputs: {
        available: false,
        latencyMs,
        ...(result?.error ? { error: String(result.error) } : { error: 'server reported unavailable' }),
      },
    };
  } catch (err) {
    return {
      status: 'success',
      outputs: {
        available: false,
        latencyMs: Date.now() - start,
        error: err?.message ?? 'unknown error',
      },
    };
  }
}

/* ─── v1.1 client-side additions ──────────────────────────── */

function callMcp(method) {
  return async function (ctx) {
    ensureMcp(ctx);
    const fn = ctx.mcp[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.mcp.${method}`), { code: 'host_capability_missing' });
    }
    const result = await fn.call(ctx.mcp, {
      serverId: ctx.config.serverId,
      ...ctx.config,
      ...ctx.inputs,
    });
    return { status: 'success', outputs: { result } };
  };
}

export const listResources = callMcp('listResources');
export const listResourceTemplates = callMcp('listResourceTemplates');
export const listPrompts = callMcp('listPrompts');
export const getPrompt = callMcp('getPrompt');
export const completion = callMcp('completion');
export const setLogLevel = callMcp('setLogLevel');

export async function subscribeResource(ctx) {
  ensureMcp(ctx);
  if (typeof ctx.mcp.subscribeResource !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.mcp.subscribeResource'), { code: 'host_capability_missing' });
  }
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  await ctx.mcp.subscribeResource(
    { serverId: ctx.config.serverId, uri: ctx.inputs.uri },
    async (event) => { events.push(event); if (emit) await emit({ kind: 'node.progress', payload: event }); },
  );
  return { status: 'success', outputs: { events, eventCount: events.length } };
}

export async function logListener(ctx) {
  ensureMcp(ctx);
  if (typeof ctx.mcp.logListener !== 'function') {
    throw Object.assign(new Error('host does not implement ctx.mcp.logListener'), { code: 'host_capability_missing' });
  }
  const events = [];
  const emit = typeof ctx.emit === 'function' ? ctx.emit : null;
  await ctx.mcp.logListener(
    { serverId: ctx.config.serverId, durationMs: ctx.config.durationMs ?? 60000 },
    async (event) => { events.push(event); if (emit) await emit({ kind: 'node.progress', payload: event }); },
  );
  return { status: 'success', outputs: { events, eventCount: events.length } };
}

export async function ping(ctx) {
  ensureMcp(ctx);
  if (typeof ctx.mcp.ping !== 'function') {
    return { status: 'success', outputs: { ok: false, roundtripMs: null, reason: 'host does not implement ctx.mcp.ping' } };
  }
  const t0 = Date.now();
  try {
    await ctx.mcp.ping({ serverId: ctx.config.serverId });
    return { status: 'success', outputs: { ok: true, roundtripMs: Date.now() - t0 } };
  } catch (e) {
    return { status: 'success', outputs: { ok: false, roundtripMs: Date.now() - t0, reason: e?.message ?? 'unknown' } };
  }
}

/* ─── Server-side (workflow IS an MCP server) ─────────────── */

export async function serverTrigger(ctx) {
  // Trigger-style: the host's MCP-server mount fires this when a JSON-RPC request arrives.
  const data = ctx.triggerData ?? {};
  return {
    status: 'success',
    outputs: {
      method: data.method ?? '',
      params: data.params ?? {},
      sessionId: data.sessionId ?? null,
      protocolVersion: data.protocolVersion ?? null,
    },
  };
}

function exposeOp(kind) {
  return async function (ctx) {
    if (typeof ctx.mcp?.expose !== 'function') {
      throw Object.assign(new Error('host does not implement ctx.mcp.expose'), { code: 'host_capability_missing' });
    }
    const handle = await ctx.mcp.expose({ kind, manifest: { ...ctx.config, ...ctx.inputs } });
    return { status: 'success', outputs: { handle, kind } };
  };
}

export const exposeTool = exposeOp('tool');
export const exposeResource = exposeOp('resource');
export const exposeResourceTemplate = exposeOp('resource-template');
export const exposePrompt = exposeOp('prompt');

export async function handleSampling(ctx) {
  if (typeof ctx.callAI !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.callAI for sampling routing'), { code: 'host_capability_missing' });
  }
  const req = ctx.inputs.request;
  const result = await ctx.callAI({
    messages: req.messages,
    systemPrompt: req.systemPrompt,
    maxTokens: req.maxTokens,
    stopSequences: req.stopSequences,
    modelPreferences: req.modelPreferences,
  });
  return { status: 'success', outputs: { result } };
}

export async function handleElicitation(ctx) {
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not support suspend'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const req = ctx.inputs.request;
  const result = await ctx.suspend({
    kind: 'clarification',
    profile: 'openwop-mcp-elicitation',
    prompt: req.message,
    formSchema: req.requestedSchema,
  });
  return {
    status: 'success',
    outputs: {
      action: result.action ?? 'accept',
      content: result.payload ?? {},
    },
  };
}

export async function provideRoots(ctx) {
  // Declarative — emits the list. Host's MCP server reads ctx.config.roots when responding to roots/list.
  return {
    status: 'success',
    outputs: {
      roots: (ctx.config.roots || []).map((r) => ({ uri: r.uri, name: r.name ?? null })),
      count: (ctx.config.roots || []).length,
    },
  };
}

/* ─── Pack registry ────────────────────────────────────────── */

export const nodes = {
  'core.openwop.mcp.list-tools': listTools,
  'core.openwop.mcp.invoke-tool': invokeTool,
  'core.openwop.mcp.read-resource': readResource,
  'core.openwop.mcp.server-status': serverStatus,
  'core.openwop.mcp.list-resources': listResources,
  'core.openwop.mcp.list-resource-templates': listResourceTemplates,
  'core.openwop.mcp.subscribe-resource': subscribeResource,
  'core.openwop.mcp.list-prompts': listPrompts,
  'core.openwop.mcp.get-prompt': getPrompt,
  'core.openwop.mcp.completion': completion,
  'core.openwop.mcp.set-log-level': setLogLevel,
  'core.openwop.mcp.log-listener': logListener,
  'core.openwop.mcp.ping': ping,
  'core.openwop.mcp.server-trigger': serverTrigger,
  'core.openwop.mcp.expose-tool': exposeTool,
  'core.openwop.mcp.expose-resource': exposeResource,
  'core.openwop.mcp.expose-resource-template': exposeResourceTemplate,
  'core.openwop.mcp.expose-prompt': exposePrompt,
  'core.openwop.mcp.handle-sampling': handleSampling,
  'core.openwop.mcp.handle-elicitation': handleElicitation,
  'core.openwop.mcp.provide-roots': provideRoots,
};

export default nodes;
