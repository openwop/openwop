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
  return {
    status: 'success',
    outputs: {
      result: result?.result ?? null,
      isError: result?.isError === true,
      ...(result?.untrustedContent !== undefined ? { untrustedContent: result.untrustedContent === true } : {}),
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

/* ─── Pack registry ────────────────────────────────────────── */

export const nodes = {
  'core.openwop.mcp.list-tools': listTools,
  'core.openwop.mcp.invoke-tool': invokeTool,
  'core.openwop.mcp.read-resource': readResource,
  'core.openwop.mcp.server-status': serverStatus,
};

export default nodes;
