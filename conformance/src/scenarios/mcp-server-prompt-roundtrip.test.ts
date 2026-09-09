/**
 * mcp-server-prompt-roundtrip — RFC 0020 §A (prompts/list + prompts/get).
 *
 * Status: ACTIVE (advertisement + behavioral).
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { req } from '../lib/requirement-ids.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const cur = (top && typeof top === 'object') ? (top as Record<string, unknown>)["mcp"] : undefined;
  const final = (cur && typeof cur === 'object') ? (cur as Record<string, unknown>)["serverMount"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function rpc(method: string, params?: Record<string, unknown>) {
  const id = Math.floor(Math.random() * 1e6);
  const reqBody: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) reqBody.params = params;
  const res = await driver.post(await mcpServerMount(), reqBody);
  return { status: res.status, body: res.json as { result?: unknown; error?: { code: number; message: string } } };
}

const PROMPT_NAME = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function registerPromptWorkflow(): Promise<boolean> {
  const res = await driver.post('/v1/host/sample/workflows', {
    workflowId: `mcp.prompt.${Date.now()}`,
    nodes: [
      {
        nodeId: 'expose',
        typeId: 'core.openwop.mcp.expose-prompt',
        config: {
          name: PROMPT_NAME,
          description: 'Conformance prompt',
          arguments: [{ name: 'topic', description: 'subject of the prompt', required: false }],
        },
      },
    ],
  });
  return res.status === 200 || res.status === 201;
}

describe('mcp-server-prompt-roundtrip: advertisement shape (RFC 0020)', () => {
  it('capabilities.mcp.serverMount is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early');
    expect(typeof cap.supported, req('openwop.it.mcp-server-prompt-roundtrip.capabilities-mcp-servermount-is-either-absent-or-a-well-formed-object', 'RFC 0020 §A', 'capabilities.mcp.serverMount is either absent or a well-formed object')).toBe('boolean');
  });
});

describe('mcp-server-prompt-roundtrip: behavioral (RFC 0020)', () => {
  it('prompts/list returns the exposed prompt and prompts/get returns messages', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!cap || cap.supported !== true` returned early');
    if (!(await registerPromptWorkflow())) return softSkip('blocked', 'precondition not met — `!(await registerPromptWorkflow())` returned early (seam, prior step, or fixture unavailable)');

    const list = await rpc('prompts/list');
    if (list.status === 404) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${list.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    const prompts = (list.body.result as { prompts?: Array<{ name: string }> } | undefined)?.prompts ?? [];
    expect(
      prompts.find((p) => p.name === PROMPT_NAME),
      req('openwop.it.mcp-server-prompt-roundtrip.prompts-list-returns-the-exposed-prompt-and-prompts-get-returns-messages', 'RFC 0020 §A', 'prompts/list MUST include exposed prompts'),
    ).toBeDefined();

    const get = await rpc('prompts/get', { name: PROMPT_NAME, arguments: { topic: 'openwop' } });
    expect(get.status).toBe(200);
    const messages = (get.body.result as { messages?: Array<{ role: string }> } | undefined)?.messages;
    expect(Array.isArray(messages), req('openwop.it.mcp-server-prompt-roundtrip.prompts-list-returns-the-exposed-prompt-and-prompts-get-returns-messages', 'RFC 0020 §A', 'prompts/get MUST return messages[]')).toBe(true);
  });
});
