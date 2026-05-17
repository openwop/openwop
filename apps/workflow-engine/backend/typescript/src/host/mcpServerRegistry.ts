/**
 * MCP server registry — declarative scan of registered workflows for
 * `core.openwop.mcp.expose-{tool,resource,prompt}` and
 * `core.openwop.mcp.handle-{sampling,elicitation}` nodes.
 *
 * The RFC 0020 §A point 2 explicit phrase "host's equivalent declarative
 * shape" sanctions this approach: rather than runtime-registering via a
 * `ctx.mcp.expose(...)` call (which requires running the workflow once),
 * the registry scans each workflow definition at lookup time and extracts
 * the manifest from the node config. The conformance suite can register a
 * workflow via `POST /v1/host/sample/workflows` and immediately have it
 * advertised in `tools/list`.
 *
 * Tenant scoping (sample-grade HONESTLY): the underlying `workflowsRegistry`
 * is process-global by design (a real host would persist per-tenant in
 * storage). The functions below enumerate ALL registered workflows without
 * a tenant filter — the sample host has a single shared workflow space.
 * **Real hosts MUST tenant-scope** every lookup (`listTools`, `listResources`,
 * `listPrompts`, `find*ByName/Uri`) against the calling `principal.tenants`
 * before returning entries to the MCP wire, or cross-tenant workflow
 * disclosure occurs. Track this when promoting `apps/workflow-engine` to
 * a non-sample reference host, OR when adding multi-tenant capability to
 * `workflowsRegistry.ts` itself.
 *
 * @see RFCS/0020-host-mcp-server-composition.md §A points 1-3
 * @see packs/core.openwop.mcp/schemas/expose-tool.config.json
 */

import { listRegisteredWorkflows } from './workflowsRegistry.js';
import type { WorkflowDefinition } from '../executor/types.js';

export type ExposeKind = 'tool' | 'resource' | 'resource-template' | 'prompt';

export interface ExposedToolManifest {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  workflowId: string;
}

export interface ExposedResourceManifest {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  workflowId: string;
}

export interface ExposedPromptManifest {
  name: string;
  description?: string;
  arguments?: ReadonlyArray<{ name: string; description?: string; required?: boolean }>;
  workflowId: string;
}

export interface HandlerWorkflow {
  workflowId: string;
}

const TYPE_EXPOSE_TOOL = 'core.openwop.mcp.expose-tool';
const TYPE_EXPOSE_RESOURCE = 'core.openwop.mcp.expose-resource';
const TYPE_EXPOSE_RESOURCE_TEMPLATE = 'core.openwop.mcp.expose-resource-template';
const TYPE_EXPOSE_PROMPT = 'core.openwop.mcp.expose-prompt';
const TYPE_HANDLE_SAMPLING = 'core.openwop.mcp.handle-sampling';
const TYPE_HANDLE_ELICITATION = 'core.openwop.mcp.handle-elicitation';

function findNodes(def: WorkflowDefinition, typeId: string): Array<{ config?: Record<string, unknown> }> {
  return def.nodes.filter((n) => n.typeId === typeId);
}

export function listTools(): ExposedToolManifest[] {
  const out: ExposedToolManifest[] = [];
  for (const def of listRegisteredWorkflows()) {
    for (const node of findNodes(def, TYPE_EXPOSE_TOOL)) {
      const cfg = node.config ?? {};
      const name = typeof cfg.name === 'string' ? cfg.name : null;
      if (!name) continue;
      const description = typeof cfg.description === 'string' ? cfg.description : undefined;
      const inputSchema =
        cfg.inputSchema && typeof cfg.inputSchema === 'object'
          ? (cfg.inputSchema as Record<string, unknown>)
          : { type: 'object', additionalProperties: true };
      const entry: ExposedToolManifest = { name, inputSchema, workflowId: def.workflowId };
      if (description !== undefined) entry.description = description;
      out.push(entry);
    }
  }
  return out;
}

export function findToolByName(name: string): ExposedToolManifest | null {
  return listTools().find((t) => t.name === name) ?? null;
}

export function listResources(): ExposedResourceManifest[] {
  const out: ExposedResourceManifest[] = [];
  for (const def of listRegisteredWorkflows()) {
    for (const node of findNodes(def, TYPE_EXPOSE_RESOURCE)) {
      const cfg = node.config ?? {};
      const uri = typeof cfg.uri === 'string' ? cfg.uri : null;
      if (!uri) continue;
      const entry: ExposedResourceManifest = { uri, workflowId: def.workflowId };
      if (typeof cfg.name === 'string') entry.name = cfg.name;
      if (typeof cfg.description === 'string') entry.description = cfg.description;
      if (typeof cfg.mimeType === 'string') entry.mimeType = cfg.mimeType;
      out.push(entry);
    }
  }
  return out;
}

export function listResourceTemplates(): ExposedResourceManifest[] {
  const out: ExposedResourceManifest[] = [];
  for (const def of listRegisteredWorkflows()) {
    for (const node of findNodes(def, TYPE_EXPOSE_RESOURCE_TEMPLATE)) {
      const cfg = node.config ?? {};
      const uri = typeof cfg.uriTemplate === 'string' ? cfg.uriTemplate : null;
      if (!uri) continue;
      const entry: ExposedResourceManifest = { uri, workflowId: def.workflowId };
      if (typeof cfg.name === 'string') entry.name = cfg.name;
      if (typeof cfg.description === 'string') entry.description = cfg.description;
      if (typeof cfg.mimeType === 'string') entry.mimeType = cfg.mimeType;
      out.push(entry);
    }
  }
  return out;
}

export function findResourceByUri(uri: string): ExposedResourceManifest | null {
  return listResources().find((r) => r.uri === uri) ?? null;
}

export function listPrompts(): ExposedPromptManifest[] {
  const out: ExposedPromptManifest[] = [];
  for (const def of listRegisteredWorkflows()) {
    for (const node of findNodes(def, TYPE_EXPOSE_PROMPT)) {
      const cfg = node.config ?? {};
      const name = typeof cfg.name === 'string' ? cfg.name : null;
      if (!name) continue;
      const entry: ExposedPromptManifest = { name, workflowId: def.workflowId };
      if (typeof cfg.description === 'string') entry.description = cfg.description;
      if (Array.isArray(cfg.arguments)) {
        entry.arguments = cfg.arguments.filter(
          (a): a is { name: string; description?: string; required?: boolean } =>
            typeof a === 'object' && a !== null && typeof (a as { name?: unknown }).name === 'string',
        );
      }
      out.push(entry);
    }
  }
  return out;
}

export function findPromptByName(name: string): ExposedPromptManifest | null {
  return listPrompts().find((p) => p.name === name) ?? null;
}

/** Find the first workflow that contains a handle-sampling node. */
export function findSamplingHandler(): HandlerWorkflow | null {
  for (const def of listRegisteredWorkflows()) {
    if (findNodes(def, TYPE_HANDLE_SAMPLING).length > 0) {
      return { workflowId: def.workflowId };
    }
  }
  return null;
}

/** Find the first workflow that contains a handle-elicitation node. */
export function findElicitationHandler(): HandlerWorkflow | null {
  for (const def of listRegisteredWorkflows()) {
    if (findNodes(def, TYPE_HANDLE_ELICITATION).length > 0) {
      return { workflowId: def.workflowId };
    }
  }
  return null;
}
