#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.mcp';
const VER = '1.1.0';
const OUT = join('packs', PACK, 'schemas');
mkdirSync(OUT, { recursive: true });
const $id = (f) => `https://packs.openwop.dev/${PACK}/${VER}/${f}`;
const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const SERVER_ID = { type: 'string', description: 'Host-registered MCP server id.' };
const RESULT = { type: 'object', additionalProperties: true };
const FLAT_SCHEMA = { type: 'object', additionalProperties: true, description: 'Flat JSON Schema constrained to primitive/enum properties.' };

const M = {
  'list-resources': {
    c: obj('McpListResourcesConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpListResourcesInput', [], { cursor: { type: 'string' } }),
    o: obj('McpListResourcesOutput', ['result'], { result: RESULT }),
  },
  'list-resource-templates': {
    c: obj('McpListResourceTemplatesConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpListResourceTemplatesInput', [], { cursor: { type: 'string' } }),
    o: obj('McpListResourceTemplatesOutput', ['result'], { result: RESULT }),
  },
  'subscribe-resource': {
    c: obj('McpSubscribeResourceConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpSubscribeResourceInput', ['uri'], { uri: { type: 'string' } }),
    o: obj('McpSubscribeResourceOutput', ['events','eventCount'], {
      events: { type: 'array', items: RESULT }, eventCount: { type: 'integer' },
    }),
  },
  'list-prompts': {
    c: obj('McpListPromptsConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpListPromptsInput', [], { cursor: { type: 'string' } }),
    o: obj('McpListPromptsOutput', ['result'], { result: RESULT }),
  },
  'get-prompt': {
    c: obj('McpGetPromptConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpGetPromptInput', ['name'], { name: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } }),
    o: obj('McpGetPromptOutput', ['result'], { result: RESULT }),
  },
  completion: {
    c: obj('McpCompletionConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpCompletionInput', ['ref','argument'], {
      ref: { type: 'object', additionalProperties: true },
      argument: { type: 'object', additionalProperties: true },
    }),
    o: obj('McpCompletionOutput', ['result'], { result: RESULT }),
  },
  'set-log-level': {
    c: obj('McpSetLogLevelConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpSetLogLevelInput', ['level'], { level: { type: 'string', enum: ['debug','info','notice','warning','error','critical','alert','emergency'] } }),
    o: obj('McpSetLogLevelOutput', ['result'], { result: RESULT }),
  },
  'log-listener': {
    c: obj('McpLogListenerConfig', ['serverId'], { serverId: SERVER_ID, durationMs: { type: 'integer', minimum: 0, default: 60000 } }),
    i: obj('McpLogListenerInput', [], {}),
    o: obj('McpLogListenerOutput', ['events','eventCount'], {
      events: { type: 'array', items: RESULT }, eventCount: { type: 'integer' },
    }),
  },
  ping: {
    c: obj('McpPingConfig', ['serverId'], { serverId: SERVER_ID }),
    i: obj('McpPingInput', [], {}),
    o: obj('McpPingOutput', ['ok'], { ok: { type: 'boolean' }, roundtripMs: { type: ['integer','null'] }, reason: { type: 'string' } }),
  },
  'server-trigger': {
    c: obj('McpServerTriggerConfig', [], {
      transport: { type: 'string', enum: ['stdio','streamable-http'], default: 'streamable-http' },
      path: { type: 'string', description: 'For streamable-http transport.' },
    }),
    i: obj('McpServerTriggerInput', [], {}),
    o: obj('McpServerTriggerOutput', ['method'], {
      method: { type: 'string' }, params: { type: 'object', additionalProperties: true },
      sessionId: { type: ['string','null'] }, protocolVersion: { type: ['string','null'] },
    }),
  },
  'expose-tool': {
    c: obj('McpExposeToolConfig', ['name'], {
      name: { type: 'string' }, description: { type: 'string' },
      inputSchema: FLAT_SCHEMA,
    }),
    i: obj('McpExposeToolInput', [], { handler: { type: 'string' } }),
    o: obj('McpExposeToolOutput', ['handle'], { handle: { type: 'string' }, kind: { type: 'string' } }),
  },
  'expose-resource': {
    c: obj('McpExposeResourceConfig', ['uri'], { uri: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' } }),
    i: obj('McpExposeResourceInput', [], {}),
    o: obj('McpExposeResourceOutput', ['handle'], { handle: { type: 'string' }, kind: { type: 'string' } }),
  },
  'expose-resource-template': {
    c: obj('McpExposeResourceTemplateConfig', ['uriTemplate'], { uriTemplate: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' } }),
    i: obj('McpExposeResourceTemplateInput', [], {}),
    o: obj('McpExposeResourceTemplateOutput', ['handle'], { handle: { type: 'string' }, kind: { type: 'string' } }),
  },
  'expose-prompt': {
    c: obj('McpExposePromptConfig', ['name','template'], {
      name: { type: 'string' }, template: { type: 'string' },
      arguments: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }),
    i: obj('McpExposePromptInput', [], {}),
    o: obj('McpExposePromptOutput', ['handle'], { handle: { type: 'string' }, kind: { type: 'string' } }),
  },
  'handle-sampling': {
    c: obj('McpHandleSamplingConfig', [], { modelHint: { type: 'string' } }),
    i: obj('McpHandleSamplingInput', ['request'], { request: { type: 'object', additionalProperties: true } }),
    o: obj('McpHandleSamplingOutput', ['result'], { result: { type: 'object', additionalProperties: true } }),
  },
  'handle-elicitation': {
    c: obj('McpHandleElicitationConfig', [], {}),
    i: obj('McpHandleElicitationInput', ['request'], { request: { type: 'object', additionalProperties: true } }),
    o: obj('McpHandleElicitationOutput', ['action'], {
      action: { type: 'string', enum: ['accept','decline','cancel'] },
      content: { type: 'object', additionalProperties: true },
    }),
  },
  'provide-roots': {
    c: obj('McpProvideRootsConfig', ['roots'], {
      roots: { type: 'array', items: obj('Root', ['uri'], { uri: { type: 'string' }, name: { type: 'string' } }) },
    }),
    i: obj('McpProvideRootsInput', [], {}),
    o: obj('McpProvideRootsOutput', ['roots','count'], {
      roots: { type: 'array' }, count: { type: 'integer' },
    }),
  },
};

let count = 0;
for (const [node, parts] of Object.entries(M)) {
  for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
    const f = `${node}.${k}.json`;
    const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
    writeFileSync(join(OUT, f), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
}
console.log(`wrote ${count} schemas to ${OUT}`);
